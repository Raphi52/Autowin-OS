/**
 * LE GLYPHE DU HALO (2026-10-28, « le rond qui tourne autour je le veux plus gros et ça
 * doit être une glyphe ») : le halo n'était qu'un cercle pointillé à 4 px de la bille. C'est
 * maintenant un cercle magique de 92 px, DERRIÈRE le personnage : une couronne de runes (`.ge`) qui
 * tourne dans un sens, une étoile à six branches cerclée de points (`.gi`) qui tourne dans l'autre.
 * Tout est en `currentColor` : l'état choisit sa couleur et ses mouvements (`cssDeLEtat`).
 * Repère : le carré du halo (64 px, 1 unité = 1 px), centre en (32, 32) ; le glyphe en déborde.
 *
 * Partagé depuis le 2026-10-31 (« Implémenter la 6 · Sol magique ») : le sol de l'accueil
 * d'un fil vide (`AnimationAccueilChat`) est ce même cercle, couché sous la mascotte. Une seule
 * source : le jour où le glyphe change, les deux changent.
 */
export const RAYON_GLYPHE = 46
/** Le côté du carré du halo, en unités du dessin. */
export const TAILLE_GLYPHE = 64

const r2 = (v: number): number => Math.round(v * 100) / 100

/** Des runes à traits droits, debout, dans une boîte d'environ 2,4 × 3,4 centrée sur 0. */
const RUNES = [
  'M-.8 1.7V-1.7M-.8-1.7L.9-.8M-.8-.4L.9.5',
  'M-.8 1.7V-1.7L.8-.9L-.8 0L.9 1.7',
  'M0 1.7V-1.7M-1.1-1.4L0 0L1.1-1.4',
  'M-1.1 1.7L.9-.5L0-1.7L-.9-.5L1.1 1.7',
  'M-.7 1.7V-1.7M-.7-.9L.7 0L-.7.9',
  'M-1 1.7V-1.7L1 .3M1 1.7V-1.7L-1 .3',
  'M0 1.7V-1.7M-1.1-.6L0-1.7L1.1-.6',
  'M-.9-1.7L.9-.6L-.9.6L.9 1.7'
]

export function glypheDuHalo(): string {
  const c = TAILLE_GLYPHE / 2
  const R = RAYON_GLYPHE
  const interieur = R - 5.4
  const bande = (R + interieur) / 2
  const n = 24
  const runes = Array.from({ length: n }, (_, i) => {
    // Un losange plein aux quatre points cardinaux, une rune partout ailleurs.
    const noeud = i % 6 === 0
    const forme = noeud ? 'M0-1.7L1.3 0L0 1.7L-1.3 0Z' : RUNES[i % RUNES.length]
    return `<path${noeud ? ' class="gn"' : ''} d="${forme}" transform="rotate(${r2((360 / n) * i)} ${c} ${c}) translate(${c} ${r2(c - bande)})"/>`
  }).join('')
  const pointe = (k: number, r: number): readonly [number, number] => {
    const a = (Math.PI / 3) * k - Math.PI / 2
    return [r2(c + r * Math.cos(a)), r2(c + r * Math.sin(a))]
  }
  const rE = 37.5
  const triangle = (k0: number): string =>
    `M${[k0, k0 + 2, k0 + 4].map((k) => pointe(k, rE).join(' ')).join('L')}Z`
  const points = [0, 1, 2, 3, 4, 5]
    .map((k) => {
      const [x, y] = pointe(k, rE)
      return `<circle class="gn" cx="${x}" cy="${y}" r="1.2"/>`
    })
    .join('')
  return (
    `<circle cx="${c}" cy="${c}" r="29.5" stroke-width=".9"/>` +
    `<g class="gi"><circle cx="${c}" cy="${c}" r="34.5" stroke-width=".8" stroke-dasharray="1.2 2.4"/>` +
    `<path d="${triangle(0)}${triangle(1)}" stroke-width=".8"/>${points}</g>` +
    `<g class="ge"><circle cx="${c}" cy="${c}" r="${R}" stroke-width="1.1"/>` +
    `<circle cx="${c}" cy="${c}" r="${interieur}" stroke-width=".7"/>` +
    `<g class="gp" stroke-width=".6">${runes}</g></g>`
  )
}
