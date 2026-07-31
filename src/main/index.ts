import { emitToLiveWindows } from './renderer-emit'
import {
  app,
  shell,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  Notification,
  Tray,
  type IpcMainInvokeEvent,
  type WebContents
} from 'electron'
import { join } from 'path'
import { randomUUID } from 'node:crypto'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import devIcon from '../../resources/autowin-os-dev.png?asset'
import type { Message, ProviderAdapter, SendResult, StreamChunk } from './providers/types'
import { guardBrokenProcessPipes } from './process-stream-guards'
import { ProviderRegistry } from './providers/registry'
import { AutowinOS } from './os'
import { projectContextBlock } from './context-files'
import { DEFAULT_CDP_PORT, listeningPorts, resolveCdpPort } from './cdp-port'
import { execFileSync } from 'node:child_process'
import { ensureBrainServerStarted } from './brain-server-launch'
import { installCrashHandlers } from './crash-handlers'
import { CostCircuitBreaker } from './cost-circuit-breaker'
import {
  costLimitsFromSettings,
  loadOrchestrationBudget,
  saveOrchestrationBudget
} from './orchestration-budget'
import {
  appPreflightProbes,
  getLastAppPreflightResult,
  runAppPreflight,
  watchAppPreflight
} from './preflight-probes'
import { repairPreflightCheck } from './preflight-repair'
import { RoleModelConfig, type ReasoningEffort, type Role, type RoleBinding } from './roles'
import { AppCommandBus, type AppEvent } from './commands'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import { ActiveChatTurns } from './active-chat-turns'
import { ConversationRouteCoordinator, ConversationRouter } from './conversation-router'
import type { ChatTurnEvent } from '../shared/chat-turn'
import { TraceLedger } from './activity/ledger'
import { listSessions, parseSession } from './activity/transcripts'
import { persistConversations } from './store/conversations-disk'
import { collectStdoutJournals } from './runs/journal-gc'
import { listConvRuns, loadConvRunTrace } from './runs/conv-runs'
import { createOrchestrateTurnPersistence } from './runs/orchestrate-turn-persistence'
import {
  appendTurnEvent,
  listUnfinishedTurns,
  pruneFinishedTurnJournals,
  readTurnJournal
} from './runs/turn-journal'
import { appendConvActivity, loadConvActivity } from './activity/conv-activity'
import {
  appendPromptCall,
  deletePromptCalls,
  loadAllPromptCalls,
  loadPromptCalls,
  costSamplesFrom,
  summarizeCostSamples
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

import { ProfileStore, type AutowinProfile } from './profile-store'
import { listCapabilities, setCapabilityEnabled, warmCapabilities } from './capability-controls'
import { defaultBehaviourWorkspace } from './behaviour-files'
import { ApprovedBehaviourWorkspaces, isTrustedRendererUrl } from './behaviour-access'
import { discoverConfiguredSkillRegistry } from './skill-registry'
import { listClaudeHooks, listCodexHooks } from './claude-hooks'
import { ModelQuestionHub, type ModelQuestion, type PendingModelQuestion } from './model-questions'
import { discoverImportedModels, findModel, loadCachedImportedModels } from './models'
import { ModelCatalogRefresher, serveModelCatalog } from './model-refresh'
import { buildModelQuotaSnapshot, getModelQuotaSnapshot } from './model-quotas'
import { loadAgentTopology, saveAgentTopology } from './topology-disk'
import { migrateTopologyShape } from './topology'
import type { AgentTopology, SlotBinding } from './topology'
import {
  configureAutowinAppDataBase,
  createAutowinAppDataRoot,
  ensureAutowinAppData,
  legacyAppDataRoot,
  resolveAutowinAppDataBase
} from './app-data'
import { configureTurnTiming } from './turn-timing'
import { AUTOWIN_APP_ID, AUTOWIN_DISPLAY_NAME } from '../shared/app-identity'
import {
  isRendererStorageMigrationComplete,
  markRendererStorageMigrationComplete,
  readLegacyRendererStorage,
  type MigratedRendererStorage
} from './renderer-storage-migration'
import { guardAttachments, guardBoolean, guardString } from './ipc-guards'
import { parseTicketSourceProfile } from '../shared/tickets'
import { azureTicketProvider, listAzurePeople } from './ticket-providers/azure'
import { getAzureDevOpsAadToken } from './ticket-providers/azure-cli-auth'
import { TicketSourceStore } from './ticket-source-store'
import { createTicketCredentialStore } from './ticket-credential-store'
import { TicketService } from './tickets-service'
import { createTicketProviderRegistry } from './ticket-providers/provider-contract'
import { githubTicketProvider } from './ticket-providers/github'
import { gitlabTicketProvider } from './ticket-providers/gitlab'
import { loadAzureDevOpsCliToken } from './azure-cli-token'
import { loadForgeCliToken } from './forge-cli-token'
import { registerTicketsIpc } from './tickets-ipc'
import { checkForUpdate, applyUpdate } from './git-update'
import { restartApplication } from './app-restart'
import {
  ChatArtifactPreviewBudget,
  MAX_ARTIFACT_PREVIEW_BYTES,
  materializeChatArtifact,
  readConversationArtifact,
  removeConversationArtifacts,
  revealableConversationArtifactPath
} from './store/chat-artifact-store'

import { BrainWorkerClient } from './viz/brain-worker-client'
import {
  createNativePreflightReader,
  filterNativePreflight,
  readNativePreflight
} from './activity/native-preflight'
import { nativeSpoolRoot, appendNativeTrace } from './activity/native-trace-spool'
import { appendBrainTrace, readBrainTraces } from './activity/brain-trace-spool'
import {
  appendConversationFileTrace,
  appendExecutionEvidenceFileTrace,
  workspaceTracePathKey
} from './activity/conversation-file-trace-spool'
import {
  readConversationGitDiff,
  readConversationGitState
} from './activity/conversation-git-state'
import { buildBehaviourComposition } from './behaviour-composition'
import {
  buildProviderStatuses,
  probePresenceUnlessStandby,
  probeResultStatus,
  runStartupProviderProbes
} from './provider-status'
import { ProviderStateStore, type ProviderMode } from './provider-state-store'
import { loadTokens } from './providers/codex-auth'
import { artifactsFromExecutionEvidence } from './providers/artifacts'

import { amitelBrainRoot, createAmitelContextProvider } from './amitel-context'
import { readGitState, readGitDiff } from './git-read-main'
import {
  captureWorkspaceMutationSnapshot,
  captureWorkspacePathGenerationMarker
} from './providers/workspace-mutation-evidence'
import { readGitGraph } from './git-graph-main'
import {
  automationAppIdentity,
  presentAutomationWindow,
  resolveAutomationInstanceMode,
  resolveExplicitUserDataDir,
  resolveIsolatedAppDataBase
} from './headless-instance'
import { TaskStore } from './task-manager/task-store'
import { persistTaskStore } from './task-manager/task-store-disk'
import { TaskScheduler } from './task-manager/task-scheduler'
import { ScheduledChatDispatcher } from './task-manager/chat-dispatch'
import {
  isolatedRelayLaunchArguments,
  PowerShellWindowsRelay,
  taskOccurrenceFromAdditionalData,
  taskOccurrenceFromArgs
} from './task-manager/windows-relay'
import { registerTaskManagerIpc } from './task-manager/task-manager-ipc'

guardBrokenProcessPipes(process.stdout, process.stderr)

const scheduledTaskDispatch = process.argv.includes('--autowin-task-dispatch')
const startupTaskOccurrence = taskOccurrenceFromArgs(process.argv)
const resolvedAutomationInstanceMode = resolveAutomationInstanceMode(
  process.argv,
  process.env,
  app.isPackaged
)
const automationInstanceMode = {
  ...resolvedAutomationInstanceMode,
  headless: resolvedAutomationInstanceMode.headless || scheduledTaskDispatch
}
const isolatedTestInstance = automationInstanceMode.isolated
const headlessTestInstance = automationInstanceMode.headless
const explicitUserDataPath = resolveExplicitUserDataDir(process.argv)
const appDataRoot = resolveIsolatedAppDataBase(
  resolveAutowinAppDataBase(app.getPath('appData'), app.isPackaged),
  isolatedTestInstance,
  explicitUserDataPath
)
app.setName(isolatedTestInstance ? `${AUTOWIN_DISPLAY_NAME} Test` : AUTOWIN_DISPLAY_NAME)
const explicitUserDataDir = explicitUserDataPath !== undefined
if (explicitUserDataPath) app.setPath('userData', explicitUserDataPath)
// En DEV uniquement : ouvre le port CDP pour piloter/inspecter le renderer réel. Jamais en packagé
// (surface de debug). Doit être posé avant app ready — d'où la sonde SYNCHRONE du port.
// Un enfant de l'app peut hériter du socket d'écoute et garder le port après la mort de l'app (vécu,
// PID orphelin en LISTENING) : on prend alors le suivant libre au lieu de perdre le CDP.
if (is.dev) {
  const cdp = resolveCdpPort(() =>
    listeningPorts(
      execFileSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true, timeout: 5_000 })
    )
  )
  app.commandLine.appendSwitch('remote-debugging-port', String(cdp.port))
  // Toujours annoncer le port EFFECTIF : sans ça, un port déplacé rendrait tout pilotage muet.
  console.log(
    `[cdp] port ${cdp.port}${cdp.forced ? ' (forcé par AUTOWIN_CDP_PORT)' : ''}` +
      (cdp.moved ? ` — ${DEFAULT_CDP_PORT} était occupé` : '')
  )
}
configureAutowinAppDataBase(appDataRoot)
const canonicalAppDataRoot = createAutowinAppDataRoot(appDataRoot)
if (!explicitUserDataDir) app.setPath('userData', canonicalAppDataRoot)
// En DEV, on n'enforce PAS le single-instance lock : un hot-restart electron-vite (ou un
// process résiduel qui détient encore le lock) ne doit jamais laisser une instance PÉRIMÉE
// à l'écran en tuant la nouvelle. Le lock n'est appliqué que sur le build packagé.
// Le verrou Electron est rattaché au `userData` : deux instances de test isolées avec deux racines
// restent indépendantes, tandis qu'un second lancement sur la MÊME racine peut réveiller la fenêtre
// du process tray (preuve Task Manager fermeture X → réouverture).
const ownsInstanceLock =
  !app.isPackaged ||
  app.requestSingleInstanceLock(
    startupTaskOccurrence ? { autowinTaskOccurrence: startupTaskOccurrence } : {}
  )
if (!ownsInstanceLock) app.quit()
else configureTurnTiming(ensureAutowinAppData(appDataRoot))

