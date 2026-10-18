import * as THREE from 'three'

/**
 * LES HALOS DU FOND AVENUE DESSINÉS PAR LOTS — quelques dessins instanciés au lieu de 424 sprites.
 *
 * MESURE QUI LE MOTIVE (2026-10-18, conv-323, instance cachée `--code-dev`) : ~1 900 dessins par image
 * (reflet + écran), dont 424 halos additifs (`THREE.Sprite`) dessinés un par un à chaque passe. Le
 * coût de three est PAR DESSIN (choix du programme, réglages, état), pas par pixel.
 *
 * LE RENDU NE CHANGE PAS, et voici pourquoi — chaque point est une condition, vérifiée ici :
 *   1. MÊME NUANCEUR : le lot est une `SpriteMaterial` de three dont le nuanceur `sprite` est repris
 *      tel quel ; seules ses ENTRÉES changent (`adapterNuanceurDeSprite`) : la position vue de la
 *      caméra, les deux axes d'échelle, le pivot, la rotation, la couleur et l'opacité arrivent par
 *      halo au lieu d'arriver par réglage d'objet. Ces valeurs sont calculées comme three les calcule
 *      (`modelViewMatrix = camera.matrixWorldInverse × matrixWorld`, en double, puis en float32) : la
 *      carte graphique reçoit les MÊMES nombres, donc les mêmes sommets et les mêmes pixels.
 *   2. L'ORDRE ENTRE HALOS NE COMPTE PAS : même nuanceur intégré de three, mélange ADDITIF, pas
 *      d'écriture de profondeur, contributions toujours positives — leur somme ne dépend pas de
 *      l'ordre. C'est la SEULE liberté que les lots prennent.
 *   3. L'ORDRE PAR RAPPORT À TOUT AUTRE TRANSPARENT est gardé là où ils se recouvrent. Chaque autre
 *      objet transparent est une BARRIÈRE — les additifs aussi : au banc (2026-10-18), ne retenir que
 *      les non additifs changeait 0,3 à 0,9 % des pixels (un nuanceur maison peut sortir du négatif
 *      ou plus de 1, que l'écran écrête à chaque ajout : l'ordre compte alors). Un halo qui chevauche
 *      une barrière à l'écran reste dessiné du même côté d'elle que chez three : un lot se ferme
 *      juste avant la première barrière qui chevauche l'un de ses halos, et three le place, dans son
 *      tri des transparents, à la profondeur de son dernier halo. Une barrière dont la sphère ne
 *      borne pas le dessin (nuanceur maison, points, os) est réputée couvrir tout l'écran.
 *   4. VISIBILITÉ PAR PASSE : le lot est recalculé au début de CHAQUE `renderer.render` (reflet de la
 *      Spirale, puis écran) par `scene.onBeforeRender`, avec la caméra de la passe et les objets
 *      réellement visibles — la foule masquée le temps du reflet n'y est pas une barrière.
 *
 * Seule différence possible : le reflet est dessiné dans une image en demi-flottants, où l'addition
 * des halos ENTRE EUX arrondit autrement selon l'ordre — au plus un dernier chiffre de demi-flottant.
 *
 * Les sprites d'origine RESTENT dans la scène : le code qui les anime (opacité, couleur, rotation,
 * position, visibilité) les modifie comme avant. Ils passent sur une couche qu'aucune caméra ne
 * regarde (`COUCHE_PORTEURS`) : three ne les dessine plus, le lot lit leurs valeurs à chaque passe.
 */

/** Une couche qu'aucune caméra du décor ne regarde : les halos d'origine y restent, non dessinés. */
export const COUCHE_PORTEURS = 31

/** Marge autour de chaque emprise à l'écran, en pixels (lissage des bords, arrondis). */
const MARGE_PX = 4

/** Lots créés d'avance par sorte de halo ; au-delà, ils naissent à la demande. */
const LOTS_D_AVANCE = 4

