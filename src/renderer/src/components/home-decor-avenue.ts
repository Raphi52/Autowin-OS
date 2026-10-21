import * as THREE from 'three'
import type { DecorScene } from './home-decor-scene'
import { nouvelleToile } from './decor-toile'
import {
  chargerFoule,
  FOULE,
  HEURE_DE_POINTE,
  type Foule,
  type PeintreTag
} from './home-decor-foule'
import { monterSpirale } from './home-decor-avenue-spirale'
import { monterToile } from './home-decor-avenue-toile'
import { GAREE, monterVoitures } from './home-decor-avenue-voitures'
import { AMBIANCE_KOWLOON, monterVille } from './home-decor-avenue-ville'
import { eclaircieVaisseau, monterVaisseau } from './home-decor-avenue-vaisseau'
import { hauteurMurRangee, monterRangee, VITRINES_RANGEE } from './home-decor-avenue-rangee'
import { regrouperHalos } from './home-decor-lots-halos'

/**
 * LE FOND DE L'ACCUEIL : UNE AVENUE CYBERPUNK SOUS L'ORAGE.
 *
 * Demande de l'utilisateur (conv-301) : « /draft un tout nouveau fond 3d pour l'accueil qui
 * s'inspire un peu de cette image notre theme ville cyberpunk obscure street tag et de notre theme
 * noir holo », puis, après des tours de brouillon, « Passe au vrai fond de l'Accueil avec ce look ».
 * « Ce look », c'est le brouillon `.autowin-tmp/draft-cyber/r-avenue.js` : une avenue en corniche,
 * la foule sous la pluie, le mur tagué, la porte du deal contre le mur de sa photo, et toute la ville
 * en contrebas.
 *
 * LA FOULE EST RÉELLE DEPUIS conv-312 : « /draft les humains les plus realiste possible pour le fond
 * decran d'accueil », puis « Implémenter la 6 · Heure de pointe ». Les corps sculptés par code et
 * leurs scènes (le deal, le taggeur, le couple, le fumeur) sont remplacés par 18 passants Microsoft
 * Rocketbox animés par capture de mouvement : voir `home-decor-foule.ts`.
 *
 * LA TOILE ÉLECTRIQUE DEPUIS conv-311 : « /draft des éléments plus trash et chaotiques pour le fond
 * d'écran d'acceuil », puis « je choisi que tu implémente le 3 » (variante 3 · Toile électrique du
 * mélange Dépotoir + Jungle de câbles + Glitch holo). Le ciel de la rue devient un filet de câbles
 * nus (guirlandes retirées ensuite à sa demande) et de pubs holo pendues aux fils, avec des câbles
 * arrachés qui crachent des étincelles et deux enseignes qui lâchent : voir `home-decor-avenue-toile.ts`.
 *
 * LA SPIRALE DEPUIS conv-310 : « /draft des moyens de rendre le fond d'écran de l'acceuil
 * magnifique effet waouh maximum », puis « implémente spirale ». Toute la chaussée devient un
 * miroir d'eau, deux koïs holo nagent sur la ville, une tour de contrôle se dresse au milieu, et
 * une rame express monte en hélice autour d'elle : voir `home-decor-avenue-spirale.ts`.
 *
 * LE CIEL EST UNE ÉCLAIRCIE LUNAIRE DEPUIS conv-319 : « /draft le fond le ciel violet de
 * l'acceuil », « Affiner la 4 · Azur d'orage », puis « implémente la 5 et met un vaisseau mere ».
 * Plus de violet : nuit bleue, plafond de nuages, trouée et lune, orage lointain (`CIEL_LUNAIRE`),
 * et, au-dessus de la ville, UN vaisseau mère choisi par /draft (« Implémenter la 6 · Anneaux
 * d'approche ») : une roue dont le moyeu porte une ville éclairée, des cercles de feux d'atterrissage
 * dessous, voir `home-decor-avenue-vaisseau.ts`.
 *
 * LA VILLE DE GAUCHE EST UN KOWLOON NÉON DEPUIS conv-315 : « /draft refais la ville de gauche du
 * fond d'écran de l'accueil », « Affiner la 2 · Kowloon néon », puis « implémente 6 » (Néons
 * animés). Les tours-boîtes, les holo-panneaux du centre et les voies rapides laissent place à un
 * quartier bas et serré, hérissé d'enseignes dont le texte défile, avec cinq hologrammes au-dessus
 * des toits : voir `home-decor-avenue-ville.ts`.
 *
 * LES VOITURES SONT TOUTES DIFFÉRENTES DEPUIS conv-320 : « refais les voitures du fond d'écran de
 * l'accueil pour qu'elles soient toutes différentes et mets en une garée avec un style futuriste top
 * qualité comme les piétons ». Les deux caisses extrudées identiques et la moto en pavés laissent
 * place à quatre carrosseries continues (hypercar, fourgon à facettes, berline volante, moto carénée)
 * et à une GT nacrée garée en charge le long du trottoir de droite : voir `home-decor-avenue-voitures.ts`.
 *
 * LA RANGÉE DE DROITE EST EN VOLUMES DEPUIS conv-1037 : « la barre d'immeuble de droite a les toits
 * qui forment une ligne droite ca fait pas naturelle et les boutiques et tags font trop basique »,
 * puis, après deux tours de /draft, « implémenter 1+2 ». Le plan peint de 140 × 24 m laisse place à
 * une pagode-tour qui se coiffe étage par étage sous sa grue, une ruelle de yatai dans une dent
 * creuse, un pignon mitoyen aux papiers peints repeint d'un 夢, et des machiya basses : voir
 * `home-decor-avenue-rangee.ts`.
 *
 * CE QUI EST REPRIS TEL QUEL : la géométrie, les nuanceurs, les couleurs et les animations du
 * brouillon.
 *
 * CE QUI CHANGE, parce qu'un fond n'est pas une démo :
 *   - un seul réglage, le n° 6 du brouillon, « Fond d'accueil » (lent et calme, pour passer derrière
 *     les widgets) ; plus de boutons, de touches 1 à 6 ni de légende ;
 *   - la caméra est POSÉE et ne suit que le pointeur (`look`) : plus de contrôles orbitaux, qui
 *     auraient volé la souris aux widgets ;
 *   - le temps vient de l'appelant (`render(elapsed)`) : la limite d'images et la pause quand la
 *     fenêtre est cachée de `DecorDeFond` s'appliquent ;
 *   - la rue entre EN FONDU dès que ses nuanceurs sont compilés (0,6 à 0,8 s mesurés,
 *     `MARQUES_AVENUE`), la foule la rejoint quand ses fichiers sont chargés et compilés ;
 *   - tout ce qui est créé est libéré par `dispose`.
 *
 * LES TEXTURES DE LA RUE SONT DESSINÉES PAR CODE (tags, enseignes, façades) : ce fichier ne charge
 * aucune image, et la photo d'inspiration de l'utilisateur n'est PAS plaquée. Seule la foule charge
 * des fichiers, ceux de `assets/foule-rocketbox`. Le contrat voisin le vérifie.
 */

