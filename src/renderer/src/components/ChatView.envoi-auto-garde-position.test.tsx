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

/**
 * Defaut vecu le 2026-09-13 (conv-518) : en mode auto, le chat redescendait tout seul a chaque tour
 * enchaine alors que le lecteur avait remonte. Cause : `send()` remettait le suivi du bas a chaque
 * envoi, y compris les envois AUTOMATIQUES. Un envoi automatique doit garder la position du lecteur.
 */
describe('ChatView — un envoi automatique garde la position du lecteur remonte', () => {
  beforeAll(installRafShim)
  let h: Harness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('le mode auto envoie la suite sans ramener le fil en bas', async () => {
    const messages = [
      { role: 'user', content: 'salut' },
      {
        role: 'assistant',
        content: '✅ Fait\nla correction\n\n👉 Recommandé\npasser en terrain\n\nAUTOWIN_PROMPT_V1: lance la suite'
      }
    ]
    const pilotChat = vi.fn().mockResolvedValue({ ok: true })
    h = await mountChat(
      chatApi({
        pilotChat,
        conversations: vi.fn().mockResolvedValue([conversation('A', messages)]),
        conversation: vi.fn(async (id: string) => conversation(id, messages))
      })
    )
    await h.click('.conv-item .conv-pick')
    const scroll = h.container.querySelector('.chat-scroll') as HTMLElement
    Object.defineProperty(scroll, 'clientHeight', { value: 500, configurable: true })
    Object.defineProperty(scroll, 'scrollHeight', { value: 5000, configurable: true })
    // La descente d'ouverture est une boucle de frames encore vivante : on la laisse finir.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1200))
    })
    scroll.scrollTo = ((options: ScrollToOptions) => {
      scroll.scrollTop = Math.max(0, (options.top ?? 0) - 500)
    }) as HTMLElement['scrollTo']

    // Le lecteur REMONTE a la molette.
    scroll.scrollTop = 0
    await act(async () => {
      scroll.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))
      scroll.dispatchEvent(new Event('scroll'))
    })

    await h.click('[data-testid="composer-auto-toggle"]')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300))
    })

    expect(JSON.stringify(pilotChat.mock.calls)).toContain('lance la suite')
    expect(scroll.scrollTop).toBeLessThan(100)
  })
})
