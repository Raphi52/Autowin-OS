import * as THREE from 'three'

/**
 * LA VILLE DE GAUCHE : UN KOWLOON NÉON, 95 M SOUS LE TROTTOIR.
 *
 * Demande de l'utilisateur (conv-315) : « /draft refais la ville de gauche du fond d'écran de
 * l'accueil », puis « Affiner la 2 · Kowloon néon », et enfin « implémente 6 » : l'affinage
 * 6 · Néons animés du brouillon `.autowin-tmp/draft-ville/final2.js` (`V[6]`, générateur
 * `kowloon`). Ce qu'il montre, vu du trottoir par-dessus la rambarde :
 *   - un quartier BAS et SERRÉ (îlots de 11 m, immeubles de 16 à 54 m) qui monte en s'éloignant ;
 *   - une forêt d'enseignes : drapeaux verticaux en kanji, bandeaux de façade, panneaux sur les
 *     toits, toutes tournées vers le trottoir, qui grésillent et tombent en panne ;
 *   - LE MOUVEMENT de la 6 : le texte de la moitié des enseignes défile, des chenillards courent sur
 *     leurs bords, certaines s'allument en séquence ; cinq hologrammes géants au-dessus des toits
 *     (SCOUT, AUTOWIN, 夜市, NOIR HOLO, 電脳) et un anneau de texte qui tourne ;
 *   - de la vapeur sur quelques toits, et au loin une ligne de gratte-ciel en silhouette.
 *
 * CE QUI EST REPRIS TEL QUEL : les positions, les quantités, les couleurs, les textes et les
 * nuanceurs du brouillon. La ville a SA PROPRE GRAINE (23, celle du brouillon) : c'est exactement
 * le quartier que l'utilisateur a vu, quel que soit ce que la rue tire au hasard avant elle.
 *
 * CE QUI CHANGE, parce qu'un fond n'est pas une démo :
 *   - les cinq hologrammes et l'anneau sont REPLACÉS dans le vrai cadre du fond (voir
 *     `HOLOGRAMMES`) : aux positions du brouillon, aucun ne se voyait dans l'Accueil ;
 *   - le générateur ne garde que les réglages de la 6 : les options des autres affinages (bloc
 *     emmuré, lanternes, toits vivants, palette froide) ne sont pas livrées ;
 *   - la taille des lumières suit la hauteur du canevas du fond, pas celle de la fenêtre ;
 *   - toutes les textures dessinées sont rendues à l'appelant, qui les libère avec la scène ;
 *   - aucune lumière ajoutée : chaque lumière de plus alourdit toutes les matières de la rue
 *     (conv-301, 22 lumières → 8). L'éclat des néons est porté par les nuanceurs et des halos.
 */

/** Les réglages de l'affinage 6 · Néons animés, recopiés du brouillon (`K` complété par `V[6].o`). */
export const KOWLOON = {
  graine: 23,
  /** Pas des îlots, en mètres : un immeuble par îlot. */
  pas: 11,
  /** Étendue du quartier, en mètres, vers l'ouest (x) et vers le fond (z). */
  etendue: [374, 748] as const,
  largeur: { min: 7.6, variation: 2.6 },
  hauteur: { min: 16, variation: 38, plafond: 28, pente: 0.45 },
  /** Part des immeubles coiffés d'un bloc sur le toit. */
  toitBloc: 0.45,
  /** Enseignes par immeuble (multiplicateur), et part des panneaux posés sur les toits. */
  enseignes: 1.15,
  toitEnseignes: 0.3,
  /** Part des enseignes en caisson lumineux (texte sombre sur fond allumé). */
  caissons: 0.28,
  palette: [
    [1, 0.18, 0.63],
    [0.18, 0.91, 1],
    [1, 0.69, 0.38],
    [0.56, 0.66, 1],
    [0.3, 1, 0.55],
    [1, 0.35, 0.3],
    [1, 0.9, 0.4]
  ],
  fenetres: [
    [0.55, 1, 0.7],
    [0.5, 0.7, 1],
    [1, 0.85, 0.6],
    [1, 0.6, 0.35]
  ],
  /** Seuil d'allumage des fenêtres : 0,38 = un peu plus de six sur dix allumées. */
  allumage: 0.38,
  /** La lueur des néons au pied des façades. */
  pied: { a: [1, 0.18, 0.63], b: [0.18, 0.91, 1], force: 0.35, hauteur: 9 },
  halos: { nombre: 180, taille: 2.2, opacite: 0.2 },
  vapeur: { part: 0.06, nombre: 30, couleur: 0x9a7aa8 },
  /** Le mouvement de la 6 : texte qui défile, chenillards, hologrammes. */
  anime: true,
  hologrammes: true
} as const

/**
 * L'AMBIANCE QUI VA AVEC (`V[6]` du brouillon) : la lueur de l'horizon, la brume, et le damier des
 * rues au sol, resserré au pas des îlots. Lue par `home-decor-avenue.ts` pour son ciel et son sol.
 *
 * L'HORIZON ET LA BRUME SUIVENT LE CIEL « ÉCLAIRCIE LUNAIRE » DEPUIS conv-319 (« implémente la 5 »,
 * voir `CIEL_LUNAIRE`) : plus de rose-violet, une lueur bleue azur (#2f8bff à moitié, en valeurs
 * linéaires comme `THREE.Color` les donne) et une brume bleu nuit. Le damier des rues ne change pas.
 */
