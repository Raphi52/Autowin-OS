import React from 'react'
import {
  formatOfficeDuration,
  requiresAttention,
  sortOfficesByAttention,
  type WorktreeAgentActivity,
  type WorktreeConflictResolutionChoice,
  type WorktreeRuntimeStatus
} from '../../../shared/worktree-activity-model'
import './WorktreeActivityView.css'

function joinNames(names: string[]): string {
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`
}

/** Décrit un conflit avec les SEULES informations réellement fournies (jamais de valeur inventée). */
function conflictOutcome(agent: WorktreeAgentActivity): string {
  const parts: string[] = []
  parts.push(
    agent.conflictFile
      ? `Deux versions touchent le même fichier : ${agent.conflictFile}.`
      : 'Deux versions touchent le même fichier.'
  )
  const others = (agent.conflictWith ?? []).filter((name) => name.trim().length > 0)
  if (others.length > 0) {
    parts.push(`Versions en présence : ${joinNames([agent.agentName, ...others])}.`)
  }
  parts.push('Aucune version n’a été écrasée : les deux sont conservées, à toi de trancher.')
  return parts.join(' ')
}

/** « après six essais » était un chiffre en dur : on montre le compteur réel quand il existe. */
function attemptsPhrase(agent: WorktreeAgentActivity): string {
  const count = agent.retryCount
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) {
    return 'plusieurs essais'
  }
  return `${count} essai${count > 1 ? 's' : ''}`
}

function stateCopy(agent: WorktreeAgentActivity): { label: string; outcome: string; tone: string } {
  if (agent.attentionReason === 'retry-exhausted') {
    const attempts = attemptsPhrase(agent)
    const detail = agent.detail ? ` ${agent.detail}` : ''
    return {
      label:
        agent.publication === 'cleanup-pending'
          ? 'Changements ajoutés · rangement à vérifier'
          : 'Essais automatiques arrêtés',
      outcome:
        agent.publication === 'cleanup-pending'
          ? `Le résultat est déjà dans ton workspace. Après ${attempts}, la copie reste protégée et demande une vérification.${detail}`
          : `Autowin a arrêté ses essais après ${attempts}. La copie reste protégée sans autre action automatique.${detail}`,
      tone: 'waiting'
    }
  }
  if (agent.publication === 'published') {
    return {
      label: 'Changements ajoutés · nouveautés protégées',
      outcome:
        'Les changements vérifiés sont déjà dans ton workspace. Du travail plus récent reste protégé dans ce bureau.',
      tone: 'waiting'
    }
  }
  if (agent.publication === 'cleanup-pending') {
    return {
      label: 'Changements ajoutés',
      outcome: 'Le résultat est déjà dans ton workspace. Autowin termine le rangement seul.',
      tone: 'waiting'
    }
  }
  if (agent.state === 'conflict') {
    return {
      label: 'Décision requise',
      outcome: conflictOutcome(agent),
      tone: 'danger'
    }
  }
  if (agent.state === 'interrupted') {
    // Ni un refus ni un conflit : l'application s'est arrêtée pendant que le run travaillait.
    // Le présenter comme « bloqué » noyait les 7 bureaux à traiter sous 118 faux positifs.
    return {
      label: 'Interrompu',
      outcome:
        'Le run tournait quand Autowin s’est arrêté. Rien n’a été perdu : la copie est conservée, tu peux la relancer ou l’oublier.',
      tone: 'waiting'
    }
  }
  if (agent.state === 'blocked') {
    if (agent.attentionReason === 'base-in-progress') {
      return {
        label: 'Nouvel essai automatique',
        outcome: 'Ton workspace est occupé. Autowin attend puis réessaie seul.',
        tone: 'waiting'
      }
    }
    if (agent.attentionReason === 'ignored-deliverables') {
      return {
        label: 'Des fichiers non suivis bloquent le retour',
        outcome: `La copie contient des fichiers ignorés par git qui pourraient être des livrables : Autowin ne les jette pas. Déplace-les ou supprime-les, puis relance le retour.${agent.detail ? ` ${agent.detail}` : ''}`,
        tone: 'danger'
      }
    }
    if (agent.attentionReason === 'base-dirty') {
      return {
        label: 'Ton travail est protégé',
        outcome: 'Tes changements passent d’abord. La copie agent reste intacte.',
        tone: 'waiting'
      }
    }
    return {
      label: 'Copie conservée',
      outcome: `Le retour automatique est bloqué. Aucun fichier local n’a été touché.${agent.detail ? ` ${agent.detail}` : ''}`,
      tone: 'danger'
    }
  }
  if (agent.state === 'merged') {
    return {
      label: 'Rangé automatiquement',
      outcome:
        agent.files.length === 0
          ? 'Aucun changement à ajouter. Le bureau a été rangé.'
          : 'Les changements vérifiés sont revenus dans ton workspace.',
      tone: 'done'
    }
  }
  if (agent.state === 'ready') {
    return {
      label: agent.verdict === 'red' ? 'Copie non retenue' : 'Copie conservée',
      outcome:
        agent.verdict === 'red'
          ? 'Le résultat n’est pas vert : il reste isolé et ne sera pas ajouté.'
          : 'Ce bureau attend sans modifier ton workspace.',
      tone: 'waiting'
    }
  }
  return {
    label: 'Agent au travail',
    outcome: 'Il travaille dans son propre bureau. Ton workspace reste disponible.',
    tone: 'working'
  }
}

function routeCopy(agent: WorktreeAgentActivity): { label: string; tone: string; glyph: string } {
  if (agent.publication === 'published') {
    return {
      label:
        agent.attentionReason === 'post-publish-change'
          ? 'Revenu dans ton workspace · suite protégée'
          : 'Revenu dans ton workspace',
      tone: 'returned',
      glyph: '↵'
    }
  }
  if (agent.publication === 'cleanup-pending') {
    return {
      label:
        agent.attentionReason === 'retry-exhausted'
          ? 'Revenu dans ton workspace · rangement à vérifier'
          : 'Revenu dans ton workspace · rangement en cours',
      tone: agent.attentionReason === 'retry-exhausted' ? 'attention' : 'returned',
      glyph: '↵'
    }
  }
  if (agent.state === 'merged') {
    return { label: 'Revenu dans ton workspace', tone: 'returned', glyph: '↵' }
  }
  if (requiresAttention(agent)) {
    return { label: 'Retour suspendu · ton avis', tone: 'attention', glyph: '↳' }
  }
  if (agent.state === 'ready') {
    return { label: 'Conservé dans ce bureau', tone: 'waiting', glyph: '→' }
  }
  return { label: 'Travaille dans ce bureau séparé', tone: 'working', glyph: '→' }
}

/** Verdict de vérification en clair (jamais « green »/« red » bruts à l'écran). */
function verdictLabel(verdict: NonNullable<WorktreeAgentActivity['verdict']>): string {
  const labels: Record<typeof verdict, string> = {
    unknown: 'inconnue',
    running: 'en cours',
    green: 'réussie',
    red: 'échouée',
    cancelled: 'annulée',
    interrupted: 'interrompue'
  }
  return labels[verdict]
}

function FileList({ agent }: { agent: WorktreeAgentActivity }): React.JSX.Element {
  if (agent.files.length === 0) {
    return <div className="wt-office-empty">Aucun fichier signalé</div>
  }
  return (
    <div className="wt-office-files" aria-label="Fichiers de ce bureau">
      {agent.files.map((file) => (
        <span className={`wt-file wt-file-${file.kind}`} key={`${file.kind}-${file.path}`}>
          <b aria-hidden>{file.kind === 'add' ? '+' : file.kind === 'del' ? '−' : '~'}</b>
          {file.path}
        </span>
      ))}
    </div>
  )
}

type OfficeActionKey = 'open' | 'retry' | 'keep-agent' | 'keep-mine'

/** Une action à la fois par bureau : pendant l'appel, le bouton dit ce qu'il fait et se verrouille. */
function useOfficeAction(): {
  pending: OfficeActionKey | null
  error?: string
  run: (key: OfficeActionKey, action: () => unknown) => void
} {
  const [pending, setPending] = React.useState<OfficeActionKey | null>(null)
  const [error, setError] = React.useState<string | undefined>(undefined)
  const run = (key: OfficeActionKey, action: () => unknown): void => {
    if (pending) return
    setPending(key)
    setError(undefined)
    const fail = (cause: unknown): void => {
      setPending(null)
      setError(cause instanceof Error ? cause.message : 'Action impossible pour l’instant.')
    }
    try {
      const result = action() as PromiseLike<unknown> | undefined
      // Une action synchrone n'a pas d'attente à montrer : ne pas inventer un état « en cours ».
      if (!result || typeof result.then !== 'function') {
        setPending(null)
        return
      }
      result.then(() => setPending(null), fail)
    } catch (cause) {
      fail(cause)
    }
  }
  return { pending, error, run }
}

function AgentOffice({
  agent,
  nowMs,
  onResolveConflict,
  onResolveConflictChoice,
  onOpenOffice,
  onRetryOffice
}: {
  agent: WorktreeAgentActivity
  nowMs?: number
  onResolveConflict?: (agentId: string) => void
  onResolveConflictChoice?: (agentId: string, choice: WorktreeConflictResolutionChoice) => unknown
  onOpenOffice?: (path: string) => unknown
  onRetryOffice?: (agentId: string) => unknown
}): React.JSX.Element {
  const copy = stateCopy(agent)
  const route = routeCopy(agent)
  const action = useOfficeAction()
  const duration = formatOfficeDuration(agent, nowMs)
  return (
    <div className="wt-office-branch" data-testid="wt-office-branch">
      <article
        className={`wt-agent-office is-${copy.tone}`}
        data-testid="wt-agent-office"
        data-state={agent.state}
        data-recovered={agent.recovered ? 'true' : 'false'}
      >
        <div className="wt-office-rail" aria-hidden />
        <div className="wt-office-body">
          <header className="wt-office-head">
            <div className="wt-office-person">
              <span className="wt-office-avatar">{agent.agentName.slice(0, 1).toUpperCase()}</span>
              <div>
                <strong>{agent.agentName}</strong>
                <span>{agent.role ? `Rôle · ${agent.role}` : 'Bureau agent'}</span>
              </div>
            </div>
            <span className={`wt-office-state is-${copy.tone}`}>
              <i aria-hidden />
              {copy.label}
            </span>
          </header>

          <div className="wt-office-task">{agent.task ?? 'Tâche récupérée'}</div>
          {agent.worktreePath && (
            <code className="wt-office-path" title={agent.worktreePath}>
              {agent.worktreePath}
            </code>
          )}
          {agent.canonicalBaseRef && (
            <div className="wt-office-base">Base vérifiée · {agent.canonicalBaseRef}</div>
          )}
          {(agent.excludedDirtyFiles?.length ?? 0) > 0 && (
            <details className="wt-office-excluded">
              <summary>
                {agent.excludedDirtyFileCount ?? agent.excludedDirtyFiles!.length} changement
                {(agent.excludedDirtyFileCount ?? agent.excludedDirtyFiles!.length) > 1
                  ? 's locaux'
                  : ' local'}{' '}
                non inclus
                {agent.excludedDirtyFilesTruncated
                  ? ` · ${agent.excludedDirtyFiles!.length} affichés`
                  : ''}
              </summary>
              <ul>
                {agent.excludedDirtyFiles!.map((path) => (
                  <li key={path}>{path}</li>
                ))}
              </ul>
            </details>
          )}
          {agent.recovered && <span className="wt-recovered">↻ Récupéré après redémarrage</span>}
          {duration && (
            <div className="wt-office-duration" data-testid="wt-office-duration">
              {agent.endedAtMs ? 'Durée · ' : 'Ouvert depuis · '}
              {duration}
            </div>
          )}
          <div className="wt-office-trace" data-testid="wt-office-trace">
            {agent.baseBranch && <span>Branche de départ · {agent.baseBranch}</span>}
            {agent.verdict && agent.verdict !== 'unknown' && (
              <span>Vérification · {verdictLabel(agent.verdict)}</span>
            )}
            {agent.publication === 'published' && agent.publishedSha && (
              <span>Ajouté sous · {agent.publishedSha.slice(0, 8)}</span>
            )}
          </div>
          <FileList agent={agent} />
          <div className="wt-office-outcome">{copy.outcome}</div>
          <div className={`wt-office-route is-${route.tone}`}>
            <span aria-hidden>{route.glyph}</span>
            {route.label}
          </div>

          {agent.state === 'conflict' && onResolveConflict && (
            <button
              type="button"
              className="wt-resolve btn btn-sm"
              data-testid="wt-resolve-conflict"
              onClick={() => onResolveConflict(agent.agentId)}
            >
              Comparer les deux versions
            </button>
          )}
          {agent.state === 'conflict' && onResolveConflictChoice && (
            <div className="wt-office-choices" data-testid="wt-office-choices">
              <button
                type="button"
                className="wt-resolve btn btn-sm"
                data-testid="wt-keep-agent"
                disabled={action.pending !== null}
                onClick={() =>
                  action.run('keep-agent', () => onResolveConflictChoice(agent.agentId, 'agent'))
                }
              >
                {action.pending === 'keep-agent'
                  ? 'Application de la version de l’agent…'
                  : 'Garder la version de l’agent'}
              </button>
              <button
                type="button"
                className="wt-resolve btn btn-sm"
                data-testid="wt-keep-mine"
                disabled={action.pending !== null}
                onClick={() =>
                  action.run('keep-mine', () => onResolveConflictChoice(agent.agentId, 'mine'))
                }
              >
                {action.pending === 'keep-mine'
                  ? 'Application de ta version…'
                  : 'Garder ma version'}
              </button>
            </div>
          )}
          {agent.state !== 'conflict' &&
            requiresAttention(agent) &&
            agent.worktreePath &&
            agent.worktreeAvailable !== false &&
            onOpenOffice && (
              <button
                type="button"
                className="wt-resolve btn btn-sm"
                data-testid="wt-open-office"
                disabled={action.pending !== null}
                onClick={() => action.run('open', () => onOpenOffice(agent.worktreePath!))}
              >
                {action.pending === 'open' ? 'Ouverture du bureau…' : 'Ouvrir le bureau protégé'}
              </button>
            )}
          {agent.attentionReason === 'retry-exhausted' && onRetryOffice && (
            <button
              type="button"
              className="wt-resolve btn btn-sm"
              data-testid="wt-retry-office"
              disabled={action.pending !== null}
              onClick={() => action.run('retry', () => onRetryOffice(agent.agentId))}
            >
              {action.pending === 'retry'
                ? 'Nouvel essai en cours…'
                : agent.worktreeAvailable === false
                  ? 'Réessayer de recréer le bureau'
                  : 'Réessayer maintenant'}
            </button>
          )}
          {action.error && (
            <div className="wt-office-error" data-testid="wt-office-error" role="alert">
              {action.error}
            </div>
          )}
        </div>
      </article>
    </div>
  )
}

export function WorktreeActivityView({
  agents,
  status,
  nowMs,
  onResolveConflict,
  onResolveConflictChoice,
  onOpenOffice,
  onRetryOffice,
  className
}: {
  agents: WorktreeAgentActivity[]
  /** `null`/absent = protection encore en cours de vérification (JAMAIS un état d'erreur). */
  status?: WorktreeRuntimeStatus | null
  nowMs?: number
  onResolveConflict?: (agentId: string) => void
  onResolveConflictChoice?: (agentId: string, choice: WorktreeConflictResolutionChoice) => unknown
  onOpenOffice?: (path: string) => unknown
  onRetryOffice?: (agentId: string) => unknown
  className?: string
}): React.JSX.Element {
  const resolving = !status
  const available = status?.available === true
  const orderedAgents = sortOfficesByAttention(agents)
  const decisions = agents.filter(requiresAttention).length
  const active = agents.filter(
    (agent) => agent.state === 'working' || agent.state === 'isolated'
  ).length
  return (
    <div className={`wt-view ${className ?? ''}`} data-testid="wt-view">
      <header className="wt-hub-head">
        <div>
          <span className="wt-kicker">TON PROJET</span>
          <h3>
            Un workspace, {agents.length} bureau{agents.length > 1 ? 'x' : ''}
          </h3>
        </div>
        <span className="wt-hub-count">
          {active} actif{active > 1 ? 's' : ''}
        </span>
      </header>

      <section
        className={`wt-main-office${available || resolving ? '' : ' is-unavailable'}${
          resolving ? ' is-checking' : ''
        }`}
        data-testid="wt-main-office"
        data-status={resolving ? 'checking' : available ? 'available' : 'unavailable'}
      >
        <div className="wt-main-icon" aria-hidden>
          ⌂
        </div>
        <div className="wt-main-copy">
          <span>TON WORKSPACE · PRINCIPAL</span>
          <strong>
            {resolving
              ? 'Workspace en cours de vérification'
              : status.workspacePath || 'Workspace non identifié'}
          </strong>
          <p>
            {resolving
              ? 'Vérification de la protection…'
              : available
                ? 'Disponible · les agents travaillent dans des bureaux séparés'
                : 'Protection indisponible · les mutations sont bloquées'}
          </p>
        </div>
        <span
          className="wt-shield"
          aria-label={resolving ? 'Vérification' : available ? 'Protégé' : 'Indisponible'}
        >
          {resolving ? '…' : available ? '✓' : '!'}
        </span>
      </section>

      <div className="wt-flow-label" aria-hidden>
        <span />
        <b>{agents.length ? 'WORKTREES · BUREAUX SÉPARÉS' : 'PRÊT POUR LES AGENTS'}</b>
        <span />
      </div>

      <section
        className={`wt-office-flow${agents.length ? '' : ' is-empty'}`}
        data-testid="wt-office-flow"
      >
        <div className="wt-offices" aria-label="Bureaux agents">
          {agents.length === 0 ? (
            <div className="wt-no-offices">
              <span aria-hidden>◇</span>
              <strong>Aucun bureau agent ouvert</strong>
              <p>Ton workspace reste le seul bureau actif.</p>
            </div>
          ) : (
            orderedAgents.map((agent) => (
              <AgentOffice
                key={agent.agentId}
                agent={agent}
                nowMs={nowMs}
                onResolveConflict={onResolveConflict}
                onResolveConflictChoice={onResolveConflictChoice}
                onOpenOffice={onOpenOffice}
                onRetryOffice={onRetryOffice}
              />
            ))
          )}
        </div>
      </section>

      <section className="wt-inbox" data-testid="wt-inbox">
        <span className="wt-inbox-icon" aria-hidden>
          ↓
        </span>
        <div>
          <strong>Changements entrants</strong>
          <p>
            {decisions > 0
              ? `${decisions} bureau${decisions > 1 ? 'x' : ''} à vérifier · rien n’est perdu`
              : 'Les retours verts sont rangés automatiquement'}
          </p>
        </div>
        <span className={decisions ? 'is-attention' : 'is-clear'}>
          {decisions ? decisions : '✓'}
        </span>
      </section>
    </div>
  )
}
