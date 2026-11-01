/**
 * LE QUARTIER, FOND DE L'ACCUEIL (conv-1421) : la Falaise peinte, où vivent les vrais agents.
 *
 * Une toile 2D, pas de 3D : la peinture est l'image, et tout ce qui bouge se pose dessus. Elle se monte
 * comme les autres fonds (`DecorScene`) : même cadence, même veille, même chemin dans `DecorDeFond`.
 *
 * LE CADRAGE. La peinture fait 1344 × 768 et se cale sur la largeur de l'Accueil, pas sur celle de la
 * fenêtre : le menu de gauche fait 216 px, et il cacherait deux tours sur sept. Elle se pose en bas de
 * l'écran, où marchent les tanukis ; ce qui manque se prolonge par le haut du ciel, et par un reflet de
 * la peinture sous le menu, dont le verre dépoli le rend invisible.
 *
 * LES OBJETS sont des morceaux de la peinture, repeints par-dessus un tanuki quand ils sont devant lui.
 * Chacun a sa ligne de pied : c'est elle, et pas la profondeur, qui décide qui passe devant.
 */
import urlFalaise from '../assets/quartier/falaise.avif'
import urlAtlas from '../assets/quartier/atlas.avif'
import type { DecorScene } from '../components/home-decor-scene'
import { HOME_WIDGET_IDS, type HomeWidgetId } from '../components/home-layout'
import {
  abonnerAgentsQuartier,
  consigneDe,
  demarrerAgentsQuartier,
  lireAgentsQuartier,
  type AgentQuartier
} from './agents-quartier'
import {
  creerMarche,
  type DonneesMarche,
  type MarcheQuartier,
  type Tanuki
} from './quartier-marche'
import {
  brancherQuartier,
  debrancherQuartier,
  type PiloteQuartier,
  type RectQuartier
} from './quartier-pont'
import { jouerGong } from './quartier-son'
import { lireTuilesSorties, TOUR_DU_WIDGET, widgetDeLaTour } from './quartier-tuiles'
import { contexte, creerVie, image, toile, type VieDecor } from './quartier-vie'

const LARGEUR = 1344
const HAUTEUR = 768
/** Plafond de la toile : au-delà, la dalle 4K paierait des pixels que la peinture n'a pas. */
const PIXELS_MAX = 3_200_000
/** Le temps du zoom avant que la vue ne s'ouvre. */
const ZOOM_MS = 640
const DESTINATIONS: Readonly<Record<string, string>> = {
  chat: 'chat',
  agent: 'agent-studio',
  knowledge: 'knowledge',
  observatory: 'observatory',
  task: 'task-manager',
  worktree: 'worktree',
  besoins: 'besoins',
  tests: 'tests',
  settings: 'settings'
}

export interface ObjetDonnee {
  n?: string
  nom?: string
  vue?: string
  cle?: string
  fixe?: string
  A?: number
  f?: number
  p?: number
  dv?: number
  x: number
  y: number
  w: number
  h: number
  m: string
  b?: number[]
}

export interface ObjetCoupe extends ObjetDonnee {
  k: HTMLCanvasElement
  hit: ImageData | null
  cal?: {
    x: number
    y: number
    w: number
    h: number
    i: HTMLImageElement
    bx?: number
    by?: number
  }
  rot?: number
  lueur?: HTMLCanvasElement
}

interface CalqueDonnee {
  x: number
  y: number
  w: number
  h: number
  m: string
  px?: number
  py?: number
  bx?: number
  by?: number
}

export interface DonneesQuartier extends DonneesMarche {
  gestes: Record<string, { r: number; d: number; n: number }>
  an: { cw: number; ch: number; ax: number; ay: number; pu: number }
  obj: ObjetDonnee[]
  feuilles: ObjetDonnee[]
  vie: {
    calques: Record<string, CalqueDonnee>
    eau: { x: number; y: number; w: number; h: number; m: string }
    /** Le disque du gong : centre et rayon, relevés sur son image. Les ondes en partent. */
    gong: { disque: [number, number, number] }
    etoiles: [number, number, number][]
    nuages: { x: number; y: number; w: number; h: number; m: string }[]
  }
}

