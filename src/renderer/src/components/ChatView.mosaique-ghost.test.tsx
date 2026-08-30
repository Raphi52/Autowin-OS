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
 * En mosaique, chaque fenetre doit proposer le PROMPT SUIVANT du modele en ghost-text (accepte par
 * Tab), comme le chat plein. Il etait cable a `null` : la fenetre n'offrait rien (2026-08-30).
 */
describe('ChatView — ghost-text du prompt suivant en mosaique', () => {
  beforeAll(installRafShim)
  let h: Harness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('affiche le prompt suivant du dernier message assistant dans la fenetre', async () => {
    const fil = [
      { role: 'user', content: 'salut' },
      { role: 'assistant', content: 'ok\nAUTOWIN_PROMPT_V1: lance le terrain sur X' }
    ]
    window.localStorage.setItem('autowin.chat.conversationsViewMode', 'mosaic')
    window.localStorage.setItem('autowin.chat.mosaicOpenIds', '[]')
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([conversation('A', fil)]),
        conversation: vi.fn(async (id: string) => conversation(id, fil))
      })
    )
    await h.click('.conv-item .conv-pick')
    const champ = h.container.querySelector<HTMLTextAreaElement>(
      '[data-conv-id="A"] textarea'
    )
    expect(champ).not.toBeNull()
    expect(champ!.placeholder).toContain('lance le terrain sur X')
  })
})
