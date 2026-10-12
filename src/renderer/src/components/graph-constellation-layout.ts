/**
 * PLACEMENT DE LA CONSTELLATION — le graphe d'une demande dessiné en arbre étoilé (conv-234,
 * 2026-10-11, /draft « une belle gueule qui ressemble à mon thème holo » → « go fil holo »).
 *
 * Chaque étape devient une perle posée dans le panneau : la demande en haut, ses enfants étalés
 * SOUS leur parent, la taille de la perle suivant la durée de l'étape. Le calcul est pur (aucun
 * DOM) : le composant mesure la largeur, ce module rend des coordonnées.
 *
 * Contraintes mesurées sur les traces réelles (162 conversations, 464 tours, 2026-10-11) : une
 * demande compte 4 nœuds en médiane et 8 au 90e centile — le cas de la maquette — mais une chaîne
 * d'outils descend jusqu'à 14 niveaux et un niveau d'agents atteint 500 nœuds (conv-72). D'où les
 * deux règles :
 *   - un niveau trop large pour le panneau PASSE À LA LIGNE (jamais de défilement horizontal) ;
 *   - un niveau profond n'est qu'une ligne de plus (le panneau défile déjà verticalement).
 */

export interface ConstellationInputNode {
  id: string
  parentId?: string
  depth: number
  /** Durée mesurée de l'étape ; absente pour un marqueur ponctuel ou une étape en cours. */
  durationMs?: number
  /** Une ligne de cause d'échec s'ajoute sous la légende : la ligne est plus haute. */
  hasFailure?: boolean
  running?: boolean
}

export interface PlacedConstellationNode {
  id: string
  parentId?: string
  /** Centre horizontal de la perle (ou de la pastille racine). */
  x: number
  /** Largeur de la légende : jusqu'aux voisins de ligne, plafonnée. */
  largeur: number
  /** Haut de la ligne qui porte le nœud. */
  top: number
  /** Centre vertical de la perle. */
  cy: number
  /** Rayon de la perle ; 0 pour une racine (pastille). */
  r: number
  row: number
  root: boolean
  /** Bas du bloc perle + légende : c'est de là que partent les liens vers les enfants. */
  bottom: number
}

export interface ConstellationRow {
  index: number
  top: number
  height: number
  ids: string[]
  root: boolean
  /** Hauteur de la zone de la perle (perle la plus grosse de la ligne + son anneau). */
  astre: number
  /** Hauteur de la légende sous la perle. */
  legende: number
}

export interface ConstellationLayout {
  width: number
  height: number
  rows: ConstellationRow[]
  nodes: Map<string, PlacedConstellationNode>
}

export interface ConstellationOptions {
  width: number
  /** La racine porte le texte de la demande sous sa pastille. */
  rootQuote?: boolean
}

export const CONSTELLATION = {
  marge: 8,
  slotMin: 76,
  slotMax: 150,
  rayonMin: 5,
  rayonMax: 18,
  rayonSansDuree: 6,
  rayonEnCours: 8,
  /** Air autour de la perle : anneau d'étape choisie ou en cours, pastille « terminé ». */
  airPerle: 7,
  ligneLegende: 13,
  ecartLignes: 28,
  racinePastille: 28,
  /** Citation (2 lignes) + durée et coût du tour sur une ligne dessous (2026-10-12). */
  racineCitation: 52
} as const

const LARGEUR_PAR_DEFAUT = 320

function rayon(
  durationMs: number | undefined,
  maxMs: number,
  running: boolean | undefined
): number {
  if (durationMs == null || !Number.isFinite(durationMs) || durationMs < 0 || maxMs <= 0)
    return running ? CONSTELLATION.rayonEnCours : CONSTELLATION.rayonSansDuree
  const part = Math.sqrt(Math.min(1, durationMs / maxMs))
  return Math.round(
    CONSTELLATION.rayonMin + (CONSTELLATION.rayonMax - CONSTELLATION.rayonMin) * part
  )
}

