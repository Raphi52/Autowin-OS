import { describe, expect, it } from 'vitest'
import { CLOSURE_UPSTREAM_REFUSAL, arretDeLaReparation } from './stopgate'

/**
 * conv-539, tour `82a4f5d1-d92f-4d73-9f6f-cac70db65ecb` (turnEvents actionId 5:gate, at=1789463201318) :
 * refus « hook fix-gate: 4 édits de src/main/objections-juge.ts sans cause vérifiée » reçu 2 fois,
 * boucle coupée en rouge alors qu'UNE ligne `fix-ok:` le levait. Un refus fix-gate se lève par une
 * édition de build : il garde un passage de plus que le seuil générique, borné.
 */
describe('réparation — refus fix-gate répété', () => {
  const refus = [
    CLOSURE_UPSTREAM_REFUSAL,
    'hook fix-gate: 4 édits de src/main/objections-juge.ts sans cause vérifiée (CausalHypothesis/fix-ok/check:)'
  ]
  const base = { reparationsAccordees: 2, plafondDur: 24, motifsCourants: refus, motifsPrecedents: refus }

  it('ne coupe pas au 2e refus fix-gate identique (réparable par une ligne)', () => {
    expect(arretDeLaReparation({ ...base, tentative: 2, refusIdentiquesConsecutifs: 2 })).toBeUndefined()
  })

  it('coupe quand même au 3e : le passage supplémentaire reste borné', () => {
    expect(arretDeLaReparation({ ...base, tentative: 3, refusIdentiquesConsecutifs: 3 })).toMatch(/3 fois/)
  })

  it('un refus MIXTE (fix-gate + motif non réparable) ne gagne pas de passage', () => {
    const mixte = [...refus, 'Promis mais pas fait : 1 point(s) annoncé(s) au départ ne sont pas faits.']
    expect(
      arretDeLaReparation({ ...base, motifsCourants: mixte, motifsPrecedents: mixte, tentative: 2, refusIdentiquesConsecutifs: 2 })
    ).toMatch(/2 fois/)
  })
})
