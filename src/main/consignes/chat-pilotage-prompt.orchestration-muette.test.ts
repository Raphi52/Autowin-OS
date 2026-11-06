import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'

/**
 * LE FIL MUET PENDANT UNE ORCHESTRATION — mesuré le 2026-09-01 dans conv-17.
 *
 * Trace causale du tour `0fb926e9-5e0a-4bf9-ab46-5f66ae57aa10`, séquence 21 : la réponse du modèle
 * pilote est EXCLUSIVEMENT `<cmd>{"name":"orchestrate",…}</cmd>` — 3074 tokens de sortie, aucun
 * caractère hors commande. Pendant que le run travaillait (5 sous-agents, phases think → build,
 * plus de dix minutes), le panneau Graphe se remplissait mais la bulle du fil restait sur
 * « Réflexion… ». Constat utilisateur : « elle bosse comme il faut mais elle m'écrit rien ».
 *
 * La cause n'est PAS un défaut d'affichage : le texte hors `<cmd>` est déjà rendu et streamé. C'est
 * la règle « émets la commande AVANT tout texte visible. N'annonce jamais un lancement » qui, lue au
 * pied de la lettre, produit le silence total — l'interdit d'annoncer un SUCCÈS était compris comme
 * un interdit d'écrire quoi que ce soit.
 *
 * Ce test verrouille la levée d'ambiguïté : l'ORDRE (commande d'abord) reste, mais une ligne de
 * contexte, au présent d'intention, devient OBLIGATOIRE dans le même message. Entrée qui doit faire
 * rougir : le paragraphe supprimé, ou l'interdit de succès re-généralisé à tout texte.
 */
describe('chat-pilotage-prompt — une commande longue n’a pas le droit de laisser le fil muet', () => {
  it('exige une ligne de contexte dans le MÊME message que la commande', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toMatch(/muet|silence/iu)
    expect(prompt, 'la ligne doit être exigée dans le même message que la commande').toMatch(
      /m[êe]me message/iu
    )
  })

  it('distingue l’intention annoncée (autorisée) du succès annoncé (interdit)', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toMatch(/je lance|j'ouvre|je tente/iu)
    // L'autre bord : l'interdit de déclarer un résultat non lu reste entier.
    expect(prompt).toContain('succeeded')
    expect(prompt).toContain('runId')
  })

  it('garde l’ORDRE d’émission : la commande précède le texte', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toContain('AVANT tout texte visible')
  })
})
