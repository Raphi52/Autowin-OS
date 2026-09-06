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
 * Demandé le 2026-09-06 : ouvrir une conversation (existante ou neuve) doit poser le curseur
 * DANS le champ de saisie. Sans ça, chaque bascule coûtait un clic supplémentaire.
 */
describe('ChatView — le champ de saisie prend le focus au changement de conversation', () => {
  beforeAll(installRafShim)
  let h: Harness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
  })

  const attendreFrames = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }

  it('focalise le champ quand on ouvre une conversation existante', async () => {
    h = await mountChat(chatApi())
    await h.click('.conv-pick')
    await attendreFrames()
    expect(document.activeElement).toBe(h.textarea())
  })

  it('focalise le champ quand on clique sur « nouvelle conversation »', async () => {
    h = await mountChat(chatApi())
    await h.click('.conv-pick')
    h.textarea().blur()
    await h.click('.conv-new-row')
    await attendreFrames()
    expect(document.activeElement).toBe(h.textarea())
  })
})
