// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EtatDuDossierDuBoard } from '../../../shared/board-dossier'
import { NomSurLeBoardReglage } from './NomSurLeBoardReglage'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const montes: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []

async function monter(api: unknown): Promise<HTMLDivElement> {
  ;(window as unknown as { api: unknown }).api = api
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  montes.push({ root, container })
  await act(async () => {
    root.render(createElement(NomSurLeBoardReglage))
  })
  return container
}

afterEach(async () => {
  for (const m of montes.splice(0)) {
    await act(async () => m.root.unmount())
    m.container.remove()
  }
  delete (window as unknown as { api?: unknown }).api
})

const etat = (partiel: Partial<EtatDuDossierDuBoard> = {}): EtatDuDossierDuBoard => ({
  dossier: null,
  cible: null,
  enCours: false,
  nom: 'jdupont',
  compte: 'jdupont',
  ...partiel
})

const saisie = (c: HTMLElement): HTMLInputElement =>
  c.querySelector('[data-testid="interface-nom-board-saisie"]') as HTMLInputElement

async function taper(c: HTMLElement, texte: string): Promise<void> {
  const champ = saisie(c)
  const poser = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    poser?.call(champ, texte)
    champ.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function envoyer(c: HTMLElement): Promise<void> {
  const formulaire = c.querySelector('form') as HTMLFormElement
  await act(async () => {
    formulaire.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

describe('Settings · Interface — « Ton nom sur le Board » (conv-1230)', () => {
  it('propose le compte Windows par défaut, sans nom choisi', async () => {
    const c = await monter({ boardDossier: vi.fn(async () => etat()), boardDossierNom: vi.fn() })
    expect(saisie(c).value).toBe('')
    expect(saisie(c).placeholder).toBe('jdupont')
    expect(c.textContent).toContain('compte Windows')
    expect(c.textContent).toContain('jdupont')
    expect(c.querySelector('[data-testid="interface-nom-board-defaut"]')).toBeNull()
  })

  it('enregistre le nom saisi et affiche ce que le moteur répond', async () => {
    const boardDossierNom = vi.fn(async (nom: string | null) =>
      etat(nom ? { nom, nomChoisi: nom } : {})
    )
    const c = await monter({ boardDossier: vi.fn(async () => etat()), boardDossierNom })
    await taper(c, '  Jean Dupont ')
    await envoyer(c)
    expect(boardDossierNom).toHaveBeenCalledWith('Jean Dupont')
    expect(saisie(c).value).toBe('Jean Dupont')
    const defaut = c.querySelector(
      '[data-testid="interface-nom-board-defaut"]'
    ) as HTMLButtonElement
    expect(defaut).not.toBeNull()

    // « Revenir au compte Windows » envoie `null`.
    await act(async () => defaut.click())
    expect(boardDossierNom).toHaveBeenLastCalledWith(null)
    expect(saisie(c).value).toBe('')
  })

  it('un nom refusé par le moteur le dit, et le champ reprend l’état d’avant', async () => {
    const c = await monter({
      boardDossier: vi.fn(async () => etat()),
      boardDossierNom: vi.fn(async () => etat({ erreur: 'Nom illisible ou trop long' }))
    })
    await taper(c, 'Jean')
    await envoyer(c)
    expect(c.textContent).toContain('n’a pas pu être enregistré')
    expect(saisie(c).value).toBe('')
  })

  it('sans pont vers le moteur (preload d’avant redémarrage), la ligne n’est pas montrée', async () => {
    const c = await monter({ boardDossier: vi.fn(async () => etat()) })
    expect(c.querySelector('[data-testid="interface-nom-board"]')).toBeNull()
  })
})
