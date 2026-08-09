// @vitest-environment happy-dom
import { createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'
import { STATIC_SUGGESTIONS } from './chat-home-suggestions'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const blockedRun = (subject: string) => ({
  subject,
  session: 'attaché',
  path: `runs/${subject}/RUN.md`,
  mtime: 1,
  summary: { status: 'bloqué', dodTotal: 0, dodChecked: 0, journalEvents: 0, defauts: 0 }
})

describe('ChatView — la home propose l’état réel, plus quatre phrases figées', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    vi.restoreAllMocks()
  })

  it('affiche une chip par run bloqué, avec la mention @run prête à l’emploi', async () => {
    h = await mountChat(
      chatApi({
        conversationRuns: vi.fn().mockResolvedValue([blockedRun('workflow-bench-regression')])
      })
    )
    await h.click('.conv-pick')
    const chips = [...h.container.querySelectorAll('[data-testid="sg-chip"]')].map(
      (c) => c.textContent
    )
    expect(chips).toContain('Débloque @run:workflow-bench-regression')
  })

  it('retombe sur le jeu statique quand aucun run n’est bloqué', async () => {
    h = await mountChat(chatApi())
    await h.click('.conv-pick')
    const chips = [...h.container.querySelectorAll('[data-testid="sg-chip"]')].map(
      (c) => c.textContent
    )
    expect(chips).toEqual(STATIC_SUGGESTIONS)
  })

  it('un clic sur une chip ENVOIE son prompt', async () => {
    const mockApi = chatApi()
    h = await mountChat(mockApi)
    await h.click('.conv-pick')
    await h.click('[data-testid="sg-chip"]')
    const payload = (mockApi.pilotChat as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{
      content: string
    }>
    expect(payload[payload.length - 1].content).toBe(STATIC_SUGGESTIONS[0])
  })
})
