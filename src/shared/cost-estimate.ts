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
 * Ce module reconstitue le tarif à partir du modèle servi. Les taux sont COPIÉS des grilles
 * officielles, citées ligne par ligne dans `MODEL_RATES` avec leur date de lecture — jamais devinés.
 * Un modèle inconnu ne rend RIEN : on préfère afficher le volume de tokens qu'inventer un montant.
 */

import type { TokenUsage } from './token-usage'
import { isSubscriptionBilled } from './billing-model'

/** Un couple de prix en $ par million de tokens. */
interface Prix {
  readonly inputPerMTok: number
  readonly outputPerMTok: number
}

/**
 * Ce que l'estimation lit d'un usage. `requests` dit combien de requêtes au modèle cet usage
 * additionne : les paliers « long contexte » se jugent requête par requête, et seul `requests` = 1
 * permet de dire qu'UNE requête a dépassé le seuil (conv-1602).
 */
export interface UsageAEstimer extends TokenUsage {
  requests?: number
}

/** Tarifs publics en $ par million de tokens, une ligne par modèle exact ou par famille. */
interface ModelRate extends Prix {
  /**
   * Fournisseur qui SERT ce tarif, en minuscules. Le catalogue est celui d'Anthropic : un tarif ne
   * vaut que pour le provider dont il est copié. Quand l'appelant nomme son provider, un motif de
   * modèle ne peut plus rendre un tarif Anthropic pour un modèle tiers qui contiendrait le même
   * mot. Sans provider, le lookup se comporte exactement comme avant.
   */
  readonly provider: string
  /** Motif reconnu dans l'identifiant du modèle, en minuscules. */
  readonly match: string
  /**
   * Part du tarif d'entrée payée par un token RELU en cache. Propre à chaque ligne : la grille
   * Anthropic du 2026-11-05 la met à 0,1× en général, 0,05× sur Opus et Sonnet 5.5, 0,025× sur
   * Fable et Mythos 5.1 ; OpenAI à 0,05× sur gpt-6.1. Le même ratio vaut aux deux paliers.
   */
  readonly cacheReadRatio: number
  /**
   * Seuil du palier « long contexte », en tokens d'entrée d'UNE requête, cache compris : au-delà
   * (strictement), `long` remplace les prix courts. Absent = un seul prix quelle que soit la taille.
   */
  readonly longAboveTokens?: number
  readonly long?: Prix
  /**
   * Tarif d'INTRODUCTION (ou de promotion), borné dans le temps. Appliqué seulement si l'appelant
   * fournit une horloge : sans elle on garde le tarif standard. Le module n'a donc pas d'horloge
   * cachée, et il cesse de lui-même d'appliquer l'intro passé `untilMs` — aucune date à retirer.
   */
  readonly intro?: Prix & {
    readonly untilMs: number
    readonly long?: Prix
  }
}

/**
 * Fin de la promotion de gpt-5.6-sol : « GPT-5.6 Sol’s promotional pricing is available until
 * November 30, 2026 » (https://developers.openai.com/api/docs/pricing.md, relu le 2026-11-05).
 * La page ne donne pas de fuseau : fin du 30/11 en UTC, inclus (conv-1602).
 */
export const GPT_5_6_SOL_PROMO_UNTIL_MS = Date.UTC(2026, 10, 30, 23, 59, 59, 999)

/** Grille Anthropic : https://platform.claude.com/docs/en/about-claude/pricing */
const CLAUDE = 'claude'
/** Grille OpenAI : https://developers.openai.com/api/docs/pricing.md, table « Standard pricing data » */
const CODEX = 'codex'
/** « Short context: ≤272K input tokens. Long context: >272K input tokens. » (grille OpenAI). */
const OPENAI_LONG_ABOVE_TOKENS = 272_000

/**
 * Ordre significatif : le premier motif qui correspond gagne. Chaque MODÈLE EXACT passe avant le
 * motif de sa famille, sinon `claude-opus-5-5` serait tarifé en `opus` et `gpt-6.1-sol` en `sol`
 * (idées fausses relevées le 2026-11-05, conv-1602). Les motifs de famille ne servent plus qu'aux
 * versions sans ligne propre.
 * fix-ok: cause mesurée le 2026-11-05 — les deux grilles officielles relues par curl (exit 0) ne
 * donnent plus les prix de cette table, et l'appel Haiku 5.5 réel (`total_cost_usd` 0,00093225 $)
 * tombait sur le motif `haiku` à 1 $ / 5 $, d'où 0,0093225 $ estimés (conv-1602).
 */
