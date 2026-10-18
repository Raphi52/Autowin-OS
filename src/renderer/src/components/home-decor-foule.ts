import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as clonerAvecSquelette } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { nouvelleToile } from './decor-toile'
import {
  DEAL,
  ecarter,
  etatClient,
  etatDealer,
  etatTaggeur,
  FIGURANTS,
  FUMEUR,
  GESTE_CLIENT,
  MARCHE_CLIENT,
  type Obstacle,
  TAGGEUR
} from './home-decor-figurants'
import {
  creerTailleur,
  numeroAvatar,
  nuancer,
  STYLE_TRIBU,
  TRIBUS,
  type Tribu,
  yeuxDeLiaison
} from './home-decor-foule-tribus'

/*
 * LA FOULE DU FOND D'ACCUEIL : DES HUMAINS RÉELS, DIRECTION « HEURE DE POINTE » (conv-312).
 *
 * Demande de l'utilisateur : « /draft les humains les plus realiste possible pour le fond decran
 * d'accueil », puis, devant les six directions rendues dans le vrai décor, « Implémenter la 6 · Heure
 * de pointe » : 18 passants, des corps, des allures et des vitesses variés, dans les deux sens.
 *
 * Les corps sculptés par code (home-decor-avenue-maillage.ts, retiré) plafonnaient au « bonhomme en
 * pâte à modeler ». Ces personnes-ci sont des modèles Microsoft Rocketbox (licence MIT, voir
 * assets/foule-rocketbox/LICENCE-ROCKETBOX.md) : maillage, peau et vêtements photographiés, squelette
 * complet, et des MARCHES CAPTURÉES SUR DE VRAIS ACTEURS.
 *
 * Comment ils arrivent dans la page :
 *   - un `.glb` par personne (géométrie indexée, squelette) et `marches.glb` (les clips) ; aucun n'a
 *     d'image intégrée : le chargeur glTF décode une image intégrée par une adresse `blob:`, que la
 *     politique de sécurité de la page refuse (`connect-src` retombe sur `default-src 'self'`) —
 *     mesuré le 2026-10-17 dans Electron, page `file://` avec la politique d'index.html ;
 *   - les textures sont des `.webp` à part, lus par `fetch` (autorisé en `file://` comme en dev) puis
 *     décodés HORS du fil principal par `createImageBitmap` ;
 *   - chaque matière porte dans ses `extras` glTF le nom de ses fichiers de texture.
 *
 * DES VOYOUS DU FUTUR DEPUIS LA FIN DE conv-312 : « ils doivent tous avoir l'air de voyous du futur »,
 * puis « implémente survet et punk ». Chaque personne appartient à une tribu, survêt' et cagoule ou
 * punk à crête : ses matières en prennent les couleurs, ses os en portent les accessoires (crête,
 * épaulettes, collier, chaîne en or). Voir `home-decor-foule-tribus.ts`.
 */

const FICHIERS = import.meta.glob('../assets/foule-rocketbox/*.{glb,webp}', {
  query: '?url',
  import: 'default',
  eager: true
}) as Record<string, string>

/** L'adresse servie d'un fichier du dossier de la foule. Un nom absent est une erreur nommée, pas un 404. */
export function adresseFoule(nom: string): string {
  const adresse = FICHIERS[`../assets/foule-rocketbox/${nom}`]
  if (!adresse) throw new Error(`[decor] fichier de foule absent : ${nom}`)
  return adresse
}

/** Les personnes du casting, et le fichier qui les porte. */
export const AVATARS = {
  M18: 'Male_Adult_18',
  F07: 'Female_Adult_07',
  BM1: 'Business_Male_01',
  F12: 'Female_Adult_12',
  M12: 'Male_Adult_12',
  F04: 'Female_Adult_04',
  M04: 'Male_Adult_04',
  F13: 'Female_Adult_13',
  M17: 'Male_Adult_17',
  BF4: 'Business_Female_04',
  M20: 'Male_Adult_20',
  F11: 'Female_Adult_11',
  M09: 'Male_Adult_09',
  SF1: 'Security_Female_01',
  M10: 'Male_Adult_10',
  M07: 'Male_Adult_07',
  // Les figurants du deal et du fumeur (home-decor-figurants.ts) : absents de la foule des passants.
  M11: 'Male_Adult_11',
  M06: 'Male_Adult_06',
  M05: 'Male_Adult_05',
  // Le taggeur du mur tagué (home-decor-figurants.ts), absent lui aussi de la foule.
  M16: 'Male_Adult_16'
} as const
export type CodeAvatar = keyof typeof AVATARS

/** Les marches capturées de `marches.glb`. */
export const MARCHES = [
  'm_walk_neutral_01',
  'm_walk_neutral_02',
  'm_walk_slow_01',
  'm_walk_fast_01',
  'f_walk_neutral_01',
  'f_walk_neutral_02',
  'f_walk_slow_01',
  'f_walk_fast_01'
] as const
export type NomMarche = (typeof MARCHES)[number]

