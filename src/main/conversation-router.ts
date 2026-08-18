import { randomUUID } from 'node:crypto'
import type { ProviderRegistry } from './providers/registry'
import type { SendResult, Usage } from './providers/types'
import type { RoleModelConfig } from './roles'
import type { Conversation, ConversationStore, Msg } from './store/conversations'
import { compileExecutionQuote } from './execution-quote'
import type { ExecutionSupervisor } from './execution-supervisor'
import { routeSkillRequest } from './skill-routing'

const ROUTE_CONFIDENCE_THRESHOLD = 0.9
const CONTEXT_MESSAGE_LIMIT = 10
const CONTEXT_MESSAGE_CHARS = 600
const TITLE_CHARS = 60

const ROUTER_SYSTEM = `Tu es le routeur de conversations d’Autowin OS.
Décide si le NOUVEAU message poursuit le même objectif que le CONTEXTE ACTUEL.
Réponds uniquement avec un objet JSON :
{"route":"current|new","confidence":0.0,"reason":"related|follow-up|new-topic|uncertain","title":""}

Règles :
- current par défaut, notamment pour une correction, un détail, un pronom, un suivi court ou une ambiguïté ;
- new uniquement si le message ouvre clairement un autre sujet ou livrable sans dépendre du contexte actuel ;
- confidence >= 0.90 uniquement quand la rupture de sujet est nette ;
- title : titre bref du nouveau sujet, sans donnée sensible, uniquement pour route=new.`

export type ConversationRouteReason =
  | 'related'
  | 'follow-up'
  | 'new-topic'
  | 'uncertain'
  | 'empty-context'
  | 'explicit-command'
  | 'local-follow-up'
  | 'fallback'

export interface ConversationRouteDecision {
  route: 'current' | 'new'
  confidence: number
  reason: ConversationRouteReason
  title?: string
  provider?: string
  model?: string
  reasoningEffort?: string
  usage?: Usage
}

function clip(value: string, cap: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > cap ? `${normalized.slice(0, cap)}…` : normalized
}

function parseDecision(text: string): Omit<ConversationRouteDecision, 'provider' | 'model'> | null {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>
    const confidence =
      typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
        ? Math.min(1, Math.max(0, parsed.confidence))
        : 0
    const reason = ['related', 'follow-up', 'new-topic', 'uncertain'].includes(
      String(parsed.reason)
    )
      ? (String(parsed.reason) as ConversationRouteReason)
      : 'uncertain'
    const title = typeof parsed.title === 'string' ? clip(parsed.title, TITLE_CHARS) : ''
    const wantsNew =
      parsed.route === 'new' && reason === 'new-topic' && confidence >= ROUTE_CONFIDENCE_THRESHOLD
    return {
      route: wantsNew ? 'new' : 'current',
      confidence,
      reason: wantsNew ? 'new-topic' : reason,
      ...(wantsNew && title ? { title } : {})
    }
  } catch {
    return null
  }
}

function contextMessages(messages: Msg[]): Array<{ role: Msg['role']; content: string }> {
  return messages.slice(-CONTEXT_MESSAGE_LIMIT).map((message) => ({
    role: message.role,
    content: clip(message.content, CONTEXT_MESSAGE_CHARS)
  }))
}

function isDeterministicFollowUp(value: string, hasAttachments: boolean): boolean {
  if (hasAttachments) return false
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized || normalized.length > 160) return false
  return /^(?:continue|poursuis|relance|recommence|go\b|vas[- ]?y\b|vazy\b|fais[- ]le\b|corrige (?:ça|cela)\b)/i.test(
    normalized
  )
}