/**
 * Pose les centres d'une ligne : chacun au plus près de sa place désirée, au moins `ecart` de son
 * voisin, et tous dans le panneau. La ligne ne dépasse jamais `capacite` nœuds : elle tient donc.
 */
function poserLigne(desirs: number[], slot: number, minX: number, maxX: number): number[] {
  const xs = desirs.map((x) => Math.min(maxX, Math.max(minX, x)))
  for (let i = 1; i < xs.length; i += 1) xs[i] = Math.max(xs[i], xs[i - 1] + slot)
  if (xs.length > 0) xs[xs.length - 1] = Math.min(xs[xs.length - 1], maxX)
  for (let i = xs.length - 2; i >= 0; i -= 1) xs[i] = Math.min(xs[i], xs[i + 1] - slot)
  for (let i = 0; i < xs.length; i += 1) xs[i] = Math.max(xs[i], minX + i * slot)
  return xs
}

export function layoutConstellation(
  input: readonly ConstellationInputNode[],
  options: ConstellationOptions
): ConstellationLayout {
  const width = options.width > 0 ? options.width : LARGEUR_PAR_DEFAUT
  const utile = Math.max(1, width - 2 * CONSTELLATION.marge)
  const capacite = Math.max(1, Math.floor(utile / CONSTELLATION.slotMin))
  const ids = new Set(input.map((node) => node.id))
  const maxMs = input.reduce(
    (max, node) =>
      node.depth > 0 && node.durationMs != null && Number.isFinite(node.durationMs)
        ? Math.max(max, node.durationMs)
        : max,
    0
  )

  // ARBRE PAR SOUS-ARBRES : l'ordre préfixe garde les frères côte à côte, et chaque rangée de
  // frères est suivie de SES enfants avant la rangée suivante. Quand un niveau passe à la ligne
  // (9 phases dans 300 px), chaque phase garde ses agents juste sous elle : les liens restent
  // courts. Placés niveau par niveau, ils traversaient toute la constellation (conv-108, mesuré).
  const enfants = new Map<string, ConstellationInputNode[]>()
  const racines: ConstellationInputNode[] = []
  for (const node of input) {
    if (!node.parentId || !ids.has(node.parentId)) racines.push(node)
    else enfants.set(node.parentId, [...(enfants.get(node.parentId) ?? []), node])
  }

  const placed = new Map<string, PlacedConstellationNode>()
  const rows: ConstellationRow[] = []
  let top = 0

  const poserRangee = (ligne: ConstellationInputNode[], estRacine: boolean): void => {
    const n = ligne.length
    let xs: number[]
    if (estRacine) {
      const part = utile / n
      xs = ligne.map((_, i) => CONSTELLATION.marge + part * (i + 0.5))
    } else {
      // Place désirée : sous le parent, les frères répartis de part et d'autre, d'autant plus
      // écartés qu'ils sont peu nombreux.
      const freres = new Map<string, string[]>()
      for (const node of ligne) {
        const cle = node.parentId ?? ''
        freres.set(cle, [...(freres.get(cle) ?? []), node.id])
      }
      const desirs = ligne.map((node) => {
        const groupe = freres.get(node.parentId ?? '') ?? [node.id]
        const ecart = Math.min(
          CONSTELLATION.slotMax,
          Math.max(CONSTELLATION.slotMin, utile / groupe.length)
        )
        const parent = node.parentId ? placed.get(node.parentId) : undefined
        return (
          (parent?.x ?? width / 2) + (groupe.indexOf(node.id) - (groupe.length - 1) / 2) * ecart
        )
      })
      const minX = CONSTELLATION.marge + CONSTELLATION.slotMin / 2
      const maxX = width - CONSTELLATION.marge - CONSTELLATION.slotMin / 2
      xs =
        minX > maxX
          ? ligne.map(() => width / 2)
          : poserLigne(desirs, CONSTELLATION.slotMin, minX, maxX)
    }
    // La légende d'un nœud prend toute la place jusqu'à ses voisins, jamais plus.
    const largeurs = xs.map((x, i) =>
      Math.min(
        estRacine ? utile : CONSTELLATION.slotMax,
        i > 0 ? x - xs[i - 1] : 2 * (x - CONSTELLATION.marge),
        i < xs.length - 1 ? xs[i + 1] - x : 2 * (width - CONSTELLATION.marge - x)
      )
    )

    const rayons = ligne.map((node) =>
      estRacine ? 0 : rayon(node.durationMs, maxMs, node.running)
    )
    const astre = estRacine
      ? CONSTELLATION.racinePastille
      : 2 * (Math.max(...rayons) + CONSTELLATION.airPerle)
    const legende = estRacine
      ? options.rootQuote
        ? CONSTELLATION.racineCitation
        : 0
      : CONSTELLATION.ligneLegende * (ligne.some((node) => node.hasFailure) ? 4 : 3)
    const height = astre + legende + CONSTELLATION.ecartLignes
    const index = rows.length
    rows.push({
      index,
      top,
      height,
      ids: ligne.map((node) => node.id),
      root: estRacine,
      astre,
      legende
    })
    ligne.forEach((node, i) => {
      placed.set(node.id, {
        id: node.id,
        ...(node.parentId && ids.has(node.parentId) ? { parentId: node.parentId } : {}),
        x: xs[i],
        largeur: largeurs[i],
        top,
        cy: top + astre / 2,
        r: rayons[i],
        row: index,
        root: estRacine,
        bottom: top + astre + legende
      })
    })
    top += height
  }

  const placer = (membres: ConstellationInputNode[], estRacine: boolean): void => {
    // Une racine est une pastille plus large qu'une perle : moins par ligne.
    const parLigne = estRacine ? Math.max(1, Math.floor(utile / 220)) : capacite
    for (let debut = 0; debut < membres.length; debut += parLigne) {
      const ligne = membres.slice(debut, debut + parLigne)
      poserRangee(ligne, estRacine)
      const suivants = ligne.flatMap((node) => enfants.get(node.id) ?? [])
      if (suivants.length > 0) placer(suivants, false)
    }
  }
  placer(racines, true)

  return { width, height: top, rows, nodes: placed }
}

