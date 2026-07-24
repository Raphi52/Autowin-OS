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
    createdAt: '2026-07-22T09:00:00.000Z',
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
      cancelTickets: vi.fn(async () => false),
      roles: vi.fn(async () => ({ orchestrator: { provider: 'codex' } })),
      conversationsCreate: vi.fn(async ({ title }: { title: string }) => ({
        id: `conv-${title}`,
        title,
        category: 'codex',
        provider: 'codex'
      })),
      conversationsRemove: vi.fn(async () => true),
      pilotChat: vi.fn(async () => ({ ok: true })),
      cancelPilotChat: vi.fn(async () => ({ ok: true })),
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
    expect(container.textContent).toContain('Tous les Work Items du projet RIG')
    expect(container.querySelectorAll('[data-testid="ticket-row"]')).toHaveLength(3)
    expect(container.textContent).toContain('Bug')
    await act(async () => {
      ;(container.querySelector('[data-testid="ticket-row"]') as HTMLButtonElement).click()
    })
    const detail = container.querySelector('[data-testid="ticket-detail"]')
    expect(detail?.textContent).toContain('Description lisible')
    expect(detail?.textContent).toContain('2026-07-22T09:00:00.000Z')
    expect(detail?.textContent).toContain('child')
    expect(detail?.querySelector('a[href="https://example.test/tickets/1"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="tickets-page-end"]')).not.toBeNull()
    await act(async () => root.unmount())
  })

  it('aligne le détail sur les tickets encore visibles après filtrage', async () => {
    api()
    const { root, container } = await render()
    const state = container.querySelector('[aria-label="Filtrer par état"]') as HTMLSelectElement

    await act(async () => {
      state.value = 'Closed'
      state.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(container.querySelectorAll('[data-testid="ticket-row"]')).toHaveLength(1)
    expect(container.querySelector('[data-testid="ticket-detail"]')?.textContent).toContain(
      'Ticket 3'
    )
    expect(container.querySelector('[data-testid="ticket-detail"]')?.textContent).not.toContain(
      'Ticket 1'
    )
    await act(async () => root.unmount())
  })

  it('ne charge rien tant que la vue persistante est inactive', async () => {
    const ticketSources = vi.fn()
    api({ ticketSources })
    const { root } = await render(false)
    expect(ticketSources).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })

  it('Tout traiter crée et prompte une conversation par ticket visible uniquement', async () => {
    const conversationsCreate = vi.fn(
      async ({ title }: { title: string; authorityMode?: 'plan' | 'ask' | 'auto' }) => ({
        id: `conv-${title}`,
        title,
        category: 'codex',
        provider: 'codex'
      })
    )
    const pilotChat = vi.fn(
      async (_messages: Array<{ role: string; content: string }>, _conversationId: string) => ({
        ok: true
      })
    )
    api({ conversationsCreate, pilotChat })
    const { root, container } = await render()
    const state = container.querySelector('[aria-label="Filtrer par état"]') as HTMLSelectElement
    await act(async () => {
      state.value = 'Closed'
      state.dispatchEvent(new Event('change', { bubbles: true }))
    })

    await act(async () => {
      ;(container.querySelector('[data-testid="tickets-process-all"]') as HTMLButtonElement).click()
      await vi.waitFor(() => expect(pilotChat).toHaveBeenCalledOnce())
    })

    expect(conversationsCreate).toHaveBeenCalledOnce()
    expect(conversationsCreate.mock.calls[0][0].title).toContain('#3')
    expect(conversationsCreate.mock.calls[0][0].authorityMode).toBe('ask')
    expect(pilotChat.mock.calls[0][0][0].content).toContain('"id": "3"')
    expect(pilotChat.mock.calls[0][0][0].content).toContain('DONNÉES NON FIABLES')
    expect(container.querySelector('[data-testid="tickets-batch-status"]')?.textContent).toContain(
      '1/1'
    )
    await act(async () => root.unmount())
  })

  it('verrouille un double clic synchrone sur Tout traiter', async () => {
    let resolvePilot!: (result: { ok: boolean }) => void
    const pilotChat = vi.fn(
      () =>
        new Promise<{ ok: boolean }>((resolve) => {
          resolvePilot = resolve
        })
    )
    api({
      listTickets: vi.fn(async () => ({ items: [item('1')], hasMore: false })),
      pilotChat
    })
    const { root, container } = await render()
    const button = container.querySelector(
      '[data-testid="tickets-process-all"]'
    ) as HTMLButtonElement
    await act(async () => {
      button.click()
      button.click()
      await vi.waitFor(() => expect(pilotChat).toHaveBeenCalledOnce())
    })
    resolvePilot({ ok: true })
    await act(async () => await Promise.resolve())
    await act(async () => root.unmount())
  })

  it('ne crée aucune conversation si la vue devient inactive pendant la résolution du rôle', async () => {
    let resolveRoles!: (roles: { orchestrator: { provider: string } }) => void
    const roles = vi.fn(
      () =>
        new Promise<{ orchestrator: { provider: string } }>((resolve) => {
          resolveRoles = resolve
        })
    )
    const conversationsCreate = vi.fn()
    api({
      listTickets: vi.fn(async () => ({ items: [item('1')], hasMore: false })),
      roles,
      conversationsCreate
    })
    const { root, container } = await render()
    await act(async () => {
      ;(container.querySelector('[data-testid="tickets-process-all"]') as HTMLButtonElement).click()
      await Promise.resolve()
    })
    await act(async () => {
      root.render(createElement(TicketsView, { active: false }))
      await Promise.resolve()
    })
    await act(async () => {
      resolveRoles({ orchestrator: { provider: 'codex' } })
      await Promise.resolve()
    })
    expect(conversationsCreate).not.toHaveBeenCalled()

    await act(async () => {
      root.render(createElement(TicketsView, { active: true }))
      await Promise.resolve()
    })
    await vi.waitFor(() => {
      const resumedButton = container.querySelector(
        '[data-testid="tickets-process-all"]'
      ) as HTMLButtonElement
      expect(resumedButton.disabled).toBe(false)
      expect(resumedButton.textContent).toBe('Tout traiter')
    })

    await act(async () => root.unmount())
  })

  it('annule le tour actif et abandonne une conversation créée après désactivation', async () => {
    let resolveCreate!: (conversation: {
      id: string
      title: string
      category: string
      provider: string
    }) => void
    const conversationsCreate = vi.fn(
      () =>
        new Promise<{
          id: string
          title: string
          category: string
          provider: string
        }>((resolve) => {
          resolveCreate = resolve
        })
    )
    const conversationsRemove = vi.fn(async () => true)
    const pilotChat = vi.fn()
    api({
      listTickets: vi.fn(async () => ({ items: [item('1')], hasMore: false })),
      conversationsCreate,
      conversationsRemove,
      pilotChat
    })
    const { root, container } = await render()
    await act(async () => {
      ;(container.querySelector('[data-testid="tickets-process-all"]') as HTMLButtonElement).click()
      await vi.waitFor(() => expect(conversationsCreate).toHaveBeenCalledOnce())
    })
    await act(async () => {
      root.render(createElement(TicketsView, { active: false }))
      await Promise.resolve()
    })
    await act(async () => {
      resolveCreate({
        id: 'conv-late',
        title: '#1',
        category: 'codex',
        provider: 'codex'
      })
      await vi.waitFor(() => expect(conversationsRemove).toHaveBeenCalledWith('conv-late'))
    })
    expect(pilotChat).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })

  it('interrompt le lot courant quand la source change', async () => {
    let resolvePilot!: (result: { ok: boolean; cancelled: boolean }) => void
    const pilotChat = vi.fn(
      () =>
        new Promise<{ ok: boolean; cancelled: boolean }>((resolve) => {
          resolvePilot = resolve
        })
    )
    const cancelPilotChat = vi.fn(async () => {
      resolvePilot({ ok: false, cancelled: true })
      return { ok: true }
    })
    api({
      ticketSources: vi.fn(async () => [
        { profile: DEFAULT_TICKET_SOURCE, credentialConfigured: false },
        { profile: github, credentialConfigured: false }
      ]),
      listTickets: vi.fn(async ({ source }: { source: { id: string } }) => ({
        items: [item(source.id === github.id ? '2' : '1', source.id)],
        hasMore: false
      })),
      conversationsCreate: vi.fn(async () => ({
        id: 'conv-source-a',
        title: '#1',
        category: 'codex',
        provider: 'codex'
      })),
      pilotChat,
      cancelPilotChat
    })
    const { root, container } = await render()
    await act(async () => {
      ;(container.querySelector('[data-testid="tickets-process-all"]') as HTMLButtonElement).click()
      await vi.waitFor(() => expect(pilotChat).toHaveBeenCalledOnce())
    })
    await act(async () => {
      const source = container.querySelector('[data-testid="tickets-source"]') as HTMLSelectElement
      source.value = github.id
      source.dispatchEvent(new Event('change', { bubbles: true }))
      await vi.waitFor(() => expect(cancelPilotChat).toHaveBeenCalledWith('conv-source-a'))
    })
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="tickets-source"]')?.textContent).toContain(
        'openai / codex'
      )
      expect(
        container.querySelector('[data-testid="tickets-batch-status"]')?.textContent
      ).toContain('Lot interrompu')
    })
    await act(async () => root.unmount())
  })

  it('ne relance pas de lecture si une sauvegarde se termine après désactivation', async () => {
    let resolveSave!: (
      sources: Array<{ profile: GitHubTicketSource; credentialConfigured: boolean }>
    ) => void
    const saveTicketSource = vi.fn(
      () =>
        new Promise<Array<{ profile: GitHubTicketSource; credentialConfigured: boolean }>>(
          (resolve) => {
            resolveSave = resolve
          }
        )
    )
    const listTickets = vi.fn(async () => ({ items: [item('1')], hasMore: false }))
    api({ saveTicketSource, listTickets })
    const { root, container } = await render()

    await act(async () => {
      container.querySelector('button') as HTMLButtonElement
      const add = [...container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Ajouter une source'
      ) as HTMLButtonElement
      add.click()
    })
    await act(async () => {
      const provider = container.querySelector('[aria-label="Fournisseur"]') as HTMLSelectElement
      provider.value = 'github'
      provider.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => {
      const owner = container.querySelector(
        '[aria-label="Propriétaire GitHub"]'
      ) as HTMLInputElement
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        owner,
        'openai'
      )
      owner.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      const repository = container.querySelector('[aria-label="Dépôt"]') as HTMLInputElement
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        repository,
        'codex'
      )
      repository.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      const save = [...container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Enregistrer'
      ) as HTMLButtonElement
      save.click()
      await Promise.resolve()
    })
    expect(saveTicketSource).toHaveBeenCalledOnce()

    await act(async () => {
      root.render(createElement(TicketsView, { active: false }))
      await Promise.resolve()
    })
    await act(async () => {
      resolveSave([{ profile: github, credentialConfigured: false }])
      await Promise.resolve()
    })

    expect(listTickets).toHaveBeenCalledTimes(1)
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
    expect(window.api.cancelTickets).toHaveBeenCalled()
    await act(async () => root.unmount())
  })

  it('masque immédiatement les tickets déjà chargés lors d’un changement de source', async () => {
    let resolveGitHub!: (page: TicketPage) => void
    const githubPage = new Promise<TicketPage>((resolve) => {
      resolveGitHub = resolve
    })
    api({
      ticketSources: vi.fn(async () => [
        { profile: DEFAULT_TICKET_SOURCE, credentialConfigured: false },
        { profile: github, credentialConfigured: false }
      ]),
      listTickets: vi.fn(({ source }: { source: { provider: string } }) =>
        source.provider === 'azure'
          ? Promise.resolve({ items: [item('1')], hasMore: false })
          : githubPage
      )
    })
    const { root, container } = await render()
    expect(container.textContent).toContain('Ticket 1')
    const select = container.querySelector('[aria-label="Source de tickets"]') as HTMLSelectElement

    await act(async () => {
      select.value = github.id
      select.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })

    expect(container.textContent).not.toContain('Ticket 1')
    expect(container.querySelector('[role="status"]')).not.toBeNull()
    await act(async () => {
      resolveGitHub({ items: [item('99', github.id)], hasMore: false })
      await Promise.resolve()
    })
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

  it('recharge les sources quand leur lecture initiale échoue', async () => {
    const ticketSources = vi
      .fn()
      .mockRejectedValueOnce(new Error('Store de sources indisponible.'))
      .mockResolvedValueOnce([{ profile: DEFAULT_TICKET_SOURCE, credentialConfigured: false }])
    api({ ticketSources })
    const { root, container } = await render()

    expect(container.textContent).toContain('Store de sources indisponible')
    await act(async () => {
      ;(container.querySelector('[data-testid="tickets-retry"]') as HTMLButtonElement).click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(ticketSources).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('Ticket 1')
    await act(async () => root.unmount())
  })

  it('recharge les sources après une erreur de réactivation avec anciennes données', async () => {
    const ticketSources = vi
      .fn()
      .mockResolvedValueOnce([{ profile: DEFAULT_TICKET_SOURCE, credentialConfigured: false }])
      .mockRejectedValueOnce(new Error('Store de sources indisponible au retour.'))
      .mockResolvedValueOnce([{ profile: DEFAULT_TICKET_SOURCE, credentialConfigured: false }])
    api({ ticketSources })
    const { root, container } = await render()

    await act(async () => {
      root.render(createElement(TicketsView, { active: false }))
      await Promise.resolve()
    })
    await act(async () => {
      root.render(createElement(TicketsView, { active: true }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(container.textContent).toContain('Store de sources indisponible au retour')

    await act(async () => {
      ;(container.querySelector('[data-testid="tickets-retry"]') as HTMLButtonElement).click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(ticketSources).toHaveBeenCalledTimes(3)
    expect(container.textContent).toContain('Ticket 1')
    await act(async () => root.unmount())
  })

  it('ne rattache pas les anciennes données à une nouvelle source après réactivation', async () => {
    const ticketSources = vi
      .fn()
      .mockResolvedValueOnce([{ profile: DEFAULT_TICKET_SOURCE, credentialConfigured: false }])
      .mockResolvedValueOnce([{ profile: github, credentialConfigured: false }])
    const listTickets = vi
      .fn()
      .mockResolvedValueOnce({ items: [item('1')], hasMore: false })
      .mockRejectedValueOnce(new Error('GitHub indisponible.'))
    api({ ticketSources, listTickets })
    const { root, container } = await render()

    await act(async () => {
      root.render(createElement(TicketsView, { active: false }))
      await Promise.resolve()
    })
    await act(async () => {
      root.render(createElement(TicketsView, { active: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.querySelector('[data-testid="tickets-source"]')?.textContent).toContain(
      'openai / codex'
    )
    expect(container.textContent).toContain('GitHub indisponible')
    expect(container.textContent).not.toContain('Ticket 1')
    await act(async () => root.unmount())
  })

  it('distingue aucune source, filtre localement et charge la page suivante', async () => {
    api({ ticketSources: vi.fn(async () => []) })
    const first = await render()
    expect(first.container.textContent).toContain('Aucune source configurée')
    await act(async () => first.root.unmount())

    const listTickets = vi
      .fn()
      .mockResolvedValueOnce({
        items: [item('1'), item('3')],
        cursor: 'next',
        hasMore: true
      })
      .mockResolvedValueOnce({ items: [item('4')], hasMore: false })
    api({ listTickets })
    const { root, container } = await render()
    const state = container.querySelector('[aria-label="Filtrer par état"]') as HTMLSelectElement
    await act(async () => {
      state.value = 'Closed'
      state.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(container.querySelectorAll('[data-testid="ticket-row"]')).toHaveLength(1)
    await act(async () => {
      ;(container.querySelector('.tickets-load-more') as HTMLButtonElement).click()
      await Promise.resolve()
    })
    expect(listTickets).toHaveBeenCalledTimes(2)
    await act(async () => root.unmount())
  })

  it('conserve les données et les marque périmées après une erreur de rafraîchissement', async () => {
    const listTickets = vi
      .fn()
      .mockResolvedValueOnce({ items: [item('1')], hasMore: false })
      .mockRejectedValueOnce(new Error('Délai fournisseur dépassé.'))
    api({ listTickets })
    const { root, container } = await render()
    await act(async () => {
      ;(container.querySelector('[data-testid="tickets-refresh"]') as HTMLButtonElement).click()
      await Promise.resolve()
    })
    expect(container.querySelector('[data-testid="tickets-stale"]')?.textContent).toContain(
      'Données périmées'
    )
    expect(container.textContent).toContain('Ticket 1')
    await act(async () => root.unmount())
  })

  it('permet de dépasser une page fournisseur vide mais encore paginable', async () => {
    const listTickets = vi
      .fn()
      .mockResolvedValueOnce({ items: [], cursor: 'next', hasMore: true })
      .mockResolvedValueOnce({ items: [item('4')], hasMore: false })
    api({ listTickets })
    const { root, container } = await render()

    const loadMore = container.querySelector('.tickets-load-more') as HTMLButtonElement
    expect(loadMore).not.toBeNull()
    await act(async () => {
      loadMore.click()
      await Promise.resolve()
    })
    expect(container.textContent).toContain('Ticket 4')
    expect(listTickets).toHaveBeenCalledTimes(2)
    await act(async () => root.unmount())
  })

  it('conserve la pagination quand un filtre ne correspond pas encore à la page courante', async () => {
    const listTickets = vi
      .fn()
      .mockResolvedValueOnce({
        items: [item('1'), item('3')],
        cursor: 'next',
        hasMore: true
      })
      .mockResolvedValueOnce({
        items: [{ ...item('4'), type: 'Bug', state: 'En cours' }],
        hasMore: false
      })
    api({ listTickets })
    const { root, container } = await render()
    const type = container.querySelector('[aria-label="Filtrer par type"]') as HTMLSelectElement
    const state = container.querySelector('[aria-label="Filtrer par état"]') as HTMLSelectElement
    await act(async () => {
      type.value = 'Bug'
      type.dispatchEvent(new Event('change', { bubbles: true }))
      state.value = 'En cours'
      state.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const loadMore = container.querySelector('.tickets-load-more') as HTMLButtonElement
    expect(loadMore).not.toBeNull()
    await act(async () => {
      loadMore.click()
      await Promise.resolve()
    })
    expect(container.textContent).toContain('Ticket 4')
    await act(async () => root.unmount())
  })

  it('explique le raccordement privé sans demander de secret au renderer', async () => {
    api()
    const { root, container } = await render()
    await act(async () => {
      const add = [...container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Ajouter une source'
      ) as HTMLButtonElement
      add.click()
    })
    const provider = container.querySelector('[aria-label="Fournisseur"]') as HTMLSelectElement
    await act(async () => {
      provider.value = 'github'
      provider.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(container.querySelector('[data-testid="tickets-auth-help"]')?.textContent).toContain(
      'gh'
    )
    expect(container.querySelector('[data-testid="tickets-auth-help"]')?.textContent).toContain(
      'GH_TOKEN'
    )
    expect(container.querySelector('[data-testid="tickets-auth-help"]')?.textContent).toContain(
      'cet hôte'
    )
    expect(container.querySelector('input[type="password"]')).toBeNull()
    await act(async () => root.unmount())
  })
})
