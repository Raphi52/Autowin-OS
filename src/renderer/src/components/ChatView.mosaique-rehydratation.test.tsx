// @vitest-environment happy-dom
import { createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const { chatApi, conversation, installRafShim, mountChat } = await import('./ChatView.harness')
type Harness = Awaited<ReturnType<typeof mountChat>>

/**
 * Apres un rafraichissement, `mosaicIds` revient de localStorage mais les fils peints, non : sans
 * re-hydratation les fenetres affichent « Aucun message. » alors que la conversation est intacte.
 */
describe('ChatView — mosaique re-hydratee au remontage', () => {
  beforeAll(installRafShim)
  let h: Harness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('repeint le fil des fenetres restaurees depuis localStorage', async () => {
    window.localStorage.setItem('autowin.chat.conversationsViewMode', 'mosaic')
    window.localStorage.setItem('autowin.chat.mosaicOpenIds', '["A"]')
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([conversation('A')]),
        conversation: vi.fn(async (id: string) =>
          conversation(id, [{ role: 'user', content: 'salut-persiste' }])
        )
      })
    )
    const fenetre = h.container.querySelector('[data-conv-id="A"]')
    expect(fenetre).not.toBeNull()
    expect(fenetre!.textContent).toContain('salut-persiste')
    expect(fenetre!.textContent).not.toContain('Aucun message.')
  })
})
