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

const OUTCOMES = new Set<RoutingOutcome>(['verified-success', 'verified-failure', 'call-failure'])

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isRoutingObservation(value: unknown): value is RoutingObservation {
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

const SHADOW_ROUTING_ENABLED_ENV = 'AUTOWIN_MODEL_ROUTING_SHADOW_ENABLED'

export type ShadowRoutingRuntime =
  | { enabled: false }
  | {
      enabled: true
      store: ShadowRoutingStore
      observer: ShadowRoutingTraceObserver
    }

/**
 * Surcharge d'environnement : `1`/`true` force ON, `0`/`false` force OFF. Toute autre valeur (vide,
 * inconnue, absente) rend `undefined` : l'environnement ne tranche pas et laisse decider le reglage.
 */
export function shadowRoutingEnvOverride(
  env: Readonly<Record<string, string | undefined>>
): boolean | undefined {
  const flag = env[SHADOW_ROUTING_ENABLED_ENV]?.trim().toLowerCase()
  if (flag === '1' || flag === 'true') return true
  if (flag === '0' || flag === 'false') return false
  return undefined
}

/**
 * Precedence EXPLICITE de l'opt-in : la variable d'environnement l'emporte dans les DEUX sens
 * quand elle est renseignee, sinon le reglage persistant de l'app decide, sinon OFF.
 */
export function resolveShadowRoutingEnabled(
  env: Readonly<Record<string, string | undefined>>,
  settingEnabled?: boolean
): boolean {
  return shadowRoutingEnvOverride(env) ?? settingEnabled === true
}

/**
 * Le pilote shadow est un opt-in explicite : l'utilisateur l'active depuis la vue Settings
 * (`settingEnabled`, persiste par `model-routing-shadow-setting`) ou l'environnement le force.
 * Tant que l'opt-in resolu est OFF, aucun store ni observateur n'est construit et aucun fichier ne
 * peut etre materialise.
 */
export function createShadowRoutingRuntime(
  path: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  settingEnabled?: boolean
): ShadowRoutingRuntime {
  if (!resolveShadowRoutingEnabled(env, settingEnabled)) return { enabled: false }
  const store = new ShadowRoutingStore(path)
  return {
    enabled: true,
    store,
    observer: new ShadowRoutingTraceObserver(store)
  }
}
