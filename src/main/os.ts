/**
 * Façade AutowinOS — câble ensemble les modules RÉELLEMENT utilisés en un seul
 * objet applicatif. Point d'intégration unique consommé par index.ts (IPC).
 * Principe : rien d'exposé ici n'est mort — chaque méthode a un appelant réel
 * (chat, orchestration, dashboards, graphe 3D).
 */
import { ProviderRegistry } from './providers/registry'
import { ClaudeCliAdapter } from './providers/claude'
import { CodexAdapter } from './providers/codex'
import { KimiCliAdapter } from './providers/kimi'
import { GeminiCliAdapter } from './providers/gemini'
import type { Message } from './providers/types'
import { CONSTITUTION } from './constitution'
import { planProviderLogin, spawnLoginTerminal } from './provider-login'
import { RoleModelConfig, type Role, type RoleBinding, type ReasoningEffort } from './roles'
import { loadRoleBindings, saveRoleBindings } from './role-store'
// fix-ok: refonte qualité (demande user « refais comme en fable ») — purge du mort, pas un blind-fix.
import { AuthoritySas } from './authority/sas'
import { CostAggregator } from './dashboards/cost'
import { isBlocked } from './dashboards/runs'
import { recurrentPatterns, parseJsonl } from './dashboards/kaizen'
import {
  loadBrainGraph,
  loadBrainNeighborhood,
  scanBrainGraphs,
  readNodeFile,
  searchVaultBrainNotes,
  type BrainGraphRef
} from './viz/fs-brains'
import { scanRuns, type RunEntry } from './dashboards/runs-scan'
import { ConversationStore } from './store/conversations'
import { TrustLedger } from './trust/ledger'
import {
  Orchestrator,
  type OrchestrationResult,
  type OrchestrationStep,
  type OrchestrationPhase
} from './orchestrator'
import { resolveVerifyReplayConfig } from './hooks/verify-replay-config'
import { buildOrchestratorDecomposer } from './greedy-decompose'
import {
  captureCloseBaseline,
  type CloseBaseline,
  closeGreenRunOnDisk,
  type AutoCloseReport
} from './run-autoclose'
import { amitelBrainRoot } from './amitel-context'
import { regimePhases } from './task-regime'
import type { PipelinePhase } from './skill-pipeline'
import {
  clearOrchestrationState,
  loadOrchestrationStates,
  pickOrchestrationToResume,
  saveOrchestrationState,
  type OrchestrationRunState
} from './runs/orchestration-state'
import { defaultBehaviourWorkspace } from './behaviour-files'
import { WorktreeManager } from './store/worktree-manager'
import { RunWorktreeCoordinator } from './store/run-worktree-coordinator'
import type {
  WorktreeAgentActivity,
  WorktreeRuntimeStatus
} from '../shared/worktree-activity-model'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { ensureAutowinAppData } from './app-data'
import { loadAutoClose, saveAutoClose } from './autoclose-store'
import { AUTOWIN_WORKSPACE_ENV } from '../shared/app-identity'

interface ExecutionWorkspaceInput {
  cwd?: string
  execPath?: string
  configured?: string
}

function gitWorkspaceFrom(start: string): string | undefined {
  let cursor = resolve(start)
  for (;;) {
    if (existsSync(join(cursor, '.git')) && existsSync(join(cursor, 'package.json'))) return cursor
    const parent = dirname(cursor)
    if (parent === cursor) return undefined
    cursor = parent
  }
}

export function resolveExecutionWorkspace(input: ExecutionWorkspaceInput = {}): string {
  const configured = input.configured ?? process.env[AUTOWIN_WORKSPACE_ENV]
  if (configured && existsSync(configured)) return resolve(configured)
  const cwdWorkspace = gitWorkspaceFrom(input.cwd ?? process.cwd())
  if (cwdWorkspace) return cwdWorkspace
  const executableWorkspace = gitWorkspaceFrom(dirname(input.execPath ?? process.execPath))
  if (executableWorkspace) return executableWorkspace
  return defaultBehaviourWorkspace()
}

/** Un modèle membre d'un bloc de fan-out (topology → orchestrateur). */
interface FanMember {
  provider: string
  model?: string
  reasoningEffort?: ReasoningEffort
}

