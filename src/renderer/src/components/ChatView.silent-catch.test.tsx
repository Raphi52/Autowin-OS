// @vitest-environment happy-dom
/**
 * Les `catch {}` MUETS faisaient disparaître l'échec sans laisser la moindre trace : impossible de
 * diagnostiquer un rejeu vide ou une reprise automatique qui n'a jamais eu lieu. Chaque échec
 * avalé laisse désormais une trace `[chat] <scope>`.
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

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

describe('ChatView — échecs avalés', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  let warn: ReturnType<typeof vi.spyOn>
  beforeAll(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(async () => {
    await h?.unmount()
    h = null
    warn.mockClear()
  })

  const scopes = (): string[] => warn.mock.calls.map((call) => String(call[0]))

  it('trace l’échec de lecture des tours inachevés (reprise automatique)', async () => {
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([conversation('A', [])]),
        unfinishedTurns: vi.fn().mockRejectedValue(new Error('index illisible'))
      })
    )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(scopes().some((scope) => scope.includes('unfinished-turns'))).toBe(true)
  })

  it('trace l’échec de lecture du journal de tour (rejeu)', async () => {
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([conversation('A', [])]),
        turnJournal: vi.fn().mockRejectedValue(new Error('journal absent'))
      })
    )
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('autowin:open-conversation', {
          detail: { conversationId: 'A', turnId: 't1' }
        })
      )
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(scopes().some((scope) => scope.includes('turn-journal'))).toBe(true)
  })
})
