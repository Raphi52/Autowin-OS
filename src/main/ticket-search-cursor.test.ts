import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_TICKET_SOURCE, type TicketItem } from '../shared/tickets'
import { searchTicketsFromCommand } from './ticket-search-command'

/**
 * LE CUL-DE-SAC DE PAGINATION — constaté en réel le 2026-08-06, et reproduit au chiffre près.
 *
 * Un agent cherchait le work item 1227 dans un projet qui en compte 780 (id max 1278). Il a conclu
 * « les IDs du projet RIG vont de 1 à 175 » et déclaré la fiche introuvable.
 *
 * Sa conclusion était FAUSSE mais LOGIQUE : l'adaptateur rend bien `cursor: '175'` avec
 * `hasMore: true`, mais la commande agent ne transmettait QUE `hasMore`. Le modèle savait donc qu'il
 * manquait des fiches, sans aucun curseur pour les demander. Mur.
 *
 * Annoncer « il en reste » sans donner le moyen de continuer est pire que de ne rien annoncer : ça
 * pousse le modèle à inventer une conclusion. La règle testée ici : si `hasMore`, alors un `cursor`
 * exploitable DOIT accompagner la réponse.
 */
function item(id: string): TicketItem {
  return {
    id,
    sourceId: DEFAULT_TICKET_SOURCE.id,
    type: 'Fiche Team',
    title: `Fiche ${id}`,
    state: 'Ouvert',
    url: `https://dev.azure.com/AmitelGTC/RIG/_workitems/edit/${id}`,
    updatedAt: '2026-08-06T10:00:00.000Z',
    fields: {}
  }
}

const deps = (page: { items: TicketItem[]; hasMore: boolean; cursor?: string }) => ({
  listSources: () => [DEFAULT_TICKET_SOURCE],
  list: vi.fn(async () => page)
})

describe('ticket_search — la suite de la lecture doit être ATTEIGNABLE', () => {
  it('LE CAS REPRODUIT : hasMore vrai → le curseur est transmis à l’agent', async () => {
    const out = await searchTicketsFromCommand(
      { pageSize: 100 },
      deps({ items: [item('1'), item('175')], hasMore: true, cursor: '175' })
    )

    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.hasMore).toBe(true)
      expect(out.cursor).toBe('175')
      // Le résumé doit DIRE comment continuer, sinon le modèle ne saura pas qu'il peut.
      expect(out.summary).toMatch(/cursor/i)
    }
  })

  it('dernière page : aucun curseur, et le résumé ne promet pas de suite', async () => {
    const out = await searchTicketsFromCommand(
      { pageSize: 100 },
      deps({ items: [item('1278')], hasMore: false })
    )

    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.hasMore).toBe(false)
      expect(out.cursor).toBeUndefined()
      expect(out.summary).not.toMatch(/il en reste/i)
    }
  })

  it('le curseur reçu est bien celui RENVOYÉ par la couche basse, pas déduit', async () => {
    // Garde-fou : déduire « le dernier id vu » serait faux dès que le tri change.
    const out = await searchTicketsFromCommand(
      { pageSize: 2 },
      deps({ items: [item('10'), item('20')], hasMore: true, cursor: '999' })
    )
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.cursor).toBe('999')
  })

  it('le curseur fourni par l’agent est transmis à la couche basse', async () => {
    const d = deps({ items: [], hasMore: false })
    await searchTicketsFromCommand({ cursor: '175' }, d)

    expect(d.list).toHaveBeenCalledWith(expect.objectContaining({ cursor: '175' }))
  })

  it('hasMore sans curseur (couche basse incohérente) ne fabrique pas un faux curseur', async () => {
    const out = await searchTicketsFromCommand(
      {},
      deps({ items: [item('1')], hasMore: true })
    )
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.cursor).toBeUndefined()
  })
})
