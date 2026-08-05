import {
  DEFAULT_TICKET_SOURCE,
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
export interface TicketCreateIpcRequest {
  source: TicketSourceProfile
  title: string
  requestId?: string
  description?: string
  workItemType?: string
  assignee?: string
}

interface TicketsServicePort {
  sources(): TicketSourceSummary[]
  saveSource(value: unknown): TicketSourceSummary[]
  list(value: TicketListRequest, signal?: AbortSignal): Promise<TicketPage>
  create(value: TicketCreateIpcRequest, signal?: AbortSignal): Promise<TicketItem>
}

interface RegisterTicketsIpcOptions {
  ipc: TicketsIpcRegistrar
  service: TicketsServicePort
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assertTrusted: (event: any, scope: string) => void
  isolated: boolean
}

function requiredText(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 500) {
    throw new Error(`Fixture Tickets ${name} invalide`)
  }
  return value
}

function proofFixture(value: unknown): { source: TicketSourceProfile; page: TicketPage } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Fixture Tickets invalide')
  }
  const raw = value as Record<string, unknown>
  if (
    raw.provider !== 'azure' ||
    raw.organization !== DEFAULT_TICKET_SOURCE.organization ||
    raw.project !== DEFAULT_TICKET_SOURCE.project ||
    raw.repository !== DEFAULT_TICKET_SOURCE.repository ||
    !Array.isArray(raw.items) ||
    raw.items.length === 0 ||
    raw.items.length > 100
  ) {
    throw new Error('Fixture Tickets invalide')
  }
  const items = raw.items.map<TicketItem>((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('Élément de fixture Tickets invalide')
    }
    const item = candidate as Record<string, unknown>
    const id = requiredText(item.id, 'id')
    const relations = Array.isArray(item.relations)
      ? item.relations.map((relation) => {
          if (!relation || typeof relation !== 'object' || Array.isArray(relation)) {
            throw new Error('Relation de fixture Tickets invalide')
          }
          const rawRelation = relation as Record<string, unknown>
          return {
            kind: requiredText(rawRelation.kind, 'relation.kind'),
            target: requiredText(rawRelation.target, 'relation.target')
          }
        })
      : []
    return {
      id,
      sourceId: DEFAULT_TICKET_SOURCE.id,
      type: requiredText(item.type, 'type'),
      title: requiredText(item.title, 'title'),
      state: requiredText(item.state, 'state'),
      url: `https://dev.azure.com/AmitelGTC/RIG/_workitems/edit/${encodeURIComponent(id)}`,
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-23T00:00:00.000Z',
      ...(typeof item.assignee === 'string' && item.assignee
        ? { assignee: item.assignee.slice(0, 500) }
        : {}),
      ...(typeof item.description === 'string'
        ? { description: item.description.slice(0, 10_000) }
        : {}),
      relations,
      fields: { __autowinTicketsProofFixture: true }
    }
  })
  return {
    source: DEFAULT_TICKET_SOURCE,
    page: { items, hasMore: false }
  }
}

export function registerTicketsIpc({
  ipc,
  service,
  assertTrusted,
  isolated
}: RegisterTicketsIpcOptions): void {
  let fixture: { source: TicketSourceProfile; page: TicketPage } | undefined
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
    if (fixture && request?.source?.id === fixture.source.id) return fixture.page
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
   * CRÉATION — la seule action SORTANTE de la chaîne Tickets : elle écrit dans le backlog d'une
   * équipe, sous l'identité de l'utilisateur. Elle franchit donc la même porte que les lectures
   * (`assertTrusted`) et partage leur registre d'annulation : un POST réseau lent doit pouvoir être
   * coupé par `tickets:cancel` avec le même `requestId`, sinon l'appelant reste pendu sans recours.
   *
   * Les bornes de validité des champs vivent dans le SERVICE, pas ici : l'IPC ne fait que la
   * frontière de confiance et le cycle de vie de la requête.
   */
  ipc.handle('tickets:create', async (event, request: TicketCreateIpcRequest) => {
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
      return await service.create(request, controller.signal)
    } finally {
      if (senderRequests.get(id) === controller) senderRequests.delete(id)
      if (senderRequests.size === 0) active.delete(event.sender)
    }
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
  ipc.handle('app:test:tickets-fixture', (event, value: unknown) => {
    assertTrusted(event, 'Fixture Tickets')
    if (!isolated) throw new Error('Fixture Tickets indisponible hors instance isolée')
    fixture = proofFixture(value)
    return true
  })
}
