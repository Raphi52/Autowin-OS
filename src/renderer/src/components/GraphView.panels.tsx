import { BrainMarkdown } from './BrainMarkdown'
import { HumanJson } from './HumanJson'
import { nodeThemeIds, type GraphNode } from './graph-view-model'

/**
 * Sous-composants de présentation de l'observatoire 3D (GraphView) : sections de
 * réglages et panneaux de détail. Purs (props only), extraits pour alléger GraphView.tsx.
 */

export function SettingsSection({
  title,
  onReset,
  children
}: {
  title: string
  onReset?: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="settings-section">
      <div className="settings-section__heading">
        <span>{title}</span>
        {onReset && <button onClick={onReset}>Réinitialiser</button>}
      </div>
      {children}
    </section>
  )
}

export function ToggleRow({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}): React.JSX.Element {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <i aria-hidden="true" />
    </label>
  )
}

export function RangeRow({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  onChange: (value: number) => void
}): React.JSX.Element {
  return (
    <label className="range-row">
      <span>
        {label} <strong>{display}</strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

export function NodePanel({
  node,
  file,
  fileErr,
  linkedNodes,
  onNavigate
}: {
  node: GraphNode
  file: { path: string; content: string } | null
  fileErr: string
  linkedNodes: Array<{ node: GraphNode; direction: 'incoming' | 'outgoing'; relation?: string }>
  onNavigate: (node: GraphNode) => void
}): React.JSX.Element {
  return (
    <div className="node-panel">
      <nav className="node-links" aria-label="Nœuds reliés">
        <div className="node-links__heading">
          <strong>Liens</strong>
          <span>{linkedNodes.length}</span>
        </div>
        {linkedNodes.length === 0 && <p>Aucun nœud relié dans cette vue.</p>}
        {linkedNodes.map((linked) => (
          <button
            key={`${linked.direction}:${linked.node.id}`}
            type="button"
            onClick={() => onNavigate(linked.node)}
          >
            <span aria-hidden="true">{linked.direction === 'outgoing' ? '→' : '←'}</span>
            <strong>{linked.node.label}</strong>
            {linked.relation && <small>{linked.relation}</small>}
          </button>
        ))}
      </nav>
      <article className="node-content">
        <span className="node-panel__theme">{nodeThemeIds(node).join(' · ')}</span>
        <h2>{node.label}</h2>
        <div className="node-panel__path">{node.file ?? 'Aucun fichier associé'}</div>
        {fileErr && <div className="node-panel__error">{fileErr}</div>}
        {!file && !fileErr && <div className="node-panel__loading">Chargement du contenu…</div>}
        {file &&
          (/\.md$/i.test(file.path) ? (
            <BrainMarkdown source={file.content} />
          ) : (
            <HumanJson value={file.content} />
          ))}
      </article>
    </div>
  )
}

export function ThemeNodesPanel({
  nodes,
  onNavigate
}: {
  nodes: GraphNode[]
  onNavigate: (node: GraphNode) => void
}): React.JSX.Element {
  return (
    <div className="theme-nodes-panel">
      <div className="theme-nodes-panel__heading">
        <span>Nœuds du thème</span>
        <strong>{nodes.length}</strong>
      </div>
      <nav className="node-links" aria-label="Nœuds des thèmes actifs par ordre alphabétique">
        {nodes.length === 0 && <p>Aucun nœud dans ce thème.</p>}
        {nodes.map((themeNode) => (
          <button key={themeNode.id} type="button" onClick={() => onNavigate(themeNode)}>
            <span aria-hidden="true">✦</span>
            <strong>{themeNode.label}</strong>
          </button>
        ))}
      </nav>
    </div>
  )
}
