import { randomUUID } from 'node:crypto'
import type { ProviderRegistry } from './providers/registry'
import type { Role, RoleBinding, RoleModelConfig, ReasoningEffort } from './roles'
import { resolvePhaseBinding } from './roles'
import { defaultQuorumThreshold } from './quorum'
import type { CostAggregator } from './dashboards/cost'
import type { TrustLedger } from './trust/ledger'
import type { AuthoritySas } from './authority/sas'
import { evaluateClosure } from './gates/stopgate'
import { HookBus } from './hooks/hook-bus'
import { createDefaultHookBus } from './hooks/default-gate-hooks'
import { resolveVerifyCmd } from './hooks/resolve-verify-cmd'
import { phaseInstruction, type PipelinePhase } from './skill-pipeline'
import { combinePhaseInstruction, type PhaseInstructionOverride } from './workflow-instruction'
import {
  agentsForPhase,
  allocationFromGraph,
  linearPhasesOf,
  nodeRanks,
  quorumForPhase,
  recoveriesFromGraph,
  worstCaseNodeExecutions,
  type WorkflowGraph
} from './workflow-graph'
import { initialBudget, nextNode, type NodeVerdict } from './workflow-walk'

/**
 * Ce qui fait d'une sortie de phase un ROUGE. Marqueur en TÊTE uniquement : un compte rendu qui
 * mentionne « défaut » au milieu d'un paragraphe raconte son travail, il ne se prononce pas.
 */
const REJET_EN_TETE = /^\s*(REJET|REJETE|REJETÉ|INVALIDE|DEFAUT|DÉFAUT|ROUGE|KO)\b/i
/** La forme que le brief du juge IMPOSE pour un rejet : « DEFAUT: <raison> », où qu'elle se trouve. */
const REJET_FORME_CONTRAT = /\b(REJET|REJETE|REJETÉ|INVALIDE|DEFAUT|DÉFAUT|KO)\s*:/i
/** L'approbation que le brief du juge IMPOSE : « Réponds STRICTEMENT par "VALIDE" ou "DEFAUT: …" ». */
const APPROBATION_CONTRAT = /\bVALIDE\b/i

/**
 * Lit le verdict d'une phase — FERMÉ par défaut pour le juge.
 *
 * `REJET_EN_TETE` seul ne testait que les PREMIERS mots, ce qui rendait VERT tout juge qui n'avait pas
 * la bonne forme. Mesuré le 2026-08-05 sur les 4 cas dégénérés, tous lus « green » :
 *   texte vide · « Error: provider timeout » · réponse hors contrat · « Le livrable présente un DEFAUT: … »
 * Le dernier est le plus coûteux : un juge qui rejette explicitement était lu comme une approbation,
 * simplement parce que le mot de rejet n'ouvrait pas la phrase.
 *
 * Le brief du juge (`phase-briefs.ts`) impose « VALIDE » ou « DEFAUT: <raison> ». On s'aligne sur CE
 * contrat : hors contrat, on ne présume pas l'approbation. Les autres phases restent vertes — elles
 * racontent leur travail, elles ne se prononcent pas.
 */
function verdictDePhase(phase: PipelinePhase, text: string): NodeVerdict {
  if (phase !== 'judge') return 'green'
  const propre = (text ?? '').trim()
  if (!propre) return 'red'
  if (REJET_EN_TETE.test(propre) || REJET_FORME_CONTRAT.test(propre)) return 'red'
  // Ni rejet lisible, ni approbation contractuelle : un juge muet sur sa conclusion ne vaut pas un OK.
  return APPROBATION_CONTRAT.test(propre) ? 'green' : 'red'
}
import { phaseBrief } from './phase-briefs'
import { personaInstruction } from '../shared/persona'
import type { DecompositionOutcome } from './greedy-decompose'
import { retrieveBrainContext, type BrainNavigation } from './brain-retrieval'
import { brainCorpusForWorkspace, scopeBrainRetrieval } from './brain-corpus-scope'
import {
  ECHO_MAX_BLOCK_CHARS,
  evictedCount,
  rememberedFacts,
  sessionMemoryBlock
} from './session-memory-echo'
import { projectContextBlock } from './context-files'
import type { ExecutionEvidence, PromptEnvelope, SendOptions, Usage } from './providers/types'
import { isShellMutation, isStateOracle } from './providers/evidence-vocabulary'
import { CONCISE_STRUCTURED_RESPONSE_INSTRUCTION } from './response-style'
import { CONSTITUTION } from './constitution'
import { PIPELINE_DISCIPLINE_INSTRUCTION } from './pipeline-discipline'
import { describeFanoutFailure, explainRoleFailure } from './provider-failure-diagnosis'
import { alignReportWithDisk } from './worktree-path-rewrite'
import { runGreedy, type GreedyNode } from './greedy-scheduler'
import type { ChatArtifact } from '../shared/artifacts'
import type { RunLifecycleEvent } from '../shared/run-execution'
import type { WorktreeAgentActivity } from '../shared/worktree-activity-model'
import { allocateExecutionTopology, type ExecutionQuote } from './execution-quote'
import type { ExecutionUsageSnapshot } from './execution-supervisor'

/**
 * Boucle d'orchestration DISCIPLINÉE — le cœur d'Autowin OS.
 *
 * Une tâche traverse le pipeline réel : un sous-agent (rôle `subagent`) l'exécute,
 * un juge (rôle `judge`, potentiellement un AUTRE modèle → décorrélation) évalue le
 * résultat, le gate déterministe tranche la clôture, et CHAQUE tour alimente le coût
 * réel + le ledger de confiance des juges. Rien de simulé : ce sont de vrais appels
 * provider, de vrais tokens, un vrai verdict.
 */
/** Un agent CLI lancé par un run : de quoi le retrouver vivant et relire ce qu'il a écrit. */
export interface RunAgentRef {
  token: string
  pid?: number
  /** Empreinte du processus au lancement (heure de démarrage + chemin) — anti pid recyclé. */
  identity?: string
  journalPath?: string
  /** Octets déjà lus dans le journal — une reprise repart de là, sans rien réafficher deux fois. */
  offset?: number
}

export interface OrchestrationStep {
  step: 'exec' | 'judge' | 'gate'
  provider?: string
  role?: string
  /** Modèle concret du tour — distingue les N appels d'un fan-out multi-modèles dans la trace. */
  model?: string
  text?: string
  tokens?: number
  costUsd?: number
  detail?: string
  prompt?: PromptEnvelope
  usage?: Usage
  /** Id du meme appel dans prompt-observability, injecte a la frontiere de persistance. */
  usageCallId?: string
  status?: 'completed' | 'failed' | 'provider-blocked'
  error?: string
  durationMs?: number
  evidence?: ExecutionEvidence[]
  /** Fichiers/objets produits par le provider pendant cette étape. */
  artifacts?: ChatArtifact[]
  /** Raisonnement/thinking du sous-agent (si le provider le remonte), conservé pour observation. */
  thinking?: string
  /** Provenance causale stable utilisée par le graphe demande → phases → agents. */
  execution?: {
    phase?: PipelinePhase
    agentId?: string
    taskId?: string
    groupId?: string
    dependencyIds?: string[]
    runId?: string
    /** Identité durable de la tentative ; le start live et sa terminaison partagent cette valeur. */
    attemptId?: string
  }
}

/** Signal « phase démarrée » émis AVANT l'appel bloquant, pour l'avancement live. */
export interface OrchestrationPhase {
  step: 'exec' | 'judge' | 'gate'
  provider?: string
  role?: string
  /** Modèle réel du sous-agent (ex "cc/claude-opus-4-8") + effort — affiché au lieu du transport. */
  model?: string
  reasoningEffort?: string
  /** A4 — phase du pipeline en cours (scout/frame/…) pour un libellé live précis (pas « sous-agent »). */
  phase?: PipelinePhase
  execution?: OrchestrationStep['execution']
}

export interface OrchestrationResult {
  task: string
  result: string
  valid: boolean
  gateBlocked: boolean
  gateReasons: string[]
  costUsd: number
  /** Devis immutable compile avant le premier appel provider. */
  quote?: ExecutionQuote
  /** Consommation atomique locale a ce run, jamais le cumul historique. */
  usage?: ExecutionUsageSnapshot
  /** Id de la décision d'autorité ouverte si le gate a bloqué (sinon undefined). */
  pendingDecisionId?: string
  /** Sortie brute de chaque phase exec — sert à peupler le RUN.md de la conversation (J2). */
  phaseOutputs: { phase: PipelinePhase; text: string }[]
  /** Requête envoyée au Brain (RAG 1×/run) — pour la traçabilité Observatory. */
  brainQuery?: string
  /** Heure à laquelle la récupération Brain s'est terminée, avant le premier appel modèle. */
  brainRetrievedAt?: string
  /** Navigation interne du Brain (candidats parcourus/scorés/retenus) si le serveur l'expose. */
  brainNavigation?: BrainNavigation
  /** Caractères de contexte Brain réellement injectés. */
  brainInjectedChars?: number
  trace: OrchestrationStep[]
  /** Mode greedy : ids des sous-tâches dont le run a échoué (rejet). */
  failedTasks?: string[]
  /** Mode greedy : ids des sous-tâches jamais lancées car une dépendance a échoué (cascade). */
  skippedTasks?: string[]
}

export interface BrainRetrievalEvent {
  timestamp: string
  query: string
  found: boolean
  status: 'found' | 'empty' | 'invalid' | 'unavailable'
  injectedChars: number
  navigation?: BrainNavigation
}

/** Snapshot immuable des modeles et panels admis pour un run entier. */
export interface OrchestrationRuntimeSnapshot {
  roles: Record<Role, RoleBinding>
  phaseFanOut: Partial<Record<PipelinePhase, RoleBinding[]>>
  judgeFanOut: RoleBinding[]
}

/**
 * COLLABORATEURS — les cinq objets sans lesquels aucun run n'existe, plus le retriever substituable.
 *
 * `OrchestratorDeps` (plus bas) reste UN SEUL contrat plat pour tous ses appelants : il hérite de ces
 * groupes, il ne les imbrique pas. Aucun des 39 sites de construction ne change de forme. Le découpage
 * ne sert qu'à rendre le contrat LISIBLE — 26 champs à plat mêlaient cinq préoccupations sans frontière.
 */
export interface OrchestratorCollaboratorDeps {
  registry: ProviderRegistry
  roles: RoleModelConfig
  cost: CostAggregator
  trust: TrustLedger
  authority: AuthoritySas
  /** Retriever substituable pour prouver les frontières d'injection sans serveur global. */
  retrieveBrain?: typeof retrieveBrainContext
}

/**
 * GATES & VÉRIFICATION — ce qui a le droit de BLOQUER un run, et sur quelle preuve.
 *
 * Tout est opt-in : absent, l'enforcement retombe sur le comportement historique.
 */
export interface OrchestratorGateDeps {
  /**
   * Système de hooks INTERNE (cycle de vie). Absent → bus par défaut (hooks synchrones existants +
   * verify-replay) → enforcement identique à l'historique (rétrocompat HARD) + verify-replay en plus.
   */
  hooks?: HookBus
  /**
   * verify-replay : commande de vérification REJOUÉE au gate pour une mutation. `verifyCmd` explicite
   * PRIME ; sinon si `autoVerify`, on résout la commande de test DÉCLARÉE du workspace (package.json).
   * Absent/off → verify-replay dormant (comportement v1). Off par défaut (opt-in, évite de forcer un
   * `npm test` coûteux/grossier sur chaque run).
   */
  verifyCmd?: string
  autoVerify?: boolean
}

/**
 * ROUTAGE — le vrai contrat métier : où l'on travaille, quelles phases sont jouées, et sur combien
 * de modèles. C'est le groupe qui décide de la QUALITÉ d'un run, et il était le plus dur à trouver
 * dans le contrat plat : noyé entre les hooks de persistance et le contexte ambiant.
 */
export interface OrchestratorRoutingDeps {
  /** Workspace borné remis au sous-agent outillé. Jamais transmis au juge ou au chat. */
  executionWorkspace: string
  /**
   * Phases d'exécution jouées AVANT le juge (pipeline du kit, 1 skill/phase). Défaut `['build']`
   * (exec simple, comportement historique) ; la prod passe `['frame','build']` → vraie pipeline.
   */
  execPhases?: PipelinePhase[]
  /**
   * Sélection ADAPTATIVE des phases en fonction de la tâche (proportionnalité : une tâche triviale
   * ne joue pas les 5 phases). Si fourni, PRIME sur `execPhases`. Générique/déterministe (voir
   * task-regime.ts). Absent → `execPhases` statique (rétrocompat, tests).
   */
  classifyPhases?: (task: string) => PipelinePhase[]
  /**
   * Fan-out MULTI-MODÈLES d'une phase composée (scout/frame/terrain) : renvoie les modèles déposés
   * dans le bloc topology de cette phase. ≥1 → la phase (ou chaque sous-tâche greedy) s'exécute sur
   * CHAQUE modèle en parallèle ; plusieurs sorties sont SYNTHÉTISÉES en union dédupliquée. Aucun
   * membre → binding subagent historique. Ne renvoyer des membres que pour scout/frame/terrain.
   */
  phaseFanOut?: (
    phase: PipelinePhase
  ) => Array<{ provider: string; model?: string; reasoningEffort?: ReasoningEffort }>
  /**
   * Fan-out MULTI-MODÈLES du JUGE : modèles déposés dans le bloc judge. ≥2 → N juges en parallèle
   * puis synthèse par QUORUM. <2 ou absent → un seul juge (rétrocompat).
   */
  judgeFanOut?: () => Array<{ provider: string; model?: string; reasoningEffort?: ReasoningEffort }>
}

/**
 * ISOLATION, SURVIE & CLÔTURE — le run peut mourir à tout moment, et une mutation ne doit pas salir
 * le workspace partagé. Ces champs sont ce qui rend un run REPRENABLE et son travail publiable.
 * Tous best-effort : une erreur de persistance ne casse jamais le run.
 */
export interface OrchestratorLifecycleDeps {
  /**
   * Volet B "gestion worktree par défaut" (flip live). Si fourni, un run de MUTATION s'exécute dans
   * une COPIE isolée (worktree) dont le cwd remplace `executionWorkspace` ; à la fin, le travail est
   * fusionné en full-auto (ou conflit → merge assisté). Absent → comportement historique (workspace
   * unique partagé). Injecté par AutowinOS ; les tests le laissent absent (rétrocompat HARD).
   */
  worktrees?: RunWorktrees
  /**
   * SURVIE NIVEAU 3 — point de sauvegarde de l'acquis reprenable. Appelé au DÉMARRAGE du run (acquis
   * vide) puis après CHAQUE phase terminée, avec l'acquis complet. L'appelant y persiste de quoi
   * reprendre à la phase suivante si le process main meurt : la boucle d'orchestration vit ici et ne
   * survit pas à un kill, donc sans ça les phases restantes étaient perdues. Le PREMIER appel est ce
   * qui rend un run tué très tôt encore reprenable — sans lui, une mort avant la fin de la première
   * phase perdait la tâche entière. Best-effort : une erreur de persistance ne casse JAMAIS le run.
   */
  onPhaseCompleted?: (info: {
    runId: string
    task: string
    /** Conversation d'origine — sans elle, une reprise ne saurait pas où s'afficher. */
    conversationId?: string
    turnId?: string
    bindingOverride?: RoleBinding
    /** Topologie exacte admise au debut du run, reutilisee telle quelle apres un crash. */
    runtimeSnapshot: OrchestrationRuntimeSnapshot
    phaseOutputs: { phase: PipelinePhase; text: string }[]
    executionQuote?: ExecutionQuote
    usage?: ExecutionUsageSnapshot
    /** Agents CLI du run : ce qui permettra de s'y RATTACHER après un redémarrage. */
    agents?: RunAgentRef[]
  }) => void
  /** Persiste immédiatement pid/journal : attendre la fin d’une phase rendrait le run non rattachable. */
  onAgentsChanged?: (runId: string, agents: RunAgentRef[]) => void
  /** Notifié quand le run atteint sa fin (vert, rouge ou abandon) → l'appelant efface l'état repris. */
  onRunSettled?: (runId: string) => void
  /** Empreinte d'un processus vivant — sert à savoir, au redémarrage, si un agent travaille encore. */
  processIdentity?: (pid: number) => string | undefined
  /**
   * Clôture automatique appelée UNIQUEMENT sur un run vert, APRÈS la fusion du worktree (le travail
   * est alors dans la base). Best-effort : son échec ne change pas le verdict du run.
   */
  closeGreenRun?: RunCloser
}

/**
 * DÉCOMPOSITION & CONTEXTE DE RUN — comment la tâche est découpée, et les valeurs ambiantes que
 * l'orchestrateur LIT sans les posséder (devis, compteurs, workflow actif), portées par
 * l'ExecutionSupervisor local au run.
 */
