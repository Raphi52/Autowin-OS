import { useMemo, useState } from 'react'
import './WorkflowCanvas.css'

/**
 * Composer un workflow en le manipulant.
 *
 * Deux règles gouvernent ce canevas, et elles viennent du défaut qu'il corrige :
 *
 *  1. **Ce qu'on compose doit être ce qui tourne.** Un graphe que le moteur ne sait pas jouer est
 *     signalé À LA COMPOSITION, jamais accepté en silence. L'écran a déjà promis deux fois un
 *     pilotage qui n'existait pas ; il ne recommence pas.
 *  2. **Un retour sans limite est refusé.** Sans borne, le run peut ne jamais s'arrêter — et le devis
 *     ne peut plus garantir sa clôture avant de partir.
 */

export type Phase = 'scout' | 'frame' | 'terrain' | 'build' | 'clean' | 'judge'

export interface CanvasNode {
  id: string
  phase: Phase
  agents?: { provider: string; model?: string }[]
  quorum?: number
}
export interface CanvasEdge {
  from: string
  to: string
  when: 'always' | 'green' | 'red'
  maxTraversals?: number
}
export interface CanvasGraph {
  entry: string
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

export interface WorkflowCanvasProps {
  graph: CanvasGraph
  onChange: (graph: CanvasGraph) => void
  /** Ce que le moteur ne peut pas jouer, calculé côté main et affiché tel quel. */
  defects?: { target?: string; message: string }[]
  /** Retours composables mais encore inertes — dits, pas masqués. */
  inertReturns?: { from: string; to: string }[]
}

const PALETTE: Phase[] = ['scout', 'frame', 'terrain', 'build', 'clean', 'judge']

/** Provider par défaut d'un agent ajouté ; le modèle, lui, se choisit agent par agent. */
const defaultProvider = 'claude'

/** Réenchaîne les nœuds dans leur ordre d'affichage, en préservant les retours déjà tracés. */
function rechain(nodes: CanvasNode[], edges: CanvasEdge[]): CanvasEdge[] {
  const retours = edges.filter((e) => e.when !== 'always')
  const chaine = nodes.slice(0, -1).map((node, i) => ({
    from: node.id,
    to: nodes[i + 1].id,
    when: 'always' as const
  }))
  // Un retour dont une extrémité a disparu n'a plus de sens : le garder tracerait vers le vide.
  const vivants = new Set(nodes.map((n) => n.id))
  return [...chaine, ...retours.filter((e) => vivants.has(e.from) && vivants.has(e.to))]
}

export function WorkflowCanvas({
  graph,
  onChange,
  defects = [],
  inertReturns = []
}: WorkflowCanvasProps): React.JSX.Element {
  const [drag, setDrag] = useState<number>()
  const [ouvert, setOuvert] = useState<string>()

  const parNoeud = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const defect of defects) {
      if (!defect.target) continue
      map.set(defect.target, [...(map.get(defect.target) ?? []), defect.message])
    }
    return map
  }, [defects])

  const globaux = defects.filter((d) => !d.target)

  const majNodes = (nodes: CanvasNode[]): void =>
    onChange({ entry: nodes[0]?.id ?? '', nodes, edges: rechain(nodes, graph.edges) })

  const ajouter = (phase: Phase): void => {
    // Un id dérivé du rang : l'utilisateur n'a pas à inventer de clé, et deux `build` restent distincts.
    const id = `${phase}-${graph.nodes.filter((n) => n.phase === phase).length + 1}`
    majNodes([...graph.nodes, { id, phase }])
  }

  const retirer = (id: string): void => majNodes(graph.nodes.filter((n) => n.id !== id))

  const deposer = (cible: number): void => {
    if (drag === undefined || drag === cible) return
    const nodes = [...graph.nodes]
    const [pris] = nodes.splice(drag, 1)
    nodes.splice(cible, 0, pris)
    setDrag(undefined)
    majNodes(nodes)
  }

  const majNoeud = (id: string, patch: Partial<CanvasNode>): void =>
    onChange({
      ...graph,
      nodes: graph.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n))
    })

  const tracerRetour = (from: string, to: string): void =>
    onChange({
      ...graph,
      // Limite posée d'office à 1 : composer un retour sans borne serait immédiatement refusé, autant
      // livrer une valeur valide et laisser l'ajuster.
      edges: [...graph.edges, { from, to, when: 'red', maxTraversals: 1 }]
    })

  const retirerRetour = (from: string, to: string): void =>
    onChange({
      ...graph,
      edges: graph.edges.filter((e) => !(e.from === from && e.to === to && e.when !== 'always'))
    })

  const retours = graph.edges.filter((e) => e.when !== 'always')

  return (
    <section className="wf-canvas" data-testid="workflow-canvas">
      <ul className="wf-palette" data-testid="wf-palette">
        {PALETTE.map((phase) => (
          <li key={phase}>
            <button type="button" data-testid={`wf-add-${phase}`} onClick={() => ajouter(phase)}>
              + {phase}
            </button>
          </li>
        ))}
      </ul>

      {globaux.length > 0 && (
        <ul className="wf-defects" role="alert" data-testid="wf-defects">
          {globaux.map((d) => (
            <li key={d.message}>{d.message}</li>
          ))}
        </ul>
      )}

      <ol className="wf-chain">
        {graph.nodes.map((node, index) => {
          const soucis = parNoeud.get(node.id) ?? []
          return (
            <li
              key={node.id}
              className={`wf-node${soucis.length ? ' is-broken' : ''}`}
              data-testid={`wf-node-${node.id}`}
              draggable
              onDragStart={() => setDrag(index)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => deposer(index)}
            >
              <button
                type="button"
                className="wf-node-head"
                data-testid={`wf-open-${node.id}`}
                onClick={() => setOuvert(ouvert === node.id ? undefined : node.id)}
              >
                <span className="wf-node-phase">{node.phase}</span>
                <span className="wf-node-agents">
                  {node.agents?.length ? `${node.agents.length} agent(s)` : '1 agent'}
                  {node.quorum ? ` · quorum ${node.quorum}` : ''}
                </span>
              </button>
              <button
                type="button"
                className="wf-node-remove"
                data-testid={`wf-remove-${node.id}`}
                title={`Retirer ${node.phase}`}
                onClick={() => retirer(node.id)}
              >
                ×
              </button>

              {soucis.map((message) => (
                <p className="wf-node-defect" key={message}>
                  {message}
                </p>
              ))}

              {ouvert === node.id && (
                <div className="wf-node-detail" data-testid={`wf-detail-${node.id}`}>
                  <label>
                    Agents
                    <input
                      type="number"
                      min={1}
                      max={9}
                      data-testid={`wf-agents-${node.id}`}
                      value={node.agents?.length ?? 1}
                      onChange={(e) => {
                        const n = Math.max(1, Number(e.target.value) || 1)
                        const actuels = node.agents ?? []
                        // On PRÉSERVE les modèles déjà choisis : changer le nombre d'agents ne doit
                        // pas effacer en silence le réglage fin de ceux qui restent.
                        majNoeud(node.id, {
                          agents: Array.from(
                            { length: n },
                            (_, i) => actuels[i] ?? { provider: defaultProvider }
                          ),
                          ...(node.quorum && node.quorum > n ? { quorum: n } : {})
                        })
                      }}
                    />
                  </label>
                  {/* Un modèle par agent : sans cela un panel de trois juges serait trois fois le
                      même, ce qui ne juge rien de plus qu'un seul. */}
                  {(node.agents ?? []).map((agent, rang) => (
                    <label key={rang}>
                      Agent {rang + 1}
                      <input
                        type="text"
                        data-testid={`wf-agent-model-${node.id}-${rang}`}
                        value={agent.model ?? ''}
                        placeholder="modèle par défaut"
                        onChange={(e) =>
                          majNoeud(node.id, {
                            agents: (node.agents ?? []).map((a, i) =>
                              i === rang
                                ? { ...a, ...(e.target.value ? { model: e.target.value } : { model: undefined }) }
                                : a
                            )
                          })
                        }
                      />
                    </label>
                  ))}
                  <label>
                    Quorum
                    <input
                      type="number"
                      min={1}
                      max={node.agents?.length ?? 1}
                      data-testid={`wf-quorum-${node.id}`}
                      value={node.quorum ?? ''}
                      placeholder="majorité"
                      onChange={(e) =>
                        majNoeud(node.id, {
                          quorum: e.target.value ? Number(e.target.value) : undefined
                        })
                      }
                    />
                  </label>
                  {/* Tracer un retour depuis ce nœud vers un nœud déjà passé. */}
                  {graph.nodes.slice(0, index).map((cible) => (
                    <button
                      key={cible.id}
                      type="button"
                      data-testid={`wf-return-${node.id}-${cible.id}`}
                      onClick={() => tracerRetour(node.id, cible.id)}
                    >
                      ↩ renvoyer à {cible.phase}
                    </button>
                  ))}
                </div>
              )}
            </li>
          )
        })}
      </ol>

      {retours.length > 0 && (
        <ul className="wf-returns" data-testid="wf-returns">
          {retours.map((edge) => {
            const inerte = inertReturns.some((r) => r.from === edge.from && r.to === edge.to)
            return (
              <li key={`${edge.from}>${edge.to}`} data-testid={`wf-edge-${edge.from}-${edge.to}`}>
                <span>
                  {edge.from} → {edge.to} si rouge
                </span>
                <label>
                  au plus
                  <input
                    type="number"
                    min={1}
                    max={10}
                    data-testid={`wf-bound-${edge.from}-${edge.to}`}
                    value={edge.maxTraversals ?? 1}
                    onChange={(e) =>
                      onChange({
                        ...graph,
                        edges: graph.edges.map((c) =>
                          c.from === edge.from && c.to === edge.to && c.when === edge.when
                            ? { ...c, maxTraversals: Math.max(1, Number(e.target.value) || 1) }
                            : c
                        )
                      })
                    }
                  />
                  fois
                </label>
                {/* Un retour composable mais inerte serait le pire des pièges : on le DIT. */}
                {inerte && (
                  <span className="wf-inert" data-testid={`wf-inert-${edge.from}-${edge.to}`}>
                    composable, mais le moteur ne sait pas encore le jouer
                  </span>
                )}
                <button
                  type="button"
                  data-testid={`wf-drop-${edge.from}-${edge.to}`}
                  onClick={() => retirerRetour(edge.from, edge.to)}
                >
                  ×
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
