// @vitest-environment happy-dom
/**
 * Defaut vecu le 2026-09-12 : un menu ouvert pres du bas (ou une matrice de 600px dans une
 * fenetre etroite) sortait de la fenetre — la partie hors ecran etait INATTEIGNABLE.
 */
import { act, useRef, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { useClampDansFenetre } from './useClampDansFenetre'

function Popup(): ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  useClampDansFenetre(ref, true)
  // JSX, PAS `createElement` : passer `ref` en argument d'une fonction ordinaire est lu comme un
  // acces au ref pendant le rendu (`react-hooks/refs`).
  return (
    <div ref={ref} data-testid="pop">
      menu
    </div>
  )
}

/**
 * Le rectangle simule est pose sur le PROTOTYPE, le temps du montage, et retire aussitot.
 *
 * Il passait avant par une fonction-ref qui ecrivait dans `ref.current` : React lit une telle
 * fonction PENDANT le rendu, ce que `react-hooks/refs` refuse — et le composant de test ne
 * ressemblait alors plus a un vrai appelant du hook, qui lui passe simplement `ref`.
 */
function monter(rect: Partial<DOMRect>): HTMLElement {
  const hote = document.createElement('div')
  document.body.appendChild(hote)
  const origine = HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect = function (): DOMRect {
    return { ...rect } as DOMRect
  }
  try {
    act(() => {
      createRoot(hote).render(<Popup />)
    })
  } finally {
    HTMLElement.prototype.getBoundingClientRect = origine
  }
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
