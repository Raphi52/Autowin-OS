import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildCausalPath, flattenCausalNodes } from './causal-path-model'
import { settleStrandedExecutionStatus, statusLabel } from './execution-interrupted-status'
import {
  buildHarnessTimelineFromTrace,
  type HarnessTimelineEvent,
  type HarnessTraceEvent
} from './harness-timeline-model'
import { LatestRequestGate } from './observatory-reliability'
import {
  projectLatestRequestExecution,
  type RequestTurnOption
} from './request-execution-tree-model'
import { workflowQuoteLabel } from './workflow-quote-label'
import './WorkflowExecutionGraph.css'
import { Spinner } from './Spinner'

/**
 * Ce que le graphe PUBLIE quand on descend sur un nœud. Il ne décide de rien : il dit sur quoi
 * l'utilisateur est descendu, à charge du panneau d'en tirer la vue adaptée. Sans cela, la
 * sélection reste enfermée dans le composant et le graphe ne peut pas remplacer les onglets.
 */
export interface ExecutionNodeSelection {
  id: string
  kind: string
  runId?: string
  skillName?: string
  turnId?: string
}

interface WorkflowExecutionGraphProps {
  conversationId?: string
  active?: boolean
  live?: boolean
  requestLabel?: string
  onSelect?: (selection: ExecutionNodeSelection | null) => void
}

