import * as THREE from 'three'
import { regrouperEnInstances } from './decor-instances'

/**
 * LA TOILE ÉLECTRIQUE : le ciel de l'avenue devient un filet de câbles.
 *
 * Demande de l'utilisateur (conv-311) : « /draft des éléments plus trash et chaotiques pour le fond
 * d'écran d'acceuil », puis le mélange « 1+3+4 » (Dépotoir, Jungle de câbles, Glitch holo), et enfin
 * « je choisi que tu implémente le 3 » : la variante 3 · Toile électrique du brouillon
 * `.autowin-tmp/draft-trash/mix.js` (`VARIANTES[2]`). Ce qu'elle montre :
 *   - des dizaines de câbles affaissés au-dessus de l'avenue, tendus des poteaux côté ville à la façade ;
 *   - des câbles arrachés qui se balancent et crachent des étincelles par le bout ;
 *   - cinq pubs holo pendues aux fils, qui se balancent sous la pluie ;
 *   - un arc électrique par salves dans une flaque, au bord de la chaussée ;
 *   - deux enseignes en drapeau qui lâchent ;
 *   - les hologrammes NEURO+ et AUTOWIN corrompus, trois fenêtres d'erreur qui surgissent, des pixels
 *     morts qui tombent ;
 *   - au sol presque rien : quelques sacs, cinq cartons, un néon tombé qui clignote, des papiers au vent.
 *
 * CE QUI EST REPRIS TEL QUEL : les positions, les quantités, les couleurs, les textes et les
 * animations du brouillon.
 *
 * SANS GUIRLANDES : le brouillon accrochait huit guirlandes clignotantes aux câbles ; l'utilisateur
 * les a retirées une fois la toile branchée (conv-311 : « enleve les guirlandes lumineuses des fils
 * electriques »). Les fils restent nus.
 *
 * CE QUI CHANGE, parce qu'un fond n'est pas une démo :
 *   - ce qui tient à la rue est construit pour UNE travée de 35 m, puis posé dans chacune des copies
 *     du décor : il défile avec la marche, comme la façade ;
 *   - AUCUNE LUMIÈRE AJOUTÉE. Le brouillon éclairait l'étincelle et le néon tombé par deux lumières
 *     ponctuelles ; chaque lumière de plus alourdit TOUTES les matières de la rue, et le nombre de
 *     lumières a déjà figé l'Accueil (conv-301, 22 lumières → 8). L'éclat est porté par des halos ;
 *   - les câbles d'une travée sont FUSIONNÉS en un seul maillage : un appel de dessin par travée au
 *     lieu de cent cinquante ;
 *   - le hasard a sa propre graine : la toile ne déplace ni la ville ni la façade, tirées avant elle.
 */

/** Les réglages de la variante 3 · Toile électrique, recopiés du brouillon (`VARIANTES[2]`). */
export const TOILE = {
  /** Câbles tendus depuis chaque point d'attache des poteaux vers la façade. */
  parPoint: 6,
  /** Câbles qui courent le long de la façade. */
  facade: 26,
  /** Câbles arrachés qui pendent et crachent des étincelles. */
  pendus: 5,
  /** Multiplicateur de la fréquence des étincelles. */
  etincelles: 1.6,
  /** Pubs holo pendues aux fils. */
  pubs: 5,
  /** Enseignes en drapeau qui lâchent (motifs 1 et 2 : HOTEL, RAMEN). */
  lachent: [1, 2] as readonly number[],
  /** Fenêtres d'erreur qui surgissent. */
  fenetres: 3,
  /** Pixels morts qui tombent des hologrammes. */
  pixels: 200,
  /** Le peu qui traîne au sol : 0,35 fois le dépotoir du brouillon. */
  sacs: 0.35,
  cartons: 5,
  papiers: 50
} as const

/** Ce que la toile reprend d'une enseigne du décor. */
export interface EnseigneDeToile {
  box: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  halo: THREE.Sprite
  lum: THREE.PointLight | null
  reflet: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  i: number
}

