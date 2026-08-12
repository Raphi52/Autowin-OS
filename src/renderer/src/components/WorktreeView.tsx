import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GitGraphCommit, GitGraphSnapshot } from '../../../shared/git-graph'
import type { GitDiffResult } from '../../../shared/git-read'
import type {
  WorktreeAgentActivity,
  WorktreeRuntimeStatus
} from '../../../shared/worktree-activity-model'
import { ModuleHeader } from './ModuleHeader'
import { layoutGitGraph } from './GitGraphLayout'
import { WorktreeActivitySummary, WorktreeActivityView } from './WorktreeActivityView'
import { DiffView } from './DiffView'
import { RunInspector } from './RunInspector'
import './WorktreeView.css'

type DetailTab = 'work' | 'files' | 'run' | 'git'
type RunEntry = Awaited<ReturnType<typeof window.api.listRuns>>[number]
type DataState = 'healthy' | 'unknown' | 'unavailable' | 'stale'

const staleAfterMs = 30 * 60 * 1000

function projectState(
  snapshot: GitGraphSnapshot | undefined,
  agents: WorktreeAgentActivity[],
  activityAvailable: boolean
): { state: DataState; label: string; alertCount: number } {
  if (snapshot?.available === false)
    return { state: 'unavailable', label: 'Indisponible', alertCount: 1 }
  if (!snapshot || !activityAvailable) return { state: 'unknown', label: 'Inconnu', alertCount: 0 }
  if (agents.some((agent) => !agent.verdict || agent.verdict === 'unknown'))
    return { state: 'unknown', label: 'Inconnu', alertCount: 0 }
  const now = Date.now()
  const stale = agents.some((agent) => now - (agent.endedAtMs ?? agent.startedAtMs) > staleAfterMs)
  const alerts = agents.filter(
    (agent) => agent.state === 'conflict' || agent.state === 'blocked'
  ).length
  if (stale) return { state: 'stale', label: 'Obsolète', alertCount: alerts }
  return { state: 'healthy', label: alerts ? 'Attention' : 'Sain', alertCount: alerts }
}

