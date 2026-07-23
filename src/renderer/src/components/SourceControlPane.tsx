import { useEffect, useState } from 'react'
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
  const [prompt, setPrompt] = useState('')
  const [openFile, setOpenFile] = useState<string | null>(null)
  const [diff, setDiff] = useState<GitDiffResult | null>(null)

  useEffect(() => {
    let alive = true
    void window.api.getGitState?.().then((g) => {
      if (alive) setGit(g as GitReadResult)
    })
    void window.api.getWorktreeActivity?.().then((a) => {
      if (alive) setWorktrees(a)
    })
    const off = window.api.onWorktreeActivity?.((a) => setWorktrees(a))
    return () => {
      alive = false
      off?.()
    }
  }, [])

  const propose = (text: string): void => setPrompt(text)
  const toggleDiff = (path: string): void => {
    if (openFile === path) {
      setOpenFile(null)
      return
    }
    setOpenFile(path)
    setDiff(null)
    void window.api.getGitDiff?.(path).then((d) => setDiff(d as GitDiffResult))
  }
  const send = (): void => {
    const t = prompt.trim()
    if (t) onSendPrompt?.(t)
    setPrompt('')
  }

  const changes = git?.state?.changes ?? []

  return (
    <div className="sc-pane" data-testid="source-control-pane">
      <div className="sc-scroll">
        {git && !git.available && (
          <div className="sc-empty">Dépôt git introuvable ici (lecture indisponible).</div>
        )}
        {git?.state && (
          <section className="sc-sect">
            <header className="sc-h">Branche</header>
            <div className="sc-branch-row">
              <span className="sc-branch">{git.state.branch || '—'}</span>
              {(git.state.ahead > 0 || git.state.behind > 0) && (
                <span className="sc-ab">↑{git.state.ahead} ↓{git.state.behind}</span>
              )}
            </div>
            <div className="sc-btns">
              <button className="sc-btn" onClick={() => propose('change de branche vers : ')}>
                Changer de branche <span className="sc-prompt-badge">→ prompt</span>
              </button>
              <button className="sc-btn" onClick={() => propose('push la branche courante')}>
                Push <span className="sc-prompt-badge">→ prompt</span>
              </button>
            </div>
          </section>
        )}

        {git?.state && (
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
                        {diff === null ? (
                          <div className="sc-clean">Chargement du diff…</div>
                        ) : diff.available ? (
                          <DiffView diff={diff.diff ?? ''} />
                        ) : (
                          <div className="sc-clean">Diff indisponible.</div>
                        )}
                        <button
                          className="sc-btn"
                          onClick={(e) => {
                            e.stopPropagation()
                            propose(`explique ce qui a changé dans ${c.path} et propose un commit`)
                          }}
                        >
                          Expliquer / committer ce fichier <span className="sc-prompt-badge">→ prompt</span>
                        </button>
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
                    Commit <span className="sc-prompt-badge">→ prompt</span>
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        <section className="sc-sect">
          <header className="sc-h">Worktrees{worktrees.length ? ` · ${worktrees.length}` : ''}</header>
          {worktrees.length === 0 ? (
            <div className="sc-clean">Aucune copie d’agent en cours.</div>
          ) : (
            <WorktreeActivityView
              agents={worktrees}
              onResolveConflict={(id) =>
                propose(`montre-moi les deux versions en conflit du worktree ${id} et aide-moi à trancher`)
              }
            />
          )}
        </section>

        {git?.history && git.history.length > 0 && (
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

      <div className="sc-promptbar">
        <div className="sc-promptbar-lbl">Prompt git (éditable) → agent</div>
        <textarea
          className="sc-promptbar-input"
          data-testid="sc-prompt-input"
          value={prompt}
          placeholder="Un bouton propose un prompt ici ; relis/édite, puis envoie."
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        <button className="sc-btn sc-send" data-testid="sc-send" disabled={!prompt.trim()} onClick={send}>
          Envoyer à l’agent
        </button>
      </div>
    </div>
  )
}
