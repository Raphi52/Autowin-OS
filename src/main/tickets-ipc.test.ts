import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_TICKET_SOURCE } from '../shared/tickets'
import { registerTicketsIpc, type TicketsIpcRegistrar } from './tickets-ipc'

function setup(isolated = false) {
  const handlers = new Map<string, (...args: any[]) => unknown>()
  const ipc = {
    handle: (channel, handler) => handlers.set(channel, handler)
  } satisfies TicketsIpcRegistrar
  const service = {
    sources: vi.fn(() => []),
    saveSource: vi.fn(() => []),
    list: vi.fn(async () => ({ items: [], hasMore: false }))
  }
  const assertTrusted = vi.fn()
  registerTicketsIpc({ ipc, service, assertTrusted, isolated })
  return { handlers, service, assertTrusted }
}

describe('IPC Tickets', () => {
  it('valide le renderer avant chaque lecture et délègue au service', async () => {
    const { handlers, service, assertTrusted } = setup()
    const event = { senderFrame: { url: 'app://trusted' } }

    expect(await handlers.get('tickets:sources')!(event)).toEqual([])
    await handlers.get('tickets:list')!(event, { source: DEFAULT_TICKET_SOURCE })

    expect(assertTrusted).toHaveBeenCalledTimes(2)
    expect(service.list).toHaveBeenCalledWith({ source: DEFAULT_TICKET_SOURCE })
  })

  it('n’expose jamais la fixture hors instance isolée', async () => {
    const { handlers } = setup(false)
    expect(() => handlers.get('app:test:tickets-fixture')!({}, { items: [] })).toThrow(
      /indisponible/i
    )
  })

  it('installe une page déterministe uniquement en instance isolée', async () => {
    const { handlers, service } = setup(true)
    await handlers.get('app:test:tickets-fixture')!(
      {},
      {
        provider: 'azure',
        organization: 'AmitelGTC',
        project: 'RIG',
        repository: 'RigApplication',
        items: [
          {
            id: '1',
            type: 'Fiche Team',
            title: 'Fixture',
            state: 'En cours',
            description: '',
            relations: []
          }
        ]
      }
    )

    const page = await handlers.get('tickets:list')!({}, { source: DEFAULT_TICKET_SOURCE })
    expect(page).toMatchObject({
      items: [{ id: '1', sourceId: DEFAULT_TICKET_SOURCE.id, title: 'Fixture' }],
      hasMore: false
    })
    expect(service.list).not.toHaveBeenCalled()
  })
})
