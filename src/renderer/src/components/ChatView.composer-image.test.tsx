// @vitest-environment happy-dom
// La miniature d'une image EN ATTENTE dans le composer doit ouvrir le même viewer que celle d'un
// message déjà envoyé : sans ce clic, l'utilisateur ne peut pas vérifier ce qu'il va envoyer.
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

// L'encodage réel passe par un <canvas> pour la miniature : hors sujet ici, on injecte
// l'attachement déjà encodé pour ne tester QUE le rendu du chip et son clic.
vi.mock('./chat-attachments', async (importOriginal) => {
  const original = await importOriginal<typeof import('./chat-attachments')>()
  return {
    ...original,
    encodeAttachment: vi.fn(async (file: File) => {
      const isImage = file.type.startsWith('image/')
      return {
        name: file.name,
        mimeType: file.type,
        size: file.size,
        kind: isImage ? ('image' as const) : ('text' as const),
        content: 'YWJj',
        ...(isImage && { thumbnail: 'data:image/jpeg;base64,bWluaQ==' })
      }
    })
  }
})

const FULL = 'data:image/png;base64,YWJj'

describe('ChatView — prévisu cliquable dans la prompt box', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    document.body.querySelector('.image-lightbox')?.remove()
    vi.restoreAllMocks()
  })

  async function pasteImage(): Promise<void> {
    const file = new File(['abc'], 'collee.png', { type: 'image/png' })
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', { configurable: true, value: { files: [file] } })
    await act(async () => {
      h!.textarea().dispatchEvent(paste)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  it('ouvre l’image en attente dans le viewer au clic sur sa miniature', async () => {
    h = await mountChat(chatApi())
    await h.click('.conv-pick')
    await pasteImage()

    const button = h.container.querySelector(
      '.attachment-list.pending .attachment-thumb-button'
    ) as HTMLButtonElement
    expect(button).toBeTruthy()
    expect(button.getAttribute('aria-label')).toBe('Agrandir collee.png')
    expect(button.querySelector('img.attachment-thumb')?.getAttribute('src')).toBe(FULL)

    await act(async () => button.click())
    expect(
      document.body.querySelector('[role="dialog"][aria-label="Aperçu de collee.png"]')
    ).toBeTruthy()
    expect(document.body.querySelector('.image-lightbox img')?.getAttribute('src')).toBe(FULL)

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(document.body.querySelector('.image-lightbox')).toBeNull()
  })

  it('laisse le retrait de la pièce jointe intact — le × ne rouvre pas le viewer', async () => {
    h = await mountChat(chatApi())
    await h.click('.conv-pick')
    await pasteImage()

    const remove = [...h.container.querySelectorAll('.attachment-chip button')].find(
      (b) => b.getAttribute('aria-label') === 'Retirer collee.png'
    ) as HTMLButtonElement
    expect(remove).toBeTruthy()
    await act(async () => remove.click())

    expect(h.container.querySelector('.attachment-chip')).toBeNull()
    expect(document.body.querySelector('.image-lightbox')).toBeNull()
  })

  it('ne rend pas de bouton-loupe pour une pièce jointe non-image', async () => {
    h = await mountChat(chatApi())
    await h.click('.conv-pick')
    const file = new File(['x'], 'notes.txt', { type: 'text/plain' })
    Object.defineProperty(file, 'text', { configurable: true, value: async () => 'x' })
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', { configurable: true, value: { files: [file] } })
    await act(async () => {
      h!.textarea().dispatchEvent(paste)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(h.container.textContent).toContain('notes.txt')
    expect(h.container.querySelector('.attachment-thumb-button')).toBeNull()
  })
})