export interface OrchestratorDecompositionDeps {
  /**
   * DÉCOMPOSEUR — le fonctionnement NORMAL d'Autowin : découpe la tâche en sous-tâches
   * indépendantes/enchaînables + leurs dépendances, dispatchées en completion-driven (chaque
   * sous-agent traité DÈS son arrivée, sans barrière). Injectable → l'implémentation prod interroge le
   * modèle orchestrateur (il sait juger quand une tâche N'EST PAS décomposable) ; les tests injectent un
   * plan déterministe. Renvoyer <2 nœuds (tâche atomique) ⇒ exécution séquentielle classique (fallback
   * naturel, aucun « mode » à activer). Absent ⇒ séquentiel (rétrocompat tests).
   *
   * Le 3ᵉ paramètre `onOutcome` est OPTIONNEL et rétrocompatible (une implémentation à 2 paramètres
   * reste assignable) : il permet à l'orchestrateur d'apprendre POURQUOI une décomposition est
   * retombée en séquentiel. Sans lui, « tâche jugée atomique » et « le modèle a foiré son JSON »
   * rendent tous deux `[]`, donc un orchestrateur qui n'orchestre plus est indiscernable du cas normal.
   */
  decompose?: (
    task: string,
    binding?: RoleBinding,
    onOutcome?: (outcome: DecompositionOutcome, task: string) => void
  ) => Promise<GreedyTaskNode[]>
  /** Plafond de sous-agents simultanés en mode greedy (défaut 4). */
  greedyConcurrency?: number
  /** Injection substituable pour les tests ; en production charge le vrai kit via skill-pipeline. */
  skillInstruction?: (phase: PipelinePhase, opts: { withFoundation: boolean }) => string
  /** Source du devis actif, portee par l'ExecutionSupervisor local au run. */
  currentExecutionQuote?: () => ExecutionQuote | undefined
  /** Compteurs locaux du run, persistes avec chaque checkpoint pour une reprise sans reset. */
  currentExecutionUsage?: () => ExecutionUsageSnapshot | undefined
  /**
   * Workflow nommé actif pour le run en cours — même idiome ambiant que le devis ci-dessus, et même
   * garantie : les runs d'une confrontation s'enchaînent en série, donc un seul workflow à la fois.
   */
  currentWorkflow?: () => WorkflowRunOverride | undefined
}

/**
 * Le contrat de l'orchestrateur — inchangé pour tous ses appelants.
 *
 * `extends` et non des sous-objets imbriqués : la forme reste PLATE, donc les 39 sites de construction
 * (11 fichiers, dont `os.ts` et 10 suites de tests) n'ont pas une ligne à changer. Sur 26 champs, 6
 * seulement sont obligatoires — tout le reste est un opt-in que les tests laissent absent.
 *
 * NB, mesuré : ajouter un champ OPTIONNEL à cette interface ne casse AUCUN site de construction. La
 * douleur qu'on prêtait à ce fourre-tout (« un champ de plus force 39 édits ») n'existait pas ; le
 * regret réel était la seule lisibilité, et c'est ce que ce découpage paie.
 */
export interface OrchestratorDeps
  extends
    OrchestratorCollaboratorDeps,
    OrchestratorGateDeps,
    OrchestratorRoutingDeps,
    OrchestratorLifecycleDeps,
    OrchestratorDecompositionDeps {}

/** Ce qu'un workflow nommé impose au run, au-delà du binding de rôle déjà accepté par `run`. */
export interface WorkflowRunOverride {
  phases?: PipelinePhase[]
  /** Le workflow comme graphe : pilote les phases jouées ET la borne des retours. */
  graph?: WorkflowGraph
  allocation?: {
    phaseMembers?: Partial<Record<PipelinePhase, number>>
    judgeMembers?: number
    maxGreedyNodes?: number
  }
  instructionFor?: (phase: PipelinePhase) => PhaseInstructionOverride | undefined
}

/** Un nœud du plan greedy : une sous-tâche + les ids dont elle dépend (doivent réussir avant). */
export interface GreedyTaskNode {
  id: string
  /** Consigne complète de la sous-tâche (remise au sous-agent build). */
  prompt: string
  /** Ids des sous-tâches prérequises (vide = indépendante, dispatchable d'emblée). */
  deps: string[]
}

function costOfTrace(trace: OrchestrationStep[]): number {
  return trace.reduce(
    (total, step) =>
      total + (Number.isFinite(step.costUsd) ? Math.max(0, step.costUsd as number) : 0),
    0
  )
}

export function limitGreedyPlan(plan: GreedyTaskNode[], maxNodes: number): GreedyTaskNode[] {
  const kept = plan.slice(0, Math.max(0, maxNodes))
  const ids = new Set(kept.map((node) => node.id))
  return kept.filter((node) => node.deps.every((dependency) => ids.has(dependency)))
}

interface PhasePromptBlock {
  name: string
  text: string
}

/** Contrat minimal du coordinateur worktree niveau run (implémenté par RunWorktreeCoordinator). */
export interface RunWorktrees {
  /** Renvoie le cwd isolé du run (mutation) ou undefined (non-mutation → base). */
  begin(
    runId: string,
    agentName: string,
    isMutation: boolean,
    metadata?: { task?: string; role?: string; conversationId?: string }
  ): string | undefined
  /**
   * Clôt le run ; appelé en fin de run, y compris sur erreur. `merge: false` (run non vert) ⇒ le
   * travail N'EST PAS fusionné dans la base et la copie isolée est conservée pour décision humaine.
   */
  end(runId: string, options?: { merge?: boolean }): unknown
  /** Snapshot d'observation du coordinateur ; ne pilote jamais la finalisation. */
  activity?(): WorktreeAgentActivity[]
  /** Attache/détache un processus CLI réel au lease durable du run. */
  process?(runId: string, pid: number, active: boolean): void
  /** Barrière durable couvrant l'intervalle avant que spawn fournisse un PID. */
  spawnIntent?(runId: string, token: string, active: boolean): void
  /** Transfert atomique de l'intention vers le PID enfant. */
  spawned?(runId: string, token: string, pid: number): void
}

/**
 * Clôture d'un run VERT (commit + publication). Injectée par AutowinOS ; absente ⇒ rien d'automatique.
 * `begin` est appelé au DÉMARRAGE pour photographier l'arbre : sans cette photo, la clôture publierait
 * aussi ce qui traînait avant le run (travail d'une autre session, notes en attente).
 */
export interface RunCloser {
  begin(runId: string): void
  close(context: { runId: string; task: string; workCwd: string }): Promise<void>
}

const MUTATION_STEM =
  'ajout|add|modifi|chang|corrig|fix|cre|create|implement|refactor|supprim|remove|renomm|rename|update|build|ger|ecri|write|edit|patch|apply|delete|move|remplac|configur|repar|nettoi|deplac|mets|met|fai'
const MUTATION_TASK = new RegExp(`\\b(?:${MUTATION_STEM})\\w*`, 'i')
const NEGATED_MUTATION = new RegExp(
  `\\b(?:sans(?:\\s+rien)?\\s+(?:\\w+\\s+){0,2}|n['e]?\\s*(?:\\w+\\s+){0,2})(?:${MUTATION_STEM})\\w*(?:\\s+pas)?`,
  'gi'
)

/** B4 — plafond du texte d'une phase RÉINJECTÉ dans le contexte de la phase suivante. */
const PHASE_CONTEXT_CAP = 2000

/**
 * #3 — plafond du texte d'UNE phase agrégé dans le livrable remis au JUGE. Le portage phase→phase
 * était déjà borné (PHASE_CONTEXT_CAP), mais l'agrégat juge (`buildExec`) concaténait les sorties
 * COMPLÈTES non tronquées → croissance linéaire du prompt juge avec le nb de phases. On borne chaque
 * bloc de phase (plus large que le portage : le juge doit voir la substance du livrable, pas juste
 * un aperçu). La sortie complète reste dans `phaseOutputs` + la trace des sous-agents.
 */
const JUDGE_PHASE_CAP = 6000

/**
 * Connecteurs de clause utilisés pour repérer une SECONDE action non couverte par le préfixe
 * lecture-seule reconnu (voir `classifyMutationConfidence`).
 */
const CLAUSE_SPLIT = /\b(?:et|puis|then|and|apres|après)\b|[;,]/gi
/** Verbes/participes lecture-seule reconnus À L'INTÉRIEUR d'une clause secondaire. */
const READ_ONLY_STEM =
  'analys|audit|cadr|document|expliqu|inspect|review|resume|resum|decri|lis|lire|liste|montre|affiche'
const READ_ONLY_CLAUSE = new RegExp(`^(?:${READ_ONLY_STEM})\\w*\\b`, 'i')

/**
 * #2 — verdict EXPLICITE de confiance sur la nature (mutation ou non) d'une tâche, au lieu d'un
 * booléen qui fait passer une heuristique textuelle pour une certitude. Trois issues :
 *  - 'mutation'  : un verbe de mutation est présent hors négation → certain.
 *  - 'read-only' : la tâche ENTIÈRE (chaque clause) matche un préfixe lecture-seule reconnu →
 *                  confiant, mais jamais absolu (langage naturel).
 *  - 'uncertain' : ni l'un ni l'autre — p.ex. une clause de tête « lecture seule » suivie d'une
 *                  seconde clause (« puis », « et », « then »...) dont le verbe n'est PAS reconnu
 *                  comme lecture-seule. C'est exactement le faux-négatif visé : une paraphrase ou
 *                  un verbe de mutation absent du dictionnaire (« puis écrase le fichier ») ne doit
 *                  jamais être absous par le préfixe lecture-seule du début de phrase.
 * Fail-safe : tout appelant qui a besoin d'un booléen (`isMutationTask`) doit traiter 'uncertain'
 * comme une mutation — le côté sûr (worktree isolé + preuve exigée), jamais le côté permissif.
 */
export type MutationConfidence = 'mutation' | 'read-only' | 'uncertain'

export function classifyMutationConfidence(task: string): MutationConfidence {
  // Kaizen est contractuellement un audit natif en lecture seule, quel que soit le vocabulaire
  // cité dans sa cible (ex. « pourquoi le modèle a voulu modifier X »).
  if (/^\/kaizen(?=\s|$)/i.test(task.trim())) return 'read-only'
  if (/^\/(?:scout|frame|judge)(?=\s|$)/i.test(task.trim())) return 'read-only'
  const normalized = task
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
  const withoutNegations = normalized.replace(NEGATED_MUTATION, ' ')
  if (MUTATION_TASK.test(withoutNegations)) return 'mutation'
  // Fail-closed : le langage naturel ne peut pas fournir une liste exhaustive des façons de
  // demander une écriture ("write", "patch", "apply", "fais…"). Seule une négation explicite
  // ET un contrat de lecture identifiable autorisent le chemin partagé ; une négation mêlée à un
  // ordre positif inconnu reste donc isolée.
  const explicitReadOnly =
    withoutNegations !== normalized &&
    /\b(?:analys|audit|cadr|document|expliqu|inspect|lecture seule|review)\w*/i.test(normalized)
  const simpleReadOnlyLead =
    /^(?:analys|audit|expliqu|inspect|review|cadr|document|resume|decri)\w*\b/i.test(normalized)
  if (!explicitReadOnly && !simpleReadOnlyLead) return 'mutation'
  if (explicitReadOnly) return 'read-only'
  // `simpleReadOnlyLead` ne certifie QUE le premier verbe. Une clause suivante introduite par un
  // connecteur (« puis », « et », « then »...) porte peut-être une action non couverte par le
  // dictionnaire de mutation — on ne peut pas l'affirmer lecture-seule sans l'avoir vérifiée.
  const clauses = normalized
    .split(CLAUSE_SPLIT)
    .map((clause) => clause.trim())
    .filter(Boolean)
  if (clauses.length <= 1) return 'read-only'
  const allClausesReadOnly = clauses.every((clause) => READ_ONLY_CLAUSE.test(clause))
  return allClausesReadOnly ? 'read-only' : 'uncertain'
}

/**
 * J3 — une tâche est une MUTATION seulement si un verbe de mutation apparaît HORS d'une négation.
 * « Ne modifie pas de code » (cadrage) ne doit PAS exiger de preuve de mutation → sinon faux-red.
 * On neutralise les clauses négatives « ne … pas » / « n'… pas » avant de tester.
 *
 * BEST-EFFORT, jamais une certitude : dérive du verdict `classifyMutationConfidence` et traite
 * 'uncertain' comme mutation (fail-safe — voir sa docstring pour le faux-négatif visé).
 */
export function isMutationTask(task: string): boolean {
  return classifyMutationConfidence(task) !== 'read-only'
}

/**
 * Ce que l'agent doit savoir quand il travaille dans une COPIE isolée — et qu'il ignorait.
 *
 * Incident du 2026-08-04 : l'agent a correctement fait un `git stash` sur le dépôt réel (via
 * `git -C`), puis a conclu « mon cwd est un worktree, donc mon stash y est local, je ne peux rien
 * certifier » et a rapporté un échec. Le raisonnement est faux — `refs/stash` est PARTAGÉ entre
 * worktrees — mais rien ne le lui disait. Il a deviné sa propre topologie, et mal.
 *
 * Aucun de mes autres correctifs n'empêche cela de recommencer : ils rendent le gate satisfiable,
 * pas l'agent lucide sur l'endroit où il se trouve. Ce bloc lui donne les trois faits qui lui
 * manquaient : où il est, où est le vrai dépôt, et ce qui est partagé entre les deux.
 */
/**
 * Neutralise un chemin avant de l'interpoler dans un bloc système.
 *
 * Deux raisons. (1) Un chemin est interpolé dans du Markdown : un dossier contenant des sauts de
 * ligne et un faux titre réécrirait le bloc — injection de prompt. (2) On n'expose pas plus que
 * nécessaire à un service distant. Le chemin du dépôt reste ENTIER : l'agent doit pouvoir écrire
 * `git -C "<base>"`, un chemin tronqué rendrait la consigne inapplicable. Seul le chemin de la
 * copie jetable est réduit à son nom de dossier — il ne sert qu'à situer l'agent.
 */
