import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'
import { CONSTITUTION } from './constitution'

/**
 * SYMPTOME -> FIX AU MOINDRE COUT.
 *
 * Mesure hors-modele, conv-138, appel turnId 1fbd4d70-64fa-4086-80b3-bbf42259edd6 :
 * localiser UNE cause tenant dans un seul fichier a consomme 3 471 481 tokens d'entree,
 * 2,26 $ et 180 741 ms. L'utilisateur ne fournit que des symptomes (saisie ts=1788375433820),
 * donc la consigne doit porter l'escalier de recherche du moins cher au plus cher.
 *
 * DEPLACE le 2026-09-12 : l'escalier vivait dans le prompt de pilotage EN PLUS de
 * SYMPTOME-HARD-GATE de la constitution, injectee dans le MEME prompt systeme — deux
 * protocoles concurrents sur le meme declencheur. La constitution porte desormais l'escalier,
 * et le prompt de pilotage ne doit PAS le redupliquer.
 */
describe('symptome -> fix au moindre cout', () => {
  const prompt = buildChatPilotagePrompt([])

  it('ordonne un escalier de localisation et interdit la lecture d’arbre entier', () => {
    expect(CONSTITUTION).toContain("LOCALISE PAR L'ESCALIER")
    expect(CONSTITUTION).toContain('grep du texte VISIBLE dans le symptôme')
    expect(CONSTITUTION).toContain('ARRÊTE-TOI dès que la cause est tenue')
    expect(CONSTITUTION).toContain("Jamais de lecture d'arbre entier")
    expect(CONSTITUTION).toContain('DEUX causes candidates')
    expect(CONSTITUTION).toContain('pas un formulaire à faire remplir')
  })

  it('ne duplique PAS cet escalier dans le prompt de pilotage', () => {
    expect(prompt).not.toContain('SYMPTÔME → FIX, AU MOINDRE COÛT')
    expect(prompt).not.toContain('grep du texte VISIBLE dans le symptôme')
  })
})
