/**
 * LE REFLET DU PIN, REJOUE TEL QUEL — la lumiere qui court sur le bord des blocs encadres du fil
 * (Raisonnement, Actions, Etapes, images, decodage, scene 3D).
 *
 * Le modele est l'anneau d'un bouton de verre, l'epingle Pinterest 941744972113082896 (video de 5 s
 * a 30 images/s, en boucle). Deux essais l'avaient INTERPRETE — une vague diagonale qui traversait
 * les blocs, puis une palette et des franges choisies a la main — et s'en ecartaient (demande du
 * 2026-11-13 : « reproduire a la perfection », puis « t'as des biais par rapport aux trucs que je
 * t'ai dit »). Ici, plus rien n'est interprete : scripts/anneau-du-pin.py a releve l'anneau de
 * chacune des 150 images, degre par degre (texture `anneau-du-pin.webp`), et ce module la repeint
 * le long du bord de chaque bloc, image apres image. Ce que fait la video, le bloc le fait : deux
 * reflets presque fixes a 11 h et 7 h qui respirent, une gerbe de blanc qui part de midi et
 * s'etale vers 4 h avant de retomber, des stries irisees, un anneau jamais tout a fait eteint.
 *
 * LE PASSAGE DU CERCLE AU BLOC : midi = le milieu du bord haut, puis le sens horaire, a pas egaux le
 * long du bord (un degre = 1/360 du tour). Les quatre points cardinaux tombent ainsi au milieu des
 * quatre cotes, quelle que soit la forme du bloc. L'epaisseur suit le pin : son anneau (17 px sur
 * une video de 720) devient le trait de 3 px des blocs, en trois tiers de couleur ; sa lueur, relevee
 * a 1 px de chaque cote, decroit comme sur la video (`DECROISSANCE_*`), sur 10 px dehors et 6 px
 * dedans, puis s'eteint sur ses derniers pixels (la video la laisse filer dans le verre du bouton).
 *
 * POURQUOI UN CANVAS, PEINT PIXEL PAR PIXEL : la texture est une image par instant ; aucun degrade
 * CSS ne suit un bord arrondi a pas egaux. Le cout reste borne : seuls les pixels de la bande du
 * bord sont peints (table precalculee a chaque changement de taille), seulement quand l'image de la
 * video change (30 par seconde, la cadence de la video, au lieu des 60 d'une animation CSS : la
 * fenetre se recompose deux fois moins souvent), et seulement pour les blocs a l'ecran (« les
 * animations sur les blocs dans le chat doivent etre en fonction de la ou je regarde »). Tous les
 * blocs lisent la meme horloge : ils montrent le meme instant de la video.
 */
import urlDeLaTexture from '../assets/anneau-du-pin.webp'

/** Images de la video, et leur cadence. */
export const IMAGES = 150
export const IMAGES_PAR_SECONDE = 30
/** Une colonne de texture par degre. */
export const DEGRES = 360
/** Lignes par image : lueur dedans, anneau (tiers interieur, milieu, exterieur), lueur dehors. */
export const LIGNES = 5
const LUEUR_DEDANS = 0
const ANNEAU_EXTERIEUR = 3
const LUEUR_DEHORS = 4
/** Le trait de l'anneau des blocs, en px CSS (le `padding` de `.cadre-anneau::before`). */
export const EPAISSEUR = 3
/** La lueur deborde de MARGE px hors du bloc : le canvas est plus grand d'autant de chaque cote. */
export const MARGE = 10
/** Profondeur de la lueur dans le bloc, en px. */
export const LUEUR_INTERIEURE = 6

/**
 * Decroissance de la lueur, en px depuis le bord de l'anneau (index = distance), normee a 1 px :
 * moyenne des secteurs allumes des 150 images, imprimee par scripts/anneau-du-pin.py.
 */
export const DECROISSANCE_EXTERIEURE = [
  1.432, 1.0, 0.762, 0.625, 0.53, 0.445, 0.391, 0.347, 0.301, 0.266
] as const
export const DECROISSANCE_INTERIEURE = [1.604, 1.0, 0.756, 0.615, 0.524, 0.448, 0.394] as const

/** L'image de la video a l'instant `ms` de l'horloge du document : la meme pour tous les blocs. */
export function imageA(ms: number): number {
  const duree = (IMAGES * 1000) / IMAGES_PAR_SECONDE
  const t = ((ms % duree) + duree) % duree
  return Math.min(IMAGES - 1, Math.floor((t * IMAGES_PAR_SECONDE) / 1000))
}

