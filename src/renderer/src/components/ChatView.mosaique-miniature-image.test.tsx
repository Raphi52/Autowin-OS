// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

// L'encodage réel passe par un <canvas> : hors sujet ici, on injecte l'image déjà encodée.
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

const { chatApi, conversation, installRafShim, mountChat } = await import('./ChatView.harness')
type Harness = Awaited<ReturnType<typeof mountChat>>

const FULL = 'data:image/png;base64,YWJj'

/**
 * DEMANDE du 2026-10-10 (conv-167) : « en mode mosaique met une miniature des images comme en mode
 * conversation ». Le composer de la mosaïque affichait l'icône générique ▤ pour une image collée,
 * là où le chat plein montre la miniature cliquable. Cause : deux copies du même rendu de pièce
 * jointe, dont une seule avait reçu la miniature.
 *
 * ENTREE QUI FAIT ECHOUER CE TEST SI LA CORRECTION EST FAUSSE : une image collée dans la fenêtre
 * mosaïque de A. Sans miniature, `.attachment-thumb-button` est absent → rouge.
 */
describe('ChatView — miniature d’image dans le composer de la mosaïque', () => {
  beforeAll(installRafShim)
  let h: Harness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    document.body.querySelector('.image-lightbox')?.remove()
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('montre la miniature cliquable de l’image collée, comme le chat plein', async () => {
    window.localStorage.setItem('autowin.chat.conversationsViewMode', 'mosaic')
    window.localStorage.setItem('autowin.chat.mosaicOpenIds', '[]')
    h = await mountChat(chatApi({ conversations: vi.fn().mockResolvedValue([conversation('A')]) }))
    await h.click('[data-testid="conv-mosaic-toggle-A"]')
    const fenetre = h.container.querySelector('[data-conv-id="A"]') as HTMLElement
    expect(fenetre).not.toBeNull()
    const champ = fenetre.querySelector('textarea') as HTMLTextAreaElement
    expect(champ).not.toBeNull()

    const file = new File(['abc'], 'collee.png', { type: 'image/png' })
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', { configurable: true, value: { files: [file] } })
    await act(async () => {
      champ.dispatchEvent(paste)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const chip = fenetre.querySelector('.attachment-list.pending .attachment-chip')
    expect(chip).not.toBeNull()
    expect(chip!.textContent).not.toContain('▤')
    const bouton = chip!.querySelector('.attachment-thumb-button') as HTMLButtonElement
    expect(bouton).not.toBeNull()
    expect(bouton.getAttribute('aria-label')).toBe('Agrandir collee.png')
    expect(bouton.querySelector('img.attachment-thumb')?.getAttribute('src')).toBe(FULL)

    await act(async () => bouton.click())
    expect(
      document.body.querySelector('[role="dialog"][aria-label="Aperçu de collee.png"]')
    ).not.toBeNull()
  })
})
