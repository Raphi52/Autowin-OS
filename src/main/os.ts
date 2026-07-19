/**
 * Façade AutowinOS — câble ensemble les modules RÉELLEMENT utilisés en un seul
 * objet applicatif. Point d'intégration unique consommé par index.ts (IPC).
 * Principe : rien d'exposé ici n'est mort — chaque méthode a un appelant réel
 * (chat, orchestration, dashboards, graphe 3D).
 */
import { ProviderRegistry } from './providers/registry'
import { ClaudeCliAdapter } from './providers/claude'
import { CodexAdapter } from './providers/codex'
import type { Message } from './providers/types'
import { loadKitSoul } from './kit'
import { RoleModelConfig, type Role, type RoleBinding } from './roles'
import { loadRoleBindings, saveRoleBindings } from './role-store'
// fix-ok: refonte qualité (demande user « refais comme en fable ») — purge du mort, pas un blind-fix.
import { AuthoritySas } from './authority/sas'
import { CostAggregator } from './dashboards/cost'
import { isBlocked } from './dashboards/runs'
import { recurrentPatterns, parseJsonl } from './dashboards/kaizen'
import { loadBrainGraph, scanBrainGraphs, readNodeFile, type BrainGraphRef } from './viz/fs-brains'
import { scanRuns, type RunEntry } from './dashboards/runs-scan'
import { ConversationStore } from './store/conversations'
import { TrustLedger } from './trust/ledger'
import { Orchestrator, type OrchestrationResult, type OrchestrationStep } from './orchestrator'
import { composeHarnessSnapshot, type HarnessSnapshot } from './harness/snapshot'
import { listHermesControls } from './hermes-controls'
import { listClaudeHooks } from './claude-hooks'
import { listBehaviourFiles } from './behaviour-files'
import { listSessions } from './activity/transcripts'

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

/** Noyau applicatif : une instance partagée, injectée dans les handlers IPC. */
export class AutowinOS {
  readonly registry: ProviderRegistry
  readonly roles = new RoleModelConfig(loadRoleBindings()) // restaure la config persistée
  readonly authority = new AuthoritySas()
  readonly cost = new CostAggregator()
  readonly conversations = new ConversationStore()
  readonly trust = new TrustLedger()
  readonly orchestrator: Orchestrator

  constructor() {
    this.registry = new ProviderRegistry(loadKitSoul())
      .register(new ClaudeCliAdapter())
      .register(new CodexAdapter())
    this.orchestrator = new Orchestrator({
      registry: this.registry,
      roles: this.roles,
      cost: this.cost,
      trust: this.trust,
      authority: this.authority
    })
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

  /** Change le binding d'un rôle ET persiste sur disque. */
  setRole(role: Role, binding: RoleBinding): Record<Role, RoleBinding> {
    const all = this.roles.setBinding(role, binding).all()
    saveRoleBindings(all)
    return all
  }

  // --- Orchestration disciplinée (le cœur) ---
  runTask(task: string, onStep?: (s: OrchestrationStep) => void): Promise<OrchestrationResult> {
    return this.orchestrator.run(task, onStep)
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
    return loadBrainGraph(path, lod, community)
  }
  readNodeFile(path: string): ReturnType<typeof readNodeFile> {
    return readNodeFile(path)
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
      settleWithin(listHermesControls('skills'), 3500, null),
      settleWithin(listHermesControls('tools'), 3500, null),
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
          hermes: behaviour.filter((f) => f.engine === 'hermes').length
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
