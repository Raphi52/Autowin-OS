import {
  parseTicketSourceProfile,
  type TicketItem,
  type TicketListRequest,
  type TicketPage,
  type TicketSourceSummary,
  type TicketSourceProfile
} from '../shared/tickets'

export interface TicketsIpcRegistrar {
  // Electron's invoke handler is deliberately variadic across the registered channels.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handle(channel: string, handler: (event: any, ...args: any[]) => unknown): void
}

/**
 * Requête de création telle qu'elle ARRIVE du renderer : le `requestId` sert au cycle de vie IPC
 * (annulation), les autres champs sont validés par le service, seule autorité sur leurs bornes.
 */
/** Lecture d'une fiche par son id. Le service valide l'id, seule autorité sur sa forme. */
export interface TicketGetIpcRequest {
  source: TicketSourceProfile
  id: string
  requestId?: string
}

/** Mise à jour telle qu'elle arrive du renderer ; validation métier dans TicketService. */
export interface TicketUpdateIpcRequest {
  source: TicketSourceProfile
  id: string
  requestId?: string
  comment?: string
  state?: string
  assignee?: string
}

interface TicketsServicePort {
  sources(): TicketSourceSummary[]
  saveSource(value: unknown): TicketSourceSummary[]
  list(value: TicketListRequest, signal?: AbortSignal): Promise<TicketPage>
  get(value: TicketGetIpcRequest, signal?: AbortSignal): Promise<TicketItem>
  update(value: TicketUpdateIpcRequest, signal?: AbortSignal): Promise<TicketItem>
}

/**
 * L'ANNUAIRE des collaborateurs, isole derriere un port.
 *
 * Il n'appelle pas le meme service que les autres canaux : il interroge Azure DevOps directement,
 * avec les MEMES identifiants que `tickets:list`. Le detail de cette authentification reste dans
 * `index.ts`, qui la partage avec le reste du demarrage ; ce module ne recoit qu'une fonction.
 */
interface TicketsPeoplePort {
  /** Rend les collaborateurs, ou [] si la source n'est pas Azure / l'appel echoue. */
  list(source: TicketSourceProfile): Promise<unknown[]>
  /** Vrai si ce profil fait partie des sources enregistrees : un profil invente est refuse. */
  estAutorisee(source: TicketSourceProfile): boolean
}

interface RegisterTicketsIpcOptions {
  ipc: TicketsIpcRegistrar
  service: TicketsServicePort
  people: TicketsPeoplePort
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assertTrusted: (event: any, scope: string) => void
}

export function registerTicketsIpc({
  ipc,
  service,
  people,
  assertTrusted
}: RegisterTicketsIpcOptions): void {
  const active = new Map<unknown, Map<string, AbortController>>()
  const requestId = (value: unknown): string => {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) {
      throw new Error('Identifiant de requête Tickets invalide')
    }
    return value
  }

  ipc.handle('tickets:sources', (event) => {
    assertTrusted(event, 'Tickets')
    return service.sources()
  })
  ipc.handle('tickets:source:save', (event, profile: unknown) => {
    assertTrusted(event, 'Tickets')
    return service.saveSource(profile)
  })
  ipc.handle('tickets:list', async (event, request: TicketListRequest) => {
    assertTrusted(event, 'Tickets')
    const id = requestId(request?.requestId)
    let senderRequests = active.get(event.sender)
    if (!senderRequests) {
      senderRequests = new Map()
      active.set(event.sender, senderRequests)
    }
    senderRequests.get(id)?.abort()
    const controller = new AbortController()
    senderRequests.set(id, controller)
    try {
      return await service.list(request, controller.signal)
    } finally {
      if (senderRequests.get(id) === controller) senderRequests.delete(id)
      if (senderRequests.size === 0) active.delete(event.sender)
    }
  })
  /**
   * LECTURE par id. Franchit la même porte de confiance que les autres canaux et partage leur
   * registre d'annulation : un appel réseau lent doit pouvoir être coupé par `tickets:cancel`.
   */
  ipc.handle('tickets:get', async (event, request: TicketGetIpcRequest) => {
    assertTrusted(event, 'Tickets')
    const id = requestId(request?.requestId)
    let senderRequests = active.get(event.sender)
    if (!senderRequests) {
      senderRequests = new Map()
      active.set(event.sender, senderRequests)
    }
    senderRequests.get(id)?.abort()
    const controller = new AbortController()
    senderRequests.set(id, controller)
    try {
      return await service.get(request, controller.signal)
    } finally {
      if (senderRequests.get(id) === controller) senderRequests.delete(id)
      if (senderRequests.size === 0) active.delete(event.sender)
    }
  })
  ipc.handle('tickets:update', async (event, request: TicketUpdateIpcRequest) => {
    assertTrusted(event, 'Tickets')
    const id = requestId(request?.requestId)
    let senderRequests = active.get(event.sender)
    if (!senderRequests) {
      senderRequests = new Map()
      active.set(event.sender, senderRequests)
    }
    senderRequests.get(id)?.abort()
    const controller = new AbortController()
    senderRequests.set(id, controller)
    try {
      return await service.update(request, controller.signal)
    } finally {
      if (senderRequests.get(id) === controller) senderRequests.delete(id)
      if (senderRequests.size === 0) active.delete(event.sender)
    }
  })
  // Annuaire des collaborateurs (autocomplete assigne) : equipes du projet -> membres, memes
  // credentials que tickets:list. BEST-EFFORT : toute defaillance => [] (l'autocomplete degrade
  // sur les assignes deja charges, jamais d'erreur bloquante pour la vue).
  ipc.handle('tickets:people', async (event, value: unknown) => {
    assertTrusted(event, 'Tickets')
    const source = parseTicketSourceProfile(value)
    if (!source || !people.estAutorisee(source)) {
      throw new Error('Profil Tickets non autorisé')
    }
    return people.list(source)
  })
  ipc.handle('tickets:cancel', (event, value: unknown) => {
    assertTrusted(event, 'Tickets')
    const id = requestId(value)
    const senderRequests = active.get(event.sender)
    const current = senderRequests?.get(id)
    if (!current) return false
    current.abort()
    senderRequests?.delete(id)
    if (senderRequests?.size === 0) active.delete(event.sender)
    return true
  })
}
