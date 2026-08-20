// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, conversation, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

/**
 * LE SYMPTOME, rapporte le 20/08 : « parfois quand une conversation travaille, je peux pas cliquer
 * sur Envoyer dans la conversation B ».
 *
 * Quand le classifieur de routage renvoie le message d'une conversation vers une AUTRE, la branche
 * routee relache bien le drapeau `busy` de la conversation SOURCE — mais pas son VERROU D'ENVOI. Or
 * ce verrou n'est libere que dans le `finally` de l'envoi, donc a la fin du tour sur la conversation
 * CIBLE, qui peut durer des minutes. Pendant tout ce temps la source affiche « Envoyer », le bouton
 * est actif... et le clic ne fait RIEN : `send()` sort en tete sur le verrou. Silencieux, donc
 * indistinguable d'une app gelee.
 */
describe('ChatView — un message routé ailleurs ne verrouille pas sa conversation d’origine', () => {
  let harness: ChatHarness | undefined

  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
  })

  it('après un routage, la conversation source peut RENVOYER pendant que la cible travaille', async () => {
    // Le tour sur la cible ne rend jamais la main : c'est le cas « une conversation travaille ».
    const pilotChat = vi.fn(() => new Promise<{ ok: boolean }>(() => {}))
    const routeConversationMessage = vi.fn(async (conversationId: string) => ({
      sourceConversationId: conversationId,
      conversationId: conversationId === 'A' ? 'Z' : conversationId,
      routed: conversationId === 'A',
      decision: { route: 'other', confidence: 1, reason: 'related' }
    }))
    harness = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([conversation('A'), conversation('Z')]),
        routeConversationMessage,
        pilotChat
      })
    )
    const item = (titre: string): HTMLElement => {
      const trouve = Array.from(
        harness!.container.querySelectorAll<HTMLElement>('.conv-item .conv-pick')
      ).find((element) => element.textContent?.includes(titre))
      if (!trouve) throw new Error(`conversation ${titre} absente de la liste`)
      return trouve
    }
    const ouvrir = async (titre: string): Promise<void> => {
      await act(async () => {
        item(titre).click()
        await Promise.resolve()
        await Promise.resolve()
      })
    }

    await ouvrir('Conversation A')
    await harness.type('premier message')
    await harness.click('[data-testid="composer-send"]')
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(routeConversationMessage).toHaveBeenCalled()
    expect(pilotChat).toHaveBeenCalledTimes(1)
    expect(pilotChat.mock.calls[0]?.[1]).toBe('Z')

    // Retour sur la conversation d'origine : elle ne travaille pas, elle doit pouvoir envoyer.
    await ouvrir('Conversation A')
    await harness.type('second message')
    await harness.click('[data-testid="composer-send"]')
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(pilotChat).toHaveBeenCalledTimes(2)
  })
})
