// @vitest-environment happy-dom
import { createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const { chatApi, conversation, installRafShim, mountChat } = await import('./ChatView.harness')
type Harness = Awaited<ReturnType<typeof mountChat>>

/**
 * UN CACHE VIDE EST UNE ABSENCE, PAS UN FIL — meme regle qu'au chat plein (conv-82).
 *
 * Une conversation ouverte en mosaique alors qu'elle etait encore vide laissait un tableau vide
 * dans le cache d'affichage. L'agent la remplit ensuite cote processus principal, sans passer par
 * ce cache : a la reouverture de la fenetre, ce vide GAGNAIT sur un store plein et la fenetre
 * revenait « creuse » (« Aucun message. ») alors que la conversation etait intacte.
 */
describe('ChatView — fenetre de mosaique rouverte apres remplissage', () => {
  beforeAll(installRafShim)
  let h: Harness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('repeint depuis le store quand le cache de la fenetre est vide', async () => {
    let rempli = false
    window.localStorage.setItem('autowin.chat.conversationsViewMode', 'mosaic')
    window.localStorage.setItem('autowin.chat.mosaicOpenIds', '[]')
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([conversation('A')]),
        conversation: vi.fn(async (id: string) =>
          conversation(id, rempli ? [{ role: 'user', content: 'salut-du-disque' }] : [])
        )
      })
    )
    // 1) Ouverture alors que la conversation est encore VIDE → cache d'affichage vide.
    await h.click('[data-testid="conv-mosaic-toggle-A"]')
    expect(h.container.querySelector('[data-conv-id="A"]')!.textContent).toContain('Aucun message.')
    // 2) Le tour se joue cote main : le store se remplit sans passer par ce cache.
    rempli = true
    // 3) Fermeture puis reouverture de la fenetre.
    await h.click('[data-testid="conv-mosaic-toggle-A"]')
    await h.click('[data-testid="conv-mosaic-toggle-A"]')
    const fenetre = h.container.querySelector('[data-conv-id="A"]')
    expect(fenetre).not.toBeNull()
    expect(fenetre!.textContent).toContain('salut-du-disque')
    expect(fenetre!.textContent).not.toContain('Aucun message.')
  })
})
