import { describe, expect, it } from 'vitest'
import { memeRefus } from './stopgate'

/**
 * conv-540, tour 4dfe2821-f6da-4cd9-8cb8-7afba10d3df4, objection du juge en reparation 21 :
 * le repli « du premier « au dernier » » avalait AUSSI le texte situe ENTRE deux citations.
 * Deux refus qui reprochent des choses differentes devenaient alors identiques, et la boucle
 * de reparation pouvait etre coupee sur un refus qui avait reellement change.
 */
describe('memeRefus — texte hors citation', () => {
  it('distingue deux refus dont le texte ENTRE les citations differe', () => {
    expect(
      memeRefus(
        ['Fichier « a.ts » manquant et regle « X » violee'],
        ['Fichier « a.ts » present et regle « X » violee']
      )
    ).toBe(false)
  })

  it('reconnait toujours identiques deux refus a citations imbriquees variables', () => {
    const refus = (interieur: string): string[] => [
      `Promis mais pas fait : « Objection du juge : ${interieur} »`
    ]
    expect(
      refus('le texte dit « pas corrigé » puis « corrigé ».') &&
        memeRefus(
          refus('le texte dit « pas corrigé » puis « corrigé ».'),
          refus('un passage dit « impossible » puis « fait » ; coûteux.')
        )
    ).toBe(true)
  })
})
