/**
 * LA TENUE DES AGENTS À LA COULEUR CHOISIE (demande utilisateur du 2026-11-06).
 *
 * Demande : « je veux un settings pour choisir la couleur de leur tenue en dessous du setting où je
 * choisis l'animal », puis « vire le foulard ». La couleur se choisit dans les réglages de l'Accueil,
 * comme l'animal, et les collègues voient la même (`TENUES_AGENTS`, src/shared/quartier-presence.ts) :
 * c'est elle, avec l'animal, qui distingue désormais les agents d'un collègue, et non plus un foulard.
 *
 * Les atlas sont des rendus 3D peints une fois pour toutes : aucun calque ne sépare la tenue du reste.
 * Mais chaque animal porte une tenue d'une teinte que son pelage n'a pas, mesuré sur les atlas
 * (pixels de saturation > 0,3) : kimono orange et pantalon brun du tanuki à 10-40°, sur un
 * pelage gris ; veste turquoise du renard à 160-180°, pelage roux à 10-30° ; gilet vert du panda à
 * 80-100°, pelage noir et blanc ; veste bleue du panda roux à 210-240°, pelage roux à 10-30°. Le masque
 * de la tenue se lit donc à la teinte, une fois par animal. La couleur s'y pose en mode « color » : teinte
 * et saturation de la couleur choisie, luminosité de la peinture ; plis, ombres et étoiles restent peints.
 */
import { contexte, toile } from './quartier-vie'
import type { AnimalAgent, TenueAgent } from '../../../shared/quartier-presence'

/**
 * La teinte de chaque couleur de tenue. Peinte sur le décor, elle ne suit pas le thème de l'app. En mode
 * « color », seules sa teinte et sa saturation comptent : la luminosité reste celle de la tenue peinte.
 */
export const TEINTE_DES_TENUES: Readonly<Record<TenueAgent, string>> = {
  rouge: '#c8323c', // couleur-fixe: tenue d'un agent peinte sur le décor
  orange: '#e8742a', // couleur-fixe: tenue d'un agent peinte sur le décor
  jaune: '#e6b422', // couleur-fixe: tenue d'un agent peinte sur le décor
  vert: '#3f9b3a', // couleur-fixe: tenue d'un agent peinte sur le décor
  turquoise: '#14a6a6', // couleur-fixe: tenue d'un agent peinte sur le décor
  bleu: '#2f5fbf', // couleur-fixe: tenue d'un agent peinte sur le décor
  violet: '#7a4fc4', // couleur-fixe: tenue d'un agent peinte sur le décor
  rose: '#e0588f' // couleur-fixe: tenue d'un agent peinte sur le décor
}

/**
 * Ce qui est de la tenue, pour un animal : une teinte entre `h0` et `h1` degrés (fondue sur 8° de part et
 * d'autre), assez saturée (`s0`, fondue sur ± 0,1), assez claire (de `v0` à `v1`). Le tanuki demande plus
 * de saturation et de clarté : l'intérieur de ses oreilles et ses sourcils sont d'un brun voisin de son
 * pantalon, mais plus ternes ou plus sombres (vu sur la planche).
 */
export interface FenetreDeTenue {
  h0: number
  h1: number
  s0: number
  v0: number
  v1: number
}

export const FENETRES_DE_TENUE: Readonly<Record<AnimalAgent, FenetreDeTenue>> = {
  tanuki: { h0: 8, h1: 45, s0: 0.5, v0: 0.2, v1: 0.32 },
  renard: { h0: 150, h1: 205, s0: 0.25, v0: 0.06, v1: 0.16 },
  panda: { h0: 55, h1: 135, s0: 0.3, v0: 0.06, v1: 0.16 },
  'panda-roux': { h0: 195, h1: 255, s0: 0.25, v0: 0.06, v1: 0.16 }
}

const rampe = (x: number, a: number, b: number): number =>
  x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a)

/**
 * Le masque de la tenue d'une image RGBA (non prémultipliée, comme `getImageData`) : une valeur de 0 à 255
 * par pixel, déjà multipliée par l'opacité du pixel pour ne jamais teinter le décor au bord du personnage.
 */
export function masqueDeTenue(rgba: Uint8ClampedArray, f: FenetreDeTenue): Uint8Array {
  const n = rgba.length >> 2
  const sortie = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3]
    if (a < 8) continue
    const r = rgba[i * 4] / 255
    const g = rgba[i * 4 + 1] / 255
    const b = rgba[i * 4 + 2] / 255
    const mx = Math.max(r, g, b)
    const d = mx - Math.min(r, g, b)
    if (d <= 1e-6 || mx <= 0) continue
    const s = d / mx
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
    const poids =
      Math.min(rampe(h, f.h0 - 8, f.h0), 1 - rampe(h, f.h1, f.h1 + 8)) *
      rampe(s, f.s0 - 0.1, f.s0 + 0.1) *
      rampe(mx, f.v0, f.v1)
    sortie[i] = Math.round(poids * a)
  }
  return sortie
}

/** `#rrggbb` en trois octets. */
function octets(hex: string): [number, number, number] {
  const v = Number.parseInt(hex.slice(1), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

/**
 * Une case de l'atlas, teinte de la couleur choisie là où est la tenue, transparente ailleurs : à poser
 * sur le personnage en mode « color ». `masque` couvre toute la planche de base (`largeur` px de large).
 */
export function caseDeTenue(
  masque: Uint8Array,
  largeur: number,
  c: number,
  r: number,
  cw: number,
  ch: number,
  tenue: TenueAgent
): HTMLCanvasElement {
  const [R, G, B] = octets(TEINTE_DES_TENUES[tenue])
  const k = toile(cw, ch)
  const g = contexte(k)
  const im = g.createImageData(cw, ch)
  const d = im.data
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const m = masque[(r * ch + y) * largeur + c * cw + x]
      if (!m) continue
      const o = (y * cw + x) * 4
      d[o] = R
      d[o + 1] = G
      d[o + 2] = B
      d[o + 3] = m
    }
  g.putImageData(im, 0, 0)
  return k
}

/**
 * Les cases déjà teintes, au plus `max` (les plus anciennes partent d'abord). Une case de 126 × 170 pèse
 * ~86 ko : 512 cases font ~44 Mo au pire, pour une planche de 336 cases par animal et par couleur.
 */
export function creerCasesDeTenue(max = 512): {
  lire: (cle: string, fabriquer: () => HTMLCanvasElement) => HTMLCanvasElement
  taille: () => number
} {
  const cases = new Map<string, HTMLCanvasElement>()
  return {
    lire(cle, fabriquer) {
      const deja = cases.get(cle)
      if (deja) {
        // Relue : elle repasse en dernier, la plus récente.
        cases.delete(cle)
        cases.set(cle, deja)
        return deja
      }
      const neuve = fabriquer()
      cases.set(cle, neuve)
      while (cases.size > max) cases.delete(cases.keys().next().value as string)
      return neuve
    },
    taille: () => cases.size
  }
}
