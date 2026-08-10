// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

describe('ChatView — la file d’attente se réordonne', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    vi.restoreAllMocks()
  })

  const queueTexts = (): (string | null)[] =>
    [...h!.container.querySelectorAll('.directive-queue-text')].map((e) => e.textContent)

  /** Un tour en cours + deux messages mis en file (l'injection échoue → repli file, comportement existant). */
  async function twoQueued(): Promise<void> {
    let resolveTurn!: (v: { ok: boolean }) => void
    const turn = new Promise<{ ok: boolean }>((r) => {
      resolveTurn = r
    })
    void resolveTurn
    h = await mountChat(
      chatApi({
        pilotChat: vi.fn(() => turn),
        injectDirective: vi.fn().mockRejectedValue(new Error('injection indisponible'))
      })
    )
    await h.click('.conv-pick')
    await h.type('tour long')
    await h.click('.composer-send')
    await h.type('A')
    await h.click('.composer-send')
    await h.type('B')
    await h.click('.composer-send')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 25))
    })
  }

  it('descend le premier message, puis le remonte — l’ordre de frappe n’est plus une fatalité', async () => {
    await twoQueued()
    expect(queueTexts()).toEqual(['A', 'B'])

    const down = h!.container.querySelectorAll('[data-testid="queue-move-down"]')
    await act(async () => (down[0] as HTMLButtonElement).click())
    expect(queueTexts()).toEqual(['B', 'A'])

    const up = h!.container.querySelectorAll('[data-testid="queue-move-up"]')
    await act(async () => (up[1] as HTMLButtonElement).click())
    expect(queueTexts()).toEqual(['A', 'B'])
  })

  it('désactive les flèches aux bornes de la file', async () => {
    await twoQueued()
    const ups = h!.container.querySelectorAll<HTMLButtonElement>('[data-testid="queue-move-up"]')
    const downs = h!.container.querySelectorAll<HTMLButtonElement>(
      '[data-testid="queue-move-down"]'
    )
    expect(ups[0].disabled).toBe(true)
    expect(downs[downs.length - 1].disabled).toBe(true)
    expect(downs[0].disabled).toBe(false)
  })

  it('un message BTW reste en dernier — le réordonnancement ne peut pas le doubler', async () => {
    await twoQueued()
    const btws = h!.container.querySelectorAll<HTMLButtonElement>('.directive-queue-btw')
    await act(async () => btws[0].click()) // A passe en BTW → part en dernier
    expect(queueTexts()).toEqual(['B', 'A'])

    const downs = h!.container.querySelectorAll<HTMLButtonElement>(
      '[data-testid="queue-move-down"]'
    )
    expect(downs[0].disabled).toBe(true) // B ne peut pas passer après le BTW
    const ups = h!.container.querySelectorAll<HTMLButtonElement>('[data-testid="queue-move-up"]')
    expect(ups[1].disabled).toBe(true) // le BTW lui-même ne bouge pas
  })
})
