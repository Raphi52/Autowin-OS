/**
 * COMBIEN COÛTE CETTE CONVERSATION — la question la plus fréquente, et la seule à laquelle l'app ne
 * répondait pas.
 *
 * Le canal `os:costBreakdown` existait déjà (main + preload + son test de contrat), il réconciliait
 * les DEUX journaux, et AUCUN appelant côté renderer ne l'utilisait. Un module atteignable mais jamais
 * appelé est du théâtre : la mesure du 2026-07-28 (114 fichiers .jsonl parsés à la main pour trouver
 * 26,65 $/h) n'aurait jamais dû demander un script.
 *
 * Ce module ne fait que RÉSUMER les lignes déjà calculées par le main. Il ne recalcule aucun coût :
 * un deuxième calcul de coût dans le renderer serait une deuxième vérité.
 */

import type { TokenUsage } from '../../../shared/token-usage'
import { formatUsd, resolveCostCoverage, type CostCoverage } from '../../../shared/cost-estimate'

export interface CostRow extends TokenUsage {
  /** Acteur, modèle ou provider selon la dimension demandée. */
  key: string
  calls: number
  costUsd: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  /**
   * Tokens ÉCRITS dans le cache — SOUS-ENSEMBLE de `inputTokens`, jamais un ajout. Optionnel : les
   * lignes issues du seul journal d'activité ne l'ont jamais porté.
   */
  cacheCreationTokens?: number
  /** Part du contexte RELUE depuis le cache. Proche de 0 = contexte réécrit à chaque appel. */
  cacheHitRatio: number
  /** Temps cumulé des appels de cette ligne (0 = non mesuré par la source). */
  durationMs?: number
  /** Appels executes dont le fournisseur n'expose pas de prix fiable. */
  unpricedCalls: number
  /**
   * Sous-ensemble de `unpricedCalls` dont les tokens ont été RELUS auprès du CLI puis tarifés au
   * tarif public par le main (`main/activity/cli-usage-recovery.ts`). Absent sur les anciens
   * journaux : ce module ne recalcule rien, il affiche ce que le main a mesuré.
   */
  estimatedCalls?: number
  /** Montant estimé de ces appels-là. */
  estimatedUsd?: number
}

export interface CostSummary extends Readonly<{
  totalUsd: number
  calls: number
  /** Libellé compact pour l'indicateur (ex. « 1,23 $ »). */
  label: string
  /** Poste le plus cher, ou `undefined` si rien n'a été dépensé. */
  topKey?: string
  /** Ratio de cache global, pondéré par les tokens (pas une moyenne des ratios). */
  cacheHitRatio: number
  /**
   * Volume ÉCRIT dans le cache. Exposé pour que « cache 0 % » cesse de se lire comme « rien n'a
   * servi » : un premier appel écrit le cache que les suivants reliront.
   */
  cacheWriteTokens: number
  /** Temps cumulé de la conversation. 0 = aucune source ne l'a mesuré. */
  durationMs: number
  unpricedCalls: number
  /**
   * Montant des appels que le provider n'a pas tarifés mais dont les tokens ont été RÉCUPÉRÉS
   * auprès du CLI. 0 = rien n'a pu être reconstitué.
   */
  estimatedUsd: number
  /**
   * Ce que l'app SAIT dire du coût — la MÊME réponse que l'issue d'orchestration et le dashboard,
   * au lieu d'une troisième version locale. Porte l'estimation au tarif public quand le provider
   * n'expose pas de prix mais que le modèle est connu.
   */
  coverage: CostCoverage
  /**
   * Le contexte est RÉÉCRIT au lieu d'être relu — c'est ce symptôme qui a mené à la cause racine du
   * 2026-07-28. Jugé sur le VOLUME de contexte, pas sur le nombre d'appels : trois appels qui
   * réécrivent 900 k tokens sont un problème, deux appels de 5 k tokens ne prouvent rien.
   *
   * Jugé sur la part FRAÎCHE, pas sur le ratio de lecture : l'écriture de cache est au dénominateur
   * du ratio sans jamais pouvoir atteindre son numérateur, si bien que le premier appel — celui qui
   * ÉCRIT le cache — voyait l'alerte se déclencher au moment précis de l'investissement.
   */
  rewritingContext: boolean
}> {}

/** LA forme d'un montant vit dans `shared/cost-estimate` ; re-exportee pour ne casser aucun import. */
export { formatUsd } from '../../../shared/cost-estimate'

/**
 * Le verdict de cache se juge au VOLUME de contexte, pas au nombre d'appels. Constate a l'ecran le
 * 2026-07-29 : 3 appels, 900 000 tokens reecrits, cache a 5 % — et aucune alerte, parce que le garde
 * exigeait 5 appels. Trois appels qui reecrivent 900 k tokens ne sont PAS un petit echantillon ; deux
 * appels de 5 k tokens, si.
 */
const MIN_CONTEXT_TOKENS_FOR_CACHE_VERDICT = 20_000
const POOR_CACHE_RATIO = 0.3

/**
 * Résumé affichable des lignes de coût. Les lignes non numériques ou négatives sont IGNORÉES plutôt
 * que sommées : un journal corrompu ne doit pas produire un total faux qui a l'air crédible.
 */
