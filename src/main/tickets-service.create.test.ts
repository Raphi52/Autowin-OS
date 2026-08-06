import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_TICKET_SOURCE, type TicketSourceProfile } from '../shared/tickets'
import type { TicketCredentialStore } from './ticket-credential-store'
import type { TicketProviderRegistry } from './ticket-providers/provider-contract'
import type { TicketSourceStore } from './ticket-source-store'
import { TicketService } from './tickets-service'

/**
 * CRÉATION de fiche — action SORTANTE, donc le maillon le plus sensible de la chaîne Tickets : la
 * lecture ne fait que révéler ce que l'utilisateur peut déjà voir, l'écriture crée un objet visible
 * par toute l'équipe, sous l'identité de l'utilisateur.
 *
 * Ce que ces tests verrouillent, et pourquoi :
 *  - le profil de source est AUTORISÉ contre le store, comme pour `list` : sinon un renderer (ou un
 *    agent qui déraille) pourrait créer une fiche dans une organisation Azure arbitraire ;
 *  - le titre est OBLIGATOIRE et borné : une fiche sans titre est un déchet dans le backlog d'équipe,
 *    et un titre de 10 Mo est un déni de service ;
 *  - un fournisseur sans création (GitHub, GitLab) est refusé explicitement, jamais silencieusement.
 */
function fixture() {
  const profiles: TicketSourceProfile[] = [DEFAULT_TICKET_SOURCE]
  const sourceStore = {
    list: vi.fn(() => profiles),
    save: vi.fn(),
    remove: vi.fn()
  } as unknown as TicketSourceStore
  const credentialStore = {
    get: vi.fn(() => null),
    has: vi.fn(() => false),
    delete: vi.fn()
  } as unknown as TicketCredentialStore
  const registry = {
    supports: vi.fn(() => true),
    list: vi.fn(async () => ({ items: [], hasMore: false })),
    create: vi.fn(async () => ({
      id: '4242',
      sourceId: DEFAULT_TICKET_SOURCE.id,
      type: 'Task',
      title: 'Fiche créée',
      state: 'New',
      url: 'https://dev.azure.com/org/proj/_workitems/edit/4242',
      updatedAt: '2026-08-04T15:44:03Z',
      fields: {}
    }))
  } as unknown as TicketProviderRegistry
  return { sourceStore, credentialStore, registry }
}

describe('TicketService.create — écrire chez le fournisseur, sous garde', () => {
  it('crée via le registre et rend la fiche, sans laisser fuir le credential', async () => {
    const deps = fixture()
    const tokenFallback = vi.fn(async () => ({
      token: 'azure-cli-secret',
      authScheme: 'bearer' as const
    }))
    const service = new TicketService({ ...deps, tokenFallback })

    const created = await service.create({
      source: DEFAULT_TICKET_SOURCE,
      title: 'Créer les fiches depuis Autowin',
      description: 'Contexte détaillé.',
      workItemType: 'Task'
    })

    expect(created.id).toBe('4242')
    expect(deps.registry.create).toHaveBeenCalledWith(
      {
        source: DEFAULT_TICKET_SOURCE,
        title: 'Créer les fiches depuis Autowin',
        description: 'Contexte détaillé.',
        workItemType: 'Task'
      },
      { token: 'azure-cli-secret', authScheme: 'bearer' }
    )
    expect(JSON.stringify(created)).not.toContain('azure-cli-secret')
  })

  it('REFUSE un profil forgé, même si son id existe (parade au renderer compromis)', async () => {
    const deps = fixture()
    const service = new TicketService(deps)

    await expect(
      service.create({
        source: { ...DEFAULT_TICKET_SOURCE, organization: 'org-pirate' },
        title: 'Fiche chez quelqu’un d’autre'
      })
    ).rejects.toThrow(/non autoris/i)
    expect(deps.registry.create).not.toHaveBeenCalled()
  })

  it('REFUSE un profil inconnu du store', async () => {
    const deps = fixture()
    const service = new TicketService(deps)

    await expect(
      service.create({ source: { ...DEFAULT_TICKET_SOURCE, id: 'jamais-vu' }, title: 'X' })
    ).rejects.toThrow(/non autoris/i)
    expect(deps.registry.create).not.toHaveBeenCalled()
  })

  it('REFUSE un titre vide ou fait d’espaces — pas de déchet dans le backlog', async () => {
    const deps = fixture()
    const service = new TicketService(deps)

    for (const title of ['', '   ', '\n\t']) {
      await expect(service.create({ source: DEFAULT_TICKET_SOURCE, title })).rejects.toThrow(
        /titre/i
      )
    }
    expect(deps.registry.create).not.toHaveBeenCalled()
  })

  it('REFUSE un titre démesuré, et une description démesurée', async () => {
    const deps = fixture()
    const service = new TicketService(deps)

    await expect(
      service.create({ source: DEFAULT_TICKET_SOURCE, title: 'x'.repeat(1000) })
    ).rejects.toThrow(/titre/i)
    await expect(
      service.create({
        source: DEFAULT_TICKET_SOURCE,
        title: 'Titre correct',
        description: 'y'.repeat(200_000)
      })
    ).rejects.toThrow(/description/i)
  })

  it('REFUSE un type de fiche non plausible (il part dans le chemin de l’URL)', async () => {
    const deps = fixture()
    const service = new TicketService(deps)

    for (const workItemType of ['../../evil', 'Task?x=1', 'a'.repeat(200), '']) {
      await expect(
        service.create({ source: DEFAULT_TICKET_SOURCE, title: 'Titre correct', workItemType })
      ).rejects.toThrow(/type de fiche/i)
    }
    expect(deps.registry.create).not.toHaveBeenCalled()
  })

  it('accepte les types réels d’Azure DevOps, espaces inclus', async () => {
    const deps = fixture()
    const service = new TicketService(deps)

    for (const workItemType of ['Bug', 'Task', 'User Story', 'Product Backlog Item']) {
      await service.create({ source: DEFAULT_TICKET_SOURCE, title: 'Titre correct', workItemType })
    }
    expect(deps.registry.create).toHaveBeenCalledTimes(4)
  })

  it('normalise les bords : titre rogné, champs vides non transmis', async () => {
    const deps = fixture()
    const service = new TicketService(deps)

    await service.create({
      source: DEFAULT_TICKET_SOURCE,
      title: '   Titre à rogner   ',
      description: '   ',
      assignee: ''
    })

    expect(deps.registry.create).toHaveBeenCalledWith(
      { source: DEFAULT_TICKET_SOURCE, title: 'Titre à rogner' },
      expect.anything()
    )
  })

  it('REFUSE un fournisseur non supporté, explicitement', async () => {
    const deps = fixture()
    ;(deps.registry.supports as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false)
    const service = new TicketService(deps)

    await expect(
      service.create({ source: DEFAULT_TICKET_SOURCE, title: 'Titre correct' })
    ).rejects.toThrow(/non support/i)
    expect(deps.registry.create).not.toHaveBeenCalled()
  })

  it('transmet le signal d’annulation au fournisseur', async () => {
    const deps = fixture()
    const service = new TicketService(deps)
    const controller = new AbortController()

    await service.create(
      { source: DEFAULT_TICKET_SOURCE, title: 'Titre correct' },
      controller.signal
    )

    expect(deps.registry.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ signal: controller.signal })
    )
  })
})
