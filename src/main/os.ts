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
  type BrainRetrievalEvent,
  type OrchestrationResult,
  type OrchestrationRuntimeSnapshot,
  type OrchestrationStep,
  type OrchestrationPhase,
  type WorkflowRunOverride
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
  pickOrchestrationsToResume,
  pickOrchestrationToResume,
  pickResumeForTask,
  saveOrchestrationAgentCheckpoint,
  saveOrchestrationState,
  type OrchestrationRunState
} from './runs/orchestration-state'
import { defaultBehaviourWorkspace } from './behaviour-files'
import { WorktreeManager } from './store/worktree-manager'
import { RunWorktreeCoordinator } from './store/run-worktree-coordinator'
import type { RunLifecycleEvent } from '../shared/run-execution'
import { WorktreeRunStateStore } from './store/worktree-run-state'
import { repositoryWorktreeIdentity } from './store/worktree-repository'
import type {
  WorktreeAgentActivity,
  WorktreeConflictDiffResult,
  WorktreeRuntimeStatus
} from '../shared/worktree-activity-model'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { ensureAutowinAppData } from './app-data'
import { loadAutoClose, saveAutoClose } from './autoclose-store'
import { AUTOWIN_WORKSPACE_ENV } from '../shared/app-identity'
import { ExecutionSupervisor, type ExecutionUsageSnapshot } from './execution-supervisor'
import { compileExecutionQuote } from './execution-quote'
import { loadOrchestrationBudget } from './orchestration-budget'
import { preparePersistedRunForRelaunch, type ProcessIdentity } from './runs/run-reattach'

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
export interface FanMember {
  provider: string
  model?: string
  reasoningEffort?: ReasoningEffort
}

export interface FanOutTopology {
  scout: FanMember[]
  frame: FanMember[]
  terrain: FanMember[]
  judge: FanMember[]
}

export function selectPhaseFanOut(fanOut: FanOutTopology, phase: PipelinePhase): FanMember[] {
  return phase === 'scout' || phase === 'frame' || phase === 'terrain' ? fanOut[phase] : []
}

/** Noyau applicatif : une instance partagée, injectée dans les handlers IPC. */
export class AutowinOS {
  private readonly brainGraphCache = new Map<string, ReturnType<typeof loadBrainGraph>>()
  readonly registry: ProviderRegistry
  readonly executionSupervisor = new ExecutionSupervisor()
  readonly roles = new RoleModelConfig(loadRoleBindings()) // restaure la config persistée
  readonly authority = new AuthoritySas()
  readonly cost = new CostAggregator(undefined, join(ensureAutowinAppData(), 'cost.jsonl'))
  readonly conversations = new ConversationStore()
  readonly trust = new TrustLedger(join(ensureAutowinAppData(), 'trust.jsonl'))
  readonly orchestrator: Orchestrator
  /**
   * Workflow nommé imposé au run en cours. Les runs d'une confrontation s'enchaînent en série, donc
   * un seul à la fois — la confrontation le pose puis le retire, y compris quand le run échoue.
   */
  private activeWorkflow?: WorkflowRunOverride
  setActiveWorkflow(workflow: WorkflowRunOverride | undefined): void {
    this.activeWorkflow = workflow
  }
  readonly executionWorkspace: string
  /**
   * Source LIVE du fan-out multi-modèles, alimentée par la topology (index.ts `syncRuntimeTopology`).
   * Les blocs scout/frame/terrain/judge de la topology y déposent leurs N modèles ; l'orchestrateur les lit
   * (deps `phaseFanOut`/`judgeFanOut`). Vide par défaut → mono-modèle (rétrocompat).
   */
  private fanOut: FanOutTopology = { scout: [], frame: [], terrain: [], judge: [] }
  private taskReadiness: Promise<{ error?: unknown }> = Promise.resolve({})
  /**
   * Coordinateur worktree (volet B) : donne à chaque run de mutation une copie isolée, fusionnée en
   * full-auto (conflit → assisté). Présent seulement si le workspace est un repo git (sinon undefined
   * → comportement historique, workspace partagé). Exposé pour l'IPC d'observabilité (volet A).
   */
  readonly worktrees?: RunWorktreeCoordinator
  private worktreeRuntimeStatus!: WorktreeRuntimeStatus
  private worktreeActivityListener?: (a: WorktreeAgentActivity[]) => void
  /** Dossier des états d'orchestration reprenables (survie niveau 3). */
  private readonly orchestrationStateRoot = join(ensureAutowinAppData(), 'run-state')
  private readonly orchestrationStartedAt = new Map<string, number>()

