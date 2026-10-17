import * as THREE from 'three'

/*
 * LES VOITURES DE L'AVENUE : TOUTES DIFFÉRENTES, ET UNE GARÉE (conv-320).
 *
 * Demande de l'utilisateur : « refais les voitures du fond d'écran de l'accueil pour qu'elles soient
 * toutes différentes et mets en une garée avec un style futuriste top qualité comme les piétons ».
 *
 * Avant : deux voitures taillées dans le MÊME profil extrudé (une boîte noire biseautée) et une moto
 * faite d'un pavé et d'une capsule. Maintenant, cinq véhicules qui ne se ressemblent pas :
 *   - « Lame », hypercar noir chromé, une lame de phare cyan qui fait le tour du nez (file de droite) ;
 *   - « Bloc », fourgon blindé à facettes graphite, barre ambre pleine largeur (file de gauche) ;
 *   - « Flottante », berline volante magenta sans roues, quatre réacteurs bleus (file de gauche) ;
 *   - « Cycle », moto carénée rouge à roues sans moyeu, pilote caché sous la bulle (file de droite) ;
 *   - « Nacre », GT nacrée GARÉE le long du trottoir de droite, branchée à sa borne, warnings ambre.
 *
 * POURQUOI DU CODE ET PAS DES FICHIERS, comme la foule : aucun modèle de voiture futuriste de cette
 * qualité n'est libre de droits et téléchargeable sans compte (recherche du 2026-10-17 : le seul
 * candidat, CarConcept des exemples Khronos, pèse 10 Mo, porte des logos et n'a qu'une forme). Les
 * carrosseries ne sont donc PAS des primitives assemblées (le reproche fait aux anciens bonshommes,
 * conv-301) : chacune est UNE surface continue, tirée de sections transversales (des superellipses)
 * interpolées sur la longueur — la façon dont on dessine une carrosserie —, avec ses vitres, son bas
 * de caisse sombre et ses lames de lumière posées SUR la surface.
 *
 * LA PEINTURE REFLÈTE LA VILLE : vernis (clearcoat) et carte d'environnement néon peinte par code,
 * préfiltrée une fois (PMREM). Elle n'est donnée qu'aux matières des voitures : le reste de la rue
 * garde ses programmes. Toutes les matières « physiques » ont les mêmes options, donc UN programme.
 *
 * CE QUE ÇA COÛTE, mesuré au banc le 2026-10-17 (vrais modules, fenêtre Electron cachée, 3 lancements
 * alternés) : construction des cinq véhicules 96 à 103 ms, carte d'environnement comprise ; la rue
 * apparaît ~0,7 s plus tard (1,56 s → 2,25 s entre `cree` et `rue-visible`), le temps de compiler en
 * tâche de fond ce programme et sa version « reflet » — sans gel, la page reste vivante. Une peinture
 * « standard » sans vernis ne gagne que 0,1 à 0,25 s : c'est le programme à reflets qui coûte.
 *
 * AUCUNE LUMIÈRE AJOUTÉE : le nombre de lumières fait partie de la clé de chaque programme (voir
 * « HUIT LUMIÈRES CALCULÉES » dans home-decor-avenue.ts). Phares, feux, warnings et réacteurs sont
 * peints par des halos et des traînées sur la chaussée mouillée, comme avant.
 */

type Halo = (
  color: THREE.ColorRepresentation,
  size: number,
  x: number,
  y: number,
  z: number,
  op?: number,
  parent?: THREE.Object3D
) => THREE.Sprite
type Trainee = (
  color: THREE.ColorRepresentation,
  w: number,
  l: number,
  op: number,
  parent: THREE.Object3D
) => THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
type Emettre = (
  x: number,
  y: number,
  z: number,
  vx: number,
  vy: number,
  vz: number,
  vie: number,
  c: THREE.Color,
  grav?: number,
  rebond?: number,
  sol?: number
) => void

/** Ce que l'avenue prête aux voitures : sa scène, son moteur, ses halos et ses gouttes. */
export interface ContexteVoitures {
  scene: THREE.Scene
  renderer: THREE.WebGLRenderer
  glow: Halo
  trainee: Trainee
  emettre: Emettre
  toile: (w: number, h: number) => [HTMLCanvasElement, CanvasRenderingContext2D]
  tex: (c: HTMLCanvasElement) => THREE.CanvasTexture
  /** Le halo radial de l'avenue, réutilisé pour les flaques de lumière posées au sol. */
  GLOW: THREE.Texture
  TROTTOIR: number
}

/** Vitesse des véhicules qui passent, en m/s, et la portion d'avenue où ils roulent. */
export const CIRCULATION = { vitesse: 22, depuis: -170, jusqua: 18 } as const

/**
 * LA VOITURE GARÉE : le long du trottoir de droite, dans le sens de la file (on voit son arrière et
 * son flanc gauche en approchant). `zp` est sa place dans la boucle des lieux (70 m, comme le deal) :
 * au départ elle est 12 m devant la caméra, et elle reste toujours 12 m AU-DELÀ du deal — elle ne
 * le cache jamais. `x` laisse ses roues à 2 cm de la bordure (qui commence à 3,88 m).
 */
export const GAREE = { x: 2.9, zp: -37, demiLargeur: 0.95 } as const

