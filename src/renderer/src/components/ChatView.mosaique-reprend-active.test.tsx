// @vitest-environment happy-dom
import { createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const { chatApi, installRafShim, mountChat } = await import('./ChatView.harness')
type Harness = Awaited<ReturnType<typeof mountChat>>

/**
 * Demande utilisateur du 2026-09-17 : « la mosaique, le probleme est que par defaut on peut avoir
 * des fois l'ecran a droite vide, il faudrait au moins prendre celui qui est selectionne ».
 *
 * Basculer en mosaique ne touchait PAS la liste des fenetres ouvertes : quand elle etait vide
 * (premiere bascule, ou apres « Tout fermer »), la moitie droite s'affichait vide alors qu'une
 * conversation etait ouverte juste avant le clic. La bascule reprend donc la conversation ACTIVE
 * comme premiere fenetre — et seulement quand il n'y en a aucune, pour ne pas rouvrir d'office une
 * fenetre que l'utilisateur venait de fermer.
 */
describe('ChatView — la mosaique reprend la conversation active', () => {
  beforeAll(installRafShim)
  let h: Harness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  const conversations = [
    { id: 'ancienne', title: 'Conversation ancienne', provider: 'codex', updatedAt: 100 },
    { id: 'recente', title: 'Conversation recente', provider: 'codex', updatedAt: 300 }
  ]

  const api = (): Record<string, unknown> =>
    chatApi({
      conversations: vi.fn().mockResolvedValue(conversations),
      conversation: vi.fn(async (id: string) => conversations.find((c) => c.id === id) ?? null)
    })

  const fenetres = (): string[] =>
    Array.from(h!.container.querySelectorAll('[data-conv-id]')).map(
      (element) => element.getAttribute('data-conv-id') ?? ''
    )

  it('ouvre la conversation active comme premiere fenetre au lieu d’une mosaique vide', async () => {
    window.localStorage.setItem('autowin.chat.conversationsViewMode', 'list')
    h = await mountChat(api())
    expect(h.container.querySelector('.conv-item.active .conv-label')?.textContent).toBe(
      'Conversation recente'
    )

    await h.click('[data-testid="conv-view-toggle"]')
    expect(fenetres()).toEqual(['recente'])
  })

  it('ne rouvre rien quand des fenetres sont deja ouvertes', async () => {
    window.localStorage.setItem('autowin.chat.conversationsViewMode', 'list')
    window.localStorage.setItem('autowin.chat.mosaicOpenIds', '["ancienne"]')
    h = await mountChat(api())

    await h.click('[data-testid="conv-view-toggle"]')
    expect(fenetres()).toEqual(['ancienne'])
  })
})
