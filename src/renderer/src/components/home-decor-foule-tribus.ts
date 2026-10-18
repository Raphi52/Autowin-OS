import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { CodeAvatar } from './home-decor-foule'
import { nouvelleToile } from './decor-toile'

/*
 * LES DEUX TRIBUS DE LA FOULE : « SURVÊT' ET CAGOULE » ET « PUNKS À CRÊTE » (conv-312).
 *
 * Demandes de l'utilisateur, dans l'ordre : « les humains sont trop sobre par rapport a l'univers dans
 * lequel ils sont », puis « ils doivent tous avoir l'air de voyous du futur ». Six tribus ont été
 * rendues sur les vrais modules du décor (brouillon : .autowin-tmp/draft-humains/banc/voyous.js),
 * puis « implémente survet et punk » : la foule se partage entre ces deux tribus, figurants compris.
 *
 *   - SURVÊT' ET CAGOULE : survêtement luisant à deux bandes lumineuses, cagoule tricotée noire dont
 *     seule la fente des yeux reste nue, cadre néon autour de la fente, grosse chaîne en or ;
 *   - PUNKS À CRÊTE : tenue noire, crête de pics lumineux sur le crâne rasé, épaulettes de métal
 *     hérissées de clous, collier clouté, tatouages néon sur le visage.
 *
 * Les nuanceurs sont ceux du brouillon validé, recopiés tels quels. Ce qui change pour le vrai fond :
 *   - les mesures du corps (dos, poitrine, cou, épaules) sont prises dans la POSE DE LIAISON, par les
 *     matrices inverses des os : aucun sommet n'est déformé à la main (la déformation par les os coûtait
 *     261 ms pour 18 passants, voir `copier` dans home-decor-foule.ts) ;
 *   - les accessoires d'une personne sont FUSIONNÉS par matière et par os : 5 objets pour un punk,
 *     1 pour un survêt', au lieu de 37 pièces ;
 *   - aucune lumière, aucune image chargée : les matières sont calculées, la seule texture (le reflet
 *     de l'or) est dessinée sur une toile.
 *
 * Repère des os Rocketbox (centimètres) : x vers le haut, y vers l'avant, z vers la gauche. Dans la
 * pose de liaison du maillage, z monte (de 0 aux pieds à ~180 au crâne) et y négatif est devant.
 */

const V3 = THREE.Vector3

export type Tribu = 'survet' | 'punk'

/**
 * LA TRIBU DE CHAQUE PERSONNE. Par personne et non par passant : les matières sont partagées entre les
 * copies d'une même personne (un programme, pas dix-huit). Les deux tribus alternent le long de chaque
 * trottoir ; au deal, le dealer en survêt' et son client punk ; le fumeur de la rambarde est punk.
 */
export const TRIBUS: Readonly<Record<CodeAvatar, Tribu>> = {
  M18: 'punk',
  F07: 'survet',
  BM1: 'survet',
  F12: 'punk',
  M12: 'punk',
  F04: 'survet',
  M04: 'survet',
  F13: 'punk',
  M17: 'punk',
  BF4: 'survet',
  M20: 'survet',
  F11: 'punk',
  M09: 'punk',
  SF1: 'survet',
  M10: 'survet',
  M07: 'punk',
  M11: 'survet',
  M06: 'punk',
  M05: 'punk',
  // le taggeur : visage caché sous la cagoule
  M16: 'survet'
}

/** Ce qui distingue une tribu à l'échelle du corps entier. */
export const STYLE_TRIBU: Readonly<Record<Tribu, { appoint: number; cheveux: boolean }>> = {
  // La lumière propre aux personnages, plus basse que les 0,22 des citadins : leurs tenues sombres
  // ressortent par leurs néons et leur liseré, pas par un éclairage plat.
  survet: { appoint: 0.1, cheveux: false }, // cagoule : les cheveux sont dessous
  punk: { appoint: 0.08, cheveux: false } // crâne rasé sous la crête
}

