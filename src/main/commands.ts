import type { AutowinOS } from './os'
import type { Message } from './providers/types'
import type { Role } from './roles'
import { closeConvRun, createConvRun, saveConvRunTrace } from './runs/conv-runs'
import { appendConvActivity } from './activity/conv-activity'
import type { OrchestrationStep } from './orchestrator'

/**
 * Bus de commandes de l'app — le PLAN DE CONTRÔLE que les agents pilotent.
 * Chaque commande mute l'état applicatif et DIFFUSE (broadcast) le changement au
 * renderer (l'UI se met à jour en direct → l'humain ET l'agent voient l'effet).
 * Le catalogue est donné au modèle ; l'agent émet des commandes, on les exécute ici.
 */
export interface CommandSpec {
  name: string
  description: string
  args: Record<string, string> // nom → description courte du type
}
export interface CommandResult {
  ok: boolean
  data?: unknown
  error?: string
}

/** Instantané de l'état que l'agent PEUT VOIR (ce qu'il pilote). */
export interface AppSnapshot {
  tab: string
  activeConversationId?: string
  providers: string[]
  roles: Record<string, { provider: string; model?: string }>
  conversations: Array<{ id: string; title: string; category: string }>
  pendingDecisions: Array<{ id: string; question: string }>
  runs: Array<{ subject: string; status: string; blocked: boolean }>
  budgetUsd: number
}

export type AppEvent =
  | { type: 'navigate'; tab: string }
  | { type: 'refresh'; scope: string }
  | { type: 'toast'; text: string }
  // Orchestration LIVE (statut temps réel + fil des sous-agents), diffusée par étape.
  | { type: 'orchestrate-start'; convId?: string; runPath?: string; task: string }
  | { type: 'orchestrate-step'; convId?: string; runPath?: string; step: OrchestrationStep }
  | { type: 'orchestrate-end'; convId?: string; runPath?: string; status: 'green' | 'red' }

const CATALOG: CommandSpec[] = [
  {
    name: 'navigate',
    description: 'Afficher une vue',
    args: { tab: 'chat|memory|agents' }
  },
  {
    name: 'chat_send',
    description: 'Envoyer un message de chat',
    args: { message: 'texte', provider: 'claude|codex (optionnel)', role: 'rôle (optionnel)' }
  },
  {
    name: 'orchestrate',
    description: 'Lancer une orchestration disciplinée',
    args: { task: 'la tâche' }
  },
  {
    name: 'create_conversation',
    description: 'Créer une conversation',
    args: { title: 'titre', category: 'claude|codex|hermes' }
  },
  {
    name: 'rename_conversation',
    description: 'Renommer',
    args: { id: 'id', title: 'nouveau titre' }
  },
  { name: 'remove_conversation', description: 'Supprimer', args: { id: 'id' } },
  {
    name: 'set_role',
    description: 'Régler le modèle d’un rôle',
    args: {
      role: 'orchestrator|subagent|judge|scout',
      provider: 'claude|codex',
      model: 'modèle (optionnel)'
    }
  },
  {
    name: 'resolve_decision',
    description: 'Trancher une décision du sas',
    args: { id: 'id', choice: 'option' }
  },
  {
    name: 'attach_run',
    description: 'Attacher un RUN.md (workflow) existant à la conversation courante',
    args: { path: 'chemin du RUN.md', conversationId: 'id (optionnel, défaut = conv active)' }
  },
  {
    name: 'load_graph',
    description: 'Charger un graphe brain (par id)',
    args: { brainId: 'id du brain' }
  },
  { name: 'get_state', description: 'Relire l’état courant de l’app', args: {} }
]

export class AppCommandBus {
  private tab = 'chat'
  /** Hook de traçage (ledger) — chaque commande exécutée y laisse une ligne. */
  trace?: (name: string, args: Record<string, unknown>, ok: boolean) => void
  /** Conversation active (contexte posé par le chat) : les workflows créés s'y rattachent. */
  activeConversationId?: string
  constructor(
    private readonly os: AutowinOS,
    private readonly broadcast: (e: AppEvent) => void,
    private readonly onChat?: (
      provider: string | undefined,
      role: string | undefined,
      msg: string
    ) => Promise<string>
  ) {}

  catalog(): CommandSpec[] {
    return CATALOG
  }

  async snapshot(): Promise<AppSnapshot> {
    const runs = this.os.runsWithGate()
    return {
      tab: this.tab,
      activeConversationId: this.activeConversationId,
      providers: this.os.registry.ids(),
      roles: this.os.roles.all(),
      conversations: this.os.conversations
        .list()
        .map((c) => ({ id: c.id, title: c.title, category: c.category })),
      pendingDecisions: (
        this.os.authority.pending() as Array<{ id: string; question: string }>
      ).map((d) => ({ id: d.id, question: d.question })),
      runs: runs
        .slice(0, 12)
        .map((r) => ({ subject: r.subject, status: r.summary.status, blocked: r.blocked })),
      budgetUsd: this.os.budget().spent
    }
  }