/** Noyau applicatif unique (P0-P4 câblés) : kit SOUL injecté, 2 voies, modules. */
const os = new AutowinOS()
const brainWorker = new BrainWorkerClient(join(__dirname, 'brain-worker.js'))
// Conversations persistées sur disque : rechargées au démarrage, sauvées à chaque mutation.
const flushConversations = persistConversations(os.conversations)
const scheduledTasks = new TaskStore()
const flushScheduledTasks = persistTaskStore(scheduledTasks)
let scheduledTaskScheduler: TaskScheduler | undefined
const pendingScheduledOccurrences = new Set<string>()
const chatArtifactPreviewBudget = new ChatArtifactPreviewBudget()
const budgetedArtifactRenderers = new Set<number>()

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
      brainWorker.request<string>('graphifyEvidence', raw, query, limit),
    // PORTEE PAR WORKSPACE (O3) : le Brain est a 99 % de la doc RIG, donc une question Autowin ramenait
    // majoritairement des sources d'un AUTRE projet. Le corpus autorise se DERIVE du workspace, il n'est
    // pas ecrit en dur : dans un workspace RIG, la doc RIG est exactement ce qu'il faut.
    // Le chat ne POUSSE plus que le graphe de code. MESURE 2026-07-29 : l'appel Brain coute ~430 ms de
    // mediane a chaque tour (jusqu'a 1 500 ms, son timeout) alors que 73 % des tours n'en ont tire
    // AUCUNE source utile ; le graphe coute 7 ms. Le Brain reste atteignable A LA DEMANDE, par la
    // commande `brain_query` que le prompt recommande deja — on passe d'un contexte pousse a une
    // capacite disponible.
    sources: ['graph'],
    workspace: () => os.executionWorkspace,
    onScope: ({ kept, dropped, corpus }) => {
      if (dropped > 0) {
        console.info(
          `[brain-scope] corpus ${corpus.join('|')} : ${kept} source(s) gardee(s), ${dropped} hors corpus ecartee(s)`
        )
      }
    }
  }),
  // MÊME source de contexte projet que les phases orchestrées (fold du CLAUDE.md/AGENTS.md du workspace).
  () => projectContextBlock(os.executionWorkspace)
)
const conversationRouteCoordinator = new ConversationRouteCoordinator(
  os.conversations,
  new ConversationRouter(os.registry, os.roles)
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
/**
 * Relayout forcé de la fenêtre principale (correctif desync fenêtre↔viewport, cf. createWindow).
 * Exposé au niveau module pour être rejoué depuis les chemins déclenchés PAR LE MODÈLE (fermeture
 * d'une fenêtre de question `alwaysOnTop` enfant), pas seulement sur les transitions utilisateur.
 */
let relayoutMainWindow: (() => void) | null = null
const diagnosticCapabilities = new DiagnosticCapabilities()
/** Boucle de re-probe du diagnostic de démarrage (#4) — arrêtée à la fermeture pour ne pas fuir de timer. */
let preflightWatchHandle: { stop: () => void } | null = null

/**
 * Survie à la fermeture de FENÊTRE (robustesse niveau 1) : fermer la fenêtre ne tue plus l'app ni le
 * run en cours — le process main reste vivant en TRAY (les tours d'agent y tournent + s'y persistent),
 * et rouvrir la fenêtre rebranche sur la conversation (résultat conservé). Quit RÉEL via le menu tray.
 */
let tray: Tray | null = null
let isQuitting = false

/** Montre la fenêtre existante (ou en recrée une si toutes fermées). */
function showMainWindow(): void {
  const existing = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  if (existing) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
  } else {
    createWindow()
  }
}