/** Les néons de la foule : rose, cyan, violet, ambre, vert acide, rouge. */
export const NEONS = [0xff2f9e, 0x22e6ff, 0xa64bff, 0xffb02e, 0x7dff3a, 0xff4d4d] as const
/** Les couleurs des survêtements : violet, rouge, sarcelle, noir, bleu roi, gris clair. */
export const SURVETEMENTS = [0x5a1ad0, 0xc0102c, 0x0b8f96, 0x18181c, 0x1f46d8, 0xd8d8de] as const

/** Le numéro de la personne dans le nom de ses matières : `m023_body` → 23, `f170_hat` → 170. */
export function numeroAvatar(nomMatiere: string): number {
  const m = /[mf](\d+)/i.exec(nomMatiere)
  return m ? Number(m[1]) : 0
}
export const neonDe = (numero: number): number => NEONS[numero % NEONS.length]
export const survetementDe = (numero: number): number => SURVETEMENTS[numero % SURVETEMENTS.length]

// ─────────────────────────────── les matières des corps ───────────────────────────────
const ENTETE = `
varying vec3 vBind; varying vec3 vBindN;
uniform vec3 uNeon; uniform vec3 uCouleur; uniform float uTete; uniform float uCheveux; uniform float uAppoint; uniform vec3 uOeil;
float lumi(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
float bord(vec3 n, float k) { return pow(1.0 - clamp(dot(n, normalize(vViewPosition)), 0.0, 1.0), k); }
float deuxBandes(float c) { return step(0.951, c) * (1.0 - step(0.9945, c)); }
// survêtement : deux bandes sur l'extérieur des jambes et le dessus des bras (pose de liaison en A, bras à ~48°)
float bandesSurvet(vec3 p, vec3 n) {
  float b = 0.0;
  if (p.z > 14.0 && p.z < 94.0 && abs(p.x) < 24.0) b += deuxBandes(abs(n.x) * step(0.0, n.x * p.x));
  if (abs(p.x) > 21.0 && p.z > 95.0) b += deuxBandes(dot(n, normalize(vec3(sign(p.x) * 0.74, 0.0, 0.67))));
  // fermeture éclair du haut
  b += step(abs(p.x), 0.7) * step(p.y, 0.0) * step(98.0, p.z) * step(p.z, 140.0);
  return min(b, 1.0);
}
`
const PEAU = `
  float peau = 0.0;
  {
    vec3 c = diffuseColor.rgb;
    float mx = max(c.r, max(c.g, c.b));
    // la peau a toujours un peu de vert (g > 0,22 r en linéaire) : un pull rouge vif n'en a pas
    peau = (c.r > c.g && c.g > c.b && (c.r - c.b) > 0.04 && (c.r - c.b) < 0.5 && mx > 0.06 && c.g > 0.22 * c.r) ? 1.0 : 0.0;
    // sur la matière du corps, un sweat beige a la couleur de la peau : la peau n'y est cherchée qu'aux mains
    // (au-delà des poignets en pose de liaison en A) et devant le cou ; bras et jambes nus sont habillés
    if (uTete < 0.5) peau *= min(1.0, step(53.0, abs(vBind.x)) + step(140.0, vBind.z) * step(abs(vBind.x), 7.0) * step(vBind.y, -2.0));
  }
  // repère du visage : yeux de la pose de liaison (y négatif = devant)
  float dzOeil = vBind.z - uOeil.z;
  float devant = step(vBind.y, uOeil.y + 3.0);
  float tissu = uTete > 0.5 ? 0.0 : (uCheveux > 0.5 ? 0.0 : 1.0 - peau);
  float lu = lumi(diffuseColor.rgb);
`
const APPOINT = 'totalEmissiveRadiance += diffuseColor.rgb * uAppoint;'

