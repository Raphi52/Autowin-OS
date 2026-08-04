import type { PipelinePhase } from './skill-pipeline'
import type { RoleBinding } from './roles'

/**
 * Un workflow comme GRAPHE, et non plus comme liste de phases.
 *
 * La liste linéaire ne sait pas exprimer le cas réel le plus fréquent : un juge qui rejette et renvoie au build,
 * ou une approche invalidée qui remonte au frame. Ce module pose le modèle et — surtout — la règle qui rend un
 * tel graphe EXÉCUTABLE.
 *
 * La règle porteuse : TOUTE ARÊTE DE RETOUR EST BORNÉE. Ce n'est pas une précaution de confort, c'est ce qui
 * garde le devis calculable. L'orchestrateur refuse un run dont il ne peut pas garantir la clôture en comptant
 * ses phases à l'avance ; avec des boucles non bornées ce compte n'existe plus et le devis devient impossible.
 * Avec des bornes, le pire cas reste FINI et se calcule exactement — on ne troque donc aucune garantie contre
 * l'expressivité du graphe.
 */

/** Ce qui fait franchir une arête. Une seule sortie `always`, sinon on choisit sur le verdict. */
export type EdgeCondition = 'always' | 'green' | 'red'

export interface WorkflowNode {
  id: string
  phase: PipelinePhase
  /** Les agents qui exécutent ce nœud. Plusieurs = fan-out ; le canevas les rend visibles. */
  agents?: RoleBinding[]
  /** Voix concordantes exigées parmi les agents. Absent = majorité simple. */
  quorum?: number
}

export interface WorkflowEdge {
  from: string
  to: string
  when: EdgeCondition
  /**
   * Nombre maximal de franchissements pour une arête de RETOUR (qui pointe vers un nœud déjà visité).
   * Obligatoire sur un retour, ignoré sur une arête avant.
   */
  maxTraversals?: number
}

