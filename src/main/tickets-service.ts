import {
  parseTicketSourceProfile,
  type TicketListRequest,
  type TicketPage,
  type TicketSourceProfile
} from '../shared/tickets'
import type { TicketCredentialStore } from './ticket-credential-store'
import type { TicketProviderRegistry } from './ticket-providers/provider-contract'
import type { TicketSourceStore } from './ticket-source-store'

export interface TicketSourceSummary {
  profile: TicketSourceProfile
  credentialConfigured: boolean
}

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

export class TicketService {
  constructor(private readonly dependencies: TicketServiceDependencies) {}

  sources(): TicketSourceSummary[] {
    return this.dependencies.sourceStore.list().map((profile) => ({
      profile,
      credentialConfigured: this.dependencies.credentialStore.has(profile.id)
    }))
  }

  saveSource(value: unknown): TicketSourceSummary[] {
    this.dependencies.sourceStore.save(value)
    return this.sources()
  }

  removeSource(id: string): TicketSourceSummary[] {
    const next = this.dependencies.sourceStore.remove(id)
    this.dependencies.credentialStore.delete(id)
    return next.map((profile) => ({
      profile,
      credentialConfigured: this.dependencies.credentialStore.has(profile.id)
    }))
  }

  async list(value: TicketListRequest): Promise<TicketPage> {
    const source = parseTicketSourceProfile(value?.source)
    if (!source) throw new Error('Profil Tickets invalide')
    const authorized = this.dependencies.sourceStore
      .list()
      .find((profile) => profile.id === source.id)
    if (!authorized || !sameProfile(authorized, source)) {
      throw new Error('Profil Tickets non autorisé')
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
      throw new Error(`Fournisseur Tickets non supporté : ${source.provider}`)
    }

    const storedCredential = this.dependencies.credentialStore.get(source.id)
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
      credential
    )
  }
}
