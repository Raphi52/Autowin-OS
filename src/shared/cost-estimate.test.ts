import { describe, expect, it } from 'vitest'
import {
  SONNET_5_INTRO_UNTIL_MS,
  estimateCostUsd,
  formatEstimatedCostUsd,
  modelRate,
  splitInputTokens
} from './cost-estimate'

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

  /**
   * Sonnet 5 est en tarif d'INTRODUCTION 2 $ / 10 $ jusqu'au 2026-08-31 inclus (catalogue Anthropic,
   * relu le 2026-08-18). Le tarif standard 3 $ / 15 $ le surestimait de 50 % pendant cette fenetre.
   * L'horloge est un PARAMETRE explicite : sans elle on garde le tarif standard, donc la fonction
   * reste pure et le code ne se met pas a mentir tout seul le 1er septembre.
   */
  it('applique le tarif intro de Sonnet 5 pendant la fenetre, le standard apres', () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, model: 'claude-sonnet-5' }
    const pendant = SONNET_5_INTRO_UNTIL_MS - 1
    const apres = SONNET_5_INTRO_UNTIL_MS + 1

    expect(estimateCostUsd(usage, pendant)).toBeCloseTo(12, 6) // 2 + 10
    expect(estimateCostUsd(usage, apres)).toBeCloseTo(18, 6) // 3 + 15
    // Sans horloge : tarif standard, jamais l'intro.
    expect(estimateCostUsd(usage)).toBeCloseTo(18, 6)
  })

  it("n'applique l'intro qu'a Sonnet 5, pas a Sonnet 4.6", () => {
    const pendant = SONNET_5_INTRO_UNTIL_MS - 1
    const usage46 = { inputTokens: 1_000_000, outputTokens: 0, model: 'claude-sonnet-4-6' }

    expect(estimateCostUsd(usage46, pendant)).toBeCloseTo(3, 6)
    expect(modelRate('claude-sonnet-4-6')?.intro).toBe(undefined)
    expect(modelRate('claude-sonnet-5')?.intro?.inputPerMTok).toBe(2)
  })

  /**
   * Ecrire dans le cache coute 1,25x le tarif d'entree (TTL 5 min, le defaut). Ces tokens etaient
   * fondus dans `inputTokens` et donc factures 1x : sous-estimation silencieuse de 25 % sur la part
   * ecrite. Comme le cache relu, ils sont un SOUS-ENSEMBLE de l'entree — jamais un ajout.
   */
  it('facture un token ECRIT dans le cache a 1,25x le tarif d entree', () => {
    // Tout l'input est une ecriture de cache : 1M x 5 $ x 1,25 = 6,25 $.
    expect(
      estimateCostUsd({
        inputTokens: 1_000_000,
        cacheCreationTokens: 1_000_000,
        outputTokens: 0,
        model: 'claude-opus-5'
      })
    ).toBeCloseTo(6.25, 6)
  })

  it('additionne lecture et ecriture de cache sans jamais doubler l entree', () => {
    // 200k frais x 5 + 300k ecrits x 6,25 + 500k relus x 0,50 = 1 + 1,875 + 0,25.
    expect(
      estimateCostUsd({
        inputTokens: 1_000_000,
        cacheCreationTokens: 300_000,
        cacheReadTokens: 500_000,
        model: 'claude-opus-5'
      })
    ).toBeCloseTo(3.125, 6)
  })

  it('borne lecture + ecriture a l entree reelle (compteurs incoherents)', () => {
    // 900k + 900k > 1M : sans borne, la part fraiche serait NEGATIVE.
    const estimate = estimateCostUsd({
      inputTokens: 1_000_000,
      cacheCreationTokens: 900_000,
      cacheReadTokens: 900_000,
      model: 'claude-opus-5'
    })
    expect(estimate).toBeGreaterThan(0)
    // Plafond dur : jamais plus que tout l'input facture au tarif d'ecriture.
    expect(estimate!).toBeLessThanOrEqual(6.25)
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

describe('splitInputTokens — un seul arbitre de l’invariant « le cache est un sous-ensemble »', () => {
  it('ordre canonique : l’ÉCRITURE est bornée d’abord, la lecture sur ce qu’il reste', () => {
    // Usage INCOHÉRENT (corruption de compteur) : 80 + 60 > 100. L'estimateur bornait l'écriture
    // d'abord, le superviseur la lecture d'abord — un facteur 12 sur la part litigieuse.
    expect(
      splitInputTokens({ inputTokens: 100, cacheReadTokens: 80, cacheCreationTokens: 60 })
    ).toEqual({ fresh: 0, cacheRead: 40, cacheWrite: 60 })
  })

  it('sur un usage COHÉRENT l’ordre est sans effet — les trois postes somment l’entrée', () => {
    const split = splitInputTokens({
      inputTokens: 1000,
      cacheReadTokens: 600,
      cacheCreationTokens: 200
    })
    expect(split).toEqual({ fresh: 200, cacheRead: 600, cacheWrite: 200 })
    expect(split.fresh + split.cacheRead + split.cacheWrite).toBe(1000)
  })

  it('des compteurs absents ou aberrants ne rendent jamais une part négative', () => {
    expect(splitInputTokens({})).toEqual({ fresh: 0, cacheRead: 0, cacheWrite: 0 })
    expect(
      splitInputTokens({ inputTokens: 50, cacheReadTokens: -10, cacheCreationTokens: 900 })
    ).toEqual({ fresh: 0, cacheRead: 0, cacheWrite: 50 })
  })
})
