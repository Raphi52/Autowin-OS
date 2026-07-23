import { app, shell, BrowserWindow, dialog, ipcMain, Notification, type IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import devIcon from '../../resources/autowin-os-dev.png?asset'
import type { Message, ProviderAdapter, SendResult, StreamChunk } from './providers/types'
import { ProviderRegistry } from './providers/registry'
import { AutowinOS } from './os'
import { installCrashHandlers } from './crash-handlers'
import { CostCircuitBreaker } from './cost-circuit-breaker'
import { runAppPreflight } from './preflight-probes'
import { RoleModelConfig, type ReasoningEffort, type Role } from './roles'
import { AppCommandBus, type AppEvent } from './commands'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import { ActiveChatTurns } from './active-chat-turns'
import type { ChatTurnEvent } from '../shared/chat-turn'
import { TraceLedger } from './activity/ledger'
import { aggregateHabits, listSessions, parseSession } from './activity/transcripts'
import { persistConversations } from './store/conversations-disk'
import { listConvRuns, loadConvRunTrace } from './runs/conv-runs'
import { appendConvActivity, loadConvActivity } from './activity/conv-activity'
import {
  appendPromptCall,
  deletePromptCalls,
  loadAllPromptCalls,
  loadPromptCalls
} from './activity/prompt-observability'
import { promptConfigChange } from './activity/prompt-config-change'
import { appendPromptConfigActivity } from './activity/prompt-config-store'
import { promptCallToTraceEvents } from './activity/prompt-call-trace'
import { pilotActionToTraceEvent } from './activity/pilot-action-trace'
import { TraceStore } from './activity/trace-store'
import { DiagnosticCapabilities } from './activity/diagnostic-capability'
import { responseDisplayedTrace } from './activity/response-displayed-trace'
import { persistOrchestrationStep } from './activity/orchestration-observability'
import { aggregateToolUsage } from './activity/tool-usage'
import { LoopRunStore } from './loop-run-store'
import { ProfileStore, resolveProfileRoute, type AutowinProfile } from './profile-store'
import {
  listCapabilities,
  setCapabilityEnabled,
  setCapabilitySelection,
  warmCapabilities
} from './capability-controls'
import {
  defaultBehaviourWorkspace,
  listBehaviourContexts,
  listBehaviourFiles,
  readBehaviourFile,
  type BehaviourFile
} from './behaviour-files'
import { ApprovedBehaviourWorkspaces, isTrustedRendererUrl } from './behaviour-access'
import { runSkillLoop, type LoopRunInput } from './loop-runner'
import { parseGeneratedLoop } from './loop-draft'
import { listLoopSkills } from './loop-skills'
import { discoverConfiguredSkillRegistry } from './skill-registry'
import { listClaudeHooks, listCodexHooks } from './claude-hooks'
import { ModelQuestionHub, type ModelQuestion, type PendingModelQuestion } from './model-questions'
import {
  DEFAULT_IMPORTED_MODELS,
  discoverImportedModels,
  discoverOmniRouteModels,
  findModel
} from './models'
import { loadAgentTopology, saveAgentTopology } from './topology-disk'
import { migrateTopologyShape } from './topology'
import type { AgentTopology, SlotBinding } from './topology'
import {
  createAutowinAppDataRoot,
  ensureAutowinAppData,
  legacyAppDataRoot,
  resolveAutowinAppDataBase
} from './app-data'
import { AUTOWIN_APP_ID, AUTOWIN_DISPLAY_NAME } from '../shared/app-identity'
import { loadOmniRouteSnapshot, omniRouteDashboardUrl } from './omniroute-client'
import { runOmniRouteKeyringSmoke } from './credentials/omniroute-keyring-smoke'
import { OmniRouteMigrationStore } from './omniroute-migration'
import {
  isRendererStorageMigrationComplete,
  markRendererStorageMigrationComplete,
  readLegacyRendererStorage,
  type MigratedRendererStorage
} from './renderer-storage-migration'
import { guardAttachments, guardBoolean, guardMessages, guardString } from './ipc-guards'
import { readBoundedUtf8FileWithin } from './bounded-file-read'
import { BrainWorkerClient } from './viz/brain-worker-client'
import {
  createNativePreflightReader,
  filterNativePreflight,
  readNativePreflight
} from './activity/native-preflight'
import { nativeSpoolRoot, appendNativeTrace } from './activity/native-trace-spool'
import { appendBrainTrace, readBrainTraces } from './activity/brain-trace-spool'
import { buildBehaviourComposition } from './behaviour-composition'
import { proveInjections } from './native-injection-proof'
import { createAmitelContextProvider } from './amitel-context'
import {
  automationAppIdentity,
  presentAutomationWindow,
  resolveAutomationInstanceMode
} from './headless-instance'

const automationInstanceMode = resolveAutomationInstanceMode(
  process.argv,
  process.env,
  app.isPackaged
)
const isolatedTestInstance = automationInstanceMode.isolated
const headlessTestInstance = automationInstanceMode.headless
const appDataRoot = resolveAutowinAppDataBase(app.getPath('appData'), app.isPackaged)
app.setName(isolatedTestInstance ? `${AUTOWIN_DISPLAY_NAME} Test` : AUTOWIN_DISPLAY_NAME)
const explicitUserDataDir = process.argv.some((argument) => argument.startsWith('--user-data-dir'))
// En DEV uniquement : ouvre le port CDP pour piloter/inspecter le renderer réel (localhost:9223).
// Jamais en packagé (surface de debug). Doit être posé avant app ready.
if (is.dev) app.commandLine.appendSwitch('remote-debugging-port', '9223')
const canonicalAppDataRoot = createAutowinAppDataRoot(appDataRoot)
if (!explicitUserDataDir) app.setPath('userData', canonicalAppDataRoot)
// En DEV, on n'enforce PAS le single-instance lock : un hot-restart electron-vite (ou un
// process résiduel qui détient encore le lock) ne doit jamais laisser une instance PÉRIMÉE
// à l'écran en tuant la nouvelle. Le lock n'est appliqué que sur le build packagé.
const ownsInstanceLock =
  isolatedTestInstance || !app.isPackaged || app.requestSingleInstanceLock()
if (!ownsInstanceLock) app.quit()
else ensureAutowinAppData(appDataRoot)
let startupStorageMigration = false

/** Noyau applicatif unique (P0-P4 câblés) : kit SOUL injecté, 2 voies, modules. */
const os = new AutowinOS()
const omniRouteMigration = new OmniRouteMigrationStore(
  join(app.getPath('userData'), 'omniroute-migration.json')
)
const startupTransport = omniRouteMigration.load()
os.registry.setConversationTransport({
  provider: 'omniroute',
  model: startupTransport.routeModel,
  reasoningEffort: startupTransport.reasoningEffort
})
const brainWorker = new BrainWorkerClient(join(__dirname, 'brain-worker.js'))
// Conversations persistées sur disque : rechargées au démarrage, sauvées à chaque mutation.
const flushConversations = persistConversations(os.conversations)

/** Diffuse un événement d'app à toutes les fenêtres (UI live quand un agent pilote). */
function broadcast(e: AppEvent): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('app:event', e)
}
/** Bus de commandes (plan de contrôle) + pilote agent (tool-loop). */
const bus = new AppCommandBus(os, broadcast)
const pilot = new AgentPilot(
  os.registry,
  os.roles,
  bus,
  createAmitelContextProvider({
    graphEvidence: (raw, query, limit) =>
      brainWorker.request<string>('graphifyEvidence', raw, query, limit)
  })
)
const modelQuestions = new ModelQuestionHub()
const activeChatTurns = new ActiveChatTurns()
/** Directives utilisateur injectées PENDANT un tour, par conversation (drainées à chaque itération). */
const pendingDirectives = new Map<string, string[]>()
function drainPendingDirectives(conversationId: string): string[] {
  const queued = pendingDirectives.get(conversationId) ?? []
  pendingDirectives.delete(conversationId)
  if (queued.length) broadcast({ type: 'refresh', scope: 'directives' })
  return queued
}
const questionWindows = new Map<string, BrowserWindow>()
const diagnosticCapabilities = new DiagnosticCapabilities()
let agentModels = DEFAULT_IMPORTED_MODELS
const agentTopologyPath = join(app.getPath('userData'), 'agent-topology.json')
let agentTopology = loadAgentTopology(agentTopologyPath, agentModels)
const agentModelsReady = discoverImportedModels(fetch, undefined, os.omniRouteCredentialStore).then(
  (models) => {
    agentModels = models
    agentTopology = loadAgentTopology(agentTopologyPath, agentModels)
    syncRuntimeTopology(agentTopology)
    return models
  }
)

