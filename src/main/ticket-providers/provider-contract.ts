import type {
  TicketItem,
  TicketListRequest,
  TicketPage,
  TicketProvider,
  TicketSourceProfile
} from '../../shared/tickets'

export type TicketProviderErrorCode =
  | 'AUTH_REQUIRED'
  | 'ACCESS_DENIED'
  | 'RATE_LIMITED'
  | 'REMOTE_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'ABORTED'
  | 'INVALID_RESPONSE'
  | 'RESPONSE_TOO_LARGE'
  | 'UNSAFE_URL'
  | 'UNSUPPORTED_PROVIDER'

export class TicketProviderError extends Error {
  constructor(
    public readonly code: TicketProviderErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'TicketProviderError'
  }
}

export interface TicketProviderContext {
  token: string
  authScheme?: 'bearer' | 'pat'
  fetchFn?: typeof fetch
  signal?: AbortSignal
}

/**
 * Demande de CRÉATION d'un ticket. Symétrique de `TicketListRequest` (même `source`, même
 * `requestId` optionnel). Seul `title` est obligatoire ; le type de work item et l'assigné
 * restent optionnels, l'adaptateur applique ses propres défauts.
 */
export interface TicketCreateRequest {
  source: TicketSourceProfile
  title: string
  requestId?: string
  description?: string
  workItemType?: string
  assignee?: string
}

/**
 * Lecture d'UNE fiche par son identifiant.
 *
 * Motif (constaté le 2026-08-06) : sans elle, demander la fiche 1227 revenait à chercher la chaîne
 * « 1227 » dans les TITRES — ce qui ne trouve rien, un titre ne contenant pas son propre numéro.
 * L'agent en avait conclu que la fiche n'existait pas. Un identifiant s'adresse directement, il ne se
 * cherche pas textuellement.
 */
export interface TicketGetRequest {
  source: TicketSourceProfile
  id: string
  requestId?: string
}

/** Retour factuel de l'agent vers une fiche existante. Au moins un champ doit être fourni. */
export interface TicketUpdateRequest {
  source: TicketSourceProfile
  id: string
  requestId?: string
  comment?: string
  state?: string
  assignee?: string
}

export interface TicketProviderAdapter {
  readonly provider: TicketProvider
  list(request: TicketListRequest, context: TicketProviderContext): Promise<TicketPage>
  /**
   * Création côté fournisseur — action SORTANTE, donc OPTIONNELLE : un adaptateur en lecture
   * seule (GitHub, GitLab) n'implémente pas cette méthode et reste conforme au contrat.
   */
  create?(request: TicketCreateRequest, context: TicketProviderContext): Promise<TicketItem>
  /** Lecture par id — OPTIONNELLE : tous les fournisseurs n'exposent pas d'accès direct. */
  get?(request: TicketGetRequest, context: TicketProviderContext): Promise<TicketItem>
  /** Mise à jour d'une fiche existante — OPTIONNELLE pour les adaptateurs en lecture seule. */
  update?(request: TicketUpdateRequest, context: TicketProviderContext): Promise<TicketItem>
}

export interface TicketProviderRegistry {
  list(request: TicketListRequest, context: TicketProviderContext): Promise<TicketPage>
  create(request: TicketCreateRequest, context: TicketProviderContext): Promise<TicketItem>
  get(request: TicketGetRequest, context: TicketProviderContext): Promise<TicketItem>
  update(request: TicketUpdateRequest, context: TicketProviderContext): Promise<TicketItem>
  supports(source: TicketSourceProfile): boolean
}

interface FetchTicketJsonOptions {
  fetchFn?: typeof fetch
  headers?: Readonly<Record<string, string>>
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT'
  /** Objet JSON, ou TABLEAU pour un corps JSON-Patch (`[{ op, path, value }, …]`). */
  body?: Readonly<Record<string, unknown>> | readonly unknown[]
  /** Surcharge du content-type d'une écriture, ex. `application/json-patch+json`. */
  contentType?: string
  timeoutMs?: number
  signal?: AbortSignal
  maxBytes?: number
}

function assertSafeUrl(input: string): void {
  try {
    const url = new URL(input)
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      url.hash !== ''
    ) {
      throw new Error('unsafe')
    }
  } catch {
    throw new TicketProviderError('UNSAFE_URL', 'Adresse fournisseur non sûre.')
  }
}

