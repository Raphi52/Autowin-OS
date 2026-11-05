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
 * LES OBJETS ont chacun leur image, posée sur la peinture au chargement (`quartier-calques.ts`, conv-1534),
 * et repeinte par-dessus un tanuki quand ils sont devant lui.
 * Chacun a sa ligne de pied : c'est elle, et pas la profondeur, qui décide qui passe devant.
 */
import {
  creerRobotDeLAtelier,
  dessinerEtabli,
  dessinerOutil,
  type PoseAtelier
} from './quartier-atelier'
import urlFalaise from '../assets/quartier/falaise.avif'
import urlDerriere from '../assets/quartier/falaise-derriere.webp'
import urlAtlas from '../assets/quartier/atlas.avif'
import urlAtlasRenard from '../assets/quartier/atlas-renard.avif'
import urlAtlasPanda from '../assets/quartier/atlas-panda.avif'
import urlAtlasPandaRoux from '../assets/quartier/atlas-panda-roux.avif'
import urlBords from '../assets/quartier/bords.avif'
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
  abonnerAgentsCollegues,
  animalDeLAgent,
  consigneDuCollegue,
  lireAgentsCollegues,
  type AgentCollegue
} from './agents-collegues'
import { abonnerMonAnimal, lireMonAnimal } from './mon-animal'
import type { AnimalAgent } from '../../../shared/quartier-presence'
import {
  creerMarche,
  estPlante,
  type DonneesMarche,
  type Geste,
  type MarcheQuartier,
  type Tanuki
} from './quartier-marche'
import {
  brancherQuartier,
  debrancherQuartier,
  type PiloteQuartier,
  type RectQuartier
} from './quartier-pont'
import {
  echelleMin,
  finesseDePlanche,
  niveauPourEchelle,
  niveauxDePlanche,
  type NiveauPlanche
} from './quartier-planche'
import { adresseBatiment, composerFalaise, nomDuBatiment } from './quartier-calques'
import { jouerGong } from './quartier-son'
import { lireTuilesSorties, TOUR_DU_WIDGET, widgetDeLaTour } from './quartier-tuiles'
import { contexte, creerVie, image, toile, type VieDecor } from './quartier-vie'
import { bornerVue, MARGE_BORD, rapprocherZoom, zoomSur } from './quartier-zoom'

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
  /** Ce que la souris touche, quand ce n'est pas ce qui est découpé : la roue tourne à part de son mât. */
  mh?: string
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

interface Sprite {
  m: string
  w: number
  h: number
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
  gestes: Record<string, Geste>
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
    /** Les fenêtres des tours, relevées sur la peinture : x, y, largeur, hauteur. */
    fenetres: [number, number, number, number][]
    /** Les petits objets qui bougent, peints comme le reste de la maquette. */
    sprites: Record<'ballon' | 'bateau1' | 'bateau2' | 'bateau3' | 'tram', Sprite>
  }
}

/**
 * Un atlas prêt à dessiner : l'image filtrée, sa silhouette d'ombre, et le cou de chaque case, mesuré une
 * fois au premier foulard. Le cou dépend de la silhouette : celui du renard n'est pas celui du tanuki.
 */
interface AtlasPeint {
  A: HTMLCanvasElement
  AO: HTMLCanvasElement
  /** L'original puis sa moitié, son quart, son huitième : de quoi dessiner sans réduction à refaire (conv-1526). */
  niveaux: NiveauPlanche[]
  parts: number[]
  /** Le niveau aux cases de `donnees.json` (126 × 170) : le foulard s'y mesure et s'y découpe (conv-1558). */
  base: NiveauPlanche
  cous: Float32Array | null
  colonnes: number
}

interface Monde {
  D: DonneesQuartier
  /** La Falaise composée de ses calques : peinture, fond derrière les bâtiments, bâtiments (conv-1534). */
  F: HTMLCanvasElement
  /** La peinture prolongée à gauche puis à droite, `MARGE_BORD` de large chacune (conv-1424). */
  B: HTMLImageElement
  S: number
  /**
   * Un atlas par animal, de même grille que celui du tanuki (conv-1446) : mes agents prennent celui
   * choisi dans les réglages de l'Accueil, ceux d'un collègue celui qu'il a choisi (conv-1537).
   */
  animaux: Record<AnimalAgent, AtlasPeint>
  OB: ObjetCoupe[]
  FE: ObjetCoupe[]
  m: MarcheQuartier
  vie: VieDecor & { rond: HTMLCanvasElement; rondO: HTMLCanvasElement; rondR: HTMLCanvasElement }
  contact: HTMLCanvasElement
  sols: { n: DonneesMarche['niv'][number]; P: Path2D }[]
}

