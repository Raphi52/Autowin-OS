import { useEffect, useRef, useState } from 'react'
import { ProjectPane } from './ProjectPane'
import { DiffView } from './DiffView'
import type { GitReadResult, GitChange, GitDiffResult } from '../../../shared/git-read'
import type { BrainTrace } from '../../../main/activity/brain-trace-spool'
import './SourceControlPane.css'
import { Spinner } from './Spinner'

const markGlyph: Record<GitChange['status'], string> = {
  modified: '~',
  added: '+',
  deleted: '–',
  renamed: '»',
  untracked: '?',
  conflicted: '!',
  committed: '✓',
  retouched: '~'
}

/**
 * Les vues du panneau. `tree` = arborescence editable du depot : demande de l'utilisateur le
 * 2026-09-12, l'arborescence doit etre un SOUS-ONGLET a cote de Fichiers/Brain/Workspace, et non
 * un bloc empile au-dessus d'eux.
 */
type PaneView = 'project' | 'brain' | 'workspace' | 'tree'

const EMPTY_GIT: GitReadResult = {
  available: true,
  state: { branch: '', ahead: 0, behind: 0, changes: [] }
}

type AutoCloseViewResult =
  | { status: 'pushed'; branch: string; files: number }
  | { status: 'committed'; files: number }
  | { status: 'skipped'; reason: string; detail?: string }
  | { status: 'failed'; error: string }

interface AutoCloseViewState {
  enabled: boolean
  last?: {
    runId: string
    branch: string
    project: AutoCloseViewResult
    brain: AutoCloseViewResult
    at: string
  }
}

function autoCloseResultLabel(scope: string, result: AutoCloseViewResult): string {
  if (result.status === 'pushed') return `${scope} · publié · ${result.branch}`
  if (result.status === 'committed') return `${scope} · commité localement`
  if (result.status === 'failed') return `${scope} · échec · ${result.error}`
  const reasons: Record<string, string> = {
    'no-changes': 'aucun changement',
    'no-remote': 'aucun distant',
    'recovery-baseline-missing': 'baseline de reprise absente',
    'protected-branch': 'branche protégée',
    'secret-detected': 'secret détecté',
    'concurrent-commits': 'commits concurrents',
    'invalid-publication-range': 'plage Git non vérifiable'
  }
  return `${scope} · non publié · ${reasons[result.reason] ?? result.reason}`
}

