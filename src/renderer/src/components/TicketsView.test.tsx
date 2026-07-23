// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_TICKET_SOURCE,
  type GitHubTicketSource,
  type TicketItem,
  type TicketPage
} from '../../../shared/tickets'
import { TicketsView } from './TicketsView'

const github: GitHubTicketSource = {
  id: 'github:openai:codex',
  label: 'openai / codex',
  provider: 'github',
  owner: 'openai',
  repository: 'codex'
}

function item(id: string, sourceId = DEFAULT_TICKET_SOURCE.id): TicketItem {
  return {
    id,
    sourceId,
    type: id === '3' ? 'Bug' : 'Fiche Team',
    title: `Ticket ${id}`,
    state: id === '3' ? 'Closed' : 'En cours',
    assignee: 'Équipe RIG',
    description: id === '1' ? 'Description lisible' : '',
    updatedAt: '2026-07-23T10:00:00.000Z',
    url: `https://example.test/tickets/${id}`,
    relations: id === '1' ? [{ kind: 'child', target: '2' }] : [],
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
      listTickets: vi.fn(async (): Promise<TicketPage> => ({
        items: [item('1'), item('2'), item('3')],
        hasMore: false
      })),
      saveTicketSource: vi.fn(),
      ...overrides
    }
  })
}

async function render(active = true): Promise<{ root: Root; container: HTMLElement }> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(TicketsView, { active }))
    await Promise.resolve()
    await Promise.resolve()
  })
  return { root, container }
}

describe('vue Tickets', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })
  afterEach(() => {
    document.body.replaceChildren()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('affiche RigApplication, tous les types et le détail sélectionné', async () => {
    api()
    const { root, container } = await render()

    expect(container.querySelector('[data-testid="tickets-source"]')?.textContent).toContain(
      'AmitelGTC / RIG / RigApplication'
    )
    expect(container.querySelectorAll('[data-testid="ticket-row"]')).toHaveLength(3)
    expect(container.textContent).toContain('Bug')
    await act(async () => {
      ;(container.querySelector('[data-testid="ticket-row"]') as HTMLButtonElement).click()
    })
    const detail = container.querySelector('[data-testid="ticket-detail"]')
    expect(detail?.textContent).toContain('Description lisible')
    expect(detail?.textContent).toContain('child')
    expect(detail?.querySelector('a[href="https://example.test/tickets/1"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="tickets-page-end"]')).not.toBeNull()
    await act(async () => root.unmount())
  })

  it('ne charge rien tant que la vue persistante est inactive', async () => {
    const ticketSources = vi.fn()
    api({ ticketSources })
    const { root } = await render(false)
    expect(ticketSources).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })

  it('ignore la réponse périmée quand la source change rapidement', async () => {
    let resolveAzure!: (page: TicketPage) => void
    const azurePage = new Promise<TicketPage>((resolve) => {
      resolveAzure = resolve
    })
    const listTickets = vi.fn(({ source }: { source: { provider: string } }) =>
      source.provider === 'azure'
        ? azurePage
        : Promise.resolve({
            items: [item('99', github.id)],
            hasMore: false
          })
    )
    api({
      ticketSources: vi.fn(async () => [
        { profile: DEFAULT_TICKET_SOURCE, credentialConfigured: false },
        { profile: github, credentialConfigured: false }
      ]),
      listTickets
    })
    const { root, container } = await render()
    const select = container.querySelector('[aria-label="Source de tickets"]') as HTMLSelectElement

    await act(async () => {
      select.value = github.id
      select.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })
    expect(container.textContent).toContain('Ticket 99')

    await act(async () => {
      resolveAzure({ items: [item('1')], hasMore: false })
      await Promise.resolve()
    })
    expect(container.textContent).toContain('Ticket 99')
    expect(container.textContent).not.toContain('Ticket 1')
    await act(async () => root.unmount())
  })

  it('rend une erreur actionnable et permet de réessayer', async () => {
    const listTickets = vi
      .fn()
      .mockRejectedValueOnce(new Error('Authentification requise.'))
      .mockResolvedValueOnce({ items: [], hasMore: false })
    api({ listTickets })
    const { root, container } = await render()

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Authentification requise'
    )
    await act(async () => {
      ;(container.querySelector('[data-testid="tickets-retry"]') as HTMLButtonElement).click()
      await Promise.resolve()
    })
    expect(listTickets).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('Aucun ticket')
    await act(async () => root.unmount())
  })
})
