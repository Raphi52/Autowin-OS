import * as THREE from 'three'

/**
 * LE VAISSEAU MÈRE : UNE VILLE EN ANNEAU, AU-DESSUS DE LA VILLE.
 *
 * Demandes de l'utilisateur (conv-319) : « implémente la 5 et met un vaisseau mere », puis « /draft le
 * vaisseau mère du fond de l'Accueil : propose 6 formes de coque… », « implémente 2 et 6 », et enfin,
 * devant deux vaisseaux séparés : « tas mis les 2 vaisseaux mais j'en veux qu'un je voulais une ville
 * de la forme de celui du haut ». C'est donc UN seul vaisseau : la 6 · Cité suspendue bâtie sur la
 * forme de la 2 · Anneau (celui qui était en haut), d'après le brouillon
 * `.autowin-tmp/draft-vaisseau/scene.js` (fonctions `anneau` et `cite`). Ce qu'il montre :
 *   - la roue de l'anneau : 600 m de jante, un moyeu, six rayons, 24 pylônes d'amarrage, 144 feux, et
 *     elle tourne lentement sur son axe ;
 *   - sur sa couronne, un Kowloon : des tours debout sur le dessus, des tours qui PENDENT dessous avec
 *     un néon rose ou cyan au bout d'une sur trois, comme sous la cité suspendue ;
 *   - des enseignes holo qui grésillent sous la couronne, des balises rouges qui clignotent.
 * La ville tourne avec la roue : ses tours sont posées dans le repère de la roue, et leurs fenêtres
 * dans le repère de chaque tour, pour ne pas glisser sur les façades pendant la rotation.
 *
 * CE QU'IL N'A PAS LE DROIT DE FAIRE, parce qu'un fond passe derrière les widgets :
 *   - ajouter une lumière : chaque lumière de plus alourdit toutes les matières de la rue (conv-301,
 *     22 lumières → 8) ; son éclat est dans ses nuanceurs, ses feux et ses halos ;
 *   - cacher la lune : il reste hors de son disque et de son halo proche (le test voisin tire des
 *     rayons vers elle, tours comprises) ;
 *   - se perdre dans le brouillard de la rue : à 2,5 km, `FogExp2` l'effacerait, il a sa propre brume.
 */

/**
 * Où il est, vu de la rue. Azimut compté depuis −z vers +x, hauteur en radians, distance en mètres.
 * Mesuré sur la vraie caméra en 1600 × 900 : la fenêtre de ciel va de x 620 à x 990 environ, du haut
 * de l'écran aux tuiles de l'Accueil (y 175) ; la lune y est en (842, 40). La ville en anneau y occupe
 * x 586 à 782, y 0 à 192, centre en (686, 91), à gauche de la lune. Plus près (2,6 km) ou plus à droite,
 * sa couronne et ses tours entraient dans le halo de la lune (rayons tirés depuis l'œil, 2026-10-18).
 */
export const VAISSEAU = { azimut: 0, hauteur: 0.4, distance: 2900, cap: 0.15 }

/** La ville posée sur la roue : rayon de la couronne, épaisseur du boudin, nombre de tours. */
export const VILLE_ANNEAU = {
  rayon: 270,
  /** Rayon du boudin de la couronne : la largeur de la « rue » circulaire où la ville est bâtie. */
  boudin: 30,
  /** Tours qui pendent sous la couronne (un néon au bout d'une sur trois). */
  pendues: 520,
  /** Tours debout sur le dessus. */
  debout: 240,
  /** Enseignes holo sous la couronne. */
  enseignes: 14
} as const

/**
 * Le grossissement des feux. Le brouillon cadrait la fenêtre de ciel 2,5 fois plus serré que l'Accueil
 * (25° au lieu de 58°) ; à la vraie taille, ses feux ne faisaient plus que 1 à 2 pixels et la jante de
 * l'anneau disparaissait derrière les câbles.
 */
export const GROSSISSEMENT_FEUX = 1.7

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
  /** La roue : la couronne et toute sa ville tournent avec elle. */
  roue: THREE.Group
  /** Les tours qui pendent sous la couronne, et celles debout dessus. */
  pendues: THREE.InstancedMesh
  debout: THREE.InstancedMesh
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

/** Un feu : position, couleur, taille (négative = balise qui clignote). */
type Feu = [number, number, number, number, number]