/** Les files : la droite s'éloigne (sens 1), la gauche vient vers nous (sens -1). */
export const FILES = {
  lame: { x: 0.92, sens: 1 },
  cycle: { x: 1.3, sens: 1 },
  bloc: { x: -2.0, sens: -1 },
  flottante: { x: -1.9, sens: -1 }
} as const

/**
 * Une section transversale le long de la caisse :
 * z (avant négatif), demi-largeur, bas, hauteur d'épaule (là où la caisse est la plus large),
 * haut, exposant de la superellipse (2 = ovale, 6 = carré arrondi), rentrée du haut (tumblehome).
 */
export type Cle = readonly [
  z: number,
  w: number,
  yb: number,
  ys: number,
  yt: number,
  n: number,
  tb: number
]

export interface Forme {
  cles: readonly Cle[]
  /** Stations sur la longueur, points par section. */
  S: number
  R: number
  /** Lissée (Catmull-Rom, normales fondues) ou à facettes (interpolation droite, faces planes). */
  lisse: boolean
  /** La vitre : de z0 à z1, au-dessus de la hauteur relative `seuil`, sous `toit` (au-delà, la tôle reprend). */
  vitre: { z0: number; z1: number; seuil: number; toit: number; arrondi: number }
  /** Sous cette hauteur relative, le bas de caisse sombre. */
  bas: number
}

// ---------- LES CINQ FORMES ----------

/** Hypercar en coin : nez au ras du sol, cockpit avancé, poupe coupée net. */
const LAME: Forme = {
  cles: [
    [-2.36, 0.3, 0.3, 0.38, 0.42, 2.4, 0],
    [-2.27, 0.74, 0.21, 0.4, 0.5, 3, 0],
    [-1.95, 0.92, 0.17, 0.46, 0.6, 3.4, 0.05],
    [-1.25, 0.95, 0.16, 0.53, 0.7, 3.6, 0.1],
    [-0.6, 0.95, 0.16, 0.57, 0.96, 3.1, 0.34],
    [0.15, 0.95, 0.16, 0.6, 1.1, 3, 0.42],
    [0.95, 0.97, 0.17, 0.62, 0.98, 3.2, 0.36],
    [1.7, 0.95, 0.19, 0.63, 0.79, 4.2, 0.18],
    [2.2, 0.9, 0.23, 0.63, 0.71, 5.2, 0.08],
    [2.37, 0.55, 0.3, 0.6, 0.65, 4, 0.05]
  ],
  S: 72,
  R: 48,
  lisse: true,
  vitre: { z0: -0.78, z1: 1.25, seuil: 0.42, toit: 2, arrondi: 0.35 },
  bas: -0.38
}

/**
 * Fourgon blindé : HUIT GRANDS PANS PLATS par section (une arête vive à l'épaule, une crête au toit),
 * flancs rentrés vers le haut comme une cabine de camion, pare-brise raide, poupe droite.
 */
const BLOC: Forme = {
  cles: [
    [-2.5, 0.95, 0.36, 0.72, 0.96, 9, 0.1],
    [-2.32, 1.05, 0.3, 0.8, 1.12, 9, 0.12],
    [-1.4, 1.06, 0.28, 1.0, 1.42, 9, 0.2],
    [-0.8, 1.06, 0.28, 1.1, 1.88, 9, 0.26],
    [1.95, 1.06, 0.28, 1.1, 1.9, 9, 0.26],
    [2.36, 1.02, 0.3, 1.08, 1.74, 9, 0.24],
    [2.5, 0.98, 0.34, 1.04, 1.62, 9, 0.22]
  ],
  S: 7,
  R: 8,
  lisse: false,
  vitre: { z0: -1.45, z1: 1.1, seuil: 0.3, toit: 0.93, arrondi: 0 },
  bas: -0.9
}

/** Berline volante en goutte : bulle de verre continue, ventre plat, aucun passage de roue. */
const FLOTTANTE: Forme = {
  cles: [
    [-2.6, 0.24, 0.24, 0.31, 0.37, 2.4, 0],
    [-2.42, 0.72, 0.11, 0.34, 0.47, 2.8, 0],
    [-1.8, 0.93, 0.05, 0.39, 0.6, 3, 0.08],
    [-0.9, 0.97, 0.03, 0.41, 0.78, 3, 0.3],
    [-0.2, 0.97, 0.03, 0.43, 1.1, 2.8, 0.45],
    [0.8, 0.96, 0.04, 0.44, 1.08, 2.8, 0.45],
    [1.8, 0.9, 0.07, 0.44, 0.8, 3, 0.3],
    [2.45, 0.6, 0.15, 0.44, 0.6, 3, 0.1],
    [2.6, 0.2, 0.29, 0.41, 0.47, 2.5, 0]
  ],
  S: 72,
  R: 48,
  lisse: true,
  vitre: { z0: -1.02, z1: 1.45, seuil: 0.34, toit: 2, arrondi: 0.45 },
  bas: -0.45
}

