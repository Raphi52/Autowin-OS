import { describe, expect, it } from 'vitest'
import { memeRefus } from './stopgate'

/**
 * Defaut mesure conv-540, tour 4dfe2821-f6da-4cd9-8cb8-7afba10d3df4 : le refus fix-gate NOMME le
 * nombre d'editions du fichier (« 4 edits » a la reparation 2, « 6 edits » a la reparation 3). Ce
 * nombre est incremente par la boucle de reparation elle-meme a chaque passage : le meme refus ne
 * pouvait donc jamais etre reconnu comme identique, et le compteur de refus fige ne mordait pas.
 */
describe('memeRefus — refus fix-gate dont le nombre d edits grandit', () => {
  it('reconnait deux refus fix-gate identiques sur le meme fichier', () => {
    const avant = ['hook fix-gate: 4 édits de src/main/orchestrator.ts sans cause vérifiée (CausalHypothesis/fix-ok/check:)']
    const apres = ['hook fix-gate: 6 édits de src/main/orchestrator.ts sans cause vérifiée (CausalHypothesis/fix-ok/check:)']
    expect(memeRefus(apres, avant)).toBe(true)
  })

  it('distingue toujours deux fichiers differents', () => {
    const avant = ['hook fix-gate: 4 édits de src/main/orchestrator.ts sans cause vérifiée']
    const apres = ['hook fix-gate: 6 édits de scripts/hdesk-lancer.ps1 sans cause vérifiée']
    expect(memeRefus(apres, avant)).toBe(false)
  })
})
