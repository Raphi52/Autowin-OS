import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  formatBytes,
  layoutWorktreeMap,
  summarizeWorktreeMap,
  worktreeLabel,
  type WorktreeMapEntry,
  type WorktreeMapLine,
  type WorktreeMapSnapshot,
  type WorktreeDoctorProposal
} from '../../../shared/worktree-map'
import type {
  WorktreeAgentActivity,
  WorktreeConflictResolutionChoice,
  WorktreeRuntimeStatus
} from '../../../shared/worktree-activity-model'
import type { WorktreeSection } from '../../../shared/navigation'
import { ViewTopBar } from './ViewTopBar'
import { WorktreeActivityView } from './WorktreeActivityView'
import './WorktreeMapView.css'

/**
 * Vue Worktrees — plan de metro des copies git.
 *
 * La geometrie vit dans `shared/worktree-map.ts` et y est testee sans DOM : ce composant ne fait
 * que rendre le plan et gerer la navigation. Deux regles de lecture, tenues sans exception :
 *  - une copie AVEC travail non commité monte au-dessus du tronc, une copie propre descend ;
 *  - l'abscisse ne represente PAS le retard (les trous d'historique sont declares par une
 *    cassure), sinon le canevas se vide la ou aucun worktree n'existe.
 */

// Le vocabulaire de couleurs est celui de l'app, pas une palette locale : la topologie git y est
// deja en cyan (cf. `GitTopology`), l'or porte l'alerte, le rose l'accent, `--text-faint` l'inerte.
const LATE = 'var(--gold)'
const LIVE = 'var(--rose)'
const CLOSED = 'var(--text-faint)'

/** Meme clé que Source control : choisir un dépôt dans une vue le choisit pour l'app. */
const REPO_STORAGE_KEY = 'autowin:sc-repo'

