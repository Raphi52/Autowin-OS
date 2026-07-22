import type { ProviderRegistry } from './providers/registry'
import type { RoleModelConfig } from './roles'
import type { CostAggregator } from './dashboards/cost'
import type { TrustLedger } from './trust/ledger'
import type { AuthoritySas } from './authority/sas'
import { evaluateClosure } from './gates/stopgate'
import { runHooks } from './gates/hooks'
import { type PipelinePhase } from './skill-pipeline'
import { phaseBrief } from './phase-briefs'
import { retrieveBrainContext } from './brain-retrieval'
import { projectContextBlock } from './context-files'
import { repoMapBlock } from './repo-map'
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
    const execPhases: PipelinePhase[] = this.deps.execPhases ?? ['build']
    let execPrompt
    let lastExecText = ''
    let lastUsage: Usage | undefined
    const aggregatedEvidence: ExecutionEvidence[] = []
    const phaseOutputs: { phase: PipelinePhase; text: string }[] = []
    // RAG Brain : 1×/run, on récupère du cerveau Amitel la connaissance pertinente (retriever
    // hybride chaud du brain_server) et on l'injecte en tête de contexte. Le sous-agent part du
    // savoir CURÉ au lieu de brute-forcer le repo. Dégrade à '' si le serveur est absent.
    const brainContext = await retrieveBrainContext(task)
    // #1 — carte du code graphify (repo-map). 1×/run, en tête de contexte : le sous-agent localise
    // le code via la carte au lieu de le relire fichier par fichier (baisse du résiduel lecture).
    // Dégrade à '' si le graphe n'est pas généré → comportement inchangé.
    const repoMap = repoMapBlock(this.deps.executionWorkspace)
    const phaseContext: string[] = [
      ...(brainContext
        ? [
            brainContext,
            `Sers-toi de la CONNAISSANCE (Brain) ci-dessus en priorité ; ne relis le dépôt que si strictement nécessaire.`
          ]
        : []),
      ...(repoMap ? [repoMap] : []),
      `TÂCHE: ${task}`
    ]
    for (const phase of execPhases) {
      const phaseMessages = [{ role: 'user' as const, content: phaseContext.join('\n\n') }]
      // F6 — le system est composé de blocs NOMMÉS : on garde leur décomposition (nom + taille)
      // pour l'observabilité, en plus de la chaîne concaténée réellement envoyée.
      // Consigne courte purpose-built (phase-briefs) : ~1-2k au lieu du SKILL.md brut. L'état
      // (besoin + acquis des phases) vit dans le message user ci-dessous, pas dans le system.
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
        model: subBinding.model,
        reasoningEffort: subBinding.reasoningEffort,
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
      execPrompt = registry.describePrompt(subProvider, phaseMessages, subOptions, subBinding.model)
      execPrompt.systemBlocks = systemBlocks
      onPhase?.({
        step: 'exec',
        provider: subProvider,
        role: 'subagent',
        model: subBinding.model,
        reasoningEffort: subBinding.reasoningEffort,
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
      if (phaseRes.usage) {
        cost.add({
          provider: subProvider,
          role: 'subagent',
          inputTokens: phaseRes.usage.inputTokens,
          outputTokens: phaseRes.usage.outputTokens,
          cacheReadTokens: phaseRes.usage.cacheReadTokens,
          costUsd: phaseRes.usage.costUsd
        })
      }
      push({
        step: 'exec',
        provider: subProvider,
        role: 'subagent',
        text: phaseRes.text,
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
          provider: judgeProvider,
          role: 'judge',
          inputTokens: verdict.usage.inputTokens,
          outputTokens: verdict.usage.outputTokens,
          cacheReadTokens: verdict.usage.cacheReadTokens,
          costUsd: verdict.usage.costUsd
        })
      }
      const ok =
        evidenceSatisfiesTask(task, exec.executionEvidence) && /^\s*valide/i.test(verdict.text)
      trust.record({ judgeModel: judgeProvider, verdict: ok ? 'green' : 'red' })
      push({
        step: 'judge',
        provider: judgeProvider,
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
      costUsd: cost.totalUsd(),
      trace
    }
  }
}
