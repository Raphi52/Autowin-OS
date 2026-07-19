import { app, shell, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import type { Message } from './providers/types'
import { AutowinOS } from './os'
import type { Role } from './roles'
import { AppCommandBus, type AppEvent } from './commands'
import { AgentPilot } from './agent-pilot'
import { TraceLedger } from './activity/ledger'
import { aggregateHabits, listSessions, parseSession } from './activity/transcripts'
import { persistConversations } from './store/conversations-disk'
import { listConvRuns, loadConvRunTrace } from './runs/conv-runs'
import { appendConvActivity, loadConvActivity } from './activity/conv-activity'
import {
  listHermesControls,
  setHermesPlugin,
  setHermesTool,
  setHermesToolSelection,
  warmHermesControls
} from './hermes-controls'
import {
  defaultBehaviourWorkspace,
  listBehaviourContexts,
  listBehaviourFiles,
  readBehaviourFile
} from './behaviour-files'
import { ApprovedBehaviourWorkspaces, isTrustedRendererUrl } from './behaviour-access'
import { runSkillLoop, type LoopRunInput } from './loop-runner'
import { listLoopSkills } from './loop-skills'
import { listClaudeHooks } from './claude-hooks'
import { ModelQuestionHub, type ModelQuestion, type PendingModelQuestion } from './model-questions'
import { DEFAULT_IMPORTED_MODELS, discoverImportedModels, findModel } from './models'
import { loadAgentTopology, saveAgentTopology } from './topology-disk'
import type { AgentTopology, SlotBinding } from './topology'
import {
  createAutowinAppDataRoot,
  ensureAutowinAppData,
  legacyAppDataRoot,
  resolveAutowinAppDataBase
} from './app-data'
import { AUTOWIN_APP_ID, AUTOWIN_DISPLAY_NAME } from '../shared/app-identity'
import {
  isRendererStorageMigrationComplete,
  markRendererStorageMigrationComplete,
  readLegacyRendererStorage,
  type MigratedRendererStorage
} from './renderer-storage-migration'
import { guardBoolean } from './ipc-guards'

const isolatedTestInstance =
  !app.isPackaged && process.env['AUTOWIN_ISOLATED_TEST_INSTANCE'] === '1'
const appDataRoot = resolveAutowinAppDataBase(app.getPath('appData'), app.isPackaged)
app.setName(AUTOWIN_DISPLAY_NAME)
const explicitUserDataDir = process.argv.some((argument) => argument.startsWith('--user-data-dir'))
const canonicalAppDataRoot = createAutowinAppDataRoot(appDataRoot)
if (!explicitUserDataDir) app.setPath('userData', canonicalAppDataRoot)
const ownsInstanceLock = isolatedTestInstance || app.requestSingleInstanceLock()
if (!ownsInstanceLock) app.quit()
else ensureAutowinAppData(appDataRoot)
let startupStorageMigration = false

/** Noyau applicatif unique (P0-P4 câblés) : kit SOUL injecté, 2 voies, modules. */
const os = new AutowinOS()
// Conversations persistées sur disque : rechargées au démarrage, sauvées à chaque mutation.
persistConversations(os.conversations)

/** Diffuse un événement d'app à toutes les fenêtres (UI live quand un agent pilote). */
function broadcast(e: AppEvent): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('app:event', e)
}
/** Bus de commandes (plan de contrôle) + pilote agent (tool-loop). */
const bus = new AppCommandBus(os, broadcast)
const pilot = new AgentPilot(os.registry, os.roles, bus)
const modelQuestions = new ModelQuestionHub()
const questionWindows = new Map<string, BrowserWindow>()
let agentModels = DEFAULT_IMPORTED_MODELS
const agentTopologyPath = join(app.getPath('userData'), 'agent-topology.json')
let agentTopology = loadAgentTopology(agentTopologyPath, agentModels)
const agentModelsReady = discoverImportedModels().then((models) => {
  agentModels = models
  agentTopology = loadAgentTopology(agentTopologyPath, agentModels)
  syncRuntimeTopology(agentTopology)
  return models
})

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
}

syncRuntimeTopology(agentTopology)

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
    win.show()
    win.focus()
    win.flashFrame(true)
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
  context?: string
): Promise<string> {
  return modelQuestions.ask(
    source,
    question,
    (pending) => openQuestionWindow(BrowserWindow.fromWebContents(sender), pending),
    context
  )
}
/** Ledger d'activité in-app : chaque action d'agent laisse une trace consultable. */
const ledger = new TraceLedger(join(app.getPath('userData'), 'trace'))
bus.trace = (name, args, ok) =>
  ledger.append({ source: 'bus', name, detail: JSON.stringify(args).slice(0, 200), ok })

