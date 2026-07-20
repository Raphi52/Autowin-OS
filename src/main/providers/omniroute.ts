import { randomUUID } from 'node:crypto'
import type {
  Message,
  PromptEnvelope,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk
} from './types'

const DEFAULT_ORIGIN = 'http://127.0.0.1:20128'
const MAX_STREAM_BYTES = 8 * 1024 * 1024

interface CredentialReader {
  get(): string | null
}

export interface OmniRouteAdapterOptions {
  fetchFn?: typeof fetch
  credentialStore: CredentialReader
  origin?: string
  model?: string
  timeoutMs?: number
  requestId?: () => string
}

type OpenAIContent =
  string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>

function openAIContent(message: Message): OpenAIContent {
  const attachments = message.attachments ?? []
  const unsupported = attachments.find((attachment) => attachment.kind === 'file')
  if (unsupported) {
    throw new Error(`Pièce jointe binaire non supportée par OmniRoute : ${unsupported.name}`)
  }
  if (attachments.length === 0) return message.content
  const content: Exclude<OpenAIContent, string> = [{ type: 'text', text: message.content }]
  for (const attachment of attachments) {
    if (attachment.kind === 'text') {
      content.push({
        type: 'text',
        text: `<fichier nom="${attachment.name.replaceAll('"', '&quot;')}">\n${attachment.content}\n</fichier>`
      })
    } else if (attachment.kind === 'image') {
      content.push({
        type: 'image_url',
        image_url: {
          url: `data:${attachment.mimeType || 'application/octet-stream'};base64,${attachment.content}`
        }
      })
    }
  }
  return content
}

function composeSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

export class OmniRouteAdapter implements ProviderAdapter {
  readonly id = 'omniroute'
  readonly supportsExecution = false
  private readonly fetchFn: typeof fetch
  private readonly credentialStore: CredentialReader
  private readonly origin: string
  private readonly model: string
  private readonly timeoutMs: number
  private readonly requestId: () => string

  constructor(options: OmniRouteAdapterOptions) {
    this.fetchFn = options.fetchFn ?? fetch
    this.credentialStore = options.credentialStore
    this.origin = options.origin ?? DEFAULT_ORIGIN
    this.model = options.model ?? 'auto/coding'
    this.timeoutMs = options.timeoutMs ?? 120_000
    this.requestId = options.requestId ?? randomUUID
  }

  async auth(): Promise<boolean> {
    try {
      return Boolean(this.credentialStore.get())
    } catch {
      return false
    }
  }

  describePrompt(messages: Message[], opts: SendOptions, model?: string): PromptEnvelope {
    return {
      provider: this.id,
      model: model ?? opts.model ?? this.model,
      transport: 'OmniRoute OpenAI-compatible SSE',
      system: opts.system,
      messages,
      options: {
        stream: true,
        reasoningEffort: opts.reasoningEffort,
        resumed: Boolean(opts.resumeSessionId)
      },
      limitation:
        'Corps applicatif observé avant fetch ; compte, provider final et fallback restent internes à OmniRoute tant qu’aucune preuve corrélée ne les expose.'
    }
  }

