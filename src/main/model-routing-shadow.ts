import { createHash } from 'node:crypto'
import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname } from 'node:path'
import { PIPELINE_PHASES, type PipelinePhase } from './skill-pipeline'
import type { RoleBinding } from './roles'
import type { TraceEventV1 } from './activity/trace-event'

export type RoutingOutcome = 'verified-success' | 'verified-failure' | 'call-failure'

export interface RoutingObservation {
  schema: 'autowin.routing-observation/v1'
  id: string
  timestamp: string
  phase: PipelinePhase
  provider: string
  model: string
  outcome: RoutingOutcome
  durationMs?: number
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
}

export interface ShadowQuotaHint {
  provider: string
  model?: string
  status: 'available' | 'unavailable' | 'unknown'
  remainingPercent?: number
}

export interface ShadowRankingEntry {
  provider: string
  model: string
  score: number
  samples: number
  verifiedSamples: number
  verifiedSuccessRate: number
  quotaPenalty: number
  qualityVetoed: boolean
  reasons: string[]
}

export interface ShadowRoutingAdvice {
  /** Copy of what execution will continue to use. This module has no mutation path. */
  executionBinding: RoleBinding
  recommended: { provider: string; model: string }
  confidence: 'low' | 'medium' | 'high'
  eligibleForReview: boolean
  ranking: ShadowRankingEntry[]
}

interface ShadowRoutingInput {
  phase: PipelinePhase
  current: RoleBinding
  candidates: ReadonlyArray<{ provider: string; model: string }>
  observations: readonly RoutingObservation[]
  quotas?: readonly ShadowQuotaHint[]
  now?: number
}

interface CandidateStats {
  provider: string
  model: string
  samples: number
  verifiedSamples: number
  successWeight: number
  failureWeight: number
  callFailureWeight: number
  totalWeight: number
  durationWeighted: number
  durationWeight: number
  costWeighted: number
  costWeight: number
}

const HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1_000
const OUTCOMES = new Set<RoutingOutcome>(['verified-success', 'verified-failure', 'call-failure'])

function key(provider: string, model: string): string {
  return `${provider}\0${model}`
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function isRoutingObservation(value: unknown): value is RoutingObservation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<RoutingObservation>
  return (
    candidate.schema === 'autowin.routing-observation/v1' &&
    typeof candidate.id === 'string' &&
    candidate.id.trim().length > 0 &&
    typeof candidate.timestamp === 'string' &&
    Number.isFinite(Date.parse(candidate.timestamp)) &&
    PIPELINE_PHASES.includes(candidate.phase as PipelinePhase) &&
    typeof candidate.provider === 'string' &&
    candidate.provider.trim().length > 0 &&
    typeof candidate.model === 'string' &&
    candidate.model.trim().length > 0 &&
    OUTCOMES.has(candidate.outcome as RoutingOutcome) &&
    [candidate.durationMs, candidate.inputTokens, candidate.outputTokens, candidate.costUsd].every(
      (entry) => entry === undefined || finiteNonNegative(entry)
    )
  )
}

function recencyWeight(timestamp: string, now: number): number {
  const age = Math.max(0, now - Date.parse(timestamp))
  return Math.pow(0.5, age / HALF_LIFE_MS)
}

function normalizedInverse(value: number | undefined, values: readonly number[]): number {
  if (value === undefined || values.length === 0) return 0.5
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  if (maximum === minimum) return 0.5
  return 1 - (value - minimum) / (maximum - minimum)
}

function quotaPenalty(provider: string, model: string, quotas: readonly ShadowQuotaHint[]): number {
  const quota = quotas.find(
    (candidate) =>
      candidate.provider === provider &&
      (candidate.model === undefined || candidate.model === model)
  )
  if (!quota || quota.status !== 'available' || !finiteNonNegative(quota.remainingPercent)) return 0
  if (quota.remainingPercent <= 10) return 0.25
  if (quota.remainingPercent <= 30) return 0.1
  return 0
}

