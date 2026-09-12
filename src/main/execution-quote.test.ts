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
        // Compteurs de COUPS desactives de fait le 2026-09-12 (demande utilisateur) : ils tuaient
        // des runs a mi-chemin. Ce qui est verrouille ici, c'est qu'un regime standard reste
        // provisionne LARGEMENT — pas la valeur exacte, qui n'a plus de sens comme frein.
        maxProviderCalls: 5_000,
        maxFreshTokens: 50_000_000,
        maxTotalTokens: 250_000_000,
        maxAgents: 500,
        maxConcurrency: 4,
        maxRecoveries: 10,
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
    expect(quote.decomposition).toEqual({ mode: 'build-only', maxNodes: 20 })
    expect(quote.limits).toMatchObject({
      maxProviderCalls: 20_000,
      maxFreshTokens: 200_000_000,
      maxTotalTokens: 1_000_000_000,
      maxConcurrency: 8,
      maxRecoveries: 20,
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

  /*
   * DEPUIS LE 2026-09-12, un fan-out demandé n'est plus RABOTÉ pour tenir dans un compteur.
   * Avant, `frame: 3` repartait servi à 1 : la topologie était silencieusement réduite, et le run
   * travaillait à un tiers de ce qui avait été décidé. Ce que ce test verrouille désormais, c'est
   * que la demande est SERVIE EN ENTIER — la clôture et la réparation restant provisionnées.
   */
  it('sert le fan-out demandé EN ENTIER, clôture et réparation comprises', () => {
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
      phaseMembers: { frame: 3 },
      judgeMembers: 3,
      maxGreedyNodes: 1,
      reservedMandatoryAgents: 23,
      plannedMaxAgents: 48
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
      phaseMembers: { scout: 4, frame: 4, terrain: 4 },
      judgeMembers: 4,
      maxGreedyNodes: 20,
      reservedMandatoryAgents: 46,
      plannedMaxAgents: 141
    })
  })

  it("refuse un plan d'exécution impossible avant toute admission provider — en mode bloquant", () => {
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
    ).toThrow(/plan d['’]exécution impossible/i)
  })
})

describe('devis face à un workflow plus large que le régime', () => {
  // Mesuré sur conv-1148 (13/08) : « Plan d’exécution impossible : 12 agent(s) obligatoires
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
    expect(() => allocateExecutionTopology(quote, demande as never)).toThrow(/Plan d’exécution impossible/)
  })
})
