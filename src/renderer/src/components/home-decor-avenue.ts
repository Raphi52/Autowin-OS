import * as THREE from 'three'
import type { DecorScene } from './home-decor-scene'
import {
  capucheDe,
  champTete,
  NOMS_OS,
  PARENT_OS,
  preparationHumains,
  QUEUE,
  REPOS,
  type MaillagesHumains,
  type NomForme,
  type Tenue
} from './home-decor-avenue-maillage'

/**
 * LE FOND DE L'ACCUEIL : UNE AVENUE CYBERPUNK SOUS L'ORAGE.
 *
 * Demande de l'utilisateur (conv-301) : « /draft un tout nouveau fond 3d pour l'accueil qui
 * s'inspire un peu de cette image notre theme ville cyberpunk obscure street tag et de notre theme
 * noir holo », puis, après des tours de brouillon, « Passe au vrai fond de l'Accueil avec ce look ».
 * « Ce look », c'est le brouillon `.autowin-tmp/draft-cyber/r-avenue.js` : une avenue en corniche,
 * la foule sous la pluie en tenues dark cyberpunk (manteaux longs, capuches amples, implants
 * lumineux), le taggeur, le deal contre le mur de sa photo, et toute la ville en contrebas.
 *
 * CE QUI EST REPRIS TEL QUEL : la géométrie, les nuanceurs, les couleurs et les animations du
 * brouillon. Les corps sont IDENTIQUES sommet par sommet (vérifié le 2026-10-17).
 *
 * CE QUI CHANGE, parce qu'un fond n'est pas une démo :
 *   - un seul réglage, le n° 6 du brouillon, « Fond d'accueil » (lent et calme, pour passer derrière
 *     les widgets) ; plus de boutons, de touches 1 à 6 ni de légende ;
 *   - la caméra est POSÉE et ne suit que le pointeur (`look`) : plus de contrôles orbitaux, qui
 *     auraient volé la souris aux widgets ;
 *   - le temps vient de l'appelant (`render(elapsed)`) : la limite d'images, la pause quand la
 *     fenêtre est cachée et le ralenti « mouvement réduit » de `DecorDeFond` s'appliquent ;
 *   - les corps sont maillés PAR TRANCHES entre deux images (`home-decor-avenue-maillage.ts`) : la
 *     rue s'affiche tout de suite, la foule la rejoint quand ses corps sont prêts ;
 *   - tout ce qui est créé est libéré par `dispose`.
 *
 * LES TEXTURES SONT DESSINÉES PAR CODE (tags, enseignes, façades) : aucune image n'est chargée, et
 * la photo d'inspiration de l'utilisateur n'est PAS plaquée. Le contrat voisin le vérifie.
 */

/** Le réglage n° 6 du brouillon, « Fond d'accueil » : lent et calme, pour passer derrière les widgets. */
export const AVENUE = {
  /** Vitesse de la marche, en m/s : on avance au pas sur le trottoir. */
  vitesse: 0.45,
  /** Amplitude du balancement de tête de la marche. */
  bob: 0.25,
  /** Force de la pluie. */
  pluie: 1,
  /** Un éclair toutes les `orage` secondes. */
  orage: 14,
  /** Une enseigne qui claque en gerbe d'étincelles toutes les `gerbe` secondes. */
  gerbe: 16,
  /** Une voiture toutes les `voitures` secondes. */
  voitures: 16,
  /** Nombre de passants. */
  passants: 7,
  /** Densité des voitures volantes au-dessus de la ville. */
  vols: 0.4,
  /** Réverbères, enseignes et projecteur baissés. */
  sombre: true
} as const

/** Le cadrage « trottoir » du brouillon, et ce que le pointeur a le droit de le décaler. */
export const CAMERA_AVENUE = {
  position: [-5.55, 1.75, 10] as const,
  cible: [-2.2, 1.45, -14] as const,
  fov: 58,
  /**
   * Décalage maximal au pointeur, en mètres. Assez pour lire la profondeur (la façade glisse
   * devant la ville), assez peu pour ne jamais sortir du trottoir ni décadrer la scène.
   */
  parallaxe: { x: 0.35, y: 0.18 }
} as const

/**
 * Temps de maillage accordé par tâche, en millisecondes.
 *
 * Une tranche dure au plus ~19 ms à froid (mesuré le 2026-10-17) : une tâche reste donc sous la
 * barre des 50 ms où le navigateur la compte comme « longue », et les images continuent de passer.
 */
export const BUDGET_MAILLAGE_MS = 8

/** Plafond de densité de pixels : au-delà, le coût par pixel monte sans que ça se voie. */
const PLAFOND_RATIO = 1.75

type Toile = [HTMLCanvasElement, CanvasRenderingContext2D]
type MeshBasique = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>

interface OsPersonne {
  hanches: THREE.Bone
  ventre: THREE.Bone
  poitrine: THREE.Bone
  cou: THREE.Bone
  tete: THREE.Bone
  bras: [THREE.Bone, THREE.Bone]
  avant: [THREE.Bone, THREE.Bone]
  main: [THREE.Bone, THREE.Bone]
  cuisse: [THREE.Bone, THREE.Bone]
  mollet: [THREE.Bone, THREE.Bone]
  pied: [THREE.Bone, THREE.Bone]
}

interface Personne {
  racine: THREE.Group
  mesh: THREE.SkinnedMesh
  os: OsPersonne
  o: Tenue
  ph: number
  taille: number
  yeux: THREE.Mesh[]
}

interface Enseigne {
  box: MeshBasique
  halo: THREE.Sprite
  lum: THREE.PointLight | null
  reflet: MeshBasique
  col: THREE.Color
  ph: number
  i: number
  cote: number
}

/** Les acteurs, montés quand leurs corps sont maillés ; avant, la rue vit sans eux. */
interface Acteurs {
  /** Tout ce qui appartient à la foule : il entre dans la scène d'un bloc, nuanceurs déjà compilés. */
  groupe: THREE.Group
  animer(t: number, dt: number, v: number): void
}

// ---------- LE SQUELETTE : cinématique inverse et poses, indépendantes de la scène ----------
const DIR = (a: number): THREE.Vector3 =>
  new THREE.Vector3(
    QUEUE[a][0] - REPOS[a][0],
    QUEUE[a][1] - REPOS[a][1],
    QUEUE[a][2] - REPOS[a][2]
  ).normalize()
const LONG = (a: number): number =>
  Math.hypot(QUEUE[a][0] - REPOS[a][0], QUEUE[a][1] - REPOS[a][1], QUEUE[a][2] - REPOS[a][2])
interface Ik {
  ra: THREE.Vector3
  rb: THREE.Vector3
  la: number
  lb: number
}
const IK_BRAS: Ik[] = [
  [5, 6],
  [8, 9]
].map(([a, b]) => ({ ra: DIR(a), rb: DIR(b), la: LONG(a), lb: LONG(b) + 0.06 }))
const IK_JAMBE: Ik[] = [
  [11, 12],
  [14, 15]
].map(([a, b]) => ({ ra: DIR(a), rb: DIR(b), la: LONG(a), lb: LONG(b) }))
const _S = new THREE.Vector3(),
  _D = new THREE.Vector3(),
  _P = new THREE.Vector3(),
  _E = new THREE.Vector3(),
  _F = new THREE.Vector3(),
  _q = new THREE.Quaternion()
// cinématique inverse à deux os : l'épaule (ou la hanche) et le coude (ou le genou) s'orientent pour poser la main sur la cible
function ik(
  a: THREE.Bone,
  b: THREE.Bone,
  c: Ik,
  sc: number,
  cible: THREE.Vector3,
  pole: THREE.Vector3
): void {
  const parent = a.parent!
  parent.updateWorldMatrix(true, false)
  a.getWorldPosition(_S)
  const la = c.la * sc,
    lb = c.lb * sc
  _D.copy(cible).sub(_S)
  const d = Math.min(Math.max(_D.length(), Math.abs(la - lb) + 1e-3), la + lb - 1e-3)
  _D.normalize()
  _P.copy(pole).sub(_S)
  _P.addScaledVector(_D, -_P.dot(_D)).normalize()
  const x = (la * la - lb * lb + d * d) / (2 * d)
  const hh = Math.sqrt(Math.max(0, la * la - x * x))
  _E.copy(_S).addScaledVector(_D, x).addScaledVector(_P, hh)
  _F.copy(_E).sub(_S).normalize()
  parent.getWorldQuaternion(_q)
  _F.applyQuaternion(_q.invert())
  a.quaternion.setFromUnitVectors(c.ra, _F)
  a.updateWorldMatrix(false, false)
  _F.copy(_S).addScaledVector(_D, d).sub(_E).normalize()
  a.getWorldQuaternion(_q)
  _F.applyQuaternion(_q.invert())
  b.quaternion.setFromUnitVectors(c.rb, _F)
  b.updateWorldMatrix(false, true)
}
const _L1 = new THREE.Vector3(),
  _L2 = new THREE.Vector3()
// pose la main k sur un point exprimé dans le repère de la personne
function main(
  p: Personne,
  k: number,
  x: number,
  y: number,
  z: number,
  px: number,
  py: number,
  pz: number
): void {
  p.racine.updateMatrixWorld(true)
  p.racine.localToWorld(_L1.set(x, y, z))
  p.racine.localToWorld(_L2.set(px, py, pz))
  ik(p.os.bras[k], p.os.avant[k], IK_BRAS[k], p.taille, _L1, _L2)
}
function pied(
  p: Personne,
  k: number,
  x: number,
  y: number,
  z: number,
  px: number,
  py: number,
  pz: number
): void {
  p.racine.updateMatrixWorld(true)
  p.racine.localToWorld(_L1.set(x, y, z))
  p.racine.localToWorld(_L2.set(px, py, pz))
  ik(p.os.cuisse[k], p.os.mollet[k], IK_JAMBE[k], p.taille, _L1, _L2)
}
function debout(p: Personne, respire = 0): void {
  const B = p.os
  B.hanches.position.set(0, 0.98, 0)
  B.hanches.rotation.set(0, 0, 0)
  B.ventre.rotation.set(0.02 + respire * 0.01, 0, 0)
  B.poitrine.rotation.set(0.03, 0, 0)
  B.cou.rotation.set(0.05, 0, 0)
  B.tete.rotation.set(0.02, 0, 0)
  for (let k = 0; k < 2; k++) {
    const s = k ? 1 : -1
    B.cuisse[k].rotation.set(0, 0, -s * 0.02)
    B.mollet[k].rotation.set(0.03, 0, 0)
    B.pied[k].rotation.set(-0.03, 0, s * 0.02)
    B.bras[k].rotation.set(0.04, 0, -s * 0.16)
    B.avant[k].rotation.set(-0.18, 0, 0)
    B.main[k].rotation.set(0, 0, 0)
  }
}
// le cycle de marche : le genou plie à l'élan, la cheville déroule, le bassin tourne, les épaules répondent
function allure(p: Personne, ph: number, a = 1): void {
  const B = p.os
  const s = Math.sin(ph)
  debout(p)
  for (let k = 0; k < 2; k++) {
    const sg = k ? 1 : -1
    const f = ph + k * Math.PI
    const sf = Math.sin(f)
    const hip = -0.4 * sf * a
    const knee = (0.06 + 0.85 * Math.pow(Math.max(0, Math.cos(f + 0.35)), 2)) * a
    B.cuisse[k].rotation.set(hip, 0, -sg * 0.02)
    B.mollet[k].rotation.set(knee, 0, 0)
    B.pied[k].rotation.set(-(hip + knee) * 0.7 + 0.12 * Math.max(0, -Math.cos(f)) * a, 0, 0)
    B.bras[k].rotation.set(0.3 * sf * a + 0.04, 0, -sg * 0.17)
    B.avant[k].rotation.set(-(0.22 + 0.3 * Math.max(0, -sf)) * a - 0.1, 0, 0)
  }
  B.hanches.position.y = 0.98 - 0.03 * (0.5 + 0.5 * Math.cos(2 * ph)) * a
  B.hanches.rotation.set(0, 0.09 * s * a, 0.035 * s * a)
  B.ventre.rotation.set(0.04 * a, -0.08 * s * a, -0.03 * s * a)
  B.poitrine.rotation.set(0.02, -0.05 * s * a, 0)
  B.tete.rotation.set(-0.03, 0.06 * s * a, 0)
}
// mains dans la poche ventrale (sweat) ou dans les poches de côté (doudoune, bomber)
function mainsPoches(p: Personne, k = 1): void {
  if (k <= 0.01) return
  p.racine.updateMatrixWorld(true)
  const ventrale = p.o.type === 'sweat'
  for (let i = 0; i < 2; i++) {
    const s = i ? 1 : -1
    p.os.main[i].getWorldPosition(_L1)
    p.racine.worldToLocal(_L1)
    const cx = ventrale ? s * 0.06 : s * 0.15,
      cy = ventrale ? 1.0 : 0.98,
      cz = ventrale ? 0.1 : 0.06
    main(
      p,
      i,
      _L1.x + (cx - _L1.x) * k,
      _L1.y + (cy - _L1.y) * k,
      _L1.z + (cz - _L1.z) * k,
      s * 0.32,
      1.1,
      -0.6
    )
  }
}
const _Q = new THREE.Vector3()
// main k vers un point du monde ; coude orienté vers un point exprimé dans le repère de la personne
function mainMonde(
  p: Personne,
  k: number,
  cibleMonde: THREE.Vector3,
  px: number,
  py: number,
  pz: number
): void {
  p.racine.updateMatrixWorld(true)
  p.racine.localToWorld(_Q.set(px, py, pz))
  ik(p.os.bras[k], p.os.avant[k], IK_BRAS[k], p.taille, cibleMonde, _Q)
}

const lisse = (x: number, a: number, b: number): number => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return u * u * (3 - 2 * u)
}

/**
 * Monte l'avenue dans un canevas.
 *
 * Rend `null` quand WebGL ou le dessin 2D ne sont pas disponibles (happy-dom en test, pilote
 * absent) : un décor n'est pas une dépendance de l'Accueil.
 */
export function createAvenueScene(): DecorScene | null {
  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'default' })
  } catch {
    return null
  }
  try {
    return monterAvenue(renderer)
  } catch (erreur) {
    // Le décor reste un DÉCOR : une scène qui ne se monte pas laisse l'Accueil sans fond 3D, elle
    // ne le casse pas. L'erreur est écrite en console pour rester visible.
    console.error("[decor] l'avenue n'a pas pu être montée :", erreur)
    renderer.dispose()
    return null
  }
}

