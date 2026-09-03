import { describe, it, expect } from 'vitest'
import { extractRecommendation } from './markdown-recommandation'

/**
 * DEFAUT VECU (conv-159, saisie ts=1788413714805) : le mode auto a envoye le mot « Recommandé »
 * tout seul comme ordre — un tour payant pour rien. Cause : la rubrique etait ecrite en TITRE sur
 * sa ligne et son contenu sur la LIGNE SUIVANTE ; l'extraction ne lisait que la ligne du titre et
 * rendait donc le titre lui-meme. Consequence double : le prompt envoye etait du bruit, ET le
 * garde-fou d'arret « recommandation = rien » ne voyait jamais le mot « rien » place en dessous.
 */
describe('extractRecommendation — rubrique sur plusieurs lignes', () => {
  it('lit le contenu de la ligne SUIVANTE quand le titre est nu', () => {
    const texte = ['✅ Fait', 'Commit 6dfe4267.', '', '👉 Recommandé', 'rien'].join('\n')
    expect(extractRecommendation(texte)).toBe('rien')
  })

  it('ne rend JAMAIS le titre comme recommandation', () => {
    const texte = ['👉 Recommandé', '', 'Autre paragraphe.'].join('\n')
    expect(extractRecommendation(texte)).not.toBe('Recommandé')
  })

  it('garde le contenu ecrit sur la meme ligne', () => {
    expect(extractRecommendation('👉 Recommandé : lance le terrain sur X')).toBe(
      'lance le terrain sur X'
    )
  })

  it('ignore la ligne technique du prompt suivant', () => {
    const texte = ['👉 Recommandé', '', 'AUTOWIN_PROMPT_V1: fais autre chose'].join('\n')
    expect(extractRecommendation(texte)).toBeNull()
  })
})
