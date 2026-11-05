import { describe, expect, it } from 'vitest'
import {
  GPT_5_6_SOL_PROMO_UNTIL_MS,
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
    // 500k frais × 2 $ + 500k cache × 0,20 $ = 1,00 + 0,10 (grille Anthropic du 2026-11-05).
    expect(moitieEnCache).toBeCloseTo(1.1, 6)
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
    expect(modelRate('claude-sonnet-5')?.inputPerMTok).toBe(2)
    expect(modelRate('claude-sonnet-4-6')?.inputPerMTok).toBe(3)
    expect(modelRate('claude-haiku-4-5')?.inputPerMTok).toBe(1)
  })

  /**
   * Sonnet 5 : les 2 $ / 10 $ annoncés comme tarif d'introduction jusqu'au 2026-08-31 sont devenus
   * le prix STANDARD ; la hausse à 3 $ / 15 $ du 1er septembre « will not occur » (grille Anthropic,
   * note 3, relue le 2026-11-05). L'ancien code repassait à 3 $ / 15 $ et surestimait de 50 %.
   */
  it('Sonnet 5 reste à 2 $ / 10 $ après le 31/08, avec ou sans horloge', () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, model: 'claude-sonnet-5' }
    const apresLe31Aout = Date.UTC(2026, 10, 5)

    expect(estimateCostUsd(usage, apresLe31Aout)).toBeCloseTo(12, 6) // 2 + 10
    expect(estimateCostUsd(usage)).toBeCloseTo(12, 6)
    expect(modelRate('claude-sonnet-5')?.intro).toBe(undefined)
  })

  it('Sonnet 4.6 garde ses 3 $ / 15 $ : seul Sonnet 5 a changé', () => {
    const usage46 = { inputTokens: 1_000_000, outputTokens: 0, model: 'claude-sonnet-4-6' }
    expect(estimateCostUsd(usage46, Date.UTC(2026, 10, 5))).toBeCloseTo(3, 6)
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

  /**
   * DUREE DE VIE 1 H (2026-09-26) : le CLI Claude ecrit son cache pour 1 h, facture 2x l'entree
   * (https://platform.claude.com/docs/en/build-with-claude/prompt-caching). Au taux fixe de 1,25x,
   * l'estimation de secours sous-evaluait chaque ecriture de 37,5 %.
   */
  it('facture a 2x la part ecrite pour 1 h, et 1,25x le reste de l ecriture', () => {
    // Tout ecrit pour 1 h : 1M x 5 $ x 2 = 10 $.
    expect(
      estimateCostUsd({
        inputTokens: 1_000_000,
        cacheCreationTokens: 1_000_000,
        cacheCreation1hTokens: 1_000_000,
        model: 'claude-opus-5'
      })
    ).toBeCloseTo(10, 6)
    // Mixte : 600k en 1 h (6 $) + 400k en 5 min (2,50 $).
    expect(
      estimateCostUsd({
        inputTokens: 1_000_000,
        cacheCreationTokens: 1_000_000,
        cacheCreation1hTokens: 600_000,
        model: 'claude-opus-5'
      })
    ).toBeCloseTo(8.5, 6)
  })

  it('reproduit au centime pres le montant que le CLI calcule lui-meme', () => {
    // Oracle hors modele : `.arena/banc-heal/out-a.json`, modelUsage « claude-opus-5 », costUSD
    // 0,8698835 $ pour 26 frais + 37 288 ecrits (tous en 1 h) + 487 297 relus + 10 129 sortis.
    expect(
      estimateCostUsd({
        inputTokens: 26 + 37_288 + 487_297,
        cacheCreationTokens: 37_288,
        cacheCreation1hTokens: 37_288,
        cacheReadTokens: 487_297,
        outputTokens: 10_129,
        model: 'claude-opus-5'
      })
    ).toBeCloseTo(0.8698835, 7)
  })

  it('une part 1 h plus grande que l ecriture est bornee a l ecriture, jamais ajoutee', () => {
    // Compteur incoherent : 1h (900k) > ecriture (100k). Seuls les 100k ecrits comptent, a 2x.
    expect(
      estimateCostUsd({
        inputTokens: 1_000_000,
        cacheCreationTokens: 100_000,
        cacheCreation1hTokens: 900_000,
        model: 'claude-opus-5'
      })
    ).toBeCloseTo(0.9 * 5 + 0.1 * 5 * 2, 6)
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

// fix-ok: prix périmés mesurés le 2026-11-05 — grille https://platform.claude.com/docs/en/about-claude/pricing
// relue par curl (exit 0) et appel Haiku 5.5 réel facturé 0,00093225 $ par le CLI, que l'ancien code
// estimait à 0,0093225 $ (motif `haiku` à 1 $ / 5 $ au lieu de 0,10 $ / 0,50 $) (conv-1602).
describe('grille Anthropic relue le 2026-11-05 : une ligne par modèle exact', () => {
  /**
   * ORACLE HORS MODÈLE : `.autowin-data/autowin-os/run-stdout/c55319db-076c-4201-b8b7-bd8b98515a11
   * .stdout.jsonl`, ligne `result`, modèle « claude-haiku-5-5 », `total_cost_usd` 0,00093225 $ pour
   * 2 frais + 2 923 écrits en 1 h + 13 095 relus + 433 sortis, une seule requête (`iterations` = 1).
   * Le calcul : 2 × 0,10 + 2 923 × 0,20 + 13 095 × 0,01 + 433 × 0,50, en $ par million.
   * Ce test devient rouge si `haiku-5-5` passe derrière le motif `haiku` (0,0093225 $), si le
   * cache relu de Haiku 5.5 n'est plus à 0,1×, ou si l'écriture 1 h n'est plus à 2× l'entrée.
   */
  it('reproduit l’appel Haiku 5.5 réel facturé 0,00093225 $ par le CLI', () => {
    expect(
      estimateCostUsd({
        inputTokens: 2 + 2_923 + 13_095,
        cacheCreationTokens: 2_923,
        cacheCreation1hTokens: 2_923,
        cacheReadTokens: 13_095,
        outputTokens: 433,
        model: 'claude-haiku-5-5',
        provider: 'claude'
      })
    ).toBeCloseTo(0.00093225, 10)
  })

  it('Opus 5.5 coûte 4 $ / 20 $ et relit son cache à 0,05× ; Opus 5 garde 5 $ / 25 $ et 0,1×', () => {
    const million = { inputTokens: 1_000_000, outputTokens: 1_000_000 }
    const toutEnCache = { inputTokens: 1_000_000, cacheReadTokens: 1_000_000 }
    expect(estimateCostUsd({ ...million, model: 'claude-opus-5-5' })).toBeCloseTo(24, 6)
    expect(estimateCostUsd({ ...toutEnCache, model: 'claude-opus-5-5' })).toBeCloseTo(0.2, 6)
    // Jumeau : la famille `opus` n'a pas bougé pour Opus 5.
    expect(estimateCostUsd({ ...million, model: 'claude-opus-5' })).toBeCloseTo(30, 6)
    expect(estimateCostUsd({ ...toutEnCache, model: 'claude-opus-5' })).toBeCloseTo(0.5, 6)
  })

  it('Sonnet 5.5 coûte 2 $ / 10 $ et relit son cache à 0,05× ; Sonnet 5 à 0,1×', () => {
    const toutEnCache = { inputTokens: 1_000_000, cacheReadTokens: 1_000_000 }
    expect(modelRate('claude-sonnet-5-5')).toMatchObject({ inputPerMTok: 2, outputPerMTok: 10 })
    expect(estimateCostUsd({ ...toutEnCache, model: 'claude-sonnet-5-5' })).toBeCloseTo(0.1, 6)
    expect(estimateCostUsd({ ...toutEnCache, model: 'claude-sonnet-5' })).toBeCloseTo(0.2, 6)
  })

  it('Fable et Mythos 5.1 relisent leur cache à 0,025× ; Fable et Mythos 5 à 0,1×', () => {
    const toutEnCache = { inputTokens: 1_000_000, cacheReadTokens: 1_000_000 }
    expect(estimateCostUsd({ ...toutEnCache, model: 'claude-fable-5-1' })).toBeCloseTo(0.25, 6)
    expect(estimateCostUsd({ ...toutEnCache, model: 'claude-mythos-5-1' })).toBeCloseTo(0.25, 6)
    expect(estimateCostUsd({ ...toutEnCache, model: 'claude-fable-5' })).toBeCloseTo(1, 6)
    expect(estimateCostUsd({ ...toutEnCache, model: 'claude-mythos-5' })).toBeCloseTo(1, 6)
  })

  /**
   * Haiku 5.5 se paie au PALIER de la requête : au-delà de 100 000 tokens d'entrée (cache compris),
   * 0,50 $ / 2,50 $ au lieu de 0,10 $ / 0,50 $. Le seuil se juge requête par requête (grille,
   * « Long context pricing »). Or les appelants additionnent souvent plusieurs requêtes avant
   * d'estimer : un total au-delà du seuil ne dit pas qu'une requête l'a dépassé.
   */
  it('Haiku 5.5 : palier haut seulement pour UNE requête au-delà de 100 000 tokens', () => {
    const une = { model: 'claude-haiku-5-5', outputTokens: 0, requests: 1 }
    // 100 000 tout juste : encore le palier bas (« up to 100,000 tokens »).
    expect(estimateCostUsd({ ...une, inputTokens: 100_000 })).toBeCloseTo(0.01, 9)
    // 100 001 sur UNE requête : tout passe au palier haut, entrée ET sortie.
    expect(estimateCostUsd({ ...une, inputTokens: 100_001 })).toBeCloseTo(0.0500005, 9)
    expect(estimateCostUsd({ ...une, inputTokens: 200_000, outputTokens: 1_000_000 })).toBeCloseTo(
      0.1 + 2.5,
      9
    )
    // Le cache compte dans la taille du prompt, et garde son ratio au palier haut (0,05 $ = 0,1×).
    expect(estimateCostUsd({ ...une, inputTokens: 200_000, cacheReadTokens: 200_000 })).toBeCloseTo(
      0.01,
      9
    )
  })

  it('Haiku 5.5 : un TOTAL de plusieurs requêtes au-delà du seuil reste au palier bas', () => {
    const total = { model: 'claude-haiku-5-5', inputTokens: 200_000, outputTokens: 0 }
    // Deux requêtes, ou un nombre inconnu : on ne sait pas qu'une seule a dépassé le seuil.
    // Le palier bas est un PLANCHER assumé, comme la durée de vie de cache inconnue.
    expect(estimateCostUsd({ ...total, requests: 2 })).toBeCloseTo(0.02, 9)
    expect(estimateCostUsd(total)).toBeCloseTo(0.02, 9)
  })
})

describe('grille OpenAI relue le 2026-11-05 : une ligne par modèle exact', () => {
  /**
   * Source : https://developers.openai.com/api/docs/pricing.md (curl, exit 0, 22 083 octets), table
   * « Standard pricing data ». Le motif `sol` attrapait `gpt-6-sol` et `gpt-6.1-sol` au prix de
   * `gpt-5.6-sol` ; le motif `terra` attrapait `gpt-6.1-terra` au prix de `gpt-5.6-terra`.
   */
  it('chaque version a son prix : le motif de famille ne les écrase plus', () => {
    expect(modelRate('gpt-6-sol', 'codex')).toMatchObject({ inputPerMTok: 2, outputPerMTok: 10 })
    expect(modelRate('gpt-6.1-sol', 'codex')).toMatchObject({ inputPerMTok: 2, outputPerMTok: 10 })
    expect(modelRate('gpt-6.1-terra', 'codex')).toMatchObject({
      inputPerMTok: 1,
      outputPerMTok: 5
    })
    expect(modelRate('gpt-5.6-terra', 'codex')).toMatchObject({
      inputPerMTok: 2,
      outputPerMTok: 12
    })
  })

  it('gpt-6.1 relit son cache à 0,05× ; gpt-6-sol à 0,1×', () => {
    const toutEnCache = { inputTokens: 1_000_000, cacheReadTokens: 1_000_000, provider: 'codex' }
    expect(estimateCostUsd({ ...toutEnCache, model: 'gpt-6.1-sol' })).toBeCloseTo(0.1, 6)
    expect(estimateCostUsd({ ...toutEnCache, model: 'gpt-6.1-terra' })).toBeCloseTo(0.05, 6)
    expect(estimateCostUsd({ ...toutEnCache, model: 'gpt-6-sol' })).toBeCloseTo(0.2, 6)
  })

  /**
   * gpt-5.6-sol est en PROMOTION à 4 $ / 20 $ jusqu'au 30/11/2026 (« GPT-5.6 Sol’s promotional
   * pricing is available until November 30, 2026 »). Après, ou sans horloge : 5 $ / 30 $, le prix
   * que la page du modèle (https://developers.openai.com/api/docs/models/gpt-5.6-sol.md, relue le
   * 2026-11-05) réduit de « 20% » et « 33% » pour arriver à 4 $ / 20 $ (conv-1602).
   */
  it('gpt-5.6-sol : 4 $ / 20 $ pendant la promotion, 5 $ / 30 $ après ou sans horloge', () => {
    const usage = {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      model: 'gpt-5.6-sol',
      provider: 'codex'
    }
    expect(estimateCostUsd(usage, GPT_5_6_SOL_PROMO_UNTIL_MS)).toBeCloseTo(24, 6)
    expect(estimateCostUsd(usage, GPT_5_6_SOL_PROMO_UNTIL_MS + 1)).toBeCloseTo(35, 6)
    expect(estimateCostUsd(usage)).toBeCloseTo(35, 6)
  })

  /**
   * « Short context: ≤272K input tokens. Long context: >272K input tokens. » (même page). Le seuil
   * EST publié : l'ancien commentaire disait le contraire. Comme pour Haiku 5.5, il se juge par
   * requête : un total de plusieurs requêtes reste au prix court (plancher).
   */
  it('au-delà de 272 000 tokens sur UNE requête : le prix long contexte', () => {
    const une = { provider: 'codex', requests: 1, outputTokens: 1_000_000 }
    // 272 000 tout juste : encore le prix court.
    expect(estimateCostUsd({ ...une, inputTokens: 272_000, model: 'gpt-6.1-sol' })).toBeCloseTo(
      0.272 * 2 + 10,
      6
    )
    // 300 000 : 4 $ / 15 $ pour gpt-6.1-sol, 2 $ / 7,50 $ pour gpt-6.1-terra.
    expect(estimateCostUsd({ ...une, inputTokens: 300_000, model: 'gpt-6.1-sol' })).toBeCloseTo(
      0.3 * 4 + 15,
      6
    )
    expect(estimateCostUsd({ ...une, inputTokens: 300_000, model: 'gpt-6.1-terra' })).toBeCloseTo(
      0.3 * 2 + 7.5,
      6
    )
    // Pendant la promotion de gpt-5.6-sol : 8 $ / 30 $.
    expect(
      estimateCostUsd(
        { ...une, inputTokens: 300_000, model: 'gpt-5.6-sol' },
        GPT_5_6_SOL_PROMO_UNTIL_MS
      )
    ).toBeCloseTo(0.3 * 8 + 30, 6)
    // Après la promotion : 10 $ / 45 $, soit « 2x input and 1.5x output for the full request »
    // appliqués à 5 $ / 30 $ (page du modèle relue le 2026-11-05). Entrée qui donnerait tort à la
    // correction : ce même appel rendrait 0,3 × 5 + 30 = 31,50 $ si l'après-promotion restait au
    // prix court (conv-1602).
    expect(
      estimateCostUsd(
        { ...une, inputTokens: 300_000, model: 'gpt-5.6-sol' },
        GPT_5_6_SOL_PROMO_UNTIL_MS + 1
      )
    ).toBeCloseTo(0.3 * 10 + 45, 6)
    // Jumeau : le même total sur plusieurs requêtes reste au prix court.
    expect(
      estimateCostUsd({ ...une, requests: 3, inputTokens: 300_000, model: 'gpt-6.1-sol' })
    ).toBeCloseTo(0.3 * 2 + 10, 6)
  })

  it('l’écriture en cache reste à 1,25× l’entrée (écriture 30 min de la grille)', () => {
    // gpt-6.1-sol : 2,50 $ le million écrit pour 30 min, soit 1,25 × 2 $.
    expect(
      estimateCostUsd({
        inputTokens: 1_000_000,
        cacheCreationTokens: 1_000_000,
        model: 'gpt-6.1-sol',
        provider: 'codex'
      })
    ).toBeCloseTo(2.5, 6)
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
    // Même famille « luna », moitié du prix : le motif générique ne doit pas l'attraper.
    expect(modelRate('gpt-6-luna', 'codex')).toMatchObject({
      inputPerMTok: 0.1,
      outputPerMTok: 0.5
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
