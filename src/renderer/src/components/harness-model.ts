/**
 * Modèle PUR de la vue « Harnais » — contrat canonique + filtres + layout.
 *
 * Aucune dépendance React/IPC ici : cette couche est testée en isolation
 * (vitest) et partage le contrat du snapshot avec le preload. Le graphe est
 * composé côté main (`os:harness:snapshot`, lecture seule, bornée) ; ici on
 * ne fait que FILTRER et POSITIONNER de façon déterministe.
 *
 * Principe de rendu : des COULOIRS (couches) empilés, pas un graphe spaghetti.
 * Le modèle actif est marqué `focal` et recentré dans son couloir.
 */

/** Couche logique — un couloir horizontal lisible dans le canvas. */
export type HarnessLayer = 'runtime' | 'configuration' | 'storage' | 'observability'

/** Provenance de la preuve. `derived` = déduit, sans artefact direct lu. */
export type HarnessSource = 'ipc' | 'filesystem' | 'provider-boundary' | 'derived'

/** Statut STRICT. `unknown` par défaut tant qu'aucune sonde non-mutante n'a confirmé. */
export type HarnessState = 'healthy' | 'unknown' | 'warning' | 'blocked' | 'inactive'

/** Où le nœud s'exécute réellement. Le Brain partagé est `shared-brain` : connaissance, jamais exécuteur. */
export type HarnessRuntime = 'autowin-local' | 'provider' | 'shared-brain' | 'none'

export type HarnessNodeKind =
  | 'you'
  | 'model'
  | 'provider'
  | 'orchestrator'
  | 'subagent'
  | 'scout'
  | 'judge'
  | 'runtime'
  | 'pilot'
  | 'command-bus'
  | 'loop'
  | 'roles'
  | 'skill'
  | 'hook'
  | 'tool'
  | 'behaviour'
  | 'authority'
  | 'gate'
  | 'kit'
  | 'brain'
  | 'conversation'
  | 'run'
  | 'cost'
  | 'trust'
  | 'activity'
  | 'trace'
  | 'question'
  | 'kaizen'

/** Verbe de l'arête — un flux orienté et typé. */
export type HarnessEdgeKind =
  | 'executes'
  | 'routes'
  | 'invokes'
  | 'injects'
  | 'reads'
  | 'persists'
  | 'observes'
  | 'gates'

/** Couloir narratif : quel flux traverse ce nœud/arête. */
export type HarnessFlow = 'chat' | 'orchestration' | 'loop' | 'pilotage' | 'brain' | 'observability'

/** Niveau de révélation. `both` = visible en Débutant ET Expert. */
export type HarnessLevel = 'beginner' | 'expert' | 'both'

/** Preuve/source d'un nœud — JAMAIS un secret, une commande brute ou un contenu de fichier. */
export interface HarnessEvidence {
  source: HarnessSource
  /** Référence lisible de la preuve (module, endpoint, racine disque). */
  ref: string
  detail?: string
}

/** Métrique bornée affichée dans l'inspecteur (compteur, taille) — jamais un dump. */
export interface HarnessMetric {
  label: string
  value: string | number
}

export interface HarnessNode {
  id: string
  kind: HarnessNodeKind
  label: string
  layer: HarnessLayer
  source: HarnessSource
  state: HarnessState
  runtime: HarnessRuntime
  level: HarnessLevel
  flows: HarnessFlow[]
  role?: string
  provider?: string
  /** Ordre stable dans son couloir (layout déterministe). */
  order: number
  /** Modèle actif / point focal du canvas. */
  focal?: boolean
  evidence: HarnessEvidence
  /** Inspecteur — champs bornés. */
  roleDesc: string
  observed: string
  notObserved: string
  references: string[]
  metrics?: HarnessMetric[]
}

export interface HarnessEdge {
  id: string
  from: string
  to: string
  kind: HarnessEdgeKind
  flows: HarnessFlow[]
  level: HarnessLevel
  label?: string
}

export interface HarnessCaps {
  maxNodes: number
  maxEdges: number
  nodeCount: number
  edgeCount: number
  truncated: boolean
}

export interface HarnessSnapshot {
  /** ISO — horodatage de composition (posé côté main). */
  generatedAt: string
  /** Étiquette du modèle actif (binding orchestrateur). */
  focusModelId: string
  nodes: HarnessNode[]
  edges: HarnessEdge[]
  caps: HarnessCaps
  /** Valeurs distinctes pour les filtres (dérivées côté main). */
  providers: string[]
  runtimes: HarnessRuntime[]
}

