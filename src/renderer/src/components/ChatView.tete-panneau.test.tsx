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
 * Demande du 2026-10-15 : « Nouveau fil » doit etre HORS de la liste qui defile, au-dessus d'elle,
 * et le titre « Conversations » disparait (il prenait une ligne pour ne rien dire). Le meme jour,
 * « inverse la position de recherche et nouveau fil » : la RECHERCHE passe en tete, « Nouveau fil »
 * juste en dessous d'elle, puis la liste.
 */
describe('ChatView — tete du panneau des conversations', () => {
  beforeAll(installRafShim)
  let h: Harness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('pose la recherche, puis « Nouveau fil » hors de la liste, sans titre', async () => {
    h = await mountChat(chatApi())
    const panneau = h.container.querySelector('.conv-pane')
    const nouveau = panneau?.querySelector('.conv-new-row')
    const recherche = panneau?.querySelector('.conv-search')
    const liste = panneau?.querySelector('.conv-list')
    expect(nouveau).toBeTruthy()
    expect(recherche).toBeTruthy()
    expect(liste).toBeTruthy()

    // Hors du conteneur qui defile : sinon le bouton part avec le defilement.
    expect(liste!.contains(nouveau!)).toBe(false)
    // Ordre visuel : la recherche, puis « Nouveau fil », puis la liste.
    const enfants = Array.from(panneau!.children)
    const rang = (el: Element): number => enfants.indexOf(el)
    expect(rang(recherche!)).toBeGreaterThanOrEqual(0)
    expect(rang(recherche!)).toBeLessThan(rang(nouveau!))
    expect(rang(nouveau!)).toBeLessThan(rang(liste!))

    // Plus de titre « Conversations » ni de ligne d'en-tete hors mosaique.
    expect(panneau!.querySelector('h1')).toBeNull()
    expect(panneau!.querySelector('.conv-head')).toBeNull()
  })
  // « Tout fermer » en mosaique : couvert par ChatView.mosaique-fermer-tout.test.tsx.
  // fix-ok: cause mesuree — un 2e test « Tout fermer » ajoute ici avait une mauvaise mise en place et
  // doublonnait ce fichier, qui clique deja `conv-mosaic-close-all` : retire.
})
