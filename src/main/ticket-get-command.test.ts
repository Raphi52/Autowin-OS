import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_TICKET_SOURCE, type TicketItem } from '../shared/tickets'
import { decideTicketGet, getTicketFromCommand } from './ticket-get-command'

/**
 * LE CAS QUI A RÉVÉLÉ LE MANQUE (2026-08-06) : l'agent, à qui on demandait la fiche 1227, a cherché
 * « 1227 » dans les TITRES, n'a rien trouvé, et a conclu que la fiche n'existait pas. Elle existait.
 * Un identifiant s'adresse, il ne se cherche pas textuellement.
 */
const fiche: TicketItem = {
  id: '1227',
  sourceId: DEFAULT_TICKET_SOURCE.id,
  type: 'Fiche Team',
  title: "[REFUS FORMALITE] Mettre en place l'envoi mail automatique",
  state: 'Ouvert',
  url: 'https://dev.azure.com/AmitelGTC/RIG/_workitems/edit/1227',
  updatedAt: '2026-08-06T10:00:00.000Z',
  assignee: 'Emmanuel HEURTIER',
  description: 'Contexte de la demande.',
  relations: [{ kind: 'Duplicate Of', target: '900' }],
  fields: {}
}

describe('decideTicketGet — l’identifiant demandé', () => {
  it('accepte un numéro en chaîne comme en nombre', () => {
    for (const id of ['1227', 1227]) {
      const d = decideTicketGet({ id })
      expect(d.allowed).toBe(true)
      if (d.allowed) expect(d.id).toBe('1227')
    }
  })

  it('tolère les formes usuelles du modèle : #1227, WI 1227, wi-1227', () => {
    for (const id of ['#1227', 'WI 1227', 'wi-1227', 'WI:1227', '  #1227  ']) {
      const d = decideTicketGet({ id })
      expect(d.allowed, `refusé à tort : ${id}`).toBe(true)
      if (d.allowed) expect(d.id).toBe('1227')
    }
  })

  it('REFUSE ce qui n’est pas un numéro, avec un motif qui dit quoi faire', () => {
    for (const id of ['', '   ', 'abc', 'la fiche 1227', '12.5', '-3', '0', '../1', undefined]) {
      const d = decideTicketGet({ id })
      expect(d.allowed, `accepté à tort : ${String(id)}`).toBe(false)
      if (!d.allowed) expect(d.reason).toMatch(/identifiant|num/i)
    }
  })

  it('IGNORE un profil de source fabriqué par le modèle', () => {
    const d = decideTicketGet({
      id: '1227',
      source: { ...DEFAULT_TICKET_SOURCE, organization: 'pirate' },
      sourceId: 'mon-projet'
    })
    expect(d.allowed).toBe(true)
    if (d.allowed) {
      expect(d).not.toHaveProperty('source')
      expect(d.sourceId).toBe('mon-projet')
    }
  })
})

describe('getTicketFromCommand — la fiche rendue', () => {
  const deps = (get?: ReturnType<typeof vi.fn>) => ({
    listSources: () => [DEFAULT_TICKET_SOURCE],
    ...(get ? { get } : {})
  })

  it('rend la fiche avec ses détails et un résumé lisible', async () => {
    const get = vi.fn(async () => fiche)
    const out = await getTicketFromCommand({ id: '1227' }, deps(get))

    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.ticket).toMatchObject({
        id: '1227',
        state: 'Ouvert',
        assignee: 'Emmanuel HEURTIER'
      })
      // Les liens comptent : c'est par eux qu'un doublon se DÉCLARE côté Azure DevOps.
      expect(out.ticket.relations).toEqual([{ kind: 'Duplicate Of', target: '900' }])
      expect(out.summary).toContain('1227')
    }
    expect(get).toHaveBeenCalledWith({ source: DEFAULT_TICKET_SOURCE, id: '1227' })
  })

  it('une fiche introuvable remonte le motif du fournisseur TEL QUEL', async () => {
    const get = vi.fn(async () => {
      throw new Error('Fiche Azure DevOps 999999 introuvable.')
    })
    const out = await getTicketFromCommand({ id: '999999' }, deps(get))

    expect(out.ok).toBe(false)
    // « introuvable » et « accès refusé » ne doivent PAS être aplatis en un même « pas trouvé » :
    // c'est cette confusion qui a produit le diagnostic faux.
    if (!out.ok) expect(out.reason).toContain('introuvable')
  })

  it('un refus d’accès reste distinct d’une absence', async () => {
    const get = vi.fn(async () => {
      throw new Error('401 Unauthorized')
    })
    const out = await getTicketFromCommand({ id: '1227' }, deps(get))
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain('401')
  })

  it('lecture non câblée → refus explicite, pas une exception', async () => {
    const out = await getTicketFromCommand({ id: '1227' }, deps())
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toMatch(/indisponible|configur/i)
  })

  it('plusieurs sources et aucune nommée : REFUS qui liste les ids', async () => {
    const out = await getTicketFromCommand(
      { id: '1227' },
      {
        listSources: () => [
          DEFAULT_TICKET_SOURCE,
          { ...DEFAULT_TICKET_SOURCE, id: 'autre', project: 'Autre' }
        ],
        get: vi.fn()
      }
    )
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toMatch(/plusieurs/i)
  })
})
