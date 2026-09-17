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
 * LA DEMANDE : « si je veux classer une conversation, cela me propose les repertoires de travail,
 * alors que je voudrais les categories » (conv-79, 2026-09-17).
 *
 * CAUSE MESUREE : la separation du dossier de travail et du libelle de classement (conv-81) a
 * filtre la liste du menu « Ranger dans… » sur `estCheminDeDossier`. Le routage cote stockage
 * etait bon, mais l'INTERFACE ne proposait plus aucun libelle : « Fiches Team » portait encore des
 * fils et etait devenu inatteignable a la souris, et rien ne permettait d'en creer un.
 *
 * Le test regarde le GESTE complet, pas la presence d'une classe CSS : ouvrir le menu, cliquer une
 * categorie existante, puis en saisir une neuve.
 */
describe('ChatView — classer une conversation par categorie', () => {
  let harness: ChatHarness | undefined

  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
    window.localStorage.clear()
  })

  const ouvrirMenuRangement = async (h: ChatHarness): Promise<void> => {
    const actions = h.container.querySelector<HTMLButtonElement>('.conv-menu-trigger')
    expect(actions).not.toBeNull()
    await act(async () => {
      actions!.click()
    })
    const ranger = document.querySelector<HTMLElement>('[data-testid="conv-menu-set-project"]')
    expect(ranger).not.toBeNull()
    await act(async () => {
      ranger!.click()
    })
  }

  it('propose les categories DEJA utilisees, pas seulement les dossiers', async () => {
    const conversationsSetProject = vi.fn().mockResolvedValue('Fiches Team')
    harness = await mountChat(
      chatApi({
        conversations: vi
          .fn()
          .mockResolvedValue([
            { ...conversation('A'), categorie: 'Fiches Team' },
            { ...conversation('B'), categorie: 'archives' }
          ]),
        conversationsSetProject
      })
    )

    await ouvrirMenuRangement(harness)

    const choix = [...document.querySelectorAll('[data-testid="conv-category-choice"]')].map(
      (bouton) => bouton.getAttribute('data-category')
    )
    expect(choix).toContain('Fiches Team')
    expect(choix).toContain('archives')

    const cible = document.querySelector<HTMLElement>('[data-category="Fiches Team"]')
    await act(async () => {
      cible!.click()
    })
    expect(conversationsSetProject).toHaveBeenCalledWith('A', 'Fiches Team')
  })

  it('ne melange PAS les repertoires de travail aux categories', async () => {
    harness = await mountChat(
      chatApi({
        conversations: vi
          .fn()
          .mockResolvedValue([
            { ...conversation('A'), categorie: 'Fiches Team' },
            { ...conversation('B'), projectPath: 'D:\\GIT\\RigApplication' }
          ])
      })
    )

    // « Ranger dans une categorie… » ne montre QUE des libelles.
    await ouvrirMenuRangement(harness)
    expect(document.querySelector('[data-testid="conv-category-choice"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="conv-project-choice"]')).toBeNull()
    expect(document.querySelector('[data-testid="conv-project-pick"]')).toBeNull()

    await act(async () => {
      document.querySelector<HTMLElement>('.conv-menu-backdrop')!.click()
    })

    // « Choisir le repertoire de travail… » ne montre QUE des chemins.
    const actions = harness.container.querySelector<HTMLButtonElement>('.conv-menu-trigger')
    await act(async () => {
      actions!.click()
    })
    const dossiers = document.querySelector<HTMLElement>('[data-testid="conv-menu-set-workdir"]')
    expect(dossiers).not.toBeNull()
    await act(async () => {
      dossiers!.click()
    })
    expect(document.querySelector('[data-testid="conv-project-pick"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="conv-category-choice"]')).toBeNull()
    expect(document.querySelector('[data-testid="conv-category-new"]')).toBeNull()
  })

  it('laisse CREER une categorie neuve depuis le menu', async () => {
    const conversationsSetProject = vi.fn().mockResolvedValue('Factures')
    harness = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([conversation('A')]),
        conversationsSetProject
      })
    )

    await ouvrirMenuRangement(harness)

    const neuve = document.querySelector<HTMLElement>('[data-testid="conv-category-new"]')
    expect(neuve).not.toBeNull()
    await act(async () => {
      neuve!.click()
    })

    const champ = document.querySelector<HTMLInputElement>('[data-testid="conv-category-input"]')
    expect(champ).not.toBeNull()
    // React remplace le setter `value` de l'element : ecrire `champ.value = …` directement ne
    // declenche PAS son `onChange`. On passe donc par le setter natif du prototype.
    const poserValeur = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set
    await act(async () => {
      poserValeur!.call(champ, 'Factures')
      champ!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      champ!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    expect(conversationsSetProject).toHaveBeenCalledWith('A', 'Factures')
  })
})
