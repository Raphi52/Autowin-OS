import { beforeEach, describe, expect, it } from 'vitest'
import {
  lireConversationsEnAttente,
  marquerConversationEnAttente,
  retirerConversationEnAttente,
  souscrireConversationsEnAttente,
  viderConversationsEnAttente
} from './conversations-attention'

/**
 * Le registre des conversations en ETAT ATTENTION (cadre dore / pastille jaune d'une fenetre de
 * mosaique). L'accueil le LIT ; la mosaique l'ECRIT. Il est pur : testable sans React ni Electron.
 */
describe('conversations-attention', () => {
  beforeEach(() => viderConversationsEnAttente())

  it('incremente la liste quand une fenetre passe en attention', () => {
    marquerConversationEnAttente('c1', 'Refonte accueil')
    marquerConversationEnAttente('c2', 'Baseline')
    expect(lireConversationsEnAttente().map((c) => c.id)).toEqual(['c1', 'c2'])
  })

  it('ne compte pas deux fois la MEME conversation', () => {
    marquerConversationEnAttente('c1', 'Refonte accueil')
    marquerConversationEnAttente('c1', 'Refonte accueil (titre a jour)')
    const liste = lireConversationsEnAttente()
    expect(liste).toHaveLength(1)
    expect(liste[0].titre).toBe('Refonte accueil (titre a jour)')
  })

  /**
   * L'entree qui ferait echouer ce test si le retrait etait faux : une conversation NON retiree
   * (`c2`) doit SURVIVRE au retrait de `c1`. Un `vider()` deguise en `retirer()` passerait le
   * simple « c1 absent » et echouerait ici.
   */
  it('retire seulement la conversation nommee', () => {
    marquerConversationEnAttente('c1', 'Un')
    marquerConversationEnAttente('c2', 'Deux')
    retirerConversationEnAttente('c1')
    expect(lireConversationsEnAttente().map((c) => c.id)).toEqual(['c2'])
  })

  it('previent les abonnes a chaque changement, et plus apres desabonnement', () => {
    const vus: number[] = []
    const stop = souscrireConversationsEnAttente((liste) => vus.push(liste.length))
    marquerConversationEnAttente('c1', 'Un')
    marquerConversationEnAttente('c2', 'Deux')
    retirerConversationEnAttente('c1')
    stop()
    marquerConversationEnAttente('c3', 'Trois')
    expect(vus).toEqual([1, 2, 1])
  })

  it('rend une COPIE : muter le retour ne touche pas le registre', () => {
    marquerConversationEnAttente('c1', 'Un')
    lireConversationsEnAttente().push({ id: 'faux', titre: 'x', depuis: 0 })
    expect(lireConversationsEnAttente()).toHaveLength(1)
  })
})

describe('instantane stable (pour useSyncExternalStore)', () => {
  beforeEach(() => viderConversationsEnAttente())

  it('rend la MEME reference tant que rien ne change, une NOUVELLE apres un changement', async () => {
    const { instantaneConversationsEnAttente } = await import('./conversations-attention')
    const a = instantaneConversationsEnAttente()
    expect(instantaneConversationsEnAttente()).toBe(a)
    marquerConversationEnAttente('c1', 'Un')
    const b = instantaneConversationsEnAttente()
    expect(b).not.toBe(a)
    expect(instantaneConversationsEnAttente()).toBe(b)
    // L'entree qui ferait echouer un cache jamais invalide : un retrait doit changer la reference.
    retirerConversationEnAttente('c1')
    expect(instantaneConversationsEnAttente()).not.toBe(b)
  })
})