/** Le réglage n° 6 du brouillon, « Fond d'accueil » : lent et calme, pour passer derrière les widgets. */
export const AVENUE = {
  /** Vitesse de la marche, en m/s : on avance au pas sur le trottoir. */
  vitesse: 0.45,
  /** Amplitude du balancement de tête de la marche. */
  bob: 0.25,
  /** Force de la pluie : plus fine sous l'éclaircie lunaire (conv-319), 0,35 contre 0,5 au brouillon. */
  pluie: 0.7,
  /** Un éclair toutes les `orage` secondes : l'orage s'éloigne sous l'éclaircie lunaire (conv-319). */
  orage: 22,
  /** Une enseigne qui claque en gerbe d'étincelles toutes les `gerbe` secondes. */
  gerbe: 16,
  /** Une voiture toutes les `voitures` secondes. */
  voitures: 16,
  /** Nombre de passants : la direction « Heure de pointe » en compte 18 (conv-312). */
  passants: HEURE_DE_POINTE.length,
  /** Densité des voitures volantes au-dessus de la ville. */
  vols: 0.4,
  /** Réverbères, enseignes et projecteur baissés. */
  sombre: true
} as const

/**
 * LE CIEL « ÉCLAIRCIE LUNAIRE » (conv-319) : « /draft le fond le ciel violet de l'acceuil », puis
 * « Affiner la 4 · Azur d'orage », puis « implémente la 5 et met un vaisseau mere ». C'est la 5 du
 * tour 2 (`.autowin-tmp/draft-ciel/t2/scene.js`, `V[4]`) : l'orage s'éloigne, une trouée s'ouvre dans
 * un plafond de nuages bleus, une lune y brille et argente le bord des nuages. Plus aucun violet :
 * l'utilisateur veut du rose et du bleu francs (conv-159).
 *
 * Les couleurs sont celles du brouillon, en hexadécimal sRGB : `THREE.Color` les convertit comme le
 * brouillon le faisait. La lueur de l'horizon et la brume de la ville sont dans `AMBIANCE_KOWLOON`.
 */
export const CIEL_LUNAIRE = {
  /** Le fond de la scène et le brouillard de la rue. */
  fond: 0x070d18,
  /** Ce que devient le fond au plus fort d'un éclair (à 50 %). */
  flash: 0x6c8ac8,
  /** Le dégradé du ciel, du haut vers l'horizon. */
  zenith: 0x02050c,
  bas: 0x0a1830,
  /** Le plafond de nuages : couverture, dessous éclairé, dessus sombre, vent, taille. */
  nuages: { couverture: 0.75, dessous: 0x1a3c6e, dessus: 0x050a14, vent: 0.02, echelle: 1.3 },
  /** La lumière d'un éclair dans le ciel et les nuages. */
  eclair: 0xcfe3ff,
  /**
   * La lune, au milieu de sa trouée, à GAUCHE, au-dessus de la ville. Elle était en haut au centre
   * (azimut 0,19, hauteur 0,455) ; l'utilisateur a choisi de mettre le vaisseau mère à cette place
   * (conv-319, 2026-10-18 : « Au centre en haut, en grand : je déplace la lune à gauche au-dessus de
   * la ville et j'éclaircis les câbles devant le vaisseau »). Sur son écran (1745 × 938, tuiles
   * masquées), elle est en (470, 130) : sous le titre « Autowin Accueil » (y 40 à 87), au-dessus des
   * hologrammes de la ville. Plus à droite, la façade la cache (capture du 2026-10-17, azimut 0,4).
   */
  lune: { azimut: -0.303, hauteur: 0.336 }
} as const

/** La direction de la lune vue de la rue (azimut compté depuis −z vers +x, hauteur en radians). */
export function directionLune(): THREE.Vector3 {
  const { azimut, hauteur } = CIEL_LUNAIRE.lune
  return new THREE.Vector3(
    Math.sin(azimut) * Math.cos(hauteur),
    Math.sin(hauteur),
    -Math.cos(azimut) * Math.cos(hauteur)
  )
}

/**
 * LE VIADUC DU MÉTRO AÉRIEN : position dans la boucle de la marche (`z`, une copie tous les
 * `boucle` m, `copies` copies), hauteur et section du tablier, bout du béton côté ville (`gauche`)
 * et bout de la voie holographique qui file au-dessus du vide (`fin`), en x.
 *
 * LE BÉTON S'ARRÊTE APRÈS LA RAMBARDE (conv-310, 2026-10-17, « Écarte les viaducs du métro aérien
 * de la zone de la tour, pour qu'on voie toute la spirale ») : jusqu'à x = −230, avec trois piles,
 * la boucle de la marche gardait toujours une ou deux dalles entre la caméra et la tour, qui
 * coupaient l'hélice de la Spirale en bandes. Au-delà de x = −12, le tablier couvre l'hélice à un
 * moment de la boucle, et une pile dans le vide aussi, même collée à la rambarde (projection dans
 * la fenêtre de l'utilisateur, 1745 × 938). Au-dessus du vide, la voie n'est plus que lumière.
 */
export const VIADUC = {
  z: -5,
  boucle: 70,
  copies: 3,
  y: 10.2,
  epaisseur: 1.3,
  profondeur: 3.2,
  gauche: -11,
  fin: -230
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

/** Plafond de densité de pixels : au-delà, le coût par pixel monte sans que ça se voie. */
const PLAFOND_RATIO = 1.75

type Toile = [HTMLCanvasElement, CanvasRenderingContext2D]
type MeshBasique = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>

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

/**
 * Où et comment l'avenue se dessine. Sans options : dans la page, sur son propre canevas.
 * Dans un Worker (decor-avenue.worker.ts, conv-323) : sur le canevas transféré, sans `window`.
 */
export interface OptionsAvenue {
  /** Le canevas transféré au Worker (`transferControlToOffscreen`). */
  canvas?: OffscreenCanvas
  /** La densité de pixels de l'écran, que le Worker reçoit de la page. */
  ratio?: () => number
  /** Appelé à la première image de la rue, à la place du fondu que la page fait elle-même. */
  surApparition?: () => void
  /**
   * LE REFLET APRÈS L'IMAGE, dans une tâche à part (Worker, conv-347). `render` ne dessine plus le
   * reflet : `apresImage` le fait, juste après, pour l'image SUIVANTE. Raison : une image ne s'affiche
   * qu'à la fin de la tâche qui la dessine ; le reflet (une image sur deux) retardait donc une image
   * sur deux d'environ 20 ms, et les écarts entre images alternaient 33 / 67 ms (« pas lissé »).
   * Le reflet a une image de retard de plus — l'eau, ridée par la pluie à chaque image, ne le montre
   * pas (même raisonnement que `REFLET_UNE_IMAGE_SUR`). Dans la page, rien ne change.
   */
  refletApresImage?: boolean
}

export function createAvenueScene(options: OptionsAvenue = {}): DecorScene | null {
  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: options.canvas,
      antialias: true,
      powerPreference: 'default'
    })
  } catch {
    return null
  }
  try {
    return monterAvenue(renderer, options)
  } catch (erreur) {
    // Le décor reste un DÉCOR : une scène qui ne se monte pas laisse l'Accueil sans fond 3D, elle
    // ne le casse pas. L'erreur est écrite en console pour rester visible.
    console.error("[decor] l'avenue n'a pas pu être montée :", erreur)
    renderer.dispose()
    return null
  }
}

