import * as THREE from 'three'

/**
 * LA RANGÉE DE DROITE DE L'AVENUE, EN VOLUMES (conv-1037).
 *
 * Demande de l'utilisateur : « /draft la barre d'immeuble de droite a les toits qui forment une ligne
 * droite ca fait pas naturelle et les boutiques et tags font trop basique refait toute la partie de
 * droite propose moi des trucs originaux », puis « Mixer 4 + 5 » (Néo-Edo + Chantier perpétuel), puis
 * « implémenter 1+2 » : la 1 « Pagode-tour qui se coiffe » et la 2 « Yokochō dans la dent creuse » du
 * tour 2 du brouillon (`.autowin-tmp/draft-facade/t2/melanges.js`, fonctions `m1` et `m2`).
 *
 * AVANT : un seul plan de 140 × 24 m (`facade` dans home-decor-avenue.ts) — toits en ligne droite,
 * deux vitrines et des tags peints à plat.
 *
 * PRIS À LA 1 : la tour qui monte en étages de pagode, un toit courbe souligné de néon par étage et des
 * lanternes sous chaque avant-toit ; deux dalles nues au sommet, la soudure, la grue qui hisse le toit
 * suivant ; la bâche-écran « AUTOWIN TOWER » et la palissade taguée au pied (le mur du taggeur).
 * PRIS À LA 2 : la dent creuse changée en ruelle de yatai (noren, lanternes, guirlandes, vapeur,
 * enseigne 横丁) ; le pignon mitoyen aux papiers peints des étages disparus, repeint d'un 夢 au
 * pinceau, le tag AUTOWIN tout en haut et un toit courbe ; les machiya basses (izakaya, distributeurs).
 * LAISSÉ : la pagode au fond de la dent creuse (la tour de la 1 en tient lieu) et la tour au pignon
 * calligraphié de la 1 (le 夢 est sur le pignon mitoyen).
 *
 * CE QUE LE DÉCOR IMPOSE (relevé dans home-decor-avenue.ts) : un mur sur rue (x = FACADE) là où le
 * décor accroche quelque chose — la porte du deal, le mur que le taggeur bombe, l'entrée du viaduc,
 * la potence de la marquise, les enseignes en drapeau, les câbles de la toile électrique. Les lieux
 * de la boucle de 70 m tombent toujours au même endroit de la travée de 35 m (35 divise 70) :
 * `ACCROCHES_RANGEE` les nomme, `LOTS_RANGEE` dit la hauteur du mur de chaque lot, le test voisin
 * vérifie l'un contre l'autre sur la géométrie réelle.
 *
 * CE QUI CHANGE PAR RAPPORT AU BROUILLON, parce que c'est un fond :
 *   - AUCUNE LUMIÈRE AJOUTÉE : leur nombre fait partie de la clé de chaque programme (« HUIT
 *     LUMIÈRES » dans home-decor-avenue.ts) ; l'éclat vient des textures émissives et des halos ;
 *   - AUCUNE MATIÈRE TRANSPARENTE : chaque transparent est une barrière qui coupe les lots de halos
 *     (home-decor-lots-halos.ts) ; le filet et le treillis sont découpés (`alphaTest`) ;
 *   - LA TRAVÉE EST FUSIONNÉE : une géométrie par matière pour toutes les copies, au lieu de
 *     plusieurs centaines d'objets ; seules la grue, la soudure et la vapeur restent animées ;
 *   - PEU DE MATIÈRES, donc peu de dessins (le coût du décor est PAR DESSIN : banc-decor-budget.mjs).
 *     Les pièces unies partagent UNE matière à couleurs par sommet ; les dessins qui ne se répètent
 *     pas partagent UNE texture (la « planche ») ; les quatre grues sont des instances. Mesuré au banc
 *     le 2026-10-21 : la première version (36 matières, une flèche de grue par copie) ajoutait 102
 *     dessins et 63 changements de programme par image au code d'avant ;
 *   - les noren et les lanternes ne se balancent plus (chaque pièce mobile est un dessin de plus).
 */

type Toile = [HTMLCanvasElement, CanvasRenderingContext2D]
type Peinture = (g: CanvasRenderingContext2D, W: number, H: number) => void

/** Ce que le décor prête à la rangée : ses repères et ses outils de dessin. */
export interface ContexteRangee {
  /** Le groupe qui glisse vers nous à chaque pas : chaque travée y est posée. */
  decor: THREE.Group
  /** Longueur d'une travée, début de la première dans le repère du décor, nombre de copies. */
  P: number
  Z0: number
  copies: number
  FACADE: number
  TROTTOIR: number
  toile: (w: number, h: number) => Toile
  tex: (c: HTMLCanvasElement) => THREE.CanvasTexture
  glow: (
    color: THREE.ColorRepresentation,
    size: number,
    x: number,
    y: number,
    z: number,
    op?: number,
    parent?: THREE.Object3D
  ) => THREE.Sprite
}

export interface Rangee {
  /** Ce qui bouge : la flèche des grues, la soudure, la vapeur des yatai, la bâche-écran. */
  animer(t: number): void
}

/**
 * Les lots de la travée, de u = 0 (le bout lointain) à u = 35 (le bout proche), la hauteur de leur
 * mur sur rue (`mur`, là où un câble ou une enseigne peut s'accrocher) et celle de leur faîte.
 * Le yokochō n'a pas de mur : son échafaudage, sur la ligne de façade, en tient lieu.
 */
export const LOTS_RANGEE = [
  { nom: 'pignon mitoyen', u0: 0, u1: 6, mur: 26, faite: 29.6 },
  { nom: 'yokocho', u0: 6, u1: 12.4, mur: 15, faite: 20 },
  { nom: 'pagode-tour', u0: 12.4, u1: 24, mur: 14.5, faite: 33.3 },
  { nom: 'izakaya', u0: 24, u1: 29.5, mur: 8.5, faite: 11.1 },
  { nom: 'distributeurs', u0: 29.5, u1: 35, mur: 11.5, faite: 14.5 }
] as const

/**
 * Ce que le décor accroche à la façade, en abscisse de travée (u0 → u1) et jusqu'à quelle hauteur.
 * Chaque valeur est dérivée de home-decor-avenue.ts (les lieux de la boucle de 70 m, décalée de
 * Z0 = −130 : u = (z + 130) mod 35).
 */
export const ACCROCHES_RANGEE = [
  // la porte du deal : Z_DEAL = −25, porte à +1,1 m, 1,1 m de large, son néon à 2,7 m
  { nom: 'porte du deal', u0: 0.55, u1: 1.65, haut: 2.7 },
  // le mur du taggeur : Z_TAG = −45, plan de 4,8 m, jusqu'à 2,65 m
  { nom: 'mur du taggeur', u0: 12.6, u1: 17.4, haut: 2.7 },
  // le viaduc : VIADUC.z = −5, tablier de 3,2 m, trou de 3,6 × 3,9 m centré à 12,15 m
  { nom: 'entrée du viaduc', u0: 18.2, u1: 21.8, haut: 14.1 },
  // la potence de la marquise de la Spirale, à u = 17
  { nom: 'marquise', u0: 16.9, u1: 17.1, haut: 12.5 },
  // les enseignes en drapeau : z = 4 + i × 8,6 + [0 ; 1,5], hauteur 5,2 + [0 ; 2,6] ± 1,6
  { nom: 'enseigne 1', u0: 4, u1: 5.5, haut: 9.4 },
  { nom: 'enseigne 2', u0: 12.6, u1: 14.1, haut: 9.4 },
  { nom: 'enseigne 3', u0: 21.2, u1: 22.7, haut: 9.4 },
  { nom: 'enseigne 4', u0: 29.8, u1: 31.3, haut: 9.4 }
] as const

/** La hauteur du mur sur rue à l'abscisse `u` d'une travée (n'importe quel u : la rangée se répète). */
export function hauteurMurRangee(u: number, P = 35): number {
  const v = ((u % P) + P) % P
  for (const lot of LOTS_RANGEE) if (v >= lot.u0 && v < lot.u1) return lot.mur
  return LOTS_RANGEE[0].mur
}

/**
 * Les boutiques de la rangée dont la lumière déborde sur le trottoir mouillé :
 * [début dans la travée (m), largeur (m), couleur].
 */
export const VITRINES_RANGEE: [number, number, string][] = [
  [6.6, 5.6, '#ffb46a'],
  [24.4, 4.8, '#ff6a4a']
]

const POLICE_HAN = "'Microsoft JhengHei','Microsoft YaHei','Yu Gothic',sans-serif"
const POLICE_JP = "'Yu Gothic','Meiryo','Microsoft YaHei',sans-serif"
const POLICE_PINCEAU = "'Yu Mincho','HGSeikaishotaiPRO','MS Mincho',serif"
/** Le néon rose qui souligne chaque toit courbe. */
const NEON = 0xff3b6a
/** La densité du brouillard de la rue (FogExp2 de home-decor-avenue.ts), au carré pour la bâche. */
const BROUILLARD2 = 0.021 * 0.021

