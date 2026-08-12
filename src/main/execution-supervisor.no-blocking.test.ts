import { describe, expect, it } from 'vitest'
import { ExecutionSupervisor } from './execution-supervisor'
import { compileExecutionQuote } from './execution-quote'

/**
 * LE BUDGET MESURE, IL NE BLOQUE PLUS.
 *
 * Décision utilisateur du 2026-08-12, explicite : « je m'en fous que ça dépense des tokens
 * j'en ai plein, détruis tout ce système de blocage ». Le comptage reste — il alimente
 * Observatory et la page Budget — mais il ne peut plus tuer un run.
 *
 * Ce que le blocage coûtait réellement, mesuré sur la campagne dogfood du 11/08 : le run
 * conv-1102 a produit son travail, puis s'est vu refuser l'appel du juge sur
 * « Budget tokens total depasse (9639639/2500000) » ; le run a avorté, la publication n'a
 * jamais été tentée, et le livrable est resté bloqué dans son worktree. Neuf worktrees portent
 * ainsi des commits de fonctionnalité complets jamais publiés. Le garde-fou ne protégeait pas
 * un budget : il détruisait du travail déjà payé.
 *
 * La ligne de partage, corrigée le 2026-08-12 après une régression attrapée par
 * `os.chat-supervisor.test.ts` : seuls les JETONS et l'USD sont du portefeuille et passent en
 * mesure seule. Le NOMBRE d'appels et d'agents, la CONCURRENCE et la DURÉE restent toujours
 * enforcés — ce sont des invariantes structurelles (un tour de chat vaut un appel, la machine ne
 * doit pas saturer, une boucle doit finir), pas des limites de dépense.
 */
describe('budget en mode mesure seule', () => {
  it('n’interrompt pas un run qui dépasse massivement le plafond de tokens', async () => {
    const supervisor = new ExecutionSupervisor()
    const quote = compileExecutionQuote('améliore la vue Worktrees')
    quote.limits.maxTotalTokens = 2_500_000

    await supervisor.run(quote, undefined, async () => {
      // Un sous-agent CLI consomme une session entière dans UN appel déjà admis.
      const premier = supervisor.reserveProviderCall()!
      premier.complete({ inputTokens: 9_600_000, outputTokens: 39_639 })

      // Avant : cette réservation-ci était refusée (ExecutionBudgetExceededError) et le run mourait.
      const juge = supervisor.reserveProviderCall()
      expect(juge).toBeDefined()
      juge!.complete({ inputTokens: 12_000, outputTokens: 400 })
    })

    const final = supervisor.lastSnapshot()!
    expect(final.stoppedReason).toBeUndefined()
    // La mesure, elle, reste exacte : c'est ce qui alimente Observatory.
    expect(final.totalTokens).toBe(9_600_000 + 39_639 + 12_000 + 400)
    expect(final.completedCalls).toBe(2)
  })

  it('ne refuse plus un appel sur les jetons ni sur le plafond USD', async () => {
    const supervisor = new ExecutionSupervisor()
    const quote = compileExecutionQuote('mène tous les chantiers de la vue Chat')
    quote.limits.maxUsd = 0.01
    quote.limits.maxTotalTokens = 1_000
    quote.limits.maxConcurrency = 8

    await supervisor.run(quote, undefined, async () => {
      for (let i = 0; i < 6; i += 1) {
        const reservation = supervisor.reserveProviderCall()
        expect(reservation).toBeDefined()
        reservation!.complete({ inputTokens: 500_000, outputTokens: 5_000, costUsd: 4.2 })
      }
    })

    const final = supervisor.lastSnapshot()!
    expect(final.stoppedReason).toBeUndefined()
    expect(final.startedCalls).toBe(6)
    expect(final.knownCostUsd).toBeCloseTo(25.2, 5)
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

  it('continue de borner la durée : elle protège d’une boucle qui ne s’arrête jamais', async () => {
    const supervisor = new ExecutionSupervisor()
    const quote = compileExecutionQuote('boucle sans fin')
    quote.limits.maxDurationMs = -1

    // Le refus avorte le run entier : c'est bien la borne qui s'exerce, pas seulement l'appel.
    await expect(
      supervisor.run(quote, undefined, async () => {
        supervisor.reserveProviderCall()
      })
    ).rejects.toThrowError(/duree|durée/i)
  })
})
