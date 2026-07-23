import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AuthStatus } from './provider-status'

export type ProviderMode = 'active' | 'standby'

export interface ProviderState {
  mode: ProviderMode
  lastProbe?: {
    status: AuthStatus
    checkedAt: number
  }
}

type PersistedProviderStates = Record<string, ProviderState>

const AUTH_STATUSES = new Set<AuthStatus>([
  'authenticated',
  'expired',
  'installed-untested',
  'absent',
  'unknown'
])

function defaultState(provider: string): ProviderState {
  return { mode: provider === 'kimi' ? 'standby' : 'active' }
}

function validProvider(provider: string): string {
  const id = provider.trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new Error('Provider invalide.')
  return id
}

function sanitizeState(value: unknown): ProviderState | undefined {
  if (!value || typeof value !== 'object') return undefined
  const input = value as { mode?: unknown; lastProbe?: unknown }
  if (input.mode !== 'active' && input.mode !== 'standby') return undefined
  const state: ProviderState = { mode: input.mode }
  if (input.lastProbe && typeof input.lastProbe === 'object') {
    const probe = input.lastProbe as { status?: unknown; checkedAt?: unknown }
    if (
      typeof probe.status === 'string' &&
      AUTH_STATUSES.has(probe.status as AuthStatus) &&
      typeof probe.checkedAt === 'number' &&
      Number.isFinite(probe.checkedAt) &&
      probe.checkedAt > 0
    ) {
      state.lastProbe = { status: probe.status as AuthStatus, checkedAt: probe.checkedAt }
    }
  }
  return state
}

export class ProviderStateStore {
  private readonly path: string

  constructor(path?: string) {
    if (!path) throw new Error('Chemin du store provider requis.')
    this.path = path
  }

  private read(): PersistedProviderStates {
    if (!existsSync(this.path)) return {}
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
      const states: PersistedProviderStates = {}
      for (const [provider, value] of Object.entries(parsed)) {
        const state = sanitizeState(value)
        if (state && /^[a-z0-9][a-z0-9-]{0,63}$/.test(provider)) states[provider] = state
      }
      return states
    } catch {
      return {}
    }
  }

  private write(states: PersistedProviderStates): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`
    writeFileSync(temporary, JSON.stringify(states, null, 2), 'utf8')
    renameSync(temporary, this.path)
  }

  get(provider: string): ProviderState {
    const id = validProvider(provider)
    return this.read()[id] ?? defaultState(id)
  }

  setMode(provider: string, mode: ProviderMode): ProviderState {
    const id = validProvider(provider)
    const states = this.read()
    const next = { ...(states[id] ?? defaultState(id)), mode }
    states[id] = next
    this.write(states)
    return next
  }

  recordProbe(provider: string, status: AuthStatus, checkedAt = Date.now()): ProviderState {
    const id = validProvider(provider)
    if (!AUTH_STATUSES.has(status) || !Number.isFinite(checkedAt) || checkedAt <= 0) {
      throw new Error('Résultat de probe invalide.')
    }
    const states = this.read()
    const next = {
      ...(states[id] ?? defaultState(id)),
      lastProbe: { status, checkedAt }
    }
    states[id] = next
    this.write(states)
    return next
  }
}
