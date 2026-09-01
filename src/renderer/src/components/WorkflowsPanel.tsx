import { useState } from 'react'
import type { RunEntry, CheckpointEntry } from './ChatView'
import { STEP_META, phaseLabel, type OrchStep, type ScopedLiveRun } from './chat-view-model'
import { WorkflowRefreshIcon, WorkflowCloseIcon, RunTrashIcon } from './chat-view-icons'
import { StepThread } from './ChatView.parts'
import { RunProgress } from './RunProgress'
import { RunInspector } from './RunInspector'

/** Onglets du détail d'un RUN. `progress` = suivi vivant (avancée), `runmd` = fichier produit. */
export type RunDetailTab = 'progress' | 'trace' | 'runmd'
import { SourceControlPane } from './SourceControlPane'
import { WorkflowExecutionGraph, type ExecutionNodeSelection } from './WorkflowExecutionGraph'
import { ModelActivityLogPane } from './ModelActivityLogPane'
import type { Msg } from './chat-view-types'
// `.lisere-dessus` vit dans cette feuille (voir ViewPage.css) : import explicite, pas d'heritage
// implicite d'une autre vue.
import './ViewPage.css'
import { Spinner } from './Spinner'

const RUN_DOT: Record<string, string> = {
  green: 'st-ok',
  open: 'st-warn',
  red: 'st-err',
  'degraded-closed': 'st-violet'
}

const EFFORT_FR: Record<string, string> = {
  low: 'faible',
  medium: 'moyen',
  high: 'élevé',
  xhigh: 'très élevé',
  max: 'max',
  ultra: 'ultra'
}

/**
 * Nœuds qui parlent du DÉPÔT plutôt que d'un sous-agent : y descendre ouvre Source control, qui
 * était jusqu'ici un onglet à part qu'il fallait penser à aller chercher.
 */
function selectionParleDuDepot(selection: ExecutionNodeSelection | null): boolean {
  return (
    selection?.kind === 'git' || selection?.kind === 'closure' || selection?.kind === 'workspace'
  )
}

export type WorkflowsPanelProps = {
  runsPaneWidth: number
  beginRunsResize: (event: React.PointerEvent<HTMLDivElement>) => void
  refreshRuns: () => void
  setShowRuns: (value: boolean) => void
  activeId: string | null
  send: (prompt: string) => void
  isActive: boolean
  requestLabel: string | undefined
  liveGraphActive: boolean
  visibleLiveRuns: [string, ScopedLiveRun<OrchStep>][]
  checkpoints: CheckpointEntry[]
  forkedCheckpoint: string
  setForkedCheckpoint: (id: string) => void
  runs: RunEntry[]
  openRun: { path: string; content: string } | null
  viewRun: (r: RunEntry) => void
  setOpenRun: (value: { path: string; content: string } | null) => void
  setOpenTrace: (value: OrchStep[] | null) => void
  requestDeleteRun: (run: RunEntry) => void
  openTrace: OrchStep[] | null
  runDetailTab: RunDetailTab
  setRunDetailTab: (tab: RunDetailTab) => void
  liveRunCardRef: React.RefObject<HTMLDivElement | null>
  /** Messages du fil : source des LOGS (trace de ce que les modèles ont fait). */
  messages: readonly Msg[]
}

/**
 * PANNEAU DROIT : UN SEUL OBJET, L'EXÉCUTION.
 *
 * Il portait quatre onglets — Sous-agents, Run, Graphe, Source control — c'est-à-dire quatre
 * projections de la MÊME exécution qu'il fallait corréler de tête, en sachant d'avance où
 * regarder. Le graphe les remplace : il EST la navigation, et ce qu'on ouvre dessous DÉCOULE du
 * nœud sur lequel on descend. Aucune des quatre vues n'est perdue — elles cessent d'être des
 * destinations pour devenir le détail d'une étape.
 */
