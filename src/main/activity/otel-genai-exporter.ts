import { createHash } from 'node:crypto'
import type { TraceEventV1 } from './trace-event'
import type { OtelGenAiConfig } from './otel-genai-config'

type OtlpAnyValue =
  { stringValue: string } | { intValue: string } | { doubleValue: number } | { boolValue: boolean }

interface OtlpAttribute {
  key: string
  value: OtlpAnyValue
}

export interface OtlpSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: 'invoke_agent' | 'chat' | 'execute_tool'
  kind: 1 | 3
  startTimeUnixNano: string
  endTimeUnixNano: string
  attributes: OtlpAttribute[]
  status: { code: 0 | 1 | 2 }
}

export interface OtlpExportTraceServiceRequest {
  resourceSpans: Array<{
    resource: { attributes: OtlpAttribute[] }
    scopeSpans: Array<{
      scope: { name: string; version: string }
      spans: OtlpSpan[]
    }>
  }>
}

function digestBytes(value: string, bytes: number): string {
  // OTLP/JSON diverge du mapping protobuf standard ici : traceId/spanId sont hex, jamais base64.
  return createHash('sha256')
    .update(value, 'utf8')
    .digest('hex')
    .slice(0, bytes * 2)
}

function integerAttribute(key: string, value: number | undefined): OtlpAttribute | undefined {
  return value === undefined || !Number.isFinite(value) || value < 0
    ? undefined
    : { key, value: { intValue: String(Math.round(value)) } }
}

function doubleAttribute(key: string, value: number | undefined): OtlpAttribute | undefined {
  return value === undefined || !Number.isFinite(value) || value < 0
    ? undefined
    : { key, value: { doubleValue: value } }
}

function bounded(value: string, max = 256): string {
  return value.slice(0, max)
}

function operation(event: TraceEventV1): OtlpSpan['name'] {
  if (event.type === 'tool-call' || event.type === 'tool-result') return 'execute_tool'
  if (event.type === 'message' || event.type === 'model-response') return 'chat'
  return 'invoke_agent'
}

function unixNanos(timestamp: string, offsetMs = 0): string {
  return (BigInt(Date.parse(timestamp) + offsetMs) * 1_000_000n).toString()
}

function spanFor(event: TraceEventV1): OtlpSpan {
  const durationMs = event.metrics?.durationMs ?? 0
  const attrs: Array<OtlpAttribute | undefined> = [
    { key: 'gen_ai.operation.name', value: { stringValue: operation(event) } },
    event.provider?.id
      ? { key: 'gen_ai.provider.name', value: { stringValue: bounded(event.provider.id) } }
      : undefined,
    event.provider?.model
      ? { key: 'gen_ai.request.model', value: { stringValue: bounded(event.provider.model) } }
      : undefined,
    event.execution?.phase
      ? { key: 'autowin.phase', value: { stringValue: bounded(event.execution.phase) } }
      : undefined,
    operation(event) === 'execute_tool'
      ? {
          key: 'gen_ai.tool.name',
          value: {
            stringValue: bounded(
              event.payloads.find((payload) => payload.name)?.name ??
                event.recipient?.id ??
                event.actor.id
            )
          }
        }
      : undefined,
    integerAttribute('gen_ai.usage.input_tokens', event.metrics?.inputTokens),
    integerAttribute('gen_ai.usage.output_tokens', event.metrics?.outputTokens),
    integerAttribute('gen_ai.usage.cache_read.input_tokens', event.metrics?.cacheReadTokens),
    doubleAttribute('autowin.cost.usd', event.metrics?.costUsd)
  ]
  return {
    traceId: digestBytes(`${event.conversationId}\0${event.turnId}`, 16),
    spanId: digestBytes(event.id, 8),
    ...(event.parentId ? { parentSpanId: digestBytes(event.parentId, 8) } : {}),
    name: operation(event),
    // Appel modele/outil = CLIENT ; orchestration interne = INTERNAL.
    kind: operation(event) === 'invoke_agent' ? 1 : 3,
    startTimeUnixNano: unixNanos(event.timestamp, -durationMs),
    endTimeUnixNano: unixNanos(event.timestamp),
    attributes: attrs.filter((attribute): attribute is OtlpAttribute => attribute !== undefined),
    status: {
      code:
        event.status === 'failed' || event.status === 'cancelled'
          ? 2
          : event.status === 'completed'
            ? 1
            : 0
    }
  }
}

/**
 * Strict allow-list mapper. Trace payloads, participant labels, raw conversation/turn/run ids and
 * Brain queries are deliberately unreachable from the returned OTLP shape.
 */
