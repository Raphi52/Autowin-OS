// @vitest-environment happy-dom
import { act, createElement } from 'react'
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

const fil = (suite: string): unknown[] => [
  { role: 'user', content: 'salut' },
  {
    role: 'assistant',
    content: `✅ Fait\nla correction\n\n👉 Recommandé\npasser en terrain\n\nAUTOWIN_PROMPT_V1: ${suite}`
  }
]

/**
 * DÉFAUT VÉCU (2026-09-02) : « j'ai mis le mode auto et je dois encore faire tab+entrée ».
 * Allumer l'interrupteur EST le geste qui demande d'envoyer la suite proposée sous les yeux.
 * L'amorce anti-vieille-réponse (pensée pour le CHANGEMENT DE FIL) marquait aussi ce tour-là comme
 * déjà traité : rien ne partait, l'utilisateur devait faire Tab+Entrée à la main.
 */
describe('ChatView — allumer le mode auto envoie la suite déjà affichée', () => {
  beforeAll(installRafShim)
  let h: Harness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('un clic sur « Mode auto » part avec le prompt suivant du dernier message', async () => {
    const messages = fil('lance le terrain sur X')
    const pilotChat = vi.fn().mockResolvedValue({ ok: true })
    h = await mountChat(
      chatApi({
        pilotChat,
        conversations: vi.fn().mockResolvedValue([conversation('A', messages)]),
        conversation: vi.fn(async (id: string) => conversation(id, messages))
      })
    )
    await h.click('.conv-item .conv-pick')
    expect(pilotChat).not.toHaveBeenCalled()
    await h.click('[data-testid="conv-auto-toggle"]')
    const envoyes = pilotChat.mock.calls.map((c) => JSON.stringify(c[0])).join('\n')
    expect(envoyes).toContain('lance le terrain sur X')
  })

  it('ouvrir un AUTRE fil ne relance pas sa vieille réponse', async () => {
    const filA = fil('lance le terrain sur A')
    const filB = fil('relance le vieux chantier B')
    const pilotChat = vi.fn().mockResolvedValue({ ok: true })
    h = await mountChat(
      chatApi({
        pilotChat,
        conversations: vi.fn().mockResolvedValue([conversation('A', filA), conversation('B', filB)]),
        conversation: vi.fn(async (id: string) => conversation(id, id === 'A' ? filA : filB))
      })
    )
    await h.click('.conv-item .conv-pick')
    await h.click('[data-testid="conv-auto-toggle"]')
    const dejaEnvoyes = pilotChat.mock.calls.length
    const picks = [...h.container.querySelectorAll<HTMLButtonElement>('.conv-pick')]
    expect(picks.length).toBeGreaterThan(1)
    await act(async () => picks[1].click())
    const suite = pilotChat.mock.calls
      .slice(dejaEnvoyes)
      .map((c) => JSON.stringify(c[0]))
      .join('\n')
    expect(suite).not.toContain('relance le vieux chantier B')
  })
})
