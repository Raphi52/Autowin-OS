import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const SCHEMA = 'autowin.omniroute-migration/v1'
const MAX_STATE_BYTES = 512 * 1024
const ROUTE_MODEL = /^[a-z0-9][a-z0-9._:/-]{0,119}$/i
const EFFORT = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'])

export type OmniRouteMigrationState = {
  schema: typeof SCHEMA
  mode: 'omniroute'
  routeModel: string
  /** Effort de raisonnement choisi pour la route ('none' = défaut modèle). Optionnel (legacy). */
  reasoningEffort?: string
  updatedAt: string
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function defaultState(now: () => string): OmniRouteMigrationState {
  return { schema: SCHEMA, mode: 'omniroute', routeModel: 'auto/coding', updatedAt: now() }
}

function isState(value: unknown): value is OmniRouteMigrationState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const state = value as Record<string, unknown>
  if (state.schema !== SCHEMA || state.mode !== 'omniroute') return false
  if (typeof state.updatedAt !== 'string' || !Number.isFinite(Date.parse(state.updatedAt)))
    return false
  if (
    state.reasoningEffort !== undefined &&
    !(typeof state.reasoningEffort === 'string' && EFFORT.has(state.reasoningEffort))
  )
    return false
  return typeof state.routeModel === 'string' && ROUTE_MODEL.test(state.routeModel)
}

export class OmniRouteMigrationStore {
  constructor(
    private readonly path: string,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  load(): OmniRouteMigrationState {
    if (!existsSync(this.path)) return defaultState(this.now)
    try {
      if (statSync(this.path).size > MAX_STATE_BYTES) return defaultState(this.now)
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as unknown
      return isState(parsed) ? clone(parsed) : defaultState(this.now)
    } catch {
      return defaultState(this.now)
    }
  }

  activate(routeModel: string, reasoningEffort?: string): OmniRouteMigrationState {
    if (!ROUTE_MODEL.test(routeModel)) throw new Error('Route OmniRoute invalide')
    if (reasoningEffort !== undefined && !EFFORT.has(reasoningEffort))
      throw new Error('Effort de raisonnement invalide')
    const current = this.load()
    // Effort conservé si non précisé cette fois-ci.
    const effort = reasoningEffort ?? current.reasoningEffort
    if (current.routeModel === routeModel && current.reasoningEffort === effort) return current
    const next: OmniRouteMigrationState = {
      schema: SCHEMA,
      mode: 'omniroute',
      routeModel,
      ...(effort ? { reasoningEffort: effort } : {}),
      updatedAt: this.now()
    }
    this.write(next)
    return clone(next)
  }

  private write(state: OmniRouteMigrationState): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const temp = `${this.path}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify(state, null, 2), 'utf8')
    renameSync(temp, this.path)
  }
}
