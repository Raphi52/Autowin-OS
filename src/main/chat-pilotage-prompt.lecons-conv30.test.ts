import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'

/**
 * KAIZEN DE conv-30 (2026-09-01) — trois pertes MESUREES dans la trace causale de ce fil, dont
 * aucune ne venait d'un bug de code : la consigne ne disait pas ce que le produit exigeait.
 *
 * 1. MUTATION NON DEMANDEE SUR UN SYMPTOME. « dans autowin les termes employes sont trop pousses »
 *    -> renommage des onglets (src/shared/navigation.ts), jamais demande, annule deux tours plus
 *    tard : l'utilisateur parlait des REPONSES du modele. Le tour avait meme ecrit « je ne le passe
 *    pas en force » puis l'avait passe en force sur la relance vague « il se passe quoi la ».
 *    Cout : ~3 M tokens et un aller-retour git pour zero valeur.
 * 2. UNE SEULE ORCHESTRATION PAR TOUR. Le plafond existe (src/shared/orchestration-outcome.ts) mais
 *    n'etait ecrit NULLE PART dans la consigne : apres un 529 du fournisseur, le pilote a relance
 *    `orchestrate` dans le meme tour et s'est fait refuser — un appel de modele brule.
 * 3. `desktop_observe` EST 1-BASE. `display: 0` a ete emis, refuse, et l'iteration perdue ; la
 *    description de la commande ne disait pas ou commencait la numerotation.
 *
 * Entrees qui doivent faire rougir : une des trois clauses supprimee ou vidée de son interdit.
 */
describe('chat-pilotage-prompt — lecons mesurees de conv-30', () => {
  it('interdit de MODIFIER quoi que ce soit tant que l’utilisateur n’a pas nomme sa cible', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toMatch(/TANT QU'IL N'A PAS NOMME SA CIBLE/u)
    // L'interdit doit porter sur la MUTATION, pas seulement sur le texte des options.
    expect(prompt).toMatch(/tu ne MODIFIES rien/u)
    expect(prompt).toMatch(/renommage/iu)
  })

  it('rend opposable la reserve que le modele s’est imposee lui-meme', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toMatch(/je ne le passe pas en force/u)
    expect(prompt).toMatch(/t'ENGAGE/u)
    // Une relance vague ne vaut pas accord — c'est exactement ce qui a derape dans conv-30.
    expect(prompt).toMatch(/n'est PAS cet accord/u)
  })

  it('annonce le plafond d’UNE orchestration par tour, surcharge serveur comprise', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toMatch(/UNE SEULE orchestration par TOUR/u)
    expect(prompt).toMatch(/529/u)
    expect(prompt).toMatch(/tu ne peux PAS la relancer dans ce meme tour/u)
  })

  it('dit dans la description de desktop_observe que les ecrans commencent a 1', () => {
    // Le catalogue n'est pas exporte : on lit la source, comme chat-ipc-contract.test.ts.
    const source = readFileSync(new URL('./commands.ts', import.meta.url), 'utf8')
    const debut = source.indexOf("name: 'desktop_observe'")
    expect(debut, 'la commande desktop_observe doit exister').toBeGreaterThan(-1)
    const specification = source.slice(debut, source.indexOf("name: 'desktop_act'"))
    expect(specification).toMatch(/A PARTIR DE 1/u)
    expect(specification).toMatch(/display: 0` est refuse/u)
  })
})
