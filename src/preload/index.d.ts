import type { StockVeille } from '../main/veille/candidats-store'
import type {
  WorktreeAgentActivity,
  WorktreeConflictDiffResult,
  WorktreeConflictResolutionChoice,
  WorktreeConflictResolutionResult,
  WorktreeRuntimeStatus
} from '../shared/worktree-activity-model'
import type { ModelQuotaSnapshot } from '../shared/model-quotas'
import type { UpdateStrategy } from '../shared/update-contract'
import type { ChatArtifact, ArtifactEncoding } from '../shared/artifacts'
import type {
  ChatAttachment,
  AgentTopology,
  NativePreflightTrace
} from '../shared/preload-contracts'
import type { Conversation, ConversationSummary } from '../main/store/conversations'
import type { EtatWhisper } from '../main/whisper-local'
import type { EtatPiper } from '../main/piper-local'
import type { OrchestrationStep, OrchestrationResult } from '../main/orchestrator'
import type { VizGraph } from '../main/viz/graph'
import type { BrainGraphRef, BrainTheme } from '../main/viz/fs-brains'
import type { BrainSearchEnvelope } from '../main/brain-search-envelope'
import type { InboxCandidate, InboxMove } from '../main/brain-inbox'
import type { RunEntry } from '../main/dashboards/runs-scan'
import type { CapabilityItem } from '../main/capability-controls'
import type { SkillRegistryItem } from '../main/skill-registry'
import type { BehaviourFile } from '../main/behaviour-files'
import type { PendingModelQuestion } from '../main/model-questions'
import type { ImportedModel } from '../main/models'
import type { PromptCallRecord, CostBreakdownRow } from '../main/activity/prompt-observability'
import type { ProviderDisplayStatus, ProviderStatus } from '../main/provider-status'
import type { SemanticTemporalProjectionV1 } from '../main/knowledge/semantic-temporal-projection'
import type { BehaviourComposition } from '../main/behaviour-composition'
import type { BrainTrace } from '../main/activity/brain-trace-spool'
import type { ConversationFileTrace } from '../main/activity/conversation-file-trace-spool'
import type { PreflightResult } from '../main/preflight'
import type { PreflightRepairOutcome } from '../main/preflight-repair'
import type { TaskManagerSnapshot, ScheduledTask } from '../main/task-manager/types'
import type { AutoCloseReport } from '../main/run-autoclose'
import type { FabricNodeSummary } from '../main/compute-fabric/control-plane'
import type { Role, RoleBinding } from '../main/roles'
import type { WorkflowProfilesFile } from '../main/workflow-profiles'
import type { AutowinProfile } from '../main/profile-store'
import type { ShadowRouteResult } from '../main/shadow-router'
import type { ShadowRoutingPilotState } from '../main/model-routing-shadow-setting'
import type { PersistedCheckpoint, CheckpointForkManifest } from '../main/wire-checkpoint-fork'
import type { OrchestrationRunState } from '../main/runs/orchestration-state'
import type { CommandResult, AppSnapshot } from '../main/commands'
import type { TraceEventV1 } from '../main/activity/trace-event'
import type { SessionMeta, SessionActivity } from '../main/activity/transcripts'
import type { ClaudeHookItem } from '../main/claude-hooks'
import type { ConvActivityEntry } from '../main/activity/conv-activity'
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
  resumePilotChat: (conversationId: string) => Promise<{
    ok: boolean
    cancelled: boolean
    turnId: string
    text?: string
    error?: string
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
  /** Le moteur qui tourne contient-il encore les sources ? Voir `shared/moteur-perime`. */
  etatDuMoteur: () => Promise<{ perime: boolean; fichier?: string; retardMs?: number }>
  orchestrationBudget: () => Promise<{
    maxUsd: number | null
    maxProviderCalls: number
    maxChatProviderCalls: number
    maxTotalTokens: number
  }>
  setOrchestrationBudget: (settings: {
    maxUsd: number | null
    maxProviderCalls: number
    maxChatProviderCalls: number
    maxTotalTokens: number
  }) => Promise<{
    maxUsd: number | null
    maxProviderCalls: number
    maxChatProviderCalls: number
    maxTotalTokens: number
  }>
  /** Opt-in persistant du pilote de routage shadow (mesure verte/coût par route). */
  shadowRoutingPilot: () => Promise<ShadowRoutingPilotState>
  setShadowRoutingPilot: (enabled: boolean) => Promise<ShadowRoutingPilotState>
  getGitState: (repoPath?: string) => Promise<import('../shared/git-read').GitReadResult>
  conversationGitState: (
    conversationId: string
  ) => Promise<import('../shared/git-read').GitReadResult>
  conversationGitDiff: (
    conversationId: string,
    path: string,
    workspaceRoot: string
  ) => Promise<import('../shared/git-read').GitDiffResult>
  /** Historique git de la vue Worktrees — la frise de commits. Lecture seule. */
  getGitGraph: (repoPath?: string) => Promise<import('../shared/git-graph').GitGraphSnapshot>
  getGitDiff: (
    path: string,
    repoPath?: string
  ) => Promise<import('../shared/git-read').GitDiffResult>
  pickGitRepo: () => Promise<string | null>
  testProjects: () => Promise<
    Array<
      import('../shared/test-projects').TestProject & {
        runner: import('../shared/test-projects').TestRunner
        runnable: boolean
        reason?: string
      }
    >
  >
  saveTestProjects: (
    projects: Array<{ root: string; label?: string }>
  ) => ReturnType<Api['testProjects']>
  pickTestProject: () => Promise<string | null>
  runProjectTests: (
    root: string,
    filter?: string
  ) => Promise<{
    root: string
    runner: import('../shared/test-projects').TestRunner
    exitCode: number | null
    durationMs: number
    totals: import('../shared/test-projects').TestTotals
    report: import('../shared/test-projects').TestReport
  }>
  perfTurnLatency: (
    derniers?: number
  ) => Promise<
    import('../shared/perf-lag').RapportLatence & { disponible: boolean; source: string }
  >
  perfGels: (
    derniers?: number
  ) => Promise<
    import('../shared/gel-detector').ResumeGels & { disponible: boolean; source: string }
  >
  getAutoClose: () => Promise<{ enabled: boolean; last?: AutoCloseReport }>
  setAutoClose: (enabled: boolean) => Promise<{ enabled: boolean; last?: AutoCloseReport }>
  unfinishedTurns: () => Promise<
    Array<{ conversationId: string; turnId: string; events: number; updatedAt: number }>
  >
  turnJournal: (conversationId: string, turnId: string) => Promise<Array<Record<string, unknown>>>
  /** Consigne à rejouer après un redémarrage demandé par l'agent, rendue une seule fois. */
  repriseEnAttente: () => Promise<{
    conversationId: string
    consigne: string
    raison?: string
    poseeA: number
  } | null>
  checkUpdate: () => Promise<{
    available: boolean
    behind: number
    branch?: string
    reference?: string
    /** Travail en cours : la mise a jour est tentee telle quelle et refusee si elle entre en conflit (aucun stash). */
    dirty?: boolean
    strategies?: UpdateStrategy[]
    error?: string
  }>
  applyUpdate: (strategy?: UpdateStrategy) => Promise<{
    ok: boolean
    relaunch?: boolean
    reload?: boolean
    effect?: 'none' | 'reload' | 'relaunch'
    npmInstalled?: boolean
    error?: string
    strategy?: UpdateStrategy
    /** Rien n'a ete touche faute d'intention explicite : une QUESTION, pas un echec. */
    needsChoice?: boolean
    strategies?: UpdateStrategy[]
  }>
  ticketSources: () => Promise<import('../shared/tickets').TicketSourceSummary[]>
  saveTicketSource: (
    profile: import('../shared/tickets').TicketSourceProfile
  ) => Promise<import('../shared/tickets').TicketSourceSummary[]>
  listTickets: (
    request: import('../shared/tickets').TicketListRequest
  ) => Promise<import('../shared/tickets').TicketPage>
  getTicket: (
    request: import('../main/tickets-ipc').TicketGetIpcRequest
  ) => Promise<import('../shared/tickets').TicketItem>
  updateTicket: (
    request: import('../main/tickets-ipc').TicketUpdateIpcRequest
  ) => Promise<import('../shared/tickets').TicketItem>
  cancelTickets: (requestId: string) => Promise<boolean>
  listTicketPeople: (source: unknown) => Promise<string[]>
  getWorktreeActivity: (conversationId?: string) => Promise<WorktreeAgentActivity[]>
  /** Travaux terminés mais jamais publiés — lecture seule, sur geste explicite. */
  getTravauxNonPublies?: () => Promise<Array<{ agentId: string; date: string; fichiers: string[] }>>
  getPatchTravailNonPublie?: (agentId: string) => Promise<{ patch: string; tronque: boolean }>
  getWorktreeStatus: () => Promise<WorktreeRuntimeStatus>
  getWorktreeConflictDiff: (agentId: string) => Promise<WorktreeConflictDiffResult>
  resolveWorktreeConflict: (
    agentId: string,
    choice: WorktreeConflictResolutionChoice
  ) => Promise<WorktreeConflictResolutionResult>
  retryWorktreeRecovery: (agentId: string) => Promise<WorktreeAgentActivity | undefined>
  discardHeldWorktree: (agentId: string) => Promise<boolean>
  setWorktreeFixture: (fixture: {
    activity: WorktreeAgentActivity[]
    status: WorktreeRuntimeStatus
  }) => Promise<boolean>
  onWorktreeActivity: (cb: (activity: WorktreeAgentActivity[]) => void) => () => void
  /** Workflows nommés : lire, créer/modifier, supprimer, sélectionner. */
  workflowProfiles: () => Promise<WorkflowProfilesFile>
  workflowProfileNotice: () => Promise<{ id: number; text: string } | null>
  workflowProfileAcknowledgeNotice: (id: number) => Promise<boolean>
  workflowProfileSave: (profile: unknown) => Promise<WorkflowProfilesFile>
  workflowProfileRemove: (id: string) => Promise<WorkflowProfilesFile>
  workflowProfileSelect: (id: string | null) => Promise<WorkflowProfilesFile>
  /** `id` nul = tout le fichier ; un id = ce seul workflow, pour en partager un sans donner le reste. */
  workflowProfilesExport: (
    id: string | null
  ) => Promise<{ ok: boolean; reason?: string; path?: string; count?: number }>
  workflowProfilesImport: () => Promise<{
    ok: boolean
    reason?: string
    imported?: number
    rejected?: string[]
    file?: WorkflowProfilesFile
  }>
  /** Ce que le moteur ne peut pas jouer d'un graphe composé, plus son pire cas. */
  checkWorkflowGraph: (graph: unknown) => Promise<{
    defects: { target?: string; message: string }[]
    worstCaseNodeExecutions: number | null
  }>
  roles: () => Promise<Record<Role, RoleBinding>>
  semanticTimeline: (conversationId: string) => Promise<SemanticTemporalProjectionV1>
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
  checkpointForks: () => Promise<Array<PersistedCheckpoint<OrchestrationRunState>>>
  createCheckpointFork: (
    checkpointId: string,
    forkId: string
  ) => Promise<CheckpointForkManifest<OrchestrationRunState>>
  shadowRouteRecommendation: (
    phase: string,
    champion: { provider: string; model: string }
  ) => Promise<ShadowRouteResult>
  modelQuotas: (force?: boolean) => Promise<ModelQuotaSnapshot>
  profiles: () => Promise<AutowinProfile[]>
  saveProfile: (profile: unknown) => Promise<AutowinProfile[]>
  applyProfile: (id: string) => Promise<{ topology: AgentTopology }>
  providerLogin: (provider: string) => Promise<{ ok: true }>
  /** Comptes Claude multiples : un CLAUDE_CONFIG_DIR par compte, bascule sans re-login. */
  claudeAccounts: () => Promise<ClaudeAccountsPayload>
  claudeAccountAdd: (label?: string) => Promise<ClaudeAccountsPayload>
  claudeAccountSwitch: (id: string) => Promise<ClaudeAccountsPayload>
  claudeAccountRemove: (id: string) => Promise<ClaudeAccountsPayload>
  topology: () => Promise<AgentTopology>
  setTopology: (topology: AgentTopology) => Promise<AgentTopology>
  capabilityControls: (kind: 'skills' | 'hooks' | 'tools' | 'plugins') => Promise<CapabilityItem[]>
  skills: () => Promise<SkillRegistryItem[]>
  promptCalls: (conversationId: string) => Promise<PromptCallRecord[]>
  // fix-ok: golden test src/main/activity/cost-breakdown.test.ts asserts this file's source text
  // contains the literal 'cacheHitRatio' (see CostBreakdownRow) — keep the substring even after typing.
  costBreakdown: (
    dimension?: 'actor' | 'model' | 'provider',
    conversationId?: string
  ) => Promise<CostBreakdownRow[]>
  brainTraces: (conversationId: string) => Promise<BrainTrace[]>
  /** Chemins lus et ecrits pendant la conversation, avec le tour et l'auteur du geste. */
  conversationFileTraces: (conversationId: string) => Promise<ConversationFileTrace[]>
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
  ouvrirReglagesMicro: () => Promise<{ ouvert: boolean; raison?: string }>
  whisperEtat: () => Promise<EtatWhisper>
  whisperInstaller: () => Promise<EtatWhisper>
  whisperTranscrire: (wav: Uint8Array) => Promise<string>
  piperEtat: () => Promise<EtatPiper>
  piperInstaller: () => Promise<EtatPiper>
  piperParler: (texte: string) => Promise<Uint8Array>
  transcriptDemarrer: () => Promise<{ id: string; nom: string; chemin: string }>
  transcriptAjouter: (id: string, texte: string) => Promise<{ octets: number }>
  transcriptTerminer: (id: string) => Promise<{ chemin: string } | null>
  transcriptLister: (
    max?: number
  ) => Promise<Array<{ nom: string; chemin: string; octets: number; le: number }>>
  transcriptRevealer: (chemin: string) => Promise<{ ok: true }>
  conversations: () => Promise<ConversationSummary[]>
  /** Ids des conversations dont le CONTENU porte le terme (+ extrait a montrer). */
  conversationsSearchContent: (
    terme: string
  ) => Promise<Array<{ id: string; extrait: string; occurrences: number }>>
  conversation: (id: string) => Promise<Conversation | null>
  conversationsCreate: (p: { title: string; category: string; provider: string }) => Promise<{
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
  /** Renomme et rend le titre RELU (`undefined` = id inconnu, rien renomme). */
  conversationsRename: (
    id: string,
    title: string
  ) => Promise<{ id: string; title: string } | undefined>
  /** Range une conversation dans un dossier. Chemin omis → sélecteur natif ; `null` → « Divers ». */
  conversationsSetProject: (id: string, path?: string | null) => Promise<string | null>
  conversationsFork: (id: string, messageId: string) => Promise<Conversation>
  conversationsRemove: (id: string) => Promise<boolean>
  /** Purge en lot. Rend les ids RÉELLEMENT supprimés (inconnus ignorés). */
  conversationsRemoveMany: (ids: readonly string[]) => Promise<string[]>
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
  /** Stock de veille concurrents : candidats sources + sources muettes de la derniere passe. */
  veilleSnapshot: () => Promise<StockVeille>
  veilleMarquer: (id: string, statut: 'nouveau' | 'ecarte' | 'prompte') => Promise<StockVeille>
  /** Lance la passe INTERNE (scout local) et rend le résultat ; le stock est réécrit côté main. */
  veilleGenerer: (conversationId?: string) => Promise<{ retenus: number; stock: StockVeille }>
  taskManagerSnapshot: () => Promise<TaskManagerSnapshot>
  outlookSnapshot: (force?: boolean) => Promise<unknown>
  outlookOuvrir: (id: string) => Promise<{ ok: boolean; erreur?: string }>
  /** Envoie une réponse à un message Outlook. Irréversible : à confirmer avant l'appel. */
  outlookRepondre: (id: string, corps: string) => Promise<{ ok: boolean; erreur?: string }>
  /** Marque des messages Outlook comme lus. Ecrit dans la boite : reserve a un geste utilisateur. */
  outlookMarquerLu: (ids: readonly string[]) => Promise<{ ok: boolean; erreur?: string }>
  taskManagerCreate: (task: unknown) => Promise<ScheduledTask>
  taskManagerUpdate: (id: string, task: unknown) => Promise<ScheduledTask>
  taskManagerRemove: (id: string) => Promise<boolean>
  taskManagerAcknowledge: (alertId: string) => Promise<boolean>
  taskManagerRunNow: (id: string) => Promise<{ started: boolean }>
  openFolder: (path: string) => Promise<void>
  /** Ouvre un fichier cite par un agent (`[a.ts:80](src/main/a.ts:80)`). Chemin resolu cote main. */
  revealFile: (path: string, line?: number) => Promise<{ ok: boolean; reason?: string }>
  appState: () => Promise<AppSnapshot>
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
  /** Un tour pilote est-il REELLEMENT en vol cote main pour cette conversation ? */
  pilotChatActive: (conversationId: string) => Promise<{ active: boolean }>
  cancelOrchestration: (conversationId: string) => Promise<{ ok: boolean }>
  injectDirective: (
    conversationId: string,
    directive: string
  ) => Promise<{ ok: boolean; messageId?: string }>
  /** Écrit le texte de l'utilisateur sur disque AVANT son envoi — filet contre les textes sans tour. */
  journaliserSaisie: (
    conversationId: string,
    texte: string,
    voie: 'message' | 'orientation'
  ) => Promise<{ ok: boolean }>

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
      noticeId?: number
      convId?: string
      runPath?: string
      task?: string
      status?: string
      step?: OrchestrationStep
      phase?: { step: string; provider?: string; role?: string }
      deltaStep?: 'exec' | 'judge'
      delta?: string
      /**
       * Activite courante de la phase, hors livrable : « Bash en cours — 2 min 30 s ».
       * Voyage sur `orchestrate-delta` mais dans son propre champ — le texte est la reponse et
       * finit persiste, la note dit seulement que le sous-agent travaille encore.
       */
      note?: string
      /** Affirmations non verifiees sur lesquelles le cadrage repose (evenement `orchestrate-hypotheses`). */
      hypotheses?: { affirmation: string; source: 'confiance' | 'besoin' }[]
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
  listBrains: () => Promise<BrainGraphRef[]>
  loadBrainGraph: (path: string, lod?: number, community?: number) => Promise<VizGraph>
  loadBrainGraphPreview: (path: string, lod?: number) => Promise<VizGraph>
  loadBrainThemes: (path: string) => Promise<BrainTheme[]>
  loadBrainThemeNodes: (path: string, themeIds: string[]) => Promise<VizGraph['nodes']>
  loadBrainNeighborhood: (path: string, nodeId: string) => Promise<VizGraph>
  readNodeFile: (path: string, vaultRoot?: string) => Promise<{ path: string; content: string }>
  searchBrain: (path: string, query: string) => Promise<BrainSearchEnvelope>
  refreshBrain: (path: string) => Promise<{ ok: boolean }>
  listInbox: (path: string) => Promise<InboxCandidate[]>
  readInboxCandidateBody: (path: string, id: string) => Promise<{ id: string; body: string }>
  promoteInbox: (path: string, id: string) => Promise<InboxMove>
  rejectInbox: (path: string, id: string) => Promise<InboxMove>
  retractKnowledge: (path: string, id: string) => Promise<InboxMove>
  supersedeKnowledge: (
    path: string,
    obsoleteId: string,
    replacementId: string
  ) => Promise<InboxMove>
  outcomeLearning: () => Promise<{
    mode: 'off' | 'shadow' | 'inbox' | 'auto'
    events: Array<{ kind: string; value: Record<string, unknown> }>
  }>
  outcomeLearningCurations: (
    offset?: number,
    limit?: number
  ) => Promise<{
    events: Array<{ kind: 'curation'; value: Record<string, unknown> }>
    total: number
  }>
  setOutcomeLearningMode: (
    mode: 'off' | 'shadow' | 'inbox' | 'auto'
  ) => Promise<{ mode: 'off' | 'shadow' | 'inbox' | 'auto' }>
  undoOutcomeLearningCuration: (eventId: string) => Promise<InboxMove>
  listRuns: () => Promise<RunEntry[]>
  deleteRun: (path: string) => Promise<{ ok: boolean }>

  getZoomFactor: () => number
  setZoomFactor: (factor: number) => void
}

declare global {
  interface Window {
    api: ChatApi
  }
}