/** Valeurs par halo dans le tampon : centre vu de la caméra (3), deux axes (3+3), pivot (2), rotation (1), teinte (4). */
const PAS = 16

export interface LotsDeHalos {
  /** Le nombre de halos regroupés. */
  readonly halos: number
  /** Le nombre de sortes (une par texture et réglages de dessin). */
  readonly sortes: number
  /** Relit les objets transparents qui imposent l'ordre : à appeler quand la scène en gagne (la foule). */
  relireBarrieres(): void
  /** Ce que la dernière passe a dessiné : lots émis et halos dedans. */
  dernierePasse(): { lots: number; halos: number }
  /** Rend la scène dans son état d'origine (sprites redessinés par three, lots retirés et libérés). */
  liberer(): void
}

type ShaderSource = { vertexShader: string; fragmentShader: string }

/**
 * Le nuanceur `sprite` de three, dont seules les entrées changent. Lève une erreur nommée si three
 * a changé ce nuanceur : un lot qui dessinerait autre chose qu'un sprite ne doit pas passer en silence.
 */
export function adapterNuanceurDeSprite(shader: ShaderSource): void {
  const remplacer = (source: string, avant: string, apres: string, ou: string): string => {
    if (!source.includes(avant))
      throw new Error(
        `[decor] lots de halos : « ${avant} » introuvable dans le nuanceur ${ou} de three (version changée ?)`
      )
    return source.split(avant).join(apres)
  }
  let v = shader.vertexShader
  v = remplacer(
    v,
    'uniform vec2 center;',
    [
      'uniform vec2 center;',
      'attribute vec3 aCentre;',
      'attribute vec3 aAxeX;',
      'attribute vec3 aAxeY;',
      'attribute vec2 aPivot;',
      'attribute float aRotation;',
      'attribute vec4 aTeinte;',
      'flat varying vec4 vTeinte;'
    ].join('\n'),
    'de sommets'
  )
  v = remplacer(
    v,
    'vec4 mvPosition = modelViewMatrix[ 3 ];',
    'vTeinte = aTeinte;\n\tvec4 mvPosition = vec4( aCentre, 1.0 );',
    'de sommets'
  )
  v = remplacer(
    v,
    'vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );',
    'vec2 scale = vec2( length( aAxeX ), length( aAxeY ) );',
    'de sommets'
  )
  v = remplacer(v, '( center - vec2( 0.5 ) )', '( aPivot - vec2( 0.5 ) )', 'de sommets')
  v = remplacer(v, 'cos( rotation )', 'cos( aRotation )', 'de sommets')
  v = remplacer(v, 'sin( rotation )', 'sin( aRotation )', 'de sommets')
  let f = shader.fragmentShader
  f = remplacer(
    f,
    'uniform float opacity;',
    'uniform float opacity;\nflat varying vec4 vTeinte;',
    'de pixels'
  )
  f = remplacer(
    f,
    'vec4 diffuseColor = vec4( diffuse, opacity );',
    'vec4 diffuseColor = vTeinte;',
    'de pixels'
  )
  shader.vertexShader = v
  shader.fragmentShader = f
}

type Dessinable = THREE.Object3D & {
  isMesh?: boolean
  isPoints?: boolean
  isLine?: boolean
  isSprite?: boolean
  isSkinnedMesh?: boolean
  isInstancedMesh?: boolean
  isBatchedMesh?: boolean
  material?: THREE.Material | THREE.Material[]
  geometry?: THREE.BufferGeometry
  boundingSphere?: THREE.Sphere | null
  center?: THREE.Vector2
}

const estDessinable = (o: Dessinable): boolean =>
  !!(o.isMesh || o.isPoints || o.isLine || o.isSprite)

const estAdditifSansProfondeur = (m: THREE.Material): boolean =>
  m.blending === THREE.AdditiveBlending && m.depthWrite === false

/** L'ordre de groupe que three donne à un objet : le `renderOrder` de son groupe le plus proche. */
function ordreDeGroupe(o: THREE.Object3D): number {
  for (let p = o.parent; p; p = p.parent) if ((p as THREE.Group).isGroup) return p.renderOrder
  return 0
}

