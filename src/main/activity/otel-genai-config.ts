export type OtelGenAiConfig =
  | { enabled: false; reason: 'disabled' | 'invalid-endpoint' }
  | {
      enabled: true
      endpoint: string
      maxQueue: number
      maxQueueBytes: number
      batchSize: number
      flushIntervalMs: number
      timeoutMs: number
      shutdownTimeoutMs: number
    }

function boundedInteger(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

/** Explicit opt-in only. Invalid configuration degrades to OFF instead of breaking application boot. */
export function resolveOtelGenAiConfig(
  env: Record<string, string | undefined> = process.env
): OtelGenAiConfig {
  if (env.AUTOWIN_OTEL_EXPORTER !== '1') return { enabled: false, reason: 'disabled' }
  const rawEndpoint = env.AUTOWIN_OTEL_ENDPOINT?.trim() || 'http://127.0.0.1:4318/v1/traces'
  try {
    const endpoint = new URL(rawEndpoint)
    if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
      return { enabled: false, reason: 'invalid-endpoint' }
    }
    return {
      enabled: true,
      endpoint: endpoint.toString(),
      maxQueue: boundedInteger(env.AUTOWIN_OTEL_MAX_QUEUE, 1_000, 1, 20_000),
      maxQueueBytes: boundedInteger(
        env.AUTOWIN_OTEL_MAX_QUEUE_BYTES,
        2 * 1024 * 1024,
        64 * 1024,
        16 * 1024 * 1024
      ),
      batchSize: boundedInteger(env.AUTOWIN_OTEL_BATCH_SIZE, 64, 1, 512),
      flushIntervalMs: boundedInteger(env.AUTOWIN_OTEL_FLUSH_MS, 2_000, 50, 60_000),
      timeoutMs: boundedInteger(env.AUTOWIN_OTEL_TIMEOUT_MS, 3_000, 100, 30_000),
      shutdownTimeoutMs: boundedInteger(env.AUTOWIN_OTEL_SHUTDOWN_MS, 1_500, 100, 5_000)
    }
  } catch {
    return { enabled: false, reason: 'invalid-endpoint' }
  }
}
