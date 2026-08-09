// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_TICKET_SOURCE, type TicketItem, type TicketPage } from '../../../shared/tickets'
import { TicketsView } from './TicketsView'

const RETRY_TITLE = 'Réessayer le chargement des tickets'

function item(id: string): TicketItem {
  return {
    id,
    sourceId: DEFAULT_TICKET_SOURCE.id,
    type: 'Fiche Team',
    title: `Ticket ${id}`,
    state: 'En cours',
    assignee: 'Équipe RIG',
    description: '',
    createdAt: '2026-07-22T09:00:00.000Z',
    updatedAt: '2026-07-23T10:00:00.000Z',
    url: `https://example.test/tickets/${id}`,
    relations: [],
    fields: {}
  }
}

function api(overrides: Record<string, unknown> = {}): void {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      ticketSources: vi.fn(async () => [
        { profile: DEFAULT_TICKET_SOURCE, credentialConfigured: false }
      ]),
      listTickets: vi.fn(async (): Promise<TicketPage> => ({ items: [item('1')], hasMore: false })),
      saveTicketSource: vi.fn(),
      cancelTickets: vi.fn(async () => false),
      listTicketPeople: vi.fn(async () => []),
      ...overrides
    }
  })
}

async function render(): Promise<{ root: Root; container: HTMLElement }> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<TicketsView active />)
    await Promise.resolve()
    await Promise.resolve()
  })
  return { root, container }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('TicketsView — title du bouton Réessayer', () => {
  it('porte le title attendu sur le bouton de réessai après une erreur de chargement des tickets', async () => {
    const listTickets = vi
      .fn()
      .mockRejectedValueOnce(new Error('Authentification requise.'))
      .mockResolvedValueOnce({ items: [], hasMore: false })
    api({ listTickets })
    const { root, container } = await render()

    const retry = container.querySelector('[data-testid="tickets-retry"]') as HTMLButtonElement
    expect(retry).not.toBeNull()
    expect(retry.getAttribute('title')).toBe(RETRY_TITLE)

    await act(async () => root.unmount())
  })

  it('porte le title attendu sur le bouton de réessai après une erreur de chargement des sources', async () => {
    const ticketSources = vi.fn().mockRejectedValueOnce(new Error('Store de sources indisponible.'))
    api({ ticketSources })
    const { root, container } = await render()

    const retry = container.querySelector('[data-testid="tickets-retry"]') as HTMLButtonElement
    expect(retry).not.toBeNull()
    expect(retry.getAttribute('title')).toBe(RETRY_TITLE)

    await act(async () => root.unmount())
  })
})