/** Un halo que l'on peut dessiner par lot sans rien changer à son rendu. */
function estHaloRegroupable(o: Dessinable): o is THREE.Sprite {
  if (!o.isSprite) return false
  const m = o.material as THREE.SpriteMaterial | undefined
  if (!m || Array.isArray(m) || !m.isSpriteMaterial) return false
  return (
    m.transparent &&
    estAdditifSansProfondeur(m) &&
    !m.alphaHash &&
    m.onBeforeCompile === THREE.Material.prototype.onBeforeCompile &&
    o.renderOrder === 0 &&
    ordreDeGroupe(o) === 0 &&
    o.layers.mask === 1 &&
    o.onBeforeRender === THREE.Object3D.prototype.onBeforeRender
  )
}

/** Ce qui doit être identique pour que deux halos partagent un dessin. */
function cleDeSorte(m: THREE.SpriteMaterial): string {
  return [
    m.map?.id ?? -1,
    m.alphaMap?.id ?? -1,
    m.fog,
    m.sizeAttenuation,
    m.depthTest,
    m.depthFunc,
    m.toneMapped,
    m.alphaTest,
    m.premultipliedAlpha,
    m.side,
    m.colorWrite,
    m.dithering,
    m.polygonOffset,
    m.polygonOffsetFactor,
    m.polygonOffsetUnits,
    m.stencilWrite,
    m.forceSinglePass,
    m.alphaToCoverage,
    m.clippingPlanes?.length ?? 0
  ].join('|')
}

/** Ce que three utilise pour trier et ce qu'il faut pour savoir si deux dessins se recouvrent. */
interface Place {
  go: number
  ro: number
  z: number
  id: number
  plein: boolean
  x0: number
  y0: number
  x1: number
  y1: number
}

/** `a` est-il dessiné avant `b` dans le tri des transparents de three (reversePainterSortStable) ? */
function avant(a: Place, b: Place): boolean {
  if (a.go !== b.go) return a.go < b.go
  if (a.ro !== b.ro) return a.ro < b.ro
  if (a.z !== b.z) return a.z > b.z
  return a.id < b.id
}

const seRecouvrent = (a: Place, b: Place): boolean =>
  a.plein || b.plein || !(a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0)

/**
 * L'emprise touche-t-elle l'image ? Un dessin entièrement hors de l'image ne colore aucun pixel :
 * un halo n'a pas à être envoyé, et un autre transparent n'impose aucun ordre.
 */
const dansLImage = (p: Place): boolean =>
  p.plein || !(p.x0 > 1 || p.x1 < -1 || p.y0 > 1 || p.y1 < -1)

/** Une barrière dont la sphère englobante borne vraiment le dessin (pas de nuanceur qui déplace). */
function sphereFiable(o: Dessinable): boolean {
  if (o.isPoints || o.isSkinnedMesh || o.isInstancedMesh || o.isBatchedMesh) return false
  // Tri de visibilité coupé par l'auteur : sa sphère n'est pas tenue à jour (géométrie réécrite).
  if (!o.frustumCulled) return false
  if (o.geometry?.morphAttributes?.position) return false
  const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
  return ms.every(
    (m) =>
      !(m as THREE.ShaderMaterial).isShaderMaterial &&
      m.onBeforeCompile === THREE.Material.prototype.onBeforeCompile &&
      !(m as THREE.MeshStandardMaterial).displacementMap
  )
}

interface Porteur {
  sprite: THREE.Sprite
  matiere: THREE.SpriteMaterial
}

interface Entree extends Place {
  porteur: Porteur
  donnees: Float32Array
  wx: number
  wy: number
  wz: number
}

interface Lot {
  mesh: THREE.Mesh
  geometrie: THREE.InstancedBufferGeometry
  donnees: Float32Array
  tampon: THREE.InstancedInterleavedBuffer
}

