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
 * En mosaique, la liste doit dire OUVERT/FERME a droite du titre, le meme clic doit refermer la
 * fenetre (toggle), et le mode selection (cases a cocher) de la vue liste ne doit pas exister.
 */
describe('ChatView — bascule ouvert/ferme en mosaique', () => {
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

  it('affiche l’etat, ouvre puis referme au meme clic', async () => {
    window.localStorage.setItem('autowin.chat.conversationsViewMode', 'mosaic')
    window.localStorage.setItem('autowin.chat.mosaicOpenIds', '[]')
    h = await mountChat(api())
    const etat = (): HTMLElement | null =>
      h!.container.querySelector('[data-testid="conv-mosaic-toggle-A"]')
    expect(etat()).not.toBeNull()
    expect(etat()!.getAttribute('aria-pressed')).toBe('false')

    await h.click('.conv-item .conv-pick')
    expect(h.container.querySelector('[data-conv-id="A"]')).not.toBeNull()
    expect(etat()!.getAttribute('aria-pressed')).toBe('true')

    await h.click('.conv-item .conv-pick')
    expect(h.container.querySelector('[data-conv-id="A"]')).toBeNull()
    expect(etat()!.getAttribute('aria-pressed')).toBe('false')

    // Entree qui piege une bascule fausse : le 3e clic. Si `mosaicIdsRef` n'est pas remis a jour
    // a la fermeture, la ref croit la fenetre encore ouverte et ce clic la referme au lieu de
    // la rouvrir.
    await h.click('.conv-item .conv-pick')
    expect(h.container.querySelector('[data-conv-id="A"]')).not.toBeNull()
    expect(etat()!.getAttribute('aria-pressed')).toBe('true')
  })

  it('n’affiche pas l’indicateur hors mosaique', async () => {
    window.localStorage.setItem('autowin.chat.conversationsViewMode', 'list')
    h = await mountChat(api())
    expect(h.container.querySelector('[data-testid="conv-mosaic-toggle-A"]')).toBeNull()
  })

  it('desactive le mode selection en mosaique', async () => {
    window.localStorage.setItem('autowin.chat.conversationsViewMode', 'mosaic')
    h = await mountChat(api())
    expect(h.container.querySelector('[data-testid="conv-menu-select-mode"]')).toBeNull()
    await h.click('.conv-menu-trigger')
    expect(document.querySelector('[data-testid="conv-menu-select-mode"]')).toBeNull()
    expect(h.container.querySelector('.conv-select-box')).toBeNull()
  })
})
