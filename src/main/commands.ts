import type { AutowinOS } from './os'
import type { Message } from './providers/types'
import type { Role } from './roles'
import {
  closeConvRun,
  createConvRun,
  populateConvRunSections,
  saveConvRunTrace
} from './runs/conv-runs'
import { appendConvActivity } from './activity/conv-activity'
import type { OrchestrationStep, OrchestrationPhase } from './orchestrator'
import { persistOrchestrationStep } from './activity/orchestration-observability'
import { randomUUID } from 'node:crypto'
import {
  decideConversationCapability,
  type ConversationAuthorityMode
} from './conversation-capabilities'

/**
 * Bus de commandes de l'app — le PLAN DE CONTRÔLE que les agents pilotent.
 * Chaque commande mute l'état applicatif et DIFFUSE (broadcast) le changement au
 * renderer (l'UI se met à jour en direct → l'humain ET l'agent voient l'effet).
 * Le catalogue est donné au modèle ; l'agent émet des commandes, on les exécute ici.
 */
export interface CommandSpec {
  name: string
  description: string
  authority?: 'automatic' | 'sensitive' | 'destructive'
  args: Record<string, string> // nom → description courte du type
  annotations?: {
    readOnlyHint: boolean
    destructiveHint: boolean
    idempotentHint: boolean
    openWorldHint: boolean
  }
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
  | { type: 'orchestrate-phase'; convId?: string; runPath?: string; phase: OrchestrationPhase }
  | {
      type: 'orchestrate-delta'
      convId?: string
      runPath?: string
      deltaStep: 'exec' | 'judge'
      delta: string
    }
  | { type: 'orchestrate-step'; convId?: string; runPath?: string; step: OrchestrationStep }
  | { type: 'orchestrate-end'; convId?: string; runPath?: string; status: 'green' | 'red' }

const CATALOG: CommandSpec[] = [
  {
    name: 'navigate',
    description: 'Afficher une vue',
    args: { tab: 'chat|memory|agents' },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: 'chat_send',
    description: 'Envoyer un message de chat',
    args: { message: 'texte', provider: 'claude|codex (optionnel)', role: 'rôle (optionnel)' }
  },
  {
    name: 'orchestrate',
    description:
      'Lancer un agent de développement capable de lire, modifier et tester le code ou les fichiers du workspace',
    args: { task: 'la tâche' },
    authority: 'sensitive',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  {
    name: 'create_conversation',
    description: 'Créer une conversation',
    args: { title: 'titre', category: 'claude|codex|hermes' },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  },
  {
    name: 'rename_conversation',
    description: 'Renommer',
    args: { id: 'id', title: 'nouveau titre' },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: 'remove_conversation',
    description: 'Supprimer',
    args: { id: 'id' },
    authority: 'destructive',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: 'set_role',
    description: 'Régler le modèle d’un rôle',
    args: {
      role: 'orchestrator|subagent|judge|scout',
      provider: 'claude|codex',
      model: 'modèle (optionnel)'
    },
    authority: 'sensitive',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: 'attach_run',
    description: 'Attacher un RUN.md (workflow) existant à la conversation courante',
    args: { path: 'chemin du RUN.md', conversationId: 'id (optionnel, défaut = conv active)' },
    authority: 'sensitive',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: 'load_graph',
    description: 'Charger un graphe brain (par id)',
    args: { brainId: 'id du brain' },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  { name: 'get_state', description: 'Relire l’état courant de l’app', args: {} }
]

const DEFAULT_COMMAND_ANNOTATIONS: NonNullable<CommandSpec['annotations']> = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
}

const SECRET_KEY = /(?:api[_-]?key|token|secret|password|credential|authorization)/i

function redactedArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  if (name === 'orchestrate') return { task: '[redacted]' }
  if (name === 'attach_run') return { path: '[redacted]', conversationId: '[redacted]' }
  if (name === 'chat_send')
    return { message: '[redacted]', provider: args.provider, role: args.role }
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => [key, SECRET_KEY.test(key) ? '[redacted]' : value])
  )
}

function safePreview(value: unknown, fallback: string): string {
  const text = String(value ?? '').trim()
  if (
    !text ||
    SECRET_KEY.test(text) ||
    /(?:bearer\s+|token\s*[=:]|secret\s*[=:]|password\s*[=:]|\bsk-[a-z0-9_-]+)/i.test(text)
  )
    return fallback
  return text.replace(/\s+/g, ' ').slice(0, 96)
}

