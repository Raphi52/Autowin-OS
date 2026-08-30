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
import { claudeAccountEnv } from './claude-accounts'
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

let cached:
  | { expiresAt: number; collectionSequence: number; value: ModelQuotaSnapshot }
  | undefined
let collectionSequence = 0

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
  // Fenêtres RÉSUMABLES : uniquement les vrais quotas. Une fenêtre sans plafond officiel
  // (mesure locale, `limitKnown: false`) n'a pas de « restant » → l'inclure afficherait un faux
  // « 100 % restant / healthy ».
  const summarizable = output
    .filter((model) => model.status === 'available')
    .flatMap((model) => model.windows.filter((entry) => entry.limitKnown !== false))
  // La wheel résume la fenêtre COURTE (5 h) : c'est elle qui bloque l'utilisateur MAINTENANT. Un
  // weekly plus bas ne doit pas alarmer sur une capacité immédiate qui, elle, est disponible.
  // Aucune fenêtre courte connue → on retombe sur le minimum (comportement historique prudent).
  const shortWindows = summarizable.filter((entry) => entry.id === 'five-hour')
  const pool = shortWindows.length > 0 ? shortWindows : summarizable
  const remaining = pool.map((entry) => entry.remainingPercent)
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

/**
 * Modèle le moins cher pour la SONDE de quota : on n'exploite que les en-têtes de la réponse, le
 * corps est jeté. `max_tokens: 1` + prompt d'un caractère ⇒ coût négligeable.
 */
const CLAUDE_PROBE_MODEL = 'claude-haiku-4-5-20251001'
/** Au-delà, l'échantillon du client Desktop est considéré comme périmé (il écrit toutes les ~5 min). */
const CLAUDE_PLAN_HISTORY_STALE_MS = 15 * 60_000

/**
 * Quota RÉEL depuis les en-têtes `anthropic-ratelimit-unified-*` d'un appel `/v1/messages`.
 * Mesuré sur ce poste : `…-5h-utilization: 0.34`, `…-5h-reset: 1785252600`, idem `-7d`.
 *
 * ATTENTION à l'unité : ces en-têtes publient une FRACTION (0.34 = 34 %) alors que Codex publie
 * déjà un pourcentage — d'où la conversion ×100 ici (sinon 0,34 % affiché au lieu de 34 %).
 */
export function parseClaudeRateLimitHeaders(headers: {
  get(name: string): string | null
}): ModelQuotaWindow[] {
  const build = (id: string, label: string, prefix: string): ModelQuotaWindow | undefined => {
    const rawUtilization = headers.get(`anthropic-ratelimit-unified-${prefix}-utilization`)
    if (rawUtilization === null) return undefined
    const fraction = Number(rawUtilization)
    if (!Number.isFinite(fraction)) return undefined
    const usedPercent = Math.min(100, Math.max(0, fraction * 100))
    const rawReset = headers.get(`anthropic-ratelimit-unified-${prefix}-reset`)
    // Garde : sans en-tête de reset, `Number(null)` vaudrait 0 → une date de 1970 affichée comme reset.
    const resetsAt = rawReset === null ? undefined : resetIso(Number(rawReset), true)
    return {
      id,
      label,
      usedPercent,
      remainingPercent: 100 - usedPercent,
      ...(resetsAt ? { resetsAt } : {})
    }
  }
  return [build('five-hour', '5 h', '5h'), build('seven-day', '7 j', '7d')].filter(
    (entry): entry is ModelQuotaWindow => entry !== undefined
  )
}

/**
 * Repli ZÉRO-RÉSEAU : le client Claude Desktop échantillonne l'utilisation du plan toutes les ~5 min
 * dans `%APPDATA%\Claude\plan-usage-history.json` (`u.fh` = fenêtre 5 h en %, `u.sd` = 7 j en %).
 * Vérifié sur ce poste et CONCORDANT avec les en-têtes (fh 33 % vs 0.34). Aucune date de reset
 * publiée → la fenêtre est rendue sans `resetsAt` (l'UI affiche « reset non exposé »).
 */
