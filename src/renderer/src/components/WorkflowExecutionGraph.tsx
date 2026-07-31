import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildCausalPath, flattenCausalNodes } from './causal-path-model'
import {
  buildHarnessTimelineFromTrace,
  type HarnessTimelineEvent,
  type HarnessTraceEvent
} from './harness-timeline-model'
import { LatestRequestGate } from './observatory-reliability'
import { projectLatestRequestExecution } from './request-execution-tree-model'
import './WorkflowExecutionGraph.css'

interface WorkflowExecutionGraphProps {
  conversationId?: string
  active?: boolean
  live?: boolean
  requestLabel?: string
}

const EVENT_LABEL: Record<HarnessTimelineEvent['kind'], string> = {
  message: 'Message',
  injection: 'Injection',
  decision: 'Décision',
  'tool-call': 'Appel outil',
  'tool-result': 'Résultat outil',
  'model-response': 'Réponse modèle',
  'response-displayed': 'Réponse affichée',
  handoff: 'Relais',
  verdict: 'Verdict',
  gate: 'Gate',
  retry: 'Nouvel essai',
  cancellation: 'Annulation',
  error: 'Erreur',
  boundary: 'Frontière'
}

function durationLabel(durationMs: number | undefined): string {
  if (durationMs == null) return 'durée inconnue'
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(durationMs / 1000)} s`
}

function costLabel(costUsd: number | undefined): string {
  if (costUsd == null) return 'coût inconnu'
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 4 }).format(costUsd)} $`
}

function statusLabel(status: string | undefined): string {
  if (status === 'running') return 'en cours'
  if (status === 'failed') return 'échec'
  if (status === 'cancelled') return 'annulé'
  if (status === 'pending') return 'en attente'
  return 'terminé'
}

function skillLabel(event: HarnessTimelineEvent): string | undefined {
  if (event.display?.skillName) return `skill · ${event.display.skillName}`
  if (event.display?.workflow === 'autowin') return 'skill non tracée'
  if (event.display?.workflow === 'direct') return 'aucune skill'
  return undefined
}

function gitOutcomeLabel(outcome: string | undefined): string {
  if (outcome === 'merged') return 'Fusionnée'
  if (outcome === 'nothing') return 'Aucun changement'
  if (outcome === 'conflict') return 'Conflit'
  if (outcome === 'blocked') return 'Bloquée'
  if (outcome === 'kept') return 'Copie conservée'
  return 'Inconnu'
}

function closureStatusLabel(status: string | undefined): string {
  if (status === 'green') return 'Green'
  if (status === 'degraded-closed') return 'Dégradé clos'
  if (status === 'red') return 'Red'
  return 'Ouvert'
}

function workspaceModeLabel(mode: string | undefined): string {
  return mode === 'worktree' ? 'Copie isolée' : 'Dépôt de travail'
}

