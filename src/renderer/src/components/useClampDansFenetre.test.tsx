// @vitest-environment happy-dom
/**
 * Defaut vecu le 2026-09-12 : un menu ouvert pres du bas (ou une matrice de 600px dans une
 * fenetre etroite) sortait de la fenetre — la partie hors ecran etait INATTEIGNABLE.
 */
import { act, createElement, useRef, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { useClampDansFenetre } from './useClampDansFenetre'

function Popup({ rect }: { rect: Partial<DOMRect> }): ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  const poser = (el: HTMLDivElement | null): void => {
    ref.current = el
    if (el) el.getBoundingClientRect = () => ({ ...rect }) as DOMRect
  }
  useClampDansFenetre(ref, true)
  return createElement('div', { ref: poser, 'data-testid': 'pop' }, 'menu')
}

function monter(rect: Partial<DOMRect>): HTMLElement {
  const hote = document.createElement('div')
  document.body.appendChild(hote)
  act(() => {
    createRoot(hote).render(createElement(Popup, { rect }))
  })
  return hote.querySelector('[data-testid="pop"]') as HTMLElement
}

describe('useClampDansFenetre', () => {
  it('remonte un menu qui depasse en bas', () => {
    window.innerHeight = 400
    window.innerWidth = 800
    const el = monter({ top: 300, bottom: 600, left: 10, right: 100, width: 90, height: 300 })
    expect(el.style.transform).toBe('translate(0px, -208px)')
  })

  it('ramene vers la gauche un menu qui depasse a droite', () => {
    window.innerHeight = 800
    window.innerWidth = 500
    const el = monter({ top: 10, bottom: 200, left: 100, right: 700, width: 600, height: 190 })
    // Plus large que la fenetre : on colle au bord GAUCHE (le bord gauche prime), jamais
    // au-dela — sinon le debut de la liste devenait invisible a son tour.
    expect(el.style.transform).toBe('translate(-92px, 0px)')
  })

  it('ne touche pas un menu deja entierement visible', () => {
    window.innerHeight = 800
    window.innerWidth = 800
    const el = monter({ top: 10, bottom: 200, left: 10, right: 200, width: 190, height: 190 })
    expect(el.style.transform).toBe('')
  })
})
