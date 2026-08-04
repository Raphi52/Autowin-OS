import { nodeThemeIds, type GraphNode } from './graph-view-model'

/**
 * Agencement RADIAL en BANDES — une fiche = un point, les points rangés en rangées régulières à
 * l'intérieur de la bande de leur famille, triés par thème pour former des ARCS DE COULEUR.
 *
 * ------------------------------------------------------------------------------------------------
 * TROIS VERSIONS, DEUX VERDICTS « ILLISIBLE ». Ce que chaque échec a appris, mesuré et non supposé :
 *
 * v1 — anneau = profondeur du chemin, angle = 1ᵉʳ thème, un point par fiche, liens dessinés.
 *      → 60 % des fiches partagent la même profondeur : un anneau portait tout. Et la caméra n'était
 *        jamais recadrée, donc le disque plat était vu PAR LA TRANCHE.
 * v2 — anneau = famille sémantique, agrégation sous un plafond de 36 points.
 *      → Vue VIDE : `node.file` est un chemin UNC ABSOLU, donc la famille valait `ged2` pour TOUS les
 *        nœuds. Corrigé (`relativePathOf`). Restait illisible : caméra à 3413 unités pour des nœuds de
 *        16-33 (des poussières), et 0 étiquette dessinée sur 30.
 * v3 (ici) — ce que les mesures imposent :
 *      · le plafond de 36 était une ERREUR de ma part : la référence visuelle montre des CENTAINES de
 *        points par anneau, en rangées serrées. On ne réduit donc pas le nombre de points, on les RANGE.
 *      · les 30 THÈMES réels de l'app (« Comprendre RIG » 254, « Moteur d'application » 209…) sont la
 *        bonne clé de secteur. J'avais écrit à tort que 93 % des fiches n'en avaient pas — l'agent de
 *        mesure avait prévenu qu'il n'avait pas rejoué les heuristiques `noteThemes()`.
 *      · les thèmes d'origine sont PRÉSERVÉS sur chaque nœud : la coloration existante de l'app s'y
 *        applique telle quelle, et trier les points par thème suffit à produire les arcs colorés.
 * ------------------------------------------------------------------------------------------------
 */

/** Position d'une fiche sur le disque. */
export type RadialDot = {
  id: string
  fx: number
  fy: number
  fz: number
  /** Index de bande (0 = centre). */
  ring: number
  family: string
  /** Rangée à l'intérieur de la bande : une bande dense en compte plusieurs. */
  row: number
}

/** Géométrie d'une bande — ce que le rendu doit tracer et étiqueter. */
export type RadialBand = {
  ring: number
  family: string
  innerRadius: number
  outerRadius: number
  /** Rayon où poser l'étiquette de la famille. */
  labelRadius: number
  notes: number
  rows: number
}

export type RadialLayoutOptions = {
  families?: readonly string[]
  excluded?: readonly string[]
  /** Rayon de la première bande. */
  innerRadius?: number
  /** Écart entre deux rangées de points. */
  rowGap?: number
  /** Écart supplémentaire entre deux bandes, pour que la frontière se voie. */
  bandGap?: number
  /**
   * Écart minimal entre deux points d'une même rangée, en unités de scène. C'EST le garde-fou de
   * lisibilité : il fixe combien de points tiennent sur une rangée, donc combien de rangées la bande
   * doit compter. Calé sur la taille réelle d'un nœud au rendu (16-33 unités).
   */
  minDotSpacing?: number
}

/** Familles du brain Amitel, du centre vers l'extérieur — mesurées, pas devinées. */
export const DEFAULT_RING_FAMILIES = [
  '<racine>',
  'governance',
  'knowledge',
  'projects',
  'tooling',
  'integrations',
  'inbox'
] as const

export const DEFAULT_EXCLUDED_FAMILIES = ['.trash'] as const

const KNOWN_FAMILY_SET: ReadonlySet<string> = new Set([
  ...DEFAULT_RING_FAMILIES,
  ...DEFAULT_EXCLUDED_FAMILIES
])

const DEFAULT_INNER_RADIUS = 90
const DEFAULT_ROW_GAP = 26
const DEFAULT_BAND_GAP = 44
const DEFAULT_MIN_DOT_SPACING = 26

