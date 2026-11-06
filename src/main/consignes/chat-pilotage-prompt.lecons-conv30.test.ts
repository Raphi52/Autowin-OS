import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'
import { ORCHESTRATION_ALREADY_ISSUED_REFUSAL } from '../../shared/orchestration-outcome'
import { sourceDuBus } from '../commands/source-du-bus.test-helpers'

/**
 * KAIZEN (2026-09-01) — trois pertes MESUREES dans la trace causale de ce fil, dont
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
 * Revue règle par règle (2026-11-06) : la clause 1 a quitté la consigne — elle contredisait
 * « Symptôme nu » de la constitution (la localisation est le travail de l'agent), et aucune plainte
 * « j'ai pas demandé » depuis le 16/10. La clause 2 est tenue par le code : le 2e `orchestrate` d'un
 * tour est refusé, et le refus le dit lui-même au modèle.
 *
 * Entrees qui doivent faire rougir : le refus de la 2e orchestration retiré, ou la clause 3 retirée.
 */
describe('chat-pilotage-prompt — lecons mesurees de conv-30', () => {
  it('la clause « sur un symptôme, ne modifie rien » ne contredit plus la constitution', () => {
    expect(buildChatPilotagePrompt([])).not.toMatch(/TANT QU'IL N'A PAS NOMME SA CIBLE/u)
  })

  it('le plafond d’UNE orchestration par tour est tenu par le refus du code', () => {
    expect(ORCHESTRATION_ALREADY_ISSUED_REFUSAL).toMatch(/deja ete lancee dans ce tour/u)
    expect(ORCHESTRATION_ALREADY_ISSUED_REFUSAL).toMatch(/nouveau message utilisateur/u)
    const source = readFileSync(
      join(__dirname, '../agent-pilot/execution-des-commandes.ts'),
      'utf8'
    )
    expect(source).toMatch(/const refusal = ORCHESTRATION_ALREADY_ISSUED_REFUSAL/u)
  })

  it('dit dans la description de desktop_observe que les ecrans commencent a 1', () => {
    // Le catalogue n'est pas exporte : on lit la source, comme chat-ipc-contract.test.ts.
    const source = sourceDuBus()
    const debut = source.indexOf("name: 'desktop_observe'")
    expect(debut, 'la commande desktop_observe doit exister').toBeGreaterThan(-1)
    const specification = source.slice(debut, source.indexOf("name: 'desktop_act'"))
    expect(specification).toMatch(/A PARTIR DE 1/u)
    expect(specification).toMatch(/display: 0` est lu comme 1/u)
  })
})
