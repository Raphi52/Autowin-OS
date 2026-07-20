/**
 * Contrat STRUCTUREL partagé de la projection « Harnais ».
 *
 * Source unique de vérité pour les types franchissant la frontière IPC : le
 * producteur (`src/main/harness/snapshot.ts`) et le consommateur
 * (`src/renderer/src/components/harness-model.ts`) importent ces définitions au
 * lieu de les dupliquer. La frontière IPC restant purement structurelle, ce
 * module ne contient QUE des types (aucune dépendance runtime).
 */

export type HarnessLayer = 'runtime' | 'configuration' | 'storage' | 'observability'
export type HarnessSource = 'ipc' | 'filesystem' | 'provider-boundary' | 'derived'
export type HarnessState = 'healthy' | 'unknown' | 'warning' | 'blocked' | 'inactive'
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

export type HarnessEdgeKind =
  'executes' | 'routes' | 'invokes' | 'injects' | 'reads' | 'persists' | 'observes' | 'gates'

export type HarnessFlow = 'chat' | 'orchestration' | 'loop' | 'pilotage' | 'brain' | 'observability'
export type HarnessLevel = 'beginner' | 'expert' | 'both'

export interface HarnessEvidence {
  source: HarnessSource
  ref: string
  detail?: string
}
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
  order: number
  focal?: boolean
  evidence: HarnessEvidence
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
  generatedAt: string
  focusModelId: string
  nodes: HarnessNode[]
  edges: HarnessEdge[]
  caps: HarnessCaps
  providers: string[]
  runtimes: HarnessRuntime[]
}
