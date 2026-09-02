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
 * En mosaique, un bouton « Tout fermer » referme d'un coup toutes les fenetres ouvertes. Il
 * n'existe que quand il sert : hors mosaique, ou en mosaique vide, il ne doit pas s'afficher.
 */
describe('ChatView — fermer toutes les fenetres de la mosaique', () => {
  beforeAll(installRafShim)
  let h: Harness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  const api = (): Record<string, unknown> =>
    chatApi({
      conversations: vi.fn().mockResolvedValue([conversation('A'), conversation('B')]),
      conversation: vi.fn(async (id: string) => conversation(id))
    })

  const bouton = (): HTMLElement | null =>
    h!.container.querySelector('[data-testid="conv-mosaic-close-all"]')

  it('referme toutes les fenetres ouvertes en un clic', async () => {
    window.localStorage.setItem('autowin.chat.conversationsViewMode', 'mosaic')
    window.localStorage.setItem('autowin.chat.mosaicOpenIds', '["A","B"]')
    h = await mountChat(api())
    expect(h.container.querySelector('[data-conv-id="A"]')).not.toBeNull()
    expect(h.container.querySelector('[data-conv-id="B"]')).not.toBeNull()
    expect(bouton()).not.toBeNull()

    await h.click('[data-testid="conv-mosaic-close-all"]')
    expect(h.container.querySelector('[data-conv-id="A"]')).toBeNull()
    expect(h.container.querySelector('[data-conv-id="B"]')).toBeNull()
    // Le mode mosaique reste actif, seule la mosaique est vidée.
    expect(h.container.querySelector('[data-testid="conv-view-toggle"]')!.getAttribute('aria-checked')).toBe('true')
    // Plus rien a fermer : le bouton disparait.
    expect(bouton()).toBeNull()
    expect(window.localStorage.getItem('autowin.chat.mosaicOpenIds')).toBe('[]')
  })

  it('n’existe pas hors mosaique', async () => {
    window.localStorage.setItem('autowin.chat.conversationsViewMode', 'list')
    h = await mountChat(api())
    expect(bouton()).toBeNull()
  })
})