function syncRuntimeTopology(topology: AgentTopology): void {
  const sync = (role: Role, binding: SlotBinding | undefined): void => {
    if (!binding) return
    const model = findModel(agentModels, binding.modelId)
    if (!model) return
    os.setRole(role, {
      provider: binding.provider,
      model: model.model,
      reasoningEffort: binding.reasoningEffort
    })
  }
  sync('orchestrator', topology.orchestrator)
  sync('subagent', topology.subagents[0])
  sync('scout', topology.panels.scout[0])
  sync('judge', topology.panels.judge[0])
  // Fan-out multi-modèles : on fournit à l'orchestrateur la LISTE COMPLÈTE des modèles de chaque
  // bloc de divergence/jugement (plus le seul `[0]`). ≥2 → il duplique + agrège. La ligne `sync`
  // ci-dessus reste pour le chemin mono-modèle (rétrocompat : 0/1 slot → comportement actuel).
  const toMembers = (
    slots: SlotBinding[]
  ): Array<{ provider: string; model?: string; reasoningEffort?: ReasoningEffort }> =>
    slots.flatMap((b) => {
      const model = findModel(agentModels, b.modelId)
      if (!model) {
        // Dégradation VISIBLE : un slot dont le modèle a disparu (désimporté) est retiré du fan-out.
        // Sans ce log, un panel configuré à N modèles retomberait silencieusement en mono.
        console.warn(
          `[fan-out] slot ${b.slotId} ignoré : modèle introuvable « ${b.modelId} » (panel dégradé)`
        )
        return []
      }
      return [{ provider: b.provider, model: model.model, reasoningEffort: b.reasoningEffort }]
    })
  os.setFanOut({
    scout: toMembers(topology.panels.scout),
    frame: toMembers(topology.panels.frame),
    judge: toMembers(topology.panels.judge)
  })
}

function openQuestionWindow(parent: BrowserWindow | null, question: PendingModelQuestion): void {
  const win = new BrowserWindow({
    width: 640,
    height: 560,
    minWidth: 480,
    minHeight: 420,
    parent: parent ?? undefined,
    modal: false,
    show: false,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    title: 'Question du modèle',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false
    }
  })
  questionWindows.set(question.id, win)
  win.on('closed', () => {
    if (!questionWindows.delete(question.id)) return
    try {
      modelQuestions.resolve(question.id, 'attend pour l’instant')
    } catch {
      // La réponse a déjà été transmise juste avant la fermeture.
    }
  })
  win.once('ready-to-show', () => {
    presentAutomationWindow(win, headlessTestInstance, { focus: true, flash: true })
  })
  win.webContents.once('did-finish-load', () => win.webContents.send('model:question', question))
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#model-question`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'model-question' })
  }
}

function askModelQuestion(
  sender: Electron.WebContents,
  source: 'chat' | 'loop',
  question: ModelQuestion,
  context?: string,
  signal?: AbortSignal
): Promise<string> {
  let pendingId: string | undefined
  const answer = modelQuestions.ask(
    source,
    question,
    (pending) => {
      pendingId = pending.id
      openQuestionWindow(BrowserWindow.fromWebContents(sender), pending)
    },
    context,
    signal
  )
  return answer.finally(() => {
    if (!signal?.aborted || !pendingId) return
    const win = questionWindows.get(pendingId)
    questionWindows.delete(pendingId)
    if (win && !win.isDestroyed()) win.close()
  })
}
/** Ledger d'activité in-app : chaque action d'agent laisse une trace consultable. */
const ledger = new TraceLedger(join(app.getPath('userData'), 'trace'))
const causalTrace = new TraceStore(join(app.getPath('userData'), 'causal-trace'))
const loopRuns = new LoopRunStore(join(app.getPath('userData'), 'loop-runs.json'))
const profiles = new ProfileStore(join(app.getPath('userData'), 'profiles.json'))
bus.trace = (name, args, ok) =>
  ledger.append({ source: 'bus', name, detail: JSON.stringify(args).slice(0, 200), ok })

/** Plafond de taille des payloads IPC (anti-DoS main process). */

const defaultBehaviourRoot = defaultBehaviourWorkspace()
const behaviourAccess = new ApprovedBehaviourWorkspaces(defaultBehaviourRoot)
const behaviourManifestCache = new Map<string, { capturedAt: number; files: BehaviourFile[] }>()

function behaviourManifestKey(workspaceRoot: string, contextRoot: string): string {
  return `${workspaceRoot}\u0000${contextRoot}`
}

async function behaviourManifest(
  workspaceRoot: string,
  contextRoot: string
): Promise<BehaviourFile[]> {
  const key = behaviourManifestKey(workspaceRoot, contextRoot)
  const cached = behaviourManifestCache.get(key)
  if (cached && Date.now() - cached.capturedAt < 15_000) return cached.files
  const files = await listBehaviourFiles({ workspaceRoot, contextRoot })
  behaviourManifestCache.set(key, { capturedAt: Date.now(), files })
  return files
}

function assertTrustedRendererSender(event: IpcMainInvokeEvent, scope: string): void {
  const trusted = isTrustedRendererUrl(event.senderFrame?.url ?? '', behaviourRendererOptions())
  if (!trusted) throw new Error(`Origine renderer non autorisée pour ${scope}`)
}

function assertTrustedBehaviourSender(event: IpcMainInvokeEvent): void {
  assertTrustedRendererSender(event, 'Behaviour')
}

function approvedBehaviourWorkspace(workspaceRoot?: unknown): string {
  return behaviourAccess.require(
    workspaceRoot === undefined
      ? defaultBehaviourRoot
      : guardString(workspaceRoot, 'behaviour.workspaceRoot')
  )
}

function behaviourRendererOptions(): { devRendererUrl?: string; rendererHtmlPath: string } {
  return {
    devRendererUrl: is.dev ? process.env.ELECTRON_RENDERER_URL : undefined,
    rendererHtmlPath: join(__dirname, '../renderer/index.html')
  }
}

/** IPC one-shot : lecture historique, import renderer, acquittement, puis marqueur. */
function registerStorageMigrationIpc(
  legacyStorageValues: MigratedRendererStorage,
  canWriteMigrationMarker: boolean
): void {
  ipcMain.handle('app:storage-migration', () => legacyStorageValues)
  ipcMain.handle('app:storage-migration-complete', (event) => {
    if (!isTrustedRendererUrl(event.senderFrame?.url ?? '', behaviourRendererOptions())) {
      throw new Error('Origine renderer non autorisee pour la migration')
    }
    if (!canWriteMigrationMarker) return false
    markRendererStorageMigrationComplete(canonicalAppDataRoot)
    return true
  })
}