function errorForStatus(status: number): TicketProviderError {
  if (status === 401) return new TicketProviderError('AUTH_REQUIRED', 'Authentification requise.')
  if (status === 403) return new TicketProviderError('ACCESS_DENIED', 'Accès refusé.')
  if (status === 429) return new TicketProviderError('RATE_LIMITED', 'Limite fournisseur atteinte.')
  return new TicketProviderError(
    'REMOTE_ERROR',
    `Le fournisseur a répondu avec le statut ${status}.`
  )
}

export async function fetchTicketJson<T>(
  url: string,
  options: FetchTicketJsonOptions = {}
): Promise<T> {
  assertSafeUrl(url)
  const fetchFn = options.fetchFn ?? fetch
  const maxBytes = options.maxBytes ?? 2_000_000
  const method = options.method ?? 'GET'
  const headers = {
    ...options.headers,
    ...(method !== 'GET' ? { 'content-type': options.contentType ?? 'application/json' } : {})
  }
  let response: Response
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? 10_000)
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal
  try {
    response = await fetchFn(url, {
      method,
      headers,
      ...(method !== 'GET' ? { body: JSON.stringify(options.body ?? {}) } : {}),
      signal
    })
  } catch {
    if (options.signal?.aborted) {
      throw new TicketProviderError('ABORTED', 'Chargement annulé.')
    }
    if (timeoutSignal.aborted) {
      throw new TicketProviderError('TIMEOUT', 'Délai fournisseur dépassé.')
    }
    throw new TicketProviderError('NETWORK_ERROR', 'Fournisseur indisponible.')
  }
  if (!response.ok) throw errorForStatus(response.status)

  const announcedLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(announcedLength) && announcedLength > maxBytes) {
    throw new TicketProviderError('RESPONSE_TOO_LARGE', 'Réponse fournisseur trop volumineuse.')
  }
  const body = await response.text()
  if (Buffer.byteLength(body, 'utf8') > maxBytes) {
    throw new TicketProviderError('RESPONSE_TOO_LARGE', 'Réponse fournisseur trop volumineuse.')
  }
  try {
    return JSON.parse(body) as T
  } catch {
    throw new TicketProviderError('INVALID_RESPONSE', 'Réponse fournisseur invalide.')
  }
}

export function createTicketProviderRegistry(
  adapters: readonly TicketProviderAdapter[]
): TicketProviderRegistry {
  const byProvider = new Map(adapters.map((adapter) => [adapter.provider, adapter]))
  const adapterFor = (source: TicketSourceProfile): TicketProviderAdapter => {
    const adapter = byProvider.get(source.provider)
    if (!adapter) {
      throw new TicketProviderError(
        'UNSUPPORTED_PROVIDER',
        `Fournisseur non supporté : ${source.provider}.`
      )
    }
    return adapter
  }
  return {
    supports: (source) => byProvider.has(source.provider),
    list: (request, context) => adapterFor(request.source).list(request, context),
    // `async` DÉLIBÉRÉ sur ces deux méthodes : elles sont typées `Promise`, donc un fournisseur non
    // supporté doit REJETER, pas jeter de façon synchrone. Sans cela, un appelant en `.catch()` — sans
    // `try` autour de l'appel — plante au lieu de recevoir l'erreur.
    create: async (request, context) => {
      const adapter = adapterFor(request.source)
      if (!adapter.create) {
        throw new TicketProviderError(
          'UNSUPPORTED_PROVIDER',
          `Création non supportée par le fournisseur ${request.source.provider}.`
        )
      }
      return await adapter.create(request, context)
    },
    get: async (request, context) => {
      const adapter = adapterFor(request.source)
      if (!adapter.get) {
        throw new TicketProviderError(
          'UNSUPPORTED_PROVIDER',
          `Lecture par identifiant non supportée par le fournisseur ${request.source.provider}.`
        )
      }
      return await adapter.get(request, context)
    },
    update: async (request, context) => {
      const adapter = adapterFor(request.source)
      if (!adapter.update) {
        throw new TicketProviderError(
          'UNSUPPORTED_PROVIDER',
          `Mise à jour non supportée par le fournisseur ${request.source.provider}.`
        )
      }
      return await adapter.update(request, context)
    }
  }
}