/** Le code de chaque tribu : après la couleur de base, puis après les lumières. */
const NUANCES: Readonly<Record<Tribu, { couleur: string; lumiere: string }>> = {
  survet: {
    couleur: `{
        float pieds = 1.0 - step(13.0, vBind.z);
        diffuseColor.rgb = mix(diffuseColor.rgb, uCouleur * (0.3 + 0.8 * lu), tissu * (1.0 - pieds));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92), bandesSurvet(vBind, vBindN) * tissu * (1.0 - pieds));
        // cagoule tricotée sur toute la peau de la tête et du cou : seule la fente des yeux reste nue
        if (uTete > 0.5) {
          float fente = step(abs(dzOeil - 0.2), 1.7) * step(abs(vBind.x), 5.6) * devant;
          vec3 tricot = vec3(0.024, 0.024, 0.03) * (0.7 + 0.3 * step(0.5, fract(vBind.x * 1.3)));
          diffuseColor.rgb = mix(tricot, diffuseColor.rgb, fente);
        }
      }`,
    lumiere: `${APPOINT}
      totalEmissiveRadiance += uNeon * 1.6 * bandesSurvet(vBind, vBindN) * tissu * step(13.0, vBind.z);
      totalEmissiveRadiance += uCouleur * bord(normal, 2.2) * 0.5 * tissu;
      if (uTete > 0.5) {
        float cadre = step(abs(dzOeil - 0.2), 2.6) * step(abs(vBind.x), 6.4) * (1.0 - step(abs(dzOeil - 0.2), 1.7) * step(abs(vBind.x), 5.6)) * devant;
        totalEmissiveRadiance += uNeon * 2.2 * cadre;
        totalEmissiveRadiance += vec3(0.5, 0.52, 0.65) * bord(normal, 2.5) * 0.18 * (1.0 - cadre);
      }`
  },
  punk: {
    // cuir noir luisant + tatouages lumineux sur le visage et le cou
    couleur: `diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lu) * 0.18, tissu);`,
    lumiere: `${APPOINT}
      totalEmissiveRadiance += vec3(0.62, 0.66, 0.9) * bord(normal, 2.4) * 0.32 * tissu;
      {
        float raies = step(abs(fract(vBind.z * 0.32 + abs(vBind.x) * 0.22) - 0.5), 0.09)
          * step(abs(vBind.x), 6.5) * devant * step(-9.0, dzOeil) * step(dzOeil, -1.8);
        float front = step(abs(fract(vBind.x * 0.25) - 0.5), 0.1) * devant * step(2.2, dzOeil) * step(dzOeil, 5.5) * step(abs(vBind.x), 5.0);
        float barbele = step(abs(dzOeil + 17.0 - 1.2 * sin(atan(vBind.y, vBind.x) * 14.0)), 0.7);
        totalEmissiveRadiance += uNeon * 2.4 * min(raies + front + barbele, 1.0) * peau * uTete;
      }`
  }
}

/** Un ajout de code juste après un repère du nuanceur de three. Un repère absent est une erreur nommée. */
function apres(source: string, repere: string, ajout: string): string {
  if (!source.includes(repere))
    throw new Error(`[decor] nuanceur de la foule sans le repère ${repere}`)
  return source.replace(repere, `${repere}\n${ajout}`)
}

/** Où sont les yeux quand le repère est introuvable : loin du corps, aucun effet de visage. */
const SANS_YEUX = new V3(0, 0, -1000)

/**
 * LES YEUX DANS LA POSE DE LIAISON, dans le repère du maillage (cm) : le milieu des deux os des yeux.
 * Le visage des deux tribus (fente de la cagoule, tatouages) se place par rapport à eux.
 * `bindMatrix` et non `bindMatrixInverse` : celle-ci suit la pose courante en mode « attached ».
 */
export function yeuxDeLiaison(mesh: THREE.Object3D): THREE.Vector3 {
  const sm = mesh as THREE.SkinnedMesh
  if (!sm.isSkinnedMesh || !sm.skeleton) return SANS_YEUX.clone()
  const os = sm.skeleton.bones
  const g = os.findIndex((b) => b.name === 'Bip01_LEye')
  const d = os.findIndex((b) => b.name === 'Bip01_REye')
  if (g < 0 || d < 0) return SANS_YEUX.clone()
  const versMaillage = sm.bindMatrix.clone().invert()
  const position = (j: number): THREE.Vector3 =>
    new V3().applyMatrix4(sm.skeleton.boneInverses[j].clone().invert()).applyMatrix4(versMaillage)
  return position(g).add(position(d)).multiplyScalar(0.5)
}

export interface Peau {
  /** Matière de la tête (le visage et le cou nus). */
  tete: boolean
  /** Mèches de cheveux. */
  cheveux: boolean
  /** Les yeux dans la pose de liaison (`yeuxDeLiaison`). */
  oeil: THREE.Vector3
  /** Le numéro de la personne (`numeroAvatar`) : sa couleur de néon et de survêtement. */
  numero: number
}