export interface Passant {
  av: CodeAvatar
  marche: NomMarche
  /** Sa file : à gauche le trottoir de la rambarde (x ∈ [-7,2 ; -4]), à droite celui des façades. */
  x: number
  /** Sa position le long de l'avenue au moment de référence `FOULE.tRef`. */
  zf: number
  /** 1 : il s'éloigne de nous ; -1 : il vient vers nous. */
  sens: 1 | -1
  /** Phase de sa marche au départ, en fraction de cycle. */
  dec: number
  /** Facteur de vitesse : il accélère le clip ET le pas, pour que les pieds ne glissent pas. */
  vit: number
}

/**
 * LE CASTING « HEURE DE POINTE », recopié tel que rendu dans le brouillon validé
 * (.autowin-tmp/draft-humains/banc/directions.js, direction 6, tirage déterministe de graine 11).
 */
export const HEURE_DE_POINTE: readonly Passant[] = [
  { av: 'M18', marche: 'm_walk_neutral_01', x: -5.539, zf: 1.626, sens: 1, dec: 0.045, vit: 1.072 },
  { av: 'F07', marche: 'f_walk_fast_01', x: 5.635, zf: -5.467, sens: 1, dec: 0.282, vit: 0.944 },
  {
    av: 'BM1',
    marche: 'm_walk_neutral_01',
    x: -5.399,
    zf: -2.506,
    sens: -1,
    dec: 0.827,
    vit: 0.977
  },
  { av: 'F12', marche: 'f_walk_neutral_02', x: 6.171, zf: -9.411, sens: 1, dec: 0.554, vit: 0.996 },
  {
    av: 'M12',
    marche: 'm_walk_neutral_02',
    x: -6.272,
    zf: -5.614,
    sens: 1,
    dec: 0.193,
    vit: 1.015
  },
  {
    av: 'F04',
    marche: 'f_walk_neutral_01',
    x: 5.468,
    zf: -13.564,
    sens: -1,
    dec: 0.522,
    vit: 0.919
  },
  { av: 'M04', marche: 'm_walk_slow_01', x: -5.273, zf: -10.482, sens: -1, dec: 0.019, vit: 1.043 },
  { av: 'F13', marche: 'f_walk_slow_01', x: 5.274, zf: -16.5, sens: -1, dec: 0.8, vit: 1.09 },
  { av: 'M17', marche: 'm_walk_slow_01', x: -6.281, zf: -13.718, sens: -1, dec: 0.255, vit: 1.023 },
  { av: 'BF4', marche: 'f_walk_slow_01', x: 6.363, zf: -20.522, sens: 1, dec: 0.874, vit: 0.9 },
  { av: 'M20', marche: 'm_walk_slow_01', x: -5.754, zf: -17.815, sens: -1, dec: 0.509, vit: 1.071 },
  { av: 'F11', marche: 'f_walk_slow_01', x: 6.696, zf: -24.41, sens: 1, dec: 0.811, vit: 1.002 },
  {
    av: 'M09',
    marche: 'm_walk_neutral_01',
    x: -4.709,
    zf: -21.793,
    sens: 1,
    dec: 0.109,
    vit: 0.97
  },
  {
    av: 'SF1',
    marche: 'f_walk_neutral_02',
    x: 5.645,
    zf: -27.827,
    sens: -1,
    dec: 0.379,
    vit: 0.935
  },
  { av: 'M10', marche: 'm_walk_fast_01', x: -6.542, zf: -24.718, sens: -1, dec: 0.98, vit: 1.099 },
  { av: 'M07', marche: 'm_walk_fast_01', x: 5.439, zf: -32.533, sens: -1, dec: 0.646, vit: 1 },
  { av: 'F07', marche: 'f_walk_fast_01', x: -5.139, zf: -29.555, sens: 1, dec: 0.569, vit: 1.082 },
  { av: 'M18', marche: 'm_walk_neutral_01', x: 6.623, zf: -36.129, sens: 1, dec: 0.288, vit: 1.065 }
]

/** Le réglage du brouillon validé (direction 6). */
export const FOULE = {
  // La lumière propre aux personnages dépend de leur tribu : `STYLE_TRIBU` (home-decor-foule-tribus.ts).
  rugositeTissu: 0.82,
  rugositePeau: 0.55,
  /** Les mèches de cheveux sont une texture à trous : ce seuil les découpe. */
  seuilCheveux: 0.45,
  /** Opacité de la tache d'ombre sous chaque personne. */
  ombre: 0.6,
  /** L'instant (s, horloge du décor) où chaque passant est à sa position `zf`. */
  tRef: 7.5,
  /** La fenêtre où vit la foule : 70 m, de 56 m devant la caméra à 4 m derrière elle. */
  fenetre: 70,
  debut: -56
} as const

