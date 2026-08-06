import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  formatBytes,
  layoutWorktreeMap,
  summarizeWorktreeMap,
  worktreeLabel,
  type WorktreeMapEntry,
  type WorktreeMapLine,
  type WorktreeMapSnapshot
} from '../../../shared/worktree-map'
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
  const [selected, setSelected] = useState<string | null>(null)
  const [repoPath, setRepoPath] = useState(() => localStorage.getItem(REPO_STORAGE_KEY) ?? '')
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState({ left: 0, width: 1 })

  const refresh = useCallback(async () => {
    // Sortie du cycle de rendu avant tout `setState` : appelée depuis un effet, une ecriture
    // synchrone declencherait une cascade de rendus (et le lint la refuse, a juste titre).
    await Promise.resolve()
    // Pont absent (fenetre non privilegiee, test) : on le DIT, on ne laisse pas la promesse
    // rejetee remonter en erreur non capturee.
    const read = window.api?.getWorktreeMap
    if (!read) {
      setSnapshot({ available: false, repoPath, entries: [], error: 'Bridge Git indisponible' })
      return
    }
    setLoading(true)
    try {
      setSnapshot(await read(repoPath || undefined))
    } catch (error) {
      setSnapshot({
        available: false,
        repoPath,
        entries: [],
        error: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setLoading(false)
    }
  }, [repoPath])

  const pickRepo = useCallback(async () => {
    const chosen = await window.api?.pickGitRepo?.()
    if (!chosen) return
    localStorage.setItem(REPO_STORAGE_KEY, chosen)
    setSelected(null)
    setRepoPath(chosen)
  }, [])

  useEffect(() => {
    // Deferré hors du rendu : lire puis ecrire l'etat de façon synchrone depuis un effet
    // declenche une cascade de rendus. La microtâche est vidée dans le meme tour, donc la
    // lecture reste immediate a l'oeil comme au test.
    if (active) queueMicrotask(() => void refresh())
  }, [active, refresh])

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

  const jumpTo = useCallback((ratio: number) => {
    const node = scrollerRef.current
    if (!node) return
    node.scrollLeft = ratio * node.scrollWidth - node.clientWidth / 2
  }, [])

  const selectedEntry = selected ? byPath.get(selected) : undefined

  return (
    <div className="wtmap" data-testid="worktree-map">
      <header className="wtmap-header">
        <div className="module-header">
          <span>Worktrees</span>
          <h1>{snapshot?.repositoryName ?? 'Dépôt'}</h1>
          <span className="wtmap-path">{snapshot?.repoPath || repoPath || 'Dépôt courant'}</span>
        </div>
        <div className="wtmap-spacer" />
        <div className="wtmap-stats">
          <Stat value={String(totals.count)} label="worktrees" />
          <Stat value={String(totals.dirty)} label="avec travail" tone="live" />
          <Stat value={String(totals.clean)} label="propres" tone="clean" />
          {totals.unknown > 0 && (
            <Stat value={String(totals.unknown)} label="non mesurés" tone="unknown" />
          )}
          <Stat value={formatBytes(totals.totalBytes)} label="au total" />
          <Stat value={formatBytes(totals.reclaimableBytes)} label="récupérables" tone="live" />
          <Stat
            value={snapshot?.baseHead ?? '—'}
            label={`référence ${snapshot?.baseBranch ?? '—'}`}
            tone="ref"
          />
        </div>
        <div className="wtmap-actions">
          <button onClick={() => void pickRepo()} data-testid="worktree-map-pick">
            Choisir un dépôt
          </button>
          <button onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Lecture…' : 'Actualiser'}
          </button>
        </div>
      </header>

      {snapshot && !snapshot.available && (
        <p className="wtmap-notice" role="status" data-testid="worktree-map-error">
          Lecture git impossible — {snapshot.error ?? 'raison inconnue'}
        </p>
      )}
      {snapshot?.available && entries.length === 0 && (
        <p className="wtmap-notice" role="status">
          Aucun worktree — ce dépôt n’a que sa copie principale.
        </p>
      )}

      {entries.length > 0 && (
        <>
          <div className="wtmap-area">
            <span className="wtmap-territory is-up">↑ vivant — réclame ton attention</span>
            <span className="wtmap-territory is-down">↓ fermé — à curer</span>
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

      {selectedEntry && (
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
  const [tx, ty] = line.terminus
  const goesRight = line.points[line.points.length - 1][0] >= line.points[0][0]
  return (
    <g>
      <polyline
        points={line.points.map(([x, y]) => `${x},${y}`).join(' ')}
        className={`wtmap-line is-${line.kind}`}
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
            aria-label={`${entry ? worktreeLabel(entry) : station.entryPath} — ${
              station.dirtyFiles ? `${station.dirtyFiles} fichiers non commités` : 'propre'
            }`}
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
              stroke={station.dirtyFiles ? LIVE : live ? LIVE : CLOSED}
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