/** Habille une matière de corps aux couleurs de sa tribu. Même programme pour toute la tribu. */
export function nuancer(m: THREE.MeshStandardMaterial, tribu: Tribu, peau: Peau): void {
  const nuance = NUANCES[tribu]
  const neon = new THREE.Color(neonDe(peau.numero))
  const couleur = new THREE.Color(survetementDe(peau.numero))
  const appoint = STYLE_TRIBU[tribu].appoint
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNeon = { value: neon }
    sh.uniforms.uCouleur = { value: couleur }
    sh.uniforms.uTete = { value: peau.tete ? 1 : 0 }
    sh.uniforms.uCheveux = { value: peau.cheveux ? 1 : 0 }
    sh.uniforms.uAppoint = { value: appoint }
    sh.uniforms.uOeil = { value: peau.oeil }
    sh.vertexShader = apres(
      apres(sh.vertexShader, '#include <common>', 'varying vec3 vBind; varying vec3 vBindN;'),
      '#include <begin_vertex>',
      'vBind = position; vBindN = normal;'
    )
    sh.fragmentShader = apres(
      apres(
        apres(sh.fragmentShader, '#include <common>', ENTETE),
        '#include <map_fragment>',
        `${PEAU}\n${nuance.couleur}`
      ),
      '#include <lights_fragment_end>',
      nuance.lumiere
    )
  }
  m.customProgramCacheKey = () => `foule-${tribu}`
}

// ─────────────────────────────── les mesures du corps ───────────────────────────────
export interface Mesures {
  /** Échelle de la tête : l'œil de la personne rapporté aux 11,1 cm du casting de référence. */
  s: number
  /** Le cou et les épaules, dans le repère de l'os du torse (Bip01_Spine2). */
  cou: THREE.Vector3
  epG: THREE.Vector3
  epD: THREE.Vector3
  /** La surface du dos et de la poitrine, puis de la nuque et de la gorge, le long de l'axe y du torse. */
  dos: number
  poitrine: number
  dosCou: number
  avantCou: number
}

const indexOs = (sq: THREE.Skeleton, nom: string): number => {
  const i = sq.bones.findIndex((b) => b.name === nom)
  if (i < 0) throw new Error(`[decor] squelette sans l os ${nom}`)
  return i
}

/**
 * MESURE UNE PERSONNE DANS SA POSE DE LIAISON. Un sommet de la peau, dans le repère de l'os du torse,
 * vaut `inverse(os) × bindMatrix × position` : ni animation, ni déformation sommet par sommet. Les
 * mêmes colonnes que le brouillon : le dos et la poitrine au milieu du torse, la nuque et la gorge sous
 * le cou. Une colonne vide garde une valeur par défaut au lieu de poser un accessoire dans le vide.
 */
