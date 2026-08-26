import { describe, expect, it } from 'vitest'
import { ConversationStore } from './conversations'

/**
 * LE TEXTE DE L'ASSISTANT DOIT ENTRER DANS L'INDEX. C'est la plus grande part du corpus.
 *
 * Defaut trouve par un test de SENSIBILITE du panel de juges -- et c'est une regression que j'avais
 * introduite au commit precedent. J'avais retire l'invalidation de l'index sur `applyTurnEvent` en
 * ecrivant que `indexerMessage` l'alimenterait desormais... sans brancher `indexerMessage` DANS
 * `applyTurnEvent`. J'avais pose les appels sur les quatre `push` de messages, or `applyTurnEvent`
 * MUTE le contenu d'un message existant (le streaming des deltas) : il ne pousse rien.
 *
 * Consequence : une fois les index construits, le texte reellement produit par l'assistant n'y
 * entrait JAMAIS. La recherche par contenu -- la fonctionnalite meme de ce chantier -- ratait
 * silencieusement la majorite de son propre corpus, jusqu'au prochain redemarrage.
 *
 * Personne ne l'aurait vu : les 6060 tests etaient verts, et le commentaire du code affirmait le
 * contraire de ce que le code faisait. C'est exactement pourquoi un commentaire ne prouve rien.
 */

describe('le contenu produit en streaming devient cherchable', () => {
  it('un mot rare arrive par un delta assistant est retrouve, sans redemarrage', () => {
    let horloge = 1000
    const store = new ConversationStore(() => horloge++)
    const c = store.create({ title: 'Fil', provider: 'claude' })
    store.beginTurn(c.id, { content: 'une question neutre' }, { turnId: 'tour-1' })

    // Cette recherche CONSTRUIT les index : c'est a partir d'ici que le trou s'ouvrait.
    expect(store.search('zygomatique')).toEqual([])

    // Le vrai chemin de production : le texte de l'assistant arrive par deltas.
    store.applyTurnEvent(c.id, 'tour-1', {
      kind: 'delta',
      text: 'voici une reponse contenant le mot zygomatique'
    } as never)
    store.applyTurnEvent(c.id, 'tour-1', { kind: 'done' } as never)

    expect(store.search('zygomatique').map((x) => x.title)).toContain('Fil')
  })
})

describe('une conversation supprimee est desinscrite, pas oubliee en bloc', () => {
  it('ce qu elle portait cesse d etre trouvable, et le reste survit', () => {
    let horloge = 1000
    const store = new ConversationStore(() => horloge++)
    const partante = store.create({ title: 'Partante', provider: 'claude' })
    store.append(partante.id, { role: 'user', content: 'un mot zygomatique ici' })
    const restante = store.create({ title: 'Restante', provider: 'claude' })
    store.append(restante.id, { role: 'user', content: 'un mot kaleidoscope ici' })

    expect(store.search('zygomatique').map((x) => x.title)).toContain('Partante')

    store.remove(partante.id)

    expect(store.search('zygomatique')).toEqual([])
    // Le voisin ne doit pas partir avec elle : `retirer` desinscrit UNE conversation, il ne vide pas.
    expect(store.search('kaleidoscope').map((x) => x.title)).toContain('Restante')
  })
})
