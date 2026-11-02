/**
 * LA MARCHE DES TANUKIS SUR LA FALAISE (conv-1421), sans aucun dessin : ce fichier se teste seul.
 *
 * Portée de la démonstration `grill/quartier/batiment/falaise2/page.tpl.html`, où elle a été mesurée :
 * 0 position hors du sol sur 432 000, 0 croisement dans un escalier, 992 trajets sur 992. Une seule
 * différence de fond : là-bas les tanukis tiraient leur prochain poste au sort ; ici, chacun suit la
 * CONSIGNE de son agent réel (`consigneDe`).
 *
 * Trois modèles tiennent ce réalisme :
 *  - la carte du sol : une grille de cases libres, relevée sur la peinture, et rien d'autre n'existe ;
 *  - l'escalier est un couloir à deux bouts : on n'y entre jamais par le côté, on y monte marche par
 *    marche, et on attend en bas que la volée se libère (sinon deux personnages se traversent) ;
 *  - la distance au sol : la profondeur compte double (`SP`), comme sur l'image.
 *
 * D15 de la fiche : au moins 20 s à un poste, une action plus courte ne le fait pas bouger. Sans cette
 * règle, un agent qui change d'outil toutes les 3 s courrait dans les escaliers sans jamais rien faire.
 *
 * LA PAUSE (conv-1428, « mes personnages passent leur temps à méditer, c'est pas assez varié »). Mesuré sur
 * 400 tours : plus de la moitié des attentes entre deux outils dépassent 6 s, et 42 % du temps d'un tour
 * se passe à réfléchir. Réfléchir n'est donc plus un seul lieu : c'est une famille de postes (`me: 'pause'`)
 * — méditer au dojo, boire le thé, s'asseoir au bord, ratisser le sable, arroser, s'entraîner au sabre,
 * le penseur — et le tanuki prend celle qui est libre, près de lui, différente de la précédente ; s'il n'y en
 * a pas, il fait les cent pas. Il en change au bout d'une minute environ.
 */
import type { Metier } from './quartier-metiers'

export type Pose = '' | 'as' | 'at' | 'pl' | 'ba'
export type MetierPoste = Metier | 'bain' | 'pause'

/**
 * Une animation de l'atlas : rangée, durée, nombre d'images. `e` : l'entrée jouée une fois en arrivant
 * (s'asseoir), à l'envers en repartant (se relever) ; `ya` : l'angle du corps dans ses images, vers lequel
 * il se tourne avant de s'asseoir.
 */
export interface Geste {
  r: number
  d: number
  n: number
  e?: { r: number; d: number; n: number }
  ya?: number
  /** Décalage de l'image dans sa case, quand un objet tenu (sabre, râteau) dépasse d'un côté. */
  dx?: number
  /** Deux images voisines se fondent : une respiration lente sans saccade. */
  fondu?: number
  /** Le corps quitte le sol (méditation longue). */
  levite?: number
}

/** Ce que l'agent demande à son tanuki. `metier: null` = rester où il est. */
export interface Consigne {
  metier: MetierPoste | null
  pose: Pose
  partir: boolean
}

/** Un endroit où se tenir : un poste de la peinture, ou une place libre à côté quand il est pris. */
export interface Place {
  x: number
  y: number
  /** Le geste joué à cet endroit ; vide = debout, à attendre. */
  g: string
  m: number
  bain?: number
  /** Au bain : la hauteur du rebord, sous laquelle le corps est dans l'eau. */
  cl?: number
}

export interface PosteQuartier extends Place {
  /** Le métier du poste ; `repos` n'est demandé par aucune action. */
  me: string
  z: number
}

export interface NiveauQuartier {
  p: [number, number][]
  e?: [number, number, number, number]
  h?: number
  yc?: number
}

export interface EscalierQuartier {
  nom: string
  a: [number, number]
  b: [number, number]
  n: number
  l: number
  c: number[]
}

export interface DonneesMarche {
  sp: number
  niv: NiveauQuartier[]
  esc: EscalierQuartier[]
  g: { x0: number; y0: number; pas: number; w: number; h: number; l: number; b: string }
  postes: PosteQuartier[]
  gestes?: Record<string, Geste>
}

type Point = number[] & { e?: number; sens?: number }