interface Sorte {
  matiere: THREE.SpriteMaterial
  porteurs: Porteur[]
  entrees: Entree[]
  lots: Lot[]
}

interface Barriere extends Place {
  objet: Dessinable
  /** La matière lue au relevé, et ce qu'on en a déduit (relu si elle change). */
  matiereVue: THREE.Material | THREE.Material[] | undefined
  materiaux: THREE.Material[]
  fiable: boolean
}

/** Le carré d'un sprite, recopié de celui de three (`Sprite.js`) : mêmes sommets, mêmes UV, même diagonale. */
const QUAD = [-0.5, -0.5, 0, 0, 0, 0.5, -0.5, 0, 1, 0, 0.5, 0.5, 0, 1, 1, -0.5, 0.5, 0, 0, 1]

export function regrouperHalos(scene: THREE.Scene): LotsDeHalos {
  const sortes = new Map<string, Sorte>()
  const porteurs = new Set<THREE.Object3D>()
  const lots = new Set<THREE.Object3D>()

  scene.traverse((o) => {
    if (!estHaloRegroupable(o as Dessinable)) return
    const sprite = o as THREE.Sprite
    const matiere = sprite.material
    const cle = cleDeSorte(matiere)
    let sorte = sortes.get(cle)
    if (!sorte) {
      const lotMatiere = matiere.clone()
      lotMatiere.name = 'lot-halos'
      lotMatiere.visible = true
      lotMatiere.onBeforeCompile = adapterNuanceurDeSprite
      lotMatiere.customProgramCacheKey = (): string => 'autowin-lot-halos-v1'
      sorte = { matiere: lotMatiere, porteurs: [], entrees: [], lots: [] }
      sortes.set(cle, sorte)
    }
    sorte.porteurs.push({ sprite, matiere })
    porteurs.add(sprite)
  })

  const nouveauLot = (sorte: Sorte): Lot => {
    const geometrie = new THREE.InstancedBufferGeometry()
    const carre = new THREE.InterleavedBuffer(new Float32Array(QUAD), 5)
    geometrie.setIndex([0, 1, 2, 0, 2, 3])
    geometrie.setAttribute('position', new THREE.InterleavedBufferAttribute(carre, 3, 0, false))
    geometrie.setAttribute('uv', new THREE.InterleavedBufferAttribute(carre, 2, 3, false))
    const donnees = new Float32Array(Math.max(1, sorte.porteurs.length) * PAS)
    const tampon = new THREE.InstancedInterleavedBuffer(donnees, PAS, 1)
    tampon.setUsage(THREE.DynamicDrawUsage)
    geometrie.setAttribute('aCentre', new THREE.InterleavedBufferAttribute(tampon, 3, 0))
    geometrie.setAttribute('aAxeX', new THREE.InterleavedBufferAttribute(tampon, 3, 3))
    geometrie.setAttribute('aAxeY', new THREE.InterleavedBufferAttribute(tampon, 3, 6))
    geometrie.setAttribute('aPivot', new THREE.InterleavedBufferAttribute(tampon, 2, 9))
    geometrie.setAttribute('aRotation', new THREE.InterleavedBufferAttribute(tampon, 1, 11))
    geometrie.setAttribute('aTeinte', new THREE.InterleavedBufferAttribute(tampon, 4, 12))
    geometrie.instanceCount = 0
    // Ne sert qu'au TRI des transparents : son centre est posé, à chaque passe, sur le dernier halo du lot.
    geometrie.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0)
    const mesh = new THREE.Mesh(geometrie, sorte.matiere)
    mesh.name = 'lot-halos'
    mesh.frustumCulled = false
    mesh.matrixAutoUpdate = false
    // three passe `object.center` à une SpriteMaterial ; le nuanceur du lot ne s'en sert pas.
    ;(mesh as Dessinable).center = new THREE.Vector2(0.5, 0.5)
    // Toujours « visible » (le reflet lui pose sa jumelle), activé par sa couche.
    mesh.layers.set(COUCHE_PORTEURS)
    scene.add(mesh)
    lots.add(mesh)
    const lot = { mesh, geometrie, donnees, tampon }
    sorte.lots.push(lot)
    return lot
  }

  for (const sorte of sortes.values()) {
    for (const p of sorte.porteurs) {
      p.sprite.layers.set(COUCHE_PORTEURS)
      sorte.entrees.push({
        porteur: p,
        donnees: new Float32Array(PAS),
        go: 0,
        ro: 0,
        z: 0,
        id: p.sprite.id,
        plein: false,
        x0: 0,
        y0: 0,
        x1: 0,
        y1: 0,
        wx: 0,
        wy: 0,
        wz: 0
      })
    }
    for (let i = 0; i < LOTS_D_AVANCE; i++) nouveauLot(sorte)
  }

  let barrieres: Barriere[] = []
  const relireBarrieres = (): void => {
    const liste: Barriere[] = []
    scene.traverse((o) => {
      const d = o as Dessinable
      if (!estDessinable(d) || porteurs.has(o) || lots.has(o) || !d.material) return
      const ms = Array.isArray(d.material) ? d.material : [d.material]
      // TOUT autre transparent, additif compris : voir le point 3 de l'en-tête.
      if (!ms.some((m) => m.transparent)) return
      liste.push({
        objet: d,
        matiereVue: d.material,
        materiaux: ms,
        fiable: sphereFiable(d),
        go: 0,
        ro: 0,
        z: 0,
        id: o.id,
        plein: false,
        x0: 0,
        y0: 0,
        x1: 0,
        y1: 0
      })
    })
    barrieres = liste
  }
  relireBarrieres()

  const _ps = new THREE.Matrix4()
  const _v4 = new THREE.Vector4()
  const _c = new THREE.Vector3()
  const _taille = new THREE.Vector2()
  let mx = 0
  let my = 0
  let derniere = { lots: 0, halos: 0 }

  /** Visible à cette passe : lui et tous ses parents visibles, et toujours accroché à la scène. */
  const accrocheEtVisible = (o: THREE.Object3D): boolean => {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) {
      if (!p.visible) return false
      if (p === scene) return true
    }
    return false
  }

  /**
   * La position d'un objet vue de la caméra : les cases 12 à 14 de
   * `camera.matrixWorldInverse × matrixWorld`, calculées avec les MÊMES opérations, dans le même ordre,
   * que `Matrix4.multiplyMatrices` de three — donc les mêmes nombres, sans la multiplication entière.
   */
  let vx = 0
  let vy = 0
  let vz = 0
  const centreVu = (e: number[], a: number[]): void => {
    const x = e[12]
    const y = e[13]
    const z = e[14]
    const w = e[15]
    vx = a[0] * x + a[4] * y + a[8] * z + a[12] * w
    vy = a[1] * x + a[5] * y + a[9] * z + a[13] * w
    vz = a[2] * x + a[6] * y + a[10] * z + a[14] * w
  }
  /** La profondeur de tri de three (`Vector4.applyMatrix4` de la position par `_ps`), mêmes opérations. */
  const zDeTri = (x: number, y: number, z: number, w: number): number => {
    const p = _ps.elements
    return p[2] * x + p[6] * y + p[10] * z + p[14] * w
  }

  /** L'emprise à l'écran (coordonnées normalisées) d'un sprite dont le centre vu est (vx, vy, vz). */
  const empriseSprite = (
    place: Place,
    centre: THREE.Vector2,
    attenue: boolean,
    P: number[],
    e: number[]
  ): void => {
    const cx = P[0] * vx + P[4] * vy + P[8] * vz + P[12]
    const cy = P[1] * vx + P[5] * vy + P[9] * vz + P[13]
    const cw = P[3] * vx + P[7] * vy + P[11] * vz + P[15]
    if (!(cw > 1e-6)) {
      place.plein = true
      return
    }
    let sx = Math.sqrt(e[0] * e[0] + e[1] * e[1] + e[2] * e[2])
    let sy = Math.sqrt(e[4] * e[4] + e[5] * e[5] + e[6] * e[6])
    if (!attenue && P[11] === -1) {
      sx *= -vz
      sy *= -vz
    }
    const ax = (0.5 + Math.abs(centre.x - 0.5)) * sx
    const ay = (0.5 + Math.abs(centre.y - 0.5)) * sy
    const r = Math.sqrt(ax * ax + ay * ay)
    const hx = (Math.abs(P[0]) * r) / cw + mx
    const hy = (Math.abs(P[5]) * r) / cw + my
    place.plein = false
    place.x0 = cx / cw - hx
    place.x1 = cx / cw + hx
    place.y0 = cy / cw - hy
    place.y1 = cy / cw + hy
  }

  /** L'emprise d'un objet par sa sphère englobante : les huit coins de son cube vu de la caméra. */
  const empriseSphere = (
    place: Place,
    centre: THREE.Vector3,
    rayon: number,
    camera: THREE.Camera
  ): void => {
    _c.copy(centre).applyMatrix4(camera.matrixWorldInverse)
    const P = camera.projectionMatrix.elements
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (let i = 0; i < 8; i++) {
      const x = _c.x + (i & 1 ? rayon : -rayon)
      const y = _c.y + (i & 2 ? rayon : -rayon)
      const z = _c.z + (i & 4 ? rayon : -rayon)
      const w = P[3] * x + P[7] * y + P[11] * z + P[15]
      if (!(w > 1e-6)) {
        place.plein = true
        return
      }
      const nx = (P[0] * x + P[4] * y + P[8] * z + P[12]) / w
      const ny = (P[1] * x + P[5] * y + P[9] * z + P[13]) / w
      if (nx < x0) x0 = nx
      if (nx > x1) x1 = nx
      if (ny < y0) y0 = ny
      if (ny > y1) y1 = ny
    }
    place.plein = false
    place.x0 = x0 - mx
    place.x1 = x1 + mx
    place.y0 = y0 - my
    place.y1 = y1 + my
  }

  /**
   * L'ordre de groupe de three si l'objet est dessiné à cette passe (lui et tous ses parents
   * visibles, accroché à la scène), sinon NaN — en une seule remontée des parents.
   */
  const ordreSiDessine = (o: THREE.Object3D): number => {
    let go = NaN
    for (let p: THREE.Object3D | null = o; p; p = p.parent) {
      if (!p.visible) return NaN
      if (p !== o && Number.isNaN(go) && (p as THREE.Group).isGroup) go = p.renderOrder
      if (p === scene) return Number.isNaN(go) ? 0 : go
    }
    return NaN
  }

  const placerBarriere = (b: Barriere, camera: THREE.Camera): boolean => {
    const o = b.objet
    if (!o.layers.test(camera.layers)) return false
    if (o.material !== b.matiereVue) {
      b.matiereVue = o.material
      b.materiaux = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
      b.fiable = sphereFiable(o)
    }
    let uneVisible = false
    for (const m of b.materiaux) if (m.visible) uneVisible = true
    if (!uneVisible) return false
    const go = ordreSiDessine(o)
    if (Number.isNaN(go)) return false
    b.go = go
    b.ro = o.renderOrder
    if (o.isSprite) {
      // comme three : la position de l'objet, dans l'espace de découpe
      const e = o.matrixWorld.elements
      b.z = zDeTri(e[12], e[13], e[14], e[15])
      centreVu(e, camera.matrixWorldInverse.elements)
      const m = o.material as THREE.SpriteMaterial
      const P = camera.projectionMatrix.elements
      empriseSprite(b, (o as THREE.Sprite).center, m.sizeAttenuation, P, e)
      return dansLImage(b)
    }
    const geo = o.geometry
    let sphere: THREE.Sphere | null | undefined = o.boundingSphere
    if (sphere === null) {
      ;(o as THREE.InstancedMesh).computeBoundingSphere()
      sphere = o.boundingSphere
    }
    if (sphere === undefined && geo) {
      if (geo.boundingSphere === null) geo.computeBoundingSphere()
      sphere = geo.boundingSphere
    }
    if (!sphere) {
      b.z = 0
      b.plein = true
      return true
    }
    // comme three (projectObject) : centre de la sphère → monde → découpe
    _v4.copy(sphere.center).applyMatrix4(o.matrixWorld)
    _c.set(_v4.x, _v4.y, _v4.z)
    b.z = _v4.applyMatrix4(_ps).z
    if (!b.fiable) {
      b.plein = true
      return true
    }
    empriseSphere(b, _c, sphere.radius * o.matrixWorld.getMaxScaleOnAxis(), camera)
    return dansLImage(b)
  }

  /** Un halo à cette passe : sa place, son emprise, et les valeurs que le nuanceur recevra. */
  const placerHalo = (en: Entree, camera: THREE.Camera): boolean => {
    const { sprite, matiere } = en.porteur
    if (!accrocheEtVisible(sprite) || !matiere.visible) return false
    const e = sprite.matrixWorld.elements
    en.z = zDeTri(e[12], e[13], e[14], e[15])
    en.wx = e[12]
    en.wy = e[13]
    en.wz = e[14]
    // exactement ce que three calcule avant de l'envoyer en float32 (WebGLRenderer, renderObject)
    centreVu(e, camera.matrixWorldInverse.elements)
    empriseSprite(en, sprite.center, matiere.sizeAttenuation, camera.projectionMatrix.elements, e)
    // hors de l'image : ce halo ne colorerait aucun pixel
    if (!dansLImage(en)) return false
    const d = en.donnees
    d[0] = vx
    d[1] = vy
    d[2] = vz
    d[3] = e[0]
    d[4] = e[1]
    d[5] = e[2]
    d[6] = e[4]
    d[7] = e[5]
    d[8] = e[6]
    d[9] = sprite.center.x
    d[10] = sprite.center.y
    d[11] = matiere.rotation
    d[12] = matiere.color.r
    d[13] = matiere.color.g
    d[14] = matiere.color.b
    d[15] = matiere.opacity
    return true
  }

  const visibles: Barriere[] = []
  const ouverts: Entree[] = []
  const fermes: Entree[] = []
  const tries: Entree[] = []

  const maj = (renderer: THREE.WebGLRenderer | null, camera: THREE.Camera): void => {
    if (!(camera as THREE.PerspectiveCamera).isCamera) return
    _ps.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    if (renderer && typeof renderer.getDrawingBufferSize === 'function') {
      renderer.getDrawingBufferSize(_taille)
      mx = (2 * MARGE_PX) / Math.max(1, _taille.x)
      my = (2 * MARGE_PX) / Math.max(1, _taille.y)
    } else {
      mx = my = 0.01
    }
    visibles.length = 0
    for (const b of barrieres) if (placerBarriere(b, camera)) visibles.push(b)
    visibles.sort((a, b) => (avant(a, b) ? -1 : avant(b, a) ? 1 : 0))

    let nLots = 0
    let nHalos = 0
    for (const sorte of sortes.values()) {
      tries.length = 0
      for (const en of sorte.entrees) {
        // Une matière changée après le regroupement : ce halo redevient un sprite que three dessine.
        // Sa JUMELLE du reflet (home-decor-reflet-jumelles.ts, `Object.create(original)`) n'en est pas
        // une : posée le temps du reflet, elle lit tout de l'original. La prendre pour un changement
        // remettait les 424 sprites en dessin, EN PLUS des lots (mesuré au banc, 2026-10-18).
        const actuelle = en.porteur.sprite.material
        if (
          actuelle !== en.porteur.matiere &&
          Object.getPrototypeOf(actuelle) !== en.porteur.matiere
        ) {
          en.porteur.sprite.layers.mask = 1
          continue
        }
        if (placerHalo(en, camera)) tries.push(en)
      }
      tries.sort((a, b) => (avant(a, b) ? -1 : avant(b, a) ? 1 : 0))
      let utilises = 0
      const emettre = (membres: Entree[]): void => {
        if (membres.length === 0) return
        const lot = utilises < sorte.lots.length ? sorte.lots[utilises] : nouveauLot(sorte)
        utilises++
        for (let i = 0; i < membres.length; i++) lot.donnees.set(membres[i].donnees, i * PAS)
        lot.geometrie.instanceCount = membres.length
        lot.tampon.clearUpdateRanges()
        lot.tampon.addUpdateRange(0, membres.length * PAS)
        lot.tampon.needsUpdate = true
        // three trie le lot à la place de son DERNIER halo : chacun des autres y est retardé, sans
        // franchir aucune barrière qui le recouvre (elles ont fermé le lot avant d'être franchies).
        const der = membres[membres.length - 1]
        lot.geometrie.boundingSphere?.center.set(der.wx, der.wy, der.wz)
        lot.mesh.layers.mask = 1
        nLots++
        nHalos += membres.length
      }
      // Fusion dans l'ordre de three : halos et barrières. `boite` englobe les halos ouverts : une
      // barrière qui ne la touche pas ne recouvre aucun d'eux, sans les parcourir un à un.
      ouverts.length = 0
      const boite: Place = { go: 0, ro: 0, z: 0, id: 0, plein: false, x0: 0, y0: 0, x1: 0, y1: 0 }
      const vider = (): void => {
        boite.plein = false
        boite.x0 = boite.y0 = Infinity
        boite.x1 = boite.y1 = -Infinity
      }
      const etendre = (o: Place): void => {
        if (o.plein) boite.plein = true
        else {
          if (o.x0 < boite.x0) boite.x0 = o.x0
          if (o.y0 < boite.y0) boite.y0 = o.y0
          if (o.x1 > boite.x1) boite.x1 = o.x1
          if (o.y1 > boite.y1) boite.y1 = o.y1
        }
      }
      vider()
      let ib = 0
      for (const en of tries) {
        while (ib < visibles.length && avant(visibles[ib], en)) {
          const b = visibles[ib++]
          if (ouverts.length === 0 || !seRecouvrent(boite, b)) continue
          // Les halos ouverts qui recouvrent cette barrière doivent être dessinés AVANT elle.
          fermes.length = 0
          let k = 0
          vider()
          for (const o of ouverts) {
            if (seRecouvrent(o, b)) fermes.push(o)
            else {
              ouverts[k++] = o
              etendre(o)
            }
          }
          ouverts.length = k
          emettre(fermes)
        }
        ouverts.push(en)
        etendre(en)
      }
      emettre(ouverts)
      for (let i = utilises; i < sorte.lots.length; i++) {
        sorte.lots[i].mesh.layers.set(COUCHE_PORTEURS)
        sorte.lots[i].geometrie.instanceCount = 0
      }
    }
    derniere = { lots: nLots, halos: nHalos }
  }

  const avantRenduPrecedent = scene.onBeforeRender
  scene.onBeforeRender = function (renderer, s, camera, cible) {
    avantRenduPrecedent.call(this, renderer, s, camera, cible)
    maj(renderer, camera)
  }

  let nHalos = 0
  for (const s of sortes.values()) nHalos += s.porteurs.length

  return {
    halos: nHalos,
    sortes: sortes.size,
    relireBarrieres,
    dernierePasse: () => derniere,
    liberer() {
      scene.onBeforeRender = avantRenduPrecedent
      for (const sorte of sortes.values()) {
        for (const p of sorte.porteurs) p.sprite.layers.mask = 1
        for (const lot of sorte.lots) {
          lot.mesh.removeFromParent()
          lot.geometrie.dispose()
        }
        sorte.matiere.dispose()
      }
      sortes.clear()
      lots.clear()
    }
  }
}