/** Segments du chemin, les DEUX séparateurs gérés : le brain vit sur un partage Windows. */
export function pathSegments(file: string | undefined): string[] {
  return (file ?? '')
    .split(/[/\\]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
}

/**
 * Chemin RELATIF au brain — la seule forme exploitable pour en déduire une famille.
 *
 * MESURÉ dans l'app en fonctionnement : `node.file` est un chemin UNC ABSOLU
 * (`\\ged2\rig\Projets IA\Amitel Brain\knowledge\_maps\x.md`), dont le 1ᵉʳ segment est le nom du
 * SERVEUR. `node.id` porte le chemin relatif propre et c'est la clé stable de l'app : on le préfère,
 * et on ne retombe sur `file` (via une ancre de famille) que si l'id n'est pas un chemin.
 */
export function relativePathOf(node: Pick<GraphNode, 'id' | 'file'>): string {
  const id = String(node.id ?? '')
  if (/[/\\]/.test(id) && !/^\\\\/.test(id) && !/^[A-Za-z]:/.test(id)) return id
  const segments = pathSegments(node.file)
  const anchor = segments.findIndex((segment) => KNOWN_FAMILY_SET.has(segment))
  if (anchor >= 0) return segments.slice(anchor).join('/')
  // fix-ok: cause reproduite par test (voir CausalHypothesis du RUN) — une fiche à la RACINE du brain
  // a un id sans séparateur ET un chemin absolu sans dossier de famille : sa « famille » devenait le nom
  // du SERVEUR (`ged2`), laissant le centre du disque vide. On ne garde que le nom du fichier ⇒ racine.
  return segments.at(-1) ?? ''
}

/** Famille d'un nœud = 1ᵉʳ segment de son chemin RELATIF, ou `<racine>`. */
export function familyOf(node: Pick<GraphNode, 'id' | 'file'>): string {
  const segments = pathSegments(relativePathOf(node))
  return segments.length <= 1 ? '<racine>' : segments[0]
}

/**
 * Thème de tri d'un nœud, au sens EXACT de l'app (`nodeThemeIds`, qui décide déjà sa COULEUR).
 * Trier les points d'une bande par cette clé regroupe les mêmes couleurs en ARCS CONTIGUS — c'est ce
 * qui donne les secteurs colorés de la référence, sans qu'aucune couleur ne soit recalculée ici.
 */
export function sortThemeOf(node: GraphNode): string {
  return nodeThemeIds(node)[0] ?? ''
}

/** Nombre de points qu'une rangée de rayon `r` accepte sans descendre sous l'écart minimal. */
export function rowCapacity(radius: number, minDotSpacing: number): number {
  return Math.max(1, Math.floor((2 * Math.PI * radius) / minDotSpacing))
}

type Placed = { dots: RadialDot[]; bands: RadialBand[] }

/**
 * Range chaque fiche sur le disque. AUCUNE fiche n'est agrégée ni perdue (invariant testé) : les bandes
 * denses gagnent des rangées au lieu de saturer une seule couronne.
 */
export function layoutRadial(
  nodes: readonly GraphNode[],
  options: RadialLayoutOptions = {}
): Placed {
  const families = options.families ?? DEFAULT_RING_FAMILIES
  const excluded = new Set(options.excluded ?? DEFAULT_EXCLUDED_FAMILIES)
  const rowGap = options.rowGap ?? DEFAULT_ROW_GAP
  const bandGap = options.bandGap ?? DEFAULT_BAND_GAP
  const minDotSpacing = options.minDotSpacing ?? DEFAULT_MIN_DOT_SPACING

  const present = new Set<string>()
  for (const node of nodes) {
    const family = familyOf(node)
    if (!excluded.has(family)) present.add(family)
  }
  const known = families.filter((family) => present.has(family))
  const unknown = [...present]
    .filter((family) => !families.includes(family))
    .sort((a, b) => a.localeCompare(b, 'fr'))
  const ringOrder = [...known, ...unknown]

  const dots: RadialDot[] = []
  const bands: RadialBand[] = []
  let radius = options.innerRadius ?? DEFAULT_INNER_RADIUS

  ringOrder.forEach((family, ring) => {
    // Tri par THÈME puis par identifiant : les mêmes couleurs deviennent adjacentes (arcs colorés), et
    // l'ordre est totalement déterministe — deux chargements donnent le même dessin.
    const familyNodes = nodes
      .filter((node) => familyOf(node) === family)
      .sort(
        (a, b) =>
          sortThemeOf(a).localeCompare(sortThemeOf(b), 'fr') ||
          String(a.id).localeCompare(String(b.id), 'fr')
      )
    if (familyNodes.length === 0) return

    const innerRadius = radius
    let index = 0
    let row = 0
    while (index < familyNodes.length) {
      const rowRadius = innerRadius + row * rowGap
      const capacity = rowCapacity(rowRadius, minDotSpacing)
      const slice = familyNodes.slice(index, index + capacity)
      const step = (2 * Math.PI) / slice.length
      // Chaque rangée tourne d'un demi-pas : deux rangées voisines ne s'alignent pas radialement,
      // sinon la bande se lit comme des rayons de roue au lieu d'une surface régulière.
      const offset = row % 2 === 0 ? 0 : step / 2
      slice.forEach((node, i) => {
        const angle = i * step + offset
        dots.push({
          id: String(node.id),
          fx: Math.cos(angle) * rowRadius,
          fy: Math.sin(angle) * rowRadius,
          // Disque STRICTEMENT plat : la caméra le regarde d'aplomb.
          fz: 0,
          ring,
          family,
          row
        })
      })
      index += slice.length
      row += 1
    }
    const outerRadius = innerRadius + Math.max(0, row - 1) * rowGap
    bands.push({
      ring,
      family,
      innerRadius,
      outerRadius,
      labelRadius: (innerRadius + outerRadius) / 2,
      notes: familyNodes.length,
      rows: row
    })
    radius = outerRadius + bandGap
  })

  return { dots, bands }
}

/** Rayon englobant — ce que la caméra doit cadrer pour que le disque tienne dans le champ. */
export function boundingRadius(dots: readonly RadialDot[]): number {
  return dots.reduce((max, dot) => Math.max(max, Math.hypot(dot.fx, dot.fy)), 0)
}
