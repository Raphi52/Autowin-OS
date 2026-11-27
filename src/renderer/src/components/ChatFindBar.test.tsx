// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatFindBar } from './ChatFindBar'

/**
 * LA BARRE CTRL+F GARDE SA PLACE QUAND LE FIL SE RAFRAÎCHIT. Entrée qui doit faire échouer ce
 * test : une barre qui relance la recherche depuis la première occurrence (et y fait défiler le
 * fil) à chaque nouveau rendu du parent — `ChatView` lui passe une fonction `racine` neuve à
 * chaque rendu, et le fil se rafraîchit en continu pendant un tour.
 */
beforeAll(() => {
  ;(globalThis as never as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
})

let hote: HTMLDivElement
let fil: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  fil = document.createElement('div')
  fil.innerHTML = '<p>badge un</p><p>badge deux</p><p>badge trois</p>'
  hote = document.createElement('div')
  document.body.append(fil, hote)
  root = createRoot(hote)
})

afterEach(() => {
  act(() => root.unmount())
  fil.remove()
  hote.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Rend la barre comme `ChatView` : une fonction `racine` NEUVE à chaque appel. */
const rendre = (): void => {
  act(() => {
    root.render(createElement(ChatFindBar, { racine: () => fil, onFermer: () => {} }))
  })
}

const champ = (): HTMLInputElement =>
  hote.querySelector<HTMLInputElement>('[data-testid="chat-find-input"]')!
const compteur = (): string =>
  hote.querySelector('[data-testid="chat-find-count"]')?.textContent ?? ''

const taper = (texte: string): void => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(champ(), texte)
    champ().dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() => {
    vi.advanceTimersByTime(500)
  })
}

const entree = (): void => {
  act(() => {
    champ().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
}

describe('ChatFindBar', () => {
  it('reste sur l’occurrence choisie quand le parent se re-rend', () => {
    rendre()
    taper('badge')
    expect(compteur()).toBe('1/3')
    entree()
    expect(compteur()).toBe('2/3')

    const defilement = vi
      .spyOn(HTMLElement.prototype, 'scrollIntoView')
      .mockImplementation(() => {})
    // Le fil se rafraîchit (tour en cours, mise à jour en direct) : plusieurs rendus du parent.
    rendre()
    rendre()
    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(compteur()).toBe('2/3')
    expect(defilement).not.toHaveBeenCalled()
  })

  it('repart de la première occurrence quand le terme change', () => {
    rendre()
    taper('badge')
    entree()
    expect(compteur()).toBe('2/3')

    taper('badge d')
    expect(compteur()).toBe('1/1')
  })
})