/** Moto carénée : un fuseau long et bas de « lightcycle », bulle reculée sur le pilote, roues sans moyeu. */
const CYCLE: Forme = {
  cles: [
    [-1.42, 0.04, 0.5, 0.54, 0.57, 2.2, 0],
    [-1.25, 0.15, 0.36, 0.53, 0.66, 2.6, 0],
    [-0.75, 0.24, 0.3, 0.55, 0.78, 3, 0.1],
    [-0.15, 0.27, 0.28, 0.57, 0.98, 3, 0.3],
    [0.45, 0.27, 0.29, 0.58, 1.02, 3, 0.32],
    [1.0, 0.23, 0.33, 0.6, 0.86, 3, 0.2],
    [1.32, 0.13, 0.42, 0.62, 0.72, 2.6, 0.05],
    [1.45, 0.04, 0.55, 0.62, 0.65, 2.2, 0]
  ],
  S: 64,
  R: 36,
  lisse: true,
  vitre: { z0: -0.5, z1: 0.95, seuil: 0.32, toit: 2, arrondi: 0.35 },
  bas: -0.55
}

/** Grand tourisme : long capot, habitacle reculé, poupe fastback. */
const NACRE: Forme = {
  cles: [
    [-2.45, 0.34, 0.31, 0.44, 0.51, 2.6, 0],
    [-2.3, 0.82, 0.22, 0.49, 0.63, 3.2, 0],
    [-1.6, 0.93, 0.2, 0.55, 0.77, 3.6, 0.06],
    [-0.7, 0.95, 0.2, 0.59, 0.84, 3.6, 0.18],
    [-0.28, 0.95, 0.2, 0.61, 1.05, 3.2, 0.36],
    [0.5, 0.95, 0.2, 0.62, 1.19, 3, 0.44],
    [1.4, 0.95, 0.21, 0.63, 1.0, 3.2, 0.36],
    [2.1, 0.92, 0.24, 0.65, 0.82, 4, 0.18],
    [2.45, 0.58, 0.3, 0.63, 0.7, 4, 0.06]
  ],
  S: 72,
  R: 48,
  lisse: true,
  vitre: { z0: -0.36, z1: 1.62, seuil: 0.5, toit: 0.965, arrondi: 0.32 },
  bas: -0.36
}

export const FORMES = { lame: LAME, bloc: BLOC, flottante: FLOTTANTE, cycle: CYCLE, nacre: NACRE }

// ---------- LA CARROSSERIE : UNE SURFACE TIRÉE DE SES SECTIONS ----------

const catmull = (p0: number, p1: number, p2: number, p3: number, t: number): number =>
  0.5 *
  (2 * p1 +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t)

/** La section à la fraction `u` de la longueur. */
function station(cles: readonly Cle[], u: number, lisse: boolean): number[] {
  const k = u * (cles.length - 1)
  const i = Math.min(cles.length - 2, Math.floor(k))
  const f = k - i
  const s: number[] = []
  for (let c = 0; c < 7; c++) {
    const v1 = cles[i][c]
    const v2 = cles[i + 1][c]
    s.push(
      lisse
        ? catmull(cles[Math.max(0, i - 1)][c], v1, v2, cles[Math.min(cles.length - 1, i + 2)][c], f)
        : v1 + (v2 - v1) * f
    )
  }
  s[1] = Math.max(0.005, s[1])
  return s
}

/** La hauteur relative (-1 en bas, 1 en haut) du point d'angle `a` d'une superellipse d'exposant `n`. */
const hauteurRelative = (a: number, n: number): number => {
  const s = Math.sin(a)
  return Math.sign(s) * Math.abs(s) ** (2 / n)
}

/** Le point d'angle `a` de la section `s`, gonflé de `gonfle` (pour poser une lame SUR la tôle). */
function pointSection(s: number[], a: number, gonfle: number, out: THREE.Vector3): THREE.Vector3 {
  const [z, w0, yb0, ys, yt0, n, tb] = s
  const w = w0 + gonfle
  const c = Math.cos(a)
  const px = Math.sign(c) * Math.abs(c) ** (2 / n)
  const py = hauteurRelative(a, n)
  if (py >= 0) return out.set(w * px * (1 - tb * py), ys + py * (yt0 + gonfle - ys), z)
  return out.set(w * px * (1 + 0.1 * py), ys + py * (ys - (yb0 - gonfle)), z)
}

export interface Caisse {
  geo: THREE.BufferGeometry
  stations: number[][]
}

/**
 * La caisse : S sections de R points, fermées à l'avant et à l'arrière. Trois groupes de faces :
 * 0 la tôle, 1 la vitre, 2 le bas de caisse. Faces orientées vers l'extérieur (le test le vérifie).
 */
