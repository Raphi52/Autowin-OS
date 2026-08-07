import { pathSegments, relativePathOf } from './graph-vault-paths'
import type { GraphNode } from './graph-view-model'

/**
 * Agencement en ARBORESCENCE RADIALE — un anneau = un NIVEAU de profondeur, une branche = une
 * filiation.
 *
 * Ce que cet agencement a remplace : un mode « anneaux par famille » ou la distance au centre
 * disait de quelle FAMILLE venait une fiche, et ou les points flottaient sans aucun lien entre eux.
 * Ce mode a ete supprime a la demande de l'utilisateur, l'arborescence montrant la meme hierarchie en
 * la rendant navigable. Ici la distance dit « a quelle profondeur », et chaque noeud est RELIE a son parent.
 * C'est la demande explicite de l'utilisateur, croquis à l'appui.
 *
 * L'arbre n'est PAS fabriqué : il est déjà dans les données. Chaque fiche porte un `file`, dont le
 * chemin relatif au vault (`projects/rig-tv/obsidian/areas/foo.md`) EST sa lignée. On ne regroupe
 * donc rien arbitrairement — même principe que les catégories du forage, dérivées et non inventées.
 *
 * Les angles suivent le dendrogramme radial classique : chaque FEUILLE reçoit une part égale du
 * cercle, et chaque nœud interne se pose au barycentre de ses enfants. Deux conséquences voulues —
 * aucune feuille ne peut en recouvrir une autre, et un parent reste toujours à l'intérieur du
 * secteur de sa propre descendance, donc les branches ne se croisent pas.
 */

/** Un nœud placé sur le disque. */
export type TreeNode = {
  /** Chemin complet depuis la racine, qui sert d'identité — deux `foo.md` de dossiers différents ne collisionnent pas. */
  id: string
  /** Le dernier segment : ce qu'on affiche. */
  label: string
  parentId: string | null
  depth: number
  /** Radians. */
  angle: number
  radius: number
  fx: number
  fy: number
  fz: number
  isLeaf: boolean
  /** Nombre de feuilles sous ce nœud — sert à doser la taille d'un nœud interne. */
  leaves: number
  /** L'identifiant de la fiche d'origine, présent seulement sur les feuilles. */
  noteId?: string
}

/** Une branche à tracer, du parent vers l'enfant. */
export type TreeEdge = { from: string; to: string; depth: number }

export type TreeLayout = {
  nodes: TreeNode[]
  edges: TreeEdge[]
  /** Profondeur maximale atteinte : le nombre d'anneaux à tracer. */
  maxDepth: number
  /** Rayon de chaque anneau, indexé par profondeur. */
  ringRadii: number[]
}

export type TreeLayoutOptions = {
  /** Écart radial entre deux anneaux. */
  ringGap?: number
  /** Familles à écarter complètement (corbeille…). */
  excluded?: readonly string[]
  /** Angle de départ, pour orienter l'arbre. */
  startAngle?: number
  /**
   * Regroupement des PREMIERS anneaux. Sans lui, l'arbre suit le disque : `knowledge`, `projects`,
   * `governance`. Avec lui, on coiffe le disque d'une lecture sans déplacer un seul fichier : le
   * groupe devient simplement un ou plusieurs segments de chemin en plus.
   *
   * La valeur peut contenir des `/` pour produire PLUSIEURS anneaux — par exemple `RIG/proc`. C'est
   * ce qui permet de subdiviser un gros sujet À L'INTÉRIEUR de son propre secteur, au lieu de croiser
   * deux axes : la campagne d'architecture a mesuré que le croisement fait chuter la justesse à 50 %,
   * sous chacun des axes pris seul.
   */
  groupOf?: (node: GraphNode) => string
}

const DEFAULT_RING_GAP = 120
const DEFAULT_EXCLUDED = ['.trash'] as const

type Interne = {
  id: string
  label: string
  parentId: string | null
  depth: number
  enfants: Map<string, Interne>
  noteId?: string
}

