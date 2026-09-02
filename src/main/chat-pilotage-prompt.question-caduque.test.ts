import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'

/**
 * LA QUESTION QUI SURVIT À SA RÉPONSE — mesuré le 2026-09-02, conv-128, tour 2.
 *
 * L'agent appelle `ask` (« quelle option pour le compteur de reprises ? »), puis la lecture du code
 * répond d'elle-même à la question : il continue, corrige la cause et LIVRE, dans le même tour.
 * Mais son message final garde la phrase morte : « Dis-moi laquelle des options ci-dessus et je
 * l'exécute directement » — collée à un résultat déjà livré.
 *
 * Effet mesuré : l'utilisateur ne comprend plus s'il doit répondre ou non, et écrit « je comprend
 * pas résume moi la situation et ce que tu demandes ». Un tour entier perdu (~0,6 $ relevé dans
 * activity/conv-128.jsonl) pour une phrase qui ne valait plus rien.
 *
 * La règle existante ne couvre PAS ce cas : elle dit quand APPELER `ask`, jamais quoi faire d'une
 * question déjà posée que le travail a rendue caduque. Entrée qui DOIT faire rougir : le paragraphe
 * retiré, ou l'obligation de nettoyer le message final affaiblie.
 */
describe('chat-pilotage-prompt — une question à laquelle le travail a répondu est morte', () => {
  it('interdit de rejouer la question dans le message final', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toMatch(/CADUQUE/u)
    expect(prompt).toMatch(/dis-moi laquelle/iu)
  })

  it('nomme le déclencheur : avoir CONTINUÉ à travailler après avoir posé la question', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toMatch(/APRES avoir pose une[\s\S]{0,20}question/iu)
  })

  it('donne le comportement de remplacement, pas seulement l’interdit', () => {
    // Une règle purement négative laisse l'agent sans conduite à tenir.
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toMatch(/ce qui a tranche/iu)
  })

  it('nomme le coût pour l’utilisateur : un tour perdu', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toMatch(/tour perdu/iu)
  })

  it('garde intacte la règle d’appel de `ask`', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toContain('boutons cliquables')
    expect(prompt).toMatch(/valider ce que tu allais faire de toute facon/u)
  })
})