export function mesurer(racine: THREE.Object3D): Mesures {
  const oeil = racine.getObjectByName('Bip01_LEye')
  if (!oeil) throw new Error('[decor] squelette sans os des yeux')
  const corps: THREE.SkinnedMesh[] = []
  racine.traverse((o) => {
    const sm = o as THREE.SkinnedMesh
    if (sm.isSkinnedMesh && /body/i.test((sm.material as THREE.Material).name)) corps.push(sm)
  })
  if (corps.length === 0) throw new Error('[decor] personne sans matière de corps')
  const versTorse = (sm: THREE.SkinnedMesh): THREE.Matrix4 =>
    sm.skeleton.boneInverses[indexOs(sm.skeleton, 'Bip01_Spine2')].clone().multiply(sm.bindMatrix)
  const ref = corps[0]
  const torseRef = ref.skeleton.boneInverses[indexOs(ref.skeleton, 'Bip01_Spine2')]
  const osDansTorse = (nom: string): THREE.Vector3 =>
    new V3()
      .applyMatrix4(ref.skeleton.boneInverses[indexOs(ref.skeleton, nom)].clone().invert())
      .applyMatrix4(torseRef)
  const cou = osDansTorse('Bip01_Neck')
  let dos = Infinity
  let poitrine = -Infinity
  let dosCou = Infinity
  let avantCou = -Infinity
  const q = new V3()
  for (const sm of corps) {
    const m = versTorse(sm)
    const pos = sm.geometry.attributes.position
    for (let i = 0; i < pos.count; i += 2) {
      q.fromBufferAttribute(pos, i).applyMatrix4(m)
      if (Math.abs(q.z) < 6 && Math.abs(q.x - 4) < 6) {
        if (q.y < 0) dos = Math.min(dos, q.y)
        else poitrine = Math.max(poitrine, q.y)
      }
      if (Math.abs(q.z) < 4 && Math.abs(q.x - (cou.x - 2)) < 2.5) {
        if (q.y < cou.y) dosCou = Math.min(dosCou, q.y)
        else avantCou = Math.max(avantCou, q.y)
      }
    }
  }
  return {
    s: oeil.position.x / 11.1,
    cou,
    epG: osDansTorse('Bip01_L_UpperArm'),
    epD: osDansTorse('Bip01_R_UpperArm'),
    dos: Number.isFinite(dos) ? dos : -15,
    poitrine: Number.isFinite(poitrine) ? poitrine : 14,
    dosCou: Number.isFinite(dosCou) ? dosCou : cou.y - 9,
    avantCou: Number.isFinite(avantCou) ? avantCou : cou.y + 9
  }
}

// ─────────────────────────────── les accessoires ───────────────────────────────
/** « Socle » : repère standard, Y en haut, Z devant, X à gauche de la personne, posé sur un os. */
const BASE = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().makeBasis(new V3(0, 0, 1), new V3(1, 0, 0), new V3(0, 1, 0))
)
const versSocle = (q: THREE.Vector3): THREE.Vector3 => new V3(q.z, q.x, q.y)

interface Pose {
  p?: THREE.Vector3
  q?: THREE.Quaternion
  r?: THREE.Euler
  e?: THREE.Vector3
}
/** Fige une pièce à sa place dans le socle, pour la fusionner avec ses voisines. */
function poser(geo: THREE.BufferGeometry, pose: Pose): THREE.BufferGeometry {
  const t = new THREE.Object3D()
  if (pose.p) t.position.copy(pose.p)
  if (pose.q) t.quaternion.copy(pose.q)
  if (pose.r) t.rotation.copy(pose.r)
  if (pose.e) t.scale.copy(pose.e)
  t.updateMatrix()
  return geo.applyMatrix4(t.matrix)
}
function fusionner(nom: string, pieces: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const geo = mergeGeometries(pieces)
  pieces.forEach((p) => p.dispose())
  if (!geo) throw new Error(`[decor] accessoire ${nom} impossible à fusionner`)
  geo.computeBoundingSphere()
  return geo
}
/** Tube le long d'une ellipse horizontale (collier, chaîne). */
function ellipseTube(rx: number, rz: number, tube: number): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = []
  for (let k = 0; k < 40; k++) {
    const t = (k / 40) * Math.PI * 2
    pts.push(new V3(rx * Math.cos(t), 0, rz * Math.sin(t)))
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 60, tube, 6, true)
}
const HAUT = new V3(0, 1, 0)

