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
import { isSubscriptionBilled } from './billing-model'

/** Tarifs publics en $ par million de tokens. Source : catalogue Anthropic (2026-08-18). */
interface ModelRate {
  /**
   * Fournisseur qui SERT ce tarif, en minuscules. Le catalogue est celui d'Anthropic : un tarif ne
   * vaut que pour le provider dont il est copié. Quand l'appelant nomme son provider, un motif de
   * modèle ne peut plus rendre un tarif Anthropic pour un modèle tiers qui contiendrait le même
   * mot. Sans provider, le lookup se comporte exactement comme avant.
   */
  readonly provider: string
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
  { provider: 'claude', match: 'fable', inputPerMTok: 10, outputPerMTok: 50 },
  { provider: 'claude', match: 'mythos', inputPerMTok: 10, outputPerMTok: 50 },
  { provider: 'claude', match: 'opus', inputPerMTok: 5, outputPerMTok: 25 },
  // Sonnet 5 AVANT le `sonnet` générique : seul lui porte le tarif d'introduction. Sonnet 4.6 reste
  // à 3 $ / 15 $ en permanence, et l'attraper avec l'intro l'aurait sous-facturé de 33 %.
  {
    provider: 'claude',
    match: 'sonnet-5',
    inputPerMTok: 3,
    outputPerMTok: 15,
    intro: { untilMs: SONNET_5_INTRO_UNTIL_MS, inputPerMTok: 2, outputPerMTok: 10 }
  },
  { provider: 'claude', match: 'sonnet', inputPerMTok: 3, outputPerMTok: 15 },
  { provider: 'claude', match: 'haiku', inputPerMTok: 1, outputPerMTok: 5 },
  // OpenAI / Codex — source primaire lue le 2026-08-18 :
  // https://developers.openai.com/api/docs/pricing.md (table « Standard »).
  // Les ratios de cache y sont IDENTIQUES a ceux d'Anthropic (relu -90 %, ecrit 1,25x), donc
  // CACHE_READ_RATIO et CACHE_WRITE_RATIO s'appliquent sans exception a ajouter.
  //
  // Ces tarifs servent l'EQUIVALENT, pas une depense : cette application n'atteint codex que par
  // l'abonnement ChatGPT (`shared/billing-model.ts`). Une surcharge long-contexte existe (~272k
  // tokens) mais la table n'en publie pas le seuil exact : NON codee tant qu'elle n'est pas precise,
  // plutot qu'approximee.
  //
  // `sol` et `terra` AVANT le motif generique `gpt-5`, sinon le premier motif gagnant les ecraserait.
  { provider: 'codex', match: 'sol', inputPerMTok: 5, outputPerMTok: 30 },
  { provider: 'codex', match: 'terra', inputPerMTok: 2, outputPerMTok: 12 },
  { provider: 'codex', match: 'luna', inputPerMTok: 0.2, outputPerMTok: 1.2 }
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

/**
 * Tarif du modèle servi, ou `undefined` si aucune famille connue ne correspond.
 *
 * `provider` est OPTIONNEL : omis, le lookup se comporte exactement comme avant (motif seul).
 * Fourni, il devient une CONDITION — un identifiant tiers ne peut plus hériter d'un tarif
 * Anthropic parce qu'il contient un mot du catalogue. Aucun tarif non-Anthropic n'est ajouté ici :
 * il n'en existe pas de source citable, et un montant inventé est pire qu'un montant absent.
 */
export function modelRate(model: string | undefined, provider?: string): ModelRate | undefined {
  if (!model) return undefined
  const key = model.toLowerCase()
  const servedBy = provider?.toLowerCase()
  return MODEL_RATES.find(
    (rate) =>
      key.includes(rate.match) && (servedBy === undefined || servedBy.includes(rate.provider))
  )
}

/**
 * Estimation en USD des tokens non tarifés. Rend `undefined` quand le modèle est inconnu ou
 * qu'aucun token n'a été compté — l'appelant affiche alors le volume, pas un montant inventé.
 */
export function estimateCostUsd(usage: TokenUsageShape, nowMs?: number): number | undefined {
  const rate = modelRate(usage.model, usage.provider)
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

/**
 * LA forme d'un montant, partout. Virgule francaise, et 3 decimales sous le centime : arrondir a
 * « 0,00 $ » effacerait une depense reelle. Montee ici depuis `conversation-cost.ts` — deux
 * formateurs vivants, c'est deux ponctuations pour le meme montant selon la surface.
 */
export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount)) return '—'
  if (amount === 0) return '0 $'
  const decimals = amount < 0.01 ? 3 : 2
  return `${amount.toFixed(decimals).replace('.', ',')} $`
}

/** Montant estimé, formaté avec la marque explicite de l'approximation. */
export function formatEstimatedCostUsd(usage: TokenUsageShape, nowMs?: number): string | undefined {
  const estimate = estimateCostUsd(usage, nowMs)
  if (estimate === undefined) return undefined
  return `≈ ${formatUsd(estimate)} estimés`
}

/** Volume lisible : la seule information vraie qui reste quand le tarif du modèle est inconnu. */
export function formatTokenVolume(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M tokens`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k tokens`
  return `${Math.round(tokens)} tokens`
}