  constructor() {
    this.registry = new ProviderRegistry(CONSTITUTION, this.executionSupervisor)
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
      try {
        const identity = repositoryWorktreeIdentity(
          join(ensureAutowinAppData(), 'worktrees'),
          executionWorkspace
        )
        const manager = new WorktreeManager({
          baseRepo: executionWorkspace,
          worktreeRoot: identity.root
        })
        this.worktrees = new RunWorktreeCoordinator({
          manager,
          stateStore: new WorktreeRunStateStore(identity.root, identity.repoId),
          onActivity: (a) => {
            this.worktreeActivityListener?.(a)
          }
        })
        this.worktreeRuntimeStatus = {
          available: true,
          workspacePath: executionWorkspace,
          repoId: identity.repoId
        }
      } catch {
        this.worktreeRuntimeStatus = {
          available: false,
          workspacePath: executionWorkspace,
          reason: 'identity-unavailable'
        }
      }
    } else {
      this.worktreeRuntimeStatus = {
        available: false,
        workspacePath: executionWorkspace,
        reason: 'not-git'
      }
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
      currentExecutionQuote: () => this.executionSupervisor.currentQuote(),
      currentExecutionUsage: () => this.executionSupervisor.currentSnapshot(),
      // Workflow nommé actif — posé le temps d'un run par la confrontation de workflows, absent le
      // reste du temps. Même portée ambiante que le devis ci-dessus.
      currentWorkflow: () => this.activeWorkflow,
      // SURVIE NIVEAU 3 : après CHAQUE phase, on persiste l'acquis du run ; à la clôture on l'efface.
      // Un kill du process main laisse donc un état reprenable → `resumableOrchestration()`.
      onPhaseCompleted: ({
        runId,
        task,
        conversationId,
        turnId,
        bindingOverride,
        runtimeSnapshot,
        phaseOutputs,
        executionQuote,
        usage,
        agents
      }) =>
        saveOrchestrationState(this.orchestrationStateRoot, {
          runId,
          task,
          ...(conversationId ? { conversationId } : {}),
          ...(turnId ? { turnId } : {}),
          ...(bindingOverride ? { bindingOverride } : {}),
          runtimeSnapshot,
          phaseOutputs,
          ...(executionQuote ? { executionQuote } : {}),
          ...(usage ? { usage } : {}),
          // Les agents CLI du run : un processus detache survit a l'app, ces references sont ce qui
          // permettra de le retrouver vivant et de relire sa sortie au lieu de tout relancer.
          ...(agents && agents.length ? { agents } : {}),
          startedAt: this.orchestrationStartedAt.get(runId) ?? Date.now(),
          updatedAt: Date.now()
        }),
      onAgentsChanged: (runId, agents) => {
        saveOrchestrationAgentCheckpoint(
          this.orchestrationStateRoot,
          runId,
          agents,
          this.executionSupervisor.currentSnapshot()
        )
      },
      onRunSettled: (runId) => {
        this.orchestrationStartedAt.delete(runId)
        clearOrchestrationState(this.orchestrationStateRoot, runId)
      },
      // Fan-out multi-modèles : les blocs topology scout/frame/terrain → phases composées ; judge → juges.
      // ≥2 modèles déposés → l'orchestrateur duplique + agrège (voir orchestrator.ts). Sinon mono.
      phaseFanOut: (phase) => selectPhaseFanOut(this.fanOut, phase),
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
          this.closeBaselines.set(
            runId,
            captureCloseBaseline(executionWorkspace, amitelBrainRoot())
          )
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
  setFanOut(next: FanOutTopology): void {
    this.fanOut = next
  }

  /** Fige l'identite complete d'un run pour que affichage, reprise et providers restent alignes. */
  captureOrchestrationRuntime(): OrchestrationRuntimeSnapshot {
    const copy = (binding: RoleBinding): RoleBinding => ({
      ...binding,
      ...(binding.phaseModel ? { phaseModel: { ...binding.phaseModel } } : {})
    })
    const current = this.roles.all()
    return {
      roles: {
        orchestrator: copy(current.orchestrator),
        subagent: copy(current.subagent),
        judge: copy(current.judge),
        scout: copy(current.scout)
      },
      phaseFanOut: {
        scout: this.fanOut.scout.map(copy),
        frame: this.fanOut.frame.map(copy),
        terrain: this.fanOut.terrain.map(copy)
      },
      judgeFanOut: this.fanOut.judge.map(copy)
    }
  }

  /** Activité worktree courante (volet A) — snapshot pour l'IPC/renderer. */
  getWorktreeActivity(): WorktreeAgentActivity[] {
    return this.worktrees ? this.worktrees.activity() : []
  }

  getWorktreeRuntimeStatus(): WorktreeRuntimeStatus {
    return (
      this.worktreeRuntimeStatus ?? {
        available: false,
        workspacePath: this.executionWorkspace,
        reason: 'identity-unavailable'
      }
    )
  }

  getWorktreeConflictDiff(agentId: string): WorktreeConflictDiffResult {
    return (
      this.worktrees?.conflictDiff(agentId) ?? {
        available: false,
        reason: 'not-conflict'
      }
    )
  }

  retryWorktreeRecovery(agentId: string): WorktreeAgentActivity | undefined {
    return this.worktrees?.retryRun(agentId)
  }

  /** Abonne l'IPC aux changements d'activité worktree (push live vers le cockpit). Idempotent. */
  onWorktreeActivity(listener: (a: WorktreeAgentActivity[]) => void): void {
    this.worktreeActivityListener = listener
  }

  /** Empêche tout run de lire la topology avant la fin de la découverte des modèles. */
  setTaskReadiness(readiness: Promise<unknown>): void {
    this.taskReadiness = readiness.then(
      () => ({}),
      (error: unknown) => ({ error })
    )
  }

  async waitUntilReady(): Promise<void> {
    // Les harness unitaires peuvent instancier le prototype sans constructeur ; en production la
    // propriété existe toujours, mais l'absence signifie naturellement « aucune barrière ».
    for (;;) {
      const observed = this.taskReadiness
      if (!observed) return
      const readiness = await observed
      // Une actualisation peut installer une nouvelle generation pendant l'attente. Valider
      // l'ancienne seulement ferait passer un alias devenu invalide entre les deux barrieres.
      if (observed !== this.taskReadiness) continue
      if (readiness && 'error' in readiness) throw readiness.error
      return
    }
  }

  // --- Conversation directe (chat) : alimente le coût réel ---
  async runChatTurn<T>(
    task: string,
    signal: AbortSignal | undefined,
    execute: () => Promise<T>,
    onUsageSettlement?: (usage: ExecutionUsageSnapshot) => void
  ): Promise<T> {
    await this.waitUntilReady()
    // Un chat deja lance depuis un run (par exemple `chat_send` pendant AgentPilot) partage
    // l'enveloppe courante. Une nouvelle AsyncLocalStorage imbriquee remettrait les compteurs a zero.
    if (this.executionSupervisor.currentQuote()) return execute()
    const settings = loadOrchestrationBudget(
      join(ensureAutowinAppData(), 'orchestration-budget.json')
    )
    const envCalls = Number(process.env.AUTOWIN_CHAT_CALL_CAP)
    const envTokens = Number(process.env.AUTOWIN_CHAT_TOKEN_CAP)
    const envUsd = Number(process.env.AUTOWIN_CHAT_USD_CAP)
    const maxProviderCalls =
      Number.isSafeInteger(envCalls) && envCalls > 0
        ? Math.min(settings.maxProviderCalls, envCalls)
        : Math.min(settings.maxProviderCalls, 6)
    const maxTotalTokens =
      Number.isSafeInteger(envTokens) && envTokens > 0
        ? Math.min(settings.maxTotalTokens, envTokens)
        : Math.min(settings.maxTotalTokens, 1_500_000)
    const defaultUsd = Number.isFinite(envUsd) && envUsd > 0 ? envUsd : 2
    const maxUsd = settings.maxUsd === null ? defaultUsd : Math.min(settings.maxUsd, defaultUsd)
    const quote = compileExecutionQuote(task || 'chat', {
      maxProviderCalls,
      maxTotalTokens,
      maxUsd
    })
    // Un tour de chat n'a ni phase ni fan-out : ses caps sont plus petits et sa concurrence est 1.
    quote.phases = []
    quote.decomposition = { mode: 'disabled', maxNodes: 1 }
    quote.limits.maxAgents = 1
    quote.limits.maxConcurrency = 1
    quote.limits.maxRecoveries = 0
    quote.limits.maxFreshTokens = Math.min(quote.limits.maxFreshTokens, maxTotalTokens)
    return this.executionSupervisor.run(quote, signal, execute, undefined, onUsageSettlement)
  }

  async chat(
    provider: string | undefined,
    role: Role | undefined,
    messages: Message[],
    onDelta: (d: string) => void
  ): Promise<{ text: string; provider: string; systemInjected: boolean }> {
    const task =
      [...messages].reverse().find((message) => message.role === 'user')?.content ?? 'chat'
    let selectedProvider = provider
    const r = await this.runChatTurn(task, undefined, () => {
      // Comme le routeur, relire APRÈS la readiness : le catalogue peut résoudre un alias pendant
      // l'attente et remplacer `codex/flagship` par son transport concret.
      const binding = this.roles.getBinding(role ?? 'orchestrator')
      const currentProvider = provider ?? binding.provider
      selectedProvider = currentProvider
      const options = provider
        ? {}
        : { model: binding.model, reasoningEffort: binding.reasoningEffort }
      return this.registry.send(currentProvider, messages, options, (c) => onDelta(c.delta))
    })
    if (r.usage) {
      this.cost.add({
        provider: selectedProvider ?? r.provider,
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
    conversationId?: string,
    /** Modèle figé pour ce run uniquement, sans mutation de la topologie globale. */
    bindingOverride?: RoleBinding,
    /** Trace immédiate de la récupération Brain, y compris si le run échoue ensuite. */
    onBrainRetrieved?: (event: BrainRetrievalEvent) => void,
    turnId?: string,
    onRunLifecycle?: (event: RunLifecycleEvent) => void,
    /** Etat budgetaire du run interrompu ; utilise uniquement avec `resumeOutputs`. */
    resumeControl?: Pick<OrchestrationRunState, 'executionQuote' | 'usage'>,
    /** Publication terminale si un provider ignore d'abord l'abort puis se règle réellement. */
    onLateUsageSettlement?: (usage: ExecutionUsageSnapshot) => void,
    /** Snapshot deja persiste par l'appelant ; absent, capture apres readiness. */
    runtimeSnapshot?: OrchestrationRuntimeSnapshot
  ): Promise<OrchestrationResult> {
    await this.waitUntilReady()
    // Certains harness historiques construisent le prototype avec un orchestrateur factice sans
    // magasin de roles. En production `roles` existe toujours ; le fallback laisse le mock intact.
    const admittedRuntime =
      runtimeSnapshot ?? (this.roles ? this.captureOrchestrationRuntime() : undefined)
    const settings = loadOrchestrationBudget(
      join(ensureAutowinAppData(), 'orchestration-budget.json')
    )
    const quote = resumeControl?.executionQuote ?? compileExecutionQuote(task, settings)
    return this.executionSupervisor.run(
      quote,
      signal,
      async () => {
        const result = await this.orchestrator.run(
          task,
          onStep,
          onPhase,
          onDelta,
          this.executionSupervisor.currentSignal(),
          collectedContext,
          resumeOutputs,
          conversationId,
          bindingOverride,
          onBrainRetrieved,
          turnId,
          onRunLifecycle,
          admittedRuntime
        )
        result.quote = quote
        result.usage = this.executionSupervisor.currentSnapshot()
        if (result.usage?.knownCostUsd !== null && result.usage?.knownCostUsd !== undefined) {
          result.costUsd = result.usage.knownCostUsd
        }
        return result
      },
      resumeControl?.usage,
      onLateUsageSettlement
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

  /** Tous les runs éligibles à la reprise automatique au démarrage, dans leur ordre de priorité. */
  resumableOrchestrations(): OrchestrationRunState[] {
    return pickOrchestrationsToResume(loadOrchestrationStates(this.orchestrationStateRoot))
  }

  /** Persiste une branche reprenable sans réécrire le checkpoint source. */
  persistCheckpointFork(
    state: OrchestrationRunState,
    ancestor: NonNullable<OrchestrationRunState['forkedFrom']>
  ): OrchestrationRunState {
    const existing = loadOrchestrationStates(this.orchestrationStateRoot)
    if (existing.some((candidate) => candidate.runId === state.runId)) {
      throw new Error(`Run de fork déjà existant : ${state.runId}`)
    }
    const now = Date.now()
    const branchState = structuredClone(state)
    delete branchState.turnId
    const fork: OrchestrationRunState = {
      ...branchState,
      runId: state.runId,
      forkedFrom: structuredClone(ancestor),
      startedAt: now,
      updatedAt: now,
      agents: []
    }
    saveOrchestrationState(this.orchestrationStateRoot, fork)
    return fork
  }

  /** Persiste la preuve de fin des providers orphelins avant de remettre leur budget au supervisor. */
  reconcileResumableOrchestrationForRelaunch(
    runId: string,
    identityOf: ProcessIdentity
  ): OrchestrationRunState | null {
    return preparePersistedRunForRelaunch(this.orchestrationStateRoot, runId, identityOf)
  }

  /**
   * Acquis reutilisable pour une tache RELANCEE dans une conversation (« reprend »). Le chemin de
   * reprise n'existait qu'au redemarrage de l'app : relancer depuis le chat repayait les phases deja
   * produites (constate le 2026-07-29). Lecture seule ; l'appelant decide.
   */
  resumableOrchestrationForTask(
    task: string,
    conversationId: string | undefined,
    nowMs = Date.now(),
    bindingOverride?: RoleBinding,
    runtimeSnapshot?: OrchestrationRuntimeSnapshot
  ): OrchestrationRunState | null {
    return pickResumeForTask(loadOrchestrationStates(this.orchestrationStateRoot), {
      task,
      conversationId,
      nowMs,
      bindingOverride,
      runtimeSnapshot
    })
  }

  /**
   * Repersiste les offsets de journal atteints après un rattachement : ce qui vient d'être montré à
   * l'utilisateur ne doit pas lui être remontré au prochain démarrage.
   */
  rememberAgentOffsets(
    runId: string,
    agents: Array<{
      token: string
      pid?: number
      identity?: string
      journalPath?: string
      offset?: number
    }>
  ): void {
    const state = loadOrchestrationStates(this.orchestrationStateRoot).find(
      (candidate) => candidate.runId === runId
    )
    if (!state) return
    saveOrchestrationState(this.orchestrationStateRoot, { ...state, agents, updatedAt: Date.now() })
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