export function carrosserie(f: Forme): Caisse {
  const { S, R } = f
  const stations: number[][] = []
  for (let i = 0; i < S; i++) stations.push(station(f.cles, i / (S - 1), f.lisse))
  const pos: number[] = []
  const v = new THREE.Vector3()
  for (const s of stations)
    for (let j = 0; j < R; j++) {
      pointSection(s, (j / R) * Math.PI * 2, 0, v)
      pos.push(v.x, v.y, v.z)
    }
  // les deux bouts : un sommet au centre de la première et de la dernière section
  const centre = (i: number, dz: number): number => {
    let y = 0
    for (let j = 0; j < R; j++) y += pos[(i * R + j) * 3 + 1]
    pos.push(0, y / R, stations[i][0] + dz)
    return pos.length / 3 - 1
  }
  const cAv = centre(0, -0.012)
  const cAr = centre(S - 1, 0.012)

  const { z0, z1, seuil, toit, arrondi } = f.vitre
  const groupes: number[][] = [[], [], []]
  const matiere = (z: number, py: number): number => {
    if (z > z0 && z < z1) {
      // les coins de la vitre s'arrondissent : le seuil monte près de ses deux bouts
      const bord = arrondi > 0 ? Math.max(0, 1 - Math.min(z - z0, z1 - z) / arrondi) : 0
      if (py > seuil + (1 - seuil) * 0.7 * bord * bord && py < toit) return 1
    }
    return py < f.bas ? 2 : 0
  }
  for (let i = 0; i < S - 1; i++) {
    const zm = (stations[i][0] + stations[i + 1][0]) / 2
    const n = (stations[i][5] + stations[i + 1][5]) / 2
    for (let j = 0; j < R; j++) {
      const a = i * R + j
      const b = i * R + ((j + 1) % R)
      const c = (i + 1) * R + j
      const d = (i + 1) * R + ((j + 1) % R)
      groupes[matiere(zm, hauteurRelative(((j + 0.5) / R) * Math.PI * 2, n))].push(a, b, c, b, d, c)
    }
  }
  for (let j = 0; j < R; j++) {
    const py = hauteurRelative(((j + 0.5) / R) * Math.PI * 2, 2)
    const m = py < f.bas ? 2 : 0
    groupes[m].push(cAv, (j + 1) % R, j)
    groupes[m].push(cAr, (S - 1) * R + j, (S - 1) * R + ((j + 1) % R))
  }

  let geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  if (f.lisse) {
    geo.setIndex(groupes.flat())
  } else {
    // à facettes : chaque triangle garde ses propres sommets, donc sa normale de face
    const plat: number[] = []
    for (const idx of groupes.flat()) plat.push(pos[idx * 3], pos[idx * 3 + 1], pos[idx * 3 + 2])
    geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(plat, 3))
  }
  let debut = 0
  groupes.forEach((g, m) => {
    geo.addGroup(debut, g.length, m)
    debut += g.length
  })
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return { geo, stations }
}

/** Les points d'une ligne posée sur la tôle, à l'angle `a`, de la station i0 à i1 (dans un sens ou l'autre). */
function ligneSurCaisse(
  stations: number[][],
  i0: number,
  i1: number,
  a: number,
  gonfle: number
): THREE.Vector3[] {
  const pts: THREE.Vector3[] = []
  const pas = i1 >= i0 ? 1 : -1
  const der = stations.length - 1
  for (let i = i0; pas > 0 ? i <= i1 : i >= i1; i += pas) {
    const p = pointSection(stations[i], a, gonfle, new THREE.Vector3())
    // les deux sections extrêmes ferment la caisse : la lame passe DEVANT leur tôle, pas dedans
    if (i === 0) p.z -= gonfle * 2
    else if (i === der) p.z += gonfle * 2
    pts.push(p)
  }
  return pts
}

/** L'indice de la dernière station avant `z` (depuis l'avant), ou de la première après (depuis l'arrière). */
const jusquA = (stations: number[][], z: number): number =>
  Math.max(1, stations.findIndex((s) => s[0] > z) - 1)
const depuis = (stations: number[][], z: number): number =>
  Math.min(
    stations.length - 2,
    Math.max(
      0,
      stations.findIndex((s) => s[0] >= z)
    )
  )

// ---------- L'ENVIRONNEMENT QUE REFLÈTE LA PEINTURE ----------

/** Une rue de nuit en panorama : ciel violet, enseignes au niveau des yeux, réverbères au-dessus. */
function environnement(ctx: ContexteVoitures, rnd: () => number): THREE.WebGLRenderTarget {
  const [c, g] = ctx.toile(512, 256)
  const ciel = g.createLinearGradient(0, 0, 0, 256)
  ciel.addColorStop(0, '#1b1030')
  ciel.addColorStop(0.36, '#3a1f58')
  ciel.addColorStop(0.49, '#7a4590')
  ciel.addColorStop(0.53, '#2a1638')
  ciel.addColorStop(0.62, '#0d0812')
  ciel.addColorStop(1, '#040306')
  g.fillStyle = ciel
  g.fillRect(0, 0, 512, 256)
  g.filter = 'blur(1.6px)'
  const neons = ['#ff4fb0', '#3ad8ff', '#9b6bff', '#ffb04a', '#ff2046', '#e9f6ff']
  // les écrans géants et les vitrines : de grands aplats que la tôle renvoie en larges reflets
  for (let i = 0; i < 14; i++) {
    g.globalAlpha = 0.55 + rnd() * 0.35
    g.fillStyle = neons[(i * 5) % neons.length]
    g.fillRect(rnd() * 512, 40 + rnd() * 70, 18 + rnd() * 40, 14 + rnd() * 30)
  }
  for (let i = 0; i < 110; i++) {
    g.globalAlpha = 0.5 + rnd() * 0.5
    g.fillStyle = neons[i % neons.length]
    g.fillRect(rnd() * 512, 60 + rnd() * 70, 3 + rnd() * 34, 2 + rnd() * 9)
  }
  // les réverbères : des taches chaudes au-dessus de la rue, et la ligne claire de l'horizon
  for (let i = 0; i < 12; i++) {
    const x = rnd() * 512
    const y = 18 + rnd() * 40
    const r = g.createRadialGradient(x, y, 0, x, y, 16)
    r.addColorStop(0, 'rgba(255,226,196,1)')
    r.addColorStop(1, 'rgba(255,200,160,0)')
    g.globalAlpha = 0.9
    g.fillStyle = r
    g.fillRect(x - 16, y - 16, 32, 32)
  }
  g.globalAlpha = 0.75
  g.fillStyle = '#ffd6f2'
  g.fillRect(0, 126, 512, 2)
  g.filter = 'none'
  g.globalAlpha = 1
  const t = ctx.tex(c)
  t.mapping = THREE.EquirectangularReflectionMapping
  const pm = new THREE.PMREMGenerator(ctx.renderer)
  const rt = pm.fromEquirectangular(t)
  pm.dispose()
  return rt
}

