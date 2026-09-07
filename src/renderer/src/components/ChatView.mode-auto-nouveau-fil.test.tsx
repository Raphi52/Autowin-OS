// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const { chatApi, installRafShim, mountChat } = await import('./ChatView.harness')
type Harness = Awaited<ReturnType<typeof mountChat>>

/**
 * DEFAUT VECU (2026-09-07) : « quand j'ouvre un nouveau fil je peux pas toggle le mode auto ».
 * Un fil neuf n'a pas encore d'identifiant, et la bascule sortait en silence faute de cible :
 * le rond ∞ ne s'allumait meme pas. L'intention doit tenir jusqu'a la creation, puis s'y poser.
 */
describe('ChatView — le rond ∞ s’arme AVANT que la conversation existe', () => {
  beforeAll(installRafShim)
  let h: Harness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('le bouton s’allume sur un fil neuf, puis le réglage suit la conversation créée', async () => {
    const conversationsCreate = vi.fn().mockResolvedValue({ id: 'NEUF', title: 'neuf' })
    h = await mountChat(
      chatApi({
        conversationsCreate,
        pilotChat: vi.fn().mockResolvedValue({ ok: true }),
        conversations: vi.fn().mockResolvedValue([])
      })
    )
    const bouton = (): Element | null =>
      h!.container.querySelector('[data-testid="composer-auto-toggle"]')
    expect(bouton()?.getAttribute('aria-pressed')).toBe('false')

    await h.click('[data-testid="composer-auto-toggle"]')
    // AVANT : le clic ne faisait rien du tout — le bouton restait éteint.
    expect(bouton()?.getAttribute('aria-pressed')).toBe('true')

    await h.type('première question')
    await h.click('[data-testid="composer-send"]')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(conversationsCreate).toHaveBeenCalled()
    expect(JSON.parse(window.localStorage.getItem('autowin.chat.modeAuto.convs') ?? '[]')).toContain(
      'NEUF'
    )
  })
})