/** Ramène une position dans la fenêtre de la foule : qui sort d'un côté rentre de l'autre, hors de vue. */
export function enrouler(z: number): number {
  const w = FOULE.fenetre
  return ((((z - FOULE.debut) % w) + w) % w) + FOULE.debut
}

/**
 * Où est un passant : sa position de référence, plus le défilement de la rue (la caméra « marche »),
 * moins son propre pas. `defile` = mètres parcourus par la rue depuis l'instant de référence.
 */
export function positionZ(p: Passant, vitesse: number, t: number, defile: number): number {
  return enrouler(p.zf + defile - p.sens * vitesse * (t - FOULE.tRef))
}

/**
 * ON CONTOURNE LA CAMÉRA. Elle est posée SUR le trottoir de gauche (x = -5,55), en plein dans la file
 * des passants : sans écart, un corps la traversait et remplissait l'écran (constaté le 2026-10-17,
 * capture de l'Accueil à 16 s). En approchant, le passant glisse de côté jusqu'à `ecartCamera` de
 * l'axe de la caméra, du côté où il se trouve déjà, et reprend sa file une fois passé.
 */
export const ECART_CAMERA = {
  /** Distance latérale gardée avec la caméra, en mètres. */
  distance: 0.95,
  /** En deçà de cette distance le long de l'avenue, l'écart est complet. */
  plein: 1.5,
  /** Au-delà, le passant est dans sa file ; entre les deux, il s'écarte en douceur. */
  portee: 4.5
} as const
export function ecarterDeLaCamera(x: number, z: number, camX: number, camZ: number): number {
  return ecarter(x, z, { x: camX, z: camZ, ...ECART_CAMERA })
}

/** Ce que les passants gardent d'écart avec un figurant : ils passent côté chaussée. */
export const ECART_FIGURANT = { distance: 0.8, plein: 1.0, portee: 3.5 } as const

/**
 * REDRESSE UNE MARCHE CAPTURÉE : l'acteur avançait dans la salle de capture (la racine `Bip01` avance
 * en z), on retire cette avance pour la rejouer nous-mêmes, et on garde le balancement DANS le cycle
 * (c'est lui qui plante les pieds). Rend la vitesse de l'acteur, en m/s (les clips sont en cm).
 */
export function redresserMarche(clip: THREE.AnimationClip): number {
  const piste = clip.tracks.find((t) => t.name === 'Bip01.position')
  if (!piste) return 0
  const v = piste.values
  const tm = piste.times
  const n = tm.length
  if (n < 2) return 0
  const dx = v[(n - 1) * 3] - v[0]
  const dz = v[(n - 1) * 3 + 2] - v[2]
  const duree = tm[n - 1] - tm[0]
  if (!(duree > 0)) return 0
  const x0 = v[0]
  const z0 = v[2]
  for (let i = 0; i < n; i++) {
    const f = (tm[i] - tm[0]) / duree
    v[i * 3] = v[i * 3] - x0 - dx * f
    v[i * 3 + 2] = v[i * 3 + 2] - z0 - dz * f
  }
  return Math.hypot(dx, dz) / 100 / duree
}

/** Une tache radiale dessinée par code : l'ombre au sol, la braise, la fumée. */
function texteRadiale(arrets: [number, string][]): THREE.CanvasTexture {
  const c = nouvelleToile(128, 128)
  const x = c.getContext('2d')
  if (x) {
    const g = x.createRadialGradient(64, 64, 4, 64, 64, 64)
    for (const [o, couleur] of arrets) g.addColorStop(o, couleur)
    x.fillStyle = g
    x.fillRect(0, 0, 128, 128)
  }
  return new THREE.CanvasTexture(c)
}

/** Une texture `.webp`, décodée hors du fil principal, dans le sens des UV du modèle d'origine. */
async function chargerTexture(nom: string, couleur: boolean): Promise<THREE.Texture> {
  const reponse = await fetch(adresseFoule(nom))
  if (!reponse.ok)
    throw new Error(`[decor] texture de foule illisible : ${nom} (${reponse.status})`)
  const image = await createImageBitmap(await reponse.blob(), {
    imageOrientation: 'flipY',
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none'
  })
  const texture = new THREE.Texture(image)
  // L'image est déjà retournée par `createImageBitmap` : une ImageBitmap ignore `flipY`.
  texture.flipY = false
  texture.colorSpace = couleur ? THREE.SRGBColorSpace : THREE.NoColorSpace
  texture.anisotropy = 4
  texture.needsUpdate = true
  return texture
}

async function chargerGlb(
  nom: string
): Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> {
  const reponse = await fetch(adresseFoule(nom))
  if (!reponse.ok) throw new Error(`[decor] modèle de foule illisible : ${nom} (${reponse.status})`)
  const gltf = await new GLTFLoader().parseAsync(await reponse.arrayBuffer(), '')
  return { scene: gltf.scene, animations: gltf.animations }
}