/** Ce que le décor prête à la toile : ses repères, ses outils de dessin et ses particules. */
export interface ContexteToile {
  /** La scène : ce qui ne défile pas (papiers, fenêtres d'erreur, pixels) y vit. */
  scene: THREE.Scene
  /** Le groupe qui glisse vers nous à chaque pas : chaque travée y est posée. */
  decor: THREE.Group
  camera: THREE.Camera
  /** Longueur d'une travée, et début de la première dans le repère du décor. */
  P: number
  Z0: number
  copies: number
  FACADE: number
  GARDE: number
  TROTTOIR: number
  ROUTE: number
  GLOW: THREE.Texture
  toile: (w: number, h: number) => [HTMLCanvasElement, CanvasRenderingContext2D]
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
  trainee: (
    color: THREE.ColorRepresentation,
    w: number,
    l: number,
    op: number,
    parent: THREE.Object3D
  ) => THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  emettre: (
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
  enseignes: EnseigneDeToile[]
  /**
   * L'éclaircie : une direction du ciel devant laquelle le filet s'éclaircit — le vaisseau mère
   * (conv-319 : « j'éclaircis les câbles devant le vaisseau »). Absente, la toile reste entière.
   */
  eclaircie?: { direction: THREE.Vector3; rayon: number }
  /**
   * La hauteur du mur sur rue à l'abscisse `u` d'une travée (conv-1037) : depuis que la rangée de
   * droite est en volumes, un câble s'accroche SOUS le toit du lot qu'il touche, pas dans le vide
   * au-dessus d'une machiya basse. Absente, le mur fait 24 m partout, comme le plan peint d'avant.
   */
  hauteurMur?: (u: number) => number
}

/**
 * Comment le filet s'éclaircit devant le vaisseau. La rue défile : chaque travée finit par passer
 * devant lui, si bien qu'aucun câble précis ne peut être retiré une fois pour toutes. C'est donc la
 * DIRECTION qui s'éclaircit : vu de la caméra, dans un cône du rayon apparent de la jante (`interieur`
 * = 1 : toute la largeur de la roue), un câble sur quatre reste (`garde`) ; ils reviennent tous, en
 * fondu, jusqu'à `exterieur` × ce rayon. À 0,8, les bords de la roue gardaient tous leurs câbles. Chaque câble tire une fois son numéro (`aTirage`) : il est gardé ou effacé en entier,
 * jamais en pointillé.
 */
export const ECLAIRCIE = { garde: 0.25, interieur: 1.0, exterieur: 1.45 } as const

/** Le numéro d'un câble, entre 0 et 1, tiré de son rang : la toile garde sa propre graine intacte. */
const tirage = (rang: number): number => {
  const x = Math.sin(rang * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

/** Éclaircit les câbles d'une matière dans la direction donnée (voir `ECLAIRCIE`). */
export function eclaircirFils(
  mat: THREE.MeshStandardMaterial,
  eclaircie: { direction: THREE.Vector3; rayon: number }
): void {
  const uniformes = {
    uEclDir: { value: eclaircie.direction.clone().normalize() },
    uEclCos: {
      value: new THREE.Vector2(
        Math.cos(eclaircie.rayon * ECLAIRCIE.exterieur),
        Math.cos(eclaircie.rayon * ECLAIRCIE.interieur)
      )
    }
  }
  mat.onBeforeCompile = (sh): void => {
    Object.assign(sh.uniforms, uniformes)
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aTirage;\nvarying float vTirage;\nvarying vec3 vMondeFil;'
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvTirage = aTirage;\nvMondeFil = (modelMatrix * vec4(transformed, 1.0)).xyz;'
      )
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uEclDir;\nuniform vec2 uEclCos;\nvarying float vTirage;\nvarying vec3 vMondeFil;'
      )
      .replace(
        'void main() {',
        'void main() {\n' +
          '  float eclC = dot(normalize(vMondeFil - cameraPosition), uEclDir);\n' +
          `  if (vTirage > mix(${ECLAIRCIE.garde.toFixed(2)}, 1.0, 1.0 - smoothstep(uEclCos.x, uEclCos.y, eclC))) discard;`
      )
  }
  mat.customProgramCacheKey = (): string => 'toile-eclaircie'
}

export interface ToileElectrique {
  /** Une image : `v` est la vitesse de la marche, que suivent ce qui flotte et ce qui jaillit. */
  maj(t: number, dt: number, v: number): void
}

/** Ce que la caméra voit de l'avenue, en profondeur : on n'anime ni n'émet hors de cette bande. */
const VU = { loin: -45, pres: 12 }

const hash = (n: number): number => {
  const x = Math.sin(n * 127.1 + 3.7) * 43758.5453
  return x - Math.floor(x)
}

const HOLO_FS = [
  'uniform sampler2D uMap;uniform float uT;uniform float uS;uniform float uTaux;varying vec2 vU;',
  'float h(float x){return fract(sin(x*127.1+uS*311.7)*43758.5453);}',
  'void main(){vec2 u=vU;float tb=floor(uT*9.0);float gl=step(uTaux,h(tb));',
  'float bande=floor(u.y*22.0);float dec=(h(bande+tb*7.0)-0.5)*0.35*gl*step(0.45,h(bande*3.1+tb));',
  'u.x=fract(u.x+dec);float ca=0.006+0.035*gl;',
  'vec3 c=vec3(texture2D(uMap,u+vec2(ca,0.0)).r,texture2D(uMap,u).g,texture2D(uMap,u-vec2(ca,0.0)).b);',
  'float blocs=step(0.9,h(floor(u.x*14.0)+floor(u.y*7.0)*14.0+tb*3.0))*gl;',
  'c=mix(c,vec3(h(tb+bande),0.2,h(bande+1.0)),blocs);',
  'float scan=0.78+0.22*sin(vU.y*500.0+uT*30.0);float flick=0.8+0.2*h(floor(uT*24.0)+5.0);',
  'float coupure=step(0.06,h(floor(uT*2.5)+11.0));',
  'float bord=smoothstep(0.0,0.02,vU.x)*smoothstep(1.0,0.98,vU.x)*smoothstep(0.0,0.03,vU.y)*smoothstep(1.0,0.97,vU.y);',
  'gl_FragColor=vec4(c*scan*flick*coupure*bord*1.25,1.0);',
  '#include <colorspace_fragment>',
  '}'
].join('\n')
const VS_UV =
  'varying vec2 vU;void main(){vU=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}'

const PUBS_FILS: [string, string, string][] = [
  ['KARAOKÉ', '#ff2fa0', 'sans fin · 24/24'],
  ['MOTEL 2H', '#2ee8ff', 'chambres sans caméra'],
  ['CRÉDIT NEURO', '#ffe066', 'taux 0 % (presque)'],
  ['ROBOT À LOUER', '#c6ff00', 'pas de questions'],
  ['DERNIÈRE CHANCE', '#ff6a00', 'offre valable hier']
]

/** Fusionne des géométries indexées (position et normale) en une seule : un appel de dessin. */
export function fusionner(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let nv = 0
  let ni = 0
  for (const g of geos) {
    nv += g.attributes.position.count
    ni += g.index ? g.index.count : 0
  }
  const pos = new Float32Array(nv * 3)
  const nor = new Float32Array(nv * 3)
  const idx = new Uint32Array(ni)
  // le numéro de chaque câble (voir `ECLAIRCIE`), seulement s'ils en portent tous un
  const tirages = geos.every((g) => g.attributes.aTirage) ? new Float32Array(nv) : null
  let ov = 0
  let oi = 0
  for (const g of geos) {
    pos.set(g.attributes.position.array as Float32Array, ov * 3)
    nor.set(g.attributes.normal.array as Float32Array, ov * 3)
    if (tirages) tirages.set(g.attributes.aTirage.array as Float32Array, ov)
    const src = g.index ? g.index.array : []
    for (let k = 0; k < src.length; k++) idx[oi + k] = src[k] + ov
    ov += g.attributes.position.count
    oi += src.length
    g.dispose()
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  if (tirages) out.setAttribute('aTirage', new THREE.BufferAttribute(tirages, 1))
  out.setIndex(new THREE.BufferAttribute(idx, 1))
  return out
}

/** Le sac-poubelle du brouillon : sphère bosselée, assise aplatie, noeud au sommet. */
function geometrieSac(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(0.5, 22, 16)
  const p = geo.attributes.position
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    v.multiplyScalar(
      1 +
        0.1 * Math.sin(v.x * 11 + v.y * 7) * Math.cos(v.z * 9) +
        0.05 * Math.sin(v.y * 27 + v.z * 19)
    )
    if (v.y < -0.3) v.y = -0.3 + (v.y + 0.3) * 0.2
    if (v.y > 0.3) {
      const k = Math.min(1, (v.y - 0.3) / 0.2)
      v.x *= 1 - k * 0.8
      v.z *= 1 - k * 0.8
      v.y += k * k * 0.18
    }
    p.setXYZ(i, v.x, v.y, v.z)
  }
  geo.computeVertexNormals()
  return geo
}

interface Pendu {
  piv: THREE.Object3D
  bout: THREE.Object3D
  eclat: THREE.Sprite
  ph: number
  f: number
}
interface PubPendue {
  piv: THREE.Object3D
  ph: number
}
interface Panneau {
  mat: THREE.ShaderMaterial
  cartes: THREE.Texture[]
}

export function monterToile(c: ContexteToile): ToileElectrique {
  const { FACADE, GARDE, TROTTOIR, ROUTE } = c
  // Sa propre graine : la ville et la façade, tirées avant la toile, gardent leur visage.
  let s0 = 1961
  const rnd = (): number => (s0 = (s0 * 16807) % 2147483647) / 2147483647
  const niveau = (x: number): number => (Math.abs(x) > ROUTE ? TROTTOIR : 0)
  const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z)
  const STD = (color: number, roughness: number, metalness: number): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness })
  const BOITE = new THREE.BoxGeometry(1, 1, 1)
  const CYL = new THREE.CylinderGeometry(1, 1, 1, 14)
  const poser = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    parent: THREE.Object3D,
    rx = 0,
    ry = 0,
    rz = 0
  ): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(x, y, z)
    m.rotation.set(rx, ry, rz)
    parent.add(m)
    return m
  }
  const bloc = (
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    parent: THREE.Object3D,
    rx = 0,
    ry = 0,
    rz = 0
  ): THREE.Mesh => {
    const m = poser(BOITE, mat, x, y, z, parent, rx, ry, rz)
    m.scale.set(w, h, d)
    return m
  }
  const tige = (
    r: number,
    h: number,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    parent: THREE.Object3D,
    rx = 0
  ): THREE.Mesh => {
    const m = poser(CYL, mat, x, y, z, parent, rx)
    m.scale.set(r, h, r)
    return m
  }

  // ---------- UNE TRAVÉE de 35 m : z va de 0 à 35 dans son repère, puis elle est recopiée ----------
  const travee = new THREE.Group()
  const noir = STD(0x08070b, 0.45, 0.5)
  const bois = STD(0x1c1714, 0.85, 0.1)
  const tubes: THREE.BufferGeometry[] = []
  const cable = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    f: number,
    r: number
  ): THREE.CatmullRomCurve3 => {
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= 12; i++) {
      const s = i / 12
      pts.push(new THREE.Vector3().lerpVectors(a, b, s).add(V(0, -f * 4 * s * (1 - s), 0)))
    }
    const courbe = new THREE.CatmullRomCurve3(pts)
    const tube = new THREE.TubeGeometry(courbe, 22, r, 4)
    const n = tube.attributes.position.count
    tube.setAttribute(
      'aTirage',
      new THREE.BufferAttribute(new Float32Array(n).fill(tirage(tubes.length)), 1)
    )
    tubes.push(tube)
    return courbe
  }
  // les poteaux électriques côté ville, entre les réverbères (eux sont à 8 et 25,5 m)
  const POTEAUX = [1, 17, 29]
  const hauts: THREE.Vector3[][] = []
  // une seule matière pour les trois transformateurs (mêmes réglages) : ils se dessinent ensemble
  const transfo = STD(0x2b2b33, 0.5, 0.7)
  POTEAUX.forEach((z) => {
    const x = -6.75
    tige(0.13, 10, bois, x, TROTTOIR + 5, z, travee)
    bloc(0.12, 0.12, 2.4, bois, x + 0.1, TROTTOIR + 9.3, z, travee)
    bloc(0.12, 0.12, 1.6, bois, x + 0.1, TROTTOIR + 8.3, z, travee)
    bloc(0.45, 0.65, 0.45, transfo, x + 0.35, TROTTOIR + 7.1, z, travee)
    const pts: THREE.Vector3[] = []
    for (const dz of [-1.1, -0.4, 0.4, 1.1]) pts.push(V(x + 0.1, TROTTOIR + 9.36, z + dz))
    for (const dz of [-0.7, 0.7]) pts.push(V(x + 0.1, TROTTOIR + 8.36, z + dz))
    hauts.push(pts)
  })
  // Le point d'attache reste tiré d'UN nombre au hasard, comme avant : la graine de la toile ne glisse
  // pas, et sur un mur de 24 m (sans `hauteurMur`) chaque câble garde exactement sa place.
  const plafond = (z: number): number => (c.hauteurMur?.(z) ?? 24) - 0.8
  const sousLeToit = (z: number): number => Math.min(14.5, plafond(z))
  const mur = (z: number): THREE.Vector3 => V(FACADE - 0.05, 5.5 + rnd() * (sousLeToit(z) - 5.5), z)
  const traverses: THREE.CatmullRomCurve3[] = []
  hauts.forEach((pts, k) =>
    pts.forEach((h) => {
      for (let n = 0; n < TOILE.parPoint; n++)
        traverses.push(
          cable(h, mur(POTEAUX[k] - 22 + rnd() * 30), 0.5 + rnd() * 2.2, 0.012 + rnd() * 0.02)
        )
    })
  )
  // d'un poteau au suivant, y compris le premier de la travée suivante
  for (let k = 0; k < POTEAUX.length; k++) {
    const b = hauts[(k + 1) % POTEAUX.length]
    const decale = k + 1 === POTEAUX.length ? c.P : 0
    for (let n = 0; n < 6; n++)
      cable(hauts[k][n], V(b[n].x, b[n].y, b[n].z + decale), 0.9 + rnd() * 0.8, 0.014)
  }
  for (let i = 0; i < TOILE.facade; i++) {
    const a = mur(rnd() * c.P)
    a.x = FACADE - 0.2
    // mêmes tirages, dans le même ordre ; le bout est ramené sous le toit qu'il atteint
    const dy = (rnd() - 0.5) * 3
    const zb = a.z - 3 - rnd() * 8
    cable(a, V(FACADE - 0.2, Math.min(a.y + dy, plafond(zb)), zb), 0.4 + rnd() * 1.2, 0.03)
  }
  for (const z of [8, 25.5])
    cable(V(GARDE + 0.05, TROTTOIR + 6.3, z), mur(z - 20 + rnd() * 30), 1.5, 0.02)
  // les traverses les mieux placées, au milieu de la travée
  const tri = traverses
    .map((courbe) => ({ courbe, e: Math.abs(courbe.getPoint(0.5).z - 19) }))
    .sort((a, b) => a.e - b.e)
    .map((x) => x.courbe)
  const choix = (i: number): THREE.CatmullRomCurve3 => tri[Math.min(tri.length - 1, i)]

  // Les guirlandes retirées tiraient 576 nombres au hasard ici (une couleur et un état par ampoule,
  // 8 × 36 ampoules). On les saute : les câbles arrachés, les sacs, les cartons et les papiers, tirés
  // après, gardent exactement la place qu'ils avaient avec elles.
  for (let i = 0; i < 8 * 36 * 2; i++) rnd()

  // les câbles arrachés : un pivot par câble, recopié dans chaque travée
  const pendre = (a: THREE.Vector3, Lg: number, ph: number, n: number): void => {
    const piv = new THREE.Group()
    piv.position.copy(a)
    piv.userData.pendu = n
    piv.userData.ph = ph
    travee.add(piv)
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= 10; i++) {
      const s = i / 10
      pts.push(V(Math.sin(s * 2.4) * 0.3 * s, -Lg * s, Math.sin(s * 3) * 0.1))
    }
    piv.add(
      new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.024, 4), noir)
    )
    const bout = new THREE.Object3D()
    bout.position.copy(pts[10])
    bout.userData.bout = n
    piv.add(bout)
    const eclat = c.glow(0xcfeaff, 1.1, 0, 0, 0, 0, bout)
    eclat.userData.eclat = n
  }
  for (let n = 0; n < TOILE.pendus; n++)
    pendre(
      n === 3 ? V(FACADE - 0.1, 8.5, 19.5) : choix(n * 3 + 1).getPoint(0.4 + 0.08 * (n % 3)),
      3.8 + rnd() * 1.4,
      n * 1.3,
      n
    )

  // les hologrammes : bandes déchirées, couleurs décalées, coupures franches
  const uHolo = { value: 0 }
  const holo = (carte: THREE.Texture, s: number, taux: number): THREE.ShaderMaterial =>
    new THREE.ShaderMaterial({
      uniforms: { uT: uHolo, uMap: { value: carte }, uS: { value: s }, uTaux: { value: taux } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      vertexShader: VS_UV,
      fragmentShader: HOLO_FS
    })
  const ecranHolo = (
    lignes: [string, number, number, string?][],
    col: string,
    fond = 'rgba(10,30,60,.55)'
  ): THREE.Texture => {
    const [cv, g] = c.toile(512, 256)
    g.fillStyle = fond
    g.fillRect(0, 0, 512, 256)
    g.strokeStyle = col
    g.lineWidth = 5
    g.strokeRect(10, 10, 492, 236)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillStyle = col
    g.shadowColor = col
    g.shadowBlur = 16
    for (const [txt, taille, y, police] of lignes) {
      g.font = taille + 'px ' + (police || 'Impact')
      g.fillText(txt, 256, y, 480)
    }
    g.shadowBlur = 0
    return c.tex(cv)
  }
  // les pubs holo pendues aux fils
  for (let n = 0; n < TOILE.pubs; n++) {
    const [mot, col, sous] = PUBS_FILS[n % PUBS_FILS.length]
    const pt = choix(n * 3 + 2).getPoint(0.42 + 0.12 * (n % 2))
    const piv = new THREE.Group()
    piv.position.copy(pt)
    piv.rotation.order = 'YXZ'
    // tournées vers l'endroit d'où on les regarde, à mi-chemin de la marche
    piv.rotation.y = Math.atan2(-5.55 - pt.x, 10 - (pt.z - 25))
    piv.userData.pub = n
    travee.add(piv)
    tige(0.006, 0.7, noir, -0.75, -0.35, 0, piv)
    tige(0.006, 0.7, noir, 0.75, -0.35, 0, piv)
    poser(
      new THREE.PlaneGeometry(1.9, 0.95),
      holo(
        ecranHolo(
          [
            [mot, 80, 110],
            [sous, 28, 196, 'Consolas']
          ],
          col
        ),
        20 + n,
        0.62
      ),
      0,
      -1.17,
      0,
      piv
    )
  }
  // NEURO+ sur la façade, AUTOWIN le long du mât du réverbère
  const panneaux: Panneau[] = []
  const reflets: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = []
  {
    const cartes = [
      ecranHolo(
        [
          ['NEURO+', 120, 100],
          ['TON CERVEAU · 99¥ / MOIS', 30, 190, 'Consolas']
        ],
        '#ff2fa0'
      ),
      ecranHolo(
        [
          ['N3UR0+', 120, 100],
          ['//// PAIEMENT REFUSÉ ////', 30, 190, 'Consolas']
        ],
        '#ffe066'
      )
    ]
    const mat = holo(cartes[0], 2, 0.7)
    const m = poser(
      new THREE.PlaneGeometry(4.2, 2.1),
      mat,
      FACADE - 0.4,
      6.4,
      19,
      travee,
      0,
      -Math.PI / 2 + 0.6,
      0
    )
    m.userData.source = 'neuro'
    panneaux.push({ mat, cartes })
    const r = c.trainee(0xff2fa0, 1.6, 10, 0.4, travee)
    r.position.set(5.6, TROTTOIR + 0.016, 23.5)
    reflets.push(r)
  }
  {
    const [cv, g] = c.toile(128, 512)
    g.fillStyle = 'rgba(10,30,60,.55)'
    g.fillRect(0, 0, 128, 512)
    g.font = 'bold 66px Bahnschrift'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillStyle = '#2ee8ff'
    g.shadowColor = '#2ee8ff'
    g.shadowBlur = 14
    'AUTOWIN'.split('').forEach((l, k) => g.fillText(l, 64, 40 + k * 66))
    const carte = c.tex(cv)
    const mat = holo(carte, 4, 0.75)
    const m = poser(
      new THREE.PlaneGeometry(0.7, 3.2),
      mat,
      -6.95,
      3.4,
      25.6,
      travee,
      0,
      Math.PI / 2 - 0.3,
      0
    )
    m.userData.source = 'autowin'
    panneaux.push({ mat, cartes: [carte] })
  }

  // un câble tombé dans une flaque, au bord de la chaussée : l'arc saute par salves
  const A = V(-3.4, 0.05, 28.6)
  cable(V(-6.6, TROTTOIR + 0.03, 31.4), A, -0.05, 0.035)
  const arcPos = new Float32Array(12 * 3)
  const arcGeo = new THREE.BufferGeometry()
  arcGeo.setAttribute('position', new THREE.BufferAttribute(arcPos, 3))
  const arcL = new THREE.Line(
    arcGeo,
    new THREE.LineBasicMaterial({
      color: 0xd8f0ff,
      transparent: true,
      blending: THREE.AdditiveBlending
    })
  )
  arcL.frustumCulled = false
  arcL.visible = false
  travee.add(arcL)
  const arcHalo = c.glow(0x9fd8ff, 3.4, -2.9, 0.3, 28.4, 0, travee)
  const flaque = poser(
    new THREE.PlaneGeometry(3, 2.2),
    new THREE.MeshBasicMaterial({
      map: c.GLOW,
      color: 0x6ac8ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }),
    -2.9,
    0.014,
    28.4,
    travee,
    -Math.PI / 2
  ) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  const arcBout = new THREE.Object3D()
  arcBout.position.copy(A)
  arcBout.userData.arc = true
  travee.add(arcBout)

  // au sol, presque rien : quelques sacs, cinq cartons, le néon tombé
  const GEO_SAC = geometrieSac()
  const MAT_SACS = [
    STD(0x1c1a24, 0.22, 0.25),
    STD(0x1e2a50, 0.25, 0.2),
    STD(0x24382a, 0.28, 0.2),
    STD(0x4a1640, 0.22, 0.2)
  ]
  const sac = (x: number, y: number, z: number, s: number): void => {
    const m = poser(
      GEO_SAC,
      MAT_SACS[Math.floor(rnd() * 4)],
      x,
      y + 0.27 * s,
      z,
      travee,
      (rnd() - 0.5) * 0.5,
      rnd() * 6,
      (rnd() - 0.5) * 0.5
    )
    m.scale.set(s * (0.9 + rnd() * 0.3), s * (0.75 + rnd() * 0.35), s * (0.9 + rnd() * 0.3))
  }
  const k = TOILE.sacs
  for (const [x, z, n, ex, ez] of [
    [6.6, 22, 10, 0.55, 1.4],
    [6.5, 9, 13, 0.6, 2],
    [6.7, 32, 8, 0.6, 1.2],
    [-6.5, 18, 7, 0.45, 1],
    [-6.3, 30.2, 11, 0.55, 1.3]
  ]) {
    const nb = Math.max(1, Math.round(n * k))
    for (let i = 0; i < nb; i++)
      sac(
        x + (rnd() - 0.5) * ex * Math.sqrt(k) * 2,
        niveau(x) + (i > nb * 0.6 ? 0.3 : 0),
        z + (rnd() - 0.5) * ez * Math.sqrt(k) * 2,
        0.55 + rnd() * 0.6
      )
  }
  const carton = STD(0x5c4630, 0.95, 0)
  const ZONES = [
    [6.1, 20],
    [6, 12],
    [5.6, 4],
    [-5.9, 29],
    [1.6, 14]
  ]
  for (let i = 0; i < TOILE.cartons; i++) {
    const [zx, zz] = ZONES[i % ZONES.length]
    const x = zx + (rnd() - 0.5) * 1.4
    const w = 0.35 + rnd() * 0.5
    const h = 0.25 + rnd() * 0.45
    const plat = rnd() < 0.45
    bloc(
      w,
      plat ? 0.05 : h,
      w * (0.8 + rnd() * 0.5),
      carton,
      x,
      niveau(x) + (plat ? 0.025 : h / 2),
      zz + (rnd() - 0.5) * 2,
      travee,
      0,
      rnd() * 3,
      plat ? 0 : (rnd() - 0.5) * 0.3
    )
  }
  const neonMat = new THREE.MeshBasicMaterial({ color: 0xff5fc0 })
  poser(
    new THREE.CylinderGeometry(0.025, 0.025, 1.6, 8),
    neonMat,
    -5.7,
    TROTTOIR + 0.75,
    30.4,
    travee,
    0.3,
    0,
    1.2
  )
  const halosNeon = [
    c.glow(0xff2fa0, 1.8, -5.7, TROTTOIR + 0.8, 30.4, 0.6, travee),
    c.glow(0xff2fa0, 1.2, -6.3, TROTTOIR + 0.55, 30.6, 0.5, travee)
  ]
  const ROSE_NEON = new THREE.Color(0xff5fc0)

  // tous les câbles de la travée en un seul maillage, éclaircis devant le vaisseau mère
  let fils = noir
  if (c.eclaircie) {
    fils = noir.clone()
    eclaircirFils(fils, c.eclaircie)
  }
  const cables = new THREE.Mesh(fusionner(tubes), fils)
  cables.name = 'cables'
  travee.add(cables)

  /**
   * LES OBJETS FIXES DE LA TRAVÉE EN QUELQUES DESSINS (conv-337) : sacs, cartons, poteaux et leurs
   * traverses partagent géométrie et matière ; chacun coûtait un dessin, à l'écran et dans le reflet
   * (107 dessins à l'écran pour trois travées visibles). Un `InstancedMesh` par géométrie et matière,
   * même rendu (voir decor-instances.ts). Avant les copies : chaque copie hérite des lots.
   */
  regrouperEnInstances(travee, [GEO_SAC, BOITE, CYL])

  // ---------- LES COPIES : une travée dans chaque copie du décor ----------
  const pendus: Pendu[] = []
  const pubs: PubPendue[] = []
  const bouts: THREE.Object3D[] = []
  const sources: THREE.Object3D[] = []
  for (let r = 0; r < c.copies; r++) {
    const copie = r === 0 ? travee : travee.clone()
    copie.position.z = c.Z0 + r * c.P
    c.decor.add(copie)
    const lus = new Map<number, Partial<Pendu>>()
    copie.traverse((o) => {
      const u = o.userData
      if (u.pendu !== undefined) lus.set(u.pendu, { ...lus.get(u.pendu), piv: o, ph: u.ph })
      if (u.bout !== undefined) lus.set(u.bout, { ...lus.get(u.bout), bout: o })
      if (u.eclat !== undefined) {
        // chaque copie a son propre éclat : deux travées visibles ne flashent pas ensemble
        const s = o as THREE.Sprite
        if (r > 0) s.material = s.material.clone()
        lus.set(u.eclat, { ...lus.get(u.eclat), eclat: s })
      }
      if (u.pub !== undefined) pubs.push({ piv: o, ph: u.pub * 1.7 + r })
      if (u.arc) bouts.push(o)
      if (u.source) sources.push(o)
    })
    for (const p of lus.values()) pendus.push({ ...(p as Pendu), f: 0 })
  }

  // ---------- CE QUI NE DÉFILE PAS : les papiers au vent, les fenêtres d'erreur, les pixels morts ----------
  const [pc, pg] = c.toile(64, 96)
  pg.fillStyle = '#d9d3c4'
  pg.fillRect(0, 0, 64, 96)
  pg.fillStyle = 'rgba(40,35,50,.55)'
  for (let y = 10; y < 90; y += 6) pg.fillRect(6, y, 30 + rnd() * 22, 2)
  pg.font = 'bold 13px Impact'
  pg.fillText('AVIS', 8, 9)
  const NP = TOILE.papiers
  const feuilles = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.24, 0.32),
    new THREE.MeshStandardMaterial({
      map: c.tex(pc),
      side: THREE.DoubleSide,
      roughness: 0.8,
      emissive: 0x1e1828
    }),
    NP
  )
  feuilles.frustumCulled = false
  c.scene.add(feuilles)
  const F = Array.from({ length: NP }, () => ({
    x: -6.8 + rnd() * 14,
    z: 8 - rnd() * 40,
    ph: rnd() * 50,
    v: 0.6 + rnd() * 1.2,
    h: rnd()
  }))

  const ERR = ecranHolo(
    [
      ['FATAL :: 0x2F', 70, 145],
      ['//// ERREUR SYSTÈME ////', 28, 52, 'Consolas']
    ],
    '#ff3b3b',
    'rgba(60,8,12,.6)'
  )
  const ERR2 = ecranHolo(
    [
      ['ACCÈS REFUSÉ', 66, 140],
      ['retry? [o/n]', 28, 210, 'Consolas']
    ],
    '#c6ff00',
    'rgba(10,40,10,.6)'
  )
  const fenetres = Array.from({ length: TOILE.fenetres }, (_, i) => {
    const m = poser(
      new THREE.PlaneGeometry(2, 1),
      holo(i % 2 ? ERR : ERR2, 10 + i, 0.5),
      0,
      -50,
      0,
      c.scene
    )
    m.visible = false
    return { m, t: rnd() * 2 }
  })

  const NPX = TOILE.pixels
  const pxPos = new Float32Array(NPX * 3)
  const pxCol = new Float32Array(NPX * 3)
  const PX = Array.from({ length: NPX }, (_, i) => {
    pxCol.set(
      [
        [0.18, 0.91, 1],
        [1, 0.18, 0.63],
        [0.3, 1, 0.5]
      ][i % 3],
      i * 3
    )
    return { x: 0, y: -50, z: 0, v: 0.3 + rnd() * 0.9 }
  })
  const pxGeo = new THREE.BufferGeometry()
  pxGeo.setAttribute('position', new THREE.BufferAttribute(pxPos, 3))
  pxGeo.setAttribute('color', new THREE.BufferAttribute(pxCol, 3))
  const pixels = new THREE.Points(
    pxGeo,
    new THREE.PointsMaterial({
      size: 0.09,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  )
  pixels.frustumCulled = false
  c.scene.add(pixels)

  // ---------- L'ANIMATION ----------
  const M4 = new THREE.Matrix4()
  const QQ = new THREE.Quaternion()
  const EU = new THREE.Euler()
  const V3 = new THREE.Vector3()
  const UN = new THREE.Vector3(1, 1, 1)
  const ETINCELLE = new THREE.Color()
  const vu = (z: number): boolean => z > VU.loin && z < VU.pres
  // un pixel naît sous un hologramme visible ; s'il n'y en a aucun, il attend hors champ
  const posSources = sources.map(() => new THREE.Vector3())
  const visibles: number[] = []
  const naitre = (p: { x: number; y: number; z: number }): void => {
    if (visibles.length === 0) {
      p.y = -50
      return
    }
    const i = visibles[Math.floor(Math.random() * visibles.length)]
    const q = posSources[i]
    const large = sources[i].userData.source === 'neuro' ? 0.6 : 0.4
    p.x = q.x + (Math.random() - 0.5) * large
    p.y = q.y + (Math.random() - 0.5) * 1.6
    p.z = q.z + (Math.random() - 0.5) * large
  }
  let dernier = -1

  return {
    maj(t, dt, v) {
      uHolo.value = t
      // les câbles arrachés se balancent ; ceux qu'on voit crachent leurs gerbes
      for (const p of pendus) {
        p.piv.rotation.z = 0.3 * Math.sin(t * 1.1 + p.ph)
        p.piv.rotation.x = 0.18 * Math.sin(t * 0.73 + p.ph * 2)
        p.f = Math.max(0, p.f - dt * 5)
        p.bout.getWorldPosition(V3)
        if (vu(V3.z) && Math.random() < dt * 2.2 * TOILE.etincelles) {
          p.f = 1
          for (let n = 0; n < 28; n++) {
            ETINCELLE.setRGB(1, 0.8 + 0.2 * rnd(), 0.5 + 0.5 * rnd())
            c.emettre(
              V3.x,
              V3.y,
              V3.z,
              (rnd() - 0.5) * 3,
              rnd() * 2.5,
              (rnd() - 0.5) * 3 + v,
              0.6 + rnd() * 0.9,
              ETINCELLE,
              9.8,
              0.35,
              niveau(V3.x) + 0.02
            )
          }
        }
        p.eclat.material.opacity = p.f * (0.6 + 0.4 * Math.random())
      }
      for (const p of pubs) {
        p.piv.rotation.x = 0.12 * Math.sin(t * 1.3 + p.ph)
        p.piv.rotation.z = 0.16 * Math.sin(t * 0.9 + p.ph * 2)
      }
      // l'arc dans la flaque : des salves, puis le silence
      const on = t % 3.7 < 1.1 && Math.random() < 0.8
      arcL.visible = on
      arcHalo.material.opacity = on ? 0.6 + 0.4 * Math.random() : 0
      flaque.material.opacity = on ? 0.35 + 0.3 * Math.random() : 0
      if (on) {
        const bx = -2.3 + Math.random() * 0.6
        const bz = 28 + Math.random() * 0.6
        for (let i = 0; i < 12; i++) {
          const s = i / 11
          const j = i === 0 || i === 11 ? 0 : 1
          arcPos.set(
            [
              A.x + (bx - A.x) * s + (Math.random() - 0.5) * 0.22 * j,
              0.03 + Math.sin(s * Math.PI) * 0.45 + (Math.random() - 0.5) * 0.16 * j,
              A.z + (bz - A.z) * s + (Math.random() - 0.5) * 0.22 * j
            ],
            i * 3
          )
        }
        arcGeo.attributes.position.needsUpdate = true
        if (Math.random() < 0.3) {
          ETINCELLE.setRGB(0.75, 0.9, 1)
          for (const b of bouts) {
            b.getWorldPosition(V3)
            if (!vu(V3.z)) continue
            for (let n = 0; n < 6; n++)
              c.emettre(
                V3.x,
                0.06,
                V3.z,
                (rnd() - 0.5) * 2,
                1 + rnd() * 2,
                (rnd() - 0.5) * 2 + v,
                0.5,
                ETINCELLE,
                9.8,
                0.3,
                0.03
              )
          }
        }
      }
      // les deux enseignes qui lâchent, par-dessus le scintillement ordinaire du décor
      for (const e of c.enseignes) {
        const rang = TOILE.lachent.indexOf(e.i)
        if (rang < 0) continue
        const n = Math.floor(t * (rang ? 9 : 14))
        const k =
          (t % (5 + rang * 3) < 1.6 + rang ? 0 : 1) *
          (hash(n + rang * 50) > (rang ? 0.15 : 0.45) ? 1 : 0.08)
        const val = Math.max(0.08, k)
        e.box.material.color.setScalar(val)
        e.halo.material.opacity = 0.7 * val
        e.reflet.material.opacity = 0.35 * val
        if (e.lum) e.lum.intensity *= val
      }
      // le néon tombé
      const neon = hash(Math.floor(t * 11)) > 0.18 ? 1 : 0.06
      neonMat.color.copy(ROSE_NEON).multiplyScalar(0.15 + 0.85 * neon)
      halosNeon.forEach((h) => (h.material.opacity = 0.6 * neon))
      // les hologrammes changent de carte au hasard des coupures
      const tick = Math.floor(t * 9)
      if (tick !== dernier) {
        dernier = tick
        for (const p of panneaux)
          if (p.cartes.length > 1 && Math.random() < 0.12)
            p.mat.uniforms.uMap.value = p.cartes[Math.floor(Math.random() * p.cartes.length)]
      }
      reflets.forEach(
        (r, i) =>
          (r.material.opacity =
            hash(Math.floor(t * 2.5) + 11 + i) < 0.06
              ? 0.02
              : 0.25 + 0.15 * hash(Math.floor(t * 24) + i))
      )
      // les papiers : à plat dans les flaques, puis une rafale les soulève ; ils suivent la marche
      const rafale = 0.5 + 0.5 * Math.sin(t * 0.33) * Math.sin(t * 0.11 + 1)
      for (let i = 0; i < NP; i++) {
        const f = F[i]
        const vol = Math.max(0, Math.sin(t * 0.9 * f.v + f.ph)) * (0.4 + rafale)
        f.z += dt * ((0.4 + 2.4 * rafale) * f.v * (vol > 0.05 ? 1 : 0.06) + v)
        f.x = Math.min(7.3, Math.max(-6.9, f.x + dt * Math.sin(t * 0.7 + f.ph) * 0.8 * vol))
        if (f.z > 9) {
          f.z -= 42
          f.x = -6.8 + rnd() * 14
        }
        EU.set(
          -Math.PI / 2 + vol * Math.sin(t * 3 * f.v + f.ph) * 2.2,
          f.ph + t * vol * 1.5,
          vol * Math.cos(t * 2.3 + f.ph) * 1.8,
          'XYZ'
        )
        QQ.setFromEuler(EU)
        M4.compose(V3.set(f.x, niveau(f.x) + 0.012 + vol * (0.5 + f.h * 2.6), f.z), QQ, UN)
        feuilles.setMatrixAt(i, M4)
      }
      feuilles.instanceMatrix.needsUpdate = true
      // les fenêtres d'erreur surgissent devant nous, se tournent vers nous, disparaissent
      for (const p of fenetres) {
        p.t -= dt
        if (p.t > 0) continue
        if (p.m.visible) {
          p.m.visible = false
          p.t = 0.5 + Math.random() * 2.5
        } else {
          p.m.visible = true
          p.t = 0.25 + Math.random() * 1.2
          p.m.position.set(
            -4 + Math.random() * 10.5,
            1.4 + Math.random() * 5,
            -2 - Math.random() * 16
          )
          p.m.lookAt(c.camera.position)
          p.m.rotation.z += (Math.random() - 0.5) * 0.2
        }
      }
      // les pixels morts tombent des hologrammes et suivent la marche
      visibles.length = 0
      sources.forEach((s, i) => {
        if (vu(s.getWorldPosition(posSources[i]).z)) visibles.push(i)
      })
      for (let i = 0; i < NPX; i++) {
        const p = PX[i]
        if (p.y < -40) naitre(p)
        else {
          p.y -= p.v * dt
          p.z += v * dt
          if (Math.random() < 0.02) p.x += (Math.random() - 0.5) * 0.3
          if (p.y < niveau(p.x)) naitre(p)
        }
        pxPos.set([p.x, p.y, p.z], i * 3)
      }
      pxGeo.attributes.position.needsUpdate = true
    }
  }
}