/**
 * Read-only recommendation. It never calls a provider, probes quotas or writes RoleModelConfig.
 * Completion alone is not quality evidence: only explicit verified-success/failure observations count.
 */
export function rankShadowModels(input: ShadowRoutingInput): ShadowRoutingAdvice {
  const now = input.now ?? Date.now()
  const candidates = new Map<string, { provider: string; model: string }>()
  for (const candidate of input.candidates)
    candidates.set(key(candidate.provider, candidate.model), candidate)
  if (input.current.model) {
    candidates.set(key(input.current.provider, input.current.model), {
      provider: input.current.provider,
      model: input.current.model
    })
  }

  const stats = [...candidates.values()].map<CandidateStats>((candidate) => ({
    ...candidate,
    samples: 0,
    verifiedSamples: 0,
    successWeight: 0,
    failureWeight: 0,
    callFailureWeight: 0,
    totalWeight: 0,
    durationWeighted: 0,
    durationWeight: 0,
    costWeighted: 0,
    costWeight: 0
  }))
  const byKey = new Map(stats.map((entry) => [key(entry.provider, entry.model), entry]))
  for (const observation of input.observations) {
    if (!isRoutingObservation(observation) || observation.phase !== input.phase) continue
    const target = byKey.get(key(observation.provider, observation.model))
    if (!target) continue
    const weight = recencyWeight(observation.timestamp, now)
    target.samples += 1
    target.totalWeight += weight
    if (observation.outcome === 'verified-success') {
      target.verifiedSamples += 1
      target.successWeight += weight
    } else if (observation.outcome === 'verified-failure') {
      target.verifiedSamples += 1
      target.failureWeight += weight
    } else {
      target.callFailureWeight += weight
    }
    if (observation.durationMs !== undefined) {
      target.durationWeighted += observation.durationMs * weight
      target.durationWeight += weight
    }
    if (observation.costUsd !== undefined) {
      target.costWeighted += observation.costUsd * weight
      target.costWeight += weight
    }
  }

  const durationMeans = stats
    .filter((entry) => entry.durationWeight > 0)
    .map((entry) => entry.durationWeighted / entry.durationWeight)
  const costMeans = stats
    .filter((entry) => entry.costWeight > 0)
    .map((entry) => entry.costWeighted / entry.costWeight)
  const ranking = stats
    .map<ShadowRankingEntry>((entry) => {
      const verifiedWeight = entry.successWeight + entry.failureWeight
      const successRate = (entry.successWeight + 1) / (verifiedWeight + 2)
      const technicalReliability =
        1 - entry.callFailureWeight / Math.max(1, entry.totalWeight + entry.callFailureWeight)
      const quality = 0.8 * successRate + 0.2 * technicalReliability
      const duration =
        entry.durationWeight > 0 ? entry.durationWeighted / entry.durationWeight : undefined
      const cost = entry.costWeight > 0 ? entry.costWeighted / entry.costWeight : undefined
      const failureRate = verifiedWeight > 0 ? entry.failureWeight / verifiedWeight : 0
      const qualityVetoed = entry.verifiedSamples >= 5 && failureRate >= 0.4
      const penalty = quotaPenalty(entry.provider, entry.model, input.quotas ?? [])
      let score =
        0.75 * quality +
        0.125 * normalizedInverse(duration, durationMeans) +
        0.125 * normalizedInverse(cost, costMeans) -
        penalty
      if (qualityVetoed) score = Math.min(score, 0.45)
      const reasons = [
        `${entry.verifiedSamples} livraison(s) vérifiée(s)`,
        `réussite vérifiée ${Math.round(successRate * 100)} %`,
        duration === undefined ? 'latence inconnue' : `latence moyenne ${Math.round(duration)} ms`,
        cost === undefined ? 'coût inconnu' : `coût moyen ${cost.toFixed(4)} $`,
        penalty > 0 ? `pression quota -${Math.round(penalty * 100)} points` : 'quota neutre'
      ]
      if (qualityVetoed) reasons.push('veto qualité : échecs vérifiés répétés')
      return {
        provider: entry.provider,
        model: entry.model,
        score: Math.max(0, Math.min(1, score)),
        samples: entry.samples,
        verifiedSamples: entry.verifiedSamples,
        verifiedSuccessRate: successRate,
        quotaPenalty: penalty,
        qualityVetoed,
        reasons
      }
    })
    .sort((left, right) => right.score - left.score || left.model.localeCompare(right.model))

  const fallback = {
    provider: input.current.provider,
    model: input.current.model ?? input.current.provider
  }
  const recommended = ranking[0] ?? {
    ...fallback,
    score: 0,
    samples: 0,
    verifiedSamples: 0,
    verifiedSuccessRate: 0.5,
    quotaPenalty: 0,
    qualityVetoed: false,
    reasons: []
  }
  const margin = recommended.score - (ranking[1]?.score ?? 0)
  const confidence: ShadowRoutingAdvice['confidence'] =
    recommended.verifiedSamples < 5
      ? 'low'
      : recommended.verifiedSamples >= 30 && margin >= 0.08
        ? 'high'
        : 'medium'
  const differs =
    recommended.provider !== input.current.provider || recommended.model !== input.current.model
  return {
    executionBinding: { ...input.current },
    recommended: { provider: recommended.provider, model: recommended.model },
    confidence,
    eligibleForReview: confidence !== 'low' && differs,
    ranking
  }
}

