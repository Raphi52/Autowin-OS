import { createHash } from 'node:crypto'
import {
  parseTicketSourceProfile,
  type TicketListRequest,
  type TicketPage,
  type TicketSourceSummary,
  type TicketSourceProfile
} from '../shared/tickets'
import type { TicketCredentialStore } from './ticket-credential-store'
import type { TicketProviderRegistry } from './ticket-providers/provider-contract'
import type { TicketSourceStore } from './ticket-source-store'

export interface TicketRuntimeCredential {
  token: string
  authScheme: 'bearer' | 'pat'
}

export interface TicketServiceDependencies {
  sourceStore: TicketSourceStore
  credentialStore: TicketCredentialStore
  registry: TicketProviderRegistry
  tokenFallback?: (source: TicketSourceProfile) => Promise<TicketRuntimeCredential | null>
}

function sameProfile(left: TicketSourceProfile, right: TicketSourceProfile): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function credentialOrigin(source: TicketSourceProfile): string {
  if (source.provider === 'azure') return 'https://dev.azure.com'
  if (source.provider === 'github') {
    return source.apiBaseUrl ? new URL(source.apiBaseUrl).origin : 'https://api.github.com'
  }
  return source.baseUrl ? new URL(source.baseUrl).origin : 'https://gitlab.com'
}

export function ticketCredentialKey(source: TicketSourceProfile): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([source.id, source.provider, credentialOrigin(source)]))
    .digest('hex')
  return `v2:${digest}`
}

export class TicketService {
  constructor(private readonly dependencies: TicketServiceDependencies) {}

  sources(): TicketSourceSummary[] {
    return this.dependencies.sourceStore.list().map((profile) => ({
      profile,
      credentialConfigured: this.dependencies.credentialStore.has(ticketCredentialKey(profile))
    }))
  }

  saveSource(value: unknown): TicketSourceSummary[] {
    const profile = parseTicketSourceProfile(value)
    if (!profile) throw new Error('Profil Tickets invalide')
    const previous = this.dependencies.sourceStore
      .list()
      .find((candidate) => candidate.id === profile.id)
    this.dependencies.sourceStore.save(profile)
    if (previous && ticketCredentialKey(previous) !== ticketCredentialKey(profile)) {
      this.dependencies.credentialStore.delete(ticketCredentialKey(previous))
    }
    return this.sources()
  }

  removeSource(id: string): TicketSourceSummary[] {
    const removed = this.dependencies.sourceStore.list().find((profile) => profile.id === id)
    const next = this.dependencies.sourceStore.remove(id)
    if (removed) this.dependencies.credentialStore.delete(ticketCredentialKey(removed))
    return next.map((profile) => ({
      profile,
      credentialConfigured: this.dependencies.credentialStore.has(ticketCredentialKey(profile))
    }))
  }

  async list(value: TicketListRequest, signal?: AbortSignal): Promise<TicketPage> {
    const source = parseTicketSourceProfile(value?.source)
    if (!source) throw new Error('Profil Tickets invalide')
    const authorized = this.dependencies.sourceStore
      .list()
      .find((profile) => profile.id === source.id)
    if (!authorized || !sameProfile(authorized, source)) {
      throw new Error('Profil Tickets non autoris?')
    }
    if (
      value.pageSize !== undefined &&
      (!Number.isSafeInteger(value.pageSize) || value.pageSize < 1 || value.pageSize > 100)
    ) {
      throw new Error('Taille de page Tickets invalide')
    }
    if (
      value.cursor !== undefined &&
      (typeof value.cursor !== 'string' || value.cursor.length === 0 || value.cursor.length > 2000)
    ) {
      throw new Error('Curseur Tickets invalide')
    }
    if (!this.dependencies.registry.supports(source)) {
      throw new Error(`Fournisseur Tickets non support? : ${source.provider}`)
    }

    const storedCredential = this.dependencies.credentialStore.get(ticketCredentialKey(source))
    const fallbackCredential =
      storedCredential === null && this.dependencies.tokenFallback
        ? await this.dependencies.tokenFallback(source)
        : null
    const credential: TicketRuntimeCredential = storedCredential
      ? { token: storedCredential, authScheme: source.provider === 'azure' ? 'pat' : 'bearer' }
      : (fallbackCredential ?? { token: '', authScheme: 'bearer' })
    return this.dependencies.registry.list(
      {
        source,
        ...(value.cursor ? { cursor: value.cursor } : {}),
        ...(value.pageSize ? { pageSize: value.pageSize } : {})
      },
      { ...credential, ...(signal ? { signal } : {}) }
    )
  }
}