interface Monde {
  D: DonneesQuartier
  F: HTMLImageElement
  S: number
  A: HTMLCanvasElement
  AO: HTMLCanvasElement
  OB: ObjetCoupe[]
  FE: ObjetCoupe[]
  m: MarcheQuartier
  vie: VieDecor & { rond: HTMLCanvasElement; rondO: HTMLCanvasElement; rondR: HTMLCanvasElement }
  contact: HTMLCanvasElement
  sols: { n: DonneesMarche['niv'][number]; P: Path2D }[]
}

async function coupe(F: HTMLImageElement, S: number, o: ObjetDonnee): Promise<ObjetCoupe> {
  const i = await image(o.m)
  const k = toile(o.w * S, o.h * S)
  const g = contexte(k)
  g.drawImage(i, 0, 0, k.width, k.height)
  let hit: ImageData | null = null
  if (o.nom) {
    // À la taille de la peinture, pas de l'image agrandie : la souris n'a pas besoin de plus.
    const c = toile(o.w, o.h)
    const gh = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
    gh.drawImage(i, 0, 0, o.w, o.h)
    hit = gh.getImageData(0, 0, c.width, c.height)
  }
  g.globalCompositeOperation = 'source-in'
  g.drawImage(F, -o.x * S, -o.y * S)
  return { ...o, k, hit }
}

/** La silhouette dorée et floue d'une tour : préparée une fois, posée à chaque image, rien à calculer. */
function lueurDe(o: ObjetCoupe): HTMLCanvasElement {
  const marge = 26
  const a = toile(o.w + marge * 2, o.h + marge * 2)
  const g = contexte(a)
  g.drawImage(o.k, marge, marge, o.w, o.h)
  g.globalCompositeOperation = 'source-in'
  g.fillStyle = '#ffd36e' // couleur-fixe: lumière d'une tour, peinte dans la maquette
  g.fillRect(0, 0, a.width, a.height)
  const b = toile(a.width, a.height)
  const h = contexte(b)
  h.filter = 'blur(9px)'
  h.drawImage(a, 0, 0)
  h.filter = 'none'
  h.drawImage(b, 0, 0)
  return b
}

async function charger(): Promise<Monde> {
  const module = await import('../assets/quartier/donnees.json')
  const D = (module.default ?? module) as unknown as DonneesQuartier
  const [F, atlas] = await Promise.all([image(urlFalaise), image(urlAtlas)])
  const S = F.naturalWidth / LARGEUR
  // Les filtres de toile coûtent cher à chaque image : on les applique UNE fois, à l'atlas entier.
  const A = toile(atlas.naturalWidth, atlas.naturalHeight)
  const gA = contexte(A)
  gA.filter = 'saturate(1.06)'
  gA.drawImage(atlas, 0, 0)
  const AO = toile(atlas.naturalWidth, atlas.naturalHeight)
  const gO = contexte(AO)
  gO.filter = 'brightness(0) blur(2px)'
  gO.drawImage(atlas, 0, 0)
  const OB = await Promise.all(D.obj.map((o) => coupe(F, S, o)))
  const FE = await Promise.all(D.feuilles.map((o) => coupe(F, S, o)))
  for (const id of HOME_WIDGET_IDS) {
    const o = OB.find((q) => q.cle === TOUR_DU_WIDGET[id])
    if (o) o.lueur = lueurDe(o)
  }
  const vie = await creerVie(D, F, S, OB, FE)
  const contact = toile(64, 64)
  const g = contexte(contact)
  const d = g.createRadialGradient(32, 32, 3, 32, 32, 32)
  d.addColorStop(0, 'rgba(46,24,10,.85)') // couleur-fixe: ombre sur la peinture
  d.addColorStop(0.55, 'rgba(46,24,10,.42)') // couleur-fixe: ombre sur la peinture
  d.addColorStop(1, 'rgba(46,24,10,0)') // couleur-fixe: ombre sur la peinture
  g.fillStyle = d
  g.fillRect(0, 0, 64, 64)
  const sols = D.niv.map((n) => {
    const P = new Path2D()
    n.p.forEach(([a, b], i) => (i ? P.lineTo(a, b) : P.moveTo(a, b)))
    P.closePath()
    return { n, P }
  })
  return { D, F, S, A, AO, OB, FE, m: creerMarche(D), vie, contact, sols }
}