function approvalQuestion(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'remove_conversation':
      return 'Supprimer définitivement cette conversation ?'
    case 'attach_run':
      return `Attacher le RUN.md « ${safePreview(
        String(args.path ?? '')
          .split(/[\\/]/)
          .pop(),
        'nom masqué'
      )} » à la conversation active ?`
    case 'set_role':
      return `Modifier le rôle ${safePreview(args.role, 'sélectionné')} vers ${safePreview(args.provider, 'fournisseur masqué')}${args.model ? ` / ${safePreview(args.model, 'modèle masqué')}` : ''} ?`
    case 'orchestrate':
      return `Lancer l’orchestration : « ${safePreview(args.task, 'tâche masquée car sensible')} » ?`
    default:
      return 'Autoriser cette action sensible ?'
  }
}

export class AppCommandBus {
  private tab = 'chat'
  /** Hook de traçage (ledger) — chaque commande exécutée y laisse une ligne. */
  trace?: (name: string, args: Record<string, unknown>, ok: boolean) => void
  /** Conversation active (contexte posé par le chat) : les workflows créés s'y rattachent. */
  activeConversationId?: string
  private readonly pendingActions = new Map<
    string,
    { name: string; args: Record<string, unknown>; action: () => Promise<unknown> }
  >()
  /** Orchestrations en vol, par conversation : permet de STOPPER le sous-agent. */
  private readonly activeOrchestrations = new Map<string, AbortController>()

