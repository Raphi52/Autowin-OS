/**
 * ESTIMATION de coût quand le provider n'expose aucun prix.
 *
 * Constaté (conv-1267, 2026-08-18) : le fil affichait « bloqué par le gate · coût non exposé ·
 * 3 appels non chiffrés ». Deux défauts dans une seule pastille : (a) le motif RÉEL du blocage
 * (`gateReasons`) était déjà dans l'outcome mais jamais affiché, si bien que la mention comptable
 * qui la suit se lisait comme la cause — un correctif d'UNE LIGNE a même été abandonné pour ce
 * malentendu (`dev-sans-watch.test.ts`) ; (b) « coût non exposé » jetait une information qu'on
 * possède : les tokens sont comptés (`execution-supervisor.ts`), seul le TARIF manque.
 *
 * Ce module reconstitue le tarif à partir du modèle servi. Les taux sont COPIÉS du catalogue
 * Anthropic (skill `claude-api`, tableau « Current Models », relu le 2026-08-18) — jamais devinés.
 * Un modèle inconnu ne rend RIEN : on préfère afficher le volume de tokens qu'inventer un montant.
 */

import type { TokenUsage } from './token-usage'

/** Tarifs publics en $ par million de tokens. Source : catalogue Anthropic (2026-08-18). */
interface ModelRate {
  /** Motif reconnu dans l'identifiant du modèle, en minuscules. */
  readonly match: string
  readonly inputPerMTok: number
  readonly outputPerMTok: number
  /**
   * Tarif d'INTRODUCTION, borné dans le temps. Appliqué seulement si l'appelant fournit une
   * horloge : sans elle on garde le tarif standard. Le module n'a donc pas d'horloge cachée, et il
   * cesse de lui-même d'appliquer l'intro passé `untilMs` — aucune date à venir retirer à la main.
   */
  readonly intro?: {
    readonly untilMs: number
    readonly inputPerMTok: number
    readonly outputPerMTok: number
  }
}

/** Fin du tarif d'introduction de Sonnet 5 : 2026-08-31 23:59:59 UTC inclus (catalogue Anthropic). */
export const SONNET_5_INTRO_UNTIL_MS = Date.UTC(2026, 7, 31, 23, 59, 59, 999)

/**
 * Ordre significatif : le premier motif qui correspond gagne. Les familles les plus spécifiques
 * (fable/mythos) passent avant les génériques, sinon un `claude-fable-5` serait tarifé en opus.
 */
const MODEL_RATES: readonly ModelRate[] = [
  { match: 'fable', inputPerMTok: 10, outputPerMTok: 50 },
  { match: 'mythos', inputPerMTok: 10, outputPerMTok: 50 },
  { match: 'opus', inputPerMTok: 5, outputPerMTok: 25 },
  // Sonnet 5 AVANT le `sonnet` générique : seul lui porte le tarif d'introduction. Sonnet 4.6 reste
  // à 3 $ / 15 $ en permanence, et l'attraper avec l'intro l'aurait sous-facturé de 33 %.
  {
    match: 'sonnet-5',
    inputPerMTok: 3,
    outputPerMTok: 15,
    intro: { untilMs: SONNET_5_INTRO_UNTIL_MS, inputPerMTok: 2, outputPerMTok: 10 }
  },
  { match: 'sonnet', inputPerMTok: 3, outputPerMTok: 15 },
  { match: 'haiku', inputPerMTok: 1, outputPerMTok: 5 }
]

/** Un token relu en cache coûte 10 % du tarif d'entrée. */
const CACHE_READ_RATIO = 0.1
/**
 * Un token ÉCRIT dans le cache coûte 1,25× le tarif d'entrée (TTL 5 min, le défaut). Un TTL 1 h
 * coûterait 2×, mais `cache_creation_input_tokens` ne dit pas le TTL : 1,25× est donc un PLANCHER
 * assumé, pas une valeur exacte — l'estimation reste marquée « ≈ estimés ».
 */
const CACHE_WRITE_RATIO = 1.25

/**
 * Conservé comme ALIAS de `TokenUsage` : la forme de l'usage n'a plus qu'une définition, mais le
 * nom historique reste importé par les appelants existants.
 */