export const AMBIANCE_KOWLOON = {
  horizon: [0.014, 0.129, 0.5] as const,
  brume: 0x0e1d33,
  rue: { a: [1, 0.3, 0.65] as const, b: [1, 0.6, 0.25] as const, force: 0.9, pas: 11 }
} as const

export interface ContexteVille {
  /** Où poser la ville : la scène, fixe pendant la marche (trop loin pour bouger). */
  scene: THREE.Object3D
  /** Hauteur du sol de la ville. */
  SOL: number
  uT: { value: number }
  uFlash: { value: number }
  uBrume: { value: THREE.Color }
  /** Position de la caméra : les enseignes et les hologrammes se tournent vers elle. */
  camera: readonly [number, number, number]
  /** Le canevas du fond : sa hauteur en pixels règle la taille des lumières. */
  canevas: { height: number }
  toile: (w: number, h: number) => [HTMLCanvasElement, CanvasRenderingContext2D]
  /** Les textures dessinées ici y sont ajoutées, pour être libérées avec la scène. */
  textures: THREE.Texture[]
}

export interface VilleBasse {
  groupe: THREE.Group
  /** Le nombre d'enseignes posées (drapeaux, bandeaux, panneaux de toit). */
  enseignes: number
  animer(t: number): void
}

const H = 'float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\n'
const FIN = 'gl_FragColor=vec4(c,1.0);\n#include <colorspace_fragment>\n}'
const ADD = {
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending
} as const
const VS_UV =
  'varying vec2 vU;void main(){vU=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}'
const VS_TOUR =
  'varying vec3 vW;varying vec3 vN;varying vec3 vL;varying float vTop;varying float vS;varying vec3 vZ;void main(){vec4 w=modelMatrix*instanceMatrix*vec4(position,1.0);vW=w.xyz;vN=normalize(mat3(modelMatrix*instanceMatrix)*normal);vL=position;vTop=instanceMatrix[3][1]+instanceMatrix[1][1];vS=fract(sin(dot(instanceMatrix[3].xz,vec2(12.9898,78.233)))*43758.5453);vZ=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));gl_Position=projectionMatrix*viewMatrix*w;}'
const FS_TETE =
  'uniform float uT;uniform float uFlash;uniform vec3 uBrume;varying vec3 vW;varying vec3 vN;varying vec3 vL;varying float vTop;varying float vS;varying vec3 vZ;\n' +
  H
const CONE_VS =
  'varying float vT;varying vec3 vN;varying vec3 vV;void main(){vT=uv.y;vec4 mv=modelViewMatrix*vec4(position,1.0);vN=normalize(normalMatrix*normal);vV=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}'
const PT_VS =
  'attribute vec3 aD;attribute vec2 aV;attribute vec3 aC;attribute float aS;uniform float uT;uniform float uE;varying vec3 vC;void main(){float k=aS<0.0?step(0.5,fract(uT*0.7+aV.x)):1.0;vC=aC*k;vec4 mv=modelViewMatrix*vec4(position+aD*fract(aV.x+uT*aV.y),1.0);gl_PointSize=clamp(abs(aS)*uE/-mv.z,1.2,48.0);gl_Position=projectionMatrix*mv;}'
const PT_FS =
  'varying vec3 vC;void main(){vec2 c=gl_PointCoord-0.5;float r=dot(c,c);gl_FragColor=vec4(vC*(exp(-r*22.0)*0.6+exp(-r*90.0)),1.0);}'
const VS_E =
  'attribute vec4 aUV;attribute vec3 aC;attribute float aK;attribute float aV;varying vec2 vQ;varying vec4 vR;varying vec3 vC;varying float vK;varying float vV;varying vec3 vW;void main(){vQ=uv;vR=aUV;vC=aC;vK=aK;vV=aV;vec4 w=modelMatrix*instanceMatrix*vec4(position,1.0);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}'

