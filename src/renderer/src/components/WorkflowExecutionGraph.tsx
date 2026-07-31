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
                    {node.event.display?.kind === 'request' ? (
                      <span className="workflow-execution-request-label">{node.event.label}</span>
                    ) : node.event.display?.kind === 'phase' ? (
                      <span>Phase Autowin</span>
                    ) : (
                      <>
                        {skillLabel(node.event) && (
                          <>
                            <span className="workflow-execution-skill">
                              {skillLabel(node.event)}
                            </span>
                            {node.event.display?.workflow === 'direct' && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>chat direct</span>
                              </>
                            )}
                            <span aria-hidden="true">·</span>
                          </>
                        )}
                        <span className="workflow-execution-agent">{node.event.actor}</span>
                        <span aria-hidden="true">·</span>
                        <span>{durationLabel(node.event.durationMs)}</span>
                      </>
                    )}
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
          <dl>
            <div>
              <dt>{selected.event.display?.kind === 'agent' ? 'Agent' : 'Acteur'}</dt>
              <dd>{selected.event.actor}</dd>
            </div>
            <div>
              <dt>Durée</dt>
              <dd>{durationLabel(selected.event.durationMs)}</dd>
            </div>
            {skillLabel(selected.event) && (
              <div>
                <dt>Skill</dt>
                <dd>{skillLabel(selected.event)}</dd>
              </div>
            )}
            {selected.event.provider && (
              <div>
                <dt>Provider</dt>
                <dd>{selected.event.provider}</dd>
              </div>
            )}
            {selected.event.model && (
              <div>
                <dt>Modèle</dt>
                <dd>{selected.event.model}</dd>
              </div>
            )}
            {(selected.event.display?.dependencyIds?.length ?? 0) > 0 && (
              <div>
                <dt>Dépend de</dt>
                <dd>{selected.event.display?.dependencyIds?.join(', ')}</dd>
              </div>
            )}
            <div>
              <dt>Observation</dt>
              <dd>{selected.event.detail}</dd>
            </div>
          </dl>
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
