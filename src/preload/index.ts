import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}
interface ChatResult {
  ok: boolean
  result?: { text: string; provider: string; systemInjected: boolean }
  error?: string
}

/** API exposée au renderer — chaque méthode a un handler main réel. */
const api = {
  captureTestPage: (): Promise<string> => ipcRenderer.invoke('app:test:capture-page'),
  storageMigration: (): Promise<Record<string, string>> =>
    ipcRenderer.invoke('app:storage-migration'),
  completeStorageMigration: (): Promise<boolean> =>
    ipcRenderer.invoke('app:storage-migration-complete'),
  // Chat
  listProviders: (): Promise<string[]> => ipcRenderer.invoke('chat:providers'),
  routerSnapshot: (): Promise<unknown> => ipcRenderer.invoke('router:snapshot'),
  routerMigrationState: (): Promise<unknown> => ipcRenderer.invoke('router:migration-state'),
  setOmniRouteCredential: (credential: string): Promise<unknown> =>
    ipcRenderer.invoke('router:set-credential', credential),
  deleteOmniRouteCredential: (): Promise<unknown> => ipcRenderer.invoke('router:delete-credential'),
  testOmniRoute: (): Promise<unknown> => ipcRenderer.invoke('router:test-route'),
  activateOmniRoute: (routeModel: string, reasoningEffort?: string): Promise<unknown> =>
    ipcRenderer.invoke('router:activate', routeModel, reasoningEffort),
  openOmniRouteDashboard: (): Promise<void> => ipcRenderer.invoke('router:open-dashboard'),
  send: (
    provider: string | undefined,
    messages: Message[],
    conversationId?: string,
    role?: string
  ): Promise<ChatResult> =>
    ipcRenderer.invoke('chat:send', { provider, messages, conversationId, role }),
  onDelta: (cb: (delta: string) => void): (() => void) => {
    const handler = (_e: unknown, delta: string): void => cb(delta)
    ipcRenderer.on('chat:delta', handler)
    return () => ipcRenderer.removeListener('chat:delta', handler)
  },
  // Orchestration disciplinée
  orchestrate: (task: string): Promise<{ ok: boolean; result?: unknown; error?: string }> =>
    ipcRenderer.invoke('os:orchestrate', task),
  onOrchestrateStep: (cb: (step: unknown) => void): (() => void) => {
    const handler = (_e: unknown, step: unknown): void => cb(step)
    ipcRenderer.on('orchestrate:step', handler)
    return () => ipcRenderer.removeListener('orchestrate:step', handler)
  },
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
  models: (): Promise<unknown[]> => ipcRenderer.invoke('os:models:list'),
  profiles: (): Promise<unknown[]> => ipcRenderer.invoke('os:profiles:list'),
  saveProfile: (profile: unknown): Promise<unknown[]> =>
    ipcRenderer.invoke('os:profiles:save', profile),
  applyProfile: (id: string): Promise<unknown> => ipcRenderer.invoke('os:profiles:apply', id),
  kimiLogin: (): Promise<{ ok: true }> => ipcRenderer.invoke('os:kimiLogin'),
  topology: (): Promise<unknown> => ipcRenderer.invoke('os:topology:get'),
  setTopology: (topology: unknown): Promise<unknown> =>
    ipcRenderer.invoke('os:topology:set', topology),
  capabilityProfiles: (): Promise<unknown> => ipcRenderer.invoke('os:capabilityProfiles:get'),
  saveCapabilityProfiles: (state: unknown): Promise<unknown> =>
    ipcRenderer.invoke('os:capabilityProfiles:save', state),
  assignCapabilityProfile: (role: string, profileId: string): Promise<unknown> =>
    ipcRenderer.invoke('os:capabilityProfiles:assign', role, profileId),
  hermesControls: (kind: 'skills' | 'hooks' | 'tools' | 'plugins'): Promise<unknown[]> =>
    ipcRenderer.invoke('hermes:controls:list', kind),
  skills: (): Promise<unknown[]> => ipcRenderer.invoke('skills:registry:list'),
  promptCalls: (conversationId?: string): Promise<unknown[]> =>
    ipcRenderer.invoke('os:promptCalls', conversationId),
  hermesPromptTraces: (conversationId: string): Promise<unknown[]> =>
    ipcRenderer.invoke('os:hermesPromptTraces', conversationId),
  hermesPromptTraceSummary: (): Promise<unknown[]> =>
    ipcRenderer.invoke('os:hermesPromptTraceSummary'),
  authorizeHermesDiagnostics: (): Promise<string | null> =>
    ipcRenderer.invoke('os:authorizeHermesDiagnostics'),
  hermesPromptTracesGlobal: (capability: string): Promise<unknown[]> =>
    ipcRenderer.invoke('os:hermesPromptTracesGlobal', capability),
  causalTrace: (conversationId: string): Promise<unknown[]> =>
    ipcRenderer.invoke('os:causalTrace', conversationId),
  claudeHooks: (): Promise<unknown[]> => ipcRenderer.invoke('claude:hooks:list'),
  codexHooks: (): Promise<unknown[]> => ipcRenderer.invoke('codex:hooks:list'),
  setHermesTool: (name: string, enabled: boolean): Promise<unknown> =>
    ipcRenderer.invoke('hermes:tools:set', name, enabled),
  setHermesToolSelection: (names: string[]): Promise<unknown> =>
    ipcRenderer.invoke('hermes:tools:select', names),
  setHermesPlugin: (name: string, enabled: boolean): Promise<unknown> =>
    ipcRenderer.invoke('hermes:plugins:set', name, enabled),
  behaviourWorkspace: (): Promise<string> => ipcRenderer.invoke('hermes:behaviour:workspace'),
  chooseBehaviourWorkspace: (): Promise<string | null> =>
    ipcRenderer.invoke('hermes:behaviour:choose-workspace'),
  behaviourContexts: (workspaceRoot: string): Promise<unknown> =>
    ipcRenderer.invoke('hermes:behaviour:contexts', workspaceRoot),
  behaviourFiles: (workspaceRoot?: string, contextRoot?: string): Promise<unknown> =>
    ipcRenderer.invoke('hermes:behaviour:list', workspaceRoot, contextRoot),
  readBehaviourFile: (id: string, workspaceRoot?: string, contextRoot?: string): Promise<string> =>
    ipcRenderer.invoke('hermes:behaviour:read', id, workspaceRoot, contextRoot),
  behaviourProof: (workspaceRoot?: string, contextRoot?: string): Promise<unknown> =>
    ipcRenderer.invoke('hermes:behaviour:proof', workspaceRoot, contextRoot),
  runSkillLoop: (input: unknown): Promise<unknown> => ipcRenderer.invoke('hermes:loop:run', input),
  loopSkills: (): Promise<unknown[]> => ipcRenderer.invoke('hermes:loop:skills'),
  generateLoopDraft: (objective: string): Promise<unknown> =>
    ipcRenderer.invoke('hermes:loop:generate', objective),
  loopRuns: (): Promise<unknown[]> => ipcRenderer.invoke('hermes:loop:runs'),
  onSkillLoopEvent: (cb: (event: unknown) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, loopEvent: unknown): void => cb(loopEvent)
    ipcRenderer.on('hermes:loop:event', handler)
    return () => ipcRenderer.removeListener('hermes:loop:event', handler)
  },
  onModelQuestion: (cb: (question: unknown) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, question: unknown): void => cb(question)
    ipcRenderer.on('model:question', handler)
    return () => ipcRenderer.removeListener('model:question', handler)
  },
  answerModelQuestion: (id: string, answer: string): Promise<{ ok: true }> =>
    ipcRenderer.invoke('model:question:answer', id, answer),
  // Dashboards réels
  budget: (): Promise<{
    spent: number
    budget: number | null
    ratio: number | null
    alert: boolean
  }> => ipcRenderer.invoke('os:budget'),
  costByRole: (): Promise<Record<string, { costUsd: number; turns: number }>> =>
    ipcRenderer.invoke('os:costByRole'),
  trustRanking: (): Promise<Array<{ model: string; accuracy: number | null; confirmed: number }>> =>
    ipcRenderer.invoke('os:trustRanking'),
  runsWithGate: (): Promise<
    Array<{ subject: string; summary: { status: string }; blocked: boolean }>
  > => ipcRenderer.invoke('os:runsWithGate'),
  kaizen: (jsonl: string): Promise<Array<{ key: string; count: number }>> =>
    ipcRenderer.invoke('os:kaizen', jsonl),
  // Sas d'autorité
  authorityPending: (): Promise<unknown[]> => ipcRenderer.invoke('os:authority:pending'),
  authorityResolve: (id: string, choice: unknown): Promise<unknown> =>
    ipcRenderer.invoke('os:authority:resolve', id, choice),
  authoritySweep: (): Promise<unknown[]> => ipcRenderer.invoke('os:authority:sweep'),
  // Conversations
  conversations: (): Promise<
    Array<{ id: string; title: string; category: string; provider: string }>
  > => ipcRenderer.invoke('os:conversations'),
  conversationsCreate: (p: {
    title: string
    category: string
    provider: string
  }): Promise<{ id: string; title: string; category: string; provider: string }> =>
    ipcRenderer.invoke('os:conversations:create', p),
  conversationsRename: (id: string, title: string): Promise<unknown> =>
    ipcRenderer.invoke('os:conversations:rename', id, title),
  conversationsSetAuthorityMode: (id: string, mode: 'plan' | 'ask' | 'auto'): Promise<unknown> =>
    ipcRenderer.invoke('os:conversations:authorityMode', id, mode),
  conversationsFork: (id: string, messageId: string): Promise<unknown> =>
    ipcRenderer.invoke('os:conversations:fork', id, messageId),
  conversationsSwitchBranch: (id: string, branchId: string): Promise<unknown> =>
    ipcRenderer.invoke('os:conversations:switchBranch', id, branchId),
  conversationsRemove: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('os:conversations:remove', id),
  openFolder: (path: string): Promise<void> => ipcRenderer.invoke('os:openFolder', path),
  // Plan de contrôle (app pilotable par les agents) + pilotage in-model
  appState: (): Promise<unknown> => ipcRenderer.invoke('os:appState'),
  appCatalog: (): Promise<unknown> => ipcRenderer.invoke('os:appCatalog'),
  appCommand: (name: string, args?: Record<string, unknown>): Promise<unknown> =>
    ipcRenderer.invoke('os:appCommand', name, args),
  pilot: (goal: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('os:pilot', goal),
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
  pendingDirectives: (conversationId: string): Promise<string[]> =>
    ipcRenderer.invoke('os:pilotChat:pending', conversationId),
  removePendingDirective: (conversationId: string, index: number): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('os:pilotChat:removeDirective', conversationId, index),
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
  // Observatoire d'activité (transcripts Claude Code + ledger in-app)
  activitySessions: (): Promise<unknown[]> => ipcRenderer.invoke('os:activity:sessions'),
  activitySession: (meta: unknown): Promise<unknown> =>
    ipcRenderer.invoke('os:activity:session', meta),
  activityHabits: (): Promise<unknown> => ipcRenderer.invoke('os:activity:habits'),
  activityLedger: (): Promise<unknown[]> => ipcRenderer.invoke('os:activity:ledger'),
  activityImage: (path: string): Promise<{ dataUrl: string }> =>
    ipcRenderer.invoke('os:activity:image', path),
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
  // Harnais : projection lecture seule (typée dans index.d.ts)
  harnessSnapshot: (): Promise<unknown> => ipcRenderer.invoke('os:harness:snapshot')
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
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
