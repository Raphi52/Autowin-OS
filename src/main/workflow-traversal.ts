import { isReturnEdge, type EdgeCondition, type WorkflowGraph, type WorkflowNode } from './workflow-graph'

/**
 * Parcourir un graphe de workflow : quel nœud vient ensuite, et quand s'arrêter.
 *
 * Fonction PURE, séparée de l'orchestrateur à dessein. La sémantique d'exécution — « un juge rouge renvoie au
 * build, mais pas plus de deux fois » — est ce qu'il y a de plus facile à casser sans s'en apercevoir, et de plus
 * pénible à prouver au milieu d'un run réel. Ici elle se vérifie en millisecondes, sans provider.
 *
 * Le PASSAGE est l'unité, pas la phase. Un nœud joué deux fois produit deux passages distincts, numérotés. C'est
 * ce qui permet à la fois de rejouer un run à l'identique et de reprendre après un crash au bon endroit — un
 * index par phase serait ambigu dès la première boucle.
 */

export interface Passage {
  nodeId: string
  /** Rang de ce passage sur ce nœud, à partir de 1. Deux visites du même nœud ne se confondent pas. */
  occurrence: number
  /** Verdict observé à la sortie ; absent tant que le passage n'est pas joué. */
  outcome?: 'green' | 'red'
}

export interface TraversalState {
  /** Chemin déjà parcouru, dans l'ordre. C'est LA trace : rejeu et reprise s'en servent tous les deux. */
  path: Passage[]
  /** Franchissements déjà consommés, par arête. */
  traversals: Record<string, number>
}

export type TraversalStep =
  | { kind: 'run'; node: WorkflowNode; occurrence: number }
  | { kind: 'done'; reason: 'fin-de-graphe' | 'limites-atteintes' }

export function emptyTraversal(): TraversalState {
  return { path: [], traversals: {} }
}

const edgeKey = (from: string, to: string, when: EdgeCondition): string => `${from}>${to}:${when}`

/** Une arête `green`/`red` ne s'applique qu'au verdict correspondant ; `always` s'applique toujours. */
function matches(condition: EdgeCondition, outcome: 'green' | 'red' | undefined): boolean {
  if (condition === 'always') return true
  return condition === outcome
}

/**
 * Prochain pas à jouer. `state` n'est jamais modifié : l'appelant enregistre le résultat via `recordPassage`,
 * ce qui rend le parcours rejouable à partir de n'importe quelle trace.
 */
export function nextStep(graph: WorkflowGraph, state: TraversalState): TraversalStep {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))

  const dernier = state.path[state.path.length - 1]
  if (!dernier) {
    const entree = byId.get(graph.entry)
    return entree
      ? { kind: 'run', node: entree, occurrence: 1 }
      : { kind: 'done', reason: 'fin-de-graphe' }
  }
  // Un passage non résolu se rejoue : c'est le cas d'une reprise après crash en plein milieu d'un nœud.
  if (dernier.outcome === undefined) {
    const node = byId.get(dernier.nodeId)
    return node
      ? { kind: 'run', node, occurrence: dernier.occurrence }
      : { kind: 'done', reason: 'fin-de-graphe' }
  }

  const ranks = forwardRanksOf(graph, byId)
  const candidates = graph.edges.filter(
    (edge) => edge.from === dernier.nodeId && matches(edge.when, dernier.outcome)
  )
  if (candidates.length === 0) return { kind: 'done', reason: 'fin-de-graphe' }

  let bloquee = false
  for (const edge of candidates) {
    if (isReturnEdge(edge, ranks)) {
      const consommes = state.traversals[edgeKey(edge.from, edge.to, edge.when)] ?? 0
      // La borne est ce qui garantit la terminaison : une fois épuisée, ce retour n'existe plus.
      if (consommes >= (edge.maxTraversals ?? 0)) {
        bloquee = true
        continue
      }
    }
    const cible = byId.get(edge.to)
    if (!cible) continue
    const occurrence = state.path.filter((p) => p.nodeId === edge.to).length + 1
    return { kind: 'run', node: cible, occurrence }
  }
  // Distinguer « le graphe est fini » de « on a épuisé les reprises » : ce n'est pas le même résultat pour
  // l'utilisateur, et le second doit se lire dans le rapport.
  return { kind: 'done', reason: bloquee ? 'limites-atteintes' : 'fin-de-graphe' }
}

/** Enregistre un passage joué et son verdict, en consommant l'arête empruntée pour y arriver. */
export function recordPassage(
  graph: WorkflowGraph,
  state: TraversalState,
  nodeId: string,
  occurrence: number,
  outcome: 'green' | 'red'
): TraversalState {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  const ranks = forwardRanksOf(graph, byId)
  const precedent = state.path[state.path.length - 1]

  const traversals = { ...state.traversals }
  if (precedent && precedent.nodeId !== nodeId) {
    const edge = graph.edges.find(
      (candidate) =>
        candidate.from === precedent.nodeId &&
        candidate.to === nodeId &&
        matches(candidate.when, precedent.outcome)
    )
    if (edge && isReturnEdge(edge, ranks)) {
      const key = edgeKey(edge.from, edge.to, edge.when)
      traversals[key] = (traversals[key] ?? 0) + 1
    }
  }

  const path = [...state.path]
  const dejaOuvert = path[path.length - 1]
  if (dejaOuvert && dejaOuvert.nodeId === nodeId && dejaOuvert.occurrence === occurrence && dejaOuvert.outcome === undefined) {
    path[path.length - 1] = { ...dejaOuvert, outcome }
  } else {
    path.push({ nodeId, occurrence, outcome })
  }
  return { path, traversals }
}

/** Ouvre un passage AVANT de le jouer — c'est ce qui rend une reprise possible si le process meurt pendant. */
export function openPassage(
  state: TraversalState,
  nodeId: string,
  occurrence: number
): TraversalState {
  return { ...state, path: [...state.path, { nodeId, occurrence }] }
}

/**
 * Rejoue une trace enregistrée : la suite des passages, dans l'ordre, telle qu'elle s'est produite. Rejouer un
 * run n'est donc pas « relancer le graphe en espérant le même chemin », c'est suivre celui qui a eu lieu.
 */
export function replayPath(state: TraversalState): Passage[] {
  return state.path.filter((passage) => passage.outcome !== undefined)
}

function forwardRanksOf(
  graph: WorkflowGraph,
  byId: Map<string, WorkflowNode>
): Map<string, number> {
  const rank = new Map<string, number>()
  const walk = (id: string, depth: number): void => {
    if (!byId.has(id)) return
    const seen = rank.get(id)
    if (seen !== undefined && seen <= depth) return
    rank.set(id, depth)
    for (const edge of graph.edges) if (edge.from === id && edge.to !== id) walk(edge.to, depth + 1)
  }
  walk(graph.entry, 0)
  return rank
}
