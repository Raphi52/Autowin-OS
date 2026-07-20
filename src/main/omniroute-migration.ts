import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Role, RoleBinding } from './roles'
import type { AgentTopology } from './topology'

const SCHEMA = 'autowin.omniroute-migration/v1'
const MAX_STATE_BYTES = 512 * 1024
const ROUTE_MODEL = /^[a-z0-9][a-z0-9._:/-]{0,119}$/i

export interface DirectConfigurationSnapshot {
  roles: Record<Role, RoleBinding>
  topology: AgentTopology
}

export type OmniRouteMigrationState =
  | { schema: typeof SCHEMA; mode: 'direct'; updatedAt: string }
  | {
      schema: typeof SCHEMA
      mode: 'omniroute'
      routeModel: string
      directSnapshot: DirectConfigurationSnapshot
      updatedAt: string
    }

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function directState(now: () => string): OmniRouteMigrationState {
  return { schema: SCHEMA, mode: 'direct', updatedAt: now() }
}

function isState(value: unknown): value is OmniRouteMigrationState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const state = value as Record<string, unknown>
  if (state.schema !== SCHEMA || (state.mode !== 'direct' && state.mode !== 'omniroute'))
    return false
  if (typeof state.updatedAt !== 'string' || !Number.isFinite(Date.parse(state.updatedAt)))
    return false
  if (state.mode === 'direct') return true
  return (
    typeof state.routeModel === 'string' &&
    ROUTE_MODEL.test(state.routeModel) &&
    Boolean(state.directSnapshot) &&
    typeof state.directSnapshot === 'object'
  )
}

export class OmniRouteMigrationStore {
  constructor(
    private readonly path: string,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  load(): OmniRouteMigrationState {
    if (!existsSync(this.path)) return directState(this.now)
    try {
      if (statSync(this.path).size > MAX_STATE_BYTES) return directState(this.now)
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as unknown
      return isState(parsed) ? clone(parsed) : directState(this.now)
    } catch {
      return directState(this.now)
    }
  }

  activate(
    routeModel: string,
    directSnapshot: DirectConfigurationSnapshot
  ): OmniRouteMigrationState {
    if (!ROUTE_MODEL.test(routeModel)) throw new Error('Route OmniRoute invalide')
    const current = this.load()
    if (current.mode === 'omniroute') {
      if (current.routeModel === routeModel) return current
      const next = { ...current, routeModel, updatedAt: this.now() }
      this.write(next)
      return clone(next)
    }
    const next: OmniRouteMigrationState = {
      schema: SCHEMA,
      mode: 'omniroute',
      routeModel,
      directSnapshot: clone(directSnapshot),
      updatedAt: this.now()
    }
    this.write(next)
    return clone(next)
  }

  prepareRollback(): DirectConfigurationSnapshot | undefined {
    const current = this.load()
    return current.mode === 'omniroute' ? clone(current.directSnapshot) : undefined
  }

  commitRollback(): OmniRouteMigrationState {
    const next = directState(this.now)
    this.write(next)
    return next
  }

  rollback(): { state: OmniRouteMigrationState; restore?: DirectConfigurationSnapshot } {
    const restore = this.prepareRollback()
    return { state: this.commitRollback(), restore }
  }

  private write(state: OmniRouteMigrationState): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const temp = `${this.path}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify(state, null, 2), 'utf8')
    renameSync(temp, this.path)
  }
}
