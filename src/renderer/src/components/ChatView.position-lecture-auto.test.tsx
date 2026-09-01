// @vitest-environment happy-dom
/**
 * REPRISE DE LECTURE — une position ne se retient que si le LECTEUR a bouge le fil.
 *
 * Defaut rapporte le 2026-09-01 (conv-61) : « je clique sur dernier message, je suis en bas ; je
 * change de conversation, je reviens, et je suis scrolle au MILIEU ». Les evenements `scroll` emis
 * par l'app elle-meme (ouverture d'une conversation, descente automatique) etaient memorises comme
 * une position de lecture choisie : la derniere frame d'une descente qui n'atterrit pas ecrivait un
 * milieu de fil, et la reouverture y revenait.
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
import { CLE_POSITION_LECTURE } from './position-lecture'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

/** Impose des metriques de defilement : happy-dom rend 0 partout, donc « pres du bas » serait vrai. */
function poserMetriques(element: HTMLElement, top: number): void {
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 4000 })
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: 500 })
  let courant = top
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => courant,
    set: (v: number) => {
      courant = v
    }
  })
}

async function fil(): Promise<{ h: ChatHarness; scroll: HTMLElement }> {
  const conv = conversation('A', [
    { role: 'user', content: 'question' },
    { role: 'assistant', content: 'reponse' }
  ])
  const h = await mountChat(
    chatApi({
      conversations: vi.fn().mockResolvedValue([conv]),
      conversation: vi.fn().mockResolvedValue(conv)
    })
  )
  await h.click('.conv-pick')
  const scroll = h.container.querySelector('.chat-scroll') as HTMLElement
  expect(scroll).not.toBeNull()
  return { h, scroll }
}

describe('ChatView — memoire de la position de lecture', () => {
  beforeAll(installRafShim)
  let harness: ChatHarness | null = null
  afterEach(async () => {
    localStorage.clear()
    await harness?.unmount()
    harness = null
    vi.restoreAllMocks()
  })

  it("un defilement provoque par l'app ne memorise AUCUNE position", async () => {
    const { h, scroll } = await fil()
    harness = h
    poserMetriques(scroll, 1200)
    await act(async () => {
      scroll.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    expect(localStorage.getItem(CLE_POSITION_LECTURE) ?? '{}').not.toContain('"A"')
  })

  it('un geste du lecteur (molette) memorise bien sa position', async () => {
    const { h, scroll } = await fil()
    harness = h
    await act(async () => {
      scroll.dispatchEvent(new Event('wheel', { bubbles: true }))
    })
    poserMetriques(scroll, 1200)
    await act(async () => {
      scroll.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    const memoire = JSON.parse(localStorage.getItem(CLE_POSITION_LECTURE) ?? '{}')
    expect(memoire.A?.top).toBe(1200)
  })
})