const EVENT_LABEL: Record<HarnessTimelineEvent['kind'], string> = {
  message: 'Message',
  injection: 'Injection',
  decision: 'Décision',
  'tool-call': 'Appel outil',
  'tool-result': 'Résultat outil',
  artifact: 'Artefact produit',
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
  if (display?.kind === 'quote') {
    return (
      <>
        {/*
          En TÊTE, avant le régime : les plafonds annoncés découlent du workflow retenu, donc c'est
          lui qu'on lit d'abord. « Aucun workflow » est écrit plutôt que la ligne masquée — une ligne
          absente se lit comme une information manquante, pas comme une absence voulue.
        */}
        <span className="workflow-execution-quote-workflow">
          {workflowQuoteLabel(display.quote?.workflow)}
        </span>
        <span aria-hidden="true">·</span>
        <span>{display.quote?.regime ?? 'regime inconnu'}</span>
        <span aria-hidden="true">·</span>
        <span>{display.quote?.limits.maxProviderCalls ?? 0} appels max</span>
        <span aria-hidden="true">·</span>
        <span>{display.quote?.limits.maxAgents ?? 0} agents max</span>
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
    const unknown = display.closure?.usage?.unpricedCalls ?? 0
    return (
      <>
        <span>{closureStatusLabel(display.closure?.status)}</span>
        <span aria-hidden="true">·</span>
        <span>{durationLabel(display.closure?.totalDurationMs)}</span>
        <span aria-hidden="true">·</span>
        <span>
          {costLabel(display.closure?.totalCostUsd)}
          {unknown > 0 ? ` + ${unknown} non chiffre(s)` : ''}
        </span>
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

/**
 * LA PENSÉE DU SOUS-AGENT — dernier échelon de la descente.
 *
 * `stepPayloads` écrit la délibération dans une charge `reasoning`, distincte de la conclusion.
 * Elle arrivait jusqu'ici sans qu'aucun chemin de rendu ne la lise. Le pli reste FERMÉ : une
 * délibération est longue, et le détail doit rester lisible d'un coup d'œil.
 */
function ExecutionNodeReasoning({
  event
}: {
  event: HarnessTimelineEvent
}): React.JSX.Element | null {
  const reasoning = (event.payloads ?? [])
    .filter((payload) => payload.kind === 'reasoning')
    .map((payload) => payload.content)
    .filter((content) => Boolean(content))
  if (reasoning.length === 0) return null
  return (
    <details className="workflow-execution-reasoning" data-execution-reasoning>
      <summary>Raisonnement du sous-agent</summary>
      {reasoning.map((content, index) => (
        <pre key={index}>{content}</pre>
      ))}
    </details>
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
  if (display?.kind === 'quote') {
    const quote = display.quote
    return (
      <dl>
        <DetailRow label="Regime" value={quote?.regime ?? 'Non expose'} />
        <DetailRow label="Phases" value={quote?.phases.join(' · ') || 'Aucune'} />
        <DetailRow
          label="Decomposition"
          value={
            quote?.decomposition.mode === 'build-only'
              ? `build uniquement · ${quote.decomposition.maxNodes} noeuds max`
              : 'desactivee'
          }
        />
        <DetailRow label="Appels max" value={quote?.limits.maxProviderCalls ?? 'Non expose'} />
        <DetailRow
          label="Budget tokens d'admission"
          value={quote?.limits.maxTotalTokens ?? 'Non expose'}
        />
        <DetailRow
          label="Mesure tokens"
          value="Usage final du provider; le prochain appel est refuse au plafond"
        />
        <DetailRow label="Agents max" value={quote?.limits.maxAgents ?? 'Non expose'} />
        <DetailRow label="Concurrence max" value={quote?.limits.maxConcurrency ?? 'Non expose'} />
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
        {closure?.usage && (
          <>
            <DetailRow label="Agents admis" value={closure.usage.startedAgents ?? 'Non expose'} />
            <DetailRow label="Appels fournisseur" value={closure.usage.startedCalls} />
            <DetailRow label="Appels actifs" value={closure.usage.activeCalls} />
            <DetailRow label="Tokens totaux" value={closure.usage.totalTokens} />
            <DetailRow label="Tokens frais" value={closure.usage.freshTokens} />
            <DetailRow
              label="Couverture"
              value={
                closure.usage.unpricedCalls > 0
                  ? `${closure.usage.unpricedCalls} appel(s) sans prix`
                  : closure.usage.tokenCoverage === 'complete'
                    ? 'Complète'
                    : 'Partielle'
              }
            />
          </>
        )}
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
  requestLabel,
  onSelect
}: WorkflowExecutionGraphProps): React.JSX.Element {
  const [events, setEvents] = useState<HarnessTimelineEvent[]>([])
  const [turnId, setTurnId] = useState<string | undefined>()
  const [turns, setTurns] = useState<RequestTurnOption[]>([])
  // Tour DEMANDÉ par l'utilisateur. Distinct de `turnId` (le tour effectivement projeté) : sans
  // cette distinction, un rechargement en direct écraserait le choix à chaque seconde. Le choix est
  // RATTACHÉ à sa conversation plutôt que remis à zéro par un effet : changer de conversation le
  // périme alors de lui-même, sans rendu supplémentaire ni cascade.
  const [picked, setPicked] = useState<{ convId?: string; turnId: string } | null>(null)
  const pickedTurnId = picked && picked.convId === conversationId ? picked.turnId : undefined
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
        const projection = projectLatestRequestExecution(timeline, {
          requestLabel,
          ...(pickedTurnId ? { turnId: pickedTurnId } : {})
        })
        const nextEvents = projection.events
        setEvents(nextEvents)
        setTurnId(projection.turnId)
        setTurns(projection.turns ?? [])
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
    [active, conversationId, requestLabel, pickedTurnId]
  )

  useEffect(() => {
    const gate = requestGate.current
    if (!active || !conversationId) {
      gate.invalidate()
      return
    }
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) void load(true)
    })
    return () => {
      cancelled = true
      gate.invalidate()
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

  useEffect(() => {
    if (!active || !conversationId || !window.api.onAppEvent) return
    return window.api.onAppEvent((event) => {
      if (
        (event.type === 'orchestrate-usage' || event.type === 'causal-trace-updated') &&
        event.convId === conversationId
      )
        void load(false)
    })
  }, [active, conversationId, load])

  // RECONCILIATION AVANT construction : `persistOrchestrationPhaseStart` ecrit `running` au
  // DEMARRAGE d'une phase et compte sur l'evenement terminal pour dire la suite. L'app tuee en
  // pleine phase, ce terminal n'arrive jamais — le `running` reste sur disque et le graphe le
  // relisait indefiniment comme une etape active (« je vois encore des choses en cours », conv-1056).
  // Le composant CONNAISSAIT deja la reponse via `live` ; elle n'etait simplement pas consultee.
  // Rien n'est reecrit sur disque : la trace reste un fait historique, on corrige ce qu'on AFFICHE.
  const settledEvents = useMemo(
    () => settleStrandedExecutionStatus(events, { live }),
    [events, live]
  )
  const graph = useMemo(() => buildCausalPath(settledEvents), [settledEvents])
  const nodes = useMemo(() => flattenCausalNodes(graph.roots), [graph.roots])
  const selected = selectedId ? graph.byId.get(selectedId) : undefined

  // La publication passe par un effet plutôt que par le gestionnaire de clic : la sélection change
  // aussi quand un rechargement fait disparaître le nœud choisi, et le panneau doit le savoir.
  const selectionRef = useRef<string | null>(null)
  const onSelectRef = useRef(onSelect)
  // Assignation dans un effet, jamais pendant le rendu : écrire une ref au rendu casse la garantie
  // de pureté de React (et le lint le refuse). Déclaré AVANT l’effet de publication pour que la
  // fonction à jour soit déjà en place quand celui-ci s’exécute.
  useEffect(() => {
    onSelectRef.current = onSelect
  })
  useEffect(() => {
    const event = selected?.event
    const key = event ? event.id : null
    if (selectionRef.current === key) return
    selectionRef.current = key
    onSelectRef.current?.(
      event
        ? {
            id: event.id,
            kind: event.display?.kind ?? 'event',
            ...(event.display?.runId ? { runId: event.display.runId } : {}),
            ...(event.display?.skillName ? { skillName: event.display.skillName } : {}),
            ...(turnId ? { turnId } : {})
          }
        : null
    )
  }, [selected, turnId])

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
        {/*
          SÉLECTEUR DE TOUR. Le graphe ne projetait que le dernier : tout l'historique de la
          conversation existait dans la trace et restait inatteignable. Masqué sous deux tours —
          une commande sans alternative est du bruit.
        */}
        {turns.length > 1 && (
          <select
            className="workflow-execution-turn-select"
            data-execution-turn-select
            aria-label="Demande affichée dans le graphe"
            value={turnId ?? turns[0].id}
            onChange={(changed) =>
              setPicked({
                ...(conversationId ? { convId: conversationId } : {}),
                turnId: changed.target.value
              })
            }
          >
            {turns.map((turn) => (
              <option key={turn.id} value={turn.id}>
                {turn.label}
              </option>
            ))}
          </select>
        )}
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
          <Spinner />
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
          {/* « la dernière demande » mentait dès qu'un tour ANTÉRIEUR était sélectionné. */}
          {pickedTurnId
            ? 'Aucune trace d’exécution pour la demande sélectionnée.'
            : 'Aucune trace d’exécution pour la dernière demande.'}
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
          <ExecutionNodeReasoning event={selected.event} />
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
