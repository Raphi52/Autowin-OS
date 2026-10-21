// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  chatApi,
  conversation,
  installRafShim,
  mountChat,
  type ChatHarness
} from './ChatView.harness'

/**
 * BOUTON DE SUITE DE LA NOTIFICATION, CÔTÉ CHAT (conv-1038, 2026-10-21). Le main émet
 * `suite-depuis-notification` quand l'utilisateur presse un bouton de la bulle de fin de tour : la
 * suite doit partir dans le fil DU TOUR, comme un message tapé, sans changer le fil affiché.
 *
 * Les entrées qui font échouer une version fausse : l'utilisateur regarde un AUTRE fil (la suite ne
 * doit pas partir dans le fil affiché) ; il y a un brouillon dans le fil du tour (il ne doit pas être
 * vidé par l'envoi de la suite).
 */
describe('ChatView — suite envoyée depuis la notification', () => {
  let h: ChatHarness | undefined
  beforeAll(installRafShim)
  afterEach(async () => {
    await h?.unmount()
    h = undefined
    window.localStorage.clear()
  })

  it('part dans le fil du tour, pas dans le fil affiché, sans vider son brouillon', async () => {
    window.localStorage.setItem('autowin.chat.brouillons', JSON.stringify({ A: 'brouillon de A' }))
    let app!: (event: Record<string, unknown>) => void
    const pilotChat = vi.fn().mockResolvedValue({ ok: true, messages: [] })
    const fils = [conversation('A'), conversation('B')]
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue(fils),
        conversation: vi.fn(async (id: string) => conversation(id)),
        pilotChat,
        onAppEvent: vi.fn((listener) => {
          app = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        })
      })
    )
    // L'utilisateur regarde B.
    const choix = [...h.container.querySelectorAll<HTMLElement>('.conv-pick')]
    const versB = choix.find((element) => element.textContent?.includes('Conversation B'))
    await act(async () => versB?.click())
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await act(async () => {
      app({ type: 'suite-depuis-notification', convId: 'A', texte: 'Lance le juge' })
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(pilotChat).toHaveBeenCalledTimes(1)
    expect(pilotChat.mock.calls[0][1]).toBe('A')
    const envoyes = pilotChat.mock.calls[0][0] as Array<{ role: string; content: string }>
    expect(envoyes.at(-1)).toMatchObject({ role: 'user', content: 'Lance le juge' })
    expect(
      h.container
        .querySelector('[data-testid="chat-view"]')
        ?.getAttribute('data-active-conversation-id')
    ).toBe('B')
    expect(JSON.parse(window.localStorage.getItem('autowin.chat.brouillons') ?? '{}').A).toBe(
      'brouillon de A'
    )
  })

  it('un texte vide n’envoie rien', async () => {
    let app!: (event: Record<string, unknown>) => void
    const pilotChat = vi.fn().mockResolvedValue({ ok: true, messages: [] })
    h = await mountChat(
      chatApi({
        pilotChat,
        onAppEvent: vi.fn((listener) => {
          app = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        })
      })
    )
    await act(async () => {
      app({ type: 'suite-depuis-notification', convId: 'A', texte: '   ' })
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(pilotChat).not.toHaveBeenCalled()
  })
})
