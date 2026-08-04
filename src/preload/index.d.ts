import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  WorktreeAgentActivity,
  WorktreeConflictDiffResult,
  WorktreeRuntimeStatus
} from '../shared/worktree-activity-model'
import type { ModelQuotaSnapshot } from '../shared/model-quotas'
import type { ChatArtifact, ArtifactEncoding } from '../shared/artifacts'

interface ChatAttachment {
  name: string
  mimeType: string
  size: number
  kind: 'text' | 'image' | 'file'
  content: string
  thumbnail?: string
}
interface ChatAttachmentMeta {
  name: string
  mimeType: string
  size: number
  thumbnail?: string
  artifact?: ChatArtifact
  turnId?: string
  originalUnavailable?: boolean
}
type StoredChatPart =
  | { kind: 'text'; text: string; streamId?: string }
  | {
      kind: 'action'
      actionId?: string
      name: string
      args?: unknown
      ok?: boolean
      data?: unknown
    }
  | { kind: 'artifact'; artifact: ChatArtifact }
interface OrchestrationStep {
  step: 'exec' | 'judge' | 'gate'
  provider?: string
  role?: string
  text?: string
  tokens?: number
  detail?: string
}
interface OrchestrationResult {
  task: string
  result: string
  valid: boolean
  gateBlocked: boolean
  gateReasons: string[]
  pendingDecisionId?: string
  costUsd: number
  trace: OrchestrationStep[]
}
interface Brain3d {
  nodes: Array<{ id: string; label: string; group: number; file?: string; themes?: string[] }>
  links: Array<{ source: string; target: string; weight: number; relation?: string }>
  totalNodes?: number
}
interface ConvActivityEntry {
  ts: string
  kind: 'chat' | 'exec' | 'judge' | 'gate' | string
  label: string
  provider?: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  costUsd?: number
  durationMs?: number
  usageCallId?: string
  text?: string
}
interface RunEntry {
  subject: string
  session: string
  path: string
  mtime: number
  summary: {
    status: string
    regime?: string
    dodTotal: number
    dodChecked: number
    journalEvents: number
    defauts: number
  }
}
interface CapabilityItem {
  id: string
  label: string
  description: string
  enabled: boolean
  mutable: boolean
  source?: string
  scope?: 'global' | 'project'
  event?: string
  matcher?: string
}

interface SkillRegistryItem extends CapabilityItem {
  source: string
  sourceLabel: string
}

interface BehaviourFile {
  id: string
  label: string
  path: string
  engine: 'codex' | 'claude' | 'autowin'
  state: 'active' | 'conditional' | 'shadowed' | 'declared' | 'injected'
  scope: 'global' | 'workspace' | 'project' | 'skill'
  reason: string
  injectedAt: string
  injectedInto: string
  active: boolean
  size: number
}

interface PendingModelQuestion {
  id: string
  source: 'chat' | 'loop'
  context?: string
  text: string
  options: string[]
}

interface ImportedModel {
  id: string
  provider: string
  model: string
  label: string
  reasoningEfforts: string[]
  defaultReasoningEffort: string
  dynamicallyLoaded?: boolean
}

interface SlotBinding {
  slotId: string
  provider: string
  modelId: string
  reasoningEffort: string
}

interface AgentTopology {
  version: number
  orchestrator: SlotBinding
  subagents: SlotBinding[]
  panels: {
    scout: SlotBinding[]
    frame: SlotBinding[]
    terrain: SlotBinding[]
    judge: SlotBinding[]
  }
}

interface PromptCallRecord {
  id: string
  ts: string
  conversationId: string
  turnId: string
  iteration: number
  actor: string
  provider: string
  model?: string
  transport: string
  boundary: string
  limitation: string
  system?: string
  messages: Array<{ role: string; content: string }>
  options: Record<string, unknown>
  response: string
  usage?: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
    costUsd?: number
  }
}

