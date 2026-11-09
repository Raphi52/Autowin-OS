// Contrats, verdicts, types et utilitaires de l'orchestrateur, sortis tels quels de
// orchestrator.ts pour alléger ce fichier ; orchestrator.ts les ré-exporte.
import { resolve } from 'node:path'
import type { ProviderRegistry } from '../providers/registry'
import { horsCitations, leconRefuseeParLeJuge } from '../juge/objections-juge'
import type { Role, RoleBinding, RoleModelConfig, ReasoningEffort } from '../profil/roles'
import { type CostAggregator } from '../dashboards/cost'
import type { TrustLedger } from '../trust/ledger'
import { HookBus } from '../hooks/hook-bus'
import {
  porteeDeLecon,
  createIndependentLearningAttestation,
  learningProposalAttestation,
  parseAttestedLearningProposal,
  type IndependentLearningAttestation
} from '../brain/outcome-learning-proposal'
import {
  PIPELINE_PHASES,
  type PipelinePhase,
  type NodePhase
} from '../skills/skill-pipeline'
import { isMutationTask } from './task-mutation-classifier'
import { type PhaseInstructionOverride } from '../workflow/workflow-instruction'
import {
  worstCaseVisits,
  type WorkflowGraph
} from '../workflow/workflow-graph'
import {
  type SujetDejaFait
} from '../scout/scout-plafond'
import { type FacteursChoix } from '../scout/scout-memoire'
import {
  type NodeVerdict
} from '../workflow/workflow-walk'
import type { DecompositionOutcome } from './greedy-decompose'
import { type SousTachePlan } from '../runs/plan-en-vagues'
import { retrieveBrainContext, type BrainNavigation } from '../brain/brain-retrieval'
import { PREFIXE_NOTE_PERSO } from '../brain/brain-perso'
import type { BrainTrace } from '../activity/brain-trace-spool'
import type { DemandeFermeture } from '../bureau/hdesk-tv'
import type {
  ExecutionEvidence,
  PromptEnvelope,
  SendOptions,
  Usage
} from '../providers/types'
import type { WatchdogMutationClaims } from '../task-manager/types'
import { isShellMutation, isStateOracle } from '../providers/evidence-vocabulary'
import { estMurDeQuota } from '../../shared/reprise-quota'
import type { AutoCloseResult } from '../runs/run-autoclose'
import type { ChatArtifact } from '../../shared/artifacts'
import type { WorktreeAgentActivity } from '../../shared/worktree-activity-model'
import { type ExecutionQuote } from './execution-quote'
import type { ExecutionUsageSnapshot } from './execution-supervisor'
import {
  type LanceurCommandeSkill
} from '../skills/skill-node-tools'

/**
 * Le juge doit juger contre le contrat que le PRODUCTEUR a reçu.
 *
 * Mesuré sur la campagne du 2026-08-12 : quatre scouts sur quatre (Knowledge, Task Manager,
 * Tickets, Settings) rejetés pour la MÊME raison, purement cosmétique — « score /100 interdit
 * par /scout, colonne # absente et bandes 🟢/🟡/🔴 non utilisées ». Aucun défaut de fond n'était
 * reproché. Texte contre texte : `phase-briefs.ts` impose au producteur des colonnes
 * `Score | Type | What | Why | How` avec « une note agrégée /100 », tandis que le SKILL.md `scout`
 * du kit externe (l. 66) INTERDIT le /100 et exige une colonne `#` et des bandes. Le juge charge
 * le kit et sanctionne un livrable pour n'avoir pas suivi un contrat qui n'est pas le sien — or
 * le format /100 est précisément celui voulu dans Autowin.
 *
 * Même classe de couplage que celui déjà neutralisé pour le RUN.md physique et l'empreinte SHA-256.
 * On neutralise le FORMAT, jamais le fond : la substance et les preuves restent exigées.
 */
/**
 * Ce que le PRODUCTEUR pouvait réellement faire — le juge l'ignorait.
 *
 * Mesuré le 2026-08-12 : deux builds sur quatre ont été rejetés pour une preuve hors de portée —
 * « aucune preuve UI live sur un binaire packagé frais », « la capture/CDP de
 * l'application réelle est affirmée sans preuve d'exécution ». Asymétrie structurelle :
 * le producteur reçoit `PIPELINE_DISCIPLINE_INSTRUCTION` qui énumère son outillage, le juge ne
 * reçoit que sa consigne de phase, le style et le contexte projet.
 *
 * On ne baisse pas l'exigence : `scripts/ui-capture.mjs` met désormais la preuve UI à portée du
 * producteur. Le juge doit donc savoir qu'elle existe, à quoi elle ressemble, et ce qu'il peut
 * légitimement réclamer — ni plus, ni moins.
 */
export const JUDGE_TOOLSET_CONTRACT =
  // 2026-11-05 : disait Bash/Edit/Write « en phase de mutation » seulement et « pas
  // d'accès web », contre `sandboxForPhase` et les outils web chargés par providers/claude.ts.
  `OUTILLAGE DU PRODUCTEUR : in-app, chaque phase dispose de Read/Grep/Glob/Bash et d'Edit/Write ` +
  `bornés au dossier de travail (seule une sous-tâche parallèle d'un build qui ne modifie rien est ` +
  `privée d'Edit/Write), et du web (WebFetch/WebSearch) ; seules BUILD et CLEAN modifient des ` +
  `fichiers. Pas de sous-agents. Pour une ` +
  `preuve UI il dispose de \`node scripts/ui-capture.mjs --view <vue> --out <png>\`, qui, par défaut, ` +
  `ouvre une instance CACHÉE (écran de l'utilisateur intact), navigue par le vrai bouton, refuse une vue vide ou erronée, et rend un JSON + un exit-code. ` +
  `Une capture citée avec son exit-code 0 et son chemin EST une preuve recevable. ` +
  // D'OU VIENT L'INTERFACE (2026-09-26) : une capture verte de l'application empaquetee
  // ne contient pas une modification non empaquetee ; le juge doit savoir la lire.
  `Son JSON dit d'où vient l'interface capturée (\`interfaceCapturee\`) : \`application-empaquetee\` = ` +
  `dernier empaquetage, qui ne contient PAS une modification d'interface non empaquetée (hors ` +
  `styles injectés par \`--css\`, signalés par \`cssInjecte\`) ; avec l'option \`--code-dev\`, ` +
  `\`code-dev\` = code en cours servi par le serveur de dev du dépôt principal, et \`code-construit\` = ` +
  `copie de travail du producteur reconstruite puis lancée sur ses propres fichiers. Une capture ne ` +
  `prouve donc un changement d'interface que si ce changement y est VISIBLE. ` +
  `Ne réclame aucun mécanisme absent de cet outillage — binaire packagé, relais planifié, outil ` +
  `tiers : leur absence n'est jamais un défaut du livrable. En revanche exige ce qui EST à portée ` +
  `— exit-code de test, lecture ciblée, capture par ce harnais — et une affirmation invérifiable ` +
  `ou sans preuve reste un défaut.
`