export function WorktreeMapView({ active }: { active: boolean }): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<WorktreeMapSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [activity, setActivity] = useState<WorktreeAgentActivity[]>([])
  const [runtimeStatus, setRuntimeStatus] = useState<WorktreeRuntimeStatus | null>(null)
  const [activityLoading, setActivityLoading] = useState(false)
  const [activityLoaded, setActivityLoaded] = useState(false)
  const [activityError, setActivityError] = useState<string | null>(null)
  const [activityNowMs, setActivityNowMs] = useState(() => Date.now())
  const [selected, setSelected] = useState<string | null>(null)
  // `carte` par défaut : c'est la question qu'on vient poser à cette vue (où en sont mes copies).
  const [section, setSection] = useState<WorktreeSection>('carte')
  const [repoPath, setRepoPath] = useState(() => localStorage.getItem(REPO_STORAGE_KEY) ?? '')
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const refreshGenerationRef = useRef(0)
  const activityGenerationRef = useRef(0)
  const [viewport, setViewport] = useState({ left: 0, width: 1 })

  const refresh = useCallback(async () => {
    const generation = ++refreshGenerationRef.current
    // Sortie du cycle de rendu avant tout `setState` : appelée depuis un effet, une ecriture
    // synchrone declencherait une cascade de rendus (et le lint la refuse, a juste titre).
    await Promise.resolve()
    // Pont absent (fenetre non privilegiee, test) : on le DIT, on ne laisse pas la promesse
    // rejetee remonter en erreur non capturee.
    const read = window.api?.getWorktreeMap
    if (!read) {
      if (generation === refreshGenerationRef.current)
        setSnapshot({ available: false, repoPath, entries: [], error: 'Bridge Git indisponible' })
      return
    }
    setLoading(true)
    try {
      const next = await read(repoPath || undefined)
      if (generation === refreshGenerationRef.current) setSnapshot(next)
    } catch (error) {
      if (generation === refreshGenerationRef.current)
        setSnapshot({
          available: false,
          repoPath,
          entries: [],
          error: error instanceof Error ? error.message : String(error)
        })
    } finally {
      if (generation === refreshGenerationRef.current) setLoading(false)
    }
  }, [repoPath])

  const refreshActivity = useCallback(async () => {
    const generation = ++activityGenerationRef.current
    await Promise.resolve()
    const readActivity = window.api?.getWorktreeActivity
    const readStatus = window.api?.getWorktreeStatus
    if (!readActivity || !readStatus) {
      if (generation === activityGenerationRef.current)
        setActivityError('Bridge des runs indisponible dans cette fenêtre.')
      return
    }
    setActivityLoading(true)
    const [activityResult, statusResult] = await Promise.allSettled([readActivity(), readStatus()])
    if (generation !== activityGenerationRef.current) return
    const errors: string[] = []
    if (activityResult.status === 'fulfilled') {
      setActivity(activityResult.value)
      setActivityLoaded(true)
    } else errors.push(errorMessage(activityResult.reason))
    if (statusResult.status === 'fulfilled') setRuntimeStatus(statusResult.value)
    else errors.push(errorMessage(statusResult.reason))
    setActivityNowMs(Date.now())
    setActivityError(errors.length > 0 ? errors.join(' · ') : null)
    setActivityLoading(false)
  }, [])

  const pickRepo = useCallback(async () => {
    const chosen = await window.api?.pickGitRepo?.()
    if (!chosen) return
    refreshGenerationRef.current += 1
    localStorage.setItem(REPO_STORAGE_KEY, chosen)
    setSelected(null)
    setRepoPath(chosen)
  }, [])

  useEffect(() => {
    // Deferré hors du rendu : lire puis ecrire l'etat de façon synchrone depuis un effet
    // declenche une cascade de rendus. La microtâche est vidée dans le meme tour, donc la
    // lecture reste immediate a l'oeil comme au test.
    if (active) queueMicrotask(() => void refresh())
    return () => {
      refreshGenerationRef.current += 1
    }
  }, [active, refresh])

  useEffect(() => {
    if (!active) return undefined
    queueMicrotask(() => void refreshActivity())
    const off = window.api?.onWorktreeActivity?.((next) => {
      // Le push live est plus récent qu'une lecture encore en vol : cette dernière ne doit pas
      // faire revenir l'interface en arrière lors de fins de runs concurrentes.
      activityGenerationRef.current += 1
      setActivity(next)
      setActivityLoaded(true)
      setActivityNowMs(Date.now())
      setActivityError(null)
      setActivityLoading(false)
    })
    return () => {
      activityGenerationRef.current += 1
      off?.()
    }
  }, [active, refreshActivity])

  const retryOffice = useCallback(
    async (agentId: string): Promise<void> => {
      const retry = window.api?.retryWorktreeRecovery
      if (!retry) throw new Error('Reprise indisponible depuis cette fenêtre.')
      await retry(agentId)
      await refreshActivity()
    },
    [refreshActivity]
  )

  const resolveConflict = useCallback(
    async (agentId: string, choice: WorktreeConflictResolutionChoice): Promise<void> => {
      const resolve = window.api?.resolveWorktreeConflict
      if (!resolve) throw new Error('Résolution indisponible depuis cette fenêtre.')
      const result = await resolve(agentId, choice)
      if (!result.resolved) {
        throw new Error(
          `${result.detail ?? 'Le conflit n’a pas pu être résolu.'} Rien n’a été écrasé.`
        )
      }
      await refreshActivity()
    },
    [refreshActivity]
  )

  // Memoïsé : `?? []` fabriquait un tableau NEUF a chaque rendu, donc les trois mémos qui en
  // dependent recalculaient la geometrie entiere a chaque frappe.
  const entries = useMemo(() => snapshot?.entries ?? [], [snapshot])
  const totals = useMemo(() => summarizeWorktreeMap(entries), [entries])
  const layout = useMemo(() => layoutWorktreeMap(entries), [entries])
  const byPath = useMemo(() => new Map(entries.map((entry) => [entry.path, entry])), [entries])

  const syncViewport = useCallback(() => {
    const node = scrollerRef.current
    if (!node || node.scrollWidth === 0) return
    const ratio = layout.width / node.scrollWidth
    setViewport({ left: node.scrollLeft * ratio, width: Math.max(node.clientWidth * ratio, 12) })
  }, [layout.width])

  useEffect(() => {
    syncViewport()
    const node = scrollerRef.current
    if (!node) return undefined
    node.addEventListener('scroll', syncViewport)
    window.addEventListener('resize', syncViewport)
    return () => {
      node.removeEventListener('scroll', syncViewport)
      window.removeEventListener('resize', syncViewport)
    }
  }, [syncViewport])

  /**
   * LA MOLETTE PARCOURT LE PLAN AU LIEU DE TOURNER DANS LE VIDE.
   *
   * Ce plan ne défile QUE latéralement : sa zone n'a aucune hauteur à parcourir. Une molette verticale
   * n'y produisait donc rien, devant une carte qui s'étend sur des milliers de pixels vers la droite.
   *
   * Écouteur NATIF et non `onWheel` de React : React attache ses gestionnaires de molette en mode
   * PASSIF, où `preventDefault()` est ignoré. Sans annulation, le geste remonterait aussi au conteneur
   * parent et ferait bouger deux choses à la fois.
   *
   * `deltaX` est laissé au navigateur : un trackpad horizontal défile déjà nativement, et y ajouter
   * notre conversion doublerait la distance parcourue.
   */
  useEffect(() => {
    const node = scrollerRef.current
    if (!node) return undefined
    const surMolette = (event: WheelEvent): void => {
      if (event.deltaX !== 0 || event.deltaY === 0) return
      node.scrollLeft += event.deltaY
      event.preventDefault()
    }
    node.addEventListener('wheel', surMolette, { passive: false })
    return () => node.removeEventListener('wheel', surMolette)
    // Dépend de `entries` : le scroller n'existe qu'UNE FOIS la lecture git revenue. Avec un tableau
    // vide, l'effet ne tournait qu'au premier rendu — là où `scrollerRef` est encore nul — et
    // l'écouteur n'était jamais attaché. La molette restait donc morte malgré le code présent.
  }, [entries])

  const jumpTo = useCallback((ratio: number) => {
    const node = scrollerRef.current
    if (!node) return
    node.scrollLeft = ratio * node.scrollWidth - node.clientWidth / 2
  }, [])

  const selectedEntry = selected ? byPath.get(selected) : undefined

  /**
   * VALEURS DE LA BARRE D'ÉTAT. Règle unique : ne jamais présenter comme mesuré ce qui ne l'est pas.
   * `dirtyFiles` et `sizeBytes` sont optionnels dans le modèle précisément parce que la mesure peut
   * ne pas avoir eu lieu — l'ancienne barre, elle, affichait `changeCount ?? 0`, donc « 0 changement »
   * sur un dépôt qu'on n'avait pas lu. On restaure la barre sans restaurer ce défaut.
   */
  const brancheCourante =
    entries.find((entry) => entry.path === snapshot?.repoPath)?.branch ??
    snapshot?.baseBranch ??
    entries.find((entry) => entry.branch)?.branch

  const mesurees = entries.filter((entry) => entry.dirtyFiles !== undefined)
  const changementsLocaux =
    mesurees.length === 0
      ? 'non mesuré'
      : String(mesurees.reduce((somme, entry) => somme + (entry.dirtyFiles ?? 0), 0))

  const alertes =
    snapshot?.available === false
      ? 'lecture git impossible'
      : // `findings`, PAS `proposals` : j'avais deviné ce nom et le typecheck l'a attrapé. Une barre
        // d'état qui compte un champ inexistant afficherait un zéro rassurant — et faux.
        String(
          (snapshot?.doctor?.findings.length ?? 0) +
            entries.filter((entry) => entry.pathExists === false || entry.prunableReason).length
        )

  const sante: { ton: string; libelle: string } =
    snapshot?.available === false
      ? { ton: 'unavailable', libelle: 'Git indisponible' }
      : totals.count > 0 && totals.unknown === totals.count
        ? { ton: 'unknown', libelle: 'État non mesuré' }
        : totals.dirty > 0
          ? { ton: 'stale', libelle: 'Travail en cours' }
          : { ton: 'clean', libelle: 'Propre' }

  return (
    <div className="wtmap" data-testid="worktree-map">
      {/* MÊME en-tête que Task Manager, Agent Studio et Settings : la vue portait un en-tête maison
          (surtitre + titre collés, boutons dans le même bloc que les compteurs), d'où la régression
          visuelle signalée. Worktrees n'a pas de sections : `ViewTopBar` rend alors l'identité et les
          actions, sans barre d'onglets vide. */}
      <ViewTopBar
        eyebrow="WORKTREES"
        title={snapshot?.repositoryName ?? 'Dépôt'}
        description={snapshot?.repoPath || repoPath || 'Dépôt courant'}
        ariaLabel="Sections Worktrees"
        active={section}
        onSelect={setSection}
        tabs={[
          { id: 'carte', label: 'Carte' },
          { id: 'activite', label: 'Activité' },
          {
            id: 'sante',
            label: 'Santé',
            // Le nombre de constats du doctor, visible depuis les deux autres onglets : sinon un
            // dépôt en vrac ne se signale qu'à celui qui pense à ouvrir l'onglet.
            anomaly: {
              count: snapshot?.doctor?.findings.length ?? 0,
              title: `Constat(s) sur le dépôt : ${snapshot?.doctor?.findings.length ?? 0}`,
              testId: 'worktree-anomaly-sante'
            }
          }
        ]}
        actions={
          <>
            <button onClick={() => void pickRepo()} data-testid="worktree-map-pick">
              Choisir un dépôt
            </button>
            <button onClick={() => void refresh()} disabled={loading}>
              {loading ? 'Lecture…' : 'Actualiser'}
            </button>
          </>
        }
      />

      {/* Tant qu'aucun snapshot n'est arrivé, des compteurs à zéro MENTIRAIENT : on ne montre
          que l'indicateur de lecture, pas un tableau de bord vide. */}
      <div className="wtmap-header" hidden={!snapshot}>
        <div className="wtmap-stats">
          <Stat value={String(totals.count)} label="worktrees" />
          <Stat value={String(totals.dirty)} label="avec travail" tone="live" />
          <Stat value={String(totals.clean)} label="propres" tone="clean" />
          {totals.unknown > 0 && (
            <Stat value={String(totals.unknown)} label="non mesurés" tone="unknown" />
          )}
          {/* Une taille NON MESURÉE n'est pas zéro. `totalBytes` vaut 0 aussi bien quand les copies
              sont vides que quand personne n'a mesuré — et la mesure n'est pas activée par défaut,
              donc « 0 o au total » était le cas COURANT, affirmé comme un fait. On ne montre un
              chiffre que si au moins une taille a été relevée. */}
          {totals.measuredSizes > 0 ? (
            <>
              <Stat value={formatBytes(totals.totalBytes)} label="au total" />
              <Stat value={formatBytes(totals.reclaimableBytes)} label="récupérables" tone="live" />
            </>
          ) : (
            <Stat value="non mesuré" label="taille disque" tone="unknown" />
          )}
          <Stat
            value={snapshot?.baseHead ?? '—'}
            label={`référence ${snapshot?.baseBranch ?? '—'}`}
            tone="ref"
          />
        </div>
      </div>

      {/* BARRE D'ÉTAT GIT restaurée. Elle vivait dans `WorktreeView.tsx` sous le nom `project-strip`
          et a disparu avec le remplacement de la vue (commit 4af73b5, 2026-08-06) : les compteurs qui
          l'ont remplacée disent le nombre de copies, mais plus la BRANCHE ni les CHANGEMENTS LOCAUX —
          les deux informations qu'on vient chercher en premier sur un dépôt.
          Chaque cellule dit « non mesuré » plutôt qu'un zéro quand la donnée manque : c'est la leçon
          de l'en-tête d'à côté, qui affichait « 0 o » sans avoir rien mesuré. */}
      {snapshot && (
        <section className={`project-strip is-${sante.ton}`} aria-label="État du dépôt">
          <div>
            <span>Santé du projet</span>
            <strong>{sante.libelle}</strong>
          </div>
          <div>
            <span>Branche</span>
            <strong>{brancheCourante ?? 'Inconnue'}</strong>
          </div>
          <div>
            <span>Changements locaux</span>
            <strong>{changementsLocaux}</strong>
          </div>
          <div>
            <span>Travaux actifs</span>
            <strong>{totals.unknown === totals.count ? 'non mesuré' : totals.dirty}</strong>
          </div>
          <div>
            <span>Alertes</span>
            <strong>{alertes}</strong>
          </div>
        </section>
      )}

      {!snapshot && (
        <p className="wtmap-notice" role="status" data-testid="worktree-map-loading">
          Lecture des worktrees…
        </p>
      )}

      {snapshot && !snapshot.available && (
        <section className="wtmap-notice is-error" role="alert" data-testid="worktree-map-error">
          <b>Lecture git impossible</b>
          <p>{explainWorktreeError(snapshot.error)}</p>
          {snapshot.error && <code className="wtmap-notice-raw">{snapshot.error}</code>}
          <div className="wtmap-notice-actions">
            <button
              onClick={() => void refresh()}
              disabled={loading}
              data-testid="worktree-map-retry"
            >
              Réessayer
            </button>
            <button onClick={() => void pickRepo()} data-testid="worktree-map-error-pick">
              Choisir un dépôt
            </button>
          </div>
        </section>
      )}
      {snapshot?.available && entries.length === 0 && (
        <p className="wtmap-notice" role="status">
          Aucun worktree — ce dépôt n’a que sa copie principale.
        </p>
      )}

      {section === 'sante' && snapshot?.available && snapshot.doctor && (
        <WorktreeDoctor report={snapshot.doctor} />
      )}
      {section === 'sante' && snapshot?.available && !snapshot.doctor && (
        <p className="wtmap-notice" role="status" data-testid="worktree-sante-vide">
          Aucun diagnostic pour ce dépôt.
        </p>
      )}

      {section === 'activite' && (
        <section className="wtmap-activity" data-testid="worktree-activity-panel">
          <div className="wtmap-activity-head">
            <b>Runs et bureaux agents</b>
            {activityLoading && <span role="status">Lecture de l’activité…</span>}
          </div>
          {activityError && (
            <div
              className="wtmap-notice is-error"
              role="alert"
              data-testid="worktree-activity-error"
            >
              <b>Lecture partielle</b>
              <p>{activityError}</p>
              <button
                onClick={() => void refreshActivity()}
                disabled={activityLoading}
                data-testid="worktree-activity-retry"
              >
                Réessayer
              </button>
            </div>
          )}
          {activityLoaded && (
            <WorktreeActivityView
              agents={activity}
              status={runtimeStatus}
              nowMs={activityNowMs}
              onOpenOffice={(path) => window.api.openFolder(path)}
              onRetryOffice={retryOffice}
              onResolveConflictChoice={resolveConflict}
            />
          )}
        </section>
      )}

      {section === 'carte' && entries.length > 0 && (
        <>
          <div className="wtmap-area">
            <span className="wtmap-territory is-up">↑ vivant — réclame ton attention</span>
            <span className="wtmap-territory is-down">
              ↓ fermé — à curer · inconnu — à vérifier
            </span>
            <div className="wtmap-scroller" ref={scrollerRef} data-testid="worktree-map-scroller">
              <svg
                className="wtmap-plan"
                width={layout.width}
                height={layout.height}
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                role="img"
                aria-label={`Plan des ${totals.count} worktrees, ${totals.dirty} avec travail non commité`}
              >
                <rect
                  x={0}
                  y={0}
                  width={layout.width}
                  height={layout.trunkY}
                  className="wtmap-band is-up"
                />
                <rect
                  x={0}
                  y={layout.trunkY}
                  width={layout.width}
                  height={layout.height - layout.trunkY}
                  className="wtmap-band is-down"
                />

                {layout.lines.map((line) => (
                  <Line
                    key={`${line.kind}:${line.entryPaths.join('|')}`}
                    line={line}
                    entries={byPath}
                    selected={selected}
                    onSelect={setSelected}
                  />
                ))}

                <line
                  x1={24}
                  y1={layout.trunkY}
                  x2={layout.width - 24}
                  y2={layout.trunkY}
                  className="wtmap-trunk"
                />

                {layout.interchanges.map((ic) => (
                  <g key={ic.head}>
                    {ic.skipped !== undefined && ic.breakX !== undefined && (
                      <Break x={ic.breakX} y={layout.trunkY} skipped={ic.skipped} />
                    )}
                    <circle
                      cx={ic.x}
                      cy={layout.trunkY}
                      r={12}
                      className="wtmap-ic-outer"
                      stroke={ic.late ? LATE : 'var(--cyan)'}
                    />
                    <circle
                      cx={ic.x}
                      cy={layout.trunkY}
                      r={5}
                      fill={ic.late ? LATE : 'var(--surface-inset)'}
                    />
                    {/* Pastille a fond opaque : sans elle le tronc barre le texte. */}
                    <rect
                      x={ic.x - 56}
                      y={layout.trunkY + 17}
                      width={112}
                      height={34}
                      rx={4}
                      className="wtmap-chip"
                      stroke={ic.late ? LATE : 'var(--container-border-strong)'}
                    />
                    <text x={ic.x} y={layout.trunkY + 31} className="wtmap-chip-sha">
                      {ic.head}
                    </text>
                    <text
                      x={ic.x}
                      y={layout.trunkY + 45}
                      className="wtmap-chip-sub"
                      fill={ic.late ? LATE : CLOSED}
                    >
                      {ic.behind === 0 ? 'à jour' : `retard ${ic.behind}`}
                    </text>
                  </g>
                ))}
              </svg>
            </div>
          </div>

          <div className="wtmap-mini">
            <p className="wtmap-mini-cap">
              Navigation — cliquez pour sauter · le cadre clair est la portion visible
            </p>
            <svg
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              preserveAspectRatio="none"
              data-testid="worktree-map-minimap"
              onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect()
                jumpTo((event.clientX - box.left) / box.width)
              }}
            >
              {layout.lines.map((line) => (
                <polyline
                  key={`mini:${line.entryPaths.join('|')}`}
                  points={line.points.map(([x, y]) => `${x},${y}`).join(' ')}
                  className={`wtmap-mini-line is-${line.kind}`}
                  stroke={line.kind === 'unknown' ? LATE : undefined}
                  strokeDasharray={line.kind === 'unknown' ? '10 8' : undefined}
                />
              ))}
              <line
                x1={24}
                y1={layout.trunkY}
                x2={layout.width - 24}
                y2={layout.trunkY}
                className="wtmap-mini-trunk"
              />
              {layout.interchanges.map((ic) => (
                <circle
                  key={`mini:${ic.head}`}
                  cx={ic.x}
                  cy={layout.trunkY}
                  r={16}
                  fill={ic.late ? LATE : 'var(--cyan)'}
                />
              ))}
              <rect
                x={viewport.left}
                y={2}
                width={viewport.width}
                height={layout.height - 4}
                className="wtmap-mini-viewport"
              />
            </svg>
          </div>
        </>
      )}

      {section === 'carte' && selectedEntry && (
        <aside className="wtmap-detail" data-testid="worktree-map-detail">
          <div className="wtmap-detail-head">
            <b>{worktreeLabel(selectedEntry)}</b>
            <button className="btn btn-ghost" onClick={() => setSelected(null)} aria-label="Fermer">
              ✕
            </button>
          </div>
          <dl>
            <dt>Chemin</dt>
            <dd className="mono">{selectedEntry.path}</dd>
            <dt>HEAD</dt>
            <dd className="mono">
              {selectedEntry.head}
              {selectedEntry.detached ? ' · détaché' : ''}
              {selectedEntry.locked ? ' · verrouillé' : ''}
            </dd>
            <dt>Retard</dt>
            <dd>{describeBehind(selectedEntry)}</dd>
            <dt>Travail local</dt>
            <dd>{describeDirty(selectedEntry)}</dd>
            <dt>Taille</dt>
            <dd>
              {selectedEntry.sizeBytes === undefined
                ? 'non mesurée'
                : formatBytes(selectedEntry.sizeBytes)}
            </dd>
          </dl>
        </aside>
      )}
    </div>
  )
}

