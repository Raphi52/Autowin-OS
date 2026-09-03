import { describe, expect, it } from 'vitest'
import {
  SONNET_5_INTRO_UNTIL_MS,
  estimateCostUsd,
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

describe('catalogue indexé (provider, motif) — aucun tarif ajouté, seule la CLÉ change', () => {
  it('sans provider, le lookup se comporte exactement comme avant', () => {
    expect(modelRate('claude-opus-5')).toMatchObject({ inputPerMTok: 5, outputPerMTok: 25 })
    expect(modelRate('claude-haiku-4-5')).toMatchObject({ inputPerMTok: 1, outputPerMTok: 5 })
  })

  /**
   * PREMISSE INVALIDEE le 2026-08-18. Ce test assiait qu'aucun tarif codex n'etait connu — « on n'en
   * a pas la source ». La source primaire a ete lue depuis
   * (developers.openai.com/api/docs/pricing.md, table Standard) : les trois tarifs existent et sont
   * citables. La regle n'a pas change (aucun tarif sans source) ; c'est la source qui est arrivee.
   */
  it('un identifiant codex rend son tarif PUBLIE, desormais source', () => {
    expect(modelRate('gpt-5.6-sol', 'codex')).toMatchObject({ inputPerMTok: 5, outputPerMTok: 30 })
    expect(modelRate('gpt-5.6-terra', 'codex')).toMatchObject({
      inputPerMTok: 2,
      outputPerMTok: 12
    })
    expect(modelRate('gpt-5.6-luna', 'codex')).toMatchObject({
      inputPerMTok: 0.2,
      outputPerMTok: 1.2
    })
  })

  it('un modele dont AUCUN catalogue ne parle ne rend toujours rien', () => {
    // La regle qui compte : pas de source, pas de tarif. Verifiee sur un tiers non catalogue.
    expect(modelRate('mistral-large')).toBeUndefined()
    expect(modelRate('mistral-large', 'mistral')).toBeUndefined()
  })

  it('le provider est une CONDITION : un modèle tiers n’hérite plus d’un tarif Anthropic', () => {
    // Un futur identifiant tiers contenant « opus » aurait été tarifé 5/25 par le motif seul.
    expect(modelRate('acme-opus-turbo')).toMatchObject({ inputPerMTok: 5 })
    expect(modelRate('acme-opus-turbo', 'codex')).toBeUndefined()
    expect(modelRate('claude-opus-5', 'claude')).toMatchObject({ inputPerMTok: 5 })
  })
})

describe('resolveCostCoverage — une seule réponse à « combien a coûté ceci »', () => {
  // Le MÊME usage, non tarifé par le provider : 100 k d'entrée + 10 k de sortie sur opus,
  // soit (100 000 × 5 + 10 000 × 25) / 1e6 = 0,75 $.
  const usage = {
    inputTokens: 100_000,
    outputTokens: 10_000,
    model: 'claude-opus-5',
    provider: 'claude'
  }

  it('les TROIS surfaces rendent le même montant pour le même usage', async () => {
    const { formatExecutionCostCoverage } = await import('./orchestration-outcome')
    const { summarizeConversationCost } =
      await import('../renderer/src/components/conversation-cost')
    const { CostAggregator } = await import('../main/dashboards/cost')

    const outcome = formatExecutionCostCoverage({
      knownCostUsd: null,
      unpricedCalls: 1,
      totalTokens: 110_000,
      ...usage,
      pricingModel: usage.model
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    const conversation = summarizeConversationCost([
      {
        key: 'orchestrator',
        calls: 1,
        costUsd: 0,
        cacheReadTokens: 0,
        cacheHitRatio: 0,
        unpricedCalls: 1,
        ...usage
      }
    ])

    const aggregator = new CostAggregator()
    aggregator.add({
      provider: 'claude',
      model: usage.model,
      inputTokens: 100_000,
      outputTokens: 10_000
    })
    const budget = aggregator.budgetStatus()

    expect(outcome).toBe('≈ 0,75 $ estimés · 1 appel non chiffré')
    expect(conversation.coverage.estimatedUsd).toBeCloseTo(0.75, 6)
    expect(budget.coverage.estimatedUsd).toBeCloseTo(0.75, 6)
    expect(conversation.label).toBe('≈ 0,75 $ estimés')
  })

  it('sur un run NON tarifé, aucune surface ne rend « 0,00 $ »', async () => {
    const { formatExecutionCostCoverage } = await import('./orchestration-outcome')
    const { summarizeConversationCost } =
      await import('../renderer/src/components/conversation-cost')
    const { CostAggregator } = await import('../main/dashboards/cost')

    // Modèle INCONNU : pas de tarif citable, donc pas de montant — le volume reste vrai.
    // `gpt-5.6-terra` ne convient plus comme exemple : son tarif est source depuis le 2026-08-18.
    const inconnu = { inputTokens: 100_000, outputTokens: 10_000, model: 'mistral-large' }
    const outcome = formatExecutionCostCoverage({
      knownCostUsd: null,
      unpricedCalls: 2,
      totalTokens: 110_000,
      ...inconnu,
      pricingModel: inconnu.model
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    const conversation = summarizeConversationCost([
      {
        key: 'codex',
        calls: 1,
        costUsd: 0,
        cacheReadTokens: 0,
        cacheHitRatio: 0,
        unpricedCalls: 2,
        ...inconnu
      }
    ])
    const aggregator = new CostAggregator()
    aggregator.add({
      provider: 'codex',
      model: inconnu.model,
      inputTokens: 100_000,
      outputTokens: 10_000
    })

    // Le trio délibéré est préservé mot pour mot.
    expect(outcome).toBe('110k tokens · tarif non exposé · 2 appels non chiffrés')
    // L'indicateur de conversation ne dit plus « non exposé » (demande utilisateur du
    // 2026-09-03) : il COMPTE ce qui manque. Les autres surfaces gardent le trio mot pour mot.
    expect(conversation.label).toBe('2 appels non chiffrés')
    expect(conversation.label).not.toMatch(/0,00 \$|0\.00 \$/)
    expect(outcome).not.toMatch(/0,00 \$|0\.00 \$/)
    expect(aggregator.budgetStatus().coverage.estimatedUsd).toBeUndefined()
    expect(aggregator.budgetStatus().coverage.tokens).toBe(110_000)
  })
})
