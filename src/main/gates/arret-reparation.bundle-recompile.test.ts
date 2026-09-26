import { describe, expect, it } from 'vitest'
import { arretDeLaReparation } from './stopgate'

/**
 * conv-539, tour 82a4f5d1-d92f-4d73-9f6f-cac70db65ecb (reparations 9 a 18, saisie ts 1789462078031).
 *
 * La mesure de peremption comparait le bundle a la SOURCE. Quand quelqu'un a recompile en cours de
 * tour, `out/main/index.js` est redevenu plus recent que la source (11:46 contre 11:40) : la mesure
 * s'est tue. Mais le processus electron, lance a 11:06, executait toujours l'ANCIEN code charge en
 * memoire. Le juge l'a constate a la reparation 17 (« le blocage invoque n'est deja plus vrai ») alors
 * que le meme refus revenait encore. Un bundle plus recent que le DEMARRAGE du processus est donc
 * lui aussi du code perime : il faut relancer l'application, pas rejouer une reparation.
 */
describe('bundle recompile apres le demarrage de l application', () => {
  const base = {
    tentative: 1,
    reparationsAccordees: 3,
    plafondDur: 24,
    motifsCourants: ['DoD non tenue'],
    motifsPrecedents: []
  }

  it('arrete la boucle en nommant la relance', () => {
    const motif = arretDeLaReparation({
      ...base,
      bundlePerime: { bundleMs: 2_000, sourceMs: 1_000, demarrageMs: 1_500, bundle: 'out/main/index.js' }
    })
    expect(motif).toMatch(/relancer l'application/i)
  })

  it('laisse passer un bundle anterieur au demarrage', () => {
    const motif = arretDeLaReparation({
      ...base,
      bundlePerime: { bundleMs: 2_000, sourceMs: 1_000, demarrageMs: 3_000, bundle: 'out/main/index.js' }
    })
    expect(motif).toBeUndefined()
  })
})
