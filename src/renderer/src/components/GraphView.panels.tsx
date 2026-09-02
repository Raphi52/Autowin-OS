import { BrainMarkdown } from './BrainMarkdown'
import { HumanJson } from './HumanJson'
import { brainScoreChannelLabel, nodeThemeIds, type GraphNode } from './graph-view-model'
import { Spinner } from './Spinner'
import { useState } from 'react'

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

/**
 * Champs du NŒUD lui-même, tels que le graphe les porte. Le panneau ne montrait que le libellé, le
 * chemin et le contenu du fichier : tout le reste (identifiant, thèmes, scores de recherche,
 * relations déclarées, position dans l'arbre) était chargé puis jeté avant l'affichage. Les
 * coordonnées de rendu (`x`, `fx`…) sont écartées : elles ne disent rien de la connaissance.
 */
const NODE_RENDER_ONLY = new Set(['x', 'y', 'z', 'fx', 'fy', 'fz', 'label'])

function nodeDetailFields(node: GraphNode): Record<string, unknown> {
  const keep: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    if (NODE_RENDER_ONLY.has(key) || value === undefined || value === null || value === '') continue
    keep[key] = value
  }
  return keep
}

export function NodePanel({
  node,
  file,
  fileErr,
  linkedNodes,
  onNavigate,
  degre,
  deuxiemeSaut,
  onRetry,
  onRetract,
  onSupersede
}: {
  node: GraphNode
  file: { path: string; content: string } | null
  fileErr: string
  linkedNodes: Array<{ node: GraphNode; direction: 'incoming' | 'outgoing'; relation?: string }>
  onNavigate: (node: GraphNode) => void
  /** Combien de liens entrent et sortent — le poids reel du noeud dans le graphe. */
  degre?: { entrants: number; sortants: number }
  /** Noeuds atteints en DEUX liens, avec le relais par lequel on y arrive. */
  deuxiemeSaut?: Array<{ node: GraphNode; via: GraphNode }>
  onRetry?: () => void
  onRetract?: () => void
  onSupersede?: () => void
}): React.JSX.Element {
  // Les liens d'une fiche fournie se comptent par dizaines et melangent toutes les relations :
  // sans ce filtre, retrouver « qui me cite » revenait a lire la liste entiere a l'oeil.
  const [relation, setRelation] = useState('')
  const relationsPresentes = [
    ...new Set(linkedNodes.map((lien) => lien.relation).filter((nom): nom is string => Boolean(nom)))
  ]
  const liensVisibles = relation
    ? linkedNodes.filter((lien) => lien.relation === relation)
    : linkedNodes
  return (
    <div className="node-panel">

      <nav className="node-links" aria-label="Nœuds reliés">
        <div className="node-links__heading">
          <strong>Liens</strong>
          <span>
            {liensVisibles.length === linkedNodes.length
              ? linkedNodes.length
              : `${liensVisibles.length}/${linkedNodes.length}`}
          </span>
          {degre && (
            <small className="node-links__degre">
              ↓{degre.entrants} ↑{degre.sortants}
            </small>
          )}
        </div>
        {relationsPresentes.length > 1 && (
          <select
            className="node-links__relation"
            aria-label="Filtrer les liens par relation"
            value={relation}
            onChange={(event) => setRelation(event.target.value)}
          >
            <option value="">Toutes relations</option>
            {relationsPresentes.map((nom) => (
              <option key={nom} value={nom}>
                {nom}
              </option>
            ))}
          </select>
        )}

        {liensVisibles.length === 0 && <p>Aucun nœud relié dans cette vue.</p>}
        {liensVisibles.map((linked) => (
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
        {deuxiemeSaut && deuxiemeSaut.length > 0 && (
          <details className="node-links__saut" data-testid="node-second-hop">
            <summary>Voisinage à 2 sauts ({deuxiemeSaut.length})</summary>
            {deuxiemeSaut.map((saut) => (
              <button key={saut.node.id} type="button" onClick={() => onNavigate(saut.node)}>
                <span aria-hidden="true">⇢</span>
                <strong>{saut.node.label}</strong>
                <small>via {saut.via.label}</small>
              </button>
            ))}
          </details>
        )}
      </nav>
      <article className="node-content">

        <span className="node-panel__theme">{nodeThemeIds(node).join(' · ')}</span>
        <h2>{node.label}</h2>
        <div className="node-panel__path">
          <span>{node.file ?? 'Aucun fichier associé'}</span>
          {node.file && (
            <button
              type="button"
              className="node-panel__copier"
              onClick={() => void navigator.clipboard?.writeText(String(node.file))}
            >
              Copier le chemin
            </button>
          )}
        </div>

        {onRetract && (
          <div>
            <button type="button" className="node-panel__retry" onClick={onRetract}>
              Retirer du Brain canonique
            </button>
            {onSupersede && (
              <button type="button" className="node-panel__retry" onClick={onSupersede}>
                Remplacer par une autre fiche
              </button>
            )}
          </div>
        )}
        {fileErr && (
          <div className="node-panel__error" role="alert">
            <span>{fileErr}</span>
            {/* La fiche ET son voisinage passent par le même chargement : un seul réessai les couvre. */}
            {onRetry && (
              <button type="button" className="node-panel__retry" onClick={onRetry}>
                Réessayer
              </button>
            )}
          </div>
        )}
        {!file && !fileErr && (
          <div className="node-panel__loading">
            <Spinner /> Chargement du contenu…
          </div>
        )}
        {/* DÉTAIL DU NŒUD — l'information existait déjà dans le nœud, elle n'était simplement
            jamais rendue. Repliée par défaut : le contenu de la fiche reste la lecture première. */}
        <details className="node-panel__details" data-testid="node-panel-details">
          <summary>Détail du nœud</summary>
          <dl className="node-panel__meta">
            <dt>Identifiant</dt>
            <dd>{node.id}</dd>
            <dt>Thèmes</dt>
            <dd>{nodeThemeIds(node).join(' · ') || '—'}</dd>
            <dt>Scores de recherche</dt>
            <dd>{brainScoreChannelLabel(node)}</dd>
            <dt>Relations déclarées</dt>
            <dd>{node.relations?.length ?? 0}</dd>
          </dl>
          {node.relations && node.relations.length > 0 && (
            <ul className="node-panel__relations">
              {node.relations.map((relation, index) => (
                <li key={`${relation.type}:${relation.target}:${index}`}>
                  <em>{relation.type}</em>
                  <span>{relation.target}</span>
                </li>
              ))}
            </ul>
          )}
          <HumanJson className="node-panel__json" value={nodeDetailFields(node)} />
        </details>
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