export const JUDGE_FORMAT_CONTRACT =
  `CONTRAT DE FORMAT : le format attendu est celui de l'application, pas celui d'un SKILL.md ` +
  `externe. Un tableau \`Score | Type | What | Why | How\` avec un Score agrégé /100 est CONFORME. ` +
  `Ne sanctionne jamais l'absence d'une colonne « # », l'absence de bandes 🟢/🟡/🔴, ni la présence ` +
  `d'un /100 : ce ne sont pas des défauts ici. Juge le FOND.\n`
export {
  classifyMutationConfidence,
  isMutationTask,
  type MutationConfidence
} from './task-mutation-classifier'

/**
 * Ce qui fait d'une sortie de phase un ROUGE. Marqueur en TÊTE uniquement : un compte rendu qui
 * mentionne « défaut » au milieu d'un paragraphe raconte son travail, il ne se prononce pas.
 */
export const REJET_EN_TETE = /^\s*(REJET|REJETE|REJETÉ|INVALIDE|DEFAUT|DÉFAUT|ROUGE|KO)\b/i
/**
 * Le binding d'une phase quand AUCUN agent n'est composé sur son nœud — le cas par défaut.
 *
 * Une phase `judge` répond au rôle `judge` ; toutes les autres au rôle `subagent`. Avant ce
 * branchement, le repli était `subagent` pour TOUT LE MONDE : le rôle `judge` configuré n'était honoré
 * que si l'on avait pensé à déposer des agents sur le nœud. Un nœud judge par défaut faisait donc
 * évaluer le livrable par le modèle qui venait de le produire — pas une vérification, un auto-jugement.
 * (`resolvePhaseFanOut` honore déjà les agents COMPOSÉS : ce repli ne concerne que leur absence.)
 */
export function bindingDeRepliPourPhase(
  phase: NodePhase,
  roles: RoleModelConfig,
  runtimeSnapshot?: OrchestrationRuntimeSnapshot
): RoleBinding {
  return phase === 'judge'
    ? (runtimeSnapshot?.roles.judge ?? roles.getBinding('judge'))
    : (runtimeSnapshot?.roles.subagent ?? roles.getBinding('subagent'))
}

/**
 * L'instantané de rôles est OPPOSABLE tant que sa cible existe — pas au-delà.
 *
 * Pourquoi geler : un run qui traverse build→judge doit être jugé par la même famille de modèles qui
 * l'a produit, sinon le verdict n'est plus comparable ; et un run repris après une pause quota ne
 * doit pas changer de provider en silence. Ce gel est voulu, il n'est pas le défaut.
 *
 * Ce qui l'était : l'instantané survivait à la disparition de ce qu'il désignait. Vécu par
 * l'utilisateur — instantané sur `codex`, configuration reconfigurée en `claude`, et le run appelait
 * quand même codex avant d'échouer sur un provider qu'il n'utilise plus. Un run ne doit pas mourir
 * sur une configuration déjà corrigée.
 *
 * LIMITE ASSUMÉE : on vérifie que le provider est ENREGISTRÉ (`registry.ids()`), pas qu'il est
 * authentifié — cette dernière vérification est asynchrone et coûteuse ici. Un provider enregistré
 * mais déconnecté échouera donc encore, mais son message nomme désormais la divergence.
 */
/**
 * ASSAINIT l'instantané À L'ADMISSION : tout rôle pointant sur un provider non enregistré retombe sur
 * la configuration courante.
 *
 * Corriger phase par phase ne suffisait PAS, et c'est un test du vrai `run()` qui l'a montré — le
 * test de la fonction pure, lui, passait et donnait une fausse confiance. L'instantané est consommé
 * par PLUSIEURS chemins (fan-out de phase, fan-out de juge, phase séquentielle) ; le premier qui
 * atteignait le registre jetait `Provider inconnu: <x>` avant toute validation. Un seul point
 * d'entrée les couvre tous.
 */
export function instantaneAssaini(
  instantane: OrchestrationRuntimeSnapshot,
  rolesCourants: Record<Role, RoleBinding>,
  providersDisponibles: readonly string[]
): { instantane: OrchestrationRuntimeSnapshot; notes: string[] } {
  const notes: string[] = []
  const disponible = (binding: RoleBinding): boolean =>
    providersDisponibles.includes(binding.provider)
  const roles = { ...instantane.roles }
  for (const [role, binding] of Object.entries(instantane.roles) as [Role, RoleBinding][]) {
    if (disponible(binding)) continue
    roles[role] = rolesCourants[role]
    notes.push(
      `instantané abandonné pour ${role} : ${binding.provider} n'est plus disponible — ` +
        `repli sur la configuration courante (${rolesCourants[role].provider})`
    )
  }
  // Les fan-outs portent des bindings INDÉPENDANTS des rôles : un membre injoignable ferait tomber
  // tout le fan-out. On RETIRE le membre plutôt que de le remplacer — sa place n'a pas d'équivalent
  // dans la configuration courante, et un panel amputé vaut mieux qu'un panel qui jette.
  const filtrer = (membres: readonly RoleBinding[], ou: string): RoleBinding[] => {
    const gardes = membres.filter(disponible)
    if (gardes.length !== membres.length)
      notes.push(
        `${membres.length - gardes.length} membre(s) du fan-out ${ou} retiré(s) : provider absent du registre`
      )
    return gardes
  }
  const phaseFanOut = Object.fromEntries(
    Object.entries(instantane.phaseFanOut).map(([phase, membres]) => [
      phase,
      filtrer(membres ?? [], phase)
    ])
  )
  const judgeFanOut = filtrer(instantane.judgeFanOut, 'juge')
  // RIEN à assainir → on rend l'objet D'ORIGINE, pas une copie identique. Un contrat existant vérifie
  // que les points de reprise portent le MÊME instantané par identité
  // (`orchestrator.provider-identity.test.ts` : « execute tout le run avec le snapshot persiste ») —
  // reconstruire sans raison le cassait, et c'était une copie gratuite dans le cas courant.
  if (notes.length === 0) return { instantane, notes }
  return { instantane: { ...instantane, roles, phaseFanOut, judgeFanOut }, notes }
}