/** Les tours lointaines : bureaux allumés par plateaux, couronnes irisées (la 1 du premier tour). */
const fsLointaines = (y: string, haze: string): string =>
  'void main(){vec3 N=normalize(vN);vec3 V=normalize(cameraPosition-vW);float d=length(vW-cameraPosition);float y=' +
  y +
  ';float fr=pow(1.0-abs(dot(N,V)),4.0);vec3 c=vec3(0.010,0.008,0.016)+vec3(0.4,0.22,0.55)*fr*0.1;vec3 wc=vS<0.5?vec3(1.0,0.7,0.4):(vS<0.82?vec3(0.82,0.9,1.0):vec3(0.55,0.75,1.0));float hi=step(6.0,vZ.y);' +
  'if(abs(N.y)<0.5){vec2 tg=normalize(vec2(-N.z,N.x));vec2 q=vec2((dot(vW.xz,tg)+vS*50.0)/1.6,y/3.6);vec2 id=floor(q);vec2 f=fract(q);float verre=step(0.3,f.y)*step(f.y,0.93)*step(0.07,f.x)*step(f.x,0.93);vec3 wz=h(vec2(vS*7.0,floor(id.y/4.0)))>0.95?vec3(1.0,0.35,0.75):wc;float on=step(0.5+0.3*vS,h(vec2(floor(id.x/5.0),id.y)+vS*91.0))*hi;float lum=verre*on*(0.55+0.45*smoothstep(0.35,0.93,f.y))*(0.75+0.25*h(id));float aa=smoothstep(0.3,0.9,max(fwidth(q.x),fwidth(q.y)));' +
  'c+=mix(wz*lum,wz*(0.5-0.3*vS)*0.08*hi,aa)*0.75;c+=verre*(1.0-on)*vec3(0.05,0.025,0.08)*(0.3+fr)*(1.0-aa);c+=mix(vec3(1.0,0.3,0.7),vec3(0.3,0.6,1.0),fract(vS*3.0))*smoothstep(5.0,0.0,vTop-vW.y)*step(0.8,vS)*step(30.0,vZ.y)*0.5;c+=vec3(1.0,0.55,0.3)*exp(-y/10.0)*0.12;}else if(N.y>0.5){c+=vec3(0.025,0.018,0.03);}c+=vec3(0.55,0.5,0.9)*uFlash*0.06;' +
  haze +
  FIN

/** Les immeubles du quartier : fenêtres irrégulières, climatiseurs, lueur des néons au pied. */
const fsQuartier = (y: string, haze: string): string =>
  'uniform vec3 uB1;uniform vec3 uB2;uniform float uBasK;uniform float uBasH;uniform vec3 uW1;uniform vec3 uW2;uniform vec3 uW3;uniform vec3 uW4;uniform float uOn;void main(){vec3 N=normalize(vN);float d=length(vW-cameraPosition);float y=' +
  y +
  ';vec3 c=vec3(0.03,0.026,0.034);' +
  'if(abs(N.y)<0.5){vec2 tg=normalize(vec2(-N.z,N.x));float u=dot(vW.xz,tg)+vS*40.0;vec2 q=vec2(u/2.6,y/3.0);vec2 id=floor(q);vec2 f=fract(q);float jx=h(id*1.3)*0.3;float win=step(0.2+jx,f.x)*step(f.x,0.62+jx)*step(0.35,f.y)*step(f.y,0.8);float clim=step(0.68+jx*0.5,f.x)*step(f.x,0.9)*step(0.12,f.y)*step(f.y,0.32);float r=h(id+vS*17.0);' +
  'vec3 wc=r>0.9?uW1:(r>0.8?uW2:(r>0.6?uW3:uW4));float on=step(uOn,h(id.yx+vS*3.0));float aa=smoothstep(0.3,0.9,max(fwidth(q.x),fwidth(q.y)));' +
  'c*=0.7+0.3*sin(u*1.7+vS*30.0)*sin(y*0.13);c-=clim*0.012*(1.0-aa);c+=mix(wc*win*on*(0.7+0.3*h(id+2.0)),(uW3+uW4)*0.07*(1.0-uOn)*1.6,aa)*0.75;c+=mix(uB1,uB2,step(0.5,fract(vS*7.0)))*exp(-y/uBasH)*uBasK;}else if(N.y>0.5){c=vec3(0.035,0.03,0.04);}c+=vec3(0.55,0.5,0.9)*uFlash*0.06;' +
  haze +
  FIN

/**
 * Les enseignes : un atlas de mots, une ligne par enseigne. Néon (texte allumé) ou caisson (texte
 * sombre sur fond allumé) ; panne et grésillement. LE MOUVEMENT DE LA 6 : le texte défile sur la
 * moitié d'entre elles, un chenillard court sur le bord, une part s'allume en séquence.
 */
const fsEnseigne = (haze: string): string =>
  'uniform float uT;uniform sampler2D uMap;uniform vec3 uBrume;uniform float uAnim;uniform float uSeuil;varying vec2 vQ;varying vec4 vR;varying vec3 vC;varying float vK;varying float vV;varying vec3 vW;void main(){float d=length(vW-cameraPosition);vec2 s=vQ;if(uAnim>0.5&&vK<0.5){if(vV>0.5)s.y=fract(s.y+uT*0.2*(0.5+vK));else s.x=fract(s.x-uT*0.15*(0.5+vK));}' +
  'float m=texture2D(uMap,vR.xy+s*vR.zw).r;float p=step(0.975,fract(sin(floor(uT*4.0+vK*17.0)*1.7)*437.5));float f=(0.9+0.1*sin(uT*31.0+vK*40.0))*(1.0-p*0.85);vec3 c=vK>uSeuil?vC*(0.85-m*0.75)*f:(vec3(0.012,0.01,0.016)+vC*m*1.9*f);' +
  'if(uAnim>0.5){vec2 asp=vV>0.5?vec2(1.0,4.0):vec2(4.0,1.0);vec2 e=min(vQ,1.0-vQ)*asp;float bord=step(min(e.x,e.y),0.12);float bulbe=step(0.5,fract(dot(vQ,asp)*5.0-uT*3.0));c+=vC*bord*bulbe*1.6;c*=mix(1.0,step(0.35,fract(uT*0.4+vK*7.0)),step(0.55,vK)*step(vK,0.7));}' +
  haze +
  FIN