type AuthStatus = 'authenticated' | 'expired' | 'installed-untested' | 'absent' | 'unknown'
type ProviderDisplayStatus = AuthStatus | 'standby'
interface ProviderStatus {
  provider: string
  status: ProviderDisplayStatus
  testable: boolean
  detail?: string
  lastCheckedAt?: number
}
interface BehaviourInfluencerField {
  label: string
  value: string
  source: string
  excerpt?: string
}
interface BehaviourPhaseSystemPrompt {
  phase: string
  blocks: BehaviourInfluencerField[]
}
interface BehaviourComposition {
  orchestrated: {
    systemPrompt: BehaviourPhaseSystemPrompt[]
    injectedContext: BehaviourInfluencerField[]
    modelSelection: BehaviourInfluencerField[]
    regime: BehaviourInfluencerField[]
    guardrails: BehaviourInfluencerField[]
  }
  direct: {
    systemPrompt: BehaviourInfluencerField[]
    modelSelection: BehaviourInfluencerField[]
  }
}
interface BrainNavigationCandidate {
  rank: number
  path: string
  type: string
  denseCos: number
  retained: boolean
}
interface BrainNavigation {
  query: string
  minDense: number
  candidates: BrainNavigationCandidate[]
}
interface BrainTrace {
  timestamp: string
  conversationId: string
  turnId?: string
  kind?: 'automatic' | 'query'
  query: string
  found?: boolean
  status?: 'found' | 'empty' | 'unavailable'
  injectedChars: number
  navigation?: BrainNavigation
}
interface NativePreflightTrace {
  schema: 'autowin.native-preflight/v1'
  timestamp: string
  sessionId: string
  turnId: string
  apiRequestId: string
  provider: string
  model: string
  apiMode?: string
  conversationId?: string
  fidelity: 'exact-redacted'
  boundary: 'native.pre_api_request'
  source: 'plugin-hook' | 'request-dump'
  messageCount: number
  toolCount: number
  request: Record<string, unknown>
}

