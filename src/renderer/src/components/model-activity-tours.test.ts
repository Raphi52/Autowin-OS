import { describe, expect, it } from 'vitest'
import { deltaMs, grouperParTour, type ModelActivityTour } from './model-activity-tours'
import type { ModelActivityEntry } from './model-activity-log'

function ligne(part: Partial<ModelActivityEntry>): ModelActivityEntry {
  return {
    id: 'x',
    turnId: 't1',
    kind: 'event',
    label: 'geste',
    source: 'journal',
    ...part
  } as ModelActivityEntry
}

describe('grouperParTour', () => {
  it('numérote les tours dans leur ordre d’apparition et garde leurs lignes', () => {
    const tours = grouperParTour([
      ligne({ id: 'a', turnId: 't1' }),
      ligne({ id: 'b', turnId: 't2' }),
      ligne({ id: 'c', turnId: 't1' })
    ])
    expect(tours.map((tour) => [tour.turnId, tour.index, tour.entries.length])).toEqual([
      ['t1', 1, 2],
      ['t2', 2, 1]
    ])
  })

  it('borne le tour par ses gestes horodatés et en déduit la durée', () => {
    const [tour] = grouperParTour([
      ligne({ id: 'a', at: 1_000 }),
      ligne({ id: 'b' }),
      ligne({ id: 'c', at: 4_500 })
    ])
    expect(tour.debut).toBe(1_000)
    expect(tour.fin).toBe(4_500)
    expect(tour.dureeMs).toBe(3_500)
  })

  it('n’invente aucune heure quand aucun geste n’en porte', () => {
    const [tour] = grouperParTour([ligne({ id: 'a' })])
    expect(tour.debut).toBeUndefined()
    expect(tour.dureeMs).toBeUndefined()
  })

  it('additionne tokens et coût des lignes de facturation, même imbriqués', () => {
    const [tour] = grouperParTour([
      ligne({ id: 'a', kind: 'usage', fields: { totalTokens: 1_200, costUsd: 0.02 } }),
      ligne({ id: 'b', kind: 'usage', fields: { usage: { totalTokens: 800 }, cost: 0.01 } }),
      ligne({ id: 'c', kind: 'text', fields: { totalTokens: 999 } })
    ])
    expect(tour.tokens).toBe(2_000)
    expect(tour.cout).toBeCloseTo(0.03, 6)
  })

  it('laisse tokens et coût absents quand aucune ligne n’en porte', () => {
    const [tour] = grouperParTour([ligne({ id: 'a', kind: 'usage', fields: { model: 'x' } })])
    expect(tour.tokens).toBeUndefined()
    expect(tour.cout).toBeUndefined()
  })

  it('signale le tour en échec dès un geste rouge', () => {
    const [ok, ko] = grouperParTour([
      ligne({ id: 'a', turnId: 't1', ok: true }),
      ligne({ id: 'b', turnId: 't2', ok: false })
    ])
    expect(ok.erreur).toBe(false)
    expect(ko.erreur).toBe(true)
  })
})

describe('deltaMs', () => {
  it('mesure l’écart depuis le début du tour', () => {
    const tour = { debut: 1_000 } as ModelActivityTour
    expect(deltaMs({ at: 3_500 } as ModelActivityEntry, tour)).toBe(2_500)
  })

  it('reste indéfini quand une des deux heures manque', () => {
    expect(deltaMs({} as ModelActivityEntry, { debut: 10 } as ModelActivityTour)).toBeUndefined()
    expect(deltaMs({ at: 10 } as ModelActivityEntry, {} as ModelActivityTour)).toBeUndefined()
  })
})
