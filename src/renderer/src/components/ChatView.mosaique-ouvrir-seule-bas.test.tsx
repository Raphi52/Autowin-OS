// @vitest-environment happy-dom
/**
 * OUVRIR UNE CONVERSATION SEULE DEPUIS LA MOSAIQUE — elle doit s'ouvrir EN BAS.
 *
 * Defaut rapporte le 2026-09-02 : « quand je clique depuis la mosaique sur aller vers la
 * conversation en grand, ca me met pas scrolle jusqu'au dernier message, j'ai du cliquer sur
 * dernier message ».
 *
 * Cause : le fil plein ecran n'est PAS rendu en mosaique — il est MONTE au moment du clic, donc il
 * nait en haut. Et quand la conversation ouverte etait deja l'active, `loadConv` repose le MEME
 * tableau de messages : React ne re-rend pas, l'effet d'atterrissage ne se rejoue jamais, et
 * personne ne descend.
 */
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, conversation, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'
import { CLE_DERNIERE_CONVERSATION } from './derniere-conversation'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): null => null
}))

/** happy-dom rend 0 partout : sans metriques, « descendre » n'a aucune trace observable. */
function poserMetriquesDuFil(): void {
  const estFil = (element: HTMLElement): boolean => element.classList.contains('chat-scroll')
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return estFil(this) ? 4000 : 0
    }
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return estFil(this) ? 500 : 0
    }
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    writable: true,
    value(this: HTMLElement, options: ScrollToOptions) {
      this.scrollTop = Math.min(options.top ?? 0, 3500)
    }
  })
}

/** Laisse tourner les frames (rAF = setTimeout 0 dans le harnais). */
async function frames(nombre = 6): Promise<void> {
  for (let i = 0; i < nombre; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

describe('ChatView — sortie de mosaique', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('ouvre le fil plein ecran DEJA descendu au dernier message', async () => {
    const fil = [
      { role: 'user', content: 'question' },
      { role: 'assistant', content: 'reponse' }
    ]
    const conv = conversation('A', fil)
    window.localStorage.setItem('autowin.chat.conversationsViewMode', 'mosaic')
    window.localStorage.setItem('autowin.chat.mosaicOpenIds', '["A"]')
    // La conversation ouverte en mosaique est aussi la DERNIERE active : c'est le cas ou rien ne
    // re-rendait le fil.
    window.localStorage.setItem(CLE_DERNIERE_CONVERSATION, 'A')
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([conv]),
        conversation: vi.fn().mockResolvedValue(conv)
      })
    )
    await frames(3)
    poserMetriquesDuFil()
    await h.click('[data-testid="chat-mosaic-open"]')
    await frames()
    const scroll = h.container.querySelector('.chat-scroll') as HTMLElement
    expect(scroll).not.toBeNull()
    expect(scroll.scrollTop).toBeGreaterThan(0)
  })
})
