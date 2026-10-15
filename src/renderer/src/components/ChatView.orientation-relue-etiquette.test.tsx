// @vitest-environment happy-dom
/**
 * UNE ORIENTATION RELUE DU DISQUE GARDE SON ÉTIQUETTE (conv-955, 2026-10-15).
 *
 * Saisies ts 1792054396405 et 1792054407546 : deux messages tapés pendant le run du tour
 * `33bc18ab-a9f3-4bac-8058-ec4838c647b8`. Le main les écrit avec `orientation: true` (journal :
 * message-conv-955-5 et -6), puis l'écran relit le fil. `hydraterFilStocke` ne recopiait pas ce
 * drapeau : le message s'affichait comme une demande ORDINAIRE, sans « orienté en cours de tour »,
 * et l'utilisateur attendait une réponse propre à ce message (« ya pas ton retour sur ce tour »,
 * conv-965, 09:03). L'étiquette (ChatMessageRow, conv-257) n'était visible que dans son propre test.
 */
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, conversation, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

describe('ChatView — orientation relue du disque', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  afterEach(async () => {
    localStorage.clear()
    await h?.unmount()
    h = null
    vi.restoreAllMocks()
  })

  it('affiche « orienté en cours de tour » sur le message écrit pendant le tour, pas sur la demande', async () => {
    const fil = [
      { role: 'user', content: 'traite le candidat effort', messageId: 'm1' },
      {
        role: 'assistant',
        content: 'Travail lancé.',
        messageId: 'm2',
        status: 'done',
        parts: [{ kind: 'text', text: 'Travail lancé.' }]
      },
      {
        role: 'user',
        content: 'enleve le titre conversations c useless',
        messageId: 'm3',
        orientation: true
      }
    ]
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([conversation('A', fil)]),
        conversation: vi.fn(async () => ({ id: 'A', title: 'A', messages: fil }))
      })
    )
    await h.click('.conv-pick')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    const orientes = h.container.querySelectorAll('.msg.user.is-orientation')
    expect(orientes).toHaveLength(1)
    expect(orientes[0].textContent).toContain('enleve le titre conversations')
    expect(orientes[0].textContent).toContain('orienté en cours de tour')
    // La demande qui a ouvert le tour reste une demande.
    expect(h.container.querySelectorAll('.msg.user')).toHaveLength(2)
  })
})