export interface WorkflowGraph {
  entry: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

export interface GraphDefect {
  /** Pour que le canevas surligne le fautif au lieu d'afficher un message global. */
  target?: string
  message: string
}

const MAX_TRAVERSALS_CEILING = 10

function indexNodes(graph: WorkflowGraph): Map<string, WorkflowNode> {
  const byId = new Map<string, WorkflowNode>()
  for (const node of graph.nodes) if (!byId.has(node.id)) byId.set(node.id, node)
  return byId
}

/** Ordre d'atteinte depuis l'entrée en ne suivant que les arêtes avant — sert à qualifier les retours. */
function forwardRanks(graph: WorkflowGraph, byId: Map<string, WorkflowNode>): Map<string, number> {
  const rank = new Map<string, number>()
  const walk = (id: string, depth: number): void => {
    if (!byId.has(id)) return
    const seen = rank.get(id)
    if (seen !== undefined && seen <= depth) return
    rank.set(id, depth)
    for (const edge of graph.edges) {
      if (edge.from === id && edge.to !== id) walk(edge.to, depth + 1)
    }
  }
  walk(graph.entry, 0)
  return rank
}

/**
 * Une arête est un RETOUR si elle pointe vers un nœud atteint plus tôt (ou vers elle-même). C'est la définition
 * qui compte pour la terminaison : une arête « avant » ne peut pas faire boucler.
 */
export function isReturnEdge(edge: WorkflowEdge, ranks: Map<string, number>): boolean {
  if (edge.from === edge.to) return true
  const from = ranks.get(edge.from)
  const to = ranks.get(edge.to)
  if (from === undefined || to === undefined) return false
  return to <= from
}

/**
 * Tout ce qui empêcherait ce graphe de tourner. Retourne une LISTE : le canevas doit pouvoir tout signaler d'un
 * coup, pas faire découvrir les problèmes un par un.
 */
export function graphDefects(graph: WorkflowGraph): GraphDefect[] {
  const defects: GraphDefect[] = []
  const byId = indexNodes(graph)

  if (graph.nodes.length === 0) {
    return [{ message: 'Le workflow est vide : aucune phase à jouer.' }]
  }
  const vus = new Set<string>()
  for (const node of graph.nodes) {
    if (vus.has(node.id)) defects.push({ target: node.id, message: `Deux nœuds portent l’id ${node.id}.` })
    vus.add(node.id)
    if (node.quorum !== undefined) {
      const agents = node.agents?.length ?? 1
      if (node.quorum < 1 || node.quorum > agents) {
        defects.push({
          target: node.id,
          message: `Quorum ${node.quorum} impossible pour ${agents} agent(s).`
        })
      }
    }
  }
  if (!byId.has(graph.entry)) {
    defects.push({ message: `Le point d’entrée ${graph.entry} ne correspond à aucun nœud.` })
    return defects
  }

  const ranks = forwardRanks(graph, byId)
  for (const edge of graph.edges) {
    if (!byId.has(edge.from)) {
      defects.push({ target: edge.from, message: `Une arête part d’un nœud inconnu (${edge.from}).` })
      continue
    }
    if (!byId.has(edge.to)) {
      defects.push({ target: edge.to, message: `Une arête pointe vers un nœud inconnu (${edge.to}).` })
      continue
    }
    if (!isReturnEdge(edge, ranks)) continue
    // Le cœur de la règle : sans borne, le run peut ne jamais finir ET le devis devient incalculable.
    if (typeof edge.maxTraversals !== 'number' || !Number.isInteger(edge.maxTraversals)) {
      defects.push({
        target: edge.from,
        message: `Le retour ${edge.from} → ${edge.to} doit porter une limite : sans elle le run peut ne jamais s’arrêter.`
      })
      continue
    }
    if (edge.maxTraversals < 1 || edge.maxTraversals > MAX_TRAVERSALS_CEILING) {
      defects.push({
        target: edge.from,
        message: `La limite du retour ${edge.from} → ${edge.to} doit être entre 1 et ${MAX_TRAVERSALS_CEILING}.`
      })
    }
  }

  // Un nœud jamais atteint n'est pas une erreur fatale, mais c'est du travail composé pour rien : le dire.
  for (const node of graph.nodes) {
    if (!ranks.has(node.id)) {
      defects.push({ target: node.id, message: `${node.id} n’est jamais atteint depuis l’entrée.` })
    }
  }
  return defects
}

/**
 * Pire cas d'exécutions par nœud. C'est ce nombre — et non `phases.length` — que le devis doit provisionner.
 * Chaque retour franchissable rejoue au plus tout ce qui est atteignable depuis sa cible, d'où le produit des
 * bornes plutôt que leur somme : deux boucles imbriquées se multiplient, elles ne s'additionnent pas.
 */
export function worstCaseVisits(graph: WorkflowGraph): Map<string, number> {
  const byId = indexNodes(graph)
  const ranks = forwardRanks(graph, byId)
  const visits = new Map<string, number>()
  for (const id of ranks.keys()) visits.set(id, 1)

  for (const edge of graph.edges) {
    if (!isReturnEdge(edge, ranks)) continue
    const bound = edge.maxTraversals
    if (typeof bound !== 'number' || bound < 1) continue
    // Tout ce qui est réatteignable depuis la cible du retour est rejoué autant de fois que la borne l'autorise.
    for (const id of reachableFrom(graph, edge.to, byId)) {
      visits.set(id, (visits.get(id) ?? 1) * (1 + bound))
    }
  }
  return visits
}

function reachableFrom(
  graph: WorkflowGraph,
  start: string,
  byId: Map<string, WorkflowNode>
): Set<string> {
  const atteints = new Set<string>()
  const pile = [start]
  while (pile.length) {
    const id = pile.pop()!
    if (atteints.has(id) || !byId.has(id)) continue
    atteints.add(id)
    for (const edge of graph.edges) if (edge.from === id) pile.push(edge.to)
  }
  return atteints
}

/** Total d'exécutions à provisionner — remplace `phases.length` dans le calcul du devis. */
export function worstCaseNodeExecutions(graph: WorkflowGraph): number {
  let total = 0
  for (const count of worstCaseVisits(graph).values()) total += count
  return total
}

/**
 * Le retour « juge rouge → build » exprimé par le graphe, traduit en nombre de réparations.
 *
 * L'orchestrateur sait DÉJÀ rejouer un build nourri du retour du gate puis re-juger — c'est
 * `maxRecoveries`, borné et éprouvé. Cette arête-là n'a donc pas besoin d'un second moteur : elle se
 * branche sur celui qui existe (réflexe : câbler plutôt que recréer).
 */
export function recoveriesFromGraph(graph: WorkflowGraph): number | undefined {
  const byId = indexNodes(graph)
  const ranks = forwardRanks(graph, byId)
  for (const edge of graph.edges) {
    if (edge.when !== 'red' || !isReturnEdge(edge, ranks)) continue
    if (byId.get(edge.from)?.phase !== 'judge') continue
    if (byId.get(edge.to)?.phase !== 'build') continue
    if (typeof edge.maxTraversals === 'number') return edge.maxTraversals
  }
  return undefined
}

/**
 * Les retours que le moteur ne sait PAS encore jouer — un rejet qui remonte au frame, par exemple.
 *
 * Cette liste existe pour que le canevas puisse le DIRE au lieu de laisser composer quelque chose
 * d'inerte : le piège serait un graphe accepté à l'écran dont une arête n'a aucun effet réel.
 */
export function unsupportedReturns(graph: WorkflowGraph): WorkflowEdge[] {
  const byId = indexNodes(graph)
  const ranks = forwardRanks(graph, byId)
  return graph.edges.filter((edge) => {
    if (!isReturnEdge(edge, ranks)) return false
    const depuis = byId.get(edge.from)?.phase
    const vers = byId.get(edge.to)?.phase
    return !(edge.when === 'red' && depuis === 'judge' && vers === 'build')
  })
}

/**
 * Convertit un workflow linéaire d'avant ce chantier en graphe. Sans cette conversion, tout profil déjà
 * enregistré deviendrait illisible le jour où le modèle change.
 */
export function graphFromPhases(phases: readonly PipelinePhase[]): WorkflowGraph {
  // Numéroté par PHASE et non par rang dans le tableau : `frame-1, build-2` se lit comme s'il
  // manquait un build. Deux `build` restent malgré tout distincts (`build-1`, `build-2`).
  const vus = new Map<string, number>()
  const nodes = phases.map((phase) => {
    const rang = (vus.get(phase) ?? 0) + 1
    vus.set(phase, rang)
    return { id: `${phase}-${rang}`, phase }
  })
  const edges = nodes.slice(0, -1).map((node, index) => ({
    from: node.id,
    to: nodes[index + 1].id,
    when: 'always' as const
  }))
  return { entry: nodes[0]?.id ?? '', nodes, edges }
}

/** La suite de phases d'un graphe SANS retour — permet au moteur linéaire actuel de jouer un graphe simple. */
export function linearPhasesOf(graph: WorkflowGraph): PipelinePhase[] | undefined {
  const byId = indexNodes(graph)
  const ranks = forwardRanks(graph, byId)
  if (graph.edges.some((edge) => isReturnEdge(edge, ranks))) return undefined
  const suite: PipelinePhase[] = []
  let courant: string | undefined = graph.entry
  const vus = new Set<string>()
  while (courant && byId.has(courant) && !vus.has(courant)) {
    vus.add(courant)
    suite.push(byId.get(courant)!.phase)
    const sortantes = graph.edges.filter((edge) => edge.from === courant)
    if (sortantes.length > 1) return undefined // un embranchement n'est pas une suite linéaire
    courant = sortantes[0]?.to
  }
  return suite.length ? suite : undefined
}
