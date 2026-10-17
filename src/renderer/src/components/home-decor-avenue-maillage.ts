/**
 * LES CORPS DE LA FOULE DE L'AVENUE : sculptés par champ de distance, puis maillés.
 *
 * Porté du brouillon validé par l'utilisateur (conv-301, `.autowin-tmp/draft-cyber/r-avenue.js`) :
 * il refusait les personnages en « boules et tubes » (« c'est encore des stickmans »). Chaque
 * silhouette est donc UN volume d'un seul tenant, vêtements compris (manteau long, capuche ample,
 * cargo), teinté par zones, assombri dans les creux et pondéré pour un vrai squelette. Le visage est
 * une tête fine maillée à part, à 5 mm : à 2 cm, un œil tient dans une seule case.
 *
 * POURQUOI CE FICHIER EST SÉPARÉ ET DÉCOUPÉ EN TRANCHES. Mesuré le 2026-10-17 sous Node : cinq corps
 * de 359 à 837 ms et deux têtes de 768 et 898 ms, soit 4,5 s de calcul d'un seul tenant. Le brouillon
 * le payait au chargement (« environ 5 s de noir »). Derrière l'Accueil, ce serait 4,5 s de fenêtre
 * figée à chaque ouverture. Le calcul est donc écrit en GÉNÉRATEURS qui rendent la main très souvent,
 * et l'appelant le fait avancer par petites tranches entre deux images. Rien ici ne touche à WebGL :
 * ce sont des tableaux de nombres, testables sans navigateur.
 *
 * LE RÉSULTAT EST GARDÉ POUR TOUTE LA SESSION (`preparationHumains`) : changer de thème ou revenir sur
 * l'Accueil reconstruit la scène, pas les corps.
 */

/** La tenue d'un personnage : la forme du corps, ses couleurs et son équipement néon. */
export interface Tenue {
  forme: NomForme
  type: 'manteau' | 'bomber' | 'sweat' | 'doudoune'
  femme?: boolean
  capuche?: 'ample' | 'normale'
  lisere?: boolean
  cargo?: boolean
  sac?: boolean
  poches?: boolean
  barbe?: boolean
  bandes?: boolean
  casquette?: boolean
  cheveux?: 'longs'
  jean?: 'slim'
  taille?: number
  parapluie?: string
  haut?: number
  bas?: number
  peau: number
  accent?: number
  couleurCheveux?: number
  chaussure?: number
  semelle?: number
  masque?: 'ombre' | 'respirateur' | 'visiere'
  neon?: string
  implant?: 'circuit' | 'traits' | 'front' | 'oeil'
}

/** Les cinq morphologies de la foule ; chaque passant en réutilise une, sans remailler. */
export type NomForme = 'M' | 'N' | 'C' | 'O' | 'E'

/** Ce qui façonne le VOLUME d'une forme. Les couleurs n'en font pas partie : elles sont posées après. */
type Gabarit = Pick<
  Tenue,
  'type' | 'femme' | 'capuche' | 'cargo' | 'sac' | 'casquette' | 'cheveux' | 'jean'
>

/**
 * Le gabarit de chaque forme.
 *
 * Le brouillon maillait chaque forme d'après la PREMIÈRE tenue qui la portait (le dealer pour `M`, le
 * client pour `C`, le taggeur pour `E`, les deux membres du couple pour `N` et `O`). Ce sont donc ces
 * gabarits-là, recopiés, qui donnent les mêmes corps que ceux que l'utilisateur a regardés.
 */
export const GABARITS: Record<NomForme, Gabarit> = {
  M: { type: 'manteau', capuche: 'ample', cargo: true },
  C: { type: 'bomber', casquette: true, jean: 'slim' },
  E: { type: 'sweat', capuche: 'ample', cargo: true, sac: true },
  N: { type: 'manteau', femme: true, cheveux: 'longs', jean: 'slim' },
  O: { type: 'manteau', jean: 'slim' }
}

// ---------- LE SQUELETTE ----------
export const NOMS_OS = [
  'hanches',
  'ventre',
  'poitrine',
  'cou',
  'tete',
  'bras0',
  'avant0',
  'main0',
  'bras1',
  'avant1',
  'main1',
  'cuisse0',
  'mollet0',
  'pied0',
  'cuisse1',
  'mollet1',
  'pied1'
] as const
export const PARENT_OS = [-1, 0, 1, 2, 3, 2, 5, 6, 2, 8, 9, 0, 11, 12, 0, 14, 15] as const
type V3 = [number, number, number]
/** Racine de chaque os au repos, en mètres, dans le repère du corps. */
export const REPOS: V3[] = []
/** Extrémité de chaque os au repos. */
export const QUEUE: V3[] = []
{
  REPOS.push([0, 0.98, 0], [0, 1.13, 0], [0, 1.31, 0], [0, 1.5, 0], [0, 1.6, 0.005])
  QUEUE.push([0, 1.13, 0], [0, 1.31, 0], [0, 1.5, 0], [0, 1.6, 0.005], [0, 1.82, 0.01])
  for (const s of [-1, 1]) {
    REPOS.push([s * 0.18, 1.45, -0.005], [s * 0.27, 1.185, 0], [s * 0.345, 0.945, 0.015])
    QUEUE.push([s * 0.27, 1.185, 0], [s * 0.345, 0.945, 0.015], [s * 0.365, 0.86, 0.02])
  }
  for (const s of [-1, 1]) {
    REPOS.push([s * 0.108, 0.95, 0], [s * 0.118, 0.52, 0.01], [s * 0.128, 0.1, -0.005])
    QUEUE.push([s * 0.118, 0.52, 0.01], [s * 0.128, 0.1, -0.005], [s * 0.128, 0.04, 0.16])
  }
}
// os candidats par membre (le dernier sert d'attache au tronc)
const GROUPES_OS = [
  [0, 1, 2, 3, 4],
  [5, 6, 7, 2],
  [8, 9, 10, 2],
  [11, 12, 13, 0],
  [14, 15, 16, 0]
]

