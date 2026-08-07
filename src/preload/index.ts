import { contextBridge, ipcRenderer, webFrame } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  ChatAttachment,
  AgentTopology,
  NativePreflightTrace
} from '../shared/preload-contracts'
import type {
  WorktreeAgentActivity,
  WorktreeConflictDiffResult,
  WorktreeRuntimeStatus
} from '../shared/worktree-activity-model'
import type { ModelQuotaSnapshot } from '../shared/model-quotas'
import type { UpdateStrategy } from '../shared/update-contract'
import type { GitReadResult, GitDiffResult } from '../shared/git-read'
import type { GitGraphSnapshot } from '../shared/git-graph'
import type { WorktreeMapSnapshot } from '../shared/worktree-map'
import type {
  TicketItem,
  TicketSourceSummary,
  TicketSourceProfile,
  TicketListRequest,
  TicketPage
} from '../shared/tickets'
import type { TicketCreateIpcRequest, TicketGetIpcRequest } from '../main/tickets-ipc'
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

export interface ClaudeAccountEntry {
  id: string
  displayName: string
  /** Niveau d'abonnement (« team », « max »…) : ce qui distingue deux comptes de meme email. */
  tier: string
  email?: string
  active: boolean
}
export interface ClaudeAccountsPayload {
  activeId: string
  accounts: ClaudeAccountEntry[]
}
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
import type { ChatArtifact, ArtifactEncoding } from '../shared/artifacts'

