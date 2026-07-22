import { randomUUID } from 'node:crypto'
import type {
  Message,
  PromptEnvelope,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk,
  Usage
} from '../providers/types'
import {
  createFabricTransportFetch,
  type FabricHttpsRequest,
  type FabricTransportFetch
} from './fabric-http-client'
import type { FabricNodeTransportStore } from './node-transport-store'

const REQUEST_SCHEMA = 'autowin.node-chat-request/v1'
const EVENT_SCHEMA = 'autowin.node-chat-event/v1'
const MAX_REQUEST_BYTES = 8 * 1024 * 1024
const MAX_STREAM_BYTES = 8 * 1024 * 1024
const MAX_EVENT_BYTES = 256 * 1024

export interface FabricResourceAdapterOptions {
  nodeId: string
  resourceId: string
  manifestDigest: string
  transportStore: FabricNodeTransportStore
  requestFn?: FabricHttpsRequest
  timeoutMs?: number
  requestId?: () => string
}

interface NodeChatEvent {
  schema: typeof EVENT_SCHEMA
  requestId: string
  sequence: number
  type: 'delta' | 'completed' | 'error'
  delta?: string
  error?: string
  sessionId?: string
  usage?: Usage
}

function composeSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function parseEvent(value: unknown): NodeChatEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Événement Autowin Node invalide')
  }
  const event = value as Record<string, unknown>
  const allowed = new Set([
    'schema',
    'requestId',
    'sequence',
    'type',
    'delta',
    'error',
    'sessionId',
    'usage'
  ])
  if (Object.keys(event).some((key) => !allowed.has(key))) {
    throw new Error('Événement Autowin Node invalide')
  }
  if (
    event.schema !== EVENT_SCHEMA ||
    typeof event.requestId !== 'string' ||
    !event.requestId ||
    !Number.isSafeInteger(event.sequence) ||
    (event.sequence as number) <= 0 ||
    (event.type !== 'delta' && event.type !== 'completed' && event.type !== 'error')
  ) {
    throw new Error('Événement Autowin Node invalide')
  }
  if (event.type === 'delta' && (typeof event.delta !== 'string' || !event.delta)) {
    throw new Error('Delta Autowin Node invalide')
  }
  if (event.type === 'error' && (typeof event.error !== 'string' || !event.error.trim())) {
    throw new Error('Erreur Autowin Node invalide')
  }
  let usage: Usage | undefined
  if (event.usage !== undefined) {
    if (!event.usage || typeof event.usage !== 'object' || Array.isArray(event.usage)) {
      throw new Error('Usage Autowin Node invalide')
    }
    const rawUsage = event.usage as Record<string, unknown>
    if (
      Object.keys(rawUsage).some((key) => key !== 'inputTokens' && key !== 'outputTokens') ||
      !nonNegativeInteger(rawUsage.inputTokens) ||
      !nonNegativeInteger(rawUsage.outputTokens)
    ) {
      throw new Error('Usage Autowin Node invalide')
    }
    usage = {
      inputTokens: rawUsage.inputTokens,
      outputTokens: rawUsage.outputTokens
    }
  }
  return {
    schema: EVENT_SCHEMA,
    requestId: event.requestId,
    sequence: event.sequence as number,
    type: event.type,
    ...(event.delta !== undefined ? { delta: event.delta as string } : {}),
    ...(event.error !== undefined ? { error: event.error as string } : {}),
    ...(typeof event.sessionId === 'string' && event.sessionId
      ? { sessionId: event.sessionId }
      : {}),
    ...(usage ? { usage } : {})
  }
}

export class FabricResourceAdapter implements ProviderAdapter {
  readonly id: string
  readonly supportsExecution = false
  private readonly transportFetch: FabricTransportFetch
  private readonly timeoutMs: number
  private readonly requestId: () => string

  constructor(private readonly options: FabricResourceAdapterOptions) {
    this.id = `fabric:${options.nodeId}:${options.resourceId}`
    this.transportFetch = createFabricTransportFetch(
      options.requestFn ? { requestFn: options.requestFn } : {}
    )
    this.timeoutMs = options.timeoutMs ?? 120_000
    this.requestId = options.requestId ?? randomUUID
  }

  async auth(): Promise<boolean> {
    try {
      return this.options.transportStore.get() !== null
    } catch {
      return false
    }
  }

  describePrompt(messages: Message[], opts: SendOptions): PromptEnvelope {
    return {
      provider: this.id,
      model: this.options.resourceId,
      transport: 'Autowin Node v1 SSE — local-tools',
      system: opts.system,
      systemBlocks: opts.systemBlocks,
      messages,
      options: {
        mode: 'local-tools',
        manifestDigest: this.options.manifestDigest,
        reasoningEffort: opts.reasoningEffort,
        resumed: Boolean(opts.resumeSessionId)
      },
      limitation:
        'Inférence distante uniquement ; les outils restent soumis à AppCommandBus dans Autowin OS.'
    }
  }