export function parseClaudePlanUsageHistory(
  raw: string,
  now: number
): { windows: ModelQuotaWindow[]; sampledAt: number } | undefined {
  const payload = JSON.parse(raw) as { samples?: unknown }
  if (!Array.isArray(payload.samples) || payload.samples.length === 0) return undefined
  const last = payload.samples[payload.samples.length - 1] as {
    t?: unknown
    u?: { fh?: unknown; sd?: unknown }
  }
  const sampledAt = typeof last.t === 'number' && Number.isFinite(last.t) ? last.t : NaN
  if (!Number.isFinite(sampledAt) || sampledAt > now + 60_000) return undefined
  const build = (id: string, label: string, value: unknown): ModelQuotaWindow | undefined => {
    const usedPercent = percent(value)
    if (usedPercent === undefined) return undefined
    return { id, label, usedPercent, remainingPercent: 100 - usedPercent }
  }
  const windows = [
    build('five-hour', '5 h', last.u?.fh),
    build('seven-day', '7 j', last.u?.sd)
  ].filter((entry): entry is ModelQuotaWindow => entry !== undefined)
  return windows.length > 0 ? { windows, sampledAt } : undefined
}

function claudePlanHistoryQuota(home: string, now: number): ProviderQuota {
  const source = 'Client Claude Desktop (local)'
  try {
    const path = join(home, 'AppData', 'Roaming', 'Claude', 'plan-usage-history.json')
    if (!existsSync(path) || statSync(path).size > MAX_USAGE_RESPONSE_CHARS * 4) {
      throw new Error('Historique de plan absent')
    }
    const parsed = parseClaudePlanUsageHistory(readFileSync(path, 'utf8'), now)
    if (!parsed) throw new Error('Historique de plan illisible')
    const age = now - parsed.sampledAt
    return {
      status: age > CLAUDE_PLAN_HISTORY_STALE_MS ? 'stale' : 'available',
      source,
      observedAt: new Date(parsed.sampledAt).toISOString(),
      windows: parsed.windows
    }
  } catch (error) {
    return {
      status: 'unavailable',
      source,
      windows: [],
      error: error instanceof Error ? error.message : 'Historique de plan indisponible'
    }
  }
}

