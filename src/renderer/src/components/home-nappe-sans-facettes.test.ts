/**
 * LA NAPPE FABRIQUE-T-ELLE ENCORE DES DROITES ? (conv-1582, « ya encore pas mal de lignes »)
 *
 * Trois passes ont corrigé le NUAGE (hash saturant, aplats, rotation par octave) et l'utilisateur
 * voyait toujours des arêtes rectilignes en travers de l'écran — y compris LOIN du nuage, sur le
 * fond étoilé. La couche restante qui couvre TOUT l'écran est la NAPPE, et son shader avait gardé
 * intacts les trois défauts déjà nommés comme fabriques de facettes dans le nuage.
 *
 * Mesure faite sur la capture de l'utilisateur (transformée de Hough sur le laplacien lissé, hors
 * zone d'interface) : deux FAISCEAUX de droites parallèles, à ~33° et ~135°, régulièrement
 * espacées de 50 à 90 px — la signature d'une grille de bruit, pas d'un maillage.
 *
 * L'oracle ci-dessous rejoue le champ de la nappe sur CPU et mesure ce même pic de Hough.
 * L'ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST SI LA CORRECTION EST FAUSSE : `champVariante('ancienne')`,
 * qui reconstitue exactement le shader d'avant (hash `sin(dot(...))`, fondu CUBIQUE, cinq octaves
 * NON tournées, `clamp` saturant). Si la version courante ne fait pas mieux qu'elle, le test casse.
 */
import { describe, expect, it } from 'vitest'
import { NAPPE_FRAGMENT_SHADER } from './home-decor-scene'

const f = Math.fround
const fract = (x: number): number => f(x - Math.floor(x))
const mix = (a: number, b: number, t: number): number => a + (b - a) * t
const cubique = (t: number): number => t * t * (3 - 2 * t)
const quintique = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10)

/** Le hash d'AVANT : `fract(sin(dot(p, k)) * 43758.5)`, qui sature et aligne ses cellules. */
const hashSin = (x: number, y: number): number =>
  fract(f(Math.sin(f(x * 127.1 + y * 311.7)) * 43758.5453123))

/** Le hash de MAINTENANT (Hoskins), sans transcendante, déjà retenu pour le nuage. */
function hashHoskins(px: number, py: number): number {
  let x = fract(f(px * 0.1031))
  let y = fract(f(py * 0.103))
  let z = fract(f(px * 0.0973))
  const d = f(f(x * f(y + 33.33)) + f(y * f(z + 33.33)) + f(z * f(x + 33.33)))
  x = f(x + d)
  y = f(y + d)
  z = f(z + d)
  return fract(f(f(x + y) * z))
}

type Hash = (x: number, y: number) => number
type Fondu = (t: number) => number

const bruit =
  (hash: Hash, fondu: Fondu) =>
  (px: number, py: number): number => {
    const ix = Math.floor(px)
    const iy = Math.floor(py)
    const ux = fondu(px - ix)
    const uy = fondu(py - iy)
    return mix(
      mix(hash(ix, iy), hash(ix + 1, iy), ux),
      mix(hash(ix, iy + 1), hash(ix + 1, iy + 1), ux),
      uy
    )
  }

// La rotation par octave : la même matrice que le nuage, propagée par produit.
const PAS: [number, number, number, number] = [0.4472136, -0.89442719, 0.89442719, 0.4472136]
const produit = (
  m: [number, number, number, number],
  n: [number, number, number, number]
): [number, number, number, number] => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3]
]

