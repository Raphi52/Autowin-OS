import {
  isReturnEdge,
  type EdgeCondition,
  type WorkflowEdge,
  type WorkflowGraph
} from './workflow-graph'

/**
 * Marcher le graphe, au lieu de dérouler un tableau de phases.
 *
 * `linearPhasesOf()` rendait `undefined` dès qu'un graphe portait un retour ou un embranchement : le moteur
 * retombait alors sur les phases du régime et TOUTE la topologie composée à l'écran était perdue. Ce module
 * fournit la décision élémentaire — « quel nœud après celui-ci, sachant son verdict ? » — sous forme PURE, pour
 * qu'elle soit vérifiable sans orchestrateur, sans provider et sans horloge.
 *
 * La règle de terminaison est celle du modèle, et elle n'est pas relâchée ici : chaque arête de RETOUR porte un
 * budget `maxTraversals` qui se consomme. Budget épuisé = l'arête n'existe plus pour ce run. Le pire cas reste
 * donc exactement celui que `worstCaseVisits()` a provisionné, et le devis reste calculable.
 */

/** Ce qu'un nœud rend au marcheur. `green` laisse passer les arêtes `always` et `green`, `red` les `always` et `red`. */
export type NodeVerdict = 'green' | 'red'

/** Compteur de franchissements, porté d'un pas à l'autre. La clé identifie l'arête, pas le nœud. */
export type TraversalBudget = Map<string, number>

export function edgeKey(edge: Pick<WorkflowEdge, 'from' | 'to' | 'when'>): string {
  return `${edge.from}>${edge.to}:${edge.when}`
}

function matches(when: EdgeCondition, verdict: NodeVerdict): boolean {
  return when === 'always' || when === verdict
}

/**
 * Le nœud suivant, ou `undefined` si le run s'arrête ici.
 *
 * Priorité délibérée : une arête CONDITIONNELLE qui correspond au verdict l'emporte sur une arête `always`
 * partant du même nœud. Sans cette règle, un `judge` portant à la fois « toujours → fin » et « rouge → build »
 * ne reviendrait jamais au build — l'arête de réparation serait composable et morte, exactement le piège que
 * `unsupportedReturns()` dénonçait.
 */
export function nextNode(
  graph: WorkflowGraph,
  from: string,
  verdict: NodeVerdict,
  budget: TraversalBudget,
  ranks: Map<string, number>
): { to: string; edge: WorkflowEdge } | undefined {
  const sortantes = graph.edges.filter((edge) => edge.from === from && matches(edge.when, verdict))
  // Une arête de retour épuisée est retirée du choix : c'est ce qui borne le run.
  const franchissables = sortantes.filter((edge) => {
    if (!isReturnEdge(edge, ranks)) return true
    const reste = budget.get(edgeKey(edge))
    return typeof reste === 'number' ? reste > 0 : (edge.maxTraversals ?? 0) > 0
  })
  if (!franchissables.length) return undefined

  const conditionnelle = franchissables.find((edge) => edge.when === verdict)
  const choisie = conditionnelle ?? franchissables[0]
  if (isReturnEdge(choisie, ranks)) {
    const cle = edgeKey(choisie)
    const reste = budget.get(cle) ?? choisie.maxTraversals ?? 0
    budget.set(cle, reste - 1)
  }
  return { to: choisie.to, edge: choisie }
}

/** Budget initial : chaque arête de retour part avec sa borne. Une arête avant n'a pas de budget. */
export function initialBudget(graph: WorkflowGraph, ranks: Map<string, number>): TraversalBudget {
  const budget: TraversalBudget = new Map()
  for (const edge of graph.edges) {
    if (isReturnEdge(edge, ranks)) budget.set(edgeKey(edge), edge.maxTraversals ?? 0)
  }
  return budget
}
