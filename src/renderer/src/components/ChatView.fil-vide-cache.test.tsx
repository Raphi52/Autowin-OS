// @vitest-environment happy-dom
/**
 * UN FIL DEJA OUVERT VIDE NE DOIT PAS RESTER VIDE POUR TOUJOURS.
 *
 * Constaté le 2026-09-01 (conv-82) : « les messages de conv-82 ont disparu » — la conversation
 * existait, la barre latérale comptait bien ses 5 messages, le disque les rendait tous, et l'écran
 * n'affichait RIEN. Chemin : une conversation ouverte alors qu'elle était encore vide (elle vient
 * d'être créée) laisse une entrée VIDE dans le cache d'affichage. L'agent la remplit ensuite côté
 * processus principal. À la réouverture, `liveMessagesRef.get(id) ?? relu` rendait ce tableau vide
 * — qui n'est pas `undefined` — et gagnait donc sur le store, pourtant plein.
 *
 * Règle : un cache VIDE n'est pas une information, c'est une absence. Le store fait foi.
 */
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, conversation, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

describe('ChatView — un cache d affichage vide ne masque pas un fil qui existe', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  afterEach(async () => {
    localStorage.clear()
    await h?.unmount()
    h = null
    vi.restoreAllMocks()
  })

  const messagesDeB = [
    { role: 'user', content: 'la demande faite à l agent' },
    {
      role: 'assistant',
      content: 'la réponse de l agent',
      parts: [{ kind: 'text', text: 'la réponse de l agent' }],
      status: 'completed',
      done: true
    }
  ]

  const ouvrir = async (harness: ChatHarness, titre: string): Promise<void> => {
    const cible = Array.from(harness.container.querySelectorAll('.conv-item')).find((element) =>
      (element.textContent ?? '').includes(titre)
    )?.querySelector('.conv-pick') as HTMLElement | undefined
    if (!cible) throw new Error(`conversation introuvable dans la liste : ${titre}`)
    await act(async () => {
      cible.click()
      await new Promise((r) => setTimeout(r, 20))
    })
  }

  it('rouvrir une conversation remplie APRES son ouverture à vide affiche ses messages', async () => {
    const liste = [
      { id: 'A', title: 'Conversation A', provider: 'codex', updatedAt: 200 },
      { id: 'B', title: 'Conversation B', provider: 'codex', updatedAt: 100 }
    ]
    // B est encore vide au moment où on l'ouvre : c'est une conversation qui vient d'être créée.
    let filDeB: unknown[] = []
    const conversationIpc = vi.fn(async (id: string) =>
      id === 'B' ? conversation('B', filDeB) : conversation('A', [])
    )
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue(liste),
        conversation: conversationIpc
      })
    )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    await ouvrir(h, 'Conversation B')
    expect(h.container.textContent).not.toContain('la réponse de l agent')

    // L'agent écrit dans B côté processus principal pendant qu'on regarde ailleurs.
    filDeB = messagesDeB
    await ouvrir(h, 'Conversation A')
    await ouvrir(h, 'Conversation B')

    expect(h.container.textContent).toContain('la demande faite à l agent')
    expect(h.container.textContent).toContain('la réponse de l agent')
  })
})