// ---------- LES PRIMITIVES DU CHAMP DE DISTANCE ----------
type Champ3 = (x: number, y: number, z: number) => number
/** Une primitive bornée : son champ, plus une sphère englobante (centre `c`, rayon `R`) et sa pente `k`. */
type Primitive = Champ3 & { c: number[]; R: number; k: number }

/** Position du dernier projeté sur le segment, lue juste après `seg` (chemin chaud : pas d'allocation). */
let TT = 0
export function seg(
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number
): number {
  const ux = bx - ax,
    uy = by - ay,
    uz = bz - az
  const vx = px - ax,
    vy = py - ay,
    vz = pz - az
  let t = (vx * ux + vy * uy + vz * uz) / (ux * ux + uy * uy + uz * uz)
  t = t < 0 ? 0 : t > 1 ? 1 : t
  TT = t
  const dx = vx - ux * t,
    dy = vy - uy * t,
    dz = vz - uz * t
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}
function borne(f: Champ3, c: number[], R: number, k = 1): Primitive {
  return Object.assign(f, { c, R, k })
}
/** Cône arrondi entre a et b, aplati d'avant en arrière par sz, rayon modulable (plis, matelassage). */
export function cone(
  a: number[],
  b: number[],
  ra: number,
  rb: number,
  sz = 1,
  mod: Champ3 | null = null
): Primitive {
  return borne(
    (x, y, z) => {
      const d = seg(x, y, z / sz, a[0], a[1], a[2] / sz, b[0], b[1], b[2] / sz)
      let r = ra + (rb - ra) * TT
      if (mod) r += mod(x, y, z)
      return (d - r) * (sz < 1 ? sz : 1)
    },
    [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
    Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 2 + Math.max(ra, rb) + 0.012,
    Math.min(1, sz)
  )
}
export function ell(c: number[], r: number[]): Primitive {
  return borne(
    (x, y, z) => {
      const qx = (x - c[0]) / r[0],
        qy = (y - c[1]) / r[1],
        qz = (z - c[2]) / r[2]
      return (Math.sqrt(qx * qx + qy * qy + qz * qz) - 1) * Math.min(r[0], r[1], r[2])
    },
    c,
    Math.max(r[0], r[1], r[2]),
    Math.min(r[0], r[1], r[2]) / Math.max(r[0], r[1], r[2])
  )
}
function boite(c: number[], h: number[], r: number): Primitive {
  return borne(
    (x, y, z) => {
      const qx = Math.abs(x - c[0]) - h[0] + r,
        qy = Math.abs(y - c[1]) - h[1] + r,
        qz = Math.abs(z - c[2]) - h[2] + r
      const ox = Math.max(qx, 0),
        oy = Math.max(qy, 0),
        oz = Math.max(qz, 0)
      return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - r
    },
    c,
    Math.hypot(h[0], h[1], h[2])
  )
}
export function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}
function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k)
}

// zones : 0 peau, 1 haut, 2 bas, 3 chaussure, 4 semelle, 5 accessoire, 6 cheveux
// les deux capuches : la normale, et l'ample qui avance au-dessus du visage et tombe sur les épaules
export interface Capuche {
  c: number[]
  r: number[]
  oc: number[]
  or: number[]
}
export const CAPUCHES: Record<'normale' | 'ample', Capuche> = {
  normale: {
    c: [0, 1.715, -0.012],
    r: [0.125, 0.14, 0.148],
    oc: [0, 1.69, 0.12],
    or: [0.088, 0.108, 0.09]
  },
  ample: {
    c: [0, 1.722, 0.0],
    r: [0.152, 0.168, 0.168],
    oc: [0, 1.68, 0.17],
    or: [0.096, 0.118, 0.1]
  }
}
export function capucheDe(o: Pick<Tenue, 'capuche'>): Capuche {
  return o.capuche === 'ample' ? CAPUCHES.ample : CAPUCHES.normale
}

interface Silhouette {
  champ(x: number, y: number, z: number, detail: boolean, liste?: number[]): number
  sortie: { zone: number; groupe: number }
  proches(x: number, y: number, z: number, marge: number): number[]
}