/* --- Libellés (partagés vue + légende, testables) ----------------------- */

export const HARNESS_LAYERS: readonly HarnessLayer[] = [
  'runtime',
  'configuration',
  'storage',
  'observability'
]

export const HARNESS_FLOWS: readonly HarnessFlow[] = [
  'chat',
  'orchestration',
  'loop',
  'pilotage',
  'brain',
  'observability'
]

export const LAYER_LABEL: Record<HarnessLayer, string> = {
  runtime: 'Runtime local',
  configuration: 'Configuration',
  storage: 'Stockage & connaissance',
  observability: 'Observabilité'
}

/** Variable de couleur CSS par couche (cyan data/runtime, or config, violet savoir, rose activité). */
export const LAYER_COLOR_VAR: Record<HarnessLayer, string> = {
  runtime: 'var(--cyan)',
  configuration: 'var(--gold)',
  storage: 'var(--violet)',
  observability: 'var(--rose)'
}

export const FLOW_LABEL: Record<HarnessFlow, string> = {
  chat: 'Chat',
  orchestration: 'Orchestration',
  loop: 'Boucle',
  pilotage: 'Pilotage app',
  brain: 'Brain partagé',
  observability: 'Observabilité'
}

export const EDGE_LABEL: Record<HarnessEdgeKind, string> = {
  executes: 'exécute',
  routes: 'route',
  invokes: 'invoque',
  injects: 'injecte',
  reads: 'lit',
  persists: 'persiste',
  observes: 'observe',
  gates: 'contrôle'
}

export const STATE_LABEL: Record<HarnessState, string> = {
  healthy: 'Sain',
  unknown: 'Inconnu',
  warning: 'Vigilance',
  blocked: 'Bloqué',
  inactive: 'Inactif'
}

export const SOURCE_LABEL: Record<HarnessSource, string> = {
  ipc: 'IPC (runtime local)',
  filesystem: 'Système de fichiers',
  'provider-boundary': 'Frontière provider',
  derived: 'Déduit (sans artefact direct)'
}

export const RUNTIME_LABEL: Record<HarnessRuntime, string> = {
  'autowin-local': 'Autowin (local)',
  provider: 'Provider (distant)',
  'shared-brain': 'Brain partagé (SMB, lecture seule)',
  none: 'Hors runtime'
}

/* --- Filtres ------------------------------------------------------------- */

export interface HarnessFilters {
  level: 'beginner' | 'expert'
  flow: 'all' | HarnessFlow
  runtime: 'all' | HarnessRuntime
  provider: 'all' | string
  health: 'all' | HarnessState
  query: string
}

export const DEFAULT_HARNESS_FILTERS: HarnessFilters = {
  level: 'beginner',
  flow: 'all',
  runtime: 'all',
  provider: 'all',
  health: 'all',
  query: ''
}

/**
 * Sémantique de niveau : Débutant montre {beginner, both} ; Expert montre
 * {expert, both}. Ainsi une simplification `beginner` n'apparaît PAS en Expert
 * (pas de double-tracé) et un détail `expert` reste caché en Débutant.
 */
export function levelVisible(level: HarnessLevel, mode: 'beginner' | 'expert'): boolean {
  return level === 'both' || level === mode
}

export interface HarnessFilterResult {
  nodes: HarnessNode[]
  edges: HarnessEdge[]
  /** Nœuds correspondant à la recherche (surlignés, pas masqués). */
  matched: Set<string>
}

export function filterHarness(
  snapshot: HarnessSnapshot,
  filters: HarnessFilters
): HarnessFilterResult {
  const needle = filters.query.trim().toLocaleLowerCase('fr')
  const nodes = snapshot.nodes.filter(
    (node) =>
      levelVisible(node.level, filters.level) &&
      (filters.flow === 'all' || node.flows.includes(filters.flow)) &&
      (filters.runtime === 'all' || node.runtime === filters.runtime) &&
      (filters.provider === 'all' || node.provider === filters.provider) &&
      (filters.health === 'all' || node.state === filters.health)
  )
  const kept = new Set(nodes.map((node) => node.id))
  const edges = snapshot.edges.filter(
    (edge) =>
      kept.has(edge.from) &&
      kept.has(edge.to) &&
      levelVisible(edge.level, filters.level) &&
      (filters.flow === 'all' || edge.flows.includes(filters.flow))
  )
  const matched = new Set<string>(
    needle
      ? nodes
          .filter((node) =>
            `${node.label} ${node.roleDesc} ${node.role ?? ''} ${node.provider ?? ''} ${node.evidence.ref}`
              .toLocaleLowerCase('fr')
              .includes(needle)
          )
          .map((node) => node.id)
      : []
  )
  return { nodes, edges, matched }
}