/** Noyau applicatif : une instance partagée, injectée dans les handlers IPC. */
export class AutowinOS {
  private readonly brainGraphCache = new Map<string, ReturnType<typeof loadBrainGraph>>()
  readonly registry: ProviderRegistry
  readonly roles = new RoleModelConfig(loadRoleBindings()) // restaure la config persistée
  readonly authority = new AuthoritySas()
  readonly cost = new CostAggregator(undefined, join(ensureAutowinAppData(), 'cost.jsonl'))
  readonly conversations = new ConversationStore()
  readonly trust = new TrustLedger(join(ensureAutowinAppData(), 'trust.jsonl'))
  readonly orchestrator: Orchestrator
  readonly executionWorkspace: string
  /**
   * Source LIVE du fan-out multi-modèles, alimentée par la topology (index.ts `syncRuntimeTopology`).
   * Les blocs scout/frame/judge de la topology y déposent leurs N modèles ; l'orchestrateur les lit
   * (deps `phaseFanOut`/`judgeFanOut`). Vide par défaut → mono-modèle (rétrocompat).
   */
  private fanOut: {
    scout: FanMember[]
    frame: FanMember[]
    judge: FanMember[]
  } = { scout: [], frame: [], judge: [] }
  private taskReadiness: Promise<void> = Promise.resolve()
  /**
   * Coordinateur worktree (volet B) : donne à chaque run de mutation une copie isolée, fusionnée en
   * full-auto (conflit → assisté). Présent seulement si le workspace est un repo git (sinon undefined
   * → comportement historique, workspace partagé). Exposé pour l'IPC d'observabilité (volet A).
   */
  readonly worktrees?: RunWorktreeCoordinator
  private worktreeActivityListener?: (a: WorktreeAgentActivity[]) => void
  /** Dossier des états d'orchestration reprenables (survie niveau 3). */
  private readonly orchestrationStateRoot = join(ensureAutowinAppData(), 'run-state')
  private readonly orchestrationStartedAt = new Map<string, number>()

  constructor() {
    this.registry = new ProviderRegistry(CONSTITUTION)
      .register(new ClaudeCliAdapter())
      .register(new CodexAdapter())
      .register(new KimiCliAdapter())
      .register(new GeminiCliAdapter())
    const executionWorkspace = resolveExecutionWorkspace()
    this.executionWorkspace = executionWorkspace
    // Le workspace resolu est republie dans l'environnement pour que le TRANSPORT y ait acces sans
    // nouvelle dependance : c'est ce qui permet au tour de chat de LIRE le projet (Read/Grep/Glob en
    // lecture seule) au lieu d'etre aveugle et de devoir orchestrer pour repondre a une question.
    process.env[AUTOWIN_WORKSPACE_ENV] = executionWorkspace
    // Garde : `git worktree` exige un vrai repo. Absent (.git manquant) → pas d'isolation (undefined).
    if (existsSync(join(executionWorkspace, '.git'))) {
      const manager = new WorktreeManager({
        baseRepo: executionWorkspace,
        worktreeRoot: join(ensureAutowinAppData(), 'worktrees')
      })
      this.worktrees = new RunWorktreeCoordinator({
        manager,
        onActivity: (a) => {
          this.worktreeActivityListener?.(a)
        }
      })
    }
    this.orchestrator = new Orchestrator({
      registry: this.registry,
      roles: this.roles,
      cost: this.cost,
      trust: this.trust,
      authority: this.authority,
      executionWorkspace,
      // verify-replay EN PROD (opt-in via AUTOWIN_VERIFY_REPLAY) : rejoue la vérif au gate au lieu
      // de croire l'evidence sur parole. Off par défaut (voir resolveVerifyReplayConfig).
      ...resolveVerifyReplayConfig(),
      worktrees: this.worktrees,
      // Pipeline ADAPTATIF (proportionnalité) : le régime de la tâche choisit le sous-ensemble de
      // phases (trivial → build seul ; standard → frame+build ; critical → les 5 scout→clean), puis
      // le juge (rôle distinct). Déterministe/générique (task-regime.ts). Économise tokens + latence
      // sur les tâches simples sans jamais sous-traiter les complexes (doute → critical).
      classifyPhases: regimePhases,
      // SURVIE NIVEAU 3 : après CHAQUE phase, on persiste l'acquis du run ; à la clôture on l'efface.
      // Un kill du process main laisse donc un état reprenable → `resumableOrchestration()`.
      onPhaseCompleted: ({ runId, task, conversationId, phaseOutputs }) =>
        saveOrchestrationState(this.orchestrationStateRoot, {
          runId,
          task,
          ...(conversationId ? { conversationId } : {}),
          phaseOutputs,
          startedAt: this.orchestrationStartedAt.get(runId) ?? Date.now(),
          updatedAt: Date.now()
        }),
      onRunSettled: (runId) => {
        this.orchestrationStartedAt.delete(runId)
        clearOrchestrationState(this.orchestrationStateRoot, runId)
      },
      // Fan-out multi-modèles : les blocs topology scout/frame → phases de divergence ; judge → juges.
      // ≥2 modèles déposés → l'orchestrateur duplique + agrège (voir orchestrator.ts). Sinon mono.
      phaseFanOut: (phase) =>
        phase === 'scout' || phase === 'frame' ? this.fanOut[phase] : [],
      judgeFanOut: () => this.fanOut.judge,
      // Fonctionnement NORMAL : on décompose systématiquement via le modèle orchestrateur (best-effort
      // → [] pour une tâche atomique = fallback séquentiel naturel). Pas de « mode » à activer.
      decompose: buildOrchestratorDecomposer({
        registry: this.registry,
        roles: this.roles,
        cwd: executionWorkspace
      }),
      // Clôture d'un run VERT : publication sur une branche dédiée (jamais main), côté projet puis
      // Brain. OFF par défaut — tant que l'utilisateur ne l'a pas activée, rien n'est publié tout seul.
      closeGreenRun: {
        // Photo de l'arbre au démarrage : tout ce qui était déjà modifié n'appartient pas au run.
        begin: (runId) => {
          if (!this.autoClose) return
          this.closeBaselines.set(runId, captureCloseBaseline(executionWorkspace, amitelBrainRoot()))
        },
        close: async ({ runId, task }) => {
          const baselinePromise = this.closeBaselines.get(runId)
          this.closeBaselines.delete(runId)
          if (!this.autoClose || !baselinePromise) return
          this.lastAutoClose = await closeGreenRunOnDisk({
            runId,
            task,
            projectRepo: executionWorkspace,
            brainRepo: amitelBrainRoot(),
            baseline: await baselinePromise
          })
        }
      }
    })
  }

