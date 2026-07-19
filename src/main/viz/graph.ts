/**
 * Normalisation d'un graphe au format graphify (node-link JSON) vers un format
 * adapté à une visualisation 3D, avec support LOD (level of detail) et filtrage
 * par communauté.
 */

/** Format d'entrée brut produit par graphify. */
export interface RawGraph {
  directed?: boolean
  nodes: {
    id: string
    label?: string
    file_type?: string
    community?: number
    source_file?: string
  }[]
  links: {
    source: string
    target: string
    weight?: number
    relation?: string
  }[]
}

/** Nœud normalisé pour la visu 3D. */
export interface VizNode {
  id: string
  label: string
  group: number
  file?: string
  themes?: string[]
}

/** Lien normalisé pour la visu 3D. */
export interface VizLink {
  source: string
  target: string
  weight: number
  relation?: string
}

/** Graphe normalisé pour la visu 3D. */
export interface VizGraph {
  nodes: VizNode[]
  links: VizLink[]
  /** Taille de la source avant application du LOD, si la vue est tronquée. */
  totalNodes?: number
}

/**
 * Normalise un RawGraph (format graphify) en VizGraph exploitable par la visu 3D.
 * - label par défaut = id
 * - group par défaut = 0 (community absente)
 * - file = source_file (optionnel)
 * - weight des liens par défaut = 1
 * - un lien dont source ou target ne référence pas un nœud existant est IGNORÉ
 *   (robustesse face à un export graphify incohérent).
 */
export function normalize(raw: RawGraph): VizGraph {
  const nodes: VizNode[] = raw.nodes.map((n) => ({
    id: n.id,
    label: n.label ?? n.id,
    group: n.community ?? 0,
    file: n.source_file
  }))

  const knownIds = new Set(nodes.map((n) => n.id))

  const links: VizLink[] = raw.links
    .filter((l) => knownIds.has(l.source) && knownIds.has(l.target))
    .map((l) => ({
      source: l.source,
      target: l.target,
      weight: l.weight ?? 1,
      ...(l.relation === undefined ? {} : { relation: l.relation })
    }))

  return { nodes, links }
}

/**
 * Filtre un VizGraph pour ne garder que les nœuds d'une communauté donnée,
 * ainsi que les liens dont les deux extrémités appartiennent à cette communauté.
 */
export function filterByCommunity(g: VizGraph, community: number): VizGraph {
  const keptNodes = g.nodes.filter((n) => n.group === community)
  const keptIds = new Set(keptNodes.map((n) => n.id))
  const keptLinks = g.links.filter((l) => keptIds.has(l.source) && keptIds.has(l.target))

  return { nodes: keptNodes, links: keptLinks }
}

/**
 * LOD : retourne les n nœuds ayant le plus haut degré (nombre de liens incidents,
 * entrants + sortants), triés par degré décroissant. Si n dépasse le nombre de
 * nœuds, retourne tous les nœuds triés.
 */
export function topByDegree(g: VizGraph, n: number): VizNode[] {
  const degree = new Map<string, number>()
  for (const node of g.nodes) {
    degree.set(node.id, 0)
  }
  for (const link of g.links) {
    degree.set(link.source, (degree.get(link.source) ?? 0) + 1)
    degree.set(link.target, (degree.get(link.target) ?? 0) + 1)
  }

  return [...g.nodes].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0)).slice(0, n)
}
