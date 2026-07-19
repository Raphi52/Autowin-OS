import { useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_HARNESS_FILTERS,
  FLOW_LABEL,
  HARNESS_FLOWS,
  HARNESS_LAYERS,
  LAYER_LABEL,
  RUNTIME_LABEL,
  SOURCE_LABEL,
  STATE_LABEL,
  filterHarness,
  harnessFilterOptions,
  layoutHarness,
  type HarnessFilters,
  type HarnessNode,
  type HarnessSnapshot
} from './harness-model'
import './HarnessView.css'

const EMPTY: HarnessSnapshot = {
  generatedAt: '',
  focusModelId: '',
  nodes: [],
  edges: [],
  caps: { maxNodes: 250, maxEdges: 500, nodeCount: 0, edgeCount: 0, truncated: false },
  providers: [],
  runtimes: []
}

export function HarnessView(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<HarnessSnapshot>(EMPTY)
  const [filters, setFilters] = useState<HarnessFilters>(DEFAULT_HARNESS_FILTERS)
  const [selectedId, setSelectedId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void window.api
      .harnessSnapshot()
      .then((value) => {
        if (cancelled) return
        setSnapshot(value)
        setSelectedId('')
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => filterHarness(snapshot, filters), [snapshot, filters])
  const options = useMemo(() => harnessFilterOptions(snapshot), [snapshot])
  const layout = useMemo(() => layoutHarness(filtered.nodes), [filtered.nodes])
  const visibleIds = useMemo(() => new Set(filtered.nodes.map((node) => node.id)), [filtered.nodes])
  const selected = snapshot.nodes.find((node) => node.id === selectedId)

  function update<K extends keyof HarnessFilters>(key: K, value: HarnessFilters[K]): void {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  return (
    <section className="harness-view">
      <header className="harness-head">
        <div>
          <span className="harness-kicker">CARTE EXPLICATIVE · LECTURE SEULE</span>
          <h1>Harnais</h1>
          <p>Ce qui relie le modèle, les règles, les données et les preuves.</p>
        </div>
        <div className="harness-badges">
          <span>Runtime local</span>
          <span>Brain partagé · lecture seule</span>
          <span>{snapshot.caps.nodeCount} nœuds</span>
        </div>
      </header>

      <div className="harness-story" aria-label="Lecture rapide du harnais">
        <span>
          <b>1</b>
          <strong>Vous demandez</strong>
          <small>Chat ou mission</small>
        </span>
        <i aria-hidden="true">→</i>
        <span>
          <b>2</b>
          <strong>Le modèle orchestre</strong>
          <small>Règles, skills et outils</small>
        </span>
        <i aria-hidden="true">→</i>
        <span>
          <b>3</b>
          <strong>Le système vérifie</strong>
          <small>Gates, traces et coûts</small>
        </span>
      </div>

      <div className="harness-controls" aria-label="Filtres du harnais">
        <div className="harness-level">
          <button
            className={filters.level === 'beginner' ? 'is-active' : ''}
            onClick={() => update('level', 'beginner')}
          >
            Comprendre
          </button>
          <button
            className={filters.level === 'expert' ? 'is-active' : ''}
            onClick={() => update('level', 'expert')}
          >
            Expert
          </button>
        </div>
        <select
          value={filters.flow}
          onChange={(event) => update('flow', event.target.value as HarnessFilters['flow'])}
          aria-label="Flux"
        >
          <option value="all">Tous les flux</option>
          {HARNESS_FLOWS.map((flow) => (
            <option key={flow} value={flow}>
              {FLOW_LABEL[flow]}
            </option>
          ))}
        </select>
        {filters.level === 'expert' && (
          <>
            <select
              value={filters.runtime}
              onChange={(event) =>
                update('runtime', event.target.value as HarnessFilters['runtime'])
              }
              aria-label="Runtime"
            >
              <option value="all">Tous les runtimes</option>
              {options.runtimes.map((runtime) => (
                <option key={runtime} value={runtime}>
                  {RUNTIME_LABEL[runtime]}
                </option>
              ))}
            </select>
            <select
              value={filters.provider}
              onChange={(event) => update('provider', event.target.value)}
              aria-label="Provider"
            >
              <option value="all">Tous les providers</option>
              {options.providers.map((provider) => (
                <option key={provider} value={provider}>
                  {provider}
                </option>
              ))}
            </select>
            <select
              value={filters.health}
              onChange={(event) => update('health', event.target.value as HarnessFilters['health'])}
              aria-label="Santé"
            >
              <option value="all">Tous les états</option>
              {options.states.map((state) => (
                <option key={state} value={state}>
                  {STATE_LABEL[state]}
                </option>
              ))}
            </select>
          </>
        )}
        <input
          value={filters.query}
          onChange={(event) => update('query', event.target.value)}
          placeholder="Chercher un composant…"
          aria-label="Recherche"
        />
      </div>

      <div className="harness-workspace">
        <div className="harness-canvas" aria-busy={loading}>
          {loading && <div className="harness-empty">Lecture du harnais réel…</div>}
          {error && <div className="harness-empty is-error">{error}</div>}
          {!loading && !error && filtered.nodes.length === 0 && (
            <div className="harness-empty">Aucun composant ne correspond aux filtres.</div>
          )}
          {!loading && !error && filtered.nodes.length > 0 && (
            <svg
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              role="img"
              aria-label="Graphe du harnais Autowin OS"
            >
              {layout.lanes.map((lane) => (
                <g key={lane.layer} className={`harness-lane lane-${lane.layer}`}>
                  <rect
                    x="6"
                    y={lane.y + 4}
                    width={layout.width - 12}
                    height={lane.height - 8}
                    rx="12"
                  />
                  <text x="22" y={lane.y + 25}>
                    {LAYER_LABEL[lane.layer]}
                  </text>
                </g>
              ))}
              <g className="harness-edges">
                {filtered.edges.map((edge) => {
                  const from = layout.positions[edge.from]
                  const to = layout.positions[edge.to]
                  if (!from || !to || !visibleIds.has(edge.from) || !visibleIds.has(edge.to))
                    return null
                  const midY = (from.y + to.y) / 2
                  return (
                    <path
                      key={edge.id}
                      d={`M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`}
                      data-kind={edge.kind}
                    />
                  )
                })}
              </g>
              <g className="harness-nodes">
                {filtered.nodes.map((node) => {
                  const pos = layout.positions[node.id]
                  if (!pos) return null
                  return (
                    <g
                      key={node.id}
                      className={`harness-node state-${node.state}${node.focal ? ' is-focal' : ''}${selectedId === node.id ? ' is-selected' : ''}${filtered.matched.has(node.id) ? ' is-match' : ''}`}
                      transform={`translate(${pos.x - 76} ${pos.y - 30})`}
                      onClick={() => setSelectedId(node.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') setSelectedId(node.id)
                      }}
                    >
                      <rect width="152" height="60" rx="9" />
                      <circle cx="14" cy="15" r="4" />
                      <text className="node-kind" x="24" y="18">
                        {node.kind}
                      </text>
                      <text className="node-label" x="12" y="41">
                        {node.label.length > 23 ? `${node.label.slice(0, 22)}…` : node.label}
                      </text>
                    </g>
                  )
                })}
              </g>
            </svg>
          )}
        </div>

        {selected && (
          <aside className="harness-inspector">
            <button
              type="button"
              className="harness-inspector__close"
              aria-label="Fermer l’inspecteur"
              onClick={() => setSelectedId('')}
            >
              ×
            </button>
            <NodeInspector node={selected} />
          </aside>
        )}
      </div>

      <footer className="harness-legend">
        {HARNESS_LAYERS.map((layer) => (
          <span key={layer} className={`legend-${layer}`}>
            {LAYER_LABEL[layer]}
          </span>
        ))}
        <span>
          <i className="state-healthy" /> prouvé sain
        </span>
        <span>
          <i className="state-unknown" /> non vérifié
        </span>
        {snapshot.caps.truncated && <strong>Vue plafonnée pour rester lisible</strong>}
      </footer>
    </section>
  )
}

function NodeInspector({ node }: { node: HarnessNode }): React.JSX.Element {
  return (
    <>
      <span className={`inspector-state state-${node.state}`}>{STATE_LABEL[node.state]}</span>
      <h2>{node.label}</h2>
      <p className="inspector-kind">
        {LAYER_LABEL[node.layer]} · {node.kind}
      </p>
      <section>
        <h3>Rôle</h3>
        <p>{node.roleDesc}</p>
      </section>
      <section>
        <h3>Source réelle</h3>
        <p>{SOURCE_LABEL[node.source]}</p>
        <code>{node.evidence.ref}</code>
        {node.evidence.detail && <p>{node.evidence.detail}</p>}
      </section>
      <section>
        <h3>Ce qui est observé</h3>
        <p>{node.observed}</p>
      </section>
      <section>
        <h3>Ce qui ne l’est pas</h3>
        <p>{node.notObserved}</p>
      </section>
      {node.metrics && node.metrics.length > 0 && (
        <section>
          <h3>Mesures bornées</h3>
          <dl>
            {node.metrics.map((metric) => (
              <div key={metric.label}>
                <dt>{metric.label}</dt>
                <dd>{metric.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <section>
        <h3>Références</h3>
        {node.references.map((reference) => (
          <code key={reference}>{reference}</code>
        ))}
      </section>
    </>
  )
}
