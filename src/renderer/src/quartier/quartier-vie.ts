/**
 * LE DÉCOR VIT (conv-1421, « ce décor doit pas etre statique il doit y avoir plein d'éléments qui
 * bougent partout »). Tout ce qui bouge sans être un tanuki : ciel, ville, eau, vapeurs, feuillages.
 *
 * Rien n'est repeint : ce sont des morceaux de la peinture qui glissent, ou de petites touches
 * dessinées par-dessus. Les teintes sont fixes : ce décor est une maquette, il ne suit pas le thème.
 *
 * LA RÈGLE DE CE FICHIER (conv-1424, « les animations de décor sont éclatées »). La scène est une photo
 * de maquette : une forme plate posée dessus se voit tout de suite. Ce qui avait une matière (ballon,
 * bateaux, tram) est donc une petite peinture dans `vie.sprites`, et ce qui est de la lumière (phare,
 * anneau, reflets, fenêtres) se fond : ni bord dur, ni allumage d'un coup.
 */
import type { DonneesQuartier, ObjetCoupe } from './quartier-scene'

type Ctx = CanvasRenderingContext2D
interface Calque {
  x: number
  y: number
  w: number
  h: number
  i: HTMLImageElement
  px?: number
  py?: number
  bx?: number
  by?: number
}

export const toile = (l: number, h: number): HTMLCanvasElement => {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.ceil(l))
  c.height = Math.max(1, Math.ceil(h))
  return c
}

export const contexte = (c: HTMLCanvasElement): Ctx => c.getContext('2d') as Ctx

export const image = async (src: string): Promise<HTMLImageElement> => {
  const i = new Image()
  i.src = src
  await i.decode()
  return i
}

const rnd = (a: number, b: number): number => a + Math.random() * (b - a)
const lisse = (t: number): number => t * t * (3 - 2 * t)

/** Un rond flou d'une teinte : vapeurs, poussière, lueurs. */
const rondFlou = (r: number, g: number, b: number): HTMLCanvasElement => {
  const k = toile(48, 48)
  const c2 = contexte(k)
  const d = c2.createRadialGradient(24, 24, 1, 24, 24, 24)
  d.addColorStop(0, `rgba(${r},${g},${b},1)`)
  d.addColorStop(0.45, `rgba(${r},${g},${b},.42)`)
  d.addColorStop(1, `rgba(${r},${g},${b},0)`)
  c2.fillStyle = d
  c2.fillRect(0, 0, 48, 48)
  return k
}

/**
 * La matière de la vapeur : trois filets souples, qui se raccordent en haut et en bas pour défiler sans
 * fin. Teinte fixe : c'est de la vapeur dans une maquette.
 */
const matiereVapeur = (): HTMLCanvasElement => {
  const L = 48
  const marge = 8
  const k = toile(L, MATIERE_H + marge)
  const c2 = contexte(k)
  const d = c2.createImageData(L, MATIERE_H + marge)
  const tour = (Math.PI * 2) / MATIERE_H
  const filets = [
    { c: -0.1, a: 0.17, f: 2, ph: 0.4, b: 0.07, g: 5, s: 0.1, f2: 3, ph2: 1 },
    { c: 0.12, a: 0.15, f: 3, ph: 2.6, b: 0.09, g: 4, s: 0.075, f2: 2, ph2: 3.4 },
    { c: 0, a: 0.21, f: 1, ph: 4.4, b: 0.06, g: 7, s: 0.055, f2: 5, ph2: 5.2 }
  ]
  for (let j = 0; j < MATIERE_H + marge; j++)
    for (let i = 0; i < L; i++) {
      const u = i / (L - 1) - 0.5
      let a = 0
      for (const f of filets) {
        const c =
          f.c + f.a * Math.sin(j * tour * f.f + f.ph) + f.b * Math.sin(j * tour * f.g + f.ph)
        const r = (u - c) / f.s
        a += Math.exp(-r * r) * (0.6 + 0.4 * Math.sin(j * tour * f.f2 + f.ph2))
      }
      const o = (j * L + i) * 4
      d.data[o] = 255
      d.data[o + 1] = 252
      d.data[o + 2] = 246
      d.data[o + 3] = Math.round(Math.min(1, a) * 255 * Math.min(1, (0.5 - Math.abs(u)) * 9))
    }
  c2.putImageData(d, 0, 0)
  return k
}

/** Le ton sombre d'une teinte de papillon : le bord de ses ailes. */
const assombrir = (c: string): string =>
  `#${[1, 3, 5]
    .map((i) =>
      Math.round(parseInt(c.slice(i, i + 2), 16) * 0.55)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`

/**
 * De combien glisse une ligne d'eau, en pixels de la peinture.
 *
 * Deux houles longues, jamais une vague par ligne : un écart franc d'une ligne à la suivante découpe
 * le reflet en peigne et dentelle les berges (conv-1424). `k` va de 0 au fond à 1 sur la rive proche.
 */
