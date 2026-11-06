/**
 * Reconnaissance des erreurs STRUCTUREES du pilote — deplacee mot pour mot depuis
 * `auto-kaizen-supervisor.ts`, supprime avec l'auto-kaizen. Le seul consommateur restant est le
 * reveil des regles Watchdog (`notifyWatchdogWorkflowIncident`) : la detection existait avant
 * l'auto-kaizen et lui survit.
 */

function clipped(value: string, max = 8_000): string {
  const normalized = value.trim()
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}…[tronqué]`
}

function serialized(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * Convertit uniquement les erreurs STRUCTURÉES du pilote. Le texte libre reste une preuve non fiable :
 * citer « ERROR » dans une réponse réussie ne doit jamais créer une tâche.
 */
export function incidentFromPilotEvent(event: {
  kind: string
  name?: string
  text?: string
  ok?: boolean
  data?: unknown
  status?: string
}): { kind: string; summary: string; detail: string } | undefined {
  if (event.kind === 'error') {
    return {
      kind: 'provider-error',
      summary: event.name ? `${event.name} a échoué` : 'Le provider a signalé une erreur',
      detail: clipped(event.text ?? serialized(event.data) ?? 'Erreur provider sans détail')
    }
  }
  if (event.kind === 'prompt-call' && event.status === 'failed') {
    return {
      kind: 'provider-error',
      summary: 'Un appel provider a échoué',
      detail: clipped(event.text ?? serialized(event.data) ?? 'Appel provider en échec')
    }
  }
  if (event.kind !== 'result') return undefined
  if (event.ok === false) {
    const detail = clipped(serialized(event.data) || event.text || 'Échec d’exécution sans détail')
    const normalizedDetail = detail.toLowerCase()
    const hasProviderEvidence =
      /\b(provider|api|openai|anthropic|codex|claude)\b.*\b(error|erreur|failed|failure|échec|quota|rate[ -]?limit|authentication|authentification|api[ -]?key|401|429)\b/.test(
        normalizedDetail
      ) ||
      /\b(error|erreur|failed|failure|échec|quota|rate[ -]?limit|authentication|authentification|api[ -]?key|401|429)\b.*\b(provider|api|openai|anthropic|codex|claude)\b/.test(
        normalizedDetail
      )
    const hasAuthorityRefusal =
      /\b(authority-refused|permission denied|access denied|not authorized|unauthorized|forbidden|tool refused|outil refusé|refus(?:é|e)? par (?:l['’])?outil)\b/.test(
        normalizedDetail
      )
    return {
      kind: hasProviderEvidence
        ? 'provider-error'
        : hasAuthorityRefusal
          ? 'authority-refused'
          : 'execution-failed',
      summary: `${event.name || 'outil'} a échoué`,
      detail
    }
  }
  if (!event.data || typeof event.data !== 'object') return undefined
  const result = event.data as Record<string, unknown>
  const status = typeof result.status === 'string' ? result.status.toLowerCase() : ''
  if (
    status === 'failed' ||
    status === 'red' ||
    result.valid === false ||
    result.gateBlocked === true
  ) {
    return {
      kind: result.gateBlocked === true ? 'gate-failed' : 'orchestration-error',
      summary:
        result.gateBlocked === true
          ? `${event.name || 'orchestration'} bloqué par une gate`
          : `${event.name || 'orchestration'} terminé en erreur`,
      detail: clipped(serialized(event.data))
    }
  }
  if (event.name === 'orchestrate' && status === 'succeeded' && result.valid !== true) {
    return {
      kind: 'verification-incomplete',
      summary: 'Le workflow a terminé sans preuve de validation globale',
      detail: clipped(serialized(event.data))
    }
  }
  return undefined
}