/** Une valeur d'une decroissance a la distance `d` (px), lineaire entre deux mesures. */
export function decroissance(table: readonly number[], d: number): number {
  if (d <= 0) return table[0]
  const i = Math.floor(d)
  if (i >= table.length - 1) return table[table.length - 1]
  return table[i] + (table[i + 1] - table[i]) * (d - i)
}

/**
 * Le point d'un rectangle arrondi (l x h, rayon r, origine au coin haut-gauche) vu par le reflet :
 * `tour` = sa place sur le tour (0 = milieu du bord haut, puis sens horaire, 1 = un tour), mesuree
 * sur la ligne MEDIANE du trait ; `distance` = sa distance signee au bord exterieur du bloc (negative
 * dedans), en px.
 */
export function pointDuBord(
  x: number,
  y: number,
  l: number,
  h: number,
  r: number
): { tour: number; distance: number } {
  const rayon = Math.max(0, Math.min(r, l / 2, h / 2))
  const a = l / 2 - rayon
  const b = h / 2 - rayon
  const px = x - l / 2
  const py = y - h / 2
  // Distance au bord : celle d'une boite arrondie (coeur a x b, gonfle de `rayon`).
  const qx = Math.abs(px) - a
  const qy = Math.abs(py) - b
  const distance =
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rayon
  // La ligne mediane du trait : meme centres de coins, rayon diminue d'une demi-epaisseur.
  const arc = (Math.max(0, rayon - EPAISSEUR / 2) * Math.PI) / 2
  const perimetre = 4 * a + 4 * b + 4 * arc
  let vx = px - Math.max(-a, Math.min(a, px))
  let vy = py - Math.max(-b, Math.min(b, py))
  if (vx === 0 && vy === 0) {
    // Dans le coeur (bloc minuscule) : le cote le plus proche.
    const versCotes = [b + py, a - px, b - py, a + px] // haut, droite, bas, gauche
    const i = versCotes.indexOf(Math.min(...versCotes))
    vx = i === 1 ? 1 : i === 3 ? -1 : 0
    vy = i === 0 ? -1 : i === 2 ? 1 : 0
  }
  const cx = Math.max(-a, Math.min(a, px))
  const cy = Math.max(-b, Math.min(b, py))
  const angle = Math.atan2(vy, vx)
  const k = arc / (Math.PI / 2) // longueur d'arc par radian
  let s: number
  if (vx === 0 && vy < 0) s = cx >= 0 ? cx : perimetre + cx
  else if (vy === 0 && vx > 0) s = a + arc + (cy + b)
  else if (vx === 0 && vy > 0) s = a + 2 * arc + 2 * b + (a - cx)
  else if (vy === 0 && vx < 0) s = 3 * a + 3 * arc + 2 * b + (b - cy)
  else if (vx > 0 && vy < 0) s = a + k * (angle + Math.PI / 2)
  else if (vx > 0) s = a + arc + 2 * b + k * angle
  else if (vy > 0) s = 3 * a + 2 * arc + 2 * b + k * (angle - Math.PI / 2)
  else s = 3 * a + 3 * arc + 4 * b + k * (angle + Math.PI)
  const tour = perimetre > 0 ? (((s / perimetre) % 1) + 1) % 1 : 0
  return { tour, distance }
}

/** Une zone du canvas peinte d'un seul `putImageData`, et les pixels du bord qu'elle contient. */
type Zone = {
  x: number
  y: number
  image: ImageData
  /** Par pixel peint : sa place dans `image.data` (octets), son echantillon du tour, ses poids. */
  octet: Uint32Array
  echantillon: Uint32Array
  poidsAnneau: Float32Array
  ligneAnneau: Float32Array
  lueurDehors: Float32Array
  lueurDedans: Float32Array
}

/** La table d'un bloc : ce qui ne change qu'avec sa taille. */
export type TableDuBord = {
  largeur: number
  hauteur: number
  echantillons: number
  zones: Zone[]
}

type FabriqueImage = (largeur: number, hauteur: number) => ImageData

/**
 * Precalcule, pour un canvas de `lc x hc` pixels d'appareil (le bloc l x h en px CSS, plus MARGE de
 * chaque cote, a `dpr` pixels par px), chaque pixel de la bande du bord : sa place sur le tour et
 * ses poids (anneau, lueur dehors, lueur dedans). `lueur` (0 a 1) l'attenue : la scene 3D l'eteint.
 */
