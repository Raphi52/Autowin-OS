// @vitest-environment happy-dom
import { createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const RUN = {
  subject: 'workflow-bench-regression',
  session: 'attaché',
  path: 'runs/workflow-bench-regression/RUN.md',
  mtime: 1,
  summary: { status: 'bloqué', dodTotal: 0, dodChecked: 0, journalEvents: 0, defauts: 0 }
}

describe('ChatView — écho de périmètre avant l’envoi', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    vi.restoreAllMocks()
  })

  const echo = (): string | null =>
    h!.container.querySelector('[data-testid="scope-echo"]')?.textContent ?? null

  it('récapitule la phase PRÉSUMÉE et les cibles désignées, avant toute exécution', async () => {
    const api = chatApi({ conversationRuns: vi.fn().mockResolvedValue([RUN]) })
    h = await mountChat(api)
    await h.click('.conv-pick')
    await h.type('débloque @run:workflow-bench-regression')

    expect(echo()).toContain('phase probable : build')
    expect(echo()).toContain('cibles : run workflow-bench-regression')
    // Écho ≠ exécution : rien n’est parti.
    expect(api.pilotChat).not.toHaveBeenCalled()
  })

  it('reste muet sur un composer vide ou un message neutre', async () => {
    h = await mountChat(chatApi())
    await h.click('.conv-pick')
    expect(echo()).toBeNull()
    await h.type('bonjour')
    expect(echo()).toBeNull()
  })
})
