import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'
import { outilsDuChat } from '../chat/chat-mcp'
import { CATALOG } from '../commands/commands'

/**
 * LE TEXTE QUI ENSEIGNE `ask` NOMMAIT LE /draft… COMME UN CAS D'`ask`.
 *
 * Les appels modèle des tours /draft c7d72274-db73-49bd-93fe-435f6647863a (conv-310),
 * 4c898868-7bfa-4535-8300-c2802e61cf10 (conv-311) et 938a67c1-78bc-4bc5-addf-865167663f44 (conv-312)
 * portaient la procédure « ne pose PAS de bloc ask sous le carrousel ». Mais le paragraphe QUESTION A
 * L'UTILISATEUR, injecté en dernier, disait « un choix entre approches → `ask` » et citait la
 * « galerie de maquettes » comme ce qui accompagne la question ; la description de `ask` aussi.
 * Les trois tours ont fini par un `ask`, sans bloc de choix. Entrée qui DOIT faire rougir :
 * l'exception retirée de la description de `ask`, ou cette description absente du texte servi.
 *
 * Le paragraphe QUESTION A L'UTILISATEUR redisait cette exception : le `ask` d'un /draft est refusé
 * par le code (`askFaitChoisirUneProposition`, prouvé par agent-pilot.draft-sans-ask.test.ts) et la
 * description de `ask` la dit, servie dans la liste des commandes texte du même système (`ask`
 * n'est pas un outil direct). Une seule phrase suffit donc, celle de la description.
 */
describe('le texte de `ask` nomme l’exception /draft', () => {
  it('le texte servi renvoie le choix d’un /draft aux boutons du bloc, une seule fois', () => {
    const outils = outilsDuChat(CATALOG)
    expect(outils).not.toContain('ask')
    for (const prompt of [
      buildChatPilotagePrompt(CATALOG),
      buildChatPilotagePrompt(CATALOG, { outilsDirects: outils })
    ]) {
      expect(prompt).toMatch(
        /propositions d’un \/draft : ce choix passe par les boutons de son bloc/u
      )
      expect(prompt).toMatch(/draft-carrousel\.mjs/u)
      expect(prompt).not.toMatch(/EXCEPTION \/draft/u)
    }
  })

  it('la description de la commande `ask` le dit au moment de l’appeler', () => {
    const ask = CATALOG.find((commande) => commande.name === 'ask')
    expect(ask?.description).toMatch(/\/draft/u)
    expect(ask?.description).toMatch(/boutons de son bloc/u)
  })
})