export function summarizeConversationCost(rows: readonly CostRow[]): CostSummary {
  let totalUsd = 0
  let calls = 0
  let cacheRead = 0
  let cacheWrite = 0
  let input = 0
  let durationMs = 0
  let unpricedCalls = 0
  let estimatedUsd = 0
  let estimatedCalls = 0
  let topKey: string | undefined
  let topCost = 0
  let output = 0
  let pricedUsd = 0
  let pricedRows = 0
  let model: string | undefined
  let provider: string | undefined
  let firstRow = true
  for (const row of rows) {
    const cost = typeof row?.costUsd === 'number' && Number.isFinite(row.costUsd) ? row.costUsd : 0
    if (cost < 0) continue
    totalUsd += cost
    output += typeof row?.outputTokens === 'number' ? Math.max(0, row.outputTokens) : 0
    if (cost > 0) {
      pricedUsd += cost
      pricedRows += 1
    }
    // Le tarif n'est reconstituable que si toutes les lignes servent le MÊME modèle : en choisir
    // un parmi plusieurs serait inventer un montant.
    if (firstRow) {
      model = row?.model
      provider = row?.provider
      firstRow = false
    } else {
      if (model !== row?.model) model = undefined
      if (provider !== row?.provider) provider = undefined
    }
    calls += typeof row?.calls === 'number' && row.calls > 0 ? row.calls : 0
    cacheRead += typeof row?.cacheReadTokens === 'number' ? Math.max(0, row.cacheReadTokens) : 0
    cacheWrite +=
      typeof row?.cacheCreationTokens === 'number' ? Math.max(0, row.cacheCreationTokens) : 0
    durationMs += typeof row?.durationMs === 'number' && row.durationMs > 0 ? row.durationMs : 0
    input += typeof row?.inputTokens === 'number' ? Math.max(0, row.inputTokens) : 0
    unpricedCalls +=
      typeof row?.unpricedCalls === 'number' && row.unpricedCalls > 0 ? row.unpricedCalls : 0
    // Montant RÉCUPÉRÉ auprès du CLI par le main. Additionné à part du coût rapporté : une
    // estimation et une dépense tarifée ne se confondent pas dans le même chiffre.
    estimatedUsd +=
      typeof row?.estimatedUsd === 'number' && row.estimatedUsd > 0 ? row.estimatedUsd : 0
    estimatedCalls +=
      typeof row?.estimatedCalls === 'number' && row.estimatedCalls > 0 ? row.estimatedCalls : 0
    if (cost > topCost) {
      topCost = cost
      topKey = row.key
    }
  }
  const contextTotal = input
  const cacheHitRatio = contextTotal > 0 ? Math.min(1, cacheRead / contextTotal) : 0
  // Même arbitrage de l'invariant « le cache est un sous-ensemble de l'entrée » que le tarif :
  // écriture bornée d'abord, lecture sur le reste.
  const boundedWrite = Math.min(contextTotal, cacheWrite)
  const boundedRead = Math.min(contextTotal - boundedWrite, cacheRead)
  const freshRatio =
    contextTotal > 0 ? (contextTotal - boundedWrite - boundedRead) / contextTotal : 0
  const coverage = resolveCostCoverage(
    {
      knownCostUsd: pricedRows > 0 ? pricedUsd : null,
      unpricedCalls,
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: cacheRead,
      cacheCreationTokens: cacheWrite,
      ...(model ? { model } : {}),
      ...(provider ? { provider } : {})
    },
    Date.now()
  )
  return {
    totalUsd,
    calls,
    coverage,
    label: spendLabel({
      knownUsd: totalUsd,
      // Estimation par LIGNE (tokens relus auprès du CLI) d'abord ; à défaut, celle de la
      // couverture, qui porte sur le volume ENTIER et couvre donc déjà tous les appels.
      estimatedUsd: estimatedUsd > 0 ? estimatedUsd : (coverage.estimatedUsd ?? 0),
      unpricedCalls,
      // Sans estimation par ligne, seule une couverture estimée couvre les appels ; sinon rien
      // ne les couvre et ils doivent rester COMPTÉS à l'écran.
      estimatedCalls:
        estimatedUsd > 0 ? estimatedCalls : coverage.estimatedUsd !== undefined ? unpricedCalls : 0
    }),
    estimatedUsd,
    durationMs,
    unpricedCalls,
    ...(topKey !== undefined ? { topKey } : {}),
    cacheHitRatio,
    cacheWriteTokens: cacheWrite,
    rewritingContext:
      contextTotal >= MIN_CONTEXT_TOKENS_FOR_CACHE_VERDICT && freshRatio > 1 - POOR_CACHE_RATIO
  }
}