function creerInterne(id: string, label: string, parentId: string | null, depth: number): Interne {
  return { id, label, parentId, depth, enfants: new Map() }
}

/**
 * Construit l'arbre des chemins. Une fiche dont le chemin est vide est rattachée à la racine sous
 * son propre identifiant : la perdre en silence serait pire que l'afficher à la racine, et le test
 * de partition l'exigerait de toute façon.
 */
function construire(
  nodes: readonly GraphNode[],
  exclues: readonly string[],
  groupe?: (node: GraphNode) => string
): Interne {
  const racine = creerInterne('', 'Brain', null, 0)
  for (const node of nodes) {
    const segments = pathSegments(relativePathOf(node))
    const brut = segments.length > 0 ? segments : [node.id]
    if (exclues.includes(brut[0])) continue
    // Le groupe est PRÉFIXÉ au chemin : tout le reste de l'algorithme continue de ne connaître que
    // des chemins, donc la profondeur, la partition et les angles restent gouvernés par les mêmes
    // invariants — il y a juste un anneau de plus au début.
    // Le groupe peut porter plusieurs niveaux, séparés par `/` — ils deviennent autant d'anneaux.
    const chemin = groupe ? [...groupe(node).split('/').filter(Boolean), ...brut] : brut

    let courant = racine
    let idCourant = ''
    for (let i = 0; i < chemin.length; i += 1) {
      idCourant = idCourant === '' ? chemin[i] : idCourant + '/' + chemin[i]
      let enfant = courant.enfants.get(idCourant)
      if (!enfant) {
        enfant = creerInterne(idCourant, chemin[i], courant.id === '' ? null : courant.id, i + 1)
        // La racine porte `parentId: null`; ses enfants directs aussi doivent pointer sur elle.
        enfant.parentId = courant.id === '' ? '' : courant.id
        courant.enfants.set(idCourant, enfant)
      }
      courant = enfant
    }
    // Le dernier segment porte la fiche. Deux fiches de même chemin sont impossibles (le chemin est
    // unique dans un système de fichiers), donc pas d'écrasement silencieux à craindre.
    courant.noteId = node.id
  }
  return racine
}

