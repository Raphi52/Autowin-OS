// @vitest-environment happy-dom
import { createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (texte: string): string | null => {
    const m = texte.match(/👉\s*Recommandé\s*\n([^\n]+)/u)
    return m ? m[1] : null
  }
}))

const { chatApi, conversation, installRafShim, mountChat } = await import('./ChatView.harness')
type Harness = Awaited<ReturnType<typeof mountChat>>

/**
 * conv-113 (2026-10-06) : la saisie ts 1791317725882, envoyée SEULE par le mode auto 0,6 s après la
 * fin du tour 0b93aa21-54c3-4be3-99f4-a23bbcb00bc4, était journalisée `voie: "message"` — comme la
 * saisie TAPÉE ts 1791317691042. L'utilisateur affirmait « il était pas coché » : rien sur le disque
 * ne permettait de dire si ce texte venait de lui ou de la machine. L'origine est désormais écrite.
 */
describe('ChatView — le journal des saisies dit quand le mode auto a envoyé seul', () => {
  beforeAll(installRafShim)
  let h: Harness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('une suite envoyée par ∞ est journalisée avec origine « mode-auto »', async () => {
    const messages = [
      { role: 'user', content: "ou t'as mis le projet paper trading ?" },
      {
        role: 'assistant',
        content:
          '✅ Fait\nla réponse\n\n👉 Recommandé\nreprendre\n\nAUTOWIN_PROMPT_V1: Reprends la mesure'
      }
    ]
    const journaliserSaisie = vi.fn().mockResolvedValue({ ok: true })
    h = await mountChat(
      chatApi({
        pilotChat: vi.fn().mockResolvedValue({ ok: true }),
        journaliserSaisie,
        conversations: vi.fn().mockResolvedValue([conversation('A', messages)]),
        conversation: vi.fn(async (id: string) => conversation(id, messages))
      })
    )
    await h.click('.conv-item .conv-pick')
    await h.click('[data-testid="composer-auto-toggle"]')
    const auto = journaliserSaisie.mock.calls.find((c) =>
      String(c[1]).startsWith('Reprends la mesure')
    )
    expect(auto).toBeDefined()
    expect(auto?.[2]).toBe('message')
    expect(auto?.[3]).toBe('mode-auto')
  })

  it('un message tapé ne porte aucune origine automatique', async () => {
    const journaliserSaisie = vi.fn().mockResolvedValue({ ok: true })
    h = await mountChat(
      chatApi({
        pilotChat: vi.fn().mockResolvedValue({ ok: true }),
        journaliserSaisie,
        conversations: vi.fn().mockResolvedValue([conversation('A', [])]),
        conversation: vi.fn(async (id: string) => conversation(id, []))
      })
    )
    await h.click('.conv-item .conv-pick')
    await h.type("ou t'as mis le projet paper trading ?")
    await h.click('.composer-send')
    const tape = journaliserSaisie.mock.calls.find((c) => String(c[1]).startsWith('ou t'))
    expect(tape).toBeDefined()
    expect(tape?.[3]).toBeUndefined()
  })
})
