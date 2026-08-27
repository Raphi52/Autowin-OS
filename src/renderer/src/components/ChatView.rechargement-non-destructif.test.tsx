// @vitest-environment happy-dom
/**
 * Un RECHARGEMENT ne doit jamais EFFACER le fil affiché.
 *
 * Constaté le 2026-08-27 : une conversation « arrêtait de s'afficher » — l'écran retombait sur
 * l'accueil « Parle à l'agent » (avec les chips de runs de la conversation TOUJOURS active) alors
 * que ses messages étaient bien dans le store. Le chemin : un événement `refresh` de portée `chat`
 * supprime le cache live du fil puis relit la conversation ; quand cette relecture rend un fil plus
 * court — VIDE dans le cas d'un tour en vol non encore persisté — le fil affiché était remplacé par
 * ce vide. Le fil ne peut que GRANDIR sur un rechargement : un store plus pauvre ne fait pas foi.
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

describe('ChatView — le rechargement ne vide pas le fil', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  afterEach(async () => {
    localStorage.clear()
    await h?.unmount()
    h = null
    vi.restoreAllMocks()
  })

  it('un refresh chat dont la relecture rend un fil VIDE laisse le fil affiché intact', async () => {
    const messages = [
      { role: 'user', content: 'ma question' },
      {
        role: 'assistant',
        content: 'ma réponse',
        parts: [{ kind: 'text', text: 'ma réponse' }],
        status: 'completed',
        done: true
      }
    ]
    const conversationIpc = vi.fn().mockResolvedValue(conversation('A', messages))
    let emit: ((event: { type: string; scope?: string; convId?: string }) => void) | null = null
    h = await mountChat(
      chatApi({
        conversations: vi
          .fn()
          .mockResolvedValue([
            { id: 'A', title: 'Conversation A', provider: 'codex', updatedAt: 1 }
          ]),
        conversation: conversationIpc,
        onAppEvent: vi.fn((listener: (e: unknown) => void) => {
          emit = listener as typeof emit
          return vi.fn()
        })
      })
    )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    // Le boot ouvre la plus récente : le fil est peint.
    expect(h.container.textContent).toContain('ma question')

    // Le store répond désormais un fil VIDE (tour en vol non persisté, écriture en cours…).
    conversationIpc.mockResolvedValue(conversation('A', []))
    await act(async () => {
      emit?.({ type: 'refresh', scope: 'chat', convId: 'A' })
      await new Promise((r) => setTimeout(r, 20))
    })

    expect(h.container.querySelector('.chat-welcome')).toBeNull()
    expect(h.container.textContent).toContain('ma question')
    expect(h.container.textContent).toContain('ma réponse')
  })
})
