import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'
import { CATALOG } from './commands'

/**
 * LE TEXTE QUI ENSEIGNE `ask` NOMMAIT LE /draft… COMME UN CAS D'`ask`.
 *
 * Les appels modèle des tours /draft c7d72274-db73-49bd-93fe-435f6647863a (conv-310),
 * 4c898868-7bfa-4535-8300-c2802e61cf10 (conv-311) et 938a67c1-78bc-4bc5-addf-865167663f44 (conv-312)
 * portaient la procédure « ne pose PAS de bloc ask sous le carrousel ». Mais le paragraphe QUESTION A
 * L'UTILISATEUR, injecté en dernier, disait « un choix entre approches → `ask` » et citait la
 * « galerie de maquettes » comme ce qui accompagne la question ; la description de `ask` aussi.
 * Les trois tours ont fini par un `ask`, sans bloc de choix. Entrée qui DOIT faire rougir : l'une
 * des deux exceptions retirée.
 */
describe('le texte de `ask` nomme l’exception /draft', () => {
  it('le paragraphe QUESTION A L’UTILISATEUR renvoie le choix d’un /draft aux boutons du bloc', () => {
    const prompt = buildChatPilotagePrompt(CATALOG)
    expect(prompt).toMatch(/EXCEPTION \/draft/u)
    expect(prompt).toMatch(/draft-carrousel\.mjs/u)
    expect(prompt).toMatch(/JAMAIS par `ask`/u)
  })

  it('la description de la commande `ask` le dit au moment de l’appeler', () => {
    const ask = CATALOG.find((commande) => commande.name === 'ask')
    expect(ask?.description).toMatch(/\/draft/u)
    expect(ask?.description).toMatch(/boutons de son bloc/u)
  })
})