export function WorkflowsPanel(props: WorkflowsPanelProps): React.JSX.Element {
  const {
    runsPaneWidth,
    beginRunsResize,
    refreshRuns,
    setShowRuns,
    activeId,
    send,
    isActive,
    requestLabel,
    liveGraphActive,
    visibleLiveRuns,
    checkpoints,
    forkedCheckpoint,
    setForkedCheckpoint,
    runs,
    openRun,
    viewRun,
    setOpenRun,
    setOpenTrace,
    requestDeleteRun,
    openTrace,
    runDetailTab,
    setRunDetailTab,
    liveRunCardRef,
    messages
  } = props

  const [selection, setSelection] = useState<ExecutionNodeSelection | null>(null)

  const depot = selectionParleDuDepot(selection)
  // Appariement par TOUR : c'est le seul lien RÉEL entre le graphe et le fil relu
  // (`scopedRunsFromTimeline` pose `runPath = turn.id`). On n'invente aucune correspondance par
  // `runId` : le `run-<n>` du graphe est éphémère et ne désigne aucun RUN.md sur disque.
  const filsDuTour =
    selection && !depot && selection.turnId
      ? visibleLiveRuns.filter(([, run]) => !run.runPath || run.runPath === selection.turnId)
      : []
  // SANS sélection, l'accueil montre TOUS les fils, puis les RUN.md : c'était la section par
  // défaut du panneau, et une orchestration en cours doit rester visible dès l'ouverture — la
  // cacher derrière un clic dans le graphe serait une perte, pas une simplification.
  const fils = depot
    ? []
    : selection
      ? filsDuTour.length > 0
        ? filsDuTour
        : visibleLiveRuns
      : visibleLiveRuns
  const filsHorsTour = Boolean(selection) && fils.length > 0 && filsDuTour.length === 0
  // « accueil » et non « runs » : sans sélection, le panneau montre les fils vivants PUIS les
  // RUN.md. Nommer cet état d'après sa seule seconde moitié le décrivait faux.
  const detailAffiche = depot ? 'source-control' : selection ? 'subagents' : 'accueil'

  return (
    <>
      <div
        className="runs-pane-resizer"
        role="separator"
        aria-label="Redimensionner la colonne Workflows"
        aria-orientation="vertical"
        onPointerDown={beginRunsResize}
      />
      <aside className="lisere-dessus runs-pane fade-in" style={{ width: `${runsPaneWidth}px` }}>
        <div className="workflow-panel-head">
          <strong className="workflow-panel-title">Exécution</strong>
          <div className="workflow-panel-actions">
            <button
              className="workflow-panel-action workflow-panel-refresh"
              onClick={refreshRuns}
              title="Rafraîchir"
              aria-label="Rafraîchir les runs"
            >
              <WorkflowRefreshIcon />
            </button>
            <button
              className="workflow-panel-action workflow-panel-close"
              onClick={() => setShowRuns(false)}
              title="Fermer Workflows"
              aria-label="Fermer Workflows"
            >
              <WorkflowCloseIcon />
            </button>
          </div>
        </div>
        {/* LA NAVIGATION. Plus un onglet parmi quatre : le point d'entrée unique du panneau. */}
        <WorkflowExecutionGraph
          conversationId={activeId ?? undefined}
          active={isActive}
          requestLabel={requestLabel}
          live={liveGraphActive}
          onSelect={setSelection}
        />
        {/* LOGS : la trace geste par geste de ce que les modèles ont fait. Section née APRÈS ce
            panneau ; elle n'est PAS une projection de l'exécution orchestrée, donc aucun nœud du
            graphe ne la porte. Elle reste donc atteignable ici, repliée par défaut. */}
        <details className="workflow-logs-fold">
          <summary>Logs</summary>
          <ModelActivityLogPane conversationId={activeId} messages={messages} live={liveGraphActive} />
        </details>
        {/* Pas de sélecteur de portée : ce panneau ne montre QUE la conversation courante.
            Le cadrage « tous » y affichait des compteurs globaux sous une conversation qui n'en
            porte que deux — on ne s'y retrouvait plus. Le global relève de l'Observatory. */}
        <div
          className="scroll-y col grow workflow-panel-detail"
          data-workflow-detail={detailAffiche}
          style={{ gap: 'var(--s2)', minHeight: 0 }}
        >
          {depot && (
            <SourceControlPane conversationId={activeId ?? undefined} onSendPrompt={send} />
          )}

          {/* SECTION SOUS-AGENTS : le fil d'une orchestration, en cours ou TERMINÉE. */}
          {selection && !depot && fils.length === 0 && (
            <div className="c-faint" style={{ fontSize: 12, padding: 'var(--s2)' }}>
              {activeId
                ? 'Aucun fil de sous-agents pour cette étape — son détail reste lisible dans le graphe ci-dessus.'
                : 'Sélectionne une conversation pour voir le fil de ses sous-agents.'}
            </div>
          )}
          {filsHorsTour && (
            <div className="c-faint" style={{ fontSize: 11, padding: '0 var(--s2)' }}>
              Aucun fil rattaché à ce tour précis — voici tous les fils de la conversation.
            </div>
          )}
          {fils.map(([runKey, liveRun]) => (
            <div
              key={runKey}
              ref={liveRun.convId === activeId ? liveRunCardRef : undefined}
              className={`card live-run stripe stripe-accent fade-in`}
              data-live-run-conversation-id={liveRun.convId}
            >
              <details className="live-run-fold" open={liveRun.status === 'running'}>
                <summary
                  className="row"
                  style={{ justifyContent: 'space-between', cursor: 'pointer' }}
                  title="Replier / déplier ce sous-agent"
                >
                  <span className="row gap2" style={{ minWidth: 0 }}>
                    {liveRun.status === 'running' ? (
                      <Spinner />
                    ) : (
                      <span
                        className={`status-dot ${liveRun.status === 'green' ? 'st-ok' : 'st-err'}`}
                      />
                    )}
                    <span className="run-subject live-subject" title={liveRun.task}>
                      {liveRun.task}
                    </span>
                  </span>
                </summary>
                <div style={{ marginTop: 'var(--s2)' }}>
                  <StepThread steps={liveRun.steps} />
                  {liveRun.status === 'running' &&
                    (() => {
                      const phase = liveRun.phase
                      const meta = phase ? STEP_META[phase.step] : undefined
                      const label = phase ? phaseLabel(phase) : 'sous-agent'
                      // Modèle réel (ex "cc/claude-opus-4-8" → "claude-opus-4-8") + effort en clair.
                      const shortModel = phase?.model?.split('/').pop()
                      const eff =
                        phase?.reasoningEffort &&
                        phase.reasoningEffort !== 'none' &&
                        phase.reasoningEffort !== 'auto'
                          ? (EFFORT_FR[phase.reasoningEffort] ?? phase.reasoningEffort)
                          : undefined
                      const detail = shortModel
                        ? `${shortModel}${eff ? ` · ${eff}` : ''}`
                        : phase?.provider
                      return (
                        <div className="subagent-step live-subagent-step">
                          <div
                            className="row gap2"
                            style={{ justifyContent: 'space-between', fontSize: 11 }}
                          >
                            <span className="c-faint">
                              <Spinner /> {meta?.icon ?? ''} {label}
                              {detail && <span className="mono c-accent"> {detail}</span>}
                            </span>
                            <span className="row gap2">
                              <span className="badge">en cours</span>
                              <button
                                className="btn btn-sm btn-danger"
                                title="Stopper le sous-agent en cours"
                                onClick={(event) => {
                                  // Sans ce retour, un échec d'annulation laissait le run affiché
                                  // « en cours » sans explication : l'utilisateur croit avoir stoppé
                                  // le sous-agent alors qu'il tourne toujours. Le composant est
                                  // sans état → on reporte l'échec sur le bouton lui-même (libellé
                                  // + title), visible et sans introduire de store local.
                                  const button = event.currentTarget
                                  void window.api
                                    .cancelOrchestration(liveRun.convId)
                                    .catch((error: unknown) => {
                                      button.textContent = '⚠ Stop échoué'
                                      button.title = `Annulation impossible : ${error instanceof Error ? error.message : String(error)}`
                                    })
                                }}
                              >
                                ⏹ Stop
                              </button>
                            </span>
                          </div>
                          {/*
                            Activité courante, AVANT le texte : quand un outil tourne quinze
                            minutes, c'est la seule chose qui distingue « travaille » de « mort ».
                            Le texte du livrable, lui, peut rester vide tout ce temps.
                          */}
                          {liveRun.note && (
                            <div
                              className="subagent-live-note"
                              title="Activité en cours du sous-agent"
                            >
                              {liveRun.note}
                            </div>
                          )}
                          {liveRun.liveText && (
                            <pre className="subagent-live-text">{liveRun.liveText}</pre>
                          )}
                        </div>
                      )
                    })()}
                </div>
              </details>
            </div>
          ))}
          {/* SECTION RUN : les RUN.md eux-mêmes (statut, DoD, journal, défauts). */}
          {!selection && checkpoints.length > 0 && (
            <section className="card checkpoint-forks">
              <strong>Checkpoints persistants</strong>
              {checkpoints.map((checkpoint) => (
                <button
                  key={checkpoint.id}
                  className="btn btn-sm"
                  onClick={() => {
                    const forkId = `fork-${Date.now()}`
                    void window.api
                      .createCheckpointFork(checkpoint.id, forkId)
                      .then(() => setForkedCheckpoint(forkId))
                  }}
                >
                  Forker {checkpoint.runId}
                </button>
              ))}
              {forkedCheckpoint && <small>Fork immuable préparé : {forkedCheckpoint}</small>}
            </section>
          )}
          {!selection && runs.length === 0 && (
            <div className="c-faint" style={{ fontSize: 12, padding: 'var(--s2)' }}>
              {activeId
                ? 'Aucun RUN.md pour cette conversation — lance une tâche (orchestration) ou attache un RUN.md.'
                : 'Sélectionne ou démarre une conversation pour voir ses RUN.md.'}
            </div>
          )}
          {!selection &&
            runs.map((r) => {
              const pct =
                r.summary.dodTotal > 0
                  ? Math.round((r.summary.dodChecked / r.summary.dodTotal) * 100)
                  : 0
              const isOpen = openRun?.path === r.path
              return (
                <div key={r.path} className="col" style={{ gap: 0 }}>
                  <div className="run-card-shell">
                    <button
                      className="card run-row"
                      onClick={() => {
                        if (isOpen) {
                          setOpenRun(null)
                          setOpenTrace(null)
                        } else {
                          viewRun(r)
                        }
                      }}
                    >
                      <div className="row" style={{ justifyContent: 'space-between' }}>
                        <div className="row gap2" style={{ minWidth: 0 }}>
                          <span className={`status-dot ${RUN_DOT[r.summary.status] ?? ''}`} />
                          <span className="run-subject">{r.subject}</span>
                        </div>
                        <span className="badge">{r.summary.status}</span>
                      </div>
                      <div className="row" style={{ marginTop: 6, gap: 'var(--s2)' }}>
                        <div className="meter grow">
                          <span
                            style={{
                              width: `${pct}%`,
                              background:
                                r.summary.status === 'green' ? 'var(--ok)' : 'var(--accent)'
                            }}
                          />
                        </div>
                        <span className="c-faint tnum" style={{ fontSize: 10 }}>
                          {r.summary.dodChecked}/{r.summary.dodTotal}
                        </span>
                        <span className="c-faint tnum" style={{ fontSize: 10 }}>
                          J {r.summary.journalEvents} · D {r.summary.defauts}
                        </span>
                      </div>
                    </button>
                    {activeId && (
                      <button
                        type="button"
                        className="run-delete-button"
                        aria-label={`Supprimer le run ${r.subject}`}
                        title={r.session === 'attaché' ? 'Détacher ce RUN' : 'Supprimer ce RUN'}
                        onClick={() => requestDeleteRun(r)}
                      >
                        <RunTrashIcon />
                      </button>
                    )}
                  </div>
                  {isOpen && (
                    <div className="run-detail-box fade-in">
                      {openTrace && (
                        <div className="run-detail-tabs">
                          <button
                            type="button"
                            className={`run-detail-tab${runDetailTab === 'progress' ? ' is-active' : ''}`}
                            onClick={() => setRunDetailTab('progress')}
                          >
                            Avancée
                          </button>
                          <button
                            type="button"
                            className={`run-detail-tab${runDetailTab === 'trace' ? ' is-active' : ''}`}
                            onClick={() => setRunDetailTab('trace')}
                          >
                            Fil des sous-agents
                          </button>
                          {openRun && (
                            <button
                              type="button"
                              className={`run-detail-tab${runDetailTab === 'runmd' ? ' is-active' : ''}`}
                              onClick={() => setRunDetailTab('runmd')}
                            >
                              RUN.md
                            </button>
                          )}
                        </div>
                      )}
                      {openTrace &&
                      (runDetailTab === 'progress' || (!openRun && runDetailTab === 'runmd')) ? (
                        <RunProgress
                          steps={openTrace}
                          activePhase={
                            visibleLiveRuns.find(
                              ([, lr]) => lr.status === 'running' && lr.runPath === openRun?.path
                            )?.[1].phase
                          }
                        />
                      ) : openTrace && runDetailTab === 'trace' ? (
                        <StepThread steps={openTrace} />
                      ) : (
                        openRun && <RunInspector content={openRun.content} summary={r.summary} />
                      )}
                    </div>
                  )}
                </div>
              )
            })}
        </div>
      </aside>
    </>
  )
}