/** Les mots des enseignes : 32 horizontaux (bandeaux, toits), 32 verticaux (drapeaux). */
export const MOTS_HORIZONTAUX = [
  'HOTEL',
  'BAR',
  '24H',
  'CLINIC',
  'AUTOWIN',
  'NOIR HOLO',
  'REPAIR',
  'KARAOKE',
  'GAME',
  'LIVE',
  'PACHINKO',
  'NOODLE',
  'ラーメン',
  'カラオケ',
  '寿司',
  '電脳',
  '麻雀',
  '夜市',
  '両替',
  '占い',
  '按摩',
  '薬局',
  '九龍',
  '酒場',
  'MAHJONG',
  'CYBER',
  'BEER',
  'ネオン',
  '24時間',
  'TATTOO',
  'DENTIST',
  'SCOUT'
] as const
export const MOTS_VERTICAUX = [
  'ラーメン',
  '酒',
  '薬',
  '麻雀',
  '電脳',
  '夜市',
  '九龍城',
  '按摩',
  '占い',
  '両替',
  '寿司',
  '質',
  '旅館',
  'カラオケ',
  '中華',
  '金',
  '医',
  '茶',
  'ホテル',
  '珈琲',
  '鍼灸',
  '漢方',
  '餃子',
  '宝石',
  '映画',
  '麺',
  '書店',
  '酒場',
  '銀行',
  '歯科',
  '眼鏡',
  '電器'
] as const

/**
 * Les cinq hologrammes au-dessus des toits : où on les veut, leur mot, leurs deux couleurs.
 *
 * PLACÉS DANS LE VRAI CADRE DU FOND, PAS DANS CELUI DU BROUILLON. Le brouillon regardait la ville
 * 34° plus à gauche que la caméra de l'Accueil (`CAMERA_AVENUE.cible`) : recopiées telles quelles,
 * ses positions mettaient quatre hologrammes et l'anneau hors de l'image, et le cinquième derrière la
 * tour de la Spirale (mesuré le 2026-10-17 par projection dans la vraie caméra, puis sur la capture
 * de l'Accueil). Chacun est donc posé par son cap (degrés à gauche de l'axe −z, vu du trottoir) et
 * sa distance, dans la bande de ville visible et hors de la colonne de la tour (cap 17,5° à 23,5°).
 * À droite de la tour, le quartier commence à x = −41 : un petit cap y impose une grande distance.
 * Le test voisin les projette dans `CAMERA_AVENUE`.
 */
export const HOLOGRAMMES = [
  { vers: [-70, -109], mot: 'AUTOWIN', couleurs: [0x2ee8ff, 0xff2fa0] }, // cap 28,5°, 135 m
  { vers: [-148, -288], mot: '夜市', couleurs: [0xff2fa0, 0x8f6bff] }, // cap 25,5°, 330 m
  { vers: [-47, -155], mot: 'NOIR HOLO', couleurs: [0x2ee8ff, 0x8f6bff] }, // cap 14°, 170 m
  { vers: [-47, -252], mot: '電脳', couleurs: [0xffb062, 0xff2fa0] }, // cap 9°, 265 m
  { vers: [-47, -380], mot: 'SCOUT', couleurs: [0x8fa8ff, 0x2ee8ff] } // cap 6°, 390 m
] as const

/**
 * LE PLANCHER DES HOLOGRAMMES, en mètres au-dessus du sol de la ville. Vu du trottoir (1,75 m),
 * son bord cache tout ce qui, à droite de la tour de la Spirale, descend sous −42 m environ : posés
 * sur les toits (−70 à −40 m), les trois hologrammes de droite y étaient à moitié enterrés (capture
 * de l'Accueil, 2026-10-17). Ils flottent donc au moins à 60 m du sol (−35 m), le faisceau les
 * relie à leur toit.
 */
export const PLANCHER_HOLOGRAMMES = 60

/** L'anneau de texte : il tourne au-dessus du plus haut toit à moins de `rayon` mètres de `vers`. */
export const ANNEAU = { vers: [-112, -194] as const, rayon: 12 } // cap 27,5°, 230 m

const POLICE = '"Yu Gothic UI","Meiryo","MS Gothic",Bahnschrift,sans-serif'

type Lumiere = number[]
type Pose = (x: number, y: number, z: number, w: number, hh: number, d: number) => void

