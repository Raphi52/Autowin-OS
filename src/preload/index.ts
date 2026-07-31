import { contextBridge, ipcRenderer, webFrame } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

/** API exposée au renderer — chaque méthode a un handler main réel. */
const api = {
  captureTestPage: (): Promise<string> => ipcRenderer.invoke('app:test:capture-page'),
  seedConversationScopeTest: (conversationId: string, variant: 'a' | 'b'): Promise<unknown> =>
    ipcRenderer.invoke('app:test:seed-conversation-scope', conversationId, variant),
  seedArtifactPreviewsTest: (): Promise<{ conversationId: string; turnId: string }> =>
    ipcRenderer.invoke('app:test:seed-artifact-previews'),
  storageMigration: (): Promise<Record<string, string>> =>
    ipcRenderer.invoke('app:storage-migration'),
  completeStorageMigration: (): Promise<boolean> =>
    ipcRenderer.invoke('app:storage-migration-complete'),
  // Orchestration disciplinée
  orchestrate: (
    task: string,
    conversationId?: string
  ): Promise<{ ok: boolean; result?: unknown; error?: string }> =>
    ipcRenderer.invoke('os:orchestrate', task, conversationId),
  onOrchestrateStep: (cb: (step: unknown) => void): (() => void) => {
    const handler = (_e: unknown, step: unknown): void => cb(step)
    ipcRenderer.on('orchestrate:step', handler)
    return () => ipcRenderer.removeListener('orchestrate:step', handler)
  },
  // #4 — résultat du diagnostic de démarrage (émis seulement si dégradé) → bannière.
  onPreflight: (cb: (result: unknown) => void): (() => void) => {
    const handler = (_e: unknown, result: unknown): void => cb(result)
    ipcRenderer.on('preflight:result', handler)
    return () => ipcRenderer.removeListener('preflight:result', handler)
  },
  getPreflight: (): Promise<unknown> => ipcRenderer.invoke('preflight:current'),
  // Source control — lecture git READ-ONLY (statut, branche, changements, historique). Aucune action git.
  getGitState: (repoPath?: string): Promise<unknown> => ipcRenderer.invoke('git:read', repoPath),
  conversationGitState: (conversationId: string): Promise<unknown> =>
    ipcRenderer.invoke('git:conversationRead', conversationId),
  conversationGitDiff: (
    conversationId: string,
    path: string,
    workspaceRoot: string
  ): Promise<unknown> =>
    ipcRenderer.invoke('git:conversationDiff', conversationId, path, workspaceRoot),
  getGitGraph: (repoPath?: string): Promise<unknown> => ipcRenderer.invoke('git:graph', repoPath),
  getGitDiff: (path: string, repoPath?: string): Promise<unknown> =>
    ipcRenderer.invoke('git:diff', path, repoPath),
  pickGitRepo: (): Promise<string | null> => ipcRenderer.invoke('git:pickRepo'),
  brainRepoPath: (): Promise<string> => ipcRenderer.invoke('git:brainRoot'),
  getAutoClose: (): Promise<unknown> => ipcRenderer.invoke('run:autoClose:get'),
  setAutoClose: (enabled: boolean): Promise<unknown> =>
    ipcRenderer.invoke('run:autoClose:set', enabled),
  // Survie niveau 2 : tours restés inachevés (app fermée pendant l'exécution) + leur journal.
  unfinishedTurns: (): Promise<
    Array<{ conversationId: string; turnId: string; events: number; updatedAt: number }>
  > => ipcRenderer.invoke('runs:unfinishedTurns'),
  turnJournal: (conversationId: string, turnId: string): Promise<Array<Record<string, unknown>>> =>
    ipcRenderer.invoke('runs:turnJournal', conversationId, turnId),
  // Auto-update git au démarrage.
  checkUpdate: (): Promise<{ available: boolean; behind: number; branch?: string }> =>
    ipcRenderer.invoke('update:check'),
  applyUpdate: (): Promise<{
    ok: boolean
    relaunch?: boolean
    npmInstalled?: boolean
    error?: string
  }> => ipcRenderer.invoke('update:apply'),
  ticketSources: (): Promise<unknown[]> => ipcRenderer.invoke('tickets:sources'),
  saveTicketSource: (profile: unknown): Promise<unknown[]> =>
    ipcRenderer.invoke('tickets:source:save', profile),
  listTickets: (request: unknown): Promise<unknown> => ipcRenderer.invoke('tickets:list', request),
  cancelTickets: (requestId: string): Promise<boolean> =>
    ipcRenderer.invoke('tickets:cancel', requestId),
  listTicketPeople: (source: unknown): Promise<string[]> =>
    ipcRenderer.invoke('tickets:people', source),
  setTicketsFixture: (fixture: unknown): Promise<boolean> =>
    ipcRenderer.invoke('app:test:tickets-fixture', fixture),
  // Cockpit worktree (volet A) — activité des copies isolées par agent (frise + journal).
  getWorktreeActivity: (): Promise<unknown[]> => ipcRenderer.invoke('worktree:activity'),
  getWorktreeStatus: (): Promise<unknown> => ipcRenderer.invoke('worktree:status'),
  getWorktreeConflictDiff: (agentId: string): Promise<unknown> =>
    ipcRenderer.invoke('worktree:conflict-diff', agentId),
  retryWorktreeRecovery: (agentId: string): Promise<unknown> =>
    ipcRenderer.invoke('worktree:retry-recovery', agentId),
  setWorktreeFixture: (fixture: unknown): Promise<boolean> =>
    ipcRenderer.invoke('app:test:worktree-fixture', fixture),
  onWorktreeActivity: (cb: (activity: unknown[]) => void): (() => void) => {
    const handler = (_e: unknown, activity: unknown[]): void => cb(activity)
    ipcRenderer.on('worktree:activity-changed', handler)
    return () => ipcRenderer.removeListener('worktree:activity-changed', handler)
  },
  // #5 — le wizard first-run re-vérifie la config à la demande (force=true pour le bouton).
  repairPreflight: (checkId: string): Promise<unknown> =>
    ipcRenderer.invoke('preflight:repair', checkId),
  recheckPreflight: (force?: boolean): Promise<unknown> =>
    ipcRenderer.invoke('preflight:recheck', force),
  orchestrationBudget: (): Promise<{ maxUsd: number | null }> =>
    ipcRenderer.invoke('os:orchestrationBudget:get'),
  setOrchestrationBudget: (settings: {
    maxUsd: number | null
  }): Promise<{ maxUsd: number | null }> =>
    ipcRenderer.invoke('os:orchestrationBudget:set', settings),
  // Config par rôle
  roles: (): Promise<
    Record<string, { provider: string; model?: string; reasoningEffort?: string }>
  > => ipcRenderer.invoke('os:roles'),
  setRole: (
    role: string,
    provider: string,
    model?: string,
    reasoningEffort?: string
  ): Promise<unknown> => ipcRenderer.invoke('os:setRole', role, provider, model, reasoningEffort),
  models: (force = false): Promise<unknown[]> => ipcRenderer.invoke('os:models:list', force),
  modelQuotas: (force = false): Promise<unknown> => ipcRenderer.invoke('os:models:quotas', force),
  profiles: (): Promise<unknown[]> => ipcRenderer.invoke('os:profiles:list'),
  saveProfile: (profile: unknown): Promise<unknown[]> =>
    ipcRenderer.invoke('os:profiles:save', profile),
  applyProfile: (id: string): Promise<unknown> => ipcRenderer.invoke('os:profiles:apply', id),
  kimiLogin: (): Promise<{ ok: true }> => ipcRenderer.invoke('os:kimiLogin'),
  providerLogin: (provider: string): Promise<{ ok: true }> =>
    ipcRenderer.invoke('os:providerLogin', provider),
  topology: (): Promise<unknown> => ipcRenderer.invoke('os:topology:get'),
  setTopology: (topology: unknown): Promise<unknown> =>
    ipcRenderer.invoke('os:topology:set', topology),
  capabilityControls: (kind: 'skills' | 'hooks' | 'tools' | 'plugins'): Promise<unknown[]> =>
    ipcRenderer.invoke('os:capabilities:list', kind),
  skills: (): Promise<unknown[]> => ipcRenderer.invoke('skills:registry:list'),
  promptCalls: (conversationId?: string): Promise<unknown[]> =>
    ipcRenderer.invoke('os:promptCalls', conversationId),
  /** Repartition du cout par role/modele/provider, triee par cout decroissant. */
  costBreakdown: (
    dimension?: 'actor' | 'model' | 'provider',
    conversationId?: string
  ): Promise<unknown[]> => ipcRenderer.invoke('os:costBreakdown', dimension, conversationId),
  promptTraces: (conversationId: string): Promise<unknown[]> =>
    ipcRenderer.invoke('os:promptTraces', conversationId),
  brainTraces: (conversationId?: string): Promise<unknown[]> =>
    ipcRenderer.invoke('os:brainTraces', conversationId),
  behaviourComposition: (): Promise<unknown> => ipcRenderer.invoke('os:behaviourComposition'),
  providerStatus: (): Promise<unknown[]> => ipcRenderer.invoke('os:providerStatus'),
  providerTest: (provider: string): Promise<unknown> =>
    ipcRenderer.invoke('os:providerTest', provider),
  setProviderMode: (provider: string, mode: 'active' | 'standby'): Promise<unknown> =>
    ipcRenderer.invoke('os:providerMode:set', provider, mode),
  promptTraceSummary: (): Promise<unknown[]> => ipcRenderer.invoke('os:promptTraceSummary'),
  authorizeDiagnostics: (): Promise<string | null> => ipcRenderer.invoke('os:authorizeDiagnostics'),
  promptTracesGlobal: (capability: string): Promise<unknown[]> =>
    ipcRenderer.invoke('os:promptTracesGlobal', capability),
  causalTrace: (conversationId: string): Promise<unknown[]> =>
    ipcRenderer.invoke('os:causalTrace', conversationId),
  claudeHooks: (): Promise<unknown[]> => ipcRenderer.invoke('claude:hooks:list'),
  codexHooks: (): Promise<unknown[]> => ipcRenderer.invoke('codex:hooks:list'),
  setCapabilityTool: (name: string, enabled: boolean): Promise<unknown> =>
    ipcRenderer.invoke('os:capabilities:tools:set', name, enabled),
  chooseBehaviourWorkspace: (): Promise<string | null> =>
    ipcRenderer.invoke('os:behaviour:choose-workspace'),
  onModelQuestion: (cb: (question: unknown) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, question: unknown): void => cb(question)
    ipcRenderer.on('model:question', handler)
    return () => ipcRenderer.removeListener('model:question', handler)
  },
  answerModelQuestion: (id: string, answer: string): Promise<{ ok: true }> =>
    ipcRenderer.invoke('model:question:answer', id, answer),
  toolUsage: (): Promise<
    Array<{ id: string; label: string; description: string; enabled: boolean; mutable: boolean }>
  > => ipcRenderer.invoke('os:toolUsage'),
  // Sas d'autorité
  authorityPending: (): Promise<unknown[]> => ipcRenderer.invoke('os:authority:pending'),
  authorityResolve: (id: string, choice: unknown): Promise<unknown> =>
    ipcRenderer.invoke('os:authority:resolve', id, choice),
  // Conversations
  conversations: (): Promise<
    Array<{ id: string; title: string; category: string; provider: string }>
  > => ipcRenderer.invoke('os:conversations'),
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
  conversationsRename: (id: string, title: string): Promise<unknown> =>
    ipcRenderer.invoke('os:conversations:rename', id, title),
  conversationsSetAuthorityMode: (id: string, mode: 'plan' | 'ask' | 'auto'): Promise<unknown> =>
    ipcRenderer.invoke('os:conversations:authorityMode', id, mode),
  conversationsFork: (id: string, messageId: string): Promise<unknown> =>
    ipcRenderer.invoke('os:conversations:fork', id, messageId),
  conversationsRemove: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('os:conversations:remove', id),
  readChatArtifact: (
    conversationId: string,
    turnId: string,
    artifactId: string
  ): Promise<unknown> =>
    ipcRenderer.invoke('os:chatArtifact:read', conversationId, turnId, artifactId),
  revealChatArtifact: (
    conversationId: string,
    turnId: string,
    artifactId: string
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('os:chatArtifact:reveal', conversationId, turnId, artifactId),
  taskManagerSnapshot: (): Promise<unknown> => ipcRenderer.invoke('task-manager:snapshot'),
  taskManagerCreate: (task: unknown): Promise<unknown> =>
    ipcRenderer.invoke('task-manager:create', task),
  taskManagerUpdate: (id: string, task: unknown): Promise<unknown> =>
    ipcRenderer.invoke('task-manager:update', id, task),
  taskManagerRemove: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('task-manager:remove', id),
  taskManagerAcknowledge: (alertId: string): Promise<boolean> =>
    ipcRenderer.invoke('task-manager:acknowledge', alertId),
  taskManagerRunNow: (id: string): Promise<{ started: boolean }> =>
    ipcRenderer.invoke('task-manager:run-now', id),
  openFolder: (path: string): Promise<void> => ipcRenderer.invoke('os:openFolder', path),
  // Plan de contrôle (app pilotable par les agents) + pilotage in-model
  appState: (): Promise<unknown> => ipcRenderer.invoke('os:appState'),
  appCatalog: (): Promise<unknown> => ipcRenderer.invoke('os:appCatalog'),
  appCommand: (name: string, args?: Record<string, unknown>): Promise<unknown> =>
    ipcRenderer.invoke('os:appCommand', name, args),
  pilotChat: (
    messages: Array<{
      role: 'user' | 'assistant'
      content: string
      attachments?: Array<{
        name: string
        mimeType: string
        size: number
        kind: 'text' | 'image' | 'file'
        content: string
      }>
    }>,
    conversationId?: string
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('os:pilotChat', messages, conversationId),
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
  onPilotEvent: (cb: (e: unknown) => void): (() => void) => {
    const h = (_e: unknown, ev: unknown): void => cb(ev)
    ipcRenderer.on('pilot:event', h)
    return () => ipcRenderer.removeListener('pilot:event', h)
  },
  onAppEvent: (cb: (e: Record<string, unknown> & { type: string }) => void): (() => void) => {
    const h = (_e: unknown, ev: Record<string, unknown> & { type: string }): void => cb(ev)
    ipcRenderer.on('app:event', h)
    return () => ipcRenderer.removeListener('app:event', h)
  },
  emitIsolatedTestAppEvent: (event: Record<string, unknown> & { type: string }): Promise<boolean> =>
    ipcRenderer.invoke('app:test:emit-event', event),
  // Workflows de la conversation active (créés in-app + attachés)
  conversationRuns: (convId: string): Promise<unknown[]> =>
    ipcRenderer.invoke('os:conversationRuns', convId),
  conversationActivity: (convId: string): Promise<unknown[]> =>
    ipcRenderer.invoke('os:conversationActivity', convId),
  runTrace: (path: string): Promise<unknown[] | null> => ipcRenderer.invoke('os:runTrace', path),
  setActiveConversation: (convId: string | null): Promise<unknown> =>
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
  loadBrainGraph: (path: string, lod?: number, community?: number): Promise<unknown> =>
    ipcRenderer.invoke('os:loadBrainGraph', path, lod, community),
  loadBrainGraphPreview: (path: string, lod?: number): Promise<unknown> =>
    ipcRenderer.invoke('os:loadBrainGraphPreview', path, lod),
  loadBrainThemes: (path: string): Promise<unknown> =>
    ipcRenderer.invoke('os:loadBrainThemes', path),
  loadBrainThemeNodes: (path: string, themeIds: string[]): Promise<unknown> =>
    ipcRenderer.invoke('os:loadBrainThemeNodes', path, themeIds),
  loadBrainNeighborhood: (path: string, nodeId: string): Promise<unknown> =>
    ipcRenderer.invoke('os:loadBrainNeighborhood', path, nodeId),
  readNodeFile: (path: string): Promise<{ path: string; content: string }> =>
    ipcRenderer.invoke('os:readNodeFile', path),
  searchBrain: (path: string, query: string): Promise<unknown[]> =>
    ipcRenderer.invoke('os:searchBrain', path, query),
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