function ExecutionNodeMeta({ event }: { event: HarnessTimelineEvent }): React.JSX.Element {
  const display = event.display
  if (display?.kind === 'workspace') {
    return (
      <>
        <span>{workspaceModeLabel(display.workspace?.mode)}</span>
        <span aria-hidden="true">·</span>
        <span>{display.workspace?.path}</span>
      </>
    )
  }
  if (display?.kind === 'skill') {
    return (
      <>
        <span className="workflow-execution-skill">phase · {display.skillName}</span>
        <span aria-hidden="true">·</span>
        <span>alias observé</span>
      </>
    )
  }
  if (display?.kind === 'git') {
    return (
      <>
        <span>{gitOutcomeLabel(display.git?.outcome)}</span>
        {display.git?.commitSha && (
          <>
            <span aria-hidden="true">·</span>
            <span>{display.git.commitSha.slice(0, 8)}</span>
          </>
        )}
      </>
    )
  }
  if (display?.kind === 'closure') {
    return (
      <>
        <span>{closureStatusLabel(display.closure?.status)}</span>
        <span aria-hidden="true">·</span>
        <span>{durationLabel(display.closure?.totalDurationMs)}</span>
        <span aria-hidden="true">·</span>
        <span>{costLabel(display.closure?.totalCostUsd)}</span>
      </>
    )
  }
  if (display?.kind === 'request') {
    return <span className="workflow-execution-request-label">{event.label}</span>
  }
  if (display?.kind === 'phase') return <span>Phase Autowin</span>
  return (
    <>
      {skillLabel(event) && (
        <>
          <span className="workflow-execution-skill">{skillLabel(event)}</span>
          {event.display?.workflow === 'direct' && (
            <>
              <span aria-hidden="true">·</span>
              <span>chat direct</span>
            </>
          )}
          <span aria-hidden="true">·</span>
        </>
      )}
      <span className="workflow-execution-agent">{event.actor}</span>
      <span aria-hidden="true">·</span>
      <span>{durationLabel(event.durationMs)}</span>
    </>
  )
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function ExecutionNodeDetail({ event }: { event: HarnessTimelineEvent }): React.JSX.Element {
  const display = event.display
  if (display?.kind === 'workspace') {
    const workspace = display.workspace
    return (
      <dl>
        <DetailRow label="Chemin effectif" value={workspace?.path ?? 'Non exposé'} />
        <DetailRow label="Mode" value={workspaceModeLabel(workspace?.mode)} />
        <DetailRow label="Dépôt source" value={workspace?.repositoryPath ?? 'Non exposé'} />
        {workspace?.baseBranch && (
          <DetailRow label="Branche de base" value={workspace.baseBranch} />
        )}
        {workspace?.baseSha && <DetailRow label="Révision de base" value={workspace.baseSha} />}
      </dl>
    )
  }
  if (display?.kind === 'skill') {
    return (
      <dl>
        <DetailRow label="Phase observée" value={display.skillName ?? 'Non exposée'} />
        <DetailRow label="Identité" value="Alias de phase" />
        <DetailRow label="Run" value={display.runId ?? 'Non exposé'} />
      </dl>
    )
  }
  if (display?.kind === 'agent') {
    return (
      <dl>
        <DetailRow label="Agent" value={event.execution?.agentId ?? event.actor} />
        <DetailRow
          label="Attempt"
          value={display.attemptId ?? event.execution?.attemptId ?? 'Non exposé'}
        />
        <DetailRow label="Skill" value={display.skillName ?? 'Non exposée'} />
        <DetailRow label="Durée" value={durationLabel(event.durationMs)} />
        {event.provider && <DetailRow label="Provider" value={event.provider} />}
        {event.model && <DetailRow label="Modèle" value={event.model} />}
        {(display.dependencyIds?.length ?? 0) > 0 && (
          <DetailRow label="Dépend de" value={display.dependencyIds?.join(', ')} />
        )}
      </dl>
    )
  }
  if (display?.kind === 'git') {
    const git = display.git
    return (
      <dl>
        <DetailRow label="Sort Git" value={gitOutcomeLabel(git?.outcome)} />
        <DetailRow label="Révision" value={git?.commitSha ?? 'Aucun commit'} />
        <DetailRow label="Branche de base" value={git?.baseBranch ?? 'Non exposée'} />
        {git?.worktreePath && <DetailRow label="Worktree" value={git.worktreePath} />}
        {(git?.files?.length ?? 0) > 0 && (
          <DetailRow label="Fichiers" value={git?.files?.join(', ')} />
        )}
        {git?.reason && <DetailRow label="Cause" value={git.reason} />}
      </dl>
    )
  }
  if (display?.kind === 'closure') {
    const closure = display.closure
    return (
      <dl>
        <DetailRow label="État de clôture" value={closureStatusLabel(closure?.status)} />
        <DetailRow label="Temps total" value={durationLabel(closure?.totalDurationMs)} />
        <DetailRow label="Coût total" value={costLabel(closure?.totalCostUsd)} />
        {closure?.integrationOutcome && (
          <DetailRow label="Intégration" value={gitOutcomeLabel(closure.integrationOutcome)} />
        )}
        {(closure?.gateReasons?.length ?? 0) > 0 && (
          <DetailRow label="Raisons" value={closure?.gateReasons?.join(' · ')} />
        )}
      </dl>
    )
  }
  return (
    <dl>
      <DetailRow label="Acteur" value={event.actor} />
      <DetailRow label="Durée" value={durationLabel(event.durationMs)} />
      {skillLabel(event) && <DetailRow label="Skill" value={skillLabel(event)} />}
      {event.provider && <DetailRow label="Provider" value={event.provider} />}
      {event.model && <DetailRow label="Modèle" value={event.model} />}
      <DetailRow label="Observation" value={event.detail} />
    </dl>
  )
}

export function WorkflowExecutionGraph({
  conversationId,
  active = true,
  live = false,
  requestLabel
}: WorkflowExecutionGraphProps): React.JSX.Element {
  const [events, setEvents] = useState<HarnessTimelineEvent[]>([])
  const [turnId, setTurnId] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const requestGate = useRef(new LatestRequestGate())
  const previousLive = useRef(live)

  const load = useCallback(
    async (showLoading: boolean): Promise<void> => {
      if (!active || !conversationId) return
      const requestId = requestGate.current.begin()
      if (showLoading) {
        setEvents([])
        setTurnId(undefined)
        setSelectedId(null)
        setLoading(true)
        setError(null)
      }
      try {
        const trace = (await window.api.causalTrace(conversationId)) as HarnessTraceEvent[]
        if (!requestGate.current.isCurrent(requestId)) return
        const timeline = buildHarnessTimelineFromTrace(Array.isArray(trace) ? trace : [])
        const projection = projectLatestRequestExecution(timeline, { requestLabel })
        const nextEvents = projection.events
        setEvents(nextEvents)
        setTurnId(projection.turnId)
        setSelectedId((current) =>
          current && nextEvents.some((event) => event.id === current) ? current : null
        )
        setError(null)
      } catch (reason) {
        if (!requestGate.current.isCurrent(requestId)) return
        setEvents([])
        setTurnId(undefined)
        setSelectedId(null)
        setError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        if (requestGate.current.isCurrent(requestId)) setLoading(false)
      }
    },
    [active, conversationId, requestLabel]
  )

  useEffect(() => {
    if (!active || !conversationId) {
      requestGate.current.invalidate()
      return
    }
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) void load(true)
    })
    return () => {
      cancelled = true
      requestGate.current.invalidate()
    }
  }, [active, conversationId, load])

  useEffect(() => {
    if (!active || !live || !conversationId) return
    const timer = window.setInterval(() => void load(false), 1000)
    return () => window.clearInterval(timer)
  }, [active, conversationId, live, load])

  useEffect(() => {
    const wasLive = previousLive.current
    previousLive.current = live
    if (active && conversationId && wasLive && !live) void load(false)
  }, [active, conversationId, live, load])

  const graph = useMemo(() => buildCausalPath(events), [events])
  const nodes = useMemo(() => flattenCausalNodes(graph.roots), [graph.roots])
  const selected = selectedId ? graph.byId.get(selectedId) : undefined
  const runCount = new Set(
    nodes
      .map((node) => node.event.display?.runId)
      .filter((runId): runId is string => Boolean(runId))
  ).size

  if (!conversationId) {
    return (
      <div className="workflow-execution-empty">
        Sélectionne une conversation pour voir son graphe d’exécution.
      </div>
    )
  }

  return (
    <section
      className="workflow-execution-graph"
      data-conversation-id={conversationId}
      data-turn-id={turnId}
      aria-label="Arbre de traitement de la demande"
      aria-busy={loading}
    >
      <header className="workflow-execution-summary">
        <div>
          <strong>Traitement de la demande</strong>
          <span>
            {runCount > 0 && (
              <>
                {runCount} run{runCount > 1 ? 's' : ''}
                {' · '}
              </>
            )}
            {nodes.filter((node) => node.event.display?.kind === 'agent').length} agent
            {nodes.filter((node) => node.event.display?.kind === 'agent').length > 1 ? 's' : ''}
            {' · '}
            {Math.max(0, nodes.length - 1)} étape{nodes.length > 2 ? 's' : ''}
            {live ? ' · en direct' : ''}
          </span>
        </div>
        <button
          className="btn btn-sm btn-ghost"
          type="button"
          onClick={() => void load(nodes.length === 0)}
          title="Rafraîchir le graphe"
          aria-label="Rafraîchir le graphe d’exécution"
        >
          ↻
        </button>
      </header>

      {loading && nodes.length === 0 && (
        <div className="workflow-execution-loading" role="status">
          <span className="spinner" aria-hidden="true" />
          Chargement du graphe…
        </div>
      )}
      {!loading && error && (
        <div className="workflow-execution-error" role="alert">
          Graphe indisponible · {error}
        </div>
      )}
      {!loading && !error && nodes.length === 0 && (
        <div className="workflow-execution-empty">
          Aucune trace d’exécution pour la dernière demande.
        </div>
      )}

      {nodes.length > 0 && (
        <div className="workflow-execution-tree" role="tree" aria-label="Traitement de la demande">
          {nodes.map((node) => (
            <div
              className="workflow-execution-node-wrap"
              key={node.id}
              style={{ '--execution-depth': node.depth } as React.CSSProperties}
            >
              {node.depth > 0 && !node.issues.includes('missing-parent') && (
                <span className="workflow-execution-edge" data-execution-edge aria-hidden="true" />
              )}
              <button
                type="button"
                role="treeitem"
                aria-selected={selectedId === node.id}
                className={[
                  'workflow-execution-node',
                  `is-${node.event.display?.kind ?? 'event'}`,
                  `is-${node.event.status ?? 'completed'}`,
                  selectedId === node.id ? 'is-selected' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                data-execution-node={node.id}
                data-execution-kind={node.event.display?.kind ?? 'event'}
                data-execution-agent={node.event.execution?.agentId ?? node.event.actor}
                data-execution-provider={node.event.provider}
                data-execution-model={node.event.model}
                data-execution-skill={node.event.display?.skillName}
                data-execution-run={node.event.display?.runId}
                data-depth={node.depth}
                onClick={() => setSelectedId((current) => (current === node.id ? null : node.id))}
              >
                <span className="workflow-execution-dot" aria-hidden="true" />
                <span className="workflow-execution-node-copy">
                  <span className="workflow-execution-node-title">
                    <b>{node.event.display?.title ?? EVENT_LABEL[node.event.kind]}</b>
                    <em>{statusLabel(node.event.status)}</em>
                  </span>
                  <span className="workflow-execution-node-meta">
                    <ExecutionNodeMeta event={node.event} />
                  </span>
                </span>
              </button>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <aside className="workflow-execution-detail" aria-label="Détail de l’étape sélectionnée">
          <header>
            <strong>{selected.event.display?.title ?? EVENT_LABEL[selected.event.kind]}</strong>
            <span>{statusLabel(selected.event.status)}</span>
          </header>
          <ExecutionNodeDetail event={selected.event} />
          {selected.issues.length > 0 && (
            <p className="workflow-execution-warning">
              Trace partielle · {selected.issues.join(', ')}
            </p>
          )}
          {selected.event.display?.limitation && (
            <p className="workflow-execution-warning">{selected.event.display.limitation}</p>
          )}
        </aside>
      )}
    </section>
  )
}