  /**
   * Clôture automatique d'un run vert (commit + push sur branche dédiée). OFF par défaut, et
   * RESTAURÉE du disque : sans ça le réglage retombait à OFF à chaque lancement, obligeant à le
   * réarmer à la main — l'étape manuelle que la fonctionnalité doit justement supprimer.
   */
  private autoClose = loadAutoClose()
  /** Photo de l'arbre par run en cours (projet + Brain), prise au démarrage. */
  private readonly closeBaselines = new Map<string, Promise<CloseBaseline>>()
  /** Dernier résultat de clôture — remonté à l'UI pour dire ce qui a réellement été publié. */
  private lastAutoClose: AutoCloseReport | undefined

  setAutoClose(enabled: boolean): void {
    this.autoClose = enabled
    saveAutoClose(enabled)
  }
  getAutoClose(): { enabled: boolean; last?: AutoCloseReport } {
    return { enabled: this.autoClose, ...(this.lastAutoClose ? { last: this.lastAutoClose } : {}) }
  }

  /** Met à jour la source live du fan-out (appelé par la topology au boot et à chaque changement). */
  setFanOut(next: { scout: FanMember[]; frame: FanMember[]; judge: FanMember[] }): void {
    this.fanOut = next
  }

  /** Activité worktree courante (volet A) — snapshot pour l'IPC/renderer. */
  getWorktreeActivity(): WorktreeAgentActivity[] {
    return this.worktrees ? this.worktrees.activity() : []
  }

  getWorktreeRuntimeStatus(): WorktreeRuntimeStatus {
    return { available: this.worktrees !== undefined }
  }

  /** Abonne l'IPC aux changements d'activité worktree (push live vers le cockpit). Idempotent. */
  onWorktreeActivity(listener: (a: WorktreeAgentActivity[]) => void): void {
    this.worktreeActivityListener = listener
  }

  /** Empêche tout run de lire la topology avant la fin de la découverte des modèles. */
  setTaskReadiness(readiness: Promise<unknown>): void {
    this.taskReadiness = readiness.then(() => undefined)
  }

  // --- Conversation directe (chat) : alimente le coût réel ---
  async chat(
    provider: string | undefined,
    role: Role | undefined,
    messages: Message[],
    onDelta: (d: string) => void
  ): Promise<{ text: string; provider: string; systemInjected: boolean }> {
    const binding = this.roles.getBinding(role ?? 'orchestrator')
    const p = provider ?? binding.provider
    const options = provider
      ? {}
      : { model: binding.model, reasoningEffort: binding.reasoningEffort }
    const r = await this.registry.send(p, messages, options, (c) => onDelta(c.delta))
    if (r.usage) {
      this.cost.add({
        provider: p,
        inputTokens: r.usage.inputTokens,
        outputTokens: r.usage.outputTokens,
        cacheReadTokens: r.usage.cacheReadTokens,
        costUsd: r.usage.costUsd
      })
    }
    return { text: r.text, provider: r.provider, systemInjected: r.systemInjected }
  }