export function monterVaisseau(ctx: ContexteVaisseau): VaisseauMere {
  const oeil = new THREE.Vector3(...ctx.camera)
  const uE = { value: ctx.canevas.height * 0.9 * GROSSISSEMENT_FEUX }
  const brume = brumePour(VAISSEAU.distance)
  let s = 61
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

  const halo = (
    g: THREE.Object3D,
    couleur: number,
    taille: number,
    x: number,
    y: number,
    z: number,
    opacite = 0.5,
    etire = 1
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
    sp.scale.set(taille, taille * etire, 1)
    sp.position.set(x, y, z)
    sp.userData.o = opacite
    g.add(sp)
    return sp
  }

  // ---------- les feux : des points dont la taille suit la distance ; taille négative = balise ----------
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
        fragmentShader:
          'varying vec3 vC;void main(){vec2 c=gl_PointCoord-0.5;float r=dot(c,c);gl_FragColor=vec4(vC*(exp(-r*22.0)*0.6+exp(-r*90.0)),1.0);}'
      })
    )
    p.frustumCulled = false
    g.add(p)
    return p
  }

  // ---------- les tours du Kowloon : fenêtres multicolores, néon au bout (`uPointe`) ----------
  // Chaque tour monte le long de son axe y local, de sa base (0) à sa pointe (1). Les fenêtres sont
  // posées dans le repère de la tour (`vL` × son échelle `vZ`) : elles restent sur la façade quand la
  // roue tourne et quand le vaisseau monte et descend.
  const tours = (max: number, pointe: number): THREE.InstancedMesh => {
    const im = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      new THREE.ShaderMaterial({
        uniforms: {
          uBrume: ctx.uBrume,
          uFlash: ctx.uFlash,
          uLune: { value: ctx.lune },
          uHz: { value: brume },
          uPointe: { value: pointe }
        },
        vertexShader:
          'varying vec3 vW;varying vec3 vN;varying vec3 vNl;varying vec3 vL;varying vec3 vZ;varying float vS;void main(){vec4 w=modelMatrix*instanceMatrix*vec4(position,1.0);vW=w.xyz;vN=normalize(mat3(modelMatrix*instanceMatrix)*normal);vNl=normal;vL=position;vZ=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));vS=fract(sin(dot(instanceMatrix[3].xyz,vec3(12.9898,78.233,37.719)))*43758.5453);gl_Position=projectionMatrix*viewMatrix*w;}',
        fragmentShader: [
          'uniform vec3 uBrume;uniform float uHz;uniform float uPointe;uniform float uFlash;uniform vec3 uLune;',
          'varying vec3 vW;varying vec3 vN;varying vec3 vNl;varying vec3 vL;varying vec3 vZ;varying float vS;',
          H,
          'void main(){vec3 N=normalize(vN);float d=length(vW-cameraPosition);vec3 c=vec3(0.03,0.028,0.036);',
          '  c+=vec3(0.3,0.4,0.6)*max(dot(N,uLune),0.0)*0.08;',
          '  if(abs(vNl.y)<0.5){float u=(abs(vNl.x)>0.5?vL.z*vZ.z:vL.x*vZ.x)+vS*40.0;',
          '    vec2 q=vec2(u/2.6,vL.y*vZ.y/3.0);vec2 id=floor(q),f=fract(q);',
          '    float win=step(0.25,f.x)*step(f.x,0.7)*step(0.35,f.y)*step(f.y,0.8);float r=h(id+vS*17.0);',
          '    vec3 wc=r>0.9?vec3(0.55,1.0,0.7):(r>0.8?vec3(0.5,0.7,1.0):(r>0.6?vec3(1.0,0.85,0.6):vec3(1.0,0.6,0.35)));',
          '    float on=step(0.38,h(id.yx+vS*3.0));float aa=smoothstep(0.3,0.9,max(fwidth(q.x),fwidth(q.y)));',
          '    vec3 neon=mix(vec3(1.0,0.18,0.63),vec3(0.18,0.91,1.0),step(0.5,fract(vS*7.0)));',
          '    c+=mix(wc*win*on,wc*0.07,aa)*0.75;c+=neon*exp(-(1.0-vL.y)*9.0)*0.8*uPointe;}',
          '  c+=vec3(0.55,0.6,0.9)*uFlash*0.05;c=mix(c,uBrume,1.0-exp(-pow(d*uHz,1.6)));',
          FIN
        ].join('\n')
      }),
      max
    )
    im.count = 0
    im.frustumCulled = false
    return im
  }

  // ========== le vaisseau : la roue de l'anneau, vue un peu par en dessous ==========
  const groupe = new THREE.Group()
  groupe.name = 'ville-anneau'
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
  // l'axe de la roue penche de 0,32 rad : on voit l'anneau en ellipse, et son +z local pointe vers le bas
  const axe = new THREE.Group()
  axe.rotation.x = Math.PI / 2 - 0.32
  groupe.add(axe)
  const roue = new THREE.Group()
  roue.name = 'roue'
  axe.add(roue)

  const { rayon: R, boudin: B } = VILLE_ANNEAU
  piece(roue, new THREE.TorusGeometry(R, B, 24, 180))
  piece(roue, new THREE.TorusGeometry(R + 36, 7, 8, 180))
  const pylone = new THREE.BoxGeometry(44, 10, 12)
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU
    piece(roue, pylone, Math.cos(a) * (R + 18), Math.sin(a) * (R + 18), 0, 0, 0, a)
  }
  const rayonRoue = new THREE.CylinderGeometry(7, 7, R - 55, 8)
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU
    const m = (R - 55) / 2 + 30
    piece(roue, rayonRoue, -Math.sin(a) * m, Math.cos(a) * m, 0, 0, 0, a)
  }
  piece(axe, new THREE.SphereGeometry(52, 32, 16))
  piece(axe, new THREE.CylinderGeometry(16, 16, 260, 12), 0, 0, 0, Math.PI / 2)
  const moyeu = new THREE.CylinderGeometry(30, 30, 18, 24)
  for (const z of [-110, 110]) piece(axe, moyeu, 0, 0, z, Math.PI / 2)

  // ---------- la ville bâtie sur la couronne ----------
  const pendues = tours(VILLE_ANNEAU.pendues, 1)
  const debout = tours(VILLE_ANNEAU.debout, 0)
  pendues.name = 'tours-pendues'
  debout.name = 'tours-debout'
  roue.add(pendues, debout)
  const feuxVille: Feu[] = []
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const Y = new THREE.Vector3(0, 1, 0)
  const BAS = new THREE.Vector3(0, 0, 1)
  const HAUT = new THREE.Vector3(0, 0, -1)
  const base = new THREE.Vector3()
  const echelle = new THREE.Vector3()
  // une tour posée sur le boudin : angle `a` autour de la roue, angle `b` autour du boudin
  const poser = (
    im: THREE.InstancedMesh,
    a: number,
    b: number,
    dir: THREE.Vector3,
    w: number,
    hh: number,
    d: number
  ): THREE.Vector3 => {
    const rr = R + B * Math.cos(b)
    base.set(Math.cos(a) * rr, Math.sin(a) * rr, B * Math.sin(b)).addScaledVector(dir, -4)
    q.setFromUnitVectors(Y, dir)
    m4.compose(base, q, echelle.set(w, hh, d))
    im.setMatrixAt(im.count++, m4)
    return base.clone().addScaledVector(dir, hh)
  }
  // dessous (+z local) : les tours qui pendent, plus longues sous le milieu du boudin
  for (let k = 0; k < VILLE_ANNEAU.pendues; k++) {
    const a = rnd() * TAU
    const ecart = (rnd() * 2 - 1) * 1.0
    const hh = (22 + Math.pow(1 - Math.abs(ecart), 1.5) * 150) * (0.4 + rnd() * 0.8)
    const bout = poser(pendues, a, Math.PI / 2 + ecart, BAS, 8 + rnd() * 12, hh, 8 + rnd() * 12)
    if (rnd() < 0.33) feuxVille.push([bout.x, bout.y, bout.z, rnd() < 0.5 ? 0xff2fa0 : 0x2ee8ff, 7])
  }
  // dessus (−z local) : les tours debout, plus basses
  for (let k = 0; k < VILLE_ANNEAU.debout; k++) {
    const a = rnd() * TAU
    const ecart = (rnd() * 2 - 1) * 0.9
    poser(debout, a, -Math.PI / 2 + ecart, HAUT, 9 + rnd() * 12, 14 + rnd() * 60, 9 + rnd() * 12)
  }
  pendues.instanceMatrix.needsUpdate = true
  debout.instanceMatrix.needsUpdate = true

  // les feux : la jante (blancs, balises rouges), le bout des tours pendues
  for (let i = 0; i < 144; i++) {
    const a = (i / 144) * TAU
    feuxVille.push([
      Math.cos(a) * (R + 43),
      Math.sin(a) * (R + 43),
      0,
      i % 12 ? 0xdfeaff : 0xff2040,
      i % 12 ? 7 : -14
    ])
  }
  feux(roue, feuxVille)
  // les enseignes holo, sous la couronne, au milieu des tours qui pendent
  const enseignes: THREE.Sprite[] = []
  for (let k = 0; k < VILLE_ANNEAU.enseignes; k++) {
    const a = rnd() * TAU
    const rr = R + (rnd() - 0.5) * B * 1.4
    enseignes.push(
      halo(
        roue,
        k % 2 ? 0xff2fa0 : 0x2ee8ff,
        24 + rnd() * 18,
        Math.cos(a) * rr,
        Math.sin(a) * rr,
        B + 40 + rnd() * 70,
        0.55,
        2.4
      )
    )
  }
  // le cœur bleu du moyeu, et ses deux bouts
  halo(axe, 0x5fa0ff, 240, 0, 0, 0, 0.5)
  for (const z of [-130, 130]) halo(axe, 0x2ee8ff, 80, 0, 0, z, 0.4)

  ctx.scene.add(groupe)

  return {
    groupe,
    roue,
    pendues,
    debout,
    animer(t) {
      // il flotte : quelques mètres de houle, jamais de traversée ; la roue emporte sa ville
      groupe.position.y = y0 + Math.sin(t * 0.1) * 5
      roue.rotation.z = t * 0.035
      // les enseignes holo grésillent, et lâchent par moments
      enseignes.forEach((e, i) => {
        e.material.opacity =
          (e.userData.o as number) *
          (0.6 + 0.4 * Math.sin(t * 3 + i * 2.1)) *
          (Math.sin(t * 0.7 + i) > 0.95 ? 0.2 : 1)
      })
      // la taille des feux suit la hauteur du canevas, en pixels
      uE.value = ctx.canevas.height * 0.9 * GROSSISSEMENT_FEUX
    }
  }
}