export function tableDuBord(
  l: number,
  h: number,
  rayon: number,
  dpr: number,
  lueur: number,
  fabrique: FabriqueImage
): TableDuBord {
  const lc = Math.max(1, Math.round((l + 2 * MARGE) * dpr))
  const hc = Math.max(1, Math.round((h + 2 * MARGE) * dpr))
  const perimetre = 2 * (l + h)
  const echantillons = Math.max(DEGRES, Math.ceil(perimetre * dpr))
  // Quatre bandes le long des bords (le milieu du bloc n'est jamais peint) ; un bloc trop petit
  // pour en avoir un, une seule zone.
  const e = Math.ceil((MARGE + Math.max(rayon, EPAISSEUR + LUEUR_INTERIEURE) + 1) * dpr)
  const rects: [number, number, number, number][] =
    hc > 2 * e && lc > 2 * e
      ? [
          [0, 0, lc, e],
          [0, hc - e, lc, e],
          [0, e, e, hc - 2 * e],
          [lc - e, e, e, hc - 2 * e]
        ]
      : [[0, 0, lc, hc]]
  const zones: Zone[] = []
  for (const [zx, zy, zl, zh] of rects) {
    const octet: number[] = []
    const echantillon: number[] = []
    const poidsAnneau: number[] = []
    const ligneAnneau: number[] = []
    const lueurDehors: number[] = []
    const lueurDedans: number[] = []
    for (let j = 0; j < zh; j++) {
      for (let i = 0; i < zl; i++) {
        const x = (zx + i + 0.5) / dpr - MARGE
        const y = (zy + j + 0.5) / dpr - MARGE
        const { tour, distance } = pointDuBord(x, y, l, h, rayon)
        const profondeur = -distance
        if (distance > MARGE || profondeur > EPAISSEUR + LUEUR_INTERIEURE) continue
        // Part du pixel dans l'anneau (bord lisse a l'echelle du pixel d'appareil).
        const dansLeBord = Math.min(1, Math.max(0, 0.5 - distance * dpr))
        const horsDuCreux = Math.min(1, Math.max(0, 0.5 - (profondeur - EPAISSEUR) * dpr))
        const anneau = dansLeBord * horsDuCreux
        const dehors =
          (1 - dansLeBord) *
          lueur *
          decroissance(DECROISSANCE_EXTERIEURE, distance) *
          Math.min(1, Math.max(0, (MARGE - 0.5 - distance) / 3))
        const creux = profondeur - EPAISSEUR
        const dedans =
          (1 - horsDuCreux) *
          lueur *
          decroissance(DECROISSANCE_INTERIEURE, creux) *
          Math.min(1, Math.max(0, (LUEUR_INTERIEURE - 0.5 - creux) / 2))
        if (anneau <= 0 && dehors < 0.004 && dedans < 0.004) continue
        octet.push((j * zl + i) * 4)
        echantillon.push(Math.min(echantillons - 1, Math.floor(tour * echantillons)))
        poidsAnneau.push(anneau)
        // Tiers de l'anneau : 0,5 px sous le bord = le tiers exterieur (ligne 3), 2,5 px = interieur.
        ligneAnneau.push(ANNEAU_EXTERIEUR - Math.min(2, Math.max(0, profondeur - 0.5)))
        lueurDehors.push(dehors)
        lueurDedans.push(dedans)
      }
    }
    zones.push({
      x: zx,
      y: zy,
      image: fabrique(zl, zh),
      octet: Uint32Array.from(octet),
      echantillon: Uint32Array.from(echantillon),
      poidsAnneau: Float32Array.from(poidsAnneau),
      ligneAnneau: Float32Array.from(ligneAnneau),
      lueurDehors: Float32Array.from(lueurDehors),
      lueurDedans: Float32Array.from(lueurDedans)
    })
  }
  return { largeur: lc, hauteur: hc, echantillons, zones }
}

/**
 * Peint l'image `image` de la texture (RGBA, 360 x IMAGES*LIGNES) dans les zones de la table.
 * Le tour est d'abord echantillonne une fois (interpolation entre deux degres), puis chaque pixel lit
 * son echantillon : l'anneau en couleur pleine, la lueur en lumiere ajoutee (son alpha = sa force).
 */
