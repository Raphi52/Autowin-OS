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
/**
 * Ce que le MODÈLE a demandé pour la suite, s'il a demandé quelque chose.
 *
 * Un workflow est un OUTIL, pas une laisse. Le graphe dit ce qui est prévu ; l'agent qui vient de
 * travailler est le mieux placé pour savoir si l'étape prévue a encore un sens. Quand il se prononce,
 * il a le DERNIER MOT — y compris pour s'arrêter, ou pour aller vers une phase que le graphe
 * n'enchaînait pas. Le forcer produirait des phases jouées pour rien, ce que le devis paierait.
 */
export type ModelChoice =
  | { kind: 'node'; id: string }
  | { kind: 'phase'; phase: string }
  | { kind: 'stop' }
  | undefined

/**
 * Résout le souhait du modèle en un nœud du graphe. Rend `undefined` s'il ne désigne rien de
 * connu — on retombe alors sur le graphe plutôt que d'inventer une destination.
 */
export function resolveChoice(graph: WorkflowGraph, choice: ModelChoice): string | undefined {
  if (!choice || choice.kind === 'stop') return undefined
  if (choice.kind === 'node') return graph.nodes.find((n) => n.id === choice.id)?.id
  return graph.nodes.find((n) => n.phase === choice.phase)?.id
}

export function nextNode(
  graph: WorkflowGraph,
  from: string,
  verdict: NodeVerdict,
  budget: TraversalBudget,
  ranks: Map<string, number>,
  choice?: ModelChoice
): { to: string; edge: WorkflowEdge } | undefined {
  // LE MODÈLE D'ABORD. Un arrêt demandé est un arrêt ; une destination connue est honorée, même si
  // aucune arête ne la desservait. Le budget de l'arête correspondante est tout de même consommé
  // quand elle existe : le pire cas provisionné doit rester une borne, pas une estimation.
  if (choice) {
    if (choice.kind === 'stop') return undefined
    const voulu = resolveChoice(graph, choice)
    if (voulu) {
      const arete = graph.edges.find((e) => e.from === from && e.to === voulu)
      if (arete && isReturnEdge(arete, ranks)) {
        const cle = edgeKey(arete)
        budget.set(cle, (budget.get(cle) ?? arete.maxTraversals ?? 0) - 1)
      }
      return { to: voulu, edge: arete ?? { from, to: voulu, when: 'always' } }
    }
  }
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

/**
 * Lit le souhait du modèle dans sa sortie : une ligne `SUITE: <phase|id|fin>`.
 *
 * Cherché en FIN de sortie et sur une ligne à lui : un compte rendu qui mentionne « suite » au fil
 * du texte raconte son travail, il ne pilote pas. Absent = le graphe décide, ce qui reste le cas
 * courant — on n'oblige personne à se prononcer.
 */
export function readModelChoice(text: string): ModelChoice {
  const ligne = text
    .split('\n')
    .reverse()
    .find((l) => /^\s*SUITE\s*:/i.test(l))
  if (!ligne) return undefined
  const valeur = ligne.replace(/^\s*SUITE\s*:/i, '').trim()
  if (!valeur) return undefined
  if (/^(fin|stop|aucune?|rien)$/i.test(valeur)) return { kind: 'stop' }
  // Un id de nœud porte un tiret et un rang (`build-2`) ; un nom de phase, non.
  return /-\d+$/.test(valeur) ? { kind: 'node', id: valeur } : { kind: 'phase', phase: valeur }
}

/** Budget initial : chaque arête de retour part avec sa borne. Une arête avant n'a pas de budget. */
export function initialBudget(graph: WorkflowGraph, ranks: Map<string, number>): TraversalBudget {
  const budget: TraversalBudget = new Map()
  for (const edge of graph.edges) {
    if (isReturnEdge(edge, ranks)) budget.set(edgeKey(edge), edge.maxTraversals ?? 0)
  }
  return budget
}