interface ShadowRoutingStoreOptions {
  maxObservations?: number
  maxStoreBytes?: number
  maxRecordBytes?: number
}

const DEFAULT_MAX_OBSERVATIONS = 5_000
const DEFAULT_MAX_STORE_BYTES = 8 * 1024 * 1024
const DEFAULT_MAX_RECORD_BYTES = 4 * 1024

/** Durable bounded observations; malformed records are ignored and recent duplicate ids suppressed. */
export class ShadowRoutingStore {
  private knownIds: Set<string> | undefined
  private knownOrder: string[] = []
  private lastReadBytes = 0

  constructor(
    private readonly path: string,
    private readonly options: ShadowRoutingStoreOptions = {}
  ) {}

  private get maxObservations(): number {
    return positiveBound(this.options.maxObservations, DEFAULT_MAX_OBSERVATIONS)
  }

  private get maxStoreBytes(): number {
    return positiveBound(this.options.maxStoreBytes, DEFAULT_MAX_STORE_BYTES)
  }

  private get maxRecordBytes(): number {
    return positiveBound(this.options.maxRecordBytes, DEFAULT_MAX_RECORD_BYTES)
  }

  append(observation: RoutingObservation): boolean {
    if (!isRoutingObservation(observation)) return false
    const serialized = JSON.stringify(observation)
    if (Buffer.byteLength(serialized, 'utf8') > this.maxRecordBytes) return false
    const ids = this.ids()
    if (ids.has(observation.id)) return false
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      appendFileSync(this.path, `${serialized}\n`, 'utf8')
      this.rememberId(observation.id)
      this.compactIfNeeded()
      return true
    } catch {
      return false
    }
  }

  read(limit = 5_000): RoutingObservation[] {
    this.lastReadBytes = 0
    if (!existsSync(this.path)) return []
    const requested = Math.min(this.maxObservations, Math.max(0, Math.floor(limit)))
    if (requested === 0) return []
    let handle: number | undefined
    try {
      handle = openSync(this.path, 'r')
      const size = fstatSync(handle).size
      const bytesToRead = Math.min(size, (requested + 1) * this.maxRecordBytes)
      this.lastReadBytes = bytesToRead
      const offset = size - bytesToRead
      const buffer = Buffer.allocUnsafe(bytesToRead)
      readSync(handle, buffer, 0, bytesToRead, offset)
      let text = buffer.toString('utf8')
      if (offset > 0) {
        const firstBreak = text.indexOf('\n')
        if (firstBreak < 0) return []
        text = text.slice(firstBreak + 1)
      }
      return text
        .split(/\r?\n/)
        .filter(Boolean)
        .flatMap((line) => {
          try {
            const parsed: unknown = JSON.parse(line)
            return isRoutingObservation(parsed) ? [parsed] : []
          } catch {
            return []
          }
        })
        .slice(-requested)
    } catch {
      return []
    } finally {
      if (handle !== undefined) closeSync(handle)
    }
  }

  stats(): { knownIds: number; fileBytes: number; lastReadBytes: number } {
    let fileBytes = 0
    try {
      fileBytes = existsSync(this.path) ? statSync(this.path).size : 0
    } catch {
      /* best-effort diagnostic */
    }
    return { knownIds: this.knownIds?.size ?? 0, fileBytes, lastReadBytes: this.lastReadBytes }
  }

  private ids(): Set<string> {
    if (!this.knownIds) {
      this.knownIds = new Set()
      for (const item of this.read(this.maxObservations)) this.rememberId(item.id)
    }
    return this.knownIds
  }

  private rememberId(id: string): void {
    const ids = this.knownIds ?? (this.knownIds = new Set())
    if (ids.has(id)) return
    ids.add(id)
    this.knownOrder.push(id)
    while (this.knownOrder.length > this.maxObservations) {
      const oldest = this.knownOrder.shift()
      if (oldest) ids.delete(oldest)
    }
  }

  private compactIfNeeded(): void {
    if (statSync(this.path).size <= this.maxStoreBytes) return
    const recent = this.read(this.maxObservations)
    const retained: string[] = []
    let retainedBytes = 0
    for (let index = recent.length - 1; index >= 0; index -= 1) {
      const line = `${JSON.stringify(recent[index])}\n`
      const bytes = Buffer.byteLength(line, 'utf8')
      if (retainedBytes + bytes > this.maxStoreBytes) break
      retained.unshift(line)
      retainedBytes += bytes
    }
    writeFileSync(this.path, retained.join(''), 'utf8')
    this.knownIds = new Set()
    this.knownOrder = []
    for (const line of retained) {
      const parsed: unknown = JSON.parse(line)
      if (isRoutingObservation(parsed)) this.rememberId(parsed.id)
    }
  }
}

