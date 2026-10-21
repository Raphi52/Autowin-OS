import * as THREE from 'three'

/**
 * LE VAISSEAU MÈRE : UNE CITÉ SUR LE MOYEU D'UNE ROUE, ET SES ANNEAUX D'APPROCHE.
 *
 * Demandes de l'utilisateur (conv-319) : « implémente la 5 et met un vaisseau mere », deux /draft de la
 * coque, puis « /draft des variantes du vaisseau spatial » ; il y garde la 5 · Moyeu-cité « mais j'aime
 * pas le dessous de la ville et j'aimerais que le dessus de la ville ait quelques lumieres », et choisit
 * enfin « Implémenter la 6 · Anneaux d'approche ». Brouillon : `.autowin-tmp/draft-vaisseau-v2/t2/`
 * (`variantes.js`, fonctions `moyeuBase` et `v6`). Ce qu'il montre :
 *   - une roue : jante fine, 24 pylônes, six ponts où roulent des tramways de feux ;
 *   - au centre, un disque de 280 m. DESSUS, une ville de 170 tours : un feu de couleur au bout d'un mât
 *     sur six toits sur dix, une balise rouge sur les dix plus hautes. DESSOUS, une plaque et des cercles
 *     de feux d'atterrissage, où une vague de lumière court du centre vers le bord ;
 *   - la roue tourne lentement et emporte sa ville.
 * Plus aucune tour ne pend sous la ville : c'est le « dessous » que l'utilisateur n'aimait pas.
 *
 * CE QU'IL N'A PAS LE DROIT DE FAIRE, parce qu'un fond passe derrière les widgets :
 *   - ajouter une lumière : chaque lumière de plus alourdit toutes les matières de la rue (conv-301,
 *     22 lumières → 8) ; son éclat est dans ses nuanceurs, ses feux et ses halos ;
 *   - cacher la lune : il reste hors de son disque et de son halo proche (le test voisin tire des
 *     rayons vers elle, tours et mâts compris) ;
 *   - se perdre dans le brouillard de la rue : à 1,3 km, `FogExp2` l'effacerait, il a sa propre brume.
 */

/**
 * Où il est, vu de la rue. Azimut compté depuis −z vers +x, hauteur en radians, distance en mètres.
 *
 * Demandes de l'utilisateur (conv-319, 2026-10-18) : « agrandis le vaisseau mère […] d'environ 40 % »,
 * puis « plus grandes plus belle et au centre en fait pas a gauche », et enfin, devant les captures :
 * « Au centre en haut, en grand : je déplace la lune à gauche au-dessus de la ville et j'éclaircis les
 * câbles devant le vaisseau ». Il était à 2 900 m (195 px de large en 1600 × 900), puis à gauche à
 * 2 450 m (267 px). Il est maintenant EN HAUT AU CENTRE, à 1 300 m, à la place de l'ancienne lune
 * (déplacée à gauche, voir `CIEL_LUNAIRE.lune`) ; les câbles devant lui sont éclaircis par la toile
 * (`eclaircieVaisseau`).
 * Mesuré sur la vraie caméra (`.autowin-tmp/draft-vaisseau-v2/centre/placer.ts`) : sur l'écran de
 * l'utilisateur (1745 × 938), centre en (788, 182), enveloppe x 561 à 1002 et y 1 à 294 ; en
 * 1600 × 900, ses coques mesurent 423 px de large, 2,17 fois l'original. Centré en x 850, la façade
 * de droite cachait le tiers droit de la roue ; plus haut, les mâts de la ville sortaient de l'écran ;
 * plus bas, l'immeuble du bout de l'avenue en cachait davantage.
 * Le cap suit l'azimut (0,15 − azimut) pour qu'on voie la roue sous le même angle qu'avant.
 * La lune, en (470, 130) chez lui, est à 0,087 rad de sa pièce la plus proche (le test exige 0,07).
 */
export const VAISSEAU = { azimut: 0.04, hauteur: 0.313, distance: 1300, cap: 0.11 }