/** Les feuilles, dans l'ordre de parcours — c'est cet ordre qui fixe la répartition angulaire. */
function feuillesDe(n: Interne, out: Interne[]): number {
  if (n.enfants.size === 0) {
    out.push(n)
    return 1
  }
  let total = 0
  for (const enfant of [...n.enfants.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    total += feuillesDe(enfant, out)
  }
  return total
}

/**
 * Pose l'arbre sur le disque.
 *
 * Le pas angulaire est CONSTANT entre feuilles voisines : c'est ce qui garantit qu'aucune feuille
 * n'en recouvre une autre, quelle que soit la densité — 564 feuilles tiennent, serrées, plutôt que
 * de s'empiler. Un nœud interne prend la moyenne de ses enfants, donc il reste toujours dans le
 * secteur de sa descendance.
 */
export function layoutTree(
  nodes: readonly GraphNode[],
  options: TreeLayoutOptions = {}
): TreeLayout {
  const ringGap = options.ringGap ?? DEFAULT_RING_GAP
  const exclues = options.excluded ?? DEFAULT_EXCLUDED
  const startAngle = options.startAngle ?? -Math.PI / 2

  const racine = construire(nodes, exclues, options.groupOf)
  const feuilles: Interne[] = []
  feuillesDe(racine, feuilles)

  const pas = feuilles.length > 0 ? (Math.PI * 2) / feuilles.length : 0
  const angleDe = new Map<string, number>()
  feuilles.forEach((f, i) => angleDe.set(f.id, startAngle + i * pas))

  const nombreFeuilles = new Map<string, number>()
  const resoudre = (n: Interne): { angle: number; feuilles: number } => {
    if (n.enfants.size === 0) {
      nombreFeuilles.set(n.id, 1)
      return { angle: angleDe.get(n.id) ?? startAngle, feuilles: 1 }
    }
    let somme = 0
    let compte = 0
    for (const enfant of n.enfants.values()) {
      const r = resoudre(enfant)
      somme += r.angle * r.feuilles
      compte += r.feuilles
    }
    // Barycentre PONDÉRÉ par le nombre de feuilles : une moyenne simple ferait dériver un parent vers
    // sa branche la plus maigre, et la branche s'inclinerait visiblement du mauvais côté.
    const angle = compte > 0 ? somme / compte : startAngle
    angleDe.set(n.id, angle)
    nombreFeuilles.set(n.id, compte)
    return { angle, feuilles: compte }
  }
  resoudre(racine)

  const out: TreeNode[] = []
  const edges: TreeEdge[] = []
  let maxDepth = 0

  const parcourir = (n: Interne): void => {
    const angle = angleDe.get(n.id) ?? startAngle
    const radius = n.depth * ringGap
    maxDepth = Math.max(maxDepth, n.depth)
    out.push({
      id: n.id,
      label: n.label,
      parentId: n.parentId,
      depth: n.depth,
      angle,
      radius,
      fx: Math.cos(angle) * radius,
      fy: Math.sin(angle) * radius,
      fz: 0,
      isLeaf: n.enfants.size === 0,
      leaves: nombreFeuilles.get(n.id) ?? 1,
      noteId: n.noteId
    })
    for (const enfant of n.enfants.values()) {
      edges.push({ from: n.id, to: enfant.id, depth: enfant.depth })
      parcourir(enfant)
    }
  }
  parcourir(racine)

  const ringRadii: number[] = []
  for (let d = 0; d <= maxDepth; d += 1) ringRadii.push(d * ringGap)

  return { nodes: out, edges, maxDepth, ringRadii }
}

/** Rayon utile pour recadrer la caméra : sans lui la vue est cadrée sur du vide. */
export function treeBoundingRadius(layout: TreeLayout): number {
  return layout.nodes.reduce((max, n) => Math.max(max, n.radius), 0)
}

/**
 * Choisit QUELLES étiquettes dessiner, par ordre d'importance, en écartant celles qui recouvriraient
 * une étiquette déjà posée.
 *
 * Trois tentatives ont échoué avant celle-ci, et chacune a appris quelque chose :
 *  1. décalage RADIAL — inopérant pour les nœuds pointant vers la gauche, où le rayon est horizontal
 *     et ne sépare donc rien verticalement ;
 *  2. décalage en Y en unités de scène — les sprites ont une taille en fraction d'ÉCRAN, donc
 *     « 34 unités » valait la moitié d'une étiquette au zoom courant ;
 *  3. décalage en Y à la bonne échelle — il séparait enfin, mais en CASCADE : la huitième étiquette
 *     finissait projetée hors du disque, à désigner une branche située très loin d'elle.
 *
 * D'où ce principe, qui est celui des cartes : quand deux noms ne tiennent pas, on n'en déplace aucun
 * — on garde le plus important et on TAIT l'autre. Un libellé posé désigne toujours exactement son
 * nœud, et le compte reste lisible sur le disque du nœud omis.
 */
export function pickVisibleLabels(
  labels: readonly { x: number; y: number; width: number; height: number; priority: number }[]
): boolean[] {
  const ordre = labels
    .map((label, index) => ({ ...label, index }))
    // Le plus IMPORTANT d'abord : c'est lui qui garde sa place quand deux noms se disputent la même.
    .sort((a, b) => b.priority - a.priority || a.index - b.index)
  const poses: typeof ordre = []
  const visible = new Array<boolean>(labels.length).fill(false)
  for (const label of ordre) {
    const gene = poses.some(
      (pose) =>
        Math.abs(pose.x - label.x) < (pose.width + label.width) / 2 &&
        Math.abs(pose.y - label.y) < (pose.height + label.height) / 2
    )
    if (gene) continue
    poses.push(label)
    visible[label.index] = true
  }
  return visible
}