/** Ce qu'on sait dire du coût d'un usage — le tout, pas un morceau par surface. */
export interface CostCoverageInput extends TokenUsage {
  /**
   * Montant TARIFÉ par le provider. `null` dit explicitement « la couverture est connue, et elle
   * est vide » ; `undefined` dit « on n'en sait rien ». Les deux mènent à l'estimation.
   */
  knownCostUsd?: number | null
  unpricedCalls?: number
  /** Volume total mesuré. À défaut, entrée + sortie. */
  totalTokens?: number
}

/**
 * RÉPONSE UNIQUE à « combien a coûté ceci ».
 *
 * Trois surfaces répondaient chacune la sienne : l'issue d'orchestration estimait au tarif public,
 * l'indicateur de conversation rendait « coût non exposé », le dashboard rendait `spentIsPartial`.
 * Une seule des trois savait estimer. Cette fonction porte la réponse ; les surfaces la FORMATENT.
 */
export interface CostCoverage {
  /**
   * Montant rapporte par le provider. NE VAUT PAS « facture » : sur un forfait c'est l'equivalent
   * que le CLI calcule (`total_cost_usd`), pas un debit. `subscription` ci-dessous tranche le sens.
   */
  readonly knownUsd?: number
  /** Estimation au tarif public, `undefined` si le modèle est inconnu. Jamais un montant inventé. */
  readonly estimatedUsd?: number
  readonly unpricedCalls: number
  /** Volume de tokens : l'information vraie qui reste quand aucun montant n'est disponible. */
  readonly tokens: number
  /**
   * La consommation est couverte par un forfait deja paye : tout montant est alors un EQUIVALENT.
   * Verifie sur le provider, jamais suppose (`shared/billing-model.ts`).
   */
  readonly subscription: boolean
}

export function resolveCostCoverage(usage: CostCoverageInput, nowMs?: number): CostCoverage {
  const known =
    typeof usage.knownCostUsd === 'number' && Number.isFinite(usage.knownCostUsd)
      ? usage.knownCostUsd
      : undefined
  const tokens =
    positive(usage.totalTokens) || positive(usage.inputTokens) + positive(usage.outputTokens)
  const estimated = known === undefined ? estimateCostUsd(usage, nowMs) : undefined
  const unpricedCalls = Math.max(0, Math.floor(positive(usage.unpricedCalls)))
  return {
    ...(known !== undefined ? { knownUsd: known } : {}),
    ...(estimated !== undefined ? { estimatedUsd: estimated } : {}),
    unpricedCalls,
    tokens,
    subscription: isSubscriptionBilled(usage.provider)
  }
}

/**
 * LIGNE PRINCIPALE d'une consommation sous forfait : ce qui est reellement consomme, dans l'unite qui
 * s'applique au contrat. Choix utilisateur du 2026-08-18 (« les deux, quota d'abord ») : le volume et
 * l'appartenance au forfait passent devant, le montant devient secondaire.
 */
function formatSubscriptionUsage(
  coverage: CostCoverage,
  unpricedLabel: string | undefined
): string {
  const base =
    coverage.tokens > 0 ? `${formatTokenVolume(coverage.tokens)} · inclus (abo)` : 'inclus (abo)'
  return unpricedLabel ? `${base} · ${unpricedLabel}` : base
}

/**
 * LIGNE SECONDAIRE : ce que le meme travail couterait s'il etait facture a l'usage. `undefined` quand
 * aucun montant n'est disponible — on ne remplace jamais une absence par un chiffre.
 *
 * Separee de la ligne principale a dessein : une pastille de fil n'a qu'une ligne, un panneau par
 * role peut en afficher deux. La surface decide, le vocabulaire reste le meme.
 */
export function formatCostEquivalent(coverage: CostCoverage): string | undefined {
  const montant = coverage.knownUsd ?? coverage.estimatedUsd
  if (montant === undefined) return undefined
  if (!coverage.subscription) return undefined
  return `≈ ${formatUsd(montant)} si facturé à l'usage`
}

/**
 * Libellé de couverture — les MÊMES mots sur toutes les surfaces. Le trio délibéré
 * « coût non exposé » / « tarif non exposé » / « N appels non chiffrés » est une cicatrice : il
 * distingue un prix absent d'un tarif absent d'un appel non compté, et se préserve mot pour mot.
 */
export function formatCostCoverage(coverage: CostCoverage): string {
  const n = coverage.unpricedCalls
  const unpricedLabel = `${n} appel${n > 1 ? 's' : ''} non chiffré${n > 1 ? 's' : ''}`
  const withUnpriced = (label: string): string => (n > 0 ? `${label} · ${unpricedLabel}` : label)
  // FORFAIT : aucun montant n'est une depense, donc aucun montant ne tient la ligne principale. Le
  // mot « connus » etait faux ici — il presentait l'equivalent calcule par le CLI comme un debit.
  if (coverage.subscription) {
    return formatSubscriptionUsage(coverage, n > 0 ? unpricedLabel : undefined)
  }
  if (coverage.knownUsd !== undefined) {
    return n > 0
      ? `${formatUsd(coverage.knownUsd)} connus · ${unpricedLabel}`
      : formatUsd(coverage.knownUsd)
  }
  if (coverage.estimatedUsd !== undefined) {
    return withUnpriced(`≈ ${formatUsd(coverage.estimatedUsd)} estimés`)
  }
  if (coverage.tokens > 0)
    return withUnpriced(`${formatTokenVolume(coverage.tokens)} · tarif non exposé`)
  return withUnpriced('coût non exposé')
}