export function bindingDePhaseValide(
  instantane: RoleBinding | undefined,
  courant: RoleBinding,
  providersDisponibles: readonly string[]
): { binding: RoleBinding; note?: string } {
  if (!instantane) return { binding: courant }
  if (!providersDisponibles.includes(instantane.provider))
    return {
      binding: courant,
      note:
        `instantané abandonné : ${instantane.provider} n'est plus disponible — ` +
        `repli sur la configuration courante (${courant.provider})`
    }
  if (instantane.provider !== courant.provider || instantane.model !== courant.model)
    return {
      binding: instantane,
      note:
        `instantané du run : ${instantane.provider}${instantane.model ? ` (${instantane.model})` : ''} — ` +
        `configuration courante : ${courant.provider}${courant.model ? ` (${courant.model})` : ''}`
    }
  return { binding: instantane }
}

/**
 * La forme que le brief du juge IMPOSE pour un rejet : « DEFAUT: <raison> ». En MAJUSCULES, elle
 * compte où qu'elle se trouve ; en toute casse, seulement en tête de ligne (puce, gras ou
 * « Verdict : » admis devant).
 *
 * fix-ok: run-9930e4959cf4-1 (trace.json entrée 13) — le juge rend « VALIDE / SCORE: 92 »,
 * puces toutes OK, dont « Les tests repèrent un vrai défaut : avec l'aléa… ». L'ancien motif unique,
 * insensible à la casse et valable partout, prenait ce « défaut : » de prose (espace typographique
 * avant les deux-points) pour le rejet du contrat : verdict lu rouge, case muette « Promis mais pas
 * fait : 1 point(s) ». Test orchestrator.verdict-gate rouge avant, vert après.
 */
export const REJET_FORME_CONTRAT = /\b(REJET|REJETE|REJETÉ|INVALIDE|DEFAUT|DÉFAUT|KO)\s*:/
export const REJET_EN_TETE_DE_LIGNE =
  /^[\s>*•-]*(?:\d+[.)]\s*)?(?:verdict\s*:\s*)?\**\s*(REJET|REJETE|REJETÉ|INVALIDE|DEFAUT|DÉFAUT|KO)\b\**\s*:/im
/** L'approbation que le brief du juge IMPOSE : « Réponds STRICTEMENT par "VALIDE" ou "DEFAUT: …" ». */
export const APPROBATION_CONTRAT = /\bVALIDE\b/i

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
export function verdictDePhase(phase: NodePhase, text: string): NodeVerdict {
  if (phase !== 'judge') return 'green'
  const propre = (text ?? '').trim()
  if (!propre) return 'red'
  if (
    REJET_EN_TETE.test(propre) ||
    // fix-ok: un VALIDE 90 dont une puce OK citait le mot de refus entre accents graves était lu
    // rouge (orchestrator.verdict-gate.test.ts rouge 1/17 avant, vert après) : une citation n'est
    // pas un verdict (voir `horsCitations`).
    REJET_FORME_CONTRAT.test(horsCitations(propre)) ||
    REJET_EN_TETE_DE_LIGNE.test(propre)
  ) {
    return 'red'
  }
  // Ni rejet lisible, ni approbation contractuelle : un juge muet sur sa conclusion ne vaut pas un OK.
  return APPROBATION_CONTRAT.test(propre) ? 'green' : 'red'
}

/**
 * LE SEUL lecteur de verdict de juge. Exporté pour être testable, et surtout pour qu'il n'y en ait
 * qu'un.
 *
 * Il y en avait DEUX, en désaccord dans ce fichier : `verdictDePhase` ci-dessus (durci le 2026-08-05
 * après quatre cas dégénérés mesurés) accepte « VALIDE » PARTOUT dans la réponse, tandis que le
 * chemin greedy testait `/^\s*valide/i` — donc exigeait que le mot OUVRE la phrase. Conséquence
 * observée sur un run réel de l'utilisateur : un juge écrivant « Verdict : VALIDE »
 * voyait son APPROBATION jetée, le run passait `red`, et la vignette annonçait un échec sur un
 * livrable pourtant complet. Un faux négatif coûte ici un travail entier déclaré perdu.
 *
 * Le brief (`Réponds STRICTEMENT par "VALIDE" ou "DEFAUT: <raison courte>"`) n'impose PAS que le mot
 * ouvre la réponse : exiger le préfixe ajoutait une contrainte que le contrat ne demande pas.
 */
export function lireVerdictJuge(text: string): boolean {
  return verdictDePhase('judge', text) === 'green'
}

/**
 * Retire du parcours du marcheur le SEUL retour judge→build : il est joué en aval par la boucle de
 * réparation B5, qui renourrit le build des raisons du gate. Les AUTRES arêtes rouges restent :
 * elles portent le fail-closed d'un juge intermédiaire (rouge → chemin de repli, jamais l'arête
 * verte) — les retirer toutes faisait franchir l'arête verte à un juge muet ou en panne (mesuré :
 * 3 tests fail-closed rouges sur main au commit 2329a77).
 */
export function sansRetourReparationJuge(graph: WorkflowGraph): WorkflowGraph {
  return {
    ...graph,
    edges: graph.edges.filter((edge) => {
      if (edge.when !== 'red') return true
      const depuis = graph.nodes.find((node) => node.id === edge.from)?.phase
      const vers = graph.nodes.find((node) => node.id === edge.to)?.phase
      return !(depuis === 'judge' && vers === 'build')
    })
  }
}

/**
 * Phases situées entre le build ciblé par un retour rouge et le juge qui l'a déclenché.
 * Le build est exécuté par la réparation enrichie ; le juge par le gate final. Ce tableau est donc
 * exactement le milieu à rejouer (par exemple `clean` dans build → clean → judge).
 */
export function phasesApresBuildDeReparation(graph: WorkflowGraph): NodePhase[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  const retour = graph.edges.find((edge) => {
    if (edge.when !== 'red') return false
    return byId.get(edge.from)?.phase === 'judge' && byId.get(edge.to)?.phase === 'build'
  })
  if (!retour) return []
  const phases: NodePhase[] = []
  const vus = new Set<string>([retour.to])
  let courant = retour.to
  for (let pas = 0; pas < graph.nodes.length; pas++) {
    const suivantes = graph.edges.filter((edge) => edge.from === courant && edge.when === 'always')
    if (suivantes.length !== 1) return []
    courant = suivantes[0].to
    if (courant === retour.from) return phases
    if (vus.has(courant)) return []
    vus.add(courant)
    const node = byId.get(courant)
    if (!node || node.phase === 'judge') return []
    phases.push(node.phase)
  }
  return []
}

/** Phases jouées SEULEMENT après un juge qui valide (`noeudsApresJuge`) : elles ne changent pas le texte jugé. */
export const PHASES_APRES_VERDICT: ReadonlySet<string> = new Set(['learn', 'git'])