interface PreflightCheck {
  id: string
  label: string
  ok: boolean
  detail?: string
  standby?: boolean
}
interface PreflightResult {
  ok: boolean
  summary: string
  checks: PreflightCheck[]
}
interface TaskManagerSnapshot {
  schemaVersion: 1
  tasks: Array<Record<string, unknown>>
  occurrences: Array<Record<string, unknown>>
  alerts: Array<Record<string, unknown>>
  scheduler: {
    running: boolean
    nextWakeAt: number | null
    relayAvailable: boolean
    relayError?: string
  }
}
interface ChatApi {
  captureTestPage: () => Promise<string>
  seedConversationScopeTest: (
    conversationId: string,
    variant: 'a' | 'b'
  ) => Promise<{ conversationId: string; path: string; variant: 'a' | 'b' }>
  seedArtifactPreviewsTest: (htmlOnly?: boolean) => Promise<{
    conversationId: string
    turnId: string
  }>
  storageMigration: () => Promise<Record<string, string>>
  completeStorageMigration: () => Promise<boolean>
  orchestrate: (
    task: string,
    conversationId?: string
  ) => Promise<{ ok: boolean; result?: OrchestrationResult; error?: string }>
  onOrchestrateStep: (cb: (step: OrchestrationStep) => void) => () => void
  onPreflight: (cb: (result: PreflightResult) => void) => () => void
  getPreflight: () => Promise<PreflightResult | null>
  repairPreflight: (checkId: string) => Promise<{ started: boolean; detail: string }>
  recheckPreflight: (force?: boolean) => Promise<PreflightResult>
  orchestrationBudget: () => Promise<{
    maxUsd: number | null
    maxProviderCalls: number
    maxTotalTokens: number
  }>
  setOrchestrationBudget: (settings: {
    maxUsd: number | null
    maxProviderCalls: number
    maxTotalTokens: number
  }) => Promise<{
    maxUsd: number | null
    maxProviderCalls: number
    maxTotalTokens: number
  }>
  getGitState: (repoPath?: string) => Promise<import('../shared/git-read').GitReadResult>
  conversationGitState: (
    conversationId: string
  ) => Promise<import('../shared/git-read').GitReadResult>
  conversationGitDiff: (
    conversationId: string,
    path: string,
    workspaceRoot: string
  ) => Promise<import('../shared/git-read').GitDiffResult>
  getGitGraph: (repoPath?: string) => Promise<import('../shared/git-graph').GitGraphSnapshot>
  getGitDiff: (
    path: string,
    repoPath?: string
  ) => Promise<import('../shared/git-read').GitDiffResult>
  pickGitRepo: () => Promise<string | null>
  brainRepoPath: () => Promise<string>
  getAutoClose: () => Promise<{ enabled: boolean; last?: unknown }>
  setAutoClose: (enabled: boolean) => Promise<{ enabled: boolean; last?: unknown }>
  unfinishedTurns: () => Promise<
    Array<{ conversationId: string; turnId: string; events: number; updatedAt: number }>
  >
  turnJournal: (conversationId: string, turnId: string) => Promise<Array<Record<string, unknown>>>
  checkUpdate: () => Promise<{
    available: boolean
    behind: number
    branch?: string
    error?: string
  }>
  applyUpdate: () => Promise<{
    ok: boolean
    relaunch?: boolean
    npmInstalled?: boolean
    error?: string
  }>
  ticketSources: () => Promise<import('../shared/tickets').TicketSourceSummary[]>
  saveTicketSource: (
    profile: import('../shared/tickets').TicketSourceProfile
  ) => Promise<import('../shared/tickets').TicketSourceSummary[]>
  listTickets: (
    request: import('../shared/tickets').TicketListRequest
  ) => Promise<import('../shared/tickets').TicketPage>
  cancelTickets: (requestId: string) => Promise<boolean>
  listTicketPeople: (source: unknown) => Promise<string[]>
  setTicketsFixture: (fixture: unknown) => Promise<boolean>
  getWorktreeActivity: () => Promise<WorktreeAgentActivity[]>
  getWorktreeStatus: () => Promise<WorktreeRuntimeStatus>
  getWorktreeConflictDiff: (agentId: string) => Promise<WorktreeConflictDiffResult>
  retryWorktreeRecovery: (agentId: string) => Promise<WorktreeAgentActivity | undefined>
  setWorktreeFixture: (fixture: {
    activity: WorktreeAgentActivity[]
    status: WorktreeRuntimeStatus
  }) => Promise<boolean>
  onWorktreeActivity: (cb: (activity: WorktreeAgentActivity[]) => void) => () => void
  /** Workflows nommés : lire, créer/modifier, supprimer, sélectionner. */
  workflowProfiles: () => Promise<unknown>
  workflowProfileSave: (profile: unknown) => Promise<unknown>
  workflowProfileRemove: (id: string) => Promise<unknown>
  workflowProfileSelect: (id: string | null) => Promise<unknown>
  /** Confrontation : un même objectif joué sous plusieurs workflows, puis comparé. */
  workflowBenchRun: (objective: string, profileIds: (string | null)[]) => Promise<unknown>
  onWorkflowBenchProgress: (
    listener: (p: { done: number; total: number; label: string }) => void
  ) => () => void
  roles: () => Promise<
    Record<string, { provider: string; model?: string; reasoningEffort?: string }>
  >
  setRole: (
    role: string,
    provider: string,
    model?: string,
    reasoningEffort?: string
  ) => Promise<Record<string, { provider: string; model?: string; reasoningEffort?: string }>>
  models: (force?: boolean) => Promise<ImportedModel[]>
  fabricNodes: () => Promise<unknown[]>
  installIsolatedFabricFixture: () => Promise<unknown>
  sendIsolatedFabricFixture: (execution?: boolean) => Promise<unknown>
  refreshFabricNode: (nodeId: string) => Promise<unknown>
  pairFabricNode: (request: unknown) => Promise<unknown>
  checkpointForks: () => Promise<Array<{ id: string; runId: string; createdAt: string }>>
  createCheckpointFork: (checkpointId: string, forkId: string) => Promise<unknown>
  shadowRouteRecommendation: (
    phase: string,
    champion: { provider: string; model: string }
  ) => Promise<unknown>
  modelQuotas: (force?: boolean) => Promise<ModelQuotaSnapshot>
  profiles: () => Promise<
    Array<{
      id: string
      name: string
      description?: string
      updatedAt: string
      topology: AgentTopology
    }>
  >
  saveProfile: (profile: unknown) => Promise<unknown[]>
  applyProfile: (id: string) => Promise<{ topology: AgentTopology }>
  kimiLogin: () => Promise<{ ok: true }>
  providerLogin: (provider: string) => Promise<{ ok: true }>
  topology: () => Promise<AgentTopology>
  setTopology: (topology: AgentTopology) => Promise<AgentTopology>
  capabilityControls: (kind: 'skills' | 'hooks' | 'tools' | 'plugins') => Promise<CapabilityItem[]>
  skills: () => Promise<SkillRegistryItem[]>
  promptCalls: (conversationId?: string) => Promise<PromptCallRecord[]>
  costBreakdown: (
    dimension?: 'actor' | 'model' | 'provider',
    conversationId?: string
  ) => Promise<
    Array<{
      key: string
      calls: number
      costUsd: number
      inputTokens: number
      outputTokens: number
      cacheReadTokens: number
      cacheHitRatio: number
      durationMs: number
      unpricedCalls: number
    }>
  >
  promptTraces: (conversationId: string) => Promise<NativePreflightTrace[]>
  brainTraces: (conversationId?: string) => Promise<BrainTrace[]>
  behaviourComposition: (workspace?: string) => Promise<BehaviourComposition>
  installIsolatedBehaviourFixture: () => Promise<string>
  providerStatus: () => Promise<ProviderStatus[]>
  providerTest: (provider: string) => Promise<{ provider: string; status: ProviderDisplayStatus }>
  setProviderMode: (
    provider: string,
    mode: 'active' | 'standby'
  ) => Promise<{ mode: 'active' | 'standby' }>
  promptTraceSummary: () => Promise<NativePreflightTrace[]>
  authorizeDiagnostics: () => Promise<string | null>
  promptTracesGlobal: (capability: string) => Promise<NativePreflightTrace[]>
  causalTrace: (conversationId: string) => Promise<unknown[]>
  activitySessions: () => Promise<
    Array<{ id: string; project: string; path: string; sizeMb: number; mtime: number }>
  >
  activitySession: (meta: { id: string; project: string }) => Promise<{
    meta: { id: string; project: string; path: string; sizeMb: number; mtime: number }
    turns: Array<{ kind: 'user' | 'assistant'; text: string }>
    images: Array<{ path: string; exists: boolean }>
    totalToolCalls: number
  }>
  activityImage: (
    session: { id: string; project: string },
    path: string
  ) => Promise<{ dataUrl: string }>
  claudeHooks: () => Promise<CapabilityItem[]>
  codexHooks: () => Promise<CapabilityItem[]>
  setCapabilityTool: (
    name: string,
    enabled: boolean
  ) => Promise<{ items: CapabilityItem[]; restartRequired: true }>
  chooseBehaviourWorkspace: () => Promise<string | null>
  onModelQuestion: (cb: (question: PendingModelQuestion) => void) => () => void
  answerModelQuestion: (id: string, answer: string) => Promise<{ ok: true }>
  toolUsage: () => Promise<
    Array<{ id: string; label: string; description: string; enabled: boolean; mutable: boolean }>
  >
  authorityPending: () => Promise<Array<{ id: string; question: string }>>
  authorityResolve: (id: string, choice: unknown) => Promise<unknown>

