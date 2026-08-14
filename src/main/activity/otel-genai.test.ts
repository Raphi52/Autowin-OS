import { describe, expect, it, vi } from 'vitest'
import type { TraceEventV1 } from './trace-event'
import { resolveOtelGenAiConfig } from './otel-genai-config'
import {
  MetadataOnlyOtlpExporter,
  type OtlpExportTraceServiceRequest,
  type OtlpTransport
} from './otel-genai-exporter'

function event(overrides: Partial<TraceEventV1> = {}): TraceEventV1 {
  return {
    schema: 'autowin.trace/v1',
    id: 'event-model-secret-id',
    conversationId: 'conversation-private',
    turnId: 'turn-private',
    timestamp: '2026-08-08T10:00:01.000Z',
    sequence: 1,
    type: 'model-response',
    status: 'completed',
    actor: { id: 'claude', kind: 'provider', label: 'Claude' },
    recipient: { id: 'user', kind: 'human', label: 'Utilisateur' },
    channel: 'assistant',
    payloads: [{ kind: 'model-response', content: 'TOP SECRET PROMPT CONTENT' }],
    observation: { boundary: 'provider response', fidelity: 'exact' },
    execution: { phase: 'build', runId: 'run-private' },
    provider: { id: 'claude', model: 'claude-fable-5' },
    metrics: { durationMs: 500, inputTokens: 120, outputTokens: 30, costUsd: 0.04 },
    ...overrides
  }
}

async function exportPayload(
  events: readonly TraceEventV1[],
  serviceVersion = 'unknown'
): Promise<OtlpExportTraceServiceRequest> {
  let payload: OtlpExportTraceServiceRequest | undefined
  const transport: OtlpTransport = async (_endpoint, next) => {
    payload = next
  }
  const exporter = new MetadataOnlyOtlpExporter(
    {
      enabled: true,
      endpoint: 'http://127.0.0.1:4318/v1/traces',
      maxQueue: 100,
      maxQueueBytes: 100_000,
      batchSize: 100,
      flushIntervalMs: 60_000,
      timeoutMs: 100,
      shutdownTimeoutMs: 100
    },
    transport,
    serviceVersion
  )
  for (const item of events) exporter.enqueue(item)
  await exporter.flush()
  exporter.close()
  if (!payload) throw new Error('Payload OTLP non émis')
  return payload
}

