import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  statSync
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ImportedModel } from './models'
import type {
  ModelQuotaAvailability,
  ModelQuotaSnapshot,
  ModelQuotaWindow
} from '../shared/model-quotas'

interface ProviderQuota {
  status: ModelQuotaAvailability
  source: string
  observedAt?: string
  windows: ModelQuotaWindow[]
  error?: string
}

const MAX_CREDENTIAL_BYTES = 256_000
const MAX_USAGE_RESPONSE_CHARS = 256_000
const MAX_CODEX_TAIL_BYTES = 2_000_000
const CACHE_MS = 60_000
const CODEX_STALE_MS = 15 * 60_000

let cached: { expiresAt: number; value: ModelQuotaSnapshot } | undefined

function percent(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(100, Math.max(0, value))
}

function resetIso(value: unknown, seconds = false): string | undefined {
  const date =
    typeof value === 'string'
      ? new Date(value)
      : typeof value === 'number'
        ? new Date(seconds ? value * 1_000 : value)
        : undefined
  return date && Number.isFinite(date.valueOf()) ? date.toISOString() : undefined
}

function window(
  id: string,
  label: string,
  raw: unknown,
  resetInSeconds = false
): ModelQuotaWindow | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const record = raw as Record<string, unknown>
  const usedPercent = percent(record.utilization ?? record.used_percent)
  if (usedPercent === undefined) return undefined
  const resetsAt = resetIso(record.resets_at, resetInSeconds)
  return {
    id,
    label,
    usedPercent,
    remainingPercent: 100 - usedPercent,
    ...(resetsAt ? { resetsAt } : {})
  }
}

export function parseClaudeUsage(value: unknown): ModelQuotaWindow[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const payload = value as Record<string, unknown>
  const labels: Record<string, string> = {
    five_hour: '5 h',
    seven_day: '7 j',
    seven_day_opus: 'Opus · 7 j',
    seven_day_sonnet: 'Sonnet · 7 j'
  }
  return Object.entries(payload)
    .map(([key, raw]) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !('resets_at' in raw)) {
        return undefined
      }
      const id = key.replaceAll('_', '-')
      const modelFamily = ['opus', 'sonnet', 'haiku', 'fable'].find((family) =>
        key.toLocaleLowerCase('en-US').includes(family)
      )
      const fallbackLabel = key
        .replaceAll('_', ' ')
        .replace(/^./, (letter) => letter.toLocaleUpperCase('fr-FR'))
      const parsed = window(
        id,
        labels[key] ??
          (modelFamily && key.startsWith('seven_day_')
            ? `${modelFamily[0].toLocaleUpperCase('fr-FR')}${modelFamily.slice(1)} · 7 j`
            : fallbackLabel),
        raw
      )
      return parsed && modelFamily ? { ...parsed, modelFamily } : parsed
    })
    .filter((entry): entry is ModelQuotaWindow => entry !== undefined)
}

function codexWindow(raw: unknown): ModelQuotaWindow | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const record = raw as Record<string, unknown>
  const minutes = typeof record.window_minutes === 'number' ? record.window_minutes : undefined
  const id = minutes === 300 ? 'five-hour' : minutes === 10_080 ? 'seven-day' : `window-${minutes}`
  const label = minutes === 300 ? '5 h' : minutes === 10_080 ? '7 j' : `${minutes ?? '?'} min`
  return window(id, label, raw, true)
}

export function parseLatestCodexRateLimitSample(jsonl: string): {
  windows: ModelQuotaWindow[]
  observedAt?: string
} {
  const lines = jsonl.split(/\r?\n/)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const event = JSON.parse(lines[index]) as {
        timestamp?: unknown
        payload?: { type?: unknown; rate_limits?: unknown }
      }
      if (event.payload?.type !== 'token_count' || !event.payload.rate_limits) continue
      const limits = event.payload.rate_limits as {
        primary?: unknown
        secondary?: unknown
      }
      const windows = [codexWindow(limits.primary), codexWindow(limits.secondary)].filter(
        (entry): entry is ModelQuotaWindow => entry !== undefined
      )
      const observedAt = resetIso(event.timestamp)
      return { windows, ...(observedAt ? { observedAt } : {}) }
    } catch {
      // Une ligne partiellement écrite ne doit pas masquer le dernier événement valide.
    }
  }
  return { windows: [] }
}

export function parseLatestCodexRateLimits(jsonl: string): ModelQuotaWindow[] {
  return parseLatestCodexRateLimitSample(jsonl).windows
}

function windowsForModel(model: ImportedModel, quota: ProviderQuota): ModelQuotaWindow[] {
  return quota.windows.filter(
    (entry) =>
      !entry.modelFamily || model.model.toLocaleLowerCase('en-US').includes(entry.modelFamily)
  )
}