/** Les accessoires d'une personne, dans le repère de leur socle : une géométrie par matière et par os. */
interface PiecesPunk {
  crete: THREE.BufferGeometry
  epaulettes: THREE.BufferGeometry
  clousEpaules: THREE.BufferGeometry
  collier: THREE.BufferGeometry
  clousCollier: THREE.BufferGeometry
}
function piecesPunk(m: Mesures): PiecesPunk {
  const s = m.s
  // la crête : dix pics du front à la nuque, plus hauts au sommet du crâne
  const pics: THREE.BufferGeometry[] = []
  for (let k = 0; k <= 9; k++) {
    const al = -0.5 + (k / 9) * 2.45
    const dir = new V3(0, Math.cos(al) / 11.3, -Math.sin(al) / 11.8).normalize()
    const base = new V3(0, -0.4 * s + 11.3 * s * Math.cos(al), -0.6 * s - 11.8 * s * Math.sin(al))
    const h = (10.5 - 3.4 * Math.abs(al - 0.55)) * s
    pics.push(
      poser(new THREE.ConeGeometry(1.9 * s, h, 7), {
        q: new THREE.Quaternion().setFromUnitVectors(HAUT, dir),
        p: base.addScaledVector(dir, h / 2 - 1.2 * s)
      })
    )
  }
  // les épaulettes de métal, trois clous chacune
  const coques: THREE.BufferGeometry[] = []
  const clous: THREE.BufferGeometry[] = []
  for (const ep of [m.epG, m.epD]) {
    const q = versSocle(ep)
    const cote = Math.sign(q.x)
    coques.push(
      poser(new THREE.SphereGeometry(1, 40, 26, 0, Math.PI * 2, 0, Math.PI / 2), {
        p: new V3(q.x * 0.95, q.y + 1.8 * s, q.z),
        r: new THREE.Euler(0, 0, -cote * 0.4),
        e: new V3(6.8 * s, 4.6 * s, 7.4 * s)
      })
    )
    for (const dz of [-3.6, 0, 3.6])
      clous.push(
        poser(new THREE.ConeGeometry(1.15 * s, 5.5 * s, 6), {
          p: new V3(q.x * 0.95 + cote * 2 * s, q.y + 6 * s, q.z + dz * s),
          r: new THREE.Euler(0, 0, -cote * 0.45)
        })
      )
  }
  // le collier clouté, douze clous tout autour
  const clousCollier: THREE.BufferGeometry[] = []
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2
    const d = new V3(Math.cos(a), 0, Math.sin(a))
    clousCollier.push(
      poser(new THREE.ConeGeometry(0.75 * s, 2.6 * s, 5), {
        q: new THREE.Quaternion().setFromUnitVectors(HAUT, d),
        p: new V3(d.x * 8.7 * s, 0, d.z * 9.1 * s)
      })
    )
  }
  return {
    crete: fusionner('crête', pics),
    epaulettes: fusionner('épaulettes', coques),
    clousEpaules: fusionner('clous des épaules', clous),
    collier: ellipseTube(7.4 * s, 7.8 * s, 1.5 * s),
    clousCollier: fusionner('clous du collier', clousCollier)
  }
}
/** La chaîne en or et son médaillon, sur le haut du survêtement. */
function chaineSurvet(m: Mesures): THREE.BufferGeometry {
  const s = m.s
  return fusionner('chaîne', [
    poser(ellipseTube(10.5 * s, (m.avantCou - m.dosCou) / 2 + 1.4 * s, 0.85 * s), {
      p: new V3(0, m.cou.x - 3 * s, (m.avantCou + m.dosCou) / 2),
      r: new THREE.Euler(0.28, 0, 0)
    }),
    poser(new THREE.CylinderGeometry(2.6 * s, 2.6 * s, 0.8 * s, 20), {
      p: new V3(0, m.cou.x - 9 * s, m.poitrine + 0.6),
      r: new THREE.Euler(Math.PI / 2, 0, 0)
    })
  ])
}

