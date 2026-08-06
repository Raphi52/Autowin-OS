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

export interface TicketProviderAdapter {
  readonly provider: TicketProvider
  list(request: TicketListRequest, context: TicketProviderContext): Promise<TicketPage>
  /**
   * Création côté fournisseur — action SORTANTE, donc OPTIONNELLE : un adaptateur en lecture
   * seule (GitHub, GitLab) n'implémente pas cette méthode et reste conforme au contrat.
   */
  create?(request: TicketCreateRequest, context: TicketProviderContext): Promise<TicketItem>
}

export interface TicketProviderRegistry {
  list(request: TicketListRequest, context: TicketProviderContext): Promise<TicketPage>
  create(request: TicketCreateRequest, context: TicketProviderContext): Promise<TicketItem>
  supports(source: TicketSourceProfile): boolean
}

interface FetchTicketJsonOptions {
  fetchFn?: typeof fetch
  headers?: Readonly<Record<string, string>>
  method?: 'GET' | 'POST'
  /** Objet JSON, ou TABLEAU pour un corps JSON-Patch (`[{ op, path, value }, …]`). */
  body?: Readonly<Record<string, unknown>> | readonly unknown[]
  /** Surcharge du content-type du POST (défaut `application/json`), ex. `application/json-patch+json`. */
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
    ...(method === 'POST' ? { 'content-type': options.contentType ?? 'application/json' } : {})
  }
  let response: Response
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? 10_000)
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal
  try {
    response = await fetchFn(url, {
      method,
      headers,
      ...(method === 'POST' ? { body: JSON.stringify(options.body ?? {}) } : {}),
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
    create: (request, context) => {
      const adapter = adapterFor(request.source)
      if (!adapter.create) {
        throw new TicketProviderError(
          'UNSUPPORTED_PROVIDER',
          `Création non supportée par le fournisseur ${request.source.provider}.`
        )
      }
      return adapter.create(request, context)
    }
  }
}
