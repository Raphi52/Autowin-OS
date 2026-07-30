import { describe, expect, it } from 'vitest'
import type { TicketItem } from '../../../shared/tickets'
import {
  AUTO_MODE_CAP_PER_CYCLE,
  loadSeen,
  pickIncomingTickets,
  primeSeen,
  saveSeen,
  ticketSeenKey
} from './ticket-auto-mode'

const ticket = (id: string, sourceId = 's1'): TicketItem =>
  ({
    sourceId,
    id,
    type: 'Task',
    title: `T${id}`,
    state: 'Ouvert',
    updatedAt: '2026-07-28T00:00:00.000Z',
    url: `https://x/${id}`
  }) as TicketItem

describe('ticketSeenKey — identite stable', () => {
  it('distingue deux sources qui partagent un id', () => {
    expect(ticketSeenKey(ticket('1', 'azure'))).not.toBe(ticketSeenKey(ticket('1', 'github')))
  })
})

describe('AMORCE (garde-fou 1) — activer le mode auto ne traite RIEN de l’existant', () => {
  it('marque tout l’existant comme vu sans le traiter', () => {
    const existing = [ticket('1'), ticket('2'), ticket('3')]
    const seen = new Set(primeSeen(existing))
    // Immediatement apres l'amorce, aucun ticket n'est « entrant ».
    expect(pickIncomingTickets(existing, seen).toTreat).toEqual([])
  })

  it('sans amorce, 50 tickets deja affiches seraient tous candidats (le piege evite)', () => {
    const many = Array.from({ length: 50 }, (_, i) => ticket(String(i)))
    const withoutPriming = pickIncomingTickets(many, new Set(), 999)
    expect(withoutPriming.toTreat).toHaveLength(50) // ce que l'amorce empeche
  })
})

describe('pickIncomingTickets — ne retraite jamais un ticket connu', () => {
  it('ne retient que les NOUVEAUX', () => {
    const seen = new Set([ticketSeenKey(ticket('1'))])
    const result = pickIncomingTickets([ticket('1'), ticket('2')], seen)
    expect(result.toTreat.map((t) => t.id)).toEqual(['2'])
  })

  it('un ticket traite au cycle N n’est plus candidat au cycle N+1', () => {
    const items = [ticket('1'), ticket('2')]
    const seen = new Set<string>()
    const first = pickIncomingTickets(items, seen)
    for (const key of first.seenAdditions) seen.add(key)
    expect(pickIncomingTickets(items, seen).toTreat).toEqual([])
  })

  it('aucun ticket → aucun traitement', () => {
    expect(pickIncomingTickets([], new Set()).toTreat).toEqual([])
  })
})

describe('CAP PAR CYCLE (garde-fou 3) — un afflux ne devient pas une rafale', () => {
  it('borne le nombre traite par cycle', () => {
    const many = Array.from({ length: 20 }, (_, i) => ticket(String(i)))
    const result = pickIncomingTickets(many, new Set())
    expect(result.toTreat).toHaveLength(AUTO_MODE_CAP_PER_CYCLE)
    expect(result.deferred).toBe(20 - AUTO_MODE_CAP_PER_CYCLE)
  })

  it('traite les reportes au cycle suivant sans rejouer les tickets deja retenus', () => {
    const many = Array.from({ length: 5 }, (_, i) => ticket(String(i)))
    const seen = new Set<string>()
    const first = pickIncomingTickets(many, seen)
    for (const key of first.seenAdditions) seen.add(key)
    const second = pickIncomingTickets(many, seen)

    expect(first.toTreat.map((item) => item.id)).toEqual(['0', '1', '2'])
    expect(second.toTreat.map((item) => item.id)).toEqual(['3', '4'])
    expect(new Set([...first.toTreat, ...second.toTreat].map(ticketSeenKey)).size).toBe(5)
  })

  it('un cap a 0 ou negatif ne traite rien (jamais d’emballement par mauvaise config)', () => {
    const many = [ticket('1'), ticket('2')]
    expect(pickIncomingTickets(many, new Set(), 0).toTreat).toEqual([])
    expect(pickIncomingTickets(many, new Set(), -5).toTreat).toEqual([])
  })
})

describe('registre persiste', () => {
  const memory = (initial?: string) => {
    let value = initial
    return {
      getItem: () => value ?? null,
      setItem: (_k: string, v: string) => {
        value = v
      },
      read: () => value
    }
  }

  it('sauve puis relit le registre (survit au redemarrage)', () => {
    const store = memory()
    saveSeen(store, new Set(['s1::1', 's1::2']))
    expect([...loadSeen(store)].sort()).toEqual(['s1::1', 's1::2'])
  })

  it('registre illisible → registre vide (l’amorce reprend le relais, pas de rafale)', () => {
    expect(loadSeen(memory('{pas du json'))).toEqual(new Set())
    expect(loadSeen(memory('{"objet":true}'))).toEqual(new Set())
  })

  it('borne la taille du registre (pas de croissance sans fin)', () => {
    const store = memory()
    saveSeen(store, new Set(Array.from({ length: 3_000 }, (_, i) => `s1::${i}`)))
    expect(JSON.parse(store.read() as string)).toHaveLength(2_000)
  })

  it('un stockage qui jette (quota) ne casse pas le mode auto', () => {
    const throwing = {
      setItem: () => {
        throw new Error('quota')
      }
    }
    expect(() => saveSeen(throwing, new Set(['a']))).not.toThrow()
  })
})