  async *send(
    messages: Message[],
    opts: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    if (opts.execution) {
      throw new Error('Une ressource local-tools ne peut pas recevoir une exécution distante')
    }
    const transport = this.options.transportStore.get()
    if (!transport) throw new Error(`Transport du Node indisponible: ${this.options.nodeId}`)
    const requestId = opts.requestId ?? this.requestId()
    const body = {
      schema: REQUEST_SCHEMA,
      requestId,
      resourceId: this.options.resourceId,
      manifestDigest: this.options.manifestDigest,
      mode: 'local-tools' as const,
      messages: messages.filter((message) => message.role !== 'system'),
      ...(opts.system ? { system: opts.system } : {}),
      options: {
        ...(opts.reasoningEffort && opts.reasoningEffort !== 'none'
          ? { reasoningEffort: opts.reasoningEffort }
          : {}),
        ...(opts.resumeSessionId ? { resumeSessionId: opts.resumeSessionId } : {})
      }
    }
    const serialized = JSON.stringify(body)
    if (Buffer.byteLength(serialized, 'utf8') > MAX_REQUEST_BYTES) {
      throw new Error('Requête Autowin Node trop volumineuse')
    }
    opts.observePrompt?.(this.describePrompt(messages, opts))
    const response = await this.transportFetch(transport, '/v1/executions/chat', {
      method: 'POST',
      headers: {
        accept: 'text/event-stream',
        'content-type': 'application/json',
        'x-request-id': requestId,
        'idempotency-key': requestId,
        ...(transport.bearerToken ? { authorization: `Bearer ${transport.bearerToken}` } : {})
      },
      body: serialized,
      signal: composeSignal(opts.signal, this.timeoutMs)
    })
    if (!response.ok) throw new Error(`Autowin Node HTTP ${response.status}`)
    if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('text/event-stream')) {
      throw new Error('Autowin Node a renvoyé un type de flux invalide')
    }
    if (!response.body) throw new Error('Autowin Node a renvoyé un flux vide')

    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8', { fatal: true })
    let buffer = ''
    let received = 0
    let expectedSequence = 1
    let completed = false
    let finalText = ''
    let usage: Usage | undefined
    let sessionId: string | undefined

    const parseFrame = (frame: string): NodeChatEvent[] => {
      const dataLines = frame
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
      if (dataLines.length === 0) return []
      const payload = dataLines.join('\n')
      if (Buffer.byteLength(payload, 'utf8') > MAX_EVENT_BYTES) {
        throw new Error('Événement Autowin Node trop volumineux')
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(payload)
      } catch {
        throw new Error('Événement Autowin Node invalide')
      }
      return [parseEvent(parsed)]
    }

    const applyEvent = (event: NodeChatEvent): string | undefined => {
      if (completed || event.requestId !== requestId || event.sequence !== expectedSequence) {
        throw new Error('Séquence Autowin Node invalide')
      }
      expectedSequence += 1
      if (event.type === 'error') throw new Error(`Autowin Node: ${event.error}`)
      if (event.type === 'completed') {
        completed = true
        usage = event.usage
        sessionId = event.sessionId
        return undefined
      }
      finalText += event.delta
      return event.delta
    }

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
        if (received > MAX_STREAM_BYTES) {
          await reader.cancel('stream-too-large')
          throw new Error('Flux Autowin Node trop volumineux')
        }
        buffer += decoder.decode(value, { stream: true })
        let boundary: number
        while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
          const frame = buffer.slice(0, boundary)
          const separator = /^\r\n\r\n/.test(buffer.slice(boundary)) ? 4 : 2
          buffer = buffer.slice(boundary + separator)
          for (const event of parseFrame(frame)) {
            const delta = applyEvent(event)
            if (delta) yield { delta }
          }
        }
      }
      buffer += decoder.decode()
      if (buffer.trim()) {
        for (const event of parseFrame(buffer)) {
          const delta = applyEvent(event)
          if (delta) yield { delta }
        }
      }
    } finally {
      reader.releaseLock()
    }
    if (!completed) throw new Error('Flux Autowin Node incomplet')
    if (!finalText.trim()) throw new Error('Autowin Node a renvoyé une réponse vide')

    return {
      text: finalText,
      provider: this.id,
      ...(sessionId ? { sessionId } : {}),
      systemInjected: Boolean(opts.system),
      ...(usage ? { usage } : {})
    }
  }
}