/** Le reflet de l'or, dessiné : une sphère éclairée d'en haut, sans dépendre des lumières de la rue. */
function matcapOr(): THREE.CanvasTexture {
  const c = nouvelleToile(128, 128)
  const g = c.getContext('2d')
  if (g) {
    const d = g.createLinearGradient(0, 0, 0, 128)
    d.addColorStop(0, '#fff3c4')
    d.addColorStop(0.48, '#e0a92e')
    d.addColorStop(0.52, '#5a3a08')
    d.addColorStop(1, '#0c0d12')
    g.fillStyle = d
    g.beginPath()
    g.arc(64, 64, 64, 0, Math.PI * 2)
    g.fill()
    const r = g.createRadialGradient(46, 38, 2, 46, 38, 38)
    r.addColorStop(0, 'rgba(255,255,255,0.9)')
    r.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = r
    g.fill()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export interface Tailleur {
  /**
   * Habille une copie animable : accessoires accrochés à ses os. `rang` : son rang dans la foule,
   * qui varie la couleur des néons entre deux copies d'une même personne.
   */
  habiller(racine: THREE.Object3D, code: CodeAvatar, rang: number): void
  /** Les textures créées, à envoyer à la carte graphique avant l'entrée de la foule, puis à libérer. */
  textures(): THREE.Texture[]
}

/**
 * LE TAILLEUR D'UNE FOULE. Ses mesures, ses pièces et ses matières vivent avec elle : une scène libérée
 * libère tout ce qu'elle contient, et la suivante repart de zéro au lieu de reprendre des restes.
 */
export function creerTailleur(): Tailleur {
  const mesures = new Map<CodeAvatar, Mesures>()
  const punks = new Map<CodeAvatar, PiecesPunk>()
  const chaines = new Map<CodeAvatar, THREE.BufferGeometry>()
  const pics = new Map<number, THREE.MeshBasicMaterial>()
  const textures: THREE.Texture[] = []
  let metal: THREE.MeshStandardMaterial | null = null
  let clou: THREE.MeshStandardMaterial | null = null
  let cuir: THREE.MeshStandardMaterial | null = null
  let or: THREE.MeshMatcapMaterial | null = null

  const mesurerUneFois = (code: CodeAvatar, racine: THREE.Object3D): Mesures => {
    let m = mesures.get(code)
    if (!m) mesures.set(code, (m = mesurer(racine)))
    return m
  }
  const os = (racine: THREE.Object3D, nom: string): THREE.Object3D => {
    const o = racine.getObjectByName(nom)
    if (!o) throw new Error(`[decor] os absent : ${nom}`)
    return o
  }
  const socle = (sur: THREE.Object3D, position: THREE.Vector3): THREE.Group => {
    const g = new THREE.Group()
    g.quaternion.copy(BASE)
    g.position.copy(position)
    sur.add(g)
    return g
  }
  const piece = (nom: string, geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh => {
    const mesh = new THREE.Mesh(geo, mat)
    mesh.name = nom
    return mesh
  }

  return {
    habiller(racine, code, rang) {
      const m = mesurerUneFois(code, racine)
      const s = m.s
      if (TRIBUS[code] === 'punk') {
        let p = punks.get(code)
        if (!p) punks.set(code, (p = piecesPunk(m)))
        // la couleur de crête change d'une copie à l'autre d'une même personne
        const corps = racine.getObjectByProperty('isSkinnedMesh', true) as
          THREE.SkinnedMesh | undefined
        const numero = numeroAvatar((corps?.material as THREE.Material | undefined)?.name ?? '')
        const neon = neonDe(numero + rang)
        let pic = pics.get(neon)
        if (!pic) {
          pic = new THREE.MeshBasicMaterial({ color: new THREE.Color(neon).multiplyScalar(1.35) })
          pics.set(neon, pic)
        }
        metal ??= new THREE.MeshStandardMaterial({
          color: 0x2a2c34,
          metalness: 0.75,
          roughness: 0.35
        })
        clou ??= new THREE.MeshStandardMaterial({
          color: 0xc9ced9,
          metalness: 0.85,
          roughness: 0.22,
          emissive: 0x262630
        })
        cuir ??= new THREE.MeshStandardMaterial({ color: 0x0d0d10, roughness: 0.4 })
        socle(os(racine, 'Bip01_Head'), new V3(11.1 * s, 1 * s, 0)).add(
          piece('punk-crete', p.crete, pic)
        )
        socle(os(racine, 'Bip01_Spine2'), new V3()).add(
          piece('punk-epaulettes', p.epaulettes, metal),
          piece('punk-clous-epaules', p.clousEpaules, clou)
        )
        socle(os(racine, 'Bip01_Neck'), new V3(4 * s, 0.5 * s, 0)).add(
          piece('punk-collier', p.collier, cuir),
          piece('punk-clous-collier', p.clousCollier, clou)
        )
      } else {
        let chaine = chaines.get(code)
        if (!chaine) chaines.set(code, (chaine = chaineSurvet(m)))
        if (!or) {
          const reflet = matcapOr()
          textures.push(reflet)
          or = new THREE.MeshMatcapMaterial({ matcap: reflet, color: 0xffffff })
        }
        socle(os(racine, 'Bip01_Spine2'), new V3()).add(piece('survet-chaine', chaine, or))
      }
    },
    textures: () => [...textures]
  }
}
