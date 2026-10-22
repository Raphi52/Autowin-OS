import * as THREE from 'three'
import { creerJumellesDuReflet } from './home-decor-reflet-jumelles'

/**
 * LA SPIRALE : la rue inondée, une tour de contrôle et la rame express qui s'enroule autour d'elle.
 *
 * Demande de l'utilisateur (conv-310) : « /draft des moyens de rendre le fond d'écran de l'acceuil
 * magnifique effet waouh maximum », puis, de tour en tour, « innondé + des enseignes plus dynamiques
 * et dans la ville a gauche des trucs flottant », « 1 3 et 5 », « 6 2 5 », et enfin
 * « implémente spirale » : la variante 4 · Spirale du brouillon `.autowin-tmp/draft-waouh/scene5.js`.
 * Ce qu'elle montre :
 *   - TOUTE LA CHAUSSÉE EST UN MIROIR D'EAU, trottoirs compris : la façade, les enseignes et le ciel
 *     s'y reflètent, troublés par les gouttes ;
 *   - deux koïs holographiques géantes, une rose et une bleue, nagent au-dessus de la ville ;
 *   - une tour de contrôle holo dans la ville, couronnée de trois anneaux de texte qui tournent ;
 *   - un rail lumineux qui s'enroule en hélice autour d'elle (un tour et demi) : une rame de sept
 *     voitures y monte, traverse cinq portiques holo qui s'allument à son passage, puis plonge ;
 *   - un essaim de 700 drones au-dessus de la tour, qui écrit AUTOWIN puis dessine ✓ ;
 *   - quatre couloirs de voitures volantes, peu denses et lents ;
 *   - les enseignes en drapeau deviennent des prismes qui pivotent d'un quart de tour (BAR → BEER →
 *     バー → AUTOWIN), et une marquise AUTOWIN à ampoules est suspendue au-dessus du trottoir.
 *
 * CE QUI EST REPRIS TEL QUEL : les positions, les quantités, les couleurs, les textes, les nuanceurs
 * et les animations du brouillon.
 *
 * CE QUI CHANGE, parce qu'un fond n'est pas une démo :
 *   - AUCUNE LUMIÈRE AJOUTÉE : tout l'éclat est porté par des halos et des matières qui émettent ;
 *     chaque lumière de plus alourdit toutes les matières de la rue (conv-301 : 22 lumières → 8) ;
 *   - LE REFLET A SES PROPRES PROGRAMMES : dessiner la scène dans une image à part fait préparer par
 *     three une seconde version de chaque nuanceur (sortie linéaire au lieu de sRGB). Préparées à la
 *     première image, elles figeraient l'Accueil comme en conv-301 ; `precompilerReflet` les fait
 *     compiler en tâche de fond — depuis conv-337 APRÈS la première image de la rue, qui ne les
 *     attend plus — et le décor les FINALISE ensuite un programme par tâche (`finaliserProgrammes`) :
 *     compilées seulement, elles se finalisaient d'un bloc au premier reflet (310 ms mesurées dans
 *     l'Accueil, 2026-10-17). Jusque-là l'eau ne reflète rien (`activerReflet`). Ces versions « reflet »
 *     appartiennent à des JUMELLES des matières (`home-decor-reflet-jumelles.ts`) : portées par les
 *     mêmes matières que l'écran, elles faisaient rebasculer chaque matière de programme deux fois
 *     par image (~34 ms par image, 2026-10-18) ;
 *   - LA FOULE N'EST PAS REFLÉTÉE : ses programmes animés arrivent après la rue, et leur version
 *     « reflet » se compilerait d'un bloc à sa première image. `avantRendu` la masque le temps du reflet ;
 *   - les prismes reprennent à chaque image la couleur de l'enseigne qu'ils remplacent : le BAR qui
 *     clignote et l'enseigne qui claque en court-circuit restent visibles ;
 *   - le hasard a sa propre graine : la spirale ne déplace ni la ville ni la façade, tirées avant elle.
 */

/** Les réglages de la variante 4 · Spirale, recopiés du brouillon. */
export const SPIRALE = {
  /** La tour de contrôle : position au sol de la ville, hauteur de son toit au-dessus du sol. */
  tour: { x: -95, z: -230, hauteur: 170, largeur: 20 },
  /**
   * Anneaux de texte autour de la tour, leurs rayons et leur vitesse relative. Serrés contre la
   * tour (18 à 26 m, au lieu de 28 à 42 m) : 10 m de vide jusqu'à l'hélice, qui ne s'y perd plus.
   */
  anneaux: 3,
  rayonsAnneaux: [18, 22, 26] as readonly number[],
  vitesseAnneaux: 0.7,
  /**
   * L'hélice : rayon autour de la tour, nombre de pas (un pas = 30°), montée par pas. Rayon 36 et
   * non 52 : une hélice se lit à ses côtés, là où les boucles tournent. Dans la fenêtre de
   * l'utilisateur (1745 × 938, 2026-10-17), à 52 m son côté gauche tombait sous le menu et son
   * côté droit contre le poteau noir de l'avenue ; à 36 m, elle tient entre x = 246 et 559.
   */
  helice: { rayon: 36, pas: 18, montee: 3 },
  /** La rame : voitures, vitesse en m/s, et ce qu'elle parcourt hors de la voie avant de revenir. */
  rame: { voitures: 7, vitesse: 70, marge: 300, depart: 260 },
  /** Portiques, en fraction de la longueur de la voie. */
  portiques: [0.2, 0.32, 0.44, 0.56, 0.68] as readonly number[],
  /**
   * L'essaim : drones, formes et durée de chaque forme en secondes. `hauteur` 75 et non 86 : à 86,
   * le ✓ montait jusqu'à l'en-tête « AUTOWIN ACCUEIL » (fenêtre 1745 × 938 de l'utilisateur,
   * 2026-10-17) ; à 75, il reste 20 px d'air, transitions comprises.
   */
  essaim: {
    drones: 700,
    formes: ['autowin', 'check'] as const,
    durees: [7, 5] as readonly number[],
    hauteur: 75
  },
  /** Couloirs de voitures volantes : densité et vitesse relatives. */
  trafic: { densite: 0.5, vitesse: 0.7 },
  /** Les prismes pivotent d'un quart de tour toutes les `periodePrismes` secondes, en vague. */
  periodePrismes: 3,
  /** Le miroir d'eau : part de la résolution, force du reflet, force des gouttes. */
  miroir: { resolution: 0.5, force: 1.1, gouttes: 0.7 }
} as const

/**
 * LE REFLET N'EST REDESSINÉ QU'UNE IMAGE SUR `REFLET_UNE_IMAGE_SUR` (conv-337, 2026-10-19).
 *
 * Mesure (scripts/banc-decor-budget.mjs, copie d'origin/main, instance cachée) : 1 684 dessins par
 * image, dont 702 pour le reflet, et 249 changements de programme sur 570. L'eau est ridée en
 * permanence par les gouttes (nuanceur du miroir, `onde`), qui, elles, bougent à CHAQUE image : un
 * reflet vieux d'une image (33 ms à 30 images/s) ne s'y distingue pas. Entre deux reflets, la matrice
 * `texMiroir` reste celle de l'image qui a été dessinée : l'eau lit l'image du reflet là où elle a
 * été prise, sans décalage.
 */
export const REFLET_UNE_IMAGE_SUR = 2

/**
 * LE FONDU DU REFLET, en ms : la rue apparaît sans reflet (ses programmes « reflet » se compilent
 * après sa première image), puis le reflet monte de 0 à sa force sur cette durée.
 */
export const FONDU_REFLET_MS = 1200

/** Ce que la spirale reprend d'une enseigne du décor. */
export interface EnseigneDeSpirale {
  box: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  i: number
}