function positiveBound(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : fallback
}

interface RoutingObservationSink {
  append(observation: RoutingObservation): boolean
}

interface PendingRoute {
  phase: PipelinePhase
  provider: string
  model: string
  durationMs?: number
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  eventId: string
  callFailed: boolean
}

interface PendingRun {
  touchedAt: number
  routes: Map<string, PendingRoute>
}

interface ShadowRoutingObserverOptions {
  maxPendingRuns?: number
  maxRoutesPerRun?: number
  pendingTtlMs?: number
  now?: () => number
}

/**
 * Corrèle les appels modèle à l'issue vérifiée du run. Un simple appel `completed` n'est jamais
 * appris comme une réussite : seul l'événement gate terminal transforme les mesures en observation.
 */
export class ShadowRoutingTraceObserver {
  private readonly pendingByRun = new Map<string, PendingRun>()

  constructor(
    private readonly sink: RoutingObservationSink,
    private readonly options: ShadowRoutingObserverOptions = {}
  ) {}

  observe(event: TraceEventV1): void {
    const now = this.options.now?.() ?? Date.now()
    this.evictExpired(now)
    const runId = event.execution?.runId
    if (!runId) return
    const phase = event.execution?.phase
    const isProviderTerminal =
      (event.type === 'model-response' || event.type === 'error') && event.actor.kind === 'provider'
    if (
      isProviderTerminal &&
      event.provider?.id &&
      event.provider.model &&
      phase &&
      PIPELINE_PHASES.includes(phase as PipelinePhase)
    ) {
      const safePhase = phase as PipelinePhase
      let pending = this.pendingByRun.get(runId)
      if (!pending) {
        while (this.pendingByRun.size >= positiveBound(this.options.maxPendingRuns, 1_000)) {
          const oldest = this.pendingByRun.keys().next().value
          if (oldest === undefined) break
          this.pendingByRun.delete(oldest)
        }
        pending = { touchedAt: now, routes: new Map() }
      } else {
        this.pendingByRun.delete(runId)
        pending.touchedAt = now
      }
      const routeKey = `${safePhase}\0${event.id}`
      while (
        !pending.routes.has(routeKey) &&
        pending.routes.size >= positiveBound(this.options.maxRoutesPerRun, 256)
      ) {
        const oldest = pending.routes.keys().next().value
        if (oldest === undefined) break
        pending.routes.delete(oldest)
      }
      pending.routes.set(routeKey, {
        phase: safePhase,
        provider: event.provider.id,
        model: event.provider.model,
        durationMs: event.metrics?.durationMs,
        inputTokens: event.metrics?.inputTokens,
        outputTokens: event.metrics?.outputTokens,
        costUsd: event.metrics?.costUsd,
        eventId: event.id,
        callFailed: event.type === 'error' || event.status === 'failed'
      })
      this.pendingByRun.set(runId, pending)
    }
    if (event.type !== 'gate') return

    const pending = this.pendingByRun.get(runId)
    if (!pending) return
    const outcome: RoutingOutcome =
      event.status === 'completed' ? 'verified-success' : 'verified-failure'
    for (const route of pending.routes.values()) {
      const routeOutcome: RoutingOutcome = route.callFailed ? 'call-failure' : outcome
      const id = createHash('sha256')
        .update(`${event.id}\0${route.eventId}\0${routeOutcome}`, 'utf8')
        .digest('hex')
      this.sink.append({
        schema: 'autowin.routing-observation/v1',
        id,
        timestamp: event.timestamp,
        phase: route.phase,
        provider: route.provider,
        model: route.model,
        outcome: routeOutcome,
        ...(route.durationMs !== undefined ? { durationMs: route.durationMs } : {}),
        ...(route.inputTokens !== undefined ? { inputTokens: route.inputTokens } : {}),
        ...(route.outputTokens !== undefined ? { outputTokens: route.outputTokens } : {}),
        ...(route.costUsd !== undefined ? { costUsd: route.costUsd } : {})
      })
    }
    this.pendingByRun.delete(runId)
  }

