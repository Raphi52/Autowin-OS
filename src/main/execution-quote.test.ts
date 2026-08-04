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
        maxConcurrency: 3
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
      maxRecoveries: 1
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
      estimatedMaxAgents: 5
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
      estimatedMaxAgents: 10
    })
  })

  it('refuse un devis impossible avant toute admission provider', () => {
    const quote = compileExecutionQuote('ajoute une page de réglages', { maxProviderCalls: 2 })

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
