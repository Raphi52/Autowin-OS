// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, conversation, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

/**
 * LA DEMANDE (conv-814) : en mode sélection, à côté de « Supprimer », un bouton « Marquer comme
 * inactive » et un bouton « Ranger dans une catégorie » (catégorie existante ou nouvelle).
 */
describe('ChatView — actions groupées de la sélection', () => {
  let harness: ChatHarness | undefined
  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
    window.localStorage.clear()
  })

  const cocherAetB = async (h: ChatHarness): Promise<void> => {
    await act(async () => {
      h.container.querySelector<HTMLButtonElement>('.conv-menu-trigger')!.click()
    })
    await act(async () => {
      document.querySelector<HTMLElement>('[data-testid="conv-menu-select-mode"]')!.click()
    })
    // Une case PAR titre (la même conversation peut être listée deux fois, et l'entrée en
    // sélection coche déjà celle dont on a ouvert le menu).
    for (const titre of ['A', 'B']) {
      const label = `Sélectionner « Conversation ${titre} »`
      const c = h.container.querySelector<HTMLInputElement>(`.conv-select-box[aria-label="${label}"]`)
      expect(c).not.toBeNull()
      if (c!.checked) continue
      await act(async () => {
        c!.click()
      })
    }
  }

  it('marque TOUT le lot comme inactif', async () => {
    const conversationsSetInactive = vi.fn().mockResolvedValue(undefined)
    harness = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([conversation('A'), conversation('B')]),
        conversationsSetInactive
      })
    )
    await cocherAetB(harness)
    await act(async () => {
      harness!.container.querySelector<HTMLElement>('[data-testid="conv-bulk-inactive"]')!.click()
    })
    expect(conversationsSetInactive).toHaveBeenCalledWith('A', true)
    expect(conversationsSetInactive).toHaveBeenCalledWith('B', true)
  })

  it('range le lot dans une catégorie existante, puis dans une nouvelle', async () => {
    const conversationsSetProject = vi.fn().mockResolvedValue('x')
    harness = await mountChat(
      chatApi({
        conversations: vi
          .fn()
          .mockResolvedValue([{ ...conversation('A'), categorie: 'archives' }, conversation('B')]),
        conversationsSetProject
      })
    )
    await cocherAetB(harness)
    await act(async () => {
      harness!.container.querySelector<HTMLElement>('[data-testid="conv-bulk-category"]')!.click()
    })
    await act(async () => {
      document.querySelector<HTMLElement>('[data-category="archives"]')!.click()
    })
    expect(conversationsSetProject).toHaveBeenCalledWith('A', 'archives')
    expect(conversationsSetProject).toHaveBeenCalledWith('B', 'archives')

    conversationsSetProject.mockClear()
    await cocherAetB(harness)
    await act(async () => {
      harness!.container.querySelector<HTMLElement>('[data-testid="conv-bulk-category"]')!.click()
    })
    await act(async () => {
      document.querySelector<HTMLElement>('[data-testid="conv-category-new"]')!.click()
    })
    const saisie = document.querySelector<HTMLInputElement>('[data-testid="conv-category-input"]')!
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(saisie, 'Factures')
      saisie.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      saisie.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(conversationsSetProject).toHaveBeenCalledWith('A', 'Factures')
    expect(conversationsSetProject).toHaveBeenCalledWith('B', 'Factures')
  })
})