  /** Exécute une commande nommée, mute l'app, diffuse le changement. */
  async exec(name: string, args: Record<string, unknown> = {}): Promise<CommandResult> {
    try {
      const data = await this.run(name, args)
      this.trace?.(name, args, true)
      return { ok: true, data }
    } catch (e) {
      this.trace?.(name, args, false)
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  private async run(name: string, a: Record<string, unknown>): Promise<unknown> {
    const s = (k: string): string => String(a[k] ?? '')
    switch (name) {
      case 'navigate': {
        this.tab = s('tab')
        this.broadcast({ type: 'navigate', tab: this.tab })
        return { tab: this.tab }
      }
      case 'chat_send': {
        const text = this.onChat
          ? await this.onChat(
              a.provider ? s('provider') : undefined,
              a.role ? s('role') : undefined,
              s('message')
            )
          : (
              await this.os.chat(
                a.provider ? s('provider') : undefined,
                (a.role ? s('role') : undefined) as Role | undefined,
                [{ role: 'user', content: s('message') } as Message],
                () => {}
              )
            ).text
        this.broadcast({ type: 'refresh', scope: 'chat' })
        return { reply: text }
      }
      case 'orchestrate': {
        // Une tâche lancée depuis une conversation laisse SON workflow (RUN.md) dans
        // le dossier de la conversation — clos green/red selon le gate, red si crash.
        // Les ÉTAPES (sous-agent → juge → gate) sont diffusées LIVE + persistées (fil sous-agents).
        const convId = this.activeConversationId
        const task = s('task')
        const runPath = convId ? createConvRun(convId, task) : undefined
        const steps: OrchestrationStep[] = []
        this.broadcast({ type: 'orchestrate-start', convId, runPath, task })
        try {
          const r = await this.os.runTask(task, (step) => {
            steps.push(step)
            this.broadcast({ type: 'orchestrate-step', convId, runPath, step })
            // Journal d'activité de la conversation : chaque étape facturée + coût tokens.
            if (convId) {
              const s = step as OrchestrationStep & {
                inputTokens?: number
                outputTokens?: number
              }
              appendConvActivity(convId, {
                kind: step.step,
                label: step.role ?? step.step,
                provider: step.provider,
                inputTokens: s.inputTokens,
                outputTokens: s.outputTokens ?? step.tokens,
                costUsd: step.costUsd,
                text: step.text ?? step.detail
              })
            }
          })
          if (runPath) {
            saveConvRunTrace(runPath, steps)
            closeConvRun(
              runPath,
              !r.gateBlocked,
              r.gateBlocked
                ? `Gate BLOQUÉ: ${r.gateReasons.join('; ')}`
                : `Juge: validé — clôture autorisée (coût ${r.costUsd.toFixed(4)} $).`
            )
          }
          this.broadcast({
            type: 'orchestrate-end',
            convId,
            runPath,
            status: r.gateBlocked ? 'red' : 'green'
          })
          this.broadcast({ type: 'refresh', scope: 'workflows' })
          this.broadcast({ type: 'refresh', scope: 'orchestration' })
          return {
            valid: r.valid,
            gateBlocked: r.gateBlocked,
            costUsd: r.costUsd,
            result: r.result,
            runPath
          }
        } catch (e) {
          if (runPath) {
            saveConvRunTrace(runPath, steps)
            closeConvRun(runPath, false, `Orchestration en échec: ${String(e).slice(0, 120)}`)
          }
          this.broadcast({ type: 'orchestrate-end', convId, runPath, status: 'red' })
          this.broadcast({ type: 'refresh', scope: 'workflows' })
          throw e
        }
      }
      case 'create_conversation': {
        const c = this.os.conversations.create({
          title: s('title'),
          category: s('category') || 'claude',
          provider: s('category') || 'claude'
        })
        this.broadcast({ type: 'refresh', scope: 'conversations' })
        return c
      }
      case 'rename_conversation': {
        const c = this.os.conversations.rename(s('id'), s('title'))
        this.broadcast({ type: 'refresh', scope: 'conversations' })
        return c
      }
      case 'remove_conversation': {
        const ok = this.os.conversations.remove(s('id'))
        this.broadcast({ type: 'refresh', scope: 'conversations' })
        return { removed: ok }
      }
      case 'set_role': {
        const all = this.os.setRole(s('role') as Role, {
          provider: s('provider'),
          model: a.model ? s('model') : undefined
        })
        this.broadcast({ type: 'refresh', scope: 'roles' })
        return all
      }
      case 'resolve_decision': {
        const r = this.os.authority.resolve(s('id'), s('choice'))
        this.broadcast({ type: 'refresh', scope: 'decisions' })
        return r
      }
      case 'attach_run': {
        const convId = (a.conversationId ? s('conversationId') : this.activeConversationId) ?? ''
        if (!convId) throw new Error('aucune conversation active pour attacher le run')
        const c = this.os.conversations.attachRun(convId, s('path'))
        this.broadcast({ type: 'refresh', scope: 'workflows' })
        return { conversation: c.id, runPaths: c.runPaths }
      }
      case 'load_graph': {
        const brain = this.os.listBrains().find((b) => b.id === s('brainId'))
        if (!brain) throw new Error(`brain inconnu: ${s('brainId')}`)
        const g = this.os.loadBrainGraph(brain.path, 300)
        this.broadcast({ type: 'navigate', tab: 'memory' })
        return { brain: brain.id, nodes: g.nodes.length, links: g.links.length }
      }
      case 'get_state':
        return await this.snapshot()
      default:
        throw new Error(`commande inconnue: ${name}`)
    }
  }
}
