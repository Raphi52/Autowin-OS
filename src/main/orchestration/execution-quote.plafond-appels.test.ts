import { describe, expect, it } from 'vitest'
import { compileExecutionQuote } from './execution-quote'

/**
 * UN TOUR NE DOIT PAS MOURIR SUR UN COMPTEUR D'ÉTAPES.
 *
 * DÉFAUTS VÉCUS le 2026-08-25, deux fois dans la même journée :
 *   - conv-1397, coupé sur « Budget d'appels provider atteint (6) » APRÈS cinq éditions réussies,
 *     juste avant sa vérification — travail à moitié posé ;
 *   - conv-1404, coupé sur « (12) » après 3 réussites et 8 échecs — demande perdue.
 *
 * Ces plafonds datent de l'époque où un tour valait UN appel provider. Un tour agentique en
 * consomme un PAR ÉTAPE : lire, éditer, vérifier, corriger. Le compteur mesurait donc des COUPS,
 * pas de la dépense — et coupait le travail en plein milieu, ce qui est la pire issue possible
 * (on a payé, et on n'a rien de fini).
 *
 * Les vrais freins restent en place et ne bougent pas ici : tokens frais, tokens totaux, et USD.
 * Ce sont eux qui mesurent la dépense ; le nombre de coups n'en est qu'un mauvais proxy.
 */
describe('plafond d’appels — une séquence agentique réaliste tient dans le devis', () => {
  it('un tour standard encaisse une séquence lire → éditer → vérifier → corriger répétée', () => {
    const quote = compileExecutionQuote('corrige le bug du panneau')

    expect(quote.regime).toBe('standard')
    // 8 échecs suivis d'autant de reprises, plus la vérification finale : conv-1404 mourait à 12.
    expect(quote.limits.maxProviderCalls).toBeGreaterThanOrEqual(30)
  })

  it('un tour trivial garde de quoi se corriger une fois', () => {
    const quote = compileExecutionQuote('renomme cette variable')

    expect(quote.limits.maxProviderCalls).toBeGreaterThanOrEqual(8)
  })

  /*
   * 2026-09-12 — DECISION UTILISATEUR : les plafonds PAR DEFAUT ne coupent plus rien, tokens
   * compris. Un compteur de tokens tue un run aussi surement qu'un compteur d'appels, et de la
   * meme facon : a mi-chemin, apres avoir paye. Ce test ne garde donc plus des VALEURS, il garde
   * ce qui reste vrai — les prereglages sont hors d'atteinte d'un run reel, et le SEUL frein qui
   * coupe encore est celui que l'utilisateur pose lui-meme.
   */
  it('les préréglages sont hors d’atteinte — seul un cap posé À LA MAIN freine encore', () => {
    const quote = compileExecutionQuote('corrige le bug du panneau')

    expect(quote.limits.maxFreshTokens).toBeGreaterThanOrEqual(50_000_000)
    expect(quote.limits.maxTotalTokens).toBeGreaterThanOrEqual(250_000_000)
    // Aucun plafond de dépense par défaut : c'est l'utilisateur qui décide d'en poser un.
    expect(quote.limits.maxUsd).toBeNull()

    const borne = compileExecutionQuote('corrige le bug du panneau', { maxUsd: 5 })
    expect(borne.limits.maxUsd).toBe(5)
  })

  it('un cap explicite RESSERRE toujours : relever le préréglage n’ouvre aucune porte', () => {
    // L'invariant qui protège un budget posé à la main. Il ne doit pas bouger d'un pouce.
    const quote = compileExecutionQuote('corrige le bug du panneau', { maxProviderCalls: 7 })

    expect(quote.limits.maxProviderCalls).toBe(7)
  })
})
