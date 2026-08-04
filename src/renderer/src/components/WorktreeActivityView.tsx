import React from 'react'
import type {
  WorktreeAgentActivity,
  WorktreeRuntimeStatus
} from '../../../shared/worktree-activity-model'
import './WorktreeActivityView.css'

function stateCopy(agent: WorktreeAgentActivity): { label: string; outcome: string; tone: string } {
  if (agent.attentionReason === 'retry-exhausted') {
    return {
      label:
        agent.publication === 'cleanup-pending'
          ? 'Changements ajoutés · rangement à vérifier'
          : 'Essais automatiques arrêtés',
      outcome:
        agent.publication === 'cleanup-pending'
          ? 'Le résultat est déjà dans ton workspace. Après six essais, la copie reste protégée et demande une vérification.'
          : 'Autowin a arrêté ses essais après six tentatives. La copie reste protégée sans autre action automatique.',
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
      outcome: 'Deux versions touchent le même fichier. Rien n’a été écrasé.',
      tone: 'danger'
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
    if (agent.attentionReason === 'base-dirty') {
      return {
        label: 'Ton travail est protégé',
        outcome: 'Tes changements passent d’abord. La copie agent reste intacte.',
        tone: 'waiting'
      }
    }
    return {
      label: 'Copie conservée',
      outcome: 'Le retour automatique est bloqué. Aucun fichier local n’a été touché.',
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

function requiresAttention(agent: WorktreeAgentActivity): boolean {
  if (agent.state === 'conflict') return true
  if (
    agent.attentionReason === 'retry-exhausted' ||
    agent.attentionReason === 'post-publish-change'
  )
    return true
  return agent.state === 'blocked' && agent.attentionReason !== 'base-in-progress'
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

function freshnessLabel(agent: WorktreeAgentActivity, nowMs: number): string {
  const timestamp = agent.endedAtMs ?? agent.startedAtMs
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'Fraîcheur inconnue'
  const ageMs = Math.max(0, nowMs - timestamp)
  if (!agent.endedAtMs && ageMs > 30 * 60_000) return 'Obsolète'
  if (ageMs < 60_000) return 'À l’instant'
  if (ageMs < 3_600_000) return `Il y a ${Math.floor(ageMs / 60_000)} min`
  return `Il y a ${Math.floor(ageMs / 3_600_000)} h`
}

/** Carte compacte partagée par le cockpit Worktrees, alimentée par les mêmes traductions métier. */
export function WorktreeActivitySummary({
  agent,
  nowMs,
  onOpen,
  showFiles = true
}: {
  agent: WorktreeAgentActivity
  nowMs?: number
  onOpen?: (agent: WorktreeAgentActivity) => void
  showFiles?: boolean
}): React.JSX.Element {
  const [renderedAt] = React.useState(() => Date.now())
  const copy = stateCopy(agent)
  const freshness = freshnessLabel(agent, nowMs ?? renderedAt)
  return (
    <article className="wt-activity-summary">
      <header>
        {onOpen ? (
          <button type="button" className="wt-summary-open" onClick={() => onOpen(agent)}>
            <strong>{agent.task ?? agent.agentName}</strong>
            <span>{agent.agentName}</span>
          </button>
        ) : (
          <div>
            <strong>{agent.task ?? agent.agentName}</strong>
            <span>{agent.agentName}</span>
          </div>
        )}
        <span className={`wt-office-state is-${copy.tone}`}>{copy.label}</span>
      </header>
      <div className="wt-summary-meta">
        <span>Phase · {agent.role || 'Inconnue'}</span>
        <span>
          Verdict · {agent.verdict && agent.verdict !== 'unknown' ? agent.verdict : 'inconnu'}
        </span>
        <span className={freshness === 'Obsolète' ? 'is-stale' : ''}>{freshness}</span>
      </div>
      {showFiles && <FileList agent={agent} />}
    </article>
  )
}

function AgentOffice({
  agent,
  onResolveConflict,
  onOpenOffice,
  onRetryOffice
}: {
  agent: WorktreeAgentActivity
  onResolveConflict?: (agentId: string) => void
  onOpenOffice?: (path: string) => void
  onRetryOffice?: (agentId: string) => void
}): React.JSX.Element {
  const copy = stateCopy(agent)
  const route = routeCopy(agent)
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
          {agent.recovered && <span className="wt-recovered">↻ Récupéré après redémarrage</span>}
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
          {agent.state !== 'conflict' &&
            requiresAttention(agent) &&
            agent.worktreePath &&
            agent.worktreeAvailable !== false &&
            onOpenOffice && (
              <button
                type="button"
                className="wt-resolve btn btn-sm"
                data-testid="wt-open-office"
                onClick={() => onOpenOffice(agent.worktreePath!)}
              >
                Ouvrir le bureau protégé
              </button>
            )}
          {agent.attentionReason === 'retry-exhausted' && onRetryOffice && (
            <button
              type="button"
              className="wt-resolve btn btn-sm"
              data-testid="wt-retry-office"
              onClick={() => onRetryOffice(agent.agentId)}
            >
              {agent.worktreeAvailable === false
                ? 'Réessayer de recréer le bureau'
                : 'Réessayer maintenant'}
            </button>
          )}
        </div>
      </article>
    </div>
  )
}

export function WorktreeActivityView({
  agents,
  status = { available: false, workspacePath: '', reason: 'identity-unavailable' },
  onResolveConflict,
  onOpenOffice,
  onRetryOffice,
  className
}: {
  agents: WorktreeAgentActivity[]
  status?: WorktreeRuntimeStatus
  nowMs?: number
  onResolveConflict?: (agentId: string) => void
  onOpenOffice?: (path: string) => void
  onRetryOffice?: (agentId: string) => void
  className?: string
}): React.JSX.Element {
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
        className={`wt-main-office${status.available ? '' : ' is-unavailable'}`}
        data-testid="wt-main-office"
      >
        <div className="wt-main-icon" aria-hidden>
          ⌂
        </div>
        <div className="wt-main-copy">
          <span>TON WORKSPACE · PRINCIPAL</span>
          <strong>{status.workspacePath || 'Workspace non identifié'}</strong>
          <p>
            {status.available
              ? 'Disponible · les agents travaillent dans des bureaux séparés'
              : 'Protection indisponible · les mutations sont bloquées'}
          </p>
        </div>
        <span className="wt-shield" aria-label={status.available ? 'Protégé' : 'Indisponible'}>
          {status.available ? '✓' : '!'}
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
            agents.map((agent) => (
              <AgentOffice
                key={agent.agentId}
                agent={agent}
                onResolveConflict={onResolveConflict}
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