/** La direction du vaisseau vue de la rue, et son rayon apparent en radians (jante et feux). */
export function eclaircieVaisseau(): { direction: THREE.Vector3; rayon: number } {
  const { azimut, hauteur, distance } = VAISSEAU
  return {
    direction: new THREE.Vector3(
      Math.sin(azimut) * Math.cos(hauteur),
      Math.sin(hauteur),
      -Math.cos(azimut) * Math.cos(hauteur)
    ),
    rayon: (MOYEU_CITE.jante + 18) / distance
  }
}

/** La roue et la cité de son moyeu. */
export const MOYEU_CITE = {
  /** Rayon de la jante : 570 m de diamètre, 606 m avec ses feux. */
  jante: 285,
  /** Tours debout sur le disque central (dessus). */
  tours: 170,
  /** Part des toits qui portent un feu de couleur au bout d'un mât : six sur dix. */
  toitsAllumes: 0.6,
  /** Balises rouges au bout d'un mât, sur les plus hautes tours. */
  balises: 10,
  /** Cercles de feux d'atterrissage sous la plaque, du rayon 30 m au rayon 138 m. */
  anneaux: 10,
  /** La vague qui court sur les cercles, du centre vers le bord : une toutes les 1 / 0,22 ≈ 4,5 s. */
  vague: 0.22,
  /** Vitesse de la roue, en rad/s : un tour en trois minutes. */
  rotation: 0.035
} as const

/**
 * Le grossissement des feux. Les brouillons cadraient la fenêtre de ciel 2,5 à 3 fois plus serré que
 * l'Accueil ; à la vraie taille, leurs feux ne faisaient plus que 1 à 2 pixels.
 */
export const GROSSISSEMENT_FEUX = 1.7

/**
 * La luminance des fenêtres des tours, vues de trop loin pour être dessinées une à une. Vers 0,1 elle
 * ressort beige-gris et délave la ville ; à 0,04 les tours restent sombres et leurs feux ressortent
 * (mesuré sur la ville en contrebas, note Brain « moyenne des fenêtres lointaines »).
 */
export const MOYENNE_FENETRES_LOIN = 0.04

/**
 * L'éclat du vaisseau. Demande de l'utilisateur (conv-319) : « plus grandes plus belle ». La forme
 * reste celle qu'il a choisie (la 6 · Anneaux d'approche) ; sont plus vifs : les feux de la jante,
 * du bord du disque, des tramways et des toits (tailles), la vague des cercles d'atterrissage (au repos,
 * puis au passage de la vague), et la lueur bleue sous le disque. Avant, dans l'ordre ci-dessous :
 * 7, −14, 7, 10, 10, −16, 6, 0,18 et 1,4, lueur de 160 m à 0,3.
 */
export const ECLAT = {
  /** Taille des feux de la jante ; ses balises rouges clignotent, en taille négative. */
  jante: 9,
  baliseJante: -16,
  /** Feux cyan du bord du disque, tramways, feux de toits et balises des plus hautes tours. */
  disque: 8,
  tramways: 12,
  toits: 12,
  balises: -18,
  /** Feux des cercles d'atterrissage, leur éclat au repos, et le surcroît au passage de la vague. */
  anneaux: 7,
  vagueRepos: 0.3,
  vaguePic: 2.0,
  /** La lueur bleue sous le disque : sa taille en mètres et son opacité. */
  lueur: 240,
  lueurOpacite: 0.45
} as const

/** La brume du brouillon, réglée pour un vaisseau à 2,3 km. */
const BRUME_BROUILLON = 0.00035
const DISTANCE_BROUILLON = 2300
/** Le facteur de brume qui donne, à `distance`, l'air qu'avait un vaisseau du brouillon à 2,3 km. */
export const brumePour = (distance: number): number =>
  (BRUME_BROUILLON * DISTANCE_BROUILLON) / distance

export interface ContexteVaisseau {
  scene: THREE.Object3D
  uT: { value: number }
  uFlash: { value: number }
  uBrume: { value: THREE.Color }
  /** La direction de la lune : elle argente les arêtes tournées vers elle. */
  lune: THREE.Vector3
  /** Position de la caméra : le vaisseau se place par rapport à elle. */
  camera: readonly [number, number, number]
  /** Le canevas du fond : sa hauteur en pixels règle la taille des feux. */
  canevas: { height: number }
  /** Le halo partagé de la rue (libéré avec ses textures). */
  GLOW: THREE.Texture
}

