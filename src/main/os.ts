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
import type { Message } from './providers/types'
import { loadKitSoul } from './kit'
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
import { regimePhases } from './task-regime'
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

  constructor() {
    this.registry = new ProviderRegistry(loadKitSoul())
      .register(new ClaudeCliAdapter())
      .register(new CodexAdapter())
      .register(new KimiCliAdapter())
    const executionWorkspace = resolveExecutionWorkspace()
    this.executionWorkspace = executionWorkspace
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
      worktrees: this.worktrees,
      // Pipeline ADAPTATIF (proportionnalité) : le régime de la tâche choisit le sous-ensemble de
      // phases (trivial → build seul ; standard → frame+build ; critical → les 5 scout→clean), puis
      // le juge (rôle distinct). Déterministe/générique (task-regime.ts). Économise tokens + latence
      // sur les tâches simples sans jamais sous-traiter les complexes (doute → critical).
      classifyPhases: regimePhases,
      // Fan-out multi-modèles : les blocs topology scout/frame → phases de divergence ; judge → juges.
      // ≥2 modèles déposés → l'orchestrateur duplique + agrège (voir orchestrator.ts). Sinon mono.
      phaseFanOut: (phase) =>
        phase === 'scout' || phase === 'frame' ? this.fanOut[phase] : [],
      judgeFanOut: () => this.fanOut.judge
    })
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

  startKimiLogin(): void {
    const kimi = this.registry.get('kimi')
    if (!(kimi instanceof KimiCliAdapter)) throw new Error('Pont Kimi Code indisponible.')
    kimi.startLogin()
  }

  /**
   * Lance le login OFFICIEL d'un provider (bouton « Se reconnecter » de la page Routeur).
   * kimi → adapter (exe résolu) ; claude/codex → terminal. L'app ne capture aucun credential.
   */
  startProviderLogin(provider: string): void {
    const plan = planProviderLogin(provider)
    if (plan.kind === 'adapter') {
      this.startKimiLogin()
      return
    }
    // codex : `npm run codex:login` doit tourner à la racine du repo (dev) → cwd = process.cwd().
    spawnLoginTerminal(plan.command, provider === 'codex' ? { cwd: process.cwd() } : {})
  }

  /** Change le binding d'un rôle ET persiste sur disque. */
  setRole(role: Role, binding: RoleBinding): Record<Role, RoleBinding> {
    const proposed = new RoleModelConfig(this.roles.all()).setBinding(role, binding).all()
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
    signal?: AbortSignal
  ): Promise<OrchestrationResult> {
    await this.taskReadiness
    return this.orchestrator.run(task, onStep, onPhase, onDelta, signal)
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
  runsWithGate(): Array<RunEntry & { blocked: boolean }> {
    return this.listRuns().map((r) => ({ ...r, blocked: isBlocked(r.summary) }))
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
  listRuns(): RunEntry[] {
    return scanRuns()
  }
}
