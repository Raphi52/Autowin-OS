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
    // Deux lignees coexistent : `knownCostUsd` (couverture explicite) et l'ancien `costUsd` seul,
    // sur lequel la pastille par run se replie deja (`formatExecutionCostCoverage`). Ne sommer que
    // la premiere annoncait « 2,00 $ » sous trois pastilles totalisant 10,40 $ — le bandeau
    // sous-estimait de 5x l'argument censé arreter l'utilisateur.
    //
    // `nombre()` s'applique aussi aux montants : un `NaN` ou un negatif produisait « -3,000 $ »,
    // un coût cumule NEGATIF affiche a l'utilisateur.
    const known = nombre(outcome.knownCostUsd) || nombre(outcome.costUsd)
    if (known > 0) connu = (connu ?? 0) + known
    total.unpricedCalls += nombre(outcome.unpricedCalls)
    total.totalTokens += nombre(outcome.totalTokens)
    total.inputTokens += nombre(outcome.inputTokens)
    total.outputTokens += nombre(outcome.outputTokens)
    total.cacheReadTokens += nombre(outcome.cacheReadTokens)
    total.cacheCreationTokens += nombre(outcome.cacheCreationTokens)
    const candidat = outcome.pricingModel ?? outcome.resolvedModel
    if (!model && typeof candidat === 'string' && candidat.trim()) model = candidat
  }
  // LIMITE ASSUMEE : aucune lignee ne pose `provider` sur l'issue (`executionCostCoverageFields`
  // n'expose que la couverture et le modele), donc `resolveCostCoverage` verra toujours
  // `subscription: false` et un forfait s'affichera comme un montant. La pastille PAR RUN a
  // exactement la meme limite : ce module ne diverge donc pas d'elle. Propager un champ que
  // personne ne remplit aurait ete du code mort deguise en correctif.
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
    // Le message n'affirme QUE ce que les donnees soutiennent. La premiere version disait
    // « relancer a l'identique a deja echoue N fois » — or rien ici ne rattache une issue a une
    // demande : trois echecs sur trois demandes DIFFERENTES produisaient la meme phrase. Un faux
    // signal dans le module dont l'objet est d'en supprimer. Le cumul est aussi mis apres deux
    // points, sinon « coût non exposé cumulés sur la série » sortait agrammatical des que la
    // couverture n'est pas un montant.
    message: `${serie.length} orchestrations d’affilée sans livraison · série : ${cout}`
  }
}

/**
 * L'issue a-t-elle FINI sans livrer ? Un gate qui bloque, un juge qui refuse, un statut d'échec.
 * Une issue sans aucun de ces signes n'est pas comptée : le silence n'est pas un échec.
 */
function estTerminale(outcome: OrchestrationOutcome): boolean {
  // Lecture DUCK-TYPEE d'un fil relu du disque : `gateBlocked` peut arriver truthy sans etre un
  // booleen, et un statut inconnu (`timeout`, ou avec une espace finale) est un echec terminal tout
  // autant que `failed`. La premiere version les laissait tous les trois disparaitre en silence.
  if (outcome.gateBlocked || outcome.valid === false) return true
  const status = typeof outcome.status === 'string' ? outcome.status.trim().toLowerCase() : ''
  if (!status) return false
  return !/^(?:running|pending|queued|started|succeeded|success|ok|green)$/.test(status)
}
