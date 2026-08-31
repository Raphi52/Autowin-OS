import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'

/**
 * LE MOT DE L'UTILISATEUR CONTRE LA REGLE — le trou qui a coute un tour entier.
 *
 * La regle « ANALYSER, ce n'est pas MODIFIER » existait deja, et avait DEJA ete affinee une premiere
 * fois apres un « scoute src/main/ » parti en `orchestrate`. Elle n'a pas tenu une seconde fois.
 *
 * Mesure conv-9 (2026-08-31), lue dans la retrospective : demande « scout pour trouver les causes des
 * freezes (ne repond pas) pour les /heal » -> `orchestrate` lance -> sous-agent 223 659 ms, ZERO token
 * de sortie, RUN.md `status: red`, aucun livrable ; l'utilisateur coupe et reecrit « RECOMMENCE SANS
 * cette erreur ». Le meme scout, rendu en direct au tour suivant, a produit huit causes classees avec
 * fichier:ligne.
 *
 * Pourquoi la regle d'origine ne suffisait pas : elle classait les demandes par FORME (« demande
 * ouverte sur le code ») et jamais par VOCABULAIRE. Or les mots de l'utilisateur reprennent les noms
 * de phases du pipeline : « scout » se lit alors comme `phase:'scout'`, et le prompt contient par
 * ailleurs une section entiere qui invite a nommer la phase. Deux lectures concurrentes dans un meme
 * prompt laissent le choix au modele.
 *
 * Entree qui DOIT faire rougir ce test : le paragraphe supprime, ou la liste des mots reduite au point
 * de ne plus couvrir « scout ».
 */
describe('chat-pilotage-prompt — le mot « scout » ne commande pas une orchestration', () => {
  it('nomme les MOTS qui ne declenchent pas de pipeline, « scout » en tete', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toMatch(/VOCABULAIRE de la demande ne decide JAMAIS de l'orchestration/u)
    for (const mot of ['scout', 'audit', 'trouve les causes', '/heal']) {
      expect(prompt).toContain(mot)
    }
  })

  it('donne le critere de remplacement : un fichier doit-il changer ?', () => {
    // Interdire sans critere ne fait que deplacer l'hesitation : la regle doit rendre la decision.
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toMatch(/un fichier doit-il\s+changer/u)
  })

  it('porte le COUT mesure, pas seulement l’interdit', () => {
    // Une regle sans consequence chiffree se fait arbitrer par la plus proche voisine.
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toMatch(/attendre des minutes|ne rien rendre du tout/u)
  })

  it('laisse la regle ANALYSER/MODIFIER en place', () => {
    // L'autre bord : ajouter ne doit pas effacer ce qui marchait deja.
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toContain("ANALYSER, ce n'est pas MODIFIER")
    expect(prompt).toContain('orchestrate')
  })
})