export interface VaisseauMere {
  /** Le vaisseau entier, posé dans le ciel. */
  groupe: THREE.Group
  /** La roue : la jante, les ponts, le disque et toute sa ville tournent avec elle. */
  roue: THREE.Group
  /** Les tours debout sur le disque central. */
  tours: THREE.InstancedMesh
  /** Les mâts des feux de toit : vu d'en dessous, un feu posé à ras du toit serait caché par le toit. */
  mats: THREE.InstancedMesh
  /** Les cercles de feux d'atterrissage sous la plaque. */
  anneaux: THREE.Points
  /** Les feux fixes : jante, bord du disque, et ceux des toits au bout de leur mât. */
  feux: THREE.Points
  /**
   * La taille de TOUS ses feux, en pixels d'écran (elle suit la hauteur du canevas). Exposée pour le
   * reflet de l'eau, dessiné à demi-résolution, qui doit la réduire le temps de son dessin
   * (`suivreLaResolution` de la Spirale, conv-1037) : sans cela, dans l'eau, les feux des toits étaient
   * deux fois trop gros et débordaient sur la plaque qui doit les cacher.
   */
  tailleFeux: { value: number }
  animer(t: number): void
}

const TAU = Math.PI * 2
const ADD = {
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending
} as const
const H = 'float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\n'
const FIN = 'gl_FragColor=vec4(c,1.0);\n#include <colorspace_fragment>\n}'
/** Le dessin d'un feu : un cœur net dans un halo doux. */
const FEU_FS =
  'varying vec3 vC;void main(){vec2 c=gl_PointCoord-0.5;float r=dot(c,c);gl_FragColor=vec4(vC*(exp(-r*22.0)*0.6+exp(-r*90.0)),1.0);}'
/** La taille d'un feu suit la distance ; `uE` porte la hauteur du canevas en pixels. */
const TAILLE_FEU = 'gl_PointSize=clamp(aS*uE/-mv.z,1.2,40.0);gl_Position=projectionMatrix*mv;}'

/** Un feu : position, couleur, taille (négative = balise qui clignote). */
type Feu = [number, number, number, number, number]

/** Un toit de la ville : son sommet (repère de la roue), sa hauteur, son emprise, son mât. */
interface Toit {
  x: number
  y: number
  z: number
  h: number
  w: number
  d: number
  mat: number
}

