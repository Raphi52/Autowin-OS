// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DiffView } from './DiffView'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('DiffView', () => {
  it('colore les lignes ajout/suppression/hunk', () => {
    const diff = 'diff --git a/f b/f\n@@ -1,2 +1,2 @@\n const a = 1\n-const b = 2\n+const b = 3'
    act(() => root.render(createElement(DiffView, { diff })))
    expect(container.querySelector('[data-testid="diff-view"]')).not.toBeNull()
    expect(container.querySelectorAll('.diff-add')).toHaveLength(1)
    expect(container.querySelectorAll('.diff-del')).toHaveLength(1)
    expect(container.querySelector('.diff-hunk')).not.toBeNull()
  })

  it('diff vide → message', () => {
    act(() => root.render(createElement(DiffView, { diff: '' })))
    expect(container.querySelector('[data-testid="diff-view"]')).toBeNull()
    expect(container.textContent).toContain('Aucune différence')
  })
})

/** Tape dans une zone de texte contrôlée par React (le setter natif déclenche son onChange). */
function taper(zone: HTMLTextAreaElement, texte: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(zone, texte)
    zone.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('DiffView — relecture ligne à ligne', () => {
  const diff = 'diff --git a/f b/f\n@@ -1,2 +1,2 @@\n const a = 1\n-const b = 2\n+const b = 3'

  it('sans onAjouter : lecture seule, aucun bouton « + » (vue des conflits inchangée)', () => {
    act(() => root.render(createElement(DiffView, { diff })))
    expect(container.querySelector('[data-testid="diff-commenter"]')).toBeNull()
  })

  it('« + » ouvre la zone, « Ajouter » rend le repère exact de la ligne et le texte', () => {
    const ajouts: Array<[unknown, string]> = []
    act(() =>
      root.render(
        createElement(DiffView, {
          diff,
          onAjouter: (repere, texte) => {
            ajouts.push([repere, texte])
          }
        })
      )
    )
    const boutons = container.querySelectorAll<HTMLButtonElement>('[data-testid="diff-commenter"]')
    // Contexte, suppression, ajout : trois lignes numérotées ; l'en-tête @@ n'en porte pas.
    expect(boutons).toHaveLength(3)
    act(() => boutons[2].click())
    const zone = container.querySelector(
      '[data-testid="diff-editeur-texte"]'
    ) as HTMLTextAreaElement
    const ajouter = (): HTMLButtonElement =>
      container.querySelector('[data-testid="diff-editeur-ajouter"]') as HTMLButtonElement
    expect(ajouter().disabled).toBe(true)
    taper(zone, 'mets 4')
    act(() => ajouter().click())
    expect(ajouts).toHaveLength(1)
    expect(ajouts[0][1]).toBe('mets 4')
    expect(ajouts[0][0]).toMatchObject({ cote: 'apres', ligne: 2, extrait: 'const b = 3' })
    expect(container.querySelector('[data-testid="diff-editeur"]')).toBeNull()
  })

  it('Échap referme la zone sans rien ajouter', () => {
    const ajouts: string[] = []
    act(() =>
      root.render(
        createElement(DiffView, {
          diff,
          onAjouter: (_repere, texte) => {
            ajouts.push(texte)
          }
        })
      )
    )
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="diff-commenter"]')!.click())
    const zone = container.querySelector(
      '[data-testid="diff-editeur-texte"]'
    ) as HTMLTextAreaElement
    taper(zone, 'brouillon')
    act(() => {
      zone.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(container.querySelector('[data-testid="diff-editeur"]')).toBeNull()
    expect(ajouts).toEqual([])
  })

  it('affiche un commentaire posé sous SA ligne et le retire au clic sur ×', () => {
    const retraits: string[] = []
    act(() =>
      root.render(
        createElement(DiffView, {
          diff,
          onAjouter: () => {},
          onRetirer: (id) => {
            retraits.push(id)
          },
          commentaires: [
            {
              id: 'k1',
              chemin: 'f',
              cote: 'avant',
              ligne: 2,
              extrait: 'const b = 2',
              voisinage: ['-const b = 2'],
              indexDansVoisinage: 0,
              texte: 'garde b = 2'
            }
          ]
        })
      )
    )
    const commentaire = container.querySelector('[data-testid="diff-comment"]') as HTMLElement
    expect(commentaire.textContent).toContain('garde b = 2')
    // Rattaché à la ligne SUPPRIMÉE (côté avant), pas à l'ajout qui porte le même numéro.
    expect(commentaire.previousElementSibling?.classList.contains('diff-del')).toBe(true)
    act(() =>
      container.querySelector<HTMLButtonElement>('[data-testid="diff-comment-retirer"]')!.click()
    )
    expect(retraits).toEqual(['k1'])
  })
})