  /**
   * Lance le login OFFICIEL d'un provider (bouton « Se reconnecter » de la page Routeur).
   * Les adapters qui exposent `startLogin` gèrent leur connexion ; claude/codex passent par un terminal.
   */
  startProviderLogin(provider: string): void {
    const adapter = this.registry.get(provider)
    if (adapter.startLogin) {
      adapter.startLogin()
      return
    }
    const plan = planProviderLogin(provider)
    if (plan.kind === 'adapter')
      throw new Error(`Le provider ${provider} n'expose pas de connexion interactive.`)
    // codex : `npm run codex:login` doit tourner à la racine du repo (dev) → cwd = process.cwd().
    spawnLoginTerminal(plan.command, provider === 'codex' ? { cwd: process.cwd() } : {})
  }

  startKimiLogin(): void {
    this.startProviderLogin('kimi')
  }

  /** Change le binding d'un rôle ET persiste sur disque. */
  setRole(role: Role, binding: RoleBinding): Record<Role, RoleBinding> {
    const proposed = new RoleModelConfig(this.roles.all(), this.roles.getCatalog())
      .setBinding(role, binding)
      .all()
    saveRoleBindings(proposed)
    this.roles.setBinding(role, proposed[role])
    return this.roles.all()
  }

  // --- Orchestration disciplinée (le cœur) ---
  async runTask(
    task: string,
    onStep?: (s: OrchestrationStep) => void,
    onPhase?: (p: OrchestrationPhase) => void,
    onDelta?: (step: 'exec' | 'judge', delta: string) => void,
    signal?: AbortSignal,
    collectedContext?: string,
    /** SURVIE NIVEAU 3 : acquis d'un run interrompu → reprise à la phase suivante. */
    resumeOutputs?: { phase: PipelinePhase; text: string }[],
    /** Conversation d'origine : persistée avec l'acquis pour qu'une reprise s'affiche au bon endroit. */
    conversationId?: string
  ): Promise<OrchestrationResult> {
    await this.taskReadiness
    return this.orchestrator.run(
      task,
      onStep,
      onPhase,
      onDelta,
      signal,
      collectedContext,
      resumeOutputs,
      conversationId
    )
  }

  /**
   * SURVIE NIVEAU 3 — run d'orchestration interrompu par la mort du process, s'il en reste un.
   * `null` = rien à reprendre (cas normal). Lecture seule : c'est l'appelant (démarrage de l'app)
   * qui décide de relancer, via `runTask(..., state.phaseOutputs)`.
   */
  resumableOrchestration(): OrchestrationRunState | null {
    return pickOrchestrationToResume(loadOrchestrationStates(this.orchestrationStateRoot))
  }

  /** Abandonne explicitement un état reprenable (l'utilisateur ne veut pas le reprendre). */
  forgetResumableOrchestration(runId: string): void {
    clearOrchestrationState(this.orchestrationStateRoot, runId)
  }

  // --- Dashboards : données RÉELLES ---
  budget(): ReturnType<CostAggregator['budgetStatus']> {
    return this.cost.budgetStatus()
  }
  costByRole(): ReturnType<CostAggregator['byRole']> {
    return this.cost.byRole()
  }
  trustRanking(): ReturnType<TrustLedger['ranking']> {
    return this.trust.ranking()
  }
  /** Gate déterministe évalué sur les VRAIS runs vivants (plus de démo hardcodée). */
  async runsWithGate(): Promise<Array<RunEntry & { blocked: boolean }>> {
    return (await this.listRuns()).map((r) => ({ ...r, blocked: isBlocked(r.summary) }))
  }
  kaizenPatterns(jsonl: string): ReturnType<typeof recurrentPatterns> {
    return recurrentPatterns(parseJsonl(jsonl))
  }

  // --- Graphe 3D / brain (données réelles disque) ---
  listBrains(): BrainGraphRef[] {
    return scanBrainGraphs()
  }
  loadBrainGraph(
    path: string,
    lod?: number,
    community?: number
  ): ReturnType<typeof loadBrainGraph> {
    const key = `${path}\u0000${lod ?? 300}\u0000${community ?? ''}`
    const cached = this.brainGraphCache.get(key)
    if (cached) return cached
    const graph = loadBrainGraph(path, lod, community)
    this.brainGraphCache.set(key, graph)
    return graph
  }
  loadBrainNeighborhood(path: string, nodeId: string): ReturnType<typeof loadBrainNeighborhood> {
    const key = `${path}\u0000neighbourhood\u0000${nodeId}`
    const cached = this.brainGraphCache.get(key)
    if (cached) return cached
    const graph = loadBrainNeighborhood(path, nodeId)
    this.brainGraphCache.set(key, graph)
    return graph
  }
  readNodeFile(path: string): ReturnType<typeof readNodeFile> {
    return readNodeFile(path)
  }
  searchBrain(path: string, query: string): ReturnType<typeof searchVaultBrainNotes> {
    return searchVaultBrainNotes(path, query)
  }
  listRuns(): Promise<RunEntry[]> {
    return scanRuns()
  }
}