/**
 * Le dernier juge des étapes reprises a-t-il lu leur texte FINAL ? Oui seulement si aucune étape qui
 * change ce texte ne vient après lui.
 *
 * Un juge joué en direct n'entre jamais dans les étapes enregistrées ; seul y entre celui qui a fini
 * pendant un redémarrage (`settleCompletedDetachedPhase`, run-reattach.ts). Un verdict enregistré
 * peut donc se trouver au MILIEU des builds, sur un texte dépassé. Mesuré sur run-7b7d533c318e-1
 * (2026-10-30) : un refus à 84 entre deux builds, relu à chaque reprise comme verdict du
 * texte final, d'où trois boucles de réparation payées pour rien.
 */
export function dernierJugeLitLeTexteFinal(acquis: ReadonlyArray<{ phase: NodePhase }>): boolean {
  let dernierJuge = -1
  let derniereEtapeDuTexte = -1
  acquis.forEach((etape, rang) => {
    if (etape.phase === 'judge') dernierJuge = rang
    else if (!PHASES_APRES_VERDICT.has(etape.phase)) derniereEtapeDuTexte = rang
  })
  return dernierJuge > derniereEtapeDuTexte
}

/** Nombre d'appels réellement promis par le graphe, panels et synthèses compris. */
export function appelsRequisParWorkflow(
  graph: WorkflowGraph,
  allocation?: WorkflowRunOverride['allocation']
): number {
  const visits = worstCaseVisits(graph)
  let total = 0
  for (const node of graph.nodes) {
    const passages = visits.get(node.id) ?? 0
    if (passages === 0) continue
    const membres =
      node.phase === 'judge'
        ? (allocation?.judgeMembers ?? node.agents?.length ?? 1)
        : (allocation?.phaseMembers?.[node.phase] ?? node.agents?.length ?? 1)
    // Un panel d'exécution de N membres est suivi d'une synthèse ; le jury agrège mécaniquement.
    const appelsParPassage =
      node.phase === 'judge' ? Math.max(1, membres) : membres >= 2 ? membres + 1 : 1
    total += passages * appelsParPassage
  }
  return total
}
// Type SEUL (effacé à la compilation) : l'orchestrateur ne connaît pas le spool, il décrit
// seulement la nature de l'appel pour celui qui écrira la trace.
// Le profil personnel suit le contexte projet dans CHAQUE system de phase, puis la
// mémoire de tête de l'entreprise, comme dans le chat.