const MODEL_RATES: readonly ModelRate[] = [
  // ── Claude — grille Anthropic relue le 2026-11-05 (conv-1602) ──
  // Fable 5.1 et Mythos 5.1 : 10 $ / 50 $, cache relu 0,25 $ = 0,025× (note 1 de la grille).
  {
    provider: CLAUDE,
    match: 'fable-5-1',
    inputPerMTok: 10,
    outputPerMTok: 50,
    cacheReadRatio: 0.025
  },
  {
    provider: CLAUDE,
    match: 'mythos-5-1',
    inputPerMTok: 10,
    outputPerMTok: 50,
    cacheReadRatio: 0.025
  },
  // Opus 5.5 : 4 $ / 20 $, cache relu 0,20 $ = 0,05× (note 2 de la grille).
  { provider: CLAUDE, match: 'opus-5-5', inputPerMTok: 4, outputPerMTok: 20, cacheReadRatio: 0.05 },
  // Sonnet 5.5 : 2 $ / 10 $, cache relu 0,10 $ = 0,05× (note 2). AVANT `sonnet-5`, qui l'attraperait.
  {
    provider: CLAUDE,
    match: 'sonnet-5-5',
    inputPerMTok: 2,
    outputPerMTok: 10,
    cacheReadRatio: 0.05
  },
  // Sonnet 5 : 2 $ / 10 $ PERMANENTS, cache relu 0,20 $. Le prix d'introduction est devenu le prix
  // standard ; la hausse à 3 $ / 15 $ du 1er septembre « will not occur » (note 3 de la grille).
  { provider: CLAUDE, match: 'sonnet-5', inputPerMTok: 2, outputPerMTok: 10, cacheReadRatio: 0.1 },
  // Haiku 5.5 : 0,10 $ / 0,50 $ jusqu'à 100 000 tokens de prompt, 0,50 $ / 2,50 $ au-delà ; le cache
  // relu reste à 0,1× aux deux paliers (0,01 $ puis 0,05 $). Section « Long context pricing ».
  {
    provider: CLAUDE,
    match: 'haiku-5-5',
    inputPerMTok: 0.1,
    outputPerMTok: 0.5,
    cacheReadRatio: 0.1,
    longAboveTokens: 100_000,
    long: { inputPerMTok: 0.5, outputPerMTok: 2.5 }
  },
  // Familles : Fable 5 et Mythos 5 (10 $ / 50 $, cache 1 $), Opus 4.5 à 5 (5 $ / 25 $, cache 0,50 $),
  // Sonnet 4.5 et 4.6 (3 $ / 15 $, cache 0,30 $), Haiku 4.5 (1 $ / 5 $, cache 0,10 $). Les modèles
  // retirés (Opus 4 et 4.1, Haiku 3.5) n'ont pas de ligne : ils prennent le prix de leur famille.
  { provider: CLAUDE, match: 'fable', inputPerMTok: 10, outputPerMTok: 50, cacheReadRatio: 0.1 },
  { provider: CLAUDE, match: 'mythos', inputPerMTok: 10, outputPerMTok: 50, cacheReadRatio: 0.1 },
  { provider: CLAUDE, match: 'opus', inputPerMTok: 5, outputPerMTok: 25, cacheReadRatio: 0.1 },
  { provider: CLAUDE, match: 'sonnet', inputPerMTok: 3, outputPerMTok: 15, cacheReadRatio: 0.1 },
  { provider: CLAUDE, match: 'haiku', inputPerMTok: 1, outputPerMTok: 5, cacheReadRatio: 0.1 },

  // ── OpenAI / Codex — grille OpenAI relue le 2026-11-05 (conv-1602) ──
  // Ces tarifs servent l'ÉQUIVALENT, pas une dépense : cette application n'atteint codex que par
  // l'abonnement ChatGPT (`shared/billing-model.ts`). Le palier long contexte EST publié (au-delà de
  // 272K tokens d'entrée) : l'ancien commentaire disait le contraire. Partout, le prix long vaut
  // 2× l'entrée et 1,5× la sortie, et le cache relu garde son ratio.
  // Écriture en cache : 30 min à 1,25× l'entrée, comme `CACHE_WRITE_RATIO` ; la grille publie aussi
  // une écriture 12 h à 2,5×, que l'usage remonté ne distingue pas — NON comptée (plancher).
  {
    provider: CODEX,
    match: 'gpt-6.1-sol',
    inputPerMTok: 2,
    outputPerMTok: 10,
    cacheReadRatio: 0.05,
    longAboveTokens: OPENAI_LONG_ABOVE_TOKENS,
    long: { inputPerMTok: 4, outputPerMTok: 15 }
  },
  {
    provider: CODEX,
    match: 'gpt-6.1-terra',
    inputPerMTok: 1,
    outputPerMTok: 5,
    cacheReadRatio: 0.05,
    longAboveTokens: OPENAI_LONG_ABOVE_TOKENS,
    long: { inputPerMTok: 2, outputPerMTok: 7.5 }
  },
  {
    provider: CODEX,
    match: 'gpt-6-sol',
    inputPerMTok: 2,
    outputPerMTok: 10,
    cacheReadRatio: 0.1,
    longAboveTokens: OPENAI_LONG_ABOVE_TOKENS,
    long: { inputPerMTok: 4, outputPerMTok: 15 }
  },
  {
    provider: CODEX,
    match: 'gpt-6-luna',
    inputPerMTok: 0.1,
    outputPerMTok: 0.5,
    cacheReadRatio: 0.1,
    longAboveTokens: OPENAI_LONG_ABOVE_TOKENS,
    long: { inputPerMTok: 0.2, outputPerMTok: 0.75 }
  },
  // gpt-5.6-sol : 4 $ / 20 $ (long 8 $ / 30 $) en PROMOTION jusqu'au 30/11/2026. Prix d'après :
  // 5 $ / 30 $, ceux que la page du modèle réduit de « 20% » et « 33% » pour arriver à 4 $ / 20 $,
  // et leur palier long 10 $ / 45 $ par sa règle « 2x input and 1.5x output for the full request »
  // (https://developers.openai.com/api/docs/models/gpt-5.6-sol.md, relue le 2026-11-05, conv-1602).
  {
    provider: CODEX,
    match: 'gpt-5.6-sol',
    inputPerMTok: 5,
    outputPerMTok: 30,
    cacheReadRatio: 0.1,
    longAboveTokens: OPENAI_LONG_ABOVE_TOKENS,
    long: { inputPerMTok: 10, outputPerMTok: 45 },
    intro: {
      untilMs: GPT_5_6_SOL_PROMO_UNTIL_MS,
      inputPerMTok: 4,
      outputPerMTok: 20,
      long: { inputPerMTok: 8, outputPerMTok: 30 }
    }
  },
  {
    provider: CODEX,
    match: 'gpt-5.6-terra',
    inputPerMTok: 2,
    outputPerMTok: 12,
    cacheReadRatio: 0.1,
    longAboveTokens: OPENAI_LONG_ABOVE_TOKENS,
    long: { inputPerMTok: 4, outputPerMTok: 18 }
  },
  {
    provider: CODEX,
    match: 'gpt-5.6-luna',
    inputPerMTok: 0.2,
    outputPerMTok: 1.2,
    cacheReadRatio: 0.1,
    longAboveTokens: OPENAI_LONG_ABOVE_TOKENS,
    long: { inputPerMTok: 0.4, outputPerMTok: 1.8 }
  },
  // Familles, pour une version sans ligne propre : le prix de gpt-5.6, sans palier long (inconnu).
  { provider: CODEX, match: 'sol', inputPerMTok: 5, outputPerMTok: 30, cacheReadRatio: 0.1 },
  { provider: CODEX, match: 'terra', inputPerMTok: 2, outputPerMTok: 12, cacheReadRatio: 0.1 },
  { provider: CODEX, match: 'luna', inputPerMTok: 0.2, outputPerMTok: 1.2, cacheReadRatio: 0.1 }
]