  async *send(
    messages: Message[],
    opts: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    let credential: string | null
    try {
      credential = this.credentialStore.get()
    } catch {
      credential = null
    }
    if (!credential) throw new Error('OmniRoute non authentifié — configure le jeton de passerelle')

    const model = opts.model ?? this.model
    const requestId = opts.requestId ?? this.requestId()
    const body = {
      model,
      messages: [
        ...(opts.system ? [{ role: 'system' as const, content: opts.system }] : []),
        ...messages
          .filter((message) => message.role !== 'system')
          .map((message) => ({ role: message.role, content: openAIContent(message) }))
      ],
      stream: true,
      stream_options: { include_usage: true },
      // Effort de raisonnement (champ OpenAI-compatible). 'none' = défaut du modèle → on n'envoie rien.
      ...(opts.reasoningEffort && opts.reasoningEffort !== 'none'
        ? { reasoning_effort: opts.reasoningEffort }
        : {})
    }
    opts.observePrompt?.(this.describePrompt(messages, opts, model))

    const headers: Record<string, string> = {
      authorization: `Bearer ${credential}`,
      'content-type': 'application/json',
      accept: 'text/event-stream',
      'x-request-id': requestId,
      'idempotency-key': requestId
    }
    if (opts.resumeSessionId) headers['x-session-id'] = opts.resumeSessionId

    const response = await this.fetchFn(`${this.origin}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      redirect: 'error',
      signal: composeSignal(opts.signal, this.timeoutMs)
    })
    if (!response.ok) throw new Error(`OmniRoute HTTP ${response.status}`)
    if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('text/event-stream')) {
      throw new Error('OmniRoute a renvoyé un type de flux invalide')
    }
    if (!response.body) throw new Error('OmniRoute a renvoyé un flux vide')

    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8', { fatal: true })
    let buffer = ''
    let received = 0
    let completed = false
    let finalText = ''
    let usage: SendResult['usage']

    const parseFrame = (frame: string): string[] => {
      const deltas: string[] = []
      const dataLines: string[] = []
      for (const rawLine of frame.split(/\r?\n/)) {
        const line = rawLine.trim()
        if (!line || line.startsWith(':') || !line.startsWith('data:')) continue
        dataLines.push(line.slice(5).trim())
      }
      if (dataLines.length === 0) return deltas
      const payload = dataLines.join('\n')
      if (payload === '[DONE]') {
        completed = true
        return deltas
      }
      if (Buffer.byteLength(payload, 'utf8') > 256 * 1024) {
        throw new Error('Événement OmniRoute trop volumineux')
      }
      let event: {
        choices?: Array<{ delta?: { content?: unknown; tool_calls?: unknown } }>
        usage?: { prompt_tokens?: unknown; completion_tokens?: unknown }
      }
      try {
        event = JSON.parse(payload)
      } catch {
        throw new Error('Flux OmniRoute invalide')
      }
      const choice = event.choices?.[0]
      if (Array.isArray(choice?.delta?.tool_calls) && choice.delta.tool_calls.length > 0) {
        throw new Error('Tool call OmniRoute non supporté')
      }
      const delta = choice?.delta?.content
      if (delta !== undefined && delta !== null && typeof delta !== 'string') {
        throw new Error('Flux OmniRoute invalide')
      }
      if (typeof delta === 'string' && delta) deltas.push(delta)
      const inputTokens = event.usage?.prompt_tokens
      const outputTokens = event.usage?.completion_tokens
      if (typeof inputTokens === 'number' || typeof outputTokens === 'number') {
        usage = {
          inputTokens: typeof inputTokens === 'number' ? inputTokens : 0,
          outputTokens: typeof outputTokens === 'number' ? outputTokens : 0
        }
      }
      return deltas
    }

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > MAX_STREAM_BYTES) {
        await reader.cancel('stream-too-large')
        throw new Error('Flux OmniRoute trop volumineux')
      }
      buffer += decoder.decode(value, { stream: true })
      let boundary: number
      while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const frame = buffer.slice(0, boundary)
        const separator = /^\r\n\r\n/.test(buffer.slice(boundary)) ? 4 : 2
        buffer = buffer.slice(boundary + separator)
        for (const delta of parseFrame(frame)) {
          finalText += delta
          yield { delta }
        }
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) {
      for (const delta of parseFrame(buffer)) {
        finalText += delta
        yield { delta }
      }
    }
    if (!completed) throw new Error('Flux OmniRoute incomplet')

    return {
      text: finalText,
      provider: this.id,
      sessionId: response.headers.get('x-omniroute-session-id') ?? undefined,
      systemInjected: Boolean(opts.system),
      usage
    }
  }
}