  /** Abort l'orchestration (sous-agent/juge) en cours pour une conversation. */
  abortOrchestration(convId: string): boolean {
    const controller = this.activeOrchestrations.get(convId)
    if (!controller) return false
    controller.abort()
    return true
  }
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
    return CATALOG.map((command) => ({
      ...command,
      annotations:
        command.annotations ??
        (command.name === 'get_state'
          ? { ...DEFAULT_COMMAND_ANNOTATIONS, readOnlyHint: true, idempotentHint: true }
          : DEFAULT_COMMAND_ANNOTATIONS)
    }))
  }

  /** Consomme une approbation UI ; elle n'est volontairement pas exposée au modèle. */
  async resolveDecision(id: string, choice: unknown): Promise<unknown> {
    const resolution = this.os.authority.resolve(id, choice)
    const pending = this.pendingActions.get(id)
    this.pendingActions.delete(id)
    this.trace?.(
      'authority_decision',
      { action: pending?.name ?? 'unknown', choice: String(choice), by: resolution.by },
      true
    )
    this.broadcast({ type: 'refresh', scope: 'decisions' })
    if (!pending || choice !== 'approve') return resolution
    try {
      const data = await pending.action()
      this.trace?.(pending.name, pending.args, true)
      this.broadcast({ type: 'refresh', scope: 'conversations' })
      this.broadcast({ type: 'refresh', scope: 'workflows' })
      return { ...resolution, executed: true, data }
    } catch (error) {
      this.trace?.(pending.name, pending.args, false)
      throw error
    }
  }

  sweepExpired(): unknown[] {
    const resolutions = this.os.authority.sweepExpired()
    for (const resolution of resolutions) {
      const pending = this.pendingActions.get(resolution.id)
      this.pendingActions.delete(resolution.id)
      this.trace?.(
        'authority_decision',
        { action: pending?.name ?? 'unknown', choice: 'cancel', by: resolution.by },
        true
      )
    }
    if (resolutions.length) this.broadcast({ type: 'refresh', scope: 'decisions' })
    return resolutions
  }

  private deferSensitiveAction(
    name: string,
    args: Record<string, unknown>,
    action: () => Promise<unknown>
  ): { pendingApproval: true; decisionId: string } {
    const decisionId = this.os.authority.propose({
      question: approvalQuestion(name, args),
      options: ['approve', 'cancel'],
      safeDefault: 'cancel',
      ttlMs: 15 * 60_000
    })
    this.pendingActions.set(decisionId, { name, args: redactedArgs(name, args), action })
    this.broadcast({ type: 'refresh', scope: 'decisions' })
    return { pendingApproval: true, decisionId }
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
  async exec(
    name: string,
    args: Record<string, unknown> = {},
    conversationId?: string,
    authorityMode: ConversationAuthorityMode = 'ask'
  ): Promise<CommandResult> {
    try {
      const specification = this.catalog().find((command) => command.name === name)
      if (!specification) throw new Error(`Commande inconnue: ${name}`)
      const decision = decideConversationCapability({
        mode: authorityMode,
        mutates: !specification.annotations?.readOnlyHint,
        authority: specification.authority ?? 'automatic'
      })
      if (decision === 'deny') {
        this.trace?.(name, redactedArgs(name, args), false)
        return { ok: false, error: `Action interdite en mode Plan: ${name}` }
      }
      if (decision === 'confirm') {
        const pending = this.deferSensitiveAction(name, args, () =>
          this.run(name, args, conversationId)
        )
        return { ok: true, data: pending }
      }
      const data = await this.run(name, args, conversationId)
      this.trace?.(name, redactedArgs(name, args), true)
      return { ok: true, data }
    } catch (e) {
      this.trace?.(name, redactedArgs(name, args), false)
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  private async run(
    name: string,
    a: Record<string, unknown>,
    conversationId?: string
  ): Promise<unknown> {
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
        // Priorité à args.conversationId : un pilotage PROGRAMMATIQUE (agent, driver) peut
        // cibler une vraie conversation sans passer par l'UI (sinon fallback __autonomous__,
        // non ouvrable depuis le badge « agents actif »).
        const convId =
          (typeof a.conversationId === 'string' && a.conversationId) ||
          conversationId ||
          this.activeConversationId ||
          '__autonomous__'
        const task = s('task')
        const runPath = createConvRun(convId, task)
        const orchestrationTurnId = randomUUID()
        const steps: OrchestrationStep[] = []
        // Sous-agent STOPPABLE : un AbortController par conversation, coupé par abortOrchestration.
        const abortController = new AbortController()
        this.activeOrchestrations.set(convId, abortController)
        this.broadcast({ type: 'orchestrate-start', convId, runPath, task })
        try {
          const r = await this.os.runTask(
            task,
            (step) => {
              steps.push(step)
              persistOrchestrationStep(step, {
                conversationId: convId,
                turnId: orchestrationTurnId,
                iteration: step.step === 'exec' ? 0 : 1
              })
              // A3 — peuplement LIVE du RUN.md : à chaque phase exec terminée, on réécrit le
              // livrable dans le RUN.md que Workflows affiche (au lieu d'un template vide 7 min).
              if (runPath && step.step === 'exec' && step.text) {
                const livePhases = steps
                  .filter((s) => s.step === 'exec' && s.text)
                  .map((s) => ({
                    phase: (s.detail ?? '').replace(/^phase /, '').replace(/ \(réparation\)$/, '') || 'build',
                    text: s.text as string
                  }))
                populateConvRunSections(runPath, livePhases)
              }
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
            },
            (phase) => {
              this.broadcast({ type: 'orchestrate-phase', convId, runPath, phase })
            },
            (step, delta) => {
              this.broadcast({ type: 'orchestrate-delta', convId, runPath, deltaStep: step, delta })
            },
            abortController.signal
          )
          if (runPath) {
            saveConvRunTrace(runPath, steps)
            populateConvRunSections(runPath, r.phaseOutputs) // J2 — RUN.md peuplé du vrai livrable
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
          // Gate bloqué → une décision d'autorité est ouverte : la surfacer TOUT DE SUITE.
          if (r.gateBlocked) this.broadcast({ type: 'refresh', scope: 'decisions' })
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
        } finally {
          this.activeOrchestrations.delete(convId)
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
        const id = s('id')
        return { removed: this.os.conversations.remove(id) }
      }
      case 'set_role': {
        const all = this.os.setRole(s('role') as Role, {
          provider: s('provider'),
          model: a.model ? s('model') : undefined
        })
        this.broadcast({ type: 'refresh', scope: 'roles' })
        return all
      }
      case 'attach_run': {
        const convId =
          (a.conversationId
            ? s('conversationId')
            : (conversationId ?? this.activeConversationId)) ?? ''
        if (!convId) throw new Error('aucune conversation active pour attacher le run')
        const path = s('path')
        const c = this.os.conversations.attachRun(convId, path)
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