export function peindre(
  table: TableDuBord,
  texture: Uint8ClampedArray,
  image: number,
  tampon?: Float32Array
): Float32Array {
  const n = table.echantillons
  const tour =
    tampon && tampon.length === n * LIGNES * 3 ? tampon : new Float32Array(n * LIGNES * 3)
  const base = image * LIGNES * DEGRES
  for (let k = 0; k < n; k++) {
    const colonne = ((k + 0.5) / n) * DEGRES - 0.5
    const c0 = Math.floor(colonne)
    const f = colonne - c0
    const g0 = (c0 + DEGRES) % DEGRES
    const g1 = (c0 + 1) % DEGRES
    for (let ligne = 0; ligne < LIGNES; ligne++) {
      const o0 = ((base + ligne * DEGRES + g0) << 2) >>> 0
      const o1 = ((base + ligne * DEGRES + g1) << 2) >>> 0
      const o = (k * LIGNES + ligne) * 3
      tour[o] = texture[o0] + (texture[o1] - texture[o0]) * f
      tour[o + 1] = texture[o0 + 1] + (texture[o1 + 1] - texture[o0 + 1]) * f
      tour[o + 2] = texture[o0 + 2] + (texture[o1 + 2] - texture[o0 + 2]) * f
    }
  }
  for (const zone of table.zones) {
    const d = zone.image.data
    const { octet, echantillon, poidsAnneau, ligneAnneau, lueurDehors, lueurDedans } = zone
    for (let p = 0; p < octet.length; p++) {
      const s = echantillon[p] * LIGNES * 3
      const ho = lueurDehors[p]
      const hi = lueurDedans[p]
      // La lumiere ajoutee (0 a 255) : la lueur de son cote, a sa distance.
      const er = tour[s + LUEUR_DEHORS * 3] * ho + tour[s + LUEUR_DEDANS * 3] * hi
      const eg = tour[s + LUEUR_DEHORS * 3 + 1] * ho + tour[s + LUEUR_DEDANS * 3 + 1] * hi
      const eb = tour[s + LUEUR_DEHORS * 3 + 2] * ho + tour[s + LUEUR_DEDANS * 3 + 2] * hi
      const wa = poidsAnneau[p]
      let r = er * (1 - wa)
      let g = eg * (1 - wa)
      let b = eb * (1 - wa)
      const forceLueur = Math.min(255, Math.max(er, eg, eb)) / 255
      const alpha = wa + forceLueur * (1 - wa)
      if (wa > 0) {
        const ligne = ligneAnneau[p]
        const l0 = Math.floor(ligne)
        const fl = ligne - l0
        const a0 = s + l0 * 3
        const a1 = s + Math.min(ANNEAU_EXTERIEUR, l0 + 1) * 3
        r += (tour[a0] + (tour[a1] - tour[a0]) * fl) * wa
        g += (tour[a0 + 1] + (tour[a1 + 1] - tour[a0 + 1]) * fl) * wa
        b += (tour[a0 + 2] + (tour[a1 + 2] - tour[a0 + 2]) * fl) * wa
      }
      const o = octet[p]
      if (alpha <= 0) {
        d[o + 3] = 0
        continue
      }
      d[o] = r / alpha
      d[o + 1] = g / alpha
      d[o + 2] = b / alpha
      d[o + 3] = alpha * 255
    }
  }
  return tour
}

/* ------------------------------------------------------------------------------------------------
   Le branchement dans la page : une texture chargee une fois, une seule boucle pour tous les blocs.
   ------------------------------------------------------------------------------------------------ */

let texture: Uint8ClampedArray | null = null
let chargement: Promise<void> | null = null

function chargerLaTexture(): Promise<void> {
  chargement ??= (async () => {
    const img = new Image()
    img.src = urlDeLaTexture
    await img.decode()
    const toile = document.createElement('canvas')
    toile.width = DEGRES
    toile.height = IMAGES * LIGNES
    const ctx = toile.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    ctx.drawImage(img, 0, 0)
    texture = ctx.getImageData(0, 0, DEGRES, IMAGES * LIGNES).data
  })().catch(() => {
    // Sans texture, l'anneau noir de la feuille reste seul : rien a peindre.
    chargement = null
  })
  return chargement
}

type Reflet = {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D | null
  table: TableDuBord | null
  tampon: Float32Array | undefined
  taille: { l: number; h: number; dpr: number } | null
  /** Taille, arrondi ou theme changes : la table est a refaire. */
  aPreparer: boolean
  preparee: number
  aRepeindre: boolean
}

/**
 * Une table coute 10 a 25 ms (mesure sur un bloc de 720 px) : un bloc qui grandit pendant qu'un
 * texte arrive n'en refait qu'une tous les ESPACEMENT_DES_TABLES_MS ; entre deux, le navigateur
 * etire l'image precedente a la nouvelle taille.
 */
const ESPACEMENT_DES_TABLES_MS = 200