function safePathForPrompt(value: string): string {
  return value.replace(/[\r\n`]+/g, ' ').trim()
}

export function workspaceIsolationNotice(rawWorkCwd: string, rawBaseWorkspace: string): string {
  if (!rawWorkCwd || !rawBaseWorkspace || rawWorkCwd === rawBaseWorkspace) return ''
  const baseWorkspace = safePathForPrompt(rawBaseWorkspace)
  // La copie est identifiée par son NOM, pas par son chemin complet : elle est jetable, et son
  // arborescence n'apprend rien d'utile à l'agent.
  const workCwd = safePathForPrompt(rawWorkCwd).split(/[\\/]/).filter(Boolean).pop() ?? 'copie'
  return [
    '## Où tu travailles',
    '',
    `Ton dossier courant est une COPIE ISOLÉE (worktree git), nommée « ${workCwd} ».`,
    `Le dépôt de l'utilisateur, lui, est ici : ${baseWorkspace}`,
    '',
    "Ce que tu écris dans ta copie n'atteint le dépôt de l'utilisateur QUE si le run se termine",
    'en vert : un run bloqué par le gate laisse ta copie non fusionnée.',
    '',
    'Ce qui est PARTAGÉ entre les deux, malgré des dossiers distincts, parce que le dépôt git est',
    'le même : le stash (`refs/stash`), les branches, les tags, les commits, la configuration.',
    "Un `git stash` lancé ici EST visible depuis le dépôt de l'utilisateur.",
    '',
    "Si une tâche vise l'état du dépôt de l'utilisateur (stash, branche, mise à jour), agis",
    `explicitement dessus avec \`git -C "${baseWorkspace}" …\` — pas sur ta copie.`,
    '',
    "Et ne DEVINE jamais ce qui s'est passé : constate-le. Après une opération, relis l'état réel",
    '(`git -C … status --porcelain`, `git -C … stash list`) et rapporte ce que tu as LU. Un agent',
    "a déjà annoncé « il ne s'est probablement rien passé » sur un travail qu'il venait de réussir.",
    '',
    "## Ta copie n'est pas un environnement complet",
    '',
    'Elle peut ne pas avoir les dépendances installées ni les artefacts de build. Une suite de tests',
    'qui échoue ICI ne prouve donc RIEN sur le produit : le défaut peut être ton environnement.',
    `Avant d'attribuer une panne au code, rejoue-la dans le dépôt réel (${baseWorkspace}).`,
    'Mesuré : un agent a annoncé « 48 fichiers rouges, impossible de démarrer » alors que la suite',
    'était verte dans le dépôt réel — le rouge venait de sa propre copie.'
  ].join('\n')
}

export function evidenceSatisfiesTask(task: string, evidence: ExecutionEvidence[] = []): boolean {
  // B1 — une tâche NON-mutation (cadrage, analyse, scout) n'a aucune preuve d'outil à fournir :
  // son livrable est le TEXTE, validé par le juge. Ne pas exiger de preuve outil ici (sinon
  // faux-rouge). La preuve d'exécution reste STRICTE pour les mutations.
  if (!isMutationTask(task)) return true
  const successful = evidence.filter((item) => item.ok)
  if (!successful.length) return false
  // F3 (strict) — une mutation exige une VÉRIFICATION réelle (test/exit-code), pas une simple
  // inspection : une lecture (`rg`, `Get-Content`) n'atteste pas que la mutation est correcte.
  // Compromis assumé : une mutation « vérifiée par relecture » doit désormais porter un test, ou
  // être close en degraded-closed/humain si aucun oracle n'existe (ex. édition de doc pure).
  const mutations = successful.filter((item) => item.kind === 'mutation')
  if (!mutations.length) return false
  if (successful.some((item) => item.kind === 'verification')) return true
  // J4 (2026-08-04) — une mutation d'ÉTAT (git stash/commit/checkout, déplacement de fichier) n'a
  // pas de test à produire : son oracle EST l'état du dépôt. Un `git status --porcelain` est
  // falsifiable, donc il vaut preuve — mais SEULEMENT ici, quand AUCUNE mutation de fichier n'est
  // présente. Une édition de code continue d'exiger un vrai test : un git status n'atteste pas
  // qu'un correctif est correct. Sans cette porte, la classe entière « muter par commande » était
  // insatisfiable et échouait en `failed` même quand le travail avait réussi (incident « met toi
  // à jour » : stash réellement effectué, run rapporté en échec).
  const stateOnly = mutations.every((item) => !item.path && isShellMutation(item.command))
  if (!stateOnly) return false
  // L'oracle doit être une preuve DISTINCTE de la mutation. Sans cette exclusion, une commande
  // unique matchant les deux motifs se prouvait TOUTE SEULE : `echo "git status" > f.txt` est à la
  // fois une mutation (redirection) et un oracle (le littéral cité en argument), donc un `echo`
  // bidon fermait le gate. Vérifié sur les regex réelles lors de l'audit du 2026-08-04.
  const mutationSet = new Set(mutations)
  return successful.some((item) => !mutationSet.has(item) && isStateOracle(item.command))
}

export class Orchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  /**
   * #8 — résolution du panel fan-out d'UNE phase (topology scout/frame/terrain), factorisée : cette
   * même expression (snapshot figé PRIME, sinon callback deps, filtrée + bornée par le devis) était
   * dupliquée mot pour mot à deux call-sites (`runGreedyBuildPhase` et le chemin séquentiel), avec
   * le risque qu'une correction future n'en touche qu'un. Le traitement de `bindingOverride` reste
   * au call-site : les deux appelants n'en font PAS le même usage (l'un renvoie `[bindingOverride]`,
   * l'autre `[]`), ce n'est donc pas un doublon à unifier.
   */
  private resolvePhaseFanOut(
    phase: PipelinePhase,
    runtimeSnapshot?: OrchestrationRuntimeSnapshot
  ): RoleBinding[] {
    // Les agents COMPOSÉS sur le nœud priment sur la topologie globale : c'est le sens même du
    // canevas. Sans ce branchement, ouvrir un nœud et y régler trois agents ne changeait rien au run.
    const graph = this.deps.currentWorkflow?.()?.graph
    const composes = graph ? agentsForPhase(graph, phase) : undefined
    return (composes ?? runtimeSnapshot?.phaseFanOut[phase] ?? this.deps.phaseFanOut?.(phase) ?? [])
      .filter((member) => member && member.provider)
      .slice(
        0,
        this.deps.currentExecutionQuote?.()?.allocation?.phaseMembers[phase] ??
          this.deps.currentExecutionQuote?.()?.limits.maxConcurrency ??
          Number.POSITIVE_INFINITY
      )
  }

  /** #8 — même facteur commun que {@link resolvePhaseFanOut}, pour le panel de JUGES. */
  private resolveJudgeFanOut(runtimeSnapshot?: OrchestrationRuntimeSnapshot): RoleBinding[] {
    const graph = this.deps.currentWorkflow?.()?.graph
    const composes = graph ? agentsForPhase(graph, 'judge') : undefined
    return (composes ?? runtimeSnapshot?.judgeFanOut ?? this.deps.judgeFanOut?.() ?? [])
      .filter((member) => member && member.provider)
      .slice(
        0,
        this.deps.currentExecutionQuote?.()?.allocation?.judgeMembers ??
          this.deps.currentExecutionQuote?.()?.limits.maxConcurrency ??
          Number.POSITIVE_INFINITY
      )
  }

  /**
   * Les phases réellement jouées. Point de lecture UNIQUE, à dessein : cette décision était dupliquée
   * entre `run` (qui provisionne le devis) et `runInner` (qui exécute), et les deux ont divergé deux
   * fois de suite — un pipeline provisionné, un autre joué. Une seule source, plus de dérive possible.
   */
  private effectivePhases(task: string): PipelinePhase[] {
    const workflow = this.deps.currentWorkflow?.()
    const fromGraph = workflow?.graph ? linearPhasesOf(workflow.graph) : undefined
    const imposed = fromGraph?.length ? fromGraph : workflow?.phases
    if (imposed?.length) return [...imposed]
    return this.deps.classifyPhases
      ? this.deps.classifyPhases(task)
      : (this.deps.execPhases ?? ['build'])
  }

  private phasePrompt(phase: PipelinePhase, withFoundation: boolean): PhasePromptBlock {
    const installed =
      this.deps.skillInstruction?.(phase, { withFoundation }) ??
      phaseInstruction(phase, undefined, { withFoundation })
    const base = installed || phaseBrief(phase)
    // Point de passage UNIQUE des consignes de phase : y brancher le workflow suffit à couvrir
    // exec, judge et greedy sans les threader un par un.
    const override = this.deps.currentWorkflow?.()?.instructionFor?.(phase)
    const text = combinePhaseInstruction(base, override)
    if (override && text !== base) return { name: `workflow:${phase}`, text }
    return installed
      ? { name: `skill:${phase}`, text: installed }
      : { name: `consigne:${phase}`, text: phaseBrief(phase) }
  }

  private readonly runNamespace = randomUUID().replace(/-/g, '').slice(0, 12)
  private runSeq = 0
  private readonly processObservers = new Map<
    string,
    {
      process: (pid: number, active: boolean) => void
      spawnIntent: (token: string, active: boolean) => void
      spawned: (token: string, pid: number) => void
      journal: (token: string, journalPath: string) => void
    }
  >()
  /**
   * Agents lancés par run : jeton, pid, journal. C'est ce qui rend un run RATTACHABLE — sans ces
   * trois informations, une app qui redémarre ne sait ni si l'agent vit encore, ni où lire ce qu'il
   * a produit pendant son absence.
   */
  private readonly runAgents = new Map<string, Map<string, RunAgentRef>>()

  private rememberAgent(runId: string, token: string, patch: Partial<RunAgentRef>): void {
    const byToken = this.runAgents.get(runId) ?? new Map<string, RunAgentRef>()
    byToken.set(token, { ...(byToken.get(token) ?? { token }), ...patch, token })
    this.runAgents.set(runId, byToken)
    try {
      this.deps.onAgentsChanged?.(runId, this.agentsOf(runId))
    } catch {
      /* persistance best-effort : elle ne casse jamais le run vivant */
    }
  }

  private forgetPendingAgent(runId: string, token: string): void {
    const byToken = this.runAgents.get(runId)
    if (!byToken?.delete(token)) return
    if (byToken.size === 0) this.runAgents.delete(runId)
    try {
      this.deps.onAgentsChanged?.(runId, this.agentsOf(runId))
    } catch {
      /* persistance best-effort : elle ne casse jamais le run vivant */
    }
  }

  /** Agents connus d'un run, pour la persistance de reprise. */
  private agentsOf(runId: string): RunAgentRef[] {
    return [...(this.runAgents.get(runId)?.values() ?? [])]
  }

  private _hooks?: HookBus
  /** Bus de hooks (fourni ou défaut). Uniforme pour TOUS les exécuteurs. */
  private get hooks(): HookBus {
    return (this._hooks ??= this.deps.hooks ?? createDefaultHookBus())
  }

  /** Commande de vérif à rejouer (verify-replay) : explicite > convention workspace > aucune (dormant). */
  private resolveVerifyCmd(cwd = this.deps.executionWorkspace): string | undefined {
    if (this.deps.verifyCmd) return this.deps.verifyCmd
    return this.deps.autoVerify ? resolveVerifyCmd(cwd) : undefined
  }

  private executionOptions(
    cwd: string,
    sandbox: NonNullable<SendOptions['execution']>['sandbox'],
    runId: string
  ): NonNullable<SendOptions['execution']> {
    const observers = this.processObservers.get(runId)
    return {
      cwd,
      sandbox,
      ...(cwd !== this.deps.executionWorkspace ? { causallyIsolated: true } : {}),
      onProcess: observers?.process,
      onSpawnIntent: observers?.spawnIntent,
      onSpawned: observers?.spawned,
      onJournal: observers?.journal
    }
  }

  /**
   * Flip live worktree : enveloppe le pipeline. Un run de mutation reçoit une copie isolée (cwd),
   * fusionnée en fin (full-auto / conflit) via le coordinateur. Sans coordinateur → cwd = base
   * (comportement historique intact).
   */
  async run(
    task: string,
    onStep?: (s: OrchestrationStep) => void,
    onPhase?: (p: OrchestrationPhase) => void,
    onDelta?: (step: 'exec' | 'judge', delta: string) => void,
    signal?: AbortSignal,
    collectedContext = '',
    /**
     * SURVIE NIVEAU 3 : reprise d'un run interrompu par la mort du process. Les phases présentes ici
     * ne sont PAS rejouées au modèle — leur livrable est réinjecté tel quel et l'exécution redémarre
     * à la phase suivante (aucun token regaspillé).
     */
    resumeOutputs: { phase: PipelinePhase; text: string }[] = [],
    /** Conversation d'origine, persistée avec l'acquis pour qu'une reprise s'affiche au bon endroit. */
    conversationId?: string,
    /** Binding figé pour ce run, prioritaire sur tous les rôles et panels de la topologie. */
    bindingOverride?: RoleBinding,
    /** Émis dès la récupération Brain, avant toute phase susceptible d'échouer. */
    onBrainRetrieved?: (event: BrainRetrievalEvent) => void,
    /** Tour Chat causal, persisté avec l'état reprenable. */
    turnId?: string,
    onRunLifecycle?: (event: RunLifecycleEvent) => void,
    runtimeSnapshot?: OrchestrationRuntimeSnapshot
  ): Promise<OrchestrationResult> {
    const runId = `run-${this.runNamespace}-${++this.runSeq}`
    const runStartedAtMs = Date.now()
    const executionQuote = this.deps.currentExecutionQuote?.()
    const emitLifecycle = (event: RunLifecycleEvent): void => {
      try {
        onRunLifecycle?.(event)
      } catch {
        /* observabilité best-effort : elle ne casse jamais le run */
      }
    }
    const activityForRun = (): WorktreeAgentActivity | undefined =>
      this.deps.worktrees?.activity?.().find((activity) => activity.agentId === runId)
    const isMut = isMutationTask(task)
    const workflow = this.deps.currentWorkflow?.()
    const phases = this.effectivePhases(task)
    const admittedRuntime: OrchestrationRuntimeSnapshot = runtimeSnapshot ?? {
      roles: this.deps.roles.all(),
      phaseFanOut: Object.fromEntries(
        phases.map((phase) => [phase, [...(this.deps.phaseFanOut?.(phase) ?? [])]])
      ),
      judgeFanOut: [...(this.deps.judgeFanOut?.() ?? [])]
    }
    if (executionQuote && !executionQuote.allocation) {
      const usage = this.deps.currentExecutionUsage?.()
      const completedPhases = resumeOutputs
        .filter((output) => output.text.trim().length > 0)
        .map((output) => output.phase)
      const phaseFanOut = Object.fromEntries(
        phases.map((phase) => [
          phase,
          bindingOverride ? 0 : (admittedRuntime.phaseFanOut[phase] ?? []).length
        ])
      ) as Partial<Record<PipelinePhase, number>>
      executionQuote.allocation = allocateExecutionTopology(executionQuote, {
        phases,
        completedPhases,
        startedAgents: usage?.startedAgents ?? usage?.startedCalls ?? 0,
        startedCalls: usage?.startedCalls ?? 0,
        mutation: isMut,
        hasDecomposer: Boolean(!bindingOverride && this.deps.decompose),
        phaseFanOut,
        judgeFanOut: bindingOverride ? 0 : admittedRuntime.judgeFanOut.length,
        // Un graphe à boucles rejoue des nœuds : provisionner sa seule chaîne ferait accepter un run
        // qui serait ensuite coupé en plein milieu, faute de places.
        ...(workflow?.graph
          ? { worstCaseNodeExecutions: worstCaseNodeExecutions(workflow.graph) }
          : {})
      })
      // Le workflow impose son allocation PAR-DESSUS le calcul du devis, clé par clé : c'est tout
      // l'intérêt de comparer « 5 juges » à « 1 juge ». Ce qu'il ne dit pas reste ce que le devis a
      // décidé — sinon un workflow qui ne règle que le jury effacerait aussi le reste.
      // Les agents composés sur les nœuds DICTENT l'allocation : sans cela le devis provisionnerait
      // un panel d'un membre et le fan-out serait tronqué — trois juges composés, un seul joué. Une
      // allocation écrite explicitement dans le profil reste prioritaire sur cette déduction.
      const depuisGraphe = workflow?.graph ? allocationFromGraph(workflow.graph) : undefined
      const impose =
        workflow?.allocation || depuisGraphe
          ? {
              ...depuisGraphe,
              ...workflow?.allocation,
              phaseMembers: {
                ...depuisGraphe?.phaseMembers,
                ...workflow?.allocation?.phaseMembers
              }
            }
          : undefined
      if (impose) {
        executionQuote.allocation = {
          ...executionQuote.allocation,
          ...(impose.judgeMembers !== undefined ? { judgeMembers: impose.judgeMembers } : {}),
          ...(impose.maxGreedyNodes !== undefined ? { maxGreedyNodes: impose.maxGreedyNodes } : {}),
          phaseMembers: {
            ...executionQuote.allocation.phaseMembers,
            ...impose.phaseMembers
          }
        }
      }
      executionQuote.decomposition =
        executionQuote.allocation.maxGreedyNodes >= 2
          ? { mode: 'build-only', maxNodes: executionQuote.allocation.maxGreedyNodes }
          : { mode: 'disabled', maxNodes: 1 }
    }
    if (isMut && !this.deps.worktrees) {
      throw new Error(
        'Mutation bloquée : le moteur d’isolation workspace est indisponible pour ce projet.'
      )
    }
    // Verdict du run, lu dans le `finally` : seul un run VERT ramène son travail dans la base.
    let green = false
    // Reference du rapport rendu : le `finally` doit pouvoir aligner ses chemins APRES avoir su ce que
    // la fusion a fait de la copie isolee. Muter l'objet rendu fonctionne (la valeur de retour est
    // cette reference), reassigner la variable ne fonctionnerait PAS.
    let produced: OrchestrationResult | undefined
    // Photo de l'arbre AVANT le run → la clôture ne publiera que le delta produit par ce run.
    this.deps.closeGreenRun?.begin(runId)
    // SURVIE : l'acquis n'était persisté qu'à la FIN d'une phase. Un run tué avant la première (le cas
    // le plus courant : la phase 1 est longue) ne laissait donc RIEN, et la reprise automatique au
    // démarrage n'avait aucune prise — l'utilisateur devait relancer la tâche à la main. On enregistre
    // dès maintenant, acquis vide : la reprise repart de zéro plutôt que de perdre la tâche.
    this.deps.onPhaseCompleted?.({
      runId,
      task,
      conversationId,
      turnId,
      bindingOverride,
      runtimeSnapshot: admittedRuntime,
      phaseOutputs: [...resumeOutputs],
      executionQuote,
      usage: this.deps.currentExecutionUsage?.(),
      agents: this.agentsOf(runId)
    })
    const isolatedCwd = this.deps.worktrees?.begin(runId, 'Agent', isMut, {
      task,
      role: 'build',
      conversationId
    })
    if (isMut && !isolatedCwd) {
      throw new Error('Mutation bloquée : Autowin n’a pas pu créer un bureau agent isolé.')
    }
    const workCwd = isolatedCwd ?? this.deps.executionWorkspace
    const initialActivity = activityForRun()
    emitLifecycle({
      stage: 'workspace',
      runId,
      timestampMs: runStartedAtMs,
      workspace: {
        mode: isolatedCwd ? 'worktree' : 'base',
        repositoryPath: initialActivity?.workspacePath ?? this.deps.executionWorkspace,
        path: workCwd,
        baseBranch: initialActivity?.baseBranch,
        baseSha: initialActivity?.baseSha
      }
    })
    emitLifecycle({
      stage: 'closure',
      runId,
      timestampMs: runStartedAtMs,
      closure: { status: 'open', totalDurationMs: 0, totalCostUsd: 0 }
    })
    if (executionQuote) {
      emitLifecycle({
        stage: 'quote',
        runId,
        timestampMs: Date.now(),
        quote: {
          quoteId: executionQuote.id,
          regime: executionQuote.regime,
          phases: [...executionQuote.phases],
          decomposition: { ...executionQuote.decomposition },
          limits: { ...executionQuote.limits },
          ...(executionQuote.allocation
            ? {
                allocation: {
                  ...executionQuote.allocation,
                  phaseMembers: { ...executionQuote.allocation.phaseMembers }
                }
              }
            : {})
        }
      })
    }
    // Les observateurs sont posés pour TOUT run, pas seulement les mutations : le rattachement a
    // besoin du journal même quand aucune copie isolée n'est en jeu. Les rappels worktree, eux,
    // restent conditionnels — sans copie, il n'y a pas de bail à tenir.
    this.processObservers.set(runId, {
      process: (pid, active) => {
        if (isMut) this.deps.worktrees?.process?.(runId, pid, active)
      },
      spawnIntent: (token, active) => {
        // L'intention est émise AVANT le spawn. À cet instant la réservation provider porte déjà
        // activeCalls=1 : checkpoint-er le token maintenant ferme la fenêtre où un CLI détaché
        // pouvait naître avant que son PID/journal ne soit persisté. Un spawn avorté retire ce pending.
        if (active) this.rememberAgent(runId, token, {})
        else this.forgetPendingAgent(runId, token)
        if (isMut) this.deps.worktrees?.spawnIntent?.(runId, token, active)
      },
      spawned: (token, pid) => {
        // Empreinte capturée MAINTENANT : au redémarrage, elle distingue notre agent d'un processus
        // étranger ayant hérité du même numéro de pid.
        const identity = this.deps.processIdentity?.(pid)
        this.rememberAgent(runId, token, { pid, ...(identity ? { identity } : {}) })
        if (isMut) this.deps.worktrees?.spawned?.(runId, token, pid)
      },
      journal: (token, journalPath) => this.rememberAgent(runId, token, { journalPath })
    })
    try {
      // Fonctionnement NORMAL : on tente TOUJOURS de décomposer (le modèle orchestrateur juge s'il
      // peut). ≥2 sous-tâches → dispatch completion-driven (DAG). Tâche atomique (plan <2) ou pas de
      // décomposeur → pipeline séquentiel classique (fallback naturel, aucun « mode » à basculer).
      let greedyPlan: GreedyTaskNode[] | undefined
      // Un modèle explicitement choisi pour la tâche doit rester l'unique décideur du run :
      // le décomposeur est lié au rôle orchestrateur global et casserait cet invariant.
      const decompositionAllowed =
        !executionQuote || executionQuote.decomposition.mode === 'build-only'
      if (
        decompositionAllowed &&
        !bindingOverride &&
        this.deps.decompose &&
        phases.includes('build')
      ) {
        // L'issue de la décomposition devient un STEP observable, pas une ligne de log : un
        // `rejected` sort en `status: 'failed'`, donc un test peut l'assérer et l'Observatory le
        // montre. Avant, un JSON foiré et une tâche atomique produisaient le même `[]` silencieux.
        const plan = await this.deps.decompose(
          task,
          admittedRuntime.roles.orchestrator,
          (outcome) => {
            onStep?.({
              step: 'gate',
              role: 'decompose',
              status: outcome.kind === 'rejected' ? 'failed' : 'completed',
              detail:
                outcome.kind === 'rejected'
                  ? `DÉCOMPOSITION REJETÉE (${outcome.reason}) — fallback séquentiel`
                  : outcome.kind === 'atomic'
                    ? 'tâche jugée atomique — séquentiel'
                    : `plan de ${outcome.nodes.length} sous-tâches`,
              execution: { runId }
            })
          }
        )
        const admittedPlan = executionQuote
          ? limitGreedyPlan(
              plan,
              executionQuote.allocation?.maxGreedyNodes ?? executionQuote.decomposition.maxNodes
            )
          : plan
        if (admittedPlan.length >= 2) {
          if (phases.length !== 1 || phases[0] !== 'build') {
            greedyPlan = admittedPlan
          } else {
            const greedyResult = await this.runGreedyPipeline(
              task,
              admittedPlan,
              workCwd,
              runId,
              onStep,
              onPhase,
              onDelta,
              signal,
              collectedContext,
              bindingOverride,
              admittedRuntime
            )
            green = !greedyResult.gateBlocked
            produced = greedyResult
            return greedyResult
          }
        }
      }
      const result = await this.runInner(
        task,
        workCwd,
        onStep,
        onPhase,
        onDelta,
        signal,
        greedyPlan,
        collectedContext,
        runId,
        resumeOutputs,
        conversationId,
        bindingOverride,
        onBrainRetrieved,
        turnId,
        admittedRuntime
      )
      green = !result.gateBlocked
      produced = result
      return result
    } finally {
      this.processObservers.delete(runId)
      // Le travail n'est fusionné dans la base QUE si le run est vert. Un run rouge, annulé ou planté
      // garde sa copie isolée (l'exception saute le `green = true` ci-dessus) : on ne ramène plus
      // automatiquement dans la base un travail jugé raté.
      const finalized = this.deps.worktrees?.end(runId, { merge: green })
      const finalizeOutcome =
        typeof finalized === 'object' && finalized !== null
          ? (finalized as { outcome?: string }).outcome
          : undefined
      const integrated =
        !isMut ||
        finalizeOutcome === 'merged' ||
        finalizeOutcome === 'nothing' ||
        finalizeOutcome === 'cleanup-pending' ||
        finalizeOutcome === 'published-residue'
      const finalActivity = activityForRun()
      if (isMut && finalized && typeof finalized === 'object' && finalizeOutcome) {
        const result = finalized as {
          outcome: string
          files?: string[]
          reason?: string
          detail?: string
          publishedSha?: string
          agentSha?: string
        }
        const outcome =
          result.outcome === 'merged' ||
          result.outcome === 'nothing' ||
          result.outcome === 'conflict' ||
          result.outcome === 'blocked'
            ? result.outcome
            : 'kept'
        emitLifecycle({
          stage: 'git',
          runId,
          timestampMs: Date.now(),
          git: {
            outcome,
            rawOutcome: result.outcome,
            commitSha: result.publishedSha ?? result.agentSha ?? finalActivity?.publishedSha,
            baseBranch: finalActivity?.baseBranch,
            worktreePath: finalActivity?.worktreePath ?? isolatedCwd,
            files: result.files ?? finalActivity?.files.map((file) => file.path),
            reason: result.reason,
            detail: result.detail ?? finalActivity?.detail
          }
        })
      }
      if (green && !integrated && produced) {
        produced.valid = false
        produced.gateBlocked = true
        if (!produced.gateReasons.includes('intégration locale non terminée')) {
          produced.gateReasons.push('intégration locale non terminée')
        }
      }
      // Le rapport a ete redige DANS la copie isolee ; la ligne ci-dessus vient de la fusionner puis de
      // la supprimer. Sans cet alignement, chaque chemin cite est mort — constate le 2026-07-29, dit
      // par l'agent lui-meme : « le rapport pointe vers un worktree qui n'existe plus ».
      if (produced && workCwd !== this.deps.executionWorkspace) {
        const aligned = alignReportWithDisk(
          { result: produced.result, phaseOutputs: produced.phaseOutputs },
          workCwd,
          this.deps.executionWorkspace,
          integrated ? 'merged' : 'kept'
        )
        produced.result = aligned.result
        produced.phaseOutputs = aligned.phaseOutputs ?? produced.phaseOutputs
      }
      // Clôture auto APRÈS la fusion (le travail est dans la base) et seulement si vert.
      // `void` + catch : publier est un service rendu, jamais une raison de faire échouer le run.
      if (green && integrated && this.deps.closeGreenRun) {
        void this.deps.closeGreenRun
          .close({ runId, task, workCwd: this.deps.executionWorkspace })
          .catch(() => undefined)
      }
      // Un vert dont l'intégration n'est pas terminée reste reprenable. Tous les autres runs ont
      // réellement atteint un état terminal : leur acquis de phase peut alors être rangé.
      if (!green || integrated) {
        try {
          this.deps.onRunSettled?.(runId)
        } catch {
          /* effacement best-effort */
        }
        this.runAgents.delete(runId)
      }
      emitLifecycle({
        stage: 'closure',
        runId,
        timestampMs: Date.now(),
        closure: {
          status: green && integrated ? 'green' : 'red',
          totalDurationMs: Math.max(0, Date.now() - runStartedAtMs),
          totalCostUsd: this.deps.currentExecutionUsage?.()?.knownCostUsd ?? produced?.costUsd ?? 0,
          gateReasons: produced?.gateReasons,
          integrationOutcome: finalizeOutcome,
          usage: this.deps.currentExecutionUsage?.()
        }
      })
    }
  }

  /**
   * Chemin GREEDY (isolé du séquentiel) : exécute un DAG de sous-tâches en completion-driven.
   * Chaque sous-tâche = un sous-agent `build` lancé via `registry.send` ; l'ordonnanceur traite
   * chaque résultat DÈS son arrivée et dispatche les avals dont les dépendances viennent d'être
   * satisfaites, sans barrière. On agrège les livrables puis on passe UNE fois le juge + le gate.
   */
  private async runGreedyPipeline(
    task: string,
    plan: GreedyTaskNode[],
    workCwd: string,
    runId: string,
    onStep?: (s: OrchestrationStep) => void,
    onPhase?: (p: OrchestrationPhase) => void,
    onDelta?: (step: 'exec' | 'judge', delta: string) => void,
    signal?: AbortSignal,
    collectedContext = '',
    bindingOverride?: RoleBinding,
    runtimeSnapshot?: OrchestrationRuntimeSnapshot
  ): Promise<OrchestrationResult> {
    const trace: OrchestrationStep[] = []
    const push = (s: OrchestrationStep): void => {
      trace.push(s)
      onStep?.(s)
    }
    const greedy = await this.runGreedyBuildPhase(
      task,
      plan,
      workCwd,
      runId,
      collectedContext,
      true,
      'build',
      push,
      onPhase,
      onDelta,
      signal,
      bindingOverride,
      runtimeSnapshot
    )

    const { valid, gate } = await this.greedyJudgeAndGate(
      task,
      greedy.aggregate,
      greedy.evidence,
      workCwd,
      runId,
      push,
      onPhase,
      onDelta,
      signal,
      bindingOverride,
      runtimeSnapshot
    )

    return {
      task,
      result: greedy.aggregate,
      valid,
      gateBlocked: gate.blocked,
      gateReasons: gate.reasons,
      costUsd: costOfTrace(trace),
      quote: this.deps.currentExecutionQuote?.(),
      phaseOutputs: greedy.orderedOutputs.map((output) => ({
        phase: 'build' as PipelinePhase,
        text: output.text
      })),
      trace,
      failedTasks: greedy.failed,
      skippedTasks: greedy.skipped
    }
  }

  /** Juge + gate en mode greedy (une passe sur l'agrégat). Isolé du closure séquentiel. */
  private async greedyJudgeAndGate(
    task: string,
    aggregate: string,
    evidence: ExecutionEvidence[],
    workCwd: string,
    runId: string,
    push: (s: OrchestrationStep) => void,
    onPhase?: (p: OrchestrationPhase) => void,
    onDelta?: (step: 'exec' | 'judge', delta: string) => void,
    signal?: AbortSignal,
    bindingOverride?: RoleBinding,
    runtimeSnapshot?: OrchestrationRuntimeSnapshot
  ): Promise<{ valid: boolean; gate: ReturnType<typeof evaluateClosure> }> {
    const { registry, roles, cost, trust } = this.deps
    // Le chemin greedy doit respecter le même ordre économique que le séquentiel : les oracles
    // locaux falsifiables passent AVANT le juge payant. S'ils réfutent le livrable, aucun appel
    // modèle ne peut rendre cette tentative verte.
    const evidenceOk = evidenceSatisfiesTask(task, evidence)
    const hookOutcome = await this.hooks.run('pre-green', {
      task,
      cwd: workCwd,
      verifyCmd: this.resolveVerifyCmd(workCwd),
      requireProof: isMutationTask(task),
      evidenceOkCount: evidence.filter((item) => item.ok).length,
      evidence
    })
    const preGate = evaluateClosure({
      status: evidenceOk && !hookOutcome.blocked ? 'green' : 'red',
      dod: [{ checked: evidenceOk, hasContent: true }]
    })
    if (hookOutcome.blocked) preGate.reasons.push(...hookOutcome.reasons)
    if (preGate.blocked) {
      onPhase?.({ step: 'gate' })
      push({
        step: 'gate',
        role: 'gate',
        detail: `PRÉ-GATE BLOQUÉ: ${preGate.reasons.join('; ')}`
      })
      return { valid: false, gate: preGate }
    }

    const projectContext = projectContextBlock(this.deps.executionWorkspace)
    const judgeBinding =
      bindingOverride ?? runtimeSnapshot?.roles.judge ?? roles.getBinding('judge')
    const judgeProvider = judgeBinding.provider
    const judgePrompt =
      `Tu es un juge outillé en lecture seule. Confronte le livrable aux preuves d'outil. ` +
      `Le livrable est le TEXTE agrégé (sous-tâches parallèles), PAS un RUN.md sur disque.\n` +
      `TÂCHE: ${task}\nRÉPONSE (agrégat des sous-tâches) : ${aggregate}\n` +
      `PREUVES OUTILS: ${JSON.stringify(evidence ?? [])}\n` +
      `Réponds STRICTEMENT par "VALIDE" ou "DEFAUT: <raison courte>".`
    const messages = [{ role: 'user' as const, content: judgePrompt }]
    const parts = [
      this.phasePrompt('judge', true),
      { name: 'style', text: CONCISE_STRUCTURED_RESPONSE_INSTRUCTION },
      { name: 'projectContext', text: projectContext }
    ]
    const systemBlocks = parts
      .filter((p) => p.text)
      .map((p) => ({ name: p.name, chars: p.text.length }))
    let envelope: PromptEnvelope | undefined
    const opts: SendOptions = {
      system: parts.map((p) => p.text).join(''),
      systemBlocks,
      model: judgeBinding.model,
      reasoningEffort: judgeBinding.reasoningEffort,
      execution: this.executionOptions(workCwd, 'read-only', runId),
      signal,
      observePrompt: (observed) => {
        observed.systemBlocks = systemBlocks
        envelope = observed
      }
    }
    envelope = registry.describePrompt(judgeProvider, messages, opts, judgeBinding.model)
    envelope.systemBlocks = systemBlocks
    const judgeExecution = {
      phase: 'judge' as const,
      agentId: 'judge:greedy',
      taskId: 'judge:greedy',
      groupId: 'judge:single',
      dependencyIds: [] as string[],
      attemptId: randomUUID()
    }
    onPhase?.({
      step: 'judge',
      provider: judgeProvider,
      role: 'judge',
      model: judgeBinding.model,
      execution: judgeExecution
    })
    const startedAt = performance.now()
    const res = await this.sendWithRoleContext('jugement', 'judge', judgeProvider, opts.model, () =>
      registry.send(judgeProvider, messages, opts, (c) => onDelta?.('judge', c.delta))
    )
    if (res.usage) {
      cost.add({
        provider: res.provider ?? judgeProvider,
        role: 'judge',
        model: judgeBinding.model,
        inputTokens: res.usage.inputTokens,
        outputTokens: res.usage.outputTokens,
        cacheReadTokens: res.usage.cacheReadTokens,
        costUsd: res.usage.costUsd
      })
    }
    const verdictText = res.text ?? ''
    // Les preuves ont déjà passé le pré-gate : le juge tranche maintenant la substance.
    const ok = /^\s*valide/i.test(verdictText)
    trust.record({ judgeModel: judgeProvider, verdict: ok ? 'green' : 'red' })
    push({
      step: 'judge',
      provider: res.provider ?? judgeProvider,
      role: 'judge',
      model: res.model ?? judgeBinding.model,
      text: verdictText.trim(),
      thinking: res.thinking,
      tokens: res.usage ? res.usage.inputTokens + res.usage.outputTokens : undefined,
      costUsd: res.usage?.costUsd,
      usage: res.usage,
      prompt: envelope,
      detail: ok ? 'validé' : 'défaut',
      status: 'completed',
      durationMs: performance.now() - startedAt,
      execution: judgeExecution
    })
    onPhase?.({ step: 'gate' })
    const gate = evaluateClosure({
      status: ok ? 'green' : 'red',
      dod: [{ checked: ok, hasContent: true }]
    })
    push({
      step: 'gate',
      role: 'gate',
      detail: gate.blocked ? `BLOQUÉ: ${gate.reasons.join('; ')}` : 'clôture autorisée'
    })
    return { valid: ok, gate }
  }

  /** Exécute une tâche à travers le pipeline discipliné complet (appels réels). */
  /**
   * Execute UNE phase en la DECOUPANT en sous-taches parallelisees (DAG completion-driven).
   *
   * Anciennement reservee a `build` : toute autre phase tournait en un seul sous-agent monolithique.
   * Mesure du 2026-07-28 (conv-75) : une phase d'exploration non decoupee a coute 10,90 $ en 11 min,
   * alors que le MEME travail, decoupe en 5 sous-audits cibles, a coute ~0,8 $ et ~1 min chacun.
   * Le decoupage n'est donc pas une specificite du build : c'est le levier de cout de TOUTE phase.
   *
   * `phase` est desormais un parametre : sans lui, les sous-agents d'un scout recevaient la consigne
   * de phase « build » (construis/modifie) au lieu de celle de leur phase reelle.
   */
  private async runGreedyBuildPhase(
    task: string,
    plan: GreedyTaskNode[],
    workCwd: string,
    runId: string,
    phaseContext: string,
    withFoundation: boolean,
    phase: PipelinePhase,
    push: (s: OrchestrationStep) => void,
    onPhase?: (p: OrchestrationPhase) => void,
    onDelta?: (step: 'exec' | 'judge', delta: string) => void,
    signal?: AbortSignal,
    bindingOverride?: RoleBinding,
    runtimeSnapshot?: OrchestrationRuntimeSnapshot
  ): Promise<{
    aggregate: string
    orderedOutputs: { id: string; text: string }[]
    evidence: ExecutionEvidence[]
    failed: string[]
    skipped: string[]
  }> {
    const { registry, roles, cost } = this.deps
    type ProviderAdmission = {
      state: 'probing' | 'ready' | 'blocked'
      settled: Promise<void>
      release: () => void
      signature?: string
      cause?: string
    }
    const providerAdmissions = new Map<string, ProviderAdmission>()
    const admitProviderCall = async (
      provider: string
    ): Promise<{ admission: ProviderAdmission; leader: boolean }> => {
      const existing = providerAdmissions.get(provider)
      if (existing) {
        if (existing.state === 'probing') await existing.settled
        return { admission: existing, leader: false }
      }
      let release = (): void => undefined
      const settled = new Promise<void>((resolve) => {
        release = resolve
      })
      const admission: ProviderAdmission = { state: 'probing', settled, release }
      providerAdmissions.set(provider, admission)
      return { admission, leader: true }
    }
    const structuralFailure = (
      error: unknown
    ): { provider: string; signature: string; cause: string } | undefined => {
      if (!error || typeof error !== 'object') return undefined
      const candidate = error as {
        structuralProviderFailure?: unknown
        provider?: unknown
        signature?: unknown
        causeText?: unknown
      }
      if (
        candidate.structuralProviderFailure !== true ||
        typeof candidate.provider !== 'string' ||
        typeof candidate.signature !== 'string'
      ) {
        return undefined
      }
      return {
        provider: candidate.provider,
        signature: candidate.signature,
        cause:
          typeof candidate.causeText === 'string'
            ? candidate.causeText
            : error instanceof Error
              ? error.message
              : String(error)
      }
    }
    const projectContext = projectContextBlock(this.deps.executionWorkspace)
    // Une phase décomposée ne doit pas contourner son panel : chaque sous-tâche est exécutée par
    // tous les membres configurés, puis leurs sorties sont fusionnées. Sans panel (build/refine ou
    // topologie legacy vide), on conserve exactement le binding subagent historique. Un override de
    // tâche reste autoritaire et désactive le fan-out, comme dans le chemin non décomposé.
    const configuredBindings: RoleBinding[] = bindingOverride
      ? [bindingOverride]
      : this.resolvePhaseFanOut(phase, runtimeSnapshot)
    const subBindings =
      configuredBindings.length > 0
        ? configuredBindings
        : [runtimeSnapshot?.roles.subagent ?? roles.getBinding('subagent')]
    const fallbackProvider = subBindings[0].provider
    const sandbox = isMutationTask(task) ? 'danger-full-access' : 'read-only'
    const evidence: ExecutionEvidence[] = []
    const outputs: { id: string; text: string }[] = []
    const nodes: GreedyNode<{ text: string; evidence: ExecutionEvidence[] }>[] = plan.map(
      (node) => ({
        id: node.id,
        deps: node.deps,
        run: async (depResults) => {
          const depContext = Object.entries(depResults)
            .map(([id, result]) => `[dépendance ${id}]\n${result.text.slice(0, PHASE_CONTEXT_CAP)}`)
            .join('\n\n')
          const userContent = [phaseContext, depContext, `[sous-tâche ${node.id}] ${node.prompt}`]
            .filter(Boolean)
            .join('\n\n')
          const parts = [
            { name: 'constitution', text: CONSTITUTION },
            this.phasePrompt(phase, withFoundation),
            { name: 'discipline', text: PIPELINE_DISCIPLINE_INSTRUCTION },
            { name: 'style', text: CONCISE_STRUCTURED_RESPONSE_INSTRUCTION },
            { name: 'projectContext', text: projectContext },
            // Vide quand le run tourne dans le dépôt de base : rien n'est payé en contexte.
            {
              name: 'workspaceIsolation',
              text: workspaceIsolationNotice(workCwd, this.deps.executionWorkspace)
            }
          ]
          const systemBlocks = parts
            .filter((part) => part.text)
            .map((part) => ({ name: part.name, chars: part.text.length }))
          const messages = [{ role: 'user' as const, content: userContent }]
          const members = await Promise.all(
            subBindings.map(async (subBinding) => {
              const subProvider = subBinding.provider
              const phaseBinding = resolvePhaseBinding(subBinding, phase)
              const memberKey = phaseBinding.model ?? subProvider
              let envelope: PromptEnvelope | undefined
              const options: SendOptions = {
                system: parts.map((part) => part.text).join(''),
                systemBlocks,
                model: phaseBinding.model,
                reasoningEffort: phaseBinding.reasoningEffort,
                execution: this.executionOptions(workCwd, sandbox, runId),
                signal,
                observePrompt: (observed) => {
                  observed.systemBlocks = systemBlocks
                  envelope = observed
                }
              }
              envelope = registry.describePrompt(subProvider, messages, options, phaseBinding.model)
              envelope.systemBlocks = systemBlocks
              const execution = {
                phase,
                agentId:
                  subBindings.length === 1
                    ? `${phase}:${node.id}`
                    : `${phase}:${node.id}:${memberKey}`,
                taskId: node.id,
                groupId: `${phase}:greedy`,
                dependencyIds: [...node.deps],
                attemptId: randomUUID()
              }
              onPhase?.({
                step: 'exec',
                provider: subProvider,
                role: 'subagent',
                model: phaseBinding.model,
                reasoningEffort: phaseBinding.reasoningEffort,
                phase,
                execution
              })
              const startedAt = performance.now()
              const { admission, leader } = await admitProviderCall(subProvider)
              if (admission.state === 'blocked') {
                const cause = admission.cause ?? `provider ${subProvider} bloqué`
                push({
                  step: 'exec',
                  provider: subProvider,
                  role: 'subagent',
                  model: phaseBinding.model,
                  text: '',
                  status: 'provider-blocked',
                  error: cause,
                  durationMs: performance.now() - startedAt,
                  detail: `sous-tâche ${node.id}`,
                  execution
                })
                return {
                  ok: false as const,
                  provider: subProvider,
                  model: phaseBinding.model,
                  text: '',
                  evidence: [] as ExecutionEvidence[],
                  agentId: execution.agentId,
                  cause
                }
              }
              try {
                const result = await registry.send(subProvider, messages, options, (chunk) =>
                  onDelta?.('exec', chunk.delta)
                )
                if (leader) {
                  admission.state = 'ready'
                  admission.release()
                }
                if (result.usage) {
                  cost.add({
                    provider: result.provider ?? subProvider,
                    role: 'subagent',
                    model: phaseBinding.model,
                    inputTokens: result.usage.inputTokens,
                    outputTokens: result.usage.outputTokens,
                    cacheReadTokens: result.usage.cacheReadTokens,
                    costUsd: result.usage.costUsd
                  })
                }
                push({
                  step: 'exec',
                  provider: result.provider ?? subProvider,
                  role: 'subagent',
                  model: result.model ?? phaseBinding.model,
                  text: result.text,
                  thinking: result.thinking,
                  tokens: result.usage
                    ? result.usage.inputTokens + result.usage.outputTokens
                    : undefined,
                  costUsd: result.usage?.costUsd,
                  usage: result.usage,
                  prompt: envelope,
                  status: 'completed',
                  durationMs: performance.now() - startedAt,
                  evidence: result.executionEvidence,
                  artifacts: result.artifacts,
                  detail:
                    subBindings.length === 1
                      ? `sous-tâche ${node.id}`
                      : `sous-tâche ${node.id} · modèle ${memberKey}`,
                  execution
                })
                return {
                  ok: true as const,
                  provider: result.provider ?? subProvider,
                  model: result.model ?? phaseBinding.model,
                  text: result.text,
                  evidence: result.executionEvidence ?? [],
                  agentId: execution.agentId,
                  cause: undefined
                }
              } catch (error) {
                const structural = structuralFailure(error)
                if (structural && structural.provider === subProvider) {
                  admission.state = 'blocked'
                  admission.signature = structural.signature
                  admission.cause = structural.cause
                }
                if (leader) {
                  if (!structural || structural.provider !== subProvider) {
                    admission.state = 'ready'
                  }
                  admission.release()
                }
                const explained = explainRoleFailure(`sous-tâche ${node.id}`, 'subagent', {
                  provider: subProvider,
                  ...(phaseBinding.model ? { model: phaseBinding.model } : {}),
                  message: error instanceof Error ? error.message : String(error)
                })
                push({
                  step: 'exec',
                  provider: subProvider,
                  role: 'subagent',
                  model: phaseBinding.model,
                  text: '',
                  status: 'failed',
                  error: explained,
                  durationMs: performance.now() - startedAt,
                  detail:
                    subBindings.length === 1
                      ? `sous-tâche ${node.id}`
                      : `sous-tâche ${node.id} · modèle ${memberKey}`,
                  execution
                })
                return {
                  ok: false as const,
                  provider: subProvider,
                  model: phaseBinding.model,
                  text: '',
                  evidence: [] as ExecutionEvidence[],
                  agentId: execution.agentId,
                  cause: explained
                }
              }
            })
          )
          const good = members.filter((member) => member.ok && member.text.trim())
          if (good.length === 0) {
            if (subBindings.length === 1 && configuredBindings.length === 0) {
              throw new Error(members[0].cause ?? `sous-tâche ${node.id} en échec`)
            }
            const explained = describeFanoutFailure(
              phase,
              'subagent',
              members.map((member) => ({
                provider: member.provider,
                ...(member.model ? { model: member.model } : {}),
                message: member.cause ?? 'sortie vide'
              }))
            )
            throw new Error(explained)
          }
          const nodeEvidence = good.flatMap((member) => member.evidence)
          let nodeText = good[0].text
          if (good.length > 1) {
            const orchBinding =
              runtimeSnapshot?.roles.orchestrator ?? roles.getBinding('orchestrator')
            const labelled = good
              .map(
                (member, index) =>
                  `### Proposition ${index + 1} (modèle ${member.model ?? member.provider})\n${member.text}`
              )
              .join('\n\n')
            const synthMessages = [
              {
                role: 'user' as const,
                content:
                  `Sous-tâche « ${node.id} » exécutée par ${good.length} modèle(s). ` +
                  `Fusionne leurs sorties en une UNION DÉDUPLIQUÉE, sans perdre d'angle distinct ni re-décider.\n\n${labelled}`
              }
            ]
            const synthOptions: SendOptions = {
              system: CONSTITUTION + CONCISE_STRUCTURED_RESPONSE_INSTRUCTION + projectContext,
              model: orchBinding.model,
              reasoningEffort: orchBinding.reasoningEffort,
              execution: this.executionOptions(workCwd, 'read-only', runId),
              signal
            }
            const synthExecution = {
              phase,
              agentId: `${phase}:${node.id}:synthesis`,
              taskId: `${node.id}:synthesis`,
              groupId: `${phase}:greedy-synthesis`,
              dependencyIds: good.map((member) => member.agentId),
              attemptId: randomUUID()
            }
            onPhase?.({
              step: 'exec',
              provider: orchBinding.provider,
              role: 'orchestrator',
              model: orchBinding.model,
              reasoningEffort: orchBinding.reasoningEffort,
              phase,
              execution: synthExecution
            })
            const synthStartedAt = performance.now()
            const synth = await this.sendWithRoleContext(
              `synthèse sous-tâche ${node.id}`,
              'orchestrator',
              orchBinding.provider,
              orchBinding.model,
              () =>
                registry.send(orchBinding.provider, synthMessages, synthOptions, (chunk) =>
                  onDelta?.('exec', chunk.delta)
                )
            )
            if (synth.usage) {
              cost.add({
                provider: synth.provider ?? orchBinding.provider,
                role: 'orchestrator',
                model: orchBinding.model,
                inputTokens: synth.usage.inputTokens,
                outputTokens: synth.usage.outputTokens,
                cacheReadTokens: synth.usage.cacheReadTokens,
                costUsd: synth.usage.costUsd
              })
            }
            push({
              step: 'exec',
              provider: synth.provider ?? orchBinding.provider,
              role: 'orchestrator',
              model: synth.model ?? orchBinding.model,
              text: synth.text,
              thinking: synth.thinking,
              tokens: synth.usage ? synth.usage.inputTokens + synth.usage.outputTokens : undefined,
              costUsd: synth.usage?.costUsd,
              usage: synth.usage,
              status: 'completed',
              durationMs: performance.now() - synthStartedAt,
              evidence: synth.executionEvidence,
              artifacts: synth.artifacts,
              detail: `synthèse sous-tâche ${node.id}`,
              execution: synthExecution
            })
            nodeText = synth.text
          }
          evidence.push(...nodeEvidence)
          outputs.push({ id: node.id, text: nodeText })
          return { text: nodeText, evidence: nodeEvidence }
        }
      })
    )
    const run = await runGreedy(nodes, {
      concurrency: Math.min(
        this.deps.greedyConcurrency ?? 4,
        this.deps.currentExecutionQuote?.()?.limits.maxConcurrency ?? Number.POSITIVE_INFINITY
      ),
      onSettled: (event) => {
        if (!event.skipped) return
        const skippedNode = plan.find((node) => node.id === event.id)
        push({
          step: 'exec',
          provider: fallbackProvider,
          role: 'subagent',
          text: '',
          status: 'failed',
          error: `sous-tâche ${event.id} sautée (dépendance en échec)`,
          detail: `sous-tâche ${event.id}`,
          execution: {
            phase,
            agentId: `${phase}:${event.id}`,
            taskId: event.id,
            groupId: `${phase}:greedy`,
            dependencyIds: [...(skippedNode?.deps ?? [])]
          }
        })
      }
    })
    const orderedOutputs = plan
      .map((node) => outputs.find((output) => output.id === node.id))
      .filter((output): output is { id: string; text: string } => Boolean(output))
    return {
      aggregate: orderedOutputs
        .map((output) => `[sous-tâche ${output.id}]\n${output.text}`)
        .join('\n\n'),
      orderedOutputs,
      evidence,
      failed: run.failed,
      skipped: run.skipped
    }
  }

  /**
   * Enrichit l'erreur d'un `registry.send` avec le ROLE et son binding. Les erreurs brutes des
   * adaptateurs disent la cause (« codex non authentifié — … », « spawn … ENOENT ») mais jamais quel
   * role l'a subie : constate a l'ecran le 2026-07-29, l'utilisateur voyait `spawn … ENOENT` sans
   * savoir quel role pointait sur un provider indisponible. On enveloppe au plus pres de l'appel : les
   * `catch` existants en amont recoivent alors le message enrichi et le journalisent tel quel.
   */
  private async sendWithRoleContext<T>(
    label: string,
    role: string,
    provider: string,
    model: string | undefined,
    send: () => Promise<T>
  ): Promise<T> {
    try {
      return await send()
    } catch (error) {
      throw new Error(
        explainRoleFailure(label, role, {
          provider,
          ...(model ? { model } : {}),
          message: error instanceof Error ? error.message : String(error)
        })
      )
    }
  }

  private async runInner(
    task: string,
    workCwd: string,
    onStep?: (s: OrchestrationStep) => void,
    onPhase?: (p: OrchestrationPhase) => void,
    onDelta?: (step: 'exec' | 'judge', delta: string) => void,
    signal?: AbortSignal,
    greedyPlan?: GreedyTaskNode[],
    collectedContext = '',
    runId = '',
    /** SURVIE NIVEAU 3 : acquis d'un run interrompu → ces phases sont REJOUÉES, pas refaites. */
    resumeOutputs: { phase: PipelinePhase; text: string }[] = [],
    conversationId?: string,
    bindingOverride?: RoleBinding,
    onBrainRetrieved?: (event: BrainRetrievalEvent) => void,
    turnId?: string,
    runtimeSnapshot?: OrchestrationRuntimeSnapshot
  ): Promise<OrchestrationResult> {
    if (!runtimeSnapshot) {
      throw new Error("Snapshot runtime manquant dans le coeur d'orchestration")
    }
    const { registry, roles, cost, trust } = this.deps
    // Souveraineté contexte (décision PLIER) : Autowin lit LUI-MÊME le fichier projet gagnant de la
    // chaîne de précédence et le plie dans chaque system → source unique, quel que soit le modèle.
    const projectContext = projectContextBlock(this.deps.executionWorkspace)
    const trace: OrchestrationStep[] = []
    const push = (s: OrchestrationStep): void => {
      trace.push(s)
      onStep?.(s)
    }

    // 1. Le sous-agent EXÉCUTE la tâche via la PIPELINE de phases (1 skill du kit par phase,
    //    provider-agnostique). Défaut ['build'] = exec simple ; prod = ['frame','build'] etc.
    const subBinding =
      bindingOverride ?? runtimeSnapshot?.roles.subagent ?? roles.getBinding('subagent')
    const subProvider = subBinding.provider
    // Sélection ADAPTATIVE (proportionnalité) : `classifyPhases(task)` prime si fourni — une tâche
    // triviale ne joue pas les 5 phases. Fallback `execPhases` statique (rétrocompat/tests).
    // Un workflow nommé REMPLACE ce pipeline : c'est ici que l'exécution se décide (le calcul du
    // devis, plus haut, en fait sa propre lecture — les deux doivent voir la même liste).
    const execPhases: PipelinePhase[] = this.effectivePhases(task)
    /**
     * Le verdict de la phase qui vient de finir. C'est lui qui décide quelle arête le marcheur franchit.
     * Vert par défaut, DÉLIBÉRÉMENT : une phase qui ne déclare rien ne doit pas déclencher une réparation
     * que personne n'a demandée. Seul un rejet explicite en tête de sortie fait basculer au rouge —
     * même idiome qu'au juge, dont la validité se lit déjà sur les premiers mots de son verdict.
     */
    let dernierVerdict: NodeVerdict = 'green'
    /**
     * La suite des phases à jouer. Avec un graphe, on le MARCHE (retours compris, budgets consommés) ;
     * sans graphe, on déroule la liste plate d'avant. Un générateur plutôt qu'un tableau : la suite ne
     * peut pas être connue à l'avance, elle dépend du verdict de chaque phase au moment où elle finit.
     */
    const grapheBrut = this.deps.currentWorkflow?.()?.graph
    /**
     * Le graphe tel que le MARCHEUR le voit — privé du seul retour `judge --red--> build`.
     *
     * Ce retour-là est déjà joué en aval par la boucle de réparation, qui fait plus que revenir au
     * build : elle le RENOURRIT des raisons du gate. Le laisser aussi au marcheur le jouerait DEUX
     * fois, et doublerait silencieusement le coût que le devis a provisionné.
     */
    const graphePilote: WorkflowGraph | undefined = grapheBrut
      ? {
          ...grapheBrut,
          edges: grapheBrut.edges.filter((edge) => {
            if (edge.when !== 'red') return true
            const depuis = grapheBrut.nodes.find((n) => n.id === edge.from)?.phase
            const vers = grapheBrut.nodes.find((n) => n.id === edge.to)?.phase
            return !(depuis === 'judge' && vers === 'build')
          })
        }
      : undefined
    const suitePhases = function* (): Generator<PipelinePhase> {
      if (!graphePilote?.nodes?.length) {
        yield* execPhases
        return
      }
      const rangs = nodeRanks(graphePilote)
      const budget = initialBudget(graphePilote, rangs)
      const parId = new Map(graphePilote.nodes.map((node) => [node.id, node]))
      let courant: string | undefined = graphePilote.entry
      // Garde-fou de dernier ressort : les budgets bornent déjà le run, ce plafond n'existe que pour
      // qu'un graphe corrompu (arête vers un nœud absent, budget incohérent) ne fige pas le process.
      for (let pas = 0; pas < 200 && courant && parId.has(courant); pas++) {
        yield parId.get(courant)!.phase
        const suivant = nextNode(graphePilote, courant, dernierVerdict, budget, rangs)
        if (!suivant) return
        courant = suivant.to
      }
    }
    let execPrompt
    let lastExecText = ''
    let lastUsage: Usage | undefined
    const aggregatedEvidence: ExecutionEvidence[] = []
    // SURVIE NIVEAU 3 : on repart de l'acquis persisté (phases déjà terminées avant le kill).
    // Une phase dont le livrable est VIDE n'est PAS un acquis : la sauter perdrait le travail
    // (constaté en réel — un run interrompu avait persisté `frame` avec 0 caractère). On ne reprend
    // donc que les phases porteuses de contenu ; les autres seront rejouées normalement.
    const usableResume = resumeOutputs.filter((output) => output.text.trim().length > 0)
    const phaseOutputs: { phase: PipelinePhase; text: string }[] = [...usableResume]
    /**
     * Les phases déjà payées, comptées par OCCURRENCE et non par nom.
     *
     * Un Set de noms de phase suffisait quand le moteur déroulait une liste plate où chaque phase
     * apparaissait une fois. Avec un graphe, un `frame` peut être rejoué LÉGITIMEMENT par une arête
     * de retour : un Set le sauterait pour toujours, et le travail annoncé par ce retour n'aurait
     * jamais lieu. On décompte donc : la 1re visite d'une phase reprise est sautée, les suivantes
     * s'exécutent.
     */
    const resteAPasser = new Map<PipelinePhase, number>()
    for (const output of usableResume) {
      resteAPasser.set(output.phase, (resteAPasser.get(output.phase) ?? 0) + 1)
    }
    /**
     * Le texte de CHAQUE visite reprise, dans l'ordre, par phase.
     *
     * Pré-amorcer le verdict depuis la seule DERNIÈRE phase reprise ne suffisait pas : la marche relit
     * `dernierVerdict` à chaque pas, et une phase rejouée sort par `dejaPayee` sans passer par
     * `recordPhase`. Un nœud intermédiaire choisissait donc son arête avec le verdict de quelqu'un
     * d'autre. Cas mesuré : acquis `scout → judge(ROUGE) → clean`, le pré-amorçage retenait `clean`
     * (vert), le marcheur franchissait l'arête VERTE au nœud judge et SAUTAIT la réparation que le
     * rouge devait déclencher — en se déclarant réussi.
     */
    const textesRepris = new Map<PipelinePhase, string[]>()
    for (const output of usableResume) {
      const file = textesRepris.get(output.phase) ?? []
      file.push(output.text)
      textesRepris.set(output.phase, file)
    }
    /** Consomme un crédit de reprise pour cette phase. `true` = déjà payée, on saute cette visite. */
    const dejaPayee = (phase: PipelinePhase): boolean => {
      const reste = resteAPasser.get(phase) ?? 0
      if (reste <= 0) return false
      resteAPasser.set(phase, reste - 1)
      // Le verdict de CETTE visite rejouée — même décompte que `resteAPasser`, donc la Nᵉ visite de la
      // phase consomme le Nᵉ acquis de cette phase. C'est ce qui fait suivre au rejeu le chemin
      // RÉELLEMENT emprunté avant l'interruption, et non celui du dernier acquis.
      const texte = textesRepris.get(phase)?.shift()
      if (texte !== undefined) dernierVerdict = verdictDePhase(phase, texte)
      return true
    }
    /** Enregistre une phase terminée ET notifie l'appelant pour qu'il persiste l'acquis. */
    const recordPhase = (phase: PipelinePhase, text: string): void => {
      // Point d'accroche UNIQUE du verdict : tous les chemins de phase (séquentiel, fan-out, greedy)
      // passent par ici. Le brancher ailleurs laisserait une branche muette, donc un retour jamais pris.
      //
      // RESTREINT AU JUGE : seul son brief impose le vocabulaire `DEFAUT:`/`VALIDE`. Un `scout` ou un
      // `frame` rédige librement ; l'un d'eux ouvrant par « KO » ou « Rejeté » aurait fait basculer
      // tout le run sur une arête rouge que personne n'a demandée. Les autres phases sont vertes —
      // elles racontent leur travail, elles ne se prononcent pas.
      dernierVerdict = verdictDePhase(phase, text)
      phaseOutputs.push({ phase, text })
      try {
        this.deps.onPhaseCompleted?.({
          runId,
          task,
          conversationId,
          turnId,
          bindingOverride,
          runtimeSnapshot,
          phaseOutputs: [...phaseOutputs],
          executionQuote: this.deps.currentExecutionQuote?.(),
          usage: this.deps.currentExecutionUsage?.(),
          agents: this.agentsOf(runId)
        })
      } catch {
        /* best-effort : une panne de persistance ne casse jamais le run en cours */
      }
    }
    let failedTasks: string[] | undefined
    let skippedTasks: string[] | undefined
    // RAG Brain : 1×/run, on récupère du cerveau Amitel la connaissance pertinente (retriever
    // hybride chaud du brain_server) et on l'injecte en tête de contexte. Le sous-agent part du
    // savoir CURÉ au lieu de brute-forcer le repo. Dégrade à '' si le serveur est absent.
    const brainCorpus = brainCorpusForWorkspace(this.deps.executionWorkspace)
    const brain =
      brainCorpus?.length === 0
        ? { context: '', status: 'empty' as const }
        : await (this.deps.retrieveBrain ?? retrieveBrainContext)(task, {
            corpus: brainCorpus
          })
    const brainRetrievedAt = new Date().toISOString()
    const scopedBrain = scopeBrainRetrieval(brain, brainCorpus)
    const brainContext = scopedBrain.context
    const memoryEcho = sessionMemoryBlock(
      rememberedFacts(conversationId, this.deps.executionWorkspace),
      ECHO_MAX_BLOCK_CHARS,
      evictedCount(conversationId, this.deps.executionWorkspace)
    )
    const brainQuery = scopedBrain.navigation?.query || task
    try {
      onBrainRetrieved?.({
        timestamp: brainRetrievedAt,
        query: brainQuery,
        found: brainContext.length > 0,
        status: scopedBrain.status,
        injectedChars: brainContext.length,
        navigation: scopedBrain.navigation
      })
    } catch {
      // L'observabilité Brain ne doit jamais faire échouer le run.
    }
    // #1 repo-map graphify RÉFUTÉ par mesure A/B (2026-07-22) : injecter GRAPH_REPORT.md (28k) à
    // chaque phase coûtait +206k tokens (ON 573k vs OFF 367k) SANS réduire la lecture agentique du
    // sous-agent → contre-productif (piège du soft-steer saturé). Levier retiré. Cf. harnais
    // scripts/measure-orchestration-tokens.mjs pour re-mesurer une éventuelle version micro.
    const phaseContext: string[] = [
      ...(memoryEcho ? [memoryEcho] : []),
      ...(brainContext
        ? [
            brainContext,
            `Sers-toi de la CONNAISSANCE (Brain) ci-dessus en priorité ; ne relis le dépôt que si strictement nécessaire.`
          ]
        : []),
      `TÂCHE: ${task}`,
      ...(collectedContext ? [collectedContext] : [])
    ]
    // Session-resume chaîné (levier coût) : on RÉUTILISE la session de l'exécuteur d'une phase à la
    // suivante quand le provider rend un sessionId. La tâche + le Brain + l'acquis des phases sont
    // alors DÉJÀ dans l'historique de session → on n'envoie que l'instruction de la nouvelle phase
    // (supprime la re-injection ×N). Dégrade proprement : pas de sessionId → resumeSessionId undefined
    // → on retombe sur la re-injection complète (comportement actuel). Le sandbox est constant sur un
    // run (isMutationTask(task) fixe) → jamais de resume à travers un changement de sandbox.
    let prevSessionId: string | undefined
    // Réinjecte l'acquis d'un run repris pour que la phase suivante l'ait dans son contexte.
    for (const output of usableResume) {
      const carried =
        output.text.length > PHASE_CONTEXT_CAP
          ? `${output.text.slice(0, PHASE_CONTEXT_CAP)}
…[tronqué — voir le fil des sous-agents]`
          : output.text
      phaseContext.push(`[phase ${output.phase}] ${carried}`)
      lastExecText = output.text
    }
    for (const phase of suitePhases()) {
      // SURVIE NIVEAU 3 : phase déjà terminée avant l'interruption → on ne la refait pas. Compté par
      // occurrence : une visite ULTÉRIEURE du même nœud, via une arête de retour, doit bien s'exécuter.
      if (dejaPayee(phase)) continue
      // DECOUPAGE DE TOUTE PHASE (et non du seul `build`). Mesure du 2026-07-28 sur conv-75 : une
      // phase d'exploration monolithique a coute 10,90 $ en 11 min, quand le meme travail decoupe en
      // 5 sous-taches ciblees revenait a ~0,8 $ et ~1 min chacune. Rien ne justifiait de reserver ce
      // levier au build : une phase longue est presque toujours plusieurs travaux qui s'ignorent.
      // Le garde-fou reste le decomposeur lui-meme : sans au moins 2 sous-taches, on retombe sur le
      // chemin sequentiel d'origine. Les droits ne changent pas (ils viennent de isMutationTask).
      if (phase === 'build' && greedyPlan && greedyPlan.length >= 2) {
        const greedy = await this.runGreedyBuildPhase(
          task,
          greedyPlan,
          workCwd,
          runId,
          phaseContext.join('\n\n'),
          true,
          phase,
          push,
          onPhase,
          onDelta,
          signal,
          bindingOverride,
          runtimeSnapshot
        )
        aggregatedEvidence.push(...greedy.evidence)
        lastExecText = greedy.aggregate
        recordPhase(phase, greedy.aggregate)
        const carried =
          greedy.aggregate.length > PHASE_CONTEXT_CAP
            ? `${greedy.aggregate.slice(0, PHASE_CONTEXT_CAP)}\n…[tronqué — voir le fil des sous-agents]`
            : greedy.aggregate
        phaseContext.push(`[phase ${phase}] ${carried}`)
        // Plusieurs phases peuvent réutiliser le même DAG. Une phase suivante réussie ne doit pas
        // effacer les échecs/skips déjà observés (sinon un Terrain rouge disparaît après Build).
        failedTasks = [...new Set([...(failedTasks ?? []), ...greedy.failed])]
        skippedTasks = [...new Set([...(skippedTasks ?? []), ...greedy.skipped])]
        prevSessionId = undefined
        continue
      }
      // Panel scout/frame/terrain : ≥1 modèle déposé dans le bloc topology → la phase s'exécute sur
      // CHAQUE membre. Avec un seul membre, sa sortie est réutilisée directement sans synthèse ;
      // avec plusieurs, l'orchestrateur synthétise. Aucun membre → binding subagent rétrocompatible.
      const fanMembers = bindingOverride ? [] : this.resolvePhaseFanOut(phase, runtimeSnapshot)
      if (fanMembers.length >= 1) {
        // Le fan-out casse la chaîne de session (N sessions //). Chaque membre part du contexte complet.
        const fanMessages = [{ role: 'user' as const, content: phaseContext.join('\n\n') }]
        const parts = [
          { name: 'constitution', text: CONSTITUTION },
          this.phasePrompt(phase, true),
          { name: 'discipline', text: PIPELINE_DISCIPLINE_INSTRUCTION },
          { name: 'style', text: CONCISE_STRUCTURED_RESPONSE_INSTRUCTION },
          { name: 'projectContext', text: projectContext },
          {
            name: 'workspaceIsolation',
            text: workspaceIsolationNotice(workCwd, this.deps.executionWorkspace)
          }
        ]
        const fanSystemBlocks = parts
          .filter((p) => p.text)
          .map((p) => ({ name: p.name, chars: p.text.length }))
        const fanSystem = parts.map((p) => p.text).join('')
        const sandbox = isMutationTask(task) ? 'danger-full-access' : 'read-only'
        const memberOutputs = await Promise.all(
          fanMembers.map(async (member, rang) => {
            // L'identité prend la persona quand il y en a une, sinon le modèle. Le rang n'est ajouté
            // QUE s'il lève une ambiguïté réelle : trois membres sur le même modèle portaient
            // jusqu'ici le MÊME agentId et se télescopaient dans le suivi comme dans l'UI ; deux
            // modèles distincts, eux, n'ont jamais eu besoin d'un suffixe.
            const signatureMembre = member.persona ?? member.model ?? member.provider
            const homonymes = fanMembers.filter(
              (autre) => (autre.persona ?? autre.model ?? autre.provider) === signatureMembre
            ).length
            const identite =
              homonymes > 1 ? `${phase}:${signatureMembre}:${rang + 1}` : `${phase}:${signatureMembre}`
            const execution = {
              phase,
              agentId: identite,
              taskId: identite,
              groupId: `${phase}:fanout`,
              dependencyIds: [] as string[],
              attemptId: randomUUID()
            }
            // La persona s'ajoute AU PROMPT de ce membre-là. Un prompt commun à tous rendrait le
            // fan-out inutile : N fois le même avis, pour N fois le prix.
            const personaBloc = personaInstruction(member.persona)
            const opts: SendOptions = {
              system: fanSystem + personaBloc,
              systemBlocks: personaBloc
                ? [...fanSystemBlocks, { name: 'persona', chars: personaBloc.length }]
                : fanSystemBlocks,
              model: member.model,
              reasoningEffort: member.reasoningEffort,
              execution: this.executionOptions(workCwd, sandbox, runId),
              signal
            }
            const startedAt = performance.now()
            onPhase?.({
              step: 'exec',
              provider: member.provider,
              role: 'subagent',
              model: member.model,
              reasoningEffort: member.reasoningEffort,
              phase,
              execution
            })
            try {
              const res = await registry.send(member.provider, fanMessages, opts, (c) =>
                onDelta?.('exec', c.delta)
              )
              if (res.usage) {
                cost.add({
                  provider: res.provider ?? member.provider,
                  role: 'subagent',
                  model: member.model,
                  inputTokens: res.usage.inputTokens,
                  outputTokens: res.usage.outputTokens,
                  cacheReadTokens: res.usage.cacheReadTokens,
                  costUsd: res.usage.costUsd
                })
              }
              push({
                step: 'exec',
                provider: res.provider ?? member.provider,
                role: 'subagent',
                model: res.model ?? member.model,
                text: res.text,
                thinking: res.thinking,
                tokens: res.usage ? res.usage.inputTokens + res.usage.outputTokens : undefined,
                costUsd: res.usage?.costUsd,
                usage: res.usage,
                status: 'completed',
                durationMs: performance.now() - startedAt,
                evidence: res.executionEvidence,
                artifacts: res.artifacts,
                detail: `phase ${phase} · modèle ${member.model ?? member.provider}`,
                execution
              })
              aggregatedEvidence.push(...(res.executionEvidence ?? []))
              return { member, text: res.text, ok: true as const, cause: undefined }
            } catch (error) {
              push({
                step: 'exec',
                provider: member.provider,
                role: 'subagent',
                model: member.model,
                text: '',
                status: 'failed',
                error: error instanceof Error ? error.message : String(error),
                durationMs: performance.now() - startedAt,
                detail: `phase ${phase} · modèle ${member.model ?? member.provider}`,
                execution
              })
              return {
                member,
                text: '',
                ok: false as const,
                // La cause est CONSERVEE : c'est elle qui manquait a l'utilisateur (2026-07-29).
                cause: error instanceof Error ? error.message : String(error)
              }
            }
          })
        )
        // SYNTHÈSE par l'orchestrateur (le rôle le + capable) : union dédupliquée, PAS de re-décision.
        // Un modèle en échec (ok=false / texte vide) ne pollue pas la synthèse (filtré).
        const good = memberOutputs.filter((o) => o.ok && o.text.trim())
        if (good.length === 0) {
          // Tous les modèles du fan-out ont échoué → échec de phase EXPLICITE (jamais une synthèse
          // fantôme sur du vide qui se propagerait comme un résultat valide). Aligne le comportement
          // sur le chemin mono-modèle (une exec en échec propage l'erreur).
          // Les causes etaient DEJA connues ici et etaient jetees en remontant : « aucun modele n'a
          // produit de sortie » ne disait pas que le role etait binde sur un provider non connecte.
          const causes = memberOutputs
            .filter((o) => !o.ok)
            .map((o) => ({
              provider: o.member.provider,
              ...(o.member.model ? { model: o.member.model } : {}),
              message: o.cause ?? 'échec sans message'
            }))
          const explained = describeFanoutFailure(phase, 'subagent', causes)
          push({
            step: 'exec',
            role: 'subagent',
            text: '',
            status: 'failed',
            error: explained,
            detail: `phase ${phase} : les ${fanMembers.length} modèles du fan-out ont échoué`,
            durationMs: 0
          })
          throw new Error(explained)
        }
        if (good.length === 1) {
          // Un seul survivant → rien à agréger : on réutilise sa sortie directement, sans appel de
          // synthèse (inutile + risque de reformulation d'un texte unique).
          const solo = good[0].text
          lastExecText = solo
          recordPhase(phase, solo)
          const carriedSolo =
            solo.length > PHASE_CONTEXT_CAP
              ? `${solo.slice(0, PHASE_CONTEXT_CAP)}\n…[tronqué — voir le fil des sous-agents]`
              : solo
          phaseContext.push(`[phase ${phase}] ${carriedSolo}`)
          prevSessionId = undefined
          continue
        }
        const orchBinding =
          bindingOverride ?? runtimeSnapshot?.roles.orchestrator ?? roles.getBinding('orchestrator')
        const labelled = good
          .map(
            (o, i) =>
              `### Proposition ${i + 1} (modèle ${o.member.model ?? o.member.provider})\n${o.text}`
          )
          .join('\n\n')
        const synthParts = [
          { name: 'constitution', text: CONSTITUTION },
          { name: 'style', text: CONCISE_STRUCTURED_RESPONSE_INSTRUCTION },
          { name: 'projectContext', text: projectContext }
        ]
        const synthOptions: SendOptions = {
          system: synthParts.map((p) => p.text).join(''),
          systemBlocks: synthParts
            .filter((p) => p.text)
            .map((p) => ({ name: p.name, chars: p.text.length })),
          model: orchBinding.model,
          reasoningEffort: orchBinding.reasoningEffort,
          execution: this.executionOptions(workCwd, 'read-only', runId),
          signal
        }
        const synthMessages = [
          {
            role: 'user' as const,
            content:
              `Phase « ${phase} » exécutée par ${good.length} modèle(s) indépendant(s). Fusionne leurs sorties en UNE seule : ` +
              `UNION DÉDUPLIQUÉE — conserve tous les angles/idées/questions distincts, supprime uniquement les redites. ` +
              `NE hiérarchise pas, NE tranche pas au-delà du regroupement (agréger ≠ re-décider).\n\n${labelled}`
          }
        ]
        const synthStartedAt = performance.now()
        const synthExecution = {
          phase,
          agentId: `${phase}:synthesis`,
          taskId: `${phase}:synthesis`,
          groupId: `${phase}:synthesis`,
          dependencyIds: good.map(({ member }) => `${phase}:${member.model ?? member.provider}`),
          attemptId: randomUUID()
        }
        onPhase?.({
          step: 'exec',
          provider: orchBinding.provider,
          role: 'orchestrator',
          model: orchBinding.model,
          reasoningEffort: orchBinding.reasoningEffort,
          phase,
          execution: synthExecution
        })
        const synth = await this.sendWithRoleContext(
          `synthèse ${phase}`,
          'orchestrator',
          orchBinding.provider,
          orchBinding.model,
          () =>
            registry.send(orchBinding.provider, synthMessages, synthOptions, (c) =>
              onDelta?.('exec', c.delta)
            )
        )
        if (synth.usage) {
          cost.add({
            provider: synth.provider ?? orchBinding.provider,
            role: 'orchestrator',
            model: orchBinding.model,
            inputTokens: synth.usage.inputTokens,
            outputTokens: synth.usage.outputTokens,
            cacheReadTokens: synth.usage.cacheReadTokens,
            costUsd: synth.usage.costUsd
          })
        }
        push({
          step: 'exec',
          provider: synth.provider ?? orchBinding.provider,
          role: 'orchestrator',
          model: synth.model ?? orchBinding.model,
          text: synth.text,
          tokens: synth.usage ? synth.usage.inputTokens + synth.usage.outputTokens : undefined,
          costUsd: synth.usage?.costUsd,
          usage: synth.usage,
          status: 'completed',
          durationMs: performance.now() - synthStartedAt,
          detail: `synthèse ${phase} (${good.length} modèles)`,
          execution: synthExecution
        })
        lastExecText = synth.text
        lastUsage = synth.usage
        recordPhase(phase, synth.text)
        const carried =
          synth.text.length > PHASE_CONTEXT_CAP
            ? `${synth.text.slice(0, PHASE_CONTEXT_CAP)}\n…[tronqué — voir le fil des sous-agents]`
            : synth.text
        phaseContext.push(`[phase ${phase}] ${carried}`)
        prevSessionId = undefined // fan-out : pas de session linéaire à chaîner
        continue
      }
      const resuming = Boolean(prevSessionId)
      // Le CADRAGE (phase frame) est le socle du prompt remis aux sous-agents : on le ré-injecte
      // TOUJOURS explicitement, même en resume. Se fier à l'historique de session (opaque, variable
      // par provider, cassé par un fan-out) faisait perdre le besoin cadré exactement au moment où
      // la phase suivante en a le plus besoin → prompt de sous-agent dégradé.
      const framed = phaseContext.find((entry) => entry.startsWith('[phase frame]')) ?? ''
      const userContent = resuming
        ? [
            `Phase suivante du pipeline : ${phase}. Continue À PARTIR de l'état de la session (tâche, connaissance Brain et acquis des phases précédentes déjà connus — ne les redemande pas). Applique la consigne de phase et enrichis le livrable existant.`,
            framed && `RAPPEL DU CADRAGE — c'est LA référence du livrable :\n${framed}`
          ]
            .filter(Boolean)
            .join('\n\n')
        : phaseContext.join('\n\n')
      const phaseMessages = [{ role: 'user' as const, content: userContent }]
      // F6 — le system est composé de blocs NOMMÉS : on garde leur décomposition (nom + taille)
      // pour l'observabilité, en plus de la chaîne concaténée réellement envoyée.
      // Consigne courte purpose-built (phase-briefs) : ~1-2k au lieu du SKILL.md brut. L'état
      // (besoin + acquis des phases) vit dans le message user ci-dessous, pas dans le system.
      // Modèle EFFECTIF de la phase : override par phase (petit modèle sur analyse, gros sur build)
      // → défaut = modèle du binding. Générique/rétrocompat (resolvePhaseBinding).
      const phaseBinding = resolvePhaseBinding(subBinding, phase)
      // Anti-perte-de-contexte / longs runs : en session-resume, la discipline (~1-2k) et le
      // projectContext (≤32k) sont DÉJÀ connus de la session (envoyés en phase 1) → les ré-envoyer
      // à chaque phase gonfle le contexte pour rien ("ENGINE injectée N fois", "1M3 tokens"). On ne
      // renvoie que la consigne de phase (qui CHANGE) + le style. Fallback (pas de resume) = complet.
      const parts = resuming
        ? [
            this.phasePrompt(phase, false),
            { name: 'style', text: CONCISE_STRUCTURED_RESPONSE_INSTRUCTION }
          ]
        : [
            { name: 'constitution', text: CONSTITUTION },
            this.phasePrompt(phase, true),
            { name: 'discipline', text: PIPELINE_DISCIPLINE_INSTRUCTION },
            { name: 'style', text: CONCISE_STRUCTURED_RESPONSE_INSTRUCTION },
            { name: 'projectContext', text: projectContext }
          ]
      const systemBlocks = parts
        .filter((p) => p.text)
        .map((p) => ({ name: p.name, chars: p.text.length }))
      const subOptions: SendOptions = {
        system: parts.map((p) => p.text).join(''),
        systemBlocks,
        model: phaseBinding.model,
        reasoningEffort: phaseBinding.reasoningEffort,
        resumeSessionId: prevSessionId,
        execution: this.executionOptions(
          workCwd,
          // B3 — une tâche NON-mutation (cadrage/analyse) n'a aucune raison d'écrire : sandbox
          // read-only → pas d'effet de bord (ex. RUN.md fantôme dans Audit/). Mutation → full access.
          isMutationTask(task) ? 'danger-full-access' : 'read-only',
          runId
        ),
        signal,
        observePrompt: (observed) => {
          observed.systemBlocks = systemBlocks
          execPrompt = observed
        }
      }
      execPrompt = registry.describePrompt(
        subProvider,
        phaseMessages,
        subOptions,
        phaseBinding.model
      )
      execPrompt.systemBlocks = systemBlocks
      const execution = {
        phase,
        agentId: `${phase}:subagent`,
        taskId: `${phase}:exec`,
        groupId: `${phase}:sequential`,
        dependencyIds: [] as string[],
        attemptId: randomUUID()
      }
      onPhase?.({
        step: 'exec',
        provider: subProvider,
        role: 'subagent',
        model: phaseBinding.model,
        reasoningEffort: phaseBinding.reasoningEffort,
        phase,
        execution
      })
      const phaseStartedAt = performance.now()
      let phaseRes
      try {
        phaseRes = await registry.send(subProvider, phaseMessages, subOptions, (c) =>
          onDelta?.('exec', c.delta)
        )
      } catch (error) {
        // L'erreur brute dit la cause mais pas QUEL role l'a subie ni son binding : on prefixe.
        const explained = explainRoleFailure(`Phase ${phase}`, 'subagent', {
          provider: subProvider,
          ...(subOptions.model ? { model: subOptions.model } : {}),
          message: error instanceof Error ? error.message : String(error)
        })
        push({
          step: 'exec',
          provider: subProvider,
          role: 'subagent',
          text: '',
          prompt: execPrompt,
          status: 'failed',
          error: explained,
          durationMs: performance.now() - phaseStartedAt,
          execution
        })
        throw new Error(explained)
      }
      // Chaîne la session pour la phase suivante (fallback : garde l'ancien id si le provider n'en
      // rend pas de nouveau — un resume claude conserve le même id et y APPEND les tours).
      //
      // RESUME FANTÔME : on ne chaîne que si l'adaptateur REPREND vraiment. `codex` rend un
      // `thread_id` sans savoir le reprendre ; le chaîner faisait basculer la phase suivante dans la
      // branche `resuming`, qui remplace tout `phaseContext` par « acquis déjà connus — ne les
      // redemande pas ». L'acquis des phases était donc perdu au moment précis où la phase suivante
      // en dépend. Sans capacité prouvée : pas de session, donc ré-injection complète.
      prevSessionId = registry.honoursSessionResume(subProvider)
        ? (phaseRes.sessionId ?? prevSessionId)
        : undefined
      if (phaseRes.usage) {
        cost.add({
          // Provider RÉEL ayant répondu (le registre peut rerouter une exécution vers un executor
          // local) — pas le demandé, sinon trace/coût mentent sur qui a vraiment tourné.
          provider: phaseRes.provider ?? subProvider,
          role: 'subagent',
          inputTokens: phaseRes.usage.inputTokens,
          outputTokens: phaseRes.usage.outputTokens,
          cacheReadTokens: phaseRes.usage.cacheReadTokens,
          costUsd: phaseRes.usage.costUsd
        })
      }
      push({
        step: 'exec',
        provider: phaseRes.provider ?? subProvider,
        role: 'subagent',
        model: phaseRes.model ?? phaseBinding.model,
        text: phaseRes.text,
        thinking: phaseRes.thinking,
        tokens: phaseRes.usage
          ? phaseRes.usage.inputTokens + phaseRes.usage.outputTokens
          : undefined,
        costUsd: phaseRes.usage?.costUsd,
        usage: phaseRes.usage,
        prompt: execPrompt,
        status: 'completed',
        durationMs: performance.now() - phaseStartedAt,
        evidence: phaseRes.executionEvidence,
        artifacts: phaseRes.artifacts,
        detail: execPhases.length > 1 ? `phase ${phase}` : undefined,
        execution
      })
      aggregatedEvidence.push(...(phaseRes.executionEvidence ?? []))
      lastExecText = phaseRes.text
      lastUsage = phaseRes.usage
      recordPhase(phase, phaseRes.text)
      // B4 — le contexte PORTÉ à la phase suivante est borné (la sortie complète reste dans
      // phaseOutputs + la trace) : évite une croissance quadratique du prompt sur les chaînes longues.
      const carried =
        phaseRes.text.length > PHASE_CONTEXT_CAP
          ? `${phaseRes.text.slice(0, PHASE_CONTEXT_CAP)}\n…[tronqué — voir le fil des sous-agents]`
          : phaseRes.text
      phaseContext.push(`[phase ${phase}] ${carried}`)
    }
    // J1 — le juge (et le résultat) reçoivent l'AGRÉGAT de toutes les phases, jamais la seule
    // dernière : sinon un livrable produit en frame/terrain devient invisible si clean dérive.
    // Recalculable : une phase de réparation (B5) ajoute à phaseOutputs, l'agrégat suit.
    const buildExec = (): {
      text: string
      usage: Usage | undefined
      executionEvidence: ExecutionEvidence[]
    } => ({
      text:
        phaseOutputs.length > 1
          ? phaseOutputs
              .map((p) => {
                // #3 — chaque bloc de phase est borné avant agrégation pour le juge (l'agrégat
                // n'est plus la concaténation des sorties COMPLÈTES). Sortie intégrale = phaseOutputs.
                const body =
                  p.text.length > JUDGE_PHASE_CAP
                    ? `${p.text.slice(0, JUDGE_PHASE_CAP)}\n…[tronqué — voir le fil des sous-agents]`
                    : p.text
                return `[phase ${p.phase}]\n${body}`
              })
              .join('\n\n')
          : lastExecText,
      usage: lastUsage,
      executionEvidence: aggregatedEvidence
    })
    let exec = buildExec()
    let lastJudgeText = ''

    // 2. Un JUGE (autre rôle → potentiellement autre modèle) évalue le résultat.
    const judgeBinding =
      bindingOverride ?? runtimeSnapshot?.roles.judge ?? roles.getBinding('judge')
    const judgeProvider = judgeBinding.provider

    // Une passe JUGE (autre rôle → décorrélation) + GATE déterministe sur l'état COURANT de `exec`.
    // Rejouable : après une phase de réparation, l'agrégat `exec` change et on re-juge.
    const judgeAndGate = async (): Promise<{
      valid: boolean
      gate: ReturnType<typeof evaluateClosure>
    }> => {
      // Les contrôles locaux falsifiables passent AVANT le juge payant. Un livrable sans preuve ou
      // bloqué par pre-green part directement en réparation : le juge ne peut rien apprendre qu'un
      // oracle local vient déjà de réfuter.
      const evidenceOk = evidenceSatisfiesTask(task, exec.executionEvidence)
      const hookOutcome = await this.hooks.run('pre-green', {
        task,
        cwd: workCwd,
        verifyCmd: this.resolveVerifyCmd(workCwd),
        requireProof: isMutationTask(task),
        evidenceOkCount: (exec.executionEvidence ?? []).filter((e) => e.ok).length,
        evidence: exec.executionEvidence
      })
      const preGate = evaluateClosure({
        status: evidenceOk && !hookOutcome.blocked ? 'green' : 'red',
        dod: [{ checked: evidenceOk, hasContent: true }]
      })
      if (hookOutcome.blocked) preGate.reasons.push(...hookOutcome.reasons)
      if (preGate.blocked) {
        onPhase?.({ step: 'gate' })
        push({
          step: 'gate',
          role: 'gate',
          detail: `PRÉ-GATE BLOQUÉ: ${preGate.reasons.join('; ')}`
        })
        return { valid: false, gate: preGate }
      }

      // fix-ok: cause PROUVÉE en live (verdict conv-30 : « le livrable requis est un RUN.md
      // physique ») — A2 a chargé le SKILL judge du kit qui exige un RUN.md/fingerprint absent
      // in-app ; on neutralise ce couplage côté juge, comme J4/B2 côté exec.
      const judgePrompt =
        `Tu es un juge outillé en lecture seule. Inspecte réellement le workspace et confronte au moins une preuve d'outil ci-dessous. ` +
        `Une affirmation sans preuve d'exécution observable est un défaut.\n` +
        `IMPORTANT (in-app Autowin OS) : le livrable est le TEXTE agrégé ci-dessous, PAS un fichier ` +
        `RUN.md sur disque (Autowin le gère). N'exige jamais de RUN.md physique, d'empreinte SHA-256 ` +
        `ni de chemin kit ; juge la SUBSTANCE du livrable et les preuves d'outil réellement observées.\n` +
        `TÂCHE: ${task}\nRÉPONSE (livrable agrégé de TOUTES les phases) : ${exec.text}\n` +
        `PREUVES OUTILS OBSERVÉES: ${JSON.stringify(exec.executionEvidence ?? [])}\n` +
        `Réponds STRICTEMENT par "VALIDE" ou "DEFAUT: <raison courte>".`
      const judgeMessages = [{ role: 'user' as const, content: judgePrompt }]
      let judgeEnvelope
      // A2 — le juge charge le SKILL.md judge du kit ; F6 — blocs nommés pour l'observabilité.
      const judgeParts = [
        this.phasePrompt('judge', true),
        { name: 'style', text: CONCISE_STRUCTURED_RESPONSE_INSTRUCTION },
        { name: 'projectContext', text: projectContext }
      ]
      const judgeBlocks = judgeParts
        .filter((p) => p.text)
        .map((p) => ({ name: p.name, chars: p.text.length }))
      const judgeOptions: SendOptions = {
        system: judgeParts.map((p) => p.text).join(''),
        systemBlocks: judgeBlocks,
        model: judgeBinding.model,
        reasoningEffort: judgeBinding.reasoningEffort,
        execution: this.executionOptions(workCwd, 'read-only', runId),
        signal,
        observePrompt: (observed) => {
          observed.systemBlocks = judgeBlocks
          judgeEnvelope = observed
        }
      }
      judgeEnvelope = registry.describePrompt(
        judgeProvider,
        judgeMessages,
        judgeOptions,
        judgeBinding.model
      )
      judgeEnvelope.systemBlocks = judgeBlocks
      const judgeMembers = bindingOverride ? [] : this.resolveJudgeFanOut(runtimeSnapshot)
      const singleJudgeExecution = {
        phase: 'judge' as const,
        agentId: 'judge:single',
        taskId: 'judge:single',
        groupId: 'judge:single',
        dependencyIds: [] as string[],
        attemptId: randomUUID()
      }
      if (judgeMembers.length < 2) {
        onPhase?.({
          step: 'judge',
          provider: judgeProvider,
          role: 'judge',
          model: judgeBinding.model,
          reasoningEffort: judgeBinding.reasoningEffort,
          execution: singleJudgeExecution
        })
      }
      const judgeStartedAt = performance.now()
      let verdict
      // FAN-OUT JUGE : ≥2 modèles dans le bloc topology judge → N juges en parallèle puis QUORUM
      // de vote MÉCANIQUE (compter les VALIDE ; majorité = pass). Agréger ≠ re-décider : aucun juge
      // supplémentaire ne tranche, on compte les voix. <2 ou absent → un seul juge (rétrocompat).
      if (judgeMembers.length >= 2) {
        const results = await Promise.all(
          judgeMembers.map(async (member) => {
            const execution = {
              phase: 'judge' as const,
              agentId: `judge:${member.model ?? member.provider}`,
              taskId: `judge:${member.model ?? member.provider}`,
              groupId: 'judge:fanout',
              dependencyIds: [] as string[],
              attemptId: randomUUID()
            }
            const opts: SendOptions = {
              ...judgeOptions,
              model: member.model,
              reasoningEffort: member.reasoningEffort
            }
            const startedAt = performance.now()
            onPhase?.({
              step: 'judge',
              provider: member.provider,
              role: 'judge',
              model: member.model,
              reasoningEffort: member.reasoningEffort,
              execution
            })
            try {
              const r = await this.sendWithRoleContext(
                'jugement (panel)',
                'judge',
                member.provider,
                member.model,
                () =>
                  registry.send(member.provider, judgeMessages, opts, (c) =>
                    onDelta?.('judge', c.delta)
                  )
              )
              if (r.usage) {
                cost.add({
                  provider: r.provider ?? member.provider,
                  role: 'judge',
                  model: member.model,
                  inputTokens: r.usage.inputTokens,
                  outputTokens: r.usage.outputTokens,
                  cacheReadTokens: r.usage.cacheReadTokens,
                  costUsd: r.usage.costUsd
                })
              }
              const votesValide = /^\s*valide/i.test(r.text)
              push({
                step: 'judge',
                provider: r.provider ?? member.provider,
                role: 'judge',
                model: r.model ?? member.model,
                text: r.text.trim(),
                tokens: r.usage ? r.usage.inputTokens + r.usage.outputTokens : undefined,
                costUsd: r.usage?.costUsd,
                usage: r.usage,
                detail: votesValide ? 'vote: VALIDE' : 'vote: DEFAUT',
                status: 'completed',
                durationMs: performance.now() - startedAt,
                execution
              })
              return { ok: votesValide, responded: true, text: r.text.trim() }
            } catch (error) {
              push({
                step: 'judge',
                provider: member.provider,
                role: 'judge',
                model: member.model,
                text: '',
                status: 'failed',
                error: error instanceof Error ? error.message : String(error),
                durationMs: performance.now() - startedAt,
                execution
              })
              // Crashé : ne vote PAS et ne compte pas dans le dénominateur du quorum.
              return { ok: false, responded: false, text: '' }
            }
          })
        )
        // Quorum sur les juges ayant RÉELLEMENT répondu (un juge crashé ne gonfle pas le dénominateur
        // → sinon 2 crashes sur 3 feraient échouer un verdict que 100 % des répondants valident).
        const responders = results.filter((r) => r.responded)
        const votingN = responders.length
        const valideVotes = responders.filter((r) => r.ok).length
        // Le quorum composé prime, mais borné au nombre de votants RÉELS : un modèle crashé ne vote
        // pas, et exiger 3 voix parmi 2 répondants rendrait le vert inatteignable sans le dire.
        const graphQuorum = this.deps.currentWorkflow?.()?.graph
          ? quorumForPhase(this.deps.currentWorkflow()!.graph!, 'judge')
          : undefined
        const threshold = graphQuorum
          ? Math.min(Math.max(1, graphQuorum), votingN)
          : defaultQuorumThreshold(votingN)
        const passes = votingN > 0 && valideVotes >= threshold
        const reasons = responders.filter((r) => !r.ok && r.text).map((r) => r.text)
        // Verdict AGRÉGÉ synthétique consommé par le gate ci-dessous. usage=undefined → le coût,
        // déjà ajouté par juge ci-dessus, n'est pas re-compté.
        verdict = {
          text: passes
            ? 'VALIDE'
            : votingN === 0
              ? 'DEFAUT: aucun juge n’a répondu (tous en échec)'
              : `DEFAUT: quorum non atteint (${valideVotes}/${votingN} VALIDE, seuil ${threshold})${reasons.length ? ` — ${reasons.join(' | ')}` : ''}`,
          provider: undefined,
          systemInjected: true,
          usage: undefined
        }
      } else {
        try {
          verdict = await this.sendWithRoleContext(
            'verdict',
            'judge',
            judgeProvider,
            judgeOptions.model,
            () =>
              registry.send(judgeProvider, judgeMessages, judgeOptions, (c) =>
                onDelta?.('judge', c.delta)
              )
          )
        } catch (error) {
          push({
            step: 'judge',
            provider: judgeProvider,
            role: 'judge',
            model: judgeBinding.model,
            text: '',
            prompt: judgeEnvelope,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
            durationMs: performance.now() - judgeStartedAt,
            execution: singleJudgeExecution
          })
          throw error
        }
        if (verdict.usage) {
          cost.add({
            provider: verdict.provider ?? judgeProvider,
            role: 'judge',
            inputTokens: verdict.usage.inputTokens,
            outputTokens: verdict.usage.outputTokens,
            cacheReadTokens: verdict.usage.cacheReadTokens,
            costUsd: verdict.usage.costUsd
          })
        }
      }
      const ok = evidenceOk && /^\s*valide/i.test(verdict.text)
      lastJudgeText = verdict.text.trim()
      trust.record({ judgeModel: judgeProvider, verdict: ok ? 'green' : 'red' })
      push({
        step: 'judge',
        provider: judgeMembers.length >= 2 ? undefined : (verdict.provider ?? judgeProvider),
        role: judgeMembers.length >= 2 ? 'orchestrator' : 'judge',
        model: judgeMembers.length >= 2 ? undefined : (verdict.model ?? judgeBinding.model),
        text: verdict.text.trim(),
        tokens: verdict.usage ? verdict.usage.inputTokens + verdict.usage.outputTokens : undefined,
        costUsd: verdict.usage?.costUsd,
        usage: verdict.usage,
        detail: ok ? 'validé' : 'défaut',
        prompt: judgeMembers.length >= 2 ? undefined : judgeEnvelope,
        status: 'completed',
        durationMs: performance.now() - judgeStartedAt,
        execution:
          judgeMembers.length >= 2
            ? {
                phase: 'judge',
                agentId: 'judge:quorum',
                taskId: 'judge:quorum',
                groupId: 'judge:quorum',
                dependencyIds: judgeMembers.map(
                  (member) => `judge:${member.model ?? member.provider}`
                )
              }
            : singleJudgeExecution
      })

      // Gate final après verdict : le juge reste nécessaire, mais seulement sur un candidat ayant
      // déjà franchi le pré-gate local. Le juge est read-only, le signal local n'a donc pas changé.
      onPhase?.({ step: 'gate' })
      const g = evaluateClosure({
        status: ok ? 'green' : 'red',
        dod: [{ checked: ok, hasContent: true }]
      })
      push({
        step: 'gate',
        role: 'gate',
        detail: g.blocked ? `BLOQUÉ: ${g.reasons.join('; ')}` : 'clôture autorisée'
      })
      return { valid: ok, gate: g }
    }

    // B5 — pour une MUTATION bloquée, UNE réparation ciblée (feedback = raisons du gate) AVANT
    // d'escalader à l'humain (résolveur avant interruption). Bornée à 1, jamais de boucle infinie.
    // Un graphe qui dessine « juge rouge → build, au plus N fois » PILOTE ce nombre : c'est la même
    // boucle, nommée à l'écran au lieu d'être déduite du régime.
    const graphRecoveries = this.deps.currentWorkflow?.()?.graph
      ? recoveriesFromGraph(this.deps.currentWorkflow()!.graph!)
      : undefined
    const allowedRecoveries = isMutationTask(task)
      ? (graphRecoveries ?? this.deps.currentExecutionQuote?.()?.limits.maxRecoveries ?? 1)
      : 0
    const MAX_ATTEMPTS = 1 + Math.max(0, Math.floor(allowedRecoveries))
    let valid = false
    let gate!: ReturnType<typeof evaluateClosure>
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        // Phase de réparation = un BUILD supplémentaire nourri du feedback du gate.
        const repairMessages = [
          {
            role: 'user' as const,
            content: [
              ...phaseContext,
              `[RÉPARATION] Le gate a bloqué : ${gate.reasons.join('; ')}. Corrige le livrable et fournis une PREUVE d'outil (test rouge→vert / exit-code).`
            ].join('\n\n')
          }
        ]
        let repairPrompt
        const repairOptions: SendOptions = {
          system:
            this.phasePrompt('build', true).text +
            PIPELINE_DISCIPLINE_INSTRUCTION +
            CONCISE_STRUCTURED_RESPONSE_INSTRUCTION +
            projectContext,
          model: subBinding.model,
          reasoningEffort: subBinding.reasoningEffort,
          execution: this.executionOptions(workCwd, 'danger-full-access', runId),
          signal,
          observePrompt: (observed) => {
            repairPrompt = observed
          }
        }
        repairPrompt = registry.describePrompt(
          subProvider,
          repairMessages,
          repairOptions,
          subBinding.model
        )
        const repairExecution = {
          phase: 'build' as const,
          agentId: 'build:repair',
          taskId: 'build:repair',
          groupId: 'build:repair',
          dependencyIds: [] as string[],
          attemptId: randomUUID()
        }
        onPhase?.({
          step: 'exec',
          provider: subProvider,
          role: 'subagent',
          model: subBinding.model,
          reasoningEffort: subBinding.reasoningEffort,
          phase: 'build',
          execution: repairExecution
        })
        const repairStartedAt = performance.now()
        const repairRes = await this.sendWithRoleContext(
          'réparation',
          'subagent',
          subProvider,
          repairOptions.model,
          () =>
            registry.send(subProvider, repairMessages, repairOptions, (c) =>
              onDelta?.('exec', c.delta)
            )
        )
        if (repairRes.usage) {
          cost.add({
            provider: subProvider,
            role: 'subagent',
            inputTokens: repairRes.usage.inputTokens,
            outputTokens: repairRes.usage.outputTokens,
            cacheReadTokens: repairRes.usage.cacheReadTokens,
            costUsd: repairRes.usage.costUsd
          })
        }
        push({
          step: 'exec',
          provider: repairRes.provider ?? subProvider,
          role: 'subagent',
          model: repairRes.model ?? subBinding.model,
          text: repairRes.text,
          tokens: repairRes.usage
            ? repairRes.usage.inputTokens + repairRes.usage.outputTokens
            : undefined,
          costUsd: repairRes.usage?.costUsd,
          usage: repairRes.usage,
          prompt: repairPrompt,
          status: 'completed',
          durationMs: performance.now() - repairStartedAt,
          evidence: repairRes.executionEvidence,
          artifacts: repairRes.artifacts,
          detail: 'phase build (réparation)',
          execution: repairExecution
        })
        aggregatedEvidence.push(...(repairRes.executionEvidence ?? []))
        lastExecText = repairRes.text
        lastUsage = repairRes.usage
        phaseOutputs.push({ phase: 'build', text: repairRes.text })
        exec = buildExec()
      }
      const r = await judgeAndGate()
      valid = r.valid
      gate = r.gate
      if (!gate.blocked) break
    }

    return {
      task,
      result: phaseOutputs.length > 0 ? exec.text : lastJudgeText,
      valid,
      gateBlocked: gate.blocked,
      gateReasons: gate.reasons,
      phaseOutputs,
      brainQuery,
      brainRetrievedAt,
      brainNavigation: scopedBrain.navigation,
      brainInjectedChars: brainContext.length,
      costUsd: costOfTrace(trace),
      quote: this.deps.currentExecutionQuote?.(),
      trace,
      failedTasks,
      skippedTasks
    }
  }
}
