// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

/**
 * DEFAUT VECU le 2026-10-13 (conv-937) : « ca m'empeche d'upload des fichiers et de preparer mon
 * prochain prompt pendant que la conv travaille ». Le bouton trombone et son champ fichier cache
 * portaient `disabled={busy}` : tant qu'un tour tournait, on ne pouvait plus joindre de fichier
 * par le bouton (le collage et le depot, eux, marchaient deja).
 *
 * ENTREE QUI FAIT ECHOUER CE TEST SI LA CORRECTION EST FAUSSE : un tour en cours (delta recu), puis
 * un fichier choisi par le champ du trombone. Si `disabled={busy}` revient, le bouton est
 * desactive et le champ refuse l'ajout → rouge.
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
      kind: 'text' as const,
      content: 'YWJj'
    }))
  }
})

describe('ChatView — joindre un fichier pendant qu’un tour tourne', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    vi.restoreAllMocks()
  })

  it('le trombone reste actif et le fichier choisi rejoint le brouillon', async () => {
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

    // Un tour tourne (delta recu) ⇒ `busy` est vrai pour la conversation A.
    await act(async () => pilote({ conversationId: 'A', kind: 'delta', delta: 'je travaille' }))
    expect(h.container.querySelector('[data-testid="composer-stop"]')).toBeTruthy()

    const bouton = h.container.querySelector('.attachment-button') as HTMLButtonElement
    const champ = h.container.querySelector('.attachment-input') as HTMLInputElement
    expect(bouton.disabled).toBe(false)
    expect(champ.disabled).toBe(false)
    // Même famille que ∞ et le micro : sans `btn` il retombe dans son style à part.
    expect(bouton.classList.contains('btn')).toBe(true)

    const fichier = new File(['abc'], 'notes.txt', { type: 'text/plain' })
    Object.defineProperty(champ, 'files', { configurable: true, value: [fichier] })
    await act(async () => {
      champ.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(h.container.querySelector('.attachment-list.pending')).toBeTruthy()
    // Le texte du prochain prompt se prépare aussi : le champ n'est pas verrouillé.
    expect(h.textarea().disabled).toBe(false)
  })
})
