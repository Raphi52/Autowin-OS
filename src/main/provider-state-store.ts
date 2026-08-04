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

  /**
   * Mutation d'UN provider, appliquée sur l'état FRAIS du disque (read-modify-write borné au champ
   * visé). Sans cette relecture juste avant l'écriture, deux mutations entrelacées (ex. un
   * `setMode('codex','standby')` fait par l'utilisateur et un `recordProbe('claude',…)` déclenché par
   * un probe de fond, ou un second process Autowin) réécrivaient l'objet ENTIER depuis une lecture
   * périmée → la mutation de l'autre provider était silencieusement PERDUE (un « provider marqué
   * facultatif » pouvait redevenir actif tout seul). On ne réécrit donc jamais un état qu'on n'a pas
   * relu, et on ne touche que l'entrée mutée : les autres providers gardent la version du disque.
   */
  private mutate(id: string, patch: (current: ProviderState) => ProviderState): ProviderState {
    const states = this.read() // relecture FRAÎCHE : ne jamais écrire depuis un snapshot périmé
    const next = patch(states[id] ?? defaultState(id))
    states[id] = next
    this.write(states)
    return next
  }

  setMode(provider: string, mode: ProviderMode): ProviderState {
    const id = validProvider(provider)
    return this.mutate(id, (current) => ({ ...current, mode }))
  }

  recordProbe(provider: string, status: AuthStatus, checkedAt = Date.now()): ProviderState {
    const id = validProvider(provider)
    if (!AUTH_STATUSES.has(status) || !Number.isFinite(checkedAt) || checkedAt <= 0) {
      throw new Error('Résultat de probe invalide.')
    }
    return this.mutate(id, (current) => ({ ...current, lastProbe: { status, checkedAt } }))
  }
}
