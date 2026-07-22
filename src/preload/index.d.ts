import { ElectronAPI } from '@electron-toolkit/preload'

interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}
interface ChatAttachment {
  name: string
  mimeType: string
  size: number
  kind: 'text' | 'image' | 'file'
  content: string
}
interface ChatAttachmentMeta {
  name: string
  mimeType: string
  size: number
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
interface ChatResult {
  ok: boolean
  result?: { text: string; provider: string; systemInjected: boolean }
  error?: string
}
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
interface SessionMeta {
  id: string
  project: string
  path: string
  sizeMb: number
  mtime: number
}
interface ToolCall {
  tool: string
  detail?: string
  ts?: string
  sidechain?: boolean
}
interface TurnEntry {
  kind: 'user' | 'assistant'
  ts?: string
  text: string
  tools: ToolCall[]
  sidechain?: boolean
}
interface SessionActivity {
  meta: SessionMeta
  turns: TurnEntry[]
  toolCounts: Record<string, number>
  images: Array<{ path: string; ts?: string; exists: boolean }>
  totalToolCalls: number
}
interface ToolHabits {
  sessionsScanned: number
  totalToolCalls: number
  tools: Array<{ tool: string; count: number }>
  imagesConsulted: number
}
interface TraceEvent {
  ts: string
  source: 'bus' | 'pilot' | 'orchestrate'
  name: string
  detail?: string
  ok?: boolean
}
interface ConvActivityEntry {
  ts: string
  kind: 'chat' | 'exec' | 'judge' | 'gate' | string
  label: string
  provider?: string
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
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
interface HermesControlItem {
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

interface SkillRegistryItem extends HermesControlItem {
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
interface BehaviourContext {
  path: string
  label: string
  depth: number
}
interface HermesInjectionProof {
  id: string
  verdict: 'injected' | 'unproven'
  observedAt?: string
  reason: string
}

interface SkillLoopInput {
  steps: Array<{
    id: string
    skill: string
    capabilities?: string[]
    prompt: string
    requires?: string[]
    produces?: string[]
  }>
  passes: number
  stopOnFailure: boolean
  carryOutput: boolean
}

interface SkillLoopEvent {
  runId: string
  kind: 'run-start' | 'step-start' | 'step-done' | 'step-error' | 'run-done'
  stepId?: string
  pass?: number
  output?: string
  error?: string
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
  panels: { scout: SlotBinding[]; judge: SlotBinding[] }
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

interface HermesPreflightTrace {
  schema: 'autowin.hermes-preflight/v1'
  timestamp: string
  sessionId: string
  turnId: string
  apiRequestId: string
  provider: string
  model: string
  apiMode?: string
  conversationId?: string
  fidelity: 'exact-redacted'
  boundary: 'hermes.pre_api_request' | 'hermes.request_dump'
  source: 'plugin-hook' | 'request-dump'
  messageCount: number
  toolCount: number
  request: Record<string, unknown>
}

interface ChatApi {
  captureTestPage: () => Promise<string>
  storageMigration: () => Promise<Record<string, string>>
  completeStorageMigration: () => Promise<boolean>
  listProviders: () => Promise<string[]>
  routerSnapshot: () => Promise<{
    status: 'healthy' | 'degraded' | 'unavailable'
    version?: string
    uptimeSeconds?: number
    observedAt: string
    endpoint: string
    transportConnected: false
    connectionCount?: number
    availableConnectionCount?: number
    sources: Array<{ id: 'health' | 'connections' | 'quotas'; status: 'ok' | 'error' }>
    protections?: { circuitBreakers?: number; lockouts?: number; quotaAlerts?: number }
    connections: Array<{
      id: string
      provider: string
      authorityMode?: 'plan' | 'ask' | 'auto'
      label?: string
      email?: string
      authType?: string
      status: 'active' | 'limited' | 'error' | 'inactive'
      incident?: { label: string; at?: string }
      quotas: Array<{ label: string; remainingPercent?: number; resetAt?: string }>
    }>
  }>
  routerMigrationState: () => Promise<{
    mode: 'omniroute'
    routeModel?: string
    credentialConfigured: boolean
  }>
  setOmniRouteCredential: (credential: string) => Promise<{ configured: true }>
  deleteOmniRouteCredential: () => Promise<{ configured: false }>
  testOmniRoute: () => Promise<{
    ok: boolean
    models: Array<{ id: string; label: string }>
    reason?: string
  }>
  activateOmniRoute: (
    routeModel: string,
    reasoningEffort?: string
  ) => Promise<{
    mode: 'omniroute'
    routeModel: string
    reasoningEffort?: string
    credentialConfigured: true
  }>
  openOmniRouteDashboard: () => Promise<void>
  send: (
    provider: string | undefined,
    messages: Message[],
    conversationId?: string,
    role?: string
  ) => Promise<ChatResult>
  onDelta: (cb: (delta: string) => void) => () => void
  orchestrate: (
    task: string
  ) => Promise<{ ok: boolean; result?: OrchestrationResult; error?: string }>
  onOrchestrateStep: (cb: (step: OrchestrationStep) => void) => () => void
  roles: () => Promise<
    Record<string, { provider: string; model?: string; reasoningEffort?: string }>
  >
  setRole: (
    role: string,
    provider: string,
    model?: string,
    reasoningEffort?: string
  ) => Promise<Record<string, { provider: string; model?: string; reasoningEffort?: string }>>
  models: () => Promise<ImportedModel[]>
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
  topology: () => Promise<AgentTopology>
  setTopology: (topology: AgentTopology) => Promise<AgentTopology>
  capabilityControls: (kind: 'skills' | 'hooks' | 'tools' | 'plugins') => Promise<HermesControlItem[]>
  skills: () => Promise<SkillRegistryItem[]>
  promptCalls: (conversationId?: string) => Promise<PromptCallRecord[]>
  promptTraces: (conversationId: string) => Promise<HermesPreflightTrace[]>
  promptTraceSummary: () => Promise<HermesPreflightTrace[]>
  authorizeDiagnostics: () => Promise<string | null>
  promptTracesGlobal: (capability: string) => Promise<HermesPreflightTrace[]>
  causalTrace: (conversationId: string) => Promise<unknown[]>
  claudeHooks: () => Promise<HermesControlItem[]>
  codexHooks: () => Promise<HermesControlItem[]>
  setCapabilityTool: (
    name: string,
    enabled: boolean
  ) => Promise<{ items: HermesControlItem[]; restartRequired: true }>
  setCapabilityToolSelection: (
    names: string[]
  ) => Promise<{ items: HermesControlItem[]; restartRequired: true }>
  setCapabilityPlugin: (
    name: string,
    enabled: boolean
  ) => Promise<{ items: HermesControlItem[]; restartRequired: true }>
  behaviourWorkspace: () => Promise<string>
  chooseBehaviourWorkspace: () => Promise<string | null>
  behaviourContexts: (workspaceRoot: string) => Promise<BehaviourContext[]>
  behaviourFiles: (workspaceRoot?: string, contextRoot?: string) => Promise<BehaviourFile[]>
  readBehaviourFile: (id: string, workspaceRoot?: string, contextRoot?: string) => Promise<string>
  behaviourProof: (workspaceRoot?: string, contextRoot?: string) => Promise<HermesInjectionProof[]>
  runSkillLoop: (
    input: SkillLoopInput
  ) => Promise<{ runId: string; completed: number; failed: number }>
  loopSkills: () => Promise<
    Array<{
      id: string
      label: string
      description: string
      source: 'autowin' | 'global'
      role: 'phase' | 'capability' | 'gate' | 'meta'
    }>
  >
  generateLoopDraft: (objective: string) => Promise<SkillLoopInput>
  loopRuns: () => Promise<
    Array<{
      runId: string
      startedAt: string
      finishedAt?: string
      completed: number
      failed: number
      events: SkillLoopEvent[]
    }>
  >
  onSkillLoopEvent: (cb: (event: SkillLoopEvent) => void) => () => void
  onModelQuestion: (cb: (question: PendingModelQuestion) => void) => () => void
  answerModelQuestion: (id: string, answer: string) => Promise<{ ok: true }>
  budget: () => Promise<{
    spent: number
    budget: number | null
    ratio: number | null
    alert: boolean
  }>
  costByRole: () => Promise<Record<string, { costUsd: number; turns: number }>>
  trustRanking: () => Promise<Array<{ model: string; accuracy: number | null; confirmed: number }>>
  runsWithGate: () => Promise<
    Array<{ subject: string; summary: { status: string }; blocked: boolean }>
  >
  toolUsage: () => Promise<
    Array<{ id: string; label: string; description: string; enabled: boolean; mutable: boolean }>
  >
  kaizen: (jsonl: string) => Promise<Array<{ key: string; count: number }>>
  authorityPending: () => Promise<Array<{ id: string; question: string }>>
  authorityResolve: (id: string, choice: unknown) => Promise<unknown>
  authoritySweep: () => Promise<unknown[]>
  conversations: () => Promise<
    Array<{
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
    }>
  >
  conversationsCreate: (p: { title: string; category: string; provider: string }) => Promise<{
    id: string
    title: string
    category: string
    provider: string
  }>
  conversationsRename: (id: string, title: string) => Promise<unknown>
  conversationsSetAuthorityMode: (id: string, mode: 'plan' | 'ask' | 'auto') => Promise<unknown>
  conversationsFork: (id: string, messageId: string) => Promise<unknown>
  conversationsSwitchBranch: (id: string, branchId: string) => Promise<unknown>
  conversationsRemove: (id: string) => Promise<boolean>
  openFolder: (path: string) => Promise<void>
  appState: () => Promise<unknown>
  appCatalog: () => Promise<
    Array<{ name: string; description: string; args: Record<string, string> }>
  >
  appCommand: (
    name: string,
    args?: Record<string, unknown>
  ) => Promise<{ ok: boolean; data?: unknown; error?: string }>
  pilot: (goal: string) => Promise<{ ok: boolean; error?: string }>
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
  pendingDirectives: (conversationId: string) => Promise<string[]>
  removePendingDirective: (conversationId: string, index: number) => Promise<{ ok: boolean }>
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
  conversationRuns: (convId: string) => Promise<RunEntry[]>
  conversationActivity: (convId: string) => Promise<ConvActivityEntry[]>
  runTrace: (path: string) => Promise<OrchestrationStep[] | null>
  setActiveConversation: (convId: string | null) => Promise<unknown>
  activitySessions: () => Promise<SessionMeta[]>
  activitySession: (meta: SessionMeta) => Promise<SessionActivity>
  activityHabits: () => Promise<ToolHabits>
  activityLedger: () => Promise<TraceEvent[]>
  activityImage: (path: string) => Promise<{ dataUrl: string }>
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
  ) => Promise<Array<{ id: string; label: string; file: string; themes: string[] }>>
  listRuns: () => Promise<RunEntry[]>
  harnessSnapshot: () => Promise<import('../renderer/src/components/harness-model').HarnessSnapshot>
  getZoomFactor: () => number
  setZoomFactor: (factor: number) => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: ChatApi
  }
}
