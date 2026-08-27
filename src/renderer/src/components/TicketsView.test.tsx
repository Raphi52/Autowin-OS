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

  it('charge 75 fiches par défaut et sait trier par ID décroissant', async () => {
    // Le parametre est DECLARE (meme s'il n'est pas lu ici) : sans lui, `vi.fn` deduit un tuple
    // d'arguments VIDE et `mock.calls[0][0]` ne compile pas (TS2493) — l'assertion sur `pageSize`
    // porte precisement sur cet argument. Meme forme qu'a la ligne 421 de ce fichier.
    const listTickets = vi.fn(async (_requete: { pageSize?: number }): Promise<TicketPage> => ({
      items: [item('1'), item('2'), item('3')],
      hasMore: false
    }))
    api({ listTickets })
    const { root, container } = await render()

    // La FENÊTRE demandée au fournisseur : trop petite, elle cachait les fiches récentes.
    expect(listTickets.mock.calls[0]?.[0]).toMatchObject({ pageSize: 75 })

    const sort = container.querySelector('[data-testid="tickets-sort"]') as HTMLSelectElement
    await act(async () => {
      sort.value = 'id-desc'
      sort.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })
    const ids = [...container.querySelectorAll('[data-testid="ticket-row"]')].map(
      (row) => row.querySelector('.tickets-id')?.textContent
    )
    expect(ids).toEqual(['#3', '#2', '#1'])

    root.unmount()
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

  it('expose un title dynamique sur le bouton de sélection globale', async () => {
    api()
    const { root, container } = await render()
    const selectAll = container.querySelector(
      '[data-testid="tickets-select-all"]'
    ) as HTMLButtonElement

    expect(selectAll.getAttribute('title')).toBe('Tout sélectionner (3)')
    await act(async () => selectAll.click())
    expect(selectAll.getAttribute('title')).toBe('Tout désélectionner')
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

  it('relit les fiches sélectionnées avant de préparer le prompt', async () => {
    api({
      roles: vi.fn(async () => ({ orchestrator: { provider: 'claude' } })),
      conversationsCreate: vi.fn(async () => ({ id: 'conv-enriched' })),
      appCommand: vi.fn(async () => ({ ok: true })),
      getTicket: vi.fn(async ({ id }: { id: string }) => ({
        ...item(id),
        comments: [{ author: 'Alice', text: 'Décision issue de la discussion distante.' }]
      }))
    })
    const prompts: string[] = []
    const listener = (event: Event): void => {
      void prompts.push((event as CustomEvent<{ prompt: string }>).detail.prompt)
    }
    window.addEventListener('autowin:prefill-conversation', listener)
    const { root, container } = await render()
    const checks = container.querySelectorAll<HTMLInputElement>(
      '[data-testid="ticket-process-checkbox"]'
    )
    await act(async () => checks[0].click())
    await act(async () => {
      ;(
        container.querySelector('[data-testid="tickets-treat-selection"]') as HTMLButtonElement
      ).click()
      for (let index = 0; index < 20; index += 1) await Promise.resolve()
    })

    expect(prompts[0]).toContain('Décision issue de la discussion distante.')
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
    const retry = container.querySelector('[data-testid="tickets-retry"]') as HTMLButtonElement
    expect(retry.getAttribute('title')).toBe('Réessayer le chargement des tickets')
    await act(async () => {
      retry.click()
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
    const retry = container.querySelector('[data-testid="tickets-retry"]') as HTMLButtonElement
    expect(retry.getAttribute('title')).toBe('Réessayer le chargement des tickets')
    await act(async () => {
      retry.click()
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

  it('expose aria-label et title sur le bouton actualiser', async () => {
    api()
    const { root, container } = await render()
    const btn = container.querySelector('[data-testid="tickets-refresh"]') as HTMLButtonElement
    expect(btn.getAttribute('aria-label')).toBe('Actualiser les tickets')
    expect(btn.getAttribute('title')).toBe('Actualiser les tickets')
    await act(async () => root.unmount())
  })

  it('expose aria-label et title sur le bouton enregistrer la source', async () => {
    api()
    const { root, container } = await render()
    await act(async () => {
      const add = container.querySelector('[aria-label="Ajouter une source"]') as HTMLButtonElement
      add.click()
    })
    const btn = container.querySelector('[aria-label="Enregistrer la source"]') as HTMLButtonElement
    expect(btn).not.toBeNull()
    expect(btn.getAttribute('aria-label')).toBe('Enregistrer la source')
    expect(btn.getAttribute('title')).toBe('Enregistrer la source')
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

/**
 * Reprise PERSISTÉE du mode auto : la première page non vide est AMORCÉE (marquée vue, non
 * traitée). Ces scénarios injectent donc leurs entrants par un rafraîchissement, après l'amorce.
 */
async function refreshList(container: HTMLElement, ticks = 20): Promise<void> {
  await act(async () => {
    ;(container.querySelector('[data-testid="tickets-refresh"]') as HTMLButtonElement).click()
    for (let index = 0; index < ticks; index += 1) await Promise.resolve()
  })
}

describe('vue Tickets — lots automatiques différés', () => {
  afterEach(() => {
    document.body.replaceChildren()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('traite 5 entrants en deux lots successifs de 3 puis 2 dans le MÊME cycle', async () => {
    localStorage.setItem('autowin:tickets-auto-mode', '1')
    const conversationsCreate = vi.fn(async ({ title }: { title: string }) => ({
      id: `conv-${title}`
    }))
    let page = [item('0')]
    api({
      listTickets: vi.fn(async () => ({ items: [...page], hasMore: false })),
      roles: vi.fn(async () => ({ orchestrator: { provider: 'claude' } })),
      conversationsCreate,
      orchestrate: vi.fn(async () => ({ ok: true }))
    })

    const { root, container } = await render()
    await act(async () => {
      for (let index = 0; index < 20; index += 1) await Promise.resolve()
    })
    // Amorce : le ticket déjà présent n'engage rien.
    expect(conversationsCreate).not.toHaveBeenCalled()

    page = [item('0'), item('1'), item('2'), item('3'), item('4'), item('5')]
    await refreshList(container)

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
    let page = [item('0')]
    api({
      listTickets: vi.fn(async () => ({ items: [...page], hasMore: false })),
      roles,
      conversationsCreate,
      orchestrate: vi.fn(async () => ({ ok: true }))
    })

    const { root, container } = await render()
    await act(async () => {
      for (let index = 0; index < 10; index += 1) await Promise.resolve()
    })

    // Un entrant arrive alors qu'AUCUN rôle n'est configuré : rien ne doit être consommé.
    page = [item('0'), item('1')]
    await refreshList(container, 10)
    expect(conversationsCreate).not.toHaveBeenCalled()
    expect(localStorage.getItem('autowin:tickets-auto-seen')).not.toContain('::1')

    await refreshList(container)

    expect(conversationsCreate).toHaveBeenCalledTimes(1)
    await act(async () => root.unmount())
  })

  it('ne consomme pas sans provider mais ne REPAYE jamais un lancement deja tente', async () => {
    localStorage.setItem('autowin:tickets-auto-mode', '1')
    const providerStatus = vi
      .fn()
      .mockResolvedValueOnce([{ provider: 'claude', status: 'expired', testable: false }])
      .mockResolvedValue([{ provider: 'claude', status: 'authenticated', testable: false }])
    const orchestrate = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true })
    let page = [item('0')]
    api({
      listTickets: vi.fn(async () => ({ items: [...page], hasMore: false })),
      roles: vi.fn(async () => ({ orchestrator: { provider: 'claude' } })),
      providerStatus,
      conversationsCreate: vi.fn(async () => ({ id: 'conv-ticket' })),
      orchestrate
    })

    const { root, container } = await render()
    await act(async () => {
      for (let index = 0; index < 10; index += 1) await Promise.resolve()
    })

    // Entrant vu alors que le provider est expiré : rien n'est consommé, rien n'est marqué.
    page = [item('0'), item('1')]
    await refreshList(container, 10)
    expect(orchestrate).not.toHaveBeenCalled()
    expect(localStorage.getItem('autowin:tickets-auto-seen')).not.toContain('::1')

    await refreshList(container)
    expect(orchestrate).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('autowin:tickets-auto-seen')).toContain('::1')

    // Le lancement a échoué (ok:false) : il ne doit JAMAIS être repayé au cycle suivant.
    await refreshList(container)
    expect(orchestrate).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('autowin:tickets-auto-seen')).toContain('::1')
    await act(async () => root.unmount())
  })

  it('affiche et rouvre la conversation liee a un ticket prepare', async () => {
    const appCommand = vi.fn(async () => ({ ok: true }))
    api({
      roles: vi.fn(async () => ({ orchestrator: { provider: 'claude' } })),
      conversationsCreate: vi.fn(async () => ({ id: 'conv-ticket-1' })),
      appCommand
    })
    const opened: string[] = []
    const listener = (event: Event): void => {
      void opened.push((event as CustomEvent<string>).detail)
    }
    window.addEventListener('autowin:open-conversation', listener)
    const { root, container } = await render()
    const checks = container.querySelectorAll<HTMLInputElement>(
      '[data-testid="ticket-process-checkbox"]'
    )
    await act(async () => checks[0].click())
    await act(async () => {
      ;(
        container.querySelector('[data-testid="tickets-treat-selection"]') as HTMLButtonElement
      ).click()
      for (let index = 0; index < 10; index += 1) await Promise.resolve()
    })

    const badge = container.querySelector(
      '[data-testid="ticket-treatment-status"]'
    ) as HTMLButtonElement
    expect(badge.textContent).toContain('prêt')
    await act(async () => badge.click())
    expect(appCommand).toHaveBeenCalledWith('navigate', { tab: 'chat' })
    expect(opened).toContain('conv-ticket-1')

    window.removeEventListener('autowin:open-conversation', listener)
    await act(async () => root.unmount())
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
    let page = [item('0')]
    api({
      listTickets: vi.fn(async () => ({ items: [...page], hasMore: false })),
      roles: vi.fn(async () => ({ orchestrator: { provider: 'claude' } })),
      conversationsCreate,
      orchestrate
    })

    const { root, container } = await render()
    await act(async () => {
      for (let index = 0; index < 10; index += 1) await Promise.resolve()
    })
    page = [item('0'), item('1'), item('2'), item('3'), item('4'), item('5')]
    await refreshList(container, 10)
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
    let page = [item('0')]
    api({
      listTickets: vi.fn(async () => ({ items: [...page], hasMore: false })),
      roles: vi.fn(async () => ({ orchestrator: { provider: 'claude' } })),
      conversationsCreate,
      orchestrate
    })

    const { root, container } = await render()

    await act(async () => {
      for (let index = 0; index < 20; index += 1) await Promise.resolve()
    })
    page = [item('0'), item('1'), item('2'), item('3'), item('4'), item('5'), item('6')]
    await refreshList(container)
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
  it('enrichit le ticket affiché par défaut, sans clic et sans rafale (P1-3)', async () => {
    const getTicket = vi.fn(async () => ({
      ...item('1'),
      comments: [{ author: 'Alice', text: 'commentaire réel' }]
    }))
    api({
      listTickets: vi.fn(async (): Promise<TicketPage> => ({ items: [item('1')], hasMore: false })),
      getTicket
    })
    const { root, container } = await render()
    await act(async () => {
      for (let index = 0; index < 5; index += 1) await Promise.resolve()
    })
    expect(getTicket).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('commentaire réel')
    await act(async () => {
      root.render(createElement(TicketsView, { active: true }))
      await Promise.resolve()
    })
    expect(getTicket).toHaveBeenCalledTimes(1)
    await act(async () => root.unmount())
  })

  it('publie un compte-rendu COPIÉ sur la fiche après un traitement auto réussi (P1-1)', async () => {
    localStorage.setItem('autowin:tickets-auto-mode', '1')
    const updateTicket = vi.fn(async (_request: unknown) => item('1'))
    let page = [item('0')]
    api({
      listTickets: vi.fn(async (): Promise<TicketPage> => ({ items: [...page], hasMore: false })),
      roles: vi.fn(async () => ({ orchestrator: { provider: 'claude' } })),
      conversationsCreate: vi.fn(async () => ({ id: 'conv-77' })),
      orchestrate: vi.fn(async () => ({ ok: true })),
      updateTicket
    })
    const { root, container } = await render()
    await act(async () => {
      for (let index = 0; index < 30; index += 1) await Promise.resolve()
    })
    expect(updateTicket).not.toHaveBeenCalled()

    page = [item('0'), item('1')]
    await refreshList(container, 30)
    expect(updateTicket).toHaveBeenCalledTimes(1)
    const request = updateTicket.mock.calls[0][0] as Record<string, unknown>
    expect(request.id).toBe('1')
    expect(String(request.comment)).toContain('conv-77')
    expect(request.state).toBeUndefined()
    expect(request.assignee).toBeUndefined()
    await act(async () => root.unmount())
  })

  it('affiche « interrompu » pour un record running orphelin au montage (P1-2)', async () => {
    localStorage.setItem(
      'autowin:tickets-treatment-records',
      JSON.stringify({
        [`${DEFAULT_TICKET_SOURCE.id}::1`]: {
          conversationId: 'conv-1',
          status: 'running',
          updatedAt: '2026-08-01T10:00:00.000Z'
        }
      })
    )
    api({
      listTickets: vi.fn(async (): Promise<TicketPage> => ({ items: [item('1')], hasMore: false }))
    })
    const { root, container } = await render()
    const badge = container.querySelector('[data-testid="ticket-treatment-status"]')
    expect(badge?.textContent).toBe('interrompu')
    await act(async () => root.unmount())
  })

  it('rend un état vide même quand la page suivante existe, en gardant « Charger la suite » (P2-4)', async () => {
    api({
      listTickets: vi.fn(async (): Promise<TicketPage> => ({
        items: [],
        hasMore: true,
        cursor: 'c2'
      }))
    })
    const { root, container } = await render()
    expect(container.querySelector('[data-testid="tickets-empty"]')?.textContent).toContain(
      'Aucun ticket'
    )
    expect(container.querySelector('.tickets-load-more')?.textContent).toContain('Charger la suite')
    await act(async () => root.unmount())
  })

  it('nomme la cause du vide (recherche serveur) et offre de l’effacer (P2-5)', async () => {
    const listTickets = vi
      .fn()
      .mockResolvedValueOnce({ items: [item('1')], hasMore: false })
      .mockResolvedValueOnce({ items: [], hasMore: false })
      .mockResolvedValue({ items: [item('1')], hasMore: false })
    api({ listTickets })
    const { root, container } = await render()
    const search = container.querySelector(
      '[aria-label="Rechercher les tickets"]'
    ) as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, 'zzz')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      ;(
        container.querySelector('[data-testid="tickets-search-server"]') as HTMLButtonElement
      ).click()
      await Promise.resolve()
      await Promise.resolve()
    })
    const empty = container.querySelector('[data-testid="tickets-empty"]') as HTMLElement
    expect(empty.textContent).toContain('zzz')
    const clear = container.querySelector(
      '[data-testid="tickets-empty-clear"]'
    ) as HTMLButtonElement
    expect(clear).not.toBeNull()
    await act(async () => {
      clear.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(listTickets).toHaveBeenCalledTimes(3)
    await act(async () => root.unmount())
  })

  it('signale un rafraîchissement en cours sur une liste déjà chargée (P2-6)', async () => {
    let release: ((page: TicketPage) => void) | undefined
    const listTickets = vi
      .fn()
      .mockResolvedValueOnce({ items: [item('1')], hasMore: true, cursor: 'c2' })
      .mockImplementationOnce(
        () =>
          new Promise<TicketPage>((resolve) => {
            release = resolve
          })
      )
    api({ listTickets })
    const { root, container } = await render()
    await act(async () => {
      ;(container.querySelector('[data-testid="tickets-refresh"]') as HTMLButtonElement).click()
      await Promise.resolve()
    })
    expect(container.querySelector('[data-testid="tickets-refreshing"]')).not.toBeNull()
    await act(async () => {
      release?.({ items: [item('1')], hasMore: false })
      await Promise.resolve()
    })
    expect(container.querySelector('[data-testid="tickets-refreshing"]')).toBeNull()
    await act(async () => root.unmount())
  })

  it('rend visible une erreur de pagination sans dépendre de stale (P2-6)', async () => {
    const listTickets = vi
      .fn()
      .mockResolvedValueOnce({ items: [item('1')], hasMore: true, cursor: 'c2' })
      .mockRejectedValueOnce(new Error('Page suivante refusée.'))
    api({ listTickets })
    const { root, container } = await render()
    await act(async () => {
      ;(container.querySelector('.tickets-load-more') as HTMLButtonElement).click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(container.querySelector('[data-testid="tickets-stale"]')?.textContent).toContain(
      'Page suivante refusée'
    )
    await act(async () => root.unmount())
  })

  it('annonce que compteurs et filtres portent sur la PAGE chargée (P2-7)', async () => {
    api()
    const { root, container } = await render()
    expect(container.querySelector('[data-testid="tickets-stats"]')?.textContent).toContain(
      'page chargée'
    )
    const type = container.querySelector('[aria-label="Filtrer par type"]') as HTMLSelectElement
    expect(type.getAttribute('title')).toContain('page chargée')
    expect(type.options.length).toBe(3)
    await act(async () => root.unmount())
  })

  it('navigue au clavier ↑/↓ et expose aria-selected sur la ligne active (P3-9)', async () => {
    api()
    const { root, container } = await render()
    const list = container.querySelector('.tickets-list') as HTMLElement
    const rows = (): Element[] => [...container.querySelectorAll('[data-testid="ticket-row"]')]
    expect(rows()[0].getAttribute('aria-selected')).toBe('true')
    await act(async () => {
      list.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
      )
    })
    expect(rows()[1].getAttribute('aria-selected')).toBe('true')
    expect(rows()[0].getAttribute('aria-selected')).toBe('false')
    await act(async () => {
      list.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
      )
    })
    expect(rows()[0].getAttribute('aria-selected')).toBe('true')
    await act(async () => root.unmount())
  })
})

describe('vue Tickets — reprise persistée du mode auto (P1)', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })
  afterEach(() => {
    document.body.replaceChildren()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('MODE AUTO persisté : la page déjà présente est AMORCÉE, seul l’entrant est traité', async () => {
    localStorage.setItem('autowin:tickets-auto-mode', '1')
    const existing = Array.from({ length: 50 }, (_, index) => item(String(index + 100)))
    let page = existing
    const orchestrate = vi.fn(async () => ({ ok: true }))
    api({
      listTickets: vi.fn(async () => ({ items: [...page], hasMore: false })),
      roles: vi.fn(async () => ({ orchestrator: { provider: 'claude' } })),
      conversationsCreate: vi.fn(async ({ title }: { title: string }) => ({ id: `conv-${title}` })),
      orchestrate
    })

    const { root, container } = await render()
    await act(async () => {
      for (let index = 0; index < 30; index += 1) await Promise.resolve()
    })
    // Reprise persistée : les 50 tickets DEJA la sont « vus », jamais traites.
    expect(orchestrate).not.toHaveBeenCalled()

    page = [item('999'), ...existing]
    await act(async () => {
      ;(container.querySelector('[data-testid="tickets-refresh"]') as HTMLButtonElement).click()
      for (let index = 0; index < 30; index += 1) await Promise.resolve()
    })
    expect(orchestrate).toHaveBeenCalledTimes(1)
    await act(async () => root.unmount())
  })
})

describe('vue Tickets — enrichissement mémoïsé et borné (P3)', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })
  afterEach(() => {
    document.body.replaceChildren()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('3 clics sur le même ticket → une SEULE relecture distante', async () => {
    const getTicket = vi.fn(async ({ id }: { id: string }) => ({
      ...item(id),
      comments: [{ author: 'Alice', text: 'discussion' }]
    }))
    api({ getTicket })
    const { root, container } = await render()
    const row = container.querySelector('[data-testid="ticket-row"]') as HTMLElement
    for (let click = 0; click < 3; click += 1) {
      await act(async () => {
        row.click()
        for (let index = 0; index < 10; index += 1) await Promise.resolve()
      })
    }
    expect(getTicket).toHaveBeenCalledTimes(1)
    await act(async () => root.unmount())
  })

  it('clic → refresh léger → sélection : réutilise la FICHE enrichie, pas seulement son id', async () => {
    const getTicket = vi.fn(async ({ id }: { id: string }) => ({
      ...item(id),
      comments: [{ author: 'Alice', text: 'Décision enrichie conservée après refresh.' }]
    }))
    api({
      getTicket,
      roles: vi.fn(async () => ({ orchestrator: { provider: 'claude' } })),
      conversationsCreate: vi.fn(async () => ({ id: 'conv-cache' })),
      appCommand: vi.fn(async () => ({ ok: true }))
    })
    const prompts: string[] = []
    const listener = (event: Event): void => {
      prompts.push((event as CustomEvent<{ prompt: string }>).detail.prompt)
    }
    window.addEventListener('autowin:prefill-conversation', listener)
    const { root, container } = await render()

    await act(async () => {
      ;(container.querySelector('[data-testid="ticket-row"]') as HTMLElement).click()
      for (let index = 0; index < 10; index += 1) await Promise.resolve()
    })
    await refreshList(container)
    await act(async () => {
      ;(
        container.querySelector('[data-testid="ticket-process-checkbox"]') as HTMLInputElement
      ).click()
      ;(
        container.querySelector('[data-testid="tickets-treat-selection"]') as HTMLButtonElement
      ).click()
      for (let index = 0; index < 20; index += 1) await Promise.resolve()
    })

    expect(getTicket).toHaveBeenCalledTimes(1)
    expect(prompts[0]).toContain('Décision enrichie conservée après refresh.')
    window.removeEventListener('autowin:prefill-conversation', listener)
    await act(async () => root.unmount())
  })

  it('deux demandes simultanées de la même fiche partagent la même Promise distante', async () => {
    let resolveTicket!: (value: TicketItem) => void
    const getTicket = vi.fn(
      ({ id }: { id: string }) =>
        new Promise<TicketItem>((resolve) => {
          resolveTicket = resolve
          void id
        })
    )
    api({ getTicket })
    const { root, container } = await render()
    const row = container.querySelector('[data-testid="ticket-row"]') as HTMLElement

    await act(async () => {
      row.click()
      row.click()
      await Promise.resolve()
    })
    expect(getTicket).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolveTicket({ ...item('1'), comments: [{ text: 'résultat partagé' }] })
      for (let index = 0; index < 10; index += 1) await Promise.resolve()
    })

    await act(async () => root.unmount())
  })

  it('sélection de 30 tickets → au plus `concurrency` relectures en vol', async () => {
    let inflight = 0
    let peak = 0
    const getTicket = vi.fn(async ({ id }: { id: string }) => {
      inflight += 1
      peak = Math.max(peak, inflight)
      for (let index = 0; index < 5; index += 1) await Promise.resolve()
      inflight -= 1
      return { ...item(id), comments: [{ author: 'A', text: 'c' }] }
    })
    api({
      listTickets: vi.fn(async () => ({
        items: Array.from({ length: 30 }, (_, index) => item(String(index + 1))),
        hasMore: false
      })),
      roles: vi.fn(async () => ({ orchestrator: { provider: 'claude' } })),
      conversationsCreate: vi.fn(async () => ({ id: 'conv-sel' })),
      appCommand: vi.fn(async () => ({ ok: true })),
      getTicket
    })
    const { root, container } = await render()
    await act(async () => {
      ;(container.querySelector('[data-testid="tickets-select-all"]') as HTMLButtonElement).click()
    })
    await act(async () => {
      ;(
        container.querySelector('[data-testid="tickets-treat-selection"]') as HTMLButtonElement
      ).click()
      for (let index = 0; index < 200; index += 1) await Promise.resolve()
    })
    expect(getTicket).toHaveBeenCalledTimes(30)
    expect(peak).toBeLessThanOrEqual(3)
    await act(async () => root.unmount())
  })
})
