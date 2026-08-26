import { describe, expect, it } from 'vitest'
import { APP_DESTINATIONS, resolveAppLocation } from './navigation'

/**
 * CE QUE CE TEST ATTRAPE, mesuré EN DIRECT le 2026-08-26 dans l'app.
 *
 * Un agent à qui on demandait d'ouvrir les worktrees a appelé `navigate` avec « worktrees » — le
 * LIBELLÉ qu'il lit dans la barre latérale. L'identifiant, lui, est `worktree` au singulier. La
 * valeur inconnue retombait sur `'chat'`, et l'appel rendait `{"tab":"chat"}` SANS ERREUR : l'agent
 * a cru avoir navigué, l'app n'avait pas bougé. Il l'a heureusement remarqué et écrit dans le fil —
 * « la navigation n'a pas pris » — mais rien dans le retour ne le disait.
 *
 * Deux défauts distincts, et les deux comptent :
 *   - le libellé affiché n'était pas une entrée valide, alors que c'est le seul nom qu'un agent VOIT ;
 *   - un repli silencieux transforme un échec en succès. Le repli reste (refuser produirait des faux
 *     blocages), mais il ne doit plus se taire.
 */
describe('resolveAppLocation — le nom AFFICHÉ est une adresse valide', () => {
  it('accepte le libellé de CHAQUE destination, pas seulement son identifiant', () => {
    for (const destination of APP_DESTINATIONS) {
      const parLibelle = resolveAppLocation(destination.label)
      expect(parLibelle.destination, `libellé « ${destination.label} »`).toBe(destination.id)
    }
  })

  it('accepte « worktrees » au pluriel — le cas vécu', () => {
    expect(resolveAppLocation('worktrees').destination).toBe('worktree')
    expect(resolveAppLocation('Worktrees').destination).toBe('worktree')
  })

  it('garde l’identifiant canonique et les alias existants intacts', () => {
    expect(resolveAppLocation('worktree').destination).toBe('worktree')
    expect(resolveAppLocation('chat').destination).toBe('chat')
    expect(resolveAppLocation('agents')).toMatchObject({
      destination: 'agent-studio',
      section: 'topology'
    })
  })

  it('DIT que la destination n’a pas été reconnue, au lieu de replier en silence', () => {
    // Le repli sur `chat` reste — refuser produirait des faux blocages. Mais l'appelant doit pouvoir
    // distinguer « je suis sur le chat parce que tu l'as demandé » de « je n'ai pas compris ».
    expect(resolveAppLocation('destination-qui-nexiste-pas')).toMatchObject({
      destination: 'chat',
      reconnu: false
    })
    expect(resolveAppLocation('worktrees').reconnu).not.toBe(false)
    expect(resolveAppLocation('chat').reconnu).not.toBe(false)
  })
})
