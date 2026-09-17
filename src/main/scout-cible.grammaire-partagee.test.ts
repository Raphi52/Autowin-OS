import { describe, expect, it } from 'vitest'
import { enteteCibleManquante, lireCibleScout, sortieScoutAvecCible } from './scout-cible'
import { lireDecisionScout } from '../shared/scout-cible-lecture'

/**
 * DEFAUT MESURE (scout interne, conv-459) : le pipeline lisait `CIBLE: aucune — rien de rentable`
 * comme une piste nommee « aucune » et lancait la phase suivante — un appel payant sur du vide —
 * alors que le mode auto du chat fermait la chaine sur exactement la meme phrase. Meme ecart sur
 * une cible IRREVERSIBLE : accord requis cote chat, aucun garde-fou cote pipeline.
 */
describe('le pipeline lit la ligne CIBLE: comme le mode auto du chat', () => {
  const aucune = 'CIBLE: aucune — rien de rentable\n\n| 1 | 40 | fix | x | y | z |'

  it('« aucune » n’est pas une cible, et l’avertissement est mis en tête', () => {
    expect(lireCibleScout(aucune)).toBeUndefined()
    expect(enteteCibleManquante(aucune)).toMatch(/CIBLE:/)
    expect(sortieScoutAvecCible(aucune).startsWith('## Cible')).toBe(true)
  })

  it('une cible IRREVERSIBLE lève la main au lieu de partir en build', () => {
    const destructrice = 'CIBLE: supprimer la table des runs — POURQUOI: gain de place'
    expect(enteteCibleManquante(destructrice)).toMatch(/IRRÉVERSIBLE/)
  })

  it('une vraie piste passe, justification retirée', () => {
    const bonne = 'CIBLE: la piste 1 — POURQUOI: impact le plus fort'
    expect(lireCibleScout(bonne)).toBe('la piste 1')
    expect(enteteCibleManquante(bonne)).toBeUndefined()
  })

  it('rend la MEME decision que le lecteur du chat, sur les memes textes', () => {
    for (const texte of [
      aucune,
      'CIBLE: rien',
      'CIBLE: la piste 2 — POURQUOI: x',
      'CIBLE: efface le cache'
    ])
      expect(lireDecisionScout(texte).statut).toBe(
        texte.includes('piste 2')
          ? 'cible'
          : texte.includes('efface')
            ? 'cible-destructrice'
            : 'aucune-cible'
      )
  })
})
