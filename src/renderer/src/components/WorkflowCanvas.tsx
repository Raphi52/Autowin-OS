import { useMemo, useState } from 'react'
import { personasFor } from '../../../shared/persona'
import './WorkflowCanvas.css'

/** Les efforts proposables. Miroir de `ReasoningEffort` côté main. */
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

/**
 * Le workflow comme PLAN, et non plus comme liste.
 *
 * L'ancien canevas empilait les nœuds dans un `<ol>` et listait les retours en texte dessous : on ne voyait ni la
 * topologie, ni le fan-out, ni où un retour retombait. Ici le graphe est DESSINÉ — nœuds placés, arêtes tracées,
 * retours en connecteurs orthogonaux portant leur borne — et l'édition fine passe par l'inspecteur latéral.
 *
 * Les positions ne sont PAS stockées : elles se DÉRIVENT de l'ordre de la chaîne (colonnes de trois). Un modèle
 * qui porterait `x`/`y` ferait vieillir des coordonnées, divergerait du graphe et n'aurait aucun sens à la
 * relecture d'un profil ; dérivées, elles sont justes par construction et le glisser-déposer garde le sens qu'il
 * a toujours eu — réordonner la chaîne, pas déplacer dans le plan.
 */

// Miroir de `PipelinePhase` (src/main/skill-pipeline.ts) — les deux doivent rester alignés, sinon on
// compose à l'écran une phase que le moteur ne sait pas jouer.
export type Phase =
  'scout' | 'frame' | 'terrain' | 'build' | 'clean' | 'judge' | 'kaizen' | 'remake'

/** Un membre du fan-out : QUI regarde (persona), avec QUEL modèle et QUEL effort. */
export interface CanvasAgent {
  /** Absent : herite du binding de phase configure dans Agent Studio. */
  provider?: string
  model?: string
  reasoningEffort?: string
  /** L'angle imposé à ce membre. Injecté dans son prompt — sans lui, le panel est N fois le même. */
  persona?: string
}

