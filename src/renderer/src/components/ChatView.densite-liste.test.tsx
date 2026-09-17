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
 * Demande du 2026-09-17 : « il devrait exister plusieurs type d'affichage de la liste des
 * conversations, plus reduite comme claude code et detaillé comme celle la ».
 *
 * Le rendu serre existait deja en feuille de style, mais il n'etait atteignable qu'en tirant la
 * colonne sous 170 px — densite et largeur etaient le meme reglage. Un bouton pose le cran, le
 * panneau le porte en `data-density`, et le choix survit au redemarrage.
 */
describe('ChatView — densite de la liste des conversations', () => {
  beforeAll(installRafShim)
  let h: Harness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  const api = (): Record<string, unknown> =>
    chatApi({
      conversations: vi.fn().mockResolvedValue([conversation('A'), conversation('B')]),
      conversation: vi.fn(async (id: string) => conversation(id))
    })

  const panneau = (): HTMLElement => h!.container.querySelector('.conv-pane') as HTMLElement
  const cran = (): string | null => panneau().getAttribute('data-density')

  it('demarre sur le cran detaille — l’affichage d’avant le reglage', async () => {
    h = await mountChat(api())
    expect(cran()).toBe('detail')
  })

  it('tourne compact → normal → detaille a chaque clic, et memorise le cran', async () => {
    h = await mountChat(api())
    await h.click('[data-testid="conv-density-toggle"]')
    expect(cran()).toBe('compact')
    expect(window.localStorage.getItem('autowin.chat.conversationsDensity')).toBe('compact')

    await h.click('[data-testid="conv-density-toggle"]')
    expect(cran()).toBe('normal')

    await h.click('[data-testid="conv-density-toggle"]')
    expect(cran()).toBe('detail')
    expect(window.localStorage.getItem('autowin.chat.conversationsDensity')).toBe('detail')
  })

  it('reprend le cran memorise au montage suivant', async () => {
    window.localStorage.setItem('autowin.chat.conversationsDensity', 'compact')
    h = await mountChat(api())
    expect(cran()).toBe('compact')
    expect(
      h.container.querySelector('[data-testid="conv-density-toggle"]')!.getAttribute('aria-label')
    ).toBe('Densité de la liste : compacte')
  })

  it('ignore une valeur memorisee inconnue au lieu de casser l’affichage', async () => {
    window.localStorage.setItem('autowin.chat.conversationsDensity', 'enorme')
    h = await mountChat(api())
    expect(cran()).toBe('detail')
  })

  it('signale une recherche en cours, pour que le numero reste lisible en cran serre', async () => {
    window.localStorage.setItem('autowin.chat.conversationsDensity', 'compact')
    h = await mountChat(api())
    expect(panneau().getAttribute('data-recherche')).toBeNull()

    const champ = h.container.querySelector('.conv-search input') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    const { act } = await import('react')
    await act(async () => {
      setter?.call(champ, 'A')
      champ.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(panneau().getAttribute('data-recherche')).toBe('oui')
  })
})
