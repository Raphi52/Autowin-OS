import { useEffect, useRef, useState } from 'react'
import { WorktreeActivityView } from './WorktreeActivityView'
import { DiffView } from './DiffView'
import type { WorktreeAgentActivity } from '../../../shared/worktree-activity-model'
import type { GitReadResult, GitChange, GitDiffResult } from '../../../shared/git-read'
import './SourceControlPane.css'

const markGlyph: Record<GitChange['status'], string> = {
  modified: '~',
  added: '+',
  deleted: '–',
  renamed: '»',
  untracked: '?'
}

type PaneView = 'project' | 'brain' | 'worktree'

interface BrainTraceView {
  timestamp: string
  conversationId: string
  turnId?: string
  kind?: 'automatic' | 'query'
  query: string
  found?: boolean
  status?: 'found' | 'empty' | 'unavailable'
  injectedChars: number
  navigation?: {
    candidates: Array<{ path: string; retained: boolean }>
  }
}

const EMPTY_GIT: GitReadResult = {
  available: true,
  state: { branch: '', ahead: 0, behind: 0, changes: [] }
}

export function SourceControlPane({
  conversationId,
  onSendPrompt
}: {
  conversationId?: string
  onSendPrompt?: (prompt: string) => void
}): React.JSX.Element {
  const [git, setGit] = useState<GitReadResult | null>(null)
  const [brainTraces, setBrainTraces] = useState<BrainTraceView[]>([])
  const [brainUnavailable, setBrainUnavailable] = useState(false)
  const [worktrees, setWorktrees] = useState<WorktreeAgentActivity[]>([])
  const [openFile, setOpenFile] = useState<string | null>(null)
  const [diff, setDiff] = useState<GitDiffResult | null>(null)
  const diffRequestRef = useRef(0)
  const dataRequestRef = useRef(0)
  const [repoPath] = useState<string>(() => localStorage.getItem('autowin:sc-repo') ?? '')
  const [refreshTick, setRefreshTick] = useState(0)
  const [view, setView] = useState<PaneView>('project')
  const scope = `${view}:${conversationId ?? ''}:${view === 'worktree' ? repoPath : ''}`
  const [loadedScope, setLoadedScope] = useState('')

  useEffect(() => {
    let alive = true
    void window.api.getWorktreeActivity?.().then((activity) => {
      if (alive) setWorktrees(activity)
    })
    const off = window.api.onWorktreeActivity?.((activity) => setWorktrees(activity))
    return () => {
      alive = false
      off?.()
    }
  }, [])

  useEffect(() => {
    const requestId = ++dataRequestRef.current

    const finishGit = (value: GitReadResult): void => {
      if (dataRequestRef.current !== requestId) return
      setGit(value)
      setBrainTraces([])
      setBrainUnavailable(false)
      setOpenFile(null)
      setDiff(null)
      setLoadedScope(scope)
    }
    const finishBrain = (value: BrainTraceView[], unavailable = false): void => {
      if (dataRequestRef.current !== requestId) return
      setBrainTraces(value)
      setBrainUnavailable(unavailable)
      setGit(null)
      setOpenFile(null)
      setDiff(null)
      setLoadedScope(scope)
    }

    if (view === 'project') {
      if (!conversationId) finishGit(EMPTY_GIT)
      else {
        void window.api
          .conversationGitState(conversationId)
          .then((value) => finishGit(value as GitReadResult))
          .catch(() => finishGit({ available: false, error: 'Lecture conversation indisponible.' }))
      }
    } else if (view === 'brain') {
      if (!conversationId) finishBrain([])
      else {
        void window.api
          .brainTraces(conversationId)
          .then((value) => finishBrain(value as BrainTraceView[]))
          .catch(() => finishBrain([], true))
      }
    } else {
      void window.api
        .getGitState(repoPath || undefined)
        .then((value) => finishGit(value as GitReadResult))
        .catch(() => finishGit({ available: false, error: 'Lecture Git indisponible.' }))
    }

    return () => {
      if (dataRequestRef.current === requestId) dataRequestRef.current += 1
    }
  }, [conversationId, refreshTick, repoPath, scope, view])

  useEffect(() => {
    const refreshConversation = (raw: unknown): void => {
      const event = raw as {
        conversationId?: string
        convId?: string
        kind?: string
        type?: string
        name?: string
      }
      const target = event.conversationId ?? event.convId
      if (target !== conversationId) return
      if (
        event.kind === 'result' ||
        event.type === 'orchestrate-step' ||
        event.type === 'orchestrate-end'
      ) {
        setRefreshTick((value) => value + 1)
      }
    }
    const offPilot = window.api.onPilotEvent?.(refreshConversation)
    const offApp = window.api.onAppEvent?.(refreshConversation)
    return () => {
      offPilot?.()
      offApp?.()
    }
  }, [conversationId])

  const [autoClose, setAutoClose] = useState<{ enabled: boolean; last?: unknown } | null>(null)
  useEffect(() => {
    let alive = true
    void window.api.getAutoClose?.().then((state) => {
      if (alive) setAutoClose(state as { enabled: boolean })
    })
    return () => {
      alive = false
    }
  }, [])

  const toggleAutoClose = async (): Promise<void> => {
    const next = !(autoClose?.enabled ?? false)
    setAutoClose({ enabled: next })
    try {
      const applied = await window.api.setAutoClose(next)
      setAutoClose(applied as { enabled: boolean })
    } catch {
      setAutoClose({ enabled: !next })
    }
  }

  const selectView = (next: PaneView): void => {
    if (next === view) setRefreshTick((value) => value + 1)
    else setView(next)
  }
  const propose = (text: string): void => onSendPrompt?.(text)
  const toggleDiff = (change: GitChange): void => {
    const key = `${change.workspaceRoot ?? ''}\0${change.path}`
    if (openFile === key) {
      diffRequestRef.current += 1
      setOpenFile(null)
      return
    }
    const requestId = ++diffRequestRef.current
    setOpenFile(key)
    setDiff(null)
    const request =
      view === 'project' && conversationId && change.workspaceRoot
        ? window.api.conversationGitDiff(conversationId, change.path, change.workspaceRoot)
        : window.api.getGitDiff(change.path, repoPath || undefined)
    void request.then((value) => {
      if (diffRequestRef.current === requestId) setDiff(value as GitDiffResult)
    })
  }

  const scopeLoaded = loadedScope === scope
  const visibleGit = scopeLoaded ? git : null
  const visibleBrainTraces = scopeLoaded ? brainTraces : []
  const changes = visibleGit?.state?.changes ?? []
  const paneLabel =
    view === 'brain'
      ? 'Appels Brain de la conversation'
      : view === 'worktree' && repoPath
        ? repoPath.replace(/^.*[\\/]/, '')
        : view === 'project'
          ? 'Projet de la conversation'
          : 'Dépôt courant'

  return (
    <div className="sc-pane" data-testid="source-control-pane">
      <div className="sc-scroll">
        <div className="sc-repo" data-testid="sc-repo">
          <span className="sc-repo-path" title={paneLabel}>
            {view === 'brain' ? '◇' : '📁'} {paneLabel}
            {!scopeLoaded && (
              <span className="sc-loading" data-testid="sc-loading">
                {' '}
                · lecture…
              </span>
            )}
          </span>
          <button
            className={`sc-btn sc-repo-btn${view === 'project' ? ' is-active' : ''}`}
            data-testid="sc-repo-project"
            title="Fichiers modifiés par cette conversation"
            onClick={() => selectView('project')}
          >
            Projet
          </button>
          <button
            className={`sc-btn sc-repo-btn${view === 'brain' ? ' is-active' : ''}`}
            data-testid="sc-repo-brain"
            title="Appels au Brain effectués depuis cette conversation"
            onClick={() => selectView('brain')}
          >
            Brain
          </button>
          <button
            className={`sc-btn sc-repo-btn${view === 'worktree' ? ' is-active' : ''}`}
            data-testid="sc-view-worktree"
            title="Branche, copies d’agents et historique"
            onClick={() => selectView('worktree')}
          >
            Worktree
          </button>
        </div>

        {view !== 'brain' && visibleGit && !visibleGit.available && (
          <div className="sc-empty">Dépôt Git introuvable ici (lecture indisponible).</div>
        )}

        {view === 'project' && visibleGit?.state && (
          <section className="sc-sect">
            <header className="sc-h">Modifiés par cette conversation · {changes.length}</header>
            {changes.length === 0 ? (
              <div className="sc-clean">Aucun fichier modifié par cette conversation.</div>
            ) : (
              <>
                {changes.map((change) => (
                  <div key={`${change.workspaceRoot ?? ''}:${change.path}`}>
                    <div
                      className={`sc-file${
                        openFile === `${change.workspaceRoot ?? ''}\0${change.path}`
                          ? ' sc-file-open'
                          : ''
                      }`}
                      data-testid="sc-file"
                      title={`${change.path} — clic : voir le diff`}
                      onClick={() => toggleDiff(change)}
                    >
                      <span className={`sc-m sc-m-${change.status}`}>
                        {markGlyph[change.status]}
                      </span>
                      <span className="sc-fn">{change.path}</span>
                      <span className="sc-chev">
                        {openFile === `${change.workspaceRoot ?? ''}\0${change.path}` ? '▾' : '▸'}
                      </span>
                    </div>
                    {openFile === `${change.workspaceRoot ?? ''}\0${change.path}` && (
                      <div className="sc-diff-wrap">
                        <div className="sc-diff-card" data-testid="sc-diff-card">
                          <div className="sc-diff-head">
                            <span className="sc-diff-title" title={change.path}>
                              {change.path}
                            </span>
                            <span className="sc-diff-wrap-mode">Retour ligne</span>
                          </div>
                          <div className="sc-diff-content">
                            {diff === null ? (
                              <div className="sc-clean">Chargement du diff…</div>
                            ) : diff.available ? (
                              <DiffView diff={diff.diff ?? ''} />
                            ) : (
                              <div className="sc-clean">Diff indisponible.</div>
                            )}
                          </div>
                          <div className="sc-diff-actions">
                            <button
                              className="sc-btn sc-diff-action"
                              onClick={(event) => {
                                event.stopPropagation()
                                propose(
                                  `explique ce qui a changé dans ${change.path} et propose un commit`
                                )
                              }}
                            >
                              Expliquer / committer ce fichier
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                <div className="sc-btns">
                  <button
                    className="sc-btn"
                    onClick={() =>
                      propose('commit tous les changements avec un message clair, puis push')
                    }
                  >
                    Commit
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {view === 'brain' && (
          <section className="sc-sect">
            <header className="sc-h">Appels Brain · {visibleBrainTraces.length}</header>
            {brainUnavailable ? (
              <div className="sc-empty">Lecture des appels Brain indisponible.</div>
            ) : visibleBrainTraces.length === 0 ? (
              <div className="sc-clean">Aucun appel Brain dans cette conversation.</div>
            ) : (
              visibleBrainTraces.map((trace, index) => {
                const retained =
                  trace.navigation?.candidates.filter((candidate) => candidate.retained) ?? []
                return (
                  <article
                    className="sc-brain-call"
                    data-testid="sc-brain-trace"
                    key={`${trace.timestamp}:${trace.turnId ?? index}`}
                  >
                    <header>
                      <span className="sc-brain-kind">
                        {trace.kind === 'query' ? 'Requête du modèle' : 'Injection automatique'}
                      </span>
                      <time dateTime={trace.timestamp}>
                        {new Date(trace.timestamp).toLocaleTimeString('fr-FR', {
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </time>
                    </header>
                    <p>{trace.query || 'Requête non exposée'}</p>
                    <footer>
                      <span title={trace.turnId ?? 'Tour historique non corrélé'}>
                        {trace.turnId ? `Tour ${trace.turnId.slice(0, 8)}` : 'Tour non corrélé'}
                      </span>
                      <span>
                        {trace.status === 'unavailable'
                          ? 'Brain indisponible'
                          : trace.found === false
                            ? 'Aucun résultat'
                          : trace.found === true
                            ? 'Résultat trouvé'
                            : 'Résultat historique inconnu'}
                      </span>
                      <span>{trace.injectedChars.toLocaleString('fr-FR')} caractères transmis</span>
                      {retained.length > 0 && <span>{retained.length} source(s) retenue(s)</span>}
                    </footer>
                    {retained.length > 0 && (
                      <ul className="sc-brain-sources">
                        {retained.map((candidate) => (
                          <li key={candidate.path} title={candidate.path}>
                            {candidate.path}
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                )
              })
            )}
          </section>
        )}

        {view === 'worktree' && visibleGit?.state && (
          <section className="sc-sect">
            <header className="sc-h">Branche</header>
            <div className="sc-branch-row">
              <span className="sc-branch">{visibleGit.state.branch || '—'}</span>
              {(visibleGit.state.ahead > 0 || visibleGit.state.behind > 0) && (
                <span className="sc-ab">
                  ↑{visibleGit.state.ahead} ↓{visibleGit.state.behind}
                </span>
              )}
            </div>
            <div className="sc-btns">
              <button
                className={`sc-btn sc-toggle ${autoClose?.enabled ? 'is-on' : 'is-off'}`}
                data-testid="sc-autoclose"
                aria-pressed={autoClose?.enabled ?? false}
                title={
                  autoClose?.enabled
                    ? 'Activée — chaque run vert sera commité et poussé sur une branche dédiée. Clic : désactiver.'
                    : 'Désactivée — rien n’est publié automatiquement. Clic : activer.'
                }
                onClick={() => void toggleAutoClose()}
              >
                <span className="sc-toggle-dot" aria-hidden="true" />
                Clôture auto
                <b className="sc-toggle-state">{autoClose?.enabled ? 'ON' : 'OFF'}</b>
              </button>
              <button className="sc-btn" onClick={() => propose('change de branche vers : ')}>
                Changer de branche
              </button>
              <button className="sc-btn" onClick={() => propose('push la branche courante')}>
                Push
              </button>
            </div>
          </section>
        )}

        {view === 'worktree' && (
          <section className="sc-sect">
            <header className="sc-h">
              Worktrees{worktrees.length ? ` · ${worktrees.length}` : ''}
            </header>
            {worktrees.length === 0 ? (
              <div className="sc-clean">Aucune copie d’agent en cours.</div>
            ) : (
              <WorktreeActivityView
                agents={worktrees}
                onResolveConflict={(id) =>
                  propose(
                    `montre-moi les deux versions en conflit du worktree ${id} et aide-moi à trancher`
                  )
                }
              />
            )}
          </section>
        )}

        {view === 'worktree' && visibleGit?.history && visibleGit.history.length > 0 && (
          <section className="sc-sect">
            <header className="sc-h">Historique</header>
            {visibleGit.history.map((commit) => (
              <div className="sc-commit" key={commit.hash}>
                <span className="sc-hash">{commit.hash}</span>
                <span className="sc-subj">{commit.subject}</span>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  )
}
