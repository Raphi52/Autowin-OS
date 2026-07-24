import type {
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

export interface TicketProviderAdapter {
  readonly provider: TicketProvider
  list(request: TicketListRequest, context: TicketProviderContext): Promise<TicketPage>
}

export interface TicketProviderRegistry {
  list(request: TicketListRequest, context: TicketProviderContext): Promise<TicketPage>
  supports(source: TicketSourceProfile): boolean
}

interface FetchTicketJsonOptions {
  fetchFn?: typeof fetch
  headers?: Readonly<Record<string, string>>
  method?: 'GET' | 'POST'
  body?: Readonly<Record<string, unknown>>
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
    ...(method === 'POST' ? { 'content-type': 'application/json' } : {})
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
  return {
    supports: (source) => byProvider.has(source.provider),
    list: (request, context) => {
      const adapter = byProvider.get(request.source.provider)
      if (!adapter) {
        throw new TicketProviderError(
          'UNSUPPORTED_PROVIDER',
          `Fournisseur non supporté : ${request.source.provider}.`
        )
      }
      return adapter.list(request, context)
    }
  }
}