function silhouette(o: Gabarit): Silhouette {
  const P: { g: number; z: number; f: Primitive }[] = []
  const add = (g: number, z: number, f: Primitive): void => {
    P.push({ g, z, f })
  }
  const f = o.femme ? 0.92 : 1
  const pli =
    (amp: number, fr: number): Champ3 =>
    (x, y, z) =>
      amp * Math.sin(y * fr + Math.atan2(z, x) * 3)
  const mat: Champ3 = (_x, y) => 0.003 * Math.cos(y * 56)
  // le tronc
  add(0, 2, cone([0, 0.84, 0], [0, 1.0, 0], 0.152 * f + (o.femme ? 0.008 : 0), 0.15 * f, 0.74))
  if (o.type === 'doudoune') {
    add(0, 1, cone([0, 0.9, 0.005], [0, 1.36, 0], 0.205 * f, 0.215 * f, 0.72, mat))
    for (const s of [-1, 1])
      add(0, 1, cone([0, 1.42, -0.01], [s * 0.165, 1.37, -0.005], 0.082, 0.095))
    add(0, 1, cone([0, 1.42, 0], [0, 1.57, 0.012], 0.092, 0.088))
  } else if (o.type === 'manteau') {
    // manteau long : buste ajusté, col montant qui cache le cou, ceinture
    add(0, 1, cone([0, 0.93, 0.005], [0, 1.35, 0], 0.168 * f, 0.178 * f, 0.68, pli(0.003, 22)))
    for (const s of [-1, 1])
      add(0, 1, cone([0, 1.43, -0.01], [s * 0.165, 1.375, -0.005], 0.066, 0.08))
    add(0, 1, cone([0, 1.4, -0.005], [0, 1.585, 0.004], 0.09, 0.08, 0.92))
    add(0, 5, cone([0, 0.985, 0.006], [0, 1.02, 0.006], 0.176 * f, 0.176 * f, 0.7))
    // la jupe du manteau, fixée aux hanches : fermée à la taille, elle s'ouvre devant en descendant, coupée net en bas
    const jupe = cone([0, 1.0, -0.012], [0, 0.4, -0.035], 0.172 * f, 0.215 * f, 0.84, pli(0.006, 9))
    add(
      0,
      1,
      borne(
        (x, y, z) => Math.max(jupe(x, y, z), z - (0.08 - 0.21 * Math.max(0, 0.95 - y)), 0.37 - y),
        jupe.c,
        jupe.R,
        jupe.k
      )
    )
  } else if (o.type === 'bomber') {
    add(0, 1, cone([0, 0.95, 0.005], [0, 1.35, 0], 0.172 * f, 0.178 * f, 0.68, pli(0.004, 30)))
    add(0, 1, cone([0, 0.93, 0], [0, 0.97, 0], 0.158 * f, 0.162 * f, 0.68))
    for (const s of [-1, 1])
      add(0, 1, cone([0, 1.43, -0.01], [s * 0.165, 1.375, -0.005], 0.064, 0.078))
    add(0, 1, cone([0, 1.43, 0], [0, 1.5, 0.008], 0.08, 0.075))
  } else {
    add(0, 1, cone([0, 0.89, 0.005], [0, 1.08, 0.005], 0.158 * f, 0.162 * f, 0.66, pli(0.005, 26)))
    add(0, 1, cone([0, 1.08, 0.005], [0, 1.35, 0], 0.162 * f, 0.176 * f, 0.66, pli(0.005, 26)))
    // trapèzes : l'épaule descend du cou vers le bras
    for (const s of [-1, 1])
      add(0, 1, cone([0, 1.43, -0.01], [s * 0.165, 1.375, -0.005], 0.062, 0.075))
    add(0, 1, ell([0, 1.03, 0.1], [0.12, 0.07, 0.035]))
  }
  add(0, 0, cone([0, 1.44, 0], [0, 1.6, 0.005], 0.055, 0.05))
  // le crâne du corps reste en retrait : le visage fin (champTete) le recouvre
  add(0, 0, ell([0, 1.69, 0.0], [0.06, 0.085, 0.07]))
  if (o.capuche) {
    const H = capucheDe(o)
    const coque = ell(H.c, H.r)
    const ouverture = ell(H.oc, H.or)
    add(
      0,
      1,
      borne((x, y, z) => Math.max(coque(x, y, z), -ouverture(x, y, z)), coque.c, coque.R, coque.k)
    )
    if (o.capuche === 'ample') {
      // le tissu retombe en pèlerine sur les épaules et dans le dos
      add(0, 1, cone([0, 1.64, -0.08], [0, 1.4, -0.12], 0.12, 0.15))
      for (const s of [-1, 1])
        add(0, 1, cone([s * 0.05, 1.6, -0.03], [s * 0.17, 1.44, -0.03], 0.075, 0.085, 0.85))
    } else add(0, 1, cone([0, 1.66, -0.07], [0, 1.44, -0.105], 0.1, 0.125))
  } else {
    add(0, 6, ell([0, 1.748, -0.03], [0.084, 0.084, 0.095]))
    if (o.cheveux === 'longs') add(0, 6, cone([0, 1.72, -0.05], [0, 1.43, -0.08], 0.088, 0.07, 0.8))
    if (o.casquette) {
      add(0, 5, ell([0, 1.775, -0.01], [0.09, 0.055, 0.1]))
      add(0, 5, boite([0, 1.765, 0.12], [0.076, 0.007, 0.06], 0.006))
    }
  }
  if (o.sac) add(0, 5, boite([0, 1.22, -0.19], [0.14, 0.19, 0.075], 0.05))
  // les bras
  for (const [g, s] of [
    [1, -1],
    [2, 1]
  ]) {
    const ep = o.type === 'doudoune' ? 0.078 : 0.066
    add(g, 1, ell([s * 0.173, 1.43, -0.005], [ep - 0.012, ep - 0.012, ep - 0.012]))
    add(
      g,
      1,
      cone(
        [s * 0.18, 1.43, -0.005],
        [s * 0.27, 1.185, 0],
        ep - 0.006,
        ep - 0.008,
        1,
        o.type === 'doudoune' ? mat : pli(0.004, 40)
      )
    )
    add(
      g,
      1,
      cone(
        [s * 0.27, 1.185, 0],
        [s * 0.335, 0.985, 0.012],
        ep - 0.01,
        ep - 0.016,
        1,
        o.type === 'doudoune' ? mat : pli(0.004, 40)
      )
    )
    add(g, 0, ell([s * 0.351, 0.905, 0.018], [0.034, 0.072, 0.046]))
    add(g, 0, cone([s * 0.333, 0.95, 0.04], [s * 0.327, 0.905, 0.058], 0.016, 0.013))
  }
  // les jambes
  for (const [g, s] of [
    [3, -1],
    [4, 1]
  ]) {
    const large = o.jean === 'slim' ? [0.084, 0.064, 0.062, 0.056] : [0.1, 0.082, 0.08, 0.074]
    add(
      g,
      2,
      cone([s * 0.108, 0.97, 0], [s * 0.118, 0.52, 0.01], large[0], large[1], 1, pli(0.004, 34))
    )
    add(
      g,
      2,
      cone(
        [s * 0.118, 0.52, 0.01],
        [s * 0.127, 0.17, -0.005],
        large[2],
        large[3],
        1,
        pli(0.005, 40)
      )
    )
    if (o.jean !== 'slim')
      add(g, 2, cone([s * 0.127, 0.23, 0], [s * 0.128, 0.15, -0.006], 0.082, 0.086))
    if (o.cargo) add(g, 2, ell([s * 0.19, 0.72, 0.0], [0.03, 0.08, 0.065]))
    add(g, 3, boite([s * 0.128, 0.068, 0.035], [0.053, 0.05, 0.132], 0.04))
    add(g, 3, cone([s * 0.127, 0.14, -0.012], [s * 0.128, 0.08, 0.02], 0.056, 0.052))
    add(g, 4, boite([s * 0.128, 0.018, 0.035], [0.059, 0.018, 0.137], 0.012))
  }
  const K = [0.045, 0.022, 0.022, 0.028, 0.028]
  const GD = new Float64Array(5)
  const sortie = { zone: 0, groupe: 0 }
  const TOUS = P.map((_, i) => i)
  function champ(x: number, y: number, z: number, detail: boolean, liste = TOUS): number {
    GD.fill(9)
    let zmin = 9
    for (let li = 0; li < liste.length; li++) {
      const p = P[liste[li]]
      const fc = p.f.c
      // borne basse exacte : si la primitive est trop loin, elle ne change ni le champ ni la zone
      const lb = (Math.sqrt((x - fc[0]) ** 2 + (y - fc[1]) ** 2 + (z - fc[2]) ** 2) - p.f.R) * p.f.k
      if (lb > GD[p.g] + K[p.g] && (!detail || lb > zmin)) continue
      const d = p.f(x, y, z)
      GD[p.g] = smin(GD[p.g], d, K[p.g])
      if (detail && d < zmin) {
        zmin = d
        sortie.zone = p.z
      }
    }
    let d = smin(GD[0], GD[1], 0.02)
    d = smin(d, GD[2], 0.02)
    d = smin(d, Math.min(GD[3], GD[4]), 0.035)
    if (detail) {
      let g = 0
      for (let i = 1; i < 5; i++) if (GD[i] < GD[g]) g = i
      sortie.groupe = g
    }
    return d
  }
  // les primitives assez proches d'un point pour compter (le reste est trop loin pour changer quoi que ce soit)
  function proches(x: number, y: number, z: number, marge: number): number[] {
    const l: number[] = []
    for (let i = 0; i < P.length; i++) {
      const c = P[i].f.c
      if (Math.sqrt((x - c[0]) ** 2 + (y - c[1]) ** 2 + (z - c[2]) ** 2) - P[i].f.R < marge)
        l.push(i)
    }
    return l
  }
  return { champ, sortie, proches }
}

