// @vitest-environment happy-dom
/**
 * Le bouton « Exporter .md » de l'entête écrit le fil AFFICHÉ dans un fichier Markdown.
 *
 * Garanties : il est désactivé quand il n'y a rien à exporter, et le blob produit contient le
 * texte réel des tours (pas une sérialisation brute des parts).
 */
import { createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const stub = { id: 'A', title: 'Ma conv', category: 'codex', provider: 'codex', updatedAt: 1 }

describe('ChatView — export Markdown', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    vi.restoreAllMocks()
  })

  const bouton = (): HTMLButtonElement =>
    h?.container.querySelector('[data-testid="chat-export-markdown"]') as HTMLButtonElement

  async function monter(messages: unknown[]): Promise<void> {
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([stub]),
        conversation: vi.fn(async (id: string) => ({ ...stub, id, messages })),
        conversationRuns: vi.fn().mockResolvedValue([])
      })
    )
    await h.click('.conv-pick')
  }

  it('est désactivé sur une conversation vide', async () => {
    await monter([])
    expect(bouton()).toBeTruthy()
    expect(bouton().disabled).toBe(true)
  })

  it('déclenche un téléchargement dont le contenu porte les tours affichés', async () => {
    await monter([
      { role: 'user', content: 'salut' },
      { role: 'assistant', content: 'bonjour', parts: [{ kind: 'text', text: 'bonjour' }] }
    ])
    const blobs: Blob[] = []
    const createObjectURL = vi.fn((b: Blob) => {
      blobs.push(b)
      return 'blob:x'
    })
    ;(URL as unknown as { createObjectURL: unknown }).createObjectURL = createObjectURL
    ;(URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn()
    const clic = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    expect(bouton().disabled).toBe(false)
    await h!.click('[data-testid="chat-export-markdown"]')

    expect(clic).toHaveBeenCalled()
    expect(blobs).toHaveLength(1)
    const texte = await blobs[0].text()
    expect(texte).toContain('# Ma conv')
    expect(texte).toContain('salut')
    expect(texte).toContain('bonjour')
    expect(texte).not.toContain('"kind"')
  })
})