/** Valeurs distinctes présentes, pour peupler les menus de filtre. */
export function harnessFilterOptions(snapshot: HarnessSnapshot): {
  providers: string[]
  runtimes: HarnessRuntime[]
  states: HarnessState[]
  flows: HarnessFlow[]
} {
  const providers = new Set<string>()
  const runtimes = new Set<HarnessRuntime>()
  const states = new Set<HarnessState>()
  const flows = new Set<HarnessFlow>()
  for (const node of snapshot.nodes) {
    if (node.provider) providers.add(node.provider)
    runtimes.add(node.runtime)
    states.add(node.state)
    for (const flow of node.flows) flows.add(flow)
  }
  return {
    providers: [...providers].sort((a, b) => a.localeCompare(b)),
    runtimes: HARNESS_LAYERS.length ? [...runtimes] : [],
    states: [...states],
    flows: HARNESS_FLOWS.filter((flow) => flows.has(flow))
  }
}

/* --- Layout déterministe (couloirs empilés) ----------------------------- */

export interface HarnessLayoutOptions {
  width?: number
  sidePad?: number
  nodeWidth?: number
  rowHeight?: number
  laneHead?: number
  lanePadBottom?: number
}

export interface LanePlacement {
  layer: HarnessLayer
  y: number
  height: number
}

export interface HarnessLayoutResult {
  positions: Record<string, { x: number; y: number }>
  lanes: LanePlacement[]
  width: number
  height: number
}

/** Recentre le nœud focal au milieu de la première rangée de son couloir. */
function centerFocal(ordered: HarnessNode[], perRow: number): HarnessNode[] {
  const index = ordered.findIndex((node) => node.focal)
  if (index < 0 || ordered.length < 2) return ordered
  const focal = ordered[index]
  const rest = ordered.filter((_, i) => i !== index)
  const firstRow = Math.min(perRow, ordered.length)
  const insertAt = Math.min(rest.length, Math.floor(firstRow / 2))
  return [...rest.slice(0, insertAt), focal, ...rest.slice(insertAt)]
}

/**
 * Positionne chaque nœud dans le couloir de sa couche. Rangées multiples si un
 * couloir déborde. 100 % déterministe (tri stable, aucun aléa ni Date).
 */
export function layoutHarness(
  nodes: readonly HarnessNode[],
  options: HarnessLayoutOptions = {}
): HarnessLayoutResult {
  const width = options.width ?? 1180
  const sidePad = options.sidePad ?? 40
  const nodeWidth = options.nodeWidth ?? 172
  const rowHeight = options.rowHeight ?? 98
  const laneHead = options.laneHead ?? 36
  const lanePadBottom = options.lanePadBottom ?? 28
  const usable = Math.max(nodeWidth, width - sidePad * 2)
  const perRow = Math.max(1, Math.floor(usable / nodeWidth))

  const positions: Record<string, { x: number; y: number }> = {}
  const lanes: LanePlacement[] = []
  let cursorY = 0

  for (const layer of HARNESS_LAYERS) {
    const laneNodes = nodes.filter((node) => node.layer === layer)
    const ordered = [...laneNodes].sort(
      (a, b) => a.order - b.order || a.id.localeCompare(b.id)
    )
    const arranged = centerFocal(ordered, perRow)
    const rows = Math.max(1, Math.ceil(arranged.length / perRow))
    const laneHeight = laneHead + rows * rowHeight + lanePadBottom
    lanes.push({ layer, y: cursorY, height: laneHeight })

    arranged.forEach((node, i) => {
      const row = Math.floor(i / perRow)
      const startOfRow = row * perRow
      const countInRow = Math.min(perRow, arranged.length - startOfRow)
      const col = i - startOfRow
      const slot = usable / countInRow
      positions[node.id] = {
        x: sidePad + slot * (col + 0.5),
        y: cursorY + laneHead + rowHeight * (row + 0.5)
      }
    })
    cursorY += laneHeight
  }

  return { positions, lanes, width, height: cursorY }
}

/** Coin haut-gauche d'un viewBox centrant `pos` dans une fenêtre donnée. */
export function centerViewBox(
  pos: { x: number; y: number },
  viewWidth: number,
  viewHeight: number
): { x: number; y: number } {
  return { x: pos.x - viewWidth / 2, y: pos.y - viewHeight / 2 }
}
