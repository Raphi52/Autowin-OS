// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

/**
 * conv-1543 (2026-11-04) : cliquer la branche OUVRE la copie, même pendant qu'un tour travaille.
 * La retenue sur place avec un bandeau « la branche t'attend dans la liste » (2026-09-03) a été
 * refusée par l'utilisateur : « juste mets-moi sur une fork de la conv comme ça a toujours été ».
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

  it('crée la branche et l’OUVRE, sans bandeau, même si le fil travaille', async () => {
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
        conversation: vi.fn((id: string) => Promise.resolve(id === 'A-fork' ? copie : source())),
        conversationsFork: fork,
        pilotChat: vi.fn(() => tour)
      })
    )
    await harness.click('.conv-pick')

    // Un tour part : la conversation A devient occupee.
    await harness.type('travaille')
    await act(async () => {
      harness!
        .textarea()
        .dispatchEvent(
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
    // ...et c'est elle qui s'affiche : la copie (u1 seul), plus l'original (u2, « travaille »).
    const body = harness.container.querySelector('.chat-scroll')?.textContent ?? ''
    expect(body).toContain('u1')
    expect(body).not.toContain('u2')
    expect(body).not.toContain('travaille')
    // Aucun bandeau « la branche t'attend dans la liste ».
    const avis = harness.container.querySelector('[data-testid="chat-workflow-notice"]')
    expect(avis?.textContent ?? '').not.toContain('A (fork)')

    await act(async () => {
      resoudreTour({ ok: true })
      await tour
    })
  })
})
