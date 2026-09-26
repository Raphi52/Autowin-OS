// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

/**
 * DEFAUT VECU le 2026-09-17 : « quand j'envoie un message pendant que tu travailles, ca n'envoie
 * pas — ou alors quand il contient une image ».
 *
 * Une image COLLEE pendant un tour, SANS texte, etait jetee en silence : `queueCurrentMessage` (et
 * l'equivalent en mosaique) sortait sur `!input.trim()`, sans regarder les pieces jointes. Le
 * composer gardait l'image, rien ne partait, rien n'apparaissait.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST SI LA CORRECTION EST FAUSSE : Entree avec une image et
 * AUCUN texte pendant que `busy` est vrai. Si la garde regarde encore le seul texte, l'image reste
 * dans le composer → rouge.
 */
vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

vi.mock('./chat-attachments', async (importOriginal) => {
  const original = await importOriginal<typeof import('./chat-attachments')>()
  return {
    ...original,
    encodeAttachment: vi.fn(async (file: File) => ({
      name: file.name,
      mimeType: file.type,
      size: file.size,
      kind: 'image' as const,
      content: 'YWJj',
      thumbnail: 'data:image/jpeg;base64,bWluaQ=='
    }))
  }
})

describe('ChatView — une image collee pendant un tour part quand meme', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    vi.restoreAllMocks()
  })

  it('Entree sans texte, image en attente, tour en cours ⇒ l’image quitte le composer', async () => {
    let pilote!: (event: Record<string, unknown>) => void
    h = await mountChat(
      chatApi({
        onPilotEvent: vi.fn((listener) => {
          pilote = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        })
      })
    )
    await h.click('.conv-pick')

    const file = new File(['abc'], 'collee.png', { type: 'image/png' })
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', { configurable: true, value: { files: [file] } })
    await act(async () => {
      h!.textarea().dispatchEvent(paste)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(h.container.querySelector('.attachment-list.pending')).toBeTruthy()

    // Un tour tourne (delta recu) ⇒ `busy` est vrai pour la conversation A.
    await act(async () => pilote({ conversationId: 'A', kind: 'delta', delta: 'je travaille' }))

    await act(async () => {
      h!
        .textarea()
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(h.container.querySelector('.attachment-list.pending')).toBeNull()
  })
})