async function claudeQuota(
  fetchFn: typeof fetch,
  home: string,
  now: number
): Promise<ProviderQuota> {
  try {
    // Le token lu doit etre celui du compte ACTIF : le routage bascule les CLI via
    // `CLAUDE_CONFIG_DIR`, donc lire `~/.claude` en dur affichait le quota de l'ANCIEN compte apres
    // une bascule. Repli sur le dossier historique quand aucun compte dedie n'est actif.
    const configDir = claudeAccountEnv().CLAUDE_CONFIG_DIR
    const credentialsPath = configDir
      ? join(configDir, '.credentials.json')
      : join(home, '.claude', '.credentials.json')
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
    // `/api/oauth/usage` est ABANDONNÉ ici : il répond 429 systématiquement pour un token
    // d'abonnement (bug ouvert non résolu côté Claude Code — issues 31021 / 31637 / 30930 ; vérifié
    // sur ce poste : /api/oauth/profile → 200 avec le MÊME token, /usage → 429 quels que soient les
    // en-têtes). Le quota réel vit dans les en-têtes d'un appel d'inférence accepté : une requête
    // invalide (400) ne les porte PAS (testé), d'où la sonde minimale ci-dessous.
    const response = await fetchFn('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: CLAUDE_PROBE_MODEL,
        max_tokens: 1,
        messages: [{ role: 'user', content: '.' }]
      }),
      signal: AbortSignal.timeout(10_000)
    })
    if (!response.ok) throw new Error(`Claude /usage HTTP ${response.status}`)
    const windows = parseClaudeRateLimitHeaders(response.headers)
    if (windows.length === 0) throw new Error('Claude ne publie aucune fenêtre')
    return {
      status: 'available',
      source: 'Quota Claude (en-têtes API)',
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
    // Repli EN CASCADE, du plus fidèle au plus approximatif — jamais un « Non exposé » stérile :
    //  1. client Desktop (vrai % du plan, zéro réseau, ~5 min de fraîcheur, sans date de reset) ;
    //  2. consommation mesurée sur les transcripts (`limitKnown: false` → tokens, pas de %).
    const history = claudePlanHistoryQuota(home, now)
    if (history.status !== 'unavailable') {
      return { ...history, error: `${message} — repli sur le client Desktop` }
    }
    const local = claudeLocalQuota(home, now)
    if (local.status === 'available') {
      return { ...local, error: `${message} — repli sur la mesure locale` }
    }
    return {
      status: 'unavailable',
      source: 'Quota Claude (en-têtes API)',
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

/**
 * Consommation Claude MESURÉE LOCALEMENT depuis les transcripts de Claude Code
 * (`~/.claude/projects/**\/*.jsonl` : chaque message assistant porte son `usage` + `timestamp`).
 *
 * POURQUOI : `/api/oauth/usage` répond 429 pour un token dont les scopes ne couvrent pas l'usage
 * (vérifié : `profile` → 200, `usage` → 429 quels que soient les en-têtes ; scopes observés =
 * user:inference/profile/sessions/... sans scope usage). Aucun plafond officiel n'est donc
 * récupérable → on n'INVENTE pas de pourcentage : `limitKnown: false` + tokens consommés.
 *
 * BORNÉ (coût) : on ne lit que les fichiers dont le mtime tombe dans la fenêtre, les plus récents
 * d'abord, plafonnés en nombre et en octets lus (readTail). Une troncature est signalée, jamais
 * masquée.
 */
// Mesuré sur ce poste : la fenêtre 7 j = ~500 transcripts / ~62 Mo à lire (tail borné), la 5 h en
// consomme déjà ~234 → un plafond trop bas tronquait le 7 j au point de l'aligner sur le 5 h
// (chiffre faux). 800 couvre les deux fenêtres ; l'appel est mis en cache 60 s (CACHE_MS).
const CLAUDE_LOCAL_MAX_FILES = 800

export function aggregateClaudeLocalUsage(
  entries: { mtimeMs: number; read: () => string }[],
  now: number,
  windows: { id: string; label: string; ms: number }[]
): { windows: ModelQuotaWindow[]; truncated: boolean } {
  const widest = Math.max(...windows.map((w) => w.ms))
  const candidates = entries
    .filter((entry) => entry.mtimeMs >= now - widest)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
  const truncated = candidates.length > CLAUDE_LOCAL_MAX_FILES
  const totals = new Map<string, number>(windows.map((w) => [w.id, 0]))
  for (const entry of candidates.slice(0, CLAUDE_LOCAL_MAX_FILES)) {
    let content: string
    try {
      content = entry.read()
    } catch {
      continue // transcript illisible (verrou, suppression concurrente) → ignoré, jamais fatal
    }
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('{') || !trimmed.includes('usage')) continue
      let record: Record<string, unknown>
      try {
        record = JSON.parse(trimmed) as Record<string, unknown>
      } catch {
        continue // 1re ligne coupée par le tail, ou ligne partielle en cours d'écriture
      }
      const message = (record.message ?? {}) as Record<string, unknown>
      const usage = (message.usage ?? record.usage) as Record<string, unknown> | undefined
      const at = Date.parse(String(record.timestamp ?? ''))
      if (!usage || !Number.isFinite(at)) continue
      const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
      // `cache_read_input_tokens` est VOLONTAIREMENT exclu : c'est le contexte relu à chaque tour,
      // il se compte en centaines de millions sur une journée et écraserait le signal (mesuré :
      // 480 M sur 5 h, chiffre vrai mais trompeur). On somme ce qui est réellement consommé neuf.
      const tokens =
        num(usage.input_tokens) + num(usage.output_tokens) + num(usage.cache_creation_input_tokens)
      for (const w of windows) {
        if (at >= now - w.ms) totals.set(w.id, (totals.get(w.id) ?? 0) + tokens)
      }
    }
  }
  return {
    truncated,
    windows: windows.map((w) => ({
      id: w.id,
      label: w.label,
      // Aucun plafond officiel connu → ces pourcentages ne sont PAS un quota (limitKnown: false).
      usedPercent: 0,
      remainingPercent: 100,
      limitKnown: false,
      usedTokens: totals.get(w.id) ?? 0
    }))
  }
}