// ---------- LES VÉHICULES ----------

export interface Roulante {
  nom: string
  g: THREE.Group
  x: number
  sens: 1 | -1
  /** Altitude de vol (0 = sur ses roues). */
  vol: number
  roues: THREE.Object3D[]
  rayon: number
  /** Demi-écart des roues ou des réacteurs : d'où partent les gerbes d'eau. */
  voie: number
}

export interface Flotte {
  roulantes: Roulante[]
  garee: THREE.Group
  /** Avance la circulation et la voiture garée ; rend la secousse que le passage donne à la caméra. */
  animer(t: number, v: number, periode: number, zGaree: number, zCamera: number): number
  liberer(): void
}

export function monterVoitures(ctx: ContexteVoitures): Flotte {
  const { scene, glow, trainee } = ctx
  let s0 = 320
  // Un tirage À PART : celui de l'avenue fixe la place de tout le reste du décor.
  const rnd = (): number => (s0 = (s0 * 16807) % 2147483647) / 2147483647
  const env = environnement(ctx, rnd)

  const physique = (
    color: number,
    metalness: number,
    roughness: number,
    extra: THREE.MeshPhysicalMaterialParameters = {}
  ): THREE.MeshPhysicalMaterial =>
    new THREE.MeshPhysicalMaterial({
      color,
      metalness,
      roughness,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      envMap: env.texture,
      envMapIntensity: 1.7,
      ...extra
    })
  /** Un verre teinté, plus miroir que la tôle, éclairé de l'intérieur par le tableau de bord. */
  const vitrage = (lueur: number): THREE.MeshPhysicalMaterial =>
    physique(0x0a0c16, 0.95, 0.02, { envMapIntensity: 2.6, emissive: lueur })
  const verre = vitrage(0x0a1a2a)
  const basDeCaisse = physique(0x0b0a10, 0.55, 0.5, { clearcoat: 0.25 })
  const pneu = physique(0x0a0a0c, 0, 0.82, { clearcoat: 0.08, clearcoatRoughness: 0.5 })
  const jante = physique(0x16161c, 1, 0.3)
  const brillant = (color: THREE.ColorRepresentation): THREE.MeshBasicMaterial =>
    new THREE.MeshBasicMaterial({ color })

  const tube = (
    pts: THREE.Vector3[],
    rayon: number,
    mat: THREE.Material,
    parent: THREE.Object3D
  ): void => {
    if (pts.length < 2) return
    const courbe = new THREE.CatmullRomCurve3(pts)
    parent.add(new THREE.Mesh(new THREE.TubeGeometry(courbe, pts.length * 3, rayon, 6, false), mat))
  }
  /** Des halos le long d'une lame : la lumière « bave » comme sous la pluie, sans post-traitement. */
  const halos = (
    pts: THREE.Vector3[],
    couleur: THREE.ColorRepresentation,
    taille: number,
    op: number,
    parent: THREE.Object3D,
    pas = 3
  ): THREE.Sprite[] => {
    const s: THREE.Sprite[] = []
    for (let i = 0; i < pts.length; i += pas)
      s.push(glow(couleur, taille, pts[i].x, pts[i].y, pts[i].z, op, parent))
    return s
  }
  /** Une flaque de lumière à plat sur la chaussée (sous un réacteur, sous la voiture garée). */
  const flaque = (
    couleur: THREE.ColorRepresentation,
    l: number,
    p: number,
    op: number,
    parent: THREE.Object3D
  ): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(l, p),
      new THREE.MeshBasicMaterial({
        map: ctx.GLOW,
        color: couleur,
        transparent: true,
        opacity: op,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    )
    m.rotation.x = -Math.PI / 2
    parent.add(m)
    return m
  }

  /** Une roue : pneu, voile sombre et anneau lumineux sur la face extérieure. Axe = x. */
  const roue = (
    r: number,
    l: number,
    anneau: THREE.ColorRepresentation,
    cote: number,
    sansMoyeu = false
  ): THREE.Group => {
    const g = new THREE.Group()
    const ep = l * 0.42
    const p = new THREE.Mesh(new THREE.TorusGeometry(r - ep, ep, 12, 36).rotateY(Math.PI / 2), pneu)
    p.scale.x = l / (2 * ep)
    g.add(p)
    if (!sansMoyeu)
      g.add(
        new THREE.Mesh(
          new THREE.CylinderGeometry(r - ep * 1.05, r - ep * 1.05, l * 0.62, 28).rotateZ(
            Math.PI / 2
          ),
          jante
        )
      )
    // sans moyeu : l'anneau borde le vide au centre ; sinon il court sur le flanc du pneu, dehors
    const a = new THREE.Mesh(
      new THREE.TorusGeometry(
        sansMoyeu ? r - 2 * ep - 0.012 : r - ep,
        sansMoyeu ? 0.022 : 0.014,
        6,
        44
      ).rotateY(Math.PI / 2),
      brillant(anneau)
    )
    a.position.x = sansMoyeu ? 0 : cote * (ep * p.scale.x + 0.004)
    g.add(a)
    return g
  }

  interface Habillage {
    nom: string
    forme: Forme
    peinture: THREE.MeshPhysicalMaterial
    vitre?: THREE.MeshPhysicalMaterial
    /** Lame avant : couleur, angle sur la section, jusqu'où elle remonte les flancs (z). */
    avant: { couleur: number; a: number; z: number; rayon: number }
    arriere: { couleur: number; a: number; z: number; rayon: number }
    /** Un filet de lumière le long des flancs. */
    ceinture?: { couleur: number; a: number; z0: number; z1: number }
    roues?: {
      r: number
      l: number
      x: number
      z: readonly number[]
      anneau: number
      sansMoyeu?: boolean
    }
    /** Les réacteurs d'un véhicule volant : sous le ventre, à la hauteur `y` du dessous de caisse. */
    reacteurs?: { couleur: number; x: number; y: number; z: readonly number[] }
  }

  interface Assemblee {
    g: THREE.Group
    roues: THREE.Object3D[]
    /** Les deux phares (gauche, droite) et les deux feux, en coordonnées du véhicule. */
    phares: THREE.Vector3[]
    feux: THREE.Vector3[]
  }

  function assembler(h: Habillage): Assemblee {
    const g = new THREE.Group()
    g.name = 'vehicule-' + h.nom
    const { geo, stations } = carrosserie(h.forme)
    g.add(new THREE.Mesh(geo, [h.peinture, h.vitre ?? verre, basDeCaisse]))
    // la lame avant fait le tour du nez : flanc droit vers la pointe, puis la pointe vers le flanc gauche
    const kAv = jusquA(stations, h.avant.z)
    const av = [
      ...ligneSurCaisse(stations, kAv, 0, h.avant.a, 0.012),
      ...ligneSurCaisse(stations, 0, kAv, Math.PI - h.avant.a, 0.012)
    ]
    const matAv = brillant(h.avant.couleur)
    tube(av, h.avant.rayon, matAv, g)
    halos(av, h.avant.couleur, 0.42, 0.45, g)
    const kAr = depuis(stations, h.arriere.z)
    const S = stations.length - 1
    const ar = [
      ...ligneSurCaisse(stations, kAr, S, h.arriere.a, 0.012),
      ...ligneSurCaisse(stations, S, kAr, Math.PI - h.arriere.a, 0.012)
    ]
    tube(ar, h.arriere.rayon, brillant(h.arriere.couleur), g)
    halos(ar, h.arriere.couleur, 0.5, 0.55, g, 2)
    if (h.ceinture) {
      const c = h.ceinture
      const i0 = depuis(stations, c.z0)
      const i1 = jusquA(stations, c.z1)
      const m = brillant(c.couleur)
      for (const a of [c.a, Math.PI - c.a])
        tube(ligneSurCaisse(stations, i0, i1, a, 0.008), 0.011, m, g)
    }
    const roues: THREE.Object3D[] = []
    if (h.roues) {
      const r = h.roues
      for (const z of r.z)
        for (const cote of r.x > 0 ? [-1, 1] : [0]) {
          const w = roue(r.r, r.l, r.anneau, cote || 1, r.sansMoyeu)
          w.position.set(cote * r.x, r.r, z)
          g.add(w)
          roues.push(w)
        }
    }
    if (h.reacteurs) {
      const rc = h.reacteurs
      for (const z of rc.z)
        for (const cote of [-1, 1]) {
          // la nacelle est noyée dans le ventre : seule sa jupe dépasse, sa tuyère luit dessous
          const nacelle = new THREE.Mesh(
            new THREE.CylinderGeometry(0.17, 0.22, 0.22, 28),
            basDeCaisse
          )
          nacelle.position.set(cote * rc.x, rc.y + 0.06, z)
          g.add(nacelle)
          const tuyere = new THREE.Mesh(
            new THREE.CircleGeometry(0.17, 28).rotateX(Math.PI / 2),
            brillant(rc.couleur)
          )
          tuyere.position.set(cote * rc.x, rc.y - 0.052, z)
          g.add(tuyere)
          glow(rc.couleur, 1.25, cote * rc.x, rc.y - 0.1, z, 0.95, g)
          glow(0xe8f6ff, 0.45, cote * rc.x, rc.y - 0.06, z, 0.9, g)
        }
    }
    // les phares et les feux : aux coins, à 30 % de la lame depuis la pointe (av[kAv] est la pointe)
    const coin = (l: THREE.Vector3[], k: number): THREE.Vector3[] => {
      const i = Math.round(k * 0.7)
      return [l[i].clone(), l[l.length - 1 - i].clone()]
    }
    const phares = coin(av, kAv)
    const feux = coin(ar, S - kAr)
    return { g, roues, phares, feux }
  }

  // ---------- LA CIRCULATION ----------
  const ROUGE = 0xff2046
  const roulantes: Roulante[] = []
  function enCirculation(
    a: Assemblee,
    h: Habillage,
    file: { x: number; sens: 1 | -1 },
    vol: number
  ): void {
    const { g } = a
    // les phares : un halo blanc par côté, et leur faisceau sur la chaussée mouillée, devant
    for (const p of a.phares) glow(0xeef4ff, 1.5, p.x, p.y, p.z - 0.05, 1, g)
    const larg = Math.abs(a.phares[0].x)
    const devant = trainee(0xdfe8ff, Math.max(0.6, larg * 1.6), 10, 0.4, g)
    devant.rotation.z = Math.PI
    devant.position.set(0, 0.02 - vol, a.phares[0].z - 5)
    // les feux : traînée de lumière dans la pluie et reflet rouge sur la chaussée, derrière
    for (const p of a.feux) {
      glow(h.arriere.couleur, 1.2, p.x, p.y, p.z + 0.05, 0.9, g)
      trainee(h.arriere.couleur, 0.08, 8, 0.8, g).position.set(p.x, p.y, p.z + 4)
    }
    trainee(h.arriere.couleur, Math.max(0.4, larg * 1.8), 6, 0.5, g).position.set(
      0,
      0.02 - vol,
      a.feux[0].z + 3
    )
    if (h.reacteurs)
      for (const z of h.reacteurs.z)
        flaque(h.reacteurs.couleur, 2.4, 1.8, 0.7, g).position.set(0, 0.03 - vol, z)
    g.position.z = 600
    g.rotation.y = file.sens > 0 ? 0 : Math.PI
    scene.add(g)
    roulantes.push({
      nom: h.nom,
      g,
      x: file.x,
      sens: file.sens,
      vol,
      roues: a.roues,
      rayon: h.roues?.r ?? 1,
      voie: h.roues ? Math.max(0.15, h.roues.x) : (h.reacteurs?.x ?? 0.7)
    })
  }

  const lame: Habillage = {
    nom: 'lame',
    forme: LAME,
    peinture: physique(0x14151f, 1, 0.3),
    vitre: vitrage(0x06303a),
    avant: { couleur: 0xaef6ff, a: 0.08, z: -1.75, rayon: 0.018 },
    arriere: { couleur: ROUGE, a: 0.2, z: 2.0, rayon: 0.02 },
    ceinture: { couleur: 0x3ae6ff, a: -0.22, z0: -1.6, z1: 1.9 },
    roues: { r: 0.36, l: 0.27, x: 0.79, z: [-1.42, 1.48], anneau: 0x3ae6ff }
  }
  const bloc: Habillage = {
    nom: 'bloc',
    forme: BLOC,
    peinture: physique(0x5d626d, 0.9, 0.38, { clearcoat: 0.3 }),
    vitre: vitrage(0x2a1606),
    avant: { couleur: 0xffc070, a: 0.04, z: -2.35, rayon: 0.024 },
    arriere: { couleur: 0xff3020, a: 0.36, z: 2.42, rayon: 0.026 },
    ceinture: { couleur: 0xffa53a, a: -0.55, z0: -2.0, z1: 2.2 },
    roues: { r: 0.42, l: 0.3, x: 0.88, z: [-1.65, 1.72], anneau: 0xffa53a }
  }
  const flottante: Habillage = {
    nom: 'flottante',
    forme: FLOTTANTE,
    peinture: physique(0x8a1260, 0.65, 0.26),
    vitre: vitrage(0x2c0a24),
    avant: { couleur: 0xffd8ef, a: 0.1, z: -1.9, rayon: 0.017 },
    arriere: { couleur: 0xff2a6a, a: 0.15, z: 2.15, rayon: 0.02 },
    ceinture: { couleur: 0xff4fb0, a: 0.04, z0: -2.1, z1: 2.3 },
    reacteurs: { couleur: 0x7cc4ff, x: 0.58, y: 0.1, z: [-1.55, 1.6] }
  }
  const cycle: Habillage = {
    nom: 'cycle',
    forme: CYCLE,
    peinture: physique(0xa3101f, 0.7, 0.26),
    vitre: vitrage(0x2a0a08),
    avant: { couleur: 0xfff1e6, a: 0.12, z: -1.12, rayon: 0.014 },
    arriere: { couleur: ROUGE, a: 0.25, z: 1.2, rayon: 0.016 },
    ceinture: { couleur: 0xff6a2a, a: -0.1, z0: -1.1, z1: 1.25 },
    roues: { r: 0.4, l: 0.18, x: 0, z: [-1.0, 1.02], anneau: 0xff4a2a, sansMoyeu: true }
  }
  enCirculation(assembler(lame), lame, FILES.lame, 0)
  enCirculation(assembler(bloc), bloc, FILES.bloc, 0)
  enCirculation(assembler(cycle), cycle, FILES.cycle, 0)
  enCirculation(assembler(flottante), flottante, FILES.flottante, 0.5)

  // ---------- LA VOITURE GARÉE : une GT nacrée en charge, warnings allumés ----------
  const nacre: Habillage = {
    nom: 'nacre',
    forme: NACRE,
    peinture: physique(0xb9bdcb, 0.55, 0.22, { clearcoatRoughness: 0.03 }),
    // garée, l'habitacle reste éclairé : la vitre laisse passer une lueur violette
    vitre: vitrage(0x2e1658),
    avant: { couleur: 0xc9a8ff, a: 0.07, z: -1.85, rayon: 0.016 },
    arriere: { couleur: 0xb06cff, a: 0.18, z: 2.05, rayon: 0.018 },
    ceinture: { couleur: 0xb07cff, a: -0.3, z0: -2.0, z1: 2.1 },
    roues: { r: 0.37, l: 0.26, x: 0.8, z: [-1.55, 1.5], anneau: 0xb07cff }
  }
  const gt = assembler(nacre)
  const garee = gt.g
  garee.position.set(GAREE.x, 0, 600)
  // sous la caisse, la lueur violette sur l'asphalte mouillé
  flaque(0x9a5cff, 3.2, 6, 0.32, garee).position.set(0, 0.025, 0)
  // les feux de détresse : quatre éclats ambre aux coins, qui battent ensemble
  const warnings = [...gt.phares, ...gt.feux].map((p) =>
    glow(0xffa328, 1.1, p.x, p.y, p.z, 0, garee)
  )
  // la borne de recharge, sur le trottoir, et son câble qui pulse
  const borne = new THREE.Group()
  borne.position.set(4.45 - GAREE.x, ctx.TROTTOIR, 0.7)
  garee.add(borne)
  const fut = new THREE.Mesh(new THREE.BoxGeometry(0.26, 1.3, 0.2), jante)
  fut.position.y = 0.65
  borne.add(fut)
  const filet = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.05, 0.03), brillant(0x3ae6ff))
  filet.position.set(-0.135, 0.62, 0)
  borne.add(filet)
  {
    const [c, g] = ctx.toile(128, 64)
    g.fillStyle = '#04121a'
    g.fillRect(0, 0, 128, 64)
    g.font = 'bold 30px Consolas, monospace'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.shadowColor = '#3ae6ff'
    g.shadowBlur = 10
    g.fillStyle = '#9ff4ff'
    g.fillText('78%', 64, 34)
    const ecran = new THREE.Mesh(
      new THREE.PlaneGeometry(0.2, 0.1),
      new THREE.MeshBasicMaterial({ map: ctx.tex(c) })
    )
    ecran.rotation.y = -Math.PI / 2
    ecran.position.set(-0.131, 1.05, 0)
    borne.add(ecran)
  }
  glow(0x3ae6ff, 0.7, borne.position.x - 0.14, ctx.TROTTOIR + 1.05, 0.7, 0.6, garee)
  const cableMat = new THREE.MeshBasicMaterial({ color: 0x3ae6ff })
  tube(
    [
      new THREE.Vector3(0.93, 0.78, 1.25),
      new THREE.Vector3(1.05, 0.35, 1.1),
      new THREE.Vector3(1.35, ctx.TROTTOIR + 0.06, 0.85),
      new THREE.Vector3(borne.position.x - 0.15, ctx.TROTTOIR + 0.45, 0.72),
      new THREE.Vector3(borne.position.x - 0.13, ctx.TROTTOIR + 0.85, 0.7)
    ],
    0.018,
    cableMat,
    garee
  )
  scene.add(garee)

  const EAU = new THREE.Color(0x9fc4ff)
  const BLEU_CABLE = new THREE.Color(0x3ae6ff)
  const V = CIRCULATION.vitesse
  return {
    roulantes,
    garee,

    animer(t, v, periode, zGaree, zCamera) {
      let secousse = 0
      const n = roulantes.length
      roulantes.forEach((ve, i) => {
        const age = (((t - (i * periode) / n) % periode) + periode) % periode
        const z = ve.sens > 0 ? 16 - age * V : CIRCULATION.depuis + age * V
        if (z < CIRCULATION.depuis || z > CIRCULATION.jusqua) {
          ve.g.position.z = 600
          return
        }
        if (ve.vol > 0) {
          // la berline volante tangue un peu sur ses réacteurs
          ve.g.position.set(ve.x, ve.vol + 0.06 * Math.sin(t * 2.3 + i), z)
          ve.g.rotation.z = 0.025 * Math.sin(t * 1.7 + i)
        } else ve.g.position.set(ve.x, 0, z)
        const roule = -(age * V) / ve.rayon
        for (const r of ve.roues) r.rotation.x = roule
        if (z < 14 && z > -60)
          for (let k = 0; k < 6; k++) {
            const cote = rnd() < 0.5 ? -1 : 1
            ctx.emettre(
              ve.x + cote * (ve.voie + rnd() * 0.25),
              0.05,
              z + ve.sens * 1.4,
              cote * (ve.vol > 0 ? 1.5 + rnd() * 2.5 : rnd() * 0.8),
              1 + rnd() * 2.4,
              ve.sens * (4 + rnd() * 6) + v,
              0.55,
              EAU,
              9.8,
              0
            )
          }
        secousse = Math.max(secousse, Math.max(0, 1 - Math.abs(z - zCamera) / 9) * 0.06)
      })
      // la GT garée suit la rue ; ses warnings battent à 1,6 Hz, son câble pulse
      garee.position.z = zGaree
      const allume = Math.floor(t * 1.6) % 2 === 0 ? 0.95 : 0
      for (const w of warnings) w.material.opacity = allume
      cableMat.color.copy(BLEU_CABLE).multiplyScalar(0.55 + 0.45 * Math.max(0, Math.sin(t * 3.2)))
      return secousse
    },

    liberer() {
      env.dispose()
    }
  }
}