/**
 * Un token ÉCRIT dans le cache pour 5 MIN coûte 1,25× le tarif d'entrée. C'est aussi le tarif
 * appliqué quand la durée de vie est INCONNUE : un PLANCHER assumé, jamais une durée devinée.
 */
const CACHE_WRITE_RATIO = 1.25
/**
 * Un token ÉCRIT dans le cache pour 1 HEURE coûte 2× le tarif d'entrée.
 * Source : https://platform.claude.com/docs/en/build-with-claude/prompt-caching (relu le 2026-09-26).
 *
 * Le CLI Claude écrit en 1 h : mesuré le 2026-09-26, `cache_creation.ephemeral_5m_input_tokens` = 0
 * sur toutes les sessions du jour. Son propre `total_cost_usd` applique d'ailleurs déjà ce taux
 * (`.arena/banc-heal/out-a.json` : 0,8698835 $ = 26 × 5 + 10 129 × 25 + 487 297 × 0,5
 * + 37 288 × 10, en $ par million). Au taux de 1,25×, l'estimation de secours d'Autowin sous-évaluait donc chaque
 * écriture de 37,5 %.
 */
const CACHE_WRITE_1H_RATIO = 2

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
  /** Relu depuis le cache (`cacheReadRatio` de la ligne : 0,1× l'entrée en général). */
  readonly cacheRead: number
  /** Écrit dans le cache (1,25× l'entrée pour 5 min, 2× pour 1 h — voir `estimateCostUsd`). */
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
 * Le palier long contexte ne s'applique qu'à UNE requête dont l'entrée dépasse le seuil. Un total
 * sous le seuil est exact au prix court (chaque requête est plus petite que lui). Un total au-delà
 * du seuil sur plusieurs requêtes, ou sur un nombre inconnu, ne dit pas qu'UNE requête l'a
 * dépassé : prix court, un PLANCHER assumé comme la durée de vie de cache inconnue. Les appelants
 * additionnent souvent plusieurs requêtes (`cli-usage-recovery.ts`, `dashboards/cost.ts`) ; juger le
 * total aurait multiplié par 5 le coût de vingt petits appels Haiku 5.5 (conv-1602).
 */
