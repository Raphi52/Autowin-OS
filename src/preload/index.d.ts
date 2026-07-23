import { ElectronAPI } from '@electron-toolkit/preload'
import type { WorktreeAgentActivity } from '../shared/worktree-activity-model'

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
  panels: { scout: SlotBinding[]; judge: SlotBinding[]; frame: SlotBinding[] }
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
  query: string
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
interface ChatApi {
  captureTestPage: () => Promise<string>
  storageMigration: () => Promise<Record<string, string>>
  completeStorageMigration: () => Promise<boolean>
  orchestrate: (
    task: string
  ) => Promise<{ ok: boolean; result?: OrchestrationResult; error?: string }>
  onOrchestrateStep: (cb: (step: OrchestrationStep) => void) => () => void
  onPreflight: (cb: (result: PreflightResult) => void) => () => void
  getPreflight: () => Promise<PreflightResult | null>
  recheckPreflight: (force?: boolean) => Promise<PreflightResult>
  getGitState: () => Promise<import('../shared/git-read').GitReadResult>
  getGitDiff: (path: string) => Promise<import('../shared/git-read').GitDiffResult>
  getWorktreeActivity: () => Promise<WorktreeAgentActivity[]>
  onWorktreeActivity: (cb: (activity: WorktreeAgentActivity[]) => void) => () => void
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
  providerLogin: (provider: string) => Promise<{ ok: true }>
  topology: () => Promise<AgentTopology>
  setTopology: (topology: AgentTopology) => Promise<AgentTopology>
  capabilityControls: (kind: 'skills' | 'hooks' | 'tools' | 'plugins') => Promise<CapabilityItem[]>
  skills: () => Promise<SkillRegistryItem[]>
  promptCalls: (conversationId?: string) => Promise<PromptCallRecord[]>
  promptTraces: (conversationId: string) => Promise<NativePreflightTrace[]>
  brainTraces: (conversationId?: string) => Promise<BrainTrace[]>
  behaviourComposition: () => Promise<BehaviourComposition>
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
  conversationRuns: (convId: string) => Promise<RunEntry[]>
  conversationActivity: (convId: string) => Promise<ConvActivityEntry[]>
  runTrace: (path: string) => Promise<OrchestrationStep[] | null>
  setActiveConversation: (convId: string | null) => Promise<unknown>
  activitySessions: () => Promise<SessionMeta[]>
  activitySession: (meta: SessionMeta) => Promise<SessionActivity>

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

  getZoomFactor: () => number
  setZoomFactor: (factor: number) => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: ChatApi
  }
}
