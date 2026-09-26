/**
 * Onglets de vues « comme un navigateur » (demande conv-685 du 2026-09-18) : chaque vue ouverte
 * devient un onglet, qu'on peut réordonner ou lâcher HORS de la fenêtre pour l'ouvrir dans sa
 * propre fenêtre (sur un autre écran). Logique pure, partagée par le renderer et le main.
 */
import { APP_DESTINATIONS, type AppDestination } from './navigation'

const IDS = new Set<string>(APP_DESTINATIONS.map((d) => d.id))

export function isAppDestination(value: unknown): value is AppDestination {
  return typeof value === 'string' && IDS.has(value)
}

/** Ferme un onglet ; si c'était l'actif, l'actif devient son voisin (droite, sinon gauche). */
export function fermerOnglet<T>(
  onglets: readonly T[],
  vue: T,
  actif: T
): { onglets: T[]; actif: T | null } {
  const index = onglets.indexOf(vue)
  if (index < 0) return { onglets: [...onglets], actif }
  const restants = onglets.filter((o) => o !== vue)
  if (vue !== actif) return { onglets: restants, actif }
  return { onglets: restants, actif: restants[index] ?? restants[index - 1] ?? null }
}

/** Déplace l'onglet `vue` à la place de `cible` (glisser-déposer dans la barre). */
export function deplacerOnglet<T>(onglets: readonly T[], vue: T, cible: T): T[] {
  const de = onglets.indexOf(vue)
  const vers = onglets.indexOf(cible)
  if (de < 0 || vers < 0 || de === vers) return [...onglets]
  const copie = [...onglets]
  copie.splice(de, 1)
  copie.splice(vers, 0, vue)
  return copie
}

/**
 * Le lâcher est-il HORS de la fenêtre ? Le glisser-déposer HTML5 ne le dit pas de façon fiable :
 * on compare la position écran de la souris en fin de geste aux limites écran de la fenêtre.
 * (0,0) exact est ignoré : Chromium le rend quand le geste est annulé (Échap).
 */
export function lacheHorsFenetre(
  point: { screenX: number; screenY: number },
  fenetre: { x: number; y: number; width: number; height: number }
): boolean {
  if (point.screenX === 0 && point.screenY === 0) return false
  return (
    point.screenX < fenetre.x ||
    point.screenY < fenetre.y ||
    point.screenX > fenetre.x + fenetre.width ||
    point.screenY > fenetre.y + fenetre.height
  )
}

/** La vue d'une fenêtre détachée, lue dans son adresse (`#view=chat`), ou `null`. */
export function vueDetacheeDepuisHash(hash: string): AppDestination | null {
  const match = /^#view=([a-z-]+)$/.exec(hash)
  return match && isAppDestination(match[1]) ? match[1] : null
}

type Rect = { x: number; y: number; width: number; height: number }

/**
 * Où poser la fenêtre détachée : centrée horizontalement sur le point de lâcher, puis RAMENÉE dans
 * la zone utile de l'écran qui contient ce point — sinon un lâcher près d'un bord laisse une partie
 * de la fenêtre hors de l'écran.
 */
export function placerFenetreDetachee(
  point: { screenX: number; screenY: number },
  taille: { width: number; height: number },
  zoneEcran: Rect
): Rect {
  const width = Math.min(taille.width, zoneEcran.width)
  const height = Math.min(taille.height, zoneEcran.height)
  const borner = (v: number, min: number, max: number): number => Math.min(Math.max(v, min), max)
  return {
    x: Math.round(
      borner(point.screenX - width / 2, zoneEcran.x, zoneEcran.x + zoneEcran.width - width)
    ),
    y: Math.round(borner(point.screenY - 20, zoneEcran.y, zoneEcran.y + zoneEcran.height - height)),
    width,
    height
  }
}