function enLongContexte(rate: ModelRate, usage: UsageAEstimer, input: number): boolean {
  return rate.longAboveTokens !== undefined && input > rate.longAboveTokens && usage.requests === 1
}

/**
 * L'entrée comptée en tokens « au prix d'entrée » : chaque poste du cache pèse son multiple du prix
 * d'entrée. Une seule définition pour la grille (`estimateCostUsd`) et pour le prix appris du CLI
 * (`tokensPonderes`) : deux copies de cette pondération finiraient par diverger (conv-1602).
 */
function entreePonderee(usage: TokenUsage, cacheReadRatio: number): number {
  // Les tokens de cache — relus ET écrits — sont un SOUS-ENSEMBLE de l'entrée : on les facture une
  // seule fois, à leur tarif propre, et on retire leur part du plein tarif. L'arbitrage de cet
  // invariant vit dans `splitInputTokens`, partagé avec le superviseur d'exécution.
  const { fresh: freshInput, cacheRead, cacheWrite } = splitInputTokens(usage)
  // La part 1 h est un SOUS-ENSEMBLE de l'écriture : bornée à elle, jamais ajoutée par-dessus.
  const cacheWrite1h = Math.min(cacheWrite, positive(usage.cacheCreation1hTokens))
  return (
    freshInput +
    (cacheWrite - cacheWrite1h) * CACHE_WRITE_RATIO +
    cacheWrite1h * CACHE_WRITE_1H_RATIO +
    cacheRead * cacheReadRatio
  )
}

/**
 * Estimation en USD des tokens non tarifés. Rend `undefined` quand le modèle est inconnu ou
 * qu'aucun token n'a été compté — l'appelant affiche alors le volume, pas un montant inventé.
 */
export function estimateCostUsd(usage: UsageAEstimer, nowMs?: number): number | undefined {
  const rate = modelRate(usage.model, usage.provider)
  if (!rate) return undefined
  const intro =
    rate.intro && nowMs !== undefined && nowMs <= rate.intro.untilMs ? rate.intro : undefined
  const input = positive(usage.inputTokens)
  const output = positive(usage.outputTokens)
  if (input + output === 0) return undefined
  const court: Prix & { readonly long?: Prix } = intro ?? rate
  // Un tarif sans prix long publié garderait son prix court : un plancher, jamais un prix deviné.
  const prix: Prix = enLongContexte(rate, usage, input) ? (court.long ?? court) : court
  const { inputPerMTok, outputPerMTok } = prix
  return (
    (entreePonderee(usage, rate.cacheReadRatio) * inputPerMTok + output * outputPerMTok) / 1_000_000
  )
}

