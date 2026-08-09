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

export const ORCHESTRATION_ALREADY_ISSUED_REFUSAL =
  'Une orchestration a deja ete lancee dans ce tour. Termine avec son resultat ; un nouveau run exige un nouveau message utilisateur.'

export const AUTHORITATIVE_ORCHESTRATION_CLOSURE_PREFIX = 'Clôture Autowin : gate validé'

export function isAuthoritativeOrchestrationClosureLine(line: string): boolean {
  return line.startsWith(AUTHORITATIVE_ORCHESTRATION_CLOSURE_PREFIX)
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

const WORKER_LIFECYCLE_PREFIX =
  /^(?:\s*\*\*)?\s*(?:(?:📍|⏳|👉|⚠️)\s*)?(?:\*\*)?\s*/u

function isStaleWorkerLifecycleLine(line: string): boolean {
  const text = line.replace(WORKER_LIFECYCLE_PREFIX, '').replace(/[`*_]/g, '').trim()
  if (/^#{1,6}\s+(?:\d+[.)]\s*)?publication\s*$/iu.test(text)) return true
  if (/\brun\s+(?:(?:reste|toujours)\s+)?open(?:\s|[.,;:—-]|$)/iu.test(text)) return true
  if (/\bnon\s+(?:publi[ée]e?|commit[ée]e?)(?:\s|[.,;:—-]|$)/iu.test(text)) return true
  if (/\bpublication\s+reste\b/iu.test(text)) return true
  if (/\b(?:autoriser|d[ée]clencher)\s+(?:la\s+)?publication\b/iu.test(text)) return true
  if (/\b(?:lancer|relancer)\s+(?:le\s+)?judge\b/iu.test(text)) return true
  if (/\bjudge\b[^\n]*(?:refus[ée]|reste|non\s+cl[oô]tur)/iu.test(text)) return true
  if (/\b(?:clean\s+(?:puis|et)\s+judge|encha[iî]ner\s+clean[^\n]*judge)\b/iu.test(text))
    return true

  return (
    /^(?:maintenant|reste\s+[àa]\s+faire|recommand[ée]|encha[iî]ner|clean)(?=\s|[—:,-]|$)/iu.test(
      text
    ) &&
    /\b(?:publication|commit|judge|clean)\b/iu.test(text)
  )
}

function isStaleWorkerLifecycleSection(line: string): boolean {
  const heading = /^\s*#{1,6}\s+(.+?)\s*$/u.exec(line)?.[1]
  if (!heading) return false
  const title = heading.replace(/[`*_]/g, '').trim()
  if (isStaleWorkerLifecycleMarker(title)) return true
  return /^(?:\d+[.)]\s*)?(?:publication|maintenant|reste\s+[àa]\s+faire|recommand[ée])(?=\s|$)/iu.test(
    title
  )
}

function isStaleWorkerLifecycleMarker(line: string): boolean {
  const text = line
    .trim()
    .replace(/^#{1,6}\s+/u, '')
    .replace(/\*\*/gu, '')
    .trim()
  return /^(?:📍\s*maintenant|⏳\s*reste\s+[àa]\s+faire|👉\s*recommand(?:é|ée|ation))(?=\s|[—:,-]|$)/iu.test(
    text
  )
}

/**
 * Le rapport du worker est capturé AVANT la gate et la publication. Une fois l'issue structurée
 * `succeeded` connue, ses preuves restent utiles mais ses recommandations de cycle de vie deviennent
 * fausses. On retire uniquement ces lignes, jamais les tests, diffs ou diagnostics.
 */
function removeStaleWorkerLifecycleAdvice(report: string): string {
  let staleHeadingLevel: number | undefined
  let staleMarkerParagraph = false
  const kept: string[] = []

  for (const line of report.split(/\r?\n/u)) {
    if (isAuthoritativeOrchestrationClosureLine(line)) {
      staleHeadingLevel = undefined
      staleMarkerParagraph = false
      kept.push(line)
      continue
    }

    const heading = /^\s*(#{1,6})\s+/u.exec(line)
    if (heading) {
      const level = heading[1].length
      if (staleHeadingLevel !== undefined && level <= staleHeadingLevel) {
        staleHeadingLevel = undefined
      }
      if (staleHeadingLevel !== undefined) continue
      staleMarkerParagraph = false
      if (isStaleWorkerLifecycleSection(line)) {
        staleHeadingLevel = level
        continue
      }
      kept.push(line)
      continue
    }

    if (staleHeadingLevel !== undefined) continue
    if (!line.trim()) {
      staleMarkerParagraph = false
      kept.push(line)
      continue
    }
    if (isStaleWorkerLifecycleMarker(line)) {
      staleMarkerParagraph = true
      continue
    }
    if (staleMarkerParagraph || isStaleWorkerLifecycleLine(line)) continue
    kept.push(line)
  }

  return kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function isDeliveredOrchestrationOutcome(outcome: OrchestrationOutcome): boolean {
  return (
    asString(outcome.status) === 'succeeded' &&
    outcome.valid === true &&
    outcome.gateBlocked === false &&
    outcome.reused === false
  )
}

/**
 * Réconcilie aussi les anciens messages déjà persistés : leur texte worker a été écrit avant la
 * publication, mais leur action `orchestrate` conserve l'outcome structuré qui fait autorité.
 */
export function reconcileClosedOrchestrationText(
  report: string,
  outcome: OrchestrationOutcome
): string {
  return isDeliveredOrchestrationOutcome(outcome) ? removeStaleWorkerLifecycleAdvice(report) : report
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
  const delivered = isDeliveredOrchestrationOutcome(outcome)
  const status = asString(outcome.status)
  const cost = formatExecutionCostCoverage(outcome)
  const run = runLabelFromPath(asString(outcome.runPath) ?? asString(outcome.runId))
  const result = asString(outcome.result)
  const visibleResult = result ? reconcileClosedOrchestrationText(result, outcome) : result

  const headline = gateBlocked
    ? '⛔ Workflow BLOQUÉ par le gate — livrable non validé'
    : invalid
      ? '⚠️ Workflow terminé mais le juge a REFUSÉ le livrable'
      : outcome.reused === true
        ? '↻ Workflow déjà en cours réutilisé (aucun nouveau run lancé)'
        : delivered
          ? '✅ Workflow terminé'
          : '⚠️ Workflow terminé — preuve incomplète de livraison'

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
