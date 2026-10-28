/**
 * Contour de focus SEULEMENT pendant une vraie navigation au clavier.
 *
 * Pourquoi (conv-1222, 2026-10-28) : « cet encerclement du bouton apparaît même quand je touche pas
 * à mon clavier, c'est parasite » — capture du bouton « Chat » de la barre de gauche, entouré de
 * rose. Les thèmes dessinent un contour sur `:focus-visible`, et Chromium allume `:focus-visible`
 * sur un bouton CLIQUÉ À LA SOURIS dès qu'une touche part ensuite, Maj seule comprise (mesuré dans
 * Edge : clic puis Maj → allumé ; clic puis « a » → allumé ; clic puis Ctrl → éteint), ou quand le
 * code pose le focus après une frappe ailleurs. Le bouton de la barre garde le focus après le clic :
 * un Win+Maj+S pour une capture, un Maj tenu en passant suffisaient à l'entourer.
 *
 * On ne s'en remet donc plus à l'heuristique de Chromium : l'app note elle-même COMMENT on se
 * déplace. Tab (ou une flèche hors d'un champ de texte) → `clavier` ; tout appui de souris, de
 * doigt ou de stylet → `pointeur`. La règle de `assets/main.css` éteint le contour tant que la
 * racine porte `pointeur`.
 */
export type ModaliteSaisie = 'clavier' | 'pointeur'

export const ATTRIBUT_MODALITE = 'data-saisie'

/** Touches qui DÉPLACENT le focus dans une liste, un menu ou des onglets (hors champ de texte). */
const TOUCHES_DE_DEPLACEMENT = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown'
])

type ToucheLue = Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'target'>

/** Dans un champ de texte, une flèche déplace le curseur, pas le focus : ce n'est pas naviguer. */
function estChampDeTexte(cible: EventTarget | null): boolean {
  const element = cible as HTMLElement | null
  if (!element || typeof element.tagName !== 'string') return false
  return element.tagName === 'TEXTAREA' || element.tagName === 'INPUT' || element.isContentEditable
}

/**
 * La modalité qu'une touche impose, ou `null` si elle ne dit rien du déplacement. Une touche
 * tenue avec Ctrl, Alt ou Windows est un raccourci (Alt+Tab change de fenêtre), pas une navigation.
 */
export function modaliteApresTouche(evenement: ToucheLue): ModaliteSaisie | null {
  if (evenement.altKey || evenement.ctrlKey || evenement.metaKey) return null
  if (evenement.key === 'Tab') return 'clavier'
  if (TOUCHES_DE_DEPLACEMENT.has(evenement.key) && !estChampDeTexte(evenement.target))
    return 'clavier'
  return null
}

/**
 * Pose `data-saisie` sur `<html>` et le tient à jour. Écoute en CAPTURE : un composant qui arrête la
 * propagation de son clic ne doit pas laisser l'app croire qu'on est encore au clavier. L'attribut
 * n'est réécrit que s'il change, pour ne pas recalculer les styles à chaque lettre tapée.
 */
export function installerModaliteSaisie(doc: Document = document): () => void {
  const racine = doc.documentElement
  const poser = (modalite: ModaliteSaisie): void => {
    if (racine.getAttribute(ATTRIBUT_MODALITE) !== modalite)
      racine.setAttribute(ATTRIBUT_MODALITE, modalite)
  }
  poser('pointeur')
  const surTouche = (evenement: KeyboardEvent): void => {
    const modalite = modaliteApresTouche(evenement)
    if (modalite) poser(modalite)
  }
  const surPointeur = (): void => poser('pointeur')
  doc.addEventListener('keydown', surTouche, true)
  doc.addEventListener('pointerdown', surPointeur, true)
  return () => {
    doc.removeEventListener('keydown', surTouche, true)
    doc.removeEventListener('pointerdown', surPointeur, true)
  }
}
