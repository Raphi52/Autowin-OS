/**
 * CARTE DE LIVRAISON d'une orchestration — les faits, pas une formule.
 *
 * Défaut mesuré sur conv-76 (2026-07-29) : 18 appels de sous-agents, 10,05 $ dépensés, et le fil
 * affichait « Workflow Autowin exécuté. » L'orchestrateur retourne pourtant statut, validité, blocage
 * de gate, coût, chemin du RUN et résultat — tout était jeté. C'est 92 % de la dépense d'une
 * conversation dont l'utilisateur ne voyait strictement rien.
 *
 * Partagé (`shared/`) parce que le main le formate et que le renderer en résume la version courte :
 * une seule définition de ce qui compte, pas deux qui divergent.
 */

export interface OrchestrationOutcome {
  status?: unknown
  valid?: unknown
  gateBlocked?: unknown
  costUsd?: unknown
  /** Somme des seuls appels tarifés ; null signifie qu'aucun prix n'est exposé. */
  knownCostUsd?: unknown
  /** Appels dont les tokens sont connus mais dont le fournisseur n'expose pas le prix. */
  unpricedCalls?: unknown
  runPath?: unknown
  runId?: unknown
  result?: unknown
  reused?: unknown
  error?: unknown
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asCallCount(value: unknown): number {
  const count = asNumber(value)
  return count === undefined ? 0 : Math.max(0, Math.floor(count))
}

const STALE_WORKER_LIFECYCLE_LINE =
  /^(?:\s*\*\*)?\s*[📍⏳👉]|\b(?:run\s+(?:reste\s+)?open|non\s+commit[ée]|(?:lancer|relancer)\s+(?:le\s+)?judge|(?:gate|publication)[^\n]*(?:reste|[àa]\s+faire|non\s+faite?|attente))\b/iu

/**
 * Le rapport du worker est capturé AVANT la gate et la publication. Une fois l'issue structurée
 * `succeeded` connue, ses preuves restent utiles mais ses recommandations de cycle de vie deviennent
 * fausses. On retire uniquement ces lignes, jamais les tests, diffs ou diagnostics.
 */
function removeStaleWorkerLifecycleAdvice(report: string): string {
  return report
    .split(/\r?\n/)
    .filter((line) => !STALE_WORKER_LIFECYCLE_LINE.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Libellé de coût honnête, compatible avec les anciens résultats qui n'avaient que `costUsd`. */
export function formatExecutionCostCoverage(data: OrchestrationOutcome): string | undefined {
  const hasCoverage = Object.prototype.hasOwnProperty.call(data, 'knownCostUsd')
  const knownCost = asNumber(data.knownCostUsd)
  const unpricedCalls = asCallCount(data.unpricedCalls)
  const unpricedLabel = `${unpricedCalls} appel${unpricedCalls > 1 ? 's' : ''} non chiffré${unpricedCalls > 1 ? 's' : ''}`

  if (hasCoverage && data.knownCostUsd === null) {
    return unpricedCalls > 0 ? `coût non exposé · ${unpricedLabel}` : 'coût non exposé'
  }
  if (hasCoverage && knownCost !== undefined) {
    return unpricedCalls > 0
      ? `${knownCost.toFixed(2)} $ connus · ${unpricedLabel}`
      : `${knownCost.toFixed(2)} $`
  }
  const legacyCost = asNumber(data.costUsd)
  return legacyCost === undefined ? undefined : `${legacyCost.toFixed(2)} $`
}

/** Nom lisible du run à partir de son chemin (le dossier `<sujet>-workspace`). */
export function runLabelFromPath(path: string | undefined): string | undefined {
  if (!path) return undefined
  const segments = path.replace(/\\/g, '/').split('/').filter(Boolean)
  const workspace = [...segments].reverse().find((segment) => segment.endsWith('-workspace'))
  return workspace?.replace(/-workspace$/, '') ?? segments.at(-2)
}

/**
 * Texte de clôture d'une orchestration. Ne prétend JAMAIS un succès : `gateBlocked` ou `valid: false`
 * sont dits explicitement, même quand l'appel a « réussi » techniquement. Un gate qui bloque est un
 * échec de livraison, pas un détail.
 */
export function formatOrchestrationOutcome(
  ok: boolean,
  data: OrchestrationOutcome | undefined,
  errorMessage?: string
): string {
  if (!ok) {
    return `Échec du workflow : ${asString(errorMessage) ?? asString(data?.error) ?? 'raison non rapportée'}`
  }
  const outcome = data ?? {}
  const gateBlocked = outcome.gateBlocked === true
  const invalid = outcome.valid === false
  const status = asString(outcome.status)
  const cost = formatExecutionCostCoverage(outcome)
  const run = runLabelFromPath(asString(outcome.runPath) ?? asString(outcome.runId))
  const result = asString(outcome.result)
  const deliveryClosed = status === 'succeeded' && !gateBlocked && !invalid && outcome.reused !== true
  const visibleResult = result && deliveryClosed ? removeStaleWorkerLifecycleAdvice(result) : result

  const headline = gateBlocked
    ? '⛔ Workflow BLOQUÉ par le gate — livrable non validé'
    : invalid
      ? '⚠️ Workflow terminé mais le juge a REFUSÉ le livrable'
      : outcome.reused === true
        ? '↻ Workflow déjà en cours réutilisé (aucun nouveau run lancé)'
        : '✅ Workflow terminé'

  const facts = [
    status && `statut ${status}`,
    cost && (cost.startsWith('coût ') ? cost : `coût ${cost}`),
    run && `run « ${run} »`
  ].filter((fact): fact is string => Boolean(fact))

  const lines = [facts.length ? `${headline} · ${facts.join(' · ')}` : headline]
  if (visibleResult)
    lines.push(
      '',
      visibleResult.length > 4_000
        ? `${visibleResult.slice(0, 4_000)}…[tronqué]`
        : visibleResult
    )
  return lines.join('\n')
}
