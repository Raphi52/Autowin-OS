import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_TICKET_SOURCE, type TicketItem } from '../shared/tickets'
import { decideTicketSearch, searchTicketsFromCommand } from './ticket-search-command'

/**
 * COMMANDE AGENT « ticket_search » — la LECTURE, qui manquait.
 *
 * Constaté en réel (2026-08-06) : à qui lui demandait « regarde s'il n'y a pas déjà un autre work
 * item sur ce sujet », l'agent répondait « je n'ai pas d'accès Azure DevOps depuis ici ». C'était
 * EXACT mais trompeur : l'app est parfaitement connectée (canal `tickets:list`, adaptateur Azure,
 * credentials configurés) et l'onglet Tickets affiche la liste. Ce qui manquait, c'était une commande
 * exposant cette lecture à l'agent. Il pouvait `navigate` vers l'onglet — ce qui change seulement ce
 * que l'UTILISATEUR voit — sans jamais pouvoir lire la donnée.
 *
 * Deux règles héritées de `ticket_create`, pour les mêmes raisons :
 *  - le modèle ne fournit JAMAIS un profil de source, seulement au plus un `sourceId` ;
 *  - on ne devine pas le projet quand plusieurs sources existent.
 */
function item(id: string, title: string): TicketItem {
  return {
    id,
    sourceId: DEFAULT_TICKET_SOURCE.id,
    type: 'Fiche Team',
    title,
    state: 'En cours',
    url: `https://dev.azure.com/AmitelGTC/RIG/_workitems/edit/${id}`,
    updatedAt: '2026-08-06T10:00:00.000Z',
    fields: {}
  }
}

describe('decideTicketSearch — ce que l’agent peut demander', () => {
  it('une recherche textuelle suffit', () => {
    const d = decideTicketSearch({ query: 'facture retour' })
    expect(d.allowed).toBe(true)
    if (d.allowed) expect(d.request.titleContains).toBe('facture retour')
  })

  it('lister sans recherche est permis (parcours de la liste)', () => {
    const d = decideTicketSearch({})
    expect(d.allowed).toBe(true)
    if (d.allowed) expect(d.request).not.toHaveProperty('titleContains')
  })

  it('IGNORE un profil de source fabriqué par le modèle — seul un sourceId est écouté', () => {
    const d = decideTicketSearch({
      query: 'x',
      source: { ...DEFAULT_TICKET_SOURCE, organization: 'org-pirate' },
      sourceId: 'mon-projet'
    })
    expect(d.allowed).toBe(true)
    if (d.allowed) {
      expect(d.request).not.toHaveProperty('source')
      expect(d.sourceId).toBe('mon-projet')
    }
  })

  it('borne la taille de page dans une plage utile', () => {
    for (const [demande, attendu] of [
      [0, 1],
      [1, 1],
      [50, 50],
      [100, 100],
      [1000, 100]
    ] as const) {
      const d = decideTicketSearch({ pageSize: demande })
      expect(d.allowed).toBe(true)
      if (d.allowed) expect(d.request.pageSize).toBe(attendu)
    }
  })

  it('une taille de page non numérique retombe sur le défaut, sans échouer', () => {
    for (const pageSize of ['beaucoup', null, {}, NaN]) {
      const d = decideTicketSearch({ pageSize })
      expect(d.allowed).toBe(true)
      if (d.allowed) expect(typeof d.request.pageSize).toBe('number')
    }
  })

  it('REFUSE une recherche démesurée avec un motif lisible', () => {
    const d = decideTicketSearch({ query: 'x'.repeat(500) })
    expect(d.allowed).toBe(false)
    if (!d.allowed) expect(d.reason).toMatch(/recherche/i)
  })
})

describe('searchTicketsFromCommand — le résultat rendu à l’agent', () => {
  const deps = (
    items: TicketItem[]
  ): { listSources: () => typeof DEFAULT_TICKET_SOURCE[]; list: ReturnType<typeof vi.fn> } => ({
    listSources: () => [DEFAULT_TICKET_SOURCE],
    list: vi.fn(async () => ({ items, hasMore: false }))
  })

  it('rend les fiches trouvées, avec leur URL', async () => {
    const d = deps([item('1227', 'Facture retour client')])
    const out = await searchTicketsFromCommand({ query: 'facture' }, d)

    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.items).toHaveLength(1)
      expect(out.items[0]).toMatchObject({ id: '1227', title: 'Facture retour client' })
      expect(out.items[0]?.url).toContain('/_workitems/edit/1227')
    }
    expect(d.list).toHaveBeenCalledWith(
      expect.objectContaining({ source: DEFAULT_TICKET_SOURCE, titleContains: 'facture' })
    )
  })

  it('AUCUN résultat est un résultat, pas une erreur — et le dit sans ambiguïté', async () => {
    const out = await searchTicketsFromCommand({ query: 'introuvable' }, deps([]))

    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.items).toEqual([])
      // Le modèle doit pouvoir conclure « rien trouvé », pas « la recherche a échoué ».
      expect(out.summary).toMatch(/aucun/i)
    }
  })

  it('plusieurs sources et aucune nommée : REFUS qui liste les ids', async () => {
    const out = await searchTicketsFromCommand(
      { query: 'x' },
      {
        listSources: () => [
          DEFAULT_TICKET_SOURCE,
          { ...DEFAULT_TICKET_SOURCE, id: 'autre', project: 'Autre' }
        ],
        list: vi.fn()
      }
    )

    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.reason).toMatch(/plusieurs/i)
      expect(out.reason).toContain('autre')
    }
  })

  it('aucune source configurée : REFUS qui dit quoi faire', async () => {
    const out = await searchTicketsFromCommand(
      { query: 'x' },
      { listSources: () => [], list: vi.fn() }
    )
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toMatch(/aucune source|configur/i)
  })

  it('un échec du fournisseur devient un refus lisible, pas une exception', async () => {
    const out = await searchTicketsFromCommand(
      { query: 'x' },
      {
        listSources: () => [DEFAULT_TICKET_SOURCE],
        list: vi.fn(async () => {
          throw new Error('401 Unauthorized')
        })
      }
    )
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain('401 Unauthorized')
  })

  it('lecture indisponible (non câblée) → refus explicite', async () => {
    const out = await searchTicketsFromCommand(
      { query: 'x' },
      { listSources: () => [DEFAULT_TICKET_SOURCE] }
    )
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toMatch(/indisponible|configur/i)
  })
})
