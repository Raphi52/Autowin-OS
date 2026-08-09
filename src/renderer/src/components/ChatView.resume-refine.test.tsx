// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}

describe('ChatView — « Reprendre en précisant… »', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    vi.restoreAllMocks()
  })

  async function turnInterrupted(): Promise<{
    api: Record<string, unknown>
    pilotChat: ReturnType<typeof vi.fn>
  }> {
    const turn = deferred<{ ok: boolean }>()
    const pilotChat = vi.fn(() => turn.promise)
    const api = chatApi({ pilotChat })
    h = await mountChat(api)
    await h.click('.conv-pick')
    await h.type('ma tâche longue')
    await h.click('.composer-send')
    await act(async () => {
      turn.resolve({ ok: true })
      await new Promise((r) => setTimeout(r, 25))
    })
    return { api, pilotChat }
  }

  it('pré-remplit le composer avec le prompt d’origine ET le motif, SANS envoyer', async () => {
    const { api, pilotChat } = await turnInterrupted()
    expect(h!.container.textContent).toContain('Réponse interrompue avant la fin')

    await h!.click('[data-testid="resume-refine"]')

    const value = h!.textarea().value
    expect(value).toContain('ma tâche longue')
    expect(value).toContain('[reprise] le tour précédent a été interrompu avant la fin')
    // Aucun envoi : ni un second tour, ni une orchestration.
    expect(pilotChat).toHaveBeenCalledTimes(1)
    expect(api.orchestrate).not.toHaveBeenCalled()
  })

  it('cohabite avec « ↻ Reprendre » sans le remplacer', async () => {
    await turnInterrupted()
    const labels = [...h!.container.querySelectorAll('.msg-terminal-action')].map(
      (b) => b.textContent
    )
    expect(labels).toEqual(['↻ Reprendre', '✎ Reprendre en précisant…'])
  })
})
