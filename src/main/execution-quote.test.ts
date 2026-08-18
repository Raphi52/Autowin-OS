import { describe, expect, it } from 'vitest'
import { allocateExecutionTopology, compileExecutionQuote } from './execution-quote'

describe('ExecutionQuote', () => {
  it('ne paie jamais un decomposeur pour une demande standard courte', () => {
    const quote = compileExecutionQuote('place la scrollbar tout en bas du panneau')

    expect(quote).toMatchObject({
      schema: 'autowin.execution-quote/v1',
      regime: 'standard',
      phases: ['frame', 'build'],
      decomposition: { mode: 'disabled', maxNodes: 1 },
      limits: {
        maxProviderCalls: 12,
        maxFreshTokens: 750_000,
        maxTotalTokens: 6_000_000,
        // frame + build + juge, puis une reparation et son re-jugement autorises par maxRecoveries=1.
        maxAgents: 5,
        maxConcurrency: 3,
        maxRecoveries: 1,
        spendEnforcement: 'metering-only'
      }
    })
  })

  it('borne explicitement la decomposition critique au build', () => {
    const quote = compileExecutionQuote(
      "refactorer toute l'architecture d'orchestration et sa telemetrie"
    )

    expect(quote.regime).toBe('critical')
    expect(quote.phases).toEqual(['scout', 'frame', 'terrain', 'build', 'clean'])
    expect(quote.decomposition).toEqual({ mode: 'build-only', maxNodes: 5 })
    expect(quote.limits).toMatchObject({
      maxProviderCalls: 24,
      maxFreshTokens: 2_000_000,
      maxTotalTokens: 15_000_000,
      maxConcurrency: 4,
      maxRecoveries: 1,
      spendEnforcement: 'metering-only'
    })
  })

  it('applique les caps utilisateur comme un plafond plus strict, jamais comme une extension', () => {
    const quote = compileExecutionQuote('refactorer tout le pipeline', {
      maxProviderCalls: 7,
      maxTotalTokens: 900_000,
      maxUsd: 3
    })

    expect(quote.limits.maxProviderCalls).toBe(7)
    expect(quote.limits.maxTotalTokens).toBe(900_000)
    expect(quote.limits.maxUsd).toBe(3)
  })

  it('est deterministe hors identite et horodatage', () => {
    const a = compileExecutionQuote('corrige la typo du bouton')
    const b = compileExecutionQuote('corrige la typo du bouton')
    expect({ ...a, id: '', createdAt: '' }).toEqual({ ...b, id: '', createdAt: '' })
  })

  it('réserve la clôture et la récupération avant de réduire un fan-out standard', () => {
    const quote = compileExecutionQuote('ajoute une page de réglages')

    const allocation = allocateExecutionTopology(quote, {
      phases: ['frame', 'build'],
      completedPhases: [],
      startedAgents: 0,
      startedCalls: 0,
      mutation: true,
      hasDecomposer: false,
      phaseFanOut: { frame: 3 },
      judgeFanOut: 3
    })

    expect(allocation).toMatchObject({
      phaseMembers: { frame: 1 },
      judgeMembers: 1,
      maxGreedyNodes: 1,
      reservedMandatoryAgents: 5,
      plannedMaxAgents: 5
    })
  })

  it('borne ensemble décomposeur, DAG et topologie critique avant le premier appel', () => {
    const quote = compileExecutionQuote('refactorer toute architecture du pipeline')

    const allocation = allocateExecutionTopology(quote, {
      phases: quote.phases,
      completedPhases: [],
      startedAgents: 0,
      startedCalls: 0,
      mutation: true,
      hasDecomposer: true,
      phaseFanOut: { scout: 4, frame: 4, terrain: 4 },
      judgeFanOut: 4
    })

    expect(allocation).toMatchObject({
      phaseMembers: { scout: 1, frame: 1, terrain: 1 },
      judgeMembers: 1,
      maxGreedyNodes: 2,
      reservedMandatoryAgents: 8,
      plannedMaxAgents: 10
    })
  })

  it('refuse un devis impossible avant toute admission provider — en mode bloquant', () => {
    // Depuis conv-1148 (13/08), le refus n'existe plus qu'en `blocking` : en mesure seule
    // (défaut), le devis s'agrandit à la demande au lieu de tuer le run avant le premier appel.
    const quote = compileExecutionQuote('ajoute une page de réglages', {
      maxProviderCalls: 2,
      spendEnforcement: 'blocking'
    })

    expect(() =>
      allocateExecutionTopology(quote, {
        phases: quote.phases,
        completedPhases: [],
        startedAgents: 0,
        startedCalls: 0,
        mutation: true,
        hasDecomposer: false,
        phaseFanOut: {},
        judgeFanOut: 0
      })
    ).toThrow(/devis impossible.*avant exécution/i)
  })
})

describe('devis face à un workflow plus large que le régime', () => {
  // Mesuré sur conv-1148 (13/08) : « Devis impossible avant exécution : 12 agent(s) obligatoires
  // pour 10 place(s) restante(s) ». Le workflow choisi est un graphe DÉTERMINISTE au pire cas fini
  // et connu ; le refuser avant le premier appel contredit la décision utilisateur du 12/08
  // (« je m'en fous que ça dépense, détruis le blocage ») — le régime servait de plafond de
  // dépense déguisé. En mesure seule, le devis S'AGRANDIT à la demande du graphe ; en mode
  // bloquant, le refus historique reste.
  const demande = {
    phases: ['build'] as const,
    completedPhases: [] as const,
    startedAgents: 0,
    startedCalls: 0,
    mutation: true,
    hasDecomposer: false,
    phaseFanOut: {},
    judgeFanOut: 1,
    worstCaseProviderCalls: 12
  }

  it('s’agrandit à la demande d’un graphe déterministe en mesure seule', () => {
    const quote = compileExecutionQuote('corrige tous les défauts du dépôt')
    quote.limits.maxAgents = 10
    quote.limits.maxProviderCalls = 10
    const allocation = allocateExecutionTopology(quote, demande as never)
    expect(allocation.plannedMaxCalls).toBeGreaterThanOrEqual(12)
    expect(quote.limits.maxAgents).toBeGreaterThanOrEqual(12)
    expect(quote.limits.maxProviderCalls).toBeGreaterThanOrEqual(12)
  })

  it('refuse toujours en mode bloquant : le plafond y est un contrat', () => {
    const quote = compileExecutionQuote('corrige tous les défauts', { spendEnforcement: 'blocking' })
    quote.limits.maxAgents = 10
    quote.limits.maxProviderCalls = 10
    expect(() => allocateExecutionTopology(quote, demande as never)).toThrow(/Devis impossible/)
  })
})