function WorktreeDoctor({
  report
}: {
  report: NonNullable<WorktreeMapSnapshot['doctor']>
}): React.JSX.Element {
  const count = report.findings.length
  return (
    <section className={`wtmap-doctor is-${report.status}`} data-testid="worktree-doctor">
      <div className="wtmap-doctor-head">
        <b>
          {report.status === 'healthy'
            ? 'Docteur : sain'
            : `Docteur : ${count} point${count > 1 ? 's' : ''} à vérifier`}
        </b>
        <span>Lecture seule · Jamais exécuté automatiquement</span>
      </div>
      {report.findings.map((finding) => (
        <div
          className={`wtmap-doctor-card is-${finding.severity}`}
          key={`${finding.code}:${finding.path}`}
        >
          <div>
            <strong>{doctorLabel(finding.code)}</strong>
            <span className="mono">{finding.path}</span>
          </div>
          <p>{finding.evidence}</p>
          {finding.proposals.map((proposal) => (
            <div
              className="wtmap-doctor-command"
              key={`${proposal.action}:${proposal.argv.join('\0')}`}
            >
              <code>{formatGitCommand(proposal)}</code>
              <button
                className="btn btn-ghost"
                onClick={() => void navigator.clipboard?.writeText(formatGitCommand(proposal))}
                title={proposal.reason}
              >
                Copier
              </button>
            </div>
          ))}
        </div>
      ))}
    </section>
  )
}