export interface Tanuki {
  id: string
  x: number
  y: number
  /** Sa hauteur à l'écran, en pixels de la peinture : elle suit le niveau où il se trouve. */
  u: number
  ch: Point[]
  i: number
  /** Phase du pas, de 0 à 1. */
  ph: number
  ang: number
  cap: number
  vit: number
  /** Le poste qu'il occupe ou vers lequel il va ; `null` s'il se tient à une place libre. */
  poste: number | null
  place: Place | null
  /** Le métier de l'endroit où il va, puis où il est. */
  cible: MetierPoste | null
  metierIci: MetierPoste | null
  th: number
  /** `tourne` : arrivé, il se tourne vers où il va s'asseoir ; `leve` : il se relève avant de partir. */
  etat: 'attend' | 'va' | 'poste' | 'etat' | 'parti' | 'tourne' | 'leve'
  nom: Pose
  face: Place | null
  mir: number
  nb: number
  sur: number
  lev: number
  S: number
  sens: number
  pause: boolean
  fileE: number
  fileS: number
  k: number
  mieux: number
  st: number
  gene: number
  pas: number
  sortant: boolean
  alpha: number
  consigne: Consigne
  /** En pause : combien de temps il reste à cette activité avant d'en changer. */
  duree: number
  /** Le geste de sa dernière pause : il en prend une autre la fois suivante. */
  dernier: string
  /** Ce qu'il fera une fois relevé. */
  apres: (() => void) | null
  /**
   * L'agent d'un collègue (D9, conv-1429) : la couleur de son foulard. Elle vit sur le tanuki et non
   * sur l'agent, car il la garde en repartant, quand son agent a déjà quitté la liste. Absent = le mien.
   */
  foulard?: string
}

/** Au moins ce temps à un poste : une action plus courte ne le fait pas bouger (D15). */
export const SEJOUR_MIN_S = 20
/** Le point où un agent entre dans le Quartier et d'où il repart : le milieu du sable, en bas. */
export const ENTREE: readonly [number, number] = [640, 748]

/** L'écart au sol entre deux tanukis qui attendent : un corps et demi, sinon ils forment un tas. */
const ECART_FILE = 52
/** Le temps passé à une activité de pause, avant d'en prendre une autre. */
export const PAUSE_MIN_S = 45
export const PAUSE_MAX_S = 110
/** Les cent pas : une étape courte, puis la suivante. */
const FLANE_MIN_S = 3
const FLANE_MAX_S = 8
/** Une fois sur six, il fait les cent pas même si une activité est libre : réfléchir en marchant. */
const PART_FLANE = 1 / 6
/** Au-delà de ce temps assis en méditation, il quitte doucement le sol. */
export const LEVITE_APRES_S = 25
/** Il se tourne à cette vitesse avant de s'asseoir, en degrés par seconde. */
const TOUR_DEG_S = 360

const V = (2 * 0.098) / (0.62 * 0.6)
const FOULEE = V * 0.6
const PEINE = [0, 2.2, 1.1, 0.5, 0.15, 0, 0, 0]
const lisse = (t: number): number => t * t * (3 - 2 * t)

const dans = (ps: readonly [number, number][], X: number, Y: number): boolean => {
  let o = false
  for (let i = 0, j = ps.length - 1; i < ps.length; j = i++) {
    const [a, b] = ps[i]
    const [e, f] = ps[j]
    if (b > Y !== f > Y && X < ((e - a) * (Y - b)) / (f - b) + a) o = !o
  }
  return o
}

/** La volée telle que la marche la lit : sa carte, plus son sens et sa longueur. */
export type EscalierEnMarche = EscalierQuartier & { i: number; dx: number; dy: number; L: number }

export interface MarcheQuartier {
  T: Tanuki[]
  avance(dt: number): void
  ajouter(id: string, consigne: Consigne, foulard?: string): Tanuki
  libre(px: number, py: number): boolean
  taille(px: number, py: number): number
  chemin(a: number[], b: number[], moi: Tanuki | null, sansGene?: boolean): Point[]
  ESC: EscalierEnMarche[]
  placePres(px: number, py: number, moi: Tanuki | null, g?: string): Place
  dans(ps: readonly [number, number][], X: number, Y: number): boolean
}

