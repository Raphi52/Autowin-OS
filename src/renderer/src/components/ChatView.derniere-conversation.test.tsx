// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'
import { CLE_DERNIERE_CONVERSATION } from './derniere-conversation'

/**
 * Demande utilisateur du 2026-08-18 : « quand je relance l'app j'aimerais que ça me mette sur ma
 * dernière conversation où j'étais au lieu de celle-là ». La conversation active n'était retenue
 * qu'en MEMOIRE du processus principal (`commands.ts` → `activeConversationId`), donc perdue à
 * chaque relance — et le boot n'ouvrait que les conversations à tour inachevé (survie de niveau 2).
 *
 * SUPERSEDE le meme jour, par une demande PLUS RECENTE du meme utilisateur : « ca doit ouvrir la
 * plus recente ». Les deux premiers cas ci-dessous sont inchanges — la memoire fait toujours
 * autorite quand elle est valide. Les deux derniers attendaient « aucune selection inventee » :
 * desormais, memoire vide ou perimee ouvre LA PLUS RECENTE au sens de la recence UTILISATEUR, parce
 * qu'un panneau vide au demarrage n'etait la reponse a aucune demande. Le comportement retire est
 * trace ici plutot qu'efface : c'est un arbitrage entre deux exigences, pas une correction de bug.
 */
describe('ChatView — reprise sur la derniere conversation ouverte', () => {
  let harness: ChatHarness | undefined

  beforeAll(() => installRafShim())
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
    localStorage.clear()
  })

  const conversations = [
    { id: 'ancienne', title: 'Conversation ancienne', provider: 'codex', updatedAt: 100 },
    { id: 'milieu', title: 'Conversation intermediaire', provider: 'codex', updatedAt: 200 },
    { id: 'recente', title: 'Conversation recente', provider: 'codex', updatedAt: 300 }
  ]

  /**
   * Le harnais partage ne fournit PAS `window.api.conversation` : ses tests n'ouvrent jamais de
   * conversation. `loadConv` l'appelle pour charger l'historique — sans ce double, il echoue et
   * aucune selection n'aboutit. C'est le double qui manquait, pas le produit.
   */
  const api = () =>
    chatApi({
      conversations: async () => conversations,
      conversation: async (id: string) => conversations.find((c) => c.id === id) ?? null
    })

  const actives = (): string[] =>
    Array.from(harness!.container.querySelectorAll('.conv-item.active')).map(
      (element) => element.querySelector('.conv-label')?.textContent ?? ''
    )

  it('rouvre celle ou l utilisateur etait, meme si ce n est pas la plus recente', async () => {
    localStorage.setItem(CLE_DERNIERE_CONVERSATION, 'milieu')

    harness = await mountChat(api())

    expect(actives()).toEqual(['Conversation intermediaire'])
  })

  it('memoire vide : ouvre LA PLUS RECENTE, jamais un panneau vide', async () => {
    harness = await mountChat(api())

    // `recente` porte le `updatedAt` le plus haut et aucun des trois n'a de `lastUserMessageAt` :
    // la recence utilisateur retombe alors sur `updatedAt` (cf. `recenceUtilisateur`).
    expect(actives()).toEqual(['Conversation recente'])
  })

  it('memoire PERIMEE (conversation supprimee depuis) : bascule sur la plus recente', async () => {
    localStorage.setItem(CLE_DERNIERE_CONVERSATION, 'effacee-entre-temps')

    harness = await mountChat(api())

    // L'identifiant fantome est ignore — c'etait deja le cas — mais il ne laisse plus l'ecran vide.
    expect(actives()).toEqual(['Conversation recente'])
  })
})
