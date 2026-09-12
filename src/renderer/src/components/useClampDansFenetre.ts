import { useLayoutEffect, type RefObject } from 'react'

/**
 * Recadre un popup (menu contextuel, liste deroulante) DANS la fenetre visible.
 *
 * Defaut vecu le 2026-09-12 : le menu d'une conversation est pose a `top: rect.top`
 * sans plancher, et la matrice modele x effort est posee a `left: 0` avec une largeur
 * de 600px. Pres du bas ou dans une fenetre etroite, une partie du popup sort de
 * l'ecran et devient INATTEIGNABLE (pas de defilement : c'est hors viewport).
 *
 * Le recadrage se fait par `transform: translate(...)` : il fonctionne que le popup
 * soit positionne en `fixed` ou en `absolute`, sans toucher son calcul de position.
 */
export function useClampDansFenetre(
  ref: RefObject<HTMLElement | null>,
  actif: boolean,
  marge = 8
): void {
  useLayoutEffect(() => {
    const el = ref.current
    if (!actif || !el) return
    const recadrer = (): void => {
      el.style.transform = ''
      const rect = el.getBoundingClientRect()
      // jsdom (et un popup pas encore mesure) rend un rectangle nul : rien a recadrer.
      if (rect.width === 0 && rect.height === 0) return
      const largeurVue = window.innerWidth
      const hauteurVue = window.innerHeight
      let dx = 0
      let dy = 0
      if (rect.right > largeurVue - marge) dx = largeurVue - marge - rect.right
      if (rect.left + dx < marge) dx = marge - rect.left
      if (rect.bottom > hauteurVue - marge) dy = hauteurVue - marge - rect.bottom
      if (rect.top + dy < marge) dy = marge - rect.top
      el.style.transform = dx || dy ? `translate(${Math.round(dx)}px, ${Math.round(dy)}px)` : ''
    }
    recadrer()
    window.addEventListener('resize', recadrer)
    return () => {
      window.removeEventListener('resize', recadrer)
      el.style.transform = ''
    }
  }, [ref, actif, marge])
}
