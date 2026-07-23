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

interface TicketsServicePort {
  sources(): TicketSourceSummary[]
  saveSource(value: unknown): TicketSourceSummary[]
  list(value: TicketListRequest, signal?: AbortSignal): Promise<TicketPage>
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
      updatedAt: '2026-07-23T00:00:00.000Z',
      ...(typeof item.assignee === 'string' && item.assignee
        ? { assignee: item.assignee.slice(0, 500) }
        : {}),
      ...(typeof item.description === 'string'
        ? { description: item.description.slice(0, 10_000) }
        : {}),
      relations,
      fields: {}
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
  const active = new Map<string, { sender: unknown; controller: AbortController }>()
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
    const previous = active.get(id)
    if (previous && previous.sender === event.sender) previous.controller.abort()
    const controller = new AbortController()
    active.set(id, { sender: event.sender, controller })
    try {
      return await service.list(request, controller.signal)
    } finally {
      if (active.get(id)?.controller === controller) active.delete(id)
    }
  })
  ipc.handle('tickets:cancel', (event, value: unknown) => {
    assertTrusted(event, 'Tickets')
    const id = requestId(value)
    const current = active.get(id)
    if (!current || current.sender !== event.sender) return false
    current.controller.abort()
    active.delete(id)
    return true
  })
  ipc.handle('app:test:tickets-fixture', (event, value: unknown) => {
    assertTrusted(event, 'Fixture Tickets')
    if (!isolated) throw new Error('Fixture Tickets indisponible hors instance isolée')
    fixture = proofFixture(value)
    return true
  })
}
