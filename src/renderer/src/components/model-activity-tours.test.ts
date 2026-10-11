import { describe, expect, it } from 'vitest'
import {
  deltaMs,
  grouperParTour,
  grouperSemblables,
  type ModelActivityTour
} from './model-activity-tours'
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

/**
 * LIGNES SEMBLABLES QUI SE SUIVENT (conv-270, 2026-10-11 : « dans les logs groupe les trucs qui se
 * ressemblent qui se suivent »). Mesure sur trois conversations réelles : même nature + même source
 * à la suite, dans un tour, ramène 503 lignes à 284 (conv-259), 272 à 172 (conv-266), 189 à 86
 * (conv-268) — surtout les rafales de « Signe de vie » d'une commande. Exiger le même TITRE en plus
 * ne regroupait que 2 lignes sur 503 : le critère est la nature, pas le texte.
 */
describe('grouperSemblables', () => {
  it('réunit en un groupe les lignes de même nature et de même source qui se suivent', () => {
    const blocs = grouperSemblables([
      ligne({ id: 'a', kind: 'reasoning' }),
      ligne({ id: 'b', kind: 'status', label: 'Bash · git status' }),
      ligne({ id: 'c', kind: 'status', label: 'Bash terminé - 3 s' }),
      ligne({ id: 'd', kind: 'status', label: 'Read · a.ts' }),
      ligne({ id: 'e', kind: 'reasoning' })
    ])
    expect(
      blocs.map((bloc) =>
        bloc.genre === 'ligne' ? bloc.entry.id : bloc.entries.map((entry) => entry.id).join('+')
      )
    ).toEqual(['a', 'b+c+d', 'e'])
  })

  it('donne au groupe l’identifiant de sa première ligne, stable quand la rafale grandit', () => {
    const avant = grouperSemblables([
      ligne({ id: 'b', kind: 'status' }),
      ligne({ id: 'c', kind: 'status' })
    ])
    const apres = grouperSemblables([
      ligne({ id: 'b', kind: 'status' }),
      ligne({ id: 'c', kind: 'status' }),
      ligne({ id: 'd', kind: 'status' })
    ])
    expect(avant[0]).toMatchObject({ genre: 'groupe', id: 'b' })
    expect(apres[0]).toMatchObject({ genre: 'groupe', id: 'b' })
  })

  it('ne réunit pas deux sources différentes, même de même nature', () => {
    const blocs = grouperSemblables([
      ligne({ id: 'a', kind: 'artifact', source: 'thread' }),
      ligne({ id: 'b', kind: 'artifact', source: 'causal' })
    ])
    expect(blocs.map((bloc) => bloc.genre)).toEqual(['ligne', 'ligne'])
  })

  it('ne cache jamais une ligne en échec dans un groupe de lignes réussies', () => {
    const blocs = grouperSemblables([
      ligne({ id: 'a', kind: 'action', ok: true }),
      ligne({ id: 'b', kind: 'action', ok: false }),
      ligne({ id: 'c', kind: 'action', ok: true })
    ])
    expect(blocs.map((bloc) => bloc.genre)).toEqual(['ligne', 'ligne', 'ligne'])
  })

  it('réunit aussi les échecs semblables qui se suivent, entre eux', () => {
    const blocs = grouperSemblables([
      ligne({ id: 'a', kind: 'action', ok: false }),
      ligne({ id: 'b', kind: 'action', ok: false })
    ])
    expect(blocs).toHaveLength(1)
    expect(blocs[0]).toMatchObject({ genre: 'groupe', id: 'a' })
  })

  it('laisse seule une ligne sans voisine semblable, et une liste vide reste vide', () => {
    expect(grouperSemblables([ligne({ id: 'a' })])).toEqual([
      { genre: 'ligne', entry: ligne({ id: 'a' }) }
    ])
    expect(grouperSemblables([])).toEqual([])
  })
})
