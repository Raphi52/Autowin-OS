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
  const cost = asNumber(outcome.costUsd)
  const run = runLabelFromPath(asString(outcome.runPath) ?? asString(outcome.runId))
  const result = asString(outcome.result)

  const headline = gateBlocked
    ? '⛔ Workflow BLOQUÉ par le gate — livrable non validé'
    : invalid
      ? '⚠️ Workflow terminé mais le juge a REFUSÉ le livrable'
      : outcome.reused === true
        ? '↻ Workflow déjà en cours réutilisé (aucun nouveau run lancé)'
        : '✅ Workflow terminé'

  const facts = [
    status && `statut ${status}`,
    cost !== undefined && `coût ${cost.toFixed(2)} $`,
    run && `run « ${run} »`
  ].filter((fact): fact is string => Boolean(fact))

  const lines = [facts.length ? `${headline} · ${facts.join(' · ')}` : headline]
  if (result) lines.push('', result.length > 4_000 ? `${result.slice(0, 4_000)}…[tronqué]` : result)
  return lines.join('\n')
}
