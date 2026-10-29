// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { EtatDuDossierDuBoard } from '../../../shared/board-dossier'
import { RouageDuBoard } from './RouageDuBoard'

/**
 * Le rouage du Board (conv-1230 : « un ptit bouton rouage qui contiendra projet, le bouton refresh et
 * le nom d'usage », au-dessus de la liste des projets). Entrée qui doit faire échouer ce fichier :
 * « Actualiser » ou le nom absents du menu, la liste des projets posée au-dessus du nom, ou un nom
 * enregistré qui ne recalcule pas le Board.
 */
beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

const etat = (partiel: Partial<EtatDuDossierDuBoard> = {}): EtatDuDossierDuBoard => ({
  dossier: null,
  cible: null,
  enCours: false,
  nom: 'jdupont',
  compte: 'jdupont',
  ...partiel
})

let racine: Root | null = null
let hote: HTMLElement | null = null

async function monter(
  props: Partial<Parameters<typeof RouageDuBoard>[0]> = {},
  api: unknown = { boardDossier: vi.fn(async () => etat()), boardDossierNom: vi.fn() }
): Promise<HTMLElement> {
  ;(window as unknown as { api: unknown }).api = api
  hote = document.createElement('div')
  document.body.appendChild(hote)
  racine = createRoot(hote)
  await act(async () => {
    racine?.render(
      createElement(
        RouageDuBoard,
        { chargement: false, onActualiser: vi.fn(), ...props },
        createElement('div', { 'data-testid': 'liste-des-projets' }, 'Projets : tous')
      )
    )
  })
  return hote
}

afterEach(async () => {
  await act(async () => racine?.unmount())
  hote?.remove()
  racine = null
  hote = null
  delete (window as unknown as { api?: unknown }).api
})

const par = (vue: HTMLElement, testid: string): HTMLElement | null =>
  vue.querySelector(`[data-testid="${testid}"]`)

describe('RouageDuBoard', () => {
  it('un bouton ⚙ dont le menu porte Actualiser, puis le nom, puis la liste des projets', async () => {
    const onActualiser = vi.fn()
    const vue = await monter({ onActualiser })
    const bouton = par(vue, 'besoins-rouage-bouton')
    expect(bouton?.textContent).toBe('⚙')
    expect(bouton?.getAttribute('aria-label')).toBe('Réglages du Board')

    const menu = vue.querySelector('.besoins-rouage-menu') as HTMLElement
    const ordre = [...menu.children].map((e) => e.getAttribute('data-testid'))
    expect(ordre).toEqual(['besoins-actualiser', 'besoins-rouage-nom', 'liste-des-projets'])
    expect(par(vue, 'besoins-rouage-nom-saisie')).not.toBeNull()
    expect((par(vue, 'besoins-rouage-nom-saisie') as HTMLInputElement).placeholder).toBe('jdupont')

    const actualiser = par(vue, 'besoins-actualiser') as HTMLButtonElement
    expect(actualiser.textContent).toBe('Actualiser')
    await act(async () => actualiser.click())
    expect(onActualiser).toHaveBeenCalledTimes(1)
  })

  it('pendant un calcul, « Actualiser » devient « Calcul… » et ne se reclique pas', async () => {
    const vue = await monter({ chargement: true })
    const actualiser = par(vue, 'besoins-actualiser') as HTMLButtonElement
    expect(actualiser.textContent).toBe('Calcul…')
    expect(actualiser.disabled).toBe(true)
  })

  it('un nom enregistré depuis le rouage recalcule le Board ; un nom refusé non', async () => {
    const onNomEnregistre = vi.fn()
    const boardDossierNom = vi
      .fn()
      .mockResolvedValueOnce(etat({ nom: 'Jean', nomChoisi: 'Jean' }))
      .mockResolvedValueOnce(etat({ erreur: 'Nom illisible ou trop long' }))
    const vue = await monter(
      { onNomEnregistre },
      { boardDossier: vi.fn(async () => etat()), boardDossierNom }
    )
    const champ = par(vue, 'besoins-rouage-nom-saisie') as HTMLInputElement
    const taper = async (texte: string): Promise<void> => {
      const poser = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      await act(async () => {
        poser?.call(champ, texte)
        champ.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    const envoyer = async (): Promise<void> => {
      await act(async () => {
        vue
          .querySelector('.besoins-rouage-menu form')
          ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      })
    }

    await taper('Jean')
    await envoyer()
    expect(boardDossierNom).toHaveBeenCalledWith('Jean')
    expect(onNomEnregistre).toHaveBeenCalledTimes(1)

    await taper('???')
    await envoyer()
    expect(vue.textContent).toContain('n’a pas pu être enregistré')
    expect(onNomEnregistre).toHaveBeenCalledTimes(1)
  })

  it('un clic hors du menu le referme', async () => {
    const vue = await monter()
    const details = par(vue, 'besoins-rouage') as HTMLDetailsElement
    await act(async () => {
      details.open = true
      details.dispatchEvent(new Event('toggle'))
    })
    expect(details.open).toBe(true)
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(details.open).toBe(false)
  })
})
