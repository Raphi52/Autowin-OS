import { describe, expect, it } from 'vitest'
import { estimateCostUsd, formatEstimatedCostUsd, modelRate } from './cost-estimate'

/**
 * Le défaut réparé : « coût non exposé » jetait une information qu'on POSSÈDE. Les tokens sont
 * comptés par le superviseur d'exécution ; seul le tarif manquait. Ces tests fixent la frontière
 * entre « estimable » (famille de modèle connue) et « inestimable » (on affiche le volume, pas un
 * montant inventé).
 */
describe('estimation de coût des appels non chiffrés', () => {
  it('tarife un opus au catalogue public (5 $ / 25 $ par MTok)', () => {
    // 1M d'entrée fraîche + 1M de sortie = 5 + 25.
    expect(
      estimateCostUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000, model: 'claude-opus-5' })
    ).toBeCloseTo(30, 6)
  })

  it('un token relu en cache coûte 10 % du tarif d’entrée', () => {
    // Tout l'input vient du cache : 1M × 5 $ × 0,1 = 0,50 $.
    expect(
      estimateCostUsd({
        inputTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
        outputTokens: 0,
        model: 'claude-opus-5'
      })
    ).toBeCloseTo(0.5, 6)
  })

  it('ne compte JAMAIS le cache deux fois (il est un sous-ensemble de l’entrée)', () => {
    const moitieEnCache = estimateCostUsd({
      inputTokens: 1_000_000,
      cacheReadTokens: 500_000,
      model: 'claude-sonnet-5'
    })
    // 500k frais × 3 $ + 500k cache × 0,30 $ = 1,50 + 0,15.
    expect(moitieEnCache).toBeCloseTo(1.65, 6)
  })

  it('borne un compteur de cache incohérent à l’entrée réelle', () => {
    // Un cacheReadTokens supérieur à l'input rendrait un coût NÉGATIF sans la borne.
    const estimate = estimateCostUsd({
      inputTokens: 100_000,
      cacheReadTokens: 900_000,
      model: 'claude-opus-5'
    })
    expect(estimate).toBeGreaterThan(0)
  })

  it('distingue les familles : fable/opus/sonnet/haiku n’ont pas le même tarif', () => {
    expect(modelRate('claude-fable-5')?.inputPerMTok).toBe(10)
    expect(modelRate('claude-opus-5')?.inputPerMTok).toBe(5)
    expect(modelRate('claude-sonnet-5')?.inputPerMTok).toBe(3)
    expect(modelRate('claude-haiku-4-5')?.inputPerMTok).toBe(1)
  })

  it('un modèle INCONNU ne rend aucune estimation (jamais un tarif deviné)', () => {
    expect(estimateCostUsd({ inputTokens: 500_000, outputTokens: 10_000, model: 'llama-42' })).toBe(
      undefined
    )
    expect(estimateCostUsd({ inputTokens: 500_000, outputTokens: 10_000 })).toBe(undefined)
  })

  it('zéro token ne rend pas « 0.00 $ estimés » — il n’y a rien à estimer', () => {
    expect(estimateCostUsd({ inputTokens: 0, outputTokens: 0, model: 'claude-opus-5' })).toBe(
      undefined
    )
  })

  it('le libellé PORTE la marque de l’approximation', () => {
    const label = formatEstimatedCostUsd({
      inputTokens: 1_000_000,
      outputTokens: 200_000,
      model: 'claude-opus-5'
    })
    expect(label).toBe('≈ 10.00 $ estimés')
  })
})