export function monterVille(ctx: ContexteVille): VilleBasse {
  const K = KOWLOON
  const { SOL, uT, uFlash, uBrume, toile } = ctx
  const [CX, CY, CZ] = ctx.camera
  const sol = SOL.toFixed(1)
  const yLocal = 'vW.y-(' + sol + ')'
  const haze =
    'c=mix(c,uBrume,1.0-exp(-pow(d*0.0011,1.6)));c=mix(c,uBrume*1.3,exp(-max(' +
    yLocal +
    ',0.0)*0.05)*0.35);'
  // Sa propre graine : la ville est celle du brouillon, quoi que la rue ait tiré avant elle.
  let s0: number = K.graine
  const rnd = (): number => (s0 = (s0 * 16807) % 2147483647) / 2147483647
  const groupe = new THREE.Group()
  ctx.scene.add(groupe)
  const garder = <T extends THREE.Texture>(t: T): T => {
    ctx.textures.push(t)
    return t
  }

  // le halo des néons (celui du brouillon : sans conversion de couleur, plus vif que celui de la rue)
  const [gc, gg] = toile(64, 64)
  const rg = gg.createRadialGradient(32, 32, 0, 32, 32, 32)
  rg.addColorStop(0, 'rgba(255,255,255,1)')
  rg.addColorStop(0.2, 'rgba(255,255,255,.5)')
  rg.addColorStop(1, 'rgba(255,255,255,0)')
  gg.fillStyle = rg
  gg.fillRect(0, 0, 64, 64)
  const GLOW = garder(new THREE.CanvasTexture(gc))
  const halo = (
    c: THREE.ColorRepresentation,
    s: number,
    x: number,
    y: number,
    z: number,
    o = 0.5
  ): THREE.Sprite => {
    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: GLOW, color: c, opacity: o, fog: false, ...ADD })
    )
    sp.scale.set(s, s, 1)
    sp.position.set(x, y, z)
    groupe.add(sp)
    return sp
  }

  const BOITE = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
  const matTours = (fs: string, u: Record<string, THREE.IUniform> = {}): THREE.ShaderMaterial =>
    new THREE.ShaderMaterial({
      uniforms: { uT, uFlash, uBrume, ...u },
      vertexShader: VS_TOUR,
      fragmentShader: FS_TETE + fs
    })
  const parc = (m: THREE.Material, max: number): Pose => {
    const im = new THREE.InstancedMesh(BOITE, m, max)
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const v = new THREE.Vector3()
    const s = new THREE.Vector3()
    im.count = 0
    im.frustumCulled = false
    groupe.add(im)
    return (x, y, z, w, hh, d) => {
      if (im.count < max) {
        m4.compose(v.set(x, y, z), q, s.set(w, hh, d))
        im.setMatrixAt(im.count++, m4)
      }
    }
  }
  const L: Lumiere[] = []
  const feu = (
    x: number,
    y: number,
    z: number,
    r: number,
    g: number,
    b: number,
    s: number
  ): Lumiere => [x, y, z, 0, 0, 0, rnd(), 0, r, g, b, s]
  const couleur = (a: readonly number[]): THREE.Color => new THREE.Color(a[0], a[1], a[2])

  // ---------- le quartier : un immeuble par îlot de 11 m ----------
  const P = K.pas
  const ni = Math.round(K.etendue[0] / P)
  const nj = Math.round(K.etendue[1] / P)
  const E: [number, number, number, number, number, number][] = []
  const fum: [number, number, number][] = []
  const toits: [number, number, number, number, number][] = []
  const poseQuartier = parc(
    matTours(fsQuartier(yLocal, haze), {
      uB1: { value: couleur(K.pied.a) },
      uB2: { value: couleur(K.pied.b) },
      uBasK: { value: K.pied.force },
      uBasH: { value: K.pied.hauteur },
      uW1: { value: couleur(K.fenetres[0]) },
      uW2: { value: couleur(K.fenetres[1]) },
      uW3: { value: couleur(K.fenetres[2]) },
      uW4: { value: couleur(K.fenetres[3]) },
      uOn: { value: K.allumage }
    }),
    9000
  )
  for (let i = 0; i < ni; i++)
    for (let j = 0; j < nj; j++) {
      const x = -41 - P * (i + 0.5)
      const z = 239 - P * (j + 0.5)
      if (rnd() < 0.04) continue
      const w = K.largeur.min + rnd() * K.largeur.variation
      const d = K.largeur.min + rnd() * K.largeur.variation
      const X = x + (rnd() - 0.5) * Math.max(0, P - 0.6 - w)
      const Z = z + (rnd() - 0.5) * Math.max(0, P - 0.6 - d)
      // près de la falaise, les toits restent sous nos pieds : c'est ce qui fait la vue plongeante
      const hh = Math.min(
        K.hauteur.min + Math.pow(rnd(), 1.6) * K.hauteur.variation + (rnd() < 0.06 ? 24 : 0),
        K.hauteur.plafond + (-x - 45) * K.hauteur.pente
      )
      poseQuartier(X, SOL, Z, w, hh, d)
      if (rnd() < K.toitBloc)
        poseQuartier(
          X + (rnd() - 0.5) * w * 0.4,
          SOL + hh,
          Z + (rnd() - 0.5) * d * 0.4,
          w * (0.3 + rnd() * 0.35),
          3 + rnd() * 6,
          d * (0.3 + rnd() * 0.35)
        )
      if (rnd() < K.vapeur.part) fum.push([X, SOL + hh + 2, Z])
      toits.push([X, SOL + hh, Z, w, d])
      const nk = rnd() < 0.85 ? Math.floor((1 + rnd() * 3) * K.enseignes + rnd() * 0.5) : 0
      for (let e = 0; e < nk; e++) {
        if (rnd() < 0.55) {
          // un drapeau vertical, accroché à la façade côté avenue
          const sh = Math.min(7 + rnd() * 12, hh - 4)
          const sw = sh / 4
          if (sh > 3)
            E.push([
              X + w / 2 + 0.4,
              SOL + 2 + rnd() * Math.max(0, hh - sh - 3) + sh / 2,
              Z + (rnd() - 0.5) * d * 0.8,
              sw,
              sh,
              1
            ])
        } else {
          // un bandeau sur la façade
          const sw = Math.min(6 + rnd() * 8, w * 1.5)
          const sh = sw / 4
          E.push([
            X + (rnd() - 0.5) * Math.max(0, w - sw),
            SOL + 2.5 + rnd() * Math.max(0, hh * 0.7 - 4),
            Z + d / 2 + 0.3,
            sw,
            sh,
            0
          ])
        }
      }
      if (rnd() < K.toitEnseignes) {
        // un panneau sur le toit
        const sw = 10 + rnd() * 10
        const sh = sw / 4
        E.push([X, SOL + hh + sh / 2 + 1.5, Z, sw, sh, 0])
      }
    }

  // ---------- au loin, les gratte-ciel en silhouette ----------
  const poseLointaines = parc(matTours(fsLointaines(yLocal, haze)), 1500)
  for (let i = 0; i < 30; i++)
    for (let j = 0; j < 46; j++) {
      const x = -60 - 38 * i
      const z = 220 - 38 * j
      if ((x > -440 && z > -530) || rnd() < 0.1) continue
      const dc = Math.hypot(x + 800, z + 900)
      const ce = Math.exp(-(dc * dc) / (2 * 350 * 350))
      const hh = 40 + Math.pow(rnd(), 2) * 80 + ce * (60 + rnd() * 240)
      const w = 14 + rnd() * 10
      const d = 14 + rnd() * 10
      poseLointaines(x, SOL, z, w, hh, d)
      if (hh > 160) {
        poseLointaines(x, SOL + hh, z, w * 0.7, hh * 0.2, d * 0.7)
        poseLointaines(x, SOL + hh * 1.2, z, 1, 30, 1)
        L.push(feu(x, SOL + hh * 1.2 + 30, z, 1, 0.12, 0.1, -3))
      }
    }

  // ---------- les enseignes : un atlas de mots, une instance par enseigne ----------
  const [ca, k] = toile(2048, 2048)
  k.fillStyle = '#000'
  k.fillRect(0, 0, 2048, 2048)
  k.textAlign = 'center'
  k.textBaseline = 'middle'
  const cadre = (x: number, y: number, w: number, h: number): void => {
    k.shadowBlur = 0
    k.fillStyle = '#0e0c12'
    k.fillRect(x + 4, y + 4, w - 8, h - 8)
    k.strokeStyle = '#fff'
    k.lineWidth = 5
    k.shadowColor = '#fff'
    k.shadowBlur = 12
    k.strokeRect(x + 12, y + 12, w - 24, h - 24)
    k.shadowBlur = 18
    k.fillStyle = '#fff'
  }
  MOTS_HORIZONTAUX.forEach((m, i) => {
    const x = (i % 4) * 512
    const y = (i >> 2) * 128
    cadre(x, y, 512, 128)
    let s = 84
    do {
      k.font = 'bold ' + s + 'px ' + POLICE
      s -= 4
    } while (k.measureText(m).width > 440)
    k.fillText(m, x + 256, y + 66)
  })
  MOTS_VERTICAUX.forEach((m, i) => {
    const x = (i % 16) * 128
    const y = 1024 + (i >> 4) * 512
    const ch = [...m]
    const s = Math.min(92, 420 / ch.length)
    cadre(x, y, 128, 512)
    k.font = 'bold ' + s + 'px ' + POLICE
    ch.forEach((c, j) => k.fillText(c, x + 64, y + 256 + (j - (ch.length - 1) / 2) * s * 1.05))
  })
  const atlas = garder(new THREE.CanvasTexture(ca))
  atlas.anisotropy = 8
  const n = E.length
  const seuil = 1 - K.caissons
  const geo = new THREE.PlaneGeometry(1, 1)
  const uvA = new Float32Array(n * 4)
  const colA = new Float32Array(n * 3)
  const kA = new Float32Array(n)
  const vA = new Float32Array(n)
  const S = new THREE.InstancedMesh(
    geo,
    new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: {
        uT,
        uMap: { value: atlas },
        uBrume,
        uAnim: { value: K.anime ? 1 : 0 },
        uSeuil: { value: seuil }
      },
      vertexShader: VS_E,
      fragmentShader: fsEnseigne(haze)
    }),
    n
  )
  {
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const Y = new THREE.Vector3(0, 1, 0)
    const PV = new THREE.Vector3()
    const SC = new THREE.Vector3()
    E.forEach(([x, y, z, w, hh, vert], i) => {
      // tournée vers le trottoir, à quelques degrés près
      q.setFromAxisAngle(Y, Math.atan2(CX - x, CZ - z) + (rnd() - 0.5) * 0.3)
      m4.compose(PV.set(x, y, z), q, SC.set(w, hh, 1))
      S.setMatrixAt(i, m4)
      const c = (rnd() * 32) | 0
      uvA.set(
        vert
          ? [(c % 16) / 16, 1 - (1024 + (c >> 4) * 512 + 512) / 2048, 1 / 16, 0.25]
          : [(c % 4) / 4, 1 - ((c >> 2) * 128 + 128) / 2048, 0.25, 1 / 16],
        i * 4
      )
      colA.set(K.palette[(rnd() * K.palette.length) | 0], i * 3)
      kA[i] = rnd()
      vA[i] = vert
    })
  }
  for (const [nom, a, s] of [
    ['aUV', uvA, 4],
    ['aC', colA, 3],
    ['aK', kA, 1],
    ['aV', vA, 1]
  ] as const)
    geo.setAttribute(nom, new THREE.InstancedBufferAttribute(a, s))
  S.frustumCulled = false
  groupe.add(S)
  // le halo des néons les plus proches (les caissons n'en ont pas)
  E.map((e, i): [number, number] => [Math.hypot(e[0] - CX, e[1] - CY, e[2] - CZ), i])
    .sort((a, b) => a[0] - b[0])
    .slice(0, K.halos.nombre)
    .forEach(([, i]) => {
      const e = E[i]
      if (kA[i] <= seuil)
        halo(
          new THREE.Color(colA[i * 3], colA[i * 3 + 1], colA[i * 3 + 2]),
          Math.max(e[3], e[4]) * K.halos.taille,
          e[0] + 1,
          e[1],
          e[2] + 1,
          K.halos.opacite
        )
    })

  // ---------- la vapeur des toits ----------
  const vapeur = fum.slice(0, K.vapeur.nombre).map(([x, y, z]) => {
    const s = halo(K.vapeur.couleur, 6, x, y, z, 0.08)
    s.material.blending = THREE.NormalBlending
    return { s, x, y, z, ph: rnd() }
  })

  // ---------- les hologrammes et l'anneau de texte ----------
  const holos: { plan: THREE.Mesh; r: number }[] = []
  let anneau: THREE.Mesh | null = null
  if (K.hologrammes && toits.length > 0) {
    const faisceau = (c: number): THREE.ShaderMaterial =>
      new THREE.ShaderMaterial({
        uniforms: { uC: { value: new THREE.Color(c) } },
        ...ADD,
        side: THREE.DoubleSide,
        vertexShader: CONE_VS,
        fragmentShader:
          'uniform vec3 uC;varying float vT;varying vec3 vN;varying vec3 vV;void main(){float a=pow(vT,1.5)*pow(abs(dot(vN,vV)),1.3)*0.55;gl_FragColor=vec4(uC*a,1.0);}'
      })
    HOLOGRAMMES.forEach(({ vers: [cx, cz], mot, couleurs }, i) => {
      // posé sur le toit le plus proche de l'endroit voulu
      let best = toits[0]
      let bd = 1e9
      for (const t of toits) {
        const dd = Math.hypot(t[0] - cx, t[2] - cz)
        if (dd < bd) {
          bd = dd
          best = t
        }
      }
      const [X, Yt, Z] = best
      const [c, g] = toile(256, 1024)
      const ch = [...mot]
      const fs = Math.min(190, 940 / ch.length)
      g.fillStyle = '#000'
      g.fillRect(0, 0, 256, 1024)
      g.strokeStyle = '#fff'
      g.lineWidth = 6
      g.strokeRect(10, 10, 236, 1004)
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.font = 'bold ' + fs + 'px "Yu Gothic UI",Bahnschrift,sans-serif'
      g.shadowColor = '#fff'
      g.shadowBlur = 14
      g.fillStyle = '#fff'
      ch.forEach((s, j) => g.fillText(s, 128, 512 + (j - (ch.length - 1) / 2) * fs * 1.02))
      const hg = 44 + rnd() * 16
      const plan = new THREE.Mesh(
        new THREE.PlaneGeometry(hg / 3.6, hg),
        new THREE.ShaderMaterial({
          uniforms: {
            uT,
            uMap: { value: garder(new THREE.CanvasTexture(c)) },
            uA: { value: new THREE.Color(couleurs[0]) },
            uB: { value: new THREE.Color(couleurs[1]) },
            uP: { value: i * 1.7 }
          },
          ...ADD,
          side: THREE.DoubleSide,
          vertexShader: VS_UV,
          fragmentShader:
            'uniform float uT;uniform sampler2D uMap;uniform vec3 uA;uniform vec3 uB;uniform float uP;varying vec2 vU;void main(){float m=texture2D(uMap,vU).r;vec3 c=mix(uA,uB,clamp(vU.y+0.3*sin(uT*0.5+uP),0.0,1.0));float sl=0.6+0.4*sin(vU.y*420.0-uT*9.0);float gl=step(0.965,fract(sin(floor(uT*5.0+uP*3.0))*91.7));gl_FragColor=vec4(c*(m*1.9+0.09)*sl*(1.0-gl*0.75),1.0);}'
        })
      )
      // l'hologramme flotte au moins au plancher, et son faisceau monte du toit jusqu'à lui
      const bas = Math.max(Yt + 5, SOL + PLANCHER_HOLOGRAMMES)
      plan.position.set(X, bas + hg / 2, Z)
      groupe.add(plan)
      holos.push({ plan, r: Math.atan2(CX - X, CZ - Z) })
      const fx = new THREE.Mesh(
        new THREE.CylinderGeometry(hg / 7, 0.5, bas - Yt, 16, 1, true).translate(
          0,
          (bas - Yt) / 2,
          0
        ),
        faisceau(couleurs[0])
      )
      fx.position.set(X, Yt, Z)
      groupe.add(fx)
      halo(couleurs[0], hg * 1.5, X, bas + hg / 2, Z, 0.18)
    })
    // l'anneau tourne au-dessus du plus haut toit autour de l'endroit voulu
    const proches = toits.filter(
      (t) => Math.hypot(t[0] - ANNEAU.vers[0], t[2] - ANNEAU.vers[1]) < ANNEAU.rayon
    )
    const haut = (proches.length > 0 ? proches : toits).reduce((a, b) => (b[1] > a[1] ? b : a))
    const [cb, kb] = toile(2048, 128)
    const phrase = 'AUTOWIN · 夜市 · NOIR HOLO · 電脳 · '
    kb.fillStyle = '#000'
    kb.fillRect(0, 0, 2048, 128)
    kb.font = 'bold 84px "Yu Gothic UI",Bahnschrift,sans-serif'
    kb.font =
      'bold ' +
      Math.floor((84 * 2030) / kb.measureText(phrase).width) +
      'px "Yu Gothic UI",Bahnschrift,sans-serif'
    kb.textBaseline = 'middle'
    kb.fillStyle = '#fff'
    kb.shadowColor = '#fff'
    kb.shadowBlur = 16
    kb.fillText(phrase, 8, 66)
    anneau = new THREE.Mesh(
      new THREE.CylinderGeometry(16, 16, 5, 96, 1, true),
      new THREE.ShaderMaterial({
        uniforms: { uT, uMap: { value: garder(new THREE.CanvasTexture(cb)) } },
        ...ADD,
        side: THREE.DoubleSide,
        vertexShader: VS_UV,
        fragmentShader:
          'uniform float uT;uniform sampler2D uMap;varying vec2 vU;void main(){float m=texture2D(uMap,vec2(fract(vU.x*2.0),vU.y)).r;vec3 c=mix(vec3(1.0,0.18,0.63),vec3(0.18,0.91,1.0),0.5+0.5*sin(vU.x*12.566+uT));gl_FragColor=vec4(c*(m*1.3+0.04),1.0);}'
      })
    )
    anneau.position.set(haut[0], haut[1] + 14, haut[2])
    groupe.add(anneau)
    halo(0xff2fa0, 60, haut[0], haut[1] + 14, haut[2], 0.12)
  }

  // ---------- les feux d'obstacle des gratte-ciel lointains, qui clignotent ----------
  const uE = { value: 0 }
  {
    const nl = L.length
    const pos = new Float32Array(nl * 3)
    const dd = new Float32Array(nl * 3)
    const vv = new Float32Array(nl * 2)
    const cc = new Float32Array(nl * 3)
    const ss = new Float32Array(nl)
    L.forEach((p, i) => {
      pos.set(p.slice(0, 3), i * 3)
      dd.set(p.slice(3, 6), i * 3)
      vv.set(p.slice(6, 8), i * 2)
      cc.set(p.slice(8, 11), i * 3)
      ss[i] = p[11]
    })
    const g = new THREE.BufferGeometry()
    for (const [nom, a, s] of [
      ['position', pos, 3],
      ['aD', dd, 3],
      ['aV', vv, 2],
      ['aC', cc, 3],
      ['aS', ss, 1]
    ] as const)
      g.setAttribute(nom, new THREE.BufferAttribute(a, s))
    const points = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        uniforms: { uT, uE },
        vertexShader: PT_VS,
        fragmentShader: PT_FS,
        ...ADD
      })
    )
    points.frustumCulled = false
    groupe.add(points)
  }

  return {
    groupe,
    enseignes: n,
    animer(t) {
      // la taille des lumières suit la hauteur du canevas, en pixels
      uE.value = ctx.canevas.height * 0.9
      for (const v of vapeur) {
        const u = (t * 0.12 + v.ph) % 1
        v.s.position.set(v.x + u * 6, v.y + u * 16, v.z)
        v.s.scale.setScalar(4 + u * 14)
        v.s.material.opacity = 0.1 * Math.sin(u * Math.PI)
      }
      holos.forEach((h, i) => (h.plan.rotation.y = h.r + 0.18 * Math.sin(t * 0.35 + i * 1.3)))
      if (anneau) anneau.rotation.y = -t * 0.3
    }
  }
}
