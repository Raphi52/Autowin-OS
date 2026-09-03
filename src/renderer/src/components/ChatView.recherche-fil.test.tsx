// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const { chatApi, conversation, installRafShim, mountChat } = await import('./ChatView.harness')

/**
 * « Je veux pouvoir Ctrl+F dans la conversation » (conv-21).
 *
 * Ce que le test prouve, hors modèle : la barre s'ouvre au raccourci, elle COMPTE les
 * occurrences réellement présentes dans le fil rendu, Entrée avance en boucle, Échap ferme.
 */
const FIL = [
  { role: 'user', content: 'le premier terrain est ici' },
  { role: 'user', content: 'et un second terrain plus loin' },
  { role: 'user', content: 'rien de pertinent' }
]

const conv = { ...conversation('A', FIL), title: 'Conversation A' }

const api = (): Record<string, unknown> =>
  chatApi({
    conversations: vi.fn().mockResolvedValue([conv]),
    conversation: vi.fn().mockResolvedValue(conv)
  })

const raccourci = async (): Promise<void> => {
  await act(async () => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true })
    )
  })
}

const attendreAmortissement = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 260))
  })
}

let fermer: (() => Promise<void>) | null = null

beforeAll(() => installRafShim())
afterEach(async () => {
  await fermer?.()
  fermer = null
})

describe('Ctrl+F dans la conversation', () => {
  it('ouvre la barre, compte les occurrences, boucle et se ferme', async () => {
    const harness = await mountChat(api())
    fermer = harness.unmount

    expect(harness.container.querySelector('[data-testid="chat-find"]')).toBeNull()

    await raccourci()
    const barre = harness.container.querySelector('[data-testid="chat-find"]')
    expect(barre).not.toBeNull()

    const champ = harness.container.querySelector(
      '[data-testid="chat-find-input"]'
    ) as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(champ, 'terrain')
      champ.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await attendreAmortissement()

    const compteur = (): string =>
      harness.container.querySelector('[data-testid="chat-find-count"]')?.textContent ?? ''
    expect(compteur()).toBe('1/2')

    const entree = async (options: KeyboardEventInit = {}): Promise<void> => {
      await act(async () => {
        champ.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...options })
        )
      })
    }
    await entree()
    expect(compteur()).toBe('2/2')
    await entree()
    expect(compteur()).toBe('1/2')
    await entree({ shiftKey: true })
    expect(compteur()).toBe('2/2')

    await act(async () => {
      champ.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      )
    })
    expect(harness.container.querySelector('[data-testid="chat-find"]')).toBeNull()
  })

  it('dit clairement quand le terme est introuvable', async () => {
    const harness = await mountChat(api())
    fermer = harness.unmount
    await raccourci()
    const champ = harness.container.querySelector(
      '[data-testid="chat-find-input"]'
    ) as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(champ, 'introuvable-xyz')
      champ.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await attendreAmortissement()
    expect(
      harness.container.querySelector('[data-testid="chat-find-count"]')?.textContent
    ).toContain('Aucun')
  })
})
