import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'

/**
 * SYMPTOME -> FIX AU MOINDRE COUT.
 *
 * Mesure hors-modele, conv-138, appel turnId 1fbd4d70-64fa-4086-80b3-bbf42259edd6 :
 * localiser UNE cause tenant dans un seul fichier a consomme 3 471 481 tokens d'entree,
 * 2,26 $ et 180 741 ms. L'utilisateur ne fournit que des symptomes (saisie ts=1788375433820),
 * donc la consigne doit porter l'escalier de recherche du moins cher au plus cher.
 */
describe('symptome -> fix au moindre cout', () => {
  const prompt = buildChatPilotagePrompt([])

  it('ordonne un escalier de localisation et interdit la lecture d’arbre entier', () => {
    expect(prompt).toContain('SYMPTÔME → FIX, AU MOINDRE COÛT')
    expect(prompt).toContain('grep du texte VISIBLE dans le symptôme')
    expect(prompt).toContain('ARRÊTE-TOI dès que la cause est tenue')
    expect(prompt).toContain("Jamais de lecture d'arbre entier")
    expect(prompt).toContain('DEUX causes candidates')
    expect(prompt).toContain('tu ne lui réclames pas de formulaire')
  })
})
