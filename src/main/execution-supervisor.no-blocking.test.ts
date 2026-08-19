import { describe, expect, it } from 'vitest'
import { ExecutionSupervisor } from './execution-supervisor'
import { compileExecutionQuote } from './execution-quote'

/** Le plafond ferme l'admission suivante sans jeter le résultat de l'appel déjà payé. */
describe('budget bloquant sans destruction du travail déjà payé', () => {
  it('compte le cache dans le total, finalise le premier appel puis refuse le suivant', async () => {
    const supervisor = new ExecutionSupervisor()
    // Refus de dépense = mode `blocking` explicite : le défaut est mesure seule (décision du 12/08).
    const quote = compileExecutionQuote('améliore la vue Worktrees', { spendEnforcement: 'blocking' })
    quote.limits.maxTotalTokens = 2_500_000

    let livrableFinalise = false
    await supervisor.run(quote, undefined, async () => {
      // Un sous-agent CLI consomme une session entière dans UN appel déjà admis.
      const premier = supervisor.reserveProviderCall()!
      premier.complete({
        inputTokens: 9_600_000,
        outputTokens: 39_639,
        cacheReadTokens: 9_500_000
      })
      expect(premier.signal.aborted).toBe(false)
      livrableFinalise = true

      expect(() => supervisor.reserveProviderCall()).toThrowError(/tokens total/i)
    })

    const final = supervisor.lastSnapshot()!
    expect(livrableFinalise).toBe(true)
    expect(final.stoppedReason).toMatch(/tokens total/i)
    // La mesure, elle, reste exacte : c'est ce qui alimente Observatory.
    expect(final.totalTokens).toBe(9_600_000 + 39_639)
    expect(final.cacheReadTokens).toBe(9_500_000)
    expect(final.freshTokens).toBe(100_000 + 39_639)
    expect(final.completedCalls).toBe(1)
  })

  it('refuse le prochain appel quand le plafond USD est atteint', async () => {
    const supervisor = new ExecutionSupervisor()
    const quote = compileExecutionQuote('mène tous les chantiers de la vue Chat', {
      spendEnforcement: 'blocking'
    })
    quote.limits.maxUsd = 0.01
    quote.limits.maxTotalTokens = 1_000
    quote.limits.maxConcurrency = 8

    await supervisor.run(quote, undefined, async () => {
      supervisor
        .reserveProviderCall()!
        .complete({ inputTokens: 500, outputTokens: 5, costUsd: 4.2 })
      expect(() => supervisor.reserveProviderCall()).toThrowError(/USD/i)
    })

    const final = supervisor.lastSnapshot()!
    expect(final.stoppedReason).toMatch(/USD/i)
    expect(final.startedCalls).toBe(1)
    expect(final.knownCostUsd).toBeCloseTo(4.2, 5)
  })

  it('continue de borner le NOMBRE d’appels : un tour de chat vaut un appel, pas deux', async () => {
    // Invariante structurelle, pas une limite de dépense : `os.ts` et le routeur de conversation
    // posent `maxProviderCalls: 1` pour qu'un même tour n'appelle pas deux fois le provider.
    const supervisor = new ExecutionSupervisor()
    const quote = compileExecutionQuote('un tour de chat')
    quote.limits.maxProviderCalls = 1
    quote.limits.maxConcurrency = 4

    await supervisor.run(quote, undefined, async () => {
      supervisor.reserveProviderCall()!.complete({ inputTokens: 10, outputTokens: 2 })
      expect(() => supervisor.reserveProviderCall()).toThrowError(/appels provider/i)
    })
  })

  it('continue de borner la concurrence : elle protège la machine, pas le portefeuille', async () => {
    const supervisor = new ExecutionSupervisor()
    const quote = compileExecutionQuote('lance un fan-out')
    quote.limits.maxConcurrency = 2

    await supervisor.run(quote, undefined, async () => {
      const a = supervisor.reserveProviderCall()!
      const b = supervisor.reserveProviderCall()!
      expect(() => supervisor.reserveProviderCall()).toThrowError(/concurrence/i)
      a.complete()
      b.complete()
    })
  })

  /**
   * RETIRE le 2026-08-19 : le guetteur d'immobilite n'existe plus (« plus aucune coupe de run »,
   * decision utilisateur maintenue apres objection). Ce test gardait la borne de duree ; la garder
   * verte aurait exige de ressusciter ce qu'on venait de supprimer. Ce qui BORNE encore un run est
   * structurel — appels, agents, concurrence — et reste couvert par les cas voisins.
   *
   * Consequence assumee, ecrite ici pour qu'elle ne se redecouvre pas : une boucle qui ne s'arrete
   * jamais n'est plus arretee par le moteur. Seul un humain la stoppe.
   */

})
