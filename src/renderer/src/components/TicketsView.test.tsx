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
      listTicketPeople: vi.fn(async () => []),
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

  it('désactive « Traiter la sélection » sans coche puis tout sélectionne/désélectionne', async () => {
    api()
    const { root, container } = await render()
    const treat = container.querySelector(
      '[data-testid="tickets-treat-selection"]'
    ) as HTMLButtonElement
    const selectAll = container.querySelector(
      '[data-testid="tickets-select-all"]'
    ) as HTMLButtonElement

    expect(treat.disabled).toBe(true)
    expect(selectAll.textContent).toContain('Tout sélectionner (3)')
    await act(async () => selectAll.click())
    const checks = container.querySelectorAll<HTMLInputElement>(
      '[data-testid="ticket-process-checkbox"]'
    )
    expect([...checks].every((box) => box.checked)).toBe(true)
    expect(treat.disabled).toBe(false)
    expect(treat.textContent).toContain('(3)')
    expect(selectAll.textContent).toContain('Tout désélectionner')
    expect(
      container.querySelector('[data-testid="tickets-selection-count"]')?.textContent
    ).toContain('3 sélectionné(s)')

    await act(async () => selectAll.click())
    expect([...checks].every((box) => !box.checked)).toBe(true)
    expect(treat.disabled).toBe(true)
    await act(async () => root.unmount())
  })

  it('PROMPT-FIRST : ouvre UNE conversation pour la sélection et pré-remplit sans envoyer', async () => {
    const conversationsCreate = vi.fn(async ({ title }: { title: string }) => ({
      id: `conv-${title}`
    }))
    const orchestrate = vi.fn(async () => ({ ok: true }))
    const appCommand = vi.fn(async () => ({ ok: true }))
    api({
      roles: vi.fn(async () => ({ orchestrator: { provider: 'claude' } })),
      conversationsCreate,
      orchestrate,
      appCommand
    })
    const prefills: Array<{ conversationId?: string; prompt?: string; send?: boolean }> = []
    const listener = (e: Event): void => {
      prefills.push((e as CustomEvent).detail)
    }
    window.addEventListener('autowin:prefill-conversation', listener)
    const { root, container } = await render()
    const checks = container.querySelectorAll<HTMLInputElement>(
      '[data-testid="ticket-process-checkbox"]'
    )
    await act(async () => {
      checks[0].click()
      checks[2].click()
    })
    const treat = container.querySelector(
      '[data-testid="tickets-treat-selection"]'
    ) as HTMLButtonElement
    expect(treat.textContent).toContain('Préparer le prompt')
    await act(async () => {
      treat.click()
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })

    // UNE seule conversation pour la selection (avant : une par ticket).
    expect(conversationsCreate).toHaveBeenCalledTimes(1)
    // AUCUNE orchestration lancee : le geste par defaut PREPARE, il n'execute pas.
    expect(orchestrate).not.toHaveBeenCalled()
    expect(prefills).toHaveLength(1)
    expect(prefills[0].send).toBe(false)
    expect(prefills[0].prompt).toContain('#1')
    expect(prefills[0].prompt).toContain('#3')
    expect(prefills[0].prompt).not.toContain('Ticket 2')
    // L'utilisateur est amene sur le Chat, sinon le prompt prepare resterait invisible.
    expect(appCommand).toHaveBeenCalledWith('navigate', { tab: 'chat' })
    window.removeEventListener('autowin:prefill-conversation', listener)
    await act(async () => root.unmount())
  })

  it('mode « Traiter réellement » coché : le prompt est ENVOYE directement', async () => {
    api({
      roles: vi.fn(async () => ({ orchestrator: { provider: 'claude' } })),
      conversationsCreate: vi.fn(async () => ({ id: 'conv-1' })),
      appCommand: vi.fn(async () => ({ ok: true }))
    })
    const prefills: Array<{ send?: boolean }> = []
    const listener = (e: Event): void => {
      prefills.push((e as CustomEvent).detail)
    }
    window.addEventListener('autowin:prefill-conversation', listener)
    const { root, container } = await render()
    const mode = container.querySelector(
      '[data-testid="tickets-mode-send"] input'
    ) as HTMLInputElement
    await act(async () => mode.click())
    const treat = container.querySelector(
      '[data-testid="tickets-treat-selection"]'
    ) as HTMLButtonElement
    expect(treat.textContent).toContain('Traiter la sélection')
    const checks = container.querySelectorAll<HTMLInputElement>(
      '[data-testid="ticket-process-checkbox"]'
    )
    await act(async () => checks[0].click())
    await act(async () => {
      treat.click()
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    expect(prefills).toHaveLength(1)
    expect(prefills[0].send).toBe(true)
    window.removeEventListener('autowin:prefill-conversation', listener)
    await act(async () => root.unmount())
  })

  it('filtre par assigné avec autocomplete alimenté par l’annuaire Azure + les assignés chargés', async () => {
    api({ listTicketPeople: vi.fn(async () => ['Alice Martin']) })
    const { root, container } = await render()

    const options = [...container.querySelectorAll('#tickets-people-list option')].map((option) =>
      option.getAttribute('value')
    )
    expect(options).toContain('Alice Martin') // annuaire Azure
    expect(options).toContain('Équipe RIG') // assignés déjà chargés

    const filter = container.querySelector(
      '[data-testid="tickets-assignee-filter"]'
    ) as HTMLInputElement
    const setFilter = (value: string): void => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(filter, value)
      filter.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await act(async () => setFilter('alice'))
    expect(container.querySelectorAll('[data-testid="ticket-row"]')).toHaveLength(0)
    await act(async () => setFilter('équipe'))
    expect(container.querySelectorAll('[data-testid="ticket-row"]')).toHaveLength(3)
    await act(async () => root.unmount())
  })

  it('trie par défaut sur la mise à jour la plus récente', async () => {
    const listTickets = vi.fn(async () => ({
      items: [item('1'), { ...item('2'), updatedAt: '2026-07-23T18:00:00.000Z' }, item('3')],
      hasMore: false
    }))
    api({ listTickets })
    const { root, container } = await render()

    const firstRow = container.querySelector('[data-testid="ticket-row"]')
    expect(firstRow?.textContent).toContain('#2')
    expect(container.querySelector('[data-testid="tickets-sort"]')).not.toBeNull()
    await act(async () => root.unmount())
  })

  it('affiche RigApplication, tous les types et le détail sélectionné', async () => {
    api()
    const { root, container } = await render()

    expect(container.querySelector('[data-testid="tickets-source"]')?.textContent).toContain(
      'AmitelGTC / RIG / RigApplication'
    )
    expect(container.textContent).toContain('Projet RIG')
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
      const add = container.querySelector('[aria-label="Ajouter une source"]') as HTMLButtonElement
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
      const add = container.querySelector('[aria-label="Ajouter une source"]') as HTMLButtonElement
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

  it('MODE AUTO : cocher n’engage RIEN sur les tickets déjà affichés (amorce)', async () => {
    const orchestrate = vi.fn(async () => ({ ok: true }))
    api({
      roles: vi.fn(async () => ({ orchestrator: { provider: 'claude' } })),
      conversationsCreate: vi.fn(async () => ({ id: 'c' })),
      orchestrate
    })
    const { root, container } = await render()
    const auto = container.querySelector(
      '[data-testid="tickets-mode-auto"] input'
    ) as HTMLInputElement
    await act(async () => {
      auto.click()
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    // Les 3 tickets deja presents ne doivent DECLENCHER AUCUN run.
    expect(orchestrate).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="tickets-auto-status"]')?.textContent).toContain(
      'déjà présents ignorés'
    )
    await act(async () => root.unmount())
  })

  it('MODE AUTO : l’état de la case survit au remontage (persisté)', async () => {
    api()
    const first = await render()
    const auto = first.container.querySelector(
      '[data-testid="tickets-mode-auto"] input'
    ) as HTMLInputElement
    await act(async () => auto.click())
    await act(async () => first.root.unmount())

    api()
    const second = await render()
    const restored = second.container.querySelector(
      '[data-testid="tickets-mode-auto"] input'
    ) as HTMLInputElement
    expect(restored.checked).toBe(true)
    await act(async () => second.root.unmount())
  })
})

describe('vue Tickets — lots automatiques différés', () => {
  afterEach(() => {
    document.body.replaceChildren()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('traite 5 entrants en deux lots successifs de 3 puis 2 sans rafraîchissement', async () => {
    localStorage.setItem('autowin:tickets-auto-mode', '1')
    const conversationsCreate = vi.fn(async ({ title }: { title: string }) => ({
      id: `conv-${title}`
    }))
    api({
      listTickets: vi.fn(async () => ({
        items: [item('1'), item('2'), item('3'), item('4'), item('5')],
        hasMore: false
      })),
      roles: vi.fn(async () => ({ orchestrator: { provider: 'claude' } })),
      conversationsCreate,
      orchestrate: vi.fn(async () => ({ ok: true }))
    })

    const { root } = await render()
    await act(async () => {
      for (let index = 0; index < 20; index += 1) await Promise.resolve()
    })

    expect(conversationsCreate).toHaveBeenCalledTimes(5)
    await act(async () => root.unmount())
  })

  it('ne consomme pas les entrants sans provider puis les lance une seule fois apres configuration', async () => {
    localStorage.setItem('autowin:tickets-auto-mode', '1')
    const roles = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValue({ orchestrator: { provider: 'claude' } })
    const conversationsCreate = vi.fn(async ({ title }: { title: string }) => ({
      id: `conv-${title}`
    }))
    api({
      listTickets: vi.fn(async () => ({ items: [item('1')], hasMore: false })),
      roles,
      conversationsCreate,
      orchestrate: vi.fn(async () => ({ ok: true }))
    })

    const { root } = await render()
    await act(async () => {
      for (let index = 0; index < 10; index += 1) await Promise.resolve()
    })

    expect(conversationsCreate).not.toHaveBeenCalled()
    expect(localStorage.getItem('autowin:tickets-auto-seen')).toBeNull()

    await act(async () => {
      root.render(createElement(TicketsView, { active: false }))
      await Promise.resolve()
    })
    await act(async () => {
      root.render(createElement(TicketsView, { active: true }))
      for (let index = 0; index < 20; index += 1) await Promise.resolve()
    })

    expect(conversationsCreate).toHaveBeenCalledTimes(1)
    await act(async () => root.unmount())
  })

  it('ne consomme pas un ticket si le provider est indisponible ou si le lancement echoue', async () => {
    localStorage.setItem('autowin:tickets-auto-mode', '1')
    const providerStatus = vi
      .fn()
      .mockResolvedValueOnce([{ provider: 'claude', status: 'expired', testable: false }])
      .mockResolvedValue([{ provider: 'claude', status: 'authenticated', testable: false }])
    const orchestrate = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true })
    api({
      listTickets: vi.fn(async () => ({ items: [item('1')], hasMore: false })),
      roles: vi.fn(async () => ({ orchestrator: { provider: 'claude' } })),
      providerStatus,
      conversationsCreate: vi.fn(async () => ({ id: 'conv-ticket' })),
      orchestrate
    })

    const first = await render()
    await act(async () => {
      for (let index = 0; index < 10; index += 1) await Promise.resolve()
    })
    expect(orchestrate).not.toHaveBeenCalled()
    expect(localStorage.getItem('autowin:tickets-auto-seen')).toBeNull()
    await act(async () => first.root.unmount())

    const second = await render()
    await act(async () => {
      for (let index = 0; index < 20; index += 1) await Promise.resolve()
    })
    expect(orchestrate).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('autowin:tickets-auto-seen')).toBeNull()
    await act(async () => second.root.unmount())

    const third = await render()
    await act(async () => {
      for (let index = 0; index < 20; index += 1) await Promise.resolve()
    })
    expect(orchestrate).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem('autowin:tickets-auto-seen')).toContain('::1')
    await act(async () => third.root.unmount())
  })

  it('termine le lot courant mais ne lance pas le lot différé après désactivation', async () => {
    localStorage.setItem('autowin:tickets-auto-mode', '1')
    const pending: Array<(value: { ok: boolean }) => void> = []
    const orchestrate = vi.fn(
      () =>
        new Promise<{ ok: boolean }>((resolve) => {
          pending.push(resolve)
        })
    )
    const conversationsCreate = vi.fn(async ({ title }: { title: string }) => ({
      id: `conv-${title}`
    }))
    api({
      listTickets: vi.fn(async () => ({
        items: [item('1'), item('2'), item('3'), item('4'), item('5')],
        hasMore: false
      })),
      roles: vi.fn(async () => ({ orchestrator: { provider: 'claude' } })),
      conversationsCreate,
      orchestrate
    })

    const { root, container } = await render()
    await act(async () => {
      for (let index = 0; index < 10; index += 1) await Promise.resolve()
    })
    expect(conversationsCreate).toHaveBeenCalledTimes(3)

    const auto = container.querySelector(
      '[data-testid="tickets-mode-auto"] input'
    ) as HTMLInputElement
    await act(async () => auto.click())
    await act(async () => {
      pending.splice(0).forEach((resolve) => resolve({ ok: true }))
      for (let index = 0; index < 10; index += 1) await Promise.resolve()
    })

    expect(conversationsCreate).toHaveBeenCalledTimes(3)
    await act(async () => root.unmount())
  })

  it('décocher « Mode auto » arrête le cycle en cours et affiche le statut arrêté', async () => {
    localStorage.setItem('autowin:tickets-auto-mode', '1')
    const pending: Array<(value: { ok: boolean }) => void> = []
    const orchestrate = vi.fn(
      () =>
        new Promise<{ ok: boolean }>((resolve) => {
          pending.push(resolve)
        })
    )
    const conversationsCreate = vi.fn(async ({ title }: { title: string }) => {
      // Decochage AU 2e item : la case est cherchee au moment de l'appel (le cycle a deja demarre).
      if (conversationsCreate.mock.calls.length === 2) {
        ;(
          document.querySelector('[data-testid="tickets-mode-auto"] input') as HTMLInputElement
        )?.click()
      }
      return { id: `conv-${title}` }
    })
    api({
      listTickets: vi.fn(async () => ({
        items: [item('1'), item('2'), item('3'), item('4'), item('5'), item('6')],
        hasMore: false
      })),
      roles: vi.fn(async () => ({ orchestrator: { provider: 'claude' } })),
      conversationsCreate,
      orchestrate
    })

    const { root, container } = await render()

    await act(async () => {
      for (let index = 0; index < 20; index += 1) await Promise.resolve()
    })
    await act(async () => {
      pending.splice(0).forEach((resolve) => resolve({ ok: true }))
      for (let index = 0; index < 20; index += 1) await Promise.resolve()
    })

    expect(conversationsCreate.mock.calls.length).toBeLessThanOrEqual(3)
    expect(container.querySelector('[data-testid="tickets-auto-status"]')?.textContent).toContain(
      'arrêté'
    )
    await act(async () => root.unmount())
  })
})