  conversations: () => Promise<
    Array<{
      id: string
      title: string
      category: string
      provider: string
      messageCount: number
      lastMessageRole?: 'user' | 'assistant'
      lastAssistantStatus?: 'streaming' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
      updatedAt: number
    }>
  >
  conversation: (id: string) => Promise<{
    id: string
    title: string
    category: string
    provider: string
    messages: Array<{
      role: 'user' | 'assistant'
      content: string
      ts: number
      attachments?: ChatAttachmentMeta[]
      turnId?: string
      status?: 'streaming' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
      parts?: StoredChatPart[]
      error?: string
    }>
    updatedAt: number
  } | null>
  conversationsCreate: (p: {
    title: string
    category: string
    provider: string
    authorityMode?: 'plan' | 'ask' | 'auto'
  }) => Promise<{
    id: string
    title: string
    category: string
    provider: string
  }>
  routeConversationMessage: (
    conversationId: string,
    message: string,
    attachmentNames: string[]
  ) => Promise<{
    sourceConversationId: string
    conversationId: string
    routed: boolean
    title?: string
    decision: { route: 'current' | 'new'; confidence: number; reason: string }
  }>
  conversationsRename: (id: string, title: string) => Promise<unknown>
  conversationsSetAuthorityMode: (id: string, mode: 'plan' | 'ask' | 'auto') => Promise<unknown>
  conversationsFork: (id: string, messageId: string) => Promise<unknown>
  conversationsRemove: (id: string) => Promise<boolean>
  readChatArtifact: (
    conversationId: string,
    turnId: string,
    artifactId: string
  ) => Promise<{
    ok: boolean
    artifact?: ChatArtifact
    encoding?: ArtifactEncoding
    content?: string
    error?: string
  }>
  revealChatArtifact: (
    conversationId: string,
    turnId: string,
    artifactId: string
  ) => Promise<{ ok: boolean; error?: string }>
  taskManagerSnapshot: () => Promise<TaskManagerSnapshot>
  taskManagerCreate: (task: unknown) => Promise<Record<string, unknown>>
  taskManagerUpdate: (id: string, task: unknown) => Promise<Record<string, unknown>>
  taskManagerRemove: (id: string) => Promise<boolean>
  taskManagerAcknowledge: (alertId: string) => Promise<boolean>
  taskManagerRunNow: (id: string) => Promise<{ started: boolean }>
  openFolder: (path: string) => Promise<void>
  appState: () => Promise<unknown>
  appCatalog: () => Promise<
    Array<{ name: string; description: string; args: Record<string, string> }>
  >
  appCommand: (
    name: string,
    args?: Record<string, unknown>
  ) => Promise<{ ok: boolean; data?: unknown; error?: string }>
  pilotChat: (
    messages: Array<{
      role: 'user' | 'assistant'
      content: string
      attachments?: ChatAttachment[]
    }>,
    conversationId?: string
  ) => Promise<{ ok: boolean; cancelled?: boolean; error?: string }>
  cancelPilotChat: (conversationId: string) => Promise<{ ok: boolean }>
  cancelOrchestration: (conversationId: string) => Promise<{ ok: boolean }>
  injectDirective: (conversationId: string, directive: string) => Promise<{ ok: boolean }>