/** Icône de barre d'état : présence VISIBLE de l'app vivante (anti « process fantôme ») + quit réel. */
function setupTray(): void {
  if (tray) return
  try {
    tray = new Tray(process.env['AUTOWIN_OS_DEV'] === '1' ? devIcon : icon)
    tray.setToolTip('Autowin OS — actif (les runs continuent fenêtre fermée)')
    const menu = Menu.buildFromTemplate([
      { label: 'Ouvrir Autowin', click: () => showMainWindow() },
      { type: 'separator' },
      {
        label: 'Quitter Autowin',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
    tray.setContextMenu(menu)
    tray.on('click', () => showMainWindow())
  } catch {
    // Tray best-effort : un échec (env sans zone de notification) ne doit pas casser le démarrage.
    tray = null
  }
}
const providerStateStore = new ProviderStateStore(
  join(app.getPath('userData'), 'provider-state.json')
)
const routedProviders = ['codex', 'claude', 'kimi'] as const
type RoutedProvider = (typeof routedProviders)[number]
let startupProviderChecks: Promise<void> = Promise.resolve()

/**
 * Borne du probe de connexion d'un provider. 20 s : c'est un VRAI appel (spawn de CLI + aller-retour
 * réseau), donc largement au-dessus d'une latence normale — la valeur n'est pas là pour accélérer un
 * échec mais pour empêcher un hang de bloquer le préflight indéfiniment.
 */
const PROVIDER_PROBE_TIMEOUT_MS = 20_000

async function probeProviderConnection(
  id: RoutedProvider
): Promise<{ provider: RoutedProvider; status: ReturnType<typeof probeResultStatus> | 'standby' }> {
  if (providerStateStore.get(id).mode === 'standby') {
    return { provider: id, status: 'standby' }
  }
  try {
    const result = (await Promise.race([
      // Probe minimal : aucun kit système injecté, pour éviter de facturer le contexte applicatif.
      os.registry.send(id, [{ role: 'user', content: 'ping' }], { system: '' }),
      new Promise<never>((_resolve, reject) =>
        setTimeout(
          // Le message NOMME le provider et le délai. Avant, un `Error('timeout')` nu rendait un hang
          // provider indistinguable d'une borne arbitraire : impossible de savoir QUI n'a pas répondu,
          // ni après combien, alors que c'est la seule information utile quand ça arrive.
          // Aucun des mots `authenticate|oauth|expired|not logged|login` ici : le `catch` en aval
          // classe sur ce message, et l'un d'eux ferait passer un timeout pour une session expirée.
          () => reject(new Error(`pas de reponse de ${id} apres ${PROVIDER_PROBE_TIMEOUT_MS} ms`)),
          PROVIDER_PROBE_TIMEOUT_MS
        )
      ) // sleep-ok: garde-timeout bornant un vrai appel provider (réseau/CLI)
    ])) as { text?: string }
    const text = (result?.text ?? '').toLowerCase()
    const status = /authenticate|oauth|expired|not logged|login/.test(text)
      ? probeResultStatus({ expired: true })
      : probeResultStatus({ ok: true })
    providerStateStore.recordProbe(id, status)
    return { provider: id, status }
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).toLowerCase()
    const status = /authenticate|oauth|expired|not logged|login/.test(message)
      ? probeResultStatus({ expired: true })
      : probeResultStatus({ errored: true })
    providerStateStore.recordProbe(id, status)
    return { provider: id, status }
  }
}

function preflightProviderOptions(): { standbyProviders: Array<(typeof routedProviders)[number]> } {
  return {
    standbyProviders: routedProviders.filter(
      (provider) => providerStateStore.get(provider).mode === 'standby'
    )
  }
}
const agentTopologyPath = join(app.getPath('userData'), 'agent-topology.json')
const modelCatalogCachePath = join(app.getPath('userData'), 'model-catalog.json')
// Le cache est chargé AVANT la topologie : un bridge momentanément incomplet ne rase pas les bindings existants.
let agentModels = loadCachedImportedModels(modelCatalogCachePath)
let agentTopology = loadAgentTopology(agentTopologyPath, agentModels)
const modelCatalog = new ModelCatalogRefresher(
  agentModels,
  () => discoverImportedModels(fetch, modelCatalogCachePath),
  {
    freshnessMs: 60_000,
    reconcile: (current, models) => {
      // Un modèle explicitement lié reste utilisable si la source live répond mais l'omet.
      // Il provient du catalogue validé au boot (cache/seed), pas d'un id inventé.
      const configuredModelIds = new Set(
        [
          agentTopology.orchestrator,
          ...agentTopology.subagents,
          ...agentTopology.panels.scout,
          ...agentTopology.panels.judge,
          ...agentTopology.panels.frame
        ].map((binding) => binding.modelId)
      )
      return [
        ...models,
        ...current.filter(
          (model) =>
            configuredModelIds.has(model.id) && !models.some((live) => live.id === model.id)
        )
      ]
    },
    onApply: (models) => {
      agentModels = models
      // Les défauts de rôle (provider-only) se résolvent désormais par alias de famille
      // contre le catalogue découvert ; les bindings existants (modèle explicite) restent intacts.
      os.roles.setCatalog(agentModels)
      agentTopology = loadAgentTopology(agentTopologyPath, agentModels)
      syncRuntimeTopology(agentTopology)
      broadcast({ type: 'refresh', scope: 'roles' })
    }
  }
)
const agentModelsReady = modelCatalog.refresh(true)
os.setTaskReadiness(agentModelsReady)

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
    // Une fenêtre enfant `alwaysOnTop` qui apparaît/disparaît peut laisser la fenêtre parente avec
    // des métriques périmées (contenu rogné). C'est un chemin déclenché PAR LE MODÈLE, pas par
    // l'utilisateur → on force le relayout du parent à sa fermeture.
    relayoutMainWindow?.()
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

/**
 * Pose une question du modele a l'utilisateur.
 *
 * CAUSE RACINE d'un tour suspendu (mesuree le 2026-07-29) : cette fonction s'appuyait sur le
 * WebContents CAPTURE au lancement du tour. Fenetre fermee ⇒ `BrowserWindow.fromWebContents(sender)`
 * rend `null`, aucune fenetre de question ne s'ouvre, et la promesse ne se resout JAMAIS — le tour
 * restait bloque indefiniment (constate : 7,4 Ko produits apres la fermeture, puis 4 minutes de
 * silence, aucun `done`). Le travail n'etait pas perdu (journal + reprise) mais le tour ne se
 * cloturait pas.
 *
 * Desormais : on cible une fenetre VIVANTE, et s'il n'y en a aucune on REFUSE la question au lieu
 * d'attendre. Le pilote sait deja traiter ce cas — il injecte la reponse et poursuit en autonomie —
 * donc un tour qui tourne en tray se termine au lieu de rester suspendu.
 */
function askModelQuestion(
  sender: Electron.WebContents,
  source: 'chat' | 'loop',
  question: ModelQuestion,
  context?: string,
  signal?: AbortSignal
): Promise<string> {
  let pendingId: string | undefined
  // Fenetre d'accueil de la question : celle d'origine si elle vit encore, sinon N'IMPORTE quelle
  // fenetre ouverte. Aucune ⇒ personne ne peut repondre : on ne bloque pas le tour pour autant.
  const originWindow = sender.isDestroyed() ? null : BrowserWindow.fromWebContents(sender)
  const host = originWindow ?? BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ?? null
  if (!host) {
    return Promise.resolve(
      'Impossible de te poser la question : aucune fenêtre ouverte (le tour se poursuit en arrière-plan). ' +
        'Continue de façon autonome avec une hypothèse raisonnable et signale-la dans ta réponse.'
    )
  }
  const answer = modelQuestions.ask(
    source,
    question,
    (pending) => {
      pendingId = pending.id
      openQuestionWindow(host, pending)
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
/** Journaux de tour (survie niveau 2 : rejeu/reprise après fermeture complète de l'app). */
const turnJournalRoot = join(app.getPath('userData'), 'turn-journals')
// Racine des journaux de SORTIE BRUTE des CLI (mode détaché opt-in AUTOWIN_DETACHED_RUNS=1) :
// transmise aux providers par l'environnement, pour qu'ils n'aient pas à connaître Electron.
process.env.AUTOWIN_RUN_JOURNAL_ROOT ??= join(app.getPath('userData'), 'run-stdout')
// Un journal est ecrit a CHAQUE spawn de CLI et rien ne les supprimait : 435 fichiers / 10,6 Mo
// mesures en 2 jours d'usage. Passe au demarrage (les runs detaches en cours sont proteges par la
// garde d'inactivite du GC), best-effort : un echec de menage ne doit jamais retarder l'app.
try {
  const collected = collectStdoutJournals(process.env.AUTOWIN_RUN_JOURNAL_ROOT)
  if (collected.removed > 0) {
    console.log(
      `[run-stdout] ${collected.removed} journaux purges (${Math.round(collected.freedBytes / 1024)} Ko)`
    )
  }
} catch {
  /* menage best-effort : jamais bloquant au demarrage */
}
const ledger = new TraceLedger(join(app.getPath('userData'), 'trace'))
const causalTrace = new TraceStore(join(app.getPath('userData'), 'causal-trace'))

const profiles = new ProfileStore(join(app.getPath('userData'), 'profiles.json'))
const orchestrationBudgetPath = join(app.getPath('userData'), 'orchestration-budget.json')
const ticketSources = new TicketSourceStore(join(app.getPath('userData'), 'ticket-sources.json'))
const ticketCredentials = createTicketCredentialStore()
const tickets = new TicketService({
  sourceStore: ticketSources,
  credentialStore: ticketCredentials,
  registry: createTicketProviderRegistry([
    azureTicketProvider,
    githubTicketProvider,
    gitlabTicketProvider
  ]),
  tokenFallback: async (source) =>
    source.provider === 'azure'
      ? { token: await loadAzureDevOpsCliToken(), authScheme: 'bearer' }
      : loadForgeCliToken(source)
})
bus.trace = (name, args, ok) =>
  ledger.append({ source: 'bus', name, detail: JSON.stringify(args).slice(0, 200), ok })

/** Plafond de taille des payloads IPC (anti-DoS main process). */

const defaultBehaviourRoot = defaultBehaviourWorkspace()
const behaviourAccess = new ApprovedBehaviourWorkspaces(defaultBehaviourRoot)

function assertTrustedRendererSender(event: IpcMainInvokeEvent, scope: string): void {
  const trusted = isTrustedRendererUrl(event.senderFrame?.url ?? '', behaviourRendererOptions())
  if (!trusted) throw new Error(`Origine renderer non autorisée pour ${scope}`)
}

function assertTrustedBehaviourSender(event: IpcMainInvokeEvent): void {
  assertTrustedRendererSender(event, 'Behaviour')
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
  // Annuaire des collaborateurs (autocomplete assigné) : équipes du projet → membres, mêmes
  // credentials que tickets:list. BEST-EFFORT : toute défaillance ⇒ [] (l'autocomplete dégrade
  // sur les assignés déjà chargés, jamais d'erreur bloquante pour la vue).
  ipcMain.handle('tickets:people', async (event, value: unknown) => {
    assertTrustedRendererSender(event, 'Tickets')
    const source = parseTicketSourceProfile(value)
    if (!source || !ticketSources.list().some((candidate) => candidate.id === source.id)) {
      throw new Error('Profil Tickets non autorisé')
    }
    if (source.provider !== 'azure') return []
    try {
      const pat = process.env.AUTOWIN_AZDO_PAT ?? ''
      const token = pat || (await getAzureDevOpsAadToken()) || ''
      if (!token) return []
      const authScheme: 'bearer' | 'pat' = pat ? 'pat' : 'bearer'
      return await listAzurePeople(source, { token, authScheme, fetchFn: fetch })
    } catch {
      return []
    }
  })
  // Survie niveau 2 : au démarrage, le renderer demande les tours restés INACHEVÉS (app fermée en
  // pleine exécution) pour les rejouer/afficher. GC des journaux terminés au passage.
  ipcMain.handle('runs:unfinishedTurns', (event) => {
    assertTrustedRendererSender(event, 'UnfinishedTurns')
    try {
      pruneFinishedTurnJournals(turnJournalRoot)
    } catch {
      /* GC best-effort */
    }
    return listUnfinishedTurns(turnJournalRoot)
  })
  ipcMain.handle('runs:turnJournal', (event, conversationId: string, turnId: string) => {
    assertTrustedRendererSender(event, 'TurnJournal')
    return readTurnJournal(
      turnJournalRoot,
      guardString(conversationId, 'conversationId'),
      guardString(turnId, 'turnId')
    )
  })
  // Auto-update git : check au démarrage (non-bloquant) + application 1-clic (pull + relaunch).
  ipcMain.handle('update:check', (event) => {
    assertTrustedRendererSender(event, 'Update')
    return checkForUpdate(process.cwd())
  })
  ipcMain.handle('update:apply', async (event) => {
    assertTrustedRendererSender(event, 'Update')
    const result = await applyUpdate(process.cwd())
    if (result.ok && result.relaunch) {
      restartApplication(app)
    }
    return result
  })
  ipcMain.handle('app:test:capture-page', async (event) => {
    assertTrustedRendererSender(event, 'Capture UI de test')
    if (!isolatedTestInstance)
      throw new Error('Capture UI de test indisponible hors instance isolée')
    return (await event.sender.capturePage()).toPNG().toString('base64')
  })
  ipcMain.handle(
    'app:test:seed-conversation-scope',
    async (event, conversationId: unknown, variant: unknown) => {
      assertTrustedRendererSender(event, 'Fixture conversation source scope')
      if (!isolatedTestInstance) throw new Error('Fixture indisponible hors instance isolée')
      const safeConversationId = guardString(conversationId, 'conversationId')
      if (variant !== 'a' && variant !== 'b') throw new Error('Variante de fixture invalide')
      const path =
        variant === 'a'
          ? 'src/renderer/src/components/SourceControlPane.tsx'
          : 'src/renderer/src/components/SourceControlPane.css'
      const fingerprint = [...(await captureWorkspaceMutationSnapshot(os.executionWorkspace))].find(
        ([candidate]) => workspaceTracePathKey(candidate) === workspaceTracePathKey(path)
      )?.[1]
      const generationMarker = await captureWorkspacePathGenerationMarker(
        os.executionWorkspace,
        path
      )
      appendConversationFileTrace({
        timestamp: new Date().toISOString(),
        conversationId: safeConversationId,
        turnId: `fixture-turn-${variant}`,
        workspaceRoot: os.executionWorkspace,
        source: 'subagent',
        paths: [path],
        ...(fingerprint ? { pathFingerprints: { [path]: fingerprint } } : {}),
        pathGenerationMarkers: { [path]: generationMarker }
      })
      appendBrainTrace({
        timestamp: new Date().toISOString(),
        conversationId: safeConversationId,
        turnId: `fixture-turn-${variant}`,
        kind: 'query',
        query: variant === 'a' ? 'fixture brain conversation A' : 'fixture brain conversation B',
        found: true,
        injectedChars: variant === 'a' ? 321 : 654
      })
      return { conversationId: safeConversationId, path, variant }
    }
  )
  ipcMain.handle('app:test:seed-artifact-previews', (event) => {
    assertTrustedRendererSender(event, 'Fixture artifact previews')
    if (!isolatedTestInstance) throw new Error('Fixture indisponible hors instance isolée')
    const conversation = os.conversations.create({
      title: 'Galerie · artefacts modèles',
      category: 'codex',
      provider: 'codex'
    })
    const previewTurnId = `artifact-preview-${Date.now()}`
    os.conversations.beginTurn(
      conversation.id,
      { content: 'Génère des livrables visuels pour la galerie de validation.' },
      {
        turnId: previewTurnId,
        runtime: { provider: 'codex', model: 'gpt-artifact-fixture' }
      }
    )
    const fixtureArtifacts = [
      {
        id: 'fixture-image',
        name: 'architecture.svg',
        mimeType: 'image/svg+xml',
        kind: 'vector' as const,
        encoding: 'base64' as const,
        content: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="280"><defs><linearGradient id="g"><stop stop-color="#f2c94c"/><stop offset="1" stop-color="#5a83ff"/></linearGradient></defs><rect width="900" height="280" rx="28" fill="#0c0e14"/><circle cx="150" cy="140" r="72" fill="url(#g)"/><rect x="330" y="66" width="220" height="148" rx="22" fill="#171b25" stroke="#f2c94c"/><rect x="680" y="86" width="150" height="108" rx="18" fill="#171b25" stroke="#5a83ff"/><path d="M222 140h108m220 0h130" stroke="#d9dce6" stroke-width="5"/><text x="440" y="145" fill="white" font-family="sans-serif" font-size="25" text-anchor="middle">AUTOWIN OS</text></svg>'
        ).toString('base64'),
        size: 0,
        createdAt: Date.now(),
        source: { provider: 'codex', model: 'gpt-artifact-fixture' }
      },
      {
        id: 'fixture-markdown',
        name: 'RUN.md',
        mimeType: 'text/markdown',
        kind: 'markdown' as const,
        encoding: 'utf8' as const,
        content:
          '## Livraison vérifiée\n\n- **Claude.exe** et **Codex** partagent le même contrat\n- Les fichiers restent liés au tour qui les a produits\n\n> Aperçu Markdown rendu dans le chat.',
        size: 180,
        createdAt: Date.now(),
        source: { provider: 'claude', model: 'opus-fixture' }
      },
      {
        id: 'fixture-diagram',
        name: 'pipeline.mmd',
        mimeType: 'text/x-mermaid',
        kind: 'diagram' as const,
        encoding: 'utf8' as const,
        content:
          'flowchart LR\n  A[Modèle] --> B[Artefact]\n  B --> C[Stockage durable]\n  C --> D[Aperçu sécurisé]',
        size: 96,
        createdAt: Date.now(),
        source: { provider: 'codex', model: 'gpt-artifact-fixture' }
      },
      {
        id: 'fixture-table',
        name: 'mesures.csv',
        mimeType: 'text/csv',
        kind: 'table' as const,
        encoding: 'utf8' as const,
        content: 'provider,artefacts,statut\nClaude,12,visible\nCodex,15,visible',
        size: 64,
        createdAt: Date.now(),
        source: { provider: 'claude', model: 'opus-fixture' }
      },
      {
        id: 'fixture-model3d',
        name: 'triangle.obj',
        mimeType: 'model/obj',
        kind: 'model3d' as const,
        encoding: 'utf8' as const,
        content: 'o Triangle\nv -1 -0.8 0\nv 1 -0.8 0\nv 0 1 0\nvn 0 0 1\nf 1//1 2//1 3//1',
        size: 76,
        createdAt: Date.now(),
        source: { provider: 'codex', model: 'gpt-artifact-fixture' }
      }
    ]
    for (const artifact of fixtureArtifacts) {
      const stored = materializeChatArtifact(artifact, conversation.id, previewTurnId)
      os.conversations.applyTurnEvent(conversation.id, previewTurnId, {
        kind: 'artifact',
        artifact: stored
      })
    }
    os.conversations.applyTurnEvent(conversation.id, previewTurnId, { kind: 'done' })
    return { conversationId: conversation.id, turnId: previewTurnId }
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
  ipcMain.handle('skills:registry:list', (event) => {
    assertTrustedRendererSender(event, 'Skills')
    return discoverConfiguredSkillRegistry(join(app.getPath('userData'), 'skill-sources.json'))
  })
  ipcMain.handle('os:providerLogin', (event, provider: unknown) => {
    assertTrustedRendererSender(event, 'Provider login')
    os.startProviderLogin(guardString(provider, 'provider'))
    return { ok: true }
  })
  ipcMain.handle('os:kimiLogin', (event) => {
    assertTrustedRendererSender(event, 'KimiLogin')
    os.startKimiLogin()
    return { ok: true }
  })

  // --- Orchestration disciplinée (le cœur) : streame chaque étape ---
  ipcMain.handle('os:orchestrate', async (event, task: string, targetConversationId?: string) => {
    assertTrustedRendererSender(event, 'Orchestrate')
    // #6 — un conversationId explicite (ex. traitement ticket) lance la VRAIE pipeline scout→frame→
    // build→judge SUR cette conversation ; sinon on retombe sur la conversation active (comportement historique).
    const conversationId = targetConversationId ?? bus.activeConversationId ?? '__autonomous__'
    // #2 — run STOPPABLE : on enregistre un AbortController dans le registre du bus pour que
    // `os:orchestrate:cancel` → abortOrchestration(conversationId) le coupe réellement (sinon no-op).
    const controller = bus.registerOrchestration(conversationId)
    // #3 — circuit-breaker de coût : coupe + notifie AVANT dépassement d'un seuil déclaré (env
    // AUTOWIN_RUN_USD_CAP / AUTOWIN_RUN_TOKEN_CAP), plutôt qu'une facture surprise en post-mortem.
    const tokenCap = Number(process.env.AUTOWIN_RUN_TOKEN_CAP)
    const breaker = new CostCircuitBreaker({
      ...costLimitsFromSettings(loadOrchestrationBudget(orchestrationBudgetPath)),
      maxTokens: Number.isFinite(tokenCap) && tokenCap > 0 ? tokenCap : undefined
    })
    const turnId = randomUUID()
    // FRONTIÈRE DE PERSISTANCE : le run direct n'écrivait que le ledger et `orchestrate:step` (canal
    // sans aucun abonné renderer) — le fil restait VIDE, échec compris. On persiste donc le tour
    // comme le fait `os:pilotChat` : ouverture, une carte par étape, état terminal systématique.
    const durableTurn = createOrchestrateTurnPersistence({
      conversations: os.conversations,
      conversationId,
      turnId,
      runtime: {
        provider: os.roles.getBinding('orchestrator').provider,
        model: os.roles.getBinding('orchestrator').model,
        reasoningEffort: os.roles.getBinding('orchestrator').reasoningEffort
      },
      journal: (durableEvent) =>
        appendTurnEvent(turnJournalRoot, conversationId, turnId, {
          ...durableEvent,
          at: Date.now()
        })
    })
    const emittedArtifactIds = new Set<string>()
    try {
      durableTurn.begin(guardString(task, 'task'))
      // Acquis d'un run interrompu portant la MÊME tâche dans CETTE conversation. Oublié aussitôt :
      // le run repris persiste le sien, sinon le même acquis serait rejoué à chaque relance.
      const resumedAcquis =
        os.resumableOrchestrationForTask?.(guardString(task, 'task'), conversationId) ?? null
      if (resumedAcquis) os.forgetResumableOrchestration(resumedAcquis.runId)
      const result = await os.runTask(
        guardString(task, 'task'),
        (step) => {
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
          appendExecutionEvidenceFileTrace(step.evidence, {
            conversationId,
            turnId,
            workspaceRoot: os.executionWorkspace
          })
          const stepArtifacts = [
            ...(step.artifacts ?? []),
            ...artifactsFromExecutionEvidence(step.evidence ?? [], {
              provider: step.provider ?? 'orchestrator',
              model: step.model,
              workspaceRoot: os.executionWorkspace
            })
          ]
          for (const artifact of stepArtifacts) {
            if (emittedArtifactIds.has(artifact.id)) continue
            emittedArtifactIds.add(artifact.id)
            try {
              const stored = materializeChatArtifact(artifact, conversationId, turnId)
              durableTurn.artifact(stored)
              emitToLiveWindows(BrowserWindow.getAllWindows(), 'pilot:event', {
                kind: 'artifact',
                artifact: stored,
                conversationId,
                turnId
              })
            } catch {
              /* une sortie illisible ne doit jamais interrompre l’orchestration */
            }
          }
          ledger.append({
            source: 'orchestrate',
            name: step.step,
            detail: `${step.role ?? ''} ${step.provider ?? ''} ${step.detail ?? ''}`.trim()
          })
          // Le fil : une carte d'action par étape, PERSISTÉE (survit au rechargement).
          durableTurn.step(step)
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
          // Diffusion aux fenetres VIVANTES, jamais au WebContents capture : fermer la fenetre en
          // cours de run ne doit ni jeter (« Object has been destroyed ») ni empecher la reprise
          // d'affichage quand on la rouvre. Le run, lui, continue en tray.
          emitToLiveWindows(BrowserWindow.getAllWindows(), 'orchestrate:step', step)
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
        },
        undefined,
        undefined,
        controller.signal,
        undefined,
        // REPRISE : ce chemin DIRECT (bouton « Reprendre », pilotage programmatique) repartait de
        // zéro et repayait les phases déjà produites — seul le chemin par le chat cherchait l'acquis.
        // On le cherche ici aussi : relancer la MÊME tâche dans la MÊME conversation doit continuer,
        // pas recommencer.
        resumedAcquis?.phaseOutputs ?? [],
        conversationId,
        undefined,
        (brain) =>
          appendBrainTrace({
            ...brain,
            conversationId,
            turnId,
            kind: 'automatic'
          }),
        turnId
      )
      durableTurn.succeed(result)
      return { ok: true, result }
    } catch (e) {
      const aborted = controller.signal.aborted
      const error = aborted ? 'Run annulé' : e instanceof Error ? e.message : String(e)
      // Un échec doit se CONCLURE dans le fil : le renderer jette la promesse (`void`), donc sans ce
      // tour terminal l'erreur disparaissait entièrement.
      durableTurn.fail(error, aborted)
      return { ok: false, error, aborted }
    } finally {
      bus.clearOrchestration(conversationId, controller)
    }
  })

  // --- Config par rôle (orchestrateur / sous-agent / juge / scout) ---
  // #5 — le wizard first-run re-vérifie la config à la demande. `force` (bouton) ignore le cache TTL ;
  // sans force (montage) le cache déduplique avec le run de démarrage.
  ipcMain.handle('os:behaviourComposition', (event) => {
    assertTrustedRendererSender(event, 'Behaviour composition')
    return buildBehaviourComposition(
      os.roles,
      process.env,
      agentTopology,
      loadOrchestrationBudget(orchestrationBudgetPath).maxUsd
    )
  })
  ipcMain.handle('os:brainTraces', (event, conversationId?: unknown) => {
    assertTrustedRendererSender(event, 'Brain traces')
    return readBrainTraces(
      typeof conversationId === 'string' ? guardString(conversationId, 'conversationId') : undefined
    )
  })
  // RÉPARER un prérequis rouge d'un clic (login OAuth, démarrage brain_server) au lieu de faire
  // recopier une commande. Renvoie ce qui a été LANCÉ — le verdict reste au re-diagnostic.
  ipcMain.handle('preflight:repair', (event, checkId?: unknown) => {
    assertTrustedRendererSender(event, 'Preflight')
    if (typeof checkId !== 'string') {
      return { started: false, detail: 'Prérequis inconnu.' }
    }
    return repairPreflightCheck(checkId, { pingBrain: () => appPreflightProbes().pingBrain() })
  })
  ipcMain.handle('preflight:recheck', (event, force?: boolean) => {
    assertTrustedRendererSender(event, 'Preflight')
    return runAppPreflight(force === true, preflightProviderOptions())
  })
  ipcMain.handle('preflight:current', (event) => {
    assertTrustedRendererSender(event, 'Preflight')
    return getLastAppPreflightResult()
  })
  // Source control : lecture git READ-ONLY (statut/branche/changements/historique). Aucune action git ici.
  // Le dépôt lu est configurable (multi-repo) : le renderer fournit un cwd (défaut = cwd de l'app).
  ipcMain.handle('git:read', (event, cwd?: string) => {
    assertTrustedRendererSender(event, 'GitRead')
    return readGitState(cwd && typeof cwd === 'string' ? cwd : process.cwd())
  })
  ipcMain.handle('git:graph', (event, cwd?: string) => {
    assertTrustedRendererSender(event, 'GitGraph')
    return readGitGraph(
      cwd && typeof cwd === 'string' ? cwd : (process.env.AUTOWIN_OS_WORKSPACE ?? process.cwd())
    )
  })
  ipcMain.handle('git:diff', (event, path: string, cwd?: string) => {
    assertTrustedRendererSender(event, 'GitDiff')
    return readGitDiff(cwd && typeof cwd === 'string' ? cwd : process.cwd(), String(path ?? ''))
  })
  // Sélecteur de dépôt (dialogue dossier, read-only) → renvoie le chemin choisi ou null si annulé.
  ipcMain.handle('git:pickRepo', async (event) => {
    assertTrustedRendererSender(event, 'GitPickRepo')
    const win = BrowserWindow.fromWebContents(event.sender)
    const res = await (win
      ? dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : dialog.showOpenDialog({ properties: ['openDirectory'] }))
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })
  // Racine du Brain partagé : permet à Source control de basculer sur SON dépôt git en un clic
  // (les notes du Brain sont versionnées comme le code). Lecture seule, aucun secret exposé.
  // Clôture automatique d'un run vert (commit + push sur branche dédiée). OFF par défaut.
  ipcMain.handle('run:autoClose:get', () => os.getAutoClose())
  ipcMain.handle('run:autoClose:set', (event, enabled: unknown) => {
    assertTrustedRendererSender(event, 'AutoClose')
    os.setAutoClose(enabled === true)
    return os.getAutoClose()
  })
  ipcMain.handle('git:brainRoot', (event) => {
    assertTrustedRendererSender(event, 'GitBrainRoot')
    return amitelBrainRoot()
  })
  // Cockpit worktree (volet A) : snapshot à la demande + push live des changements d'activité.
  let worktreeFixture:
    | {
        activity: ReturnType<typeof os.getWorktreeActivity>
        status: ReturnType<typeof os.getWorktreeRuntimeStatus>
      }
    | undefined
  ipcMain.handle('worktree:activity', (event) => {
    assertTrustedRendererSender(event, 'WorktreeActivity')
    return worktreeFixture?.activity ?? os.getWorktreeActivity()
  })
  ipcMain.handle('worktree:status', (event) => {
    assertTrustedRendererSender(event, 'WorktreeStatus')
    return worktreeFixture?.status ?? os.getWorktreeRuntimeStatus()
  })
  ipcMain.handle('worktree:conflict-diff', (event, agentId: unknown) => {
    assertTrustedRendererSender(event, 'WorktreeConflictDiff')
    return os.getWorktreeConflictDiff(typeof agentId === 'string' ? agentId : '')
  })
  ipcMain.handle('worktree:retry-recovery', (event, agentId: unknown) => {
    assertTrustedRendererSender(event, 'WorktreeRetryRecovery')
    if (typeof agentId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(agentId)) {
      throw new Error('Identifiant de bureau invalide')
    }
    return os.retryWorktreeRecovery(agentId)
  })
  ipcMain.handle('app:test:worktree-fixture', (event, value: unknown) => {
    assertTrustedRendererSender(event, 'Fixture worktree')
    if (!isolatedTestInstance) throw new Error('Fixture worktree indisponible hors instance isolée')
    if (!value || typeof value !== 'object') throw new Error('Fixture worktree invalide')
    const fixture = value as Record<string, unknown>
    if (!Array.isArray(fixture.activity) || !fixture.status || typeof fixture.status !== 'object') {
      throw new Error('Fixture worktree incomplète')
    }
    const nextFixture = fixture as NonNullable<typeof worktreeFixture>
    worktreeFixture = nextFixture
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('worktree:activity-changed', nextFixture.activity)
    }
    return true
  })
  os.onWorktreeActivity((activity) => {
    for (const w of BrowserWindow.getAllWindows())
      w.webContents.send('worktree:activity-changed', activity)
  })
  ipcMain.handle('os:roles', () => os.roles.all())
  ipcMain.handle('os:orchestrationBudget:get', (event) => {
    assertTrustedRendererSender(event, 'Orchestration budget')
    return loadOrchestrationBudget(orchestrationBudgetPath)
  })
  ipcMain.handle('os:orchestrationBudget:set', (event, value: unknown) => {
    assertTrustedRendererSender(event, 'Orchestration budget')
    return saveOrchestrationBudget(orchestrationBudgetPath, value)
  })
  ipcMain.handle(
    'os:setRole',
    (event, role: Role, provider: string, model?: string, reasoningEffort?: string) => {
      assertTrustedRendererSender(event, 'SetRole')
      const binding = os.setRole(role, {
        provider,
        model,
        reasoningEffort: reasoningEffort as ReasoningEffort | undefined
      })
      broadcast({ type: 'refresh', scope: 'roles' })
      return binding
    }
  )
  ipcMain.handle('os:models:list', (event, force = false) => {
    assertTrustedRendererSender(event, 'Model catalog')
    if (typeof force !== 'boolean') throw new Error('Option de rafraîchissement invalide')
    return serveModelCatalog(modelCatalog, force)
  })
  ipcMain.handle('os:models:quotas', async (event, force = false) => {
    assertTrustedRendererSender(event, 'Model quotas')
    if (typeof force !== 'boolean') throw new Error('Option de rafraîchissement invalide')
    const models = modelCatalog.current()
    if (isolatedTestInstance) {
      const observedAt = new Date().toISOString()
      const fiveHourResetsAt = new Date(Date.now() + 5 * 60 * 60_000).toISOString()
      const sevenDayResetsAt = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString()
      return buildModelQuotaSnapshot(models, {
        claude: {
          status: 'available',
          source: 'Fixture isolée Claude',
          observedAt,
          windows: [
            {
              id: 'five-hour',
              label: '5 h',
              usedPercent: 63,
              remainingPercent: 37,
              resetsAt: fiveHourResetsAt
            },
            {
              id: 'seven-day',
              label: '7 j',
              usedPercent: 18,
              remainingPercent: 82,
              resetsAt: sevenDayResetsAt
            }
          ]
        },
        codex: {
          status: 'available',
          source: 'Fixture isolée Codex',
          observedAt,
          windows: [
            {
              id: 'five-hour',
              label: '5 h',
              usedPercent: 42,
              remainingPercent: 58,
              resetsAt: fiveHourResetsAt
            },
            {
              id: 'seven-day',
              label: '7 j',
              usedPercent: 29,
              remainingPercent: 71,
              resetsAt: sevenDayResetsAt
            }
          ]
        }
      })
    }
    return getModelQuotaSnapshot(models, { force })
  })
  // Page Routeur — statut d'auth au CHARGEMENT (cheap/local) : codex exact (expiry token),
  // claude/kimi = présence CLI seulement (JAMAIS « authenticated » sans probe réel). Borné.
  ipcMain.handle('os:providerStatus', async (event) => {
    assertTrustedRendererSender(event, 'Provider status')
    await startupProviderChecks
    const bounded = (p: Promise<boolean>): Promise<boolean> =>
      Promise.race([
        p.catch(() => false),
        new Promise<boolean>((r) => setTimeout(() => r(false), 4000)) // sleep-ok: garde-timeout bornant auth() (spawn CLI), pas un délai flaky
      ])
    const responds = async (id: string): Promise<boolean> => {
      const state = providerStateStore.get(id)
      return probePresenceUnlessStandby(state, async () => {
        try {
          const adapter = os.registry.get(id) as { auth?: () => Promise<boolean> }
          return adapter.auth ? await bounded(adapter.auth()) : false
        } catch {
          return false
        }
      })
    }
    const [claudeResponds, kimiResponds] = await Promise.all([responds('claude'), responds('kimi')])
    return buildProviderStatuses({
      codexTokens: loadTokens(),
      claudeResponds,
      kimiResponds,
      now: Date.now(),
      states: {
        codex: providerStateStore.get('codex'),
        claude: providerStateStore.get('claude'),
        kimi: providerStateStore.get('kimi')
      }
    })
  })
  ipcMain.handle('os:providerMode:set', (event, provider: unknown, mode: unknown) => {
    assertTrustedRendererSender(event, 'Provider mode')
    const id = guardString(provider, 'provider')
    if (!routedProviders.includes(id as (typeof routedProviders)[number])) {
      throw new Error('Provider non supporté.')
    }
    if (mode !== 'active' && mode !== 'standby') throw new Error('Mode provider invalide.')
    return providerStateStore.setMode(id, mode as ProviderMode)
  })
  // Bouton « Tester » — probe RÉEL borné à la demande (claude/kimi) : un vrai mini-tour dont
  // l'erreur d'auth révèle l'expiration. Timeout/exception → unknown (jamais authenticated).
  ipcMain.handle('os:providerTest', async (event, provider: unknown) => {
    assertTrustedRendererSender(event, 'Provider test')
    const id = guardString(provider, 'provider')
    if (!routedProviders.includes(id as RoutedProvider)) {
      throw new Error('Provider non supporté.')
    }
    return probeProviderConnection(id as RoutedProvider)
  })
  ipcMain.handle('os:profiles:list', () => profiles.list())
  ipcMain.handle('os:profiles:save', async (event, profile: AutowinProfile) => {
    assertTrustedRendererSender(event, 'Profiles')
    await agentModelsReady
    const safe = {
      ...profile,
      topology: agentTopology,
      roles: os.roles.all(),
      updatedAt: new Date().toISOString()
    }
    return profiles.save(safe)
  })
  ipcMain.handle('os:profiles:apply', async (event, id: string) => {
    assertTrustedRendererSender(event, 'Profiles')
    await agentModelsReady
    const profile = profiles.list().find((item) => item.id === guardString(id, 'profile.id'))
    if (!profile) throw new Error('Profil introuvable')
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
    broadcast({ type: 'refresh', scope: 'roles' })
    return profile
  })
  ipcMain.handle('os:topology:get', async () => {
    await agentModelsReady
    return agentTopology
  })
  ipcMain.handle('os:topology:set', async (event, topology: AgentTopology) => {
    assertTrustedRendererSender(event, 'Topology')
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

  ipcMain.handle('os:behaviour:choose-workspace', async (event) => {
    assertTrustedBehaviourSender(event)
    if (headlessTestInstance) return null
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    const selected = result.canceled ? null : (result.filePaths[0] ?? null)
    return selected ? behaviourAccess.approve(selected) : null
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

  // Usage RÉEL des outils (actions Codex/Claude observées) — distinct du catalogue natif décoratif.
  ipcMain.handle('os:toolUsage', () => aggregateToolUsage())

  // --- Sas d'autorité (décisions AFK ouvertes par l'orchestrateur) ---
  ipcMain.handle('os:authority:pending', () => os.authority.pending())
  ipcMain.handle('os:authority:resolve', (_e, id: string, choice: unknown) =>
    bus.resolveDecision(id, choice)
  )

  // --- Conversations catégorisées ---
  ipcMain.handle('os:conversations', () => os.conversations.list())
  ipcMain.handle(
    'os:chatArtifact:read',
    (event, rawConversationId: unknown, rawTurnId: unknown, rawArtifactId: unknown) => {
      assertTrustedRendererSender(event, 'Chat artifact')
      const conversationId = guardString(rawConversationId, 'conversationId')
      const turnId = guardString(rawTurnId, 'turnId')
      const artifactId = guardString(rawArtifactId, 'artifactId')
      if (!budgetedArtifactRenderers.has(event.sender.id)) {
        budgetedArtifactRenderers.add(event.sender.id)
        event.sender.once('destroyed', () => {
          chatArtifactPreviewBudget.clearRenderer(event.sender.id)
          budgetedArtifactRenderers.delete(event.sender.id)
        })
      }
      const scope = `${event.sender.id}:${conversationId}`
      const artifactBudgetId = `${turnId}\u0000${artifactId}`
      const remaining = Math.min(
        MAX_ARTIFACT_PREVIEW_BYTES,
        chatArtifactPreviewBudget.remaining(scope, artifactBudgetId)
      )
      const result = readConversationArtifact(
        os.conversations.get(conversationId),
        turnId,
        artifactId,
        undefined,
        remaining
      )
      if (
        result.ok &&
        !chatArtifactPreviewBudget.reserve(scope, artifactBudgetId, result.artifact?.size ?? 0)
      ) {
        return { ok: false, artifact: result.artifact, error: 'Budget cumulé des aperçus atteint' }
      }
      return result
    }
  )
  ipcMain.handle(
    'os:chatArtifact:reveal',
    (event, rawConversationId: unknown, rawTurnId: unknown, rawArtifactId: unknown) => {
      assertTrustedRendererSender(event, 'Chat artifact')
      const conversationId = guardString(rawConversationId, 'conversationId')
      const turnId = guardString(rawTurnId, 'turnId')
      const artifactId = guardString(rawArtifactId, 'artifactId')
      const path = revealableConversationArtifactPath(
        os.conversations.get(conversationId),
        turnId,
        artifactId
      )
      if (!path) return { ok: false, error: 'Artefact introuvable' }
      shell.showItemInFolder(path)
      return { ok: true }
    }
  )
  ipcMain.handle(
    'os:conversations:create',
    (
      event,
      p: {
        title: string
        category: string
        provider: string
        authorityMode?: 'plan' | 'ask' | 'auto'
      }
    ) => {
      assertTrustedRendererSender(event, 'Conversation create')
      if (p.authorityMode && !['plan', 'ask', 'auto'].includes(p.authorityMode)) {
        throw new Error('Mode d’autorité invalide')
      }
      const conversation = os.conversations.create(p)
      broadcast({ type: 'refresh', scope: 'conversations' })
      return conversation
    }
  )
  ipcMain.handle(
    'os:conversations:routeMessage',
    async (event, rawConversationId: unknown, rawMessage: unknown, rawAttachmentNames: unknown) => {
      assertTrustedRendererSender(event, 'Conversation route')
      const conversationId = guardString(rawConversationId, 'conversationId')
      const message = guardString(rawMessage, 'message')
      if (!Array.isArray(rawAttachmentNames) || rawAttachmentNames.length > 8) {
        throw new Error('attachmentNames: tableau borné attendu')
      }
      const attachmentNames = rawAttachmentNames.map((name, index) =>
        guardString(name, `attachmentNames[${index}]`)
      )
      const result = await conversationRouteCoordinator.route(
        conversationId,
        message,
        attachmentNames
      )
      const decision = result.decision
      appendConvActivity(conversationId, {
        kind: 'conversation-route',
        label: result.routed ? 'Nouveau contexte détecté' : 'Contexte courant conservé',
        provider: decision.provider,
        model: decision.model,
        reasoningEffort: decision.reasoningEffort,
        inputTokens: decision.usage?.inputTokens,
        outputTokens: decision.usage?.outputTokens,
        costUsd: decision.usage?.costUsd,
        text: JSON.stringify({
          route: decision.route,
          confidence: decision.confidence,
          reason: decision.reason,
          sourceConversationId: result.sourceConversationId,
          conversationId: result.conversationId
        })
      })
      ledger.append({
        source: 'pilot',
        name: 'conversation_route',
        detail: `${decision.route}:${decision.confidence.toFixed(2)}:${decision.reason}`,
        ok: true
      })
      if (result.routed) broadcast({ type: 'refresh', scope: 'conversations' })
      return result
    }
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
  ipcMain.handle('os:conversations:remove', async (event, rawId: string) => {
    assertTrustedRendererSender(event, 'Conversations')
    const id = guardString(rawId, 'id')
    await activeChatTurns.abortAndWait(id, 'conversation-deleted')
    const removed = os.conversations.remove(id)
    if (removed) {
      removeConversationArtifacts(id)
      causalTrace.deleteConversation(id)
      deletePromptCalls(id)
      broadcast({ type: 'refresh', scope: 'conversations' })
    }
    return removed
  })

  // --- Graphe brain 3D (données réelles disque) + workflow ---
  ipcMain.handle('os:listBrains', () => brainWorker.request('listBrains'))
  ipcMain.handle('os:loadBrainGraphPreview', (event, path: string, lod?: number) => {
    assertTrustedRendererSender(event, 'Brain')
    return brainWorker.request('loadPreview', guardString(path, 'path'), lod)
  })
  ipcMain.handle('os:loadBrainThemes', (event, path: string) => {
    assertTrustedRendererSender(event, 'Brain')
    return brainWorker.request('loadThemes', guardString(path, 'path'))
  })
  ipcMain.handle('os:loadBrainThemeNodes', (event, path: string, rawThemeIds: unknown) => {
    assertTrustedRendererSender(event, 'Brain')
    if (!Array.isArray(rawThemeIds) || rawThemeIds.length > 100)
      throw new Error('IPC themeIds: tableau borné attendu')
    const themeIds = rawThemeIds.map((themeId, index) => guardString(themeId, `themeIds[${index}]`))
    return brainWorker.request('loadThemeNodes', guardString(path, 'path'), themeIds)
  })
  ipcMain.handle('os:loadBrainGraph', (event, path: string, lod?: number, community?: number) => {
    assertTrustedRendererSender(event, 'Brain')
    return brainWorker.request('loadGraph', guardString(path, 'path'), lod, community)
  })
  ipcMain.handle('os:loadBrainNeighborhood', (event, path: string, nodeId: string) => {
    assertTrustedRendererSender(event, 'Brain')
    return brainWorker.request(
      'loadNeighborhood',
      guardString(path, 'path'),
      guardString(nodeId, 'nodeId')
    )
  })
  ipcMain.handle('os:readNodeFile', (event, path: string) => {
    assertTrustedRendererSender(event, 'Brain')
    return brainWorker.request('readNodeFile', guardString(path, 'path'))
  })
  ipcMain.handle('os:searchBrain', (_e, path: string, query: string) =>
    brainWorker.request('searchBrain', guardString(path, 'path'), guardString(query, 'query'))
  )
  ipcMain.handle('os:listRuns', () => os.listRuns())

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
  // Chat transparent : l'agent converse ET pilote l'app dans le même tour.
  // conversationId (optionnel) → le tour est PERSISTÉ dans la conversation (fil rechargeable).
  const runPilotChat = async (
    sender: WebContents | undefined,
    messages: Array<{
      role: 'user' | 'assistant'
      content: string
      attachments?: Message['attachments']
    }>,
    conversationId?: string,
    bindingOverride?: RoleBinding
  ): Promise<{
    ok: boolean
    cancelled: boolean
    turnId: string
    error?: string
  }> => {
    // Duree du tour : MESUREE de bout en bout, pour repondre a « qu'est-ce qui est lent ? » et pas
    // seulement a « qu'est-ce qui coute ? » (les deux ne coincident pas forcement).
    const turnStartedAtMs = performance.now()
    const controller = new AbortController()
    let resolveCompletion!: () => void
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve
    })
    const turnId = randomUUID()
    /**
     * Plafond d'un TOUR de chat. Réutilise le circuit-breaker déjà éprouvé sur l'orchestration
     * (module pur, testé) avec un seuil PROPRE au chat : un tour conversationnel n'a pas le même
     * ordre de grandeur qu'un run complet. Réglable via AUTOWIN_CHAT_USD_CAP ; défaut généreux
     * (2 $) — assez haut pour ne jamais gêner un tour légitime, assez bas pour arrêter une boucle
     * (le pire tour mesuré coûtait 2,109 $).
     */
    const chatUsdCap = Number(process.env.AUTOWIN_CHAT_USD_CAP)
    const chatBreaker = new CostCircuitBreaker({
      maxUsd: Number.isFinite(chatUsdCap) && chatUsdCap > 0 ? chatUsdCap : 2
    })
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
        { provider: string; model?: string; reasoningEffort?: string } | undefined
      const last = safe[safe.length - 1]
      if (conversationId && last?.role === 'user' && os.conversations.get(conversationId)) {
        const binding = bindingOverride ?? os.roles.getBinding('orchestrator')
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
        else if (pilotEvent.kind === 'artifact' && pilotEvent.artifact)
          durableEvent = { kind: 'artifact', artifact: pilotEvent.artifact }
        else if (pilotEvent.kind === 'done') {
          /**
           * Le TEXTE du `done` doit atterrir dans le message quand rien n'a ete streame.
           *
           * Constate en essai reel (2026-07-29) : le chemin direct `orchestrate` emet sa carte de
           * livraison (statut, cout, run, resultat) UNIQUEMENT dans le `done` — aucun delta. Comme
           * seul `sessionId` etait persiste, la carte etait calculee puis JETEE, et le fil ne gardait
           * que « [a execute orchestrate] ». Meme patron que le cout jete : produire l'information
           * puis la perdre a la frontiere de persistance.
           *
           * Condition stricte pour ne JAMAIS dupliquer : on ne persiste ce texte que si aucun delta
           * n'a ete emis pendant le tour (sinon le texte du `done` reprend ce qui a deja ete dit).
           */
          const closing = pilotEvent.text?.trim()
          if (closing && !streamedSpoken.trim()) {
            os.conversations.applyTurnEvent(conversationId, turnId, {
              kind: 'delta',
              // Flux dedie : ce texte de cloture n'appartient a aucun stream deja ouvert.
              streamId: `${turnId}:closing`,
              text: closing
            })
            try {
              appendTurnEvent(turnJournalRoot, conversationId, turnId, {
                kind: 'delta',
                text: closing,
                at: Date.now()
              })
            } catch {
              /* journal best-effort */
            }
          }
          durableEvent = { kind: 'done', sessionId: turnSessionId }
        } else if (pilotEvent.kind === 'cancellation') durableEvent = { kind: 'cancelled' }
        if (durableEvent) {
          os.conversations.applyTurnEvent(conversationId, turnId, durableEvent)
          // Survie niveau 2 : le même événement va AUSSI dans le journal fichier du tour, pour
          // pouvoir repérer/rejouer un tour resté inachevé après une fermeture complète de l'app.
          try {
            appendTurnEvent(turnJournalRoot, conversationId, turnId, {
              ...durableEvent,
              at: Date.now()
            })
          } catch {
            /* journal best-effort : ne jamais casser un tour pour une écriture de trace */
          }
        }
      }
      const handlePilotEvent = (incomingPilotEvent: PilotEvent): void => {
        let pilotEvent = incomingPilotEvent
        if (conversationId && pilotEvent.kind === 'artifact' && pilotEvent.artifact) {
          try {
            pilotEvent = {
              ...pilotEvent,
              artifact: materializeChatArtifact(pilotEvent.artifact, conversationId, turnId)
            }
          } catch (error) {
            pilotEvent = {
              kind: 'error',
              text:
                error instanceof Error ? error.message : 'Conservation de l’artefact impossible',
              iteration: pilotEvent.iteration
            }
          }
        }
        if (pilotEvent.kind === 'delta' && pilotEvent.text) streamedSpoken += pilotEvent.text
        if (pilotEvent.kind === 'think' && pilotEvent.text) spoken.push(pilotEvent.text)
        if (pilotEvent.kind === 'command' && pilotEvent.name)
          spoken.push(`[a exécuté ${pilotEvent.name}]`)
        if (pilotEvent.kind === 'done' && pilotEvent.usage) turnUsage = pilotEvent.usage
        // Budget du TOUR de chat : le circuit-breaker de coût ne protégeait que les runs
        // orchestrés. Mesuré le 2026-07-28 : un seul tour a coûté 2,109 $ (40 itérations d'outils)
        // sans qu'aucune borne n'existe côté chat. On compte chaque appel et on COUPE au seuil.
        if (pilotEvent.kind === 'prompt-call' && pilotEvent.callUsage) {
          const tripped = chatBreaker.observe({
            step: 'exec',
            detail: 'chat',
            costUsd: pilotEvent.callUsage.costUsd,
            tokens: pilotEvent.callUsage.inputTokens + pilotEvent.callUsage.outputTokens
          } as Parameters<typeof chatBreaker.observe>[0])
          if (tripped) {
            ledger.append({
              source: 'orchestrate',
              name: 'chat-budget',
              detail: `tour coupé — ${tripped.reason}`
            })
            controller.abort(`budget du tour dépassé : ${tripped.reason}`)
          }
        }
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
        // Idem pour le flux de chat : une fenetre fermee est un non-evenement, pas une erreur du
        // tour en cours (qui est deja paye et persiste).
        emitToLiveWindows(BrowserWindow.getAllWindows(), 'pilot:event', {
          ...pilotEvent,
          conversationId,
          turnId
        })
      }
      const delayedPilotFixture =
        isolatedTestInstance && safe.at(-1)?.content.startsWith('[[autowin-fixture-delayed-pilot]]')
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
          snapshotForPrompt: () => bus.snapshotForPrompt(),
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
            sender
              ? askModelQuestion(sender, 'chat', question, 'Chat', controller.signal)
              : Promise.reject(
                  new Error(
                    'Une tâche planifiée ne peut pas répondre à une question interactive du modèle.'
                  )
                ),
          6,
          conversationId,
          controller.signal,
          conversationId ? (os.conversations.get(conversationId)?.authorityMode ?? 'ask') : 'ask',
          conversationId ? () => drainPendingDirectives(conversationId) : undefined,
          bindingOverride,
          turnId
        )
      // Journal d'activité de la conversation : le tour de chat, avec son coût ET sa durée.
      const turnDurationMs = Math.round(performance.now() - turnStartedAtMs)
      if (conversationId) {
        const last = safe[safe.length - 1]
        const orchestratorBinding = bindingOverride ?? os.roles.getBinding('orchestrator')
        appendConvActivity(conversationId, {
          kind: 'chat',
          label: last?.role === 'user' ? last.content : 'tour agent',
          provider: turnPromptIdentity?.provider ?? orchestratorBinding.provider,
          model: turnPromptIdentity?.model ?? orchestratorBinding.model,
          reasoningEffort:
            turnPromptIdentity?.reasoningEffort ?? orchestratorBinding.reasoningEffort,
          inputTokens: turnUsage?.inputTokens,
          outputTokens: turnUsage?.outputTokens,
          costUsd: turnUsage?.costUsd,
          durationMs: turnDurationMs,
          text: (streamedSpoken || spoken.join('\n')).slice(0, 600)
        })
      }
      broadcast({ type: 'refresh', scope: 'workflows' })
      return { ok: true, cancelled: false, turnId }
    } catch (e) {
      /**
       * ETAT TERMINAL, journal COMPRIS. Ce catch n'ecrivait que dans le store : le journal FICHIER
       * du tour ne recevait ni `done` ni `failed`, donc le tour restait « inacheve » pour toujours
       * et la reprise automatique le rejouait a chaque demarrage — un tour ZOMBIE.
       *
       * Constate en reel le 2026-07-29 : une erreur d'API repetee (filtre de contenu) fait jeter le
       * pilote apres 2 tentatives ; le journal du tour s'arretait sur ['delta','stream-reset',
       * 'delta'] sans aucun evenement terminal. Un tour qui echoue doit se CONCLURE, pas disparaitre.
       */
      const terminal = controller.signal.aborted
        ? ({ kind: 'cancelled' } as const)
        : ({ kind: 'failed', error: e instanceof Error ? e.message : String(e) } as const)
      if (conversationId && os.conversations.get(conversationId)) {
        os.conversations.applyTurnEvent(conversationId, turnId, terminal)
      }
      if (conversationId) {
        try {
          appendTurnEvent(turnJournalRoot, conversationId, turnId, {
            ...terminal,
            at: Date.now()
          })
        } catch {
          /* journal best-effort : ne jamais masquer l'erreur d'origine pour une ecriture de trace */
        }
      }
      broadcast({ type: 'refresh', scope: 'workflows' })
      if (controller.signal.aborted) return { ok: true, cancelled: true, turnId }
      return {
        ok: false,
        cancelled: false,
        turnId,
        error: e instanceof Error ? e.message : String(e)
      }
    } finally {
      if (conversationId) {
        activeChatTurns.delete(conversationId, controller)
        broadcast({ type: 'refresh', scope: 'conversations' })
        if (pendingDirectives.delete(conversationId)) {
          // directives non consommées = obsolètes
          broadcast({ type: 'refresh', scope: 'directives' })
        }
      }
      resolveCompletion()
    }
  }
  ipcMain.handle('os:pilotChat', (event, messages, conversationId) => {
    assertTrustedRendererSender(event, 'PilotChat')
    return runPilotChat(event.sender, messages, conversationId)
  })
  ipcMain.handle('git:conversationRead', async (event, conversationId: unknown) => {
    assertTrustedRendererSender(event, 'ConversationGitRead')
    const safeConversationId = guardString(conversationId, 'conversationId')
    return readConversationGitState(safeConversationId, os.executionWorkspace)
  })
  ipcMain.handle(
    'git:conversationDiff',
    async (event, conversationId: unknown, rawPath: unknown, rawWorkspaceRoot: unknown) => {
      assertTrustedRendererSender(event, 'ConversationGitDiff')
      const safeConversationId = guardString(conversationId, 'conversationId')
      const path = guardString(rawPath, 'path')
        .replaceAll('\\', '/')
        .replace(/^\.\/+/, '')
      const requestedRoot = guardString(rawWorkspaceRoot, 'workspaceRoot')
      return readConversationGitDiff(safeConversationId, path, requestedRoot)
    }
  )

  const relayScriptPath = app.isPackaged
    ? join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'autowin-task-relay.ps1')
    : join(app.getAppPath(), 'resources', 'autowin-task-relay.ps1')
  const taskDispatcher = new ScheduledChatDispatcher({
    hasConversation: (conversationId) => Boolean(os.conversations.get(conversationId)),
    createConversation: (input) => os.conversations.create(input),
    bindConversation: (taskId, conversationId) => {
      scheduledTasks.bindConversation(taskId, conversationId)
    },
    isConversationBusy: (conversationId) => Boolean(activeChatTurns.get(conversationId)),
    interruptAndWait: (conversationId, reason) =>
      activeChatTurns.abortAndWait(conversationId, reason),
    runPrompt: (conversationId, prompt, binding) =>
      runPilotChat(undefined, [{ role: 'user', content: prompt }], conversationId, binding)
  })
  const relay = new PowerShellWindowsRelay({
    scriptPath: relayScriptPath,
    executablePath: process.execPath,
    launchArguments: isolatedRelayLaunchArguments({
      isolated: isolatedTestInstance,
      remoteDebuggingPort: app.commandLine.getSwitchValue('remote-debugging-port'),
      userDataPath: app.getPath('userData')
    })
  })
  scheduledTaskScheduler = new TaskScheduler(scheduledTasks, taskDispatcher, relay)
  registerTaskManagerIpc({
    ipc: ipcMain,
    store: scheduledTasks,
    scheduler: scheduledTaskScheduler,
    assertTrusted: assertTrustedRendererSender,
    onChanged: () => broadcast({ type: 'refresh', scope: 'task-manager' })
  })
  void scheduledTaskScheduler
    .start(startupTaskOccurrence)
    .then(async () => {
      for (const occurrenceId of pendingScheduledOccurrences) {
        await scheduledTaskScheduler?.runOccurrence(occurrenceId)
      }
      pendingScheduledOccurrences.clear()
      broadcast({ type: 'refresh', scope: 'task-manager' })
    })
    .catch((error) => {
      console.error('[task-manager] démarrage du scheduler impossible', error)
      broadcast({ type: 'refresh', scope: 'task-manager' })
    })

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
    if (!activeChatTurns.get(conversationId)) return { ok: false }
    const queued = pendingDirectives.get(conversationId) ?? []
    queued.push(directive)
    pendingDirectives.set(conversationId, queued)
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
  ipcMain.handle('os:runTrace', (event, path: string) => {
    assertTrustedRendererSender(event, 'RunTrace')
    return loadConvRunTrace(guardString(path, 'path'))
  })
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
  /**
   * « Ou est passe l'argent ? » sans ecrire de script. Repartition du cout par role, modele ou
   * provider, triee par cout decroissant, avec le cacheHitRatio (un ratio proche de 0 signale un
   * contexte REECRIT au lieu d'etre relu — c'est ce symptome qui a mene a la cause racine du
   * 2026-07-28, ou 114 fichiers .jsonl avaient du etre parses a la main).
   */
  ipcMain.handle(
    'os:costBreakdown',
    (_e, dimension?: 'actor' | 'model' | 'provider', convId?: string) => {
      const allowed = ['actor', 'model', 'provider'] as const
      const dim = allowed.includes(dimension as (typeof allowed)[number]) ? dimension : 'actor'
      const id = convId ? guardString(convId, 'convId') : undefined
      const calls = id ? loadPromptCalls(id) : loadAllPromptCalls()
      // LES DEUX journaux : les sous-agents les plus couteux n'existent que dans l'activite
      // (mesure conv-75 : 2,83 $ vus contre ~20,70 $ reels). costSamplesFrom deduplique.
      const activity = id ? loadConvActivity(id) : []
      return summarizeCostSamples(costSamplesFrom(calls, activity), dim as (typeof allowed)[number])
    }
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
      const preflightTraces = nativeCalls.length
        ? []
        : filterNativePreflight(nativePreflight, conversationId)
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

  // Affichage des screenshots consultés : whitelist extensions + cap taille, lecture seule.
  ipcMain.handle('os:activity:image', async (event, path: string) => {
    assertTrustedRendererSender(event, 'ActivityImage')
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

  // Desync fenêtre↔viewport (vécu) : le contenu reste parfois rendu à ses ANCIENNES métriques —
  // rogné en haut à gauche, le reste noir — jusqu'à ce qu'un vrai resize force un relayout, d'où le
  // « minimiser puis réagrandir » qui répare. Terrain propice ici : zoomFactor persistant
  // (webFrame.setZoomFactor au montage), `maximize()` juste avant `show()`, titleBarOverlay, et un
  // écran à DPI ≠ 100 %. On ne devine pas lequel déclenche : on force un recalcul COMPLET des
  // métriques sur chaque transition à risque. enableDeviceEmulation/disable recalcule layout ET
  // scale (invalidate() ne fait qu'un repaint) et ne dé-maximise pas la fenêtre.
  const forceRelayout = (): void => {
    const wc = mainWindow.webContents
    if (wc.isDestroyed()) return
    try {
      wc.enableDeviceEmulation({
        screenPosition: 'desktop',
        screenSize: { width: 0, height: 0 },
        viewPosition: { x: 0, y: 0 },
        viewSize: { width: 0, height: 0 },
        deviceScaleFactor: 0,
        scale: 1
      })
      wc.disableDeviceEmulation()
    } catch {
      // API indisponible sur un futur Electron → repli best-effort, jamais casser l'affichage.
      try {
        wc.invalidate()
      } catch {
        /* rien de mieux à faire : on laisse la fenêtre telle quelle */
      }
    }
  }
  // `on` est surchargé par nom d'event → on branche explicitement (une boucle sur une union ne typecheck pas).
  mainWindow.on('show', forceRelayout)
  mainWindow.on('restore', forceRelayout)
  mainWindow.on('maximize', forceRelayout)
  mainWindow.on('unmaximize', forceRelayout)
  relayoutMainWindow = forceRelayout

  mainWindow.on('ready-to-show', () => {
    presentAutomationWindow(mainWindow, automationInstanceMode.headless, { maximize: true })
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
if (ownsInstanceLock) {
  app.on('second-instance', (_event, commandLine, _workingDirectory, additionalData) => {
    const scheduledOccurrence =
      taskOccurrenceFromAdditionalData(additionalData) ?? taskOccurrenceFromArgs(commandLine)
    if (scheduledOccurrence) {
      if (scheduledTaskScheduler) void scheduledTaskScheduler.runOccurrence(scheduledOccurrence)
      else pendingScheduledOccurrences.add(scheduledOccurrence)
      return
    }
    const w = BrowserWindow.getAllWindows()[0]
    if (!w) {
      createWindow()
    } else {
      if (w.isMinimized()) w.restore()
      w.show()
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
  }
  registerStorageMigrationIpc(legacyStorageValues, canWriteMigrationMarker)
  registerChatIpc()
  registerTicketsIpc({
    ipc: ipcMain,
    service: tickets,
    assertTrusted: assertTrustedRendererSender,
    isolated: isolatedTestInstance
  })
  // Validation d'auth réelle en arrière-plan à chaque démarrage. Le batch est lancé avant la fenêtre,
  // sans être attendu ici : l'ouverture reste immédiate, tandis que providerStatus attend le résultat.
  startupProviderChecks = runStartupProviderProbes(
    routedProviders,
    (provider) => providerStateStore.get(provider),
    probeProviderConnection
  )
  createWindow()
  setupTray() // l'app vit en tray → fermer la fenêtre ne tue plus les runs en cours

  // #4 — diagnostic de démarrage (non bloquant) : on vérifie brain_server, CLI providers et token,
  // et on pousse le résultat au renderer (bannière) pour que l'utilisateur voie une config incomplète
  // AVANT de lancer un run, plutôt qu'un échec silencieux en plein run. Best-effort, jamais bloquant.
  //
  // brain_server n'ouvre son port qu'APRÈS le warm-up fastembed (~30-40 s sur SMB), donc un ping unique
  // au lancement échoue à tort et RESTE figé. `watchAppPreflight` re-sonde avec backoff tant que `brain`
  // échoue et pousse CHAQUE transition — dont la récupération ok qui efface la bannière. On ne pousse
  // que sur CHANGEMENT (ok-ness + set d'échecs) pour ne pas écraser un dismiss utilisateur inutilement.
  let lastPreflightSignature: string | null = null
  // SURVIE NIVEAU 3 — reprise AUTOMATIQUE au démarrage (choix explicite de l'utilisateur : pas de
  // bouton, pas de question). Un run d'orchestration tué avec la mort du process main laisse son
  // acquis persisté ; on relance ICI à la phase suivante, en réinjectant les livrables déjà produits
  // (aucune phase refaite). Rien à reprendre → aucun effet (démarrage normal strictement inchangé).
  const resumableRun = os.resumableOrchestration()
  if (resumableRun) {
    const conversationId = resumableRun.conversationId ?? '__autonomous__'
    const resumeTurnId = resumableRun.turnId ?? randomUUID()
    const legacyResumeTurn = resumableRun.turnId
      ? null
      : createOrchestrateTurnPersistence({
          conversations: os.conversations,
          conversationId,
          turnId: resumeTurnId
        })
    const resumedArtifactIds = new Set<string>()
    legacyResumeTurn?.begin(`[Reprise automatique] ${resumableRun.task}`)
    console.log(
      '[resume-orchestration]',
      resumableRun.runId,
      '→ phases déjà acquises :',
      resumableRun.phaseOutputs.map((output) => output.phase).join(', ')
    )
    // ATTENTION (bug attrapé en vérifiant) : le run REPRIS reçoit un NOUVEAU runId et persiste son
    // propre état ; `onRunSettled` n'effacerait donc jamais l'ancien fichier, et l'app rejouerait la
    // même reprise à CHAQUE démarrage. On oublie l'ancien état dès que la reprise est lancée : son
    // acquis est déjà passé dans `resumeOutputs`, et le nouveau run a sa propre persistance.
    os.forgetResumableOrchestration(resumableRun.runId)
    void os
      .runTask(
        resumableRun.task,
        (step) => {
          legacyResumeTurn?.step(step)
          persistOrchestrationStep(
            step,
            { conversationId, turnId: resumeTurnId, iteration: step.step === 'exec' ? 0 : 1 },
            undefined,
            causalTrace
          )
          appendExecutionEvidenceFileTrace(step.evidence, {
            conversationId,
            turnId: resumeTurnId,
            workspaceRoot: os.executionWorkspace
          })
          const stepArtifacts = [
            ...(step.artifacts ?? []),
            ...artifactsFromExecutionEvidence(step.evidence ?? [], {
              provider: step.provider ?? 'orchestrator',
              model: step.model,
              workspaceRoot: os.executionWorkspace
            })
          ]
          for (const artifact of stepArtifacts) {
            if (resumedArtifactIds.has(artifact.id)) continue
            resumedArtifactIds.add(artifact.id)
            try {
              const stored = materializeChatArtifact(artifact, conversationId, resumeTurnId)
              if (legacyResumeTurn) legacyResumeTurn.artifact(stored)
              else if (os.conversations.get(conversationId))
                os.conversations.applyTurnEvent(conversationId, resumeTurnId, {
                  kind: 'artifact',
                  artifact: stored
                })
              emitToLiveWindows(BrowserWindow.getAllWindows(), 'pilot:event', {
                kind: 'artifact',
                artifact: stored,
                conversationId,
                turnId: resumeTurnId
              })
            } catch {
              /* artefact best-effort pendant la reprise */
            }
          }
          for (const w of BrowserWindow.getAllWindows())
            w.webContents.send('orchestrate:step', step)
        },
        undefined,
        undefined,
        undefined,
        undefined,
        resumableRun.phaseOutputs,
        resumableRun.conversationId,
        resumableRun.bindingOverride,
        (brain) =>
          appendBrainTrace({
            ...brain,
            conversationId,
            ...(resumeTurnId ? { turnId: resumeTurnId } : {}),
            kind: 'automatic'
          }),
        resumeTurnId
      )
      .then((result) => {
        legacyResumeTurn?.succeed(result)
        return result
      })
      .catch((error: unknown) => {
        legacyResumeTurn?.fail(error instanceof Error ? error.message : String(error), false)
        console.warn('[resume-orchestration] échec de la reprise :', error)
      })
  }

  preflightWatchHandle = watchAppPreflight((result) => {
    const signature = `${result.ok}|${result.checks
      .filter((c) => !c.ok)
      .map((c) => c.id)
      .sort()
      .join(',')}`
    if (signature === lastPreflightSignature) return
    lastPreflightSignature = signature
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('preflight:result', result)
    // #2 — un rouge « brain » → tenter de DÉMARRER le service local (garde anti-doublon + tentative
    // unique par session dans ensureBrainServerStarted). Le backoff de watchAppPreflight re-sondera
    // ensuite jusqu'à sa disponibilité (warm-up fastembed). Fire-and-forget : ne bloque pas le push.
    if (result.checks.some((c) => c.id === 'brain' && !c.ok)) {
      void ensureBrainServerStarted(() => appPreflightProbes().pingBrain()).then((r) =>
        console.log('[brain-launch]', r.status, '—', r.detail)
      )
    }
  }, preflightProviderOptions())

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
app.on('before-quit', () => {
  flushConversations()
  flushScheduledTasks()
  preflightWatchHandle?.stop() // couper la boucle de re-probe démarrage (pas de timer résiduel)
  preflightWatchHandle = null
})

app.on('window-all-closed', () => {
  // Robustesse niveau 1 : on NE QUITTE PLUS quand la dernière fenêtre se ferme — l'app reste vivante
  // en tray pour que les runs en cours continuent (et que le résultat soit là à la réouverture). Le
  // quit réel passe UNIQUEMENT par le menu tray (isQuitting). La migration de démarrage garde son
  // comportement historique (elle ne quittait pas ici — elle gère son propre relaunch).
  if (isQuitting) {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