describe('OTLP GenAI metadata-only', () => {
  it('is disabled by default and rejects an invalid endpoint without throwing', () => {
    expect(resolveOtelGenAiConfig({})).toEqual({ enabled: false, reason: 'disabled' })
    expect(
      resolveOtelGenAiConfig({ AUTOWIN_OTEL_EXPORTER: '1', AUTOWIN_OTEL_ENDPOINT: 'file:///tmp/x' })
    ).toEqual({ enabled: false, reason: 'invalid-endpoint' })
  })

  it('maps a causal tree to OTLP spans without any content or raw private ids', async () => {
    const parent = event({
      id: 'parent-private',
      sequence: 0,
      type: 'decision',
      parentId: undefined
    })
    const child = event({ parentId: parent.id })
    const payload = await exportPayload([parent, child], '1.2.3')
    const encoded = JSON.stringify(payload)
    const spans = payload.resourceSpans[0].scopeSpans[0].spans

    expect(spans).toHaveLength(2)
    expect(spans[0].traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(spans[0].spanId).toMatch(/^[0-9a-f]{16}$/)
    expect(spans[1].parentSpanId).toBe(spans[0].spanId)
    expect(spans[1].startTimeUnixNano).toBe('1786183200500000000')
    expect(spans[1].endTimeUnixNano).toBe('1786183201000000000')
    expect(encoded).not.toContain('TOP SECRET PROMPT CONTENT')
    expect(encoded).not.toContain('conversation-private')
    expect(encoded).not.toContain('turn-private')
    expect(encoded).not.toContain('run-private')
    expect(encoded).toContain('gen_ai.usage.input_tokens')
    expect(spans[1].kind).toBe(3)
  })

  it('exports tool semantic attributes with CLIENT span kind', async () => {
    const payload = await exportPayload([
      event({
        type: 'tool-call',
        payloads: [{ kind: 'tool-call', name: 'shell_command', content: '{}' }]
      })
    ])
    const span = payload.resourceSpans[0].scopeSpans[0].spans[0]
    expect(span.kind).toBe(3)
    expect(span.attributes).toContainEqual({
      key: 'gen_ai.tool.name',
      value: { stringValue: 'shell_command' }
    })
  })

  it('keeps enqueue non-blocking, bounds the queue and swallows transport failures', async () => {
    let release: (() => void) | undefined
    const transport = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          release = () => reject(new Error('collector down'))
        })
    )
    const exporter = new MetadataOnlyOtlpExporter(
      {
        enabled: true,
        endpoint: 'http://127.0.0.1:4318/v1/traces',
        maxQueue: 2,
        maxQueueBytes: 4_096,
        batchSize: 1,
        flushIntervalMs: 60_000,
        timeoutMs: 100,
        shutdownTimeoutMs: 100
      },
      transport
    )

    expect(exporter.enqueue(event({ id: 'a' }))).toBe('queued')
    expect(exporter.enqueue(event({ id: 'b' }))).toBe('queued')
    expect(exporter.enqueue(event({ id: 'c' }))).toBe('dropped')
    const flushing = exporter.flush()
    release?.()
    await expect(flushing).resolves.toBeUndefined()
    expect(exporter.stats()).toMatchObject({ queued: 1, dropped: 1, failedBatches: 1 })
    exporter.close()
  })

  it('projects before enqueue and bounds memory by bytes, not only by event count', () => {
    const exporter = new MetadataOnlyOtlpExporter({
      enabled: true,
      endpoint: 'http://127.0.0.1:4318/v1/traces',
      maxQueue: 20_000,
      maxQueueBytes: 2_048,
      batchSize: 64,
      flushIntervalMs: 60_000,
      timeoutMs: 100,
      shutdownTimeoutMs: 100
    })
    const huge = event({
      payloads: [{ kind: 'model-response', content: 'SECRET'.repeat(2 * 1024 * 1024) }]
    })
    expect(exporter.enqueue(huge)).toBe('queued')
    expect(exporter.stats().queuedBytes).toBeLessThan(2_048)
    exporter.close()
  })

  it('performs no transport call while disabled', async () => {
    const transport = vi.fn(async () => undefined)
    const exporter = new MetadataOnlyOtlpExporter({ enabled: false, reason: 'disabled' }, transport)
    expect(exporter.enqueue(event())).toBe('disabled')
    await exporter.flush()
    expect(transport).not.toHaveBeenCalled()
  })

  it('drains every bounded batch before an orderly shutdown', async () => {
    const transport = vi.fn(async () => undefined)
    const exporter = new MetadataOnlyOtlpExporter(
      {
        enabled: true,
        endpoint: 'http://127.0.0.1:4318/v1/traces',
        maxQueue: 4,
        maxQueueBytes: 8_192,
        batchSize: 1,
        flushIntervalMs: 60_000,
        timeoutMs: 100,
        shutdownTimeoutMs: 100
      },
      transport
    )
    exporter.enqueue(event({ id: 'a' }))
    exporter.enqueue(event({ id: 'b' }))
    exporter.enqueue(event({ id: 'c' }))

    await exporter.drain()

    expect(transport).toHaveBeenCalledTimes(3)
    expect(exporter.stats()).toMatchObject({ queued: 0, exported: 3 })
    exporter.close()
  })

  it('borne globalement le drain meme si le transport ignore son timeout', async () => {
    vi.useFakeTimers()
    const transport = vi.fn(() => new Promise<void>(() => undefined))
    const exporter = new MetadataOnlyOtlpExporter(
      {
        enabled: true,
        endpoint: 'http://127.0.0.1:4318/v1/traces',
        maxQueue: 10,
        maxQueueBytes: 8_192,
        batchSize: 1,
        flushIntervalMs: 60_000,
        timeoutMs: 30_000,
        shutdownTimeoutMs: 100
      },
      transport
    )
    exporter.enqueue(event({ id: 'a' }))
    exporter.enqueue(event({ id: 'b' }))
    const draining = exporter.drain()
    await vi.advanceTimersByTimeAsync(101)
    await expect(draining).resolves.toBeUndefined()
    expect(exporter.stats()).toMatchObject({ queued: 0, dropped: 2 })
    exporter.close()
    vi.useRealTimers()
  })
})
