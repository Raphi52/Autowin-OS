/**
 * Comparer plusieurs façons de faire sur un MÊME objectif.
 *
 * Le but n'est pas de désigner le workflow le moins cher, mais le meilleur travail au meilleur prix
 * — deux choses que le classement naïf confond en permanence :
 *
 *  - un run ROUGE qui coûte trois fois moins cher n'est pas « moins cher », il n'a rien produit ;
 *  - un coût INCONNU (appels non tarifés) n'est pas un coût nul — le traiter comme zéro
 *    couronnerait systématiquement le workflow le moins mesurable.
 *
 * Ces deux règles sont la raison d'être de ce module ; le tri, lui, est trivial.
 */

export interface WorkflowRunOutcome {
  profileId: string
  profileName: string
  /** Le gate a-t-il autorisé la clôture ? Seul un run vert peut prétendre à quoi que ce soit. */
  green: boolean
  /** Coût mesuré. `null`/absent = INCONNU, jamais assimilé à zéro. */
  costUsd?: number | null
  totalTokens?: number
  durationMs?: number
  /** Appels dont le prix n'a pas pu être établi — rend le coût partiel. */
  unpricedCalls?: number
  proofStatus?: 'passed' | 'failed' | 'unknown'
  checksPassed?: number
  checksFailed?: number
  proofs?: Array<{ command?: string; summary: string; ok: boolean; exitCode?: number }>
  retainedWorkspace?: { runId: string; path: string; baseSha?: string; files: string[] }
  nonMeasuredReason?: string
}

export interface WorkflowComparisonRow extends WorkflowRunOutcome {
  /** Coût utilisable pour le classement, ou `null` si on ne sait pas. */
  comparableCostUsd: number | null
  /** Ce que la ligne ne permet PAS d'affirmer — affiché, jamais tu. */
  caveat?: string
}

export interface WorkflowComparison {
  rows: WorkflowComparisonRow[]
  /** Recommandation : le moins cher PARMI les verts, ou `undefined` si aucun n'aboutit. */
  recommendedProfileId?: string
  /** Pourquoi cette recommandation — ou pourquoi il n'y en a pas. */
  rationale: string
}

function comparableCost(outcome: WorkflowRunOutcome): number | null {
  if (typeof outcome.costUsd !== 'number' || Number.isNaN(outcome.costUsd)) return null
  // Un coût amputé d'appels non tarifés n'est pas comparable à un coût complet : on refuse de
  // classer dessus plutôt que de couronner le workflow le moins mesuré.
  if ((outcome.unpricedCalls ?? 0) > 0) return null
  return outcome.costUsd
}

function caveatFor(outcome: WorkflowRunOutcome, cost: number | null): string | undefined {
  if (outcome.nonMeasuredReason) return `non mesuré — ${outcome.nonMeasuredReason}`
  if (!outcome.green) return 'run non vert — ne compte pas comme un résultat'
  if (cost === null && (outcome.unpricedCalls ?? 0) > 0) {
    return `coût partiel — ${outcome.unpricedCalls} appel(s) non tarifé(s)`
  }
  if (cost === null) return 'coût inconnu — non classable'
  return undefined
}

export function compareWorkflowRuns(outcomes: readonly WorkflowRunOutcome[]): WorkflowComparison {
  const rows: WorkflowComparisonRow[] = outcomes.map((outcome) => {
    const comparableCostUsd = comparableCost(outcome)
    const caveat = caveatFor(outcome, comparableCostUsd)
    return { ...outcome, comparableCostUsd, ...(caveat ? { caveat } : {}) }
  })

  const verts = rows.filter((row) => row.green)
  if (verts.length === 0) {
    return {
      rows,
      rationale:
        'Aucun workflow n’a abouti : il n’y a rien à recommander. Un run moins cher qui échoue ne coûte pas moins, il ne produit rien.'
    }
  }

  const chiffrables = verts.filter((row) => row.comparableCostUsd !== null)
  if (chiffrables.length === 0) {
    return {
      rows,
      rationale: `${verts.length} workflow(s) ont abouti, mais aucun coût n’est comparable — on ne classe pas sur une mesure incomplète.`
    }
  }

  const meilleur = chiffrables.reduce((best, row) =>
    (row.comparableCostUsd as number) < (best.comparableCostUsd as number) ? row : best
  )
  const ecartes = verts.length - chiffrables.length
  const reserve =
    ecartes > 0 ? ` ${ecartes} workflow(s) vert(s) écarté(s) faute de coût comparable.` : ''
  return {
    rows,
    recommendedProfileId: meilleur.profileId,
    rationale: `${meilleur.profileName} aboutit pour ${(meilleur.comparableCostUsd as number).toFixed(2)} $, le moins cher parmi ${chiffrables.length} workflow(s) verts.${reserve}`
  }
}