export function glissementEau(yPeinture: number, temps: number, k: number): number {
  return (
    Math.sin(yPeinture * 0.22 + temps * 1.1) * (0.16 + k * 0.42) +
    Math.sin(yPeinture * 0.09 - temps * 0.6) * (0.12 + k * 0.36)
  )
}

/**
 * La forme d'un filet de vapeur à la hauteur `u` (0 au ras de l'eau, 1 en haut) : son écart à la verticale
 * et sa largeur. Un seul ruban continu : empiler des ronds blancs faisait un paquet de coton (conv-1424).
 */
export function formeVolute(
  u: number,
  temps: number,
  ph: number,
  large: number
): { dx: number; l: number } {
  const monte = u * u
  return {
    dx:
      Math.sin(u * 3.4 - temps * 0.8 + ph) * (0.6 + monte * large * 0.34) +
      Math.sin(u * 7.3 - temps * 1.3 + ph * 2) * monte * large * 0.1 +
      monte * large * 0.45,
    l: large * (0.32 + u * 0.9)
  }
}

/** L'opacité d'un filet à la hauteur `u` : il naît sans bord au ras de l'eau et se dissout en montant. */
export function fonduVapeur(u: number): number {
  return Math.min(1, u / 0.12) ** 1.2 * (1 - Math.max(0, (u - 0.28) / 0.72)) ** 1.6
}

/** Un bateau suit sa voie : il ralentit au bout, vire en montrant sa largeur, et repart. */
export interface VoieBateau {
  x: number
  /** -1 ou 1 : le sens voulu. */
  sens: number
  /** De -1 à 1 : le sens réel. À 0, on voit le bateau par l'étrave. */
  cap: number
  v: number
  min: number
  max: number
}

export function avancerBateau(b: VoieBateau, dt: number): void {
  if (b.x >= b.max) b.sens = -1
  if (b.x <= b.min) b.sens = 1
  b.cap += Math.max(-dt * 0.5, Math.min(dt * 0.5, b.sens - b.cap))
  b.x += b.v * b.cap * dt
}

/** Le tram s'arrête à chaque bout du pont : il repart en douceur. Rend sa place, de 0 à 1. */
export function placeDuTram(t: number): number {
  const u = t % 2
  const aller = u < 1 ? u : 2 - u
  const pause = 0.08
  return lisse(Math.max(0, Math.min(1, (aller - pause) / (1 - 2 * pause))))
}

/** L'instant où la cloche sonne, après le début du geste. */
const IMPACT_S = 0.34
/** Hauteur d'une ligne de filet, en pixels de la peinture : entière, pour qu'aucune couture ne se voie. */
const LIGNE_VAPEUR = 2
const VAPEUR_L = 56
const VAPEUR_H = 90
/** La matière de la vapeur boucle sur cette hauteur : elle défile sans couture. */
const MATIERE_H = 192
/** Un tanuki au poste du gong ne frappe pas sans arrêt. */
const PAUSE_FRAPPE_S = 8

/** Un filet de vapeur : son pied (x, y) sur la peinture, sa hauteur, sa largeur, sa transparence, sa vitesse. */
export interface Vapeur {
  x: number
  y: number
  h: number
  l: number
  a: number
  v: number
}
/**
 * La vapeur de l'onsen de la Falaise o-1916 (conv-1459) : elle monte du milieu de l'eau, devant les baigneurs
 * adossés aux galets, là où la peinture la montre déjà.
 */
export const VAPEURS_ONSEN: readonly Vapeur[] = [
  { x: 250, y: 738, h: 40, l: 16, a: 0.24, v: 15 },
  { x: 292, y: 730, h: 58, l: 20, a: 0.28, v: 13 },
  { x: 335, y: 745, h: 46, l: 18, a: 0.26, v: 16 },
  { x: 378, y: 734, h: 66, l: 24, a: 0.32, v: 12 },
  { x: 420, y: 748, h: 52, l: 20, a: 0.28, v: 14 },
  { x: 462, y: 756, h: 40, l: 16, a: 0.22, v: 15 }
]
/** La théière du toit du Chat : la vapeur part de son couvercle, sous le Brain (conv-1459). */
const VAPEUR_THEIERE: Vapeur = { x: 783, y: 224, h: 44, l: 13, a: 0.34, v: 13 }
// fix-ok: positions relevées sur l'ancienne peinture — sur la capture du lot 3 (conv-1444), la roue orange, le
// maillet rouge, les étoiles, la lueur de l'anneau et le faisceau du phare tombaient à côté des objets de la
// Falaise o-1916. Tout ce qui suit est relevé sur elle.
/** Le centre de l'anneau de Jarvis, sur la tour verte de la Falaise o-1916 (conv-1444). */
export const ANNEAU: readonly [number, number] = [368, 197]
/** La lanterne du phare, sous la flèche de la tour violette (conv-1444) : le faisceau en part. */
export const PHARE: readonly [number, number] = [433, 195]