/** Un corps maillé : sa surface, ses poids d'os, sa zone de vêtement et son ombre de creux par sommet. */
export interface MaillageCorps {
  position: Float32Array
  normal: Float32Array
  skinIndex: Uint16Array
  skinWeight: Float32Array
  index: Uint16Array | Uint32Array
  zones: Uint8Array
  ao: Float32Array
}

/** Une tête fine maillée : surface, normales et ombre de creux. */
export interface MaillageTete {
  position: Float32Array
  normal: Float32Array
  index: Uint16Array | Uint32Array
  ao: Float32Array
}

function versIndex(idx: number[], sommets: number): Uint16Array | Uint32Array {
  return sommets < 65536 ? Uint16Array.from(idx) : Uint32Array.from(idx)
}

/**
 * Nombre de sommets projetés entre deux reprises de main.
 *
 * Chaque sommet coûte une quinzaine d'évaluations du champ : 256 sommets font quelques
 * millisecondes, loin du seuil de 50 ms où le navigateur compte une tâche longue.
 */
const SOMMETS_PAR_TRANCHE = 256

/**
 * Maillage « surface nets » du champ, puis projection sur la surface, normales lisses, creux
 * assombris, poids des os. GÉNÉRATEUR : il rend la main à chaque tranche de grille et tous les
 * `SOMMETS_PAR_TRANCHE` sommets ; le résultat est la valeur de retour.
 */