interface ExtrasMatiere {
  couleur?: string | null
  normale?: string | null
  cheveux?: boolean
}

/** La matière d'une partie du corps : tissu ou peau, aux couleurs de la tribu de la personne. */
function matiere(
  mesh: THREE.Mesh,
  textures: Map<string, THREE.Texture>,
  tribu: Tribu
): THREE.MeshStandardMaterial {
  const source = mesh.material as THREE.Material
  const nom = source.name
  const extras = source.userData as ExtrasMatiere
  const peau = /head/i.test(nom)
  const cheveux = extras.cheveux === true
  const m = new THREE.MeshStandardMaterial({
    name: nom,
    map: (extras.couleur && textures.get(extras.couleur)) || null,
    normalMap: (extras.normale && textures.get(extras.normale)) || null,
    roughness: peau ? FOULE.rugositePeau : FOULE.rugositeTissu,
    metalness: 0,
    alphaTest: cheveux ? FOULE.seuilCheveux : 0,
    side: cheveux ? THREE.DoubleSide : THREE.FrontSide
  })
  nuancer(m, tribu, { tete: peau, cheveux, oeil: yeuxDeLiaison(mesh), numero: numeroAvatar(nom) })
  return m
}

/**
 * REMPLACE LES MATIÈRES D'UN MODÈLE, UNE MATIÈRE NEUVE PAR MATIÈRE D'ORIGINE. Le chargeur glTF découpe
 * une matière d'origine en plusieurs morceaux de maillage : 157 morceaux de corps pour 40 matières
 * d'origine dans la foule. Une matière neuve par morceau en faisait 140 ; elles sont 40 (54 avec les
 * accessoires, au lieu de 154 ; banc du 2026-10-18, conv-312). Mesuré dans l'Accueil : la tâche la plus
 * longue après l'entrée de la foule n'a PAS baissé (77 à 154 ms, contre 62 à 102 ms avant). Elle
 * est surtout une image ordinaire du décor : à chaque image, `setProgram` coûte 34 ms même 5 à 9 s
 * après l'entrée de la foule, parce que le reflet de la Spirale dessine la rue en espace linéaire puis
 * l'écran en sRGB, et que three change alors de programme chaque matière dessinée dans les deux
 * (WebGLRenderer.js, `outputColorSpace !== colorSpace`) ; la foule, masquée dans le reflet, n'y est
 * pour rien. Les morceaux d'une matière d'origine partagent son squelette : leurs yeux de liaison, qui
 * placent le visage des tribus, coïncident (écart mesuré sur le banc : 0 cm), la matière partagée est
 * donc exactement celle qu'aurait reçue chaque morceau. Rend le nombre de matières créées.
 */
export function remplacerMatieres(
  modele: THREE.Object3D,
  fabriquer: (mesh: THREE.Mesh) => THREE.Material
): number {
  const neuves = new Map<THREE.Material, THREE.Material>()
  modele.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const origine = mesh.material as THREE.Material
    let neuve = neuves.get(origine)
    if (!neuve) {
      neuve = fabriquer(mesh)
      neuves.set(origine, neuve)
    }
    mesh.material = neuve
  })
  neuves.forEach((_, origine) => origine.dispose())
  return neuves.size
}

interface Personne {
  p: Passant
  racine: THREE.Object3D
  bassin: THREE.Object3D
  mixer: THREE.AnimationMixer
  vitesse: number
  ombre: THREE.Mesh
}

/** Un figurant : ses gestes, celui qu'il joue, et ses os nommés. */
interface Figurant {
  racine: THREE.Object3D
  bassin: THREE.Object3D
  mixer: THREE.AnimationMixer
  actions: Map<string, THREE.AnimationAction>
  courant: string | null
  ombre: THREE.Mesh
  os(nom: string): THREE.Object3D
}

/** Passe d'un geste capturé à l'autre par un fondu enchaîné : jamais de saut de pose. */
function jouer(f: Figurant, nom: string, fondu = 0.45): THREE.AnimationAction {
  const action = f.actions.get(nom)
  if (!action) throw new Error(`[decor] geste absent : ${nom}`)
  if (f.courant === nom) return action
  const avant = f.courant ? f.actions.get(f.courant) : undefined
  action.reset()
  action.play()
  if (avant) avant.crossFadeTo(action, fondu, false)
  f.courant = nom
  return action
}

/**
 * LE MUR TAGUÉ, PEINT PAR LE DÉCOR. Le taggeur lui dit quand et où sa bombe crache ; le décor, qui
 * possède la toile du mot, pose la peinture, la brume et les projections.
 */
