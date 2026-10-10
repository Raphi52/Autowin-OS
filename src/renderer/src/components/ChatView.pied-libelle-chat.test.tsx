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
 * Demande utilisateur du 2026-10-10 (pied de liste, /draft) : « le mot Liste remplace le par
 * Chat ». Le bouton de vue du pied affiche « Chat » hors mosaique, « Mosaïque » en mosaique.
 */
describe('ChatView — le bouton de vue du pied dit « Chat » hors mosaique', () => {
  beforeAll(installRafShim)
  let h: Harness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  const conversations = [{ id: 'un', title: 'Un fil', provider: 'codex', updatedAt: 100 }]
  const api = (): Record<string, unknown> =>
    chatApi({
      conversations: vi.fn().mockResolvedValue(conversations),
      conversation: vi.fn(async (id: string) => conversations.find((c) => c.id === id) ?? null)
    })
  const libelle = (): string | null | undefined =>
    h!.container.querySelector('[data-testid="conv-view-toggle"] .conv-foot-libelle')?.textContent

  it('affiche « Chat » en vue liste, puis « Mosaïque » apres bascule', async () => {
    window.localStorage.setItem('autowin.chat.conversationsViewMode', 'list')
    h = await mountChat(api())
    expect(libelle()).toBe('Chat')

    await h.click('[data-testid="conv-view-toggle"]')
    expect(libelle()).toBe('Mosaïque')
  })
})