  markResponseDisplayed: (
    conversationId: string,
    content: string
  ) => Promise<{ ok: boolean; eventId: string }>
  onPilotEvent: (
    cb: (e: {
      kind: string
      conversationId?: string
      turnId?: string
      streamId?: string
      actionId?: string
      iteration?: number
      text?: string
      name?: string
      args?: unknown
      ok?: boolean
      data?: unknown
    }) => void
  ) => () => void
  onAppEvent: (
    cb: (e: {
      type: string
      tab?: string
      origin?: string
      scope?: string
      text?: string
      convId?: string
      runPath?: string
      task?: string
      status?: string
      step?: OrchestrationStep
      phase?: { step: string; provider?: string; role?: string }
      deltaStep?: 'exec' | 'judge'
      delta?: string
    }) => void
  ) => () => void
  emitIsolatedTestAppEvent: (event: Record<string, unknown> & { type: string }) => Promise<boolean>
  isolatedTestConversationReadCount: (reset?: boolean) => Promise<number>
  conversationRuns: (convId: string) => Promise<RunEntry[]>
  deleteConversationRun: (
    convId: string,
    path: string
  ) => Promise<{ ok: boolean; kind: 'deleted' | 'detached' }>
  conversationActivity: (convId: string) => Promise<ConvActivityEntry[]>
  runTrace: (path: string) => Promise<OrchestrationStep[] | null>
  setActiveConversation: (convId: string | null) => Promise<unknown>
  listBrains: () => Promise<
    Array<{
      id: string
      label: string
      path: string
      sizeMb: number
      kind: 'vault' | 'graphify'
      themes?: Array<{ id: string; label: string }>
    }>
  >
  loadBrainGraph: (path: string, lod?: number, community?: number) => Promise<Brain3d>
  loadBrainGraphPreview: (path: string, lod?: number) => Promise<Brain3d>
  loadBrainThemes: (path: string) => Promise<Array<{ id: string; label: string }>>
  loadBrainThemeNodes: (path: string, themeIds: string[]) => Promise<Brain3d['nodes']>
  loadBrainNeighborhood: (path: string, nodeId: string) => Promise<Brain3d>
  readNodeFile: (path: string) => Promise<{ path: string; content: string }>
  searchBrain: (
    path: string,
    query: string
  ) => Promise<
    Array<{
      id: string
      label: string
      file: string
      themes: string[]
      score: number
      denseScore?: number
      lexicalScore?: number
      graphScore?: number
      fusedScore?: number
      relations: Array<{ type: string; target: string }>
    }>
  >
  refreshBrain: (path: string) => Promise<{ ok: boolean }>
  listRuns: () => Promise<RunEntry[]>
  deleteRun: (path: string) => Promise<{ ok: boolean }>

  getZoomFactor: () => number
  setZoomFactor: (factor: number) => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: ChatApi
  }
}