export function canonicalCausalPath(root: string, path: string): string {
  const normalized = resolve(root, path).replaceAll('\\', '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/** Convertit la preuve Git publiée en claims directement consommables par le moteur vivant. */
export function watchdogClaimsFromEvidence(
  evidence: readonly ExecutionEvidence[],
  workspaceRoot: string
): WatchdogMutationClaims {
  const paths = new Set<string>()
  const mutatedLineFingerprints: Record<string, string[]> = {}
  const mutatedPathGenerationMarkers: Record<string, string> = {}
  /*
   * Valeurs par chemin rangées UNE fois par preuve, la première d'une clé gagnant comme le
   * `Object.entries(...).find(...)` d'avant. Chercher chaque chemin parmi tous ceux de la preuve
   * coûtait chemins² : 10,3 s de fenêtre figée pour une publication de 2 344 fichiers (mesuré le
   * 06/11/2026). Garde : `orchestrator-contrats.sans-gel.test.ts`.
   */
  const parChemin = <T>(valeurs: Record<string, T> | undefined): Map<string, T> => {
    const index = new Map<string, T>()
    for (const [candidate, valeur] of Object.entries(valeurs ?? {})) {
      const key = canonicalCausalPath(workspaceRoot, candidate)
      if (!index.has(key)) index.set(key, valeur)
    }
    return index
  }
  for (const item of evidence) {
    if (!item.ok || item.kind !== 'mutation') continue
    const lignesParChemin = parChemin(item.writtenLineFingerprintsByPath)
    const marqueursParChemin = parChemin(item.pathGenerationMarkers)
    for (const path of item.paths ?? (item.path ? [item.path] : [])) {
      const absolute = resolve(workspaceRoot, path)
      const canonical = canonicalCausalPath(workspaceRoot, path)
      paths.add(absolute)
      const fingerprints = lignesParChemin.get(canonical)
      if (fingerprints?.length) {
        mutatedLineFingerprints[absolute] = [
          ...(mutatedLineFingerprints[absolute] ?? []),
          ...fingerprints
        ]
      }
      const generationMarker = marqueursParChemin.get(canonical)
      if (generationMarker) mutatedPathGenerationMarkers[absolute] = generationMarker
    }
  }
  return {
    mutatedPaths: [...paths],
    mutatedLineFingerprints,
    mutatedPathGenerationMarkers
  }
}

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
  /** Décodeur du journal brut à employer après crash. */
  provider?: string
  /** Modèle lancé — sans lui, la dépense réglée après coup n'est attribuable à aucun modèle. */
  model?: string
  /** Attribution persistée : le graphe/devis ne suffit pas à redéduire la phase après un crash. */
  phase?: NodePhase
  /** Réservation provider non réglée ; reste vraie entre la sortie du PID et le règlement du stream. */
  active?: boolean
  /** Un résultat de membre doit repasser par l'agrégateur ; il n'est jamais un acquis de phase seul. */
  fanOut?: boolean
  /** Réservation provider exacte portée par cette occurrence, pour une reprise sans déduction. */
  reservationId?: string
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
  /**
   * Étape de découpage seulement : les sous-tâches ADMISES et leurs dépendances, pour que le RUN.md
   * montre le plan avant le build (`runs/plan-en-vagues.ts`).
   */
  plan?: SousTachePlan[]
  /** Provenance causale stable utilisée par le graphe demande → phases → agents. */
  execution?: {
    phase?: NodePhase
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
  phase?: NodePhase
  /**
   * Le prompt REELLEMENT envoye a cette phase, disponible DES le demarrage — l'enveloppe est
   * construite juste avant cet evenement. Sans lui, la ligne de pipeline ne montrait le prompt
   * qu'a la FIN de la phase (le step termine), donc « rien en preprompt » pendant tout l'appel.
   */
  prompt?: PromptEnvelope
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
  /** Sortie brute de chaque phase exec — sert à peupler le RUN.md de la conversation (J2). */
  phaseOutputs: {
    phase: NodePhase
    text: string
    agentToken?: string
    executionEvidence?: ExecutionEvidence[]
  }[]
  /** Verdict terminal du juge, tel qu'écrit — annexé au RUN.md pour la mémoire inter-runs. */
  judgeText?: string
  /**
   * Le même verdict LU (`lireVerdictJuge`, sa note `SCORE`) : le chat ne reçoit pas `judgeText`, et
   * `valid` mêle le juge et la publication — un run validé dont la publication attend passe à
   * `valid: false` sans que rien ne dise que le juge, lui, a validé.
   */
  verdictDuJuge?: { valide: boolean; note?: number }
  /**
   * PRÉSENT seulement quand une relecture seule (`/judge`) est LIVRÉE en nommant des défauts du
   * travail relu (`defautsDeLaRelectureSeule`) : le Journal du RUN.md doit le dire, au lieu de
   * « Juge: validé » (piste 5).
   */
  defautsDuTravailRelu?: string[]
  /**
   * Fichier de la copie ENTIÈRE des sorties d'étapes (`runs/livrable-entier.ts`), quand quelqu'un
   * l'écrit : la bulle coupée le nomme au lieu de promettre un « livrable entier » introuvable.
   */
  livrableEntier?: string
  /** Attestation locale émise uniquement depuis le retour d'un rôle judge distinct de l'auteur. */
  learningAttestations?: IndependentLearningAttestation[]
  /**
   * Notes que les nœuds du run (l'étape `learn` surtout) ont ÉCRITES au Brain par `remember` :
   * elles partent en revue, et la bulle doit le dire au lieu de « aucune leçon proposée ».
   */
  notesBrainDeposees?: number
  /** Requête envoyée au Brain (RAG 1×/run) — pour la traçabilité Observatory. */
  brainQuery?: string
  /** Heure à laquelle la récupération Brain s'est terminée, avant le premier appel modèle. */
  brainRetrievedAt?: string
  /** Navigation interne du Brain (candidats parcourus/scorés/retenus) si le serveur l'expose. */
  brainNavigation?: BrainNavigation
  /** Caractères de contexte Brain réellement injectés. */
  brainInjectedChars?: number
  /** Delta causal du commit préparé puis effectivement publié (sans doublons fan-out ni TOCTOU). */
  causalMutationEvidence?: ExecutionEvidence[]
  trace: OrchestrationStep[]
  /** Mode greedy : ids des sous-tâches dont le run a échoué (rejet). */
  failedTasks?: string[]
  /** Mode greedy : ids des sous-tâches jamais lancées car une dépendance a échoué (cascade). */
  skippedTasks?: string[]
  /** Copie verte volontairement conservée (tournoi) ; elle n'a pas été publiée dans la base. */
  retainedWorkspace?: {
    runId: string
    path: string
    baseSha?: string
    files: string[]
  }
}

export function attestJudgeApprovedLearning(
  aggregate: string,
  approved: boolean,
  runId: string,
  provider: string,
  model: string | undefined,
  workspace: string,
  /**
   * Le texte du verdict : un livrable VALIDE dont le juge a refusé la LEÇON (« OK: leçon refusée »)
   * n'atteste pas cette leçon (refuser la leçon coûtait une réparation).
   */
  texteDuJuge = ''
): IndependentLearningAttestation[] {
  if (!approved || leconRefuseeParLeJuge(texteDuJuge)) return []
  const parsed = parseAttestedLearningProposal(aggregate)
  if (!parsed) return []
  const proposal = {
    ...parsed,
    scope: porteeDeLecon(parsed.scope, workspace)
  }
  return [
    createIndependentLearningAttestation(
      learningProposalAttestation(proposal),
      runId,
      `${provider}:${model ?? 'default'}`
    )
  ]
}

export interface OrchestrationRunOptions {
  /** `hold` conserve un run vert dans sa copie isolée et interdit sa publication automatique. */
  publication?: 'auto' | 'hold'
  /** Source Git immuable imposée aux bras d'un contrefactuel. */
  sourceSnapshot?: { workspaceId: string; baseSha: string; contentHash: string }
  /** Reprise interne : conserve l'identité qui possède déjà la copie Git durable du run. */
  resumeRunId?: string
}

export interface BrainRetrievalEvent {
  timestamp: string
  query: string
  found: boolean
  status: 'found' | 'empty' | 'invalid' | 'unavailable'
  injectedChars: number
  navigation?: BrainNavigation
  /**
   * Nature de l'appel. Absente = `automatic`. Le run en a fait DEUX jusqu'au 2026-09-27 (la
   * récupération par tâche et l'empreinte du dépôt, retirée depuis) : les anciennes traces gardent
   * donc le libellé `empreinte`, qui doit rester lisible.
   */
  kind?: BrainTrace['kind']
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
  /** Retriever substituable pour prouver les frontières d'injection sans serveur global. */
  retrieveBrain?: typeof retrieveBrainContext
  /**
   * Environnement du Brain PERSO (`envDuBrainPerso`), relu à CHAQUE run : un Brain perso réglé dans
   * les Réglages sert dès le run suivant. Absent ou `undefined` : seul le Brain d'équipe est
   * interrogé (2026-10-28).
   */
  brainPerso?: () => NodeJS.ProcessEnv | undefined
  /** Le serveur perso n'écoute pas (connexion refusée) : l'appelant tente de le démarrer. */
  persoInjoignable?: () => void
  /** Résumé metadata-only des décisions reliées à leurs issues observées dans cette conversation. */
  causalMemoryFor?: (conversationId: string) => string
  /**
   * Les pistes que les scouts précédents ont déjà proposées sur un dépôt (`scout-memoire.ts`).
   * `connues` est lu UNE fois au début du run, `sauf` = ce run ; `noter` à la fin de chaque scout.
   */
  memoireScout?: {
    /** `demande` = la tâche du run : seuls les titres qui en touchent le sujet reviennent. */
    connues: (depot: string, sauf: string, demande?: string) => string[]
    noter: (depot: string, texteScout: string, run: string) => void
    /**
     * Les pistes prises/laissées, lues dans la demande du run (message de sélection). `run` = ce
     * run, qui TRAITE les pistes prises : leur résultat se relit sur lui (piste 1).
     */
    choisir?: (depot: string, demande: string, run: string) => void
    /** Le bilan des choix réels sur ce dépôt ; '' tant qu'il y a trop peu de pistes jugées. */
    bilan?: (depot: string) => string
    /** Le facteur de note par type, tiré des choix réels (`facteursDesChoix`) ; {} sans mesure. */
    facteurs?: (depot: string) => FacteursChoix
    /**
     * Les sujets déjà traités sur ce dépôt (commits récents, pistes livrées) : une piste qui les
     * redit est marquée « déjà fait ? » (`marquerDejaFait`, piste 4). Lu en tâche de
     * fond au début du run, comme la liste des fichiers du plafond.
     */
    dejaFaits?: (depot: string) => Promise<readonly SujetDejaFait[]>
  }
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
    phase: NodePhase
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
  /**
   * Directives utilisateur arrivees PENDANT le run, drainees ENTRE DEUX PHASES.
   *
   * « Orienter sans interrompre » ne pouvait pas atteindre un run : le pilote de chat ne draine les
   * directives qu'entre deux de ses iterations, et pendant une orchestration il est bloque dans
   * l'appel `orchestrate`. L'utilisateur orientait, et rien ne se passait (mesure du 20/08). La
   * granularite est la PHASE : on n'interrompt pas un sous-agent en vol, on corrige le cadre de la
   * phase suivante.
   */
  drainDirectives?: (conversationId: string) => string[]
  /**
   * FIN DE RUN (lot 1 du RUN outils-agent-1-2-4-6-7) : ferme le bureau caché du run
   * (`identifiantBureauCache(runId)`), que le run soit vert, rouge ou planté. Une app laissée ouverte
   * par une phase occupait l'identifiant : hdesk-lancer refuse une relance tant qu'elle vit (exit 5).
   * Jamais attendu ni levé : la fermeture douce peut prendre jusqu'à 30 s et ne doit ni retarder ni
   * casser le run. Absent (tests) → rien n'est fermé.
   */
  fermerBureauCache?: (demande: DemandeFermeture) => Promise<unknown>
  onPhaseCompleted?: (info: {
    runId: string
    task: string
    /** Conversation d'origine — sans elle, une reprise ne saurait pas où s'afficher. */
    conversationId?: string
    turnId?: string
    bindingOverride?: RoleBinding
    /** Topologie exacte admise au debut du run, reutilisee telle quelle apres un crash. */
    runtimeSnapshot: OrchestrationRuntimeSnapshot
    phaseOutputs: {
      phase: NodePhase
      text: string
      agentToken?: string
      executionEvidence?: ExecutionEvidence[]
      /** Commit du code lu par `think` : sa reprise exige que les fichiers cités n'aient pas changé. */
      codeSha?: string
    }[]
    executionQuote?: ExecutionQuote
    usage?: ExecutionUsageSnapshot
    /** Agents CLI du run : ce qui permettra de s'y RATTACHER après un redémarrage. */
    agents?: RunAgentRef[]
  }) => void
  /** Persiste immédiatement pid/journal : attendre la fin d’une phase rendrait le run non rattachable. */
  onAgentsChanged?: (runId: string, agents: RunAgentRef[]) => void
  /** Notifié quand le run atteint sa fin (vert, rouge ou abandon) → l'appelant efface l'état repris. */
  onRunSettled?: (runId: string) => void
  /**
   * Run arrêté par le MUR DE QUOTA : il n'est pas fini, il est SUSPENDU. L'appelant garde son état
   * reprenable en y notant le refus et l'heure de retour annoncée, avec les agents et la
   * consommation réglés (`marquerCheckpointCoupeParQuota`). `onRunSettled` n'est PAS appelé.
   */
  onRunQuotaWalled?: (
    runId: string,
    mur: { reason: string; resumeAfter?: number },
    regle: { agents: RunAgentRef[]; usage?: ExecutionUsageSnapshot }
  ) => void
  /** Empreinte d'un processus vivant — sert à savoir, au redémarrage, si un agent travaille encore. */
  processIdentity?: (pid: number) => string | null | undefined
  /**
   * Clôture automatique appelée UNIQUEMENT sur un run vert, APRÈS la fusion du worktree (le travail
   * est alors dans la base). Best-effort : son échec ne change pas le verdict du run.
   */
  closeGreenRun?: RunCloser
  /**
   * Horloge d'attente entre deux tentatives après une SURCHARGE API transitoire (529/503). Injectable
   * pour que les tests ne dorment pas ; absent ⇒ `setTimeout` réel (backoff linéaire).
   */
  sleep?: (ms: number) => Promise<void>
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
  skillInstruction?: (phase: NodePhase, opts: { withFoundation: boolean }) => string
  /**
   * L'étape a-t-elle sa skill désactivée dans Settings › Skills ? Absent = aucune ne l'est (tests).
   * En production : `etapeDesactiveeDansLesReglages` (os.ts) — une étape désactivée ne se joue pas.
   */
  etapeDesactivee?: (phase: string) => boolean
  /**
   * Les outils Brain d'un noeud SKILL, en LIAISON TARDIVE.
   *
   * Le bus de commandes n'existe pas encore quand l'orchestrateur est construit (`index.ts` cree
   * `AutowinOS` avant `AppCommandBus`). D'ou une fonction plutot qu'une valeur : elle est appelee
   * au moment de la phase, quand le bus est la. Absente = aucun outil, comportement d'avant.
   */
  skillCommands?: () => LanceurCommandeSkill | undefined
  /**
   * Les outils des étapes d'un run lancé par un fil de lot (`ecrire_a_un_fil` et `proprietaire_fichier`,
   * signés de ce fil), en liaison tardive comme `skillCommands`. `dossier` est celui de l'étape, la copie
   * de son run. Rend rien pour un fil hors plan : aucun outil.
   */
  outilsDuLot?: (conversationId: string, dossier?: string) => LanceurCommandeSkill | undefined
  /** Source du devis actif, portee par l'ExecutionSupervisor local au run. */
  currentExecutionQuote?: () => ExecutionQuote | undefined
  /** Compteurs locaux du run, persistes avec chaque checkpoint pour une reprise sans reset. */
  currentExecutionUsage?: () => ExecutionUsageSnapshot | undefined
  /**
   * Le fichier ou la copie ENTIERE des sorties d'etapes de ce run est ecrite (`runs/livrable-entier.ts`,
   * a chaque `onPhaseCompleted`). La marque de coupe de l'agregat du juge le nomme ; absent, elle garde
   * son libelle d'avant. Fourni par celui qui ECRIT le fichier : jamais nommer une copie que personne
   * n'ecrit.
   */
  cheminDuLivrableEntier?: (runId: string) => string | undefined
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
  /**
   * L'utilisateur a CHOISI ce workflow, il n'a pas été deviné.
   *
   * Un choix explicite bat l'heuristique de proportionnalité : sans ce drapeau, attacher un
   * workflow à une conversation puis envoyer une demande jugée légère le désactivait EN SILENCE —
   * l'écran affichait un workflow attaché qui ne pilotait rien.
   */
  explicit?: boolean
  /**
   * QUI pilote ce run, et d'où il vient.
   *
   * Sans ce champ, l'identité du workflow était détruite à la frontière : les sites de construction
   * recevaient un profil portant `id` et `name` et n'en transmettaient que la topologie. Le devis
   * affichait donc des plafonds SANS pouvoir nommer ce qui les cause — alors que les plafonds en
   * découlent directement. Purement informatif : rien dans le moteur ne s'en sert pour décider.
   */
  identity?: { name: string; source: 'manuel' | 'modele' | 'compose' }
  phases?: NodePhase[]
  /** Le workflow comme graphe : pilote les phases jouées ET la borne des retours. */
  graph?: WorkflowGraph
  allocation?: {
    phaseMembers?: Partial<Record<PipelinePhase, number>>
    judgeMembers?: number
    maxGreedyNodes?: number
  }
  instructionFor?: (phase: NodePhase) => PhaseInstructionOverride | undefined
}

/** Un nœud du plan greedy : une sous-tâche + les ids dont elle dépend (doivent réussir avant). */
export interface GreedyTaskNode {
  id: string
  /** Consigne complète de la sous-tâche (remise au sous-agent build). */
  prompt: string
  /** Ids des sous-tâches prérequises (vide = indépendante, dispatchable d'emblée). */
  deps: string[]
}

/**
 * Le refus de quota qui a arrêté un run, ou rien.
 *
 * Seule l'EXCEPTION compte : c'est par elle que le mur arrive (« Phase clean — … : You've hit your
 * session limit · resets 1pm »). Un verdict rouge rendu normalement reste un
 * verdict, jamais une suspension. Le vocabulaire est celui du disjoncteur (`estMurDeQuota`), qui
 * écarte déjà le rate-limit passager.
 */
export function murDeQuotaDuRun(erreur: unknown): string | undefined {
  if (erreur === undefined || erreur === null) return undefined
  const message = erreur instanceof Error ? erreur.message : String(erreur)
  return estMurDeQuota(message) ? message : undefined
}

/** Au-delà, une pile d'appels entière rendrait la clôture illisible ; le détail reste dans la trace. */
export const MOTIF_D_ARRET_MAX = 300

/**
 * LA RAISON D'UNE CLÔTURE QUAND LE RUN S'EST ARRÊTÉ AVANT LE CONTRÔLE FINAL.
 *
 * `gateReasons` n'existe que dans le rapport du run (`produced`), écrit au bout du pipeline. Un run
 * arrêté par une exception — quota atteint, connexion expirée, phase en échec — n'en a pas : sa
 * clôture rouge ne disait donc RIEN (mesuré le 2026-10-15, deux clôtures
 * rouges à « Raisons » vide). L'erreur qui a arrêté le run est cette raison.
 */
export function raisonsDArretDuRun(erreur: unknown): string[] | undefined {
  if (erreur === undefined || erreur === null) return undefined
  const message = (erreur instanceof Error ? erreur.message : String(erreur)).trim()
  const motif =
    message.length > MOTIF_D_ARRET_MAX ? `${message.slice(0, MOTIF_D_ARRET_MAX - 1)}…` : message
  return [`run arrêté avant le contrôle final : ${motif || 'erreur sans message'}`]
}

export function costOfTrace(trace: OrchestrationStep[]): number {
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

export interface PhasePromptBlock {
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
    metadata?: {
      task?: string
      role?: string
      conversationId?: string
      turnId?: string
      causalWatchPaths?: readonly string[]
      sourceWorkspacePath?: string
      sourceBaseSha?: string
      resumeExisting?: boolean
    }
  ): string | undefined
  beginAsync?(
    runId: string,
    agentName: string,
    isMutation: boolean,
    metadata?: {
      task?: string
      role?: string
      conversationId?: string
      turnId?: string
      causalWatchPaths?: readonly string[]
      sourceWorkspacePath?: string
      sourceBaseSha?: string
      resumeExisting?: boolean
    }
  ): Promise<string | undefined>
  /**
   * Clôt le run ; appelé en fin de run, y compris sur erreur. `merge: false` (run non vert) ⇒ le
   * travail N'EST PAS fusionné dans la base et la copie isolée est conservée pour décision humaine.
   */
  end(
    runId: string,
    options?: {
      merge?: boolean
      retainGreen?: boolean
      /** Run suspendu par le mur de quota : copie gardée pour la reprise, jamais classée triée. */
      suspendu?: boolean
      onPrepared?: (publication: { baseSha: string; agentSha: string }) => void
      onPublished?: (publication: { baseSha: string; agentSha: string }) => void | Promise<void>
    }
  ): unknown
  endAsync?(
    runId: string,
    options?: {
      merge?: boolean
      retainGreen?: boolean
      /** Run suspendu par le mur de quota : copie gardée pour la reprise, jamais classée triée. */
      suspendu?: boolean
      onPrepared?: (publication: { baseSha: string; agentSha: string }) => void
      onPublished?: (publication: { baseSha: string; agentSha: string }) => void | Promise<void>
    }
  ): Promise<unknown>
  /**
   * PRÉ-VOL, strictement en LECTURE : fichiers non committés de la BASE, tels que `git status` les
   * voit. N'écrit rien — ni `stash`, ni `checkout`, ni ref. Optionnel : un coordinateur qui ne
   * l'implémente pas garde exactement l'ancien comportement (aucun refus inventé).
   */
  baseDirtyFiles?(): readonly string[]
  /** Snapshot d'observation du coordinateur ; ne pilote jamais la finalisation. */
  activity?(): WorktreeAgentActivity[]
  /**
   * Fichiers RÉELLEMENT changés dans la copie du run, mesurés à l'instant de l'appel. La liste
   * `files` d'`activity()` ne convient pas pour cette question : le coordinateur ne la remplit qu'à
   * la finalisation, elle est donc vide pendant tout le run. Une erreur se PROPAGE : une mesure
   * impossible ne doit jamais se lire « copie vide » (2026-10-13).
   */
  fichiersChangesDeLaCopie?(runId: string): Promise<readonly string[]>
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
  /**
   * Rend le compte rendu de la publication du PROJET, ou rien si la clôture n'a rien publié
   * (éteinte). L'annonce du commit en tire le vrai état du push (2026-10-25).
   */
  close(context: {
    runId: string
    task: string
    workCwd: string
    projectPublication?: { baseSha: string; publishedSha: string }
  }): Promise<AutoCloseResult | undefined | void>
}

/**
 * LE POINT UNIQUE du portage phase → phase — et il ne coupe plus rien (2026-09-27).
 *
 * Historique : il y avait six `slice(0, 2000)` muets, réunis ici puis remplacés par une projection
 * par sections (`phase-carry.ts`) sous la même borne de 2 000 caractères. Mesuré alors sur 1280
 * sorties réelles : 25,8 % tronquées, dont 62,5 % des `scout` et 46,7 % des `frame`. La projection
 * choisissait mieux QUOI couper, mais coupait toujours.
 *
 * Règle posée par l'utilisateur le 2026-09-27 : pas de budget, on récupère le nécessaire. Une phase
 * écrit ce que la suivante doit savoir ; la tronquer revient à décider à sa place, sur le seul
 * critère du volume, ce qui ne l'était pas. La sortie passe donc ENTIÈRE. Le point unique reste, pour
 * qu'aucune coupe locale ne réapparaisse ailleurs.
 */
export function porterVersPhaseSuivante(texte: string): string {
  return texte
}

/**
 * LA CONSIGNE QUI ACCOMPAGNE LA LISTE DE CANDIDATES injectée en tête de run (2026-09-27).
 *
 * Le Brain ne rend plus d'extraits : il rend des titres, des chemins et des tailles. Sans cette
 * consigne, une phase lirait la liste comme du savoir et s'arrêterait aux titres. Deux façons
 * d'ouvrir, parce que toutes les phases n'ont pas les mêmes outils : un nœud skill a `brain_read`,
 * une phase du pipeline lit le fichier elle-même (elle tourne avec les droits de lecture complets) —
 * d'où la RACINE, sans laquelle un chemin `knowledge/…` ne mène nulle part hors du serveur.
 */
export function consigneCandidatesBrain(racine?: string, perso?: { racine?: string }): string {
  const ouvrir = racine
    ? `avec \`brain_read\` si tu l'as, sinon en lisant le fichier \`${racine}/<chemin>\``
    : 'avec `brain_read`'
  const base =
    `Ci-dessus : les notes CANDIDATES du Brain pour cette tâche (titre, chemin, taille), PAS leur contenu. ` +
    `Ouvre EN ENTIER celles qui servent ta tâche, autant qu'il en faut, ${ouvrir}. ` +
    `Ignore les autres ; ne fouille le dépôt que pour ce que ce savoir ne couvre pas.`
  if (!perso) return base
  /*
   * BRAIN PERSO : ses notes vivent sous une AUTRE racine. Sans cette phrase, une phase
   * sans `brain_read` lirait `<racine de l'équipe>/perso:knowledge/…`, un fichier qui n'existe pas.
   */
  const ouvrirPerso = perso.racine
    ? `avec \`brain_read\` en GARDANT le préfixe si tu l'as, sinon en lisant le fichier \`${perso.racine}/<chemin sans le préfixe>\``
    : 'avec `brain_read` en GARDANT le préfixe'
  return `${base} Les notes préfixées \`${PREFIXE_NOTE_PERSO}\` viennent du Brain PERSO de l'utilisateur (privé) : ouvre-les ${ouvrirPerso}.`
}

/**
 * #3 — plafond du texte d'UNE phase agrégé dans le livrable remis au JUGE. Le portage phase→phase
 * était alors borné (il ne l'est plus depuis le 2026-09-27), mais l'agrégat juge (`buildExec`) concaténait les sorties
 * COMPLÈTES non tronquées → croissance linéaire du prompt juge avec le nb de phases. On borne chaque
 * bloc de phase (plus large que le portage : le juge doit voir la substance du livrable, pas juste
 * un aperçu). La sortie complète reste dans `phaseOutputs` + la trace des sous-agents.
 * Piste 5 : c'est la PART de chaque phase ; la place qu'une phase courte n'utilise pas
 * revient aux longues, sous 60 000 au total (`agregerPhasesPourLeJuge`, agregat-juge.ts).
 */
export const JUDGE_PHASE_CAP = 6000

/**
 * AUCUNE DIFFERENCE DE DROITS ENTRE L'ORCHESTRATEUR ET LES SOUS-AGENTS.
 *
 * Demande utilisateur du 2026-09-04 : « je ne veux aucune difference d'autorisation entre
 * l'orchestrateur et les sous agents, tout le monde doit pouvoir tout faire a tout moment ».
 *
 * Avant, les droits suivaient la phase : seules build/clean/salvage/kaizen ecrivaient, toutes les
 * autres partaient en `read-only`. Consequence vecue : une phase amont qui trouvait la cause devait
 * REDIGER ce qu'elle aurait fait, et le pre-gate reclamait parfois une preuve de mutation a une
 * phase a qui l'ecriture etait interdite. Le tour de chat, lui, ecrit deja (`providers/claude.ts`).
 *
 * Toutes les phases recoivent donc les MEMES droits que le chat. La seule frontiere qui reste
 * fermee est le fond autonome (`watchdog-read-only`) : personne ne le declenche, son contexte
 * d'evenement n'est pas fiable.
 */
export function sandboxForPhase(
  _task: string,
  _phase: NodePhase
): NonNullable<SendOptions['execution']>['sandbox'] {
  return 'danger-full-access'
}

/**
 * Le préfixe slash choisit le routage, il ne fait pas partie du besoin métier.
 *
 * Le conserver dans `TÂCHE:` devient contradictoire dès qu'un workflow explicite élargit `/build`
 * en scout → frame → terrain → build : les phases amont lisent alors l'ordre « build » comme leur
 * propre mission et tentent d'écrire malgré leur contrat read-only. Le routage a déjà été calculé
 * avant la construction du contexte ; on peut donc retirer uniquement une phase native reconnue.
 */
export function taskForPipelineContext(task: string): string {
  const match = /^\s*\/([a-z][a-z0-9-]*)\b\s*/i.exec(task)
  if (!match) return task
  const phase = match[1].toLowerCase() as PipelinePhase
  if (!PIPELINE_PHASES.includes(phase)) return task
  return task.slice(match[0].length).trimStart()
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
export function safePathForPrompt(value: string): string {
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

export function gitTargets(command: string | undefined): string[] {
  if (!command) return []
  const matches = command.matchAll(/\bgit(?:\.exe)?\s+-C\s+(?:"([^"]+)"|'([^']+)'|(\S+))/gi)
  return [...matches].map((match) => {
    const target = match[1] ?? match[2] ?? match[3]
    return target
      .replaceAll('/', '\\')
      .replace(/[\\]+$/, '')
      .toLowerCase()
  })
}

export function hasVerifiedExternalGitMutation(
  evidence: readonly ExecutionEvidence[],
  executionWorkspace: string
): boolean {
  const expectedTarget = executionWorkspace
    .replaceAll('/', '\\')
    .replace(/[\\]+$/, '')
    .toLowerCase()
  const successful = evidence.filter((item) => item.ok)
  const mutation = successful.some((item) => {
    const targets = gitTargets(item.command)
    return (
      item.kind === 'mutation' &&
      !item.path &&
      isShellMutation(item.command) &&
      targets.length > 0 &&
      targets.every((target) => target === expectedTarget)
    )
  })
  if (!mutation) return false
  return successful.some((item) => {
    const targets = gitTargets(item.command)
    return (
      item.kind !== 'mutation' &&
      isStateOracle(item.command) &&
      targets.length > 0 &&
      targets.every((target) => target === expectedTarget)
    )
  })
}

/**
 * Jeton d'attente d'un appel ADMIS dont l'adaptateur n'a pas encore annoncé son agent. Il porte la
 * réservation jusqu'à `spawnIntent` (qui le remplace par le vrai jeton) ou jusqu'au règlement de
 * l'appel (qui le supprime) : la liste des agents actifs égale ainsi toujours celle des appels réservés.
 */
export function jetonDeReservation(reservationId: string): string {
  return `reservation:${reservationId}`
}
