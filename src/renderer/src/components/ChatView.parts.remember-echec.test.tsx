// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AssistantActivityGroup } from './ChatView.parts'

/**
 * UN FAIT PERDU NE DOIT PAS RESSEMBLER À UN FAIT RETENU.
 *
 * Mesuré le 2026-09-11 sur les traces causales (150 appels `remember`, 35 échecs) : une part des
 * échecs passait la validation locale (`allowed: true`) et mourait au dépôt — « Brain injoignable »,
 * « jeton du Brain absent », « délai dépassé ». La commande RÉUSSIT à rendre un échec, donc
 * `action.ok` reste vrai : le fil affichait « 1 action terminée · remember » au-dessus d'un fait
 * jamais écrit. C'est le faux vert que ce bloc existe pour contredire.
 */
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const rendre = (data: Record<string, unknown>): string => {
  act(() =>
    root.render(
      createElement(AssistantActivityGroup, {
        actions: [{ kind: 'action', name: 'remember', ok: true, args: {}, data }] as never
      })
    )
  )
  const el = container.querySelector<HTMLElement>('[data-testid="activity-group"]')
  if (!el) throw new Error('activity-group absent')
  return el.textContent ?? ''
}

describe('un dépôt remember qui échoue est VISIBLE dans le fil', () => {
  it('ne dit plus « terminée » quand le Brain est injoignable, et montre le motif', () => {
    const texte = rendre({
      allowed: true,
      stored: false,
      detail: 'Brain injoignable : fetch failed'
    })

    expect(texte).not.toContain('terminée')
    expect(texte).toContain('Brain injoignable : fetch failed')
  })

  it('montre le motif d’un refus de validation', () => {
    const texte = rendre({
      allowed: false,
      stored: false,
      reason: 'locator non vérifiable — attendu git:<chemin>@<sha>'
    })

    expect(texte).not.toContain('terminée')
    expect(texte).toContain('locator non vérifiable')
  })

  it('dit l’état INCONNU sans le confondre avec un échec', () => {
    const texte = rendre({
      allowed: true,
      stored: false,
      unknown: true,
      detail: 'délai dépassé (2000 ms) — état du dépôt INCONNU, le Brain a peut-être écrit'
    })

    expect(texte).toContain('inconnu')
    expect(texte).not.toContain('terminée')
  })

  it('laisse un dépôt réussi affiché comme terminé', () => {
    const texte = rendre({ allowed: true, stored: true, detail: 'candidat déposé (inbox)' })

    expect(texte).toContain('terminée')
    expect(texte).not.toContain('rien retenu')
  })
})
