import type { ProviderRegistry } from './providers/registry'
import type { RoleModelConfig, ReasoningEffort } from './roles'
import { resolvePhaseBinding } from './roles'
import { defaultQuorumThreshold } from './quorum'
import type { CostAggregator } from './dashboards/cost'
import type { TrustLedger } from './trust/ledger'
import type { AuthoritySas } from './authority/sas'
import { evaluateClosure } from './gates/stopgate'
import { runHooks } from './gates/hooks'
import { type PipelinePhase } from './skill-pipeline'
import { phaseBrief } from './phase-briefs'
import { retrieveBrainContext, type BrainNavigation } from './brain-retrieval'
import { projectContextBlock } from './context-files'
import type { ExecutionEvidence, PromptEnvelope, SendOptions, Usage } from './providers/types'
import { CONCISE_STRUCTURED_RESPONSE_INSTRUCTION } from './response-style'
import { PIPELINE_DISCIPLINE_INSTRUCTION } from './pipeline-discipline'

/**
 * Boucle d'orchestration DISCIPLINÉE — le cœur d'Autowin OS.
 *
 * Une tâche traverse le pipeline réel : un sous-agent (rôle `subagent`) l'exécute,
 * un juge (rôle `judge`, potentiellement un AUTRE modèle → décorrélation) évalue le
 * résultat, le gate déterministe tranche la clôture, et CHAQUE tour alimente le coût
 * réel + le ledger de confiance des juges. Rien de simulé : ce sont de vrais appels
 * provider, de vrais tokens, un vrai verdict.
 */
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
  status?: 'completed' | 'failed'
  error?: string
  durationMs?: number
  evidence?: ExecutionEvidence[]
  /** Raisonnement/thinking du sous-agent (si le provider le remonte), conservé pour observation. */
  thinking?: string
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
}

export interface OrchestrationResult {
  task: string
  result: string
  valid: boolean
  gateBlocked: boolean
  gateReasons: string[]
  costUsd: number
  /** Id de la décision d'autorité ouverte si le gate a bloqué (sinon undefined). */
  pendingDecisionId?: string
  /** Sortie brute de chaque phase exec — sert à peupler le RUN.md de la conversation (J2). */
  phaseOutputs: { phase: PipelinePhase; text: string }[]
  /** Requête envoyée au Brain (RAG 1×/run) — pour la traçabilité Observatory. */
  brainQuery?: string
  /** Navigation interne du Brain (candidats parcourus/scorés/retenus) si le serveur l'expose. */
  brainNavigation?: BrainNavigation
  /** Caractères de contexte Brain réellement injectés. */
  brainInjectedChars?: number
  trace: OrchestrationStep[]
}

export interface OrchestratorDeps {
  registry: ProviderRegistry
  roles: RoleModelConfig
  cost: CostAggregator
  trust: TrustLedger
  authority: AuthoritySas
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
   * Fan-out MULTI-MODÈLES d'une phase de DIVERGENCE (scout/frame) : renvoie les modèles déposés
   * dans le bloc topology de cette phase. ≥2 → la phase s'exécute sur CHAQUE modèle en parallèle
   * puis l'orchestrateur SYNTHÉTISE (union dédupliquée). <2 ou absent → mono-modèle (comportement
   * actuel inchangé, rétrocompat HARD). Ne renvoyer des membres que pour scout/frame.
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

const MUTATION_TASK =
  /\b(ajout|ajouter|add|modifi|change|corrig|fix|cr[eé]|create|impl[eé]ment|refactor|supprim|remove|renomm|update|build)\w*/i

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
 * J3 — une tâche est une MUTATION seulement si un verbe de mutation apparaît HORS d'une négation.
 * « Ne modifie pas de code » (cadrage) ne doit PAS exiger de preuve de mutation → sinon faux-red.
 * On neutralise les clauses négatives « ne … pas » / « n'… pas » avant de tester.
 */
