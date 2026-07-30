import { useEffect, useRef, useState } from 'react'
import { WorktreeActivityView } from './WorktreeActivityView'
import { DiffView } from './DiffView'
import type { WorktreeAgentActivity } from '../../../shared/worktree-activity-model'
import type { GitReadResult, GitChange, GitDiffResult } from '../../../shared/git-read'
import './SourceControlPane.css'

/**
 * Surface "Source control" (fusion worktrees + git), design C : sections de consultation en haut +
 * une BARRE DE PROMPT éditable en bas. VISION : un bouton/clic-droit ne fait PAS de git — il
 * PRÉ-REMPLIT le prompt (l'utilisateur relit/édite), puis envoie à l'agent via `onSendPrompt`.
 * Lecture git = READ-ONLY (getGitState). Aucune action git n'est exécutée par le renderer.
 */
const markGlyph: Record<GitChange['status'], string> = {
  modified: '~',
  added: '+',
  deleted: '–',
  renamed: '»',
  untracked: '?'
}

export function SourceControlPane({
  onSendPrompt
}: {
  onSendPrompt?: (prompt: string) => void
}): React.JSX.Element {
  const [git, setGit] = useState<GitReadResult | null>(null)
  const [worktrees, setWorktrees] = useState<WorktreeAgentActivity[]>([])
  const [openFile, setOpenFile] = useState<string | null>(null)
  const [diff, setDiff] = useState<GitDiffResult | null>(null)
  const diffRequestRef = useRef(0)
  // v3 — dépôt configurable (multi-repo), persisté ; '' = cwd de l'app par défaut.
  const [repoPath, setRepoPath] = useState<string>(
    () => localStorage.getItem('autowin:sc-repo') ?? ''
  )
  // Compteur de rafraîchissement : recliquer le dépôt DÉJÀ actif réécrivait un state identique →
  // React ne re-rendait rien → « le bouton ne fait rien ». Désormais chaque clic relit le dépôt.
  const [refreshTick, setRefreshTick] = useState(0)
  const [loading, setLoading] = useState(false)
  /**
   * Vue affichée. `changes` = UNIQUEMENT les fichiers modifiés du dépôt choisi (Projet ou Brain),
   * pour aller droit au « qu'est-ce qui a changé ». `worktree` = tout le reste (branche, copies
   * d'agents, historique), qui noyait la liste des changements quand tout s'empilait.
   */
  const [view, setView] = useState<'changes' | 'worktree'>('changes')

  useEffect(() => {
    let alive = true
    // On NE VIDE PLUS l'affichage pendant le rafraîchissement (avant : écran blanc → « on dirait que
    // rien ne se passe »). L'ancienne liste reste visible, un indicateur signale le chargement.
    // Le changement de dépôt lance immédiatement une nouvelle requête externe.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    void window.api.getGitState?.(repoPath || undefined).then((g) => {
      if (alive) {
        setGit(g as GitReadResult)
        setLoading(false)
      }
    })
    void window.api.getWorktreeActivity?.().then((a) => {
      if (alive) setWorktrees(a)
    })
    const off = window.api.onWorktreeActivity?.((a) => setWorktrees(a))
    return () => {
      alive = false
      off?.()
    }
  }, [repoPath, refreshTick])

  const selectRepo = (path: string): void => {
    diffRequestRef.current += 1
    localStorage.setItem('autowin:sc-repo', path)
    setOpenFile(null)
    setDiff(null)
    setRepoPath(path)
    setView('changes')
    setRefreshTick((n) => n + 1)
  }

  // Clôture automatique d'un run vert (commit + push sur branche dédiée). OFF par défaut, côté main.
  const [autoClose, setAutoClose] = useState<{ enabled: boolean; last?: unknown } | null>(null)
  useEffect(() => {
    let alive = true
    void window.api.getAutoClose?.().then((s) => {
      if (alive) setAutoClose(s as { enabled: boolean })
    })
    return () => {
      alive = false
    }
  }, [])
  const toggleAutoClose = async (): Promise<void> => {
    const next = !(autoClose?.enabled ?? false)
    setAutoClose({ enabled: next }) // optimiste
    try {
      const applied = await window.api.setAutoClose(next)
      setAutoClose(applied as { enabled: boolean })
    } catch {
      setAutoClose({ enabled: !next })
    }
  }

  // Le Brain partagé est versionné comme le code : on y bascule en un clic pour voir SES diffs.
  const [brainPath, setBrainPath] = useState<string>('')
  useEffect(() => {
    let alive = true
    void window.api.brainRepoPath?.().then((p) => {
      if (alive && typeof p === 'string') setBrainPath(p)
    })
    return () => {
      alive = false
    }
  }, [])
  const onBrain = Boolean(brainPath) && repoPath === brainPath

  // Les boutons envoient DIRECTEMENT la demande à l'agent (plus de barre de prompt intermédiaire :
  // le détour « relis puis envoie » n'apportait rien, l'agent reste de toute façon le seul à agir).
  const propose = (text: string): void => onSendPrompt?.(text)
  const toggleDiff = (path: string): void => {
    if (openFile === path) {
      diffRequestRef.current += 1
      setOpenFile(null)
      return
    }
    const requestId = ++diffRequestRef.current
    setOpenFile(path)
    setDiff(null)
    void window.api.getGitDiff?.(path, repoPath || undefined).then((d) => {
      if (diffRequestRef.current === requestId) setDiff(d as GitDiffResult)
    })
  }

  const changes = git?.state?.changes ?? []

  return (
    <div className="sc-pane" data-testid="source-control-pane">
      <div className="sc-scroll">
        <div className="sc-repo" data-testid="sc-repo">
          <span className="sc-repo-path" title={repoPath || 'Dépôt courant (app)'}>
            📁 {repoPath ? repoPath.replace(/^.*[\\/]/, '') : 'Dépôt courant'}
            {/* Retour visible à CHAQUE clic : sans lui, un rafraîchissement rapide passe inaperçu. */}
            {loading && (
              <span className="sc-loading" data-testid="sc-loading">
                {' '}
                · lecture…
              </span>
            )}
          </span>
          {/* Projet / Brain = les CHANGEMENTS du dépôt choisi. Worktree = tout le reste. */}
          <button
            className={`sc-btn sc-repo-btn${view === 'changes' && !repoPath ? ' is-active' : ''}`}
            data-testid="sc-repo-project"
            title="Fichiers modifiés du dépôt du projet"
            onClick={() => selectRepo('')}
          >
            Projet
          </button>
          {brainPath && (
            <button
              className={`sc-btn sc-repo-btn${view === 'changes' && onBrain ? ' is-active' : ''}`}
              data-testid="sc-repo-brain"
              title={`Fichiers .md modifiés du Brain — ${brainPath}`}
              onClick={() => selectRepo(brainPath)}
            >
              Brain
            </button>
          )}
          <button
            className={`sc-btn sc-repo-btn${view === 'worktree' ? ' is-active' : ''}`}
            data-testid="sc-view-worktree"
            title="Branche, copies d’agents et historique"
            onClick={() => setView('worktree')}
          >
            Worktree
          </button>
        </div>
        {git && !git.available && (
          <div className="sc-empty">Dépôt git introuvable ici (lecture indisponible).</div>
        )}
        {view === 'worktree' && git?.state && (
          <section className="sc-sect">
            <header className="sc-h">Branche</header>
            <div className="sc-branch-row">
              <span className="sc-branch">{git.state.branch || '—'}</span>
              {(git.state.ahead > 0 || git.state.behind > 0) && (
                <span className="sc-ab">
                  ↑{git.state.ahead} ↓{git.state.behind}
                </span>
              )}
            </div>
            <div className="sc-btns">
              {/* Quand un run passe au vert : commit + push automatique sur auto/<run>, jamais main. */}
              <button
                className={`sc-btn sc-toggle ${autoClose?.enabled ? 'is-on' : 'is-off'}`}
                data-testid="sc-autoclose"
                aria-pressed={autoClose?.enabled ?? false}
                title={
                  autoClose?.enabled
                    ? 'ACTIVÉE — chaque run vert sera commité et poussé sur une branche dédiée (jamais main). Clic : désactiver.'
                    : 'DÉSACTIVÉE — rien n’est publié automatiquement. Clic : activer.'
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

        {view === 'changes' && git?.state && (
          <section className="sc-sect">
            <header className="sc-h">Changements · {changes.length}</header>
            {changes.length === 0 ? (
              <div className="sc-clean">Rien à committer, arbre propre.</div>
            ) : (
              <>
                {changes.map((c) => (
                  <div key={c.path}>
                    <div
                      className={`sc-file${openFile === c.path ? ' sc-file-open' : ''}`}
                      data-testid="sc-file"
                      title={`${c.path} — clic : voir le diff`}
                      onClick={() => toggleDiff(c.path)}
                    >
                      <span className={`sc-m sc-m-${c.status}`}>{markGlyph[c.status]}</span>
                      <span className="sc-fn">{c.path}</span>
                      <span className="sc-chev">{openFile === c.path ? '▾' : '▸'}</span>
                    </div>
                    {openFile === c.path && (
                      <div className="sc-diff-wrap">
                        <div className="sc-diff-card" data-testid="sc-diff-card">
                          <div className="sc-diff-head">
                            <span className="sc-diff-title" title={c.path}>
                              {c.path}
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
                              onClick={(e) => {
                                e.stopPropagation()
                                propose(
                                  `explique ce qui a changé dans ${c.path} et propose un commit`
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

        {view === 'worktree' && git?.history && git.history.length > 0 && (
          <section className="sc-sect">
            <header className="sc-h">Historique</header>
            {git.history.map((c) => (
              <div className="sc-commit" key={c.hash}>
                <span className="sc-hash">{c.hash}</span>
                <span className="sc-subj">{c.subject}</span>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  )
}
