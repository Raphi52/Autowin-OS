// @vitest-environment happy-dom
/**
 * TRONCATURE À LA RÉOUVERTURE (conv-1376, « quand je suis retourné dans ma conversation »).
 *
 * Un tour initié CÔTÉ MAIN (scout de veille, tâche planifiée) sur une conversation NON ouverte amorce
 * un fil live pour que les patchs aient une cible. Cette amorce était écrite sur un cache VIDE : le
 * cache live devenait `[assistant streaming]`, alors qu'il fait AUTORITÉ à la réouverture
 * (`liveMessagesRef.current.get(id) ?? store`). Résultat : tout l'historique persisté disparaissait
 * de l'écran.
 *
 * Entrée qui doit faire échouer ce test si la correction est fausse : une conversation B qui possède
 * DÉJÀ un échange complet dans le store, jamais ouverte pendant la session, et qui reçoit un
 * événement pilote avant son premier clic. Si l'amorce n'est pas précédée d'une amorce du cache
 * depuis le store, « vieux message » et « vieille réponse » sont absents après le clic.
 */
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const stubs = [
  { id: 'A', title: 'Conversation A', category: 'codex', provider: 'codex', updatedAt: 3 },
  { id: 'B', title: 'Conversation B', category: 'codex', provider: 'codex', updatedAt: 2 }
]

const detail = (id: string): Record<string, unknown> =>
  id === 'B'
    ? {
        ...stubs[1],
        messages: [
          { role: 'user', content: 'vieux message', messageId: 'b1' },
          { role: 'assistant', content: 'vieille réponse', messageId: 'b2', done: true }
        ]
      }
    : { ...stubs[0], messages: [] }

describe('ChatView — tour initié côté main sur une conversation fermée', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null

  afterEach(async () => {
    localStorage.clear()
    await h?.unmount()
    h = null
    vi.restoreAllMocks()
  })

  it('la réouverture garde l’historique du store (pas de fil tronqué à l’amorce)', async () => {
    let pilote!: (event: Record<string, unknown>) => void
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue(stubs),
        conversation: vi.fn(async (id: string) => detail(id)),
        onPilotEvent: vi.fn((listener) => {
          pilote = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        })
      })
    )

    // B n'a jamais été ouverte : le main y démarre un tour.
    await act(async () =>
      pilote({ conversationId: 'B', kind: 'delta', text: 'je travaille', streamId: 's1' })
    )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    // L'utilisateur revient dans B.
    const picks = h.container.querySelectorAll('.conv-pick')
    await act(async () => (picks[1] as HTMLElement).click())
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    expect(h.container.textContent).toContain('vieux message')
    expect(h.container.textContent).toContain('vieille réponse')
    // Le tour en cours reste visible : l'amorce n'est pas perdue par la correction.
    expect(h.container.textContent).toContain('je travaille')
  })
})
