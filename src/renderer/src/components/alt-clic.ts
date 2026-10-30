/**
 * ALT+CLIC SUR N'IMPORTE QUEL ÉLÉMENT D'AUTOWIN (conv-1338, 2026-10-30).
 *
 * L'utilisateur décrit un endroit en mots (163 retouches d'interface en octobre), puis l'agent le
 * cherche dans le code. Le geste de conv-1038 ne vivait que sur la vue chat ; il couvre maintenant
 * toute l'app et joint une capture de l'élément :
 *   1. `installerAltClic` écoute la fenêtre en phase de CAPTURE, avant tout gestionnaire de l'app :
 *      Alt+clic sur « brancher » ne crée pas de branche, sur un lien ne l'ouvre pas ;
 *   2. la capture est prise AVANT de quitter la vue, sinon l'image montrerait le chat ;
 *   3. l'élément part dans une file, que `ChatView` vide : le chat n'existe pas tant que
 *      l'utilisateur ne l'a pas ouvert une fois (`visitedTabs`, App.tsx).
 *
 * BOUTON GRISÉ : Chromium ne lui donne ni `click` ni `mousedown`, seulement `pointerdown` et
 * `pointerup` (mesuré par de vrais clics hors écran). C'était pourtant l'exemple d'origine du geste
 * (« pk le bouton joindre fichier est grisé »). Le relâchement du pointeur y tient donc lieu de clic.
 *
 * Ne passent PAS par ici, sans rien à faire : les boutons de fenêtre et les zones de déplacement (le
 * système les garde), les pages du fil et le navigateur intégré (autre document). Un champ de saisie
 * et le fond de la page rendent une référence `null` : le clic y reste ordinaire.
 */

import type { RectNavigateur } from '../../../shared/navigateur'
import { fichierDeLaCapture } from './navigateur-integre-outils'
import { elementVise, referenceDeLElement } from './reference-element'

/** Au-delà, la référence part sans image : un écran figé ne doit pas retenir le geste. */
export const DELAI_CAPTURE_MS = 1500

export interface ElementCible {
  texte: string
  image: File | null
  /** La fenêtre de mosaïque cliquée ; absente, c'est le fil actif du chat. */
  fenetre?: string
}

// ── La file vers le chat ───────────────────────────────────────────────────────────────────────

let ecouteur: ((element: ElementCible) => void) | null = null
const enAttente: ElementCible[] = []

/** Remet l'élément au chat, ou le garde jusqu'à sa première ouverture. */
export function poserElementCible(element: ElementCible): void {
  if (ecouteur) ecouteur(element)
  else enAttente.push(element)
}

/** Posé par `ChatView` à son montage : rend d'abord ce qui attendait, dans l'ordre des clics. */
export function ecouterElementsCibles(recevoir: (element: ElementCible) => void): () => void {
  ecouteur = recevoir
  for (const element of enAttente.splice(0)) recevoir(element)
  return () => {
    if (ecouteur === recevoir) ecouteur = null
  }
}

// ── La capture ─────────────────────────────────────────────────────────────────────────────────

type Boite = Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>

/**
 * La partie visible de l'élément, en pixels de capture ; `null` s'il n'y a rien à voir. Un élément
 * mesure en pixels de page : `capturePage` attend des pixels de fenêtre, soit la mesure × le zoom de
 * l'app (à 150 %, sans cette multiplication, l'image ne montre pas l'élément — mesuré).
 */
export function rectangleVisible(
  boite: Boite,
  fenetre: { largeur: number; hauteur: number },
  zoom: number
): RectNavigateur | null {
  const gauche = Math.max(boite.left, 0)
  const haut = Math.max(boite.top, 0)
  const droite = Math.min(boite.right, fenetre.largeur)
  const bas = Math.min(boite.bottom, fenetre.hauteur)
  if (droite <= gauche || bas <= haut) return null
  return {
    x: gauche * zoom,
    y: haut * zoom,
    largeur: (droite - gauche) * zoom,
    hauteur: (bas - haut) * zoom
  }
}

