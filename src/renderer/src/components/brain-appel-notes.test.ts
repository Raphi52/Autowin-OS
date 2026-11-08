import { describe, expect, it } from 'vitest'
import type { BrainTrace } from '../../../main/activity/brain-trace-spool'
import { repartirNotesAppel } from './brain-appel-notes'

const candidat = (
  path: string,
  denseCos: number,
  rank: number
): NonNullable<BrainTrace['navigation']>['candidates'][number] => ({
  path,
  denseCos,
  rank,
  type: 'lesson',
  retained: true
})

const trace = (partiel: Partial<BrainTrace>): BrainTrace => ({
  timestamp: '2026-11-08T08:07:00.000Z',
  conversationId: 'conv-a',
  query: 'daily kaizen',
  injectedChars: 0,
  ...partiel
})

describe('repartirNotesAppel', () => {
  it('rien transmis : toutes les notes trouvées sont écartées, avec leur proximité', () => {
    const r = repartirNotesAppel(
      trace({
        point: 'chat-titres-du-tour',
        found: false,
        status: 'found',
        injectedChars: 0,
        navigation: {
          query: 'q',
          minDense: 0,
          candidates: [candidat('a.md', 0.32, 1), candidat('b.md', 0.26, 2)]
        }
      })
    )
    expect(r.transmises).toEqual([])
    expect(r.ecartees).toEqual([
      { path: 'a.md', proximite: 0.32 },
      { path: 'b.md', proximite: 0.26 }
    ])
  })

  it('notes servies connues : seules elles sont transmises, le reste est écarté', () => {
    const r = repartirNotesAppel(
      trace({
        point: 'chat-titres-du-tour',
        found: true,
        injectedChars: 120,
        notes: ['knowledge/a.md', 'perso:knowledge/p.md'],
        navigation: {
          query: 'q',
          minDense: 0,
          candidates: [
            candidat('knowledge\\a.md', 0.51, 1),
            candidat('knowledge/b.md', 0.33, 2),
            { ...candidat('knowledge/c.md', 0.2, 3), retained: false }
          ]
        }
      })
    )
    expect(r.transmises).toEqual([
      { path: 'knowledge/a.md', proximite: 0.51 },
      { path: 'perso:knowledge/p.md' }
    ])
    expect(r.ecartees).toEqual([{ path: 'knowledge/b.md', proximite: 0.33 }])
  })

  it('contenu injecté sans liste de notes : les notes retenues sont celles transmises', () => {
    const r = repartirNotesAppel(
      trace({
        kind: 'automatic',
        injectedChars: 900,
        navigation: { query: 'q', minDense: 0, candidates: [candidat('a.md', 0.6, 1)] }
      })
    )
    expect(r.transmises).toEqual([{ path: 'a.md', proximite: 0.6 }])
    expect(r.ecartees).toEqual([])
  })

  it('aucune navigation : rien à lister', () => {
    expect(repartirNotesAppel(trace({ kind: 'depot' }))).toEqual({ transmises: [], ecartees: [] })
  })
})
