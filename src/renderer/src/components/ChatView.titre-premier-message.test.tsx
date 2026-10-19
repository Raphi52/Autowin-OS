// @vitest-environment happy-dom
import { createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const { chatApi, installRafShim, mountChat } = await import('./ChatView.harness')
type Harness = Awaited<ReturnType<typeof mountChat>>

/**
 * Bug constate le 30/08 : « toutes mes nouvelles conversations s'appellent Nouvelle conversation ».
 * La vue renommait alors le fil provisoire au premier envoi.
 *
 * Depuis conv-999 (2026-10-16), c'est le STOCKAGE qui titre le fil, a CHAQUE message qui lance un
 * tour (conversations.titre-dernier-message.test.ts couvre le provisoire), et `conversationsRename`
 * est le renommage MANUEL : il marque le titre comme choisi par l'utilisateur. Si la vue l'appelait
 * encore a l'envoi, le titre se figerait sur le premier message — exactement ce qui est corrige.
 */
describe('ChatView — l envoi ne fige pas le titre', () => {
  beforeAll(installRafShim)
  let h: Harness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('n appelle pas le renommage manuel en envoyant le premier message', async () => {
    const api = chatApi({
      conversations: vi
        .fn()
        .mockResolvedValue([
          { id: 'A', title: 'Nouvelle conversation', provider: 'codex', messages: [], updatedAt: 1 }
        ]),
      conversation: vi
        .fn()
        .mockResolvedValue({ id: 'A', title: 'Nouvelle conversation', messages: [] }),
      conversationsRename: vi.fn().mockResolvedValue({ ok: true })
    })
    h = await mountChat(api)
    await h.type('corrige le titrage des conversations')
    await h.click('.composer-send')
    await vi.waitFor(() => expect(api.pilotChat).toHaveBeenCalled())
    expect(api.conversationsRename).not.toHaveBeenCalled()
  })
})
