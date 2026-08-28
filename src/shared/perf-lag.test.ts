import { describe, expect, it } from 'vitest'
import { resumerJalons, resumerSondeRenderer, SEUIL_SEGMENT_LENT_MS } from './perf-lag'

/**
 * Outillage de mesure des LENTEURS — noyau pur.
 *
 * Il transforme deux sources de faits en un rapport lisible : les jalons de tour ecrits par
 * `turn-timing.ts` (cote main) et une sonde de reactivite du renderer. Rien n'y est devine : un
 * segment est « lent » parce que son p95 depasse un seuil NOMME, pas parce qu'il en a l'air.
 */
describe('resumerJalons', () => {
  const lignes = [
    // Les marques sont CUMULEES depuis le debut du tour : le cout propre d'une etape est la
    // difference avec la precedente. Un rapport qui afficherait la marque brute accuserait
    // `firstToken` de tout, y compris du temps passe avant lui.
    JSON.stringify({ ts: 'a', totalMs: 100, marks: { snapshot: 30, ragBrain: 40 } }),
    JSON.stringify({ ts: 'b', totalMs: 9000, marks: { snapshot: 8000, ragBrain: 8100 } }),
    'ceci-n-est-pas-du-json'
  ]

  it('rend le cout PROPRE de chaque segment, pas la marque cumulee', () => {
    const r = resumerJalons(lignes)
    const rag = r.segments.find((s) => s.nom === 'ragBrain')
    expect(rag?.maxMs).toBe(100) // 8100 - 8000, jamais 8100
    expect(r.tours).toBe(2)
    expect(r.lignesIllisibles).toBe(1)
  })

  it('designe comme SUSPECT le segment dont le p95 depasse le seuil', () => {
    const r = resumerJalons(lignes)
    expect(r.suspects.map((s) => s.nom)).toContain('snapshot')
    expect(r.suspects.map((s) => s.nom)).not.toContain('ragBrain')
    expect(SEUIL_SEGMENT_LENT_MS).toBeGreaterThan(0)
  })

  it('sans aucune ligne, ne rend aucun suspect (jamais un verdict invente)', () => {
    const r = resumerJalons([])
    expect(r.tours).toBe(0)
    expect(r.suspects).toEqual([])
  })
})

describe('resumerSondeRenderer', () => {
  it('mesure le RETARD des ticks, pas leur nombre : un gel de 2 s est vu', () => {
    // Entree qui doit faire echouer un resume qui se contenterait de compter les ticks :
    // 10 ticks attendus toutes les 200 ms, mais un intervalle a 2 200 ms.
    const horodatages = [0, 200, 400, 2600, 2800]
    const r = resumerSondeRenderer({ intervalleMs: 200, horodatages, tachesLongues: [250, 60] })
    expect(r.retardMaxMs).toBe(2000)
    expect(r.gele).toBe(true)
    expect(r.tacheLonguePlusLongueMs).toBe(250)
  })

  it('un renderer fluide n’est PAS declare gele', () => {
    const r = resumerSondeRenderer({
      intervalleMs: 200,
      horodatages: [0, 205, 410, 615],
      tachesLongues: []
    })
    expect(r.gele).toBe(false)
    expect(r.retardMaxMs).toBeLessThan(50)
  })
})
