import { formatCostCoverage, resolveCostCoverage } from './cost-estimate'
import { isDeliveredOrchestrationOutcome, type OrchestrationOutcome } from './orchestration-outcome'

/**
 * FRICTION SUR ÉCHECS RÉPÉTÉS — rendre visible le mur avant que l'utilisateur le paie une fois de plus.
 *
 * Défaut mesuré (conv-1302, 2026-08-18) : douze orchestrations d'affilée sur la MÊME demande, dont
 * aucune n'a livré ce qui était demandé, pour un cumul supérieur à 20 $. À chaque tour, l'interface
 * proposait de relancer et rien ne disait « on est au troisième échec, le problème n'est pas la
 * chance ». L'utilisateur a relancé neuf fois — c'est le comportement rationnel quand personne ne
 * lui montre la série.
 *
 * Ce module ne DÉCIDE rien : il n'annule ni ne bloque aucune relance. Il rend la série et son coût
 * LISIBLES, et la décision de changer d'approche reste entièrement humaine. Un garde qui couperait
 * de lui-même serait pire : la relance est parfois exactement la bonne réponse.
 *
 * Le coût n'est pas recalculé ici : les compteurs de la série sont additionnés puis remis à
 * `resolveCostCoverage`, l'unique réponse à « combien a coûté ceci ». Un deuxième calcul de coût
 * aurait fini par diverger du premier.
 */
export interface FrictionEchecsRepetes {
  /** Longueur de la série d'orchestrations TERMINALES sans livraison. */
  runs: number
  /** Libellé de coût honnête pour la série entière ; jamais un faux zéro. */
  cout: string
  /** Ligne prête à afficher, à lire comme un constat — pas comme un verdict sur la demande. */
  message: string
}

/** Champs de consommation d'une issue, additionnés sur la série. */
function cumul(outcomes: readonly OrchestrationOutcome[]): {
  knownCostUsd: number | null
  unpricedCalls: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  model?: string
} {
  const nombre = (valeur: unknown): number =>
    typeof valeur === 'number' && Number.isFinite(valeur) && valeur > 0 ? valeur : 0
  let connu: number | null = null
  const total = {
    unpricedCalls: 0,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0
  }
  let model: string | undefined
  for (const outcome of outcomes) {
    // `knownCostUsd` a trois sens distincts : un montant, `null` (« connu et vide ») et l'absence
    // (« on n'en sait rien »). La somme ne doit devenir un nombre que si AU MOINS une issue en
    // portait un — sinon un cumul « 0,00 $ » se lirait comme « ça n'a rien coûté ».
    const known = outcome.knownCostUsd
    if (typeof known === 'number' && Number.isFinite(known)) connu = (connu ?? 0) + known
    total.unpricedCalls += nombre(outcome.unpricedCalls)
    total.totalTokens += nombre(outcome.totalTokens)
    total.inputTokens += nombre(outcome.inputTokens)
    total.outputTokens += nombre(outcome.outputTokens)
    total.cacheReadTokens += nombre(outcome.cacheReadTokens)
    total.cacheCreationTokens += nombre(outcome.cacheCreationTokens)
    const candidat = outcome.pricingModel ?? outcome.resolvedModel
    if (!model && typeof candidat === 'string' && candidat.trim()) model = candidat
  }
  return { ...total, knownCostUsd: connu, ...(model ? { model } : {}) }
}

/** Seuil par défaut : au TROISIÈME échec d'affilée, ce n'est plus de la malchance. */
export const SEUIL_FRICTION = 3

/**
 * La série d'échecs qui se termine MAINTENANT, si elle atteint le seuil.
 *
 * `outcomes` est chronologique. Seule la série FINALE compte : une livraison réussie remet le
 * compteur à zéro, parce qu'un progrès réel a eu lieu entre-temps. Les issues encore en cours
 * (ni livrées ni terminales) n'entrent pas dans la série : on ne reproche pas un échec à un run
 * qui n'a pas fini.
 */
export function frictionEchecsRepetes(
  outcomes: readonly OrchestrationOutcome[],
  seuil: number = SEUIL_FRICTION
): FrictionEchecsRepetes | undefined {
  const serie: OrchestrationOutcome[] = []
  for (const outcome of [...outcomes].reverse()) {
    if (isDeliveredOrchestrationOutcome(outcome)) break
    if (!estTerminale(outcome)) continue
    serie.unshift(outcome)
  }
  if (serie.length < Math.max(2, seuil)) return undefined
  const cout = formatCostCoverage(resolveCostCoverage(cumul(serie)))
  return {
    runs: serie.length,
    cout,
    message: `${serie.length} orchestrations d’affilée sans livraison · ${cout} cumulés sur la série · relancer à l’identique a déjà échoué ${serie.length} fois`
  }
}

/**
 * L'issue a-t-elle FINI sans livrer ? Un gate qui bloque, un juge qui refuse, un statut d'échec.
 * Une issue sans aucun de ces signes n'est pas comptée : le silence n'est pas un échec.
 */
function estTerminale(outcome: OrchestrationOutcome): boolean {
  if (outcome.gateBlocked === true || outcome.valid === false) return true
  const status = typeof outcome.status === 'string' ? outcome.status.toLowerCase() : ''
  return /^(?:failed|error|cancelled|aborted|interrupted)$/.test(status)
}