/** Plafond de taille des payloads IPC (anti-DoS main process). */
const MAX_IPC_STRING = 2_000_000 // ~2 Mo
function guardString(s: unknown, name: string): string {
  if (typeof s !== 'string') throw new Error(`IPC ${name}: string attendue`)
  if (s.length > MAX_IPC_STRING) throw new Error(`IPC ${name}: payload trop volumineux`)
  return s
}
function guardMessages(m: unknown): Message[] {
  if (!Array.isArray(m)) throw new Error('IPC messages: tableau attendu')
  if (m.length > 1000) throw new Error('IPC messages: trop de messages')
  for (const x of m) guardString((x as Message)?.content, 'message.content')
  return m as Message[]
}

const defaultBehaviourRoot = defaultBehaviourWorkspace()
const behaviourAccess = new ApprovedBehaviourWorkspaces(defaultBehaviourRoot)

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
  ipcMain.handle('chat:providers', () => os.registry.ids())

  // --- Orchestration disciplinée (le cœur) : streame chaque étape ---
  ipcMain.handle('os:orchestrate', async (event, task: string) => {
    try {
      const result = await os.runTask(guardString(task, 'task'), (step) => {
        ledger.append({
          source: 'orchestrate',
          name: step.step,
          detail: `${step.role ?? ''} ${step.provider ?? ''} ${step.detail ?? ''}`.trim()
        })
        event.sender.send('orchestrate:step', step)
      })
      return { ok: true, result }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // --- Config par rôle (orchestrateur / sous-agent / juge / scout) ---
  ipcMain.handle('os:roles', () => os.roles.all())
  ipcMain.handle('os:setRole', (_e, role: Role, provider: string, model?: string) =>
    os.setRole(role, { provider, model })
  )
  ipcMain.handle('os:models:list', () => agentModelsReady)
  ipcMain.handle('os:topology:get', async () => {
    await agentModelsReady
    return agentTopology
  })
  ipcMain.handle('os:topology:set', async (_event, topology: AgentTopology) => {
    await agentModelsReady
    guardString(JSON.stringify(topology), 'topology')
    agentTopology = saveAgentTopology(agentTopologyPath, topology, agentModels)
    syncRuntimeTopology(agentTopology)
    return agentTopology
  })

  // --- Contrôles Hermes : inventaire prompt + mutations bornées ---
  ipcMain.handle(
    'hermes:controls:list',
    (event, kind: 'skills' | 'hooks' | 'tools' | 'plugins') => {
      assertTrustedRendererSender(event, 'Hermes')
      if (!['skills', 'hooks', 'tools', 'plugins'].includes(kind))
        throw new Error('Vue Hermes inconnue')
      return listHermesControls(kind)
    }
  )
  ipcMain.handle('hermes:tools:select', (event, names: unknown) => {
    assertTrustedRendererSender(event, 'Hermes')
    if (!Array.isArray(names) || !names.every((name) => typeof name === 'string'))
      throw new Error('Sélection de toolsets invalide')
    return setHermesToolSelection(names)
  })
  ipcMain.handle('hermes:plugins:set', (event, name: string, enabled: unknown) => {
    assertTrustedRendererSender(event, 'Hermes')
    return setHermesPlugin(guardString(name, 'plugin'), guardBoolean(enabled, 'plugin.enabled'))
  })
  ipcMain.handle('claude:hooks:list', () => listClaudeHooks())
  ipcMain.handle('hermes:tools:set', (event, name: string, enabled: unknown) => {
    assertTrustedRendererSender(event, 'Hermes')
    return setHermesTool(guardString(name, 'toolset'), guardBoolean(enabled, 'toolset.enabled'))
  })
  ipcMain.handle('hermes:behaviour:workspace', (event) => {
    assertTrustedBehaviourSender(event)
    return defaultBehaviourRoot
  })
  ipcMain.handle('hermes:behaviour:choose-workspace', async (event) => {
    assertTrustedBehaviourSender(event)
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    const selected = result.canceled ? null : (result.filePaths[0] ?? null)
    return selected ? behaviourAccess.approve(selected) : null
  })
  ipcMain.handle('hermes:behaviour:contexts', (event, workspaceRoot: string) => {
    assertTrustedBehaviourSender(event)
    const workspace = approvedBehaviourWorkspace(workspaceRoot)
    return listBehaviourContexts({ workspaceRoot: workspace, contextRoot: workspace })
  })
  ipcMain.handle('hermes:behaviour:list', (event, workspaceRoot?: string, contextRoot?: string) => {
    assertTrustedBehaviourSender(event)
    const workspace = approvedBehaviourWorkspace(workspaceRoot)
    return listBehaviourFiles({
      workspaceRoot: workspace,
      contextRoot: contextRoot ? guardString(contextRoot, 'behaviour.contextRoot') : workspace
    })
  })
  ipcMain.handle(
    'hermes:behaviour:read',
    (event, id: string, workspaceRoot?: string, contextRoot?: string) => {
      assertTrustedBehaviourSender(event)
      const workspace = approvedBehaviourWorkspace(workspaceRoot)
      return readBehaviourFile(guardString(id, 'behaviour.id'), {
        workspaceRoot: workspace,
        contextRoot: contextRoot ? guardString(contextRoot, 'behaviour.contextRoot') : workspace
      })
    }
  )
  ipcMain.handle('hermes:loop:run', (event, input: LoopRunInput) =>
    runSkillLoop(
      input,
      os.registry,
      os.roles.getBinding('orchestrator').provider,
      (loopEvent) => event.sender.send('hermes:loop:event', loopEvent),
      (question, context) => askModelQuestion(event.sender, 'loop', question, context)
    )
  )
  ipcMain.handle('hermes:loop:skills', () => listLoopSkills())
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
  ipcMain.handle('os:kaizen', (_e, jsonl: string) => os.kaizenPatterns(guardString(jsonl, 'jsonl')))

  // --- Sas d'autorité (décisions AFK ouvertes par l'orchestrateur) ---
  ipcMain.handle('os:authority:pending', () => os.authority.pending())
  ipcMain.handle('os:authority:resolve', (_e, id: string, choice: unknown) =>
    os.authority.resolve(id, choice)
  )
  ipcMain.handle('os:authority:sweep', () => os.authority.sweepExpired())

  // --- Conversations catégorisées ---
  ipcMain.handle('os:conversations', () => os.conversations.list())
  ipcMain.handle(
    'os:conversations:create',
    (_e, p: { title: string; category: string; provider: string }) => os.conversations.create(p)
  )
  ipcMain.handle('os:conversations:rename', (_e, id: string, title: string) =>
    os.conversations.rename(id, guardString(title, 'title'))
  )
  ipcMain.handle('os:conversations:remove', (_e, id: string) => os.conversations.remove(id))

  // --- Graphe brain 3D (données réelles disque) + workflow ---
  ipcMain.handle('os:listBrains', () => os.listBrains())
  ipcMain.handle('os:loadBrainGraph', (_e, path: string, lod?: number, community?: number) =>
    os.loadBrainGraph(guardString(path, 'path'), lod, community)
  )
  ipcMain.handle('os:readNodeFile', (_e, path: string) =>
    os.readNodeFile(guardString(path, 'path'))
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
      messages: Array<{ role: 'user' | 'assistant'; content: string }>,
      conversationId?: string
    ) => {
      try {
        const safe = (Array.isArray(messages) ? messages : [])
          .slice(-40)
          .map((m) => ({ role: m.role, content: guardString(m.content, 'content') }))
        // Contexte : les workflows créés pendant ce tour se rattachent à CETTE conversation.
        bus.activeConversationId = conversationId
        const spoken: string[] = []
        let turnUsage: { inputTokens: number; outputTokens: number; costUsd?: number } | undefined
        await pilot.chat(
          safe,
          (e) => {
            if (e.kind === 'think' && e.text) spoken.push(e.text)
            if (e.kind === 'command' && e.name) spoken.push(`[a exécuté ${e.name}]`)
            if (e.kind === 'done' && e.usage) turnUsage = e.usage
            event.sender.send('pilot:event', e)
          },
          (question) => askModelQuestion(event.sender, 'chat', question, 'Chat')
        )
        // Journal d'activité de la conversation : le tour de chat, avec son coût en tokens.
        if (conversationId) {
          const last = safe[safe.length - 1]
          appendConvActivity(conversationId, {
            kind: 'chat',
            label: last?.role === 'user' ? last.content : 'tour agent',
            provider: os.roles.getBinding('orchestrator').provider,
            inputTokens: turnUsage?.inputTokens,
            outputTokens: turnUsage?.outputTokens,
            costUsd: turnUsage?.costUsd,
            text: spoken.join('\n').slice(0, 600)
          })
        }
        // Persistance best-effort : la conv peut avoir été supprimée PENDANT le tour (par l'agent).
        if (conversationId && os.conversations.get(conversationId)) {
          const last = safe[safe.length - 1]
          if (last?.role === 'user')
            os.conversations.append(conversationId, { role: 'user', content: last.content })
          os.conversations.append(conversationId, {
            role: 'assistant',
            content: spoken.join('\n') || '(aucune réponse)'
          })
        }
        return { ok: true }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
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
      color: '#000000',
      symbolColor: '#f5f7fb',
      height: 28
    },
    icon,
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
    mainWindow.maximize()
    mainWindow.show()
    setTimeout(() => void warmHermesControls(), 250)
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

// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId(AUTOWIN_APP_ID)

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

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !startupStorageMigration) {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