export class ConversationRouter {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly roles: RoleModelConfig,
    private readonly executionSupervisor: ExecutionSupervisor,
    private readonly waitUntilReady: () => Promise<void> = async () => {}
  ) {}

  async decide(
    conversation: Conversation,
    incomingMessage: string,
    attachmentNames: string[] = [],
    signal?: AbortSignal
  ): Promise<ConversationRouteDecision> {
    if (!conversation.messages.some((message) => message.content.trim())) {
      return { route: 'current', confidence: 1, reason: 'empty-context' }
    }
    if (routeSkillRequest(incomingMessage)?.reason === 'explicit-skill') {
      return { route: 'current', confidence: 1, reason: 'explicit-command' }
    }
    if (isDeterministicFollowUp(incomingMessage, attachmentNames.length > 0)) {
      return { route: 'current', confidence: 1, reason: 'local-follow-up' }
    }

    const messages = [
      {
        role: 'user' as const,
        content: JSON.stringify({
          currentTitle: clip(conversation.title, TITLE_CHARS),
          currentContext: contextMessages(conversation.messages),
          incoming: clip(incomingMessage, 2_000),
          attachments: attachmentNames.slice(0, 8).map((name) => clip(name, 120))
        })
      }
    ]
    try {
      await this.waitUntilReady()
      // La découverte peut remplacer un alias pendant l'attente : relire APRÈS la barrière évite
      // d'envoyer l'ancien `codex/flagship` alors que son transport concret vient d'être résolu.
      const binding = this.roles.getBinding('orchestrator')
      const send = (): Promise<SendResult> =>
        this.registry.send(binding.provider, messages, {
          system: ROUTER_SYSTEM,
          model: binding.model,
          reasoningEffort: binding.reasoningEffort,
          signal,
          requestId: randomUUID()
        })
      const result = this.executionSupervisor.currentQuote()
        ? await send()
        : await this.executionSupervisor.run(
            (() => {
              const quote = compileExecutionQuote(`conversation-route:${incomingMessage}`, {
                maxProviderCalls: 1,
                maxTotalTokens: 200_000,
                maxUsd: 0.1
              })
              quote.phases = []
              quote.decomposition = { mode: 'disabled', maxNodes: 1 }
              quote.limits.maxAgents = 0
              quote.limits.maxConcurrency = 1
              quote.limits.maxDurationMs = 30_000
              quote.limits.maxRecoveries = 0
              quote.limits.maxFreshTokens = Math.min(quote.limits.maxFreshTokens, 50_000)
              return quote
            })(),
            signal,
            send
          )
      const parsed = parseDecision(result.text)
      if (!parsed) {
        return {
          route: 'current',
          confidence: 0,
          reason: 'fallback',
          provider: result.provider,
          model: result.model ?? binding.model,
          reasoningEffort: binding.reasoningEffort,
          usage: result.usage
        }
      }
      return {
        ...parsed,
        provider: result.provider,
        model: result.model ?? binding.model,
        reasoningEffort: binding.reasoningEffort,
        usage: result.usage
      }
    } catch {
      const binding = this.roles.getBinding('orchestrator')
      return {
        route: 'current',
        confidence: 0,
        reason: 'fallback',
        provider: binding.provider,
        model: binding.model,
        reasoningEffort: binding.reasoningEffort
      }
    }
  }
}

export interface ConversationRouteResult {
  sourceConversationId: string
  conversationId: string
  routed: boolean
  decision: ConversationRouteDecision
  title?: string
}

export class ConversationRouteCoordinator {
  constructor(
    private readonly conversations: ConversationStore,
    private readonly router: Pick<ConversationRouter, 'decide'>
  ) {}

  async route(
    sourceConversationId: string,
    incomingMessage: string,
    attachmentNames: string[] = [],
    signal?: AbortSignal
  ): Promise<ConversationRouteResult> {
    const source = this.conversations.get(sourceConversationId)
    if (!source) throw new Error(`Conversation inconnue: ${sourceConversationId}`)
    const visibleSource = {
      ...source,
      messages: this.conversations.messagesOf(sourceConversationId)
    }
    const decision = await this.router.decide(
      visibleSource,
      incomingMessage,
      attachmentNames,
      signal
    )
    if (decision.route !== 'new') {
      return {
        sourceConversationId,
        conversationId: sourceConversationId,
        routed: false,
        decision
      }
    }

    // Revalide après l'appel modèle : une suppression concurrente ne doit pas
    // créer un fil orphelin à partir d'un contexte qui n'existe plus.
    if (!this.conversations.get(sourceConversationId)) {
      throw new Error(`Conversation supprimée pendant le routage: ${sourceConversationId}`)
    }
    const fallbackTitle =
      clip(incomingMessage, TITLE_CHARS) ||
      clip(attachmentNames[0] ?? '', TITLE_CHARS) ||
      'Nouvelle conversation'
    const target = this.conversations.create({
      title: decision.title || fallbackTitle,
      provider: source.provider
    })
    return {
      sourceConversationId,
      conversationId: target.id,
      routed: true,
      decision,
      title: target.title
    }
  }
}
