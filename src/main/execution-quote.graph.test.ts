import { describe, expect, it } from 'vitest'
import { allocateExecutionTopology, compileExecutionQuote } from './execution-quote'
import { worstCaseNodeExecutions, type WorkflowGraph } from './workflow-graph'

const requete = (over: Record<string, unknown> = {}) => ({
  phases: ['frame', 'build'] as never,
  completedPhases: [] as never,
  startedAgents: 0,
  startedCalls: 0,
  mutation: false,
  hasDecomposer: false,
  phaseFanOut: {},
  judgeFanOut: 0,
  ...over
})

const boucle: WorkflowGraph = {
  entry: 'f',
  nodes: [
    { id: 'f', phase: 'frame' },
    { id: 'b', phase: 'build' },
    { id: 'j', phase: 'judge' }
  ],
  edges: [
    { from: 'f', to: 'b', when: 'always' },
    { from: 'b', to: 'j', when: 'always' },
    { from: 'j', to: 'b', when: 'red', maxTraversals: 2 }
  ]
}

/**
 * Le devis refuse un run dont il ne peut pas garantir la clôture, en comptant les phases avant de partir. Un
 * graphe à boucles rejoue des nœuds : sans ce provisionnement, le run est accepté puis coupé en plein milieu.
 */
describe('provisionner un graphe à boucles', () => {
  it('un pipeline linéaire compte ses phases, comme avant', () => {
    const quote = compileExecutionQuote('corrige le bug')
    const alloc = allocateExecutionTopology(quote, requete())
    expect(alloc.reservedMandatoryAgents).toBe(3) // 2 phases + 1 passe de juge
  })

  it('un graphe à boucles provisionne son PIRE CAS, pas sa liste de phases', () => {
    const quote = compileExecutionQuote('refonte architecture sécurité migration')
    const pireCas = worstCaseNodeExecutions(boucle) // 1 + 3 + 3
    expect(pireCas).toBe(7)
    const alloc = allocateExecutionTopology(
      quote,
      requete({ phases: ['frame', 'build', 'judge'], worstCaseNodeExecutions: pireCas })
    )
    // Le nœud judge est déjà l'une des 7 visites : le rajouter créerait un appel fantôme.
    expect(alloc.reservedMandatoryAgents).toBe(pireCas)
  })

  it('un graphe trop gourmand est REFUSÉ avant de dépenser, pas coupé en route', () => {
    // Régime standard : les 2 phases seules passent, c'est bien le pire cas du graphe qui fait refuser.
    const quote = compileExecutionQuote('corrige le bug')
    expect(() => allocateExecutionTopology(quote, requete())).not.toThrow()
    expect(() =>
      allocateExecutionTopology(quote, requete({ worstCaseNodeExecutions: 40 }))
    ).toThrow('Devis impossible')
  })

  it('le pire cas ne peut pas SOUS-provisionner la liste de phases', () => {
    // Une valeur absente ou incohérente ne doit jamais réduire ce qui était déjà réservé.
    const quote = compileExecutionQuote('corrige le bug')
    const alloc = allocateExecutionTopology(quote, requete({ worstCaseNodeExecutions: 1 }))
    expect(alloc.reservedMandatoryAgents).toBe(2)
  })

  it('absent, le comportement est strictement celui d’avant', () => {
    const quote = compileExecutionQuote('corrige le bug')
    expect(allocateExecutionTopology(quote, requete())).toEqual(
      allocateExecutionTopology(quote, requete({ worstCaseNodeExecutions: undefined }))
    )
  })
})