export interface VieDecor {
  /** `actifs(...postes)` : un tanuki y travaille-t-il ? Le gong réagit. */
  avancer(
    dt: number,
    actifs: (...postes: number[]) => boolean,
    tanukis: readonly { etat: string; sur: number; y: number; x: number; ph: number; pas: number }[]
  ): void
  ciel(x: Ctx): void
  eau(x: Ctx): void
  pieces(x: Ctx): void
  feuillages(x: Ctx, devant: boolean): void
  airs(x: Ctx): void
  /** La roue de Settings, seule : son survol la redessine éclairée. */
  roue(x: Ctx): void
  frapper(sonner: () => void): void
  temps(): number
}

export async function creerVie(
  D: DonneesQuartier,
  F: HTMLImageElement,
  S: number,
  OB: ObjetCoupe[],
  FE: ObjetCoupe[]
): Promise<
  VieDecor & { rond: HTMLCanvasElement; rondO: HTMLCanvasElement; rondR: HTMLCanvasElement }
> {
  const VI = D.vie
  const rond = rondFlou(255, 255, 255)
  const rondS = rondFlou(214, 186, 140)
  const rondO = rondFlou(255, 196, 70)
  const rondR = rondFlou(235, 62, 48)
  const rondT = rondFlou(84, 214, 222)
  const ombreP = rondFlou(46, 24, 10)
  // Le faisceau du phare : une lumière qui s'étale et s'éteint, jamais un triangle à bords nets.
  const faisceau = toile(256, 96)
  {
    const c2 = contexte(faisceau)
    const d = c2.createImageData(256, 96)
    for (let j = 0; j < 96; j++)
      for (let i = 0; i < 256; i++) {
        const u = i / 255
        const v = (j - 47.5) / 48
        const large = 0.1 + u * 0.8
        const a = (1 - u) ** 1.7 * Math.exp(-((v / large) ** 2) * 2.4) * Math.min(1, u * 14)
        const o = (j * 256 + i) * 4
        d.data[o] = 255
        d.data[o + 1] = 244
        d.data[o + 2] = 196
        d.data[o + 3] = Math.round(a * 255)
      }
    c2.putImageData(d, 0, 0)
  }
  const CAL: Record<string, Calque> = {}
  await Promise.all(
    Object.entries(VI.calques).map(async ([n, o]) => {
      CAL[n] = { ...o, i: await image(o.m) }
    })
  )
  for (const o of OB) if (o.n && CAL[o.n]) o.cal = CAL[o.n]
  const e = VI.eau
  const EAUm = await image(e.m)
  // À la taille de la peinture : à moitié moins, toute l'eau du fond sortait floue (conv-1424).
  const EAUc = toile(e.w * S, e.h * S)
  const EAUg = contexte(EAUc)
  const EAUs = toile(e.w * S, e.h * S)
  contexte(EAUs).drawImage(F, -e.x * S, -e.y * S)
  const NUA = await Promise.all(
    VI.nuages.map(async (o, i) => ({
      ...o,
      i: await image(o.m),
      v: [4.6, 3.1, 2.2][i],
      dx: [420, -120, 760][i],
      y: [34, 118, 8][i]
    }))
  )
  const SPR = Object.fromEntries(
    await Promise.all(
      Object.entries(VI.sprites).map(async ([n, o]) => [n, { ...o, i: await image(o.m) }] as const)
    )
  )
  const bonsai = OB.filter((o) => o.cle === 'worktree').map((o) => ({ ...o, A: 1.4, f: 1.1, p: 2 }))
  FE.push(...bonsai)

  let temps = 0
  let gust = 1
  let frappeDebut = -99
  let impactFait = true
  let sonner: (() => void) | null = null
  const GONG = VI.gong
  // Des filets fins qui montent de l'eau et s'effacent, de tailles différentes. L'encens du dojo collé n'a plus
  // de fumée : la Falaise o-1916 peint son dojo, sans brûle-encens (conv-1459).
  const VOLUTES = [...VAPEURS_ONSEN, VAPEUR_THEIERE].map((o, i) => ({
    ...o,
    ph: i * 2.1,
    o: i * 47
  }))
  const MATIERE = matiereVapeur()
  const VAPEUR = toile(VAPEUR_L, VAPEUR_H)
  const VAPEURg = contexte(VAPEUR)
  // Le filet naît sans bord au ras de l'eau et se dissout en montant.
  const FONDU = toile(1, VAPEUR_H)
  {
    const c2 = contexte(FONDU)
    const d = c2.createImageData(1, VAPEUR_H)
    for (let j = 0; j < VAPEUR_H; j++)
      d.data[j * 4 + 3] = Math.round(fonduVapeur(1 - j / (VAPEUR_H - 1)) * 255)
    c2.putImageData(d, 0, 0)
  }
  const POU: { x: number; y: number; r: number; age: number; vie: number }[] = []
  const ONDES: { age: number }[] = []
  // Les cerisiers du quai de la Falaise o-1916 (conv-1444) : le grand à gauche, les deux près du torii.
  const NIDS = [
    [14, 335],
    [32, 340],
    [388, 330],
    [404, 334],
    [452, 330],
    [468, 334]
  ]
  /**
   * Un pétale naît et se fane : il ne traverse plus toute l'image à la même taille. Ceux des cerisiers
   * lointains tombent vers l'eau, tout petits ; une poignée, plus proches, passe devant le décor.
   */
  const semer = (p: { x: number; y: number; loin: boolean; age: number; vie: number }): void => {
    if (p.loin) {
      const n = NIDS[Math.floor(rnd(0, NIDS.length))]
      p.x = n[0] + rnd(-16, 16)
      p.y = n[1] + rnd(-12, 6)
      p.vie = rnd(5, 11)
    } else {
      p.x = rnd(-30, 420)
      p.y = rnd(460, 640)
      p.vie = rnd(11, 20)
    }
    p.age = 0
  }
  const PET = Array.from({ length: 34 }, (_, i) => {
    const loin = i < 24
    const p = {
      x: 0,
      y: 0,
      v: rnd(10, 22) * (loin ? 0.35 : 1),
      c: rnd(0, 6),
      s: loin ? rnd(0.8, 1.2) : rnd(1.7, 2.4),
      loin,
      age: 0,
      vie: 1
    }
    semer(p)
    p.age = rnd(0, p.vie)
    return p
  })
  const OIS = Array.from({ length: 11 }, (_, i) => {
    const g = i < 5 ? 0 : i < 8 ? 1 : 2
    return {
      x: [-40, 500, 1180][g] - (i % 5) * 16 + rnd(-5, 5),
      y: [120, 62, 150][g] + (i % 3) * 9 + rnd(-4, 4),
      v: [17, 13, -15][g],
      ph: rnd(0, 6),
      s: rnd(3.2, 4.6)
    }
  })
  // Chaque voie reste dans l'eau libre : hors de là, la voile passerait devant le hangar ou la bibliothèque.
  // Sur la Falaise o-1916, l'eau libre est entre le robot du hangar et la bibliothèque (conv-1444).
  const BAT = [
    { x: 250, y: 411, v: 3.6, min: 180, max: 324, l: 12, s: 'bateau2' },
    { x: 210, y: 416, v: 5, min: 183, max: 322, l: 16, s: 'bateau1' },
    { x: 290, y: 426, v: 3, min: 258, max: 316, l: 22, s: 'bateau3' }
  ].map((b) => ({
    ...b,
    sens: 1,
    cap: 1,
    i: SPR[b.s].i,
    h: (b.l * SPR[b.s].h) / SPR[b.s].w
  }))
  const ECL = Array.from({ length: 46 }, () => ({
    x: rnd(0, e.w),
    y: rnd(0, e.h),
    f: rnd(0.35, 1.1),
    p: rnd(0, 6),
    l: rnd(4, 11)
  }))
  // De vraies fenêtres, relevées sur la peinture : allumées au hasard, elles tombaient à côté.
  const FEN = VI.fenetres.map(([x, y, w, h]) => ({
    x,
    y,
    w,
    h,
    t: rnd(0, 9),
    voulu: Math.random() < 0.3 ? 1 : 0,
    a: 0
  }))
  // Ils restent sur les plantes : au-dessus d'un bain, ils se perdaient dans la vapeur (conv-1424). Celles de
  // la Falaise o-1916 (conv-1444) : le palmier nain et la mousse au bord de l'onsen, le pot du chemin,
  // l'herbe sous la caméra et la grosse plante grasse à gauche.
  const FLEURS = [
    [336, 648],
    [500, 668],
    [560, 640],
    [614, 625],
    [836, 728],
    [80, 640]
  ]
  const PAP = Array.from({ length: 6 }, (_, i) => {
    const c = ['#f2a23a', '#f0cf4e', '#e86a92', '#7fb7e8'][i % 4] // couleur-fixe: papillons de la maquette
    return {
      cx: FLEURS[i][0],
      cy: FLEURS[i][1],
      r: rnd(9, 20),
      p: rnd(0, 6),
      v: rnd(0.28, 0.6),
      c,
      bord: assombrir(c)
    }
  })
  const BAL = { x: 690, y: 92, v: -3.4 }
  const TRAM = {
    t: 0.2,
    // Relevé sur le pont de pierre de la Falaise o-1916 (conv-1444) : le haut de la chaussée, de la ville jusqu'au
    // toit de la bibliothèque, qui cache la fin du pont. Rien n'est devant lui.
    ps: [
      [254, 367],
      [266, 363],
      [280, 361],
      [300, 360],
      [320, 362.5],
      [335, 366],
      [350, 372],
      [364, 379]
    ]
  }

  type Bateau = (typeof BAT)[number]
  /** Le bateau vu de biais quand il vire : jamais aplati à rien. */
  const largeur = (b: Bateau): number => b.l * (b.cap < 0 ? -1 : 1) * Math.max(0.3, Math.abs(b.cap))

  /** Dans l'eau : le sillage et le reflet, que le masque coupe aux berges. */
  const dessinerSillage = (g: Ctx, b: Bateau): void => {
    const l = largeur(b)
    g.save()
    g.scale(S, S)
    g.translate(b.x - e.x, b.y - e.y)
    g.globalAlpha = 0.3 * Math.abs(b.cap)
    g.drawImage(rond, -l * 1.6, -0.6, l * 1.5, 2.4)
    g.globalAlpha = 0.3
    g.scale(1, -0.62)
    g.drawImage(b.i, -l / 2, -b.h, l, b.h)
    g.restore()
  }

  /** Sur l'eau : le bateau lui-même, qui dépasse la surface sans être coupé par le masque. */
  const dessinerBateau = (x: Ctx, b: Bateau): void => {
    const l = largeur(b)
    x.save()
    x.translate(b.x, b.y + Math.sin(temps * 1.2 + b.y) * 0.25)
    x.rotate(Math.sin(temps * 0.9 + b.y) * 0.022)
    x.drawImage(b.i, -l / 2, -b.h * 0.94, l, b.h)
    x.restore()
  }

  /** Le ruban d'un filet, ligne par ligne, puis son fondu : à plat sur `VAPEUR`, une seule fois par filet. */
  const filet = (s: (typeof VOLUTES)[number]): void => {
    const g = VAPEURg
    g.globalCompositeOperation = 'source-over'
    g.clearRect(0, 0, VAPEUR_L, VAPEUR_H)
    const n = Math.ceil(VAPEUR_H / LIGNE_VAPEUR)
    for (let j = 0; j < n; j++) {
      const f = formeVolute(j / n, temps, s.ph, s.l)
      const ligne = (((j * LIGNE_VAPEUR * 1.1 - s.o) % MATIERE_H) + MATIERE_H) % MATIERE_H
      g.drawImage(
        MATIERE,
        0,
        ligne,
        48,
        LIGNE_VAPEUR,
        VAPEUR_L / 2 + f.dx - f.l / 2,
        VAPEUR_H - (j + 1) * LIGNE_VAPEUR,
        f.l,
        LIGNE_VAPEUR
      )
    }
    g.globalCompositeOperation = 'destination-in'
    g.drawImage(FONDU, 0, 0, VAPEUR_L, VAPEUR_H)
  }

  /** Le tram sur le pont : il s'arrête aux deux bouts, et ne roule jamais à reculons. */
  const dessinerTram = (x: Ctx): void => {
    const n = TRAM.ps.length - 1
    const u = placeDuTram(TRAM.t) * n
    const i = Math.min(n - 1, Math.floor(u))
    const a = TRAM.ps[i]
    const b = TRAM.ps[i + 1]
    const sp = SPR.tram
    const lt = 19
    const ht = (lt * sp.h) / sp.w
    x.save()
    x.translate(a[0] + (b[0] - a[0]) * (u - i), a[1] + (b[1] - a[1]) * (u - i))
    x.rotate(Math.atan2(b[1] - a[1], b[0] - a[0]))
    x.scale(TRAM.t % 2 < 1 ? 1 : -1, 1)
    x.drawImage(sp.i, -lt / 2, -ht, lt, ht)
    x.restore()
  }

  const ballon = (x: Ctx): void => {
    const sp = SPR.ballon
    const h = 44
    const l = (h * sp.w) / sp.h
    x.save()
    x.translate(BAL.x, BAL.y + Math.sin(temps * 0.4) * 5)
    x.rotate(Math.sin(temps * 0.27) * 0.02)
    x.drawImage(sp.i, -l / 2, -h / 2, l, h)
    x.restore()
  }

  const papillon = (x: Ctx, b: (typeof PAP)[number]): void => {
    const t0 = temps * b.v + b.p
    const px = b.cx + Math.sin(t0) * b.r + Math.sin(t0 * 2.7) * 5
    const py = b.cy + Math.cos(t0 * 1.3) * b.r * 0.35 + Math.sin(t0 * 3.1) * 3
    // Il plane par moments : les ailes restent ouvertes au lieu de battre sans arrêt.
    const plane = Math.max(0, Math.sin(t0 * 2.1))
    const bat = Math.abs(Math.sin(temps * 9 + b.p))
    const ouvert = 0.3 + 0.7 * (plane > 0.6 ? 0.9 : bat)
    x.globalAlpha = 0.2
    x.drawImage(ombreP, px - 4, py + 8, 8, 2.6)
    x.globalAlpha = 1
    x.save()
    x.translate(px, py)
    x.rotate(Math.sin(t0 * 1.1) * 0.45)
    for (const cote of [-1, 1]) {
      x.save()
      x.scale(cote * ouvert, 1)
      x.fillStyle = b.bord
      x.beginPath()
      x.moveTo(0, -0.4)
      x.bezierCurveTo(1.1, -4, 5.4, -4.2, 4.8, -0.9)
      x.bezierCurveTo(4.4, 0.5, 1.6, 0.4, 0, 0.2)
      x.moveTo(0, 0)
      x.bezierCurveTo(1.6, 0.3, 3.8, 0.5, 3.2, 2.6)
      x.bezierCurveTo(2.6, 3.8, 0.8, 2.6, 0, 1)
      x.fill()
      x.fillStyle = b.c
      x.beginPath()
      x.moveTo(0.5, -0.5)
      x.bezierCurveTo(1.4, -3.2, 4.7, -3.4, 4.2, -1)
      x.bezierCurveTo(3.8, 0, 1.6, 0, 0.5, -0.1)
      x.moveTo(0.5, 0.3)
      x.bezierCurveTo(1.6, 0.5, 3.2, 0.6, 2.7, 2.2)
      x.bezierCurveTo(2.2, 3.1, 0.9, 2.2, 0.5, 1)
      x.fill()
      x.restore()
    }
    x.fillStyle = '#3a2a1e' // couleur-fixe: corps d'un papillon
    x.beginPath()
    x.ellipse(0, 0.4, 0.42, 1.9, 0, 0, 6.3)
    x.fill()
    x.restore()
  }

  /** Un calque fixe, sans l'ombre dorée du survol : elle dessinerait un disque autour du fond de la roue. */
  const poserFixe = (x: Ctx, c: Calque): void => {
    x.save()
    x.shadowColor = 'transparent'
    x.drawImage(c.i, c.x, c.y, c.w, c.h)
    x.restore()
  }

  /**
   * La roue de la Falaise o-1916 est peinte, vue un peu de biais (conv-1444) : sous elle, son ciel et son mât
   * refaits cachent les rayons peints ; la jante tourne autour de son centre ; le moyeu, rond et décalé vers
   * nous, reste fixe par-dessus. Tournée d'un bloc, la roue valsait autour de son moyeu.
   */
  const dessinerRoue = (x: Ctx): void => {
    const R0 = CAL.roue
    poserFixe(x, CAL.roueFond)
    x.save()
    x.translate(R0.px ?? 0, R0.py ?? 0)
    x.rotate(temps * 0.32)
    x.drawImage(R0.i, R0.x - (R0.px ?? 0), R0.y - (R0.py ?? 0), R0.w, R0.h)
    x.restore()
    poserFixe(x, CAL.roueMoyeu)
  }

  return {
    rond,
    rondO,
    rondR,
    temps: () => temps,
    frapper(son) {
      if (temps - frappeDebut < 1.6) return
      frappeDebut = temps
      impactFait = false
      sonner = son
    },
    avancer(dt, actifs, tanukis) {
      temps += dt
      gust = 0.65 + 0.35 * Math.sin(temps * 0.23) * Math.sin(temps * 0.071 + 1)
      for (const s of VOLUTES) s.o += dt * s.v
      for (const w of tanukis)
        if (w.etat === 'va' && w.sur < 0 && w.y > 672) {
          const q = Math.floor(w.ph * 2)
          if (q !== w.pas) {
            ;(w as { pas: number }).pas = q
            POU.push({ x: w.x + rnd(-4, 4), y: w.y + 1, r: 2.5, age: 0, vie: rnd(0.5, 0.9) })
          }
        }
      for (let i = POU.length - 1; i >= 0; i--) {
        const p = POU[i]
        p.age += dt
        if (p.age > p.vie) POU.splice(i, 1)
        else {
          p.r += 11 * dt
          p.y -= 3 * dt
        }
      }
      for (const p of PET) {
        p.age += dt
        if (p.age > p.vie) semer(p)
        p.x += (p.v * gust + (p.loin ? 1.5 : 4)) * dt
        p.y += p.loin
          ? (4 + Math.sin(temps * 1.3 + p.c) * 3) * dt
          : (8 + Math.sin(temps * 1.3 + p.c) * 8) * dt
        p.c += dt
      }
      for (const b of OIS) {
        b.x += b.v * dt
        if (b.x > 1400) b.x = -60
        if (b.x < -60) b.x = 1400
      }
      for (const b of BAT) avancerBateau(b, dt)
      for (const f of FEN) {
        f.t -= dt
        if (f.t <= 0) {
          f.t = rnd(4, 14)
          f.voulu = Math.random() < 0.3 ? 1 : 0
        }
        // Une lampe monte et descend : un allumage d'un coup se lisait comme un pixel qui clignote.
        f.a += (f.voulu - f.a) * Math.min(1, dt * 1.2)
      }
      TRAM.t = (TRAM.t + dt * 0.03) % 2
      BAL.x += BAL.v * dt
      if (BAL.x < -40) BAL.x = 1380
      for (const n of NUA) {
        n.dx += n.v * dt
        if (n.dx > 1500) n.dx = -n.w - 60
      }
      // La cloche de la Falaise o-1916 est peinte, sans maillet ni disque découpé (conv-1444) : rien ne s'y
      // balance, le coup se voit à la lueur et aux ondes (voir `airs`).
      // Un tanuki au poste du gong le frappe de temps en temps : sans son (voir quartier-son.ts).
      if (actifs(26) && temps - frappeDebut > PAUSE_FRAPPE_S) {
        frappeDebut = temps
        impactFait = false
        sonner = null
      }
      if (!impactFait && temps - frappeDebut >= IMPACT_S) {
        impactFait = true
        sonner?.()
        sonner = null
        ONDES.push({ age: 0 }, { age: -0.24 }, { age: -0.48 })
      }
      for (let i = ONDES.length - 1; i >= 0; i--) {
        ONDES[i].age += dt
        if (ONDES[i].age > 1.7) ONDES.splice(i, 1)
      }
    },
    eau(x) {
      const g = EAUg
      const l = e.w * S
      g.globalCompositeOperation = 'source-over'
      g.globalAlpha = 1
      g.clearRect(0, 0, l, e.h * S)
      // Le fond d'abord : une ligne qui glisse ne laisse ainsi aucun trou au bord de l'eau.
      g.drawImage(EAUs, 0, 0)
      for (let j = 0; j < e.h; j++) {
        const dx = glissementEau(e.y + j, temps, j / e.h) * S
        g.drawImage(EAUs, 0, j * S, l, S, dx, j * S, l, S + 0.5)
      }
      for (const b of BAT) dessinerSillage(g, b)
      // Le soleil sur l'eau : des traits longs qui montent et s'éteignent, sans bord.
      g.globalCompositeOperation = 'lighter'
      for (const p of ECL) {
        const a = Math.abs(Math.sin(temps * p.f + p.p)) ** 6
        if (a < 0.03) continue
        const k = 0.45 + (p.y / e.h) * 0.75
        g.globalAlpha = a * 0.5
        g.drawImage(rond, (p.x - (p.l * k) / 2) * S, p.y * S, p.l * k * S, 1.5 * k * S)
      }
      g.globalAlpha = 1
      g.globalCompositeOperation = 'destination-in'
      g.drawImage(EAUm, 0, 0, l, e.h * S)
      x.drawImage(EAUc, e.x, e.y, e.w, e.h)
      for (const b of BAT) dessinerBateau(x, b)
      // Après l'eau : elle passe juste derrière le pont, et aurait recouvert le haut du tram.
      dessinerTram(x)
    },
    ciel(x) {
      ballon(x)
      for (const n of NUA) {
        x.globalAlpha = 0.7
        x.drawImage(n.i, n.dx, n.y, n.w, n.h)
        x.globalAlpha = 1
      }
      // L'anneau de Jarvis respire derrière son cerclage, et le phare balaie la ville en passant
      // derrière les tours. Peints avant elles : posés dessus, ils brûlaient l'anneau en disque blanc.
      // Sur la Falaise o-1916 (conv-1444) : l'anneau coiffe la tour verte, la lanterne du phare est sous la
      // flèche de la tour violette.
      const v = 0.55 + 0.45 * Math.sin(temps * 1.5)
      const halo = 46 + v * 7
      x.globalCompositeOperation = 'lighter'
      x.globalAlpha = 0.16 + 0.2 * v
      x.drawImage(rondT, ANNEAU[0] - halo, ANNEAU[1] - halo, halo * 2, halo * 2)
      const th = temps * 0.42
      for (const sens of [0, Math.PI]) {
        const dx = Math.cos(th + sens)
        const dy = Math.sin(th + sens) * 0.16
        x.globalAlpha = 0.06 + 0.3 * Math.abs(dx)
        x.save()
        x.translate(PHARE[0], PHARE[1])
        x.rotate(Math.atan2(dy, dx))
        x.scale(Math.hypot(dx, dy) * 1.05, 0.5)
        x.drawImage(faisceau, 0, -48)
        x.restore()
      }
      x.globalAlpha = 1
      x.globalCompositeOperation = 'source-over'
      // Les nuages passent derrière ce qui est grand : le Brain, les tours et l'observatoire restent devant.
      for (const o of OB) if (o.fixe === 'ciel') x.drawImage(o.k, o.x, o.y, o.w, o.h)
      x.strokeStyle = 'rgba(38,46,66,.72)' // couleur-fixe: oiseaux dans le ciel peint
      x.lineWidth = 1.1
      x.lineCap = 'round'
      x.beginPath()
      for (const b of OIS) {
        const a = Math.sin(temps * 8 + b.ph) * b.s * 0.55
        x.moveTo(b.x - b.s, b.y - a)
        x.quadraticCurveTo(b.x - b.s * 0.45, b.y - b.s * 0.4, b.x, b.y)
        x.quadraticCurveTo(b.x + b.s * 0.45, b.y - b.s * 0.4, b.x + b.s, b.y - a)
      }
      x.stroke()
      x.globalCompositeOperation = 'lighter'
      for (const [a, b, s] of VI.etoiles) {
        const w = 0.5 + 0.5 * Math.sin(temps * (1 + (a % 7) * 0.23) + b)
        x.globalAlpha = 0.1 + 0.6 * w * w
        const r = s * (1.1 + w * 0.7)
        x.drawImage(rond, a - r, b - r, r * 2, r * 2)
      }
      // La lumière dans le disque reste discrète : le cerclage et son blanc se voient toujours.
      x.globalAlpha = 0.05 + 0.08 * v
      x.drawImage(rond, ANNEAU[0] - 20, ANNEAU[1] - 20, 40, 40)
      x.globalAlpha = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(temps * 3.3))
      x.drawImage(rond, PHARE[0] - 11, PHARE[1] - 11, 22, 22)
      for (const f of FEN) {
        if (f.a < 0.02) continue
        x.globalAlpha = f.a * 0.3
        x.drawImage(rondO, f.x + f.w / 2 - 6, f.y + f.h / 2 - 6, 12, 12)
      }
      x.globalCompositeOperation = 'source-over'
      x.fillStyle = '#ffe3a0' // couleur-fixe: fenêtres allumées
      for (const f of FEN) {
        if (f.a < 0.02) continue
        x.globalAlpha = f.a * 0.82
        x.fillRect(f.x, f.y, f.w, f.h)
      }
      x.globalAlpha = 1
    },
    pieces(x) {
      // Plus de dojo collé ni de coussins : la Falaise o-1916 les peint (conv-1459).
      dessinerRoue(x)
      // La longue-vue de l'observatoire cherche quelque chose, très lentement, autour de la tête de son pied.
      const lv = OB.find((o) => o.cle === 'observatory')
      if (lv) {
        x.save()
        x.translate(1153, 112)
        x.rotate(Math.sin(temps * 0.31) * 0.012)
        x.translate(-1153, -112)
        x.drawImage(lv.k, lv.x, lv.y, lv.w, lv.h)
        x.restore()
      }
    },
    roue: dessinerRoue,
    feuillages(x, devant) {
      for (const f of FE) {
        if (Boolean(f.dv) !== devant) continue
        const A = f.A ?? 0
        const fr = f.f ?? 1
        const p = f.p ?? 0
        const k =
          (A / f.h) * gust * Math.sin(temps * fr + p) +
          (A / f.h) * 0.3 * Math.sin(temps * fr * 2.3 + p)
        const by = f.y + f.h
        x.save()
        x.transform(1, 0, k, 1, -k * by, 0)
        x.drawImage(f.k, f.x, f.y, f.w, f.h)
        x.restore()
      }
    },
    airs(x) {
      for (const p of POU) {
        x.globalAlpha = 0.34 * (1 - p.age / p.vie)
        x.drawImage(rondS, p.x - p.r, p.y - p.r * 0.6, p.r * 2, p.r * 1.2)
      }
      for (const s of VOLUTES) {
        filet(s)
        x.globalAlpha = s.a * 0.82
        x.drawImage(VAPEUR, s.x - VAPEUR_L / 2, s.y - s.h, VAPEUR_L, s.h)
      }
      const t = temps - frappeDebut
      // Le bronze s'éclaire au coup, et le son se voit : des ondes dorées qui partent de la cloche.
      const [cx, cy, rayon] = GONG.disque
      x.globalCompositeOperation = 'lighter'
      if (t >= IMPACT_S && t < 3) {
        x.globalAlpha = 0.55 * Math.exp(-(t - IMPACT_S) * 2)
        x.drawImage(rondO, cx - rayon, cy - rayon, rayon * 2, rayon * 2)
      }
      x.lineWidth = 2
      for (const o of ONDES) {
        if (o.age < 0) continue
        const u = o.age / 1.7
        x.globalAlpha = 0.6 * (1 - u)
        x.strokeStyle = '#ffe2a0' // couleur-fixe: onde du gong, lumière du bronze
        x.beginPath()
        x.ellipse(cx, cy, rayon + u * 110, (rayon + u * 110) * 0.82, 0, 0, 6.3)
        x.stroke()
      }
      x.globalCompositeOperation = 'source-over'
      x.globalAlpha = 1
      x.fillStyle = '#f8c4d6' // couleur-fixe: pétales de cerisier
      for (const p of PET) {
        x.globalAlpha = Math.min(1, p.age * 1.2) * Math.min(1, (p.vie - p.age) * 0.9)
        x.save()
        x.translate(p.x, p.y)
        x.rotate(p.c)
        x.scale(1, Math.abs(Math.sin(p.c * 2.2)) * 0.8 + 0.25)
        x.beginPath()
        x.ellipse(0, 0, p.s, p.s * 0.62, 0, 0, 6.3)
        x.fill()
        x.restore()
      }
      x.globalAlpha = 1
      for (const b of PAP) papillon(x, b)
    }
  }
}