/**
 * REPÈRES DE TEMPS DE L'APPARITION, lisibles par `performance.getEntriesByName('decor-avenue:…')`.
 *
 * Depuis que la rue attend la fin de sa compilation pour se dessiner (conv-301, gel corrigé), il
 * existe un délai entre l'ouverture de l'Accueil et la première image de la rue. Sans repère, ce
 * délai ne se mesurait pas : la sonde de l'Accueil lit ces trois marques —
 * `cree` (scène montée), `rue-visible` (première image dessinée), `foule-visible` (la foule entre).
 */
export const MARQUES_AVENUE = {
  cree: 'decor-avenue:cree',
  /**
   * La rue est compilée : elle sera dessinée à l'image suivante. Posée hors de la boucle d'images,
   * cette marque ne dépend pas de leur cadence — dans l'instance cachée, Windows ne compose pas le
   * bureau et le navigateur n'y produit qu'UNE image par seconde (mesuré le 2026-10-17), ce qui
   * retarde `rue-visible` jusqu'à 1 s sans que l'utilisateur ne le voie jamais.
   */
  rueCompilee: 'decor-avenue:rue-compilee',
  rueVisible: 'decor-avenue:rue-visible',
  /**
   * La version « reflet » des programmes est compilée et finalisée : l'eau commence à refléter. Depuis
   * conv-337, la rue n'attend plus son reflet pour apparaître ; ce repère mesure l'écart.
   */
  refletPret: 'decor-avenue:reflet-pret',
  /** Les personnes et leurs textures sont chargées ; la compilation de leurs nuanceurs commence. */
  fouleChargee: 'decor-avenue:foule-chargee',
  fouleVisible: 'decor-avenue:foule-visible'
} as const

/**
 * Dans un Worker, les marques tombent dans le journal de performance DU WORKER, que les sondes de
 * la page ne lisent pas : le Worker branche ici leur recopie vers la page.
 */
let recopierMarque: ((nom: string) => void) | null = null
export function brancherMarquesAvenue(recopie: (nom: string) => void): void {
  recopierMarque = recopie
}

const marquer = (nom: string): void => {
  globalThis.performance?.mark?.(nom)
  recopierMarque?.(nom)
}

/**
 * LE FONDU D'ENTRÉE, en millisecondes.
 *
 * La rue n'est dessinée qu'une fois compilée : sans fondu, elle surgissait d'un coup sur le fond de
 * la page, au milieu de la lecture des tuiles. L'opacité du canevas monte de 0 à 1 sur cette durée,
 * animée par le compositeur du navigateur (`canvas.animate`) : aucun travail sur le fil principal.
 * Un fondu n'est pas un mouvement : il reste actif sous « réduire les animations ».
 */
export const FONDU_ENTREE_MS = 1200