/** Ce que le décor prête à la spirale : ses repères, ses outils de dessin et ses enseignes. */
export interface ContexteSpirale {
  scene: THREE.Scene
  /** Le groupe qui glisse vers nous à chaque pas : les prismes et la marquise y sont posés. */
  decor: THREE.Group
  renderer: THREE.WebGLRenderer
  camera: THREE.PerspectiveCamera
  /** Longueur d'une travée, début de la première et nombre de copies du décor. */
  P: number
  Z0: number
  copies: number
  FACADE: number
  ROUTE: number
  GARDE: number
  TROTTOIR: number
  /** Le sol de la ville en contrebas. */
  SOL: number
  /** Le temps des nuanceurs de la ville, partagé. */
  uT: { value: number }
  GLOW: THREE.Texture
  toile: (w: number, h: number) => [HTMLCanvasElement, CanvasRenderingContext2D]
  tex: (c: HTMLCanvasElement) => THREE.CanvasTexture
  /** Les enseignes en drapeau, et pour chaque motif son mot, sa couleur et sa texture. */
  enseignes: EnseigneDeSpirale[]
  motifs: { mot: string; couleur: string; texture: THREE.Texture }[]
}

export interface Spirale {
  /** Tout ce que la spirale pose dans la scène et hors du décor. */
  groupe: THREE.Group
  /** Les plans du miroir d'eau. */
  miroirs: THREE.Mesh[]
  /**
   * CE QUI NE SE VOIT PAS DANS L'EAU, donc n'y est pas dessiné : la rame, les portiques et les
   * anneaux de la tour. Mesuré au banc de rendu (conv-337, 5 instants, chaque groupe retiré du SEUL
   * reflet, même instant et même hasard) : l'écart à l'image complète reste au niveau du bruit du
   * banc (l'essaim, qui avance d'un rendu à l'autre), alors que les façades (≈ 210 000 pixels), les
   * prismes, les roues et les koïs changent nettement l'image. 66 dessins de moins par reflet.
   */
  sansReflet: THREE.Object3D[]
  /** Les prismes qui remplacent les enseignes, dans l'ordre des enseignes. */
  prismes: THREE.Mesh[]
  /** La marquise, une par travée. */
  marquises: THREE.Group[]
  /** L'image où le reflet est dessiné. */
  cibleReflet: THREE.WebGLRenderTarget
  /**
   * Fait compiler en tâche de fond la version « reflet » des programmes de la scène, avec le
   * compilateur du décor. À enchaîner après la compilation de la rue, avant sa première image.
   */
  precompilerReflet(
    compiler: (objet: THREE.Object3D, cible?: THREE.Scene) => Promise<void>
  ): Promise<void>
  /**
   * Les matières que le reflet dessine (les jumelles de celles de l'écran) : leurs programmes sont à
   * finaliser en tâche de fond, comme ceux de la scène, après `precompilerReflet`.
   */
  matieresDuReflet(): Iterable<THREE.Material>
  /**
   * La version « reflet » des programmes est compilée ET finalisée : le reflet peut être dessiné.
   * Avant cet appel, `avantRendu` ne dessine aucun reflet et l'eau n'en montre aucun ; après, le
   * reflet monte en fondu (`FONDU_REFLET_MS`).
   */
  activerReflet(): void
  /** Une image : `t` en secondes, `parcours` la distance marchée (fait défiler les gouttes). */
  animer(t: number, parcours: number): void
  /**
   * À appeler juste avant `renderer.render(scene, camera)`, caméra posée : dessine le reflet, une
   * image sur `REFLET_UNE_IMAGE_SUR`. `exclus` est masqué le temps du reflet (la foule), comme
   * `sansReflet`.
   */
  avantRendu(exclus?: (THREE.Object3D | null | undefined)[]): void
  /** Libère ce que le parcours de la scène ne libère pas (l'image du reflet). */
  liberer(): void
}

const ADD = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false } as const
const sh = (...l: string[]): string => [...l, '#include <colorspace_fragment>', '}'].join('\n')
const VS_W =
  'varying vec3 vW;void main(){vec4 w=modelMatrix*vec4(position,1.0);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}'
const VS_UW =
  'varying vec2 vU;varying vec3 vW;void main(){vU=uv;vec4 w=modelMatrix*vec4(position,1.0);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}'
const BRUIT = 'float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}'
const H1 = 'float h1(float x){return fract(sin(x*91.345)*43758.5453);}'
const lisse = (x: number): number => {
  const u = Math.min(1, Math.max(0, x))
  return u * u * (3 - 2 * u)
}
const PR = new THREE.Color(1, 0.31, 0.62)
const PV = new THREE.Color(0.62, 0.36, 1)
const PB = new THREE.Color(0.18, 0.55, 1)
const palette = (u: number, o: THREE.Color): THREE.Color =>
  u < 0.5 ? o.copy(PR).lerp(PV, u * 2) : o.copy(PV).lerp(PB, u * 2 - 1)

/** Les mots que montrent les autres faces des prismes, par motif (BAR, HOTEL, RAMEN, 24H). */
export const FACES_PRISMES: Record<string, { autre: string; kata: string }> = {
  BAR: { autre: 'BEER', kata: 'バー' },
  HOTEL: { autre: 'ROOMS', kata: 'ホテル' },
  RAMEN: { autre: 'NOODLE', kata: 'ラーメン' },
  '24H': { autre: 'OPEN', kata: '営業中' }
}

/** La voie en hélice : elle part du bord de l'avenue, s'enroule autour de la tour, puis plonge. */
export function voieHelice(): THREE.CatmullRomCurve3 {
  const { x: TX, z: TZ } = SPIRALE.tour
  const { rayon, pas, montee } = SPIRALE.helice
  const tours = Array.from({ length: pas + 1 }, (_, k) => {
    const a = 1.15 - (k * Math.PI) / 6
    return [TX + Math.cos(a) * rayon, 8 + k * montee, TZ + Math.sin(a) * rayon]
  })
  const pts = [
    [-24, 4, 90],
    [-24, 4, 10],
    [-28, 5, -60],
    [-46, 8, -120],
    ...tours,
    [-150, 50, -330],
    [-230, 20, -420],
    [-300, 0, -540],
    [-260, -10, -650]
  ]
  return new THREE.CatmullRomCurve3(
    pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    false,
    'centripetal'
  )
}

/** La rame : abscisse de sa tête sur la voie à l'instant `t` (négative ou au-delà = hors de la voie). */
export function abscisseRame(t: number, longueur: number): number {
  const { vitesse, marge, depart } = SPIRALE.rame
  return ((t * vitesse + depart) % (longueur + marge)) - 120
}