const pied = (o: ObjetCoupe, px: number): number => {
  const b = o.b ?? []
  const n = b.length
  const t = Math.max(0, Math.min(n - 1, (px - o.x) / 8))
  const a = Math.floor(t)
  const e = Math.min(n - 1, a + 1)
  return b[a] + (b[e] - b[a]) * (t - a)
}

const couvre = (o: ObjetCoupe, w: Tanuki): boolean =>
  w.x + w.u * 0.4 > o.x && w.x - w.u * 0.4 < o.x + o.w && w.y + 4 > o.y && w.y - w.u < o.y + o.h

/** D19 : les premiers mots du fil ; pour un lot, ce qui suit « Lot 8/8 — ». */
export function etiquetteDuFil(titre: string): string {
  const t = titre.replace(/^\s*Lot\s+\d+\s*\/\s*\d+\s*[—–-]\s*/i, '').trim()
  return t.length > 24 ? `${t.slice(0, 23).trimEnd()}…` : t
}

export function creerSceneQuartier(): DecorScene | null {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) return null
  const x: CanvasRenderingContext2D = ctx
  canvas.style.opacity = '0'
  canvas.style.transition = 'opacity 0.6s ease'
  demarrerAgentsQuartier()

  let monde: Monde | null = null
  let libere = false
  let W = 1
  let H = 1
  let dpr = 1
  let gauche = 0
  let z = 1
  let zv = 1
  let vx = LARGEUR / 2
  let vy = HAUTEUR / 2
  let sx = 0
  let sy = 0
  let esc = 1
  let e0 = 1
  let ax = 0
  let cible: RectQuartier | null = null
  let sous: ObjetCoupe | null = null
  let dernier = -1
  const lumieres = new Map<string, number>()
  let agents: readonly AgentQuartier[] = lireAgentsQuartier()
  const desabonner = abonnerAgentsQuartier(() => {
    agents = lireAgentsQuartier()
  })

  /** Le cadrage au repos : calé sur la largeur de l'Accueil, posé en bas. */
  const cadrer = (): void => {
    ax = gauche * dpr
    const Wc = Math.max(1, W - ax)
    e0 = Math.max(Wc / LARGEUR, H / 1040)
  }

  const versPeinture = (cx: number, cy: number): [number, number] => [
    (cx * dpr - ax) / esc + sx,
    (cy * dpr) / esc + sy
  ]
  const versFenetre = (o: RectQuartier): RectQuartier => ({
    x: ((o.x - sx) * esc + ax) / dpr,
    y: ((o.y - sy) * esc) / dpr,
    w: (o.w * esc) / dpr,
    h: (o.h * esc) / dpr
  })

  function touche(px: number, py: number): ObjetCoupe | null {
    const OB = monde?.OB ?? []
    for (let i = OB.length - 1; i >= 0; i--) {
      const o = OB[i]
      if (
        !o.nom ||
        !o.hit ||
        px < o.x - 4 ||
        py < o.y - 4 ||
        px >= o.x + o.w + 4 ||
        py >= o.y + o.h + 4
      )
        continue
      // Un peu de tolérance : un pilier de torii fait 8 px, il doit rester facile à viser.
      const a = o.hit
      for (const [e, f] of [
        [0, 0],
        [4, 0],
        [-4, 0],
        [0, 4],
        [0, -4]
      ]) {
        const u = Math.floor(px + e - o.x)
        const v = Math.floor(py + f - o.y)
        if (
          u >= 0 &&
          v >= 0 &&
          u < a.width &&
          v < a.height &&
          a.data[(v * a.width + u) * 4 + 3] > 96
        )
          return o
      }
    }
    return null
  }

  function tanukiSous(px: number, py: number): Tanuki | null {
    const T = monde?.m.T ?? []
    let best: Tanuki | null = null
    for (const w of T) {
      if (Math.abs(px - w.x) > w.u * 0.34 || py > w.y + 5 || py < w.y - w.u * 1.05) continue
      if (!best || w.y > best.y) best = w
    }
    return best
  }

  const pilote: PiloteQuartier = {
    cibleSous(cx, cy) {
      if (!monde || cible) return null
      const [px, py] = versPeinture(cx, cy)
      const w = tanukiSous(px, py)
      if (w) {
        const a = agents.find((q) => q.id === w.id)
        return {
          type: 'agent',
          id: w.id,
          titre: a?.titre ?? '',
          rect: { x: w.x - w.u * 0.4, y: w.y - w.u, w: w.u * 0.8, h: w.u }
        }
      }
      const o = touche(px, py)
      if (!o?.cle) return null
      const rect = { x: o.x, y: o.y, w: o.w, h: o.h }
      const widget = widgetDeLaTour(o.cle)
      if (widget) return { type: 'tour', cle: o.cle, widget, rect }
      const destination = DESTINATIONS[o.cle]
      return destination ? { type: 'vue', cle: o.cle, destination, rect } : null
    },
    survoler(c) {
      sous = c && c.type !== 'agent' ? (monde?.OB.find((o) => o.cle === c.cle) ?? null) : null
    },
    zoomerSur(c) {
      cible = c.rect
      z = Math.min(3, 760 / Math.max(c.rect.w, c.rect.h * 1.75))
      sous = null
      return new Promise((r) => setTimeout(r, ZOOM_MS))
    },
    frapperGong(avecSon) {
      monde?.vie.frapper(avecSon ? jouerGong : () => undefined)
    },
    rectDeLaTour(widget: HomeWidgetId) {
      const o = monde?.OB.find((q) => q.cle === TOUR_DU_WIDGET[widget])
      return o ? versFenetre({ x: o.x, y: o.y, w: o.w, h: o.h }) : null
    },
    poserCadre(g) {
      gauche = Math.max(0, g)
      cadrer()
    }
  }
  brancherQuartier(pilote)

  /** Aligne les tanukis sur les vrais agents : un arrivant entre, celui qui n'a plus de fil repart. */
  function synchroniser(): void {
    if (!monde) return
    const { m } = monde
    const maintenant = Date.now()
    for (const a of agents) {
      const consigne = consigneDe(a, maintenant)
      const w = m.T.find((q) => q.id === a.id)
      if (w) w.consigne = consigne
      else m.ajouter(a.id, consigne)
    }
    for (const w of m.T)
      if (!agents.some((a) => a.id === w.id)) w.consigne = { metier: null, pose: '', partir: true }
  }

  const cellule = (M: Monde, w: Tanuki): { c: number; r: number; m: number } => {
    if (w.etat === 'etat') {
      const g = M.D.gestes[w.nom]
      return { c: Math.floor((w.th * g.n) / g.d) % g.n, r: g.r, m: w.mir }
    }
    if (w.etat === 'poste' && w.face?.g) {
      const g = M.D.gestes[w.face.g]
      return { c: Math.floor((w.th * g.n) / g.d) % g.n, r: g.r, m: w.face.m || 0 }
    }
    const a = ((w.ang % 360) + 360) % 360
    const s = Math.round(a / 45) % 8
    const m = s > 4 ? 1 : 0
    const r = m ? 8 - s : s
    return {
      c: w.etat === 'attend' || w.pause ? 8 : Math.floor((((w.ph % 1) + 1) % 1) * 8),
      r,
      m
    }
  }

  function sprite(M: Monde, w: Tanuki, atlas: HTMLCanvasElement, ombre: boolean): void {
    const { an } = M.D
    const k = w.u / an.pu
    const cl = cellule(M, w)
    x.save()
    // Au bain, tout ce qui passe sous le bord du baquet est dans l'eau.
    if (w.nom === 'ba' && w.face?.cl) {
      x.beginPath()
      x.rect(w.x - 90, w.y - 160, 180, w.face.cl - w.y + 160)
      x.clip()
    }
    x.translate(w.x, w.y - (ombre ? 0 : w.lev))
    if (ombre) x.transform(1, 0, 0.46, -0.2, 0, 0)
    x.scale(cl.m ? -k : k, k)
    x.drawImage(atlas, cl.c * an.cw, cl.r * an.ch, an.cw, an.ch, -an.ax, -an.ay, an.cw, an.ch)
    x.restore()
  }

  function dessinerOmbre(M: Monde, w: Tanuki): void {
    if (w.nom === 'ba') return
    const r = w.u * 0.3
    const sol = M.sols.find((q) => M.m.dans(q.n.p, w.x, w.y))
    x.save()
    if (sol && !sol.n.e) x.clip(sol.P)
    x.globalAlpha = 0.55 * w.alpha
    x.drawImage(M.contact, w.x - r, w.y - r * 0.46, r * 2, r * 0.92)
    // Sur une marche, l'ombre portée tomberait dans le vide : on ne garde que le contact.
    if (w.sur < 0) {
      x.globalAlpha = 0.27 * w.alpha
      sprite(M, w, M.AO, true)
    }
    x.restore()
  }

  function peint(o: ObjetCoupe): void {
    if (!o.cal) {
      x.drawImage(o.k, o.x, o.y, o.w, o.h)
      return
    }
    const c = o.cal
    const bx = c.bx ?? 0
    const by = c.by ?? 0
    x.save()
    x.translate(bx, by)
    x.rotate(o.rot ?? 0)
    x.drawImage(c.i, c.x - bx, c.y - by, c.w, c.h)
    x.restore()
  }

  function tanukis(M: Monde): void {
    for (const w of [...M.m.T].sort((a, b) => a.y - b.y)) {
      dessinerOmbre(M, w)
      x.globalAlpha = w.alpha
      sprite(M, w, M.A, false)
      x.globalAlpha = 1
      // Tout objet dont le pied est plus près que le sien passe devant lui, entier.
      for (const o of M.OB)
        if (o.fixe !== 'ciel' && o.b && couvre(o, w) && w.y < pied(o, w.x) - 1) peint(o)
    }
  }

  /** D5 : deux signaux seulement tranchent dans la scène : l'or (t'attend), le rouge (planté). */
  function signaux(M: Monde): void {
    const t = M.vie.temps()
    x.globalCompositeOperation = 'lighter'
    for (const w of M.m.T) {
      if (w.nom !== 'at' && w.nom !== 'pl') continue
      const v = 0.5 + 0.5 * Math.sin(t * 3 + w.x)
      const r = w.u * (0.34 + v * 0.06)
      if (w.nom === 'at') {
        const m = w.mir ? 1 : -1
        x.globalAlpha = 0.16 + 0.2 * v
        x.drawImage(M.vie.rondO, w.x + m * w.u * 0.13 - r, w.y - w.u * 1.08 - r, r * 2, r * 2)
      } else {
        x.globalAlpha = 0.2 + 0.16 * v
        x.drawImage(M.vie.rondR, w.x - r * 1.3, w.y - w.u * 0.45 - r, r * 2.6, r * 2)
      }
    }
    x.globalAlpha = 1
    x.globalCompositeOperation = 'source-over'
  }

  /** D19 et D20 : le nom du fil au-dessus de la tête ; dans la foule, seuls l'or et le rouge le gardent. */
  function etiquettes(M: Monde): void {
    const T = M.m.T
    const foule = T.length > 8
    const px = (11 * dpr) / esc
    const marge = (5 * dpr) / esc
    const ht = (18 * dpr) / esc
    x.font = `600 ${px}px system-ui, sans-serif`
    x.textAlign = 'center'
    x.textBaseline = 'middle'
    // Deux tanukis côte à côte : la seconde étiquette monte d'un cran au lieu de couvrir la première.
    const posees: { g: number; d: number; y: number }[] = []
    for (const w of [...T].sort((a, b) => b.y - a.y)) {
      if (foule && w.nom !== 'at' && w.nom !== 'pl') continue
      const a = agents.find((q) => q.id === w.id)
      const t = a ? etiquetteDuFil(a.titre) : ''
      if (!t) continue
      const l = x.measureText(t).width + marge * 2
      let cy = w.y - w.u * (w.nom === 'at' ? 1.42 : 1.1) - w.lev
      const g = w.x - l / 2
      const d = w.x + l / 2
      for (let essai = 0; essai < 6; essai++) {
        const y = cy
        if (!posees.some((p) => g < p.d && d > p.g && Math.abs(p.y - y) < ht + 1)) break
        cy -= ht + 2
      }
      posees.push({ g, d, y: cy })
      x.globalAlpha = 0.92 * w.alpha
      x.fillStyle =
        w.nom === 'at'
          ? '#8a5d0a' // couleur-fixe: l'or de la mascotte, « t'attend »
          : w.nom === 'pl'
            ? '#8e241c' // couleur-fixe: le rouge de la mascotte, « planté »
            : 'rgba(24,18,12,.8)' // couleur-fixe: étiquette posée sur la peinture
      x.beginPath()
      x.roundRect(w.x - l / 2, cy - ht / 2, l, ht, marge)
      x.fill()
      x.fillStyle = '#ffffff' // couleur-fixe: texte d'une étiquette sur la peinture
      x.fillText(t, w.x, cy + px * 0.05)
    }
    x.globalAlpha = 1
  }

  /** La tour dont le widget est dehors reste allumée : elle s'éveille doucement, une fois sortie. */
  function tours(M: Monde, dt: number): void {
    const sorties = lireTuilesSorties()
    for (const id of HOME_WIDGET_IDS) {
      const cle = TOUR_DU_WIDGET[id]
      const o = M.OB.find((q) => q.cle === cle)
      if (!o?.lueur) continue
      const voulu = sorties.has(id) ? 1 : 0
      const l = lumieres.get(cle) ?? 0
      const n = l + (voulu - l) * Math.min(1, dt * (voulu ? 2.2 : 5))
      lumieres.set(cle, n)
      if (n < 0.02) continue
      const pouls = 0.9 + 0.1 * Math.sin(M.vie.temps() * 2.2)
      x.save()
      x.globalCompositeOperation = 'lighter'
      x.globalAlpha = 0.6 * n * pouls
      x.drawImage(o.lueur, o.x - 26, o.y - 26, o.w + 52, o.h + 52)
      x.globalAlpha = 0.13 * n
      x.drawImage(o.k, o.x, o.y, o.w, o.h)
      x.restore()
    }
  }

  function halo(o: ObjetCoupe): void {
    x.save()
    x.shadowColor = 'rgba(255,214,110,.95)' // couleur-fixe: contour d'un objet survolé sur la peinture
    x.shadowBlur = 11 * esc
    for (let i = 0; i < 2; i++) x.drawImage(o.k, o.x, o.y, o.w, o.h)
    x.restore()
  }

  function dessin(M: Monde, dt: number): void {
    const vw0 = (W - ax) / e0
    const vh0 = H / e0
    const sx0 = (LARGEUR - vw0) / 2
    const sy0 = HAUTEUR - vh0
    const vw = vw0 / zv
    const vh = vh0 / zv
    const m = Math.min(1, (zv - 1) / 0.4)
    const cx0 = sx0 + vw0 / 2
    const cy0 = sy0 + vh0 / 2
    const tx = cible ? cible.x + cible.w / 2 : cx0
    const ty = cible ? cible.y + cible.h / 2 : cy0
    const pas = 1 - Math.exp(-dt * 7)
    vx += (cx0 + (tx - cx0) * m - vx) * pas
    vy += (cy0 + (ty - cy0) * m - vy) * pas
    sx = Math.max(Math.min(0, sx0), Math.min(LARGEUR - vw, vx - vw / 2))
    sy = Math.max(Math.min(0, sy0), Math.min(HAUTEUR - vh, vy - vh / 2))
    esc = e0 * zv
    const { F, S } = M
    x.setTransform(esc, 0, 0, esc, ax - sx * esc, -sy * esc)
    x.imageSmoothingQuality = 'high'
    // Au-dessus de la peinture, le haut du ciel se prolonge ; sous le menu, un reflet de la peinture.
    const gaucheMonde = sx - ax / esc
    if (sy < 0 || gaucheMonde < 0) {
      const haut = Math.min(0, sy)
      x.drawImage(
        F,
        0,
        0,
        F.naturalWidth,
        3 * S,
        gaucheMonde,
        haut - 2,
        LARGEUR - gaucheMonde,
        3 - haut + 2
      )
    }
    if (gaucheMonde < 0) {
      x.save()
      x.scale(-1, 1)
      x.drawImage(F, 0, 0, -gaucheMonde * S, HAUTEUR * S, 0, 0, -gaucheMonde, HAUTEUR)
      x.restore()
    }
    x.drawImage(F, 0, 0, LARGEUR, HAUTEUR)
    M.vie.ciel(x)
    tours(M, dt)
    M.vie.eau(x)
    M.vie.pieces(x)
    M.vie.feuillages(x, false)
    for (const o of M.OB) if (o.cal) peint(o)
    tanukis(M)
    M.vie.feuillages(x, true)
    signaux(M)
    M.vie.airs(x)
    if (sous) {
      halo(sous)
      if (sous.cle === 'settings' || sous.cle === 'task') M.vie.pieces(x)
      // Le halo repeint la zone d'après la peinture, où le gong n'est pas : il repasse devant.
      if (sous.cle === 'task') {
        for (const o of M.OB) if (o.n === 'gong') peint(o)
        M.vie.maillet(x)
      }
    }
    etiquettes(M)
    x.setTransform(1, 0, 0, 1, 0, 0)
  }

  void charger()
    .then((M) => {
      if (libere) return
      monde = M
      synchroniser()
      canvas.style.opacity = '1'
    })
    .catch(() => {
      // Un décor n'est pas une dépendance de la fonction : sans images, l'Accueil reste utilisable.
    })

  return {
    canvas,
    render(elapsed) {
      const M = monde
      if (!M) return
      const ecart = dernier < 0 ? 0 : elapsed - dernier
      dernier = elapsed
      // Au repos, l'app dessine 15 images par seconde : deux pas par image, pour que le temps du
      // Quartier reste l'horloge réelle, sans un pas assez long pour traverser un mur.
      const dt = Math.max(0, Math.min(0.1, ecart))
      // De retour d'une vue : le zoom se défait sous les yeux, comme il s'était fait (D-11).
      if (ecart > 0.5 && cible) {
        cible = null
        z = 1
      }
      synchroniser()
      const pas = dt > 0.05 ? 2 : 1
      for (let i = 0; i < pas; i++) M.m.avance(dt / pas)
      const m = M.m
      M.vie.avancer(
        dt,
        (...p) => m.T.some((w) => w.etat === 'poste' && p.includes(w.poste as number)),
        m.T
      )
      zv += (z - zv) * Math.min(1, dt * 4.2)
      dessin(M, dt)
    },
    resize(w, h) {
      const ratio = Math.min(2, window.devicePixelRatio || 1)
      dpr = Math.min(ratio, Math.sqrt(PIXELS_MAX / Math.max(1, w * h)))
      W = Math.max(1, Math.round(w * dpr))
      H = Math.max(1, Math.round(h * dpr))
      canvas.width = W
      canvas.height = H
      const accueil = document.querySelector('.home-view')?.getBoundingClientRect()
      if (accueil && accueil.width > 0) gauche = accueil.left
      cadrer()
    },
    dispose() {
      libere = true
      desabonner()
      debrancherQuartier(pilote)
    }
  }
}
