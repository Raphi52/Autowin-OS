/**
 * UNE SÉLECTION DE CANDIDATS SCOUT NE REJOUE PAS LE SCOUT — côté WORKFLOW du fil.
 *
 * Demande utilisateur du 2026-10-22 (conv-1080) : « le doublon enlève-le, ça c'est sûr ». Le message
 * envoyé par le panneau des candidats sort d'un scout qui vient d'éclairer et de localiser ses
 * pistes. Or un workflow qui porte un nœud `scout` (« Chantier Autowin », « Exploration »), qu'il
 * soit choisi à la main ou par le modèle, le rejouait en tête du run : un deuxième éclairage payé
 * pour la même question. Le régime par défaut, lui, est traité dans `task-regime.ts`.
 *
 * Le nœud est CONTOURNÉ, pas seulement effacé : son prédécesseur est relié à ses successeurs, pour
 * que `think → scout → frame` devienne `think → frame` et que le graphe reste jouable. Le workflow
 * garde son nom et tous ses autres nœuds — seul le doublon part.
 */
import type { NodePhase } from '../shared/pipeline-phases'
import { estSelectionDeScout } from '../shared/selection-scout'
import type { WorkflowRunOverride } from './orchestrator'
import type { WorkflowEdge, WorkflowGraph } from './workflow-graph'

/**
 * Le graphe sans les nœuds d'une phase, chaque nœud retiré étant contourné. `undefined` si rien ne
 * reste à jouer. Graphe sans nœud de cette phase → rendu TEL QUEL (même référence).
 */
export function graphSansPhase(graph: WorkflowGraph, phase: NodePhase): WorkflowGraph | undefined {
  const retires = new Set(graph.nodes.filter((node) => node.phase === phase).map((n) => n.id))
  if (retires.size === 0) return graph
  const nodes = graph.nodes.filter((node) => !retires.has(node.id))
  if (nodes.length === 0) return undefined

  // Où mène un nœud retiré : ses successeurs gardés, en traversant une chaîne de nœuds retirés.
  // On suit ses arêtes `always` (le chemin normal) ; à défaut, toutes ses sorties.
  const destinations = (id: string, vus: Set<string> = new Set()): string[] => {
    if (!retires.has(id)) return [id]
    if (vus.has(id)) return []
    vus.add(id)
    const sorties = graph.edges.filter((edge) => edge.from === id)
    const normales = sorties.filter((edge) => edge.when === 'always')
    return (normales.length ? normales : sorties).flatMap((edge) => destinations(edge.to, vus))
  }

  const edges: WorkflowEdge[] = []
  const deja = new Set<string>()
  const ajouter = (edge: WorkflowEdge): void => {
    const cle = `${edge.from}|${edge.to}|${edge.when}`
    if (deja.has(cle) || edge.from === edge.to) return
    deja.add(cle)
    edges.push(edge)
  }
  for (const edge of graph.edges) {
    if (retires.has(edge.from)) continue
    for (const to of destinations(edge.to)) ajouter({ ...edge, to })
  }
  const entry = destinations(graph.entry)[0] ?? nodes[0]!.id
  return { entry, nodes, edges }
}

/**
 * Le workflow du run, sans son nœud `scout` quand la demande est une sélection de candidats scout.
 * Toute autre demande, ou un workflow sans scout, passe inchangé.
 */
export function workflowSansScoutPourSelection(
  workflow: WorkflowRunOverride | undefined,
  task: string
): WorkflowRunOverride | undefined {
  if (!workflow || !estSelectionDeScout(task)) return workflow
  const aScoutDansPhases = workflow.phases?.includes('scout') ?? false
  const graph = workflow.graph ? graphSansPhase(workflow.graph, 'scout') : undefined
  if (!aScoutDansPhases && graph === workflow.graph) return workflow
  const sansScout: WorkflowRunOverride = { ...workflow }
  delete sansScout.graph
  delete sansScout.phases
  const phasesGardees = workflow.phases?.filter((p) => p !== 'scout')
  return {
    ...sansScout,
    ...(graph ? { graph } : {}),
    ...(phasesGardees?.length ? { phases: phasesGardees } : {})
  }
}
