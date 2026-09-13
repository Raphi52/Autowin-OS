// @vitest-environment happy-dom
/**
 * SCINDER ICI — la suite du fil part dans une conversation neuve et QUITTE celle-ci.
 *
 * Forker copie le début et n'allège rien : le passé lourd est alors payé deux fois. Mesure du
 * 2026-09-13 (cost.jsonl) : 1 952 tours de chat dépassent 400 000 jetons d'entrée et totalisent
 * 2 563 $, soit 62 % de la dépense. Ce test exige que le geste APPELLE la scission avec le message
 * visé — une correction qui se contenterait d'afficher le bouton échouerait ici.
 */
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  chatApi,
  conversation,
  installRafShim,
  mountChat,
  type ChatHarness
} from './ChatView.harness'

vi.mock('./Markdown', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const fil = [
  { role: 'user', content: 'u1', ts: 1, messageId: 'm1' },
  {
    role: 'assistant',
    content: 'a1',
    ts: 1,
    messageId: 'm2',
    status: 'completed',
    parts: [{ kind: 'text', text: 'a1' }]
  }
]

describe('ChatView — scinder un fil', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    vi.restoreAllMocks()
  })

  it('le geste « scinder » appelle la scission sur le message visé', async () => {
    const conversationsSplit = vi.fn().mockResolvedValue({
      source: { id: 'A' },
      cible: { id: 'A-scinde' }
    })
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([conversation('A', fil)]),
        conversationsSplit
      })
    )
    await h.click('.conv-pick')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    const boutons = h.container.querySelectorAll('[data-testid="msg-split"]')
    expect(boutons.length).toBeGreaterThan(0)
    await h.click('[data-testid="msg-split"]')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    expect(conversationsSplit).toHaveBeenCalledWith('A', 'm1')
  })
})