/** Un rectangle de la planche (en pixels de sa toile). */
interface Zone {
  x: number
  y: number
  w: number
  h: number
}

export function monterRangee(c: ContexteRangee): Rangee {
  const F = c.FACADE
  const SOL = c.TROTTOIR
  const RDC = 4.6
  let s0 = 1037
  const rnd = (): number => (s0 = (s0 * 16807) % 2147483647) / 2147483647
  const entre = (a: number, b: number): number => a + rnd() * (b - a)
  const choisir = <X>(l: readonly X[]): X => l[Math.floor(rnd() * l.length)]

  // ---------- les textures qui se RÉPÈTENT le long des façades : une texture chacune ----------
  const dessin = (w: number, h: number, f: Peinture): THREE.CanvasTexture => {
    const [cv, g] = c.toile(w, h)
    f(g, w, h)
    const t = c.tex(cv)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    return t
  }
  const mLum = (t: THREE.Texture, k: number): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({
      map: t,
      emissiveMap: t,
      emissive: 0xffffff,
      emissiveIntensity: k,
      roughness: 0.9
    })

  /*
   * LA PLANCHE : tous les dessins qui ne se répètent pas (pignon au 夢, enseignes, noren, intérieurs,
   * distributeurs, lanternes) dans UNE texture, donc UNE matière et UN dessin par image au lieu de
   * treize. L'éclat propre à chacun est cuit dans ses pixels : la matière brille à `ECLAT` (celui des
   * lanternes), un dessin moins vif y est assombri d'autant.
   */
  const PW = 2048
  const PH = 1024
  const ECLAT = 1.25
  const [planche, gp] = c.toile(PW, PH)
  gp.fillStyle = '#000000'
  gp.fillRect(0, 0, PW, PH)
  const tPlanche = c.tex(planche)
  const mPlanche = new THREE.MeshStandardMaterial({
    map: tPlanche,
    emissiveMap: tPlanche,
    emissive: 0xffffff,
    emissiveIntensity: ECLAT,
    // une seule face, comme les façades : chaque pièce de la planche est vue de devant, et la matière
    // partage ainsi leur programme (un programme de moins à changer à chaque image)
    roughness: 0.9
  })
  const peindre = (
    x: number,
    y: number,
    w: number,
    h: number,
    f: Peinture,
    eclat: number
  ): Zone => {
    gp.save()
    gp.translate(x, y)
    gp.beginPath()
    gp.rect(0, 0, w, h)
    gp.clip()
    f(gp, w, h)
    gp.restore()
    if (eclat < ECLAT) {
      gp.save()
      gp.globalAlpha = 1 - eclat / ECLAT
      gp.fillStyle = '#000000'
      gp.fillRect(x, y, w, h)
      gp.restore()
    }
    return { x, y, w, h }
  }
  /** Ramène les coordonnées de texture d'une géométrie (0 → 1) dans sa zone de la planche. */
  const surPlanche = <G extends THREE.BufferGeometry>(geo: G, z: Zone): G => {
    const uv = geo.attributes.uv
    for (let i = 0; i < uv.count; i++)
      uv.setXY(i, (z.x + uv.getX(i) * z.w) / PW, (PH - z.y - z.h + uv.getY(i) * z.h) / PH)
    return geo
  }

  /*
   * LES PIÈCES UNIES (béton, bois, tubes, néons, ampoules…) : une matière par couleur le temps de la
   * construction ; à la fusion, toutes rejoignent UNE matière à couleurs par sommet (`uniStd`, ou
   * `uniBasic` pour ce qui ne prend pas la lumière).
   */
  const uniStd = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.8,
    metalness: 0.2
  })
  const uniBasic = new THREE.MeshBasicMaterial({ vertexColors: true })
  const unies = new Map<string, THREE.Material>()
  const mStd = (col: number): THREE.MeshStandardMaterial => {
    const cle = 's' + col
    let m = unies.get(cle) as THREE.MeshStandardMaterial | undefined
    if (!m) unies.set(cle, (m = new THREE.MeshStandardMaterial({ color: col })))
    return m
  }
  const mBasic = (col: number): THREE.MeshBasicMaterial => {
    const cle = 'b' + col
    let m = unies.get(cle) as THREE.MeshBasicMaterial | undefined
    if (!m) unies.set(cle, (m = new THREE.MeshBasicMaterial({ color: col })))
    return m
  }

  // ---------- la travée en construction : tout ce qui ne bouge pas est fusionné à la fin ----------
  const T = new THREE.Group()
  const ajoute = (
    p: THREE.Object3D,
    geo: THREE.BufferGeometry,
    m: THREE.Material,
    x: number,
    y: number,
    z: number,
    ry = 0,
    rx = 0
  ): THREE.Mesh => {
    const o = new THREE.Mesh(geo, m)
    o.position.set(x, y, z)
    o.rotation.set(rx, ry, 0)
    p.add(o)
    return o
  }
  const boite = (
    m: THREE.Material,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    p: THREE.Object3D = T
  ): THREE.Mesh => ajoute(p, new THREE.BoxGeometry(w, h, d), m, x, y, z)
  const planUV = (w: number, h: number, u0 = 0, v0 = 0, su = 1, sv = 1): THREE.PlaneGeometry => {
    const g = new THREE.PlaneGeometry(w, h)
    const uv = g.attributes.uv
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * su, v0 + uv.getY(i) * sv)
    return g
  }
  /** Un panneau tourné vers la rue (normale −x) ; le u de sa texture va vers +z, vers nous. */
  const panneauRue = (
    m: THREE.Material,
    geo: THREE.BufferGeometry,
    x: number,
    y: number,
    z: number
  ): THREE.Mesh => ajoute(T, geo, m, x, y, z, -Math.PI / 2)
  const halo = (col: number, s: number, x: number, y: number, z: number, op = 0.8): THREE.Sprite =>
    c.glow(col, s, x, y, z, op, T)
  /** Une boîte dont la texture garde l'échelle (su × sv m par tuile) au lieu d'être étirée par face. */
  const cube = (
    m: THREE.Material,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    v0 = 0,
    su = 16,
    sv = 24,
    p: THREE.Object3D = T
  ): THREE.Mesh => {
    const g = new THREE.BoxGeometry(w, h, d)
    const uv = g.attributes.uv
    const tailles = [
      [d, h],
      [d, h],
      [w, d],
      [w, d],
      [w, h],
      [w, h]
    ]
    for (let f = 0; f < 6; f++)
      for (let i = 0; i < 4; i++) {
        const k = f * 4 + i
        uv.setXY(k, (uv.getX(k) * tailles[f][0]) / su, v0 + (uv.getY(k) * tailles[f][1]) / sv)
      }
    return ajoute(p, g, m, x, y, z)
  }

  // ---------- les peintures ----------
  /** Une tuile de façade : 16 m × 24 m (8 étages de 3 m), 32 px par mètre. */
  const peintureFacade =
    (o: {
      fond: string
      pal: string[]
      taux: number
      eteint?: string
      shoji?: boolean
      clim?: number
    }): Peinture =>
    (g, W, H) => {
      g.fillStyle = o.fond
      g.fillRect(0, 0, W, H)
      for (let i = 0; i < 1500; i++) {
        g.fillStyle = 'rgba(' + (rnd() < 0.5 ? '40,34,60' : '0,0,0') + ',' + rnd() * 0.28 + ')'
        g.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 24, 2 + rnd() * 14)
      }
      for (let et = 0; et < 8; et++) {
        const y0 = H - (et + 1) * 96
        g.fillStyle = 'rgba(0,0,0,.6)'
        g.fillRect(0, y0 + 90, W, 6)
        for (let k = 0; k < 8; k++) {
          const x = k * 64 + 10
          const yy = y0 + 22
          const w = 44
          const h = 56
          const allume = rnd() < o.taux
          g.fillStyle = allume ? choisir(o.pal) : (o.eteint ?? '#08070c')
          g.fillRect(x, yy, w, h)
          if (allume && o.shoji) {
            g.strokeStyle = 'rgba(60,30,15,.85)'
            g.lineWidth = 2
            for (let s = 1; s < 4; s++) g.strokeRect(x + (s * w) / 4, yy, 0.1, h)
            for (let s = 1; s < 5; s++) g.strokeRect(x, yy + (s * h) / 5, w, 0.1)
          } else if (allume) {
            g.fillStyle = 'rgba(10,6,16,.55)'
            g.fillRect(x, yy, w * (0.2 + rnd() * 0.5), h)
            if (rnd() < 0.3) {
              g.fillStyle = 'rgba(10,6,16,.85)'
              g.beginPath()
              g.ellipse(x + w * 0.7, yy + h * 0.45, 5, 8, 0, 0, 7)
              g.fill()
              g.fillRect(x + w * 0.7 - 8, yy + h * 0.62, 16, h * 0.38)
            }
          }
          g.strokeStyle = '#050407'
          g.lineWidth = 3
          g.strokeRect(x, yy, w, h)
          if (!o.shoji) g.strokeRect(x + w / 2, yy, 0.1, h)
          if (o.clim && rnd() < o.clim) {
            g.fillStyle = '#211c2a'
            g.fillRect(x + 4, yy + h + 5, 34, 16)
            g.fillStyle = '#0c0a10'
            g.fillRect(x + 8, yy + h + 9, 26, 3)
          }
        }
      }
    }
  /** Un caisson éclairé : fond plein, lettres pleines, à la verticale si `vertical`. */
  const peintureCaisson =
    (
      txt: string,
      fond: string,
      encre: string,
      vertical: boolean,
      police = POLICE_HAN,
      lueur = 0
    ): Peinture =>
    (g, w, h) => {
      g.fillStyle = fond
      g.fillRect(0, 0, w, h)
      g.strokeStyle = lueur ? encre : 'rgba(255,255,255,.55)'
      g.lineWidth = 5
      g.strokeRect(6, 6, w - 12, h - 12)
      g.fillStyle = encre
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      if (lueur) {
        g.shadowColor = encre
        g.shadowBlur = lueur
      }
      if (vertical) {
        const lettres = [...txt]
        const pas = (h - 24) / lettres.length
        g.font = 'bold ' + Math.floor(Math.min(w * 0.7, pas * 0.84)) + 'px ' + police
        lettres.forEach((l, k) => g.fillText(l, w / 2, 12 + pas * (k + 0.5)))
      } else {
        g.font = 'bold ' + Math.floor(h * 0.6) + 'px ' + police
        g.fillText(txt, w / 2, h / 2 + 2, w - 24)
      }
    }
  /** Un intérieur éclairé vu par une baie : étagères chargées et une silhouette. */
  const peintureInterieur =
    (haut: string, bas: string): Peinture =>
    (g, W, H) => {
      const gr = g.createLinearGradient(0, 0, 0, H)
      gr.addColorStop(0, haut)
      gr.addColorStop(1, bas)
      g.fillStyle = gr
      g.fillRect(0, 0, W, H)
      for (let s = 0; s < 4; s++) {
        const y = 14 + s * 26
        g.fillStyle = 'rgba(30,15,10,.85)'
        g.fillRect(0, y + 18, W, 4)
        for (let k = 0; k < 30; k++) {
          g.fillStyle = choisir([
            '#c4142c',
            '#1b4fd1',
            '#2a8a4a',
            '#ffd23f',
            '#ff2fa0',
            '#f4f1ea',
            '#3a2a1c'
          ])
          g.fillRect(k * (W / 30) + rnd() * 3, y + 18 - entre(8, 16), entre(3, 8), 16)
        }
      }
      g.fillStyle = 'rgba(15,8,8,.92)'
      g.beginPath()
      g.ellipse(W * 0.62, H * 0.4, 8, 11, 0, 0, 7)
      g.fill()
      g.fillRect(W * 0.62 - 13, H * 0.49, 26, H * 0.51)
    }
  /** Le tag de l'avenue : contour, remplissage, coulures, cœur blanc. */
  const tag = (
    g: CanvasRenderingContext2D,
    txt: string,
    x: number,
    y: number,
    size: number,
    out: string,
    fill: string,
    font = 'Impact',
    rot = -0.07,
    coulures = 7,
    haloT = 0.4
  ): void => {
    g.save()
    g.translate(x, y)
    g.rotate(rot)
    g.transform(1, 0, -0.22, 1, 0, 0)
    g.font = size + 'px ' + font
    g.textAlign = 'center'
    g.lineJoin = 'round'
    g.lineCap = 'round'
    const w = g.measureText(txt).width
    g.shadowColor = out
    g.shadowBlur = size * haloT
    g.lineWidth = size * 0.15
    g.strokeStyle = out
    g.strokeText(txt, 0, 0)
    g.shadowBlur = 0
    g.lineWidth = size * 0.06
    g.strokeStyle = '#06040c'
    g.strokeText(txt, 0, 0)
    g.shadowColor = fill
    g.shadowBlur = size * 0.25
    g.fillStyle = fill
    g.fillText(txt, 0, 0)
    g.strokeStyle = fill
    for (let i = 0; i < coulures; i++) {
      const dx = (rnd() - 0.5) * w * 0.9
      g.lineWidth = size * (0.025 + rnd() * 0.035)
      g.beginPath()
      g.moveTo(dx, -size * 0.06)
      g.lineTo(dx, size * (0.12 + rnd() * 0.75))
      g.stroke()
    }
    g.shadowBlur = 0
    g.globalAlpha *= 0.7
    g.lineWidth = Math.max(1, size * 0.014)
    g.strokeStyle = '#ffffff'
    g.strokeText(txt, 0, 0)
    g.restore()
  }
  /** Des affiches collées en couches, lacérées, et des autocollants. */
  const affiches = (
    g: CanvasRenderingContext2D,
    W: number,
    H: number,
    n: number,
    mots: string[]
  ): void => {
    const fonds = [
      '#e8e2d0',
      '#ff2fa0',
      '#2ee8ff',
      '#ffd23f',
      '#1d1b26',
      '#f4f1ea',
      '#3c6eeb',
      '#ff5a3c'
    ]
    for (let i = 0; i < n; i++) {
      const w = entre(W * 0.1, W * 0.22)
      const h = entre(H * 0.4, H * 0.85)
      const x = entre(-w * 0.3, W - w * 0.7)
      const y = entre(-h * 0.2, H - h * 0.8)
      g.save()
      g.translate(x + w / 2, y + h / 2)
      g.rotate(entre(-0.08, 0.08))
      g.beginPath()
      g.moveTo(-w / 2, -h / 2)
      for (let k = 0; k <= 10; k++) g.lineTo(-w / 2 + (w * k) / 10, -h / 2 + rnd() * 5)
      for (let k = 0; k <= 10; k++) g.lineTo(w / 2 - rnd() * 7, -h / 2 + (h * k) / 10)
      for (let k = 0; k <= 10; k++) g.lineTo(w / 2 - (w * k) / 10, h / 2 - rnd() * (k > 4 ? 28 : 6))
      g.closePath()
      const fond = choisir(fonds)
      g.fillStyle = fond
      g.fill()
      g.clip()
      const sombre = fond === '#1d1b26' || fond === '#3c6eeb'
      g.fillStyle = sombre ? '#ffffff' : '#111018'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.font = 'bold ' + Math.floor(w * 0.3) + 'px Impact'
      g.fillText(choisir(mots), 0, -h * 0.2, w * 0.9)
      g.fillStyle = sombre ? '#ffd23f' : '#ff2fa0'
      g.beginPath()
      g.arc(0, h * 0.1, w * 0.2, 0, 7)
      g.fill()
      g.fillStyle = sombre ? '#cfd6ff' : '#2a2833'
      g.font = Math.floor(w * 0.1) + 'px Consolas'
      g.fillText(
        choisir(['03:00 · B2', 'SAM 22H', '¥ 980', 'LIVE 24/7', 'NIVEAU -3']),
        0,
        h * 0.36,
        w * 0.9
      )
      g.restore()
    }
    for (let i = 0; i < n * 4; i++) {
      g.save()
      g.translate(rnd() * W, rnd() * H)
      g.rotate(entre(-0.6, 0.6))
      g.fillStyle = choisir(['#ffffff', '#ffd23f', '#2ee8ff', '#ff2fa0', '#111018'])
      const s = entre(6, 18)
      if (rnd() < 0.5) {
        g.beginPath()
        g.arc(0, 0, s / 2, 0, 7)
        g.fill()
      } else g.fillRect(-s, -s / 2, s * 2, s)
      g.restore()
    }
  }
  /** Un kanji au pinceau, ses éclaboussures et ses coulures. */
  const calligraphie = (
    g: CanvasRenderingContext2D,
    kanji: string,
    cx: number,
    cy: number,
    taille: number,
    encre: string
  ): void => {
    g.save()
    g.font = 'bold ' + taille + 'px ' + POLICE_PINCEAU
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillStyle = encre
    g.shadowColor = 'rgba(255,111,181,.6)'
    g.shadowBlur = taille * 0.075
    g.fillText(kanji, cx, cy)
    g.shadowBlur = 0
    for (let i = 0; i < 90; i++) {
      g.globalAlpha = rnd() * 0.8
      g.beginPath()
      g.arc(
        cx + (rnd() - 0.5) * taille * 0.95,
        cy + (rnd() - 0.5) * taille * 1.05,
        rnd() * taille * 0.018,
        0,
        7
      )
      g.fill()
    }
    g.globalAlpha = 0.75
    for (let i = 0; i < 8; i++)
      g.fillRect(
        cx - taille * 0.4 + rnd() * taille * 0.8,
        cy + taille * 0.3,
        3 + rnd() * 4,
        taille * (0.1 + rnd() * 0.35)
      )
    g.restore()
  }
  const sceau = (
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    s: number,
    txt: string
  ): void => {
    g.fillStyle = '#c4142c'
    g.fillRect(x, y, s, s)
    g.fillStyle = '#ffe9c4'
    g.font = 'bold ' + Math.floor(s * 0.4) + 'px ' + POLICE_JP
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(txt, x + s / 2, y + s / 2)
  }
  /** Le pignon nu de la maison qui a perdu sa voisine : 14 × 26 m. */
  const peintureMitoyen: Peinture = (g, W, H) => {
    const X = (m: number): number => (m / 14) * W
    const Y = (m: number): number => H - (m / 26) * H
    g.fillStyle = '#2a2830'
    g.fillRect(0, 0, W, H)
    for (let i = 0; i < 2500; i++) {
      g.fillStyle = 'rgba(' + (rnd() < 0.5 ? '70,66,80' : '0,0,0') + ',' + rnd() * 0.25 + ')'
      g.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 20, 2 + rnd() * 14)
    }
    // les papiers peints des étages disparus, pièce par pièce, et la trace des planchers
    const PAPIERS = ['#7a4a5e', '#4a6e62', '#7a6a50', '#3e5272', '#6e5a7a']
    for (let et = 0; et < 5; et++) {
      const y0 = et === 0 ? 0 : RDC + (et - 1) * 3
      const y1 = et === 0 ? RDC : y0 + 3
      let x = 0
      while (x < 12) {
        const w = entre(2.5, 5)
        g.fillStyle = choisir(PAPIERS)
        g.fillRect(X(x) + 3, Y(y1) + 3, X(w) - 6, Y(y0) - Y(y1) - 6)
        g.fillStyle = 'rgba(255,255,255,.12)'
        if (rnd() < 0.5)
          for (let s = 0; s < X(w); s += 12) g.fillRect(X(x) + s, Y(y1), 4, Y(y0) - Y(y1))
        else
          for (let s = 0; s < 40; s++)
            g.fillRect(X(x) + rnd() * X(w), Y(y1) + rnd() * (Y(y0) - Y(y1)), 5, 5)
        g.fillStyle = 'rgba(0,0,0,.35)'
        g.fillRect(X(x) + X(w) * 0.6, Y(y1) + 8, X(0.8), Y(y0) - Y(y1) - 16)
        x += w
      }
      g.fillStyle = '#121016'
      g.fillRect(0, Y(y1) - 4, X(12), 9)
    }
    // l'escalier disparu, en zigzag, et la descente d'eau
    g.strokeStyle = 'rgba(0,0,0,.6)'
    g.lineWidth = 10
    g.beginPath()
    for (let et = 0; et < 5; et++) {
      const y = et === 0 ? 0 : RDC + (et - 1) * 3
      g.moveTo(X(10), Y(y))
      g.lineTo(X(12), Y(y + 1.5))
      g.lineTo(X(10), Y(y + 3))
    }
    g.stroke()
    g.fillStyle = 'rgba(20,18,24,.9)'
    g.fillRect(X(5.5), Y(26), X(0.6), H)
    // le 夢 peint au pinceau par-dessus les papiers peints, son sceau, et le tag tout en haut
    calligraphie(g, '夢', W * 0.48, Y(10), 330, 'rgba(244,241,234,.95)')
    sceau(g, W * 0.7, Y(5.2), 70, '自動')
    tag(g, 'AUTOWIN', W * 0.5, Y(23.2), 128, '#ff2fa0', '#eafcff', 'Impact', -0.06, 9, 0.5)
    tag(g, 'heaven spot', W * 0.62, Y(21.6), 40, '#2ee8ff', '#ffffff', 'Ink Free', -0.04, 3)
  }
  const peintureNoren: Peinture = (g, W, H) => {
    g.fillStyle = '#1b2a5a'
    g.fillRect(0, 0, W, H)
    g.fillStyle = '#f4f1ea'
    g.beginPath()
    g.arc(W / 2, H * 0.42, H * 0.3, 0, 7)
    g.fill()
    g.fillStyle = '#1b2a5a'
    g.font = 'bold ' + Math.floor(H * 0.42) + 'px ' + POLICE_JP
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText('酒', W / 2, H * 0.44)
    g.fillStyle = '#f4f1ea'
    g.font = Math.floor(H * 0.12) + 'px ' + POLICE_JP
    g.fillText('居酒屋 · 深夜', W / 2, H * 0.86)
  }
  const DISTRIB = [
    ['#c4142c', 'AUTOWIN'],
    ['#f4f1ea', 'コーヒー'],
    ['#1b4fd1', 'NEURO+'],
    ['#111018', 'BOSS'],
    ['#ff2fa0', 'ラムネ']
  ] as const
  const peintureDistributeur =
    (col: string, nom: string): Peinture =>
    (g, W) => {
      g.fillStyle = col
      g.fillRect(0, 0, W, 256)
      g.fillStyle = col === '#f4f1ea' ? '#1a1a22' : '#ffffff'
      g.font = 'bold 24px ' + POLICE_JP
      g.textAlign = 'center'
      g.fillText(nom, W / 2, 30, W - 10)
      g.fillStyle = '#f8fbff'
      g.fillRect(8, 44, W - 16, 132)
      for (let r = 0; r < 4; r++)
        for (let k = 0; k < 6; k++) {
          g.fillStyle = choisir([
            '#c4142c',
            '#1b4fd1',
            '#2a8a4a',
            '#ffd23f',
            '#ff2fa0',
            '#3a2a1c',
            '#2ee8ff'
          ])
          g.fillRect(14 + k * 18, 50 + r * 32, 12, 22)
          g.fillStyle = '#ff3b3b'
          g.fillRect(14 + k * 18, 74 + r * 32, 12, 3)
        }
      g.fillStyle = '#16141c'
      g.fillRect(8, 186, W - 16, 52)
      g.fillStyle = '#2ee8ff'
      g.fillRect(W - 38, 196, 22, 8)
    }

  // ---------- la planche : chaque dessin à sa place fixe, avec 4 px d'écart ----------
  const Z = {
    mitoyen: peindre(0, 0, 512, 1024, peintureMitoyen, 0.75),
    hotel: peindre(
      516,
      0,
      128,
      640,
      peintureCaisson('ホテル桜', '#0b0810', '#ff6fb5', true, POLICE_JP, 18),
      1.2
    ),
    yokocho: peindre(
      648,
      0,
      128,
      640,
      peintureCaisson('横丁', '#0b0810', '#ff6fb5', true, POLICE_JP, 18),
      1.2
    ),
    noren: peindre(780, 0, 512, 256, peintureNoren, 0.55),
    interieur: peindre(780, 260, 256, 128, peintureInterieur('#fff1d6', '#ffb46a'), 1),
    yatai: peindre(1040, 260, 256, 128, peintureInterieur('#ffe2b8', '#c87a3a'), 1),
    lanterneRouge: peindre(
      1296,
      260,
      128,
      64,
      peintureCaisson('祭', '#d8203a', '#1a0a0a', false, POLICE_JP),
      ECLAT
    ),
    lanterneBlanche: peindre(
      1428,
      260,
      128,
      64,
      peintureCaisson('祭', '#fff1d6', '#1a0a0a', false, POLICE_JP),
      ECLAT
    ),
    distributeurs: DISTRIB.map(([col, nom], i) =>
      peindre(1296 + i * 132, 0, 128, 256, peintureDistributeur(col, nom), 1.15)
    )
  }
  const zoneLanterne = (col: string): Zone =>
    col === '#d8203a' ? Z.lanterneRouge : Z.lanterneBlanche

  // ---------- les matières de la rangée ----------
  const tuile = new THREE.MeshStandardMaterial({
    color: 0x1e1b26,
    roughness: 0.5,
    metalness: 0.35,
    side: THREE.DoubleSide
  })
  const mMaison = mLum(
    dessin(
      512,
      768,
      peintureFacade({
        shoji: true,
        fond: '#1a1210',
        pal: ['#ffe2b8', '#ffd9a8', '#fff1d6'],
        taux: 0.6,
        eteint: '#120c0a'
      })
    ),
    0.95
  )
  const mTour = mLum(
    dessin(
      512,
      768,
      peintureFacade({
        fond: '#120f16',
        pal: ['#ffd9a8', '#ff8fd0', '#ffe2b8', '#9fb6ff'],
        taux: 0.45,
        clim: 0.25
      })
    ),
    0.9
  )
  // pignons des machiya et mur du fond de la dent creuse : peu de fenêtres allumées
  const mArriere = mLum(
    dessin(512, 768, peintureFacade({ fond: '#100d13', pal: ['#ffd9a8'], taux: 0.12, clim: 0.1 })),
    0.7
  )
  const mNuit = mStd(0x0d0a10)
  const mBeton = mStd(0x3a3a42)
  const mTube = mStd(0x8a8a94)
  const mBoisYatai = mStd(0x4a2a1a)
  /*
   * LA GRUE EN UNE SEULE MATIÈRE (un dessin par image pour les quatre) : un treillis opaque — traits
   * jaunes sur fond sombre, un feu rose à chaque croisement —, dont trois points unis habillent aussi
   * la cabine (jaune), le contrepoids et le toit hissé (sombre), et le néon de ce toit (rose).
   */
  const mGrue = mLum(
    dessin(64, 64, (g) => {
      g.fillStyle = '#14100a'
      g.fillRect(0, 0, 64, 64)
      g.strokeStyle = '#e0a020'
      g.lineWidth = 10
      g.strokeRect(2, 2, 60, 60)
      g.beginPath()
      g.moveTo(0, 0)
      g.lineTo(64, 64)
      g.moveTo(64, 0)
      g.lineTo(0, 64)
      g.stroke()
      g.fillStyle = '#ff3b6a'
      g.fillRect(28, 28, 8, 8)
    }),
    0.45
  )
  /** Les points unis de la texture de la grue (pixels (4, 32), (14, 30) et (32, 32)). */
  const UV_GRUE = { jaune: [0.06, 0.5], sombre: [0.22, 0.53], rose: [0.5, 0.5] } as const
  const uni = <G extends THREE.BufferGeometry>(geo: G, [u, v]: readonly number[]): G => {
    const uv = geo.attributes.uv
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u, v)
    return geo
  }
  const mPalissade = mLum(
    dessin(1024, 256, (g, W, H) => {
      g.fillStyle = '#2a2a30'
      g.fillRect(0, 0, W, H)
      for (let x = 0; x < W; x += 128) {
        g.fillStyle = 'rgba(0,0,0,.5)'
        g.fillRect(x, 0, 4, H)
      }
      affiches(g, W, H, 6, ['DÉMOLITION', 'RAVE', 'NEURO+', 'BIENTÔT'])
      tag(g, 'scout', W * 0.72, H * 0.5, 80, '#ff2fa0', '#ffffff', 'Ink Free')
      tag(g, 'OS', W * 0.9, H * 0.75, 90, '#3c6eeb', '#8fa8ff')
      g.fillStyle = 'rgba(255,255,255,.75)'
      g.font = 'bold 22px Consolas'
      g.fillText("DÉFENSE D'AFFICHER — LOI DU 29 JUILLET 1881", 30, H - 18)
    }),
    0.55
  )

  // ---------- pièces de Néo-Edo ----------
  const profilCourbe = (profondeur: number, rise: number, ov: number): THREE.Shape => {
    const s = new THREE.Shape()
    s.moveTo(-ov - 0.25, 0.55)
    s.quadraticCurveTo(-ov + 0.3, -0.05, 0, 0.1)
    s.quadraticCurveTo(profondeur * 0.22, rise * 0.25, profondeur * 0.5, rise)
    s.quadraticCurveTo(profondeur * 0.78, rise * 0.25, profondeur + ov * 0.5, 0.1)
    s.lineTo(profondeur + ov * 0.5, -0.15)
    s.quadraticCurveTo(profondeur * 0.78, rise * 0.25 - 0.25, profondeur * 0.5, rise - 0.3)
    s.quadraticCurveTo(profondeur * 0.22, rise * 0.25 - 0.25, 0, -0.15)
    s.quadraticCurveTo(-ov + 0.3, -0.3, -ov - 0.25, 0.35)
    return s
  }
  /** Un toit courbe aux coyaux relevés, profil vu depuis le pignon, souligné de néon côté rue. */
  const toitCourbe = (
    x: number,
    z1: number,
    z2: number,
    y: number,
    profondeur: number,
    rise: number,
    ov = 1.6
  ): void => {
    const len = z1 - z2 + 1.2
    ajoute(
      T,
      new THREE.ExtrudeGeometry(profilCourbe(profondeur, rise, ov), {
        depth: len,
        bevelEnabled: false,
        curveSegments: 8
      }),
      tuile,
      x,
      y,
      z2 - 0.6
    )
    boite(mBasic(NEON), 0.07, 0.07, len, x - ov - 0.25, y + 0.55, (z1 + z2) / 2)
  }
  /** Un toit de pagode carré, souligné de néon sur ses deux faces visibles. */
  const toitPagode = (x: number, z: number, y: number, w: number, p: THREE.Object3D = T): void => {
    const r = (w / 2 + 1.1) / Math.SQRT1_2
    const pts = [
      [r, 0.6],
      [r * 0.93, 0.0],
      [r * 0.72, 0.28],
      [r * 0.45, 0.95],
      [0.15, 1.5]
    ].map(([a, b]) => new THREE.Vector2(a, b))
    ajoute(p, new THREE.LatheGeometry(pts, 4), tuile, x, y, z, Math.PI / 4)
    const d = r * Math.SQRT1_2
    const L = r * Math.SQRT2
    boite(mBasic(NEON), 0.06, 0.06, L, x - d, y + 0.6, z, p)
    boite(mBasic(NEON), L, 0.06, 0.06, x, y + 0.6, z + d, p)
  }
  /** Une rangée de lanternes sur un fil, le long de z, et sa lueur. */
  /**
   * `lueur` : un halo sur la rangée. Les lanternes des étages de la tour s'en passent — leur
   * texture brille déjà, et chaque halo de plus peut couper un lot de halos (un dessin de plus).
   */
  const lanternes = (
    x: number,
    y: number,
    z1: number,
    z2: number,
    couleurs: string[],
    lueur = true
  ): void => {
    boite(mStd(0x0a0808), 0.02, 0.02, z1 - z2, x, y + 0.42, (z1 + z2) / 2)
    let k = 0
    for (let z = z1 - 0.4; z > z2 + 0.2; z -= 0.72) {
      const geo = surPlanche(
        new THREE.SphereGeometry(0.21, 10, 6),
        zoneLanterne(couleurs[k++ % couleurs.length])
      )
      ajoute(T, geo, mPlanche, x, y, z).scale.y = 1.35
    }
    if (lueur) halo(couleurs[0] === '#d8203a' ? 0xff4a3a : 0xffe2b8, 2.6, x, y, (z1 + z2) / 2, 0.38)
  }
  /** Un noren : rideau fendu en n lés, tourné vers la rue, ou vers nous si `face`. */
  const noren = (x: number, y: number, zc: number, n = 4, face = false): void => {
    for (let k = 0; k < n; k++) {
      const d = ((n - 1) / 2 - k) * 0.55
      const g = surPlanche(planUV(0.52, 1.0, k / n, 0, 1 / n, 1), Z.noren)
      if (face) ajoute(T, g, mPlanche, x - d, y - 0.5, zc)
      else ajoute(T, g, mPlanche, x, y - 0.5, zc + d, -Math.PI / 2)
    }
  }
  /** Une enseigne verticale en drapeau, tournée vers nous, et sa potence. */
  const enseigneVerticale = (x: number, y: number, z: number, zone: Zone): void => {
    ajoute(T, surPlanche(new THREE.PlaneGeometry(1.05, 5.2), zone), mPlanche, x, y, z)
    boite(mStd(0x0a0808), Math.max(0.6, F - x), 0.06, 0.06, (x + F) / 2, y + 2.5, z - 0.05)
    halo(0xff6fb5, 6, x, y, z + 0.3, 0.35)
  }
  /** Un immeuble : façade sur rue au-dessus du rez-de-chaussée, pignon tourné vers nous, toit plat. */
  function immeuble(o: {
    z1: number
    z2: number
    h: number
    mf: THREE.Material
    /** le pignon : une façade répétée, ou une zone de la planche plaquée d'un seul tenant */
    pignon: THREE.Material | Zone
    rdc?: THREE.Material
    profondeur?: number
    base?: number
  }): void {
    const profondeur = o.profondeur ?? 14
    const base = o.base ?? RDC
    const len = o.z1 - o.z2
    const hh = o.h - base
    const zc = (o.z1 + o.z2) / 2
    const u0 = (Math.floor(entre(0, 8)) * 2) / 16
    if (hh > 0) panneauRue(o.mf, planUV(len, hh, u0, 0, len / 16, hh / 24), F, base + hh / 2, zc)
    if (o.pignon instanceof THREE.Material)
      ajoute(
        T,
        planUV(profondeur, o.h, 0, 0, profondeur / 16, o.h / 24),
        o.pignon,
        F + profondeur / 2,
        o.h / 2,
        o.z1
      )
    else
      ajoute(
        T,
        surPlanche(new THREE.PlaneGeometry(profondeur, o.h), o.pignon),
        mPlanche,
        F + profondeur / 2,
        o.h / 2,
        o.z1
      )
    ajoute(
      T,
      new THREE.PlaneGeometry(profondeur, len),
      mNuit,
      F + profondeur / 2,
      o.h,
      zc,
      0,
      -Math.PI / 2
    )
    if (o.rdc) panneauRue(o.rdc, new THREE.PlaneGeometry(len, base), F, base / 2, zc)
  }
  /** Une machiya : étages à shoji, toit courbe, auvent, izakaya ouvert au rez-de-chaussée. */
  const machiya = (o: {
    z1: number
    z2: number
    h: number
    rise: number
    noren?: boolean
    lant?: string[]
  }): void => {
    const profondeur = 10
    const zc = (o.z1 + o.z2) / 2
    const len = o.z1 - o.z2
    immeuble({ z1: o.z1, z2: o.z2, h: o.h, mf: mMaison, pignon: mArriere, base: 3.6, profondeur })
    // sans débord de pignon : ses deux voisines sont plus hautes, le débord sortirait devant leur façade
    toitCourbe(F, o.z1 - 0.6, o.z2 + 0.6, o.h, profondeur, o.rise)
    boite(tuile, 1.4, 0.12, len + 0.4, F - 0.7, 3.75, zc)
    panneauRue(
      mPlanche,
      surPlanche(new THREE.PlaneGeometry(len - 0.4, 3.4), Z.interieur),
      F + 1.2,
      SOL + 1.7,
      zc
    )
    if (o.noren) noren(F - 0.05, 3.3, o.z1 - 2.2)
    if (o.lant) lanternes(F - 0.9, 3.25, o.z1 - 0.2, o.z2 + 0.2, o.lant)
  }
  const distributeurs = (x: number, z0: number): void => {
    Z.distributeurs.forEach((zone, i) => {
      const z = z0 - i * 0.98
      boite(mStd(0x1a1820), 0.8, 1.85, 0.94, x + 0.41, SOL + 0.925, z)
      panneauRue(mPlanche, surPlanche(new THREE.PlaneGeometry(0.9, 1.8), zone), x, SOL + 0.92, z)
    })
    halo(0xcfe8ff, 5, x - 0.3, 1.4, z0 - Z.distributeurs.length * 0.49, 0.3)
  }
  /** Un yatai : comptoir, petit toit courbe vu de face, noren, lanterne rouge, tabourets ; ouvert vers nous. */
  const yatai = (x: number, z: number, w: number): void => {
    boite(mBoisYatai, w, 1.0, 0.9, x, SOL + 0.5, z)
    boite(mBoisYatai, w, 2.4, 0.15, x, SOL + 1.2, z - 0.95)
    ajoute(
      T,
      surPlanche(new THREE.PlaneGeometry(w - 0.3, 1.2), Z.yatai),
      mPlanche,
      x,
      SOL + 1.75,
      z - 0.86
    )
    for (const s of [-1, 1])
      boite(mBoisYatai, 0.1, 2.3, 0.1, x + s * (w / 2 - 0.05), SOL + 1.15, z + 0.4)
    toitCourbe(x - w / 2 - 0.1, z + 0.6, z - 0.7, SOL + 2.3, w + 0.2, 0.7, 0.35)
    noren(x, SOL + 2.25, z + 0.62, 3, true)
    const l = ajoute(
      T,
      surPlanche(new THREE.SphereGeometry(0.22, 10, 6), Z.lanterneRouge),
      mPlanche,
      x + w / 2 + 0.15,
      SOL + 1.9,
      z + 0.6
    )
    l.scale.y = 1.35
    for (let k = 0; k < 3; k++)
      ajoute(
        T,
        new THREE.CylinderGeometry(0.17, 0.17, 0.6, 10),
        mStd(0xd8203a),
        x - w / 2 + 0.5 + k * 0.8,
        SOL + 0.3,
        z + 0.95
      )
  }

  // ---------- pièces du chantier ----------
  /** n dalles nues sur poteaux, fers à béton en attente au sommet ; rend la cote du sommet. */
  const carcasse = (
    x: number,
    z1: number,
    z2: number,
    y0: number,
    n: number,
    profondeur: number,
    pas = 3.1
  ): number => {
    const len = z1 - z2
    const zc = (z1 + z2) / 2
    for (let k = 0; k < n; k++) {
      const y = y0 + k * pas
      boite(mBeton, profondeur, 0.3, len, x + profondeur / 2, y + pas, zc)
      for (const xx of [x + 0.4, x + profondeur / 2, x + profondeur - 0.4])
        for (const zz of [z1 - 0.4, zc, z2 + 0.4])
          boite(mBeton, 0.45, pas, 0.45, xx, y + pas / 2, zz)
    }
    const top = y0 + n * pas
    for (let k = 0; k < 40; k++)
      boite(
        mStd(0x6a4a3a),
        0.04,
        entre(0.8, 1.8),
        0.04,
        x + entre(0.3, profondeur - 0.3),
        top + 0.8,
        choisir([z1 - 0.3, z2 + 0.3]) + entre(-0.2, 0.2)
      )
    return top
  }
  /** Échafaudage de tubes : montants à x = a − 0,25 et a − 1,25, le long de z, lisses et planchers dès `premier` m. */
  const echafaudage = (a: number, z1: number, z2: number, h: number, premier: number): void => {
    const L = z1 - z2
    const zc = (z1 + z2) / 2
    for (let z = z2 + 0.2; z < z1; z += 2.2)
      for (const d of [0.25, 1.25])
        ajoute(T, new THREE.CylinderGeometry(0.04, 0.04, h, 5), mTube, a - d, h / 2, z)
    for (let y = premier; y < h; y += 2) {
      for (const d of [0.25, 1.25])
        ajoute(
          T,
          new THREE.CylinderGeometry(0.035, 0.035, L, 5),
          mTube,
          a - d,
          y,
          zc,
          0,
          Math.PI / 2
        )
      boite(mStd(0x5a4a30), 1.0, 0.05, L, a - 0.75, y + 0.03, zc)
    }
  }
  /** Une guirlande d'ampoules tendue de a à b, avec son creux. */
  const guirlande = (a: number[], b: number[], creux: number, col: number): void => {
    const n = Math.max(2, Math.round(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.6))
    for (let k = 0; k <= n; k++) {
      const u = k / n
      ajoute(
        T,
        new THREE.SphereGeometry(0.07, 6, 4),
        mBasic(col),
        a[0] + (b[0] - a[0]) * u,
        a[1] + (b[1] - a[1]) * u - Math.sin(u * Math.PI) * creux,
        a[2] + (b[2] - a[2]) * u
      )
    }
  }
  /** La bâche qui ondule et dont l'image saute de temps en temps (la bâche-écran), embrumée comme la rue. */
  const uTemps = { value: 0 }
  const bacheEcran = (carte: THREE.Texture): THREE.ShaderMaterial =>
    new THREE.ShaderMaterial({
      uniforms: { t: uTemps, carte: { value: carte }, brume: { value: new THREE.Color(0x070d18) } },
      side: THREE.DoubleSide,
      vertexShader:
        'varying vec2 vU;varying vec3 vW;void main(){vU=uv;vec4 w=modelMatrix*vec4(position,1.0);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}',
      fragmentShader: [
        'uniform float t;uniform vec3 brume;uniform sampler2D carte;varying vec2 vU;varying vec3 vW;',
        'float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
        'void main(){vec2 u=vU;',
        '  float pli=0.5+0.5*sin(u.x*38.0+sin(u.y*5.0+t*0.8)*1.6);',
        '  float salve=step(0.93,h(vec2(floor(t*5.0),3.0)));',
        '  u.x+=salve*(h(vec2(floor(u.y*24.0),floor(t*20.0)))-0.5)*0.08;',
        '  vec3 c=texture2D(carte,u).rgb;c*=0.7+0.45*pli;c*=0.85+0.15*sin(u.y*500.0+t*12.0);',
        '  float d=length(vW-cameraPosition);c=mix(c,brume,1.0-exp(-' +
          BROUILLARD2.toFixed(6) +
          '*d*d));',
        '  gl_FragColor=vec4(c,1.0);',
        '#include <colorspace_fragment>',
        '}'
      ].join('\n')
    })

  // =====================================================================================
  // A · LE PIGNON MITOYEN (u 0 → 6) — la maison qui a perdu sa voisine (2)
  // =====================================================================================
  immeuble({ z1: 6, z2: 0, h: 26, mf: mTour, pignon: Z.mitoyen, rdc: mNuit })
  toitCourbe(F, 6, 0, 26, 14, 3.6)
  enseigneVerticale(F - 0.95, 13.2, 2.4, Z.hotel)

  // =====================================================================================
  // B · LE YOKOCHŌ DANS LA DENT CREUSE (u 6 → 12.4) — la ruelle de yatai (2) sous un échafaudage (1)
  // =====================================================================================
  const vapeurs: [number, number, number][] = []
  {
    const z1 = 12.4
    const z2 = 6
    const len = z1 - z2
    const zc = (z1 + z2) / 2
    // le terrain vague et le mur du fond (l'arrière d'un autre immeuble)
    ajoute(
      T,
      new THREE.PlaneGeometry(14, len),
      mStd(0x15131a),
      F + 7,
      SOL - 0.01,
      zc,
      0,
      -Math.PI / 2
    )
    panneauRue(mArriere, planUV(len, 20, 0, 0, len / 16, 20 / 24), F + 14, 10, zc)
    // quatre yatai adossés au pignon mitoyen, tournés vers nous
    for (let i = 0; i < 4; i++) {
      yatai(F + 1.9 + i * 3.0, z2 + 1.65, 2.6)
      if (i % 2) vapeurs.push([F + 1.9 + i * 3.0, SOL + 1.6, z2 + 1.85])
    }
    for (let i = 0; i < 4; i++)
      guirlande(
        [F + 2 + i * 3.4, 5.6, z1 - 0.2],
        [F + 2 + i * 3.4, 5.6, z2 + 0.2],
        0.7,
        i % 2 ? 0xffe2b8 : 0xff8a6a
      )
    // l'échafaudage d'un chantier qui attend, sur la ligne de façade : passage libre sous 4 m
    echafaudage(F + 1.4, z1 - 0.1, z2 + 0.1, 15, 4)
    lanternes(F + 0.4, 3.6, z1 - 0.2, z2 + 0.2, ['#d8203a'])
    enseigneVerticale(F - 0.45, 6.6, z1 - 0.5, Z.yokocho)
    halo(0xffb46a, 7, F + 6, 2.2, z2 + 2.4, 0.35)
  }

  // =====================================================================================
  // C · LA PAGODE-TOUR QUI SE COIFFE (u 12.4 → 24) (1)
  // =====================================================================================
  const grues: [number, number, number][] = []
  const soudures: [number, number, number][] = []
  {
    const z1 = 24
    const z2 = 12.4
    const w0 = z1 - z2
    const cz = (z1 + z2) / 2
    const cx = F + w0 / 2
    // le socle : quatre niveaux sur rue (le viaduc y entre à 10,2 m), palissade taguée au pied
    const HS = 14.5
    cube(mTour, w0, HS - 2.6, w0, cx, 2.6 + (HS - 2.6) / 2, cz, 2.6 / 24)
    boite(mNuit, w0 - 0.1, 2.6, w0 - 0.1, cx + 0.05, 1.3, cz)
    panneauRue(mPalissade, planUV(w0, 2.6, 0, 0, w0 / 9.6, 1), F, 1.3, cz)
    // la bâche-écran qui annonce la tour finie, entre les enseignes en drapeau et sous le viaduc
    const [pc, pg] = c.toile(1024, 960)
    {
      const W = 1024
      const H = 960
      const gr = pg.createLinearGradient(0, 0, W, H)
      gr.addColorStop(0, '#0a1430')
      gr.addColorStop(1, '#3a0a2a')
      pg.fillStyle = gr
      pg.fillRect(0, 0, W, H)
      // la tour finie : sept étages qui rétrécissent, chacun coiffé d'un toit courbe néon
      const cx2 = W * 0.24
      let y = H - 40
      for (let k = 0; k < 7; k++) {
        const w = 360 - k * 38
        const h = k === 0 ? 150 : 88
        pg.strokeStyle = '#e8c070'
        pg.lineWidth = 4
        pg.strokeRect(cx2 - w / 2 + 26, y - h, w - 52, h)
        y -= h
        pg.strokeStyle = '#ff3b6a'
        pg.lineWidth = 6
        pg.beginPath()
        pg.moveTo(cx2 - w / 2 - 10, y - 18)
        pg.quadraticCurveTo(cx2 - w / 2 + 26, y + 4, cx2, y - 22)
        pg.quadraticCurveTo(cx2 + w / 2 - 26, y + 4, cx2 + w / 2 + 10, y - 18)
        pg.stroke()
        y -= 10
      }
      pg.strokeStyle = '#e8c070'
      pg.lineWidth = 4
      pg.beginPath()
      pg.moveTo(cx2, y - 10)
      pg.lineTo(cx2, y - 60)
      pg.stroke()
      pg.textAlign = 'center'
      const tx = W * 0.71
      pg.fillStyle = '#ffffff'
      pg.font = 'bold 66px Bahnschrift'
      pg.fillText('BIENTÔT ICI', tx, 170)
      pg.fillStyle = '#ff2fa0'
      pg.font = 'bold 96px Bahnschrift'
      pg.fillText('AUTOWIN', tx, 300, W * 0.5)
      pg.fillText('TOWER', tx, 400, W * 0.5)
      pg.fillStyle = '#2ee8ff'
      pg.font = '38px Consolas'
      pg.fillText('2031 · 7 TOITS · 88 ÉTAGES', tx, 480, W * 0.52)
      pg.fillStyle = '#e8c070'
      pg.font = 'bold 120px ' + POLICE_JP
      pg.fillText('自動塔', tx, 660, W * 0.5)
      pg.font = 'bold 64px ' + POLICE_JP
      pg.fillText('建設中', tx, 760, W * 0.5)
      sceau(pg, tx + 150, 800, 90, '自動')
    }
    panneauRue(bacheEcran(c.tex(pc)), new THREE.PlaneGeometry(6.4, 6), F - 0.06, 6, 17.6)
    halo(0xff2fa0, 9, F - 1, 6, 17.6, 0.16)
    // le toit du socle et ses lanternes, coupées devant l'entrée du viaduc
    let y = HS
    toitPagode(cx, cz, y, w0)
    lanternes(F - 0.8, y - 0.6, z1 - 0.2, 22.2, ['#fff1d6'], false)
    lanternes(F - 0.8, y - 0.6, 17.8, z2 + 0.2, ['#fff1d6'], false)
    // trois étages qui rétrécissent, chacun coiffé de son toit courbe et de ses lanternes
    ;[10.2, 8.8, 7.4].forEach((w, k) => {
      const h = 4.2
      cube(mTour, w, h, w, cx, y + h / 2, cz, y / 24)
      toitPagode(cx, cz, y + h, w)
      lanternes(
        cx - w / 2 - 0.9,
        y + h - 0.6,
        cz + w / 2,
        cz - w / 2,
        k % 2 ? ['#d8203a'] : ['#fff1d6'],
        false
      )
      y += h
    })
    // deux dalles nues, leur filet, la soudure ; la grue hisse le toit suivant (animée plus bas)
    const top = carcasse(cx - 2.8, cz + 2.8, cz - 2.8, y, 2, 5.6)
    grues.push([cx + 1, top + 0.2 + 4.5 + 0.4, cz])
    soudures.push([cx - 2.4, y + 3.5, cz - 1.5])
  }

  // =====================================================================================
  // D · L'IZAKAYA (u 24 → 29.5) et E · LA MACHIYA AUX DISTRIBUTEURS (u 29.5 → 35) (2)
  // =====================================================================================
  machiya({
    z1: 29.5,
    z2: 24,
    h: 8.5,
    rise: 2.6,
    noren: true,
    lant: ['#d8203a', '#d8203a', '#fff1d6']
  })
  immeuble({ z1: 35, z2: 29.5, h: 11.5, mf: mMaison, pignon: mArriere, base: 3.6, profondeur: 11 })
  // débord côté izakaya (plus basse) seulement : de l'autre côté, il sortirait devant le pignon mitoyen
  toitCourbe(F, 34.4, 29.5, 11.5, 11, 3)
  // auvent écourté : l'enseigne en drapeau de u 29,8 à 31,3 descend jusqu'à 3,6 m
  boite(tuile, 1.2, 0.12, 3.4, F - 0.5, 3.75, 33.3)
  panneauRue(mNuit, new THREE.PlaneGeometry(5.5, 3.6), F, 1.8, 32.25)
  distributeurs(F - 0.86, 34.4)
  lanternes(F - 1.3, 7.4, 34.8, 31.6, ['#fff1d6', '#d8203a'])

  // =====================================================================================
  // LA FUSION : une géométrie par matière pour toutes les copies (les pièces unies réunies en une
  // matière à couleurs par sommet) ; les halos, eux, sont recopiés
  // =====================================================================================
  const seau = (m: THREE.Material): THREE.Material => {
    const s = m as THREE.MeshStandardMaterial
    if (m === tuile || s.map || s.alphaTest) return m
    if ((m as THREE.MeshBasicMaterial).isMeshBasicMaterial) return uniBasic
    if (s.isMeshStandardMaterial) return uniStd
    return m
  }
  /** Fusionne les maillages de `racine` (au repère d'origine) par matière, recopiés à chaque décalage en z. */
  function fusionner(
    racine: THREE.Object3D,
    decalages: number[]
  ): Map<THREE.Material, THREE.BufferGeometry> {
    racine.updateMatrixWorld(true)
    const seaux = new Map<THREE.Material, { g: THREE.BufferGeometry; couleur: THREE.Color }[]>()
    const fixes: THREE.Mesh[] = []
    racine.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      const source = m.material as THREE.MeshStandardMaterial
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()
      if (!g.attributes.normal) g.computeVertexNormals()
      g.applyMatrix4(m.matrixWorld)
      const cle = seau(source)
      const liste = seaux.get(cle) ?? []
      liste.push({ g, couleur: source.color ?? new THREE.Color(1, 1, 1) })
      seaux.set(cle, liste)
      fixes.push(m)
    })
    for (const m of fixes) m.removeFromParent()
    new Set(fixes.map((m) => m.geometry)).forEach((g) => g.dispose())
    const resultat = new Map<THREE.Material, THREE.BufferGeometry>()
    for (const [matiere, parties] of seaux) {
      const teinte = matiere === uniStd || matiere === uniBasic
      const total =
        parties.reduce((n, p) => n + p.g.attributes.position.count, 0) * decalages.length
      const pos = new Float32Array(total * 3)
      const nor = new Float32Array(total * 3)
      const uvs = new Float32Array(total * 2)
      const col = teinte ? new Float32Array(total * 3) : null
      let k = 0
      for (const dz of decalages)
        for (const { g, couleur } of parties) {
          const p = g.attributes.position.array
          const n = g.attributes.normal.array
          const uv = g.attributes.uv?.array
          const count = g.attributes.position.count
          for (let i = 0; i < count; i++) {
            const j = k + i
            pos[j * 3] = p[i * 3]
            pos[j * 3 + 1] = p[i * 3 + 1]
            pos[j * 3 + 2] = p[i * 3 + 2] + dz
            nor[j * 3] = n[i * 3]
            nor[j * 3 + 1] = n[i * 3 + 1]
            nor[j * 3 + 2] = n[i * 3 + 2]
            if (uv) {
              uvs[j * 2] = uv[i * 2]
              uvs[j * 2 + 1] = uv[i * 2 + 1]
            }
            if (col) {
              col[j * 3] = couleur.r
              col[j * 3 + 1] = couleur.g
              col[j * 3 + 2] = couleur.b
            }
          }
          k += count
        }
      parties.forEach((p) => p.g.dispose())
      const G = new THREE.BufferGeometry()
      G.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      G.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
      G.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
      if (col) G.setAttribute('color', new THREE.BufferAttribute(col, 3))
      G.computeBoundingSphere()
      resultat.set(matiere, G)
    }
    return resultat
  }
  const decalages = Array.from({ length: c.copies }, (_, r) => c.Z0 + r * c.P)
  for (const [matiere, G] of fusionner(T, decalages)) {
    const fusion = new THREE.Mesh(G, matiere)
    fusion.name = 'rangee'
    c.decor.add(fusion)
  }

  // ---------- les grues : une flèche par copie, toutes dessinées en instances ----------
  const fleche = new THREE.Group()
  // le mât tourne avec la flèche : une boîte carrée qui pivote sur son axe ne se voit presque pas
  cube(mGrue, 1, 4.5, 1, 0, -2.65, 0, 0, 1.6, 1.6, fleche)
  cube(mGrue, 1, 1, 26, 0, 0, 9, 0, 1.6, 1.6, fleche)
  ajoute(fleche, uni(new THREE.BoxGeometry(1.4, 1.4, 2.2), UV_GRUE.sombre), mGrue, 0, -0.4, -6)
  ajoute(fleche, uni(new THREE.BoxGeometry(1.4, 1.2, 1.4), UV_GRUE.jaune), mGrue, 0.9, -1, 0)
  ajoute(fleche, uni(new THREE.BoxGeometry(0.04, 7, 0.04), UV_GRUE.sombre), mGrue, 0, -4, 14)
  {
    // le toit de pagode suivant, pendu au câble, et son néon
    const r = (5.4 / 2 + 1.1) / Math.SQRT1_2
    const pts = [
      [r, 0.6],
      [r * 0.93, 0.0],
      [r * 0.72, 0.28],
      [r * 0.45, 0.95],
      [0.15, 1.5]
    ].map(([a, b]) => new THREE.Vector2(a, b))
    ajoute(
      fleche,
      uni(new THREE.LatheGeometry(pts, 4), UV_GRUE.sombre),
      mGrue,
      0,
      -7.8,
      14,
      Math.PI / 4
    )
    const d = r * Math.SQRT1_2
    const L = r * Math.SQRT2
    ajoute(fleche, uni(new THREE.BoxGeometry(0.06, 0.06, L), UV_GRUE.rose), mGrue, -d, -7.2, 14)
    ajoute(fleche, uni(new THREE.BoxGeometry(L, 0.06, 0.06), UV_GRUE.rose), mGrue, 0, -7.2, 14 + d)
  }
  const poses = decalages.flatMap((dz) => grues.map(([x, y, z]) => new THREE.Vector3(x, y, z + dz)))
  const instancier = (racine: THREE.Object3D): THREE.InstancedMesh[] =>
    [...fusionner(racine, [0])].map(([matiere, G]) => {
      const im = new THREE.InstancedMesh(G, matiere, poses.length)
      // la flèche pivote : sa sphère englobante changerait à chaque image
      im.frustumCulled = false
      im.name = 'rangee-grue'
      c.decor.add(im)
      return im
    })
  const partiesFleche = instancier(fleche)
  const feux = poses.map(() => [
    c.glow(0xff2a2a, 1.6, 0, 0, 0, 0.9, c.decor),
    c.glow(0xff2a2a, 1.6, 0, 0, 0, 0.9, c.decor)
  ])
  const mF = new THREE.Matrix4()
  const bout = new THREE.Vector3()
  const poserGrues = (t: number): void => {
    poses.forEach((p, k) => {
      mF.makeRotationY(0.4 + Math.sin(t * 0.08 + k * 1.7) * 0.9).setPosition(p)
      partiesFleche.forEach((im) => im.setMatrixAt(k, mF))
      const allume = Math.sin(t * 2.2 + k) > 0.5 ? 0.95 : 0.05
      feux[k][0].position.copy(bout.set(0, 0.6, 22).applyMatrix4(mF))
      feux[k][0].material.opacity = allume
      feux[k][1].position.copy(bout.set(0, 1.2, 0).applyMatrix4(mF))
      feux[k][1].material.opacity = 0.95 - allume
    })
    for (const im of partiesFleche) im.instanceMatrix.needsUpdate = true
  }
  poserGrues(0)

  // les halos fixes, une copie de la travée chacun ; la soudure et la vapeur, posées dans chaque copie
  const travees = decalages.map((_, r) => (r === 0 ? T : T.clone()))
  const eclairs: THREE.Sprite[] = []
  const fumees: { s: THREE.Sprite; ph: number; y: number }[] = []
  decalages.forEach((dz, r) => {
    const copie = travees[r]
    copie.position.z = dz
    c.decor.add(copie)
    for (const [x, y, z] of soudures) eclairs.push(c.glow(0xcfe3ff, 2.4, x, y, z, 0, copie))
    vapeurs.forEach(([x, y, z], k) =>
      fumees.push({
        s: c.glow(0xcfd6e8, 1.2, x, y, z, 0.2, copie),
        ph: k / vapeurs.length + r * 0.13,
        y
      })
    )
  })

  return {
    animer(t) {
      uTemps.value = t
      poserGrues(t)
      eclairs.forEach((s, i) => {
        const u = t + i * 2.3
        s.material.opacity =
          Math.sin(u * 23) * Math.sin(u * 7.3) > 0.3 && Math.sin(u * 0.9) > -0.2 ? 0.95 : 0
      })
      for (const f of fumees) {
        const k = (t * 0.25 + f.ph) % 1
        f.s.position.y = f.y + k * 2.4
        f.s.scale.setScalar(0.8 + k * 1.8)
        f.s.material.opacity = 0.22 * (1 - k)
      }
    }
  }
}