export interface CanvasNode {
  id: string
  phase: Phase
  agents?: CanvasAgent[]
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

/** Un modèle proposable, tel qu'Agent Studio le connaît. */
export interface CanvasModel {
  provider: string
  id: string
}

export interface WorkflowCanvasProps {
  graph: CanvasGraph
  onChange: (graph: CanvasGraph) => void
  /**
   * Les modèles réellement disponibles — MÊME source qu'Agent Studio (`window.api.models()`).
   * Une saisie libre laissait composer un modèle inexistant, découvert seulement au lancement.
   */
  models?: CanvasModel[]
  /** Ce que le moteur ne peut pas jouer, calculé côté main et affiché tel quel. */
  defects?: { target?: string; message: string }[]
  /** Exécutions provisionnées au pire cas, affichées en barre d'état. */
  worstCase?: number | null
}

const PALETTE: Phase[] = [
  'scout',
  'frame',
  'terrain',
  'build',
  'clean',
  'judge',
  'kaizen',
  'remake'
]

/* ── Géométrie du plan. Des constantes plutôt que des valeurs semées : le tracé des arêtes en dépend. ── */
const NODE_W = 158
const NODE_H = 64
const COL_GAP = 188
const ROW_GAP = 90
const PAD = 44
const PER_COL = 3
const LOOP_LANE = 108 // couloir à droite du plan où passent les retours
const VOIE_ECART = 14 // écart entre deux retours dans le couloir, pour qu'ils ne se recouvrent pas
const COURBE = 18 // rayon d'arrondi des coudes ; borné au tracé pour ne jamais boucler sur soi

function place(index: number): { x: number; y: number } {
  const col = Math.floor(index / PER_COL)
  const row = index % PER_COL
  return { x: PAD + col * (NODE_W + COL_GAP), y: PAD + row * (NODE_H + ROW_GAP) }
}

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
  models = [],
  worstCase = null
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
    onChange({ ...graph, nodes: graph.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) })

  /** Modifie UN membre du fan-out sans toucher aux autres réglages déjà posés. */
  const majAgent = (node: CanvasNode, rang: number, patch: Partial<CanvasAgent>): void =>
    majNoeud(node.id, {
      agents: (node.agents ?? []).map((a, i) => (i === rang ? { ...a, ...patch } : a))
    })

  /**
   * Un retour vers une carte donnée existe, ou n'existe pas — il ne s'EMPILE pas. Chaque clic ajoutait une arête de
   * plus : le plan dessinait N flèches superposées, et surtout le pire cas d'exécution était MULTIPLIÉ par (1 + borne)
   * à chaque doublon. Cinq clics suffisaient à multiplier le devis par 32 sans qu'aucune boucle de plus n'existe.
   */
  const tracerRetour = (from: string, to: string): void => {
    if (graph.edges.some((e) => e.from === from && e.to === to && e.when !== 'always')) return
    onChange({
      ...graph,
      // Limite posée d'office à 1 : composer un retour sans borne serait immédiatement refusé, autant
      // livrer une valeur valide et laisser l'ajuster.
      edges: [...graph.edges, { from, to, when: 'red', maxTraversals: 1 }]
    })
  }

  const retirerRetour = (from: string, to: string): void =>
    onChange({
      ...graph,
      edges: graph.edges.filter((e) => !(e.from === from && e.to === to && e.when !== 'always'))
    })

  const retours = graph.edges.filter((e) => e.when !== 'always')
  const avants = graph.edges.filter((e) => e.when === 'always')
  const rang = useMemo(() => new Map(graph.nodes.map((n, i) => [n.id, i])), [graph.nodes])

  const colonnes = Math.max(1, Math.ceil(graph.nodes.length / PER_COL))
  const lignes = Math.min(PER_COL, Math.max(1, graph.nodes.length))
  const planW = PAD * 2 + colonnes * NODE_W + (colonnes - 1) * COL_GAP + LOOP_LANE
  const planH = PAD * 2 + lignes * NODE_H + (lignes - 1) * ROW_GAP

  /**
   * Chaîne : vertical si même colonne, coude ADOUCI sinon.
   *
   * Le tracé garde exactement la même géométrie qu'avant — même point de départ, même gouttière
   * intermédiaire, même point d'arrivée : seuls les deux angles droits deviennent des arrondis.
   * Un coude à 90° lit « schéma technique » ; le même trajet arrondi lit « flux ». C'est la moitié
   * de l'impression de fluidité, pour aucun changement de topologie.
   */
  const traceAvant = (a: number, b: number): string => {
    const p = place(a)
    const q = place(b)
    if (p.x === q.x) return `M${p.x + NODE_W / 2} ${p.y + NODE_H} V${q.y - 7}`
    const mid = p.x + NODE_W + COL_GAP / 2
    const y1 = p.y + NODE_H / 2
    const y2 = q.y + NODE_H / 2
    // Rayon borné par la demi-distance disponible : sur deux nœuds très proches, un rayon fixe
    // ferait boucler la courbe sur elle-même.
    const r = Math.min(COURBE, Math.abs(y2 - y1) / 2, COL_GAP / 2)
    if (r < 2) return `M${p.x + NODE_W} ${y1} H${mid} V${y2} H${q.x - 7}`
    const sens = y2 > y1 ? 1 : -1
    return (
      `M${p.x + NODE_W} ${y1} H${mid - r}` +
      `Q${mid} ${y1} ${mid} ${y1 + r * sens}` +
      `V${y2 - r * sens}` +
      `Q${mid} ${y2} ${mid + r} ${y2}` +
      `H${q.x - 7}`
    )
  }

  /**
   * Retour : sort à droite, remonte par le couloir, rentre par la droite de la cible.
   *
   * Le couloir est DÉCALÉ par retour (`voie`) : sans cela deux retours partant du même nœud
   * partagent exactement le même segment vertical et se recouvrent au pixel près — une seule flèche
   * reste visible, et on ne peut plus dire quel retour va où.
   */
  const traceRetour = (a: number, b: number, voie: number): string => {
    const p = place(a)
    const q = place(b)
    const lane =
      PAD + colonnes * NODE_W + (colonnes - 1) * COL_GAP + LOOP_LANE / 2 + voie * VOIE_ECART
    const y1 = p.y + NODE_H / 2
    const y2 = q.y + NODE_H / 2 + 10
    const r = Math.min(COURBE, Math.abs(y2 - y1) / 2)
    if (r < 2) return `M${p.x + NODE_W} ${y1} H${lane} V${y2} H${q.x + NODE_W + 7}`
    const sens = y2 > y1 ? 1 : -1
    return (
      `M${p.x + NODE_W} ${y1} H${lane - r}` +
      `Q${lane} ${y1} ${lane} ${y1 + r * sens}` +
      `V${y2 - r * sens}` +
      `Q${lane} ${y2} ${lane - r} ${y2}` +
      `H${q.x + NODE_W + 7}`
    )
  }

  return (
    <section className="wf-canvas" data-testid="workflow-canvas">
      <div className="wf-editor">
        <aside className="wf-palette-pane">
          <p className="wf-kicker">Phases</p>
          <ul className="wf-palette" data-testid="wf-palette">
            {PALETTE.map((phase) => (
              <li key={phase}>
                <button
                  type="button"
                  className={`wf-pal-item wf-ph-${phase}`}
                  data-testid={`wf-add-${phase}`}
                  onClick={() => ajouter(phase)}
                >
                  <span className="wf-dot" />
                  {phase}
                </button>
              </li>
            ))}
          </ul>
          <p className="wf-hint">
            Cliquer ajoute la phase au bout de la chaîne. Glisser un nœud le réordonne.
          </p>
        </aside>

        {/* Deux boîtes, pas une : le VIEWPORT défile, la SURFACE porte sa taille réelle. Elles étaient
            confondues — `overflow: auto` et `minWidth: planW` sur le même élément — donc la boîte
            grandissait avec le graphe au lieu de déborder, et rien ne pouvait défiler : une chaîne
            longue sortait simplement de l'écran par la droite. Un conteneur ne déborde pas de lui-même. */}
        <div className="wf-plan-zone">
          <div className="wf-plan-viewport">
            <div className="wf-plan" style={{ width: planW, height: planH }}>
              <svg className="wf-wires" width={planW} height={planH} aria-hidden="true">
                <defs>
                  <marker
                    id="wf-ar"
                    markerWidth="7"
                    markerHeight="7"
                    refX="6"
                    refY="3.5"
                    orient="auto"
                  >
                    <path d="M0,0 L7,3.5 L0,7 z" className="wf-ar-n" />
                  </marker>
                  <marker
                    id="wf-ar-red"
                    markerWidth="7"
                    markerHeight="7"
                    refX="6"
                    refY="3.5"
                    orient="auto"
                  >
                    <path d="M0,0 L7,3.5 L0,7 z" className="wf-ar-r" />
                  </marker>
                  <marker
                    id="wf-ar-green"
                    markerWidth="7"
                    markerHeight="7"
                    refX="6"
                    refY="3.5"
                    orient="auto"
                  >
                    <path d="M0,0 L7,3.5 L0,7 z" className="wf-ar-g" />
                  </marker>
                </defs>
                {/* Les arêtes AVANT se lisent dans `graph.edges`, JAMAIS dans l'ordre du tableau de
                nœuds : dessiner nœud[i] → nœud[i+1] afficherait une chaîne linéaire même quand le
                moteur, lui, suit d'autres arêtes — l'utilisateur validerait un graphe qu'il ne
                compose pas. */}
                {avants.map((edge) => {
                  const a = rang.get(edge.from)
                  const b = rang.get(edge.to)
                  if (a === undefined || b === undefined) return null
                  return (
                    <path
                      key={`fwd-${edge.from}-${edge.to}`}
                      d={traceAvant(a, b)}
                      className="wf-wire"
                      markerEnd="url(#wf-ar)"
                    />
                  )
                })}
                {retours.map((edge, voie) => {
                  const a = rang.get(edge.from)
                  const b = rang.get(edge.to)
                  if (a === undefined || b === undefined) return null
                  return (
                    <path
                      key={`ret-${edge.from}-${edge.to}`}
                      d={traceRetour(a, b, voie)}
                      className={`wf-wire wf-wire-${edge.when}`}
                      markerEnd={`url(#wf-ar-${edge.when === 'green' ? 'green' : 'red'})`}
                    />
                  )
                })}
              </svg>

              {graph.nodes.map((node, index) => {
                const soucis = parNoeud.get(node.id) ?? []
                const pos = place(index)
                const agents = node.agents ?? []
                return (
                  <div
                    key={node.id}
                    className={`wf-node wf-ph-${node.phase}${soucis.length ? ' is-broken' : ''}${
                      ouvert === node.id ? ' is-open' : ''
                    }`}
                    style={{ left: pos.x, top: pos.y, width: NODE_W }}
                    data-testid={`wf-node-${node.id}`}
                    draggable
                    onDragStart={() => setDrag(index)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => deposer(index)}
                  >
                    <span className="wf-node-bar" />
                    <button
                      type="button"
                      className="wf-node-head"
                      data-testid={`wf-open-${node.id}`}
                      onClick={() => setOuvert(ouvert === node.id ? undefined : node.id)}
                    >
                      <span className="wf-node-phase">
                        <span className="wf-dot" />
                        {node.phase}
                      </span>
                      <span className="wf-node-id">{node.id}</span>
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
                    <span className="wf-node-agents">
                      {agents.length > 1 ? (
                        agents.map((agent, i) => (
                          <span
                            className="wf-ag"
                            key={i}
                            title={agent.model ?? 'modèle par défaut'}
                          />
                        ))
                      ) : (
                        <span className="wf-ag-label">{agents[0]?.model ?? '1 agent'}</span>
                      )}
                      {node.quorum ? <span className="wf-quorum-badge">q{node.quorum}</span> : null}
                    </span>
                    {soucis.map((message) => (
                      <p className="wf-node-defect" key={message}>
                        {message}
                      </p>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Hors du VIEWPORT, pas seulement hors de la surface. Première tentative : la barre placée
              dans le viewport — mesuré faux, un enfant `absolute` d'un conteneur qui défile suit le
              contenu, et les pastilles se faisaient couper à gauche dès qu'on regardait la droite du
              graphe. Elle vit donc dans une zone qui, elle, ne défile pas. Or c'est précisément quand
              la chaîne s'allonge que le devis « ≤N exéc. » doit rester sous les yeux. */}
          <div className="wf-statusbar">
            {worstCase ? (
              <span className="wf-pill is-warn">≤{worstCase} exéc. au pire cas</span>
            ) : null}
            {defects.length ? (
              <span className="wf-pill is-err">
                {defects.length} défaut{defects.length > 1 ? 's' : ''}
              </span>
            ) : (
              <span className="wf-pill is-ok">valide</span>
            )}
          </div>
        </div>

        <aside className="wf-insp">
          {globaux.length > 0 && (
            <ul className="wf-defects" role="alert" data-testid="wf-defects">
              {globaux.map((d) => (
                <li key={d.message}>{d.message}</li>
              ))}
            </ul>
          )}

          {ouvert && graph.nodes.some((n) => n.id === ouvert) ? (
            (() => {
              const node = graph.nodes.find((n) => n.id === ouvert)!
              const index = rang.get(node.id) ?? 0
              return (
                <div className="wf-node-detail" data-testid={`wf-detail-${node.id}`}>
                  <p className="wf-kicker">Nœud sélectionné</p>
                  <p className={`wf-insp-title wf-ph-${node.phase}`}>
                    <span className="wf-dot" />
                    {node.id}
                  </p>
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
                            (_, i) => actuels[i] ?? {}
                          ),
                          ...(node.quorum && node.quorum > n ? { quorum: n } : {})
                        })
                      }}
                    />
                  </label>
                  {/* Trois réglages par membre — modèle, effort, ANGLE. Sans l'angle, un panel de
                      trois juges est trois fois le même juge : il coûte trois fois plus et
                      n'apprend rien de plus. L'angle est injecté dans le prompt du membre. */}
                  {(node.agents ?? []).map((agent, r) => (
                    <div className="wf-agent-card" key={r}>
                      <p className="wf-agent-rang">Agent {r + 1}</p>
                      <label>
                        Angle
                        <select
                          data-testid={`wf-agent-persona-${node.id}-${r}`}
                          value={agent.persona ?? ''}
                          onChange={(e) =>
                            majAgent(node, r, { persona: e.target.value || undefined })
                          }
                        >
                          <option value="">aucun angle imposé</option>
                          {personasFor(node.phase).map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Modèle
                        <select
                          data-testid={`wf-agent-model-${node.id}-${r}`}
                          value={agent.model ?? ''}
                          onChange={(e) => {
                            const selected = models.find((model) => model.id === e.target.value)
                            majAgent(node, r, {
                              provider: selected?.provider,
                              model: selected?.id
                            })
                          }}
                        >
                          <option value="">modèle par défaut</option>
                          {/* Un modèle déjà composé mais absent du catalogue reste proposé : sinon
                              ouvrir un profil ancien effacerait silencieusement son réglage. */}
                          {agent.model && !models.some((m) => m.id === agent.model) && (
                            <option value={agent.model}>{agent.model} (indisponible)</option>
                          )}
                          {models.map((m) => (
                            <option key={`${m.provider}:${m.id}`} value={m.id}>
                              {m.id}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Effort
                        <select
                          data-testid={`wf-agent-effort-${node.id}-${r}`}
                          value={agent.reasoningEffort ?? ''}
                          onChange={(e) =>
                            majAgent(node, r, { reasoningEffort: e.target.value || undefined })
                          }
                        >
                          <option value="">par défaut</option>
                          {EFFORTS.map((effort) => (
                            <option key={effort} value={effort}>
                              {effort}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
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
                  {graph.nodes.slice(0, index).length > 0 && (
                    <p className="wf-kicker wf-kicker-sub">Renvoyer vers</p>
                  )}
                  <div className="wf-return-buttons">
                    {graph.nodes.slice(0, index).map((cible) => {
                      // Un renvoi déjà tracé se VOIT sur son bouton : sans ce retour visuel, rien ne distinguait
                      // « c'est fait » de « ça n'a rien fait », et c'est en recliquant qu'on empilait les flèches.
                      const dejaTrace = graph.edges.some(
                        (e) => e.from === node.id && e.to === cible.id && e.when !== 'always'
                      )
                      return (
                        <button
                          key={cible.id}
                          type="button"
                          className={dejaTrace ? 'is-active' : undefined}
                          aria-pressed={dejaTrace}
                          disabled={dejaTrace}
                          title={
                            dejaTrace
                              ? `Renvoi vers ${cible.phase} déjà tracé — retirez-le dans « Retours »`
                              : undefined
                          }
                          data-testid={`wf-return-${node.id}-${cible.id}`}
                          onClick={() => tracerRetour(node.id, cible.id)}
                        >
                          {dejaTrace ? '✓' : '↩'} {cible.phase}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })()
          ) : (
            <p className="wf-hint wf-insp-empty">
              Cliquer un nœud pour régler ses agents, son quorum et ses retours.
            </p>
          )}

          {retours.length > 0 && (
            <ul className="wf-returns" data-testid="wf-returns">
              <li className="wf-kicker wf-kicker-sub">Retours</li>
              {retours.map((edge) => {
                return (
                  <li
                    // La condition fait partie de l'identité : `judge→build si rouge` et `judge→build si vert` sont deux
                    // retours distincts, et sans elle ils partageaient la même clé React.
                    key={`${edge.from}>${edge.to}:${edge.when}`}
                    data-testid={`wf-edge-${edge.from}-${edge.to}`}
                  >
                    <span className="wf-return-name">
                      {edge.from} → {edge.to} si {edge.when === 'green' ? 'vert' : 'rouge'}
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
                    </label>
                    <button
                      type="button"
                      className="wf-return-drop"
                      data-testid={`wf-drop-${edge.from}-${edge.to}`}
                      onClick={() => retirerRetour(edge.from, edge.to)}
                      title="Retirer ce retour"
                    >
                      ×
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </aside>
      </div>
    </section>
  )
}
