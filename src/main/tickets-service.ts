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
  TicketGetRequest,
  TicketUpdateRequest,
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
/**
 * Borne du filtre de recherche par titre. Généreuse par rapport à `System.Title` (255) — on cherche
 * une sous-chaîne, jamais un titre entier — mais bornée : la valeur est interpolée dans une requête
 * WIQL envoyée à l'API distante.
 */
const MAX_TITLE_SEARCH_LENGTH = 400
const MAX_DESCRIPTION_LENGTH = 100_000
const MAX_ASSIGNEE_LENGTH = 320
const MAX_UPDATE_COMMENT_LENGTH = 20_000
const MAX_STATE_LENGTH = 100
/**
 * Le type de fiche est INTERPOLÉ DANS LE CHEMIN de l'URL de création. `encodeURIComponent` protège
 * déjà côté adaptateur ; on refuse néanmoins en amont tout ce qui n'a pas la forme d'un type réel
 * (« Bug », « User Story », « Product Backlog Item »), pour ne jamais envoyer un chemin exotique.
 */
const WORK_ITEM_TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9 _-]{0,63}$/

/**
 * Bornes de l'ENRICHISSEMENT remonté du fournisseur (discussion + titre des relations).
 *
 * La discussion d'une fiche est souvent l'information décisive — mais elle est aussi le champ le
 * moins borné du fournisseur (des dizaines de messages, pièces jointes inlinées). Elle traverse
 * l'IPC puis alimente un prompt au budget fixe : on la borne ICI, à la frontière, plutôt que de
 * laisser chaque consommateur se défendre. On garde les messages les plus RÉCENTS.
 */
const MAX_COMMENTS = 20
const MAX_COMMENT_TEXT = 2_000
const MAX_RELATION_TITLE = 255

function normalizeComments(item: TicketItem): TicketItem['comments'] {
  if (!Array.isArray(item.comments) || item.comments.length === 0) return undefined
  return item.comments
    .filter((comment) => comment && typeof comment.text === 'string' && comment.text.trim())
    .slice(-MAX_COMMENTS)
    .map((comment) => ({
      ...(comment.id ? { id: String(comment.id).slice(0, 100) } : {}),
      ...(comment.author ? { author: String(comment.author).slice(0, 320) } : {}),
      ...(comment.createdAt ? { createdAt: String(comment.createdAt).slice(0, 40) } : {}),
      text: comment.text.trim().slice(0, MAX_COMMENT_TEXT)
    }))
}

/**
 * Normalise une fiche remontée par un adaptateur avant de la rendre au renderer : discussion bornée
 * et titre de relation borné. Une relation sans titre reste une relation valide (id nu) — on
 * n'invente jamais de titre.
 */
export function normalizeTicketItem(item: TicketItem): TicketItem {
  const comments = normalizeComments(item)
  const relations = item.relations?.map((relation) =>
    relation.title
      ? { ...relation, title: String(relation.title).trim().slice(0, MAX_RELATION_TITLE) }
      : relation
  )
  return {
    ...item,
    ...(relations ? { relations } : {}),
    ...(comments ? { comments } : {})
  }
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
    // Le filtre part dans une requête WIQL construite par l'adaptateur (qui l'échappe). Ici on borne
    // sa LONGUEUR : c'est le service qui protège l'API distante, comme pour `pageSize` et `cursor`.
    const titleContains =
      typeof value.titleContains === 'string' ? value.titleContains.trim() : undefined
    if (titleContains !== undefined && titleContains.length > MAX_TITLE_SEARCH_LENGTH) {
      throw new Error(`Recherche Tickets trop longue (max ${MAX_TITLE_SEARCH_LENGTH} caractères)`)
    }
    if (!this.dependencies.registry.supports(source)) {
      throw new Error(`Fournisseur Tickets non supporté : ${source.provider}`)
    }

    const credential = await this.resolveCredential(source)
    const page = await this.dependencies.registry.list(
      {
        source,
        ...(value.cursor ? { cursor: value.cursor } : {}),
        ...(value.pageSize ? { pageSize: value.pageSize } : {}),
        // Vide = AUCUN filtre : on ne transmet rien, plutôt qu'un filtre vide qui ramènerait tout.
        ...(titleContains ? { titleContains } : {})
      },
      { ...credential, ...(signal ? { signal } : {}) }
    )
    return { ...page, items: page.items.map(normalizeTicketItem) }
  }

  /**
   * LECTURE d'une fiche par son identifiant. Même garde d'autorisation que `list` : le profil doit
   * être STRICTEMENT celui du store.
   *
   * L'identifiant est validé ICI, avant tout appel réseau : il finit dans le chemin d'une URL, et un
   * refus local vaut mieux qu'une requête forgée envoyée au fournisseur.
   */
  async get(value: TicketGetRequest, signal?: AbortSignal): Promise<TicketItem> {
    const source = this.authorizedSource(value?.source)
    const id = typeof value?.id === 'string' ? value.id.trim() : ''
    if (!/^[1-9]\d*$/.test(id)) {
      throw new Error(`Identifiant de fiche invalide : « ${id} » (entier positif attendu)`)
    }
    if (!this.dependencies.registry.supports(source)) {
      throw new Error(`Fournisseur Tickets non supporté : ${source.provider}`)
    }
    const credential = await this.resolveCredential(source)
    return normalizeTicketItem(
      await this.dependencies.registry.get(
        { source, id },
        { ...credential, ...(signal ? { signal } : {}) }
      )
    )
  }

  /** Écrit uniquement sur une source strictement autorisée et avec des champs bornés. */
  async update(value: TicketUpdateRequest, signal?: AbortSignal): Promise<TicketItem> {
    const source = this.authorizedSource(value?.source)
    const id = typeof value?.id === 'string' ? value.id.trim() : ''
    if (!/^[1-9]\d*$/.test(id)) {
      throw new Error(`Identifiant de fiche invalide : « ${id} » (entier positif attendu)`)
    }
    const comment = typeof value?.comment === 'string' ? value.comment.trim() : ''
    const state = typeof value?.state === 'string' ? value.state.trim() : ''
    const assignee = typeof value?.assignee === 'string' ? value.assignee.trim() : ''
    if (!comment && !state && !assignee) throw new Error('Au moins une modification est requise')
    if (comment.length > MAX_UPDATE_COMMENT_LENGTH) {
      throw new Error(`Commentaire trop long (max ${MAX_UPDATE_COMMENT_LENGTH} caractères)`)
    }
    if (state.length > MAX_STATE_LENGTH) throw new Error('État de fiche invalide')
    if (assignee.length > MAX_ASSIGNEE_LENGTH) throw new Error('Assigné de fiche invalide')
    if (!this.dependencies.registry.supports(source)) {
      throw new Error(`Fournisseur Tickets non supporté : ${source.provider}`)
    }
    const credential = await this.resolveCredential(source)
    return normalizeTicketItem(
      await this.dependencies.registry.update(
        {
          source,
          id,
          ...(comment ? { comment } : {}),
          ...(state ? { state } : {}),
          ...(assignee ? { assignee } : {})
        },
        { ...credential, ...(signal ? { signal } : {}) }
      )
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
