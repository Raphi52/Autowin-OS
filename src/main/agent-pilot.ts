import type { ProviderRegistry } from './providers/registry'
import type { RoleModelConfig } from './roles'
import type { AppCommandBus } from './commands'
import { capabilityInstruction } from './capability-profiles'
import type { Message, PromptEnvelope, SendOptions, Usage } from './providers/types'
import {
  MODEL_QUESTION_INSTRUCTION,
  parseModelQuestion,
  type ModelQuestion
} from './model-questions'
import { VisibleStreamFilter } from '../shared/stream-markup-filter'
import type { ConversationAuthorityMode } from './conversation-capabilities'
import { randomUUID } from 'node:crypto'

/**
 * Boucle de PILOTAGE : un agent LLM conduit l'app lui-même.
 * Il reçoit le catalogue de commandes + l'état courant, ÉMET des appels
 * `<cmd>{"name":..,"args":..}</cmd>`, qu'on exécute sur le bus (l'UI se met à jour
 * en direct), puis on lui renvoie le résultat + le nouvel état, et il reboucle
 * jusqu'à écrire DONE (ou cap d'itérations). C'est « l'agent voit ce qu'il update ».
 */
export interface PilotEvent {
  conversationId?: string
  kind:
    | 'delta'
    | 'stream-reset'
    | 'think'
    | 'command'
    | 'result'
    | 'done'
    | 'error'
    | 'retry'
    | 'cancellation'
    | 'prompt-call'
  text?: string
  name?: string
  args?: unknown
  ok?: boolean
  data?: unknown
  iteration?: number
  prompt?: PromptEnvelope
  response?: string
  status?: 'completed' | 'failed'
  error?: string
  callUsage?: Usage
  callDurationMs?: number
  sessionId?: string
  streamId?: string
  actionId?: string
  /** Coût cumulé du tour (surfacé sur l'event 'done') → journal d'activité par conversation. */
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number }
}

const CMD_RE = /<cmd>\s*(\{[\s\S]*?\})\s*<\/cmd>/g
const CONTROL_RE = /<(cmd|question)>\s*([\s\S]*?)\s*<\/\1>/g

type OrderedPilotToken =
  { kind: 'text'; text: string } | { kind: 'command'; name: string; args: Record<string, unknown> }

function filterVisibleText(raw: string): string {
  const filter = new VisibleStreamFilter()
  return filter.push(raw) + filter.finish()
}

function parseOrderedPilotTokens(raw: string): OrderedPilotToken[] {
  const tokens: OrderedPilotToken[] = []
  let cursor = 0
  CONTROL_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = CONTROL_RE.exec(raw)) !== null) {
    const visible = filterVisibleText(raw.slice(cursor, match.index))
    if (visible) tokens.push({ kind: 'text', text: visible })
    if (match[1] === 'cmd') {
      try {
        const parsed = JSON.parse(match[2]) as {
          name?: string
          args?: Record<string, unknown>
        }
        if (parsed.name)
          tokens.push({ kind: 'command', name: parsed.name, args: parsed.args ?? {} })
      } catch {
        /* bloc de commande invalide : supprimé du texte visible, jamais exécuté */
      }
    }
    cursor = match.index + match[0].length
  }
  const trailing = filterVisibleText(raw.slice(cursor))
  if (trailing) tokens.push({ kind: 'text', text: trailing })
  return tokens
}

