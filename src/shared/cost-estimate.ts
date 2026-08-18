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

/** Tarifs publics en $ par million de tokens. Source : catalogue Anthropic (2026-08-18). */
interface ModelRate {
  /** Motif reconnu dans l'identifiant du modèle, en minuscules. */
  readonly match: string
  readonly inputPerMTok: number
  readonly outputPerMTok: number
}

/**
 * Ordre significatif : le premier motif qui correspond gagne. Les familles les plus spécifiques
 * (fable/mythos) passent avant les génériques, sinon un `claude-fable-5` serait tarifé en opus.
 */
const MODEL_RATES: readonly ModelRate[] = [
  { match: 'fable', inputPerMTok: 10, outputPerMTok: 50 },
  { match: 'mythos', inputPerMTok: 10, outputPerMTok: 50 },
  { match: 'opus', inputPerMTok: 5, outputPerMTok: 25 },
  { match: 'sonnet', inputPerMTok: 3, outputPerMTok: 15 },
  { match: 'haiku', inputPerMTok: 1, outputPerMTok: 5 }
]

/** Un token relu en cache coûte 10 % du tarif d'entrée. */
const CACHE_READ_RATIO = 0.1

export interface TokenUsageShape {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  model?: string
}

function positive(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
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
export function estimateCostUsd(usage: TokenUsageShape): number | undefined {
  const rate = modelRate(usage.model)
  if (!rate) return undefined
  const input = positive(usage.inputTokens)
  const output = positive(usage.outputTokens)
  // Les tokens de cache sont un SOUS-ENSEMBLE de l'entrée : on ne les facture qu'une fois, au
  // tarif réduit, et on retire donc leur part du plein tarif.
  const cacheRead = Math.min(input, positive(usage.cacheReadTokens))
  if (input + output === 0) return undefined
  const freshInput = input - cacheRead
  return (
    (freshInput * rate.inputPerMTok +
      cacheRead * rate.inputPerMTok * CACHE_READ_RATIO +
      output * rate.outputPerMTok) /
    1_000_000
  )
}

/** Montant estimé, formaté avec la marque explicite de l'approximation. */
export function formatEstimatedCostUsd(usage: TokenUsageShape): string | undefined {
  const estimate = estimateCostUsd(usage)
  if (estimate === undefined) return undefined
  return `≈ ${estimate.toFixed(2)} $ estimés`
}
