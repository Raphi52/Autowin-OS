import { describe, expect, it } from 'vitest'
import { arretDeLaReparation } from './stopgate'

/**
 * conv-539, tour `82a4f5d1-d92f-4d73-9f6f-cac70db65ecb` : 14 reparations consecutives refusees.
 * Cause mesuree : l'application jugeait avec `out/main/index.js` date de 11:06 alors que les
 * correctifs du code principal etaient commites de 11:11 a 11:31 (`grep -c jugeRefuse` = 0 dans le
 * bundle, 2 dans la source). Aucune reparation ne pouvait faire bouger le refus, et RIEN ne le
 * disait : la boucle brulait un build + un panel de juge par passage.
 */
describe('arretDeLaReparation — bundle plus vieux que le code du gate', () => {
  const base = {
    tentative: 1,
    reparationsAccordees: 5,
    plafondDur: 24,
    motifsCourants: ['hook fix-gate: 4 edits de src/main/objections-juge.ts sans cause verifiee'],
    motifsPrecedents: [] as string[]
  }

  it('arrete en NOMMANT le bundle perime quand la source du gate est plus recente', () => {
    const arret = arretDeLaReparation({
      ...base,
      bundlePerime: { bundleMs: 1_000, sourceMs: 2_000, bundle: 'out/main/index.js' }
    })
    expect(arret).toBeDefined()
    expect(arret).toContain('out/main/index.js')
  })

  it('ne change rien quand le bundle est a jour', () => {
    expect(
      arretDeLaReparation({
        ...base,
        bundlePerime: { bundleMs: 3_000, sourceMs: 2_000, bundle: 'out/main/index.js' }
      })
    ).toBeUndefined()
  })
})
