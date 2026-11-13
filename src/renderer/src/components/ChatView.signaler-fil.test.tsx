// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  chatApi,
  conversation,
  installRafShim,
  mountChat,
  type ChatHarness
} from './ChatView.harness'

/**
 * LA DEMANDE (08/11) : « que je puisse kaizen une conv ou plusieurs ». Le menu du fil et la barre de
 * sélection ouvrent un fil NEUF prérempli de `/kaizen <fils>`, curseur en fin de ligne, sans rien
 * envoyer : c'est à l'utilisateur de dire ce qui n'a pas marché.
 */
describe('ChatView — signaler un problème sur un fil', () => {
  let harness: ChatHarness | undefined
  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
    window.localStorage.clear()
  })

  const attendreImages = async (): Promise<void> => {
    await act(async () => {
      await new Promise((fin) => setTimeout(fin, 20))
    })
  }

  const champ = (h: ChatHarness, selecteur = 'textarea'): HTMLTextAreaElement => {
    const trouve = h.container.querySelector<HTMLTextAreaElement>(selecteur)
    expect(trouve).not.toBeNull()
    return trouve!
  }

  it('depuis le menu du fil : un fil neuf prérempli, curseur en fin, rien envoyé', async () => {
    const chatSend = vi.fn()
    harness = await mountChat(chatApi({ chatSend }))
    await act(async () => {
      harness!.container.querySelector<HTMLButtonElement>('.conv-menu-trigger')!.click()
    })
    const entree = document.querySelector<HTMLElement>('[data-testid="conv-menu-signaler"]')
    expect(entree?.textContent).toContain('Signaler un problème sur ce fil')
    await act(async () => {
      entree!.click()
    })
    await attendreImages()
    const saisie = champ(harness)
    expect(saisie.value).toBe('/kaizen A ')
    expect(saisie.selectionStart).toBe(saisie.value.length)
    expect(document.activeElement).toBe(saisie)
    expect(harness.container.querySelector('.conv-new-row.active')).not.toBeNull()
    expect(chatSend).not.toHaveBeenCalled()
  })

  it('depuis une sélection : tous les fils cochés dans la même demande', async () => {
    harness = await mountChat(
      chatApi({ conversations: vi.fn().mockResolvedValue([conversation('A'), conversation('B')]) })
    )
    await act(async () => {
      harness!.container.querySelector<HTMLButtonElement>('.conv-menu-trigger')!.click()
    })
    await act(async () => {
      document.querySelector<HTMLElement>('[data-testid="conv-menu-select-mode"]')!.click()
    })
    for (const titre of ['A', 'B']) {
      const label = `Sélectionner « Conversation ${titre} »`
      const c = harness.container.querySelector<HTMLInputElement>(
        `.conv-select-box[aria-label="${label}"]`
      )
      if (c!.checked) continue
      await act(async () => {
        c!.click()
      })
    }
    const bouton = harness.container.querySelector<HTMLButtonElement>(
      '[data-testid="conv-bulk-signaler"]'
    )
    expect(bouton?.textContent).toBe('Signaler un problème (2)')
    await act(async () => {
      bouton!.click()
    })
    await attendreImages()
    expect(champ(harness).value).toBe('/kaizen A B ')
    // La sélection est quittée : sa barre ne reste pas affichée au-dessus du fil neuf.
    expect(harness.container.querySelector('[data-testid="conv-bulk-signaler"]')).toBeNull()
  })

  it('en mosaïque : le fil neuf est une fenêtre de plus, sa saisie préremplie', async () => {
    window.localStorage.setItem('autowin.chat.conversationsViewMode', 'mosaic')
    window.localStorage.setItem('autowin.chat.mosaicOpenIds', '[]')
    const conversationsCreate = vi.fn().mockResolvedValue(conversation('N'))
    harness = await mountChat(
      chatApi({
        conversationsCreate,
        conversation: vi.fn(async (id: string) => conversation(id))
      })
    )
    await act(async () => {
      harness!.container.querySelector<HTMLButtonElement>('.conv-menu-trigger')!.click()
    })
    await act(async () => {
      document.querySelector<HTMLElement>('[data-testid="conv-menu-signaler"]')!.click()
    })
    await attendreImages()
    await attendreImages()
    expect(conversationsCreate).toHaveBeenCalledTimes(1)
    expect(champ(harness, '[data-conv-id="N"] textarea').value).toBe('/kaizen A ')
  })
})