/** API exposée au renderer — chaque méthode a un handler main réel. */
const api = {
  captureTestPage: (): Promise<string> => ipcRenderer.invoke('app:test:capture-page'),
  seedConversationScopeTest: (
    conversationId: string,
    variant: 'a' | 'b'
  ): Promise<{ conversationId: string; path: string; variant: 'a' | 'b' }> =>
    ipcRenderer.invoke('app:test:seed-conversation-scope', conversationId, variant),
  seedArtifactPreviewsTest: (
    htmlOnly = false
  ): Promise<{ conversationId: string; turnId: string }> =>
    ipcRenderer.invoke('app:test:seed-artifact-previews', htmlOnly),
  storageMigration: (): Promise<Record<string, string>> =>
    ipcRenderer.invoke('app:storage-migration'),
  completeStorageMigration: (): Promise<boolean> =>
    ipcRenderer.invoke('app:storage-migration-complete'),
  // Orchestration disciplinée
  orchestrate: (
    task: string,
    conversationId?: string
  ): Promise<{ ok: boolean; result?: OrchestrationResult; error?: string }> =>
    ipcRenderer.invoke('os:orchestrate', task, conversationId),
  onOrchestrateStep: (cb: (step: OrchestrationStep) => void): (() => void) => {
    const handler = (_e: unknown, step: OrchestrationStep): void => cb(step)
    ipcRenderer.on('orchestrate:step', handler)
    return () => ipcRenderer.removeListener('orchestrate:step', handler)
  },
  // #4 — résultat du diagnostic de démarrage (émis seulement si dégradé) → bannière.
  onPreflight: (cb: (result: PreflightResult) => void): (() => void) => {
    const handler = (_e: unknown, result: PreflightResult): void => cb(result)
    ipcRenderer.on('preflight:result', handler)
    return () => ipcRenderer.removeListener('preflight:result', handler)
  },
  getPreflight: (): Promise<PreflightResult | null> => ipcRenderer.invoke('preflight:current'),
  // Source control — lecture git READ-ONLY (statut, branche, changements, historique). Aucune action git.
  getGitState: (repoPath?: string): Promise<GitReadResult> =>
    ipcRenderer.invoke('git:read', repoPath),
  conversationGitState: (conversationId: string): Promise<GitReadResult> =>
    ipcRenderer.invoke('git:conversationRead', conversationId),
  conversationGitDiff: (
    conversationId: string,
    path: string,
    workspaceRoot: string
  ): Promise<GitDiffResult> =>
    ipcRenderer.invoke('git:conversationDiff', conversationId, path, workspaceRoot),
  getGitGraph: (repoPath?: string): Promise<GitGraphSnapshot> =>
    ipcRenderer.invoke('git:graph', repoPath),
  getWorktreeMap: (repoPath?: string): Promise<WorktreeMapSnapshot> =>
    ipcRenderer.invoke('git:worktreeMap', repoPath),
  getGitDiff: (path: string, repoPath?: string): Promise<GitDiffResult> =>
    ipcRenderer.invoke('git:diff', path, repoPath),
  pickGitRepo: (): Promise<string | null> => ipcRenderer.invoke('git:pickRepo'),
  brainRepoPath: (): Promise<string> => ipcRenderer.invoke('git:brainRoot'),
  getAutoClose: (): Promise<{ enabled: boolean; last?: AutoCloseReport }> =>
    ipcRenderer.invoke('run:autoClose:get'),
  setAutoClose: (enabled: boolean): Promise<{ enabled: boolean; last?: AutoCloseReport }> =>
    ipcRenderer.invoke('run:autoClose:set', enabled),
  // Survie niveau 2 : tours restés inachevés (app fermée pendant l'exécution) + leur journal.
  unfinishedTurns: (): Promise<
    Array<{ conversationId: string; turnId: string; events: number; updatedAt: number }>
  > => ipcRenderer.invoke('runs:unfinishedTurns'),
  turnJournal: (conversationId: string, turnId: string): Promise<Array<Record<string, unknown>>> =>
    ipcRenderer.invoke('runs:turnJournal', conversationId, turnId),
  // Auto-update git au démarrage.
  checkUpdate: (): Promise<{
    available: boolean
    behind: number
    branch?: string
    reference?: string
    dirty?: boolean
    strategies?: UpdateStrategy[]
  }> => ipcRenderer.invoke('update:check'),
  applyUpdate: (strategy?: UpdateStrategy): Promise<{
    ok: boolean
    relaunch?: boolean
    npmInstalled?: boolean
    error?: string
    strategy?: UpdateStrategy
    /** Rien n'a ete touche : il manque une intention explicite. Ce n'est pas un echec. */
    needsChoice?: boolean
    strategies?: UpdateStrategy[]
  }> => ipcRenderer.invoke('update:apply', strategy),
  ticketSources: (): Promise<TicketSourceSummary[]> => ipcRenderer.invoke('tickets:sources'),
  saveTicketSource: (profile: TicketSourceProfile): Promise<TicketSourceSummary[]> =>
    ipcRenderer.invoke('tickets:source:save', profile),
  listTickets: (request: TicketListRequest): Promise<TicketPage> =>
    ipcRenderer.invoke('tickets:list', request),
  createTicket: (request: TicketCreateIpcRequest): Promise<TicketItem> =>
    ipcRenderer.invoke('tickets:create', request),
  getTicket: (request: TicketGetIpcRequest): Promise<TicketItem> =>
    ipcRenderer.invoke('tickets:get', request),
  cancelTickets: (requestId: string): Promise<boolean> =>
    ipcRenderer.invoke('tickets:cancel', requestId),
  listTicketPeople: (source: unknown): Promise<string[]> =>
    ipcRenderer.invoke('tickets:people', source),
  setTicketsFixture: (fixture: unknown): Promise<boolean> =>
    ipcRenderer.invoke('app:test:tickets-fixture', fixture),
  // Cockpit worktree (volet A) — activité des copies isolées par agent (frise + journal).
  getWorktreeActivity: (): Promise<WorktreeAgentActivity[]> =>
    ipcRenderer.invoke('worktree:activity'),
  getWorktreeStatus: (): Promise<WorktreeRuntimeStatus> => ipcRenderer.invoke('worktree:status'),
  getWorktreeConflictDiff: (agentId: string): Promise<WorktreeConflictDiffResult> =>
    ipcRenderer.invoke('worktree:conflict-diff', agentId),
  retryWorktreeRecovery: (agentId: string): Promise<WorktreeAgentActivity | undefined> =>
    ipcRenderer.invoke('worktree:retry-recovery', agentId),
  setWorktreeFixture: (fixture: {
    activity: WorktreeAgentActivity[]
    status: WorktreeRuntimeStatus
  }): Promise<boolean> => ipcRenderer.invoke('app:test:worktree-fixture', fixture),
  onWorktreeActivity: (cb: (activity: WorktreeAgentActivity[]) => void): (() => void) => {
    const handler = (_e: unknown, activity: WorktreeAgentActivity[]): void => cb(activity)
    ipcRenderer.on('worktree:activity-changed', handler)
    return () => ipcRenderer.removeListener('worktree:activity-changed', handler)
  },
  // #5 — le wizard first-run re-vérifie la config à la demande (force=true pour le bouton).
  repairPreflight: (checkId: string): Promise<PreflightRepairOutcome> =>
    ipcRenderer.invoke('preflight:repair', checkId),
  recheckPreflight: (force?: boolean): Promise<PreflightResult> =>
    ipcRenderer.invoke('preflight:recheck', force),
  orchestrationBudget: (): Promise<{
    maxUsd: number | null
    maxProviderCalls: number
    maxTotalTokens: number
  }> => ipcRenderer.invoke('os:orchestrationBudget:get'),
  setOrchestrationBudget: (settings: {
    maxUsd: number | null
    maxProviderCalls: number
    maxTotalTokens: number
  }): Promise<{
    maxUsd: number | null
    maxProviderCalls: number
    maxTotalTokens: number
  }> => ipcRenderer.invoke('os:orchestrationBudget:set', settings),
  // Config par rôle
  workflowProfiles: (): Promise<WorkflowProfilesFile> =>
    ipcRenderer.invoke('os:workflowProfiles:get'),
  workflowProfileSave: (profile: unknown): Promise<WorkflowProfilesFile> =>
    ipcRenderer.invoke('os:workflowProfiles:upsert', profile),
  workflowProfileRemove: (id: string): Promise<WorkflowProfilesFile> =>
    ipcRenderer.invoke('os:workflowProfiles:remove', id),
  workflowProfileSelect: (id: string | null): Promise<WorkflowProfilesFile> =>
    ipcRenderer.invoke('os:workflowProfiles:select', id),
  // `id` nul = tout le fichier ; un id = ce seul workflow, pour en partager un sans donner le reste.
  workflowProfilesExport: (id: string | null): Promise<unknown> =>
    ipcRenderer.invoke('os:workflowProfiles:export', id),
  workflowProfilesImport: (): Promise<unknown> =>
    ipcRenderer.invoke('os:workflowProfiles:import'),
  checkWorkflowGraph: (graph: unknown): Promise<unknown> =>
    ipcRenderer.invoke('os:workflowGraph:check', graph),
  conversationWorkflow: (conversationId: string): Promise<string | null> =>
    ipcRenderer.invoke('os:workflowSelection:get', conversationId),
  selectConversationWorkflow: (
    conversationId: string,
    profileId: string | null
  ): Promise<string | null> =>
    ipcRenderer.invoke('os:workflowSelection:set', conversationId, profileId),
  workflowBenchRun: (
    objective: string,
    profileIds: (string | null)[]
  ): Promise<WorkflowBenchReport> =>
    ipcRenderer.invoke('os:workflowBench:run', { objective, profileIds }),
  // La confrontation dure plusieurs runs : sans ce flux, l'attente serait aveugle.
  onWorkflowBenchProgress: (
    listener: (p: { done: number; total: number; label: string }) => void
  ): (() => void) => {
    const handler = (_e: unknown, p: { done: number; total: number; label: string }): void =>
      listener(p)
    ipcRenderer.on('os:workflowBench:progress', handler)
    return () => ipcRenderer.removeListener('os:workflowBench:progress', handler)
  },
  roles: (): Promise<Record<Role, RoleBinding>> => ipcRenderer.invoke('os:roles'),
  setRole: (
    role: string,
    provider: string,
    model?: string,
    reasoningEffort?: string
  ): Promise<Record<Role, RoleBinding>> =>
    ipcRenderer.invoke('os:setRole', role, provider, model, reasoningEffort),
  models: (force = false): Promise<ImportedModel[]> => ipcRenderer.invoke('os:models:list', force),
  fabricNodes: (): Promise<FabricNodeSummary[]> => ipcRenderer.invoke('os:fabric:list'),
  installIsolatedFabricFixture: (): Promise<{
    summary: FabricNodeSummary
    model: ImportedModel
  }> => ipcRenderer.invoke('app:test:fabric-fixture:install'),
  // Résultat d'exécution provider — hétérogène par construction (`ProviderAdapter['send']` délègue
  // au provider réel, dont la forme du résultat varie ; aucun oracle local ne le contraint).
  sendIsolatedFabricFixture: (execution = false): Promise<unknown> =>
    ipcRenderer.invoke('app:test:fabric-fixture:send', execution),
  refreshFabricNode: (nodeId: string): Promise<FabricNodeSummary> =>
    ipcRenderer.invoke('os:fabric:refresh', nodeId),
  pairFabricNode: (request: unknown): Promise<FabricNodeSummary> =>
    ipcRenderer.invoke('os:fabric:pair', request),
  checkpointForks: (): Promise<Array<PersistedCheckpoint<OrchestrationRunState>>> =>
    ipcRenderer.invoke('os:checkpointForks:list'),
  createCheckpointFork: (
    checkpointId: string,
    forkId: string
  ): Promise<CheckpointForkManifest<OrchestrationRunState>> =>
    ipcRenderer.invoke('os:checkpointFork:create', checkpointId, forkId),
  shadowRouteRecommendation: (
    phase: string,
    champion: { provider: string; model: string }
  ): Promise<ShadowRouteRecommendation> =>
    ipcRenderer.invoke('os:shadowRoute:recommend', phase, champion),
  modelQuotas: (force = false): Promise<ModelQuotaSnapshot> =>
    ipcRenderer.invoke('os:models:quotas', force),
  profiles: (): Promise<AutowinProfile[]> => ipcRenderer.invoke('os:profiles:list'),
  saveProfile: (profile: unknown): Promise<AutowinProfile[]> =>
    ipcRenderer.invoke('os:profiles:save', profile),
  applyProfile: (id: string): Promise<{ topology: AgentTopology }> =>
    ipcRenderer.invoke('os:profiles:apply', id),
  kimiLogin: (): Promise<{ ok: true }> => ipcRenderer.invoke('os:kimiLogin'),
  providerLogin: (provider: string): Promise<{ ok: true }> =>
    ipcRenderer.invoke('os:providerLogin', provider),
  /** Comptes Claude multiples — un CLAUDE_CONFIG_DIR par compte, bascule sans re-login. */
  claudeAccounts: (): Promise<ClaudeAccountsPayload> =>
    ipcRenderer.invoke('os:claudeAccounts:list'),
  claudeAccountAdd: (label?: string): Promise<ClaudeAccountsPayload> =>
    ipcRenderer.invoke('os:claudeAccounts:add', label),
  claudeAccountSwitch: (id: string): Promise<ClaudeAccountsPayload> =>
    ipcRenderer.invoke('os:claudeAccounts:switch', id),
  claudeAccountRemove: (id: string): Promise<ClaudeAccountsPayload> =>
    ipcRenderer.invoke('os:claudeAccounts:remove', id),
  claudeAccountLogin: (id: string): Promise<{ ok: true }> =>
    ipcRenderer.invoke('os:claudeAccounts:login', id),
  claudeAccountRefresh: (): Promise<ClaudeAccountsPayload> =>
    ipcRenderer.invoke('os:claudeAccounts:refresh'),
  topology: (): Promise<AgentTopology> => ipcRenderer.invoke('os:topology:get'),
  setTopology: (topology: AgentTopology): Promise<AgentTopology> =>
    ipcRenderer.invoke('os:topology:set', topology),
  capabilityControls: (kind: 'skills' | 'hooks' | 'tools' | 'plugins'): Promise<CapabilityItem[]> =>
    ipcRenderer.invoke('os:capabilities:list', kind),
  skills: (): Promise<SkillRegistryItem[]> => ipcRenderer.invoke('skills:registry:list'),
  promptCalls: (conversationId?: string): Promise<PromptCallRecord[]> =>
    ipcRenderer.invoke('os:promptCalls', conversationId),
  /** Repartition du cout par role/modele/provider, triee par cout decroissant. */
  costBreakdown: (
    dimension?: 'actor' | 'model' | 'provider',
    conversationId?: string
  ): Promise<CostBreakdownRow[]> =>
    ipcRenderer.invoke('os:costBreakdown', dimension, conversationId),
  promptTraces: (conversationId: string): Promise<NativePreflightTrace[]> =>
    ipcRenderer.invoke('os:promptTraces', conversationId),
  brainTraces: (conversationId?: string): Promise<BrainTrace[]> =>
    ipcRenderer.invoke('os:brainTraces', conversationId),
  behaviourComposition: (
    workspace?: string
  ): Promise<
    BehaviourComposition & {
      inspection: { workspace: string; files: Array<BehaviourFile & { excerpt?: string }> }
    }
  > => ipcRenderer.invoke('os:behaviourComposition', workspace),
  installIsolatedBehaviourFixture: (): Promise<string> =>
    ipcRenderer.invoke('app:test:behaviour-fixture:install'),
  providerStatus: (): Promise<ProviderStatus[]> => ipcRenderer.invoke('os:providerStatus'),
  providerTest: (provider: string): Promise<{ provider: string; status: ProviderDisplayStatus }> =>
    ipcRenderer.invoke('os:providerTest', provider),
  setProviderMode: (
    provider: string,
    mode: 'active' | 'standby'
  ): Promise<{ mode: 'active' | 'standby' }> =>
    ipcRenderer.invoke('os:providerMode:set', provider, mode),
  promptTraceSummary: (): Promise<NativePreflightTrace[]> =>
    ipcRenderer.invoke('os:promptTraceSummary'),
  authorizeDiagnostics: (): Promise<string | null> => ipcRenderer.invoke('os:authorizeDiagnostics'),
  promptTracesGlobal: (capability: string): Promise<NativePreflightTrace[]> =>
    ipcRenderer.invoke('os:promptTracesGlobal', capability),
  causalTrace: (conversationId: string): Promise<TraceEventV1[]> =>
    ipcRenderer.invoke('os:causalTrace', conversationId),
  activitySessions: (): Promise<SessionMeta[]> => ipcRenderer.invoke('os:activity:sessions'),
  activitySession: (meta: { id: string; project: string }): Promise<SessionActivity> =>
    ipcRenderer.invoke('os:activity:session', meta),
  activityImage: (
    session: { id: string; project: string },
    path: string
  ): Promise<{ dataUrl: string }> => ipcRenderer.invoke('os:activity:image', session, path),
  claudeHooks: (): Promise<ClaudeHookItem[]> => ipcRenderer.invoke('claude:hooks:list'),
  codexHooks: (): Promise<ClaudeHookItem[]> => ipcRenderer.invoke('codex:hooks:list'),
  setCapabilityTool: (
    name: string,
    enabled: boolean
  ): Promise<{ items: CapabilityItem[]; restartRequired: true }> =>
    ipcRenderer.invoke('os:capabilities:tools:set', name, enabled),
  chooseBehaviourWorkspace: (): Promise<string | null> =>
    ipcRenderer.invoke('os:behaviour:choose-workspace'),
  onModelQuestion: (cb: (question: PendingModelQuestion) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, question: PendingModelQuestion): void =>
      cb(question)
    ipcRenderer.on('model:question', handler)
    return () => ipcRenderer.removeListener('model:question', handler)
  },
  answerModelQuestion: (id: string, answer: string): Promise<{ ok: true }> =>
    ipcRenderer.invoke('model:question:answer', id, answer),
  toolUsage: (): Promise<
    Array<{ id: string; label: string; description: string; enabled: boolean; mutable: boolean }>
  > => ipcRenderer.invoke('os:toolUsage'),
  // Sas d'autorité
  authorityPending: (): Promise<Array<{ id: string; question: string }>> =>
    ipcRenderer.invoke('os:authority:pending'),
  // `bus.resolveDecision()` (src/main/commands.ts) est lui-même typé `Promise<unknown>` : la décision
  // résolue est de forme libre selon le type de question d'autorité posée.
  authorityResolve: (id: string, choice: unknown): Promise<unknown> =>
    ipcRenderer.invoke('os:authority:resolve', id, choice),
  // Conversations
  conversations: (): Promise<ConversationSummary[]> => ipcRenderer.invoke('os:conversations'),
  conversation: (id: string): Promise<Conversation | null> =>
    ipcRenderer.invoke('os:conversation', id),
  conversationsCreate: (p: {
    title: string
    category: string
    provider: string
    authorityMode?: 'plan' | 'ask' | 'auto'
  }): Promise<{ id: string; title: string; category: string; provider: string }> =>
    ipcRenderer.invoke('os:conversations:create', p),
  routeConversationMessage: (
    conversationId: string,
    message: string,
    attachmentNames: string[]
  ): Promise<{
    sourceConversationId: string
    conversationId: string
    routed: boolean
    title?: string
    decision: { route: 'current' | 'new'; confidence: number; reason: string }
  }> =>
    ipcRenderer.invoke('os:conversations:routeMessage', conversationId, message, attachmentNames),
  conversationsRename: (id: string, title: string): Promise<void> =>
    ipcRenderer.invoke('os:conversations:rename', id, title),
  conversationsSetAuthorityMode: (
    id: string,
    mode: 'plan' | 'ask' | 'auto'
  ): Promise<Conversation> => ipcRenderer.invoke('os:conversations:authorityMode', id, mode),
  /**
   * Range une conversation dans un dossier de travail — ce qui la groupe dans la liste.
   * `path` OMIS → le main ouvre le sélecteur natif (le renderer n'a pas le disque) ;
   * `null` → la conversation retourne dans « Divers ». Rend le chemin retenu, ou `null`.
   */
  conversationsSetProject: (id: string, path?: string | null): Promise<string | null> =>
    ipcRenderer.invoke('os:conversations:setProject', id, path),
  conversationsFork: (id: string, messageId: string): Promise<Conversation> =>
    ipcRenderer.invoke('os:conversations:fork', id, messageId),
  conversationsRemove: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('os:conversations:remove', id),
  readChatArtifact: (
    conversationId: string,
    turnId: string,
    artifactId: string
  ): Promise<{
    ok: boolean
    artifact?: ChatArtifact
    encoding?: ArtifactEncoding
    content?: string
    error?: string
  }> => ipcRenderer.invoke('os:chatArtifact:read', conversationId, turnId, artifactId),
  revealChatArtifact: (
    conversationId: string,
    turnId: string,
    artifactId: string
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('os:chatArtifact:reveal', conversationId, turnId, artifactId),
  taskManagerSnapshot: (): Promise<TaskManagerSnapshot> =>
    ipcRenderer.invoke('task-manager:snapshot'),
  taskManagerCreate: (task: unknown): Promise<ScheduledTask> =>
    ipcRenderer.invoke('task-manager:create', task),
  taskManagerUpdate: (id: string, task: unknown): Promise<ScheduledTask> =>
    ipcRenderer.invoke('task-manager:update', id, task),
  taskManagerRemove: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('task-manager:remove', id),
  taskManagerAcknowledge: (alertId: string): Promise<boolean> =>
    ipcRenderer.invoke('task-manager:acknowledge', alertId),
  taskManagerRunNow: (id: string): Promise<{ started: boolean }> =>
    ipcRenderer.invoke('task-manager:run-now', id),
  openFolder: (path: string): Promise<void> => ipcRenderer.invoke('os:openFolder', path),
  // Plan de contrôle (app pilotable par les agents) + pilotage in-model
  appState: (): Promise<AppSnapshot> => ipcRenderer.invoke('os:appState'),
  appCatalog: (): Promise<CommandSpec[]> => ipcRenderer.invoke('os:appCatalog'),
  appCommand: (name: string, args?: Record<string, unknown>): Promise<CommandResult> =>
    ipcRenderer.invoke('os:appCommand', name, args),
  pilotChat: (
    messages: Array<{
      role: 'user' | 'assistant'
      content: string
      attachments?: ChatAttachment[]
    }>,
    conversationId?: string
  ): Promise<{
    ok: boolean
    cancelled: boolean
    turnId: string
    text?: string
    error?: string
    verification?: { complete: boolean; evidence: string }
  }> => ipcRenderer.invoke('os:pilotChat', messages, conversationId),
  cancelPilotChat: (conversationId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('os:pilotChat:cancel', conversationId),
  cancelOrchestration: (conversationId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('os:orchestrate:cancel', conversationId),
  injectDirective: (conversationId: string, directive: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('os:pilotChat:inject', conversationId, directive),
  markResponseDisplayed: (
    conversationId: string,
    content: string
  ): Promise<{ ok: boolean; eventId: string }> =>
    ipcRenderer.invoke('os:causalTrace:displayed', conversationId, content),
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
  ): (() => void) => {
    const h = (_e: unknown, ev: Parameters<typeof cb>[0]): void => cb(ev)
    ipcRenderer.on('pilot:event', h)
    return () => ipcRenderer.removeListener('pilot:event', h)
  },
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
  ): (() => void) => {
    const h = (_e: unknown, ev: Parameters<typeof cb>[0]): void => cb(ev)
    ipcRenderer.on('app:event', h)
    return () => ipcRenderer.removeListener('app:event', h)
  },
  emitIsolatedTestAppEvent: (event: Record<string, unknown> & { type: string }): Promise<boolean> =>
    ipcRenderer.invoke('app:test:emit-event', event),
  isolatedTestConversationReadCount: (reset = false): Promise<number> =>
    ipcRenderer.invoke('app:test:conversation-read-count', reset),
  // Workflows de la conversation active (créés in-app + attachés)
  conversationRuns: (convId: string): Promise<RunEntry[]> =>
    ipcRenderer.invoke('os:conversationRuns', convId),
  deleteConversationRun: (
    convId: string,
    path: string
  ): Promise<{ ok: boolean; kind: 'deleted' | 'detached' }> =>
    ipcRenderer.invoke('os:conversationRuns:delete', convId, path),
  conversationActivity: (convId: string): Promise<ConvActivityEntry[]> =>
    ipcRenderer.invoke('os:conversationActivity', convId),
  runTrace: (path: string): Promise<OrchestrationStep[] | null> =>
    ipcRenderer.invoke('os:runTrace', path),
  setActiveConversation: (convId: string | null): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('os:setActiveConversation', convId),
  // Graphe brain 3D + workflow
  listBrains: (): Promise<
    Array<{
      id: string
      label: string
      path: string
      sizeMb: number
      kind: 'vault' | 'graphify'
      themes?: Array<{ id: string; label: string }>
    }>
  > => ipcRenderer.invoke('os:listBrains'),
  loadBrainGraph: (path: string, lod?: number, community?: number): Promise<VizGraph> =>
    ipcRenderer.invoke('os:loadBrainGraph', path, lod, community),
  loadBrainGraphPreview: (path: string, lod?: number): Promise<VizGraph> =>
    ipcRenderer.invoke('os:loadBrainGraphPreview', path, lod),
  loadBrainThemes: (path: string): Promise<Array<{ id: string; label: string }>> =>
    ipcRenderer.invoke('os:loadBrainThemes', path),
  loadBrainThemeNodes: (path: string, themeIds: string[]): Promise<VizGraph['nodes']> =>
    ipcRenderer.invoke('os:loadBrainThemeNodes', path, themeIds),
  loadBrainNeighborhood: (path: string, nodeId: string): Promise<VizGraph> =>
    ipcRenderer.invoke('os:loadBrainNeighborhood', path, nodeId),
  readNodeFile: (path: string): Promise<{ path: string; content: string }> =>
    ipcRenderer.invoke('os:readNodeFile', path),
  searchBrain: (
    path: string,
    query: string
  ): Promise<
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
  > => ipcRenderer.invoke('os:searchBrain', path, query),
  refreshBrain: (path: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('os:refreshBrain', path),
  listRuns: (): Promise<
    Array<{
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
    }>
  > => ipcRenderer.invoke('os:listRuns'),
  deleteRun: (path: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('os:runs:delete', path),

  // Zoom app-wide (accessibilité) — agit sur tout le rendu comme un navigateur.
  getZoomFactor: (): number => webFrame.getZoomFactor(),
  setZoomFactor: (factor: number): void => webFrame.setZoomFactor(factor)
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // FAIL-CLOSED sur la frontiere de securite. Ce reste du gabarit @electron-toolkit exposait `api` et
  // `electron` en assignant DIRECTEMENT sur `window`, donc SANS `contextBridge` : n'importe quel script
  // de la page aurait eu la surface IPC complete, y compris les commandes qui ecrivent sur le disque.
  //
  // La branche est aujourd'hui INATTEIGNABLE — les trois sites de creation de fenetre posent
  // `contextIsolation: true` (`main/index.ts` x2, `renderer-storage-migration.ts`). Mais du code mort
  // sur une frontiere de securite est un piege qui attend : le jour ou une fenetre oublie le reglage,
  // l'ancienne version aurait degrade EN SILENCE vers le mode non isole. On echoue bruyamment a la
  // place, pour que l'oubli se voie au lancement au lieu de s'exposer.
  throw new Error(
    "preload: contextIsolation est desactive. Refus d'exposer l'API sans contextBridge — " +
      'poser `contextIsolation: true` dans les webPreferences de la fenetre.'
  )
}