export function creerMarche(D: DonneesMarche, alea: () => number = Math.random): MarcheQuartier {
  const SP = D.sp
  const G = D.g
  const bits = new Uint8Array(G.w * G.h)
  for (let j = 0, p = 0; j < G.h; j++)
    for (let i = 0; i < G.l; i++, p++) {
      const v = parseInt(G.b[p], 16)
      for (let k = 0; k < 4; k++) {
        const q = i * 4 + k
        if (q < G.w) bits[j * G.w + q] = (v >> (3 - k)) & 1
      }
    }
  const libreC = (i: number, j: number): boolean =>
    i >= 0 && j >= 0 && i < G.w && j < G.h && bits[j * G.w + i] === 1
  const libre = (px: number, py: number): boolean =>
    libreC(Math.round((px - G.x0) / G.pas), Math.round((py - G.y0) / G.pas))

  const ESC = D.esc.map((e, i) => {
    const dx = e.b[0] - e.a[0]
    const dy = e.b[1] - e.a[1]
    return { ...e, i, dx, dy, L: Math.hypot(dx, dy) }
  })

  // Distance au bord, en cases : à coût égal, on marche au milieu du plancher, pas en rasant le vide.
  const marge = new Uint8Array(G.w * G.h)
  {
    let f: number[] = []
    for (let q = 0; q < bits.length; q++) if (!bits[q]) f.push(q)
    for (let d = 1; d < 7 && f.length; d++) {
      const n: number[] = []
      for (const q of f) {
        const i = q % G.w
        for (const [a, b] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1]
        ]) {
          const u = i + a
          const v = ((q / G.w) | 0) + b
          if (u < 0 || v < 0 || u >= G.w || v >= G.h) continue
          const r = v * G.w + u
          if (bits[r] && !marge[r]) {
            marge[r] = d
            n.push(r)
          }
        }
      }
      f = n
    }
    for (let q = 0; q < bits.length; q++) if (bits[q] && !marge[q]) marge[q] = 7
  }
  const dansEsc = new Uint8Array(G.w * G.h)
  ESC.forEach((e) => {
    for (const q of e.c) dansEsc[q] = e.i + 1
  })
  const LIBRES: [number, number][] = []
  for (let j = 0; j < G.h; j++) for (let i = 0; i < G.w; i++) if (libreC(i, j)) LIBRES.push([i, j])

  function proche(px: number, py: number): [number, number] {
    let m = 1e9
    let b = LIBRES[0]
    for (const q of LIBRES) {
      const d = Math.hypot(q[0] * G.pas + G.x0 - px, (q[1] * G.pas + G.y0 - py) / SP)
      if (d < m) {
        m = d
        b = q
      }
    }
    return b
  }

  /** La taille vient du niveau où il se trouve : plus haut, c'est plus loin. */
  function taille(px: number, py: number): number {
    for (const n of D.niv)
      if (dans(n.p, px, py)) {
        if (n.e) {
          const t = Math.max(0, Math.min(1, (py - n.e[0]) / (n.e[2] - n.e[0])))
          return n.e[1] + (n.e[3] - n.e[1]) * t
        }
        return (n.h ?? 55) * (1 + (py - (n.yc ?? py)) * 0.0016)
      }
    return 0
  }

  const T: Tanuki[] = []
  const immobile = (o: Tanuki): boolean => o.etat !== 'va' && o.etat !== 'parti'
  const GESTES = D.gestes ?? {}
  /** Le geste joué à l'endroit où il se tient, s'il en a un. */
  const gesteIci = (w: Tanuki): Geste | undefined =>
    w.poste !== null && w.face?.g ? GESTES[w.face.g] : undefined

  const gene = (i: number, j: number, moi: Tanuki | null): boolean => {
    const px = i * G.pas + G.x0
    const py = j * G.pas + G.y0
    for (const o of T)
      if (o !== moi && immobile(o) && Math.hypot(px - o.x, (py - o.y) / SP) < o.u * 0.34)
        return true
    return false
  }

  function chemin(a: number[], b: number[], moi: Tanuki | null, sansGene = false): Point[] {
    const [ai, aj] = proche(a[0], a[1])
    const [bi, bj] = proche(b[0], b[1])
    const N = G.w * G.h
    const cout = new Float32Array(N).fill(1e9)
    const de = new Int32Array(N).fill(-1)
    const fait = new Uint8Array(N)
    const id = (i: number, j: number): number => j * G.w + i
    const H = (i: number, j: number): number => Math.hypot(i - bi, (j - bj) / SP)
    const ouv = [id(ai, aj)]
    cout[id(ai, aj)] = 0
    while (ouv.length) {
      let m = 0
      let mv = 1e9
      for (let k = 0; k < ouv.length; k++) {
        const q = ouv[k]
        const f = cout[q] + H(q % G.w, (q / G.w) | 0)
        if (f < mv) {
          mv = f
          m = k
        }
      }
      const q = ouv.splice(m, 1)[0]
      if (fait[q]) continue
      fait[q] = 1
      const i = q % G.w
      const j = (q / G.w) | 0
      if (i === bi && j === bj) break
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1]
      ]) {
        const ni = i + di
        const nj = j + dj
        if (
          !libreC(ni, nj) ||
          (di && dj && !(libreC(i + di, j) && libreC(i, j + dj))) ||
          (!sansGene && gene(ni, nj, moi))
        )
          continue
        const n = id(ni, nj)
        const cc = cout[q] + Math.hypot(di, dj / SP) * (1 + (dansEsc[n] ? 0 : PEINE[marge[n]]))
        if (cc < cout[n]) {
          cout[n] = cc
          de[n] = q
          ouv.push(n)
        }
      }
    }
    let q = id(bi, bj)
    const l: number[] = []
    if (de[q] < 0 && q !== id(ai, aj)) return sansGene ? [[a[0], a[1]]] : chemin(a, b, moi, true)
    while (q >= 0) {
      l.unshift(q)
      q = de[q]
    }
    const P = (c: number): number[] => [(c % G.w) * G.pas + G.x0, ((c / G.w) | 0) * G.pas + G.y0]
    const cel = (p: number[]): number =>
      Math.round((p[1] - G.y0) / G.pas) * G.w + Math.round((p[0] - G.x0) / G.pas)
    // Une droite ne vaut que si elle garde la même distance aux bords que ses deux bouts.
    const vu = (p: number[], r: number[]): boolean => {
      const n = Math.ceil(Math.hypot(r[0] - p[0], r[1] - p[1]) / 2)
      const s = Math.min(2, marge[cel(p)], marge[cel(r)])
      for (let k = 0; k <= n; k++) {
        const u = [p[0] + ((r[0] - p[0]) * k) / n, p[1] + ((r[1] - p[1]) * k) / n]
        if (!libre(u[0], u[1]) || marge[cel(u)] < s) return false
      }
      return true
    }
    const tire = (m: number[]): number[][] => {
      const v = m.map(P)
      const o = [v[0]]
      let i = 0
      while (i < v.length - 1) {
        let k = v.length - 1
        while (k > i + 1 && !vu(v[i], v[k])) k--
        o.push(v[k])
        i = k
      }
      return o
    }
    // Le trajet se coupe en tronçons : un sol se tire en droites, un escalier se prend d'un bout à
    // l'autre. Deux cases d'escalier frôlées au pied ne sont pas une montée.
    const o: Point[] = []
    let buf: number[] = []
    const vide = (): void => {
      if (buf.length) {
        o.push(...tire(buf))
        buf = []
      }
    }
    for (let i = 0; i < l.length;) {
      const e = dansEsc[l[i]]
      let k = i
      while (k + 1 < l.length && dansEsc[l[k + 1]] === e) k++
      if (e && k - i + 1 >= ESC[e - 1].c.length * 0.7) {
        vide()
        const E = ESC[e - 1]
        const d = P(l[i])
        const mt =
          Math.hypot(d[0] - E.a[0], d[1] - E.a[1]) < Math.hypot(d[0] - E.b[0], d[1] - E.b[1])
        const pe = mt ? E.a : E.b
        while (
          o.length > 1 &&
          Math.hypot(o[o.length - 1][0] - pe[0], o[o.length - 1][1] - pe[1]) < 11
        )
          o.pop()
        o.push([...pe])
        const f: Point = [...(mt ? E.b : E.a)]
        f.e = E.i
        f.sens = mt ? 1 : -1
        o.push(f)
      } else buf.push(...l.slice(i, k + 1))
      i = k + 1
    }
    vide()
    return o
  }

  const clair = (px: number, py: number, h: number[]): boolean => {
    const m = Math.ceil(Math.hypot(h[0] - px, h[1] - py) / 2.5)
    for (let k = 1; k <= m; k++)
      if (!libre(px + ((h[0] - px) * k) / m, py + ((h[1] - py) * k) / m)) return false
    return true
  }

  // Il vise un point un peu plus loin sur son trajet : ses virages s'arrondissent.
  function visee(w: Tanuki): number[] {
    let rest = w.u * 0.75
    let px = w.x
    let py = w.y
    let h: number[] = w.ch[w.i]
    for (let k = w.i; k < w.ch.length; k++) {
      const q = w.ch[k]
      const d = Math.hypot(q[0] - px, (q[1] - py) / SP)
      if (d >= rest) {
        h = [px + ((q[0] - px) * rest) / d, py + ((q[1] - py) * rest) / d]
        break
      }
      h = q
      rest -= d
      px = q[0]
      py = q[1]
      const n = w.ch[k + 1]
      if (n && n.e !== undefined) break
    }
    return clair(w.x, w.y, h) ? h : w.ch[w.i]
  }

  type Volee = (typeof ESC)[number]
  const encombre = (E: Volee, sens: number, moi: Tanuki): boolean =>
    T.some((o) => o !== moi && o.sur === E.i && (o.sens !== sens || o.S < 2.5))

  function dansEscalier(w: Tanuki, c0: Point, dt: number): void {
    const E = ESC[c0.e as number]
    const s = c0.sens as number
    if (w.sur !== E.i) {
      if (encombre(E, s, w)) {
        w.pause = true
        return
      }
      w.pause = false
      w.sur = E.i
      w.sens = s
      w.S = 0
      w.vit = 0
    }
    const dev = T.find(
      (o) => o !== w && o.sur === E.i && o.sens === s && o.S > w.S && o.S - w.S < 2.5
    )
    if (!dev) w.S += (s > 0 ? 2.4 : 3) * w.k * dt
    if (w.S >= E.n) {
      w.sur = -1
      w.lev = 0
      const f = s > 0 ? E.b : E.a
      w.x = f[0]
      w.y = f[1]
      w.i++
      w.st = 0
      w.mieux = 1e9
      return
    }
    // Il pose le pied sur chaque marche : le corps s'arrête un instant, puis se hisse à la suivante.
    const fr = w.S % 1
    const e = fr < 0.32 ? 0 : lisse((fr - 0.32) / 0.68)
    const t = (Math.floor(w.S) + e) / E.n
    const u = s > 0 ? t : 1 - t
    w.x = E.a[0] + E.dx * u
    w.y = E.a[1] + E.dy * u
    w.lev = ((Math.sin(Math.PI * e) * E.L) / E.n) * 0.22
    w.ph = w.S / 2
    const ai = ((Math.atan2(E.dx * s, E.dy * s) * 180) / Math.PI + 360) % 360
    const d = ((ai - w.ang + 540) % 360) - 180
    w.ang += Math.sign(d) * Math.min(Math.abs(d), 420 * dt)
    w.cap = w.ang
  }

  function partirVers(w: Tanuki, place: Place): void {
    w.place = place
    w.ch = chemin([w.x, w.y], [place.x, place.y], w)
    w.i = 0
    w.etat = 'va'
    w.nom = ''
    w.mieux = 1e9
    if (w.ch.length > 1 && Math.hypot(w.ch[0][0] - w.x, (w.ch[0][1] - w.y) / SP) < 12) w.i = 1
  }

  /** Une case libre près d'un point, sur le même sol, loin des autres : la file d'attente d'un poste plein. */
  function placePres(px: number, py: number, moi: Tanuki | null, g = ''): Place {
    const zone = D.niv.findIndex((n) => dans(n.p, px, py))
    let meilleure: Place | null = null
    let m = 1e9
    for (const [i, j] of LIBRES) {
      if (marge[j * G.w + i] < 2 || dansEsc[j * G.w + i]) continue
      const X = i * G.pas + G.x0
      const Y = j * G.pas + G.y0
      const d = Math.hypot(X - px, (Y - py) / SP)
      if (d >= m || d < 8) continue
      if (zone >= 0 && !dans(D.niv[zone].p, X, Y)) continue
      const genant = T.some((o) => {
        if (o === moi) return false
        const c = o.etat === 'va' && o.place ? o.place : o
        return Math.hypot(c.x - X, (c.y - Y) / SP) < ECART_FILE
      })
      if (genant) continue
      m = d
      meilleure = { x: X, y: Y, g, m: X > px ? 1 : 0 }
    }
    return meilleure ?? { x: px, y: py, g, m: 0 }
  }

  function aller(w: Tanuki, metier: MetierPoste): void {
    if (metier === 'pause') {
      allerEnPause(w)
      return
    }
    const pris = new Set(T.filter((o) => o !== w).map((o) => o.poste))
    let best = -1
    let bd = 1e9
    D.postes.forEach((p, i) => {
      if (p.me !== metier || pris.has(i)) return
      const d = Math.hypot(p.x - w.x, (p.y - w.y) / SP)
      if (d < bd) {
        bd = d
        best = i
      }
    })
    w.cible = metier
    if (best >= 0) {
      w.poste = best
      partirVers(w, D.postes[best])
      return
    }
    // Les baquets sont pris : celui qui a fini prend une pause plutôt que d'attendre assis par terre.
    if (metier === 'bain') {
      allerEnPause(w)
      return
    }
    // Poste plein : il attend à côté, debout (D16).
    const modele = D.postes.find((p) => p.me === metier)
    w.poste = null
    partirVers(w, modele ? placePres(modele.x, modele.y, w) : placePres(ENTREE[0], ENTREE[1], w))
  }

  /**
   * Une activité de pause : libre, pas trop loin, peu prise par les autres, et pas celle qu'il vient de
   * faire. Un peu de hasard, sinon tous les tanukis d'un même étage iraient au même endroit.
   */
  function allerEnPause(w: Tanuki): void {
    w.cible = 'pause'
    w.duree = PAUSE_MIN_S + alea() * (PAUSE_MAX_S - PAUSE_MIN_S)
    const pris = new Set(T.filter((o) => o !== w).map((o) => o.poste))
    const occupe = new Map<string, number>()
    for (const o of T)
      if (o !== w && o.poste !== null) {
        const g = D.postes[o.poste].g
        occupe.set(g, (occupe.get(g) ?? 0) + 1)
      }
    let best = -1
    let bs = 1e9
    D.postes.forEach((p, i) => {
      if (p.me !== 'pause' || pris.has(i) || i === w.poste) return
      const d = Math.hypot(p.x - w.x, (p.y - w.y) / SP)
      const s =
        d / 260 + (occupe.get(p.g) ?? 0) * 0.9 + (p.g === w.dernier ? 2.5 : 0) + alea() * 1.6
      if (s < bs) {
        bs = s
        best = i
      }
    })
    if (best < 0 || alea() < PART_FLANE) {
      flaner(w)
      return
    }
    w.poste = best
    w.dernier = D.postes[best].g
    partirVers(w, D.postes[best])
  }

  /** Les cent pas : quelques mètres sur le même sol, un arrêt, puis encore. */
  function flaner(w: Tanuki): void {
    w.cible = 'pause'
    w.poste = null
    w.dernier = ''
    w.duree = FLANE_MIN_S + alea() * (FLANE_MAX_S - FLANE_MIN_S)
    const dx = (alea() - 0.5) * 2 * (60 + alea() * 120)
    const dy = (alea() - 0.5) * 50
    partirVers(w, placePres(w.x + dx, w.y + dy, w))
  }

  /** Assis à un poste qui a une entrée : il se relève avant toute autre chose. */
  function quitter(w: Tanuki, suite: () => void): void {
    const g = gesteIci(w)
    if (w.etat === 'poste' && g?.e && w.th > 0) {
      w.etat = 'leve'
      w.th = 0
      w.apres = suite
      return
    }
    suite()
  }

  /** Il est là où son agent le veut : au poste demandé, ou en pause quand les baquets étaient pris. */
  const bienPlace = (voulu: MetierPoste, ici: MetierPoste | null): boolean =>
    voulu === ici || (voulu === 'bain' && ici === 'pause')

  /** Le tanuki ne marche pas : il regarde ce que son agent lui demande. */
  function decider(w: Tanuki): void {
    const c = w.consigne
    if (c.partir) {
      if (!w.sortant)
        quitter(w, () => {
          w.sortant = true
          w.poste = null
          w.cible = null
          partirVers(w, { x: ENTREE[0], y: ENTREE[1], g: '', m: 0 })
        })
      return
    }
    if (c.metier && !bienPlace(c.metier, w.metierIci)) {
      const delai = c.metier === 'bain' || w.metierIci === null ? 0 : SEJOUR_MIN_S
      if (w.th >= delai) {
        const metier = c.metier
        quitter(w, () => aller(w, metier))
        return
      }
    }
    // En pause, il change d'activité de temps en temps : c'est ce qui rend la scène vivante.
    if (c.metier && w.metierIci === 'pause' && w.th >= w.duree) {
      quitter(w, () => allerEnPause(w))
      return
    }
    // Fini sans baquet libre : sa pause tient lieu de bain ; sans poste, il s'assied là où il est.
    const pose = c.pose === 'ba' && !w.face?.bain ? (w.poste !== null ? '' : 'as') : c.pose
    if (pose) {
      if (w.etat !== 'etat' || w.nom !== pose) {
        // Une question ou un échec le relève d'abord, s'il était assis.
        if (w.etat === 'poste' && gesteIci(w)?.e) {
          quitter(w, () => undefined)
          return
        }
        w.etat = 'etat'
        w.nom = pose
        w.mir = w.face?.m ?? 0
      }
    } else if (w.etat === 'etat') {
      w.nom = ''
      w.etat = w.poste !== null ? 'poste' : 'attend'
      w.th = 0
    }
  }

  function arrivee(w: Tanuki): void {
    w.nb++
    w.face = w.place
    w.metierIci = w.cible
    w.th = 0
    w.vit = 0
    if (w.sortant) {
      if (w.consigne.partir) {
        w.etat = 'parti'
        return
      }
      w.sortant = false
    }
    w.etat = w.poste !== null ? 'poste' : 'attend'
    // Avant de s'asseoir, il se tourne vers l'endroit où il va s'asseoir.
    if (gesteIci(w)?.e) w.etat = 'tourne'
  }

  /** Arrivé à sa place, il pivote sur lui-même jusqu'à l'angle de ses images assises. */
  function tourner(w: Tanuki, dt: number): void {
    const g = gesteIci(w)
    const voulu = (((g?.ya ?? 0) * (w.face?.m ? -1 : 1)) + 360) % 360
    const ec = ((voulu - w.ang + 540) % 360) - 180
    w.ang += Math.sign(ec) * Math.min(Math.abs(ec), TOUR_DEG_S * dt)
    w.cap = w.ang
    if (Math.abs(ec) < 0.5) {
      w.etat = 'poste'
      w.th = 0
    }
  }

  /** La méditation longue : il quitte le sol de quelques pixels et y flotte, au rythme de son souffle. */
  function leviter(w: Tanuki, dt: number): void {
    const g = gesteIci(w)
    let voulu = 0
    if (w.etat === 'poste' && g?.levite) {
      const t = w.th - (g.e?.d ?? 0) - LEVITE_APRES_S
      const k = Math.max(0, Math.min(1, t / 6))
      voulu = k * k * (3 - 2 * k) * (g.levite + 0.18 * g.levite * Math.sin(w.th * 1.05)) * (w.u / 60)
    }
    w.lev += (voulu - w.lev) * Math.min(1, dt * (voulu ? 1.2 : 6))
  }

  function avance(dt: number): void {
    for (let n = T.length - 1; n >= 0; n--) {
      const w = T[n]
      w.alpha = Math.min(1, w.alpha + dt * 1.6)
      if (w.etat === 'parti') {
        w.alpha -= dt * 3.2
        if (w.alpha <= 0) T.splice(n, 1)
        continue
      }
      // Entre deux niveaux, la taille glisse : un sol mesuré à la main ne tombe jamais pile.
      const tu = taille(w.x, w.y) / 0.866
      if (tu) w.u += (tu - w.u) * Math.min(1, dt * 6)
      if (w.etat === 'tourne') {
        tourner(w, dt)
        continue
      }
      if (w.etat === 'leve') {
        w.th += dt
        leviter(w, dt)
        if (w.th >= (gesteIci(w)?.e?.d ?? 0)) {
          const suite = w.apres
          w.apres = null
          w.etat = w.poste !== null ? 'poste' : 'attend'
          w.lev = 0
          // Relevé : il reste debout tant qu'il n'a pas d'autre ordre, sans se rasseoir aussitôt.
          w.th = Math.max(w.th, 1e-3)
          if (suite) suite()
          if (w.etat === 'poste' && gesteIci(w)?.e) w.etat = 'attend'
        }
        continue
      }
      if (w.etat !== 'va') {
        w.th += dt
        leviter(w, dt)
        decider(w)
        continue
      }
      marcher(w, dt)
    }
  }

  function replanifier(w: Tanuki): void {
    if (!w.place) return
    w.ch = chemin([w.x, w.y], [w.place.x, w.place.y], w)
    w.i = 0
  }

  function marcher(w: Tanuki, dt: number): void {
    const c0 = w.ch[w.i]
    if (!c0) {
      arrivee(w)
      return
    }
    if (c0.e !== undefined) {
      dansEscalier(w, c0, dt)
      return
    }
    let gx = c0[0] - w.x
    let gy = (c0[1] - w.y) / SP
    const dc = Math.hypot(gx, gy)
    const sv = w.ch[w.i + 1]
    const palier = sv !== undefined && sv.e !== undefined
    // Au pied de l'escalier, on s'arrête derrière ceux qui attendent déjà : une file, pas un tas.
    if (palier && encombre(ESC[sv.e as number], sv.sens as number, w)) {
      const devant = T.filter(
        (o) =>
          o !== w &&
          o.pause &&
          o.fileE === sv.e &&
          o.fileS === sv.sens &&
          Math.hypot(o.x - c0[0], (o.y - c0[1]) / SP) < dc
      ).length
      if (dc < w.u * (0.85 + devant * 0.62)) {
        w.pause = true
        w.fileE = sv.e as number
        w.fileS = sv.sens as number
        w.vit = 0
        w.st = 0
        return
      }
    }
    w.pause = false
    w.fileE = -1
    const dernier = w.i >= w.ch.length - 1
    // On ne passe au point suivant en avance que s'il est déjà en vue.
    if (dc < 2.5 || (!dernier && !palier && dc < w.u * 0.4 && clair(w.x, w.y, w.ch[w.i + 1]))) {
      w.i++
      w.mieux = 1e9
      return
    }
    if (dc < w.mieux - 0.05) {
      w.mieux = dc
      w.st = 0
    } else if ((w.st += dt) > 1.2) {
      w.st = 0
      w.mieux = 1e9
      if (dernier && dc < 32) {
        w.i++
        return
      }
      replanifier(w)
      return
    }
    const h = visee(w)
    let hx = h[0] - w.x
    let hy = (h[1] - w.y) / SP
    const hn = Math.hypot(hx, hy) || 1
    hx /= hn
    hy /= hn
    gx /= dc
    gy /= dc
    let lat = 0
    let bloque = 1
    const px = -hy
    const py = hx
    for (const o of T) {
      if (o === w || o.sur >= 0) continue
      const ox = o.x - w.x
      const oy = (o.y - w.y) / SP
      const d = Math.hypot(ox, oy)
      const Rr = w.u * 0.52
      if (d < Rr && ox * hx + oy * hy > 0) {
        lat += (1 - d / Rr) * (ox * px + oy * py > 0 ? -1.5 : 1.5)
        if (d < Rr * 0.55) bloque = immobile(o) || o.pause ? 1 : w.id > o.id ? 0.25 : 1
      }
    }
    // Le cap tourne à vitesse humaine : il ne change jamais de direction d'un coup.
    const voulu = (Math.atan2(hx + px * lat, hy + py * lat) * 180) / Math.PI
    const ec = ((voulu - w.cap + 540) % 360) - 180
    // Tout près d'un point à atteindre, il vise droit : sinon il tournerait autour sans y arriver.
    if (dc < w.u * 0.34 && (dernier || palier)) w.cap = voulu
    else w.cap += Math.sign(ec) * Math.min(Math.abs(ec), 300 * dt)
    let nx = Math.sin((w.cap * Math.PI) / 180)
    let ny = Math.cos((w.cap * Math.PI) / 180)
    // Il ralentit pour s'arrêter à son poste et pour prendre un virage serré.
    const frein = dernier || palier ? Math.max(0.4, Math.min(1, dc / (w.u * 0.5))) : 1
    const vire = 1 - Math.min(0.6, Math.abs(ec) / 170)
    w.vit += (V * w.u * w.k * bloque * frein * vire - w.vit) * Math.min(1, dt * 7)
    const v = w.vit * dt
    let X = w.x + nx * v
    let Y = w.y + ny * SP * v
    if (!libre(X, Y)) {
      X = w.x + gx * v
      Y = w.y + gy * SP * v
      nx = gx
      ny = gy
    }
    if (!libre(X, Y)) {
      const sx = w.x + gx * v
      const sy = w.y + gy * SP * v
      if (Math.abs(gx) > 0.2 && libre(sx, w.y)) {
        X = sx
        Y = w.y
      } else if (Math.abs(gy) > 0.2 && libre(w.x, sy)) {
        X = w.x
        Y = sy
      }
    }
    if (libre(X, Y)) {
      const dd = Math.hypot(X - w.x, (Y - w.y) / SP)
      w.x = X
      w.y = Y
      w.ph += dd / (FOULEE * w.u)
      const e = (((Math.atan2(nx, ny) * 180) / Math.PI - w.ang + 540) % 360) - 180
      w.ang += Math.sign(e) * Math.min(Math.abs(e), 420 * dt)
    } else {
      // Coincé contre un coin : il se recentre sur sa case, d'où les droites du trajet sont sûres.
      const cx = Math.round((w.x - G.x0) / G.pas) * G.pas + G.x0
      const cy = Math.round((w.y - G.y0) / G.pas) * G.pas + G.y0
      if (libre(cx, cy)) {
        w.x += (cx - w.x) * Math.min(1, dt * 8)
        w.y += (cy - w.y) * Math.min(1, dt * 8)
      }
      if ((w.gene += dt) > 0.35) {
        w.gene = 0
        replanifier(w)
      }
    }
  }

  /**
   * Un nouvel agent entre par le sable, et attend là sa première action (D14). Celui d'un collègue entre
   * par le même chemin et suit les mêmes règles : seul son foulard le distingue (D-8, D9).
   */
  function ajouter(id: string, consigne: Consigne, foulard?: string): Tanuki {
    const p = placePres(ENTREE[0], ENTREE[1], null)
    const [i, j] = proche(p.x, p.y)
    const X = i * G.pas + G.x0
    const Y = j * G.pas + G.y0
    const w: Tanuki = {
      id,
      x: X,
      y: Y,
      u: (taille(X, Y) || 66) / 0.866,
      ch: [],
      i: 0,
      ph: alea(),
      ang: 180,
      cap: 180,
      vit: 0,
      poste: null,
      place: p,
      cible: null,
      metierIci: null,
      th: 0,
      etat: 'attend',
      nom: '',
      face: p,
      mir: 0,
      nb: 0,
      sur: -1,
      lev: 0,
      S: 0,
      sens: 0,
      pause: false,
      fileE: -1,
      fileS: 0,
      k: 0.93 + 0.14 * alea(),
      mieux: 1e9,
      st: 0,
      gene: 0,
      pas: 0,
      sortant: false,
      alpha: 0,
      consigne,
      duree: 0,
      dernier: '',
      apres: null,
      ...(foulard ? { foulard } : {})
    }
    T.push(w)
    return w
  }

  return { T, avance, ajouter, libre, taille, chemin, ESC, placePres, dans }
}
