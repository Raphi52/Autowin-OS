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
  it('un pipeline linéaire provisionne ses phases, ses passes de juge ET ses réparations', () => {
    /**
     * ATTENDAIT 3 — « 2 phases + 1 passe de juge » — parce que le devis n'accordait AUCUNE
     * réparation à une tâche non-mutation (`requete()` porte `mutation: false`). C'était le miroir
     * d'une règle de l'orchestrateur qui refusait de réparer un run d'analyse, corrigée le
     * 2026-08-20 : un refus « analyse absente » ou « DoD non cochée » se répare par un nouveau
     * passage, et le contrat racine adapte déjà ses exigences à un run en lecture seule.
     *
     * Le devis provisionne donc maintenant ces passages, sans quoi la dépense serait NON PROVISIONNÉE
     * et le run coupé en plein milieu. La composition, pour un pipeline plat :
     *   2 phases + (1 + 1) passes de juge + 1 build de réparation = 5.
     */
    const quote = compileExecutionQuote('corrige le bug')
    expect(quote.limits.maxRecoveries).toBe(1) // la source du chiffre, pas une constante magique
    const alloc = allocateExecutionTopology(quote, requete())
    expect(alloc.reservedMandatoryAgents).toBe(
      2 + (1 + quote.limits.maxRecoveries) + quote.limits.maxRecoveries
    )
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

  it('un graphe trop gourmand est REFUSÉ avant de dépenser — en mode bloquant seulement', () => {
    // Régime standard : les 2 phases seules passent, c'est bien le pire cas du graphe qui fait refuser.
    // Depuis conv-1148 (13/08), ce refus est réservé au mode `blocking` : en mesure seule (défaut),
    // le devis s'agrandit au pire cas du graphe au lieu de tuer le run.
    const bloquant = compileExecutionQuote('corrige le bug', { spendEnforcement: 'blocking' })
    expect(() => allocateExecutionTopology(bloquant, requete())).not.toThrow()
    expect(() =>
      allocateExecutionTopology(bloquant, requete({ worstCaseNodeExecutions: 40 }))
    ).toThrow("Plan d’exécution impossible")
    const mesure = compileExecutionQuote('corrige le bug')
    const alloc = allocateExecutionTopology(mesure, requete({ worstCaseNodeExecutions: 40 }))
    expect(alloc.reservedMandatoryAgents).toBe(40)
    expect(mesure.limits.maxProviderCalls).toBeGreaterThanOrEqual(40)
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
