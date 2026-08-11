// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

describe('ChatView — refus visible du workflow actif', () => {
  let harness: ChatHarness | undefined

  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
  })

  it('affiche dans le chat le toast émis quand main neutralise un workflow cassé', async () => {
    let emit!: (event: { type: string; text?: string; noticeId?: number }) => void
    harness = await mountChat(
      chatApi({
        workflowProfileAcknowledgeNotice: vi.fn().mockResolvedValue(true),
        onAppEvent: vi.fn((listener) => {
          emit = listener
          return vi.fn()
        })
      })
    )

    await act(async () =>
      emit({ type: 'toast', text: 'Workflow « Cassé » non exécutable', noticeId: 1 })
    )

    const notice = harness.container.querySelector('[data-testid="chat-workflow-notice"]')
    expect(notice?.getAttribute('role')).toBe('alert')
    expect(notice?.textContent).toContain('Cassé')
  })

  it('récupère au montage le refus émis avant la création de la fenêtre', async () => {
    harness = await mountChat(
      chatApi({
        workflowProfileNotice: vi
          .fn()
          .mockResolvedValue({ id: 7, text: 'Workflow « Persisté cassé » non exécutable' }),
        workflowProfileAcknowledgeNotice: vi.fn().mockResolvedValue(true)
      })
    )

    const notice = harness.container.querySelector('[data-testid="chat-workflow-notice"]')
    expect(notice?.textContent).toContain('Persisté cassé')
  })

  it('ne perd pas la notice si le premier montage disparaît avant la réponse IPC', async () => {
    let resolveFirst!: (value: { id: number; text: string }) => void
    const firstRead = new Promise<{ id: number; text: string }>((resolve) => {
      resolveFirst = resolve
    })
    const notice = { id: 9, text: 'Workflow « Course » non exécutable' }
    const read = vi.fn().mockReturnValueOnce(firstRead).mockResolvedValue(notice)
    const acknowledge = vi.fn().mockResolvedValue(true)

    harness = await mountChat(
      chatApi({
        workflowProfileNotice: read,
        workflowProfileAcknowledgeNotice: acknowledge
      })
    )
    await harness.unmount()
    harness = undefined
    resolveFirst(notice)
    await Promise.resolve()
    expect(acknowledge).not.toHaveBeenCalled()

    harness = await mountChat(
      chatApi({
        workflowProfileNotice: read,
        workflowProfileAcknowledgeNotice: acknowledge
      })
    )
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)))

    expect(
      harness.container.querySelector('[data-testid="chat-workflow-notice"]')?.textContent
    ).toContain('Course')
    expect(acknowledge).toHaveBeenCalledWith(9)
  })

  it('une lecture startup retardée ne remplace pas un refus live plus récent', async () => {
    let resolveStartup!: (value: { id: number; text: string }) => void
    const startupRead = new Promise<{ id: number; text: string }>((resolve) => {
      resolveStartup = resolve
    })
    let emit!: (event: { type: string; text?: string; noticeId?: number }) => void
    const acknowledge = vi.fn().mockResolvedValue(true)
    harness = await mountChat(
      chatApi({
        workflowProfileNotice: vi.fn().mockReturnValue(startupRead),
        workflowProfileAcknowledgeNotice: acknowledge,
        onAppEvent: vi.fn((listener) => {
          emit = listener
          return vi.fn()
        })
      })
    )

    await act(async () => emit({ type: 'toast', text: 'Refus live récent', noticeId: 2 }))
    resolveStartup({ id: 1, text: 'Refus startup ancien' })
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)))

    const text = harness.container.querySelector('[data-testid="chat-workflow-notice"]')?.textContent
    expect(text).toContain('live récent')
    expect(text).not.toContain('startup ancien')
    expect(acknowledge).toHaveBeenCalledWith(2)
    expect(acknowledge).not.toHaveBeenCalledWith(1)
  })
})