function* mailler(sil: Silhouette, h: number): Generator<void, MaillageCorps, void> {
  const f = sil.champ
  const x0 = -0.48,
    y0 = -0.02,
    z0 = -0.33,
    x1 = 0.48,
    y1 = 1.9,
    z1 = 0.25
  const nx = Math.ceil((x1 - x0) / h) + 1,
    ny = Math.ceil((y1 - y0) / h) + 1,
    nz = Math.ceil((z1 - z0) / h) + 1
  const v = new Float32Array(nx * ny * nz)
  const H = h * 4
  const mx = Math.ceil((x1 - x0) / H) + 1,
    my = Math.ceil((y1 - y0) / H) + 1,
    mz = Math.ceil((z1 - z0) / H) + 1
  const vg = new Float32Array(mx * my * mz)
  const listes: number[][] = []
  let n = 0
  for (let k = 0; k < mz; k++) {
    for (let j = 0; j < my; j++)
      for (let i = 0; i < mx; i++) {
        const x = x0 + i * H,
          y = y0 + j * H,
          z = z0 + k * H
        listes.push(sil.proches(x, y, z, H + 0.06))
        vg[n] = f(x, y, z, false, listes[n])
        n++
      }
    yield
  }
  const CG = (x: number, y: number, z: number): number =>
    Math.round((x - x0) / H) + mx * (Math.round((y - y0) / H) + my * Math.round((z - z0) / H))
  n = 0
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const cg = Math.round(i / 4) + mx * (Math.round(j / 4) + my * Math.round(k / 4))
        const g = vg[cg]
        v[n++] =
          Math.abs(g) > H * 1.05 ? g : f(x0 + i * h, y0 + j * h, z0 + k * h, false, listes[cg])
      }
    yield
  }
  const I = (i: number, j: number, k: number): number => i + nx * (j + ny * k)
  const C = (i: number, j: number, k: number): number => i + (nx - 1) * (j + (ny - 1) * k)
  const cid = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1)
  const CO = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [0, 1, 1],
    [1, 1, 1]
  ]
  const AR = [
    [0, 1],
    [2, 3],
    [4, 5],
    [6, 7],
    [0, 2],
    [1, 3],
    [4, 6],
    [5, 7],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7]
  ]
  const cv = new Float32Array(8)
  const pos: number[] = []
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        let neg = 0
        for (let c = 0; c < 8; c++) {
          cv[c] = v[I(i + CO[c][0], j + CO[c][1], k + CO[c][2])]
          if (cv[c] < 0) neg++
        }
        if (neg === 0 || neg === 8) continue
        let sx = 0,
          sy = 0,
          sz = 0,
          cnt = 0
        for (const [a, b] of AR) {
          if (cv[a] < 0 === cv[b] < 0) continue
          const t = cv[a] / (cv[a] - cv[b])
          sx += CO[a][0] + (CO[b][0] - CO[a][0]) * t
          sy += CO[a][1] + (CO[b][1] - CO[a][1]) * t
          sz += CO[a][2] + (CO[b][2] - CO[a][2]) * t
          cnt++
        }
        cid[C(i, j, k)] = pos.length / 3
        pos.push(x0 + (i + sx / cnt) * h, y0 + (j + sy / cnt) * h, z0 + (k + sz / cnt) * h)
      }
    }
    yield
  }
  const idx: number[] = []
  const quad = (a: number, b: number, c: number, d: number, inverse: boolean): void => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return
    if (inverse) idx.push(a, d, c, a, c, b)
    else idx.push(a, b, c, a, c, d)
  }
  for (let k = 1; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const a = v[I(i, j, k)],
          b = v[I(i + 1, j, k)]
        if (a < 0 === b < 0) continue
        quad(
          cid[C(i, j - 1, k - 1)],
          cid[C(i, j, k - 1)],
          cid[C(i, j, k)],
          cid[C(i, j - 1, k)],
          b < 0
        )
      }
  yield
  for (let k = 1; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const a = v[I(i, j, k)],
          b = v[I(i, j + 1, k)]
        if (a < 0 === b < 0) continue
        quad(
          cid[C(i - 1, j, k - 1)],
          cid[C(i - 1, j, k)],
          cid[C(i, j, k)],
          cid[C(i, j, k - 1)],
          b < 0
        )
      }
  yield
  for (let k = 0; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const a = v[I(i, j, k)],
          b = v[I(i, j, k + 1)]
        if (a < 0 === b < 0) continue
        quad(
          cid[C(i - 1, j - 1, k)],
          cid[C(i, j - 1, k)],
          cid[C(i, j, k)],
          cid[C(i - 1, j, k)],
          b < 0
        )
      }
  yield
  const nv = pos.length / 3
  const P3 = new Float32Array(pos)
  const N3 = new Float32Array(nv * 3)
  const ZO = new Uint8Array(nv)
  const AO = new Float32Array(nv)
  const SI = new Uint16Array(nv * 4)
  const SW = new Float32Array(nv * 4)
  const e = 0.004
  const os = REPOS.map((r, i) => [r, QUEUE[i]])
  for (let q = 0; q < nv; q++) {
    let x = P3[q * 3],
      y = P3[q * 3 + 1],
      z = P3[q * 3 + 2]
    const li = listes[CG(x, y, z)]
    const fl = (a: number, b: number, c: number): number => sil.champ(a, b, c, false, li)
    let gx = 0,
      gy = 0,
      gz = 0
    for (let it = 0; it < 2; it++) {
      const d = fl(x, y, z)
      gx = (fl(x + e, y, z) - fl(x - e, y, z)) / (2 * e)
      gy = (fl(x, y + e, z) - fl(x, y - e, z)) / (2 * e)
      gz = (fl(x, y, z + e) - fl(x, y, z - e)) / (2 * e)
      const g2 = gx * gx + gy * gy + gz * gz || 1
      const pas = Math.max(-h * 0.5, Math.min(h * 0.5, d / g2))
      if (it < 1) {
        x -= gx * pas
        y -= gy * pas
        z -= gz * pas
      }
    }
    const gl = Math.hypot(gx, gy, gz) || 1
    const nX = gx / gl,
      nY = gy / gl,
      nZ = gz / gl
    P3.set([x, y, z], q * 3)
    N3.set([nX, nY, nZ], q * 3)
    // les creux (aisselles, entrejambe, intérieur de capuche) prennent moins de lumière
    let occ = 0
    for (let s = 1; s <= 3; s++) {
      const hh = 0.018 * s
      occ += (hh - fl(x + nX * hh, y + nY * hh, z + nZ * hh)) * Math.pow(0.6, s)
    }
    AO[q] = Math.min(1, Math.max(0.25, 1 - occ * 9))
    sil.champ(x, y, z, true, li)
    ZO[q] = sil.sortie.zone
    // poids des os : distance aux os du membre auquel ce point appartient
    // sous la jupe d'un manteau, la jambe reste à la jambe (sinon elle suivrait le bassin)
    const gq =
      sil.sortie.groupe === 0 && ZO[q] >= 2 && ZO[q] <= 4 && y < 0.8
        ? x < 0
          ? 3
          : 4
        : sil.sortie.groupe
    const cand = GROUPES_OS[gq]
    const dist = cand.map((b) => {
      const [ra, qa] = os[b]
      return seg(x, y, z, ra[0], ra[1], ra[2], qa[0], qa[1], qa[2])
    })
    const dmin = Math.min(...dist)
    const w = dist.map((d) => Math.exp(-(d - dmin) / 0.03))
    const ordre = cand
      .map((b, i): [number, number] => [b, w[i]])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
    const tot = ordre.reduce((s, a) => s + a[1], 0)
    ordre.forEach(([b, wi], i) => {
      SI[q * 4 + i] = b
      SW[q * 4 + i] = wi / tot
    })
    if (q % SOMMETS_PAR_TRANCHE === SOMMETS_PAR_TRANCHE - 1) yield
  }
  return {
    position: P3,
    normal: N3,
    skinIndex: SI,
    skinWeight: SW,
    index: versIndex(idx, nv),
    zones: ZO,
    ao: AO
  }
}