/** Abscisse du RAIL : la marge, où aucune légende ne se pose. */
export const RAIL_X = CONSTELLATION.marge / 2

/**
 * Lien parent → enfant : part sous le bloc du parent, arrive au sommet de l'anneau de l'enfant.
 *
 * Un lien qui SAUTE des rangées (l'enfant n'est pas sur la rangée suivante : frères passés à la
 * ligne, chacun suivi de ses agents) ne traverse pas la constellation en diagonale. Il rejoint le
 * RAIL de la marge LA PLUS PROCHE de son parent, le descend, et en ressort juste au-dessus de son
 * enfant. Les liens longs d'un même côté partagent ce rail : un seul trait au lieu d'un faisceau
 * (conv-108, mesuré le 2026-10-11).
 */
export function constellationEdgePath(
  parent: PlacedConstellationNode,
  child: PlacedConstellationNode,
  largeurPanneau?: number
): string {
  const sx = parent.x
  const sy = parent.bottom + 2
  const ex = child.x
  const ey = child.root ? child.top : child.cy - child.r - 4
  const r = (n: number): string => (Math.round(n * 10) / 10).toString()
  if (child.row - parent.row > 1) {
    const x = largeurPanneau != null && sx > largeurPanneau / 2 ? largeurPanneau - RAIL_X : RAIL_X
    return (
      `M${r(sx)} ${r(sy)}C${r(sx)} ${r(sy + 22)} ${r(x)} ${r(sy + 8)} ${r(x)} ${r(sy + 30)}` +
      `V${r(ey - 34)}C${r(x)} ${r(ey - 10)} ${r(ex)} ${r(ey - 24)} ${r(ex)} ${r(ey)}`
    )
  }
  const h = Math.max(8, ey - sy)
  return `M${r(sx)} ${r(sy)}C${r(sx)} ${r(sy + h * 0.55)} ${r(ex)} ${r(ey - h * 0.55)} ${r(ex)} ${r(ey)}`
}
