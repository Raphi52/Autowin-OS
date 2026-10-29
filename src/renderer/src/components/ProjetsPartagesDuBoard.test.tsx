// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjetsPartagesDuBoard, type ProjetAffiche } from './ProjetsPartagesDuBoard'

/**
 * Le menu « Projets » du Board (conv-1211). Entrée qui doit faire échouer ce fichier : un projet
 * décoché depuis « tous » qui rendrait encore `null` (tout repartirait sur le partage), ou un bouton
 * qui annonce « tous » alors qu'une liste est retenue.
 */
const PROJETS: ProjetAffiche[] = [
  { cle: 'D:\\Factures', libelle: 'Factures', demandes: 12 },
  { cle: 'D:\\Perso', libelle: 'Perso', demandes: 3 }
]

let racine: Root | null = null
let hote: HTMLElement | null = null

function monter(choisis: string[] | null, onChoisir = vi.fn()): HTMLElement {
  hote = document.createElement('div')
  document.body.appendChild(hote)
  racine = createRoot(hote)
  act(() => {
    racine?.render(createElement(ProjetsPartagesDuBoard, { projets: PROJETS, choisis, onChoisir }))
  })
  return hote
}

afterEach(() => {
  act(() => racine?.unmount())
  hote?.remove()
  racine = null
  hote = null
})

/** Par attribut : l'antislash d'un chemin Windows serait lu comme un échappement dans un sélecteur CSS. */
const caseDu = (vue: HTMLElement, cle: string): HTMLInputElement | null =>
  [...vue.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
    (c) => c.getAttribute('data-testid') === `besoins-projet-${cle}`
  ) ?? null

const cocher = (el: Element | null): void => {
  act(() => (el as HTMLInputElement).click())
}

describe('ProjetsPartagesDuBoard', () => {
  it('sans choix : « tous », chaque projet coché ; décocher le perso garde les autres', () => {
    const onChoisir = vi.fn()
    const vue = monter(null, onChoisir)
    expect(vue.querySelector('[data-testid="besoins-projets-resume"]')?.textContent).toBe(
      'Projets : tous'
    )
    expect(
      (vue.querySelector('[data-testid="besoins-projets-tous"]') as HTMLInputElement).checked
    ).toBe(true)
    cocher(caseDu(vue, 'D:\\Perso'))
    expect(onChoisir).toHaveBeenCalledWith(['D:\\Factures'])
  })

  it('avec une liste : le compte et la note ; « tous » rend null', () => {
    const onChoisir = vi.fn()
    const vue = monter(['D:\\Factures'], onChoisir)
    expect(vue.querySelector('[data-testid="besoins-projets-resume"]')?.textContent).toBe(
      'Projets : 1/2'
    )
    expect(caseDu(vue, 'D:\\Perso')?.checked).toBe(false)
    expect(vue.textContent).toContain('pas recopié tant qu’il n’est pas coché')
    cocher(vue.querySelector('[data-testid="besoins-projets-tous"]'))
    expect(onChoisir).toHaveBeenCalledWith(null)
  })

  it('la croix d’une ligne retire son dossier du Chat sans cocher ni décocher (conv-1212)', () => {
    const onChoisir = vi.fn()
    const onRetirer = vi.fn()
    hote = document.createElement('div')
    document.body.appendChild(hote)
    racine = createRoot(hote)
    act(() => {
      racine?.render(
        createElement(ProjetsPartagesDuBoard, {
          projets: [
            { cle: 'D:\\Factures', libelle: 'Factures', demandes: 12, retirable: 'D:\\Factures' },
            // Le dépôt par défaut, que le Chat propose toujours : pas de croix.
            { cle: 'D:\\Perso', libelle: 'Perso', demandes: 3 }
          ],
          choisis: null,
          onChoisir,
          onRetirer
        })
      )
    })
    const croix = [...hote.querySelectorAll('button')].filter((b) =>
      b.getAttribute('data-testid')?.startsWith('besoins-projet-retirer-')
    )
    expect(croix.map((b) => b.getAttribute('data-testid'))).toEqual([
      'besoins-projet-retirer-D:\\Factures'
    ])
    act(() => croix[0].click())
    expect(onRetirer).toHaveBeenCalledWith('D:\\Factures')
    expect(onChoisir).not.toHaveBeenCalled()
    expect(caseDu(hote, 'D:\\Factures')?.checked).toBe(true)
  })
})
