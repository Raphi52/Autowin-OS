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
 * Une conversation creee D'AVANCE (fenetre mosaique) porte un titre placeholder que rien ne
 * remplacait. Le PREMIER message utilisateur doit la nommer.
 */
describe('ChatView — titre pris sur le premier message', () => {
  beforeAll(installRafShim)
  let h: Harness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('renomme la conversation placeholder avec le debut du message', async () => {
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
    expect(api.conversationsRename).toHaveBeenCalledWith(
      'A',
      'corrige le titrage des conversations'
    )
  })
})