export function monterVaisseau(ctx: ContexteVaisseau): VaisseauMere {
  const oeil = new THREE.Vector3(...ctx.camera)
  const uE = { value: ctx.canevas.height * 0.9 * GROSSISSEMENT_FEUX }
  const brume = brumePour(VAISSEAU.distance)
  // la graine du brouillon : même ville, mêmes toits allumés
  let s = 65
  const rnd = (): number => (s = (s * 16807) % 2147483647) / 2147483647

  // ---------- la coque : le clair de lune argente les arêtes, des hublots sur les flancs ----------
  const coque = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      uT: ctx.uT,
      uFlash: ctx.uFlash,
      uLune: { value: ctx.lune },
      uBrume: ctx.uBrume,
      uBase: { value: new THREE.Color(0x0c111b) },
      uWin: { value: new THREE.Color(0xc8e4ff) },
      uOn: { value: 0.55 },
      uPas: { value: new THREE.Vector2(9, 6) },
      uPan: { value: 14 },
      uHz: { value: brume }
    },
    vertexShader:
      'varying vec3 vW;varying vec3 vN;varying vec3 vL;void main(){vec4 w=modelMatrix*vec4(position,1.0);vW=w.xyz;vN=normalize(mat3(modelMatrix)*normal);vL=position;gl_Position=projectionMatrix*viewMatrix*w;}',
    fragmentShader: [
      'uniform float uT;uniform float uFlash;uniform vec3 uLune;uniform vec3 uBrume;uniform vec3 uBase;uniform vec3 uWin;',
      'uniform float uOn;uniform vec2 uPas;uniform float uPan;uniform float uHz;varying vec3 vW;varying vec3 vN;varying vec3 vL;',
      H,
      'void main(){vec3 N=normalize(vN);vec3 V=normalize(cameraPosition-vW);float d=length(vW-cameraPosition);vec3 c=uBase;',
      '  vec2 pq=(abs(N.y)>0.6?vL.xz:vec2(vL.x+vL.z,vL.y))/uPan;vec2 pf=abs(fract(pq)-0.5);',
      '  c*=(0.75+0.5*h(floor(pq)))*(1.0-0.35*step(0.46,max(pf.x,pf.y)));',
      '  float lam=max(dot(N,uLune),0.0);float fr=pow(1.0-abs(dot(N,V)),3.0);',
      '  c+=vec3(0.3,0.4,0.6)*lam*0.14+vec3(0.6,0.75,1.0)*fr*lam*0.8;c+=vec3(0.03,0.06,0.12)*max(-N.y,0.0)*0.8;',
      '  if(abs(N.y)<0.55){vec2 q=vec2(vL.x+vL.z,vL.y)/uPas;vec2 id=floor(q),f=fract(q);',
      '    float hub=step(0.22,f.x)*step(f.x,0.78)*step(0.3,f.y)*step(f.y,0.72);float on=step(uOn,h(id+7.0));',
      '    float aa=smoothstep(0.3,0.9,max(fwidth(q.x),fwidth(q.y)));c+=mix(uWin*hub*on,uWin*0.07*(1.0-uOn),aa)*0.9;}',
      '  c+=vec3(0.6,0.7,1.0)*uFlash*(0.08+0.25*abs(N.y));',
      '  c=mix(c,uBrume,1.0-exp(-pow(d*uHz,1.6)));',
      FIN
    ].join('\n')
  })

  const piece = (
    g: THREE.Object3D,
    geo: THREE.BufferGeometry,
    x = 0,
    y = 0,
    z = 0,
    rx = 0,
    ry = 0,
    rz = 0
  ): THREE.Mesh => {
    const p = new THREE.Mesh(geo, coque)
    p.position.set(x, y, z)
    p.rotation.set(rx, ry, rz)
    g.add(p)
    return p
  }

  // ---------- des feux fixes : des points dont la taille suit la distance ; taille négative = balise ----------
  const feux = (g: THREE.Object3D, liste: Feu[]): THREE.Points => {
    const pos: number[] = []
    const col: number[] = []
    const taille: number[] = []
    const k = new THREE.Color()
    for (const [x, y, z, c, t] of liste) {
      k.setHex(c)
      pos.push(x, y, z)
      col.push(k.r, k.g, k.b)
      taille.push(t)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('aC', new THREE.Float32BufferAttribute(col, 3))
    geo.setAttribute('aS', new THREE.Float32BufferAttribute(taille, 1))
    const p = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: { uT: ctx.uT, uE },
        ...ADD,
        vertexShader:
          'attribute vec3 aC;attribute float aS;uniform float uT;uniform float uE;varying vec3 vC;void main(){float ph=fract(sin(dot(position.xz+position.y,vec2(12.9898,78.233)))*43758.5453);float k=aS<0.0?step(0.72,fract(uT*0.55+ph)):1.0;vC=aC*k;vec4 mv=modelViewMatrix*vec4(position,1.0);gl_PointSize=clamp(abs(aS)*uE/-mv.z,1.2,40.0);gl_Position=projectionMatrix*mv;}',
        fragmentShader: FEU_FS
      })
    )
    p.frustumCulled = false
    g.add(p)
    return p
  }

  // ---------- des feux qui bougent : leur position est calculée par le nuanceur, à chaque image ----------
  const feuxMobiles = (
    g: THREE.Object3D,
    attributs: Record<string, { valeurs: number[]; taille: number }>,
    vertexShader: string,
    uniforms: Record<string, THREE.IUniform> = {}
  ): THREE.Points => {
    const geo = new THREE.BufferGeometry()
    for (const [nom, { valeurs, taille }] of Object.entries(attributs))
      geo.setAttribute(nom, new THREE.Float32BufferAttribute(valeurs, taille))
    const p = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: { uT: ctx.uT, uE, ...uniforms },
        ...ADD,
        vertexShader,
        fragmentShader: FEU_FS
      })
    )
    p.frustumCulled = false
    g.add(p)
    return p
  }

  const halo = (
    g: THREE.Object3D,
    couleur: number,
    taille: number,
    x: number,
    y: number,
    z: number,
    opacite: number
  ): THREE.Sprite => {
    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: ctx.GLOW,
        color: couleur,
        opacity: opacite,
        fog: false,
        ...ADD
      })
    )
    sp.scale.set(taille, taille, 1)
    sp.position.set(x, y, z)
    g.add(sp)
    return sp
  }

  // ========== le vaisseau : la roue, vue un peu par en dessous ==========
  const groupe = new THREE.Group()
  groupe.name = 'moyeu-cite'
  {
    const { azimut, hauteur, distance, cap } = VAISSEAU
    groupe.position.set(
      oeil.x + Math.sin(azimut) * Math.cos(hauteur) * distance,
      oeil.y + Math.sin(hauteur) * distance,
      oeil.z - Math.cos(azimut) * Math.cos(hauteur) * distance
    )
    groupe.rotation.y = cap
  }
  const y0 = groupe.position.y
  // l'axe de la roue penche de 0,32 rad : on la voit en ellipse. Dans le repère de la roue, +z pointe
  // vers le BAS (le dessous de la cité), −z vers le HAUT (sa ville).
  const axe = new THREE.Group()
  axe.rotation.x = Math.PI / 2 - 0.32
  groupe.add(axe)
  const roue = new THREE.Group()
  roue.name = 'roue'
  axe.add(roue)

  // ---------- la roue : jante fine, pylônes, six ponts, le disque central et la plaque du dessous ----------
  const R = MOYEU_CITE.jante
  piece(roue, new THREE.TorusGeometry(R, 13, 16, 180))
  const pylone = new THREE.BoxGeometry(30, 8, 10)
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU
    piece(roue, pylone, Math.cos(a) * (R + 10), Math.sin(a) * (R + 10), 0, 0, 0, a)
  }
  const pont = new THREE.BoxGeometry(18, R - 140, 7)
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU
    const m = (R - 140) / 2 + 130
    piece(roue, pont, -Math.sin(a) * m, Math.cos(a) * m, 0, 0, 0, a)
  }
  piece(roue, new THREE.CylinderGeometry(140, 150, 26, 24), 0, 0, 0, Math.PI / 2)
  piece(roue, new THREE.CylinderGeometry(60, 90, 40, 24), 0, 0, -30, Math.PI / 2)
  piece(roue, new THREE.CylinderGeometry(132, 142, 8, 48), 0, 0, 17, Math.PI / 2)

  // ---------- la ville du dessus : 170 tours debout sur le disque ----------
  // Chaque tour monte le long de son axe y local, de sa base (0) à son toit (1). Les fenêtres sont posées
  // dans le repère de la tour (`vL` × son échelle `vZ`) : elles restent sur la façade quand la roue tourne.
  const tours = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
    new THREE.ShaderMaterial({
      uniforms: {
        uBrume: ctx.uBrume,
        uFlash: ctx.uFlash,
        uLune: { value: ctx.lune },
        uHz: { value: brume },
        uLoin: { value: MOYENNE_FENETRES_LOIN }
      },
      vertexShader:
        'varying vec3 vW;varying vec3 vN;varying vec3 vNl;varying vec3 vL;varying vec3 vZ;varying float vS;void main(){vec4 w=modelMatrix*instanceMatrix*vec4(position,1.0);vW=w.xyz;vN=normalize(mat3(modelMatrix*instanceMatrix)*normal);vNl=normal;vL=position;vZ=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));vS=fract(sin(dot(instanceMatrix[3].xyz,vec3(12.9898,78.233,37.719)))*43758.5453);gl_Position=projectionMatrix*viewMatrix*w;}',
      fragmentShader: [
        'uniform vec3 uBrume;uniform float uHz;uniform float uFlash;uniform vec3 uLune;uniform float uLoin;',
        'varying vec3 vW;varying vec3 vN;varying vec3 vNl;varying vec3 vL;varying vec3 vZ;varying float vS;',
        H,
        'void main(){vec3 N=normalize(vN);float d=length(vW-cameraPosition);vec3 c=vec3(0.03,0.028,0.036);',
        '  c+=vec3(0.3,0.4,0.6)*max(dot(N,uLune),0.0)*0.08;',
        '  if(abs(vNl.y)<0.5){float u=(abs(vNl.x)>0.5?vL.z*vZ.z:vL.x*vZ.x)+vS*40.0;',
        '    vec2 q=vec2(u/2.6,vL.y*vZ.y/3.0);vec2 id=floor(q),f=fract(q);',
        '    float win=step(0.25,f.x)*step(f.x,0.7)*step(0.35,f.y)*step(f.y,0.8);float r=h(id+vS*17.0);',
        '    vec3 wc=r>0.9?vec3(0.55,1.0,0.7):(r>0.8?vec3(0.5,0.7,1.0):(r>0.6?vec3(1.0,0.85,0.6):vec3(1.0,0.6,0.35)));',
        '    float on=step(0.38,h(id.yx+vS*3.0));float aa=smoothstep(0.3,0.9,max(fwidth(q.x),fwidth(q.y)));',
        '    c+=mix(wc*win*on,wc*uLoin,aa)*0.75;}',
        '  c+=vec3(0.55,0.6,0.9)*uFlash*0.05;c=mix(c,uBrume,1.0-exp(-pow(d*uHz,1.6)));',
        FIN
      ].join('\n')
    }),
    MOYEU_CITE.tours
  )
  tours.name = 'tours'
  tours.frustumCulled = false
  roue.add(tours)
  const m4 = new THREE.Matrix4()
  const HAUT = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, -1)
  )
  const v = new THREE.Vector3()
  const echelle = new THREE.Vector3()
  const toits: Toit[] = []
  for (let k = 0; k < MOYEU_CITE.tours; k++) {
    const a = rnd() * TAU
    const r = 40 + Math.sqrt(rnd()) * 95
    const w = 9 + rnd() * 12
    const d = 9 + rnd() * 12
    const h = 20 + rnd() * 90
    m4.compose(v.set(Math.cos(a) * r, Math.sin(a) * r, -9), HAUT, echelle.set(w, h, d))
    tours.setMatrixAt(k, m4)
    toits.push({ x: v.x, y: v.y, z: -9 - h, h, w, d, mat: 0 })
  }
  tours.instanceMatrix.needsUpdate = true

  // ---------- les feux fixes : la jante (blancs, balises rouges) et le bord du disque (cyan) ----------
  const feuxFixes: Feu[] = []
  for (let i = 0; i < 144; i++) {
    const a = (i / 144) * TAU
    feuxFixes.push([
      Math.cos(a) * (R + 18),
      Math.sin(a) * (R + 18),
      0,
      i % 12 ? 0xdfeaff : 0xff2040,
      i % 12 ? ECLAT.jante : ECLAT.baliseJante
    ])
  }
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * TAU
    feuxFixes.push([Math.cos(a) * 152, Math.sin(a) * 152, 0, 0x2ee8ff, ECLAT.disque])
  }

  // ---------- les tramways : huit feux par pont, qui vont et viennent du disque à la jante ----------
  {
    const aM: number[] = []
    const aC: number[] = []
    const aS: number[] = []
    for (let i = 0; i < 6; i++) {
      const phi = (i / 6) * TAU + Math.PI / 2
      for (let k = 0; k < 8; k++) {
        const sens = k % 2 ? 1 : -1
        aM.push(phi, rnd(), sens * (0.07 + rnd() * 0.04), sens * 6)
        aC.push(...(sens > 0 ? [1, 0.85, 0.55] : [0.5, 0.85, 1]))
        aS.push(ECLAT.tramways)
      }
    }
    feuxMobiles(
      roue,
      {
        position: { valeurs: new Array<number>(aS.length * 3).fill(0), taille: 3 },
        aM: { valeurs: aM, taille: 4 },
        aC: { valeurs: aC, taille: 3 },
        aS: { valeurs: aS, taille: 1 }
      },
      'attribute vec4 aM;attribute vec3 aC;attribute float aS;uniform float uT;uniform float uE;uniform vec2 uR;varying vec3 vC;void main(){float k=fract(aM.y+uT*aM.z);float r=mix(uR.x,uR.y,k);vec3 p=vec3(cos(aM.x)*r,sin(aM.x)*r,aM.w);vC=aC*smoothstep(0.0,0.06,k)*smoothstep(1.0,0.94,k);vec4 mv=modelViewMatrix*vec4(p,1.0);' +
        TAILLE_FEU,
      { uR: { value: new THREE.Vector2(150, R - 14) } }
    )
  }

  // ---------- DESSOUS : les cercles de feux d'atterrissage, et la vague qui les parcourt ----------
  const anneaux = (() => {
    const position: number[] = []
    const aC: number[] = []
    const aS: number[] = []
    for (let n = 0; n < MOYEU_CITE.anneaux; n++) {
      const r = 30 + n * 12
      const nb = Math.round((TAU * r) / 14)
      for (let i = 0; i < nb; i++) {
        const a = (i / nb) * TAU
        position.push(Math.cos(a) * r, Math.sin(a) * r, 22)
        aC.push(0.75, 0.88, 1)
        aS.push(ECLAT.anneaux)
      }
    }
    return feuxMobiles(
      roue,
      {
        position: { valeurs: position, taille: 3 },
        aC: { valeurs: aC, taille: 3 },
        aS: { valeurs: aS, taille: 1 }
      },
      `attribute vec3 aC;attribute float aS;uniform float uT;uniform float uE;varying vec3 vC;void main(){float r=length(position.xy)/140.0;float k=exp(-pow((fract(uT*${MOYEU_CITE.vague.toFixed(2)})-r)*7.0,2.0));vC=aC*(${ECLAT.vagueRepos.toFixed(2)}+${ECLAT.vaguePic.toFixed(2)}*k);vec4 mv=modelViewMatrix*vec4(position,1.0);` +
        TAILLE_FEU
    )
  })()
  anneaux.name = 'anneaux-approche'
  halo(roue, 0x5fa0ff, ECLAT.lueur, 0, 0, 40, ECLAT.lueurOpacite)

  // ---------- DESSUS : quelques lumières sur la ville, chacune au bout d'un mât ----------
  // Vu d'en dessous, un feu posé à ras du toit serait caché par le toit lui-même : le mât dépasse
  // d'environ la demi-largeur du toit, plus quelques mètres.
  const toitFeu = (t: Toit, c: number, taille: number, plus: number): void => {
    const hauteurMat = Math.max(t.w, t.d) * 0.5 + plus
    t.mat = Math.max(t.mat, hauteurMat)
    feuxFixes.push([t.x, t.y, t.z - hauteurMat, c, taille])
  }
  for (const t of toits
    .slice()
    .sort((a, b) => b.h - a.h)
    .slice(0, MOYEU_CITE.balises))
    toitFeu(t, 0xff2040, ECLAT.balises, 10)
  const couleurs = [0xfff1d6, 0xffb062, 0x2ee8ff, 0xff2fa0]
  for (const t of toits)
    if (rnd() < MOYEU_CITE.toitsAllumes) toitFeu(t, couleurs[(rnd() * 4) | 0], ECLAT.toits, 4)
  const avecMat = toits.filter((t) => t.mat > 0)
  const mats = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
    coque,
    avecMat.length
  )
  mats.name = 'mats'
  avecMat.forEach((t, k) => {
    m4.compose(v.set(t.x, t.y, t.z), HAUT, echelle.set(1.4, t.mat, 1.4))
    mats.setMatrixAt(k, m4)
  })
  mats.instanceMatrix.needsUpdate = true
  roue.add(mats)
  const feuxPoses = feux(roue, feuxFixes)
  feuxPoses.name = 'feux'

  ctx.scene.add(groupe)

  return {
    groupe,
    roue,
    tours,
    mats,
    anneaux,
    feux: feuxPoses,
    tailleFeux: uE,
    animer(t) {
      // il flotte : quelques mètres de houle, jamais de traversée ; la roue emporte sa ville
      groupe.position.y = y0 + Math.sin(t * 0.1) * 5
      roue.rotation.z = t * MOYEU_CITE.rotation
      // la taille des feux suit la hauteur du canevas, en pixels
      uE.value = ctx.canevas.height * 0.9 * GROSSISSEMENT_FEUX
    }
  }
}