function GitTopology({ commits }: { commits: GitGraphCommit[] }): React.JSX.Element {
  const layout = useMemo(() => layoutGitGraph(commits), [commits])
  return (
    <div className="cockpit-detail__graph" data-testid="git-topology">
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        width={layout.width}
        height={layout.height}
      >
        {layout.edges.map((edge) => (
          <path
            key={`${edge.from.commit.hash}-${edge.to.commit.hash}`}
            d={`M ${edge.from.x} ${edge.from.y} L ${edge.to.x} ${edge.to.y}`}
            fill="none"
            stroke="var(--cyan)"
          />
        ))}
        {layout.nodes.map((node) => (
          <g key={node.commit.hash}>
            <circle
              cx={node.x}
              cy={node.y}
              r="5"
              fill="var(--surface-inset)"
              stroke="var(--gold)"
            />
            <text x={node.x + 14} y={node.y + 4}>
              {node.commit.shortHash} · {node.commit.subject}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

export function WorktreeView({ active }: { active: boolean }): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<GitGraphSnapshot>()
  const [agents, setAgents] = useState<WorktreeAgentActivity[]>([])
  const [status, setStatus] = useState<WorktreeRuntimeStatus>()
  const [loading, setLoading] = useState(false)
  const [activityAvailable, setActivityAvailable] = useState(true)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailTab, setDetailTab] = useState<DetailTab>('work')
  const [openFile, setOpenFile] = useState<string>()
  const [diff, setDiff] = useState<GitDiffResult | null>(null)
  const [openRun, setOpenRun] = useState<{ entry: RunEntry; content: string }>()
  const [detailError, setDetailError] = useState<string>()
  const [repoPath, setRepoPath] = useState(() => localStorage.getItem('autowin:sc-repo') ?? '')
  const requestId = useRef(0)
  const detailRequestId = useRef(0)

  const load = useCallback(async (): Promise<void> => {
    const id = ++requestId.current
    setLoading(true)
    const gitPromise = window.api?.getGitGraph?.(repoPath || undefined)
    if (!gitPromise) {
      setSnapshot({ available: false, repoPath, error: 'Bridge Git indisponible' })
      setLoading(false)
      return
    }
    const [gitResult, activityResult, statusResult] = await Promise.allSettled([
      gitPromise,
      window.api.getWorktreeActivity?.() ?? Promise.reject(new Error('Activité indisponible')),
      window.api.getWorktreeStatus?.() ?? Promise.reject(new Error('Statut indisponible'))
    ])
    if (id !== requestId.current) return
    setSnapshot(
      gitResult.status === 'fulfilled'
        ? gitResult.value
        : { available: false, repoPath, error: String(gitResult.reason) }
    )
    setActivityAvailable(activityResult.status === 'fulfilled')
    setAgents(activityResult.status === 'fulfilled' ? activityResult.value : [])
    setStatus(statusResult.status === 'fulfilled' ? statusResult.value : undefined)
    setLoading(false)
  }, [repoPath])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (active) void load()
    return () => {
      requestId.current += 1
    }
  }, [active, load])

  const health = projectState(snapshot, agents, activityAvailable)
  const activeAgents = agents.filter(
    (agent) => agent.state === 'working' || agent.state === 'isolated'
  )
  const priorities = agents.filter(
    (agent) => agent.state === 'conflict' || agent.state === 'blocked'
  )
  const recent = [...agents].sort(
    (a, b) => (b.endedAtMs ?? b.startedAtMs) - (a.endedAtMs ?? a.startedAtMs)
  )

  const pickRepo = async (): Promise<void> => {
    const chosen = await window.api.pickGitRepo?.()
    if (!chosen) return
    localStorage.setItem('autowin:sc-repo', chosen)
    setRepoPath(chosen)
  }

  const openDiff = (agent: WorktreeAgentActivity, path: string): void => {
    const id = ++detailRequestId.current
    setOpenFile(path)
    setDiff(null)
    setDetailError(undefined)
    void window.api.getGitDiff(path, agent.worktreePath || repoPath || undefined).then(
      (value) => {
        if (detailRequestId.current === id) setDiff(value)
      },
      (error) => {
        if (detailRequestId.current === id) setDetailError(String(error))
      }
    )
  }

  const openRunDetail = (): void => {
    setDetailTab('run')
    if (openRun || detailError) return
    const id = ++detailRequestId.current
    void window.api
      .listRuns()
      .then(async (runs) => {
        const entry = runs[0]
        if (!entry) throw new Error('Aucun RUN disponible')
        const file = await window.api.readNodeFile(entry.path)
        if (detailRequestId.current === id) setOpenRun({ entry, content: file.content })
      })
      .catch((error) => {
        if (detailRequestId.current === id)
          setDetailError(error instanceof Error ? error.message : String(error))
      })
  }

  return (
    <section className="worktree-tab cockpit" data-active={active}>
      <header className="cockpit-header">
        <div>
          <ModuleHeader eyebrow="Cockpit projet" title={snapshot?.repositoryName ?? 'Worktrees'} />
          <span className="cockpit-path">{snapshot?.repoPath || repoPath || 'Dépôt courant'}</span>
        </div>
        <div className="cockpit-actions">
          <button type="button" onClick={() => void pickRepo()}>
            Choisir
          </button>
          <button type="button" onClick={() => void load()} disabled={loading}>
            {loading ? 'Actualisation…' : 'Actualiser'}
          </button>
        </div>
      </header>

      {loading && !snapshot ? (
        <div className="cockpit-state" role="status">
          Chargement du cockpit projet…
        </div>
      ) : (
        <div className="cockpit-scroll">
          <section className={`project-strip is-${health.state}`} aria-label="Santé du projet">
            <div>
              <span>Santé du projet</span>
              <strong>{health.label}</strong>
            </div>
            <div>
              <span>Branche</span>
              <strong>{snapshot?.branch ?? 'Inconnue'}</strong>
            </div>
            <div>
              <span>Changements locaux</span>
              <strong>
                {snapshot?.available === false ? 'Indisponibles' : (snapshot?.changeCount ?? 0)}
              </strong>
            </div>
            <div>
              <span>Travaux actifs</span>
              <strong>{activityAvailable ? activeAgents.length : 'Inconnus'}</strong>
            </div>
            <div>
              <span>Alertes</span>
              <strong>{health.alertCount}</strong>
            </div>
          </section>

          {snapshot?.available === false && (
            <div className="cockpit-notice is-error" role="alert">
              <strong>Git indisponible</strong>
              <span>{snapshot.error ?? 'Le dépôt ne peut pas être lu.'}</span>
            </div>
          )}
          {!activityAvailable && (
            <div className="cockpit-notice" role="status">
              <strong>Données partielles</strong>
              <span>L’activité des worktrees est indisponible.</span>
            </div>
          )}

          <section className="cockpit-section cockpit-now" data-testid="worktree-priorities">
            <header>
              <div>
                <span>Priorités</span>
                <h2>À faire maintenant</h2>
              </div>
              <b>{priorities.length}</b>
            </header>
            {priorities.length ? (
              priorities.map((agent) => (
                <button
                  key={agent.agentId}
                  type="button"
                  onClick={() => {
                    setDetailTab('work')
                    setDetailOpen(true)
                  }}
                >
                  <strong>
                    {agent.state === 'conflict' ? 'Conflit à trancher' : 'Travail bloqué'}
                  </strong>
                  <span>
                    {agent.task ?? agent.agentName}
                    {agent.conflictFile ? ` · ${agent.conflictFile}` : ''}
                  </span>
                </button>
              ))
            ) : (
              <p>Aucun blocage ni décision prioritaire.</p>
            )}
          </section>

          <section className="cockpit-section" data-testid="worktree-current-work">
            <header>
              <div>
                <span>Vue d’ensemble</span>
                <h2>Travaux en cours</h2>
              </div>
            </header>
            {activeAgents.length ? (
              <div className="cockpit-work-list">
                {activeAgents.map((agent) => (
                  <WorktreeActivitySummary
                    key={agent.agentId}
                    agent={agent}
                    onOpen={() => {
                      setDetailTab('work')
                      setDetailOpen(true)
                    }}
                  />
                ))}
                <div className="cockpit-touched-files" aria-label="Fichiers touchés">
                  {activeAgents
                    .flatMap((agent) => agent.files)
                    .map((file) => (
                      <span key={`${file.kind}:${file.path}`}>{file.path}</span>
                    ))}
                </div>
              </div>
            ) : (
              <div className="cockpit-empty">
                <strong>{activityAvailable ? 'Projet prêt' : 'Activité indisponible'}</strong>
                <span>
                  {activityAvailable
                    ? 'Aucun travail agent en cours.'
                    : 'Impossible de déterminer les travaux actifs.'}
                </span>
              </div>
            )}
          </section>

          <section
            className="cockpit-section cockpit-recent"
            data-testid="worktree-recent-activity"
          >
            <header>
              <div>
                <span>Historique</span>
                <h2>Activité récente</h2>
              </div>
            </header>
            {recent.length ? (
              <div className="cockpit-work-list">
                {recent.slice(0, 6).map((agent) => (
                  <WorktreeActivitySummary
                    key={agent.agentId}
                    agent={agent}
                    onOpen={() => {
                      setDetailTab('work')
                      setDetailOpen(true)
                    }}
                  />
                ))}
              </div>
            ) : (
              <p>
                {activityAvailable ? 'Aucune activité récente.' : 'Activité récente indisponible.'}
              </p>
            )}
          </section>

          <button
            className="cockpit-open-detail"
            type="button"
            onClick={() => {
              setDetailTab('git')
              setDetailOpen(true)
            }}
          >
            Ouvrir la topologie Git
          </button>
        </div>
      )}

      {detailOpen && (
        <aside
          className="cockpit-detail"
          aria-label="Détails du projet"
          data-testid="worktree-detail-panel"
        >
          <header>
            <strong>Détails du projet</strong>
            <button type="button" onClick={() => setDetailOpen(false)}>
              Fermer
            </button>
          </header>
          <nav>
            <button
              className={detailTab === 'work' ? 'is-active' : ''}
              onClick={() => setDetailTab('work')}
            >
              État du travail
            </button>
            <button
              className={detailTab === 'files' ? 'is-active' : ''}
              onClick={() => setDetailTab('files')}
            >
              Fichiers
            </button>
            <button className={detailTab === 'run' ? 'is-active' : ''} onClick={openRunDetail}>
              RUN
            </button>
            <button
              className={detailTab === 'git' ? 'is-active' : ''}
              onClick={() => setDetailTab('git')}
            >
              Topologie Git
            </button>
          </nav>
          {detailTab === 'git' ? (
            snapshot?.available === false ? (
              <p>Topologie indisponible.</p>
            ) : (
              <GitTopology commits={snapshot?.commits ?? []} />
            )
          ) : detailTab === 'run' ? (
            detailError ? (
              <p role="alert">RUN indisponible : {detailError}</p>
            ) : openRun ? (
              <RunInspector content={openRun.content} summary={openRun.entry.summary} />
            ) : (
              <p role="status">Lecture du RUN…</p>
            )
          ) : detailTab === 'files' ? (
            <div className="cockpit-detail__files">
              {agents
                .flatMap((agent) => agent.files.map((file) => ({ agent, file })))
                .map(({ agent, file }) => (
                  <div key={`${agent.agentId}:${file.path}`}>
                    <button type="button" onClick={() => openDiff(agent, file.path)}>
                      {file.path}
                    </button>
                    {openFile === file.path && (
                      <div className="cockpit-detail__diff">
                        {detailError ? (
                          <p role="alert">Diff indisponible : {detailError}</p>
                        ) : diff === null ? (
                          <p role="status">Chargement du diff…</p>
                        ) : diff.available ? (
                          <DiffView diff={diff.diff ?? ''} />
                        ) : (
                          <p role="alert">
                            Diff indisponible{diff.error ? ` : ${diff.error}` : '.'}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              {agents.every((agent) => agent.files.length === 0) && <p>Aucun fichier touché.</p>}
            </div>
          ) : (
            <WorktreeActivityView agents={agents} status={status} className="is-detail" />
          )}
        </aside>
      )}
    </section>
  )
}