/** IPC : chat, orchestration, dashboards et graphe. */
function registerChatIpc(): void {
  ipcMain.handle('app:test:capture-page', async (event) => {
    assertTrustedRendererSender(event, 'Capture UI de test')
    if (!isolatedTestInstance)
      throw new Error('Capture UI de test indisponible hors instance isolée')
    return (await event.sender.capturePage()).toPNG().toString('base64')
  })
  ipcMain.handle('app:test:emit-event', (event, payload: unknown) => {
    assertTrustedRendererSender(event, 'Fixture UI')
    if (!isolatedTestInstance) throw new Error('Émission de test indisponible hors instance isolée')
    if (!payload || typeof payload !== 'object') throw new Error('Événement de test invalide')
    const appEvent = payload as Record<string, unknown>
    if (
      ![
        'orchestrate-start',
        'orchestrate-phase',
        'orchestrate-delta',
        'orchestrate-step',
        'orchestrate-end',
        'refresh'
      ].includes(String(appEvent.type))
    ) {
      throw new Error('Type d’événement de test interdit')
    }
    if (appEvent.type === 'refresh' && appEvent.scope !== 'conversations')
      throw new Error('Scope de refresh de test interdit')
    broadcast(appEvent as unknown as AppEvent)
    return true
  })
  // --- Chat direct : streame les deltas, alimente le coût RÉEL ---
  ipcMain.handle(
    'chat:send',
    async (
      event,
      req: { provider?: string; role?: Role; messages: Message[]; conversationId?: string }
    ) => {
      try {
        const messages = guardMessages(req?.messages)
        const result = await os.chat(req.provider, req.role, messages, (d) =>
          event.sender.send('chat:delta', d)
        )
        if (req.conversationId) {
          const last = messages[messages.length - 1]
          if (last?.role === 'user')
            os.conversations.append(req.conversationId, { role: 'user', content: last.content })
          os.conversations.append(req.conversationId, { role: 'assistant', content: result.text })
        }
        return { ok: true, result }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )
  ipcMain.handle('skills:registry:list', (event) => {
    assertTrustedRendererSender(event, 'Skills')
    return discoverConfiguredSkillRegistry(join(app.getPath('userData'), 'skill-sources.json'))
  })
  ipcMain.handle('chat:providers', () => os.registry.ids())
  ipcMain.handle('router:snapshot', (event) => {
    assertTrustedRendererSender(event, 'Router')
    // Comptes/quotas exigent un « management token » OmniRoute (≠ clé API /v1) que l'app
    // ne stocke pas encore → on n'envoie rien (la clé API donnerait 403). Santé reste dispo.
    return loadOmniRouteSnapshot(fetch)
  })
  ipcMain.handle('router:migration-state', (event) => {
    assertTrustedRendererSender(event, 'Router')
    const state = omniRouteMigration.load()
    return {
      mode: 'omniroute' as const,
      routeModel: state.routeModel,
      reasoningEffort: state.reasoningEffort,
      credentialConfigured: Boolean(os.omniRouteCredentialStore.get())
    }
  })
  ipcMain.handle('router:set-credential', (event, credential: unknown) => {
    assertTrustedRendererSender(event, 'Router')
    os.omniRouteCredentialStore.set(guardString(credential, 'router.credential'))
    return { configured: true }
  })
  ipcMain.handle('router:delete-credential', (event) => {
    assertTrustedRendererSender(event, 'Router')
    os.omniRouteCredentialStore.delete()
    return { configured: false }
  })
  ipcMain.handle('router:test-route', async (event) => {
    assertTrustedRendererSender(event, 'Router')
    const models = await discoverOmniRouteModels(fetch, os.omniRouteCredentialStore)
    return {
      ok: models.length > 0,
      models: models.map(({ model, label }) => ({ id: model, label })),
      reason:
        models.length > 0
          ? undefined
          : 'OmniRoute inaccessible, credential refusé ou catalogue invalide'
    }
  })
  ipcMain.handle(
    'router:activate',
    async (event, routeModel: unknown, reasoningEffort?: unknown) => {
      assertTrustedRendererSender(event, 'Router')
      const route = guardString(routeModel, 'router.routeModel')
      const effort =
        reasoningEffort === undefined || reasoningEffort === null
          ? undefined
          : guardString(reasoningEffort, 'router.reasoningEffort')
      const models = await discoverOmniRouteModels(fetch, os.omniRouteCredentialStore)
      if (!models.some((model) => model.model === route)) {
        throw new Error('Route non confirmée par le catalogue OmniRoute')
      }
      const state = omniRouteMigration.activate(route, effort)
      os.registry.setConversationTransport({
        provider: 'omniroute',
        model: state.routeModel,
        reasoningEffort: state.reasoningEffort
      })
      broadcast({ type: 'refresh', scope: 'roles' })
      return {
        mode: 'omniroute',
        routeModel: route,
        reasoningEffort: state.reasoningEffort,
        credentialConfigured: true
      }
    }
  )
  ipcMain.handle('router:open-dashboard', async (event) => {
    assertTrustedRendererSender(event, 'Router')
    await shell.openExternal(omniRouteDashboardUrl)
  })
  ipcMain.handle('os:kimiLogin', () => {
    os.startKimiLogin()
    return { ok: true }
  })

  // --- Orchestration disciplinée (le cœur) : streame chaque étape ---
  ipcMain.handle('os:orchestrate', async (event, task: string) => {
    const conversationId = bus.activeConversationId ?? '__autonomous__'
    // #2 — run STOPPABLE : on enregistre un AbortController dans le registre du bus pour que
    // `os:orchestrate:cancel` → abortOrchestration(conversationId) le coupe réellement (sinon no-op).
    const controller = bus.registerOrchestration(conversationId)
    // #3 — circuit-breaker de coût : coupe + notifie AVANT dépassement d'un seuil déclaré (env
    // AUTOWIN_RUN_USD_CAP / AUTOWIN_RUN_TOKEN_CAP), plutôt qu'une facture surprise en post-mortem.
    const usdCap = Number(process.env.AUTOWIN_RUN_USD_CAP)
    const tokenCap = Number(process.env.AUTOWIN_RUN_TOKEN_CAP)
    const breaker = new CostCircuitBreaker({
      maxUsd: Number.isFinite(usdCap) && usdCap > 0 ? usdCap : undefined,
      maxTokens: Number.isFinite(tokenCap) && tokenCap > 0 ? tokenCap : undefined
    })
    try {
      const turnId = randomUUID()
      const result = await os.runTask(guardString(task, 'task'), (step) => {
        persistOrchestrationStep(
          step,
          {
            conversationId,
            turnId,
            iteration: step.step === 'exec' ? 0 : 1
          },
          undefined,
          causalTrace
        )
        ledger.append({
          source: 'orchestrate',
          name: step.step,
          detail: `${step.role ?? ''} ${step.provider ?? ''} ${step.detail ?? ''}`.trim()
        })
        // Chantier 3 — trace native : capture l'envelope réel (system porte le RAG Brain + contexte).
        if (step.prompt) {
          appendNativeTrace({
            provider: step.prompt.provider,
            model: step.prompt.model,
            conversationId,
            turnId,
            system: step.prompt.system,
            messages: step.prompt.messages,
            timestamp: new Date().toISOString()
          })
        }
        event.sender.send('orchestrate:step', step)
        // #3 — au franchissement du seuil : couper le run + prévenir l'utilisateur immédiatement.
        const trip = breaker.observe(step)
        if (trip) {
          controller.abort()
          try {
            if (Notification.isSupported()) {
              new Notification({
                title: 'Autowin OS — run stoppé (budget)',
                body: `Run coupé : ${trip.reason}.`
              }).show()
            }
          } catch {
            /* notif best-effort : ne jamais casser le run à cause d'un échec de notification */
          }
        }
      }, undefined, undefined, controller.signal)
      // Trace Brain (observabilité Observatory) : requête réelle + navigation interne + injecté.
      if (result.brainNavigation || (result.brainInjectedChars ?? 0) > 0) {
        appendBrainTrace({
          timestamp: new Date().toISOString(),
          conversationId,
          query: result.brainQuery ?? '',
          injectedChars: result.brainInjectedChars ?? 0,
          navigation: result.brainNavigation
        })
      }
      return { ok: true, result }
    } catch (e) {
      const aborted = controller.signal.aborted
      return {
        ok: false,
        error: aborted ? 'Run annulé' : e instanceof Error ? e.message : String(e),
        aborted
      }
    } finally {
      bus.clearOrchestration(conversationId, controller)
    }
  })

  // --- Config par rôle (orchestrateur / sous-agent / juge / scout) ---
  // #5 — le wizard first-run re-vérifie la config à la demande. `force` (bouton) ignore le cache TTL ;
  // sans force (montage) le cache déduplique avec le run de démarrage.
  ipcMain.handle('os:behaviourComposition', (event) => {
    assertTrustedRendererSender(event, 'Behaviour composition')
    return buildBehaviourComposition(os.roles)
  })
  ipcMain.handle('os:brainTraces', (event, conversationId?: unknown) => {
    assertTrustedRendererSender(event, 'Brain traces')
    return readBrainTraces(
      typeof conversationId === 'string' ? guardString(conversationId, 'conversationId') : undefined
    )
  })
  ipcMain.handle('preflight:recheck', (_e, force?: boolean) => runAppPreflight(force === true))
  ipcMain.handle('os:roles', () => os.roles.all())
  ipcMain.handle(
    'os:setRole',
    (_e, role: Role, provider: string, model?: string, reasoningEffort?: string) => {
      const binding = os.setRole(role, {
        provider,
        model,
        reasoningEffort: reasoningEffort as ReasoningEffort | undefined
      })
      broadcast({ type: 'refresh', scope: 'roles' })
      return binding
    }
  )
  ipcMain.handle('os:models:list', () => agentModelsReady)
  ipcMain.handle('os:profiles:list', () => profiles.list())
  ipcMain.handle('os:profiles:save', async (_event, profile: AutowinProfile) => {
    await agentModelsReady
    const safe = {
      ...profile,
      topology: agentTopology,
      roles: os.roles.all(),
      transport: (() => {
        const state = omniRouteMigration.load()
        return { mode: 'omniroute' as const, routeModel: state.routeModel }
      })(),
      updatedAt: new Date().toISOString()
    }
    return profiles.save(safe)
  })
  ipcMain.handle('os:profiles:apply', async (_event, id: string) => {
    await agentModelsReady
    const profile = profiles.list().find((item) => item.id === guardString(id, 'profile.id'))
    if (!profile) throw new Error('Profil introuvable')
    const validatedRoute = resolveProfileRoute(
      profile.transport,
      omniRouteMigration.load().routeModel
    )
    const models = await discoverOmniRouteModels(fetch, os.omniRouteCredentialStore)
    if (!models.some((model) => model.model === validatedRoute))
      throw new Error('Route OmniRoute du profil indisponible')
    // Rétrocompat : un profil sauvegardé AVANT le bloc `frame` n'a pas `panels.frame` → on migre
    // la forme avant validation (sinon assertTopology jetterait « Profil introuvable/incohérent »).
    agentTopology = saveAgentTopology(
      agentTopologyPath,
      migrateTopologyShape(profile.topology) as AgentTopology,
      agentModels
    )
    syncRuntimeTopology(agentTopology)
    for (const [role, binding] of Object.entries(profile.roles) as Array<
      [Role, import('./roles').RoleBinding]
    >)
      os.setRole(role, binding)
    const migratedState = omniRouteMigration.activate(validatedRoute)
    os.registry.setConversationTransport({
      provider: 'omniroute',
      model: validatedRoute,
      reasoningEffort: migratedState.reasoningEffort
    })
    broadcast({ type: 'refresh', scope: 'roles' })
    return profile
  })
  ipcMain.handle('os:topology:get', async () => {
    await agentModelsReady
    return agentTopology
  })
  ipcMain.handle('os:topology:set', async (_event, topology: AgentTopology) => {
    await agentModelsReady
    guardString(JSON.stringify(topology), 'topology')
    agentTopology = saveAgentTopology(agentTopologyPath, topology, agentModels)
    syncRuntimeTopology(agentTopology)
    broadcast({ type: 'refresh', scope: 'roles' })
    return agentTopology
  })

  // --- Contrôles de capacités : inventaire + mutations bornées ---
  ipcMain.handle(
    'os:capabilities:list',
    (event, kind: 'skills' | 'hooks' | 'tools' | 'plugins') => {
      assertTrustedRendererSender(event, 'Capabilities')
      if (!['skills', 'hooks', 'tools', 'plugins'].includes(kind))
        throw new Error('Vue de capacités inconnue')
      return listCapabilities(kind)
    }
  )
  ipcMain.handle('os:capabilities:tools:select', async (event, names: unknown) => {
    assertTrustedRendererSender(event, 'Capabilities')
    if (!Array.isArray(names) || !names.every((name) => typeof name === 'string'))
      throw new Error('Sélection de toolsets invalide')
    const before = await listCapabilities('tools')
    const result = await setCapabilitySelection('tools', names)
    const change = promptConfigChange('tools', before, result.items)
    appendPromptConfigActivity('Prompt Load · preset tools', change)
    if (bus.activeConversationId) {
      appendConvActivity(bus.activeConversationId, {
        kind: 'configuration-change',
        label: 'Prompt Load · preset tools',
        text: JSON.stringify(change)
      })
    }
    broadcast({ type: 'refresh', scope: 'workflows' })
    return result
  })
  ipcMain.handle('os:capabilities:plugins:set', async (event, name: string, enabled: unknown) => {
    assertTrustedRendererSender(event, 'Capabilities')
    const before = await listCapabilities('plugins')
    const result = await setCapabilityEnabled(
      'plugins',
      guardString(name, 'plugin'),
      guardBoolean(enabled, 'plugin.enabled')
    )
    const change = promptConfigChange('plugins', before, result.items)
    appendPromptConfigActivity(`Prompt Load · plugin ${name}`, change)
    if (bus.activeConversationId) {
      appendConvActivity(bus.activeConversationId, {
        kind: 'configuration-change',
        label: `Prompt Load · plugin ${name}`,
        text: JSON.stringify(change)
      })
    }
    broadcast({ type: 'refresh', scope: 'workflows' })
    return result
  })
  ipcMain.handle('claude:hooks:list', () => listClaudeHooks())
  ipcMain.handle('codex:hooks:list', () => listCodexHooks())
  ipcMain.handle('os:capabilities:tools:set', async (event, name: string, enabled: unknown) => {
    assertTrustedRendererSender(event, 'Capabilities')
    const before = await listCapabilities('tools')
    const result = await setCapabilityEnabled(
      'tools',
      guardString(name, 'toolset'),
      guardBoolean(enabled, 'toolset.enabled')
    )
    const change = promptConfigChange('tools', before, result.items)
    appendPromptConfigActivity(`Prompt Load · toolset ${name}`, change)
    if (bus.activeConversationId) {
      appendConvActivity(bus.activeConversationId, {
        kind: 'configuration-change',
        label: `Prompt Load · toolset ${name}`,
        text: JSON.stringify(change)
      })
    }
    broadcast({ type: 'refresh', scope: 'workflows' })
    return result
  })
  ipcMain.handle('os:behaviour:workspace', (event) => {
    assertTrustedBehaviourSender(event)
    return defaultBehaviourRoot
  })
  ipcMain.handle('os:behaviour:choose-workspace', async (event) => {
    assertTrustedBehaviourSender(event)
    if (headlessTestInstance) return null
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    const selected = result.canceled ? null : (result.filePaths[0] ?? null)
    return selected ? behaviourAccess.approve(selected) : null
  })
  ipcMain.handle('os:behaviour:contexts', (event, workspaceRoot: string) => {
    assertTrustedBehaviourSender(event)
    const workspace = approvedBehaviourWorkspace(workspaceRoot)
    return listBehaviourContexts({ workspaceRoot: workspace, contextRoot: workspace })
  })
  ipcMain.handle('os:behaviour:list', (event, workspaceRoot?: string, contextRoot?: string) => {
    assertTrustedBehaviourSender(event)
    const workspace = approvedBehaviourWorkspace(workspaceRoot)
    const activeContext = contextRoot
      ? guardString(contextRoot, 'behaviour.contextRoot')
      : workspace
    return behaviourManifest(workspace, activeContext)
  })
  ipcMain.handle(
    'os:behaviour:read',
    (event, id: string, workspaceRoot?: string, contextRoot?: string) => {
      assertTrustedBehaviourSender(event)
      const workspace = approvedBehaviourWorkspace(workspaceRoot)
      return readBehaviourFile(guardString(id, 'behaviour.id'), {
        workspaceRoot: workspace,
        contextRoot: contextRoot ? guardString(contextRoot, 'behaviour.contextRoot') : workspace
      })
    }
  )
  ipcMain.handle(
    'os:behaviour:proof',
    async (event, workspaceRoot?: string, contextRoot?: string) => {
      assertTrustedBehaviourSender(event)
      const workspace = approvedBehaviourWorkspace(workspaceRoot)
      const query = {
        workspaceRoot: workspace,
        contextRoot: contextRoot ? guardString(contextRoot, 'behaviour.contextRoot') : workspace
      }
      const files = await behaviourManifest(query.workspaceRoot, query.contextRoot)
      const contents = new Map<string, string>()
      const allowedRoots = [
        workspace,
        join(app.getPath('home'), '.codex'),
        join(app.getPath('home'), '.claude')
      ]
      for (const file of files) {
        if (file.engine !== 'autowin' || file.scope === 'skill') continue
        try {
          contents.set(file.id, readBoundedUtf8FileWithin(file.path, allowedRoots, 512_000))
        } catch {
          /* non prouvable */
        }
      }
      return proveInjections(files, contents, loadNativeTraces())
    }
  )
  ipcMain.handle('os:loop:run', (event, input: LoopRunInput) => {
    assertTrustedRendererSender(event, 'Loop')
    const events: import('./loop-runner').LoopEvent[] = []
    const startedAt = new Date().toISOString()
    return runSkillLoop(
      input,
      os.registry,
      os.roles.getBinding('orchestrator').provider,
      (loopEvent) => {
        events.push(loopEvent)
        event.sender.send('os:loop:event', loopEvent)
      },
      (question, context) => askModelQuestion(event.sender, 'loop', question, context)
    ).then((result) => {
      loopRuns.save({ ...result, startedAt, finishedAt: new Date().toISOString(), input, events })
      return result
    })
  })
  ipcMain.handle('os:loop:skills', (event) => {
    assertTrustedRendererSender(event, 'Loop')
    return listLoopSkills()
  })
  ipcMain.handle('os:loop:generate', async (event, objective: unknown) => {
    assertTrustedRendererSender(event, 'Loop')
    const goal = guardString(objective, 'loop.objective').trim()
    if (!goal) throw new Error('Objectif requis.')
    const skills = await listLoopSkills()
    const binding = os.roles.getBinding('orchestrator')
    const response = await os.registry.send(binding.provider, [{ role: 'user', content: goal }], {
      model: binding.model,
      reasoningEffort: binding.reasoningEffort,
      system: `Tu es le planificateur de Loop Builder. Propose un workflow SPECIFIQUE a l'objectif utilisateur. Reponds UNIQUEMENT avec du JSON valide : {"steps":[{"id":"","skill":"","capabilities":[],"prompt":""}],"passes":1,"stopOnFailure":true,"carryOutput":true}. Catalogue autorise (id | role | description) : ${skills.map((skill) => `${skill.id} | ${skill.role} | ${skill.description}`).join(' ; ')}. Une skill est un mecanisme interne : ne decris jamais son fonctionnement dans prompt. Chaque prompt decrit une action concrete, un livrable mesurable et ses contraintes. Les skills role=capability vont dans capabilities sur la tache qui les utilise, jamais dans une etape artificielle. Les skills role=gate sont les validations finales. Si build est utilise, ajoute clean puis judge. Interdit : "cadre le besoin", "prepare le terrain", "execute le travail", "audite le resultat". Choisis seulement les skills necessaires; un workflow peut avoir 1 a 8 etapes.`
    })
    return parseGeneratedLoop(response.text, new Set(skills.map((skill) => skill.id)))
  })
  ipcMain.handle('os:loop:runs', (event) => {
    assertTrustedRendererSender(event, 'Loop')
    return loopRuns.list()
  })
  ipcMain.handle('model:question:answer', (event, id: string, answer: unknown) => {
    const safeId = guardString(id, 'modelQuestion.id')
    const win = questionWindows.get(safeId)
    if (!win || win.webContents.id !== event.sender.id)
      throw new Error('Fenêtre de question invalide')
    modelQuestions.resolve(safeId, answer)
    questionWindows.delete(safeId)
    win.flashFrame(false)
    setImmediate(() => win.close())
    return { ok: true }
  })

  // --- Dashboards : données RÉELLES (plus de démo) ---
  ipcMain.handle('os:budget', () => os.budget())
  ipcMain.handle('os:costByRole', () => os.costByRole())
  ipcMain.handle('os:trustRanking', () => os.trustRanking())
  ipcMain.handle('os:runsWithGate', () => os.runsWithGate())
  // Usage RÉEL des outils (actions Codex/Claude observées) — distinct du catalogue natif décoratif.
  ipcMain.handle('os:toolUsage', () => aggregateToolUsage())
  ipcMain.handle('os:kaizen', (_e, jsonl: string) => os.kaizenPatterns(guardString(jsonl, 'jsonl')))

  // --- Sas d'autorité (décisions AFK ouvertes par l'orchestrateur) ---
  ipcMain.handle('os:authority:pending', () => os.authority.pending())
  ipcMain.handle('os:authority:resolve', (_e, id: string, choice: unknown) =>
    bus.resolveDecision(id, choice)
  )
  ipcMain.handle('os:authority:sweep', () => bus.sweepExpired())

  // --- Conversations catégorisées ---
  ipcMain.handle('os:conversations', () => os.conversations.list())
  ipcMain.handle(
    'os:conversations:create',
    (_e, p: { title: string; category: string; provider: string }) => os.conversations.create(p)
  )
  ipcMain.handle('os:conversations:rename', (_e, id: string, title: string) =>
    os.conversations.rename(id, guardString(title, 'title'))
  )
  ipcMain.handle('os:conversations:authorityMode', (event, rawId: string, rawMode: unknown) => {
    assertTrustedRendererSender(event, 'Conversation authority')
    const id = guardString(rawId, 'id')
    if (!['plan', 'ask', 'auto'].includes(String(rawMode))) {
      throw new Error('Mode d’autorité invalide')
    }
    return os.conversations.setAuthorityMode(id, rawMode as 'plan' | 'ask' | 'auto')
  })
  ipcMain.handle('os:conversations:fork', (event, rawId: string, rawMessageId: string) => {
    assertTrustedRendererSender(event, 'Conversation fork')
    return os.conversations.fork(guardString(rawId, 'id'), guardString(rawMessageId, 'messageId'))
  })
  ipcMain.handle('os:conversations:switchBranch', (event, rawId: string, rawBranchId: string) => {
    assertTrustedRendererSender(event, 'Conversation branch')
    return os.conversations.switchBranch(
      guardString(rawId, 'id'),
      guardString(rawBranchId, 'branchId')
    )
  })
  ipcMain.handle('os:conversations:remove', async (_e, rawId: string) => {
    const id = guardString(rawId, 'id')
    await activeChatTurns.abortAndWait(id, 'conversation-deleted')
    const removed = os.conversations.remove(id)
    if (removed) {
      causalTrace.deleteConversation(id)
      deletePromptCalls(id)
    }
    return removed
  })

  // --- Graphe brain 3D (données réelles disque) + workflow ---
  ipcMain.handle('os:listBrains', () => brainWorker.request('listBrains'))
  ipcMain.handle('os:loadBrainGraphPreview', (_e, path: string, lod?: number) =>
    brainWorker.request('loadPreview', guardString(path, 'path'), lod)
  )
  ipcMain.handle('os:loadBrainThemes', (_e, path: string) =>
    brainWorker.request('loadThemes', guardString(path, 'path'))
  )
  ipcMain.handle('os:loadBrainThemeNodes', (_e, path: string, rawThemeIds: unknown) => {
    if (!Array.isArray(rawThemeIds) || rawThemeIds.length > 100)
      throw new Error('IPC themeIds: tableau borné attendu')
    const themeIds = rawThemeIds.map((themeId, index) => guardString(themeId, `themeIds[${index}]`))
    return brainWorker.request('loadThemeNodes', guardString(path, 'path'), themeIds)
  })
  ipcMain.handle('os:loadBrainGraph', (_e, path: string, lod?: number, community?: number) =>
    brainWorker.request('loadGraph', guardString(path, 'path'), lod, community)
  )
  ipcMain.handle('os:loadBrainNeighborhood', (_e, path: string, nodeId: string) =>
    brainWorker.request(
      'loadNeighborhood',
      guardString(path, 'path'),
      guardString(nodeId, 'nodeId')
    )
  )
  ipcMain.handle('os:readNodeFile', (_e, path: string) =>
    brainWorker.request('readNodeFile', guardString(path, 'path'))
  )
  ipcMain.handle('os:searchBrain', (_e, path: string, query: string) =>
    brainWorker.request('searchBrain', guardString(path, 'path'), guardString(query, 'query'))
  )
  ipcMain.handle('os:listRuns', () => os.listRuns())
  // --- Harnais : projection lecture seule, bornée, SANS chemin ni mutation ---
  ipcMain.handle('os:harness:snapshot', () => os.harnessSnapshot())
  // Ouvre le dossier contenant un fichier dans l'explorateur (vue Workflow).
  ipcMain.handle('os:openFolder', (_e, path: string) => {
    shell.showItemInFolder(guardString(path, 'path'))
  })

  // --- Plan de contrôle : l'app pilotable par les agents ---
  ipcMain.handle('os:appState', () => bus.snapshot())
  ipcMain.handle('os:appCatalog', () => bus.catalog())
  ipcMain.handle('os:appCommand', (_e, name: string, args?: Record<string, unknown>) =>
    bus.exec(guardString(name, 'name'), args)
  )
  // Pilotage in-model : un agent conduit l'app, ses actions streamées au renderer.
  ipcMain.handle('os:pilot', async (event, goal: string) => {
    try {
      await pilot.run(guardString(goal, 'goal'), (e) => event.sender.send('pilot:event', e))
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  // Chat transparent : l'agent converse ET pilote l'app dans le même tour.
  // conversationId (optionnel) → le tour est PERSISTÉ dans la conversation (fil rechargeable).
  ipcMain.handle(
    'os:pilotChat',
    async (
      event,
      messages: Array<{
        role: 'user' | 'assistant'
        content: string
        attachments?: Message['attachments']
      }>,
      conversationId?: string
    ) => {
      const controller = new AbortController()
      let resolveCompletion!: () => void
      const completion = new Promise<void>((resolve) => {
        resolveCompletion = resolve
      })
      const turnId = randomUUID()
      if (conversationId) activeChatTurns.set(conversationId, controller, completion)
      try {
        const safe = (Array.isArray(messages) ? messages : []).slice(-40).map((m) => ({
          role: m.role,
          content: guardString(m.content, 'content'),
          ...(m.attachments?.length ? { attachments: guardAttachments(m.attachments) } : {})
        }))
        const spoken: string[] = []
        let streamedSpoken = ''
        let traceParentId: string | undefined
        let traceSequence = conversationId ? causalTrace.nextSequence(conversationId) : 0
        let traceActionIndex = 0
        let turnUsage: { inputTokens: number; outputTokens: number; costUsd?: number } | undefined
        let turnSessionId: string | undefined
        let turnPromptIdentity:
          | { provider: string; model?: string; reasoningEffort?: string }
          | undefined
        const last = safe[safe.length - 1]
        if (conversationId && last?.role === 'user' && os.conversations.get(conversationId)) {
          const binding = os.roles.getBinding('orchestrator')
          os.conversations.beginTurn(
            conversationId,
            {
              content: last.content,
              attachments: last.attachments?.map(({ name, mimeType, size, thumbnail }) => ({
                name,
                mimeType,
                size,
                ...(thumbnail && { thumbnail })
              }))
            },
            {
              turnId,
              runtime: {
                provider: binding.provider,
                model: binding.model,
                reasoningEffort: binding.reasoningEffort
              }
            }
          )
        }
        const applyDurableEvent = (pilotEvent: PilotEvent): void => {
          if (!conversationId || !os.conversations.get(conversationId)) return
          let durableEvent: ChatTurnEvent | undefined
          if (pilotEvent.kind === 'delta' && pilotEvent.text && pilotEvent.streamId)
            durableEvent = {
              kind: 'delta',
              streamId: pilotEvent.streamId,
              text: pilotEvent.text
            }
          else if (pilotEvent.kind === 'stream-reset' && pilotEvent.streamId)
            durableEvent = { kind: 'stream-reset', streamId: pilotEvent.streamId }
          else if (pilotEvent.kind === 'think' && pilotEvent.text)
            durableEvent = {
              kind: 'delta',
              streamId: `fallback:${pilotEvent.iteration ?? 0}`,
              text: pilotEvent.text
            }
          else if (pilotEvent.kind === 'command' && pilotEvent.name)
            durableEvent = {
              kind: 'command',
              actionId: pilotEvent.actionId ?? `${pilotEvent.iteration ?? 0}:${traceActionIndex}`,
              name: pilotEvent.name,
              args: pilotEvent.args
            }
          else if (pilotEvent.kind === 'result' && pilotEvent.name)
            durableEvent = {
              kind: 'result',
              actionId:
                pilotEvent.actionId ??
                `${pilotEvent.iteration ?? 0}:${Math.max(0, traceActionIndex - 1)}`,
              name: pilotEvent.name,
              ok: pilotEvent.ok,
              data: pilotEvent.data
            }
          else if (pilotEvent.kind === 'done')
            durableEvent = { kind: 'done', sessionId: turnSessionId }
          else if (pilotEvent.kind === 'cancellation') durableEvent = { kind: 'cancelled' }
          if (durableEvent) os.conversations.applyTurnEvent(conversationId, turnId, durableEvent)
        }
        const handlePilotEvent = (pilotEvent: PilotEvent): void => {
          if (pilotEvent.kind === 'delta' && pilotEvent.text) streamedSpoken += pilotEvent.text
          if (pilotEvent.kind === 'think' && pilotEvent.text) spoken.push(pilotEvent.text)
          if (pilotEvent.kind === 'command' && pilotEvent.name)
            spoken.push(`[a exécuté ${pilotEvent.name}]`)
          if (pilotEvent.kind === 'done' && pilotEvent.usage) turnUsage = pilotEvent.usage
          if (pilotEvent.kind === 'prompt-call' && pilotEvent.sessionId)
            turnSessionId = pilotEvent.sessionId
          if (pilotEvent.kind === 'prompt-call' && pilotEvent.prompt) {
            const reasoningEffort = pilotEvent.prompt.options.reasoningEffort
            turnPromptIdentity ??= {
              provider: pilotEvent.prompt.provider,
              model: pilotEvent.prompt.model,
              reasoningEffort: typeof reasoningEffort === 'string' ? reasoningEffort : undefined
            }
          }
          applyDurableEvent(pilotEvent)
          if (conversationId && pilotEvent.kind === 'prompt-call' && pilotEvent.prompt) {
            const promptCall = appendPromptCall({
              conversationId,
              turnId,
              iteration: pilotEvent.iteration ?? 0,
              actor: 'orchestrator',
              provider: pilotEvent.prompt.provider,
              model: pilotEvent.prompt.model,
              transport: pilotEvent.prompt.transport,
              boundary: 'Autowin OS -> provider adapter',
              limitation: pilotEvent.prompt.limitation,
              system: pilotEvent.prompt.system,
              messages: pilotEvent.prompt.messages,
              options: pilotEvent.prompt.options,
              response: pilotEvent.response ?? '',
              status: pilotEvent.status,
              error: pilotEvent.error,
              usage: pilotEvent.callUsage,
              durationMs: pilotEvent.callDurationMs,
              sessionId: pilotEvent.sessionId
            })
            const promptTraceEvents = promptCallToTraceEvents(
              promptCall,
              traceSequence,
              traceParentId
            )
            for (const traceEvent of promptTraceEvents) causalTrace.append(traceEvent)
            traceParentId = `${promptCall.id}:3`
            traceSequence += promptTraceEvents.length
            traceActionIndex = 0
          }
          if (
            conversationId &&
            (pilotEvent.kind === 'command' ||
              pilotEvent.kind === 'result' ||
              pilotEvent.kind === 'error' ||
              pilotEvent.kind === 'retry' ||
              pilotEvent.kind === 'cancellation')
          ) {
            const actionSequence = traceActionIndex++
            const stableActionId = pilotEvent.actionId?.replaceAll(':', '-') ?? `${actionSequence}`
            const action = pilotActionToTraceEvent({
              id: `${turnId}:action:${stableActionId}:${pilotEvent.kind}`,
              conversationId,
              turnId,
              parentId: traceParentId,
              timestamp: new Date().toISOString(),
              sequence: traceSequence++,
              kind: pilotEvent.kind,
              name: pilotEvent.name,
              data:
                pilotEvent.kind === 'command'
                  ? pilotEvent.args
                  : (pilotEvent.data ?? pilotEvent.text),
              ok: pilotEvent.ok
            })
            causalTrace.append(action)
            traceParentId = action.id
          }
          event.sender.send('pilot:event', { ...pilotEvent, conversationId, turnId })
        }
        const delayedPilotFixture =
          isolatedTestInstance &&
          safe.at(-1)?.content.startsWith('[[autowin-fixture-delayed-pilot]]')
        const durableStreamPrefix = '[[autowin-fixture-durable-stream]]'
        const durableStreamFixture =
          isolatedTestInstance && safe.at(-1)?.content.startsWith(durableStreamPrefix)
        if (durableStreamFixture) {
          const target = safe.at(-1)?.content.slice(durableStreamPrefix.length).trim() || 'fixture'
          let fixtureCall = 0
          const fixtureProvider: ProviderAdapter = {
            id: 'autowin-durable-fixture',
            auth: async () => true,
            async *send(): AsyncGenerator<StreamChunk, SendResult, void> {
              fixtureCall += 1
              if (fixtureCall > 1) {
                return {
                  text: '',
                  provider: 'autowin-durable-fixture',
                  systemInjected: true
                }
              }
              const chunks = [
                'Je ',
                'réponds ',
                'progressivement.',
                '<cm',
                `d>{"name":"get_state","args":{"target":${JSON.stringify(target)},"token":"fixture-secret"}}</cmd>`,
                ' Terminé.'
              ]
              for (const delta of chunks) {
                yield { delta }
                if (!delta.startsWith('<') && !delta.startsWith('d>'))
                  await new Promise((resolve) => setTimeout(resolve, 120))
              }
              return {
                text: chunks.join(''),
                provider: 'autowin-durable-fixture',
                systemInjected: true
              }
            }
          }
          const fixtureRegistry = new ProviderRegistry().register(fixtureProvider)
          const fixtureRoles = new RoleModelConfig({
            orchestrator: { provider: fixtureProvider.id, model: 'deterministic-fixture' }
          })
          const fixtureBus = {
            catalog: () => bus.catalog(),
            snapshot: () => bus.snapshot(),
            exec: async (name: string, args: Record<string, unknown>) =>
              name === 'get_state'
                ? { ok: true, data: { source: 'durable-fixture', target: args.target } }
                : bus.exec(name, args, conversationId)
          } as AppCommandBus
          await new AgentPilot(fixtureRegistry, fixtureRoles, fixtureBus).chat(
            safe,
            handlePilotEvent,
            undefined,
            6,
            conversationId,
            controller.signal,
            conversationId ? (os.conversations.get(conversationId)?.authorityMode ?? 'ask') : 'ask'
          )
        } else if (delayedPilotFixture) {
          await new Promise<void>((resolve, reject) => {
            const finish = (): void => {
              controller.signal.removeEventListener('abort', cancel)
              resolve()
            }
            const cancel = (): void => {
              clearTimeout(timeout)
              reject(new Error('aborted'))
            }
            const timeout = setTimeout(finish, 600)
            if (controller.signal.aborted) cancel()
            else controller.signal.addEventListener('abort', cancel, { once: true })
          })
          const fixtureEvents = [
            { kind: 'think', text: 'événement tardif correctement routé' },
            { kind: 'command', name: 'get_state', args: { target: 'late-conversation' } },
            { kind: 'result', name: 'get_state', ok: true, data: { source: 'isolated' } },
            { kind: 'command', name: 'navigate', args: { tab: 'memory' } },
            { kind: 'result', name: 'navigate', ok: true, data: { activeTab: 'memory' } },
            { kind: 'done', text: 'fixture pilot terminée' }
          ]
          for (const fixtureEvent of fixtureEvents) handlePilotEvent(fixtureEvent as PilotEvent)
        } else
          await pilot.chat(
            safe,
            handlePilotEvent,
            (question) =>
              askModelQuestion(event.sender, 'chat', question, 'Chat', controller.signal),
            6,
            conversationId,
            controller.signal,
            conversationId ? (os.conversations.get(conversationId)?.authorityMode ?? 'ask') : 'ask',
            conversationId ? () => drainPendingDirectives(conversationId) : undefined
          )
        // Journal d'activité de la conversation : le tour de chat, avec son coût en tokens.
        if (conversationId) {
          const last = safe[safe.length - 1]
          const conversationRoute = os.registry.getConversationTransport()
          appendConvActivity(conversationId, {
            kind: 'chat',
            label: last?.role === 'user' ? last.content : 'tour agent',
            provider: turnPromptIdentity?.provider ?? conversationRoute?.provider ?? 'omniroute',
            model: turnPromptIdentity?.model ?? conversationRoute?.model,
            reasoningEffort:
              turnPromptIdentity?.reasoningEffort ?? conversationRoute?.reasoningEffort,
            inputTokens: turnUsage?.inputTokens,
            outputTokens: turnUsage?.outputTokens,
            costUsd: turnUsage?.costUsd,
            text: (streamedSpoken || spoken.join('\n')).slice(0, 600)
          })
        }
        broadcast({ type: 'refresh', scope: 'workflows' })
        return { ok: true, cancelled: false }
      } catch (e) {
        if (conversationId && os.conversations.get(conversationId)) {
          os.conversations.applyTurnEvent(
            conversationId,
            turnId,
            controller.signal.aborted
              ? { kind: 'cancelled' }
              : { kind: 'failed', error: e instanceof Error ? e.message : String(e) }
          )
        }
        broadcast({ type: 'refresh', scope: 'workflows' })
        if (controller.signal.aborted) return { ok: true, cancelled: true }
        return { ok: false, cancelled: false, error: e instanceof Error ? e.message : String(e) }
      } finally {
        if (conversationId) {
          activeChatTurns.delete(conversationId, controller)
          if (pendingDirectives.delete(conversationId)) // directives non consommées = obsolètes
            broadcast({ type: 'refresh', scope: 'directives' })
        }
        resolveCompletion()
      }
    }
  )
  ipcMain.handle('os:pilotChat:cancel', (_e, rawConversationId: string) => {
    const conversationId = guardString(rawConversationId, 'conversationId')
    // Stoppe le tour pilote ET le sous-agent en vol rattaché à cette conversation.
    const orchestrationAborted = bus.abortOrchestration(conversationId)
    const pilotAborted = activeChatTurns.abort(conversationId, 'user')
    return { ok: pilotAborted || orchestrationAborted }
  })
  ipcMain.handle('os:orchestrate:cancel', (_e, rawConversationId: string) => {
    const conversationId = guardString(rawConversationId, 'conversationId')
    return { ok: bus.abortOrchestration(conversationId) }
  })
  // Injection LIVE : une directive envoyée pendant un tour atteint la boucle pilote
  // au prochain point d'itération (pilotage continu, sans attendre la fin du tour).
  ipcMain.handle('os:pilotChat:inject', (_e, rawConversationId: string, rawDirective: string) => {
    const conversationId = guardString(rawConversationId, 'conversationId')
    const directive = guardString(rawDirective, 'directive').trim()
    if (!directive) return { ok: false }
    const queued = pendingDirectives.get(conversationId) ?? []
    queued.push(directive)
    pendingDirectives.set(conversationId, queued)
    broadcast({ type: 'refresh', scope: 'directives' })
    return { ok: true }
  })
  // Lire la file d'attente (directives non encore consommées) d'une conversation.
  ipcMain.handle('os:pilotChat:pending', (_e, rawConversationId: string) => {
    const conversationId = guardString(rawConversationId, 'conversationId')
    return [...(pendingDirectives.get(conversationId) ?? [])]
  })
  // Retirer une directive en attente par index (avant qu'elle soit consommée).
  ipcMain.handle('os:pilotChat:removeDirective', (_e, rawConversationId: string, rawIndex: unknown) => {
    const conversationId = guardString(rawConversationId, 'conversationId')
    const index = Number(rawIndex)
    const queued = pendingDirectives.get(conversationId)
    if (!queued || !Number.isInteger(index) || index < 0 || index >= queued.length)
      return { ok: false }
    queued.splice(index, 1)
    if (queued.length) pendingDirectives.set(conversationId, queued)
    else pendingDirectives.delete(conversationId)
    broadcast({ type: 'refresh', scope: 'directives' })
    return { ok: true }
  })
  ipcMain.handle(
    'os:causalTrace:displayed',
    (_e, rawConversationId: string, rawContent: string) => {
      const conversationId = guardString(rawConversationId, 'conversationId')
      const content = guardString(rawContent, 'content')
      const existing = causalTrace.readConversation(conversationId)
      const parentId = existing.at(-1)?.id
      const sequence = causalTrace.nextSequence(conversationId)
      const event = responseDisplayedTrace({
        conversationId,
        turnId: existing.at(-1)?.turnId ?? `${conversationId}:displayed`,
        parentId,
        sequence,
        content,
        timestamp: new Date().toISOString()
      })
      causalTrace.append(event)
      return { ok: true, eventId: event.id }
    }
  )

  // --- Workflows PAR CONVERSATION : créés par ses orchestrations + RUN.md attachés ---
  ipcMain.handle('os:conversationRuns', (_e, convId: string) => {
    const c = os.conversations.get(guardString(convId, 'convId'))
    return listConvRuns(convId, c?.runPaths ?? [])
  })
  // Fil des sous-agents d'un run (exec/juge/gate avec contenu), pour l'affichage détaillé.
  ipcMain.handle('os:runTrace', (_e, path: string) => loadConvRunTrace(guardString(path, 'path')))
  // L'UI signale la conversation active → les orchestrations lancées s'y rattachent.
  ipcMain.handle('os:setActiveConversation', (_e, convId: string | null) => {
    bus.activeConversationId = convId ?? undefined
    return { ok: true }
  })
  // Activité (scopée conversation) : timeline des étapes facturées + coût tokens.
  ipcMain.handle('os:conversationActivity', (_e, convId: string) =>
    loadConvActivity(guardString(convId, 'convId'))
  )
  ipcMain.handle('os:promptCalls', (_e, convId?: string) =>
    convId ? loadPromptCalls(guardString(convId, 'convId')) : loadAllPromptCalls()
  )
  const loadNativeTraces = (): ReturnType<typeof readNativePreflight> => {
    // Spool NATIF Autowin : les traces sont écrites par Autowin lui-même (native-trace-spool) →
    // l'Observatory (RAG/injection) se peuple sur les vraies requêtes de l'app. Plus aucun fallback
    // externe (spool externe retiré).
    return readNativePreflight(nativeSpoolRoot(), 100)
  }
  const migrateLegacyCausalTraces = (): void => {
    const nativePreflight = loadNativeTraces()
    for (const conversation of os.conversations.list()) {
      const conversationId = conversation.id
      const events = causalTrace.readConversation(conversationId)
      const knownIds = new Set(events.map((traceEvent) => traceEvent.id))
      let nextSequence = events.length
        ? Math.max(...events.map((traceEvent) => traceEvent.sequence)) + 1
        : 0
      const nativeCalls = loadPromptCalls(conversationId)
      for (const call of nativeCalls) {
        if (knownIds.has(`${call.id}:0`)) continue
        for (const traceEvent of promptCallToTraceEvents(call, nextSequence)) {
          causalTrace.append(traceEvent)
          knownIds.add(traceEvent.id)
          nextSequence = traceEvent.sequence + 1
        }
      }
      // Anti-double-frontière : une conversation avec des appels NATIFS Autowin (codex/claude)
      // porte déjà sa propre frontière par appel. Les préflight legacy dupliqueraient la
      // même frontière dans la timeline → on ne les fusionne QUE pour les convs sans natif
      // (aucun appel natif). La vue dédiée (os:promptTraces) reste inchangée.
      const preflightTraces = nativeCalls.length ? [] : filterNativePreflight(nativePreflight, conversationId)
      for (const trace of preflightTraces) {
        const id = `native:${trace.apiRequestId}`
        if (knownIds.has(id)) continue
        causalTrace.append({
          schema: 'autowin.trace/v1',
          id,
          conversationId,
          turnId: trace.turnId,
          timestamp: trace.timestamp,
          sequence: nextSequence++,
          type: 'boundary',
          status: 'completed',
          actor: { id: 'native', kind: 'hook', label: 'Trace préflight' },
          recipient: { id: trace.provider, kind: 'provider', label: trace.provider },
          channel: 'internal',
          payloads: [
            {
              kind: 'resource',
              name: 'Requête native',
              mediaType: 'application/json',
              content: JSON.stringify(trace.request)
            }
          ],
          observation: {
            boundary: trace.boundary,
            fidelity: 'exact',
            limitation: 'Secrets masqués avant persistance.'
          },
          provider: {
            id: trace.provider,
            model: trace.model,
            transport: trace.apiMode,
            sessionId: trace.sessionId
          }
        })
        knownIds.add(id)
      }
    }
  }
  migrateLegacyCausalTraces()
  const readNativePromptTraces = createNativePreflightReader(loadNativeTraces)
  ipcMain.handle('os:promptTraces', (event, conversationId: unknown) => {
    assertTrustedRendererSender(event, 'Native traces')
    const safeConversationId = guardString(conversationId, 'conversationId')
    return readNativePromptTraces(safeConversationId)
  })
  ipcMain.handle('os:promptTraceSummary', (event) => {
    assertTrustedRendererSender(event, 'Native trace summary')
    // La requête brute est volontairement exclue de ce résumé IPC.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    return loadNativeTraces().map(({ request: _request, ...metadata }) => metadata)
  })
  ipcMain.handle('os:authorizeDiagnostics', (event) => {
    assertTrustedRendererSender(event, 'Diagnostics authorization')
    if (headlessTestInstance) return null
    return diagnosticCapabilities.issue(event.sender.id)
  })
  ipcMain.handle('os:promptTracesGlobal', (event, token: unknown) => {
    assertTrustedRendererSender(event, 'Native global diagnostics')
    const safeToken = guardString(token, 'capability')
    if (!diagnosticCapabilities.consume(safeToken, event.sender.id)) {
      throw new Error('Diagnostics capability denied')
    }
    return filterNativePreflight(loadNativeTraces())
  })
  ipcMain.handle('os:causalTrace', (_e, convId: string) => {
    const conversationId = guardString(convId, 'convId')
    return causalTrace.readConversation(conversationId)
  })

  // --- Observatoire d'activité : transcripts Claude Code (lecture seule) + ledger in-app ---
  ipcMain.handle('os:activity:sessions', () => listSessions(60))
  ipcMain.handle('os:activity:session', async (_e, meta) => parseSession(meta))
  ipcMain.handle('os:activity:habits', () => aggregateHabits(20))
  ipcMain.handle('os:activity:ledger', () => ledger.recent(300))
  // Affichage des screenshots consultés : whitelist extensions + cap taille, lecture seule.
  ipcMain.handle('os:activity:image', async (_e, path: string) => {
    const p = guardString(path, 'path')
    if (!/\.(png|jpe?g|webp|gif|bmp)$/i.test(p)) throw new Error('extension non autorisée')
    const { statSync, readFileSync } = await import('node:fs')
    if (statSync(p).size > 8_000_000) throw new Error('image trop volumineuse')
    const ext = p.split('.').pop()!.toLowerCase()
    const mime =
      ext === 'png'
        ? 'image/png'
        : ext === 'webp'
          ? 'image/webp'
          : `image/${ext === 'jpg' ? 'jpeg' : ext}`
    return { dataUrl: `data:${mime};base64,${readFileSync(p).toString('base64')}` }
  })
}

function rendererLocation(): { devRendererUrl?: string; rendererHtmlPath: string } {
  return {
    devRendererUrl: is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined,
    rendererHtmlPath: join(__dirname, '../renderer/index.html')
  }
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    title: 'Autowin OS',
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#f5f7fb',
      height: 28
    },
    icon: process.env['AUTOWIN_OS_DEV'] === '1' ? devIcon : icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // sandbox:false requis par le preload @electron-toolkit ; contextIsolation
      // reste à true (défaut Electron) — affirmé ici pour éviter toute régression.
      contextIsolation: true,
      sandbox: false
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    // Allowlist : n'ouvre à l'extérieur QUE http/https (une réponse modèle peut
    // contenir un lien hostile file://, ms-*: … → jamais shell.openExternal dessus).
    try {
      const u = new URL(details.url)
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        shell.openExternal(details.url)
      }
    } catch {
      /* URL invalide — ignorée */
    }
    return { action: 'deny' }
  })

  const blockUntrustedNavigation = (event: { preventDefault(): void }, url: string): void => {
    if (!isTrustedRendererUrl(url, behaviourRendererOptions())) event.preventDefault()
  }
  mainWindow.webContents.on('will-navigate', blockUntrustedNavigation)
  mainWindow.webContents.on('will-redirect', blockUntrustedNavigation)

  mainWindow.on('ready-to-show', () => {
    presentAutomationWindow(mainWindow, headlessTestInstance, { maximize: true })
    setTimeout(() => void warmCapabilities(), 250)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// UNE seule instance : deux apps concurrentes sur le même conversations.json se marchent
// dessus (vécu : conv « disparue » car l'user regardait une 2e instance au main plus vieux).
// Un 2e lancement remet la fenêtre existante au premier plan.
if (!isolatedTestInstance && ownsInstanceLock) {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0]
    if (w) {
      if (w.isMinimized()) w.restore()
      w.focus()
    }
  })
}

// Filet de sécurité process-level (#1) : une promesse non-catchée ne doit PAS tuer tout le process
// (fenêtres + runs + persistance). On loggue et on survit. Branché AVANT whenReady.
installCrashHandlers({
  logDir: app.getPath('userData'),
  // Sur crash non catché, le finally du handler os:orchestrate ne tourne pas → couper les
  // orchestrations en vol pour ne pas laisser de controllers fantômes (cancel no-op sinon).
  onFatal: () => bus.abortAllOrchestrations()
})

// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  if (headlessTestInstance && process.argv.includes('--omniroute-keyring-smoke')) {
    const result = runOmniRouteKeyringSmoke()
    writeFileSync(
      join(app.getPath('userData'), 'omniroute-keyring-smoke.json'),
      JSON.stringify(result),
      {
        encoding: 'utf8',
        flag: 'wx'
      }
    )
    process.stdout.write(`${JSON.stringify(result)}\n`)
    app.quit()
    return
  }
  // Set app user model id for windows
  electronApp.setAppUserModelId(automationAppIdentity(AUTOWIN_APP_ID, automationInstanceMode))

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  let legacyStorageValues: MigratedRendererStorage = {}
  let canWriteMigrationMarker = isRendererStorageMigrationComplete(canonicalAppDataRoot)
  if (!explicitUserDataDir && !canWriteMigrationMarker) {
    startupStorageMigration = true
    try {
      const legacyRead = await readLegacyRendererStorage(
        legacyAppDataRoot(appDataRoot),
        rendererLocation()
      )
      legacyStorageValues = legacyRead.values
      canWriteMigrationMarker = legacyRead.status !== 'failed'
      if (legacyRead.status === 'failed') {
        console.warn(
          `[Autowin migration] legacy LocalStorage read failed at ${legacyRead.stage ?? 'unknown-stage'} (${legacyRead.errorCode ?? 'UNKNOWN'}); will retry on next application launch`
        )
      }
    } finally {
      startupStorageMigration = false
    }
  }
  registerStorageMigrationIpc(legacyStorageValues, canWriteMigrationMarker)
  registerChatIpc()
  createWindow()

  // #4 — diagnostic de démarrage (non bloquant) : on vérifie brain_server, CLI providers et token,
  // et on pousse le résultat au renderer (bannière) pour que l'utilisateur voie une config incomplète
  // AVANT de lancer un run, plutôt qu'un échec silencieux en plein run. Best-effort, jamais bloquant.
  void runAppPreflight()
    .then((result) => {
      if (!result.ok) {
        for (const w of BrowserWindow.getAllWindows()) w.webContents.send('preflight:result', result)
      }
    })
    .catch(() => {
      /* preflight best-effort : ne jamais casser le démarrage */
    })

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
// Flush forcé avant la fermeture : ne pas perdre le dernier fragment de streaming
// resté dans la fenêtre de debounce de 120 ms de la persistance.
app.on('before-quit', () => flushConversations())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !startupStorageMigration) {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
