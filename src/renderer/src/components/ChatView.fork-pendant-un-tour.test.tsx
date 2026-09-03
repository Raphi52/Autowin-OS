// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

/**
 * Vecu le 2026-09-03 : l'icone « branche » (26 px, collee sous chaque message, a 6 px de la loupe)
 * transportait l'utilisateur dans la copie MEME pendant qu'un tour travaillait — il quittait le fil
 * en cours de run sans l'avoir voulu. Le geste volontaire hors tour garde son comportement (test
 * « forker OUVRE la conversation créée »), mais un tour en cours retient sur place.
 */
describe('fork pendant un tour en cours', () => {
  let harness: ChatHarness | null = null

  const source = (): Record<string, unknown> => ({
    id: 'A',
    title: 'A',
    provider: 'codex',
    updatedAt: 1,
    messages: [
      { role: 'user', content: 'u1', ts: 1, messageId: 'm1' },
      {
        role: 'assistant',
        content: 'a1',
        ts: 1,
        messageId: 'm2',
        parentMessageId: 'm1',
        turnId: 't1',
        status: 'completed',
        parts: [{ kind: 'text', text: 'a1' }]
      },
      { role: 'user', content: 'u2', ts: 2, messageId: 'm3', parentMessageId: 'm2' }
    ]
  })
  const copie = {
    id: 'A-fork',
    title: 'A (fork)',
    provider: 'codex',
    updatedAt: 2,
    messages: [{ role: 'user', content: 'u1', ts: 1, messageId: 'f1' }]
  }

  beforeEach(() => installRafShim())
  afterEach(async () => {
    await harness?.unmount()
    harness = null
  })

  it('crée la branche mais NE quitte PAS le fil qui travaille', async () => {
    let resoudreTour: (value: { ok: boolean }) => void = () => {}
    const tour = new Promise<{ ok: boolean }>((resolve) => {
      resoudreTour = resolve
    })
    const fork = vi.fn().mockResolvedValue(copie)
    harness = await mountChat(
      chatApi({
        conversations: vi
          .fn()
          .mockResolvedValueOnce([source()])
          .mockResolvedValue([source(), copie]),
        conversation: vi.fn().mockResolvedValue(source()),
        conversationsFork: fork,
        pilotChat: vi.fn(() => tour)
      })
    )
    await harness.click('.conv-pick')

    // Un tour part : la conversation A devient occupee.
    await harness.type('travaille')
    await act(async () => {
      harness!.textarea().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    const forkBtn = [...harness.container.querySelectorAll('button')].find((b) =>
      /branche/i.test(b.getAttribute('aria-label') ?? '')
    ) as HTMLButtonElement | undefined
    expect(forkBtn).toBeTruthy()
    await act(async () => {
      forkBtn!.click()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    // La branche EST creee...
    expect(fork).toHaveBeenCalledWith('A', expect.any(String))
    // ...et un avis dit ou elle est partie, au lieu d'un deplacement silencieux.
    const avis = harness.container.querySelector('[data-testid="chat-workflow-notice"]')
    expect(avis?.textContent ?? '').toContain('A (fork)')

    await act(async () => {
      resoudreTour({ ok: true })
      await tour
    })
  })
})
