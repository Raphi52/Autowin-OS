// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { appliquerLangue } from '../langue'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const { chatApi, conversation, installRafShim, mountChat } = await import('./ChatView.harness')
type Harness = Awaited<ReturnType<typeof mountChat>>

/**
 * LA LISTE DES FILS ET L'EN-TÊTE DU CHAT SUIVENT LA LANGUE (traduction anglaise, conv-1170, lot
 * « Chat — liste des fils, en-tête, fil et saisie »). Entrée qui doit faire échouer ce test : un
 * libellé de la liste ou de l'en-tête laissé en dur, ou un ChatView qui ne se redessine pas quand la
 * langue change — et, au retour, un français qui ne serait plus mot pour mot celui d'avant.
 */
describe('ChatView — langue de la liste des fils et de l’en-tête', () => {
  beforeAll(installRafShim)
  let h: Harness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    window.localStorage.clear()
    vi.restoreAllMocks()
    appliquerLangue('fr')
  })

  const api = (): Record<string, unknown> =>
    chatApi({
      conversations: vi.fn().mockResolvedValue([conversation('A'), conversation('B')]),
      conversation: vi.fn(async (id: string) => conversation(id))
    })

  it('bascule en anglais sans être remonté, puis revient au français', async () => {
    h = await mountChat(api())
    const c = h.container
    const lire = (): Record<string, string | null | undefined> => ({
      recherche: c.querySelector('.conv-search input')?.getAttribute('placeholder'),
      rechercheAria: c.querySelector('.conv-search input')?.getAttribute('aria-label'),
      nouveau: c.querySelector('.conv-new-title')?.textContent,
      filtre: c.querySelector('[data-testid="conv-status-filter"]')?.textContent,
      densite: c.querySelector('[data-testid="conv-density-toggle"]')?.getAttribute('aria-label'),
      mosaique: c.querySelector('[data-testid="conv-view-toggle"]')?.getAttribute('aria-label'),
      actions: c.querySelector('.conv-menu-trigger')?.getAttribute('aria-label'),
      titre: c.querySelector('.chat-head-kicker')?.textContent?.trim(),
      fil: c.querySelector('[data-testid="chat-runtime-conv"]')?.getAttribute('title')
    })
    const francais = lire()
    expect(francais).toMatchObject({
      recherche: 'Rechercher partout…',
      rechercheAria: 'Rechercher dans les conversations',
      nouveau: 'Nouveau fil',
      filtre: 'Toutes',
      densite: 'Densité de la liste : détaillée',
      mosaique: 'Vue mosaïque',
      actions: 'Actions de la conversation'
    })

    await act(async () => appliquerLangue('en'))
    const anglais = lire()
    expect(anglais).toMatchObject({
      recherche: 'Search everywhere…',
      rechercheAria: 'Search the conversations',
      nouveau: 'New thread',
      filtre: 'All',
      densite: 'List density: detailed',
      mosaique: 'Mosaic view',
      actions: 'Conversation actions'
    })
    // L'en-tête : sans fil ouvert, « New conversation » ; avec un fil, SON titre (une donnée, pas
    // un texte de l'écran) et son identifiant expliqué en anglais.
    if (francais.titre === 'Nouvelle conversation') {
      expect(anglais.titre).toBe('New conversation')
      expect(anglais.fil).toBe('No conversation open')
    } else {
      expect(anglais.titre).toBe(francais.titre)
      expect(anglais.fil).toMatch(/^Identifier of this conversation: \w+\. This is the name/)
    }

    await act(async () => appliquerLangue('fr'))
    expect(lire()).toEqual(francais)
  })
})
