/**
 * LA FENÊTRE PRINCIPALE SE SOUVIENT DE SA PLACE.
 *
 * Constaté par l'utilisateur le 2026-10-13 : « quand je suis en mode réduit et que je ferme et que
 * j'ouvre l'app, ça se souvient pas de où j'avais mis la fenêtre et à quelle taille ». Cause lue dans
 * `window.ts` : la fenêtre naissait TOUJOURS en 900×670 puis était forcée en plein écran
 * (`maximize: true`) — aucune position n'était jamais écrite ni relue.
 *
 * Ce fichier ne contient que des règles PURES (lire, écrire, ramener à l'écran) : les appels
 * Electron et le disque restent dans `window.ts`.
 */

export type Rect = { x: number; y: number; width: number; height: number }

/** Taille et place de la fenêtre NON agrandie, plus le fait qu'elle était agrandie ou non. */
export type EtatFenetre = Rect & { maximisee: boolean }

/** Nom du fichier, sous le dossier de données de l'application. */
export const FICHIER_ETAT_FENETRE = 'fenetre-principale.json'

/** En dessous, la fenêtre n'est plus utilisable : une valeur enregistrée plus petite est remontée. */
export const TAILLE_MINIMALE = { width: 480, height: 360 }

/**
 * Bande du haut qu'il faut voir à l'écran pour pouvoir attraper la fenêtre (barre de titre de
 * 28 px dans `window.ts`, et assez de largeur pour viser à côté des boutons).
 */
const BANDE_ATTRAPABLE = { hauteur: 28, largeur: 120 }

const nombreFini = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Relit le contenu du fichier. Absent, illisible ou incomplet → null (comportement par défaut). */
export function lireEtatFenetre(texte: string | null | undefined): EtatFenetre | null {
  if (!texte) return null
  let brut: unknown
  try {
    brut = JSON.parse(texte)
  } catch {
    return null
  }
  if (!brut || typeof brut !== 'object') return null
  const o = brut as Record<string, unknown>
  if (!nombreFini(o.x) || !nombreFini(o.y) || !nombreFini(o.width) || !nombreFini(o.height)) {
    return null
  }
  if (o.width <= 0 || o.height <= 0) return null
  return {
    x: Math.round(o.x),
    y: Math.round(o.y),
    width: Math.round(o.width),
    height: Math.round(o.height),
    maximisee: o.maximisee === true
  }
}

export function ecrireEtatFenetre(etat: EtatFenetre): string {
  const { x, y, width, height, maximisee } = etat
  return JSON.stringify({ x, y, width, height, maximisee })
}

function intersection(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const droite = Math.min(a.x + a.width, b.x + b.width)
  const bas = Math.min(a.y + a.height, b.y + b.height)
  return droite > x && bas > y ? { x, y, width: droite - x, height: bas - y } : null
}

/**
 * Où rouvrir la fenêtre, d'après l'état enregistré et les écrans BRANCHÉS MAINTENANT.
 *
 * - Sa barre de titre est encore attrapable sur un écran → on la rend telle qu'elle était.
 * - Sinon (écran débranché, résolution changée) → elle est ramenée dans l'écran qu'elle chevauche
 *   le plus, ou à défaut le premier de la liste (l'appelant passe l'écran principal en tête),
 *   réduite si elle est plus grande que lui. Une fenêtre rouverte hors de tout écran serait
 *   invisible : c'est le piège que ce cas évite.
 *
 * `zones` = zones utiles des écrans (sans la barre des tâches). Liste vide → null.
 */
export function placerFenetreMemorisee(
  etat: EtatFenetre,
  zones: readonly Rect[]
): EtatFenetre | null {
  if (zones.length === 0) return null
  const width = Math.max(etat.width, TAILLE_MINIMALE.width)
  const height = Math.max(etat.height, TAILLE_MINIMALE.height)
  const fenetre: Rect = { x: etat.x, y: etat.y, width, height }

  const bandeHaute: Rect = { x: fenetre.x, y: fenetre.y, width, height: BANDE_ATTRAPABLE.hauteur }
  const attrapable = zones.some((zone) => {
    const vue = intersection(bandeHaute, zone)
    return vue !== null && vue.width >= Math.min(BANDE_ATTRAPABLE.largeur, width)
  })
  if (attrapable) return { ...fenetre, maximisee: etat.maximisee }

  const surface = (r: Rect | null): number => (r ? r.width * r.height : 0)
  const zone = zones.reduce(
    (meilleure, z) =>
      surface(intersection(fenetre, z)) > surface(intersection(fenetre, meilleure)) ? z : meilleure,
    zones[0]
  )
  const largeur = Math.min(width, zone.width)
  const hauteur = Math.min(height, zone.height)
  const borner = (v: number, min: number, max: number): number => Math.min(Math.max(v, min), max)
  return {
    x: Math.round(borner(fenetre.x, zone.x, zone.x + zone.width - largeur)),
    y: Math.round(borner(fenetre.y, zone.y, zone.y + zone.height - hauteur)),
    width: largeur,
    height: hauteur,
    maximisee: etat.maximisee
  }
}