export function mapTraceEventsToOtlp(
  events: readonly TraceEventV1[],
  serviceVersion = 'unknown'
): OtlpExportTraceServiceRequest {
  const spans = [...events]
    .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id))
    .map(spanFor)
  return requestForSpans(spans, serviceVersion)
}

function requestForSpans(
  spans: readonly OtlpSpan[],
  serviceVersion: string
): OtlpExportTraceServiceRequest {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'autowin-os' } }]
        },
        scopeSpans: [
          {
            scope: { name: 'autowin-os.genai', version: serviceVersion },
            spans: [...spans]
          }
        ]
      }
    ]
  }
}

export type OtlpTransport = (
  endpoint: string,
  payload: OtlpExportTraceServiceRequest,
  timeoutMs: number
) => Promise<void>

async function fetchTransport(
  endpoint: string,
  payload: OtlpExportTraceServiceRequest,
  timeoutMs: number
): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`OTLP HTTP ${response.status}`)
  } finally {
    clearTimeout(timeout)
  }
}

export type OtlpEnqueueResult = 'disabled' | 'queued' | 'dropped'

/** Bounded, asynchronous and best-effort: telemetry can never become a run dependency. */
export class MetadataOnlyOtlpExporter {
  private readonly queue: Array<{ span: OtlpSpan; bytes: number }> = []
  private queuedBytes = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private inFlight: Promise<void> | undefined
  private inFlightBatchSize = 0
  private closed = false
  private dropped = 0
  private failedBatches = 0
  private exported = 0

  constructor(
    private readonly config: OtelGenAiConfig,
    private readonly transport: OtlpTransport = fetchTransport,
    private readonly serviceVersion = 'unknown'
  ) {}

  enqueue(event: TraceEventV1): OtlpEnqueueResult {
    if (!this.config.enabled || this.closed) return 'disabled'
    // Projection AVANT mise en file : aucun prompt, payload ou id brut sensible ne reste en memoire.
    const span = spanFor(event)
    const bytes = Buffer.byteLength(JSON.stringify(span), 'utf8')
    if (
      this.queue.length >= this.config.maxQueue ||
      bytes > this.config.maxQueueBytes ||
      this.queuedBytes + bytes > this.config.maxQueueBytes
    ) {
      this.dropped += 1
      return 'dropped'
    }
    this.queue.push({ span, bytes })
    this.queuedBytes += bytes
    this.schedule()
    return 'queued'
  }

  flush(): Promise<void> {
    if (!this.config.enabled || this.queue.length === 0) return Promise.resolve()
    if (this.inFlight) return this.inFlight
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    const batch = this.queue.splice(0, this.config.batchSize)
    this.inFlightBatchSize = batch.length
    this.queuedBytes -= batch.reduce((total, item) => total + item.bytes, 0)
    const operation = this.transport(
      this.config.endpoint,
      requestForSpans(
        batch.map((item) => item.span),
        this.serviceVersion
      ),
      this.config.timeoutMs
    )
      .then(() => {
        this.exported += batch.length
      })
      .catch(() => {
        this.failedBatches += 1
      })
      .finally(() => {
        this.inFlightBatchSize = 0
        this.inFlight = undefined
        if (this.queue.length > 0) this.schedule()
      })
    this.inFlight = operation
    return operation
  }

  /** Vide tous les lots lors d'une fermeture ordonnee, sans jamais propager une panne collector. */
  async drain(): Promise<void> {
    if (!this.config.enabled) return
    const shutdownTimeoutMs = this.config.shutdownTimeoutMs
    let expired = false
    let deadline: ReturnType<typeof setTimeout> | undefined
    const drainAll = async (): Promise<void> => {
      while (this.inFlight || this.queue.length > 0) {
        if (this.inFlight) await this.inFlight
        else await this.flush()
      }
    }
    await Promise.race([
      drainAll(),
      new Promise<void>((resolve) => {
        deadline = setTimeout(() => {
          expired = true
          resolve()
        }, shutdownTimeoutMs)
      })
    ])
    if (deadline) clearTimeout(deadline)
    if (expired) {
      this.dropped += this.queue.length + this.inFlightBatchSize
      this.queue.length = 0
      this.queuedBytes = 0
    }
  }

  stats(): {
    queued: number
    queuedBytes: number
    exported: number
    dropped: number
    failedBatches: number
  } {
    return {
      queued: this.queue.length,
      queuedBytes: this.queuedBytes,
      exported: this.exported,
      dropped: this.dropped,
      failedBatches: this.failedBatches
    }
  }

  close(): void {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.queue.length = 0
    this.queuedBytes = 0
  }

  private schedule(): void {
    if (!this.config.enabled || this.closed || this.timer || this.inFlight) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flush()
    }, this.config.flushIntervalMs)
    this.timer.unref?.()
  }
}
