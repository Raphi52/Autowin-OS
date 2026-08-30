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
 * Bug constate : en mosaique, le bouton « Nouveau » de la barre laterale vidait le fil unique
 * (masque derriere la grille) et n'ouvrait AUCUNE fenetre. Il doit creer une conversation et
 * l'ajouter a la mosaique.
 */
describe('ChatView — « Nouveau » en mode mosaique', () => {
  beforeAll(installRafShim)
  let h: Harness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('ouvre une fenetre de plus dans la mosaique', async () => {
    window.localStorage.setItem('autowin.chat.conversationsViewMode', 'mosaic')
    window.localStorage.setItem('autowin.chat.mosaicOpenIds', '[]')
    const api = chatApi({
      conversationsCreate: vi.fn().mockResolvedValue({ id: 'NEUVE', title: 'Nouvelle conversation' })
    })
    h = await mountChat(api)
    expect(h.container.querySelector('[data-testid="chat-mosaic"]')).not.toBeNull()
    await h.click('.conv-new-row')
    expect(api.conversationsCreate).toHaveBeenCalled()
    expect(h.container.querySelector('[data-conv-id="NEUVE"]')).not.toBeNull()
  })
})