export type TokenUsageShape = TokenUsage

function positive(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/** Décomposition de l'entrée en trois postes DISJOINTS dont la somme vaut `inputTokens`. */
export interface InputTokenSplit {
  /** Contexte envoyé au plein tarif : ni relu, ni écrit dans le cache. */
  readonly fresh: number
  /** Relu depuis le cache (0,1× l'entrée). */
  readonly cacheRead: number
  /** Écrit dans le cache (1,25× l'entrée). */
  readonly cacheWrite: number
}

/**
 * ARBITRE UNIQUE de l'invariant « le cache est un sous-ensemble de l'entrée ».
 *
 * Il était arbitré à DEUX endroits dans des ordres OPPOSÉS — l'estimateur bornait l'écriture
 * d'abord, le superviseur d'exécution la lecture d'abord. L'écriture coûte 1,25× l'entrée et la
 * lecture 0,1× : l'ordre décide qui absorbe l'excédent, soit un facteur 12 sur la part litigieuse
 * du même usage.
 *
 * ORDRE CANONIQUE : l'ÉCRITURE bornée d'abord, la lecture sur ce qu'il reste. Sur un usage
 * cohérent (le cas nominal garanti par le contrat de `providers/types.ts`) l'ordre est sans effet.
 * Sur un usage INCOHÉRENT — une corruption de compteur, pas un cas métier — cet ordre fait tomber
 * l'excédent dans le poste le plus cher : l'estimation SUR-évalue et le garde-budget mord plus
 * TÔT. Les deux directions d'erreur sont conservatrices.
 */
export function splitInputTokens(usage: TokenUsage): InputTokenSplit {
  const input = positive(usage.inputTokens)
  const cacheWrite = Math.min(input, positive(usage.cacheCreationTokens))
  const cacheRead = Math.min(input - cacheWrite, positive(usage.cacheReadTokens))
  return { fresh: input - cacheWrite - cacheRead, cacheRead, cacheWrite }
}

/** Tarif du modèle servi, ou `undefined` si aucune famille connue ne correspond. */
export function modelRate(model: string | undefined): ModelRate | undefined {
  if (!model) return undefined
  const key = model.toLowerCase()
  return MODEL_RATES.find((rate) => key.includes(rate.match))
}

/**
 * Estimation en USD des tokens non tarifés. Rend `undefined` quand le modèle est inconnu ou
 * qu'aucun token n'a été compté — l'appelant affiche alors le volume, pas un montant inventé.
 */
export function estimateCostUsd(usage: TokenUsageShape, nowMs?: number): number | undefined {
  const rate = modelRate(usage.model)
  if (!rate) return undefined
  const intro =
    rate.intro && nowMs !== undefined && nowMs <= rate.intro.untilMs ? rate.intro : undefined
  const inputPerMTok = intro?.inputPerMTok ?? rate.inputPerMTok
  const outputPerMTok = intro?.outputPerMTok ?? rate.outputPerMTok
  const input = positive(usage.inputTokens)
  const output = positive(usage.outputTokens)
  if (input + output === 0) return undefined
  // Les tokens de cache — relus ET écrits — sont un SOUS-ENSEMBLE de l'entrée : on les facture une
  // seule fois, à leur tarif propre, et on retire leur part du plein tarif. L'arbitrage de cet
  // invariant vit dans `splitInputTokens`, partagé avec le superviseur d'exécution.
  const { fresh: freshInput, cacheRead, cacheWrite } = splitInputTokens(usage)
  return (
    (freshInput * inputPerMTok +
      cacheWrite * inputPerMTok * CACHE_WRITE_RATIO +
      cacheRead * inputPerMTok * CACHE_READ_RATIO +
      output * outputPerMTok) /
    1_000_000
  )
}

/** Montant estimé, formaté avec la marque explicite de l'approximation. */
export function formatEstimatedCostUsd(usage: TokenUsageShape, nowMs?: number): string | undefined {
  const estimate = estimateCostUsd(usage, nowMs)
  if (estimate === undefined) return undefined
  return `≈ ${estimate.toFixed(2)} $ estimés`
}
