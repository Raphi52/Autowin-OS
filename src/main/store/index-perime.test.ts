import { describe, expect, it } from 'vitest'
import { ConversationStore } from './conversations'

/**
 * L'INDEX DOIT SUIVRE LE CHEMIN REEL, PAS SEULEMENT CELUI DES TESTS.
 *
 * Defaut releve par l'audit : `voisinageCache` etait invalide dans `hydrate`, `create`, `append`,
 * `applyTurnEvent` et `remove` -- mais PAS dans `beginTurn` ni `beginContinuationTurn`, les deux
 * methodes qui ajoutent REELLEMENT les messages a chaque tour de chat en production. `append` n'est
 * qu'un chemin annexe.
 *
 * Consequence : apres plusieurs tours de conversation, l'index restait celui d'AVANT ces messages.
 * Les mots du tour courant ne le rejoignaient jamais, et la recherche raisonnait sur un corpus
 * perime tant qu'aucune conversation n'etait creee ou supprimee.
 *
 * C'est une correction INCOMPLETE, pas un oubli mineur : j'avais couvert les chemins que mes tests
 * exercaient, et cru couvrir le store. Un cache invalide sur les mauvais chemins est pire qu'aucun
 * cache -- il repond avec assurance sur un corpus disparu.
 */

describe('l index suit les ecritures du chemin de production', () => {
  it('un lien appris par beginTurn elargit vraiment la recherche', () => {
    let horloge = 1000
    const store = new ConversationStore(() => horloge++)
    const cible = store.create({ title: 'Cible', provider: 'claude' })
    store.append(cible.id, { role: 'user', content: 'explique-moi les rondelles de statut' })
    const fil = store.create({ title: 'Fil', provider: 'claude' })

    // Cette premiere recherche CONSTRUIT l'index : c'est elle qui le figeait.
    // Un cache perime n'empeche pas de trouver un mot PRESENT -- il empeche l'expansion
    // d'apprendre. C'est donc l'expansion qu'il faut mettre a l'epreuve, pas la presence.
    expect(store.search('macarons')).toEqual([])

    // Le chemin REEL de production : beginTurn, pas append.
    store.beginTurn(fil.id, { content: 'macarons ou rondelles, meme chose' }, { turnId: 'tour-1' })
    store.beginTurn(fil.id, { content: 'ces macarons, ces rondelles' }, { turnId: 'tour-2' })

    // Aucun create/remove/hydrate entre-temps : seul beginTurn a ecrit. Si l'index reste celui
    // d'avant, « macarons » ne mene toujours a rien.
    expect(store.search('macarons').map((x) => x.title)).toContain('Cible')
  })
})