export interface PeintreTag {
  /** x de la façade peinte (m). */
  xMur: number
  /** Le mur réapparaît au fond de la rue : vierge, avec le mot suivant. */
  nouveau(): void
  /** Part du mot peinte, de 0 à 1 : le fond du mot se remplit derrière la main. */
  devoiler(part: number): void
  /** La bombe crache, de `buse` vers le point visé du mur (coordonnées du monde). */
  bomber(buse: THREE.Vector3, vise: THREE.Vector3): void
  /** Bombe relâchée. */
  relacher(): void
  /** Le mot est fini : complété, et la peinture coule. */
  finir(): void
}

/** Où et à quelle vitesse jouent les scènes : les mesures de la rue, données par l'avenue. */
export interface Scenes {
  facade: number
  garde: number
  vRue: number
  /** Le mur tagué : sans lui, pas de taggeur. */
  tag?: PeintreTag
}
/** La position actuelle (z) de chaque lieu le long de la rue. */
export interface Lieux {
  deal: number
  fumeur: number
  /** Le centre du mur tagué. */
  tag?: number
}

export interface Foule {
  /** Pas encore dans la scène : l'appelant l'y ajoute une fois ses nuanceurs compilés. */
  groupe: THREE.Group
  /** Les textures, à libérer avec la scène (une matière libérée ne libère pas ses textures). */
  textures: THREE.Texture[]
  /**
   * `t` : horloge du décor ; `defile` : mètres parcourus par la rue depuis `FOULE.tRef` ;
   * `camera` : sa position au sol, que les passants contournent ; `lieux` : où sont le deal et le
   * fumeur, quand la foule a ses scènes.
   */
  animer(
    t: number,
    dt: number,
    defile: number,
    camera: { x: number; z: number },
    lieux?: Lieux
  ): void
}

/** Prépare une copie animable d'une personne chargée. */
function copier(modele: THREE.Group): { racine: THREE.Object3D; bassin: THREE.Object3D } {
  const racine = clonerAvecSquelette(modele)
  racine.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh
    if (!mesh.isMesh) return
    // Le volume d'un corps animé n'est pas celui de sa pose de repos : sans ça, un bras sort du cadre de calcul et disparaît.
    mesh.frustumCulled = false
    /*
     * LA SPHÈRE ENGLOBANTE EST POSÉE D'AVANCE, celle de la pose de repos. Le moteur ne s'en sert que
     * pour trier les objets ; absente, il la calcule à la première image en déformant chaque sommet
     * par ses os : 261 ms sur le fil principal pour 18 passants (profil du 2026-10-17, conv-312,
     * `applyBoneTransform`), dans la tâche de 0,6 à 0,9 s qui suivait l'entrée de la foule.
     */
    if (mesh.isSkinnedMesh) {
      if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere()
      if (mesh.geometry.boundingSphere) mesh.boundingSphere = mesh.geometry.boundingSphere.clone()
    }
  })
  const bassin = racine.getObjectByName('Bip01')
  if (!bassin) throw new Error('[decor] squelette sans racine Bip01')
  return { racine, bassin }
}

/**
 * CHARGE ET MONTE LA FOULE. Tout est asynchrone et découpé : un fichier à la fois, le décodage des
 * images hors du fil principal. `vivante()` faux (scène libérée) arrête le chargement et rend `null`.
 * Avec `scenes`, les figurants du deal et du fumeur sont montés aussi (home-decor-figurants.ts).
 */