function claudeLocalQuota(home: string, now: number): ProviderQuota {
  const source = 'Transcripts Claude Code (local)'
  try {
    const root = join(home, '.claude', 'projects')
    if (!existsSync(root)) throw new Error('Aucun transcript local')
    const entries = (readdirSync(root, { recursive: true }) as string[])
      .filter((path) => path.endsWith('.jsonl'))
      .map((relativePath) => {
        const absolutePath = join(root, relativePath)
        return { absolutePath, mtimeMs: statSync(absolutePath).mtimeMs }
      })
      .map((file) => ({ mtimeMs: file.mtimeMs, read: () => readTail(file.absolutePath) }))
    const aggregate = aggregateClaudeLocalUsage(entries, now, [
      { id: 'local-5h', label: '5 h · tokens neufs', ms: 5 * 3_600_000 },
      { id: 'local-7d', label: '7 j · tokens neufs', ms: 7 * 24 * 3_600_000 }
    ])
    if (aggregate.windows.every((w) => (w.usedTokens ?? 0) === 0)) {
      throw new Error('Aucune consommation locale mesurable')
    }
    return {
      status: 'available',
      source: aggregate.truncated ? `${source} · échantillon partiel` : source,
      observedAt: new Date(now).toISOString(),
      windows: aggregate.windows
    }
  } catch (error) {
    return {
      status: 'unavailable',
      source,
      windows: [],
      error: error instanceof Error ? error.message : 'Usage local indisponible'
    }
  }
}

function codexQuota(home: string, now: number): ProviderQuota {
  try {
    const root = join(home, '.codex', 'sessions')
    const candidates = (readdirSync(root, { recursive: true }) as string[])
      .filter((path) => /(?:^|[\\/])rollout-.*\.jsonl$/.test(path))
      .map((relativePath) => {
        const absolutePath = join(root, relativePath)
        return { absolutePath, mtime: statSync(absolutePath).mtime }
      })
      .sort((left, right) => right.mtime.valueOf() - left.mtime.valueOf())
      .slice(0, 20)
    type CodexQuotaCandidate = {
      observedAt: string
      observedAtMs: number
      windows: ModelQuotaWindow[]
      trustedTimestamp: boolean
    }
    let latestTimestamped: CodexQuotaCandidate | undefined
    let latestFallback: CodexQuotaCandidate | undefined
    for (const candidate of candidates) {
      const sample = parseLatestCodexRateLimitSample(readTail(candidate.absolutePath))
      if (sample.windows.length > 0) {
        const observedAt = sample.observedAt ?? candidate.mtime.toISOString()
        const observedAtMs = new Date(observedAt).valueOf()
        const trustedTimestamp = sample.observedAt !== undefined
        const quotaCandidate = {
          observedAt,
          observedAtMs,
          windows: sample.windows,
          trustedTimestamp
        }
        if (trustedTimestamp) {
          if (!latestTimestamped || observedAtMs > latestTimestamped.observedAtMs) {
            latestTimestamped = quotaCandidate
          }
        } else if (!latestFallback || observedAtMs > latestFallback.observedAtMs) {
          latestFallback = quotaCandidate
        }
      }
    }
    const latest = latestTimestamped ?? latestFallback
    if (latest) {
      const age = now - latest.observedAtMs
      return {
        status: !latest.trustedTimestamp || age > CODEX_STALE_MS ? 'stale' : 'available',
        source: 'Codex local',
        observedAt: latest.observedAt,
        windows: latest.windows
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

/**
 * Jette le snapshot memorise. Appele quand l'IDENTITE change (bascule de compte dans le routage) :
 * le cache de 60 s est indexe sur le temps, pas sur le compte, donc sans cela l'utilisateur voyait
 * encore le quota du compte precedent apres avoir change.
 */
export function invalidateModelQuotaCache(): void {
  cached = undefined
}

export async function getModelQuotaSnapshot(
  models: readonly ImportedModel[],
  options: { fetchFn?: typeof fetch; home?: string; now?: number; force?: boolean } = {}
): Promise<ModelQuotaSnapshot> {
  const now = options.now ?? Date.now()
  if (!options.force && cached && cached.expiresAt > now) return cached.value
  const currentCollectionSequence = ++collectionSequence
  const home = options.home ?? homedir()
  const [claude, codex] = await Promise.all([
    claudeQuota(options.fetchFn ?? fetch, home, now),
    Promise.resolve(codexQuota(home, now))
  ])
  const value = buildModelQuotaSnapshot(models, { claude, codex }, new Date(now).toISOString())
  if (!cached || currentCollectionSequence >= cached.collectionSequence) {
    cached = {
      expiresAt: now + CACHE_MS,
      collectionSequence: currentCollectionSequence,
      value
    }
  }
  return value
}
