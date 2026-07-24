import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  GitGraphCommit,
  GitGraphRefKind,
  GitGraphSnapshot
} from '../../../shared/git-graph'
import { ModuleHeader } from './ModuleHeader'
import { commitsReachableFromRefs, layoutGitGraph } from './GitGraphLayout'
import './WorktreeView.css'

type CenterMode = 'topology' | 'chronology' | 'remote' | 'tags'

const laneColors = [
  'var(--cyan)',
  'var(--violet)',
  'var(--mint)',
  'var(--orange)',
  'var(--rose)',
  'var(--gold)'
]

const kindLabel: Record<GitGraphRefKind, string> = {
  local: 'locale',
  remote: 'distante',
  tag: 'tag'
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('fr-FR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).format(date)
}

function GitTopology({
  commits,
  selectedHash,
  onSelect
}: {
  commits: GitGraphCommit[]
  selectedHash?: string
  onSelect: (commit: GitGraphCommit) => void
}): React.JSX.Element {
  const layout = useMemo(() => layoutGitGraph(commits), [commits])
  return (
    <div className="git-ledger__graph-scroll" data-testid="git-topology">
      <svg
        className="git-ledger__graph"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        width={layout.width}
        height={layout.height}
        aria-label="Topologie des commits Git"
        role="img"
      >
        {layout.edges.map((edge) => {
          const color = laneColors[edge.lane % laneColors.length]
          const middleY = edge.from.y + Math.max(20, (edge.to.y - edge.from.y) * 0.48)
          return (
            <path
              key={`${edge.from.commit.hash}-${edge.to.commit.hash}`}
              d={`M ${edge.from.x} ${edge.from.y} C ${edge.from.x} ${middleY}, ${edge.to.x} ${middleY}, ${edge.to.x} ${edge.to.y}`}
              fill="none"
              stroke={color}
              strokeWidth="2"
              opacity="0.82"
            />
          )
        })}
        {layout.nodes.map((node) => {
          const selected = node.commit.hash === selectedHash
          const color = laneColors[node.lane % laneColors.length]
          const important = selected || node.commit.refs.length > 0
          return (
            <g
              key={node.commit.hash}
              className={`git-ledger__node${selected ? ' is-selected' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(node.commit)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') onSelect(node.commit)
              }}
            >
              <circle
                cx={node.x}
                cy={node.y}
                r={selected ? 7 : 5}
                fill="var(--surface-inset)"
                stroke={color}
                strokeWidth={selected ? 3 : 2}
              />
              <text x={node.x + 15} y={node.y + 4} className="git-ledger__hash">
                {node.commit.shortHash}
              </text>
              {important && (
                <text x={node.x + 76} y={node.y + 4} className="git-ledger__subject">
                  {node.commit.subject}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export function WorktreeView({ active }: { active: boolean }): React.JSX.Element {
  return <WorktreeViewSession key={active ? 'active' : 'inactive'} active={active} />
}

function WorktreeViewSession({ active }: { active: boolean }): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<GitGraphSnapshot>()
  const [selectedHash, setSelectedHash] = useState<string>()
  const [mode, setMode] = useState<CenterMode>('topology')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const requestId = useRef(0)
  const [repoPath, setRepoPath] = useState(
    () => localStorage.getItem('autowin:sc-repo') ?? ''
  )

  const load = useCallback(async (): Promise<void> => {
    const id = ++requestId.current
    if (typeof window.api?.getGitGraph !== 'function') {
      setSnapshot({
        available: false,
        repoPath,
        error: 'Bridge Git indisponible'
      })
      return
    }
    setLoading(true)
    try {
      const next = await window.api.getGitGraph(repoPath || undefined)
      if (id !== requestId.current) return
      setSnapshot(next)
      const preferred =
        next.commits?.find((commit) => commit.shortHash === next.head) ?? next.commits?.[0]
      setSelectedHash((current) =>
        next.commits?.some((commit) => commit.hash === current) ? current : preferred?.hash
      )
    } catch (error) {
      if (id === requestId.current) {
        setSnapshot({
          available: false,
          repoPath,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [repoPath])

  useEffect(() => {
    if (active) void load()
    return () => {
      requestId.current += 1
    }
  }, [active, load])

  const pickRepo = async (): Promise<void> => {
    const chosen = await window.api.pickGitRepo?.()
    if (!chosen) return
    localStorage.setItem('autowin:sc-repo', chosen)
    setRepoPath(chosen)
  }

  const refs = snapshot?.refs ?? []
  const commits = snapshot?.commits ?? []
  const worktrees = snapshot?.worktrees ?? []
  const normalizedQuery = query.trim().toLocaleLowerCase('fr')
  const filteredRefs = refs.filter((ref) =>
    `${ref.name} ${ref.hash}`.toLocaleLowerCase('fr').includes(normalizedQuery)
  )
  const visibleRefs =
    mode === 'remote'
      ? filteredRefs.filter((ref) => ref.kind === 'remote')
      : mode === 'tags'
        ? filteredRefs.filter((ref) => ref.kind === 'tag')
        : filteredRefs
  const topologyIsFiltered = normalizedQuery.length > 0 || mode === 'remote' || mode === 'tags'
  const visibleCommits = topologyIsFiltered
    ? commitsReachableFromRefs(commits, visibleRefs)
    : commits
  const selectedCommit =
    visibleCommits.find((commit) => commit.hash === selectedHash) ?? visibleCommits[0]

  return (
    <section className="worktree-tab" data-active={active}>
      <header className="git-ledger__header">
        <div>
          <ModuleHeader eyebrow="Cartographie Git" title="Références & historique" />
          <span className="git-ledger__path" title={snapshot?.repoPath || repoPath}>
            {snapshot?.repoPath || repoPath || 'Dépôt courant'}
          </span>
        </div>
        <div className="git-ledger__metrics" aria-live="polite">
          <span>
            <strong>{snapshot?.changeCount ?? 0}</strong>
            modifications
          </span>
          <span>
            <strong>{refs.length}</strong>
            références
          </span>
          <span>
            <strong>{worktrees.length}</strong>
            worktrees
          </span>
          <button type="button" onClick={() => void pickRepo()}>
            Choisir
          </button>
          <button type="button" onClick={() => void load()} disabled={loading}>
            {loading ? 'Actualisation…' : 'Actualiser'}
          </button>
        </div>
      </header>

      {loading && snapshot === undefined ? (
        <div className="git-ledger__state" role="status">
          Lecture de la topologie Git…
        </div>
      ) : snapshot?.available === false ? (
        <div className="git-ledger__state is-error" role="alert">
          <strong>Dépôt Git introuvable</strong>
          <span>Choisis un dépôt versionné ou vérifie le chemin configuré.</span>
          {snapshot.error && <code>{snapshot.error}</code>}
        </div>
      ) : (
        <div className="git-ledger__shell">
          <aside className="git-ledger__ledger" aria-label="Références et worktrees">
            <label className="git-ledger__search">
              <span>Rechercher</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Branche, tag, hash…"
              />
            </label>
            <div className="git-ledger__section-head">
              <span>Branche / référence</span>
              <span>HEAD</span>
              <span>État</span>
            </div>
            <div className="git-ledger__rows">
              {visibleRefs.map((ref) => (
                <button
                  type="button"
                  key={ref.fullName}
                  className={selectedCommit?.hash === ref.hash ? 'is-selected' : ''}
                  onClick={() => {
                    const commit = commits.find((candidate) => candidate.hash === ref.hash)
                    if (commit) setSelectedHash(commit.hash)
                  }}
                >
                  <span className={`git-ledger__dot is-${ref.kind}`} />
                  <span title={ref.fullName}>
                    <strong>{ref.name}</strong>
                    <small>{ref.kind === 'local' ? ref.fullName.replace('refs/heads/', '') : ref.fullName}</small>
                  </span>
                  <code>{ref.hash.slice(0, 7)}</code>
                  <em>{ref.isHead ? 'HEAD' : kindLabel[ref.kind]}</em>
                </button>
              ))}
              {visibleRefs.length === 0 && (
                <p className="git-ledger__empty">Aucune référence correspondante.</p>
              )}
            </div>
            <div className="git-ledger__section-head is-worktrees">
              <span>Worktree</span>
              <span>Branche</span>
              <span>Mode</span>
            </div>
            <div className="git-ledger__worktrees">
              {worktrees.map((worktree) => (
                <button
                  type="button"
                  key={worktree.path}
                  onClick={() => {
                    const commit = commits.find((candidate) => candidate.hash === worktree.head)
                    if (commit) setSelectedHash(commit.hash)
                  }}
                >
                  <code title={worktree.path}>{worktree.path}</code>
                  <span title={worktree.branch ?? 'detached'}>
                    {worktree.branch ?? 'detached'}
                  </span>
                  <em>{worktree.locked ? 'lock' : 'rw'}</em>
                </button>
              ))}
            </div>
          </aside>

          <main className="git-ledger__center">
            <nav className="git-ledger__tabs" aria-label="Vue du dépôt">
              {(
                [
                  ['topology', 'Topologie'],
                  ['chronology', 'Chronologie'],
                  ['remote', 'Refs distantes'],
                  ['tags', 'Tags']
                ] as Array<[CenterMode, string]>
              ).map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={mode === value ? 'is-active' : ''}
                  onClick={() => setMode(value)}
                >
                  {label}
                </button>
              ))}
              {snapshot?.truncated && <small>Historique récent borné · références anciennes incluses</small>}
            </nav>
            {mode === 'topology' ? (
              <GitTopology
                commits={visibleCommits}
                selectedHash={selectedCommit?.hash}
                onSelect={(commit) => setSelectedHash(commit.hash)}
              />
            ) : mode === 'chronology' ? (
              <div className="git-ledger__chronology">
                {visibleCommits.map((commit) => (
                  <button
                    type="button"
                    key={commit.hash}
                    className={selectedCommit?.hash === commit.hash ? 'is-selected' : ''}
                    onClick={() => setSelectedHash(commit.hash)}
                  >
                    <code>{commit.shortHash}</code>
                    <span>
                      <strong>{commit.subject}</strong>
                      <small>{commit.author} · {formatDate(commit.date)}</small>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <GitTopology
                commits={visibleCommits}
                selectedHash={selectedCommit?.hash}
                onSelect={(commit) => setSelectedHash(commit.hash)}
              />
            )}
          </main>

          <aside className="git-ledger__inspector" aria-label="Analyse du commit">
            <span className="git-ledger__eyebrow">Analyse</span>
            {selectedCommit ? (
              <>
                <code className="git-ledger__selected-hash">{selectedCommit.shortHash}</code>
                <h2>{selectedCommit.subject}</h2>
                <dl>
                  <div>
                    <dt>Branche</dt>
                    <dd>{selectedCommit.refs[0] ?? snapshot?.branch ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Auteur</dt>
                    <dd>{selectedCommit.author}</dd>
                  </div>
                  <div>
                    <dt>Date</dt>
                    <dd>{formatDate(selectedCommit.date)}</dd>
                  </div>
                  <div>
                    <dt>Parents</dt>
                    <dd>
                      {selectedCommit.parents.length
                        ? selectedCommit.parents.map((parent) => parent.slice(0, 7)).join(' · ')
                        : 'Commit racine'}
                    </dd>
                  </div>
                  <div>
                    <dt>Réfs jointes</dt>
                    <dd>{selectedCommit.refs.join(' · ') || 'Aucune'}</dd>
                  </div>
                  <div>
                    <dt>Worktree</dt>
                    <dd>
                      {worktrees.find((worktree) => worktree.head === selectedCommit.hash)?.path ??
                        'Aucun worktree attaché'}
                    </dd>
                  </div>
                </dl>
              </>
            ) : (
              <p className="git-ledger__empty">Aucun commit dans cet historique.</p>
            )}
          </aside>
        </div>
      )}
    </section>
  )
}