  private evictExpired(now: number): void {
    const ttl = positiveBound(this.options.pendingTtlMs, 6 * 60 * 60 * 1_000)
    for (const [runId, pending] of this.pendingByRun) {
      if (now - pending.touchedAt > ttl) this.pendingByRun.delete(runId)
    }
  }
}

export const SHADOW_ROUTING_ENABLED_ENV = 'AUTOWIN_MODEL_ROUTING_SHADOW_ENABLED'

export type ShadowRoutingRuntime =
  | { enabled: false }
  | {
      enabled: true
      store: ShadowRoutingStore
      observer: ShadowRoutingTraceObserver
    }

/**
 * Le pilote shadow est un opt-in explicite. Tant que la variable n'est pas a `1` ou `true`, aucun
 * store ni observateur n'est construit et aucun fichier ne peut etre materialise.
 */
export function createShadowRoutingRuntime(
  path: string,
  env: Readonly<Record<string, string | undefined>> = process.env
): ShadowRoutingRuntime {
  const flag = env[SHADOW_ROUTING_ENABLED_ENV]?.trim().toLowerCase()
  if (flag !== '1' && flag !== 'true') return { enabled: false }
  const store = new ShadowRoutingStore(path)
  return {
    enabled: true,
    store,
    observer: new ShadowRoutingTraceObserver(store)
  }
}
