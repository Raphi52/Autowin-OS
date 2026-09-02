/**
 * DEFAUT VECU (31/08, conv-1569) : sur « relance l'app », l'agent a planifie un script detache qui
 * arretait TOUS les processus electron puis relancait `npm run dev`. Il vit DANS cette app : il a
 * donc tue sa propre session au milieu de son tour. Cote utilisateur : « kaizen t'as plante » — la
 * reponse n'est jamais arrivee, et l'arret large emportait des fenetres etrangeres au travail.
 *
 * Le prompt de pilotage doit porter l'interdit ET l'issue de remplacement, sans quoi rien n'empeche
 * le geste de se rejouer.
 *
 * CORRECTION (02/09, conv-103) : l'issue de remplacement etait « le redemarrage revient a
 * l'utilisateur ». Depuis l'arrivee de `restart_app` (redemarrage par le lanceur officiel + consigne
 * de reprise rejouee dans la conversation), cette issue est FAUSSE : l'utilisateur a mesure la gene
 * (« ca doit jamais me dire de redemarer l'app, ca doit le faire »). L'agent redemarre donc lui-meme,
 * et ne rend la main que si `restart_app` se declare indisponible.
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

  it('nomme l issue de remplacement : redemarrer SOI-MEME avec restart_app', () => {
    expect(prompt).toMatch(/tu le FAIS toi-meme avec `restart_app`/)
    expect(prompt).toMatch(/consigne de reprise/)
  })

  it('interdit de renvoyer le redemarrage a l utilisateur en cloture', () => {
    expect(prompt).toMatch(/NE DEMANDE JAMAIS a l'utilisateur de relancer l'app/)
    expect(prompt).toMatch(/Ctrl\+R[\s\S]{0,80}est un ECHEC/)
  })

  it('ne garde la main a l utilisateur que si restart_app se declare indisponible', () => {
    expect(prompt).toMatch(/si `restart_app` te repond lui-meme qu'il est indisponible/)
  })

  it('interdit l arret large d un nom de processus entier', () => {
    expect(prompt).toMatch(/arreter TOUS les processus/)
  })
})
