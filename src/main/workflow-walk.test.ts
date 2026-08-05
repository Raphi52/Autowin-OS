import { describe, expect, it } from 'vitest'
import { nodeRanks, type WorkflowGraph } from './workflow-graph'
import { edgeKey, initialBudget, nextNode, type NodeVerdict } from './workflow-walk'

/**
 * Le marcheur est la pièce qui manquait pour que le graphe soit JOUÉ et non seulement dessiné.
 * Ces tests fixent les deux propriétés qui comptent : un retour quelconque est franchi (pas seulement
 * `judge → build`), et il finit TOUJOURS par s'épuiser — sans quoi le devis du run devient incalculable.
 */

const g = (parts: Partial<WorkflowGraph>): WorkflowGraph => ({
  entry: 'frame-1',
  nodes: [
    { id: 'frame-1', phase: 'frame' },
    { id: 'build-1', phase: 'build' },
    { id: 'judge-1', phase: 'judge' }
  ],
  edges: [
    { from: 'frame-1', to: 'build-1', when: 'always' },
    { from: 'build-1', to: 'judge-1', when: 'always' }
  ],
  ...parts
})

/** Déroule le run complet et rend la suite des nœuds visités. Le verdict est scripté par nœud visité. */
function walk(graph: WorkflowGraph, verdicts: NodeVerdict[]): string[] {
  const ranks = nodeRanks(graph)
  const budget = initialBudget(graph, ranks)
  const visites = [graph.entry]
  let courant = graph.entry
  for (let pas = 0; pas < 50; pas++) {
    const verdict = verdicts[pas] ?? 'green'
    const suivant = nextNode(graph, courant, verdict, budget, ranks)
    if (!suivant) break
    visites.push(suivant.to)
    courant = suivant.to
  }
  return visites
}

describe('marcher le graphe', () => {
  it('suit la chaîne simple jusqu’au bout', () => {
    expect(walk(g({}), [])).toEqual(['frame-1', 'build-1', 'judge-1'])
  })

  it('franchit un retour NON juge→build — celui que le moteur ne savait pas jouer', () => {
    const graph = g({
      edges: [
        { from: 'frame-1', to: 'build-1', when: 'always' },
        { from: 'build-1', to: 'judge-1', when: 'always' },
        // Un rejet qui remonte au FRAME : exactement l'arête que `unsupportedReturns` déclarait inerte.
        { from: 'judge-1', to: 'frame-1', when: 'red', maxTraversals: 1 }
      ]
    })
    expect(walk(graph, ['green', 'green', 'red'])).toEqual([
      'frame-1',
      'build-1',
      'judge-1',
      'frame-1',
      'build-1',
      'judge-1'
    ])
  })

  it('épuise le budget d’un retour : un rouge permanent ne boucle pas à l’infini', () => {
    const graph = g({
      edges: [
        { from: 'frame-1', to: 'build-1', when: 'always' },
        { from: 'build-1', to: 'judge-1', when: 'always' },
        { from: 'judge-1', to: 'build-1', when: 'red', maxTraversals: 2 }
      ]
    })
    const visites = walk(graph, Array(20).fill('red'))
    // 2 retours autorisés → le build est joué 1 + 2 fois, puis le run s'arrête faute d'arête franchissable.
    expect(visites.filter((id) => id === 'build-1')).toHaveLength(3)
    expect(visites[visites.length - 1]).toBe('judge-1')
  })

  it('une arête conditionnelle l’emporte sur une arête « always » du même nœud', () => {
    const graph = g({
      nodes: [
        { id: 'frame-1', phase: 'frame' },
        { id: 'build-1', phase: 'build' },
        { id: 'judge-1', phase: 'judge' },
        { id: 'clean-1', phase: 'clean' }
      ],
      edges: [
        { from: 'frame-1', to: 'build-1', when: 'always' },
        { from: 'build-1', to: 'judge-1', when: 'always' },
        { from: 'judge-1', to: 'clean-1', when: 'always' },
        { from: 'judge-1', to: 'build-1', when: 'red', maxTraversals: 1 }
      ]
    })
    // Sans la priorité au conditionnel, le juge rouge partirait vers `clean` et la réparation serait morte.
    expect(walk(graph, ['green', 'green', 'red'])).toContain('build-1')
    expect(walk(graph, ['green', 'green', 'red']).slice(0, 4)).toEqual([
      'frame-1',
      'build-1',
      'judge-1',
      'build-1'
    ])
  })

  it('un verdict vert emprunte l’arête verte, pas la rouge', () => {
    const graph = g({
      edges: [
        { from: 'frame-1', to: 'build-1', when: 'always' },
        { from: 'build-1', to: 'judge-1', when: 'always' },
        { from: 'judge-1', to: 'frame-1', when: 'red', maxTraversals: 3 }
      ]
    })
    expect(walk(graph, ['green', 'green', 'green'])).toEqual(['frame-1', 'build-1', 'judge-1'])
  })

  it('le budget initial ne compte que les retours, jamais les arêtes avant', () => {
    const graph = g({
      edges: [
        { from: 'frame-1', to: 'build-1', when: 'always' },
        { from: 'build-1', to: 'judge-1', when: 'always' },
        { from: 'judge-1', to: 'build-1', when: 'red', maxTraversals: 2 }
      ]
    })
    const budget = initialBudget(graph, nodeRanks(graph))
    expect([...budget.keys()]).toEqual([edgeKey({ from: 'judge-1', to: 'build-1', when: 'red' })])
    expect(budget.get(edgeKey({ from: 'judge-1', to: 'build-1', when: 'red' }))).toBe(2)
  })
})
