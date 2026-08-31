/**
 * DEFAUT VECU (31/08, conv-1569) : sur « relance l'app », l'agent a planifie un script detache qui
 * arretait TOUS les processus electron puis relancait `npm run dev`. Il vit DANS cette app : il a
 * donc tue sa propre session au milieu de son tour. Cote utilisateur : « kaizen t'as plante » — la
 * reponse n'est jamais arrivee, et l'arret large emportait des fenetres etrangeres au travail.
 *
 * Le prompt de pilotage doit porter l'interdit ET l'issue de remplacement (rendre le redemarrage a
 * l'utilisateur), sans quoi rien n'empeche le geste de se rejouer.
 */
import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'

describe('prompt de pilotage — processus hote', () => {
  const prompt = buildChatPilotagePrompt([])

  it('interdit de tuer le processus hote', () => {
    expect(prompt).toMatch(/NE TUE JAMAIS TON PROCESSUS HOTE/)
  })

  it('ferme la porte du differe : detacher le geste ne le rend pas sur', () => {
    expect(prompt).toMatch(/differe[\s\S]{0,120}detache/)
    expect(prompt).toMatch(/differer ne rend pas le geste sur/)
  })

  it('nomme l issue de remplacement : le redemarrage revient a l utilisateur', () => {
    expect(prompt).toMatch(/redemarrage revient a l'utilisateur/)
  })

  it('interdit l arret large d un nom de processus entier', () => {
    expect(prompt).toMatch(/arreter TOUS les processus/)
  })
})