// ---------- LE VISAGE : une tête fine (5 mm), maillée à part et portée par l'os de la tête ----------
// À 2 cm de maille, un œil tient dans une seule case : le visage est sculpté à part, avec ses orbites, ses paupières,
// l'arête du nez, les lèvres, les pommettes, la mâchoire et les oreilles.
export function champTete(femme: boolean): Champ3 {
  const m = femme ? 0.96 : 1
  const crane = ell([0, 1.72, -0.008], [0.077 * m, 0.084, 0.094])
  const face = ell([0, 1.675, 0.028], [0.067 * m, 0.072, 0.07])
  const mach = [-1, 1].map((s) =>
    cone([s * 0.055 * m, 1.655, -0.005], [s * 0.02, 1.612, 0.056], 0.02 * m, femme ? 0.012 : 0.016)
  )
  const menton = ell([0, 1.61, 0.066], [0.022 * m, 0.018, 0.019])
  const pom = [-1, 1].map((s) => ell([s * 0.045 * m, 1.69, 0.066], [0.021, 0.014, 0.019]))
  const arcade = cone(
    [-0.044, 1.729, 0.079],
    [0.044, 1.729, 0.079],
    femme ? 0.007 : 0.011,
    femme ? 0.007 : 0.011
  )
  const orb = [-1, 1].map((s) => ell([s * 0.032, 1.706, 0.094], [0.017, 0.011, 0.015]))
  const paup = [-1, 1].map((s) => ell([s * 0.032, 1.716, 0.087], [0.016, 0.0055, 0.011]))
  const paupB = [-1, 1].map((s) => ell([s * 0.032, 1.696, 0.086], [0.015, 0.0045, 0.0095]))
  const nez = cone([0, 1.718, 0.091], [0, 1.676, 0.111], 0.0065, femme ? 0.0085 : 0.0105)
  const bout = ell([0, 1.672, 0.109], [0.012 * m, 0.0105, 0.0105])
  const ailes = [-1, 1].map((s) => ell([s * 0.0115, 1.669, 0.1], [0.0085, 0.0075, 0.0075]))
  const levH = ell([0, 1.6465, 0.0925], [0.019, femme ? 0.0068 : 0.0055, 0.0085])
  const levB = ell([0, 1.638, 0.0905], [0.017, femme ? 0.0078 : 0.0062, 0.0085])
  const bouche = ell([0, 1.642, 0.1], [0.018, 0.0014, 0.008])
  const oreilles = [-1, 1].map((s) => ell([s * 0.078 * m, 1.692, -0.004], [0.011, 0.027, 0.019]))
  const cou = cone([0, 1.62, -0.01], [0, 1.54, -0.012], 0.05 * m, 0.054 * m)
  return (x, y, z) => {
    let d = smin(crane(x, y, z), face(x, y, z), 0.03)
    for (const f of mach) d = smin(d, f(x, y, z), 0.02)
    d = smin(d, menton(x, y, z), 0.015)
    for (const f of pom) d = smin(d, f(x, y, z), 0.015)
    d = smin(d, arcade(x, y, z), 0.012)
    for (const f of orb) d = smax(d, -f(x, y, z), 0.008)
    for (const f of paup) d = smin(d, f(x, y, z), 0.004)
    for (const f of paupB) d = smin(d, f(x, y, z), 0.003)
    d = smin(d, nez(x, y, z), 0.008)
    d = smin(d, bout(x, y, z), 0.006)
    for (const f of ailes) d = smin(d, f(x, y, z), 0.005)
    d = smin(smin(d, levH(x, y, z), 0.005), levB(x, y, z), 0.005)
    d = smax(d, -bouche(x, y, z), 0.002)
    for (const f of oreilles) d = smin(d, f(x, y, z), 0.008)
    return smin(d, cou(x, y, z), 0.02)
  }
}