function monterAvenue(renderer: THREE.WebGLRenderer): DecorScene {
  const canvas = renderer.domElement
  const FOND = new THREE.Color(0x170b24)
  const FLASH = new THREE.Color(0x8a78c8)
  const scene = new THREE.Scene()
  const fondCourant = FOND.clone()
  scene.background = fondCourant
  const brouillard = new THREE.FogExp2(0x170b24, 0.021)
  scene.fog = brouillard
  const camera = new THREE.PerspectiveCamera(CAMERA_AVENUE.fov, 1, 0.1, 6000)
  camera.position.set(...CAMERA_AVENUE.position)
  const T0 = 0
  const DEPART = 25
  const TROTTOIR = 0.15
  const ROUTE = 4
  const FACADE = 7.5
  const GARDE = -7.2
  const p = AVENUE

  /** Toutes les textures dessinées, pour les libérer avec la scène. */
  const textures: THREE.Texture[] = []
  let s0 = 7
  const rnd = (): number => (s0 = (s0 * 16807) % 2147483647) / 2147483647
  const toile = (w: number, h: number): Toile => {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const g = c.getContext('2d')
    if (!g) throw new Error('dessin 2D indisponible')
    return [c, g]
  }
  const tex = (c: HTMLCanvasElement): THREE.CanvasTexture => {
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 8
    textures.push(t)
    return t
  }
  const [gc, gg] = toile(128, 128)
  const rg = gg.createRadialGradient(64, 64, 0, 64, 64, 64)
  rg.addColorStop(0, 'rgba(255,255,255,1)')
  rg.addColorStop(0.2, 'rgba(255,255,255,.5)')
  rg.addColorStop(1, 'rgba(255,255,255,0)')
  gg.fillStyle = rg
  gg.fillRect(0, 0, 128, 128)
  const GLOW = tex(gc)
  const glow = (
    color: THREE.ColorRepresentation,
    size: number,
    x: number,
    y: number,
    z: number,
    op = 1,
    parent: THREE.Object3D = scene
  ): THREE.Sprite => {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: GLOW,
        color,
        opacity: op,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false
      })
    )
    s.scale.set(size, size, 1)
    s.position.set(x, y, z)
    parent.add(s)
    return s
  }
  const [fc, fg] = toile(32, 256)
  const lg = fg.createLinearGradient(0, 0, 0, 256)
  lg.addColorStop(0, 'rgba(255,255,255,0)')
  lg.addColorStop(0.15, 'rgba(255,255,255,.9)')
  lg.addColorStop(1, 'rgba(255,255,255,0)')
  fg.fillStyle = lg
  fg.fillRect(0, 0, 32, 256)
  const FADE = tex(fc)
  // une lumière couchée au sol (reflet mouillé) ; sa partie vive est côté -z
  const trainee = (
    color: THREE.ColorRepresentation,
    w: number,
    l: number,
    op: number,
    parent: THREE.Object3D
  ): MeshBasique => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, l),
      new THREE.MeshBasicMaterial({
        map: FADE,
        color,
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
  // une flaque de lumière : forte côté u = 1, nulle côté u = 0
  const [dc, dg] = toile(128, 32)
  const dgr = dg.createLinearGradient(0, 0, 128, 0)
  dgr.addColorStop(0, 'rgba(255,255,255,0)')
  dgr.addColorStop(1, 'rgba(255,255,255,1)')
  dg.fillStyle = dgr
  dg.fillRect(0, 0, 128, 32)
  const DEGRADE = tex(dc)

  // Un tag : contour, remplissage, coulures, coeur blanc — le style de l'image.
  function tag(
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
    halo = 0.4
  ): number {
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
    g.shadowBlur = size * halo
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
    return w
  }

  // ---------- L'AVENUE (le décor se répète tous les 35 m et glisse vers nous : c'est la marche) ----------
  const P = 35
  const L = 140
  const Z0 = 10 - L
  const decor = new THREE.Group()
  scene.add(decor)
  // les vitrines du rez-de-chaussée : [début dans la travée (m), largeur (m), couleur de la lumière]
  const VITRINES: [number, number, string][] = [
    [3, 6, '#ff4fb0'],
    [22, 5, '#2ee8ff']
  ]
  function facade(): THREE.CanvasTexture {
    const W2 = 2048
    const H2 = 1404
    const m = W2 / P
    const [c, g] = toile(W2, H2)
    const Y = (h: number): number => H2 - h * m
    g.fillStyle = '#120d18'
    g.fillRect(0, 0, W2, H2)
    for (let i = 0; i < 5000; i++) {
      g.fillStyle = 'rgba(' + (rnd() < 0.5 ? '40,30,60' : '0,0,0') + ',' + rnd() * 0.3 + ')'
      g.fillRect(rnd() * W2, rnd() * H2, 2 + rnd() * 30, 2 + rnd() * 20)
    }
    // les étages : dalles, fenêtres éclairées ou non, silhouettes, climatiseurs
    for (let et = 0; et < 6; et++) {
      const y0 = 5.2 + et * 3.1
      g.fillStyle = 'rgba(0,0,0,.6)'
      g.fillRect(0, Y(y0), W2, 9)
      for (let k = 0; k < 12; k++) {
        const x = 30 + (k * (W2 - 60)) / 12 + (et % 2) * 12
        const w = 95
        const h = 1.7 * m
        const yy = Y(y0 + 2.3)
        const r = rnd()
        g.fillStyle =
          r < 0.5
            ? '#08070c'
            : ['#ffd9a8', '#ff8fd0', '#9fb6ff', '#ffe2b8', '#2ee8ff', '#ffb878'][
                Math.floor(rnd() * 6)
              ]
        g.fillRect(x, yy, w, h)
        if (r >= 0.5) {
          g.fillStyle = 'rgba(10,6,16,.55)'
          g.fillRect(x, yy, w * (0.2 + rnd() * 0.5), h)
          if (rnd() < 0.3) {
            g.fillStyle = 'rgba(10,6,16,.85)'
            g.beginPath()
            g.ellipse(x + w * 0.7, yy + h * 0.5, 9, 15, 0, 0, Math.PI * 2)
            g.fill()
            g.fillRect(x + w * 0.7 - 15, yy + h * 0.66, 30, h * 0.34)
          }
        }
        g.strokeStyle = '#050407'
        g.lineWidth = 5
        g.strokeRect(x, yy, w, h)
        g.beginPath()
        g.moveTo(x + w / 2, yy)
        g.lineTo(x + w / 2, yy + h)
        g.stroke()
        if (rnd() < 0.22) {
          g.fillStyle = '#1e1a26'
          g.fillRect(x + 12, Y(y0 + 0.75), 62, 0.55 * m)
          g.fillStyle = '#0c0a10'
          g.fillRect(x + 18, Y(y0 + 0.65), 48, 6)
        }
      }
    }
    // le rez-de-chaussée : rideaux de fer tagués et vitrines éclairées
    g.fillStyle = '#0d0a12'
    g.fillRect(0, Y(4.8), W2, 4.8 * m)
    for (let y = 0.3; y < 4.2; y += 0.09) {
      g.fillStyle = 'rgba(255,255,255,.03)'
      g.fillRect(0, Y(y), W2, 2)
      g.fillStyle = 'rgba(0,0,0,.4)'
      g.fillRect(0, Y(y) + 3, W2, 2)
    }
    VITRINES.forEach(([u, w, col]) => {
      const x = u * m
      const gr = g.createLinearGradient(0, Y(4), 0, Y(0.3))
      gr.addColorStop(0, col)
      gr.addColorStop(1, '#ffffff')
      g.fillStyle = gr
      g.fillRect(x, Y(4), w * m, 3.7 * m)
      // présentoirs et silhouettes dans la vitrine
      g.fillStyle = 'rgba(12,8,18,.75)'
      for (let k = 0; k < 4; k++)
        g.fillRect(x + 20 + (k * (w * m - 40)) / 4, Y(1.4), (w * m) / 5, 0.12 * m)
      g.fillRect(x + w * m * 0.3, Y(2.6), 22, 1.8 * m)
      g.beginPath()
      g.ellipse(x + w * m * 0.3 + 11, Y(2.75), 13, 18, 0, 0, Math.PI * 2)
      g.fill()
      g.strokeStyle = '#06040a'
      g.lineWidth = 10
      g.strokeRect(x, Y(4), w * m, 3.7 * m)
      // enseigne au-dessus de la vitrine
      g.font = 'bold 70px Bahnschrift'
      g.textAlign = 'center'
      g.shadowColor = col
      g.shadowBlur = 25
      g.fillStyle = col
      g.fillText(u < 10 ? 'KISSATEN' : 'PHONE · REPAIR', x + (w * m) / 2, Y(4.25))
      g.shadowBlur = 0
    })
    g.globalAlpha = 0.2
    for (let i = 0; i < 10; i++)
      tag(
        g,
        ['AW', 'OS', 'RUN', 'SCOUT', 'X'][i % 5],
        rnd() * W2,
        Y(1 + rnd() * 3),
        70 + rnd() * 70,
        '#8fa8ff',
        '#5b3c8a',
        'Ink Free',
        (rnd() - 0.5) * 0.4
      )
    g.globalAlpha = 1
    tag(g, 'AUTOWIN', 13.5 * m, Y(1.3), 125, '#2ee8ff', '#ff2fa0', 'Impact')
    tag(g, 'OS', 19.8 * m, Y(1.5), 120, '#3c6eeb', '#8fa8ff', 'Impact')
    tag(g, 'noir holo', 31 * m, Y(1.5), 92, '#ff2fa0', '#2ee8ff', 'Ink Free')
    tag(g, 'scout', 1.5 * m, Y(2.2), 60, '#2ee8ff', '#ffffff', 'Ink Free')
    tag(g, 'JUDGE', 13 * m, Y(3.5), 70, '#e63ca0', '#ff6bb5', 'Impact', 0.05, 4)
    const t = tex(c)
    t.wrapS = THREE.RepeatWrapping
    t.repeat.set(L / P, 1)
    return t
  }
  {
    const t = facade()
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(L, 24),
      new THREE.MeshStandardMaterial({
        map: t,
        emissiveMap: t,
        emissive: 0xffffff,
        emissiveIntensity: 0.9,
        roughness: 0.9
      })
    )
    m.position.set(FACADE, 12, 10 - L / 2)
    m.rotation.y = -Math.PI / 2
    decor.add(m)
  }
  // la chaussée : asphalte mouillé, lignes, et les trottoirs carrelés avec leurs bordures
  {
    const [c, g] = toile(512, 1024)
    g.fillStyle = '#1a1820'
    g.fillRect(0, 0, 512, 1024)
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = (rnd() < 0.5 ? 'rgba(0,0,0,' : 'rgba(90,80,110,') + rnd() * 0.25 + ')'
      g.fillRect(rnd() * 512, rnd() * 1024, 1 + rnd() * 4, 1 + rnd() * 4)
    }
    for (let i = 0; i < 12; i++) {
      g.fillStyle = 'rgba(0,0,0,.35)'
      g.beginPath()
      g.ellipse(
        rnd() * 512,
        rnd() * 1024,
        20 + rnd() * 60,
        10 + rnd() * 40,
        rnd() * 3,
        0,
        Math.PI * 2
      )
      g.fill()
    }
    g.fillStyle = 'rgba(230,226,240,.75)'
    for (let y = 0; y < 1024; y += 384) g.fillRect(252, y, 8, 192)
    g.fillRect(24, 0, 7, 1024)
    g.fillRect(481, 0, 7, 1024)
    const t = tex(c)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(1, L / 16)
    const route = new THREE.Mesh(
      new THREE.PlaneGeometry(ROUTE * 2, L),
      new THREE.MeshStandardMaterial({ map: t, color: 0x8a8296, roughness: 0.14, metalness: 0.7 })
    )
    route.rotation.x = -Math.PI / 2
    route.position.z = 10 - L / 2
    decor.add(route)
  }
  {
    const [c, g] = toile(256, 256)
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const v = 38 + rnd() * 14
        g.fillStyle = 'rgb(' + v + ',' + (v - 6) + ',' + (v + 8) + ')'
        g.fillRect(i * 64, j * 64, 64, 64)
      }
    }
    g.strokeStyle = 'rgba(0,0,0,.6)'
    g.lineWidth = 3
    for (let i = 0; i <= 4; i++) {
      g.beginPath()
      g.moveTo(i * 64, 0)
      g.lineTo(i * 64, 256)
      g.moveTo(0, i * 64)
      g.lineTo(256, i * 64)
      g.stroke()
    }
    for (let i = 0; i < 2500; i++) {
      g.fillStyle = 'rgba(0,0,0,' + rnd() * 0.25 + ')'
      g.fillRect(rnd() * 256, rnd() * 256, 2, 2)
    }
    const bordure = new THREE.MeshStandardMaterial({
      color: 0x35303e,
      roughness: 0.4,
      metalness: 0.3
    })
    for (const [x0, x1] of [
      [ROUTE, FACADE],
      [GARDE - 0.25, -ROUTE]
    ]) {
      const t = tex(c)
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.repeat.set((x1 - x0) / 2, L / 2)
      const dalle = new THREE.Mesh(
        new THREE.PlaneGeometry(x1 - x0, L),
        new THREE.MeshStandardMaterial({
          map: t,
          color: 0x9a92a8,
          roughness: 0.28,
          metalness: 0.45
        })
      )
      dalle.rotation.x = -Math.PI / 2
      dalle.position.set((x0 + x1) / 2, TROTTOIR, 10 - L / 2)
      decor.add(dalle)
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.24, TROTTOIR + 0.02, L), bordure)
      b.position.set(
        x0 > 0 ? ROUTE + 0.12 : -ROUTE - 0.12,
        (TROTTOIR + 0.02) / 2 - 0.01,
        10 - L / 2
      )
      decor.add(b)
    }
    // la tranche de la corniche, sous la rambarde
    const tranche = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 1.6, L),
      new THREE.MeshStandardMaterial({ color: 0x0e0c12, roughness: 0.8 })
    )
    tranche.position.set(GARDE - 0.4, TROTTOIR - 0.8, 10 - L / 2)
    decor.add(tranche)
  }
  // la rambarde côté ville : poteaux, mains courantes, verre, filet néon
  {
    const metal = new THREE.MeshStandardMaterial({
      color: 0x1c1a24,
      metalness: 0.85,
      roughness: 0.32
    })
    const poteaux = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 1.1, 0.06), metal, L / 2)
    const m4 = new THREE.Matrix4()
    for (let i = 0; i < L / 2; i++) {
      m4.makeTranslation(GARDE, TROTTOIR + 0.55, Z0 + i * 2)
      poteaux.setMatrixAt(i, m4)
    }
    decor.add(poteaux)
    for (const y of [1.1, 0.55]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, L), metal)
      r.position.set(GARDE, TROTTOIR + y, 10 - L / 2)
      decor.add(r)
    }
    const neon = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.025, L),
      new THREE.MeshBasicMaterial({ color: 0x2ee8ff })
    )
    neon.position.set(GARDE + 0.06, TROTTOIR + 1.04, 10 - L / 2)
    decor.add(neon)
    const verre = new THREE.Mesh(
      new THREE.PlaneGeometry(L, 1.0),
      new THREE.MeshBasicMaterial({
        color: 0xa8c0ff,
        transparent: true,
        opacity: 0.05,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    )
    verre.rotation.y = Math.PI / 2
    verre.position.set(GARDE, TROTTOIR + 0.55, 10 - L / 2)
    decor.add(verre)
  }
  // les réverbères côté rambarde : mât, bras, halo, cône de lumière dans la pluie, flaque de lumière au sol
  const CONE_MAT = new THREE.ShaderMaterial({
    uniforms: { uC: { value: new THREE.Color(0xffd2a8) }, uI: { value: 1 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader:
      'varying float vT;varying vec3 vN;varying vec3 vV;void main(){vT=uv.y;vec4 mv=modelViewMatrix*vec4(position,1.0);vN=normalize(normalMatrix*normal);vV=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}',
    fragmentShader:
      'uniform vec3 uC;uniform float uI;varying float vT;varying vec3 vN;varying vec3 vV;void main(){float a=pow(vT,1.6)*pow(abs(dot(vN,vV)),1.4)*0.16*uI;gl_FragColor=vec4(uC*a,1.0);}'
  })
  const reverberes: THREE.PointLight[] = []
  {
    const metal = new THREE.MeshStandardMaterial({
      color: 0x15131b,
      metalness: 0.8,
      roughness: 0.4
    })
    for (let rep = 0; rep < 4; rep++) {
      for (const j of [0, 1]) {
        const z = Z0 + rep * P + j * 17.5 + 8
        const mat = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 6.4, 8), metal)
        mat.position.set(GARDE + 0.05, TROTTOIR + 3.2, z)
        decor.add(mat)
        const bras = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.07, 0.07), metal)
        bras.position.set(GARDE + 1.45, TROTTOIR + 6.3, z)
        decor.add(bras)
        const tete = new THREE.Mesh(
          new THREE.BoxGeometry(0.55, 0.09, 0.2),
          new THREE.MeshBasicMaterial({ color: 0xfff0dc })
        )
        tete.position.set(GARDE + 2.85, TROTTOIR + 6.24, z)
        decor.add(tete)
        glow(0xffd2a8, 2.6, GARDE + 2.85, TROTTOIR + 6.1, z, 0.9, decor)
        const cone = new THREE.Mesh(new THREE.ConeGeometry(2.6, 6.1, 28, 1, true), CONE_MAT)
        cone.position.set(GARDE + 2.85, TROTTOIR + 3.1, z)
        decor.add(cone)
        for (const [cx, w, y, op] of [
          [-5.6, 3.2, TROTTOIR + 0.012, 0.28],
          [-2.8, 2.4, 0.012, 0.18]
        ]) {
          const f = new THREE.Mesh(
            new THREE.PlaneGeometry(w, 6),
            new THREE.MeshBasicMaterial({
              map: GLOW,
              color: 0xffb98a,
              transparent: true,
              opacity: op,
              blending: THREE.AdditiveBlending,
              depthWrite: false
            })
          )
          f.rotation.x = -Math.PI / 2
          f.position.set(cx, y, z)
          decor.add(f)
        }
        if (rep < 1) {
          const l = new THREE.PointLight(0xffc89a, 16, 14, 2)
          l.position.set(GARDE + 2.6, TROTTOIR + 5.6, z)
          decor.add(l)
          reverberes.push(l)
        }
      }
    }
  }
  // la lumière des vitrines déborde sur le trottoir mouillé
  for (let rep = 0; rep < 4; rep++) {
    VITRINES.forEach(([u, w, col]) => {
      const f = new THREE.Mesh(
        new THREE.PlaneGeometry(3.4, w + 1),
        new THREE.MeshBasicMaterial({
          map: DEGRADE,
          color: col,
          transparent: true,
          opacity: 0.35,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
      )
      f.rotation.x = -Math.PI / 2
      f.position.set(FACADE - 1.7, TROTTOIR + 0.014, Z0 + rep * P + u + w / 2)
      decor.add(f)
    })
  }

  // les enseignes en drapeau sur la façade
  const motifs = [0, 1, 2, 3].map((i) => ({
    z: 4 + i * 8.6 + rnd() * 1.5,
    y: 5.2 + rnd() * 2.6,
    c: ['#ff2fa0', '#2ee8ff', '#8fa8ff', '#e63ca0'][i],
    ph: rnd() * 10
  }))
  const MOTS_ENSEIGNES = ['BAR', 'HOTEL', 'RAMEN', '24H']
  const TEX_ENSEIGNES = motifs.map((m, i) => {
    const [c, g] = toile(128, 512)
    g.fillStyle = '#0a0710'
    g.fillRect(0, 0, 128, 512)
    g.shadowColor = m.c
    g.shadowBlur = 14
    g.strokeStyle = m.c
    g.lineWidth = 6
    g.strokeRect(10, 10, 108, 492)
    g.font = 'bold 84px Bahnschrift'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    const mot = MOTS_ENSEIGNES[i]
    const pas = 470 / mot.length
    mot.split('').forEach((l, k) => {
      g.shadowBlur = 18
      g.fillStyle = m.c
      g.fillText(l, 64, 22 + pas * (k + 0.5))
      g.shadowBlur = 0
      g.fillStyle = 'rgba(255,255,255,.55)'
      g.fillText(l, 64, 22 + pas * (k + 0.5))
    })
    return tex(c)
  })
  const potence = new THREE.MeshBasicMaterial({ color: 0x050407 })
  const enseignes: Enseigne[] = []
  for (let rep = 0; rep < 4; rep++) {
    motifs.forEach((m, i) => {
      const z = Z0 + rep * P + m.z
      const col = new THREE.Color(m.c)
      const box = new THREE.Mesh(
        new THREE.PlaneGeometry(0.8, 3.2),
        new THREE.MeshBasicMaterial({ map: TEX_ENSEIGNES[i], side: THREE.DoubleSide })
      )
      box.position.set(FACADE - 0.55, m.y, z)
      decor.add(box)
      const bras = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.06), potence)
      bras.position.set(FACADE - 0.3, m.y + 1.55, z)
      decor.add(bras)
      const halo = glow(col, 4.8, FACADE - 0.7, m.y, z, 0.7, decor)
      let lum: THREE.PointLight | null = null
      if (rep === 0 && i < 2) {
        lum = new THREE.PointLight(col, 30, 15, 2)
        lum.position.set(FACADE - 1.3, m.y, z)
        decor.add(lum)
      }
      const reflet = trainee(col, 0.7, 10, 0.35, decor)
      reflet.position.set(FACADE - 3.2, 0.015, z + 4.6)
      enseignes.push({ box, halo, lum, reflet, col, ph: m.ph, i, cote: 1 })
    })
  }
  // l'éclairage d'ambiance de la rue : violet d'en haut, bitume mouillé d'en bas
  scene.add(new THREE.HemisphereLight(0x6a4a9a, 0x1a0f24, 1.0))

  // pluie (autour de nous ; redouble pendant l'orage)
  const N = 3400
  const pos = new Float32Array(N * 6)
  const aBout = new Float32Array(N * 2)
  for (let i = 0; i < N; i++) {
    const x = -8.5 + rnd() * 16.5
    const y = rnd() * 14
    const z = 10 - rnd() * 34
    pos.set([x, y, z, x, y, z], i * 6)
    aBout[i * 2 + 1] = 1
  }
  const pluieGeo = new THREE.BufferGeometry()
  pluieGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  pluieGeo.setAttribute('aBout', new THREE.BufferAttribute(aBout, 1))
  const pluieMat = new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uForce: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader:
      'attribute float aBout;uniform float uT;uniform float uForce;varying float vB;varying float vF;void main(){vB=aBout;vec3 p=position;p.y=mod(p.y-uT*16.0,14.0)-aBout*(0.45+0.25*uForce);p.x+=aBout*0.06*uForce;vec4 mv=modelViewMatrix*vec4(p,1.0);vF=clamp(1.0+mv.z/26.0,0.0,1.0);gl_Position=projectionMatrix*mv;}',
    fragmentShader:
      'uniform float uForce;varying float vB;varying float vF;void main(){gl_FragColor=vec4(0.75,0.82,1.0,min(0.5,0.24*uForce)*vF*(1.0-vB*0.8));}'
  })
  const pluie = new THREE.LineSegments(pluieGeo, pluieMat)
  pluie.frustumCulled = false
  scene.add(pluie)

  // vapeur des bouches d'égout et des grilles du trottoir
  const [sc, sg] = toile(128, 128)
  for (let i = 0; i < 14; i++) {
    const x = 30 + rnd() * 68
    const y = 30 + rnd() * 68
    const r = 18 + rnd() * 30
    const g2 = sg.createRadialGradient(x, y, 0, x, y, r)
    g2.addColorStop(0, 'rgba(255,255,255,.22)')
    g2.addColorStop(1, 'rgba(255,255,255,0)')
    sg.fillStyle = g2
    sg.fillRect(0, 0, 128, 128)
  }
  const FUMEE = tex(sc)
  const fumees: { s: THREE.Sprite; r: number; x: number }[] = []
  for (let i = 0; i < 7; i++) {
    const c = rnd() < 0.5 ? 0x8a3cff : 0xff3fa8
    const k = 1.8 + rnd() * 1.6
    const x = -3 + rnd() * 9
    const z = Z0 + rnd() * P
    const r = rnd() * 6
    for (let rep = 0; rep < 4; rep++) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: FUMEE,
          color: c,
          transparent: true,
          opacity: 0.32,
          depthWrite: false
        })
      )
      s.scale.set(k * 1.5, k, 1)
      s.position.set(x, k * 0.5 + 0.1, z + rep * P)
      decor.add(s)
      fumees.push({ s, r, x })
    }
  }

  // ---------- PARTICULES partagées : éclaboussures, peinture, étincelles ----------
  const PMAX = 2400
  const pPos = new Float32Array(PMAX * 3)
  const pCol = new Float32Array(PMAX * 3)
  const parts = Array.from({ length: PMAX }, () => ({
    x: 0,
    y: -50,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    vie: 0,
    max: 1,
    r: 0,
    g: 0,
    b: 0,
    grav: 0,
    rebond: 0,
    sol: 0
  }))
  let pi = 0
  function emettre(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    vie: number,
    c: THREE.Color,
    grav = 9.8,
    rebond = 0,
    sol = 0.03
  ): void {
    const q = parts[pi]
    pi = (pi + 1) % PMAX
    q.x = x
    q.y = y
    q.z = z
    q.vx = vx
    q.vy = vy
    q.vz = vz
    q.vie = q.max = vie
    q.r = c.r
    q.g = c.g
    q.b = c.b
    q.grav = grav
    q.rebond = rebond
    q.sol = sol
  }
  const pGeo = new THREE.BufferGeometry()
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3))
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3))
  const particules = new THREE.Points(
    pGeo,
    new THREE.PointsMaterial({
      size: 0.15,
      map: GLOW,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  )
  particules.frustumCulled = false
  scene.add(particules)
  function majParticules(dt: number): void {
    for (let i = 0; i < PMAX; i++) {
      const q = parts[i]
      const j = i * 3
      if (q.vie > 0) {
        q.vie -= dt
        q.vy -= q.grav * dt
        q.x += q.vx * dt
        q.y += q.vy * dt
        q.z += q.vz * dt
        if (q.rebond && q.y < q.sol) {
          q.y = q.sol
          q.vy = -q.vy * q.rebond
          q.vx *= 0.6
          q.vz *= 0.6
        }
        const k = Math.max(0, q.vie / q.max)
        pPos[j] = q.x
        pPos[j + 1] = q.y
        pPos[j + 2] = q.z
        pCol[j] = q.r * k
        pCol[j + 1] = q.g * k
        pCol[j + 2] = q.b * k
      } else {
        pCol[j] = pCol[j + 1] = pCol[j + 2] = 0
      }
    }
    pGeo.attributes.position.needsUpdate = true
    pGeo.attributes.color.needsUpdate = true
  }
  let secousse = 0
  const tmpV = new THREE.Vector3()

  // ---------- LES LIEUX DE L'ACTION (se répètent tous les 70 m) ----------
  const W = 70
  const boucle = new THREE.Group()
  scene.add(boucle)
  let decalB = 0
  // où se trouve, devant nous, la copie visible d'un lieu placé à zp dans la boucle
  const zVisible = (zp: number): number => (zp + decalB > 12 ? zp + decalB - W : zp + decalB)

  // ---------- LA VILLE EN CONTREBAS ----------
  // Fixe pendant la marche (trop loin pour bouger) : un quadrillage de rues lumineuses 95 m plus bas, plus de mille
  // tours aux fenêtres allumées et aux arêtes irisées, un centre d'affaires avec ses gratte-ciel et ses holo-panneaux,
  // des voies rapides surélevées pleines de phares, des voitures volantes, des projecteurs qui balaient les nuages.
  const SOL = -95
  const uVille = { uT: { value: 0 }, uFlash: { value: 0 } }
  const BRUME_V = new THREE.Color(0x2a1238)
  const fragHaze =
    'c=mix(c,uBrume,1.0-exp(-pow(d*0.0011,1.6)));c=mix(c,uBrume*1.3,exp(-max(vW.y+95.0,0.0)*0.05)*0.35);'

  // le ciel : noir en haut, lueur rose de la ville sur l'horizon, côté ville surtout
  const ciel = new THREE.Mesh(
    new THREE.SphereGeometry(4000, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: uVille,
      vertexShader:
        'varying vec3 vP;void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: [
        'uniform float uFlash;varying vec3 vP;',
        'void main(){vec3 d=normalize(vP);float h=d.y;',
        '  vec3 c=mix(vec3(0.07,0.025,0.11),vec3(0.006,0.004,0.014),smoothstep(-0.05,0.5,h));',
        '  float cote=smoothstep(0.5,-0.7,d.x);',
        '  c+=vec3(0.6,0.12,0.4)*exp(-abs(h+0.01)*12.0)*(0.18+0.5*cote);',
        '  c+=vec3(0.18,0.25,0.65)*exp(-abs(h-0.06)*28.0)*0.1;',
        '  c+=vec3(0.65,0.6,1.0)*uFlash*smoothstep(-0.1,0.5,h)*0.55;',
        '  gl_FragColor=vec4(c,1.0);',
        '#include <colorspace_fragment>',
        '}'
      ].join('\n')
    })
  )
  scene.add(ciel)

  // le sol de la ville : un damier de rues éclairées
  const solVille = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000),
    new THREE.ShaderMaterial({
      uniforms: { uT: uVille.uT, uBrume: { value: BRUME_V } },
      vertexShader:
        'varying vec3 vW;void main(){vec4 w=modelMatrix*vec4(position,1.0);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}',
      fragmentShader: [
        'uniform float uT;uniform vec3 uBrume;varying vec3 vW;',
        'void main(){',
        '  float d=length(vW-cameraPosition);',
        '  vec2 q=(vW.xz-vec2(-41.0,239.0))/38.0;',
        '  vec2 e=abs(fract(q+0.5)-0.5)*38.0;',
        '  float l=1.4+d*0.003;',
        '  float rue=exp(-min(e.x,e.y)/l);',
        '  vec2 id=floor(q+0.5);',
        '  float h=fract(sin(dot(id,vec2(12.9898,78.233)))*43758.5453);',
        '  vec3 c=vec3(0.025,0.014,0.035)+mix(vec3(1.0,0.5,0.22),vec3(0.95,0.3,0.75),h)*rue*0.55;',
        fragHaze,
        '  gl_FragColor=vec4(c,1.0);',
        '#include <colorspace_fragment>',
        '}'
      ].join('\n')
    })
  )
  solVille.rotation.x = -Math.PI / 2
  solVille.position.y = SOL
  scene.add(solVille)

  // les tours : une seule géométrie instanciée ; un nuanceur pose les fenêtres, le couronnement irisé et la brume
  const geoTour = new THREE.BoxGeometry(1, 1, 1)
  geoTour.translate(0, 0.5, 0)
  const matTour = new THREE.ShaderMaterial({
    uniforms: {
      uT: uVille.uT,
      uFlash: uVille.uFlash,
      uRose: { value: new THREE.Color(0xe63ca0) },
      uBleu: { value: new THREE.Color(0x3c6eeb) },
      uPerv: { value: new THREE.Color(0x8fa8ff) },
      uBrume: { value: BRUME_V }
    },
    vertexShader: [
      'varying vec3 vW;varying vec3 vN;varying vec3 vL;varying float vTop;varying float vS;',
      'void main(){',
      '  vec4 w=modelMatrix*instanceMatrix*vec4(position,1.0);',
      '  vW=w.xyz;vN=normalize(mat3(modelMatrix*instanceMatrix)*normal);vL=position;',
      '  vTop=instanceMatrix[3][1]+instanceMatrix[1][1];',
      '  vS=fract(sin(dot(instanceMatrix[3].xz,vec2(12.9898,78.233)))*43758.5453);',
      '  gl_Position=projectionMatrix*viewMatrix*w;',
      '}'
    ].join('\n'),
    fragmentShader: [
      'uniform float uT;uniform float uFlash;uniform vec3 uRose;uniform vec3 uBleu;uniform vec3 uPerv;uniform vec3 uBrume;',
      'varying vec3 vW;varying vec3 vN;varying vec3 vL;varying float vTop;varying float vS;',
      'float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
      'void main(){',
      '  vec3 N=normalize(vN);vec3 V=normalize(cameraPosition-vW);',
      '  float d=length(vW-cameraPosition);',
      '  float fr=pow(1.0-abs(dot(N,V)),3.0);',
      '  vec3 iri=mix(uRose,uBleu,0.5+0.5*sin(vW.y*0.025+vW.x*0.01+vS*6.0+uT*0.2));',
      '  vec3 c=vec3(0.012,0.009,0.02)+iri*fr*0.2;',
      '  if(abs(N.y)<0.5){',
      '    vec2 f=abs(N.x)>0.5?vec2(vW.z,vW.y):vec2(vW.x,vW.y);',
      '    vec2 cell=f*vec2(0.38,0.28);vec2 id=floor(cell);vec2 g=fract(cell);',
      '    float win=step(0.15,g.x)*step(g.x,0.85)*step(0.25,g.y)*step(g.y,0.8);',
      '    float r=h(id+vS*37.0);',
      '    float dens=0.52+0.3*vS;',
      '    vec3 wc=r>0.985?uRose*1.7:(r>0.97?uPerv*1.5:(r>0.93?vec3(0.55,0.78,1.0):vec3(1.0,0.74,0.46)));',
      '    float lumi=win*step(dens,r)*(0.8+0.2*sin(uT*0.3+r*40.0));',
      '    lumi=mix(lumi,(1.0-dens)*0.42,smoothstep(500.0,1100.0,d));',
      '    c+=lumi*wc*0.6;',
      '    c+=iri*smoothstep(4.0,0.0,vTop-vW.y)*0.8*step(0.35,vS);',
      '  } else if(N.y>0.5){',
      '    c+=iri*smoothstep(0.45,0.5,max(abs(vL.x),abs(vL.z)))*0.7;',
      '  }',
      '  c+=vec3(0.55,0.5,0.9)*uFlash*0.07;',
      fragHaze,
      '  gl_FragColor=vec4(c,1.0);',
      '#include <colorspace_fragment>',
      '}'
    ].join('\n')
  })
  const NT = 2600
  const tours = new THREE.InstancedMesh(geoTour, matTour, NT)
  const grandes: [number, number, number, number, number][] = []
  const antennes: [number, number, number][] = []
  {
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    let n = 0
    const pose = (x: number, y: number, z: number, w: number, hgt: number, d: number): void => {
      if (n >= NT) return
      m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(w, hgt, d))
      tours.setMatrixAt(n++, m4)
    }
    for (let i = 0; i < 30; i++) {
      for (let j = 0; j < 46; j++) {
        const x = -60 - 38 * i
        const z = 220 - 38 * j
        if (rnd() < 0.08 || (i === 11 && j === 23)) continue
        const dcx = Math.hypot(x + 430, z + 560)
        const centre = Math.exp(-(dcx * dcx) / (2 * 230 * 230))
        // près de la falaise, les toits restent sous nos pieds : c'est ce qui fait la vue plongeante
        const cap = 58 + (-x - 45) * 1.15
        const deux = centre < 0.3 && rnd() < 0.35
        // les tours tiennent dans 25 m : il reste 13 m de rue entre deux îlots
        for (let k = 0; k < (deux ? 2 : 1); k++) {
          const w = deux ? 10 + rnd() * 4 : 14 + rnd() * 11
          const d = 14 + rnd() * 11
          const jx = (12.5 - w / 2) * (rnd() - 0.5) * 2
          const jz = deux ? (k ? 6.5 : -6.5) : (12.5 - d / 2) * (rnd() - 0.5) * 2
          let hgt =
            14 + Math.pow(rnd(), 2.4) * 55 + centre * (30 + rnd() * 210) + (rnd() < 0.025 ? 120 : 0)
          hgt = Math.min(hgt, cap)
          pose(x + jx, SOL, z + jz, w, hgt, deux ? 10 : d)
          if (hgt > 105) {
            // retraits successifs des gratte-ciel, antenne au sommet
            pose(x + jx, SOL + hgt, z + jz, w * 0.68, hgt * 0.22, d * 0.68)
            pose(x + jx, SOL + hgt * 1.22, z + jz, w * 0.4, hgt * 0.1, d * 0.4)
            pose(x + jx, SOL + hgt * 1.32, z + jz, 1.2, 22 + rnd() * 20, 1.2)
            antennes.push([x + jx, SOL + hgt * 1.32 + 30, z + jz])
            grandes.push([x + jx, z + jz, w, d, hgt])
          }
        }
      }
    }
    // la tour-signal du centre
    pose(-478, SOL, -654, 34, 300, 34)
    pose(-478, SOL + 300, -654, 24, 70, 24)
    pose(-478, SOL + 370, -654, 13, 40, 13)
    pose(-478, SOL + 410, -654, 2, 70, 2)
    antennes.push([-478, SOL + 480, -654])
    tours.count = n
  }
  scene.add(tours)

  // les holo-panneaux du centre, tournés vers l'avenue
  const PANNEAUX = [
    ['AUTOWIN', '#ff2fa0', '#2ee8ff'],
    ['NOIR HOLO', '#2ee8ff', '#ff2fa0'],
    ['SCOUT · BUILD · JUDGE', '#8fa8ff', '#e63ca0'],
    ['ラーメン 24H', '#ffb062', '#ff2fa0'],
    ['AUTOWIN OS', '#e63ca0', '#8fa8ff'],
    ['夜 NEON', '#2ee8ff', '#8fa8ff'],
    ['AUTO · WIN', '#ff6bb5', '#2ee8ff']
  ]
  function panneau(i: number, x: number, y: number, z: number, w: number, hh: number): void {
    const [txt, a, b] = PANNEAUX[i % PANNEAUX.length]
    const [c, g] = toile(1024, 512)
    g.fillStyle = 'rgba(255,255,255,.06)'
    g.fillRect(0, 0, 1024, 512)
    g.strokeStyle = '#fff'
    g.lineWidth = 10
    g.strokeRect(14, 14, 996, 484)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    let size = 240
    g.font = 'bold ' + size + 'px Bahnschrift, Impact, sans-serif'
    while (g.measureText(txt).width > 900) {
      size -= 10
      g.font = 'bold ' + size + 'px Bahnschrift, Impact, sans-serif'
    }
    g.shadowColor = '#fff'
    g.shadowBlur = 30
    g.fillStyle = '#fff'
    g.fillText(txt, 512, 256)
    const t = new THREE.CanvasTexture(c)
    textures.push(t)
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uT: uVille.uT,
        uMap: { value: t },
        uA: { value: new THREE.Color(a) },
        uB: { value: new THREE.Color(b) },
        uP: { value: rnd() * 10 }
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      vertexShader:
        'varying vec2 vU;void main(){vU=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: [
        'uniform float uT;uniform sampler2D uMap;uniform vec3 uA;uniform vec3 uB;uniform float uP;varying vec2 vU;',
        'void main(){',
        '  float m=texture2D(uMap,vU).r;',
        '  vec3 c=mix(uA,uB,clamp(vU.x+0.3*sin(uT*0.4+uP),0.0,1.0));',
        '  float lignes=0.75+0.25*sin(vU.y*260.0-uT*5.0);',
        '  float panne=step(0.985,fract(sin(floor(uT*6.0+uP*7.0))*437.5));',
        '  float f=(0.85+0.15*sin(uT*23.0+uP))*(1.0-panne*0.8);',
        '  gl_FragColor=vec4(c*m*lignes*f*1.4,1.0);',
        '#include <colorspace_fragment>',
        '}'
      ].join('\n')
    })
    const pan = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), mat)
    pan.position.set(x, y, z)
    pan.rotation.y = Math.PI / 2
    scene.add(pan)
    glow(new THREE.Color(a), w * 1.3, x + 3, y, z, 0.12).material.fog = false
  }
  grandes.sort((a, b) => Math.hypot(a[0] + 430, a[1] + 560) - Math.hypot(b[0] + 430, b[1] + 560))
  {
    let k = 0
    for (const [x, z, w, d, hgt] of grandes) {
      if (k >= 7) break
      if (x < -800) continue
      panneau(k, x + w / 2 + 0.6, SOL + hgt * (0.55 + 0.25 * rnd()), z, d * 0.92, d * 0.46)
      k++
    }
    panneau(0, -478 + 17.6, SOL + 220, -654, 32, 16)
  }

  // les voies rapides surélevées, le long des rues, et leurs flots de phares
  const VOIES_V = [
    [
      [-79, -80, 300],
      [-79, -80, -1600]
    ],
    [
      [-1300, -76, -521],
      [-79, -76, -521]
    ],
    [
      [-573, -74, 300],
      [-573, -74, -1600]
    ],
    [
      [-1300, -72, -1053],
      [-79, -72, -1053]
    ]
  ]
  const voieMat = new THREE.MeshBasicMaterial({ color: 0x08060c })
  const lampadaires: THREE.Vector3[] = []
  const flots: {
    A: THREE.Vector3
    dir: THREE.Vector3
    lat: THREE.Vector3
    lng: number
    sens: number
    u: number
    v: number
    voie: number
  }[] = []
  VOIES_V.forEach(([a, b]) => {
    const A = new THREE.Vector3(a[0], a[1], a[2])
    const B = new THREE.Vector3(b[0], b[1], b[2])
    const lng = A.distanceTo(B)
    const tablier = new THREE.Mesh(new THREE.BoxGeometry(1, 1.4, 1), voieMat)
    tablier.scale.set(Math.abs(B.x - A.x) + 10, 1, Math.abs(B.z - A.z) + 10)
    tablier.position.copy(A).add(B).multiplyScalar(0.5)
    scene.add(tablier)
    const dir = B.clone().sub(A).normalize()
    const lat = new THREE.Vector3(-dir.z, 0, dir.x)
    for (let s = 0; s < lng; s += 14)
      for (const k of [-4.8, 4.8])
        lampadaires.push(
          A.clone()
            .addScaledVector(dir, s)
            .addScaledVector(lat, k)
            .add(new THREE.Vector3(0, 1.2, 0))
        )
    for (const sens of [-1, 1]) {
      for (let i = 0; i < 160; i++)
        flots.push({
          A,
          dir,
          lat,
          lng,
          sens,
          u: rnd(),
          v: (14 + rnd() * 10) / lng,
          voie: sens * (1.4 + (i % 2) * 2.4)
        })
    }
  })
  {
    const pl = new Float32Array(lampadaires.length * 3)
    lampadaires.forEach((q, i) => pl.set([q.x, q.y, q.z], i * 3))
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pl, 3))
    scene.add(
      new THREE.Points(
        g,
        new THREE.PointsMaterial({
          size: 1.6,
          map: GLOW,
          color: 0xffb070,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false
        })
      )
    )
  }
  const fPos = new Float32Array(flots.length * 3 * 3)
  const fCol = new Float32Array(flots.length * 3 * 3)
  {
    const blanc = new THREE.Color(0xeef4ff)
    const rouge = new THREE.Color(0xff2a4a)
    flots.forEach((f, i) => {
      const c = f.sens > 0 ? blanc : rouge
      for (let k = 0; k < 3; k++)
        fCol.set([c.r * (1 - k * 0.3), c.g * (1 - k * 0.3), c.b * (1 - k * 0.3)], (i * 3 + k) * 3)
    })
  }
  const fGeo = new THREE.BufferGeometry()
  fGeo.setAttribute('position', new THREE.BufferAttribute(fPos, 3))
  fGeo.setAttribute('color', new THREE.BufferAttribute(fCol, 3))
  const flotsPts = new THREE.Points(
    fGeo,
    new THREE.PointsMaterial({
      size: 2.2,
      map: GLOW,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false
    })
  )
  flotsPts.frustumCulled = false
  scene.add(flotsPts)
  function majFlots(t: number): void {
    flots.forEach((f, i) => {
      for (let k = 0; k < 3; k++) {
        let u = (f.u + f.sens * (t * f.v - k * 0.0025)) % 1
        if (u < 0) u += 1
        const x = f.A.x + f.dir.x * u * f.lng + f.lat.x * f.voie
        const z = f.A.z + f.dir.z * u * f.lng + f.lat.z * f.voie
        fPos.set([x, f.A.y + 1.4, z], (i * 3 + k) * 3)
      }
    })
    fGeo.attributes.position.needsUpdate = true
  }

  // les voitures volantes : des couloirs aériens au-dessus de la ville, et quelques-unes qui frôlent l'avenue
  const vols: {
    cx: number
    cz: number
    rx: number
    rz: number
    y: number
    w: number
    ph: number
    rose: boolean
  }[] = []
  for (let i = 0; i < 70; i++) {
    const proche = i < 4
    vols.push({
      cx: proche ? -60 : -150 - rnd() * 900,
      cz: proche ? -40 - rnd() * 60 : -100 - rnd() * 1100,
      rx: proche ? 260 : 120 + rnd() * 400,
      rz: proche ? 30 : 60 + rnd() * 300,
      y: proche ? 26 + rnd() * 10 : -50 + rnd() * 130,
      w: (proche ? 0.07 : 0.02 + rnd() * 0.04) * (rnd() < 0.5 ? 1 : -1),
      ph: rnd() * 7,
      rose: rnd() < 0.35
    })
  }
  const vPos = new Float32Array(vols.length * 4 * 3)
  const vCol = new Float32Array(vols.length * 4 * 3)
  vols.forEach((v, i) => {
    const c = new THREE.Color(v.rose ? 0xff4fb0 : 0xdff0ff)
    for (let k = 0; k < 4; k++)
      vCol.set([c.r * (1 - k * 0.24), c.g * (1 - k * 0.24), c.b * (1 - k * 0.24)], (i * 4 + k) * 3)
  })
  const vGeo = new THREE.BufferGeometry()
  vGeo.setAttribute('position', new THREE.BufferAttribute(vPos, 3))
  vGeo.setAttribute('color', new THREE.BufferAttribute(vCol, 3))
  const volsPts = new THREE.Points(
    vGeo,
    new THREE.PointsMaterial({
      size: 2.6,
      map: GLOW,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false
    })
  )
  volsPts.frustumCulled = false
  scene.add(volsPts)
  function majVols(t: number, densite: number): void {
    vols.forEach((v, i) => {
      const actif = i < 4 || i < 4 + 66 * densite
      for (let k = 0; k < 4; k++) {
        const a = v.ph + (t - k * 0.06) * v.w
        vPos.set(
          actif
            ? [v.cx + Math.cos(a) * v.rx, v.y + Math.sin(a * 2) * 4, v.cz + Math.sin(a) * v.rz]
            : [0, -9999, 0],
          (i * 4 + k) * 3
        )
      }
    })
    vGeo.attributes.position.needsUpdate = true
  }

  // les feux d'obstacle rouges en haut des antennes
  const aPos = new Float32Array(antennes.length * 3)
  antennes.forEach((q, i) => aPos.set(q, i * 3))
  const aGeo = new THREE.BufferGeometry()
  aGeo.setAttribute('position', new THREE.BufferAttribute(aPos, 3))
  const balises = new THREE.Points(
    aGeo,
    new THREE.PointsMaterial({
      size: 5,
      map: GLOW,
      color: 0xff2030,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false
    })
  )
  scene.add(balises)

  // les projecteurs qui balaient les nuages
  const projMat = new THREE.ShaderMaterial({
    uniforms: { uC: { value: new THREE.Color(0xb8c8ff) } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader:
      'varying float vT;varying vec3 vN;varying vec3 vV;void main(){vT=uv.y;vec4 mv=modelViewMatrix*vec4(position,1.0);vN=normalize(normalMatrix*normal);vV=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}',
    fragmentShader:
      'uniform vec3 uC;varying float vT;varying vec3 vN;varying vec3 vV;void main(){float a=(1.0-vT)*pow(abs(dot(vN,vV)),2.0)*0.12;gl_FragColor=vec4(uC*a,1.0);}'
  })
  const projecteurs = [
    [-380, -480],
    [-620, -760],
    [-300, -950],
    [-820, -380]
  ].map(([x, z], i) => {
    const g = new THREE.Group()
    g.position.set(x, SOL + 10, z)
    const c = new THREE.Mesh(new THREE.CylinderGeometry(22, 1.5, 420, 24, 1, true), projMat)
    c.position.y = 210
    g.add(c)
    scene.add(g)
    return { g, ph: i * 1.7 }
  })

  // les nuages bas, éclairés par la ville
  const nuages: THREE.Sprite[] = []
  for (let i = 0; i < 44; i++) {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: FUMEE,
        color: rnd() < 0.5 ? 0x8a3c9a : 0x3c3a8a,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false
      })
    )
    const k = 380 + rnd() * 520
    s.scale.set(k * 1.8, k * 0.55, 1)
    s.position.set(-1500 + rnd() * 1700, 150 + rnd() * 120, 300 - rnd() * 2000)
    s.material.rotation = rnd() * 6
    scene.add(s)
    nuages.push(s)
  }

  // l'éclair, au-dessus de la ville
  const eclairMat = new THREE.MeshBasicMaterial({
    color: 0xf0e6ff,
    fog: false,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  })
  let eclair: THREE.Group | null = null
  function nouvelEclair(): void {
    if (eclair) {
      scene.remove(eclair)
      eclair.traverse((o) => (o as THREE.Mesh).geometry?.dispose())
    }
    const groupe = new THREE.Group()
    eclair = groupe
    const branche = (
      x: number,
      y: number,
      z: number,
      fin: number,
      epais: number
    ): THREE.Vector3[] => {
      const pts: THREE.Vector3[] = []
      while (y > fin) {
        pts.push(new THREE.Vector3(x, y, z))
        y -= 8 + rnd() * 14
        x += (rnd() - 0.5) * 26
        z += (rnd() - 0.5) * 26
      }
      pts.push(new THREE.Vector3(x, fin, z))
      groupe.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(
            new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1),
            pts.length * 3,
            epais,
            5
          ),
          eclairMat
        )
      )
      return pts
    }
    const x = -250 - rnd() * 700
    const z = -300 - rnd() * 900
    const tronc = branche(x, 260, z, SOL + 60, 1.8)
    for (let b = 0; b < 3; b++) {
      const q = tronc[1 + Math.floor(rnd() * (tronc.length - 3))]
      branche(q.x, q.y, q.z, q.y - 40 - rnd() * 60, 0.9)
    }
    scene.add(groupe)
  }

  // ---------- LES HUMAINS : un seul corps continu par personne (maillé dans home-decor-avenue-maillage.ts) ----------
  // une seule matière pour tous : tissu mouillé (reflet satiné), liseré néon rose à gauche, cyan à droite
  // lumière d'appoint des personnages (comme au cinéma) : sans elle, un tissu sous le néon n'a plus que la couleur du néon
  const APPOINT = 0.0
  const appoint = (sh: { fragmentShader: string }, k: number): void => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * ' +
        k.toFixed(3) +
        ';'
    )
  }
  const MAT_HUMAIN = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.8,
  })
  MAT_HUMAIN.onBeforeCompile = (sh) => {
    appoint(sh, APPOINT)
    // le grain du tissu : une trame fine et des variations plus larges, accrochées au corps (elles suivent les plis)
    const ajoute = (src: string, ancre: string, lignes: string[]): string =>
      src.replace(ancre, [ancre, ...lignes].join('\n'))
    sh.vertexShader = ajoute(
      ajoute(sh.vertexShader, '#include <common>', [
        'varying vec3 vObj;',
        'attribute vec3 aEmis;',
        'varying vec3 vEmis;'
      ]),
      '#include <begin_vertex>',
      ['vObj = position;', 'vEmis = aEmis;']
    )
    let f = sh.fragmentShader
    f = ajoute(f, '#include <common>', [
      'varying vec3 vObj;',
      'varying vec3 vEmis;',
      'float h3(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}',
      'float n3(vec3 p){vec3 i=floor(p);vec3 f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z);}'
    ])
    f = ajoute(f, '#include <color_fragment>', [
      'float grain = n3(vObj * 140.0) * 0.45 + n3(vObj * 26.0) * 0.55;',
      'diffuseColor.rgb *= 0.78 + 0.44 * grain;'
    ])
    f = ajoute(f, '#include <roughnessmap_fragment>', [
      'roughnessFactor = clamp(roughnessFactor * (0.85 + 0.3 * grain), 0.3, 1.0);'
    ])
    f = ajoute(f, '#include <emissivemap_fragment>', [
      '{ vec3 nV = normalize(normal); float fr = pow(1.0 - abs(dot(nV, normalize(vViewPosition))), 6.0); totalEmissiveRadiance += mix(vec3(1.0, 0.16, 0.6), vec3(0.15, 0.85, 1.0), 0.5 + 0.5 * nV.x) * fr * 0.9; }',
      'totalEmissiveRadiance += vEmis;'
    ])
    sh.fragmentShader = f
  }
  const PEAU_FILL = (sh: { fragmentShader: string }): void => appoint(sh, APPOINT * 1.1)
  const MAT_PEAU = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.55,
  })
  MAT_PEAU.onBeforeCompile = PEAU_FILL
  // le globe de l'œil : blanc, iris brun, pupille ; vernis pour accrocher le reflet des néons
  const OEIL = ((): { geo: THREE.SphereGeometry; m: THREE.MeshStandardMaterial } => {
    const [c, g] = toile(128, 64)
    g.fillStyle = '#d9d2cc'
    g.fillRect(0, 0, 128, 64)
    for (const [r, col] of [
      [10.5, '#3a2416'],
      [7.5, '#5a3a22'],
      [3.8, '#050404']
    ] as const) {
      g.fillStyle = col
      g.beginPath()
      g.arc(32, 32, r, 0, Math.PI * 2)
      g.fill()
    }
    const t = tex(c)
    const m = new THREE.MeshStandardMaterial({
      map: t,
      roughness: 0.3,
    })
    m.onBeforeCompile = PEAU_FILL
    return { geo: new THREE.SphereGeometry(0.0118, 18, 12), m }
  })()
  // le matériel (masques, visières, cartouches) : polymère noir mat, liseré de néon par la tranche
  // sous une capuche noire, le visage n'existe plus : un creux d'ombre
  const MAT_OMBRE = new THREE.MeshBasicMaterial({ color: 0x020203 })
  const MAT_EQUIP = new THREE.MeshStandardMaterial({
    color: 0x0c0c10,
    roughness: 0.35,
    metalness: 0.4,
    side: THREE.DoubleSide
  })
  const HUMAINS: Personne[] = []

  /**
   * Ce que la scène fabrique à partir des maillages de la session : des attributs PARTAGÉS par
   * forme (comme dans le brouillon), pour n'envoyer chaque corps qu'une fois à la carte graphique.
   */
  let attributs: {
    corps: Record<
      NomForme,
      {
        position: THREE.BufferAttribute
        normal: THREE.BufferAttribute
        skinIndex: THREE.BufferAttribute
        skinWeight: THREE.BufferAttribute
        index: THREE.BufferAttribute
        zones: Uint8Array
        ao: Float32Array
      }
    >
    tetes: {
      position: THREE.BufferAttribute
      normal: THREE.BufferAttribute
      index: THREE.BufferAttribute
      ao: Float32Array
    }[]
  } | null = null
  const preparerAttributs = (m: MaillagesHumains): NonNullable<typeof attributs> => {
    const corps = {} as NonNullable<typeof attributs>['corps']
    for (const nom of Object.keys(m.corps) as NomForme[]) {
      const F = m.corps[nom]
      corps[nom] = {
        position: new THREE.BufferAttribute(F.position, 3),
        normal: new THREE.BufferAttribute(F.normal, 3),
        skinIndex: new THREE.BufferAttribute(F.skinIndex, 4),
        skinWeight: new THREE.BufferAttribute(F.skinWeight, 4),
        index: new THREE.BufferAttribute(F.index, 1),
        zones: F.zones,
        ao: F.ao
      }
    }
    const tetes = m.tetes.map((T) => ({
      position: new THREE.BufferAttribute(T.position, 3),
      normal: new THREE.BufferAttribute(T.normal, 3),
      index: new THREE.BufferAttribute(T.index, 1),
      ao: T.ao
    }))
    return { corps, tetes }
  }

  function couleursTete(
    T: { position: THREE.BufferAttribute; ao: Float32Array },
    o: Tenue
  ): Float32Array {
    const Pa = T.position.array as Float32Array
    const col = new Float32Array(Pa.length)
    const peau = new THREE.Color(o.peau),
      cheveux = new THREE.Color(o.couleurCheveux ?? 0x0d0a09)
    const levre = peau
      .clone()
      .lerp(new THREE.Color(0x8a3a40), o.femme ? 0.5 : 0.3)
      .multiplyScalar(0.8)
    const rose = new THREE.Color(0xb04a50)
    const c = new THREE.Color()
    for (let q = 0; q < Pa.length; q += 3) {
      const x = Pa[q],
        y = Pa[q + 1],
        z = Pa[q + 2],
        ax = Math.abs(x)
      c.copy(peau)
      // pommettes un peu rouges, cernes sous les yeux
      if (z > 0.055 && ax > 0.028 && ax < 0.064 && y > 1.65 && y < 1.69) c.lerp(rose, 0.14)
      if (z > 0.07 && ax > 0.016 && ax < 0.048 && y > 1.688 && y < 1.699) c.multiplyScalar(0.8)
      if (z > 0.08 && ax < 0.021 && y > 1.631 && y < 1.653) c.copy(levre)
      // sourcils arqués
      const ys = 1.731 + 0.004 * Math.cos(((ax - 0.03) / 0.026) * 1.4)
      if (
        z > 0.068 &&
        ax > 0.009 &&
        ax < 0.054 &&
        Math.abs(y - ys) < (o.femme ? 0.0028 : 0.0042) * (1.15 - ax * 9)
      )
        c.copy(cheveux)
      // barbe courte sur la mâchoire et la lèvre supérieure
      if (
        o.barbe &&
        z > -0.01 &&
        y < 1.668 &&
        !(z > 0.08 && ax < 0.021 && y > 1.631 && y < 1.653) &&
        !(y > 1.649 && ax > 0.03)
      )
        c.lerp(cheveux, 0.6)
      // cheveux (front, tempes, nuque)
      if (y > 1.758 || (z < -0.012 && y > 1.645 && !(ax > 0.066 && y < 1.722))) c.copy(cheveux)
      let k = T.ao[q / 3]
      if (o.capuche)
        k *=
          0.3 + 0.4 * lisse(y, 1.6, 1.68) * (1 - 0.6 * lisse(y, 1.71, 1.77)) * lisse(z, -0.02, 0.07)
      if (o.casquette) k *= 1 - 0.35 * lisse(y, 1.69, 1.74)
      // dark cyberpunk : la peau qui dépasse reste dans l'ombre ; sous une capuche noire, le visage disparaît
      k *= 0.42
      // cache-visage : du tissu noir de l'arête du nez au menton
      if ((o.masque === 'respirateur' || o.masque === 'visiere') && y < 1.693 && z > -0.03) {
        c.setHex(0x0e0e12)
        k = T.ao[q / 3]
      }
      col.set([c.r * k, c.g * k, c.b * k], q)
    }
    return col
  }
  // pose la tête fine et les yeux sur l'os de la tête ; appelé par personne()
  function visage(o: Tenue, osTete: THREE.Bone): THREE.Mesh[] {
    const T = attributs!.tetes[o.femme ? 1 : 0]
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', T.position)
    geo.setAttribute('normal', T.normal)
    geo.setIndex(T.index)
    geo.setAttribute('color', new THREE.BufferAttribute(couleursTete(T, o), 3))
    const m = new THREE.Mesh(geo, o.masque === 'ombre' ? MAT_OMBRE : MAT_PEAU)
    m.position.set(-REPOS[4][0], -REPOS[4][1], -REPOS[4][2])
    osTete.add(m)
    const neon = new THREE.Color(o.neon ?? '#2ee8ff')
    // l'équipement est posé dans le repère du corps au repos, puis rattaché à l'os de la tête
    const pose = <O extends THREE.Object3D>(obj: O, x: number, y: number, z: number): O => {
      obj.position.set(x - REPOS[4][0], y - REPOS[4][1], z - REPOS[4][2])
      osTete.add(obj)
      return obj
    }
    if (o.masque === 'visiere') {
      // visière : un bandeau noir qui fait le tour des yeux, une fente de lumière au milieu
      pose(
        new THREE.Mesh(
          new THREE.CylinderGeometry(0.0905, 0.0905, 0.036, 32, 1, true, -1.25, 2.5),
          MAT_EQUIP
        ),
        0,
        1.708,
        0.006
      )
      const fente = pose(
        new THREE.Mesh(
          new THREE.CylinderGeometry(0.0915, 0.0915, 0.011, 32, 1, true, -1.05, 2.1),
          new THREE.MeshBasicMaterial({
            color: neon.clone().multiplyScalar(2),
            side: THREE.DoubleSide
          })
        ),
        0,
        1.709,
        0.006
      )
      fente.renderOrder = 1
      glow(neon, 0.3, 0, 1.709 - REPOS[4][1], 0.1 - REPOS[4][2], 0.7, osTete)
    }
    if (o.masque === 'respirateur') {
      // le bord du cache-visage : un fil de néon sous les yeux
      pose(
        new THREE.Mesh(
          new THREE.CylinderGeometry(0.083, 0.083, 0.003, 32, 1, true, -1.15, 2.3),
          new THREE.MeshBasicMaterial({
            color: neon.clone().multiplyScalar(1.4),
            side: THREE.DoubleSide
          })
        ),
        0,
        1.69,
        0.024
      )
    }
    // les yeux : éteints derrière la visière ; ailleurs ils brillent dans l'ombre de la capuche
    const yeux = [-1, 1].map((s) => {
      const e = new THREE.Mesh(
        OEIL.geo,
        o.masque === 'ombre'
          ? new THREE.MeshBasicMaterial({ color: neon.clone().multiplyScalar(1.4) })
          : OEIL.m
      )
      e.position.set(s * 0.032 - REPOS[4][0], 1.706 - REPOS[4][1], 0.0755 - REPOS[4][2])
      e.visible = o.masque !== 'visiere'
      if (o.masque === 'ombre') e.scale.set(0.85, 0.55, 1)
      osTete.add(e)
      return e
    })
    if (o.masque === 'ombre')
      glow(neon, 0.12, 0, 1.706 - REPOS[4][1], 0.09 - REPOS[4][2], 0.5, osTete)
    implants(o, osTete, neon, yeux)
    return yeux
  }
  // ---------- LES IMPLANTS : des circuits de lumière posés sur la peau, un œil cybernétique ----------
  const SDF_TETES: Partial<Record<0 | 1, (x: number, y: number, z: number) => number>> = {}
  const _n = new THREE.Vector3()
  // le point de la surface du visage devant (x, y), un peu décollé le long de la normale
  function surTete(
    f: (x: number, y: number, z: number) => number,
    x: number,
    y: number,
    decolle = 0.0016
  ): THREE.Vector3 {
    let z = 0.16
    while (z > -0.06 && f(x, y, z) > 0) z -= 0.001
    const e = 0.001
    _n.set(
      f(x + e, y, z) - f(x - e, y, z),
      f(x, y + e, z) - f(x, y - e, z),
      f(x, y, z + e) - f(x, y, z - e)
    ).normalize()
    return new THREE.Vector3(x, y, z).addScaledVector(_n, decolle)
  }
  const CIRCUITS: Record<'circuit' | 'traits' | 'front', [number, number][][]> = {
    // de la tempe à la pommette, avec une branche vers l'arcade
    circuit: [
      [
        [0.072, 1.752],
        [0.074, 1.728],
        [0.068, 1.706],
        [0.052, 1.693]
      ],
      [
        [0.074, 1.728],
        [0.06, 1.738]
      ]
    ],
    // trois traits parallèles sous l'œil, comme des peintures de guerre
    traits: [
      [
        [0.022, 1.69],
        [0.05, 1.686]
      ],
      [
        [0.024, 1.682],
        [0.052, 1.677]
      ],
      [
        [0.026, 1.674],
        [0.054, 1.668]
      ]
    ],
    // une ligne du front à l'arête du nez
    front: [
      [
        [0.0, 1.765],
        [0.0, 1.735],
        [0.012, 1.722]
      ]
    ]
  }
  function implants(o: Tenue, osTete: THREE.Bone, neon: THREE.Color, yeux: THREE.Mesh[]): void {
    if (!o.implant) return
    const f = (SDF_TETES[o.femme ? 1 : 0] ??= champTete(!!o.femme))
    const mat = new THREE.MeshBasicMaterial({ color: neon.clone().multiplyScalar(1.5) })
    const rel = (v: THREE.Vector3): THREE.Vector3 =>
      v.set(v.x - REPOS[4][0], v.y - REPOS[4][1], v.z - REPOS[4][2])
    const traces = o.implant === 'oeil' ? [] : (CIRCUITS[o.implant] ?? CIRCUITS.circuit)
    for (const trace of traces) {
      const pts = trace.map(([x, y]) => rel(surTete(f, x, y)))
      const courbe = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1)
      osTete.add(new THREE.Mesh(new THREE.TubeGeometry(courbe, 20, 0.0024, 5), mat))
      for (const bout of [pts[0], pts[pts.length - 1]]) {
        const d = new THREE.Mesh(new THREE.SphereGeometry(0.0046, 8, 6), mat)
        d.position.copy(bout)
        osTete.add(d)
      }
      glow(neon, 0.09, pts[1].x, pts[1].y, pts[1].z, 0.6, osTete)
    }
    if (o.implant === 'oeil') {
      // l'œil gauche remplacé : une lentille rouge cerclée de métal, et sa lueur
      const rouge = new THREE.Color(0xff2a3c)
      const oeil = yeux[1]
      oeil.material = new THREE.MeshBasicMaterial({ color: rouge.clone().multiplyScalar(1.6) })
      const bague = new THREE.Mesh(new THREE.TorusGeometry(0.0145, 0.0026, 8, 28), MAT_EQUIP)
      bague.position.copy(oeil.position).add(_n.set(0, 0, 0.006))
      osTete.add(bague)
      const lentille = new THREE.Mesh(
        new THREE.CircleGeometry(0.0055, 20),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      )
      lentille.position.copy(oeil.position).add(_n.set(0, 0, 0.0122))
      osTete.add(lentille)
      glow(rouge, 0.09, oeil.position.x, oeil.position.y, oeil.position.z + 0.01, 0.8, osTete)
      const ligne = (
        [
          [0.05, 1.71],
          [0.068, 1.716],
          [0.074, 1.74]
        ] as const
      ).map(([x, y]) => rel(surTete(f, x, y)))
      osTete.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ligne), 16, 0.0014, 5),
          new THREE.MeshBasicMaterial({ color: rouge })
        )
      )
    }
  }
  // les paupières se ferment un instant, chacun à son rythme
  function cligner(t: number): void {
    for (const q of HUMAINS) {
      const c = (t + q.ph * 3.1) % (3.2 + q.ph * 0.5)
      const k = c < 0.13 ? 0.12 : 1
      q.yeux[0].scale.y = q.yeux[1].scale.y = k * (q.o.masque === 'ombre' ? 0.55 : 1)
    }
  }

  const _c = new THREE.Color()
  function personne(o: Tenue): Personne {
    const F = attributs!.corps[o.forme]
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', F.position)
    geo.setAttribute('normal', F.normal)
    geo.setAttribute('skinIndex', F.skinIndex)
    geo.setAttribute('skinWeight', F.skinWeight)
    geo.setIndex(F.index)
    const pal = [
      o.peau,
      o.haut ?? 0x1a1820,
      o.bas ?? 0x1a2030,
      o.chaussure ?? 0x18181c,
      o.semelle ?? 0xe6e2da,
      o.accent ?? 0x22212a,
      o.couleurCheveux ?? 0x0d0a09
    ]
    const nv = F.zones.length
    const col = new Float32Array(nv * 3)
    const PP = F.position.array as Float32Array,
      NN = F.normal.array as Float32Array
    const blouson = o.type === 'doudoune' || o.type === 'bomber' || o.type === 'manteau'
    const HC = capucheDe(o)
    const manteau = o.type === 'manteau'
    let s1 = 13 + (o.peau % 997) + ((o.haut ?? 0) % 991)
    for (let q = 0; q < nv; q++) {
      const z = F.zones[q]
      const x = PP[q * 3],
        y = PP[q * 3 + 1],
        w = PP[q * 3 + 2],
        ax = Math.abs(x)
      _c.setHex(pal[z])
      let k = F.ao[q] * (0.94 + 0.12 * ((s1 = (s1 * 16807) % 2147483647) / 2147483647))
      if (z === 0 && o.capuche && y > 1.5) k *= 0.3
      if (z === 1) {
        // fermeture éclair, cordons de capuche, bandes sur les manches, bord-côte du bomber
        if (blouson && ax < 0.008 && w > 0.05 && y > 0.92 && y < 1.5) _c.setHex(0xa8a8b0)
        if (o.capuche && w > 0.06 && Math.abs(ax - 0.045) < 0.006 && y > 1.3 && y < 1.47)
          _c.setHex(0xe8e4dc)
        if (o.bandes && ax > 0.2 && y < 1.44 && NN[q * 3] * Math.sign(x) > 0.82) _c.setHex(0xeeeae2)
        if (o.type === 'bomber' && ((y < 0.985 && ax < 0.25) || (ax > 0.31 && y < 1.0))) k *= 0.55
        // l'intérieur de la capuche reste dans l'ombre
        if (
          o.capuche &&
          y > 1.55 &&
          ((x - HC.oc[0]) / HC.or[0]) ** 2 +
            ((y - HC.oc[1]) / HC.or[1]) ** 2 +
            ((w - HC.oc[2]) / HC.or[2]) ** 2 <
            1.25
        )
          k *= 0.35
      }
      // le jean blanchit sur le devant des cuisses
      if (z === 2 && o.jean === 'slim' && NN[q * 3 + 2] > 0.5 && y > 0.45) k *= 1.18
      col.set([_c.r * k, _c.g * k, _c.b * k], q * 3)
    }
    // les liserés de néon cousus dans les vêtements : fermeture, bas de veste, bande de manche, genouillère, semelle
    const emis = new Float32Array(nv * 3)
    const nc = new THREE.Color(o.neon ?? '#2ee8ff')
    for (let q = 0; q < nv; q++) {
      const z = F.zones[q]
      const x = PP[q * 3],
        y = PP[q * 3 + 1],
        w = PP[q * 3 + 2],
        ax = Math.abs(x)
      let e = 0
      if (z === 1 && ax < 0.006 && w > 0.05 && y > (manteau ? 0.38 : 0.95) && y < 1.42) e = 1
      if (
        z === 1 &&
        !manteau &&
        ax < 0.24 &&
        Math.abs(y - (o.type === 'sweat' ? 0.9 : 0.95)) < 0.008
      )
        e = 0.8
      // manteau : ourlet lumineux en bas des pans, et le bord du col montant
      if (z === 1 && manteau && y < 0.4 && NN[q * 3 + 1] > -0.7) e = 1
      if (z === 1 && manteau && Math.abs(y - 1.578) < 0.008 && ax < 0.1) e = 0.9
      // capuche : un liseré néon tout autour de l'ouverture
      if (z === 1 && o.lisere && o.capuche && y > 1.55) {
        const ev =
          ((x - HC.oc[0]) / HC.or[0]) ** 2 +
          ((y - HC.oc[1]) / HC.or[1]) ** 2 +
          ((w - HC.oc[2]) / HC.or[2]) ** 2
        if (ev > 0.98 && ev < 1.3 && w > HC.oc[2] - HC.or[2] * 0.55) e = 1.1
      }
      // implant au poignet : un anneau de lumière à la naissance de la main
      if (z === 0 && o.implant && y > 0.952 && y < 0.972 && ax > 0.3) e = 1
      if (z === 2 && x > 0 && Math.abs(y - 0.5) < 0.01) e = 0.9
      if (z === 4 && NN[q * 3 + 1] < 0.5) e = 0.55
      emis.set([nc.r * e * 1.3, nc.g * e * 1.3, nc.b * e * 1.3], q * 3)
    }
    geo.setAttribute('aEmis', new THREE.BufferAttribute(emis, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    const mesh = new THREE.SkinnedMesh(geo, MAT_HUMAIN)
    const os = NOMS_OS.map(() => new THREE.Bone())
    os.forEach((b, i) => {
      const r = REPOS[i]
      const parent = PARENT_OS[i]
      if (parent < 0) b.position.set(r[0], r[1], r[2])
      else {
        b.position.set(r[0] - REPOS[parent][0], r[1] - REPOS[parent][1], r[2] - REPOS[parent][2])
        os[parent].add(b)
      }
    })
    mesh.add(os[0])
    mesh.updateMatrixWorld(true)
    mesh.bind(new THREE.Skeleton(os))
    mesh.frustumCulled = false
    const racine = new THREE.Group()
    racine.add(mesh)
    racine.scale.setScalar(o.taille ?? 1)
    const B: OsPersonne = {
      hanches: os[0],
      ventre: os[1],
      poitrine: os[2],
      cou: os[3],
      tete: os[4],
      bras: [os[5], os[8]],
      avant: [os[6], os[9]],
      main: [os[7], os[10]],
      cuisse: [os[11], os[14]],
      mollet: [os[12], os[15]],
      pied: [os[13], os[16]]
    }
    // ombre au sol
    const ombre = new THREE.Mesh(
      new THREE.PlaneGeometry(0.95, 0.95).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        map: GLOW,
        color: 0x000000,
        transparent: true,
        opacity: 0.55,
        depthWrite: false
      })
    )
    ombre.position.y = 0.012
    racine.add(ombre)
    const q: Personne = {
      racine,
      mesh,
      os: B,
      o,
      ph: rnd() * 6,
      taille: o.taille ?? 1,
      yeux: visage(o, os[4])
    }
    HUMAINS.push(q)
    return q
  }

  // ---------- LE MÉTRO AÉRIEN : son viaduc traverse l'avenue et file au-dessus du vide ----------
  const PONT = -5
  {
    const beton = new THREE.MeshStandardMaterial({ color: 0x0d0b12, roughness: 0.8 })
    for (const dz of [0, -W, -2 * W]) {
      const g = new THREE.Group()
      g.position.z = PONT + dz
      const pont = new THREE.Mesh(new THREE.BoxGeometry(FACADE + 230, 1.3, 3.2), beton)
      pont.position.set((FACADE - 230) / 2, 10.2, 0)
      g.add(pont)
      for (const x of [-38, -120, -205]) {
        const pile = new THREE.Mesh(new THREE.BoxGeometry(2.4, 10.2 - SOL, 2.4), beton)
        pile.position.set(x, (10.2 + SOL) / 2, 0)
        g.add(pile)
      }
      const trou = new THREE.Mesh(
        new THREE.PlaneGeometry(3.6, 3.9),
        new THREE.MeshBasicMaterial({ color: 0x000000 })
      )
      trou.position.set(FACADE - 0.03, 12.15, 0)
      trou.rotation.y = -Math.PI / 2
      g.add(trou)
      for (let x = -6; x <= 6; x += 2) glow(0xffc27a, 0.9, x, 9.45, 0, 0.9, g)
      boucle.add(g)
    }
  }
  const [wc, wg] = toile(512, 128)
  wg.fillStyle = '#07060b'
  wg.fillRect(0, 0, 512, 128)
  for (let i = 0; i < 10; i++) {
    wg.fillStyle = ['#ffd9a8', '#ff8fd0', '#9fb6ff', '#ffe9c8'][i % 4]
    wg.fillRect(14 + i * 50, 30, 38, 58)
    if (rnd() < 0.6) {
      wg.fillStyle = '#120c18'
      wg.beginPath()
      wg.ellipse(24 + i * 50 + rnd() * 18, 70, 7, 12, 0, 0, Math.PI * 2)
      wg.fill()
    }
  }
  wg.fillStyle = '#ff2fa0'
  wg.fillRect(0, 10, 512, 4)
  wg.fillStyle = '#2ee8ff'
  wg.fillRect(0, 108, 512, 4)
  const fenetres = tex(wc)
  const caisseMetro = new THREE.MeshStandardMaterial({
    color: 0x14121b,
    metalness: 0.5,
    roughness: 0.5
  })
  const vitresMetro = new THREE.MeshBasicMaterial({ map: fenetres, fog: false })
  const rame = new THREE.Group()
  for (let k = 0; k < 4; k++) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(8.6, 2.5, 2.6), [
      caisseMetro,
      caisseMetro,
      caisseMetro,
      caisseMetro,
      vitresMetro,
      vitresMetro
    ])
    w.position.set(-4.3 - k * 8.9, 12, 0)
    rame.add(w)
  }
  rame.visible = false
  scene.add(rame)
  const strobes = (
    [
      [0, 0xffd9a8]
    ] as const
  ).map(([x, c]) => {
    const l = new THREE.PointLight(c, 0, 24, 2)
    l.position.set(x, 9.2, 0)
    scene.add(l)
    return l
  })
  const pantographe = glow(0x9fc8ff, 4, 0, 9.45, 0, 0)
  const ETINCELLE = new THREE.Color(0xbfe0ff)
  const train: { debut: number | null; sens: number } = { debut: null, sens: 1 }
  function metro(t: number, zb: number, v: number): void {
    rame.position.z = zb
    strobes.forEach((l) => (l.position.z = zb))
    pantographe.position.z = zb
    if (train.debut === null) {
      rame.visible = false
      strobes.forEach((l) => (l.intensity = 0))
      pantographe.material.opacity = 0
      return
    }
    const avance = (t - train.debut) * 16
    if (avance > 300) {
      train.debut = null
      return
    }
    const tete = train.sens > 0 ? -230 + avance : FACADE + 40 - avance
    rame.visible = true
    rame.rotation.y = train.sens > 0 ? 0 : Math.PI
    rame.position.x = tete
    const queue = tete - train.sens * 35.6
    const dessus = Math.min(tete, queue) < 6 && Math.max(tete, queue) > -6
    strobes.forEach(
      (l, i) => (l.intensity = dessus ? 200 * (Math.sin(tete * 2.6 + i) > 0 ? 1 : 0.15) : 0)
    )
    pantographe.material.opacity = dessus && rnd() < 0.6 ? 1 : 0
    pantographe.position.x = (rnd() - 0.5) * 8
    if (dessus) {
      for (let k = 0; k < 16; k++)
        emettre(
          (rnd() - 0.5) * 9,
          9.5,
          zb + (rnd() - 0.5) * 2.4,
          (rnd() - 0.5) * 2.4,
          rnd() * 1.5,
          (rnd() - 0.5) * 2.4 + 1 + v,
          1.6,
          ETINCELLE,
          9.8,
          0.35,
          0.03
        )
      secousse = Math.max(secousse, 0.03 * Math.max(0, 1 - Math.abs(zb) / 30))
    }
  }

  // ---------- LA CIRCULATION : on s'éloigne à droite, on vient vers nous à gauche ----------
  const profil = new THREE.Shape()
  ;[
    [-2.3, 0.25],
    [-2.36, 0.74],
    [-1.25, 0.84],
    [-0.62, 1.27],
    [0.48, 1.3],
    [1.12, 0.86],
    [2.26, 0.74],
    [2.34, 0.38],
    [2.22, 0.24]
  ].forEach(([x, y], i) => (i ? profil.lineTo(x, y) : profil.moveTo(x, y)))
  profil.closePath()
  const caisseGeo = new THREE.ExtrudeGeometry(profil, {
    depth: 1.7,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.07,
    bevelSegments: 3
  })
  caisseGeo.translate(0, 0, -0.85)
  caisseGeo.rotateY(Math.PI / 2)
  const carMat = new THREE.MeshStandardMaterial({
    color: 0x0b0b12,
    metalness: 0.75,
    roughness: 0.25
  })
  const ROUGE = new THREE.Color(0xff2046)
  const EAU = new THREE.Color(0x9fc4ff)
  function vehicule(
    moto: boolean,
    x: number,
    sens: number
  ): { g: THREE.Group; x: number; sens: number; z: number | null } {
    const g = new THREE.Group()
    if (moto) {
      const corps = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.55, 1.9), carMat)
      corps.position.y = 0.6
      g.add(corps)
      const pilote = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.45, 4, 10), carMat)
      pilote.position.set(0, 1.25, 0.2)
      pilote.rotation.x = -0.5
      g.add(pilote)
    } else g.add(new THREE.Mesh(caisseGeo, carMat))
    const larg = moto ? 0 : 0.68
    const feux = new THREE.Mesh(
      new THREE.BoxGeometry(moto ? 0.18 : 1.45, 0.07, 0.04),
      new THREE.MeshBasicMaterial({ color: ROUGE })
    )
    feux.position.set(0, moto ? 0.85 : 0.66, moto ? 0.97 : 2.42)
    g.add(feux)
    for (const s of moto ? [0] : [-1, 1]) {
      glow(ROUGE, 1.3, s * larg, feux.position.y, feux.position.z + 0.05, 1, g)
      trainee(ROUGE, 0.09, 8, 0.9, g).position.set(s * larg, feux.position.y, feux.position.z + 4)
      glow(0xeef4ff, 1.5, s * larg * 0.95, 0.62, -2.42, 1, g)
    }
    trainee(ROUGE, moto ? 0.4 : 1.4, 6, 0.55, g).position.set(0, 0.02, 4.5)
    const devant = trainee(0xdfe8ff, moto ? 0.6 : 1.6, 10, 0.4, g)
    devant.rotation.z = Math.PI
    devant.position.set(0, 0.02, -7.5)
    const phare = new THREE.SpotLight(0xdfeaff, 300, 50, 0.42, 0.5, 2)
    phare.position.set(0, 0.7, -2.3)
    phare.target.position.set(0, 0.2, -22)
    // le phare reste hors de la scène : sa lumière est peinte (halo + traînée), pas calculée
    g.add(phare.target)
    g.position.z = 600
    g.rotation.y = sens > 0 ? 0 : Math.PI
    scene.add(g)
    return { g, x, sens, z: null }
  }
  const vehicules = [vehicule(false, 2.0, 1), vehicule(true, 2.9, 1), vehicule(false, -2.0, -1)]
  function circulation(t: number, v: number): void {
    const per = p.voitures
    vehicules.forEach((ve, i) => {
      const age = (((t - (i * per) / 3) % per) + per) % per
      const z = ve.sens > 0 ? 16 - age * 22 : -170 + age * 22
      if (z < -170 || z > 18) {
        ve.g.position.z = 600
        ve.z = null
        return
      }
      ve.g.position.set(ve.x, 0, z)
      ve.z = z
      if (z < 14 && z > -60)
        for (let n = 0; n < 6; n++)
          emettre(
            ve.x + (rnd() - 0.5) * 1.3,
            0.05,
            z + ve.sens * 1.4,
            (rnd() - 0.5) * 1.6,
            1 + rnd() * 2.4,
            ve.sens * (4 + rnd() * 6) + v,
            0.55,
            EAU,
            9.8,
            0
          )
      secousse = Math.max(secousse, Math.max(0, 1 - Math.abs(z - camera.position.z) / 9) * 0.06)
    })
  }

  // ---------- LE DRONE : il fouille l'avenue au projecteur, gyrophare rouge et bleu ----------
  const drone = new THREE.Group()
  {
    const metal = new THREE.MeshStandardMaterial({
      color: 0x15131c,
      metalness: 0.6,
      roughness: 0.4
    })
    drone.add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.16, 0.7), metal))
    for (const a of [Math.PI / 4, -Math.PI / 4]) {
      const bras = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 0.08), metal)
      bras.rotation.y = a
      drone.add(bras)
    }
  }
  const helices = [
    [-0.53, -0.53],
    [0.53, -0.53],
    [-0.53, 0.53],
    [0.53, 0.53]
  ].map(([x, z]) => {
    const h = new THREE.Mesh(
      new THREE.CircleGeometry(0.3, 20),
      new THREE.MeshBasicMaterial({
        color: 0xc8d4ff,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    )
    h.rotation.x = -Math.PI / 2
    h.position.set(x, 0.1, z)
    drone.add(h)
    return h
  })
  const gyroR = new THREE.PointLight(0xff2040, 0, 18, 2)
  const gyroB = new THREE.PointLight(0x2f6bff, 0, 18, 2)
  gyroR.position.set(-0.3, -0.1, 0)
  gyroB.position.set(0.3, -0.1, 0)
  const haloR = glow(0xff2040, 1.6, -0.3, -0.05, 0, 1, drone)
  const haloB = glow(0x2f6bff, 1.6, 0.3, -0.05, 0, 1, drone)
  // un seul feu calculé : le bleu ne vit que dans son halo
  drone.add(gyroR)
  drone.scale.setScalar(1.7)
  scene.add(drone)
  const coneGeo = new THREE.ConeGeometry(2.4, 14, 36, 1, true)
  coneGeo.translate(0, -7, 0)
  coneGeo.rotateX(-Math.PI / 2)
  const faisceauMat = new THREE.ShaderMaterial({
    uniforms: { uI: { value: 1 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader:
      'varying float vT;varying vec3 vN;varying vec3 vV;void main(){vT=position.z/14.0;vec4 mv=modelViewMatrix*vec4(position,1.0);vN=normalize(normalMatrix*normal);vV=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}',
    fragmentShader:
      'uniform float uI;varying float vT;varying vec3 vN;varying vec3 vV;void main(){float a=pow(1.0-vT,1.3)*pow(abs(dot(vN,vV)),1.5)*0.45*uI;gl_FragColor=vec4(vec3(0.85,0.9,1.0)*a,1.0);}'
  })
  const faisceau = new THREE.Mesh(coneGeo, faisceauMat)
  scene.add(faisceau)
  const projecteur = new THREE.SpotLight(0xeef3ff, 0, 40, 0.17, 0.45, 2)
  scene.add(projecteur, projecteur.target)
  const tache = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 3.4),
    new THREE.MeshBasicMaterial({
      map: GLOW,
      color: 0xdfe8ff,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  )
  tache.rotation.x = -Math.PI / 2
  scene.add(tache)
  const cible = new THREE.Vector3()
  function patrouille(t: number, k: number): void {
    const z = -12 + Math.sin(t * 0.2) * 8
    drone.position.set(1.5 + Math.sin(t * 0.37) * 3, 8.2 + Math.sin(t * 1.7) * 0.15, z)
    drone.rotation.set(Math.cos(t * 0.2) * 0.12, 0, Math.cos(t * 0.37) * 0.14)
    helices.forEach((h, i) => (h.rotation.z = t * 40 * (i % 2 ? 1 : -1)))
    cible.set(1.5 + Math.sin(t * 0.8) * 5.5, TROTTOIR, z - 5 + Math.sin(t * 0.53) * 4)
    faisceau.position.copy(drone.position)
    faisceau.lookAt(cible)
    faisceauMat.uniforms.uI.value = k
    projecteur.position.copy(drone.position)
    projecteur.target.position.copy(cible)
    projecteur.intensity = 520 * k
    tache.position.set(cible.x, Math.abs(cible.x) > ROUTE ? TROTTOIR + 0.02 : 0.02, cible.z)
    tache.material.opacity = 0.5 * k
    const f = (t * 5) % 4
    const r = f < 2 && f % 0.5 < 0.25 ? 1 : 0
    const b = f >= 2 && f % 0.5 < 0.25 ? 1 : 0
    gyroR.intensity = r * 120 * k
    gyroB.intensity = b * 120 * k
    haloR.material.opacity = 0.15 + r
    haloB.material.opacity = 0.15 + b
  }

  // ---------- L'ORAGE ; et une enseigne qui claque en gerbe d'étincelles ----------
  const eclairLum = new THREE.HemisphereLight(0xcab8ff, 0x201030, 0)
  scene.add(eclairLum)
  let eclairN = -1
  function orage(t: number, periode: number): void {
    const n = Math.floor(t / periode)
    const c = t % periode
    if (n !== eclairN) {
      eclairN = n
      nouvelEclair()
    }
    const f =
      c < 0.08 ? 1 : c < 0.14 ? 0.15 : c < 0.24 ? 0.85 : c < 0.5 ? ((0.5 - c) / 0.26) * 0.4 : 0
    eclairLum.intensity = f * 5
    uVille.uFlash.value = f
    fondCourant.copy(FOND).lerp(FLASH, f * 0.5)
    brouillard.color.copy(fondCourant)
    if (eclair) eclair.visible = f > 0.1
    nuages.forEach((s) => (s.material.opacity = 0.16 + f * 0.5))
    secousse = Math.max(secousse, f * 0.05)
  }
  const ORANGE = new THREE.Color(0xffb062)
  const BLANC = new THREE.Color(0xfff2dc)
  const arc = new THREE.PointLight(0xffa860, 0, 12, 2)
  // l'arc reste hors de la scène : la gerbe d'étincelles porte l'éclair
  let gerbe = false
  let cc: Enseigne | null = null
  function courtCircuit(t: number, periode: number, v: number): void {
    const avant = gerbe
    gerbe = (t + 3) % periode < 1.6
    if (gerbe && !avant) {
      cc = null
      let meilleur = 99
      enseignes.forEach((e) => {
        if (!e.lum) return
        const z = e.box.getWorldPosition(tmpV).z
        if (z > -24 && z < -6 && Math.abs(z + 14) < meilleur) {
          meilleur = Math.abs(z + 14)
          cc = e
        }
      })
    }
    if (!gerbe) cc = null
    if (gerbe && cc) {
      const o = cc.box.getWorldPosition(new THREE.Vector3())
      for (let k = 0; k < 30; k++) {
        const col = BLANC.clone().lerp(ORANGE, rnd())
        emettre(
          o.x - 0.15,
          o.y + (rnd() - 0.5) * 0.8,
          o.z + (rnd() - 0.5) * 0.6,
          -(0.5 + rnd() * 3.5),
          (rnd() - 0.2) * 3.5,
          (rnd() - 0.5) * 3 + v,
          0.8 + rnd() * 0.9,
          col,
          9.8,
          0.4,
          TROTTOIR + 0.03
        )
      }
      arc.position.copy(o).add(new THREE.Vector3(-0.4, 0, 0))
      arc.intensity = rnd() < 0.5 ? 60 * rnd() : 0
    } else arc.intensity = 0
  }

  // ---------- LES GENS ----------
  const Z_DEAL = -25
  const Z_TAG = -45
  const Z_COUPLE = -52
  const Z_FUMEUR = -42
  const tA = new THREE.Vector3()
  const tB = new THREE.Vector3()
  // la porte de service derrière le dealer et son néon rose qui grésille (comme la photo) : elle fait partie de la rue
  const lampeDeal = new THREE.Group()
  scene.add(lampeDeal)
  /*
   * LA LUEUR DU TÉLÉPHONE DU DEALER VIT DANS LA RUE, PAS DANS SA MAIN.
   *
   * Le brouillon l'accrochait à la main. Dans le fond, la foule arrive APRÈS la rue : cette lumière
   * faisait alors passer la scène de 21 à 22 lumières ponctuelles, et three.js recompilait TOUS les
   * nuanceurs éclairés de la rue d'un seul tenant (le nombre fait partie de la clé de programme,
   * three/src/renderers/webgl/WebGLPrograms.js:473). Mesuré le 2026-10-17 dans l'instance cachée :
   * une tâche de 12,5 s à 3,45 s du chargement, moment où la foule se prépare (rapprochement par
   * l'horodatage seulement). Corrigé en même temps que la compilation en tâche de fond plus bas : la
   * part de chacune n'est pas mesurée. Le nombre de lumières reste donc le même du début à la fin ;
   * `majDeal` la pose à la main à chaque image.
   *
   * HUIT LUMIÈRES CALCULÉES, PAS VINGT-DEUX (2026-10-17, conv-301). Avec 22 lumières dans chaque
   * programme et des matières « physiques » pour la foule, la finalisation des programmes
   * (`onFirstUse` de three) prenait encore 4,7 s de fil principal : un gel de 6 à 7 s à l'ouverture
   * de l'Accueil, mesuré deux fois dans l'instance cachée. Restent dans la scène : 2 réverbères,
   * 2 enseignes, 1 strobe du métro, le feu du drone, son projecteur et le néon du deal. L'écran du
   * téléphone, la bombe du taggeur, l'arc électrique, le feu bleu et les phares gardent leur animation
   * mais ne sont plus ajoutés à la scène : leur lumière est peinte par les halos. La foule est en
   * matière « standard » (ni sheen ni vernis), un programme bien plus court.
   */
  const lueurEcran = new THREE.PointLight(0x7fdcff, 0, 1.8, 2)
  {
    const porte = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 2.3),
      new THREE.MeshStandardMaterial({ color: 0x0b0a10, roughness: 0.5, metalness: 0.6 })
    )
    porte.position.set(FACADE - 0.02, TROTTOIR + 1.15, 1.1)
    porte.rotation.y = -Math.PI / 2
    lampeDeal.add(porte)
  }
  const tubeDeal = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.05, 1.3),
    new THREE.MeshBasicMaterial({ color: 0xff4fb8 })
  )
  tubeDeal.position.set(FACADE - 0.06, TROTTOIR + 2.55, 1.1)
  lampeDeal.add(tubeDeal)
  const haloDeal = glow(0xff3fa8, 2.4, FACADE - 0.2, TROTTOIR + 2.55, 1.1, 0.8, lampeDeal)
  const lumDeal = new THREE.PointLight(0xff4fb0, 26, 7, 2)
  lumDeal.position.set(FACADE - 0.9, TROTTOIR + 2.35, 0.7)
  lampeDeal.add(lumDeal)
  function majLampeDeal(t: number, zd: number): void {
    lampeDeal.position.z = zd
    const gr = Math.sin(t * 17) > 0.93 || Math.sin(t * 0.9) > 0.985 ? 0.25 : 1
    lumDeal.intensity = 26 * gr
    haloDeal.material.opacity = 0.8 * gr
    tubeDeal.material.color.setHex(gr < 1 ? 0x3a1430 : 0xff4fb8)
  }
  // le mur du taggeur : la peinture se dessine dans une toile, plaquée sur la façade
  const [vc, vg] = toile(1024, 341)
  const [fc2, fg2] = toile(1024, 341)
  const texTag = tex(vc)
  const planTag = new THREE.Mesh(
    new THREE.PlaneGeometry(4.8, 1.6),
    new THREE.MeshBasicMaterial({ map: texTag, transparent: true, depthWrite: false })
  )
  planTag.position.set(FACADE - 0.03, TROTTOIR + 1.85, 0)
  planTag.rotation.y = -Math.PI / 2
  scene.add(planTag)
  const tg = {
    cycle: -1,
    n: 0,
    z: 0,
    ph: 0,
    mots: [
      ['AUTOWIN', 'Impact', '#2ee8ff', '#ff2fa0'],
      ['noir holo', 'Ink Free', '#ff2fa0', '#2ee8ff'],
      ['JUDGE', 'Impact', '#2ee8ff', '#ff6bb5'],
      ['SCOUT', 'Impact', '#ff2fa0', '#2ee8ff']
    ] as [string, string, string, string][],
    vg,
    fc2,
    fg2,
    t: texTag,
    plan: planTag,
    brume: glow(0xffffff, 0.9, 0, -20, 0, 0),
    lum: new THREE.PointLight(0xffffff, 0, 5, 2),
    couleur: new THREE.Color(),
    x0: 0,
    x1: 0,
    motif: null as CanvasPattern | null,
    coulures: [] as { x: number; y: number; l: number; e: number }[],
    remplissage: '#ffffff'
  }
  function preparerTag(): void {
    const [txt, font, out, fill] = tg.mots[tg.n % tg.mots.length]
    tg.fg2.clearRect(0, 0, 1024, 341)
    tg.vg.clearRect(0, 0, 1024, 341)
    let size = font === 'Impact' ? 220 : 170
    tg.fg2.font = size + 'px ' + font
    while (tg.fg2.measureText(txt).width > 760) {
      size -= 10
      tg.fg2.font = size + 'px ' + font
    }
    const w = tag(tg.fg2, txt, 512, 240, size, out, fill, font, -0.06, 0, 0.16)
    tg.x0 = 512 - w / 2 - 30
    tg.x1 = 512 + w / 2 + 30
    tg.motif = tg.vg.createPattern(tg.fc2, 'no-repeat')
    tg.coulures = Array.from({ length: 9 }, () => ({
      x: 512 + (rnd() - 0.5) * w * 0.9,
      y: 235 + rnd() * 10,
      l: 40 + rnd() * 90,
      e: 5 + rnd() * 6
    }))
    tg.remplissage = fill
    tg.couleur.set(fill)
  }
  function parapluie(couleur: string): THREE.Group {
    const pp = new THREE.Group()
    const neon = new THREE.Color(couleur)
    const manche = new THREE.Mesh(
      new THREE.CylinderGeometry(0.009, 0.009, 0.9, 8),
      new THREE.MeshBasicMaterial({ color: neon })
    )
    manche.position.y = 0.45
    pp.add(manche)
    const toileP = new THREE.Mesh(
      new THREE.SphereGeometry(0.62, 28, 8, 0, Math.PI * 2, 0, Math.PI * 0.42),
      new THREE.MeshStandardMaterial({
        color: neon.clone().lerp(new THREE.Color(0xffffff), 0.6),
        emissive: neon,
        emissiveIntensity: 0.12,
        transparent: true,
        opacity: 0.38,
        roughness: 0.1,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    )
    toileP.position.y = 0.62
    toileP.scale.y = 0.62
    pp.add(toileP)
    const bord = new THREE.Mesh(
      new THREE.TorusGeometry(0.62 * Math.sin(Math.PI * 0.42), 0.009, 6, 48),
      new THREE.MeshBasicMaterial({ color: neon })
    )
    bord.rotation.x = Math.PI / 2
    bord.position.y = 0.62 + 0.62 * 0.62 * Math.cos(Math.PI * 0.42)
    pp.add(bord)
    glow(neon, 1.4, 0, 0.8, 0, 0.55, pp)
    return pp
  }

  /**
   * LES ACTEURS, montés une fois leurs corps maillés : le dealer adossé au mur et son client, le
   * taggeur, le couple sous le parapluie, le fumeur à la rambarde, et les passants.
   */
  function monterActeurs(m: MaillagesHumains): Acteurs {
    attributs = preparerAttributs(m)
    // PAS ENCORE DANS LA SCÈNE : le groupe n'y entre qu'une fois ses nuanceurs compilés (voir `entrer`).
    const groupe = new THREE.Group()

    // LE MEC ADOSSÉ AU MUR (la photo) ET LE DEAL — cycle de 30 s : le client arrive, échange, regarde autour, repart
    const dealer = personne({
      forme: 'M',
      type: 'manteau',
      capuche: 'ample',
      lisere: true,
      cargo: true,
      haut: 0x16161a,
      bas: 0x1c1c20,
      peau: 0x8d5a3f,
      barbe: true,
      chaussure: 0x101014,
      semelle: 0x2a2a30,
      masque: 'ombre',
      neon: '#ff2fa0',
      implant: 'circuit'
    })
    const client = personne({
      forme: 'C',
      type: 'bomber',
      casquette: true,
      haut: 0x1a1a20,
      bas: 0x141418,
      jean: 'slim',
      peau: 0xdba987,
      accent: 0x1c1c22,
      couleurCheveux: 0x0a0808,
      chaussure: 0x101014,
      semelle: 0x2a2a30,
      masque: 'respirateur',
      neon: '#2ee8ff',
      implant: 'oeil'
    })
    groupe.add(dealer.racine, client.racine)
    const paquet = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.04, 0.12),
      new THREE.MeshBasicMaterial({ color: 0x8c8676 })
    )
    groupe.add(paquet)
    const ecran = new THREE.Mesh(
      new THREE.PlaneGeometry(0.07, 0.14),
      new THREE.MeshBasicMaterial({ color: 0x9fe8ff, side: THREE.DoubleSide })
    )
    dealer.os.main[0].add(ecran)
    ecran.position.set(0, -0.1, 0.05)
    ecran.rotation.x = -1.1
    const _M = new THREE.Vector3()
    const dealDecal = 0
    function majDeal(t: number, dt: number, zd: number): [number, number] {
      const c = (((t - dealDecal) % 30) + 30) % 30
      const R = dealer
      R.racine.position.set(FACADE - 0.34, TROTTOIR, zd)
      R.racine.rotation.y = -Math.PI / 2
      const k = 1 - lisse(c, 12, 13) * (1 - lisse(c, 16.5, 17.5))
      // adossé : le dos au mur, un pied à plat contre le mur, la tête baissée ; il se redresse quand le client arrive
      debout(R)
      const B = R.os
      B.hanches.rotation.x = -0.12 * k
      B.hanches.position.z = 0.05 * k
      B.poitrine.rotation.x = 0.07 * k
      B.cou.rotation.x = 0.12 * k + 0.03
      B.tete.rotation.set(0.3 * k + 0.03, Math.sin(t * 0.25) * 0.15 * k, 0)
      pied(R, 1, 0.13, 0.1, 0.12 + 0.08 * k, 0.15, 0.6, 1.5)
      pied(R, 0, -0.12, 0.1 + 0.34 * k, 0.1 - 0.36 * k, -0.15, 0.75, 1.5)
      B.pied[0].rotation.x = 0.9 * k
      const tel = lisse(c, 21, 21.8) * (1 - lisse(c, 25.5, 26.3))
      const donne = lisse(c, 13.4, 13.9) * (1 - lisse(c, 14.8, 15.3))
      mainsPoches(R, 1)
      if (tel > 0.01) {
        R.os.main[0].getWorldPosition(tA)
        R.racine.localToWorld(tB.set(-0.06, 1.24, 0.27))
        mainMonde(R, 0, tA.lerp(tB, tel), -0.4, 0.9, -0.2)
        B.tete.rotation.x += 0.25 * tel
      }
      ecran.visible = tel > 0.5
      lueurEcran.intensity = tel > 0.5 ? 2.2 : 0
      // la lueur suit l'écran, là où le brouillon l'accrochait à la main : (0, -0,05, 0,25) dans son repère
      R.os.main[0].updateWorldMatrix(true, false)
      R.os.main[0].localToWorld(lueurEcran.position.set(0, -0.05, 0.25))
      // le client
      const C = client
      const x = FACADE - 1.25
      let z: number
      let yaw: number
      let marche = 0
      if (c < 12) {
        z = zd - 17 + 16.65 * (c / 12)
        yaw = lisse(c, 11, 12) * (Math.PI / 2)
        marche = 1 - lisse(c, 11.4, 12)
      } else if (c < 17) {
        z = zd - 0.35
        yaw = Math.PI / 2 + lisse(c, 16.2, 17) * (Math.PI / 2)
      } else if (c < 29) {
        z = zd - 0.35 - 16.65 * ((c - 17) / 12)
        yaw = Math.PI
        marche = lisse(c, 17, 17.5) * (1 - lisse(c, 28.5, 29))
      } else {
        z = zd - 17
        yaw = 0
      }
      C.racine.position.set(x, TROTTOIR, z)
      C.racine.rotation.y = yaw
      if (marche > 0.02) {
        C.ph += 1.35 * ((Math.PI * 2) / 1.42) * dt
        allure(C, C.ph, marche)
      } else debout(C)
      if (c >= 12 && c < 17)
        C.os.tete.rotation.y = c > 15 && c < 16.4 ? Math.sin((c - 15) * 4.5) * 0.7 : 0
      let kp = 1
      if (c >= 12.2 && c < 13) kp = 1 - lisse(c, 12.2, 13)
      else if (c >= 13 && c < 15.6) kp = 0
      else if (c >= 15.6 && c < 16.2) kp = lisse(c, 15.6, 16.2)
      mainsPoches(C, kp)
      // l'échange : les deux mains se rejoignent, le paquet change de main
      if (donne > 0.01) {
        _M.set((R.racine.position.x + C.racine.position.x) / 2, TROTTOIR + 1.05, zd + 0.1)
        R.os.main[1].getWorldPosition(tA)
        mainMonde(R, 1, tA.clone().lerp(_M, donne), 0.5, 0.9, -0.2)
        C.os.main[0].getWorldPosition(tB)
        mainMonde(C, 0, tB.clone().lerp(_M, donne), -0.5, 0.9, -0.2)
      }
      paquet.visible = c > 13.6 && c < 15.4
      if (paquet.visible) {
        R.os.main[1].getWorldPosition(tA)
        C.os.main[0].getWorldPosition(tB)
        paquet.position
          .copy(tA)
          .lerp(tB, lisse(c, 14.1, 14.6))
          .add(tmpV.set(0, -0.07, 0))
      }
      return [x, z]
    }

    // LE TAGGEUR : il peint la façade à la bombe, la peinture coule, il recule pour regarder, il recommence
    const tagueur = personne({
      forme: 'E',
      type: 'sweat',
      capuche: 'ample',
      lisere: true,
      cargo: true,
      sac: true,
      haut: 0x141418,
      bas: 0x18181e,
      peau: 0x5b3a28,
      accent: 0x15141a,
      chaussure: 0x101014,
      semelle: 0x2a2a30,
      masque: 'ombre',
      neon: '#b14bff',
      implant: 'traits'
    })
    groupe.add(tagueur.racine)
    const bombe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.032, 0.032, 0.2, 12),
      new THREE.MeshStandardMaterial({ color: 0x1a1824, metalness: 0.8, roughness: 0.3 })
    )
    bombe.position.set(0, -0.1, 0.03)
    tagueur.os.main[0].add(bombe)
    const surMur = new THREE.Vector3()
    function majTagueur(t: number, dt: number, zt: number): [number, number] {
      tg.plan.position.z = zt
      tg.plan.updateMatrixWorld()
      const c = t % 14
      const n = Math.floor(t / 14)
      if (n !== tg.cycle) {
        tg.cycle = n
        tg.n = n
        preparerTag()
        tg.t.needsUpdate = true
      }
      const g = tg.vg
      const P2 = tagueur
      let recul = 0
      let cz: number
      if (c < 6) {
        const q = c / 6
        const hx = tg.x0 + (tg.x1 - tg.x0) * q
        const hy = 150 + Math.sin(c * 9) * 100
        g.fillStyle = tg.motif ?? tg.remplissage
        for (let k = 0; k < 26; k++) {
          g.beginPath()
          g.arc(hx + (rnd() - 0.5) * 30, hy + (rnd() - 0.5) * 60, 7 + rnd() * 14, 0, Math.PI * 2)
          g.fill()
        }
        g.globalAlpha = 0.1
        g.fillRect(0, 0, Math.max(0, hx - 26), 341)
        g.globalAlpha = 1
        tg.t.needsUpdate = true
        tg.plan.localToWorld(surMur.set((hx / 1024 - 0.5) * 4.8, (0.5 - hy / 341) * 1.6, 0))
        cz = surMur.z - 0.25
      } else {
        if (c < 6.1) {
          // la toile du motif, dessinée par code dans preparerTag : le tag fini est recopié d'un trait
          g.drawImage(tg.fc2, 0, 0)
          tg.t.needsUpdate = true
        }
        tg.plan.localToWorld(surMur.set(((tg.x0 + tg.x1) / 2048 - 0.5) * 4.8, 0, 0))
        cz = surMur.z
        recul = lisse(c, 8.4, 9.6) * (1 - lisse(c, 12.6, 13.8))
      }
      if (c >= 6 && c < 8.5) {
        const q = (c - 6) / 2.5
        g.strokeStyle = tg.remplissage
        g.lineCap = 'round'
        tg.coulures.forEach((d) => {
          g.lineWidth = d.e
          g.beginPath()
          g.moveTo(d.x, d.y)
          g.lineTo(d.x, d.y + d.l * q)
          g.stroke()
        })
        tg.t.needsUpdate = true
      }
      tg.plan.material.opacity = c > 12 ? Math.max(0, (14 - c) / 2) : 1
      const avant = tg.z
      tg.z += (cz - tg.z) * Math.min(1, dt * 4)
      const vit = Math.abs(tg.z - avant) / Math.max(dt, 1e-3)
      tg.ph += vit * dt * 7
      P2.racine.position.set(FACADE - 0.62 - recul * 0.9, TROTTOIR, tg.z)
      P2.racine.rotation.y = Math.PI / 2
      debout(P2)
      // pas chassés le long du mur
      const pas = Math.min(1, vit * 1.5)
      P2.os.cuisse[0].rotation.z = 0.02 + 0.18 * pas * Math.max(0, Math.sin(tg.ph))
      P2.os.cuisse[1].rotation.z = -0.02 - 0.18 * pas * Math.max(0, -Math.sin(tg.ph))
      P2.os.hanches.position.y = 0.98 - 0.02 * pas * Math.abs(Math.sin(tg.ph))
      if (c < 6) {
        P2.os.poitrine.rotation.x = 0.06
        mainMonde(P2, 0, surMur.clone().add(tmpV.set(-0.24, -0.04, 0)), -0.5, 0.85, 0.15)
        P2.os.tete.lookAt(surMur)
        P2.racine.updateMatrixWorld(true)
        bombe.getWorldPosition(tA)
        tg.brume.position.copy(surMur).add(tmpV.set(-0.05, 0, 0))
        tg.brume.material.color.copy(tg.couleur)
        tg.brume.material.opacity = 0.7
        tg.lum.color.copy(tg.couleur)
        tg.lum.intensity = 14
        tg.lum.position.copy(surMur).add(tmpV.set(-0.7, 0.1, 0.2))
        for (let k = 0; k < 8; k++) {
          const v2 = surMur
            .clone()
            .sub(tA)
            .multiplyScalar(1 / 0.14)
          emettre(
            tA.x,
            tA.y,
            tA.z,
            v2.x + (rnd() - 0.5) * 0.8,
            v2.y + (rnd() - 0.5) * 1,
            v2.z + (rnd() - 0.5) * 1,
            0.14,
            tg.couleur,
            0,
            0
          )
        }
      } else {
        tg.brume.material.opacity = 0
        tg.lum.intensity = 0
        P2.os.tete.rotation.x = -0.08 * recul
      }
      return [P2.racine.position.x, tg.z]
    }

    // LES FIGURANTS : un couple sous un parapluie devant la vitrine, un type accoudé à la rambarde qui fume face à la ville
    const couple = [
      personne({
        forme: 'N',
        type: 'manteau',
        femme: true,
        cheveux: 'longs',
        jean: 'slim',
        haut: 0x1c1820,
        bas: 0x1c1c20,
        peau: 0x6e4632,
        taille: 0.94,
        chaussure: 0x101014,
        semelle: 0x2a2a30,
        masque: 'respirateur',
        neon: '#ff3b3b',
        implant: 'circuit'
      }),
      personne({
        forme: 'O',
        type: 'manteau',
        jean: 'slim',
        haut: 0x16161a,
        bas: 0x141418,
        peau: 0xc48a66,
        couleurCheveux: 0x0a0808,
        chaussure: 0x101014,
        semelle: 0x2a2a30,
        masque: 'visiere',
        neon: '#ff2fa0',
        implant: 'front'
      })
    ]
    couple.forEach((q) => groupe.add(q.racine))
    const parapluieCouple = parapluie('#ff2fa0')
    groupe.add(parapluieCouple)
    function majCouple(t: number, zc: number): [number, number, number][] {
      const [A, Bp] = couple
      A.racine.position.set(FACADE - 1.0, TROTTOIR, zc + 0.4)
      A.racine.rotation.y = Math.PI + 0.25
      Bp.racine.position.set(FACADE - 1.15, TROTTOIR, zc - 0.42)
      Bp.racine.rotation.y = -0.2
      debout(A, Math.sin(t * 1.3))
      debout(Bp, Math.sin(t * 1.1 + 1))
      A.os.hanches.rotation.z = 0.04
      A.os.tete.rotation.set(0.05, Math.sin(t * 0.4) * 0.1, 0)
      parapluieCouple.position.set(FACADE - 1.1, TROTTOIR + 1.18, zc)
      parapluieCouple.rotation.set(0, 0, -0.12)
      mainMonde(A, 0, tmpV.set(FACADE - 1.1, TROTTOIR + 1.26, zc), -0.5, 0.9, -0.2)
      mainsPoches(Bp, 1)
      // il parle avec les mains de temps en temps
      const parle = lisse(t % 7, 1, 1.5) * (1 - lisse(t % 7, 4, 4.6))
      if (parle > 0.01) {
        Bp.os.main[1].getWorldPosition(tA)
        Bp.racine.localToWorld(
          tB.set(0.18 + Math.sin(t * 3) * 0.05, 1.18 + Math.sin(t * 4.3) * 0.06, 0.32)
        )
        mainMonde(Bp, 1, tA.lerp(tB, parle), 0.6, 0.9, -0.3)
      }
      return [[FACADE - 1.1, zc, 1.0]]
    }
    const fumeur = personne({
      forme: 'O',
      type: 'manteau',
      jean: 'slim',
      haut: 0x1a1a20,
      bas: 0x18181e,
      peau: 0x8d5a3f,
      barbe: true,
      chaussure: 0x101014,
      semelle: 0x2a2a30,
      masque: 'respirateur',
      neon: '#2ee8ff',
      implant: 'circuit'
    })
    groupe.add(fumeur.racine)
    const braise = glow(0xff7a2a, 0.12, 0, 0, 0, 1, fumeur.os.main[1])
    braise.position.set(0.02, -0.12, 0.05)
    const bouffee = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: FUMEE,
        color: 0xb8a8d0,
        transparent: true,
        opacity: 0,
        depthWrite: false
      })
    )
    groupe.add(bouffee)
    function majFumeur(t: number, zf: number): [number, number, number][] {
      const F = fumeur
      F.racine.position.set(GARDE + 0.48, TROTTOIR, zf)
      F.racine.rotation.y = -Math.PI / 2
      debout(F, Math.sin(t))
      F.os.hanches.rotation.x = 0.16
      F.os.poitrine.rotation.x = 0.12
      F.os.tete.rotation.set(0.12, Math.sin(t * 0.2) * 0.25, 0)
      pied(F, 0, -0.12, 0.1, -0.12, -0.2, 0.6, 1.5)
      pied(F, 1, 0.1, 0.1, -0.02, 0.2, 0.6, 1.5)
      // les avant-bras posés sur la main courante
      F.racine.localToWorld(tA.set(-0.22, 1.1, 0.42))
      mainMonde(F, 0, tA, -0.6, 0.85, -0.1)
      const c = t % 9
      const bouche = lisse(c, 2, 2.8) * (1 - lisse(c, 4.2, 5))
      F.racine.localToWorld(tA.set(0.22, 1.1, 0.42))
      F.racine.localToWorld(tB.set(0.03, 1.66, 0.13))
      mainMonde(F, 1, tA.lerp(tB, bouche), 0.6, 0.9, -0.2)
      braise.material.opacity = 0.6 + 0.4 * (c > 2.8 && c < 4.2 ? 1 : 0)
      const souffle = lisse(c, 4.6, 5) * (1 - lisse(c, 5.5, 8))
      F.racine.localToWorld(tB.set(0, 1.72 + (c - 4.6) * 0.12, 0.35 + (c - 4.6) * 0.12))
      bouffee.position.copy(tB)
      bouffee.scale.setScalar(0.25 + Math.max(0, c - 4.6) * 0.18)
      bouffee.material.opacity = souffle * 0.35
      return [[GARDE + 0.48, zf, 0.7]]
    }

    // LES PASSANTS : des deux côtés, dans les deux sens ; ils s'écartent les uns des autres et contournent les figurants.
    // Le réglage « Fond d'accueil » n'en montre que les `AVENUE.passants` premiers : on ne fabrique que ceux-là.
    const TOUTES_TENUES: Tenue[] = [
      {
        forme: 'M',
        type: 'manteau',
        capuche: 'ample',
        lisere: true,
        cargo: true,
        haut: 0x141418,
        bas: 0x1c1c20,
        peau: 0xc48a66,
        poches: true,
        barbe: true,
        chaussure: 0x101014,
        semelle: 0x2a2a30,
        masque: 'ombre',
        neon: '#b14bff',
        implant: 'oeil'
      },
      {
        forme: 'N',
        type: 'manteau',
        femme: true,
        cheveux: 'longs',
        jean: 'slim',
        haut: 0x1c1820,
        bas: 0x141418,
        peau: 0x6e4632,
        taille: 0.95,
        parapluie: '#2ee8ff',
        chaussure: 0x101014,
        semelle: 0x2a2a30,
        masque: 'respirateur',
        neon: '#ff3b3b',
        implant: 'traits'
      },
      {
        forme: 'C',
        type: 'bomber',
        casquette: true,
        bandes: true,
        haut: 0x16161a,
        bas: 0x18181e,
        peau: 0xdba987,
        accent: 0x1a1a20,
        couleurCheveux: 0x0a0808,
        chaussure: 0x101014,
        semelle: 0x2a2a30,
        masque: 'visiere',
        neon: '#ff2fa0',
        implant: 'circuit'
      },
      {
        forme: 'O',
        type: 'manteau',
        jean: 'slim',
        haut: 0x1a1a20,
        bas: 0x1c1c20,
        peau: 0x8d5a3f,
        poches: true,
        chaussure: 0x101014,
        semelle: 0x2a2a30,
        masque: 'respirateur',
        neon: '#2ee8ff',
        implant: 'front'
      },
      {
        forme: 'E',
        type: 'sweat',
        capuche: 'ample',
        lisere: true,
        cargo: true,
        sac: true,
        haut: 0x141418,
        bas: 0x141418,
        peau: 0x5b3a28,
        accent: 0x3b3b44,
        taille: 1.03,
        chaussure: 0x101014,
        semelle: 0x2a2a30,
        masque: 'ombre',
        neon: '#b14bff',
        implant: 'circuit'
      },
      {
        forme: 'N',
        type: 'manteau',
        femme: true,
        cheveux: 'longs',
        jean: 'slim',
        haut: 0x1c1820,
        bas: 0x18181e,
        peau: 0xdba987,
        taille: 0.93,
        parapluie: '#ff2fa0',
        couleurCheveux: 0x0a0808,
        chaussure: 0x101014,
        semelle: 0x2a2a30,
        masque: 'respirateur',
        neon: '#ff3b3b',
        implant: 'oeil'
      },
      {
        forme: 'O',
        type: 'manteau',
        jean: 'slim',
        haut: 0x16161a,
        bas: 0x1c1c20,
        peau: 0xc48a66,
        parapluie: '#8fa8ff',
        chaussure: 0x101014,
        semelle: 0x2a2a30,
        masque: 'visiere',
        neon: '#ff2fa0',
        implant: 'traits'
      }
    ]
    const TENUES = TOUTES_TENUES.slice(0, p.passants)
    // [x de la file, sens] : à gauche on s'éloigne contre la chaussée et on vient vers nous contre la rambarde
    const FILES = [
      [-4.65, -1],
      [5.0, -1],
      [5.75, 1],
      [-6.45, 1],
      [6.55, -1],
      [4.75, 1],
      [-4.65, -1]
    ]
    const passants = TENUES.map((o, i) => {
      const q = personne(o)
      groupe.add(q.racine)
      const [x0, dir] = FILES[i]
      let pp: THREE.Group | null = null
      if (o.parapluie) {
        pp = parapluie(o.parapluie)
        q.racine.add(pp)
        pp.position.set(-0.13, 1.16, 0.2)
        pp.rotation.x = -0.12
      }
      return {
        p: q,
        o,
        pp,
        x0,
        x: x0,
        dir,
        vit: 1.1 + rnd() * 0.35,
        z: 12 - ((i * 23.7) % 78),
        ph: rnd() * 6
      }
    })
    function majPassants(dt: number, v: number, obstacles: number[][]): void {
      passants.forEach((q) => {
        q.z += (q.dir * q.vit + v) * dt
        if (q.dir < 0 && q.z < -72) q.z = 15
        if (q.dir > 0 && q.z > 16) q.z = -70
        let cibleX = q.x0
        obstacles.forEach(([ox, oz, r]) => {
          if (Math.abs(q.z - oz) < 2.2 && Math.abs(cibleX - ox) < r)
            cibleX = ox + (cibleX > ox ? r : -r)
        })
        // garder la file sur son trottoir
        cibleX =
          q.x0 < 0
            ? THREE.MathUtils.clamp(cibleX, GARDE + 0.4, -ROUTE - 0.3)
            : THREE.MathUtils.clamp(cibleX, ROUTE + 0.3, FACADE - 0.4)
        q.x += (cibleX - q.x) * Math.min(1, dt * 2.5)
        q.ph += (q.vit / 1.42) * Math.PI * 2 * dt
        q.p.racine.position.set(q.x, TROTTOIR, q.z)
        q.p.racine.rotation.y = q.dir > 0 ? 0 : Math.PI
        allure(q.p, q.ph, 1)
        if (q.o.poches) mainsPoches(q.p, 1)
        if (q.pp) {
          q.p.racine.localToWorld(tA.set(-0.13, 1.2, 0.2))
          mainMonde(q.p, 0, tA, -0.6, 0.9, -0.3)
        }
      })
    }

    return {
      groupe,
      animer(t, dt, v) {
        const zd = zVisible(Z_DEAL)
        const cl = majDeal(t, dt, zd)
        const tgp = majTagueur(t, dt, zVisible(Z_TAG))
        const obst: number[][] = [
          [FACADE - 0.4, zd, 0.8],
          [cl[0], cl[1], 0.6],
          [tgp[0], tgp[1], 0.8],
          ...majCouple(t, zVisible(Z_COUPLE)),
          ...majFumeur(t, zVisible(Z_FUMEUR)),
          [camera.position.x, camera.position.z, 0.7]
        ]
        majPassants(dt, v, obst)
        cligner(t)
      }
    }
  }

  // ---------- LE RÉGLAGE « FOND D'ACCUEIL » ----------
  let parcours = DEPART
  pluieMat.uniforms.uForce.value = p.pluie
  reverberes.forEach((l) => (l.intensity = p.sombre ? 9 : 16))
  CONE_MAT.uniforms.uI.value = p.sombre ? 0.6 : 1

  // ---------- LA FOULE ARRIVE QUAND SES CORPS SONT PRÊTS ----------
  let acteurs: Acteurs | null = null
  /** La foule montée mais pas encore entrée : à libérer aussi si la scène part avant elle. */
  let enAttente: THREE.Group | null = null
  let vivante = true
  /**
   * COMPILER EN TÂCHE DE FOND, SANS LE PIÈGE DE `compileAsync`. three r185 relit
   * `properties.get(m).currentProgram.isReady()` toutes les 10 ms ; si la scène est libérée entre-temps
   * (le décor est reconstruit quand le thème change au démarrage), `currentProgram` n'existe plus,
   * la vérification lève une TypeError non rattrapée et la promesse ne se résout JAMAIS — mesuré le
   * 2026-10-17 (conv-301, sonde de l'Accueil). Ici la vérification s'arrête avec la scène, et une
   * matière sans programme compte comme prête au lieu de faire tomber la boucle.
   */
  const compilerEnFond = (objet: THREE.Object3D, cible?: THREE.Scene): Promise<void> => {
    const materiaux = renderer.compile(objet, camera, cible ?? null) as Set<THREE.Material>
    return new Promise((ok) => {
      const verifier = (): void => {
        if (!vivante) return ok()
        for (const m of materiaux) {
          const prog = (renderer.properties.get(m) as { currentProgram?: { isReady(): boolean } }).currentProgram
          if (!prog || prog.isReady()) materiaux.delete(m)
        }
        if (materiaux.size === 0) ok()
        else setTimeout(verifier, 10)
      }
      verifier()
    })
  }
  /**
   * LA FOULE N'ENTRE QU'UNE FOIS SES NUANCEURS COMPILÉS.
   *
   * Ses matières « physiques » (tissu satiné, peau vernie, yeux, visières, parapluies) donnent cinq
   * programmes lourds à compiler. Les compiler à la première image où ils apparaissent figeait la
   * fenêtre. `compileAsync` les fait compiler en tâche de fond par le pilote graphique, et la foule
   * entre dans la scène quand ils sont prêts.
   */
  const entrer = (m: MaillagesHumains): void => {
    const prets = monterActeurs(m)
    enAttente = prets.groupe
    const montrer = (): void => {
      if (!vivante) return
      scene.add(prets.groupe)
      enAttente = null
      acteurs = prets
    }
    compilerEnFond(prets.groupe, scene).then(montrer, (erreur: unknown) => {
      // Rien n'est masqué : l'échec est écrit, et la foule entre quand même (compilée à l'affichage).
      console.error('[decor] compilation de la foule en tâche de fond impossible :', erreur)
      montrer()
    })
  }
  /**
   * LA RUE AUSSI SE COMPILE EN TÂCHE DE FOND (2026-10-17, conv-301). Seule la foule passait par
   * `compileAsync` : la première image de la rue compilait tous ses programmes d'un bloc sur le fil
   * principal (`onFirstUse` de three, 2,3 s mesurées par profil dans l'instance cachée, carte
   * RTX 3060 sous Direct3D 11, `KHR_parallel_shader_compile` présent) — un gel de 3 s à
   * l'ouverture de l'Accueil. Le pilote compile désormais pendant que la page reste vivante ; tant
   * que ce n'est pas fini, `render` ne dessine rien et le fond de la page reste visible.
   */
  let rueCompilee = false
  compilerEnFond(scene).then(
    () => {
      rueCompilee = true
    },
    (erreur: unknown) => {
      console.error('[decor] compilation de la rue en tâche de fond impossible :', erreur)
      rueCompilee = true
    }
  )
  const preparation = preparationHumains()
  const deja = preparation.avancer(0)
  let canal: MessageChannel | null = null
  if (deja) entrer(deja)
  else if (typeof MessageChannel === 'function') {
    // Un canal de messages et non `setTimeout(0)` : après quelques rappels imbriqués, le navigateur
    // impose 4 ms d'attente à chaque `setTimeout`, ce qui triplerait la durée du maillage. Entre deux
    // messages, il peint quand même ses images : la rue reste vivante pendant que la foule se prépare.
    const c = new MessageChannel()
    canal = c
    c.port1.onmessage = () => {
      if (!vivante) return
      const m = preparation.avancer(BUDGET_MAILLAGE_MS)
      if (m) {
        entrer(m)
        c.port1.close()
        canal = null
        return
      }
      c.port2.postMessage(0)
    }
    c.port2.postMessage(0)
  }

  let prevPont: number | null = null
  let pluieT = 0
  let tPrecedent: number | null = null
  const base = new THREE.Vector3(...CAMERA_AVENUE.position)
  const viseur = new THREE.Vector3(...CAMERA_AVENUE.cible)

  return {
    canvas,

    resize(largeur, hauteur) {
      if (!(largeur > 0 && hauteur > 0)) return
      const ratio = Math.min(window.devicePixelRatio || 1, PLAFOND_RATIO)
      renderer.setPixelRatio(ratio)
      renderer.setSize(largeur, hauteur, false)
      camera.aspect = largeur / hauteur
      camera.updateProjectionMatrix()
    },

    render(elapsed, look) {
      // La rue n'est dessinée qu'une fois ses programmes compilés en tâche de fond (plus bas) :
      // la dessiner avant forçait la compilation sur le fil principal, à la première image.
      if (!rueCompilee) return
      const t = elapsed + T0
      // Le pas de temps vient de l'horloge de l'appelant : ralentie sous « mouvement réduit », elle
      // ralentit toute la scène. Plafonné à 50 ms : au retour d'une fenêtre cachée, la foule ne
      // doit pas sauter de plusieurs mètres d'un coup.
      const dt = tPrecedent === null ? 0 : Math.min(0.05, Math.max(0, t - tPrecedent))
      tPrecedent = t
      const v = p.vitesse
      parcours += v * dt
      decor.position.z = parcours % P
      decalB = parcours % W
      boucle.position.z = decalB
      decor.updateMatrixWorld(true)
      boucle.updateMatrixWorld(true)
      secousse = 0
      pluieT += dt * p.pluie
      pluieMat.uniforms.uT.value = pluieT
      uVille.uT.value = t

      const zb = zVisible(PONT)
      if (prevPont !== null && prevPont < -30 && zb >= -30) {
        train.debut = t
        train.sens = -train.sens
      }
      prevPont = zb

      circulation(t, v)
      patrouille(t, p.sombre ? 0.55 : 1)
      orage(t, p.orage)
      courtCircuit(t, p.gerbe, v)
      metro(t, zb, v)
      majFlots(t)
      majVols(t, p.vols)
      balises.material.opacity = Math.sin(t * 2.6) > 0.2 ? 1 : 0.12
      projecteurs.forEach((s) =>
        s.g.rotation.set(0.32 * Math.sin(t * 0.21 + s.ph), 0, 0.3 * Math.cos(t * 0.17 + s.ph * 1.3))
      )
      nuages.forEach((s, i) => (s.position.x += Math.sin(i) * 0.6 * dt))

      majLampeDeal(t, zVisible(Z_DEAL))
      acteurs?.animer(t, dt, v)

      enseignes.forEach((e) => {
        let bz =
          e.i === 0
            ? Math.sin(t * 23 + e.ph) > 0.92 || Math.sin(t * 1.3 + e.ph) > 0.97
              ? 0.15
              : 1
            : 0.85 + 0.15 * Math.sin(t * 1.4 + e.ph)
        if (gerbe && e === cc) bz = rnd() < 0.5 ? 0.05 : 1.4
        e.halo.material.opacity = 0.7 * bz
        if (e.lum) e.lum.intensity = 30 * bz * (p.sombre ? 0.7 : 1)
        e.reflet.material.opacity = 0.35 * Math.min(1, bz)
        e.box.material.color.setScalar(0.35 + 0.65 * Math.min(1, bz))
      })
      fumees.forEach((f) => {
        f.s.position.x = f.x + Math.sin(t * 0.3 + f.r) * 0.4
        f.s.material.rotation = t * 0.05 + f.r
      })
      majParticules(dt)

      // LA CAMÉRA EST POSÉE : elle ne suit que le pointeur, amorti en amont par l'appelant, et le
      // pas lent de la marche. Recalculée à chaque image depuis sa base : rien ne s'accumule.
      const px = look.x * CAMERA_AVENUE.parallaxe.x
      const py = -look.y * CAMERA_AVENUE.parallaxe.y
      camera.position.set(base.x + px, base.y + py, base.z)
      camera.lookAt(viseur.x + px * 0.5, viseur.y + py * 0.5, viseur.z)
      const phase = (parcours / 0.75) * Math.PI
      const b = p.bob * Math.min(1, v)
      camera.position.x += 0.03 * Math.sin(phase) * b
      camera.position.y += 0.035 * (0.5 - 0.5 * Math.cos(2 * phase)) * b
      camera.rotateZ(Math.sin(phase) * 0.006 * b)
      if (secousse > 0) {
        camera.position.x += (Math.random() - 0.5) * secousse
        camera.position.y += (Math.random() - 0.5) * secousse
      }
      renderer.render(scene, camera)
    },

    dispose() {
      vivante = false
      canal?.port1.close()
      canal = null
      // La foule encore en compilation n'est pas dans la scène : elle est libérée aussi.
      const racines: THREE.Object3D[] = enAttente ? [scene, enAttente] : [scene]
      for (const racine of racines)
        racine.traverse((objet) => {
          const mesh = objet as THREE.Mesh
          mesh.geometry?.dispose?.()
          const matiere = mesh.material as THREE.Material | THREE.Material[] | undefined
          if (Array.isArray(matiere)) matiere.forEach((entree) => entree.dispose())
          else matiere?.dispose?.()
        })
      for (const texture of textures) texture.dispose()
      renderer.dispose()
      canvas.remove()
    }
  }
}