export function isMutationTask(task: string): boolean {
  const withoutNegations = task.replace(/\bn[e']\s*\w+(?:\s+\w+){0,2}?\s+pas\b/gi, ' ')
  return MUTATION_TASK.test(withoutNegations)
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
  return (
    successful.some((item) => item.kind === 'mutation') &&
    successful.some((item) => item.kind === 'verification')
  )
}

export class Orchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  /** Exécute une tâche à travers le pipeline discipliné complet (appels réels). */
  async run(
    task: string,
    onStep?: (s: OrchestrationStep) => void,
    onPhase?: (p: OrchestrationPhase) => void,
    onDelta?: (step: 'exec' | 'judge', delta: string) => void,
    signal?: AbortSignal
  ): Promise<OrchestrationResult> {
    const { registry, roles, cost, trust, authority } = this.deps
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
    const subBinding = roles.getBinding('subagent')
    const subProvider = subBinding.provider
    // Sélection ADAPTATIVE (proportionnalité) : `classifyPhases(task)` prime si fourni — une tâche
    // triviale ne joue pas les 5 phases. Fallback `execPhases` statique (rétrocompat/tests).
    const execPhases: PipelinePhase[] = this.deps.classifyPhases
      ? this.deps.classifyPhases(task)
      : (this.deps.execPhases ?? ['build'])
    let execPrompt
    let lastExecText = ''
    let lastUsage: Usage | undefined
    const aggregatedEvidence: ExecutionEvidence[] = []
    const phaseOutputs: { phase: PipelinePhase; text: string }[] = []
    // RAG Brain : 1×/run, on récupère du cerveau Amitel la connaissance pertinente (retriever
    // hybride chaud du brain_server) et on l'injecte en tête de contexte. Le sous-agent part du
    // savoir CURÉ au lieu de brute-forcer le repo. Dégrade à '' si le serveur est absent.
    const brain = await retrieveBrainContext(task)
    const brainContext = brain.context
    // #1 repo-map graphify RÉFUTÉ par mesure A/B (2026-07-22) : injecter GRAPH_REPORT.md (28k) à
    // chaque phase coûtait +206k tokens (ON 573k vs OFF 367k) SANS réduire la lecture agentique du
    // sous-agent → contre-productif (piège du soft-steer saturé). Levier retiré. Cf. harnais
    // scripts/measure-orchestration-tokens.mjs pour re-mesurer une éventuelle version micro.
    const phaseContext: string[] = [
      ...(brainContext
        ? [
            brainContext,
            `Sers-toi de la CONNAISSANCE (Brain) ci-dessus en priorité ; ne relis le dépôt que si strictement nécessaire.`
          ]
        : []),
      `TÂCHE: ${task}`
    ]
    // Session-resume chaîné (levier coût) : on RÉUTILISE la session de l'exécuteur d'une phase à la
    // suivante quand le provider rend un sessionId. La tâche + le Brain + l'acquis des phases sont
    // alors DÉJÀ dans l'historique de session → on n'envoie que l'instruction de la nouvelle phase
    // (supprime la re-injection ×N). Dégrade proprement : pas de sessionId → resumeSessionId undefined
    // → on retombe sur la re-injection complète (comportement actuel). Le sandbox est constant sur un
    // run (isMutationTask(task) fixe) → jamais de resume à travers un changement de sandbox.
    let prevSessionId: string | undefined
    for (const phase of execPhases) {
      // Panel scout/frame : ≥1 modèle déposé dans le bloc topology → la phase s'exécute sur
      // CHAQUE membre. Avec un seul membre, sa sortie est réutilisée directement sans synthèse ;
      // avec plusieurs, l'orchestrateur synthétise. Aucun membre → binding subagent rétrocompatible.
      const fanMembers = (this.deps.phaseFanOut?.(phase) ?? []).filter((m) => m && m.provider)
      if (fanMembers.length >= 1) {
        // Le fan-out casse la chaîne de session (N sessions //). Chaque membre part du contexte complet.
        const fanMessages = [{ role: 'user' as const, content: phaseContext.join('\n\n') }]
        const parts = [
          { name: `consigne:${phase}`, text: phaseBrief(phase) },
          { name: 'discipline', text: PIPELINE_DISCIPLINE_INSTRUCTION },
          { name: 'style', text: CONCISE_STRUCTURED_RESPONSE_INSTRUCTION },
          { name: 'projectContext', text: projectContext }
        ]
        const fanSystemBlocks = parts
          .filter((p) => p.text)
          .map((p) => ({ name: p.name, chars: p.text.length }))
        const fanSystem = parts.map((p) => p.text).join('')
        const sandbox = isMutationTask(task) ? 'danger-full-access' : 'read-only'
        const memberOutputs = await Promise.all(
          fanMembers.map(async (member) => {
            const opts: SendOptions = {
              system: fanSystem,
              systemBlocks: fanSystemBlocks,
              model: member.model,
              reasoningEffort: member.reasoningEffort,
              execution: { cwd: this.deps.executionWorkspace, sandbox },
              signal
            }
            const startedAt = performance.now()
            onPhase?.({
              step: 'exec',
              provider: member.provider,
              role: 'subagent',
              model: member.model,
              reasoningEffort: member.reasoningEffort,
              phase
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
                detail: `phase ${phase} · modèle ${member.model ?? member.provider}`
              })
              aggregatedEvidence.push(...(res.executionEvidence ?? []))
              return { member, text: res.text, ok: true as const }
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
                detail: `phase ${phase} · modèle ${member.model ?? member.provider}`
              })
              return { member, text: '', ok: false as const }
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
          push({
            step: 'exec',
            role: 'subagent',
            text: '',
            status: 'failed',
            error: `Les ${fanMembers.length} modèles du fan-out ${phase} ont échoué`,
            detail: `phase ${phase} : les ${fanMembers.length} modèles du fan-out ont échoué`,
            durationMs: 0
          })
          throw new Error(
            `Fan-out ${phase} : aucun modèle n'a produit de sortie (${fanMembers.length} échec(s))`
          )
        }
        if (good.length === 1) {
          // Un seul survivant → rien à agréger : on réutilise sa sortie directement, sans appel de
          // synthèse (inutile + risque de reformulation d'un texte unique).
          const solo = good[0].text
          lastExecText = solo
          phaseOutputs.push({ phase, text: solo })
          const carriedSolo =
            solo.length > PHASE_CONTEXT_CAP
              ? `${solo.slice(0, PHASE_CONTEXT_CAP)}\n…[tronqué — voir le fil des sous-agents]`
              : solo
          phaseContext.push(`[phase ${phase}] ${carriedSolo}`)
          prevSessionId = undefined
          continue
        }
        const orchBinding = roles.getBinding('orchestrator')
        const labelled = good
          .map((o, i) => `### Proposition ${i + 1} (modèle ${o.member.model ?? o.member.provider})\n${o.text}`)
          .join('\n\n')
        const synthParts = [
          { name: 'style', text: CONCISE_STRUCTURED_RESPONSE_INSTRUCTION },
          { name: 'projectContext', text: projectContext }
        ]
        const synthOptions: SendOptions = {
          system: synthParts.map((p) => p.text).join(''),
          systemBlocks: synthParts.filter((p) => p.text).map((p) => ({ name: p.name, chars: p.text.length })),
          model: orchBinding.model,
          reasoningEffort: orchBinding.reasoningEffort,
          execution: { cwd: this.deps.executionWorkspace, sandbox: 'read-only' },
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
        onPhase?.({
          step: 'exec',
          provider: orchBinding.provider,
          role: 'orchestrator',
          model: orchBinding.model,
          reasoningEffort: orchBinding.reasoningEffort,
          phase
        })
        const synth = await registry.send(orchBinding.provider, synthMessages, synthOptions, (c) =>
          onDelta?.('exec', c.delta)
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
          detail: `synthèse ${phase} (${good.length} modèles)`
        })
        lastExecText = synth.text
        lastUsage = synth.usage
        phaseOutputs.push({ phase, text: synth.text })
        const carried =
          synth.text.length > PHASE_CONTEXT_CAP
            ? `${synth.text.slice(0, PHASE_CONTEXT_CAP)}\n…[tronqué — voir le fil des sous-agents]`
            : synth.text
        phaseContext.push(`[phase ${phase}] ${carried}`)
        prevSessionId = undefined // fan-out : pas de session linéaire à chaîner
        continue
      }
      const resuming = Boolean(prevSessionId)
      const userContent = resuming
        ? `Phase suivante du pipeline : ${phase}. Continue À PARTIR de l'état de la session (tâche, connaissance Brain et acquis des phases précédentes déjà connus — ne les redemande pas). Applique la consigne de phase et enrichis le livrable existant.`
        : phaseContext.join('\n\n')
      const phaseMessages = [{ role: 'user' as const, content: userContent }]
      // F6 — le system est composé de blocs NOMMÉS : on garde leur décomposition (nom + taille)
      // pour l'observabilité, en plus de la chaîne concaténée réellement envoyée.
      // Consigne courte purpose-built (phase-briefs) : ~1-2k au lieu du SKILL.md brut. L'état
      // (besoin + acquis des phases) vit dans le message user ci-dessous, pas dans le system.
      // Modèle EFFECTIF de la phase : override par phase (petit modèle sur analyse, gros sur build)
      // → défaut = modèle du binding. Générique/rétrocompat (resolvePhaseBinding).
      const phaseBinding = resolvePhaseBinding(subBinding, phase)
      const parts = [
        { name: `consigne:${phase}`, text: phaseBrief(phase) },
        { name: 'discipline', text: PIPELINE_DISCIPLINE_INSTRUCTION },
        { name: 'style', text: CONCISE_STRUCTURED_RESPONSE_INSTRUCTION },
        { name: 'projectContext', text: projectContext }
      ]
      const systemBlocks = parts.filter((p) => p.text).map((p) => ({ name: p.name, chars: p.text.length }))
      const subOptions: SendOptions = {
        system: parts.map((p) => p.text).join(''),
        systemBlocks,
        model: phaseBinding.model,
        reasoningEffort: phaseBinding.reasoningEffort,
        resumeSessionId: prevSessionId,
        execution: {
          cwd: this.deps.executionWorkspace,
          // B3 — une tâche NON-mutation (cadrage/analyse) n'a aucune raison d'écrire : sandbox
          // read-only → pas d'effet de bord (ex. RUN.md fantôme dans Audit/). Mutation → full access.
          sandbox: isMutationTask(task) ? 'danger-full-access' : 'read-only'
        },
        signal,
        observePrompt: (observed) => {
          observed.systemBlocks = systemBlocks
          execPrompt = observed
        }
      }
      execPrompt = registry.describePrompt(subProvider, phaseMessages, subOptions, phaseBinding.model)
      execPrompt.systemBlocks = systemBlocks
      onPhase?.({
        step: 'exec',
        provider: subProvider,
        role: 'subagent',
        model: phaseBinding.model,
        reasoningEffort: phaseBinding.reasoningEffort,
        phase
      })
      const phaseStartedAt = performance.now()
      let phaseRes
      try {
        phaseRes = await registry.send(subProvider, phaseMessages, subOptions, (c) =>
          onDelta?.('exec', c.delta)
        )
      } catch (error) {
        push({
          step: 'exec',
          provider: subProvider,
          role: 'subagent',
          text: '',
          prompt: execPrompt,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
          durationMs: performance.now() - phaseStartedAt
        })
        throw error
      }
      // Chaîne la session pour la phase suivante (fallback : garde l'ancien id si le provider n'en
      // rend pas de nouveau — un resume claude conserve le même id et y APPEND les tours).
      prevSessionId = phaseRes.sessionId ?? prevSessionId
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
        tokens: phaseRes.usage ? phaseRes.usage.inputTokens + phaseRes.usage.outputTokens : undefined,
        costUsd: phaseRes.usage?.costUsd,
        usage: phaseRes.usage,
        prompt: execPrompt,
        status: 'completed',
        durationMs: performance.now() - phaseStartedAt,
        evidence: phaseRes.executionEvidence,
        detail: execPhases.length > 1 ? `phase ${phase}` : undefined
      })
      aggregatedEvidence.push(...(phaseRes.executionEvidence ?? []))
      lastExecText = phaseRes.text
      lastUsage = phaseRes.usage
      phaseOutputs.push({ phase, text: phaseRes.text })
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
    const buildExec = (): { text: string; usage: Usage | undefined; executionEvidence: ExecutionEvidence[] } => ({
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

    // 2. Un JUGE (autre rôle → potentiellement autre modèle) évalue le résultat.
    const judgeBinding = roles.getBinding('judge')
    const judgeProvider = judgeBinding.provider

    // Une passe JUGE (autre rôle → décorrélation) + GATE déterministe sur l'état COURANT de `exec`.
    // Rejouable : après une phase de réparation, l'agrégat `exec` change et on re-juge.
    const judgeAndGate = async (): Promise<{
      valid: boolean
      gate: ReturnType<typeof evaluateClosure>
    }> => {
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
        { name: 'skill:judge', text: phaseBrief('judge') },
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
        execution: { cwd: this.deps.executionWorkspace, sandbox: 'read-only' },
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
      onPhase?.({
        step: 'judge',
        provider: judgeProvider,
        role: 'judge',
        model: judgeBinding.model,
        reasoningEffort: judgeBinding.reasoningEffort
      })
      const judgeStartedAt = performance.now()
      let verdict
      // FAN-OUT JUGE : ≥2 modèles dans le bloc topology judge → N juges en parallèle puis QUORUM
      // de vote MÉCANIQUE (compter les VALIDE ; majorité = pass). Agréger ≠ re-décider : aucun juge
      // supplémentaire ne tranche, on compte les voix. <2 ou absent → un seul juge (rétrocompat).
      const judgeMembers = (this.deps.judgeFanOut?.() ?? []).filter((m) => m && m.provider)
      if (judgeMembers.length >= 2) {
        const results = await Promise.all(
          judgeMembers.map(async (member) => {
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
              reasoningEffort: member.reasoningEffort
            })
            try {
              const r = await registry.send(member.provider, judgeMessages, opts, (c) =>
                onDelta?.('judge', c.delta)
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
                durationMs: performance.now() - startedAt
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
                durationMs: performance.now() - startedAt
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
        const threshold = defaultQuorumThreshold(votingN)
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
          provider: judgeProvider,
          systemInjected: true,
          usage: undefined
        }
      } else {
        try {
          verdict = await registry.send(judgeProvider, judgeMessages, judgeOptions, (c) =>
            onDelta?.('judge', c.delta)
          )
        } catch (error) {
          push({
            step: 'judge',
            provider: judgeProvider,
            role: 'judge',
            text: '',
            prompt: judgeEnvelope,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
            durationMs: performance.now() - judgeStartedAt
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
      const ok =
        evidenceSatisfiesTask(task, exec.executionEvidence) && /^\s*valide/i.test(verdict.text)
      trust.record({ judgeModel: judgeProvider, verdict: ok ? 'green' : 'red' })
      push({
        step: 'judge',
        provider: verdict.provider ?? judgeProvider,
        role: 'judge',
        text: verdict.text.trim(),
        tokens: verdict.usage ? verdict.usage.inputTokens + verdict.usage.outputTokens : undefined,
        costUsd: verdict.usage?.costUsd,
        usage: verdict.usage,
        detail: ok ? 'validé' : 'défaut',
        prompt: judgeEnvelope,
        status: 'completed',
        durationMs: performance.now() - judgeStartedAt
      })

      // GATE déterministe (model-agnostic) + hooks in-app reproduits (enforcement HORS-MODÈLE).
      const hookViolations = runHooks({
        requireProof: isMutationTask(task),
        evidenceOkCount: (exec.executionEvidence ?? []).filter((e) => e.ok).length
      })
      onPhase?.({ step: 'gate' })
      const g = evaluateClosure({
        status: ok && hookViolations.length === 0 ? 'green' : 'red',
        dod: [{ checked: ok, hasContent: true }]
      })
      if (hookViolations.length) g.reasons.push(...hookViolations.map((h) => `hook ${h.hook}: ${h.detail}`))
      push({
        step: 'gate',
        detail: g.blocked ? `BLOQUÉ: ${g.reasons.join('; ')}` : 'clôture autorisée'
      })
      return { valid: ok, gate: g }
    }

    // B5 — pour une MUTATION bloquée, UNE réparation ciblée (feedback = raisons du gate) AVANT
    // d'escalader à l'humain (résolveur avant interruption). Bornée à 1, jamais de boucle infinie.
    const MAX_ATTEMPTS = isMutationTask(task) ? 2 : 1
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
            phaseBrief('build') +
            PIPELINE_DISCIPLINE_INSTRUCTION +
            CONCISE_STRUCTURED_RESPONSE_INSTRUCTION +
            projectContext,
          model: subBinding.model,
          reasoningEffort: subBinding.reasoningEffort,
          execution: { cwd: this.deps.executionWorkspace, sandbox: 'danger-full-access' },
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
        onPhase?.({
          step: 'exec',
          provider: subProvider,
          role: 'subagent',
          model: subBinding.model,
          reasoningEffort: subBinding.reasoningEffort,
          phase: 'build'
        })
        const repairStartedAt = performance.now()
        const repairRes = await registry.send(subProvider, repairMessages, repairOptions, (c) =>
          onDelta?.('exec', c.delta)
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
          provider: subProvider,
          role: 'subagent',
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
          detail: 'phase build (réparation)'
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

    // 4. Gate BLOQUÉ → la décision remonte à l'humain via le sas d'autorité
    // (rejouer/abandonner) ; défaut sûr = abandonner si personne ne répond (AFK).
    let pendingDecisionId: string | undefined
    if (gate.blocked) {
      pendingDecisionId = authority.propose({
        question: `Tâche "${task}" : le juge a rejeté le résultat. Rejouer ou abandonner ?`,
        options: ['rejouer', 'abandonner'],
        safeDefault: 'abandonner',
        ttlMs: 10 * 60 * 1000
      })
    }

    return {
      task,
      result: exec.text,
      valid,
      gateBlocked: gate.blocked,
      gateReasons: gate.reasons,
      pendingDecisionId,
      phaseOutputs,
      brainQuery: brain.navigation?.query ?? (brainContext ? task : undefined),
      brainNavigation: brain.navigation,
      brainInjectedChars: brainContext.length,
      costUsd: cost.totalUsd(),
      trace
    }
  }
}