export function monterSpirale(ctx: ContexteSpirale): Spirale {
  const {
    scene,
    decor,
    renderer,
    camera,
    P,
    Z0,
    copies,
    FACADE,
    ROUTE,
    GARDE,
    TROTTOIR,
    SOL,
    uT,
    GLOW,
    toile,
    tex
  } = ctx
  let s0 = 4242
  const rnd = (): number => (s0 = (s0 * 16807) % 2147483647) / 2147483647
  const groupe = new THREE.Group()
  groupe.name = 'spirale'
  scene.add(groupe)
  const NOIR = new THREE.MeshBasicMaterial({ color: 0x07050c, fog: false })
  const sprite = (
    color: THREE.ColorRepresentation,
    size: number,
    x: number,
    y: number,
    z: number,
    op: number,
    parent: THREE.Object3D
  ): THREE.Sprite => {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: GLOW, color, opacity: op, fog: false, ...ADD })
    )
    s.scale.set(size, size, 1)
    s.position.set(x, y, z)
    parent.add(s)
    return s
  }

  // ---------- des nuées de points lumineux (voitures, drones) dont la taille suit la distance ----------
  const echelles: { value: number }[] = []
  const nuee = (
    n: number
  ): {
    p: THREE.Points
    g: THREE.BufferGeometry
    pos: Float32Array
    col: Float32Array
    ta: Float32Array
  } => {
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(n * 3)
    const col = new Float32Array(n * 3)
    const ta = new Float32Array(n)
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aCol', new THREE.BufferAttribute(col, 3))
    g.setAttribute('aTaille', new THREE.BufferAttribute(ta, 1))
    const uEchelle = { value: 300 }
    echelles.push(uEchelle)
    const m = new THREE.ShaderMaterial({
      uniforms: { uEchelle },
      ...ADD,
      vertexShader:
        'attribute float aTaille;attribute vec3 aCol;uniform float uEchelle;varying vec3 vC;void main(){vC=aCol;vec4 mv=modelViewMatrix*vec4(position,1.0);gl_PointSize=clamp(aTaille*uEchelle/-mv.z,1.5,80.0);gl_Position=projectionMatrix*mv;}',
      fragmentShader:
        'varying vec3 vC;void main(){vec2 c=gl_PointCoord-0.5;float r=dot(c,c);gl_FragColor=vec4(vC*(exp(-r*24.0)*0.7+exp(-r*110.0)),1.0);}'
    })
    const p = new THREE.Points(g, m)
    p.frustumCulled = false
    return { p, g, pos, col, ta }
  }

  // ---------- LA RUE INONDÉE : toute la chaussée est un miroir d'eau ----------
  const cibleReflet = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType })
  // Le reflet dessine des jumelles des matières, jamais les matières de l'écran : sans elles, chaque
  // matière rebasculait de programme deux fois par image (voir home-decor-reflet-jumelles.ts).
  const jumelles = creerJumellesDuReflet()
  const camMiroir = new THREE.PerspectiveCamera()
  const texMiroir = new THREE.Matrix4()
  const uDecal = { value: 0 }
  const miroirMat = new THREE.ShaderMaterial({
    uniforms: {
      uMiroir: { value: cibleReflet.texture },
      uTex: { value: texMiroir },
      uT,
      uDecal,
      uForce: { value: SPIRALE.miroir.force },
      uGouttes: { value: SPIRALE.miroir.gouttes }
    },
    ...ADD,
    vertexShader: VS_W,
    fragmentShader: sh(
      'uniform sampler2D uMiroir;uniform mat4 uTex;uniform float uT;uniform float uDecal;uniform float uForce;uniform float uGouttes;varying vec3 vW;',
      BRUIT,
      'vec2 onde(vec2 p,float k){vec2 q=p*k;vec2 id=floor(q);vec2 f=fract(q)-0.5-(vec2(h(id),h(id+7.1))-0.5)*0.5;',
      'float ph=fract(uT*0.9+h(id+3.3));float r=length(f);float x=(r-ph*0.45)*38.0;',
      'float a=sin(clamp(x,-3.1416,3.1416))*step(abs(x),3.1416)*(1.0-ph)*(1.0-ph);return normalize(f+1e-4)*a;}',
      'void main(){vec2 p=vec2(vW.x,vW.z-uDecal);vec2 d=(onde(p,2.3)+onde(p+5.7,3.4))*0.011*uGouttes;',
      'vec4 pr=uTex*vec4(vW,1.0);vec3 net=texture2D(uMiroir,pr.xy/pr.w+d).rgb;',
      'vec3 V=normalize(cameraPosition-vW);float fr=0.05+0.95*pow(1.0-max(V.y,0.0),5.0);',
      'gl_FragColor=vec4(net*fr*uForce,1.0);'
    )
  })
  const miroirs = (
    [
      [-ROUTE, ROUTE, 0.012],
      [ROUTE, FACADE, TROTTOIR + 0.012],
      [GARDE - 0.25, -ROUTE, TROTTOIR + 0.012]
    ] as const
  ).map(([x0, x1, y]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, 150), miroirMat)
    m.rotation.x = -Math.PI / 2
    m.position.set((x0 + x1) / 2, y, -60)
    m.name = 'miroir-eau'
    groupe.add(m)
    return m
  })
  const _cw = new THREE.Vector3()
  const _vise = new THREE.Vector3()
  const _rot = new THREE.Matrix4()
  const _plan = new THREE.Plane()
  const _clip = new THREE.Vector4()
  const _q = new THREE.Vector4()
  const _taille = new THREE.Vector2()

  // ---------- LES DEUX KOÏS GÉANTES (corps tourné + voiles, liseré, écailles, lignes de balayage) ----------
  const voile = (pts: number[][]): THREE.BufferGeometry => {
    const p: number[] = []
    for (let i = 1; i < pts.length - 1; i++) p.push(...pts[0], ...pts[i], ...pts[i + 1])
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
    g.computeVertexNormals()
    return g
  }
  const PROFIL = [
    [0, -0.5],
    [0.014, -0.47],
    [0.035, -0.38],
    [0.07, -0.24],
    [0.105, -0.06],
    [0.12, 0.12],
    [0.11, 0.28],
    [0.08, 0.4],
    [0.045, 0.47],
    [0, 0.5]
  ]
  const koiCorps = new THREE.LatheGeometry(
    PROFIL.map(([r, y]) => new THREE.Vector2(r, y)),
    28
  )
  koiCorps.rotateX(Math.PI / 2)
  koiCorps.scale(0.85, 1, 1)
  const koiVoiles = [
    voile([
      [0, 0.02, -0.44],
      [0, 0.05, -0.5],
      [0, 0.16, -0.76],
      [0, 0.26, -1.05],
      [0, 0.13, -0.95],
      [0, 0, -0.84],
      [0, -0.13, -0.95],
      [0, -0.26, -1.05],
      [0, -0.16, -0.76],
      [0, -0.05, -0.5]
    ]),
    voile([
      [0, 0.1, 0.1],
      [0, 0.11, 0.16],
      [0, 0.18, 0.08],
      [0, 0.17, -0.06],
      [0, 0.13, -0.22],
      [0, 0.08, -0.3]
    ]),
    ...[1, -1].map((s) =>
      voile([
        [s * 0.08, -0.06, 0.22],
        [s * 0.1, -0.07, 0.27],
        [s * 0.26, -0.13, 0.18],
        [s * 0.32, -0.16, 0],
        [s * 0.22, -0.12, -0.02],
        [s * 0.1, -0.08, 0.12]
      ])
    )
  ]
  const koiMat = (
    c1: number,
    c2: number,
    ph: number,
    fil: boolean,
    voileOn: boolean
  ): THREE.ShaderMaterial =>
    new THREE.ShaderMaterial({
      uniforms: {
        uT,
        uC: { value: new THREE.Color(c1) },
        uC2: { value: new THREE.Color(c2) },
        uPh: { value: ph },
        uI: { value: fil ? 0.35 : 1 },
        uVoile: { value: voileOn ? 1 : 0 }
      },
      side: THREE.DoubleSide,
      wireframe: fil,
      ...ADD,
      vertexShader: [
        'uniform float uT;uniform float uPh;varying vec3 vN;varying vec3 vV;varying vec3 vO;varying vec3 vW;',
        'void main(){vec3 p=position;float u=clamp(0.5-p.z,0.0,1.6);',
        'p.x+=sin(p.z*7.0+uT*3.0+uPh)*0.07*u*u+sin(uT*1.5+uPh)*0.02;p.y+=sin(uT*3.0+uPh)*max(abs(position.x)-0.1,0.0)*0.45;',
        'vO=position;vec4 w=modelMatrix*vec4(p,1.0);vW=w.xyz;vec4 mv=viewMatrix*w;vN=normalize(normalMatrix*normal);vV=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}'
      ].join('\n'),
      fragmentShader: sh(
        'uniform vec3 uC;uniform vec3 uC2;uniform float uT;uniform float uI;uniform float uVoile;varying vec3 vN;varying vec3 vV;varying vec3 vO;varying vec3 vW;',
        'void main(){float fr=pow(clamp(1.0-abs(dot(normalize(vN+1e-5),normalize(vV))),0.0,1.0),2.2);float lignes=0.55+0.45*sin(vW.y*1.4-uT*6.0);',
        'float ecailles=smoothstep(0.6,1.0,sin(vO.z*80.0)*sin(atan(vO.y,vO.x)*12.0));float glitch=step(0.94,fract(sin(floor(vW.y*0.4)+floor(uT*7.0)*13.1)*437.5));',
        'vec3 c=mix(uC,uC2,smoothstep(0.3,0.5,vO.z));float rayons=0.5+0.5*sin((vO.y-vO.x)*150.0);',
        'float a=(0.05+fr*0.9+ecailles*0.25+uVoile*(0.2+0.35*rayons))*lignes*(1.0-glitch*0.75)*uI;gl_FragColor=vec4(c*a,1.0);'
      )
    })
  const kois = (
    [
      [0xff4f9f, 0xffd6ea],
      [0x2f8bff, 0xd2e6ff]
    ] as const
  ).map(([c1, c2], i) => {
    const g = new THREE.Group()
    const mv = koiMat(c1, c2, i * Math.PI, false, true)
    g.add(
      new THREE.Mesh(koiCorps, koiMat(c1, c2, i * Math.PI, false, false)),
      new THREE.Mesh(koiCorps, koiMat(c1, c2, i * Math.PI, true, false)),
      ...koiVoiles.map((v) => new THREE.Mesh(v, mv))
    )
    g.scale.setScalar(62)
    sprite(c1, 1.5, 0, 0, 0, 0.1, g)
    g.name = 'koi'
    groupe.add(g)
    return g
  })
  const _a = new THREE.Vector3()
  const _b = new THREE.Vector3()
  const posKoi = (u: number, i: number, v: THREE.Vector3): THREE.Vector3 => {
    const a = u * 0.11 + i * Math.PI
    return v.set(-10 + Math.cos(a) * 55, 30 + i * 8 + Math.sin(a * 2) * 6, -150 + Math.sin(a) * 40)
  }

  // ---------- LES ENSEIGNES EN PRISMES, et la marquise AUTOWIN ----------
  const panneau = (mot: string, c: string): THREE.CanvasTexture => {
    const [cv, g] = toile(128, 512)
    g.fillStyle = '#0a0710'
    g.fillRect(0, 0, 128, 512)
    g.shadowColor = c
    g.shadowBlur = 14
    g.strokeStyle = c
    g.lineWidth = 6
    g.strokeRect(10, 10, 108, 492)
    const ls = [...mot]
    const pas = 470 / ls.length
    g.font =
      'bold ' +
      Math.round(Math.min(84, pas * 0.9)) +
      'px Bahnschrift,"Yu Gothic UI","Yu Gothic",Meiryo,sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    ls.forEach((l, k) => {
      g.save()
      g.translate(64, 22 + pas * (k + 0.5))
      if (l === 'ー') g.rotate(Math.PI / 2)
      g.shadowBlur = 18
      g.fillStyle = c
      g.fillText(l, 0, 0)
      g.shadowBlur = 0
      g.fillStyle = 'rgba(255,255,255,.55)'
      g.fillText(l, 0, 0)
      g.restore()
    })
    return tex(cv)
  }
  const faces = ctx.motifs.map((m) => {
    const f = FACES_PRISMES[m.mot] ?? { autre: m.mot, kata: m.mot }
    return {
      autre: panneau(f.autre, m.couleur),
      kata: panneau(f.kata, m.couleur),
      autowin: panneau('AUTOWIN', m.couleur),
      ...m
    }
  })
  const boite = new THREE.BoxGeometry(0.8, 3.2, 0.8)
  const bout = new THREE.MeshBasicMaterial({ color: 0x07050b })
  const prismes = ctx.enseignes.map((e) => {
    const f = faces[e.i]
    const m = (t: THREE.Texture): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ map: t })
    // L'ordre des faces d'une boîte : +x, -x, +y, -y, +z, -z. Comme le drapeau qu'il remplace, le prisme
    // montre d'abord sa face +z, tournée vers nous : le mot d'origine. Les quarts de tour amènent les autres.
    const prisme = new THREE.Mesh(boite, [
      m(f.autre),
      m(f.kata),
      bout,
      bout,
      m(f.texture),
      m(f.autowin)
    ])
    prisme.position.copy(e.box.position)
    prisme.name = 'prisme'
    e.box.visible = false
    decor.add(prisme)
    return prisme
  })
  const dos = (x: number): number => {
    const c1 = 1.70158
    const c3 = c1 + 1
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
  }
  const FW = 5.6
  const FH = 2.5
  const [mc, mg] = toile(1024, 456)
  mg.fillStyle = '#0b0612'
  mg.fillRect(0, 0, 1024, 456)
  mg.textAlign = 'center'
  mg.textBaseline = 'middle'
  mg.font = 'bold 176px Bahnschrift, Impact, sans-serif'
  mg.shadowColor = '#ff2fa0'
  mg.shadowBlur = 39
  mg.lineWidth = 14
  mg.strokeStyle = '#ff2fa0'
  mg.strokeText('AUTOWIN', 512, 198)
  mg.shadowBlur = 0
  mg.fillStyle = '#fff3fa'
  mg.fillText('AUTOWIN', 512, 198)
  mg.font = '600 52px Consolas, monospace'
  mg.fillStyle = '#2ee8ff'
  mg.shadowColor = '#2ee8ff'
  mg.shadowBlur = 16
  mg.fillText('O S   ·   E N   D I R E C T', 512, 338)
  const marquiseMat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: tex(mc) }, uT },
    vertexShader: VS_UW,
    fragmentShader: sh(
      'uniform sampler2D uMap;uniform float uT;varying vec2 vU;varying vec3 vW;',
      'void main(){vec2 uv=vU;float p=fract(uT/4.2);float w=p<0.45?smoothstep(0.0,0.02,0.1+p/0.45*0.82-uv.x):(p<0.7?step(0.5,fract((p-0.45)/0.0625)):1.0);',
      'vec3 c=texture2D(uMap,uv).rgb*mix(0.12,1.3,w);vec2 W=vec2(' +
        FW.toFixed(2) +
        ',' +
        FH.toFixed(2) +
        ');vec2 q=uv*W;vec2 a=vec2(0.1),b=W-0.1;',
      'float dT=abs(q.y-b.y),dB=abs(q.y-a.y),dL=abs(q.x-a.x),dR=abs(q.x-b.x);float s,dd;',
      'if(min(dT,dB)<min(dL,dR)){s=dT<dB?q.x-a.x:(b.x-a.x)+(b.y-a.y)+(b.x-q.x);dd=min(dT,dB);}else{s=dR<dL?(b.x-a.x)+(b.y-q.y):2.0*(b.x-a.x)+(b.y-a.y)+(q.y-a.y);dd=min(dL,dR);}',
      'float sp=0.14;float k=floor(s/sp);float r=length(vec2((fract(s/sp)-0.5)*sp,dd));float on=step(1.5,mod(k-floor(uT*7.0),3.0));',
      'c+=vec3(1.0,0.8,0.5)*(smoothstep(0.045,0.025,r)*(0.3+2.0*on)+exp(-r*38.0)*on*0.35);gl_FragColor=vec4(c,1.0);'
    )
  })
  const metal = new THREE.MeshStandardMaterial({ color: 0x15131b, metalness: 0.8, roughness: 0.4 })
  const marquises = Array.from({ length: copies }, (_, r) => {
    const g = new THREE.Group()
    g.position.set(FACADE - 3.0, 10.6, Z0 + r * P + 17)
    g.name = 'marquise'
    g.add(new THREE.Mesh(new THREE.PlaneGeometry(FW, FH), marquiseMat))
    const bras = new THREE.Mesh(new THREE.BoxGeometry(5.9, 0.09, 0.09), metal)
    bras.position.set(0.15, FH / 2 + 0.35, 0)
    g.add(bras)
    for (const x of [-2.2, 2.2]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.35, 0.025), metal)
      c.position.set(x, FH / 2 + 0.17, 0)
      g.add(c)
    }
    decor.add(g)
    return g
  })

  // ---------- LA TOUR DE CONTRÔLE : arêtes holo, bandes qui montent ----------
  const { x: TX, z: TZ, hauteur: TH, largeur } = SPIRALE.tour
  const geoTour = new THREE.BoxGeometry(1, 1, 1)
  geoTour.translate(0, 0.5, 0)
  const tourMat = new THREE.ShaderMaterial({
    uniforms: { uT },
    vertexShader:
      'varying vec3 vL;varying vec3 vW;varying vec3 vN;void main(){vL=position;vN=normal;vec4 w=modelMatrix*vec4(position,1.0);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}',
    fragmentShader: sh(
      'uniform float uT;varying vec3 vL;varying vec3 vW;varying vec3 vN;',
      'void main(){float e=abs(vN.x)>0.5?abs(vL.z):abs(vL.x);float bord=smoothstep(0.4,0.5,e);float bande=step(0.9,fract(vW.y*0.12-uT*0.4));float grille=step(0.92,fract(vW.y*0.6));',
      'vec3 c=vec3(0.015,0.02,0.04)+vec3(0.18,0.85,1.0)*(bord*2.0+bande*0.8+grille*0.1)+vec3(1.0,0.31,0.62)*bande*bord;',
      'if(vN.y>0.5)c=vec3(1.0,0.31,0.62)*0.8;gl_FragColor=vec4(c,1.0);'
    )
  })
  const tour = new THREE.Mesh(geoTour, tourMat)
  tour.scale.set(largeur, TH, largeur)
  tour.position.set(TX, SOL, TZ)
  tour.name = 'tour-de-controle'
  groupe.add(tour)
  const antenne = new THREE.Mesh(new THREE.BoxGeometry(0.8, 30, 0.8), NOIR)
  antenne.position.set(TX, SOL + TH + 15, TZ)
  groupe.add(antenne)
  const feu = sprite(0xff2046, 10, TX, SOL + TH + 30, TZ, 1, groupe)

  // ---------- les anneaux de texte autour de la tour ----------
  const holoMat = (map: THREE.Texture, c: number): THREE.ShaderMaterial =>
    new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: map },
        uT,
        uC: { value: new THREE.Color(c) },
        uPh: { value: rnd() * 10 }
      },
      side: THREE.DoubleSide,
      ...ADD,
      vertexShader: VS_UW,
      fragmentShader: sh(
        'uniform sampler2D uMap;uniform float uT;uniform vec3 uC;uniform float uPh;varying vec2 vU;varying vec3 vW;',
        H1,
        'void main(){float g=step(0.93,h1(floor(uT*9.0)+uPh));float r=h1(floor(vU.y*20.0)+floor(uT*25.0)+uPh);vec2 uv=vU+vec2((r-0.5)*0.12*g,0.0);',
        'vec3 m=texture2D(uMap,uv).rgb;float l=0.75+0.25*sin(vW.y*2.2-uT*5.0+uPh);float f=gl_FrontFacing?1.0:0.35;',
        'gl_FragColor=vec4((m*2.6*l+0.045)*uC*f*(1.0-g*0.5)*(0.9+0.1*sin(uT*41.0+uPh)),1.0);'
      )
    })
  const masqueTexte = (s: string): THREE.CanvasTexture => {
    const [, g0] = toile(8, 8)
    g0.font = 'bold 120px Bahnschrift, Impact, sans-serif'
    const w = Math.max(8, Math.ceil(g0.measureText(s).width))
    const [c, g] = toile(w * 2, 190)
    g.fillStyle = '#000'
    g.fillRect(0, 0, w * 2, 190)
    g.font = g0.font
    g.textBaseline = 'middle'
    g.fillStyle = '#fff'
    g.fillText(s, 0, 99)
    g.fillText(s, w, 99)
    g.fillRect(0, 8, w * 2, 5)
    g.fillRect(0, 177, w * 2, 5)
    const t = tex(c)
    t.wrapS = THREE.RepeatWrapping
    return t
  }
  const anneaux = (
    [
      [5, 0.2, 'AUTOWIN  ·  TOUR  ·  '],
      [22, -0.14, 'SCOUT  ·  BUILD  ·  JUDGE  ·  '],
      [39, 0.1, '3 AGENTS  ·  11 RUNS VERTS  ·  ']
    ] as const
  )
    .slice(0, SPIRALE.anneaux)
    .map(([y, v, texte], i) => {
      const R = SPIRALE.rayonsAnneaux[i]
      const g = new THREE.Group()
      g.position.set(TX, y, TZ)
      g.add(
        new THREE.Mesh(
          new THREE.CylinderGeometry(R, R, 8, 160, 1, true),
          holoMat(masqueTexte(texte), i % 2 ? 0xff4f9f : 0x2ee8ff)
        )
      )
      const lisere = new THREE.MeshBasicMaterial({
        color: i % 2 ? 0x2ee8ff : 0xff4f9f,
        fog: false,
        ...ADD
      })
      for (const dy of [-5.1, 5.1]) {
        const r = new THREE.Mesh(new THREE.TorusGeometry(R + 0.4, 0.18, 6, 200), lisere)
        r.rotation.x = Math.PI / 2
        r.position.y = dy
        g.add(r)
      }
      g.name = 'anneau'
      groupe.add(g)
      return { g, y, v: v * SPIRALE.vitesseAnneaux }
    })

  // ---------- LE RAIL EN HÉLICE, la rame et les portiques ----------
  const voie = voieHelice()
  const LONG = voie.getLength()
  const railMat = new THREE.ShaderMaterial({
    uniforms: { uT },
    vertexShader:
      'varying vec3 vN;varying vec2 vU;void main(){vU=uv;vN=normal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: sh(
      'uniform float uT;varying vec3 vN;varying vec2 vU;',
      'void main(){float top=smoothstep(0.5,0.9,vN.y);float tiret=step(0.82,fract(vU.x*' +
        Math.round(LONG / 3) +
        '.0-uT*4.0));',
      'vec3 c=vec3(0.03,0.025,0.045)+vec3(0.18,0.85,1.0)*top*(0.5+1.2*tiret)+vec3(1.0,0.31,0.62)*smoothstep(0.3,0.0,abs(vN.y))*0.35;gl_FragColor=vec4(c,1.0);'
    )
  })
  const rail = new THREE.Mesh(new THREE.TubeGeometry(voie, 900, 0.9, 8, false), railMat)
  rail.name = 'rail-helice'
  groupe.add(rail)
  groupe.add(
    new THREE.Mesh(
      new THREE.TubeGeometry(voie, 900, 2.88, 8, false),
      new THREE.MeshBasicMaterial({ color: 0x0a2233, fog: false, ...ADD })
    )
  )
  // L'HÉLICE SE LIT (2026-10-17) : le rail seul, fin, cyan et rose comme les liserés des anneaux, se
  // perdait entre les anneaux de texte dans l'Accueil de l'utilisateur. Sur la SEULE partie en
  // hélice : un néon à cœur blanc où des éclats roses montent, et un halo bleu doux autour. L'arrivée
  // du rail, tout près de la caméra, n'est pas épaissie : elle mangerait le bas de l'écran.
  {
    let u0 = -1
    let u1 = -1
    for (let i = 0; i <= 2000; i++) {
      const p = voie.getPointAt(i / 2000)
      if (Math.abs(Math.hypot(p.x - TX, p.z - TZ) - SPIRALE.helice.rayon) < 3) {
        if (u0 < 0) u0 = i / 2000
        u1 = i / 2000
      }
    }
    const helice = new (class extends THREE.Curve<THREE.Vector3> {
      getPoint(t: number, cible = new THREE.Vector3()): THREE.Vector3 {
        return voie.getPointAt(u0 + (u1 - u0) * t, cible)
      }
    })()
    // la voie est parcourue à vitesse constante (getPointAt) : la longueur de l hélice en découle
    const eclats = Math.round(((u1 - u0) * LONG) / 12)
    const VS_TUBE =
      'varying vec3 vN;varying vec3 vV;varying vec2 vU;void main(){vU=uv;vec4 mv=modelViewMatrix*vec4(position,1.0);vN=normalize(normalMatrix*normal);vV=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}'
    const neon = new THREE.Mesh(
      new THREE.TubeGeometry(helice, 600, 1.5, 10, false),
      new THREE.ShaderMaterial({
        uniforms: { uT },
        vertexShader: VS_TUBE,
        fragmentShader: sh(
          'uniform float uT;varying vec3 vN;varying vec3 vV;varying vec2 vU;',
          'void main(){float face=abs(dot(normalize(vN),normalize(vV)));',
          // un éclat tous les 12 m, qui monte le long de l'hélice
          'float eclat=smoothstep(0.72,1.0,fract(vU.x*' + eclats + '.0-uT*0.6));',
          'vec3 c=mix(vec3(0.16,0.3,1.0),vec3(0.75,0.85,1.0),pow(face,6.0))*(0.55+0.35*face)+vec3(1.0,0.3,0.68)*eclat*1.4;',
          'gl_FragColor=vec4(c,1.0);'
        )
      })
    )
    neon.name = 'helice-neon'
    groupe.add(neon)
    const halo = new THREE.Mesh(
      new THREE.TubeGeometry(helice, 600, 4.5, 12, false),
      new THREE.ShaderMaterial({
        uniforms: { uT },
        ...ADD,
        vertexShader: VS_TUBE,
        fragmentShader: sh(
          'uniform float uT;varying vec3 vN;varying vec3 vV;varying vec2 vU;',
          'void main(){float face=abs(dot(normalize(vN),normalize(vV)));',
          'vec3 c=vec3(0.18,0.32,0.92)*pow(face,2.6)*(0.16+0.04*sin(uT*1.3));',
          'gl_FragColor=vec4(c,1.0);'
        )
      })
    )
    halo.name = 'helice-halo'
    groupe.add(halo)
  }
  // Les piles : une seule géométrie fusionnée, un seul appel de dessin.
  {
    const piles: THREE.BufferGeometry[] = []
    for (let u = 0.16; u < 0.99; u += 0.08) {
      const p = voie.getPointAt(u)
      if (Math.hypot(p.x - TX, p.z - TZ) < 14) continue
      const h = p.y - SOL
      const b = new THREE.BoxGeometry(0.8, h, 0.8)
      b.translate(p.x, SOL + h / 2 - 0.4, p.z)
      piles.push(b)
    }
    const g = fusionnerBoites(piles)
    piles.forEach((b) => b.dispose())
    groupe.add(new THREE.Mesh(g, NOIR))
  }
  const [wc, wg] = toile(512, 128)
  wg.fillStyle = '#0b0912'
  wg.fillRect(0, 0, 512, 128)
  for (let k = 0; k < 6; k++) {
    wg.fillStyle = k % 3 === 1 ? '#9fe8ff' : '#ffd9a8'
    wg.fillRect(18 + k * 82, 30, 62, 46)
  }
  wg.fillStyle = '#ff4f9f'
  wg.fillRect(0, 92, 512, 9)
  wg.fillStyle = '#2ee8ff'
  wg.fillRect(0, 14, 512, 4)
  const cote = new THREE.MeshBasicMaterial({ map: tex(wc), fog: false })
  const toit = new THREE.MeshBasicMaterial({ color: 0x0e0b16, fog: false })
  const nez = new THREE.MeshBasicMaterial({ color: 0x9fe8ff, fog: false })
  const wagon = new THREE.BoxGeometry(2.3, 2.5, 10)
  const wagons = Array.from({ length: SPIRALE.rame.voitures }, (_, k) => {
    const m = new THREE.Mesh(wagon, [cote, cote, toit, toit, k === 0 ? nez : toit, toit])
    sprite(0x2ee8ff, 1, 0, -1.5, 0, 0.5, m).scale.set(5, 1.6, 1)
    // VISIBLE AU MONTAGE : la compilation en tâche de fond ne prépare que ce qui est visible. Née
    // cachée, la rame aurait compilé ses programmes à son premier passage, en pleine marche. C'est
    // `animer`, appelé avant la première image, qui la range hors de la voie.
    m.name = 'wagon'
    groupe.add(m)
    return m
  })
  const phare = sprite(0xeef8ff, 9, 0, 0, 0, 1, groupe)
  const _q1 = new THREE.Vector3()
  const _q2 = new THREE.Vector3()
  const texPortique = masqueTexte('AUTOWIN  ·  EXPRESS  ·  ')
  const C0 = new THREE.Color(0x2ee8ff)
  const R0 = new THREE.Color(0xff4f9f)
  const portiques = SPIRALE.portiques.map((u) => {
    const g = new THREE.Group()
    voie.getPointAt(u, _q1)
    voie.getTangentAt(u, _q2)
    g.position.set(_q1.x, _q1.y + 1.9, _q1.z)
    g.lookAt(_q1.x + _q2.x, _q1.y + 1.9 + _q2.y, _q1.z + _q2.z)
    g.name = 'portique'
    groupe.add(g)
    const R = 4.6
    const bm = holoMat(texPortique, 0x2ee8ff)
    const b = new THREE.Mesh(new THREE.CylinderGeometry(R, R, R * 0.3, 64, 1, true), bm)
    b.rotation.x = Math.PI / 2
    g.add(b)
    const tm = new THREE.MeshBasicMaterial({ color: 0xff4f9f, fog: false, ...ADD })
    for (const z of [-R * 0.2, R * 0.2]) {
      const t2 = new THREE.Mesh(new THREE.TorusGeometry(R + 0.1, 0.12, 6, 96), tm)
      t2.position.z = z
      g.add(t2)
    }
    return { g, b, bm, tm, halo: sprite(0x2ee8ff, R * 3.5, 0, 0, 0, 0.12, g), s: u * LONG }
  })

  // ---------- L'ESSAIM DE DRONES : AUTOWIN, puis ✓ ----------
  const ND = SPIRALE.essaim.drones
  const essaim = nuee(ND)
  const vol = new THREE.Group()
  vol.position.set(TX, SPIRALE.essaim.hauteur, TZ - 20)
  vol.lookAt(-5.55, 1.75, 10)
  vol.scale.setScalar(34)
  vol.add(essaim.p)
  vol.name = 'essaim'
  groupe.add(vol)
  const formeTexte = (str: string, n: number, larg: number): [number[][], number[][]] => {
    const W = Math.max(640, str.length * 92)
    const [, g] = toile(W, 140)
    g.fillStyle = '#fff'
    g.font = 'bold 120px Bahnschrift, Impact, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(str, W / 2, 74)
    const d = g.getImageData?.(0, 0, W, 140)?.data
    const cand: number[][] = []
    if (d)
      for (let y = 0; y < 140; y += 2)
        for (let x = 0; x < W; x += 2) if (d[(y * W + x) * 4 + 3] > 128) cand.push([x, y])
    // Sans dessin lisible (police absente), les drones restent en nuage plutôt que de tous s'empiler.
    if (cand.length === 0) for (let k = 0; k < 64; k++) cand.push([rnd() * W, 30 + rnd() * 80])
    const P2: number[][] = []
    const C: number[][] = []
    const o = new THREE.Color()
    for (let i = 0; i < n; i++) {
      const [x, y] = cand[Math.floor(rnd() * cand.length)]
      P2.push([(x / W - 0.5) * larg, (0.5 - y / 140) * ((larg * 140) / W), 0])
      palette(x / W, o)
      C.push([o.r, o.g, o.b])
    }
    return [P2, C]
  }
  const formeCoche = (n: number): [number[][], number[][]] => {
    const seg = [
      [-0.75, 0.05],
      [-0.25, -0.5],
      [0.85, 0.7]
    ]
    const l1 = Math.hypot(0.5, 0.55)
    const l2 = Math.hypot(1.1, 1.2)
    const P2: number[][] = []
    const C: number[][] = []
    for (let i = 0; i < n; i++) {
      const u = rnd() * (l1 + l2)
      const [a, b] = u < l1 ? [seg[0], seg[1]] : [seg[1], seg[2]]
      const f = u < l1 ? u / l1 : (u - l1) / l2
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const m = Math.hypot(dx, dy)
      const e = (rnd() - 0.5) * 0.15
      P2.push([a[0] + dx * f - (dy / m) * e, a[1] + dy * f + (dx / m) * e, 0])
      C.push([0, 1, 0.33])
    }
    return [P2, C]
  }
  const F = SPIRALE.essaim.formes.map((f) =>
    f === 'autowin' ? formeTexte('AUTOWIN', ND, 3.6) : formeCoche(ND)
  )
  const RET = Array.from({ length: ND }, () => rnd() * 0.7)
  const DUREES = SPIRALE.essaim.durees
  const TOT = DUREES.reduce((a, b) => a + b, 0)
  for (let i = 0; i < ND; i++) essaim.ta[i] = 3.4

  // ---------- QUATRE COULOIRS DE VOITURES VOLANTES, peu denses et lents ----------
  const AV = new THREE.Color(0.95, 0.97, 1)
  const AR = new THREE.Color(1, 0.12, 0.22)
  const CY = new THREE.Color(0.18, 0.75, 1)
  const RO = new THREE.Color(1, 0.31, 0.62)
  const COULOIRS = [
    [[-22, 5.5, -430], [0, 0, 1], 470, 30, 26, 0],
    [[-31, 8.5, 40], [0, 0, -1], 470, 26, 26, 1],
    [[-58, 19, -480], [0, 0, 1], 500, 40, 38, 0],
    [[-72, 25, 30], [0, 0, -1], 500, 34, 38, 1]
  ] as const
  const TRAINE = 10
  const voies = COULOIRS.map(([o, d, len, v, n, type]) => ({
    p0: new THREE.Vector3(...o),
    dir: new THREE.Vector3(...d).normalize(),
    len,
    v: v * SPIRALE.trafic.vitesse,
    n: Math.max(1, Math.round(n * SPIRALE.trafic.densite)),
    type
  }))
  const autos: { l: (typeof voies)[number]; v: number; o: number; col: THREE.Color }[] = []
  voies.forEach((l) => {
    for (let k = 0; k < l.n; k++) {
      const neon = rnd() < 0.12
      autos.push({
        l,
        v: l.v * (0.85 + rnd() * 0.3),
        o: rnd() * l.len,
        col: neon ? (k % 2 ? CY : RO) : l.type === 0 ? AV : AR
      })
    }
  })
  const trafic = nuee(autos.length * TRAINE)
  groupe.add(trafic.p)
  autos.forEach((w, i) => {
    for (let k = 0; k < TRAINE; k++) {
      const j = i * TRAINE + k
      const f = k ? Math.pow(1 - k / TRAINE, 1.4) * 0.8 : 1.7
      trafic.col.set([w.col.r * f, w.col.g * f, w.col.b * f], j * 3)
      trafic.ta[j] = k ? 1.5 : 2.4
    }
  })
  const _p = new THREE.Vector3()

  const sansReflet: THREE.Object3D[] = [
    ...wagons,
    ...portiques.map((p) => p.g),
    ...anneaux.map((a) => a.g)
  ]
  /** Le reflet n'est dessiné qu'une fois ses programmes prêts ; `null` = pas encore. */
  let debutFondu: number | null = null
  let imagesDepuisReflet = 0
  /** L'image du reflet contient-elle un reflet à jour de sa taille ? */
  let refletValide = false
  // l'eau ne montre rien tant que le reflet n'est pas prêt (mélange additif : force 0 = invisible)
  miroirMat.uniforms.uForce.value = 0

  return {
    groupe,
    miroirs,
    prismes,
    marquises,
    cibleReflet,
    sansReflet,

    activerReflet() {
      if (debutFondu === null) debutFondu = performance.now()
    },

    precompilerReflet(compiler) {
      const precedente = renderer.getRenderTarget()
      miroirs.forEach((m) => (m.visible = false))
      // `compile` de three parcourt TOUS les objets, masqués compris : les jumelles aussi.
      jumelles.poser(scene, true)
      renderer.setRenderTarget(cibleReflet)
      const prete = compiler(scene, scene)
      renderer.setRenderTarget(precedente)
      jumelles.retirer()
      miroirs.forEach((m) => (m.visible = true))
      return prete
    },

    matieresDuReflet() {
      return jumelles.matieres()
    },

    animer(t, parcours) {
      uDecal.value = parcours
      kois.forEach((k, i) => {
        k.position.copy(posKoi(t, i, _a))
        k.lookAt(posKoi(t + 0.05, i, _b))
      })
      // les prismes pivotent d'un quart de tour, en vague le long de l'avenue, et gardent la couleur
      // (le clignotement, le court-circuit) de l'enseigne qu'ils remplacent
      prismes.forEach((pr, k) => {
        const q = (t - pr.position.z * 0.06) / SPIRALE.periodePrismes
        const n = Math.floor(q)
        const ph = Math.min(1, (q - n) / 0.28)
        pr.rotation.y = ((n + dos(ph)) * Math.PI) / 2
        const couleur = ctx.enseignes[k].box.material.color
        for (const m of pr.material as THREE.MeshBasicMaterial[])
          if (m !== bout) m.color.copy(couleur)
      })
      anneaux.forEach((a) => {
        a.g.rotation.y = t * a.v
        a.g.position.y = a.y + Math.sin(t * 0.4) * 0.8
      })
      feu.material.opacity = (t * 1.2) % 1 < 0.5 ? 1 : 0.15
      // la rame et les portiques
      const s = abscisseRame(t, LONG)
      wagons.forEach((m, k) => {
        const sk = s - k * 10.6
        m.visible = sk > 0 && sk < LONG
        if (!m.visible) return
        voie.getPointAt(sk / LONG, _q1)
        voie.getTangentAt(sk / LONG, _q2)
        m.position.copy(_q1)
        m.position.y += 1.9
        m.lookAt(_q1.x + _q2.x, _q1.y + 1.9 + _q2.y, _q1.z + _q2.z)
      })
      phare.visible = wagons[0].visible
      if (phare.visible) {
        voie.getTangentAt(Math.min(1, s / LONG), _q2)
        phare.position.copy(wagons[0].position).addScaledVector(_q2, 5.4)
      }
      portiques.forEach((p) => {
        const d = s - p.s
        const k = d > -25 && d < 85 ? 1 : 0
        p.bm.uniforms.uC.value
          .copy(C0)
          .multiplyScalar(0.5 + 2.4 * k * (0.6 + 0.4 * Math.sin(t * 20)))
        p.tm.color.copy(R0).multiplyScalar(0.6 + 1.5 * k)
        p.halo.material.opacity = 0.06 + 0.35 * k
        p.b.rotation.y = t * 0.6
      })
      // l'essaim passe d'une forme à l'autre
      let u = (t + 2) % TOT
      let k = 0
      while (k < DUREES.length - 1 && u > DUREES[k]) {
        u -= DUREES[k]
        k++
      }
      const av = (k + F.length - 1) % F.length
      for (let i = 0; i < ND; i++) {
        const a = lisse((u - RET[i]) / 1.6)
        const A = F[av][0][i]
        const B = F[k][0][i]
        const j = i * 3
        essaim.pos[j] = A[0] + (B[0] - A[0]) * a
        essaim.pos[j + 1] = A[1] + (B[1] - A[1]) * a + Math.sin(a * Math.PI) * 0.25
        essaim.pos[j + 2] = A[2] + (B[2] - A[2]) * a
        const ca = F[av][1][i]
        const cb = F[k][1][i]
        const e = (1.5 + Math.sin(a * Math.PI) * 0.8) * (Math.random() < 0.004 ? 2.5 : 1)
        essaim.col[j] = (ca[0] + (cb[0] - ca[0]) * a) * e
        essaim.col[j + 1] = (ca[1] + (cb[1] - ca[1]) * a) * e
        essaim.col[j + 2] = (ca[2] + (cb[2] - ca[2]) * a) * e
      }
      essaim.g.attributes.position.needsUpdate = true
      essaim.g.attributes.aCol.needsUpdate = true
      // le trafic : une tête lumineuse et sa traînée par voiture
      autos.forEach((w, i) => {
        const sv = (((w.o + t * w.v) % w.l.len) + w.l.len) % w.l.len
        const esp = w.v * 0.036
        for (let kk = 0; kk < TRAINE; kk++) {
          _p.copy(w.l.p0).addScaledVector(w.l.dir, sv - kk * esp)
          trafic.pos.set([_p.x, _p.y, _p.z], (i * TRAINE + kk) * 3)
        }
      })
      trafic.g.attributes.position.needsUpdate = true
    },

    avantRendu(exclus = []) {
      // la taille des points suit la hauteur réelle de l'image
      renderer.getDrawingBufferSize(_taille)
      const w = Math.max(4, _taille.x)
      const h = Math.max(4, _taille.y)
      const echelle = h / 2 / Math.tan((camera.fov * Math.PI) / 360)
      echelles.forEach((e) => (e.value = echelle))
      const rw = Math.ceil(w * SPIRALE.miroir.resolution)
      const rh = Math.ceil(h * SPIRALE.miroir.resolution)
      if (cibleReflet.width !== rw || cibleReflet.height !== rh) {
        cibleReflet.setSize(rw, rh)
        // réallouée, l'image du reflet est vide : elle se redessine à cette image-ci
        refletValide = false
      }
      // Pas de reflet tant que sa version des programmes n'est pas prête : la dessiner ici la
      // compilerait sur le fil, à cette image (le gel de conv-301). L'eau reste sans reflet.
      if (debutFondu === null) return
      miroirMat.uniforms.uForce.value =
        SPIRALE.miroir.force * Math.min(1, (performance.now() - debutFondu) / FONDU_REFLET_MS)
      // Une image sur REFLET_UNE_IMAGE_SUR : entre deux, l'eau relit le reflet précédent, avec la
      // matrice `texMiroir` de l'image où il a été pris.
      imagesDepuisReflet++
      if (refletValide && imagesDepuisReflet < REFLET_UNE_IMAGE_SUR) return
      // la caméra miroir : symétrique de la caméra par rapport à l'eau, coupée au ras de l'eau
      camera.updateMatrixWorld()
      _cw.setFromMatrixPosition(camera.matrixWorld)
      if (_cw.y <= 0.05) return
      imagesDepuisReflet = 0
      refletValide = true
      _rot.extractRotation(camera.matrixWorld)
      _vise.set(0, 0, -1).applyMatrix4(_rot).add(_cw)
      camMiroir.position.set(_cw.x, -_cw.y, _cw.z)
      camMiroir.up.set(0, 1, 0).applyMatrix4(_rot)
      camMiroir.up.y = -camMiroir.up.y
      camMiroir.lookAt(_vise.x, -_vise.y, _vise.z)
      camMiroir.near = camera.near
      camMiroir.far = camera.far
      camMiroir.updateMatrixWorld()
      camMiroir.projectionMatrix.copy(camera.projectionMatrix)
      texMiroir
        .set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
        .multiply(camMiroir.projectionMatrix)
        .multiply(camMiroir.matrixWorldInverse)
      _plan.set(new THREE.Vector3(0, 1, 0), 0).applyMatrix4(camMiroir.matrixWorldInverse)
      _clip.set(_plan.normal.x, _plan.normal.y, _plan.normal.z, _plan.constant)
      const e = camMiroir.projectionMatrix.elements
      _q.set(
        (Math.sign(_clip.x) + e[8]) / e[0],
        (Math.sign(_clip.y) + e[9]) / e[5],
        -1,
        (1 + e[10]) / e[14]
      )
      _clip.multiplyScalar(2 / _clip.dot(_q))
      e[2] = _clip.x
      e[6] = _clip.y
      e[10] = _clip.z + 1 - 0.003
      e[14] = _clip.w
      camMiroir.projectionMatrixInverse.copy(camMiroir.projectionMatrix).invert()
      echelles.forEach((v) => (v.value = echelle * SPIRALE.miroir.resolution))
      const caches = [...exclus, ...sansReflet].filter((o): o is THREE.Object3D => !!o && o.visible)
      caches.forEach((o) => (o.visible = false))
      miroirs.forEach((m) => (m.visible = false))
      const precedente = renderer.getRenderTarget()
      jumelles.poser(scene)
      renderer.setRenderTarget(cibleReflet)
      renderer.render(scene, camMiroir)
      renderer.setRenderTarget(precedente)
      jumelles.retirer()
      miroirs.forEach((m) => (m.visible = true))
      caches.forEach((o) => (o.visible = true))
      echelles.forEach((v) => (v.value = echelle))
    },

    liberer() {
      cibleReflet.dispose()
      geoTour.dispose()
      jumelles.liberer()
    }
  }
}

/** Fusionne des boîtes non indexées ou indexées en une seule géométrie (positions, normales, uv). */
export function fusionnerBoites(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const plates = geos.map((g) => (g.index ? g.toNonIndexed() : g))
  const total = plates.reduce((n, g) => n + g.attributes.position.count, 0)
  const pos = new Float32Array(total * 3)
  const nor = new Float32Array(total * 3)
  const uv = new Float32Array(total * 2)
  let o = 0
  for (const g of plates) {
    const n = g.attributes.position.count
    pos.set(g.attributes.position.array as ArrayLike<number>, o * 3)
    if (g.attributes.normal) nor.set(g.attributes.normal.array as ArrayLike<number>, o * 3)
    if (g.attributes.uv) uv.set(g.attributes.uv.array as ArrayLike<number>, o * 2)
    o += n
  }
  plates.forEach((g, i) => {
    if (g !== geos[i]) g.dispose()
  })
  const sortie = new THREE.BufferGeometry()
  sortie.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  sortie.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  sortie.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  return sortie
}
