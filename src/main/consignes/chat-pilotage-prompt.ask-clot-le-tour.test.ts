import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'
import { CATALOG } from '../commands/commands'

/**
 * `ask` CLOT LE TOUR — et le prompt disait le contraire. Mesuré le 2026-10-10, (/draft).
 *
 * L'agent a émis `ask` (6 variantes en boutons) suivi de « la galerie suit », comptant reprendre la
 * main pour afficher les maquettes. Mais `agent-pilot.ts` termine le tour dès qu'une question est
 * posée (bloc « UNE QUESTION CLOT LE TOUR ») : l'utilisateur a reçu des boutons sans les maquettes
 * à choisir, et a dû écrire « tu me les as pas mis dans le chat ».
 *
 * Cause localisée : la règle générale « Après une commande tu reçois le résultat [...] et tu peux
 * continuer » était fausse pour `ask`, et la description de `ask` ne disait pas qu'elle clôt le tour.
 * Entrée qui DOIT faire rougir : l'une des deux consignes retirée, OU le pilote qui cesse de clore
 * le tour (la consigne deviendrait fausse dans l'autre sens).
 */
describe('`ask` clôt le tour : tout ce qu’il faut voir va dans le même message', () => {
  // Le chemin courant : outils directs servis, `ask` reste en texte et garde sa description.
  const prompt = buildChatPilotagePrompt(CATALOG, {
    outilsDirects: CATALOG.filter((c) => c.name !== 'ask' && c.name !== 'orchestrate').map(
      (c) => c.name
    )
  })

  // Le paragraphe QUESTION A L'UTILISATEUR a quitté la consigne (revue règle par règle,
  // 2026-11-06) : il redisait la description de `ask`, servie dans la liste des commandes.
  it('la consigne du chat sert la description de `ask`, qui dit qu’elle clôt le tour', () => {
    expect(prompt).toMatch(/- ask\([^)]*\) : [^\n]*`ask` CLOT TON TOUR/u)
    expect(prompt).toMatch(/- ask\([^)]*\) : [^\n]*MEME message/u)
  })

  it('aucune règle ne dit plus qu’on reprend la main après une commande sans exclure `ask`', () => {
    expect(prompt).not.toMatch(/tu peux continuer(?! — SAUF après `ask`)/u)
  })

  it('la description de la commande `ask` le dit aussi, au moment de l’appeler', () => {
    const ask = CATALOG.find((commande) => commande.name === 'ask')
    expect(ask?.description).toMatch(/CLOT TON TOUR/u)
    expect(ask?.description).toMatch(/MEME message/u)
  })

  it('le pilote clôt réellement le tour quand une question est posée', () => {
    const source = readFileSync(join(__dirname, '../agent-pilot/agent-pilot.ts'), 'utf8')
    expect(source).toMatch(
      /if \(etat\.questionPoseeCeTour\) \{[\s\S]{0,1200}emit\(\{\s*kind: 'done'[\s\S]{0,500}?return\s*\}/u
    )
  })
})
