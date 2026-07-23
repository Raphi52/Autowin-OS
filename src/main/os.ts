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
import { composeHarnessSnapshot, type HarnessSnapshot } from './harness/snapshot'
import { listCapabilities } from './capability-controls'
import { listClaudeHooks } from './claude-hooks'
import { defaultBehaviourWorkspace, listBehaviourFiles } from './behaviour-files'
import { listSessions } from './activity/transcripts'
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

/** Course bornée : rend `fallback` si la promesse dépasse `ms` (sonde jamais bloquante). */
async function settleWithin<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } catch {
    return fallback
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Lecture synchrone défensive : `fallback` si la source jette (partage hors ligne…). */
function safeSync<T>(read: () => T, fallback: T): T {
  try {
    return read()
  } catch {
    return fallback
  }
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

  constructor() {
    this.registry = new ProviderRegistry(loadKitSoul())
      .register(new ClaudeCliAdapter())
      .register(new CodexAdapter())
      .register(new KimiCliAdapter())
    this.orchestrator = new Orchestrator({
      registry: this.registry,
      roles: this.roles,
      cost: this.cost,
      trust: this.trust,
      authority: this.authority,
      executionWorkspace: resolveExecutionWorkspace(),
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

  /** Change le binding d'un rôle ET persiste sur disque. */
  setRole(role: Role, binding: RoleBinding): Record<Role, RoleBinding> {
    const proposed = new RoleModelConfig(this.roles.all()).setBinding(role, binding).all()
    saveRoleBindings(proposed)
    this.roles.setBinding(role, proposed[role])
    return this.roles.all()
  }

  // --- Orchestration disciplinée (le cœur) ---
  runTask(
    task: string,
    onStep?: (s: OrchestrationStep) => void,
    onPhase?: (p: OrchestrationPhase) => void,
    onDelta?: (step: 'exec' | 'judge', delta: string) => void,
    signal?: AbortSignal
  ): Promise<OrchestrationResult> {
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

  /**
   * Projection « Harnais » — lecture seule, bornée, sans chemin ni contenu.
   * Récolte des inventaires réels déjà disponibles (compteurs/étiquettes), avec
   * timeouts non bloquants ; les sources async indisponibles restent `unknown`.
   */
  async harnessSnapshot(): Promise<HarnessSnapshot> {
    const orchestrator = this.roles.getBinding('orchestrator')
    const soul = safeSync(() => loadKitSoul(), '')

    const [skills, tools, behaviour] = await Promise.all([
      settleWithin(listCapabilities('skills'), 3500, null),
      settleWithin(listCapabilities('tools'), 3500, null),
      settleWithin(listBehaviourFiles(), 3500, null)
    ])

    const hooks = safeSync(() => listClaudeHooks(), [])
    const sessions = safeSync(() => listSessions(60), [])
    const brains = safeSync(() => scanBrainGraphs(), [])
    const runs = safeSync(() => scanRuns(), [])
    const budget = this.cost.budgetStatus()

    const behaviourByEngine = behaviour
      ? {
          codex: behaviour.filter((f) => f.engine === 'codex').length,
          claude: behaviour.filter((f) => f.engine === 'claude').length,
          autowin: behaviour.filter((f) => f.engine === 'autowin').length
        }
      : null

    return composeHarnessSnapshot({
      generatedAt: new Date().toISOString(),
      roleBindings: this.roles.all(),
      providers: this.registry.ids(),
      activeModel: {
        id: orchestrator.model ?? `${orchestrator.provider} · modèle par défaut`,
        provider: orchestrator.provider
      },
      kit: { injected: soul.length > 0, size: soul.length },
      counts: {
        skills: skills ? skills.length : null,
        tools: tools ? tools.length : null,
        hooks: hooks.length,
        behaviour: behaviour ? behaviour.length : null,
        conversations: this.conversations.list().length,
        sessions: sessions.length,
        trustModels: this.trust.ranking().length
      },
      hookEvents: [...new Set(hooks.map((h) => h.event))].slice(0, 8),
      behaviourByEngine,
      brains: brains.map((b) => ({
        id: b.id,
        label: b.label,
        kind: b.kind,
        sizeMb: b.sizeMb,
        themes: b.themes?.length ?? 0
      })),
      runs: {
        total: runs.length,
        blocked: runs.filter((r) => isBlocked(r.summary)).length,
        open: runs.filter((r) => r.summary.status === 'open' || r.summary.status === 'red').length
      },
      budget: { spent: budget.spent, budget: budget.budget, alert: budget.alert },
      pendingAuthority: this.authority.pending().length
    })
  }
}