export function SourceControlPane({
  conversationId,
  depotConversation,
  onSendPrompt
}: {
  conversationId?: string
  /** Depot de la CONVERSATION : ce que la vue « Workspace » doit lire, branche comprise. */
  depotConversation?: string
  onSendPrompt?: (prompt: string) => void
}): React.JSX.Element {
  const [git, setGit] = useState<GitReadResult | null>(null)
  const [brainTraces, setBrainTraces] = useState<BrainTrace[]>([])
  const [brainUnavailable, setBrainUnavailable] = useState(false)
  const [openFile, setOpenFile] = useState<string | null>(null)
  const [diff, setDiff] = useState<GitDiffResult | null>(null)
  const diffRequestRef = useRef(0)
  const dataRequestRef = useRef(0)
  /*
   * DEPOT DE LA VUE « WORKSPACE ».
   *
   * Il suit la CONVERSATION. Auparavant il ne lisait que `autowin:sc-repo`, un chemin choisi une
   * fois dans le navigateur et jamais revu : le panneau affichait alors le nom et la branche d'un
   * AUTRE depot que celui du fil (constate le 2026-09-23 : « RIG-V3 » sur une conversation
   * AutoWinOS). Le chemin memorise ne sert plus que de repli quand la conversation n'en porte pas.
   */
  const [repoMemorise] = useState<string>(() => localStorage.getItem('autowin:sc-repo') ?? '')
  const repoPath = depotConversation?.trim() || repoMemorise
  const [refreshTick, setRefreshTick] = useState(0)
  /** Fichier dont « Annuler ces changements » attend le clic de confirmation. */
  const [annulerArme, setAnnulerArme] = useState<string | null>(null)
  /**
   * Fichiers ANNULES depuis ce panneau : une fois annules, ils sortent de la liste des modifies,
   * donc « Remettre » vit a part. Memoire de l'ecran seulement : un rechargement l'oublie, la copie
   * des changements reste sur le disque (voir la demande envoyee a l'agent).
   */
  const [annules, setAnnules] = useState<string[]>([])
  const [view, setView] = useState<PaneView>('project')
  const scope = `${view}:${conversationId ?? ''}:${view === 'workspace' ? repoPath : ''}`
  const [loadedScope, setLoadedScope] = useState('')

  useEffect(() => {
    // L'activité des bureaux vit dans l'onglet Worktrees ; ici, l'événement sert seulement à relire
    // le résultat de clôture auto, qui peut se terminer APRÈS le retour du run.
    const off = window.api.onWorktreeActivity?.(() => {
      setRefreshTick((tick) => tick + 1)
    })
    return () => {
      off?.()
    }
  }, [conversationId])

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
    const finishBrain = (value: BrainTrace[], unavailable = false): void => {
      if (dataRequestRef.current !== requestId) return
      setBrainTraces(value)
      setBrainUnavailable(unavailable)
      setGit(null)
      setOpenFile(null)
      setDiff(null)
      setLoadedScope(scope)
    }

    if (view === 'tree') {
      // L'arborescence charge elle-meme par ses propres canaux : aucune lecture git a faire ici.
      finishGit(EMPTY_GIT)
    } else if (view === 'project') {
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
          .then((value) => finishBrain(value))
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
        // FIN DE TOUR : les fichiers modifies par le chat sont notes juste avant (agent-pilot,
        // capture avant/apres). Sans cette relecture, il fallait quitter puis rouvrir l'onglet.
        event.kind === 'done' ||
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

  const [autoClose, setAutoClose] = useState<AutoCloseViewState | null>(null)
  const [autoCloseError, setAutoCloseError] = useState<string>()
  useEffect(() => {
    let alive = true
    void window.api.getAutoClose?.().then((state) => {
      if (alive) setAutoClose(state as AutoCloseViewState)
    })
    return () => {
      alive = false
    }
  }, [refreshTick])

  const toggleAutoClose = async (): Promise<void> => {
    // fix-ok: l'état optimiste est rétabli et expliqué si le main process ne peut pas le persister.
    const previous = autoClose?.enabled ?? false
    const next = !previous
    setAutoCloseError(undefined)
    setAutoClose({ enabled: next })
    try {
      const applied = await window.api.setAutoClose(next)
      setAutoClose(applied as AutoCloseViewState)
    } catch {
      setAutoClose({ enabled: previous })
      setAutoCloseError('Impossible de conserver ce réglage sur le disque.')
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
    void request
      .then((value) => {
        if (diffRequestRef.current === requestId) setDiff(value as GitDiffResult)
      })
      .catch(() => {
        // fix-ok: une erreur obsolète ne doit ni bloquer le chargement ni écraser un diff plus récent.
        if (diffRequestRef.current === requestId) {
          setDiff({ available: false, error: 'Diff indisponible.' })
        }
      })
  }

  const scopeLoaded = loadedScope === scope
  const visibleGit = scopeLoaded ? git : null
  const visibleBrainTraces = scopeLoaded ? brainTraces : []
  const changes = visibleGit?.state?.changes ?? []
  const paneLabel =
    view === 'tree'
      ? 'Arborescence du projet'
      : view === 'brain'
        ? 'Appels Brain de la conversation'
        : view === 'workspace' && repoPath
          ? repoPath.replace(/^.*[\\/]/, '')
          : view === 'project'
            ? // Suit le renommage de l'onglet : un onglet « Fichiers » ouvrant un panneau intitulé
              // « Projet de la conversation » se contredirait à l'écran.
              'Fichiers de la conversation'
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
            {/* « Fichiers » et non « Projet » : cet onglet liste les FICHIERS modifiés par la
                conversation, ce que son propre `title` disait déjà. « Projet » annonçait un périmètre
                (le dépôt) au lieu du contenu (les fichiers touchés ici). */}
            Fichiers
          </button>
          <button
            className={`sc-btn sc-repo-btn${view === 'tree' ? ' is-active' : ''}`}
            data-testid="sc-view-tree"
            title="Arborescence du projet et editeur de fichier"
            onClick={() => selectView('tree')}
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
            className={`sc-btn sc-repo-btn${view === 'workspace' ? ' is-active' : ''}`}
            data-testid="sc-view-workspace"
            title="Branche et copies d’agents du workspace"
            onClick={() => selectView('workspace')}
          >
            Workspace
          </button>
        </div>

        {view === 'tree' && <ProjectPane conversationId={conversationId} racine={repoPath} />}

        {view !== 'brain' && view !== 'tree' && visibleGit && !visibleGit.available && (
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
                              <div className="sc-clean">
                                <Spinner /> Chargement du diff…
                              </div>
                            ) : diff.available ? (
                              <>
                                {diff.note ? <div className="sc-clean">{diff.note}</div> : null}
                                <DiffView diff={diff.diff ?? ''} />
                              </>
                            ) : (
                              <div className="sc-clean">Diff indisponible{diff.error ? ` : ${diff.error}` : '.'}</div>
                            )}
                          </div>
                          <div className="sc-diff-actions">
                            {/* ANNULER (demande du 2026-09-23) remplace « Expliquer / committer ».
                                Geste qui PERD du travail : un premier clic arme, le second envoie.
                                Comme les autres boutons, le panneau ne lance aucun git lui-meme. */}
                            <button
                              className={`sc-btn sc-diff-action${annulerArme === change.path ? ' is-armed' : ''}`}
                              data-testid="sc-diff-annuler"
                              onClick={(event) => {
                                event.stopPropagation()
                                if (annulerArme !== change.path) {
                                  setAnnulerArme(change.path)
                                  return
                                }
                                setAnnulerArme(null)
                                setAnnules((liste) =>
                                  liste.includes(change.path) ? liste : [...liste, change.path]
                                )
                                propose(
                                  `annule les changements de ${change.path} faits par cette conversation : ` +
                                    `remets-le dans son état d'avant. Avant d'annuler, garde une copie ` +
                                    `de ces changements dans artifacts/annules/ pour pouvoir les remettre. ` +
                                    `Ne touche pas aux modifications d'autres travaux dans ce fichier.`
                                )
                              }}
                            >
                              {annulerArme === change.path
                                ? 'Confirmer : annuler ces changements'
                                : 'Annuler ces changements'}
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
            {annules.map((path) => (
              <div className="sc-annule" data-testid="sc-annule" key={path}>
                <span className="sc-annule-path" title={path}>
                  ↺ {path}
                </span>
                <button
                  className="sc-btn"
                  data-testid="sc-remettre"
                  onClick={() => {
                    setAnnules((liste) => liste.filter((p) => p !== path))
                    propose(
                      `remets les changements de ${path} que tu viens d'annuler, ` +
                        `à partir de la copie gardée dans artifacts/annules/.`
                    )
                  }}
                >
                  Remettre le changement
                </button>
              </div>
            ))}
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

        {view === 'workspace' && visibleGit?.state && (
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
                    ? 'Activée — tente de publier chaque run vert sur une branche dédiée, jamais sur main. Clic : désactiver.'
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
            {autoCloseError && (
              <div className="sc-clean" data-testid="sc-autoclose-error" role="alert">
                {autoCloseError}
              </div>
            )}
            {autoClose?.last && (
              <div className="sc-autoclose-last" data-testid="sc-autoclose-last">
                <strong>Dernière clôture · {autoClose.last.runId}</strong>
                <span>{autoCloseResultLabel('Projet', autoClose.last.project)}</span>
                <span>{autoCloseResultLabel('Brain', autoClose.last.brain)}</span>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
