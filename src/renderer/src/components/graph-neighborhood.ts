/**
 * VOISINAGE d'un nœud du graphe Brain — modèle pur, hors composant.
 *
 * Le panneau de détail ne montrait que les voisins DIRECTS. Or la question qu'on se pose devant une
 * fiche est presque toujours « et à quoi ça se rattache ensuite ? » : le deuxième saut. Il se
 * calcule à partir des liens DÉJÀ chargés — aucune lecture disque supplémentaire.
 */
import type { GraphNode } from './graph-view-model'

export interface GraphLien {
  source: string | { id?: string }
  target: string | { id?: string }
  relation?: string
}

/** Identifiant d'un bout de lien : la vue 3D remplace parfois l'id par l'objet nœud lui-même. */
export function boutId(bout: GraphLien['source']): string {
  if (typeof bout === 'string') return bout
  return typeof bout?.id === 'string' ? bout.id : ''
}

/** Voisins DIRECTS d'un nœud, avec le sens du lien et sa relation. */
export function voisinsDirects(
  nodeId: string,
  liens: readonly GraphLien[]
): Array<{ id: string; direction: 'incoming' | 'outgoing'; relation?: string }> {
  const out: Array<{ id: string; direction: 'incoming' | 'outgoing'; relation?: string }> = []
  for (const lien of liens) {
    const source = boutId(lien.source)
    const cible = boutId(lien.target)
    if (source === nodeId && cible && cible !== nodeId)
      out.push({ id: cible, direction: 'outgoing', ...(lien.relation ? { relation: lien.relation } : {}) })
    else if (cible === nodeId && source && source !== nodeId)
      out.push({ id: source, direction: 'incoming', ...(lien.relation ? { relation: lien.relation } : {}) })
  }
  return out
}

/** Degré du nœud : combien de liens entrent, combien sortent. */
export function degre(
  nodeId: string,
  liens: readonly GraphLien[]
): { entrants: number; sortants: number } {
  let entrants = 0
  let sortants = 0
  for (const lien of liens) {
    if (boutId(lien.source) === nodeId) sortants += 1
    if (boutId(lien.target) === nodeId) entrants += 1
  }
  return { entrants, sortants }
}

/**
 * Nœuds atteints en DEUX liens exactement : ni le nœud courant, ni ses voisins directs. Chaque
 * nœud n'apparaît qu'une fois, avec le voisin direct PAR lequel on l'atteint — c'est ce chemin qui
 * rend le second saut compréhensible plutôt qu'une liste de noms sans lien apparent.
 */
export function deuxiemeSaut(
  nodeId: string,
  liens: readonly GraphLien[],
  parId: ReadonlyMap<string, GraphNode>
): Array<{ node: GraphNode; via: GraphNode }> {
  const directs = new Set(voisinsDirects(nodeId, liens).map((voisin) => voisin.id))
  const vus = new Set<string>([nodeId, ...directs])
  const out: Array<{ node: GraphNode; via: GraphNode }> = []
  for (const direct of directs) {
    const relais = parId.get(direct)
    if (!relais) continue
    for (const loin of voisinsDirects(direct, liens)) {
      if (vus.has(loin.id)) continue
      const node = parId.get(loin.id)
      if (!node) continue
      vus.add(loin.id)
      out.push({ node, via: relais })
    }
  }
  return out
}