/**
 * Traduit la sortie technique en cause LISIBLE et actionnable : le message git brut seul laisse
 * l'utilisateur sans issue. Les trois cas usuels sont nommés, le reste tombe sur un générique.
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function explainWorktreeError(raw: string | undefined): string {
  const text = (raw ?? '').toLowerCase()
  if (!raw)
    return 'Raison inconnue. Réessayez la lecture, ou choisissez explicitement le dépôt à lire.'
  if (text.includes('bridge') || text.includes('pont') || text.includes('ipc'))
    return 'Le pont interne (IPC) entre la fenêtre et le processus principal n’est pas disponible : cette vue ne peut pas interroger git. Relancez l’application, puis réessayez.'
  if (text.includes('not a git repository') || text.includes('pas un dépôt'))
    return 'Ce dossier n’est pas un dépôt git. Choisissez un dépôt valide (le dossier qui contient .git).'
  if (text.includes('enoent') || text.includes('introuvable') || text.includes('not found'))
    return 'Git est introuvable sur cette machine (absent du PATH). Installez git ou ouvrez l’application depuis un environnement où `git` répond.'
  return 'La lecture git a échoué. Réessayez, ou choisissez un autre dépôt ; le détail technique est ci-dessous.'
}

function doctorLabel(
  code: NonNullable<WorktreeMapSnapshot['doctor']>['findings'][number]['code']
): string {
  if (code === 'prunable') return 'Métadonnées orphelines'
  if (code === 'missing') return 'Dossier absent'
  if (code === 'unreadable') return 'Copie illisible par Git'
  return 'Copie verrouillée'
}

function formatGitCommand(proposal: WorktreeDoctorProposal): string {
  const quote = (arg: string): string => (/\s/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg)
  return ['git', ...proposal.argv].map(quote).join(' ')
}

function describeBehind(entry: WorktreeMapEntry): string {
  if (entry.behind === undefined) return 'non calculable'
  if (entry.behind === 0) return 'à jour'
  return `${entry.behind} commit${entry.behind > 1 ? 's' : ''} de retard`
}

function describeDirty(entry: WorktreeMapEntry): string {
  if (entry.dirtyFiles === undefined) return 'non mesuré'
  if (entry.dirtyFiles === 0) return 'propre — récupérable'
  return `${entry.dirtyFiles} fichier${entry.dirtyFiles > 1 ? 's' : ''} non commité${entry.dirtyFiles > 1 ? 's' : ''}`
}

function Stat({
  value,
  label,
  tone
}: {
  value: string
  label: string
  tone?: 'live' | 'clean' | 'unknown' | 'ref'
}): React.JSX.Element {
  return (
    <span className={`wtmap-stat${tone ? ` is-${tone}` : ''}`}>
      <b>{value}</b>
      <span>{label}</span>
    </span>
  )
}

/** Cassure : deux obliques sur le tronc, qui DECLARENT les commits sans worktree. */
function Break({ x, y, skipped }: { x: number; y: number; skipped: number }): React.JSX.Element {
  return (
    <g data-testid="worktree-map-break">
      <rect x={x - 17} y={y - 10} width={34} height={20} className="wtmap-break-mask" />
      {[-9, 3].map((dx) => (
        <line
          key={dx}
          x1={x + dx}
          y1={y + 12}
          x2={x + dx + 12}
          y2={y - 12}
          className="wtmap-break"
        />
      ))}
      <text x={x} y={y - 26} className="wtmap-break-label">
        {skipped} commit{skipped > 1 ? 's' : ''} sauté{skipped > 1 ? 's' : ''}
      </text>
    </g>
  )
}