export async function chargerFoule(
  passants: readonly Passant[],
  sol: number,
  vivante: () => boolean,
  scenes?: Scenes
): Promise<Foule | null> {
  const textures = new Map<string, THREE.Texture>()
  const modeles = new Map<CodeAvatar, THREE.Group>()
  const libererTout = (): null => {
    textures.forEach((t) => t.dispose())
    return null
  }
  const tache = (): Promise<void> => new Promise<void>((ok) => setTimeout(ok, 0))

  const marches = await chargerGlb('marches.glb')
  if (!vivante()) return libererTout()
  const clips = new Map<string, { clip: THREE.AnimationClip; vitesse: number }>()
  for (const clip of marches.animations)
    clips.set(clip.name, { clip, vitesse: redresserMarche(clip) })
  if (scenes) {
    const gestes = await chargerGlb('gestes.glb')
    if (!vivante()) return libererTout()
    for (const clip of gestes.animations) clips.set(clip.name, { clip, vitesse: 0 })
  }

  const codes = new Set<CodeAvatar>(passants.map((p) => p.av))
  if (scenes) for (const code of Object.values(FIGURANTS)) codes.add(code)
  for (const code of codes) {
    const { scene: modele } = await chargerGlb(`${AVATARS[code]}.glb`)
    if (!vivante()) return libererTout()
    const tribu = TRIBUS[code]
    // Sous la cagoule et sous la crête, pas de cheveux : leurs mèches ne sont ni montées ni chargées.
    if (!STYLE_TRIBU[tribu].cheveux) {
      const meches: THREE.Mesh[] = []
      modele.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.isMesh && ((mesh.material as THREE.Material).userData as ExtrasMatiere).cheveux)
          meches.push(mesh)
      })
      for (const mesh of meches) {
        mesh.removeFromParent()
        mesh.geometry.dispose()
        ;(mesh.material as THREE.Material).dispose()
      }
    }
    const aCharger: [string, boolean][] = []
    modele.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const e = m.userData as ExtrasMatiere
        if (e.couleur) aCharger.push([e.couleur, true])
        if (e.normale) aCharger.push([e.normale, false])
      }
    })
    for (const [nom, couleur] of aCharger) {
      if (textures.has(nom)) continue
      textures.set(nom, await chargerTexture(nom, couleur))
      if (!vivante()) return libererTout()
    }
    // Les matières sont partagées entre les morceaux d'une même matière d'origine, et entre les copies
    // d'une même personne : un programme, pas dix-huit.
    remplacerMatieres(modele, (mesh) => matiere(mesh, textures, tribu))
    modeles.set(code, modele)
  }

  const groupe = new THREE.Group()
  groupe.name = 'foule-rocketbox'
  const ombreTexture = texteRadiale([
    [0, 'rgba(0,0,0,0.85)'],
    [0.5, 'rgba(0,0,0,0.45)'],
    [1, 'rgba(0,0,0,0)']
  ])
  const ombreGeo = new THREE.PlaneGeometry(0.95, 0.95)
  const ombreMat = new THREE.MeshBasicMaterial({
    map: ombreTexture,
    transparent: true,
    depthWrite: false,
    opacity: FOULE.ombre
  })
  const nouvelleOmbre = (): THREE.Mesh => {
    const ombre = new THREE.Mesh(ombreGeo, ombreMat)
    ombre.rotation.x = -Math.PI / 2
    groupe.add(ombre)
    return ombre
  }
  const gens: Personne[] = []
  // Les accessoires des tribus, accrochés aux os de chaque copie (crête, épaulettes, collier, chaîne).
  const tailleur = creerTailleur()
  let rang = 0
  for (const p of passants) {
    // UN PASSANT PAR TÂCHE : copier un squelette et lier sa marche (106 pistes) coûte quelques
    // millisecondes ; les dix-huit d'un bloc faisaient une tâche de 80 à 190 ms (sonde du 2026-10-17).
    await tache()
    if (!vivante()) return libererTout()
    const modele = modeles.get(p.av)
    const marche = clips.get(p.marche)
    if (!modele || !marche) throw new Error(`[decor] passant incomplet : ${p.av} / ${p.marche}`)
    const { racine, bassin } = copier(modele)
    tailleur.habiller(racine, p.av, rang++)
    const mixer = new THREE.AnimationMixer(racine)
    const action = mixer.clipAction(marche.clip)
    action.timeScale = p.vit
    action.play()
    action.time = (p.dec * marche.clip.duration) % marche.clip.duration
    groupe.add(racine)
    gens.push({
      p,
      racine,
      bassin,
      mixer,
      vitesse: marche.vitesse * p.vit,
      ombre: nouvelleOmbre()
    })
  }

  // ---------- LES FIGURANTS : le deal contre le mur, le fumeur à la rambarde ----------
  const extras: THREE.Texture[] = [ombreTexture]
  let animerScenes: ((dt: number, lieux: Lieux) => Obstacle[]) | null = null
  if (scenes) {
    const figurant = async (code: CodeAvatar, gestes: string[]): Promise<Figurant | null> => {
      await tache()
      if (!vivante()) return null
      const modele = modeles.get(code)
      if (!modele) throw new Error(`[decor] figurant absent : ${code}`)
      const { racine, bassin } = copier(modele)
      tailleur.habiller(racine, code, rang++)
      const mixer = new THREE.AnimationMixer(racine)
      const actions = new Map<string, THREE.AnimationAction>()
      for (const nom of gestes) {
        const c = clips.get(nom)
        if (!c) throw new Error(`[decor] geste absent : ${nom}`)
        actions.set(nom, mixer.clipAction(c.clip))
      }
      groupe.add(racine)
      return {
        racine,
        bassin,
        mixer,
        actions,
        courant: null,
        ombre: nouvelleOmbre(),
        os(nom) {
          const o = racine.getObjectByName(nom)
          if (!o) throw new Error(`[decor] os absent : ${nom}`)
          return o
        }
      }
    }
    const dealer = await figurant(FIGURANTS.dealer, [
      'm_cell_phone_textmessage',
      'm_gestic_talk_cool'
    ])
    const client = await figurant(FIGURANTS.client, [MARCHE_CLIENT, ...Object.values(GESTE_CLIENT)])
    const fumeur = await figurant(FIGURANTS.fumeur, [FUMEUR.geste])
    const peintre = scenes.tag
    const taggeur = peintre
      ? await figurant(FIGURANTS.taggeur, [...Object.values(TAGGEUR.gestes), TAGGEUR.marche])
      : null
    if (!dealer || !client || !fumeur || (peintre && !taggeur)) return libererTout()
    const vMarche = clips.get(MARCHE_CLIENT)?.vitesse || 1
    jouer(dealer, 'm_cell_phone_textmessage')
    jouer(fumeur, FUMEUR.geste)
    // Les objets tenus vivent dans le repère de la main : les os sont en centimètres (échelle 0,01).
    const telephone = new THREE.Mesh(
      new THREE.BoxGeometry(7, 1, 14),
      new THREE.MeshBasicMaterial({ color: 0x9fe8ff })
    )
    telephone.position.set(9, -2, 2)
    dealer.os('Bip01_R_Hand').add(telephone)
    const paquet = new THREE.Mesh(
      new THREE.BoxGeometry(11, 5, 8),
      new THREE.MeshStandardMaterial({ color: 0x7a6a50, roughness: 0.9 })
    )
    paquet.position.set(9, -3, 2)
    paquet.visible = false
    client.os('Bip01_R_Hand').add(paquet)
    const haloTexture = texteRadiale([
      [0, 'rgba(255,255,255,1)'],
      [0.25, 'rgba(255,255,255,0.45)'],
      [1, 'rgba(255,255,255,0)']
    ])
    const braise = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: haloTexture,
        color: 0xff7a2a,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false
      })
    )
    braise.position.set(11, -1, 4)
    braise.scale.set(10, 10, 1)
    fumeur.os('Bip01_R_Hand').add(braise)
    const fumeeTexture = texteRadiale([
      [0, 'rgba(255,255,255,0.75)'],
      [0.6, 'rgba(255,255,255,0.25)'],
      [1, 'rgba(255,255,255,0)']
    ])
    const bouffee = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: fumeeTexture,
        color: 0xd6cce6,
        transparent: true,
        opacity: 0,
        depthWrite: false
      })
    )
    groupe.add(bouffee)
    extras.push(haloTexture, fumeeTexture)

    // La bombe du taggeur dans sa main droite (centimètres, comme le téléphone) ; sa buse au bout.
    const buse = new THREE.Object3D()
    if (taggeur) {
      const bombe = new THREE.Mesh(
        new THREE.CylinderGeometry(3.2, 3.2, 20, 12),
        new THREE.MeshStandardMaterial({ color: 0x1a1824, metalness: 0.8, roughness: 0.3 })
      )
      bombe.position.set(9, -2, 3)
      bombe.rotation.z = Math.PI / 2
      buse.position.set(0, 11, 0)
      bombe.add(buse)
      taggeur.os('Bip01_R_Hand').add(bombe)
    }
    const vMarcheTag = clips.get(TAGGEUR.marche)?.vitesse || 1
    const xTaggeur = scenes.facade - TAGGEUR.ecartMur
    const gesteTag = {
      secoue: TAGGEUR.gestes.secoue,
      trait: TAGGEUR.gestes.trait,
      regarde: TAGGEUR.gestes.regarde,
      marche: TAGGEUR.marche
    } as const
    const pointBuse = new THREE.Vector3()
    const vise = new THREE.Vector3()
    /** La part déjà peinte : `null` avant la première image (le mur garde alors son mot fini). */
    let peint: number | null = null
    let fini = true

    const tmp = new THREE.Vector3()
    const tete = new THREE.Vector3()
    let aLaBouche = false
    let ageBouffee = Infinity
    const poser = (f: Figurant, x: number, z: number, cap: number): void => {
      f.racine.position.set(x, sol, z)
      f.racine.rotation.y = cap
      f.racine.updateMatrixWorld(true)
      f.bassin.getWorldPosition(tmp)
      f.ombre.position.set(tmp.x, sol + 0.012, tmp.z)
    }
    const xDealer = scenes.facade - DEAL.ecartDealer
    const xClient = scenes.facade - DEAL.ecartClient
    const xFumeur = scenes.garde + FUMEUR.ecartRambarde
    const mainFumeur = fumeur.os('Bip01_R_Hand')
    const teteFumeur = fumeur.os('Bip01_Head')
    animerScenes = (dt, lieux) => {
      // le dealer : son téléphone, puis le client
      const ed = etatDealer(lieux.deal, scenes.vRue, vMarche)
      jouer(dealer, ed.geste)
      telephone.visible = ed.geste === 'm_cell_phone_textmessage'
      dealer.mixer.update(dt)
      poser(dealer, xDealer, lieux.deal + DEAL.dzDealer, ed.cap)
      // le client
      const ec = etatClient(lieux.deal, scenes.vRue, vMarche)
      client.racine.visible = ec.visible
      client.ombre.visible = ec.visible
      const geste = ec.geste === 'marche' ? MARCHE_CLIENT : GESTE_CLIENT[ec.geste]
      const action = jouer(client, geste)
      paquet.visible =
        ec.geste === 'prend' && action.time > DEAL.paquet[0] && action.time < DEAL.paquet[1]
      client.mixer.update(dt)
      const zClient = lieux.deal + ec.rel
      poser(client, xClient, zClient, ec.cap)
      // le fumeur : la braise rougit quand il tire, la fumée sort quand la main redescend
      fumeur.mixer.update(dt)
      poser(fumeur, xFumeur, lieux.fumeur, FUMEUR.cap)
      mainFumeur.getWorldPosition(tmp)
      teteFumeur.getWorldPosition(tete)
      const bouche = tmp.distanceTo(tete) < FUMEUR.bouche
      braise.material.opacity = bouche ? 1 : 0.65
      if (aLaBouche && !bouche) {
        ageBouffee = 0
        // devant le visage, du côté de la ville qu'il regarde
        bouffee.position.copy(tete).add(tmp.set(-0.12, 0.02, 0))
      }
      aLaBouche = bouche
      ageBouffee += dt
      const vie = ageBouffee / FUMEUR.bouffee
      if (vie < 1) {
        bouffee.position.x -= 0.22 * dt
        bouffee.position.y += 0.18 * dt
        bouffee.scale.setScalar(0.18 + vie * 0.7)
        bouffee.material.opacity = 0.5 * Math.sin(Math.PI * Math.min(1, vie * 1.4))
      } else bouffee.material.opacity = 0
      // le taggeur : il bombe le mur, la peinture se pose là où vise sa bombe
      let zTaggeur: number | null = null
      if (taggeur && peintre && lieux.tag !== undefined) {
        const et = etatTaggeur(lieux.tag, scenes.vRue, vMarcheTag)
        jouer(taggeur, gesteTag[et.geste])
        taggeur.mixer.update(dt)
        zTaggeur = lieux.tag + et.rel
        poser(taggeur, xTaggeur, zTaggeur, et.cap)
        // Le mur réapparaît au fond (la part peinte retombe) : vierge, mot suivant. À la première image,
        // il n'est effacé que si le taggeur n'a pas encore commencé : sinon il garde son mot fini.
        if ((peint === null && et.peinture === 0) || (peint !== null && et.peinture < peint)) {
          peintre.nouveau()
          fini = false
        }
        peint = et.peinture
        if (!fini) {
          peintre.devoiler(et.peinture)
          if (et.bombe) {
            buse.getWorldPosition(pointBuse)
            // la bombe vise le mur droit devant lui : il fait face à la façade
            vise.set(peintre.xMur, pointBuse.y, pointBuse.z)
            peintre.bomber(pointBuse, vise)
          } else peintre.relacher()
          if (et.peinture >= 1) {
            peintre.finir()
            fini = true
          }
        } else peintre.relacher()
      }
      // les passants contournent les figurants, côté chaussée
      const versLaChaussee = (x: number): -1 | 1 => (x > 0 ? -1 : 1)
      const obstacles: Obstacle[] = [
        {
          x: xDealer,
          z: lieux.deal + DEAL.dzDealer,
          cote: versLaChaussee(xDealer),
          ...ECART_FIGURANT
        },
        { x: xFumeur, z: lieux.fumeur, cote: versLaChaussee(xFumeur), ...ECART_FIGURANT }
      ]
      if (ec.visible)
        obstacles.push({ x: xClient, z: zClient, cote: versLaChaussee(xClient), ...ECART_FIGURANT })
      if (zTaggeur !== null)
        obstacles.push({
          x: xTaggeur,
          z: zTaggeur,
          cote: versLaChaussee(xTaggeur),
          ...ECART_FIGURANT
        })
      return obstacles
    }
  }

  const v = new THREE.Vector3()
  return {
    groupe,
    textures: [...textures.values(), ...extras, ...tailleur.textures()],
    animer(t, dt, defile, camera, lieux) {
      const obstacles = animerScenes && lieux ? animerScenes(dt, lieux) : []
      for (const g of gens) {
        g.mixer.update(dt)
        const z = positionZ(g.p, g.vitesse, t, defile)
        let x = g.p.x
        for (const o of obstacles) x = ecarter(x, z, o)
        // La caméra en dernier : personne ne la traverse, même en contournant un figurant.
        x = ecarterDeLaCamera(x, z, camera.x, camera.z)
        g.racine.position.set(x, sol, z)
        g.racine.rotation.y = g.p.sens === 1 ? Math.PI : 0
        g.racine.updateMatrixWorld(true)
        g.bassin.getWorldPosition(v)
        g.ombre.position.set(v.x, sol + 0.012, v.z)
      }
    }
  }
}