function monterAvenue(renderer: THREE.WebGLRenderer, options: OptionsAvenue): DecorScene {
  const canvas = renderer.domElement
  // Dans un Worker, le canevas n'est pas dans la page : c'est la page qui fait le fondu.
  const dansLaPage = !options.surApparition
  marquer(MARQUES_AVENUE.cree)
  // Invisible jusqu'à sa première image : le fondu d'entrée part de là (voir `apparaitre`).
  if (dansLaPage) canvas.style.opacity = '0'
  const FOND = new THREE.Color(CIEL_LUNAIRE.fond)
  const FLASH = new THREE.Color(CIEL_LUNAIRE.flash)
  const scene = new THREE.Scene()
  // Les matrices sont mises à jour une fois par image dans `render`, avant les deux passes (reflet et
  // écran) : three les recalculait à chacune (3 416 objets, inventaire du 2026-10-18, conv-323).
  scene.matrixWorldAutoUpdate = false
  const fondCourant = FOND.clone()
  scene.background = fondCourant
  const brouillard = new THREE.FogExp2(CIEL_LUNAIRE.fond, 0.021)
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
    // dans la page OU dans le Worker (voir decor-toile.ts)
    const c = nouvelleToile(w, h)
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
  /**
   * LA RANGÉE DE DROITE (conv-1037, « implémenter 1+2 ») : des volumes à la place du plan peint de
   * 140 × 24 m — pagode-tour sous sa grue, ruelle de yatai dans une dent creuse, pignon mitoyen au 夢,
   * machiya basses (voir home-decor-avenue-rangee.ts). Montée ici, avant la compilation de la rue,
   * pour que ses programmes se compilent avec elle en tâche de fond. Elle n'ajoute aucune lumière.
   */
  const rangee = monterRangee({ decor, P, Z0, copies: L / P, FACADE, TROTTOIR, toile, tex, glow })
  // les boutiques de la rangée : [début dans la travée (m), largeur (m), couleur de la lumière]
  const VITRINES = VITRINES_RANGEE
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
  // l'éclairage d'ambiance de la rue : clair de lune bleu d'en haut, bitume mouillé d'en bas — plus de
  // violet depuis le ciel « Éclaircie lunaire » (conv-319, voir `CIEL_LUNAIRE`)
  scene.add(new THREE.HemisphereLight(0x4a62a0, 0x0d1220, 1.0))

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
  // Fixe pendant la marche (trop loin pour bouger) : 95 m plus bas, un Kowloon néon (conv-315) — un quartier bas et
  // serré hérissé d'enseignes animées, cinq hologrammes, des gratte-ciel au loin —, des voitures volantes, des
  // projecteurs qui balaient les nuages.
  const SOL = -95
  const uVille = { uT: { value: 0 }, uFlash: { value: 0 } }
  const BRUME_V = new THREE.Color(AMBIANCE_KOWLOON.brume)
  const vec3 = (v: readonly number[]): string => v.map((x) => x.toFixed(3)).join(',')
  const RUE_V = AMBIANCE_KOWLOON.rue
  const fragHaze =
    'c=mix(c,uBrume,1.0-exp(-pow(d*0.0011,1.6)));c=mix(c,uBrume*1.3,exp(-max(vW.y+95.0,0.0)*0.05)*0.35);'

  // LE CIEL « ÉCLAIRCIE LUNAIRE » (conv-319, voir `CIEL_LUNAIRE`) : le nuanceur de la 5 du brouillon.
  // Un dégradé noir-bleu, la lueur bleue de la ville sur l'horizon, un plafond de nuages qui dérive,
  // éclairé par-dessous côté ville ; une trouée autour de la lune, dont la lumière argente le bord des
  // nuages ; et l'éclair, qui blanchit le ciel et allume le nuage d'où il part (`celluleEclair`).
  const LUNE = directionLune()
  const celluleEclair = new THREE.Vector4(0, 1, 0, 0)
  const NU = CIEL_LUNAIRE.nuages
  const ciel = new THREE.Mesh(
    new THREE.SphereGeometry(4000, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uT: uVille.uT,
        uFlash: uVille.uFlash,
        uZen: { value: new THREE.Color(CIEL_LUNAIRE.zenith) },
        uBas: { value: new THREE.Color(CIEL_LUNAIRE.bas) },
        uNb: { value: new THREE.Color(NU.dessous) },
        uNh: { value: new THREE.Color(NU.dessus) },
        uFl: { value: new THREE.Color(CIEL_LUNAIRE.eclair) },
        uCell: { value: celluleEclair },
        uLune: { value: LUNE }
      },
      vertexShader:
        'varying vec3 vP;void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: [
        'uniform float uT;uniform float uFlash;uniform vec3 uZen;uniform vec3 uBas;uniform vec3 uNb;uniform vec3 uNh;',
        'uniform vec3 uFl;uniform vec4 uCell;uniform vec3 uLune;varying vec3 vP;',
        'float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
        'float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(h(i),h(i+vec2(1.0,0.0)),f.x),mix(h(i+vec2(0.0,1.0)),h(i+vec2(1.0,1.0)),f.x),f.y);}',
        'float fbm(vec2 p){float s=0.0,a=0.5;for(int i=0;i<5;i++){s+=a*n2(p);p=p*2.03+vec2(1.7,9.2);a*=0.5;}return s;}',
        'void main(){vec3 d=normalize(vP);float y=d.y;',
        '  vec3 c=mix(uBas,uZen,smoothstep(-0.05,0.5,y));',
        '  float cote=smoothstep(0.5,-0.7,d.x);',
        '  c+=vec3(' + vec3(AMBIANCE_KOWLOON.horizon) + ')*exp(-abs(y+0.01)*12.0)*(0.18+0.5*cote);',
        // l'éclair allume une plaque de ciel autour du haut de sa branche
        '  float cel=uCell.w*exp(-(1.0-dot(d,uCell.xyz))*60.0);c+=uFl*cel*0.12;',
        // la lune : son halo, puis son disque
        '  float la=1.0-dot(d,uLune);',
        '  c+=vec3(0.55,0.7,1.0)*(exp(-la*700.0)*0.35+exp(-la*90.0)*0.12);',
        '  c=mix(c,vec3(0.86,0.92,1.0)*(0.86+0.14*n2(d.xy*420.0)),smoothstep(0.00024,0.00016,la));',
        // le plafond de nuages, projeté sur un plan, qui dérive avec le vent ; la trouée autour de la lune
        '  vec2 q=d.xz/max(y+0.1,0.04)*' +
          NU.echelle.toFixed(2) +
          '+vec2(uT,uT*0.4)*' +
          NU.vent.toFixed(3) +
          ';',
        '  float n=fbm(q);',
        '  float cov=smoothstep(' +
          (1 - NU.couverture).toFixed(2) +
          ',' +
          (1.3 - NU.couverture).toFixed(2) +
          ',n);',
        '  cov*=1.0-smoothstep(0.035,0.01,la+(n-0.5)*0.03);float bord=4.0*cov*(1.0-cov);',
        '  float bas=exp(-max(y,0.0)*5.0);',
        '  vec3 nc=mix(uNh,uNb,clamp(bas*(0.45+0.7*cote)+(n-0.5)*0.8,0.0,1.0));',
        '  nc+=uFl*uFlash*(0.4+n)*1.2+uFl*cel*(0.3+1.6*n)*1.6;',
        // le liseré argenté au bord de la trouée, et le clair de lune sur le dessus des nuages proches
        '  nc+=vec3(0.7,0.82,1.0)*exp(-la*25.0)*bord*1.3+vec3(0.25,0.32,0.45)*exp(-la*8.0)*n*0.5;',
        '  c=mix(c,nc,cov*smoothstep(-0.03,0.08,y));',
        '  c+=uFl*uFlash*smoothstep(-0.1,0.5,y)*0.55;',
        '  gl_FragColor=vec4(c,1.0);',
        '#include <colorspace_fragment>',
        '}'
      ].join('\n')
    })
  )
  scene.add(ciel)

  // le sol de la ville : un damier de rues éclairées, au pas des îlots du Kowloon
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
        '  vec2 q=(vW.xz-vec2(-41.0,239.0))/' + RUE_V.pas.toFixed(1) + ';',
        '  vec2 e=abs(fract(q+0.5)-0.5)*' + RUE_V.pas.toFixed(1) + ';',
        '  float l=1.4+d*0.003;',
        '  float rue=exp(-min(e.x,e.y)/l);',
        '  vec2 id=floor(q+0.5);',
        '  float h=fract(sin(dot(id,vec2(12.9898,78.233)))*43758.5453);',
        '  vec3 c=vec3(0.025,0.014,0.035)+mix(vec3(' +
          vec3(RUE_V.a) +
          '),vec3(' +
          vec3(RUE_V.b) +
          '),h)*rue*' +
          RUE_V.force.toFixed(2) +
          ';',
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

  // LE KOWLOON NÉON (conv-315, « implémente 6 ») : un quartier bas et serré hérissé d'enseignes dont le
  // texte défile, cinq hologrammes au-dessus des toits, et au loin les gratte-ciel en silhouette. Monté ICI,
  // avant la compilation de la rue : ses programmes se compilent avec elle en tâche de fond.
  const villeBasse = monterVille({
    scene,
    SOL,
    uT: uVille.uT,
    uFlash: uVille.uFlash,
    uBrume: { value: BRUME_V },
    camera: CAMERA_AVENUE.position,
    canevas: canvas,
    toile,
    textures
  })

  // LE VAISSEAU MÈRE (conv-319, « Implémenter la 6 · Anneaux d'approche ») : une cité sur le moyeu d'une
  // roue, au-dessus de la ville, à gauche. Monté ICI, avant la compilation de la rue, comme la ville.
  const vaisseau = monterVaisseau({
    scene,
    uT: uVille.uT,
    uFlash: uVille.uFlash,
    uBrume: { value: BRUME_V },
    lune: LUNE,
    camera: CAMERA_AVENUE.position,
    canevas: canvas,
    GLOW
  })

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

  // les nuages bas, éclairés par la ville : dans les bleus du plafond de l'éclaircie lunaire (conv-319),
  // et effacés autour de la lune pour ne pas refermer sa trouée (`horsTrouee`)
  const nuages: THREE.Sprite[] = []
  const OEIL_NUAGES = new THREE.Vector3(...CAMERA_AVENUE.position)
  const versNuage = new THREE.Vector3()
  const horsTrouee = (s: THREE.Sprite): number =>
    THREE.MathUtils.smoothstep(
      versNuage.subVectors(s.position, OEIL_NUAGES).normalize().angleTo(LUNE),
      0.12,
      0.32
    )
  for (let i = 0; i < 44; i++) {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: FUMEE,
        color: rnd() < 0.5 ? 0x1f4a86 : 0x14305a,
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
    s.material.opacity = 0.16 * horsTrouee(s)
    scene.add(s)
    nuages.push(s)
  }

  // l'éclair, au-dessus de la ville : blanc bleuté, et le nuage d'où il part s'allume (`celluleEclair`)
  const eclairMat = new THREE.MeshBasicMaterial({
    color: 0xdfeaff,
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
    // le ciel s'allume autour du haut de la branche : sa direction vue de la rue
    const haut = new THREE.Vector3(x, 260, z).sub(OEIL_NUAGES).normalize()
    celluleEclair.set(haut.x, haut.y, haut.z, celluleEclair.w)
    for (let b = 0; b < 3; b++) {
      const q = tronc[1 + Math.floor(rnd() * (tronc.length - 3))]
      branche(q.x, q.y, q.z, q.y - 40 - rnd() * 60, 0.9)
    }
    scene.add(groupe)
  }

  // ---------- LE MÉTRO AÉRIEN : son viaduc traverse l'avenue et file au-dessus du vide ----------
  const PONT = VIADUC.z
  /**
   * Les arêtes holo du viaduc ne se voient pas dans l'eau : mesuré au banc de rendu (conv-337), les
   * retirer du seul reflet laisse l'image au niveau du bruit du banc. Elles n'y sont plus dessinées.
   */
  const aretesViaduc: THREE.Object3D[] = []
  {
    const beton = new THREE.MeshStandardMaterial({ color: 0x0d0b12, roughness: 0.8 })
    // la voie au-dessus du vide : les quatre arêtes du tablier en lumière, rien qui cache la ville
    const holo = new THREE.MeshBasicMaterial({
      color: 0x2ee8ff,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
    const longueurHolo = VIADUC.gauche - VIADUC.fin
    const areteHolo = new THREE.BoxGeometry(longueurHolo, 0.08, 0.08)
    for (let k = 0; k < VIADUC.copies; k++) {
      const g = new THREE.Group()
      g.position.z = PONT - k * W
      const pont = new THREE.Mesh(
        new THREE.BoxGeometry(FACADE - VIADUC.gauche, VIADUC.epaisseur, VIADUC.profondeur),
        beton
      )
      pont.position.set((FACADE + VIADUC.gauche) / 2, VIADUC.y, 0)
      g.add(pont)
      for (const dy of [-1, 1])
        for (const dz of [-1, 1]) {
          const arete = new THREE.Mesh(areteHolo, holo)
          arete.position.set(
            (VIADUC.gauche + VIADUC.fin) / 2,
            VIADUC.y + (dy * VIADUC.epaisseur) / 2,
            (dz * VIADUC.profondeur) / 2
          )
          arete.name = 'viaduc-holo'
          aretesViaduc.push(arete)
          g.add(arete)
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
  const strobes = ([[0, 0xffd9a8]] as const).map(([x, c]) => {
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
  // Cinq véhicules tous différents, dont une GT garée le long du trottoir de droite (conv-320) :
  // voir `home-decor-avenue-voitures.ts`. Aucune lumière ajoutée, phares et feux restent peints.
  const flotte = monterVoitures({
    scene,
    renderer,
    glow,
    trainee,
    emettre,
    toile,
    tex,
    GLOW,
    TROTTOIR
  })
  function circulation(t: number, v: number): void {
    secousse = Math.max(
      secousse,
      flotte.animer(t, v, p.voitures, zVisible(GAREE.zp), camera.position.z)
    )
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
  const eclairLum = new THREE.HemisphereLight(0xcfe3ff, 0x101a30, 0)
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
    celluleEclair.w = f * 1.4
    fondCourant.copy(FOND).lerp(FLASH, f * 0.5)
    brouillard.color.copy(fondCourant)
    if (eclair) eclair.visible = f > 0.1
    nuages.forEach((s) => (s.material.opacity = (0.16 + f * 0.5) * horsTrouee(s)))
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

  // ---------- LES LIEUX DES ANCIENNES SCÈNES : la porte du deal et le mur tagué restent dans la rue ----------
  const Z_DEAL = -25
  const Z_TAG = -45
  /** Le fumeur accoudé à la rambarde, face à la ville (rejoué par un humain réel, conv-312). */
  const Z_FUMEUR = -42
  // la porte de service derrière le dealer et son néon rose qui grésille (comme la photo) : elle fait partie de la rue
  const lampeDeal = new THREE.Group()
  scene.add(lampeDeal)
  /*
   * HUIT LUMIÈRES CALCULÉES, PAS VINGT-DEUX (2026-10-17, conv-301). Avec 22 lumières dans chaque
   * programme et des matières « physiques » pour la foule, la finalisation des programmes
   * (`onFirstUse` de three) prenait encore 4,7 s de fil principal : un gel de 6 à 7 s à l'ouverture
   * de l'Accueil, mesuré deux fois dans l'instance cachée. Restent dans la scène : 2 réverbères,
   * 2 enseignes, 1 strobe du métro, le feu du drone, son projecteur et le néon du deal. L'arc
   * électrique, le feu bleu et les phares gardent leur animation mais ne sont plus ajoutés à la
   * scène : leur lumière est peinte par les halos.
   *
   * Depuis conv-312, la foule est réelle (`home-decor-foule.ts`), en matière « standard », et
   * n'ajoute AUCUNE lumière : le nombre de lumières, qui fait partie de la clé de chaque programme,
   * reste le même avant et après son arrivée.
   */
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
    n: 0,
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
  }
  /** Le mot fini sur le mur, et ses coulures. */
  function acheverTag(): void {
    tg.vg.drawImage(tg.fc2, 0, 0)
    tg.vg.strokeStyle = tg.remplissage
    tg.vg.lineCap = 'round'
    tg.coulures.forEach((d) => {
      tg.vg.lineWidth = d.e
      tg.vg.beginPath()
      tg.vg.moveTo(d.x, d.y)
      tg.vg.lineTo(d.x, d.y + d.l)
      tg.vg.stroke()
    })
    tg.t.needsUpdate = true
  }
  // Avant l'arrivée de la foule — ou si elle ne se charge pas —, le mur porte le mot fini.
  preparerTag()
  acheverTag()
  /**
   * LE TAG EST PEINT PAR LE TAGGEUR (conv-312, « met un pieton taggeur aussi »). Un humain réel bombe le
   * mur à chaque passage (home-decor-figurants.ts, home-decor-foule.ts) : le mot apparaît là où vise sa
   * bombe, son fond se remplit derrière la main, puis il est achevé et la peinture coule. Aucune
   * lumière ajoutée : la brume de peinture est un halo (le nombre de lumières reste celui de la rue).
   */
  const brumeTag = glow(0xffffff, 0.9, 0, -20, 0, 0)
  const couleurTag = new THREE.Color()
  const surMur = new THREE.Vector3()
  let partDevoilee = 0
  const peintreTag: PeintreTag = {
    xMur: FACADE - 0.03,
    nouveau() {
      tg.n++
      preparerTag()
      partDevoilee = 0
      couleurTag.set(tg.remplissage)
      tg.t.needsUpdate = true
    },
    devoiler(part) {
      if (part <= partDevoilee) return
      partDevoilee = part
      // le fond du mot se remplit, par couches légères, jusqu'à un peu derrière la main
      const hx = tg.x0 + (tg.x1 - tg.x0) * part
      tg.vg.fillStyle = tg.motif ?? tg.remplissage
      tg.vg.globalAlpha = 0.1
      tg.vg.fillRect(0, 0, Math.max(0, hx - 26), 341)
      tg.vg.globalAlpha = 1
      tg.t.needsUpdate = true
    },
    bomber(buse, vise) {
      tg.plan.updateMatrixWorld()
      tg.plan.worldToLocal(surMur.copy(vise))
      const hx = (surMur.x / 4.8 + 0.5) * 1024
      const hy = (0.5 - surMur.y / 1.6) * 341
      tg.vg.fillStyle = tg.motif ?? tg.remplissage
      for (let k = 0; k < 18; k++) {
        tg.vg.beginPath()
        tg.vg.arc(hx + (rnd() - 0.5) * 30, hy + (rnd() - 0.5) * 40, 6 + rnd() * 12, 0, Math.PI * 2)
        tg.vg.fill()
      }
      tg.t.needsUpdate = true
      brumeTag.position.set(vise.x - 0.05, vise.y, vise.z)
      brumeTag.material.color.copy(couleurTag)
      brumeTag.material.opacity = 0.7
      for (let k = 0; k < 6; k++)
        emettre(
          buse.x,
          buse.y,
          buse.z,
          (vise.x - buse.x) / 0.14 + (rnd() - 0.5) * 0.8,
          (vise.y - buse.y) / 0.14 + (rnd() - 0.5),
          (vise.z - buse.z) / 0.14 + (rnd() - 0.5),
          0.14,
          couleurTag,
          0,
          0
        )
    },
    relacher() {
      brumeTag.material.opacity = 0
    },
    finir() {
      acheverTag()
      brumeTag.material.opacity = 0
    }
  }

  // ---------- LE RÉGLAGE « FOND D'ACCUEIL » ----------
  let parcours = DEPART
  pluieMat.uniforms.uForce.value = p.pluie
  reverberes.forEach((l) => (l.intensity = p.sombre ? 9 : 16))
  CONE_MAT.uniforms.uI.value = p.sombre ? 0.6 : 1

  // ---------- LA FOULE ARRIVE QUAND SES FICHIERS SONT CHARGÉS ET COMPILÉS ----------
  let foule: Foule | null = null
  /** La foule montée mais pas encore entrée : à libérer aussi si la scène part avant elle. */
  let enAttente: Foule | null = null
  /**
   * Le défilement de la rue à l'instant où chaque passant est à sa position de référence : c'est le
   * réglage du brouillon validé (la rue défile depuis `DEPART` à `p.vitesse`).
   */
  const PARCOURS_REF = DEPART + p.vitesse * FOULE.tRef
  let vivante = true
  /**
   * COMPILER EN TÂCHE DE FOND, SANS LE PIÈGE DE `compileAsync`. three r185 relit
   * `properties.get(m).currentProgram.isReady()` toutes les 10 ms ; si la scène est libérée entre-temps
   * (le décor est reconstruit quand le thème change, ou quand on quitte l'Accueil aussitôt
   * ouvert), `currentProgram` n'existe plus,
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
          const prog = (renderer.properties.get(m) as { currentProgram?: { isReady(): boolean } })
            .currentProgram
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
   * Ses programmes se compilent en tâche de fond par le pilote graphique, et elle entre dans la scène
   * quand ils sont prêts : les compiler à la première image où elle apparaît figerait la fenêtre.
   */
  const entrer = (prete: Foule): void => {
    marquer(MARQUES_AVENUE.fouleChargee)
    enAttente = prete
    const montrer = (): void => {
      if (!vivante) return
      scene.add(prete.groupe)
      // ses ombres et sa fumée sont des transparents non additifs : l'ordre des halos les respecte
      lots.relireBarrieres()
      enAttente = null
      foule = prete
      marquer(MARQUES_AVENUE.fouleVisible)
    }
    envoyerTextures(prete)
      .then(() => compilerEnFond(prete.groupe, scene))
      .then(() => finaliserProgrammes(prete.groupe))
      .then(montrer, (erreur: unknown) => {
        // Rien n'est masqué : l'échec est écrit, et la foule entre quand même (compilée à l'affichage).
        console.error('[decor] compilation de la foule en tâche de fond impossible :', erreur)
        montrer()
      })
  }
  /**
   * LES TEXTURES DE LA FOULE PARTENT VERS LA CARTE GRAPHIQUE UNE PAR UNE, AVANT SON ENTRÉE.
   *
   * Envoyées toutes à la première image où la foule apparaît, ses 79 textures donnaient une tâche de
   * 917 ms (mesuré le 2026-10-17, conv-312, sonde de l'Accueil dans l'instance cachée, juste après
   * la marque `foule-visible`). Une par tâche, chacune reste courte et les images continuent de passer.
   */
  const envoyerTextures = async (prete: Foule): Promise<void> => {
    for (const texture of prete.textures) {
      if (!vivante) return
      renderer.initTexture(texture)
      await new Promise<void>((ok) => setTimeout(ok, 0))
    }
  }
  /**
   * LES PROGRAMMES DE LA FOULE SONT FINALISÉS AVANT SON ENTRÉE, un par tâche. Compilés en tâche de
   * fond, ils gardent pour leur première utilisation la lecture de leurs réglages (`onFirstUse` de
   * three, via `getUniforms`) : 90 ms dans la première image de la foule (profil du 2026-10-17, conv-312).
   *
   * TOUS les programmes d'une matière, pas seulement le courant : une matière transparente à double
   * face en a deux (face arrière, face avant), et une matière dessinée à l'écran puis dans le reflet
   * de la Spirale en a deux aussi. Les seconds restaient à finaliser au premier reflet : 187 ms de
   * lecture de journaux (espion de `linkProgram` dans l'Accueil, 2026-10-17, conv-310).
   */
  const finaliserProgrammes = async (
    groupe: THREE.Object3D,
    // les matières hors de la scène qui seront dessinées : les jumelles du reflet de la Spirale
    autres: Iterable<THREE.Material> = []
  ): Promise<void> => {
    type Programme = { getUniforms(): unknown }
    const programmes = new Set<Programme>()
    const relever = (m: THREE.Material): void => {
      const proprietes = renderer.properties.get(m) as {
        currentProgram?: Programme
        programs?: Map<string, Programme>
      }
      for (const prog of proprietes.programs?.values() ?? []) programmes.add(prog)
      if (proprietes.currentProgram) programmes.add(proprietes.currentProgram)
    }
    groupe.traverse((objet) => {
      const matiere = (objet as THREE.Mesh).material as
        THREE.Material | THREE.Material[] | undefined
      for (const m of Array.isArray(matiere) ? matiere : matiere ? [matiere] : []) relever(m)
    })
    for (const m of autres) relever(m)
    for (const prog of programmes) {
      if (!vivante) return
      prog.getUniforms()
      await new Promise<void>((ok) => setTimeout(ok, 0))
    }
  }
  /**
   * LA TOILE ÉLECTRIQUE (conv-311, variante 3 du /draft « trash et chaotique ») : les câbles nus,
   * les pubs pendues aux fils, l'arc dans la flaque et les enseignes qui lâchent. Montée
   * ICI, avant la compilation de la rue, pour que ses programmes se compilent avec elle en tâche de
   * fond. Elle n'ajoute aucune lumière : l'éclat des étincelles et du néon tombé est porté par des
   * halos, sinon chaque matière de la rue serait recompilée (voir `home-decor-avenue-toile.ts`).
   */
  const toileElectrique = monterToile({
    scene,
    decor,
    camera,
    P,
    Z0,
    copies: L / P,
    FACADE,
    GARDE,
    TROTTOIR,
    ROUTE,
    GLOW,
    toile,
    tex,
    glow,
    trainee,
    emettre,
    enseignes,
    // conv-319 : « j'éclaircis les câbles devant le vaisseau » (le vaisseau mère, en haut au centre)
    eclaircie: eclaircieVaisseau(),
    // conv-1037 : la rangée n'est plus un mur de 24 m, les câbles s'accrochent sous ses toits
    hauteurMur: (u) => hauteurMurRangee(u, P)
  })
  /**
   * LA SPIRALE (conv-310, « implémente spirale ») : la rue inondée, la tour de contrôle et la rame
   * en hélice. Montée ICI, avant la compilation de la rue, pour que ses programmes se compilent
   * avec elle en tâche de fond. Le reflet de l'eau a sa propre version de chaque programme : elle
   * est compilée juste après, avant la première image (voir `precompilerReflet`).
   */
  const spirale = monterSpirale({
    scene,
    decor,
    renderer,
    camera,
    P,
    Z0,
    copies: 4,
    FACADE,
    ROUTE,
    GARDE,
    TROTTOIR,
    SOL,
    uT: uVille.uT,
    GLOW,
    toile,
    tex,
    enseignes,
    motifs: motifs.map((m, i) => ({
      mot: MOTS_ENSEIGNES[i],
      couleur: m.c,
      texture: TEX_ENSEIGNES[i]
    }))
  })
  // Le reflet de l'eau est dessiné à demi-résolution : la taille des feux du vaisseau (pixels d'écran)
  // y est réduite d'autant. conv-1037 : « les reflets de la ville flottante sont dans la rue mais ils
  // devraient pas etre visibile car cachés par le socle » — deux fois trop gros, les feux des toits
  // débordaient dans l'eau sur la plaque qui les cache.
  spirale.suivreLaResolution(vaisseau.tailleFeux)
  /**
   * LES HALOS PAR LOTS (conv-323) : les 424 halos additifs de la rue, de la ville, de la Spirale et
   * des nuages, dessinés un par un à chaque passe, passent en quelques dessins instanciés, sans rien
   * changer au rendu (voir home-decor-lots-halos.ts). Ici, une fois TOUS les halos posés et avant la
   * compilation de la rue : les programmes des lots se compilent avec elle, en tâche de fond.
   */
  const lots = regrouperHalos(scene)
  /**
   * LA RUE AUSSI SE COMPILE EN TÂCHE DE FOND (2026-10-17, conv-301). Seule la foule passait par
   * `compileAsync` : la première image de la rue compilait tous ses programmes d'un bloc sur le fil
   * principal (`onFirstUse` de three, 2,3 s mesurées par profil dans l'instance cachée, carte
   * RTX 3060 sous Direct3D 11, `KHR_parallel_shader_compile` présent) — un gel de 3 s à
   * l'ouverture de l'Accueil. Le pilote compile désormais pendant que la page reste vivante ; tant
   * que ce n'est pas fini, `render` ne dessine rien et le fond de la page reste visible.
   */
  let rueCompilee = false
  const rueEstCompilee = (): void => {
    rueCompilee = true
    // Une scène libérée avant la fin (thème changé, Accueil quitté) ne marque rien : sa promesse se
    // résout à l'arrêt, pas à la compilation, et fausserait la mesure.
    if (vivante) marquer(MARQUES_AVENUE.rueCompilee)
  }
  /**
   * LA RUE N'ATTEND PLUS SON REFLET (conv-337, 2026-10-19). Avant, la rue n'apparaissait qu'une fois
   * compilées ET finalisées les deux versions de chaque programme : celle de l'écran, puis celle du
   * reflet (74 programmes, dont 37 pour le seul reflet — espion de linkProgram, conv-310). Désormais
   * la rue apparaît dès que SES programmes sont prêts ; l'eau reste sans reflet jusqu'à ce que la
   * version « reflet » soit à son tour compilée en tâche de fond PUIS finalisée un programme par tâche
   * (sans cela, le premier reflet la finalisait d'un bloc : `onFirstUse` 310 ms dans la première
   * image, conv-310). Alors seulement le reflet est activé, et monte en fondu.
   */
  const refletEstPret = (): void => {
    if (!vivante) return
    spirale.activerReflet()
    marquer(MARQUES_AVENUE.refletPret)
  }
  compilerEnFond(scene)
    .then(() => finaliserProgrammes(scene))
    .then(rueEstCompilee, (erreur: unknown) => {
      console.error('[decor] compilation de la rue en tâche de fond impossible :', erreur)
      rueEstCompilee()
    })
    .then(() => (vivante ? spirale.precompilerReflet(compilerEnFond) : undefined))
    .then(() => finaliserProgrammes(scene, spirale.matieresDuReflet()))
    .then(refletEstPret, (erreur: unknown) => {
      // Rien n'est masqué : l'échec est écrit, et le reflet s'active quand même (compilé à l'image).
      console.error('[decor] compilation du reflet en tâche de fond impossible :', erreur)
      refletEstPret()
    })
  /** Une foule arrivée après la fin de la scène n'y entre jamais : elle est libérée tout de suite. */
  const libererFoule = (f: Foule): void => {
    f.groupe.traverse((objet) => {
      const mesh = objet as THREE.Mesh
      mesh.geometry?.dispose?.()
      const matiere = mesh.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(matiere)) matiere.forEach((entree) => entree.dispose())
      else matiere?.dispose?.()
    })
    f.textures.forEach((texture) => texture.dispose())
  }
  // La foule se charge pendant que la rue vit : un fichier à la fois, les images décodées hors du fil
  // principal. Un échec laisse la rue sans passants, il ne la casse pas, et il est écrit.
  // Avec ses scènes : le deal contre le mur de la porte et le fumeur à la rambarde (conv-312).
  chargerFoule(HEURE_DE_POINTE.slice(0, p.passants), TROTTOIR, () => vivante, {
    facade: FACADE,
    garde: GARDE,
    vRue: p.vitesse,
    tag: peintreTag
  }).then(
    (prete) => {
      if (prete && vivante) entrer(prete)
      else if (prete) libererFoule(prete)
    },
    (erreur: unknown) => console.error('[decor] la foule n a pas pu être chargée :', erreur)
  )

  /**
   * La première image de la rue est dessinée : le canevas passe de 0 à 1 en fondu. Appelé APRÈS
   * `renderer.render`, pour que le fondu ne dévoile jamais un tampon vide.
   */
  let apparue = false
  const apparaitre = (): void => {
    apparue = true
    marquer(MARQUES_AVENUE.rueVisible)
    if (!dansLaPage) return options.surApparition?.()
    canvas.style.opacity = '1'
    // Sans l'API d'animation (happy-dom en test), la rue apparaît d'un coup : rien n'est caché.
    if (typeof canvas.animate === 'function')
      canvas.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: FONDU_ENTREE_MS,
        easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)'
      })
  }

  /** Le reflet de l'eau (une image sur deux, voir home-decor-avenue-spirale.ts), foule et viaduc exclus. */
  const dessinerReflet = (): void => spirale.avantRendu([foule?.groupe, ...aretesViaduc])

  let prevPont: number | null = null
  let pluieT = 0
  let tPrecedent: number | null = null
  const base = new THREE.Vector3(...CAMERA_AVENUE.position)
  const viseur = new THREE.Vector3(...CAMERA_AVENUE.cible)

  return {
    canvas,

    resize(largeur, hauteur) {
      if (!(largeur > 0 && hauteur > 0)) return
      const ratio = Math.min(
        (options.ratio ? options.ratio() : window.devicePixelRatio) || 1,
        PLAFOND_RATIO
      )
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
      // Le pas de temps vient de l'horloge de l'appelant. Plafonné à 50 ms : au retour d'une fenêtre
      // cachée, la foule ne doit pas sauter de plusieurs mètres d'un coup.
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
      villeBasse.animer(t)
      vaisseau.animer(t)
      majVols(t, p.vols)
      projecteurs.forEach((s) =>
        s.g.rotation.set(0.32 * Math.sin(t * 0.21 + s.ph), 0, 0.3 * Math.cos(t * 0.17 + s.ph * 1.3))
      )
      nuages.forEach((s, i) => (s.position.x += Math.sin(i) * 0.6 * dt))

      majLampeDeal(t, zVisible(Z_DEAL))
      tg.plan.position.z = zVisible(Z_TAG)
      foule?.animer(t, dt, parcours - PARCOURS_REF, base, {
        deal: zVisible(Z_DEAL),
        fumeur: zVisible(Z_FUMEUR),
        tag: zVisible(Z_TAG)
      })

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
      // après le scintillement des enseignes : les deux qui lâchent y sont reprises par la toile
      toileElectrique.maj(t, dt, v)
      rangee.animer(t)
      majParticules(dt)
      spirale.animer(t, parcours)

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
      // Les matrices des 3 400 objets, UNE fois par image : laissé à three, chaque passe (reflet, puis
      // écran) les recalculait (`matrixWorldAutoUpdate`, coupé à la création de la scène).
      scene.updateMatrixWorld()
      // ce qui ne dépend pas de la caméra, lu une fois pour les deux passes (reflet, écran)
      lots.nouvelleImage()
      // le reflet de l'eau, caméra posée ; la foule n'y est pas (voir home-decor-avenue-spirale.ts).
      // Dans le Worker, il est dessiné après l'image, dans sa propre tâche (`apresImage`).
      if (!options.refletApresImage) dessinerReflet()
      renderer.render(scene, camera)
      if (!apparue) apparaitre()
    },

    // Le reflet de l'image suivante, à l'état (scène, caméra) de celle qu'on vient de dessiner.
    apresImage: options.refletApresImage
      ? () => {
          if (rueCompilee && vivante) dessinerReflet()
        }
      : undefined,

    dispose() {
      vivante = false
      // La foule encore en compilation n'est pas dans la scène : elle est libérée aussi.
      const racines: THREE.Object3D[] = enAttente ? [scene, enAttente.groupe] : [scene]
      for (const racine of racines)
        racine.traverse((objet) => {
          const mesh = objet as THREE.Mesh
          mesh.geometry?.dispose?.()
          const matiere = mesh.material as THREE.Material | THREE.Material[] | undefined
          if (Array.isArray(matiere)) matiere.forEach((entree) => entree.dispose())
          else matiere?.dispose?.()
        })
      for (const texture of textures) texture.dispose()
      for (const f of [foule, enAttente]) f?.textures.forEach((texture) => texture.dispose())
      spirale.liberer()
      lots.liberer()
      flotte.liberer()
      renderer.dispose()
      // dans un Worker, le canevas appartient à la page : c'est elle qui le retire
      if (dansLaPage) canvas.remove()
    }
  }
}