function Line({
  line,
  entries,
  selected,
  onSelect
}: {
  line: WorktreeMapLine
  entries: Map<string, WorktreeMapEntry>
  selected: string | null
  onSelect: (path: string) => void
}): React.JSX.Element {
  const live = line.kind === 'live'
  const unknown = line.kind === 'unknown'
  const [tx, ty] = line.terminus
  const goesRight = line.points[line.points.length - 1][0] >= line.points[0][0]
  return (
    <g>
      <polyline
        points={line.points.map(([x, y]) => `${x},${y}`).join(' ')}
        className={`wtmap-line is-${line.kind}`}
        stroke={unknown ? LATE : undefined}
        strokeWidth={unknown ? 4 : undefined}
        strokeDasharray={unknown ? '10 8' : undefined}
      />
      {line.stations.map((station) => {
        const entry = entries.get(station.entryPath)
        const isSelected = selected === station.entryPath
        return (
          <g
            key={station.entryPath}
            className={`wtmap-station${isSelected ? ' is-selected' : ''}`}
            role="button"
            tabIndex={0}
            aria-label={`${entry ? worktreeLabel(entry) : station.entryPath} — ${entry ? describeDirty(entry) : 'état inconnu'}`}
            onClick={() => onSelect(station.entryPath)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') onSelect(station.entryPath)
            }}
          >
            <circle
              cx={station.x}
              cy={station.y}
              r={station.dirtyFiles ? 6.5 : 5}
              fill={station.dirtyFiles ? LIVE : 'var(--surface-inset)'}
              stroke={station.dirtyFiles ? LIVE : unknown ? LATE : live ? LIVE : CLOSED}
              strokeWidth={3}
            />
            {station.dirtyFiles !== undefined && (
              <text x={station.x} y={station.y - 13} className="wtmap-station-label">
                {station.dirtyFiles} fich.
              </text>
            )}
          </g>
        )
      })}
      {live ? (
        <>
          <circle cx={tx} cy={ty} r={9} className="wtmap-terminus is-live" />
          <circle cx={tx} cy={ty} r={3.5} fill={LIVE} />
        </>
      ) : unknown ? (
        <>
          <circle
            cx={tx}
            cy={ty}
            r={10}
            fill="var(--surface-panel)"
            stroke={LATE}
            strokeWidth={2}
          />
          <text x={tx} y={ty + 4} textAnchor="middle" fill={LATE} fontWeight={700}>
            ?
          </text>
        </>
      ) : (
        <>
          <circle cx={tx} cy={ty} r={10} className="wtmap-terminus is-closed" />
          <line x1={tx - 5.5} y1={ty - 5.5} x2={tx + 5.5} y2={ty + 5.5} className="wtmap-cross" />
          <line x1={tx - 5.5} y1={ty + 5.5} x2={tx + 5.5} y2={ty - 5.5} className="wtmap-cross" />
        </>
      )}
      <text
        x={tx + (goesRight ? 16 : -16)}
        y={ty + 4}
        textAnchor={goesRight ? 'start' : 'end'}
        className={`wtmap-terminus-label is-${line.kind}`}
        fill={unknown ? LATE : undefined}
      >
        {line.label}
      </text>
      <text
        x={tx + (goesRight ? 16 : -16)}
        y={ty + 18}
        textAnchor={goesRight ? 'start' : 'end'}
        className="wtmap-terminus-sub"
      >
        {line.entryPaths
          .map((path) => {
            const entry = entries.get(path)
            return entry ? worktreeLabel(entry) : path
          })
          .join(' · ')}
      </text>
    </g>
  )
}
