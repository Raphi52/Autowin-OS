// @vitest-environment happy-dom
/**
 * LE BROUILLON SURVIT AU RECHARGEMENT DE LA FENÊTRE.
 *
 * Symptôme utilisateur du 2026-09-01 : « de temps en temps ça m'enlève de la conversation dans
 * laquelle je suis en train d'écrire et ça m'efface le message ». Le texte en cours de frappe ne
 * vivait que dans une ref du renderer : un rechargement (mise à jour appliquée, rechargement à
 * chaud, plantage du renderer) le perdait sans trace — le journal des saisies n'écrit qu'au moment
 * de l'ENVOI, donc un brouillon jamais envoyé n'y laissait rien.
 *
 * Le démontage/remontage de la vue reproduit exactement ce rechargement : la mémoire du composant
 * repart de zéro, seul le stockage local subsiste.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chatApi, installRafShim, mountChat } from './ChatView.harness'
import { CLE_BROUILLONS } from './brouillons-persistes'
import { CLE_DERNIERE_CONVERSATION } from './derniere-conversation'
import { conversation } from './ChatView.harness'

installRafShim()

describe('brouillon du composer après rechargement de la fenêtre', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => window.localStorage.clear())

  it('retrouve le texte tapé alors qu’il n’avait jamais été envoyé', async () => {
    const premier = await mountChat(chatApi())
    await premier.type('message à moitié écrit que je ne veux pas perdre')
    expect(window.localStorage.getItem(CLE_BROUILLONS)).toContain('à moitié écrit')
    await premier.unmount()

    const second = await mountChat(chatApi())
    expect(second.textarea().value).toBe('message à moitié écrit que je ne veux pas perdre')
    await second.unmount()
  })

  it('n’écrit rien quand le composer est vide — pas de brouillon fantôme', async () => {
    const vue = await mountChat(chatApi())
    await vue.type('abc')
    await vue.type('')
    expect(window.localStorage.getItem(CLE_BROUILLONS) ?? '{}').not.toContain('abc')
    await vue.unmount()
  })
})

describe('la reprise automatique ne vole plus la conversation où j’écris', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => window.localStorage.clear())

  it('reste sur MA conversation quand un tour interrompu attend dans une AUTRE', async () => {
    window.localStorage.setItem(CLE_DERNIERE_CONVERSATION, 'A')
    window.localStorage.setItem(CLE_BROUILLONS, JSON.stringify({ A: 'ma phrase en cours' }))
    const api = chatApi({
      conversations: async () => [conversation('A'), conversation('B')],
      // Un tour interrompu RÉCENT dans B : c'est lui qui volait le démarrage.
      unfinishedTurns: async () => [
        { conversationId: 'B', turnId: 't1', events: 3, updatedAt: Date.now() }
      ],
      turnJournal: async () => []
    })
    const vue = await mountChat(api)
    // La sélection reste la mienne, et mon texte est toujours là.
    expect(vue.container.querySelector('.conv-item.active')?.textContent).toContain('A')
    expect(vue.textarea().value).toBe('ma phrase en cours')
    await vue.unmount()
  })

  it('reprend bien le tour interrompu quand RIEN n’est en cours de frappe', async () => {
    window.localStorage.setItem(CLE_DERNIERE_CONVERSATION, 'A')
    const api = chatApi({
      conversations: async () => [conversation('A'), conversation('B')],
      unfinishedTurns: async () => [
        { conversationId: 'B', turnId: 't1', events: 3, updatedAt: Date.now() }
      ],
      turnJournal: async () => []
    })
    const vue = await mountChat(api)
    expect(vue.container.querySelector('.conv-item.active')?.textContent).toContain('B')
    await vue.unmount()
  })
})