/** La boîte et le pas de la tête fine, repris du brouillon. */
const BOITE_TETE = [-0.1, 1.53, -0.115, 0.1, 1.815, 0.14] as const
export const PAS_TETE = 0.005
/** Le pas du corps : 2 cm, celui du brouillon validé. */
export const PAS_CORPS = 0.02

/** Maillage « surface nets » d'un champ dans une boîte ; normales par gradient, creux assombris. GÉNÉRATEUR. */
function* nets(f: Champ3, b: readonly number[], h: number): Generator<void, MaillageTete, void> {
  const [x0, y0, z0, x1, y1, z1] = b
  const nx = Math.ceil((x1 - x0) / h) + 1,
    ny = Math.ceil((y1 - y0) / h) + 1,
    nz = Math.ceil((z1 - z0) / h) + 1
  const I = (i: number, j: number, k: number): number => i + nx * (j + ny * k)
  const v = new Float32Array(nx * ny * nz)
  for (let k = 0, n = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) v[n++] = f(x0 + i * h, y0 + j * h, z0 + k * h)
    yield
  }
  const cid = new Int32Array(nx * ny * nz).fill(-1)
  const CO = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [0, 1, 1],
    [1, 1, 1]
  ]
  const AR = [
    [0, 1],
    [2, 3],
    [4, 5],
    [6, 7],
    [0, 2],
    [1, 3],
    [4, 6],
    [5, 7],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7]
  ]
  const cv = new Float32Array(8)
  const pos: number[] = []
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        let neg = 0
        for (let c = 0; c < 8; c++)
          if ((cv[c] = v[I(i + CO[c][0], j + CO[c][1], k + CO[c][2])]) < 0) neg++
        if (neg === 0 || neg === 8) continue
        let sx = 0,
          sy = 0,
          sz = 0,
          cnt = 0
        for (const [a, c] of AR) {
          if (cv[a] < 0 === cv[c] < 0) continue
          const t = cv[a] / (cv[a] - cv[c])
          sx += CO[a][0] + (CO[c][0] - CO[a][0]) * t
          sy += CO[a][1] + (CO[c][1] - CO[a][1]) * t
          sz += CO[a][2] + (CO[c][2] - CO[a][2]) * t
          cnt++
        }
        cid[I(i, j, k)] = pos.length / 3
        pos.push(x0 + (i + sx / cnt) * h, y0 + (j + sy / cnt) * h, z0 + (k + sz / cnt) * h)
      }
    yield
  }
  const idx: number[] = []
  const quad = (a: number, b2: number, c: number, d: number, inv: boolean): void => {
    if (a < 0 || b2 < 0 || c < 0 || d < 0) return
    if (inv) idx.push(a, d, c, a, c, b2)
    else idx.push(a, b2, c, a, c, d)
  }
  for (let k = 1; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const a = v[I(i, j, k)],
          c = v[I(i + 1, j, k)]
        if (a < 0 !== c < 0)
          quad(
            cid[I(i, j - 1, k - 1)],
            cid[I(i, j, k - 1)],
            cid[I(i, j, k)],
            cid[I(i, j - 1, k)],
            c < 0
          )
      }
  yield
  for (let k = 1; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const a = v[I(i, j, k)],
          c = v[I(i, j + 1, k)]
        if (a < 0 !== c < 0)
          quad(
            cid[I(i - 1, j, k - 1)],
            cid[I(i - 1, j, k)],
            cid[I(i, j, k)],
            cid[I(i, j, k - 1)],
            c < 0
          )
      }
  yield
  for (let k = 0; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const a = v[I(i, j, k)],
          c = v[I(i, j, k + 1)]
        if (a < 0 !== c < 0)
          quad(
            cid[I(i - 1, j - 1, k)],
            cid[I(i, j - 1, k)],
            cid[I(i, j, k)],
            cid[I(i - 1, j, k)],
            c < 0
          )
      }
  yield
  const P = new Float32Array(pos),
    N = new Float32Array(pos.length),
    ao = new Float32Array(pos.length / 3)
  const e = h * 0.3
  for (let q = 0; q < P.length; q += 3) {
    let x = P[q],
      y = P[q + 1],
      z = P[q + 2]
    const gx = f(x + e, y, z) - f(x - e, y, z),
      gy = f(x, y + e, z) - f(x, y - e, z),
      gz = f(x, y, z + e) - f(x, y, z - e)
    const gl = Math.hypot(gx, gy, gz) || 1
    const d = f(x, y, z)
    x -= (gx / gl) * d
    y -= (gy / gl) * d
    z -= (gz / gl) * d
    P.set([x, y, z], q)
    N.set([gx / gl, gy / gl, gz / gl], q)
    let occ = 0
    for (let s = 1; s <= 3; s++)
      occ +=
        (0.006 * s - f(x + N[q] * 0.006 * s, y + N[q + 1] * 0.006 * s, z + N[q + 2] * 0.006 * s)) *
        Math.pow(0.6, s)
    ao[q / 3] = Math.min(1, Math.max(0.3, 1 - occ * 45))
    if ((q / 3) % SOMMETS_PAR_TRANCHE === SOMMETS_PAR_TRANCHE - 1) yield
  }
  return { position: P, normal: N, index: versIndex(idx, P.length / 3), ao }
}

