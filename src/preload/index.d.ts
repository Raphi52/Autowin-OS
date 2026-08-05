import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  WorktreeAgentActivity,
  WorktreeConflictDiffResult,
  WorktreeRuntimeStatus
} from '../shared/worktree-activity-model'
import type { ModelQuotaSnapshot } from '../shared/model-quotas'
import type { ChatArtifact, ArtifactEncoding } from '../shared/artifacts'
import type {
  ChatAttachment,
  AgentTopology,
  NativePreflightTrace
} from '../shared/preload-contracts'
import type { Conversation, ConversationSummary } from '../main/store/conversations'
import type { OrchestrationStep, OrchestrationResult } from '../main/orchestrator'
import type { VizGraph } from '../main/viz/graph'
import type { RunEntry } from '../main/dashboards/runs-scan'
import type { CapabilityItem } from '../main/capability-controls'
import type { SkillRegistryItem } from '../main/skill-registry'
import type { BehaviourFile } from '../main/behaviour-files'
import type { PendingModelQuestion } from '../main/model-questions'
import type { ImportedModel } from '../main/models'
import type { PromptCallRecord, CostBreakdownRow } from '../main/activity/prompt-observability'
import type { ProviderDisplayStatus, ProviderStatus } from '../main/provider-status'
import type { BehaviourComposition } from '../main/behaviour-composition'
import type { BrainTrace } from '../main/activity/brain-trace-spool'
import type { PreflightResult } from '../main/preflight'
import type { PreflightRepairOutcome } from '../main/preflight-repair'
import type { TaskManagerSnapshot, ScheduledTask } from '../main/task-manager/types'
import type { AutoCloseReport } from '../main/run-autoclose'
import type { FabricNodeSummary } from '../main/compute-fabric/control-plane'
import type { Role, RoleBinding } from '../main/roles'
import type { WorkflowProfilesFile } from '../main/workflow-profiles'
import type { WorkflowBenchReport } from '../main/workflow-bench'
import type { AutowinProfile } from '../main/profile-store'
import type { ShadowRouteRecommendation } from '../main/shadow-router'
import type { PersistedCheckpoint, CheckpointForkManifest } from '../main/wire-checkpoint-fork'
import type { OrchestrationRunState } from '../main/runs/orchestration-state'
import type { CommandSpec, CommandResult, AppSnapshot } from '../main/commands'
import type { TraceEventV1 } from '../main/activity/trace-event'
import type { SessionMeta, SessionActivity } from '../main/activity/transcripts'
import type { ClaudeHookItem } from '../main/claude-hooks'
import type { ConvActivityEntry } from '../main/activity/conv-activity'
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
  repairPreflight: (checkId: string) => Promise<PreflightRepairOutcome>
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
  getAutoClose: () => Promise<{ enabled: boolean; last?: AutoCloseReport }>
  setAutoClose: (enabled: boolean) => Promise<{ enabled: boolean; last?: AutoCloseReport }>
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
  createTicket: (
    request: import('../main/tickets-ipc').TicketCreateIpcRequest
  ) => Promise<import('../shared/tickets').TicketItem>
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
  workflowProfiles: () => Promise<WorkflowProfilesFile>
  workflowProfileSave: (profile: unknown) => Promise<WorkflowProfilesFile>
  workflowProfileRemove: (id: string) => Promise<WorkflowProfilesFile>
  workflowProfileSelect: (id: string | null) => Promise<WorkflowProfilesFile>
  /** Ce que le moteur ne peut pas jouer d'un graphe composé, plus son pire cas. */
  checkWorkflowGraph: (graph: unknown) => Promise<{
    defects: { target?: string; message: string }[]
    inertReturns: { from: string; to: string }[]
    worstCaseNodeExecutions: number | null
  }>
  /** Quel workflow pilote une conversation donnée. */
  conversationWorkflow: (conversationId: string) => Promise<string | null>
  selectConversationWorkflow: (
    conversationId: string,
    profileId: string | null
  ) => Promise<string | null>
  /** Confrontation : un même objectif joué sous plusieurs workflows, puis comparé. */
  workflowBenchRun: (
    objective: string,
    profileIds: (string | null)[]
  ) => Promise<WorkflowBenchReport>
  onWorkflowBenchProgress: (
    listener: (p: { done: number; total: number; label: string }) => void
  ) => () => void
  roles: () => Promise<Record<Role, RoleBinding>>
  setRole: (
    role: string,
    provider: string,
    model?: string,
    reasoningEffort?: string
  ) => Promise<Record<Role, RoleBinding>>
  models: (force?: boolean) => Promise<ImportedModel[]>
  fabricNodes: () => Promise<FabricNodeSummary[]>
  installIsolatedFabricFixture: () => Promise<{ summary: FabricNodeSummary; model: ImportedModel }>
  /**
   * Résultat d'exécution d'un provider — hétérogène par construction (`ProviderAdapter['send']`
   * délègue au provider réel, dont la forme du résultat varie ; aucun oracle local ne le contraint).
   */
  sendIsolatedFabricFixture: (execution?: boolean) => Promise<unknown>
  refreshFabricNode: (nodeId: string) => Promise<FabricNodeSummary>
  pairFabricNode: (request: unknown) => Promise<FabricNodeSummary>
  checkpointForks: () => Promise<Array<PersistedCheckpoint<OrchestrationRunState>>>
  createCheckpointFork: (
    checkpointId: string,
    forkId: string
  ) => Promise<CheckpointForkManifest<OrchestrationRunState>>
  shadowRouteRecommendation: (
    phase: string,
    champion: { provider: string; model: string }
  ) => Promise<ShadowRouteRecommendation>
  modelQuotas: (force?: boolean) => Promise<ModelQuotaSnapshot>
  profiles: () => Promise<AutowinProfile[]>
  saveProfile: (profile: unknown) => Promise<AutowinProfile[]>
  applyProfile: (id: string) => Promise<{ topology: AgentTopology }>
  kimiLogin: () => Promise<{ ok: true }>
  providerLogin: (provider: string) => Promise<{ ok: true }>
  topology: () => Promise<AgentTopology>
  setTopology: (topology: AgentTopology) => Promise<AgentTopology>
  capabilityControls: (kind: 'skills' | 'hooks' | 'tools' | 'plugins') => Promise<CapabilityItem[]>
  skills: () => Promise<SkillRegistryItem[]>
  promptCalls: (conversationId?: string) => Promise<PromptCallRecord[]>
  // fix-ok: golden test src/main/activity/cost-breakdown.test.ts asserts this file's source text
  // contains the literal 'cacheHitRatio' (see CostBreakdownRow) — keep the substring even after typing.
  costBreakdown: (
    dimension?: 'actor' | 'model' | 'provider',
    conversationId?: string
  ) => Promise<CostBreakdownRow[]>
  promptTraces: (conversationId: string) => Promise<NativePreflightTrace[]>
  brainTraces: (conversationId?: string) => Promise<BrainTrace[]>
  behaviourComposition: (workspace?: string) => Promise<
    BehaviourComposition & {
      inspection: { workspace: string; files: Array<BehaviourFile & { excerpt?: string }> }
    }
  >
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
  causalTrace: (conversationId: string) => Promise<TraceEventV1[]>
  activitySessions: () => Promise<SessionMeta[]>
  activitySession: (meta: { id: string; project: string }) => Promise<SessionActivity>
  activityImage: (
    session: { id: string; project: string },
    path: string
  ) => Promise<{ dataUrl: string }>
  claudeHooks: () => Promise<ClaudeHookItem[]>
  codexHooks: () => Promise<ClaudeHookItem[]>
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
  /**
   * `bus.resolveDecision()` (src/main/commands.ts) est lui-même typé `Promise<unknown>` : la décision
   * résolue est un objet de forme libre selon le type de la question d'autorité posée.
   */
  authorityResolve: (id: string, choice: unknown) => Promise<unknown>

  conversations: () => Promise<ConversationSummary[]>
  conversation: (id: string) => Promise<Conversation | null>
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
  conversationsRename: (id: string, title: string) => Promise<void>
  conversationsSetAuthorityMode: (
    id: string,
    mode: 'plan' | 'ask' | 'auto'
  ) => Promise<Conversation>
  conversationsFork: (id: string, messageId: string) => Promise<Conversation>
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
  taskManagerCreate: (task: unknown) => Promise<ScheduledTask>
  taskManagerUpdate: (id: string, task: unknown) => Promise<ScheduledTask>
  taskManagerRemove: (id: string) => Promise<boolean>
  taskManagerAcknowledge: (alertId: string) => Promise<boolean>
  taskManagerRunNow: (id: string) => Promise<{ started: boolean }>
  openFolder: (path: string) => Promise<void>
  appState: () => Promise<AppSnapshot>
  appCatalog: () => Promise<CommandSpec[]>
  appCommand: (name: string, args?: Record<string, unknown>) => Promise<CommandResult>
  pilotChat: (
    messages: Array<{
      role: 'user' | 'assistant'
      content: string
      attachments?: ChatAttachment[]
    }>,
    conversationId?: string
  ) => Promise<{
    ok: boolean
    cancelled: boolean
    turnId: string
    text?: string
    error?: string
    verification?: { complete: boolean; evidence: string }
  }>
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
  setActiveConversation: (convId: string | null) => Promise<{ ok: boolean }>
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
  loadBrainGraph: (path: string, lod?: number, community?: number) => Promise<VizGraph>
  loadBrainGraphPreview: (path: string, lod?: number) => Promise<VizGraph>
  loadBrainThemes: (path: string) => Promise<Array<{ id: string; label: string }>>
  loadBrainThemeNodes: (path: string, themeIds: string[]) => Promise<VizGraph['nodes']>
  loadBrainNeighborhood: (path: string, nodeId: string) => Promise<VizGraph>
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
