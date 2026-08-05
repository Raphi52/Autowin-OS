import { createHash } from 'node:crypto'
import {
  parseTicketSourceProfile,
  type TicketItem,
  type TicketListRequest,
  type TicketPage,
  type TicketSourceSummary,
  type TicketSourceProfile
} from '../shared/tickets'
import type { TicketCredentialStore } from './ticket-credential-store'
import type {
  TicketCreateRequest,
  TicketProviderRegistry
} from './ticket-providers/provider-contract'
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

/**
 * Bornes de la création. Motif : une fiche part dans le backlog d'une ÉQUIPE, sous l'identité de
 * l'utilisateur. Un titre vide y laisse un déchet que quelqu'un devra trier ; un champ démesuré est
 * un déni de service sur l'API du fournisseur. Valeurs alignées sur Azure DevOps (`System.Title` est
 * plafonné à 255 caractères côté serveur — autant refuser AVANT l'appel réseau).
 */
const MAX_TITLE_LENGTH = 255
const MAX_DESCRIPTION_LENGTH = 100_000
const MAX_ASSIGNEE_LENGTH = 320
/**
 * Le type de fiche est INTERPOLÉ DANS LE CHEMIN de l'URL de création. `encodeURIComponent` protège
 * déjà côté adaptateur ; on refuse néanmoins en amont tout ce qui n'a pas la forme d'un type réel
 * (« Bug », « User Story », « Product Backlog Item »), pour ne jamais envoyer un chemin exotique.
 */
const WORK_ITEM_TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9 _-]{0,63}$/

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

    const credential = await this.resolveCredential(source)
    return this.dependencies.registry.list(
      {
        source,
        ...(value.cursor ? { cursor: value.cursor } : {}),
        ...(value.pageSize ? { pageSize: value.pageSize } : {})
      },
      { ...credential, ...(signal ? { signal } : {}) }
    )
  }

  /**
   * CRÉATION d'une fiche chez le fournisseur — action SORTANTE. Même garde d'autorisation que `list`
   * (le profil doit être STRICTEMENT celui du store, pas seulement porter un id connu), plus des
   * bornes sur les champs : ici on écrit dans le backlog d'une équipe, sous l'identité de
   * l'utilisateur, et une fiche mal formée est un déchet que quelqu'un devra trier.
   *
   * Les champs vides ne sont PAS transmis : envoyer `description: ''` écraserait le champ côté
   * fournisseur au lieu de le laisser à son défaut.
   */
  async create(value: TicketCreateRequest, signal?: AbortSignal): Promise<TicketItem> {
    const source = this.authorizedSource(value?.source)

    const title = typeof value?.title === 'string' ? value.title.trim() : ''
    if (!title) throw new Error('Titre de fiche requis')
    if (title.length > MAX_TITLE_LENGTH) {
      throw new Error(`Titre de fiche trop long (max ${MAX_TITLE_LENGTH} caractères)`)
    }

    const description = typeof value?.description === 'string' ? value.description.trim() : ''
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      throw new Error(`Description de fiche trop longue (max ${MAX_DESCRIPTION_LENGTH} caractères)`)
    }

    const assignee = typeof value?.assignee === 'string' ? value.assignee.trim() : ''
    if (assignee.length > MAX_ASSIGNEE_LENGTH) throw new Error('Assigné de fiche invalide')

    // `undefined` = « laisse le fournisseur choisir son défaut ». Une chaîne fournie, en revanche,
    // doit être plausible : elle part dans le CHEMIN de l'URL de création.
    const workItemType = value?.workItemType
    if (workItemType !== undefined && !WORK_ITEM_TYPE_PATTERN.test(workItemType.trim())) {
      throw new Error('Type de fiche invalide')
    }

    if (!this.dependencies.registry.supports(source)) {
      throw new Error(`Fournisseur Tickets non supporté : ${source.provider}`)
    }

    const credential = await this.resolveCredential(source)
    return this.dependencies.registry.create(
      {
        source,
        title,
        ...(description ? { description } : {}),
        ...(assignee ? { assignee } : {}),
        ...(workItemType ? { workItemType: workItemType.trim() } : {})
      },
      { ...credential, ...(signal ? { signal } : {}) }
    )
  }

  /**
   * Un profil venu du renderer n'est JAMAIS pris au mot : il doit être IDENTIQUE à celui du store.
   * Porter un id connu ne suffit pas — sinon un renderer compromis viserait une autre organisation.
   */
  private authorizedSource(value: unknown): TicketSourceProfile {
    const source = parseTicketSourceProfile(value)
    if (!source) throw new Error('Profil Tickets invalide')
    const authorized = this.dependencies.sourceStore
      .list()
      .find((profile) => profile.id === source.id)
    if (!authorized || !sameProfile(authorized, source)) {
      throw new Error('Profil Tickets non autorisé')
    }
    return source
  }

  /** Credential du store, sinon repli (Azure CLI), sinon vide — jamais rendu à l'appelant. */
  private async resolveCredential(source: TicketSourceProfile): Promise<TicketRuntimeCredential> {
    const stored = this.dependencies.credentialStore.get(ticketCredentialKey(source))
    const fallback =
      stored === null && this.dependencies.tokenFallback
        ? await this.dependencies.tokenFallback(source)
        : null
    return stored
      ? { token: stored, authScheme: source.provider === 'azure' ? 'pat' : 'bearer' }
      : (fallback ?? { token: '', authScheme: 'bearer' })
  }
}