function fbm(variante: 'ancienne' | 'courante', px: number, py: number): number {
  const b = variante === 'ancienne' ? bruit(hashSin, cubique) : bruit(hashHoskins, quintique)
  let somme = 0
  let amplitude = 0.5
  let rot: [number, number, number, number] = [...PAS]
  for (let octave = 0; octave < 5; octave += 1) {
    somme += amplitude * b(px, py)
    if (variante === 'ancienne') {
      px = px * 2.03 + 17.3
      py = py * 2.03 + 9.1
    } else {
      const nx = (rot[0] * px + rot[1] * py) * 2.03 + 17.3
      const ny = (rot[2] * px + rot[3] * py) * 2.03 + 9.1
      px = nx
      py = ny
      rot = produit(PAS, rot)
    }
    amplitude *= 0.5
  }
  return somme
}

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** La carte des crêtes de la nappe, telle que le fragment shader la calcule. */
function champVariante(variante: 'ancienne' | 'courante', N: number, temps: number): Float64Array {
  const out = new Float64Array(N * N)
  for (let j = 0; j < N; j += 1) {
    for (let i = 0; i < N; i += 1) {
      const ux = ((i + 0.5) / N) * 3
      const uy = ((j + 0.5) / N) * 3
      const dx = temps * 0.011
      const dy = -temps * 0.007
      const w1 = fbm(variante, ux + dx, uy + dy)
      const w2 = fbm(variante, ux + 5.2 + dx * 1.7, uy + 1.3 + dy * 1.7)
      const champ = fbm(variante, ux + w1 * 1.6 + dx * 0.5, uy + w2 * 1.6 + dy * 0.5)
      out[j * N + i] =
        variante === 'ancienne'
          ? Math.pow(Math.min(1, Math.max(0, champ * 1.25)), 3.2)
          : Math.pow(smoothstep(0.02, 0.86, champ), 3.2)
    }
  }
  return out
}

/**
 * Le pic de Hough sur le laplacien lissé : combien de points de pli tombent sur UNE MÊME droite,
 * rapporté au côté de l'image. Un champ isotrope tourne autour de 0,20–0,29 ; un motif rayé
 * dépasse 1,6. C'est la mesure appliquée à la capture de l'utilisateur (0,46).
 */
function picDeDroites(map: Float64Array, N: number): number {
  const lap = new Float64Array(N * N)
  for (let y = 1; y < N - 1; y += 1) {
    for (let x = 1; x < N - 1; x += 1) {
      lap[y * N + x] = Math.abs(
        4 * map[y * N + x] -
          map[y * N + x + 1] -
          map[y * N + x - 1] -
          map[(y + 1) * N + x] -
          map[(y - 1) * N + x]
      )
    }
  }
  const points: Array<[number, number, number]> = []
  for (let y = 2; y < N - 2; y += 1) {
    for (let x = 2; x < N - 2; x += 1) points.push([x, y, lap[y * N + x]])
  }
  points.sort((a, b) => b[2] - a[2])
  const retenus = points.slice(0, Math.floor(N * N * 0.08))
  const NA = 180
  const D = Math.hypot(N, N)
  const NR = Math.round(D)
  const acc = new Int32Array(NA * NR)
  for (const [x, y] of retenus) {
    for (let a = 0; a < NA; a += 1) {
      const theta = (a * Math.PI) / NA
      const r = Math.round(x * Math.cos(theta) + y * Math.sin(theta) + D / 2)
      if (r >= 0 && r < NR) acc[a * NR + r] += 1
    }
  }
  let max = 0
  for (const v of acc) if (v > max) max = v
  return max / N
}

describe('la nappe ne fabrique plus de droites', () => {
  it('le contrôle positif — le shader d AVANT — dépasse le seuil, sinon la mesure ne mesure rien', () => {
    expect(picDeDroites(champVariante('ancienne', 160, 12), 160)).toBeGreaterThan(0.33)
  })

  it('le champ courant aligne moins ses plis que le shader d avant', () => {
    const N = 160
    for (const temps of [4, 12, 40]) {
      const avant = picDeDroites(champVariante('ancienne', N, temps), N)
      const courant = picDeDroites(champVariante('courante', N, temps), N)
      expect(courant, `t=${temps} : ${courant.toFixed(3)} vs ${avant.toFixed(3)}`).toBeLessThan(
        avant
      )
    }
  })

  it('le shader de la nappe a perdu les trois fabriques de facettes déjà retirées du nuage', () => {
    // 1. le hash saturant
    expect(NAPPE_FRAGMENT_SHADER).not.toContain('sin(dot(')
    // 2. le fondu cubique — remplacé par le quintique, de dérivée nulle aux bords de cellule
    expect(NAPPE_FRAGMENT_SHADER).toContain('f * f * f * (f * (f * 6.0 - 15.0) + 10.0)')
    // 3. les octaves alignées — chaque octave tourne désormais d'un angle qui avance
    expect(NAPPE_FRAGMENT_SHADER).toContain('rot = pas * rot;')
    // 4. l'aplat saturé, dont le bord est un iso-contour anguleux
    expect(NAPPE_FRAGMENT_SHADER).not.toContain('clamp(champ * 1.25')
  })
})