const tous = new Set<Reflet>()
const aLEcran = new Set<Reflet>()
const parCanvas = new WeakMap<Element, Reflet>()
let boucle = 0
let derniereImage = -1
let observateurDeChamp: IntersectionObserver | null = null
let observateurDeTaille: ResizeObserver | null = null
let observateurDeTheme: MutationObserver | null = null

function preparer(reflet: Reflet): void {
  const { canvas, taille } = reflet
  if (!taille) return
  const style = getComputedStyle(canvas)
  const rayon = Number.parseFloat(style.getPropertyValue('--cadre-rayon')) || 16
  const lueurLue = Number.parseFloat(style.getPropertyValue('--reflet-lueur'))
  const lueur = Number.isFinite(lueurLue) ? lueurLue : 1
  reflet.ctx ??= canvas.getContext('2d')
  const ctx = reflet.ctx
  if (!ctx) return
  reflet.table = tableDuBord(taille.l, taille.h, rayon, taille.dpr, lueur, (zl, zh) =>
    ctx.createImageData(zl, zh)
  )
  canvas.width = reflet.table.largeur
  canvas.height = reflet.table.hauteur
  reflet.aRepeindre = true
  reflet.aPreparer = false
}

function tic(maintenant: number): void {
  boucle = 0
  if (aLEcran.size === 0) return
  if (texture) {
    const image = imageA(maintenant)
    for (const reflet of aLEcran) {
      if (
        reflet.aPreparer &&
        (!reflet.table || maintenant - reflet.preparee >= ESPACEMENT_DES_TABLES_MS)
      ) {
        preparer(reflet)
        reflet.preparee = maintenant
      }
      const { table, ctx } = reflet
      if (!table || !ctx || (image === derniereImage && !reflet.aRepeindre)) continue
      reflet.tampon = peindre(table, texture, image, reflet.tampon)
      for (const zone of table.zones) ctx.putImageData(zone.image, zone.x, zone.y)
      reflet.aRepeindre = false
    }
    derniereImage = image
  }
  boucle = requestAnimationFrame(tic)
}

function relancer(): void {
  if (boucle === 0 && aLEcran.size > 0) boucle = requestAnimationFrame(tic)
}

/**
 * Branche le reflet sur un canvas `.cadre-reflet` : suivi de sa taille, peint seulement a l'ecran.
 * Rend de quoi le debrancher. Sans IntersectionObserver ni ResizeObserver (jsdom), ne fait rien.
 */
export function brancherLeReflet(canvas: HTMLCanvasElement): () => void {
  if (typeof IntersectionObserver === 'undefined' || typeof ResizeObserver === 'undefined')
    return () => undefined
  void chargerLaTexture()
  const reflet: Reflet = {
    canvas,
    ctx: null,
    table: null,
    tampon: undefined,
    taille: null,
    aPreparer: true,
    preparee: 0,
    aRepeindre: true
  }
  parCanvas.set(canvas, reflet)
  tous.add(reflet)
  observateurDeChamp ??= new IntersectionObserver((entrees) => {
    for (const entree of entrees) {
      const r = parCanvas.get(entree.target)
      if (!r) continue
      if (entree.isIntersecting) {
        aLEcran.add(r)
        r.aRepeindre = true
      } else aLEcran.delete(r)
    }
    relancer()
  })
  observateurDeTaille ??= new ResizeObserver((entrees) => {
    for (const entree of entrees) {
      const r = parCanvas.get(entree.target)
      if (!r) continue
      const dpr = window.devicePixelRatio || 1
      const l = entree.contentRect.width - 2 * MARGE
      const h = entree.contentRect.height - 2 * MARGE
      if (l <= 0 || h <= 0) continue
      if (r.taille && r.taille.l === l && r.taille.h === h && r.taille.dpr === dpr) continue
      r.taille = { l, h, dpr }
      r.aPreparer = true
    }
    relancer()
  })
  // Un changement de theme change la lueur (eteinte en clair) : toutes les tables sont a refaire.
  if (!observateurDeTheme) {
    observateurDeTheme = new MutationObserver(() => {
      for (const r of tous) r.aPreparer = true
      relancer()
    })
    observateurDeTheme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-base']
    })
  }
  observateurDeChamp.observe(canvas)
  observateurDeTaille.observe(canvas)
  return () => {
    observateurDeChamp?.unobserve(canvas)
    observateurDeTaille?.unobserve(canvas)
    const r = parCanvas.get(canvas)
    if (r) {
      aLEcran.delete(r)
      tous.delete(r)
    }
    parCanvas.delete(canvas)
  }
}