/** Le corps d'une forme, en tranches. */
export function maillerCorps(nom: NomForme): Generator<void, MaillageCorps, void> {
  return mailler(silhouette(GABARITS[nom]), PAS_CORPS)
}

/** La tête fine, en tranches. */
export function maillerTete(femme: boolean): Generator<void, MaillageTete, void> {
  return nets(champTete(femme), BOITE_TETE, PAS_TETE)
}

/** Tous les maillages dont la foule a besoin. */
export interface MaillagesHumains {
  corps: Record<NomForme, MaillageCorps>
  /** `[homme, femme]` */
  tetes: [MaillageTete, MaillageTete]
}

export const ORDRE_FORMES: readonly NomForme[] = ['M', 'C', 'E', 'N', 'O']

function* toutMailler(): Generator<void, MaillagesHumains, void> {
  const corps = {} as Record<NomForme, MaillageCorps>
  for (const nom of ORDRE_FORMES) corps[nom] = yield* maillerCorps(nom)
  const homme = yield* maillerTete(false)
  const femme = yield* maillerTete(true)
  return { corps, tetes: [homme, femme] }
}

/** Un travail de maillage qu'on fait avancer par tranches. */
export interface Preparation {
  /**
   * Avance le travail pendant AU PLUS `budgetMs` (à une tranche près), puis rend la main.
   * Rend les maillages quand tout est prêt, `null` tant qu'il reste du travail.
   */
  avancer(budgetMs: number): MaillagesHumains | null
}

/** Fabrique un travail neuf. `horloge` se remplace en test. */
export function creerPreparation(horloge: () => number = () => performance.now()): Preparation {
  let travail: Generator<void, MaillagesHumains, void> | null = null
  let resultat: MaillagesHumains | null = null
  return {
    avancer(budgetMs) {
      if (resultat) return resultat
      if (!travail) travail = toutMailler()
      const fin = horloge() + Math.max(0, budgetMs)
      for (;;) {
        const pas = travail.next()
        if (pas.done) {
          resultat = pas.value
          travail = null
          return resultat
        }
        if (horloge() >= fin) return null
      }
    }
  }
}

let partagee: Preparation | null = null
/**
 * LE travail de la session, partagé par toutes les scènes successives.
 *
 * Une scène libérée (thème changé, Accueil quitté) arrête simplement de le faire avancer : le travail
 * déjà fait n'est pas perdu, la scène suivante le reprend où il en était.
 */
export function preparationHumains(): Preparation {
  partagee ??= creerPreparation()
  return partagee
}