/**
 * FORME commune des prix Claude quand la grille ne connaît pas le modèle : sur toutes les lignes
 * Claude de `MODEL_RATES` (grille du 2026-11-05), la sortie vaut 5× l'entrée, et le cache relu
 * 0,1× sur la plupart. Seule la forme est supposée : le NIVEAU du prix vient du CLI (conv-1602).
 */
const FORME_CLAUDE_PAR_DEFAUT = { sortieParEntree: 5, cacheReadRatio: 0.1 } as const

/**
 * Tokens PONDÉRÉS : l'usage compté en tokens « au prix d'entrée », la sortie et le cache pesant
 * leur multiple de ce prix. Le CLI Claude tarife chaque modèle (`modelUsage[<modèle>].costUSD`) :
 * `costUSD ÷ tokensPonderes` donne alors le prix d'un token d'entrée SANS l'avoir recopié d'une
 * grille, et `tokensPonderes × ce prix` réestime un autre usage du même modèle (conv-1602).
 *
 * Les MULTIPLES viennent de la ligne de grille du modèle quand elle existe (Opus 5.5 relit le cache
 * à 0,05×), sinon de la forme Claude commune. Une hausse de prix qui garde la forme — le cas
 * courant — est donc absorbée sans toucher à la table.
 */
export function tokensPonderes(usage: UsageAEstimer): number {
  const rate = modelRate(usage.model, usage.provider)
  const forme = rate
    ? {
        sortieParEntree: rate.outputPerMTok / rate.inputPerMTok,
        cacheReadRatio: rate.cacheReadRatio
      }
    : FORME_CLAUDE_PAR_DEFAUT
  return (
    entreePonderee(usage, forme.cacheReadRatio) +
    positive(usage.outputTokens) * forme.sortieParEntree
  )
}

/**
 * Vrai quand AUCUNE requête de cet usage n'a pu passer le palier long contexte : le total d'entrée
 * ne dépasse pas le seuil (chaque requête est plus petite que lui). Un `costUSD` observé au-delà
 * peut mêler prix courts et prix longs : son rapport ne dirait pas le prix court (conv-1602).
 */
export function sousLePalierLong(usage: UsageAEstimer): boolean {
  const seuil = modelRate(usage.model, usage.provider)?.longAboveTokens
  return seuil === undefined || positive(usage.inputTokens) <= seuil
}

/**
 * Estimation au prix APPRIS du CLI (`usdParTokenPondere`, un prix court). `undefined` — l'appelant
 * prend alors la grille — quand l'usage n'a rien de tarifable ou qu'UNE requête passe le palier long
 * contexte de sa ligne : le prix appris ne dit rien de ce palier, la grille si (conv-1602).
 */
export function estimerAuTarifAppris(
  usage: UsageAEstimer,
  usdParTokenPondere: number
): number | undefined {
  if (!Number.isFinite(usdParTokenPondere) || usdParTokenPondere <= 0) return undefined
  const rate = modelRate(usage.model, usage.provider)
  if (rate && enLongContexte(rate, usage, positive(usage.inputTokens))) return undefined
  const ponderes = tokensPonderes(usage)
  return ponderes > 0 ? ponderes * usdParTokenPondere : undefined
}

/**
 * LA forme d'un montant, partout. Virgule francaise, et 3 decimales sous le centime : arrondir a
 * « 0,00 $ » effacerait une depense reelle. Montee ici depuis `conversation-cost.ts` — deux
 * formateurs vivants, c'est deux ponctuations pour le meme montant selon la surface.
 */
export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount)) return '—'
  if (amount === 0) return '0 $'
  const decimals = Math.abs(amount) < 0.01 ? 3 : 2
  return `${amount.toFixed(decimals).replace('.', ',')} $`
}

/** Volume lisible : la seule information vraie qui reste quand le tarif du modèle est inconnu. */
function formatTokenVolume(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M tokens`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k tokens`
  return `${Math.round(tokens)} tokens`
}

/** Ce qu'on sait dire du coût d'un usage — le tout, pas un morceau par surface. */
export interface CostCoverageInput extends UsageAEstimer {
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
