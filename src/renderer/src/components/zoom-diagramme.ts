import { LARGEUR_DESSIN_PAR_DEFAUT } from './zone-dessin-diagramme'

/**
 * LES CALCULS DE LA GRANDE VUE D'UN SCHÉMA (conv-1322, 2026-10-30 : « un schema que j'arrive pas a
 * lire et je peux pas l'agrandir »). Sans React ni page, pour se tester au chiffre près.
 *
 * Échelle 1 = la taille à laquelle mermaid a dessiné le schéma, donc son texte en 14 à 16 px : le
 * pourcentage affiché dit directement à quel point le texte est lisible.
 */

export interface Taille {
  largeur: number
  hauteur: number
}

export interface Point {
  x: number
  y: number
}

/** Où se pose le dessin dans le cadre : son coin haut gauche, et son échelle. */
export interface Vue extends Point {
  echelle: number
}

export const ECHELLE_MIN = 0.05
export const ECHELLE_MAX = 8
/** Un petit schéma de deux boîtes ne s'ouvre pas démesuré : au-delà, c'est à l'utilisateur de zoomer. */
export const ECHELLE_AJUSTEE_MAX = 2
/** Vide laissé autour du schéma ajusté, pour que ses bords ne collent pas à la fenêtre. */
export const MARGE_AJUSTEE = 24
/** Un schéma sans `viewBox` lisible se dessine à cette taille. */
export const TAILLE_DE_SECOURS: Taille = { largeur: LARGEUR_DESSIN_PAR_DEFAUT, hauteur: 600 }

const VITESSE_MOLETTE = 0.0015
/** Un pincement du pavé tactile arrive en petits pas, avec Ctrl : il va donc plus vite par pas. */
const VITESSE_PINCEMENT = 0.01
/**
 * Ctrl + molette arrive sous la même forme, mais par crans de 100 : sans plafond, un seul cran
 * multipliait l'échelle par 2,7 (sonde de conv-1322 : 66 % → 179 %).
 */
const PAS_PINCEMENT_MAX = 20

const borner = (echelle: number): number => Math.min(ECHELLE_MAX, Math.max(ECHELLE_MIN, echelle))

/** La taille naturelle du schéma, lue sur le `viewBox` de sa balise `<svg>` de tête. */
export function tailleDuSvg(svg: string): Taille | null {
  const entete = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? ''
  const valeurs = /\bviewBox\s*=\s*["']([^"']*)["']/i
    .exec(entete)?.[1]
    .trim()
    .split(/[\s,]+/)
  if (valeurs?.length !== 4) return null
  const [largeur, hauteur] = valeurs.slice(2).map(Number)
  return largeur > 0 && hauteur > 0 ? { largeur, hauteur } : null
}

/**
 * Le même dessin avec ses PROPRES identifiants. Mermaid y accroche ses styles et ses pointes de
 * flèche : deux fois le même identifiant dans une page lierait la grande vue au dessin du fil, et
 * ses flèches disparaîtraient avec lui. `idDuDessin` est unique par dessin : le remplacer partout
 * ne touche que ces références.
 */
export function copieDuSvg(svg: string, idDuDessin: string): string {
  return svg.replaceAll(idDuDessin, `${idDuDessin}-agrandi`)
}

/** Le schéma entier dans le cadre, centré. */
export function vueAjustee(dessin: Taille, cadre: Taille): Vue {
  const echelle = borner(
    Math.min(
      (cadre.largeur - 2 * MARGE_AJUSTEE) / dessin.largeur,
      (cadre.hauteur - 2 * MARGE_AJUSTEE) / dessin.hauteur,
      ECHELLE_AJUSTEE_MAX
    )
  )
  return {
    echelle,
    x: (cadre.largeur - dessin.largeur * echelle) / 2,
    y: (cadre.hauteur - dessin.hauteur * echelle) / 2
  }
}

/** Zoome en gardant immobile le point du dessin qui est sous `point` (le pointeur, en général). */
export function zoomerAutourDe(vue: Vue, facteur: number, point: Point): Vue {
  const echelle = borner(vue.echelle * facteur)
  const rapport = echelle / vue.echelle
  return {
    echelle,
    x: point.x - (point.x - vue.x) * rapport,
    y: point.y - (point.y - vue.y) * rapport
  }
}

/** Exponentiel : un cran vers le haut puis un vers le bas ramène exactement à l'échelle de départ. */
export function facteurDeMolette(deltaY: number, pincement: boolean): number {
  if (!pincement) return Math.exp(-deltaY * VITESSE_MOLETTE)
  const pas = Math.min(PAS_PINCEMENT_MAX, Math.max(-PAS_PINCEMENT_MAX, deltaY))
  return Math.exp(-pas * VITESSE_PINCEMENT)
}