export function buildModelQuotaSnapshot(
  models: readonly ImportedModel[],
  quotas: Partial<Record<string, ProviderQuota>>,
  observedAt = new Date().toISOString()
): ModelQuotaSnapshot {
  const providerCounts = new Map<string, number>()
  for (const model of models)
    providerCounts.set(model.provider, (providerCounts.get(model.provider) ?? 0) + 1)
  const output = models.map((model) => {
    const quota = quotas[model.provider] ?? {
      status: 'unavailable' as const,
      source: 'Quota non exposé',
      windows: []
    }
    const windows = windowsForModel(model, quota)
    return {
      modelId: model.id,
      model: model.model,
      label: model.label,
      provider: model.provider,
      shared: (providerCounts.get(model.provider) ?? 0) > 1,
      status: quota.status,
      source: quota.source,
      ...(quota.observedAt ? { observedAt: quota.observedAt } : {}),
      windows,
      ...(quota.error ? { error: quota.error } : {})
    }
  })
  const remaining = output
    .filter((model) => model.status === 'available')
    .flatMap((model) => model.windows.map((entry) => entry.remainingPercent))
  const minimum = remaining.length > 0 ? Math.min(...remaining) : undefined
  return {
    observedAt,
    summary: {
      ...(minimum !== undefined ? { remainingPercent: minimum } : {}),
      status:
        minimum === undefined
          ? 'unknown'
          : minimum <= 10
            ? 'critical'
            : minimum <= 30
              ? 'warning'
              : 'healthy'
    },
    models: output
  }
}

async function claudeQuota(
  fetchFn: typeof fetch,
  home: string,
  now: number
): Promise<ProviderQuota> {
  try {
    const credentialsPath = join(home, '.claude', '.credentials.json')
    if (!existsSync(credentialsPath) || statSync(credentialsPath).size > MAX_CREDENTIAL_BYTES) {
      throw new Error('Session Claude indisponible')
    }
    const credentials = JSON.parse(readFileSync(credentialsPath, 'utf8')) as {
      claudeAiOauth?: { accessToken?: unknown }
    }
    const accessToken = credentials.claudeAiOauth?.accessToken
    if (typeof accessToken !== 'string' || accessToken.length < 20) {
      throw new Error('Session Claude indisponible')
    }
    const response = await fetchFn('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        authorization: `Bearer ${accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'content-type': 'application/json'
      },
      signal: AbortSignal.timeout(5_000)
    })
    if (!response.ok) throw new Error(`Claude /usage HTTP ${response.status}`)
    const text = await response.text()
    if (text.length > MAX_USAGE_RESPONSE_CHARS) throw new Error('Réponse Claude trop volumineuse')
    const windows = parseClaudeUsage(JSON.parse(text))
    if (windows.length === 0) throw new Error('Claude ne publie aucune fenêtre')
    return {
      status: 'available',
      source: 'Claude /usage',
      observedAt: new Date(now).toISOString(),
      windows
    }
  } catch (error) {
    const message =
      error instanceof Error &&
      /^(Session Claude indisponible|Claude \/usage HTTP \d+|Réponse Claude trop volumineuse|Claude ne publie aucune fenêtre)$/.test(
        error.message
      )
        ? error.message
        : 'Quota Claude indisponible'
    return {
      status: 'unavailable',
      source: 'Claude /usage',
      windows: [],
      error: message
    }
  }
}

function readTail(path: string): string {
  const descriptor = openSync(path, 'r')
  try {
    const size = fstatSync(descriptor).size
    const length = Math.min(size, MAX_CODEX_TAIL_BYTES)
    const buffer = Buffer.alloc(length)
    readSync(descriptor, buffer, 0, length, size - length)
    return buffer.toString('utf8')
  } finally {
    closeSync(descriptor)
  }
}

function codexQuota(home: string, now: number): ProviderQuota {
  try {
    const root = join(home, '.codex', 'sessions')
    const candidates = (readdirSync(root, { recursive: true }) as string[])
      .filter((path) => /(?:^|[\\/])rollout-.*\.jsonl$/.test(path))
      .sort()
      .reverse()
      .slice(0, 20)
    for (const relativePath of candidates) {
      const absolutePath = join(root, relativePath)
      const sample = parseLatestCodexRateLimitSample(readTail(absolutePath))
      if (sample.windows.length > 0) {
        const observedAt = sample.observedAt ?? statSync(absolutePath).mtime.toISOString()
        const age = now - new Date(observedAt).valueOf()
        return {
          status: age > CODEX_STALE_MS ? 'stale' : 'available',
          source: 'Codex local',
          observedAt,
          windows: sample.windows
        }
      }
    }
    throw new Error('Aucun événement rate_limits récent')
  } catch (error) {
    return {
      status: 'unavailable',
      source: 'Codex local',
      windows: [],
      error:
        error instanceof Error && error.message === 'Aucun événement rate_limits récent'
          ? error.message
          : 'Quota Codex indisponible'
    }
  }
}

export async function getModelQuotaSnapshot(
  models: readonly ImportedModel[],
  options: { fetchFn?: typeof fetch; home?: string; now?: number; force?: boolean } = {}
): Promise<ModelQuotaSnapshot> {
  const now = options.now ?? Date.now()
  if (!options.force && cached && cached.expiresAt > now) return cached.value
  const home = options.home ?? homedir()
  const [claude, codex] = await Promise.all([
    claudeQuota(options.fetchFn ?? fetch, home, now),
    Promise.resolve(codexQuota(home, now))
  ])
  const value = buildModelQuotaSnapshot(models, { claude, codex }, new Date(now).toISOString())
  cached = { expiresAt: now + CACHE_MS, value }
  return value
}