function waitForAnswer(answer: Promise<string>, signal?: AbortSignal): Promise<string> {
  if (!signal) return answer
  if (signal.aborted) return Promise.reject(new Error(String(signal.reason ?? 'aborted')))
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(new Error(String(signal.reason ?? 'aborted')))
    signal.addEventListener('abort', abort, { once: true })
    answer.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

export class AgentPilot {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly roles: RoleModelConfig,
    private readonly bus: AppCommandBus
  ) {}

  async run(goal: string, onEvent: (e: PilotEvent) => void, maxIter = 6): Promise<void> {
    const binding = this.roles.getBinding('orchestrator')
    const provider = binding.provider
    const catalog = this.bus.catalog()
    const snapshot = await this.bus.snapshot()

    const system =
      `Tu PILOTES l'application "Autowin OS" via des commandes. Objectif de l'utilisateur : "${goal}".\n` +
      `Pour agir, émets une ou plusieurs commandes AU FORMAT EXACT : <cmd>{"name":"...","args":{...}}</cmd>.\n` +
      `Tu peux faire modifier le code du workspace par la commande orchestrate. Ne dis jamais que tu ne peux pas modifier le code lorsque cette commande est disponible : utilise-la avec la demande complète de l'utilisateur.\n` +
      `Commandes disponibles :\n` +
      catalog
        .map((c) => `- ${c.name}(${Object.keys(c.args).join(', ')}) : ${c.description}`)
        .join('\n') +
      `\nRègles : agis par petits pas, une ou deux commandes par tour. Après exécution tu recevras le résultat + l'état. ` +
      `Quand l'objectif est atteint, réponds UNIQUEMENT "DONE: <résumé>" sans commande.` +
      capabilityInstruction(binding.capabilityProfileId)

    const convo: string[] = [`ÉTAT INITIAL:\n${JSON.stringify(snapshot)}`]

    for (let i = 0; i < maxIter; i++) {
      const res = await this.registry.send(
        provider,
        [{ role: 'user', content: `${convo.join('\n\n')}\n\nProchaine action ?` }],
        { system }
      )
      const text = res.text.trim()

      // Extraire les commandes émises par le modèle.
      const cmds: Array<{ name: string; args: Record<string, unknown> }> = []
      let m: RegExpExecArray | null
      CMD_RE.lastIndex = 0
      while ((m = CMD_RE.exec(text)) !== null) {
        try {
          const parsed = JSON.parse(m[1]) as { name: string; args?: Record<string, unknown> }
          if (parsed.name) cmds.push({ name: parsed.name, args: parsed.args ?? {} })
        } catch {
          /* JSON de commande invalide — ignoré */
        }
      }

      const thought = text.replace(CMD_RE, '').trim()
      if (thought) onEvent({ kind: 'think', text: thought })

      if (cmds.length === 0) {
        onEvent({ kind: 'done', text: thought || 'terminé' })
        return
      }

      const results: string[] = []
      for (const c of cmds) {
        onEvent({ kind: 'command', name: c.name, args: c.args })
        const r = await this.bus.exec(c.name, c.args) // MUTE l'app + broadcast (UI live)
        onEvent({ kind: 'result', name: c.name, ok: r.ok, data: r.ok ? r.data : r.error })
        results.push(`${c.name} → ${r.ok ? JSON.stringify(r.data) : 'ERREUR ' + r.error}`)
      }

      const state = await this.bus.snapshot()
      convo.push(`TU AS ÉMIS: ${text}`)
      convo.push(`RÉSULTATS:\n${results.join('\n')}\n\nÉTAT MAINTENANT:\n${JSON.stringify(state)}`)
    }
    const capError = `Cap d'itérations (${maxIter}) atteint sans réponse finale`
    onEvent({
      kind: 'error',
      text: capError
    })
    throw new Error(capError)
  }

  /**
   * Mode CONVERSATION (chat transparent) : l'agent parle À l'utilisateur ET peut
   * piloter l'app dans le même tour. Le texte hors-commande est sa réponse parlée ;
   * les `<cmd>` sont exécutées et rendues comme des actions inline. L'historique
   * complet est réinjecté pour un vrai multi-tours. Un tour peut enchaîner plusieurs
   * itérations (agir → constater → répondre) jusqu'à ce qu'il ne reste plus de commande.
   */
  async chat(
    history: Message[],
    onEvent: (e: PilotEvent) => void,
    ask?: (question: ModelQuestion) => Promise<string>,
    maxIter = 6,
    conversationId?: string,
    signal?: AbortSignal,
    authorityMode: ConversationAuthorityMode = 'ask',
    /** Directives injectées par l'utilisateur PENDANT le tour — drainées à chaque itération. */
    drainDirectives?: () => string[]
  ): Promise<void> {
    const binding = this.roles.getBinding('orchestrator')
    const provider = binding.provider
    const catalog = this.bus.catalog()
    const snapshot = await this.bus.snapshot()

    const system =
      `Tu es l'agent d'"Autowin OS", un cockpit d'orchestration d'agents. Tu CONVERSES avec ` +
      `l'utilisateur en français, naturellement, ET tu peux PILOTER l'application toi-même.\n` +
      `Pour agir sur l'app, émets une ou plusieurs commandes AU FORMAT EXACT : ` +
      `<cmd>{"name":"...","args":{...}}</cmd>. Tout texte HORS commande est ta réponse parlée à ` +
      `l'utilisateur (il la voit dans le chat). L'UI se met à jour EN DIRECT quand tu agis.\n` +
      `Tu peux faire modifier le code du workspace par la commande orchestrate. Ne dis jamais que tu ne peux pas modifier le code lorsque cette commande est disponible : utilise-la avec la demande complète de l'utilisateur.\n` +
      `Commandes disponibles :\n` +
      catalog
        .map((c) => `- ${c.name}(${Object.keys(c.args).join(', ')}) : ${c.description}`)
        .join('\n') +
      `\nRègles : réponds normalement quand c'est une simple question ; n'utilise des commandes ` +
      `QUE si l'objectif demande d'agir sur l'app. Après une commande tu reçois le résultat + le ` +
      `nouvel état et tu peux continuer. Quand tu as fini d'agir, termine par ta réponse en clair ` +
      `SANS commande.\n${MODEL_QUESTION_INSTRUCTION}` +
      capabilityInstruction(binding.capabilityProfileId)

    // Reconstruit le fil : historique de la conversation + état courant de l'app.
    const convo: string[] = [
      `ÉTAT DE L'APP:\n${JSON.stringify(snapshot)}`,
      ...history.map((m) => `${m.role === 'user' ? 'UTILISATEUR' : 'TOI'}: ${m.content}`)
    ]
    const currentAttachments = history.at(-1)?.attachments

    // Coût cumulé du tour (toutes les itérations LLM du même message utilisateur).
    const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 }

    for (let i = 0; i < maxIter; i++) {
      // Pilotage continu : les directives envoyées PENDANT le tour entrent au prochain
      // point d'itération (priorité immédiate, sans attendre la fin du tour).
      for (const directive of drainDirectives?.() ?? []) {
        convo.push(`UTILISATEUR (DIRECTIVE INJECTÉE EN COURS DE TOUR — PRIORITAIRE): ${directive}`)
      }
      const messages: Message[] = [
        {
          role: 'user',
          content: `${convo.join('\n\n')}\n\n(Réponds à l'utilisateur / agis.)`,
          ...(i === 0 && currentAttachments?.length ? { attachments: currentAttachments } : {})
        }
      ]
      let prompt = this.registry.describePrompt(
        provider,
        messages,
        {
          system,
          model: binding.model,
          reasoningEffort: binding.reasoningEffort
        },
        binding.model
      )
      const options: SendOptions = {
        system,
        model: binding.model,
        reasoningEffort: binding.reasoningEffort,
        observePrompt: (observed) => {
          prompt = observed
        },
        signal,
        requestId: randomUUID()
      }
      let res
      let attempt = 0
      let callStartedAt = performance.now()
      let successfulStreamedPrefix = ''
      let successfulAttempt = 0
      while (!res) {
        const streamId = `${i}:${attempt}`
        const visibleFilter = new VisibleStreamFilter()
        let attemptStreamedPrefix = ''
        let commandBoundarySeen = false
        const emitVisiblePrefix = (
          segments: ReturnType<VisibleStreamFilter['pushSegments']>
        ): void => {
          for (const segment of segments) {
            if (segment.kind === 'control') {
              if (segment.control === 'cmd') commandBoundarySeen = true
              continue
            }
            if (commandBoundarySeen || !segment.text) continue
            attemptStreamedPrefix += segment.text
            onEvent({ kind: 'delta', streamId, text: segment.text, iteration: i })
          }
        }
        try {
          callStartedAt = performance.now()
          res = await this.registry.send(provider, messages, options, (chunk) => {
            emitVisiblePrefix(visibleFilter.pushSegments(chunk.delta))
          })
          emitVisiblePrefix(visibleFilter.finishSegments())
          successfulStreamedPrefix = attemptStreamedPrefix
          successfulAttempt = attempt
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (signal?.aborted) {
            onEvent({
              kind: 'cancellation',
              iteration: i,
              name: provider,
              text: 'Annulation demandée par utilisateur',
              data: { reason: signal.reason ?? 'user' }
            })
            throw error
          }
          onEvent({
            kind: 'prompt-call',
            iteration: i,
            prompt,
            response: '',
            status: 'failed',
            error: message,
            callDurationMs: performance.now() - callStartedAt
          })
          if (attempt >= 1) throw error
          if (attemptStreamedPrefix) onEvent({ kind: 'stream-reset', streamId, iteration: i })
          attempt += 1
          onEvent({
            kind: 'retry',
            iteration: i,
            name: provider,
            text: message,
            data: { attempt, maxAttempts: 2 }
          })
        }
      }
      onEvent({
        kind: 'prompt-call',
        iteration: i,
        prompt,
        response: res.text,
        status: 'completed',
        callUsage: res.usage,
        callDurationMs: performance.now() - callStartedAt,
        sessionId: res.sessionId
      })
      if (res.usage) {
        usage.inputTokens += res.usage.inputTokens
        usage.outputTokens += res.usage.outputTokens
        usage.costUsd += res.usage.costUsd ?? 0
      }
      const text = res.text.trim()
      const question = parseModelQuestion(text)
      if (question && ask) {
        const answer = await waitForAnswer(ask(question), signal)
        convo.push(`TOI: ${text}`)
        convo.push(`UTILISATEUR: ${answer}`)
        continue
      }

      const ordered = parseOrderedPilotTokens(res.text)
      const spoken = ordered
        .filter(
          (token): token is Extract<OrderedPilotToken, { kind: 'text' }> => token.kind === 'text'
        )
        .map((token) => token.text)
        .join('')
        .trim()
      const hasCommand = ordered.some((token) => token.kind === 'command')

      if (!hasCommand) {
        if (!successfulStreamedPrefix && spoken) onEvent({ kind: 'think', text: spoken })
        else if (successfulStreamedPrefix) {
          const visible = ordered
            .filter(
              (token): token is Extract<OrderedPilotToken, { kind: 'text' }> =>
                token.kind === 'text'
            )
            .map((token) => token.text)
            .join('')
          const remainder = visible.startsWith(successfulStreamedPrefix)
            ? visible.slice(successfulStreamedPrefix.length)
            : ''
          if (remainder)
            onEvent({
              kind: 'delta',
              streamId: `${i}:${successfulAttempt}:remainder`,
              text: remainder,
              iteration: i
            })
        }
        onEvent({ kind: 'done', text: spoken, usage })
        return
      }

      const results: string[] = []
      let commandIndex = 0
      let tokenIndex = 0
      let streamedPrefixRemaining = successfulStreamedPrefix
      for (const token of ordered) {
        signal?.throwIfAborted()
        if (token.kind === 'text') {
          let visible = token.text
          if (streamedPrefixRemaining) {
            if (streamedPrefixRemaining.startsWith(visible)) {
              streamedPrefixRemaining = streamedPrefixRemaining.slice(visible.length)
              visible = ''
            } else if (visible.startsWith(streamedPrefixRemaining)) {
              visible = visible.slice(streamedPrefixRemaining.length)
              streamedPrefixRemaining = ''
            } else {
              visible = ''
              streamedPrefixRemaining = ''
            }
          }
          if (visible)
            onEvent({
              kind: 'delta',
              streamId: `${i}:${successfulAttempt}:ordered:${tokenIndex}`,
              text: visible,
              iteration: i
            })
          tokenIndex += 1
          continue
        }

        const actionId = `${i}:${commandIndex++}`
        onEvent({ kind: 'command', actionId, name: token.name, args: token.args })
        signal?.throwIfAborted()
        const r = await this.bus.exec(token.name, token.args, conversationId, authorityMode)
        onEvent({
          kind: 'result',
          actionId,
          name: token.name,
          ok: r.ok,
          data: r.ok ? r.data : r.error
        })
        results.push(`${token.name} → ${r.ok ? JSON.stringify(r.data) : 'ERREUR ' + r.error}`)
        tokenIndex += 1
      }

      const state = await this.bus.snapshot()
      convo.push(`TU AS ÉMIS: ${text}`)
      convo.push(`RÉSULTATS:\n${results.join('\n')}\n\nÉTAT MAINTENANT:\n${JSON.stringify(state)}`)
    }
    const capError = `Cap d'itérations (${maxIter}) atteint sans réponse finale`
    onEvent({
      kind: 'error',
      text: capError,
      usage
    })
    throw new Error(capError)
  }
}