/**
 * LE LIBELLÉ D'UNE DÉPENSE, total ou ligne — un seul endroit, donc un seul vocabulaire.
 *
 * Demande de l'utilisateur du 2026-09-03, sur « 7,00 $ + non exposé » : il ne veut plus lire ces
 * deux mots, il veut la VALEUR. Elle existe : quand le CLI meurt avant son event `result`, ses
 * tokens restent écrits dans son transcript, et le main les relit puis les tarife au tarif public
 * (`main/activity/cli-usage-recovery.ts`). Le libellé porte donc :
 *   « 7,00 $ »                                     tout est tarifé par le provider ;
 *   « 7,00 $ + ≈ 8,43 $ estimés »                  le reste a été récupéré auprès du CLI ;
 *   « 7,00 $ + ≈ 8,43 $ estimés · 1 appel non chiffré »  un appel dont RIEN n'est récupérable ;
 *   « 1 appel non chiffré »                        aucune valeur, nulle part.
 *
 * Le « ≈ » n'est pas décoratif : ce montant est reconstitué au tarif public, pas facturé par le
 * provider. Simplifier les mots ne doit pas effacer cette différence.
 */
interface SpendLabelInput {
  knownUsd: number
  /** Montant reconstitué au tarif public (0 = rien de récupéré). */
  estimatedUsd: number
  unpricedCalls: number
  /** Part de `unpricedCalls` déjà couverte par l'estimation. */
  estimatedCalls: number
}

function spendLabel(input: SpendLabelInput): string {
  const parts: string[] = []
  if (input.knownUsd > 0) parts.push(formatUsd(input.knownUsd))
  // « estimés » est le mot des AUTRES surfaces pour la même chose (`formatCostCoverage`) :
  // le garder ici, c'est un seul vocabulaire de coût dans toute l'app.
  if (input.estimatedUsd > 0) parts.push(`≈ ${formatUsd(input.estimatedUsd)} estimés`)
  const montant = parts.join(' + ')
  const reste = Math.max(0, input.unpricedCalls - input.estimatedCalls)
  // Ce qui reste sans aucun chiffre se COMPTE : « 1 appel non chiffré » dit ce qui manque et
  // combien, là où « non exposé » n'était qu'un aveu sans quantité.
  const manquant =
    reste > 0 ? `${reste} appel${reste > 1 ? 's' : ''} non chiffré${reste > 1 ? 's' : ''}` : ''
  if (montant && manquant) return `${montant} · ${manquant}`
  return montant || manquant || formatUsd(input.knownUsd)
}

/**
 * Le montant d'UNE ligne, avec le MÊME vocabulaire que le total. La ligne rendait « + inconnu » là
 * où le total disait autre chose : un mot de plus pour la même incertitude.
 *
 * N'ESTIME RIEN ICI : `CostRow` ne porte ni modèle ni provider. Le montant estimé lui est REMIS par
 * le main, qui seul connaît le modèle servi — un calcul local serait une deuxième vérité.
 */
export function costRowLabel(
  row: Pick<CostRow, 'costUsd' | 'unpricedCalls' | 'estimatedCalls' | 'estimatedUsd'>
): string {
  return spendLabel({
    knownUsd: row.costUsd,
    estimatedUsd: row.estimatedUsd ?? 0,
    unpricedCalls: row.unpricedCalls,
    estimatedCalls: row.estimatedCalls ?? 0
  })
}

/** Lignes triées par coût décroissant, sans les lignes à 0 $ (elles n'expliquent aucune dépense). */
export function spendingRows(rows: readonly CostRow[]): CostRow[] {
  return rows
    .filter(
      (row) =>
        (typeof row?.costUsd === 'number' && row.costUsd > 0) ||
        (typeof row?.unpricedCalls === 'number' && row.unpricedCalls > 0)
    )
    .sort((a, b) => b.costUsd - a.costUsd || b.unpricedCalls - a.unpricedCalls)
}

/** « 1 appel » / « 3 appels » — vu a l'ecran le 2026-07-29 en « 1 appels ». */
export function callsLabel(calls: number): string {
  return `${calls} appel${calls > 1 ? 's' : ''}`
}

/** Part d'une ligne dans le total, en pourcentage entier (pour une barre de proportion). */
export function sharePercent(row: CostRow, totalUsd: number): number {
  if (!(totalUsd > 0)) return 0
  return Math.round((row.costUsd / totalUsd) * 100)
}

/**
 * Duree lisible : « 4,2 s », « 3 min 12 s », « 1 h 05 ». Rend `undefined` quand rien n'a ete mesure —
 * afficher « 0 s » ferait croire a une operation instantanee au lieu d'une absence de mesure.
 */
export function formatDuration(ms: number): string | undefined {
  if (!Number.isFinite(ms) || ms <= 0) return undefined
  if (ms < 1000) return `${Math.round(ms)} ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1).replace('.', ',')} s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds - minutes * 60)
  if (minutes < 60) return rest > 0 ? `${minutes} min ${rest} s` : `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const restMin = minutes - hours * 60
  return `${hours} h ${String(restMin).padStart(2, '0')}`
}

/** Part du TEMPS d'une ligne, en pourcentage entier. Le poste le plus lent n'est pas le plus cher. */
export function timeSharePercent(row: CostRow, totalDurationMs: number): number {
  if (!(totalDurationMs > 0) || !row.durationMs || row.durationMs <= 0) return 0
  return Math.round((row.durationMs / totalDurationMs) * 100)
}