async function coupe(F: HTMLCanvasElement, S: number, o: ObjetDonnee): Promise<ObjetCoupe> {
  const i = await image(o.m)
  const k = toile(o.w * S, o.h * S)
  const g = contexte(k)
  g.drawImage(i, 0, 0, k.width, k.height)
  let hit: ImageData | null = null
  if (o.nom) {
    // À la taille de la peinture, pas de l'image agrandie : la souris n'a pas besoin de plus.
    const c = toile(o.w, o.h)
    const gh = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
    gh.drawImage(o.mh ? await image(o.mh) : i, 0, 0, o.w, o.h)
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

/** Les filtres de toile coûtent cher à chaque image : on les applique UNE fois, à l'atlas entier. */
function peindreAtlas(atlas: HTMLImageElement, an: { cw: number; ch: number }): AtlasPeint {
  // Le tanuki v3 est rendu en ×2 (conv-1558) : ses niveaux partent de ses cases de 252 × 340, et le
  // flou de l'ombre double avec lui pour rester le même une fois réduit.
  const f = finesseDePlanche(atlas.naturalWidth, an.cw)
  const A = toile(atlas.naturalWidth, atlas.naturalHeight)
  const gA = contexte(A)
  gA.filter = 'saturate(1.06)'
  gA.drawImage(atlas, 0, 0)
  const AO = toile(atlas.naturalWidth, atlas.naturalHeight)
  const gO = contexte(AO)
  gO.filter = `brightness(0) blur(${2 * f}px)`
  gO.drawImage(atlas, 0, 0)
  const niveaux = niveauxDePlanche(A, AO, an.cw * f, an.ch * f)
  const base = niveaux.find((n) => n.cw === an.cw && n.ch === an.ch) ?? niveaux[0]
  return { A, AO, niveaux, parts: niveaux.map((n) => n.cw / an.cw), base, cous: null, colonnes: 0 }
}

async function charger(): Promise<Monde> {
  const module = await import('../assets/quartier/donnees.json')
  const D = (module.default ?? module) as unknown as DonneesQuartier
  const [peinture, derriere, batiments, atlas, renard, panda, pandaRoux, B] = await Promise.all([
    image(urlFalaise),
    image(urlDerriere),
    Promise.all(D.obj.map((o) => image(adresseBatiment(nomDuBatiment(o))))),
    image(urlAtlas),
    image(urlAtlasRenard),
    image(urlAtlasPanda),
    image(urlAtlasPandaRoux),
    image(urlBords)
  ])
  const S = peinture.naturalWidth / LARGEUR
  const F = composerFalaise(peinture, derriere, D.obj, batiments, S)
  const animaux: Record<AnimalAgent, AtlasPeint> = {
    tanuki: peindreAtlas(atlas, D.an),
    renard: peindreAtlas(renard, D.an),
    panda: peindreAtlas(panda, D.an),
    'panda-roux': peindreAtlas(pandaRoux, D.an)
  }
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
  return { D, F, B, S, animaux, OB, FE, m: creerMarche(D), vie, contact, sols }
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

/** La part de la hauteur du corps où tombe le cou : mesurée sur le foulard peint des cases de face (0,52 à 0,59). */
const COU = 0.56

/**
 * Le cou de chaque case de l'atlas (conv-1429) : `[x, y, demi-largeur]` en pixels de la case, `NaN` pour
 * une case vide. Le foulard peint n'est visible que de face — aucun pixel de dos, en méditation ni au
 * sabre, mesuré sur l'atlas : on le place donc d'après la silhouette, à `COU` de sa hauteur, au milieu de
 * la plus longue bande opaque (la queue, vue de profil, en est séparée).
 */
export function cousDeLAtlas(
  rgba: Uint8ClampedArray,
  largeur: number,
  cw: number,
  ch: number,
  colonnes: number,
  rangees: number
): Float32Array {
  const cous = new Float32Array(colonnes * rangees * 3).fill(NaN)
  const opaque = (px: number, py: number): boolean => rgba[(py * largeur + px) * 4 + 3] > 128
  const ligneOpaque = (x0: number, py: number): boolean => {
    for (let u = 0; u < cw; u++) if (opaque(x0 + u, py)) return true
    return false
  }
  for (let r = 0; r < rangees; r++)
    for (let c = 0; c < colonnes; c++) {
      const x0 = c * cw
      const y0 = r * ch
      let haut = 0
      while (haut < ch && !ligneOpaque(x0, y0 + haut)) haut++
      if (haut >= ch) continue
      let bas = ch - 1
      while (bas > haut && !ligneOpaque(x0, y0 + bas)) bas--
      const y = Math.round(haut + (bas - haut) * COU)
      let meilleur = 0
      let debut = 0
      let suite = 0
      for (let u = 0; u <= cw; u++) {
        if (u < cw && opaque(x0 + u, y0 + y)) suite++
        else {
          if (suite > meilleur) {
            meilleur = suite
            debut = u - suite
          }
          suite = 0
        }
      }
      if (!meilleur) continue
      const i = (r * colonnes + c) * 3
      cous[i] = debut + meilleur / 2
      cous[i + 1] = y
      cous[i + 2] = meilleur / 2
    }
  return cous
}

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
  /** Le grand robot du hangar, nourri par les coups des agents au poste des runs (conv-1453). */
  const robot = creerRobotDeLAtelier()
  let forgent: PoseAtelier[] = []
  let agents: readonly AgentQuartier[] = lireAgentsQuartier()
  const desabonner = abonnerAgentsQuartier(() => {
    agents = lireAgentsQuartier()
  })
  // Les agents des collègues vivent dans le même quartier (D-10, conv-1429) ; le bouton « Mes agents »
  // vide cette liste, et leurs tanukis repartent comme ceux dont le fil s'est fermé.
  let collegues: readonly AgentCollegue[] = lireAgentsCollegues()
  const desabonnerCollegues = abonnerAgentsCollegues(() => {
    collegues = lireAgentsCollegues()
  })
  // L'animal de MES agents (conv-1537), lu à chaque image : un nouveau choix les redessine aussitôt.
  let monAnimal: AnimalAgent = lireMonAnimal()
  const desabonnerMonAnimal = abonnerMonAnimal(() => {
    monAnimal = lireMonAnimal()
  })
  /**
   * L'animal d'un tanuki de collègue (conv-1446). Comme son foulard, il reste sur le tanuki et non sur
   * l'agent : en repartant, son agent a déjà quitté la liste, et il ne doit pas redevenir tanuki en route.
   */
  const animalDuTanuki = new WeakMap<Tanuki, AnimalAgent>()
  const atlasDe = (M: Monde, w: Tanuki): AtlasPeint => M.animaux[animalDuTanuki.get(w) ?? monAnimal]
  const etoffe = toile(1, 1)

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
        const a = agents.find((q) => q.id === w.id) ?? collegues.find((q) => q.id === w.id)
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
      // La vue au repos, en pixels de scène : l'élément la remplit presque (conv-1424).
      z = zoomSur(c.rect, Math.max(1, W - ax) / e0, H / e0)
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
    // Ceux des collègues : mêmes lieux selon le métier et la phase (D-8), un foulard à leur couleur (D9),
    // dessinés avec l'atlas de leur animal (conv-1446).
    for (const a of collegues) {
      const consigne = consigneDuCollegue(a, maintenant)
      const w = m.T.find((q) => q.id === a.id)
      if (w) w.consigne = consigne
      else {
        const nouveau = m.ajouter(a.id, consigne, a.collegue.couleur)
        const animal = animalDeLAgent(a)
        if (animal) animalDuTanuki.set(nouveau, animal)
      }
    }
    for (const w of m.T)
      if (!agents.some((a) => a.id === w.id) && !collegues.some((a) => a.id === w.id))
        w.consigne = { metier: null, pose: '', partir: true }
  }

  /** La case de l'atlas à dessiner ; `f` fond l'image suivante par-dessus, `dx` recale une case décalée. */
  const cellule = (
    M: Monde,
    w: Tanuki
  ): { c: number; r: number; m: number; f?: number; n?: number; dx?: number } => {
    if (w.etat === 'etat') {
      const g = M.D.gestes[w.nom]
      return { c: Math.floor((w.th * g.n) / g.d) % g.n, r: g.r, m: w.mir }
    }
    if ((w.etat === 'poste' || w.etat === 'leve') && w.face?.g) {
      const g = M.D.gestes[w.face.g]
      const m = w.face.m || 0
      const e = g.e
      // S'asseoir en arrivant, se relever en partant : les mêmes images, dans un sens puis dans l'autre.
      if (e && w.etat === 'leve') {
        const k = Math.max(0, 1 - w.th / e.d)
        return { c: Math.min(e.n - 1, Math.round(k * (e.n - 1))), r: e.r, m }
      }
      if (e && w.th < e.d)
        return { c: Math.min(e.n - 1, Math.floor((w.th * e.n) / e.d)), r: e.r, m }
      const q = ((w.th - (e?.d ?? 0)) * g.n) / g.d
      const c = Math.floor(q) % g.n
      return { c, r: g.r, m, f: g.fondu ? q - Math.floor(q) : 0, n: g.n, dx: g.dx ?? 0 }
    }
    const a = ((w.ang % 360) + 360) % 360
    const s = Math.round(a / 45) % 8
    const m = s > 4 ? 1 : 0
    const r = m ? 8 - s : s
    return {
      // Debout : à l'arrêt, et quand il se tourne vers sa place avant de s'asseoir.
      c:
        w.etat === 'attend' || w.etat === 'tourne' || w.pause
          ? 8
          : Math.floor((((w.ph % 1) + 1) % 1) * 8),
      r,
      m
    }
  }

  function sprite(M: Monde, w: Tanuki, ombre: boolean): void {
    const { an } = M.D
    const k = w.u / an.pu
    const cl = cellule(M, w)
    const planche = atlasDe(M, w)
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
    const ox = -an.ax + (cl.dx ?? 0)
    // Rétréci, il est lu dans la réduction de sa taille, en « low » : en « high », la carte graphique
    // refaisait les réductions de toute la planche à chaque dessin — 3,4 images/s au lieu de 32 (conv-1526).
    // Agrandi (zoom), l'original garde le lissage de la scène.
    const e = echelleMin(x.getTransform())
    const n = planche.niveaux[niveauPourEchelle(e, planche.parts)]
    const atlas = ombre ? n.AO : n.A
    const qualite = x.imageSmoothingQuality
    const lire = (c: number): void => {
      if (e < 1) x.imageSmoothingQuality = 'low'
      x.drawImage(atlas, c * n.cw, cl.r * n.ch, n.cw, n.ch, ox, -an.ay, an.cw, an.ch)
      x.imageSmoothingQuality = qualite
    }
    lire(cl.c)
    // Le foulard reste peint sur la case d'origine : sa petite toile ne coûte rien (mesuré, conv-1526).
    if (!ombre && w.foulard) poserFoulard(M, planche, w.foulard, cl.c, cl.r, ox)
    // Une respiration de douze images en six secondes : l'image suivante se fond par-dessus, sans à-coup.
    if (!ombre && cl.f && cl.n) {
      const a = x.globalAlpha
      x.globalAlpha = a * cl.f
      lire((cl.c + 1) % cl.n)
      x.globalAlpha = a
    }
    x.restore()
  }

  /**
   * Le foulard d'un collègue (D9, conv-1429) : une écharpe à sa couleur, découpée sur la silhouette de
   * l'image en cours, à hauteur du cou. Posé dans le repère du personnage, il suit le miroir, le pas et
   * la marche sans calcul de plus. Trois gestes sur une petite toile : 15 collègues au plus, c'est peu.
   * Le cou et la découpe viennent de l'atlas de SON animal (conv-1446).
   */
  function poserFoulard(
    M: Monde,
    P: AtlasPeint,
    couleur: string,
    c: number,
    r: number,
    ox: number
  ): void {
    const { an } = M.D
    const B = P.base.A
    if (!P.cous) {
      P.colonnes = Math.floor(B.width / an.cw)
      const rangees = Math.floor(B.height / an.ch)
      const rgba = contexte(B).getImageData(0, 0, B.width, B.height).data
      P.cous = cousDeLAtlas(rgba, B.width, an.cw, an.ch, P.colonnes, rangees)
    }
    const cous = P.cous
    const i = (r * P.colonnes + c) * 3
    const cx = cous[i]
    if (!Number.isFinite(cx)) return
    const cy = cous[i + 1]
    const rx = Math.max(9, Math.min(20, cous[i + 2] * 0.8))
    const ry = 7.5
    if (etoffe.width !== an.cw || etoffe.height !== an.ch) {
      etoffe.width = an.cw
      etoffe.height = an.ch
    }
    const g = contexte(etoffe)
    g.globalCompositeOperation = 'source-over'
    g.clearRect(0, 0, an.cw, an.ch)
    g.fillStyle = couleur
    g.beginPath()
    g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
    g.fill()
    // La pointe, sous le menton : c'est elle qui le fait lire comme un foulard, et non comme un col.
    g.beginPath()
    g.moveTo(cx - rx * 0.45, cy + ry * 0.4)
    g.lineTo(cx + rx * 0.45, cy + ry * 0.4)
    g.lineTo(cx, cy + ry * 2.1)
    g.closePath()
    g.fill()
    // Un reflet en haut, un pli d'ombre en bas : un aplat de couleur se lirait comme un autocollant.
    const d = g.createLinearGradient(0, cy - ry, 0, cy + ry * 2.1)
    d.addColorStop(0, 'rgba(255,255,255,.2)') // couleur-fixe: reflet du foulard peint sur le décor
    d.addColorStop(0.45, 'rgba(0,0,0,0)') // couleur-fixe: milieu du foulard peint sur le décor
    d.addColorStop(1, 'rgba(0,0,0,.34)') // couleur-fixe: pli d'ombre du foulard peint sur le décor
    g.globalCompositeOperation = 'source-atop'
    g.fillStyle = d
    g.fillRect(0, cy - ry, an.cw, ry * 3.2)
    g.globalCompositeOperation = 'destination-in'
    g.drawImage(B, c * an.cw, r * an.ch, an.cw, an.ch, 0, 0, an.cw, an.ch)
    x.drawImage(etoffe, ox, -an.ay, an.cw, an.ch)
  }

  function dessinerOmbre(M: Monde, w: Tanuki): void {
    if (w.nom === 'ba') return
    const r = w.u * 0.3
    const sol = M.sols.find((q) => M.m.dans(q.n.p, w.x, w.y))
    x.save()
    if (sol && !sol.n.e) x.clip(sol.P)
    x.globalAlpha = 0.55 * w.alpha
    x.drawImage(M.contact, w.x - r, w.y - r * 0.46, r * 2, r * 0.92)
    // Sur une marche, ou assis au bord les jambes dans le vide, l'ombre portée tomberait dans le vide :
    // on ne garde que le contact.
    if (w.sur < 0 && !(w.face?.g === 'bo' && w.etat !== 'va')) {
      x.globalAlpha = 0.27 * w.alpha
      sprite(M, w, true)
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

  /** La pose d'atelier d'un tanuki assis au poste des runs, ou rien s'il n'y est pas. */
  const poseAtelier = (M: Monde, w: Tanuki): PoseAtelier | null => {
    if (w.etat !== 'poste' || w.poste === null || !w.face?.g) return null
    if (M.D.postes[w.poste]?.me !== 'runs') return null
    const g = M.D.gestes[w.face.g]
    const entree = g.e?.d ?? 0
    if (w.th < entree) return null
    return {
      id: w.id,
      x: w.x,
      y: w.y,
      u: w.u,
      th: w.th - entree,
      sens: w.face.m ? -1 : 1,
      cycle: g.d,
      images: g.n,
      alpha: w.alpha
    }
  }

  function tanukis(M: Monde): void {
    forgent = []
    for (const w of [...M.m.T].sort((a, b) => a.y - b.y)) {
      dessinerOmbre(M, w)
      // Au poste des runs, il forge au lieu de taper dans le vide (conv-1453).
      const atelier = poseAtelier(M, w)
      if (atelier) {
        forgent.push(atelier)
        dessinerEtabli(x, atelier)
      }
      x.globalAlpha = w.alpha
      sprite(M, w, false)
      x.globalAlpha = 1
      if (atelier) dessinerOutil(x, atelier)
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
      // fix-ok: la lueur rouge testait la pose 'pl' (grep : 3 sites, signaux/étiquettes) ; planté = pr, fu ou bi (conv-1554).
      // L'agent d'un collègue n'attend pas après moi : ni or ni rouge (D9, conv-1429).
      if ((w.nom !== 'at' && !estPlante(w.nom)) || w.foulard) continue
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
      if (foule && w.nom !== 'at' && !estPlante(w.nom)) continue
      // Un collègue n'a pas d'étiquette au-dessus de la tête : son prénom et son titre vont au survol (D9).
      if (w.foulard) continue
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
          : estPlante(w.nom)
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

  function halo(M: Monde, o: ObjetCoupe): void {
    x.save()
    x.shadowColor = 'rgba(255,214,110,.95)' // couleur-fixe: contour d'un objet survolé sur la peinture
    x.shadowBlur = 11 * esc
    // La roue n'est pas dans la peinture : sa lueur passe sous le mât, sinon elle le délave, et elle
    // revient nette par-dessus.
    if (o.cle === 'settings') M.vie.roue(x)
    for (let i = 0; i < 2; i++) x.drawImage(o.k, o.x, o.y, o.w, o.h)
    x.restore()
    if (o.cle === 'settings') M.vie.roue(x)
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
    // Zoomée, la vue peut sortir de la peinture par ses bords prolongés : la roue de Settings et la clé du
    // hangar, collées au bord, se centrent comme le reste (conv-1424). Au repos, la marge vaut 0.
    sx = bornerVue(vx, vw, Math.min(0, sx0), LARGEUR, MARGE_BORD * m)
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
        F.width,
        3 * S,
        gaucheMonde,
        haut - 2,
        Math.max(LARGEUR, sx + vw) - gaucheMonde,
        3 - haut + 2
      )
    }
    if (gaucheMonde < 0) {
      x.save()
      x.scale(-1, 1)
      x.drawImage(F, 0, 0, -gaucheMonde * S, HAUTEUR * S, 0, 0, -gaucheMonde, HAUTEUR)
      x.restore()
    }
    // Les bords prolongés : à gauche, ils remplacent peu à peu le reflet à mesure que le zoom s'approche.
    const { B } = M
    const mb = MARGE_BORD
    if (gaucheMonde < 0 && m > 0) {
      x.globalAlpha = m
      x.drawImage(B, 0, 0, mb * S, HAUTEUR * S, -mb, 0, mb, HAUTEUR)
      x.globalAlpha = 1
    }
    // 16 px de tampon séparent les deux bords dans l'image : le lissage y lit sans prendre un filet de l'autre.
    if (sx + vw > LARGEUR)
      x.drawImage(B, mb * S + 16, 0, mb * S, HAUTEUR * S, LARGEUR, 0, mb, HAUTEUR)
    x.drawImage(F, 0, 0, LARGEUR, HAUTEUR)
    M.vie.ciel(x)
    tours(M, dt)
    M.vie.eau(x)
    M.vie.pieces(x)
    M.vie.feuillages(x, false)
    for (const o of M.OB) if (o.cal) peint(o)
    // Le robot s'allume derrière les agents ; il compte leurs coups une fois qu'ils sont dessinés.
    robot.dessiner(x)
    tanukis(M)
    robot.avancer(dt, forgent)
    M.vie.feuillages(x, true)
    signaux(M)
    M.vie.airs(x)
    if (sous) {
      halo(M, sous)
      if (sous.cle === 'task') M.vie.pieces(x)
      // La cloche de la Falaise o-1916 est dans la peinture (conv-1444) : le halo la repeint lui-même, sans
      // gong découpé ni maillet à repasser devant.
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
      zv = rapprocherZoom(zv, z, dt)
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
      desabonnerCollegues()
      desabonnerMonAnimal()
      debrancherQuartier(pilote)
    }
  }
}
