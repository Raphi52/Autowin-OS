import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'
import { CATALOG } from './commands'

/**
 * `ask` CLOT LE TOUR — et le prompt disait le contraire. Mesuré le 2026-10-10, conv-171 (/draft).
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
  const prompt = buildChatPilotagePrompt(CATALOG)

  it('le paragraphe QUESTION A L’UTILISATEUR dit que `ask` clôt le tour', () => {
    expect(prompt).toMatch(/`ask` CLOT TON TOUR/u)
    expect(prompt).toMatch(/MEME message/u)
    expect(prompt).toMatch(/il n'y a pas de suite/u)
  })

  it('la règle « après une commande tu peux continuer » nomme l’exception', () => {
    expect(prompt).toMatch(/tu peux continuer — SAUF après `ask`/u)
  })

  it('la description de la commande `ask` le dit aussi, au moment de l’appeler', () => {
    const ask = CATALOG.find((commande) => commande.name === 'ask')
    expect(ask?.description).toMatch(/CLOT TON TOUR/u)
    expect(ask?.description).toMatch(/MEME message/u)
  })

  it('le pilote clôt réellement le tour quand une question est posée', () => {
    const source = readFileSync(join(__dirname, 'agent-pilot.ts'), 'utf8')
    expect(source).toMatch(
      /if \(questionPoseeCeTour\) \{[\s\S]{0,1200}emit\(\{\s*kind: 'done'[\s\S]{0,500}?return\s*\}/u
    )
  })
})
