// @vitest-environment happy-dom
/**
 * LE BOUTON QUI POSE LA SÉPARATION DES VOIX, éprouvé sans toucher au disque.
 *
 * Ce qui est vérifié ici tient en une phrase : le bouton n'apparaît QUE là où il a un sens, il
 * appelle RÉELLEMENT le pont, et ce qu'il rend — succès comme échec — se voit à l'écran. Un bouton
 * de 2,5 Go qui s'afficherait partout, ou dont l'échec resterait muet, serait pire que son absence.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const etatPret = {
  installe: false,
  pythonPresent: true,
  jetonPresent: false,
  megaoctets: 2500,
  erreur: null
}

let conteneur: HTMLDivElement
let racine: Root

function poserApi(api: Record<string, unknown>): void {
  ;(window as unknown as { api?: unknown }).api = {
    whisperEtat: async () => ({ installe: true }),
    transcriptLister: async () => [],
    ...api
  }
}

async function monter(): Promise<void> {
  const { EnregistrementsWidget } = await import('./EnregistrementsWidget')
  await act(async () => {
    racine.render(createElement(EnregistrementsWidget))
  })
}

/** Choisir le mode « Fichier audio » dans le menu, comme le ferait l'utilisateur. */
async function choisirModeFichier(): Promise<void> {
  const select = conteneur.querySelector<HTMLSelectElement>('[data-testid="enregistrements-mode"]')!
  await act(async () => {
    select.value = 'fichier'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

const bouton = (): HTMLButtonElement | null =>
  conteneur.querySelector('[data-testid="enregistrements-installer-diarisation"]')

beforeEach(() => {
  conteneur = document.createElement('div')
  document.body.appendChild(conteneur)
  racine = createRoot(conteneur)
  vi.stubGlobal('navigator', { ...navigator, mediaDevices: undefined })
})

afterEach(() => {
  act(() => racine.unmount())
  conteneur.remove()
  delete (window as unknown as { api?: unknown }).api
  vi.unstubAllGlobals()
})

describe('bouton d installation de la separation des voix', () => {
  it('N APPARAIT PAS dans les modes dictee et conversation : il ne les concerne pas', async () => {
    poserApi({ diarisationEtat: async () => etatPret, diarisationInstaller: async () => etatPret })
    await monter()
    expect(bouton()).toBeNull()
  })

  it('apparait en mode fichier quand la brique manque, en ANNONCANT son poids avant le clic', async () => {
    poserApi({ diarisationEtat: async () => etatPret, diarisationInstaller: async () => etatPret })
    await monter()
    await choisirModeFichier()
    expect(bouton()).not.toBeNull()
    expect(bouton()!.textContent).toContain('2500')
  })

  it('n apparait PAS sans Python : on ne propose pas ce qu on ne sait pas poser', async () => {
    poserApi({
      diarisationEtat: async () => ({ ...etatPret, pythonPresent: false }),
      diarisationInstaller: async () => etatPret
    })
    await monter()
    await choisirModeFichier()
    expect(bouton()).toBeNull()
    expect(conteneur.textContent).toContain('Python est introuvable')
  })

  it('disparait quand la brique REPOND deja : rien ne se retelecharge', async () => {
    poserApi({
      diarisationEtat: async () => ({ ...etatPret, installe: true, jetonPresent: true }),
      diarisationInstaller: async () => etatPret
    })
    await monter()
    await choisirModeFichier()
    expect(bouton()).toBeNull()
    expect(conteneur.textContent).toContain('Prêt')
  })

  it('LE CLIC appelle le pont, et le succes bascule l affichage', async () => {
    const installer = vi.fn(async () => ({ ...etatPret, installe: true, jetonPresent: true }))
    poserApi({ diarisationEtat: async () => etatPret, diarisationInstaller: installer })
    await monter()
    await choisirModeFichier()
    await act(async () => {
      bouton()!.click()
    })
    expect(installer).toHaveBeenCalledTimes(1)
    expect(bouton()).toBeNull()
    expect(conteneur.textContent).toContain('Prêt')
  })

  it('UN ECHEC se VOIT : le message de pip est affiche, jamais avale', async () => {
    poserApi({
      diarisationEtat: async () => etatPret,
      diarisationInstaller: async () => ({ ...etatPret, erreur: 'ERROR: proxy refuse la connexion' })
    })
    await monter()
    await choisirModeFichier()
    await act(async () => {
      bouton()!.click()
    })
    expect(conteneur.textContent).toContain('proxy refuse la connexion')
  })

  it('installee SANS jeton : on ne promet pas que ca marchera, on nomme ce qui manque', async () => {
    poserApi({
      diarisationEtat: async () => ({ ...etatPret, installe: true, jetonPresent: false }),
      diarisationInstaller: async () => etatPret
    })
    await monter()
    await choisirModeFichier()
    expect(conteneur.textContent).toContain('Hugging Face')
  })

  it('le bouton Enregistrer reste NEUTRALISE tant que la brique manque : sinon il ouvrirait le micro', async () => {
    poserApi({ diarisationEtat: async () => etatPret, diarisationInstaller: async () => etatPret })
    await monter()
    await choisirModeFichier()
    const bascule = conteneur.querySelector<HTMLButtonElement>(
      '[data-testid="enregistrements-bascule"]'
    )!
    expect(bascule.disabled).toBe(true)
  })
})