/** Le même élément recliqué garde son nom : `addFiles` le dédoublonne par nom. */
function nomDeLImage(texte: string, rect: RectNavigateur): string {
  let empreinte = 5381
  for (const lettre of `${texte}|${Math.round(rect.x)}|${Math.round(rect.y)}`)
    empreinte = (empreinte * 33 + (lettre.codePointAt(0) ?? 0)) >>> 0
  return `element-${empreinte.toString(36)}.png`
}

async function capturer(element: Element, texte: string): Promise<File | null> {
  const api = window.api
  // Interface rechargée à chaud sur un moteur plus ancien : le pont n'a pas encore cette méthode.
  if (!api?.capturerElement) return null
  const rect = rectangleVisible(
    element.getBoundingClientRect(),
    { largeur: window.innerWidth, hauteur: window.innerHeight },
    api.getZoomFactor?.() ?? 1
  )
  if (!rect) return null
  let minuteur: ReturnType<typeof setTimeout> | undefined
  const delai = new Promise<null>((rendre) => {
    minuteur = setTimeout(() => rendre(null), DELAI_CAPTURE_MS)
  })
  try {
    const adresse = await Promise.race([api.capturerElement(rect), delai])
    return adresse ? fichierDeLaCapture(adresse, nomDeLImage(texte, rect)) : null
  } catch (erreur) {
    // La référence part sans image : le geste reste utile, mais la cause doit rester lisible.
    console.warn('[alt-clic] capture impossible, référence envoyée sans image', erreur)
    return null
  } finally {
    clearTimeout(minuteur)
  }
}

// ── Le geste ───────────────────────────────────────────────────────────────────────────────────

/** La fenêtre de mosaïque visée, `{}` hors mosaïque, ou `null` : aucune saisie à viser en mosaïque. */
function destinationDe(cible: Element): { fenetre?: string } | null {
  const fenetre = cible.closest('.chat-mosaic-window[data-conv-id]')?.getAttribute('data-conv-id')
  if (fenetre) return { fenetre }
  return cible.closest('.chat-layout.is-mosaic') ? null : {}
}

/** Le fil à nommer dans la référence : celui de la fenêtre, sinon le fil ouvert dans le chat. */
function filDe(cible: Element, fenetre: string | undefined): string | null {
  const actif = cible
    .closest('[data-active-conversation-id]')
    ?.getAttribute('data-active-conversation-id')
  return fenetre ?? (actif || null)
}

/**
 * Installé une fois par `App`, toujours monté. `ouvrirChat` n'est appelé qu'une fois la capture
 * prise. Rend la fonction qui retire les écouteurs.
 */
export function installerAltClic(ouvrirChat: () => void, fenetre: Window = window): () => void {
  let appui: EventTarget | null = null

  const traiter = (cible: Element, evenement: Event): void => {
    const destination = destinationDe(cible)
    if (!destination) return
    const texte = referenceDeLElement(cible, {
      conversationId: filDe(cible, destination.fenetre)
    })
    if (!texte) return
    evenement.preventDefault()
    evenement.stopPropagation()
    void capturer(elementVise(cible), texte).then((image) => {
      ouvrirChat()
      poserElementCible({ texte, image, ...destination })
    })
  }

  const surClic = (evenement: MouseEvent): void => {
    const { altKey, button, target } = evenement
    if (altKey && button === 0 && target instanceof Element) traiter(target, evenement)
  }
  const surAppui = (evenement: PointerEvent): void => {
    const { altKey, button, target } = evenement
    appui = altKey && button === 0 ? target : null
  }
  const surRelache = (evenement: PointerEvent): void => {
    const { altKey, button, target } = evenement
    const memeCible = appui === target
    appui = null
    if (!altKey || button !== 0 || !memeCible || !(target instanceof Element)) return
    // Un bouton actif recevra son `click` juste après : le traiter ici le ferait deux fois.
    if (target.closest('[disabled]')) traiter(target, evenement)
  }

  fenetre.addEventListener('click', surClic, true)
  fenetre.addEventListener('pointerdown', surAppui, true)
  fenetre.addEventListener('pointerup', surRelache, true)
  return () => {
    fenetre.removeEventListener('click', surClic, true)
    fenetre.removeEventListener('pointerdown', surAppui, true)
    fenetre.removeEventListener('pointerup', surRelache, true)
  }
}
