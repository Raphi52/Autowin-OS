import { spawn } from 'node:child_process'
import { resolveClaudeBin } from './providers/claude'
import { traceActionEventId } from './activity/trace-event'
import { emitToLiveWindows } from './renderer-emit'
import {
  ClaudeAccountsStore,
  accountEnv,
  configureClaudeAccountEnv,
  describeAccounts,
  parseIdentity,
  type ClaudeIdentity
} from './claude-accounts'
import {
  app,
  shell,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  Tray,
  type IpcMainInvokeEvent,
  type WebContents
} from 'electron'
import { dirname, join } from 'path'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { buildExport, readImport, suggestedFileName } from './workflow-transfer'
import { createHash, randomUUID } from 'node:crypto'
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
import { configureSessionMemoryEcho } from './session-memory-echo'
import { configureRememberDepositStore } from './brain-remember'
import { clearBrainRetrievalCache, retrieveBrainContext } from './brain-retrieval'
import { applyBrainRetrievalScores, type BrainNoteSearchResult } from './viz/fs-brains'
import { installCrashHandlers } from './crash-handlers'
import { CostCircuitBreaker } from './cost-circuit-breaker'
import { loadOrchestrationBudget, saveOrchestrationBudget } from './orchestration-budget'
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
import type { RunLifecycleEvent } from '../shared/run-execution'
import { TraceLedger } from './activity/ledger'
import {
  listSessionsAsync,
  parseSession,
  resolveListedSessionAsync,
  resolveListedSessionImage
} from './activity/transcripts'
import { persistConversations } from './store/conversations-disk'
import { collectStdoutJournals } from './runs/journal-gc'
import {
  deleteConvRun,
  listConvRuns,
  loadConvRunTrace,
  reconcileAbandonedConvRuns
} from './runs/conv-runs'
import { deleteListedRun } from './dashboards/runs-scan'
import { createOrchestrateTurnPersistence } from './runs/orchestrate-turn-persistence'
import {
  admitAutomaticResumeRuntime,
  admitLiveReattachment,
  type OrchestrationRunState
} from './runs/orchestration-state'
import {
  appendTurnEvent,
  listUnfinishedTurns,
  pruneFinishedTurnJournals,
  readTurnJournal
} from './runs/turn-journal'
import { appendConvActivity, loadConvActivity } from './activity/conv-activity'
import { persistChatUsageSettlement } from './activity/chat-usage-settlement'
import { sameExecutionUsage, type ExecutionUsageSnapshot } from './execution-supervisor'
import { reconcileLateRunLifecycle } from './activity/late-run-usage-settlement'
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
import { rebaseTraceSequence, TraceStore } from './activity/trace-store'
import { DiagnosticCapabilities } from './activity/diagnostic-capability'
import { responseDisplayedTrace } from './activity/response-displayed-trace'
import {
  persistOrchestrationPhaseStart,
  persistOrchestrationStep,
  persistRunLifecycle
} from './activity/orchestration-observability'
import { aggregateToolUsage } from './activity/tool-usage'

import { ProfileStore, type AutowinProfile } from './profile-store'
import {
  capabilityEnabled,
  listCapabilities,
  setCapabilityEnabled,
  warmCapabilities
} from './capability-controls'
import { seedRegistrySnapshot } from './native-registry'
import { ROUTED_PROVIDERS, type RoutedProvider } from './routed-providers'
import {
  defaultBehaviourWorkspace,
  listBehaviourFiles,
  readBehaviourFileFromManifest
} from './behaviour-files'
import { ApprovedBehaviourWorkspaces, isTrustedRendererUrl } from './behaviour-access'
import { discoverConfiguredSkillRegistry } from './skill-registry'
import { listClaudeHooks, listCodexHooks } from './claude-hooks'
import { ModelQuestionHub, type ModelQuestion, type PendingModelQuestion } from './model-questions'
import {
  discoverImportedModels,
  findModel,
  loadCachedImportedModels,
  type ImportedModel
} from './models'
import { FabricControlPlane, type FabricNodeSummary } from './compute-fabric/control-plane'
import { FetchFabricManifestClient } from './compute-fabric/manifest-client'
import { createFabricNodeTransportStore } from './compute-fabric/node-transport-store'
import { createFabricProductBindings } from './compute-fabric/product-bridge'
import { createCheckpointForkManifest } from './wire-checkpoint-fork'
import { recommendShadowRoute } from './shadow-router'
import { ModelCatalogRefresher } from './model-refresh'
import { buildModelQuotaSnapshot, getModelQuotaSnapshot } from './model-quotas'
import { loadAgentTopology, saveAgentTopology } from './topology-disk'
import { migrateTopologyShape } from './topology'
import type { AgentTopology, SlotBinding } from './topology'
import {
  assertRuntimeTopologyAvailable,
  runtimeRoleBinding,
  runtimeRoleSlots,
  topologyWithRuntimeRole,
  UnresolvedRuntimeModelError
} from './runtime-topology'
import {
  configureAutowinAppDataBase,
  createAutowinAppDataRoot,
  ensureAutowinAppData,
  legacyAppDataRoot,
  portableAppDataBase,
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
import { checkForUpdate, applyUpdate, type UpdateStrategy } from './git-update'
import { restartApplication } from './app-restart'
import {
  ChatArtifactPreviewBudget,
  MAX_ARTIFACT_PREVIEW_BYTES,
  materializeChatArtifact,
  materializeUserImageArtifact,
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
import { resumeActionFor, runIsProducing, waitUntilRunCanResume } from './runs/run-reattach'
import {
  activeWorkflowProfile,
  loadWorkflowProfiles,
  removeWorkflowProfile,
  saveWorkflowProfiles,
  seedDefaultWorkflows,
  selectWorkflowProfile,
  upsertWorkflowProfile,
  type WorkflowProfile,
  type WorkflowProfilesFile
} from './workflow-profiles'
import { overrideFor, registerWorkflowBenchIpc } from './workflow-bench-ipc'
import {
  DEFAULT_BRAIN_GRACE_MS,
  decidePreflightAnnouncement,
  type BrainLaunchOutcome
} from './preflight-announce'
import {
  graphDefects,
  worstCaseNodeExecutions,
  type WorkflowGraph
} from './workflow-graph'
import { recapMessage, summarizeJournal } from './runs/journal-replay'
import { tailJournalOnce } from './runs/stdout-journal'
import { defaultProcessIdentity } from './store/worktree-manager'
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
  probeResultStatus
} from './provider-status'
import { ProviderStateStore, type ProviderMode } from './provider-state-store'
import { compileExecutionQuote } from './execution-quote'
import { loadTokens } from './providers/codex-auth'
import { artifactsFromExecutionEvidence } from './providers/artifacts'

import { amitelBrainRoot, createAmitelContextProvider } from './amitel-context'
import { readGitState, readGitDiff } from './git-read-main'
import {
  captureWorkspaceMutationSnapshot,
  captureWorkspacePathGenerationMarker
} from './providers/workspace-mutation-evidence'
import { readGitGraph } from './git-graph-main'
import { readWorktreeMap } from './worktree-map-main'
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
import {
  AutoKaizenSupervisor,
  inheritAutoKaizenAuthority,
  incidentFromPilotEvent,
  type AutoKaizenIncidentInput
} from './auto-kaizen-supervisor'

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
let isolatedConversationReadCount = 0
const headlessTestInstance = automationInstanceMode.headless
const explicitUserDataPath = resolveExplicitUserDataDir(process.argv)
// STOCKAGE PORTABLE : l'app écrit dans SON dossier, plus dans `%APPDATA%`. Mesuré le 2026-08-07,
// supprimer le dossier du projet laissait 1,8 Go derrière lui. `dirname(app.getPath('exe'))` et non
// `app.getAppPath()` en packagé : ce dernier pointe dans l'asar, où rien ne s'écrit.
const appDataRoot = resolveIsolatedAppDataBase(
  resolveAutowinAppDataBase(
    portableAppDataBase(app.getAppPath(), dirname(app.getPath('exe')), app.isPackaged),
    app.isPackaged
  ),
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
configureSessionMemoryEcho(join(app.getPath('userData'), 'session-memory.json'))
configureRememberDepositStore(join(app.getPath('userData'), 'remember-deposits.json'))
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
// SORTIE DE L'ÉTAT D'ATTENTE. Un tour laissé `streaming` sur disque appartient à un run mort avec
// l'app : plus aucun process ne viendra le clore. Le chargement le clôt donc et le DIT dans la
// conversation d'origine — sauf pour les tours dont le checkpoint survit, qui vont vraiment
// reprendre quelques lignes plus bas. Sans ce discriminant on mentirait dans un sens ou dans l'autre.
const resumableTurnIds = new Set(
  os
    .resumableOrchestrations()
    .map((state) => state.turnId)
    .filter((turnId): turnId is string => Boolean(turnId))
)
const flushConversations = persistConversations(os.conversations, undefined, { resumableTurnIds })
const scheduledTasks = new TaskStore()
const flushScheduledTasks = persistTaskStore(scheduledTasks)
let scheduledTaskScheduler: TaskScheduler | undefined
let autoKaizenSupervisor: AutoKaizenSupervisor | undefined
const pendingScheduledOccurrences = new Set<string>()
const chatArtifactPreviewBudget = new ChatArtifactPreviewBudget()
const budgetedArtifactRenderers = new Set<number>()

/** Diffuse un événement d'app à toutes les fenêtres (UI live quand un agent pilote). */
function broadcast(e: AppEvent): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('app:event', e)
  if (!autoKaizenSupervisor) return
  if (e.type === 'orchestrate-step' && e.convId && e.step.status === 'failed') {
    const attempt = e.step.execution?.attemptId ?? `${e.step.step}:${e.step.provider ?? 'unknown'}`
    autoKaizenSupervisor.report({
      dedupeKey: `orchestration-step:${e.runPath ?? e.convId}:${attempt}`,
      sourceConversationId: e.convId,
      kind: e.step.step === 'gate' ? 'gate-failed' : 'orchestration-step-failed',
      summary: `${e.step.step} a échoué`,
      detail: e.step.error ?? e.step.detail ?? e.step.text ?? 'Étape en échec sans détail',
      lineage: autoKaizenSupervisor.lineageForConversation(e.convId)
    })
  } else if (e.type === 'orchestrate-end' && e.convId && e.status === 'red') {
    autoKaizenSupervisor.report({
      dedupeKey: `orchestration-end:${e.runPath ?? e.convId}:red`,
      sourceConversationId: e.convId,
      kind: 'orchestration-red',
      summary: 'Une orchestration s’est terminée en rouge',
      detail: e.runPath ? `RUN en échec : ${e.runPath}` : 'Orchestration rouge sans RUN associé',
      lineage: autoKaizenSupervisor.lineageForConversation(e.convId)
    })
  }
}
/** Bus de commandes (plan de contrôle) + pilote agent (tool-loop). */
function reportAutoKaizen(input: AutoKaizenIncidentInput): void {
  const supervisor = autoKaizenSupervisor
  if (!supervisor || !os.conversations.get(input.sourceConversationId)) return
  supervisor.report({
    ...input,
    lineage: input.lineage ?? supervisor.lineageForConversation(input.sourceConversationId)
  })
}

const bus = new AppCommandBus(
  os,
  broadcast,
  undefined,
  undefined,
  (name) => capabilityEnabled('tools', name) !== false,
  undefined,
  // Fermetures PARESSEUSES : le service Tickets est construit plus bas dans ce module, alors que le
  // bus l'est ici. Elles ne sont évaluées qu'à l'exécution d'une commande, donc bien après.
  // Les sources sont relues à CHAQUE appel : le modèle nomme au plus un `sourceId`, jamais un profil.
  () => tickets.sources().map((summary) => summary.profile),
  (request) => tickets.create(request),
  (request) => tickets.list(request),
  (request) => tickets.get(request)
)
seedRegistrySnapshot({
  tools: bus.catalog().map((command) => ({
    id: command.name,
    label: command.name,
    description: command.description,
    enabled: true,
    mutable: true,
    source: 'app-command-bus'
  }))
})
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
  () => projectContextBlock(os.executionWorkspace),
  () => os.executionWorkspace
)
const conversationRouteCoordinator = new ConversationRouteCoordinator(
  os.conversations,
  new ConversationRouter(os.registry, os.roles, os.executionSupervisor, () => os.waitUntilReady())
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
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  try {
    const quote = compileExecutionQuote(`provider-probe:${id}`, {
      maxProviderCalls: 1,
      maxTotalTokens: 100_000,
      maxUsd: 0.05
    })
    quote.phases = []
    quote.decomposition = { mode: 'disabled', maxNodes: 1 }
    quote.limits.maxAgents = 0
    quote.limits.maxConcurrency = 1
    quote.limits.maxDurationMs = PROVIDER_PROBE_TIMEOUT_MS
    quote.limits.maxRecoveries = 0
    quote.limits.maxFreshTokens = Math.min(quote.limits.maxFreshTokens, 25_000)
    const timeoutController = new AbortController()
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        const message = `pas de reponse de ${id} apres ${PROVIDER_PROBE_TIMEOUT_MS} ms`
        timeoutController.abort(message)
        reject(new Error(`pas de reponse de ${id} apres ${PROVIDER_PROBE_TIMEOUT_MS} ms`))
      }, PROVIDER_PROBE_TIMEOUT_MS) // sleep-ok: garde-timeout bornant un vrai appel provider (réseau/CLI)
    })
    const result = (await os.executionSupervisor.run(quote, timeoutController.signal, () =>
      Promise.race([
        // Probe minimal : aucun kit système injecté, pour éviter de facturer le contexte applicatif.
        os.registry.send(id, [{ role: 'user', content: 'ping' }], {
          system: '',
          signal: timeoutController.signal
        }),
        timeout
      ])
    )) as { text?: string }
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
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}

function preflightProviderOptions(): { standbyProviders: RoutedProvider[] } {
  return {
    standbyProviders: ROUTED_PROVIDERS.filter(
      (provider) => providerStateStore.get(provider).mode === 'standby'
    )
  }
}
const agentTopologyPath = join(app.getPath('userData'), 'agent-topology.json')
const modelCatalogCachePath = join(app.getPath('userData'), 'model-catalog.json')

// Comptes Claude multiples (bascule en un clic). Le store est cree tot et branche AUSSITOT sur
// `configureClaudeAccountEnv` : tout spawn du CLI Claude — run, sonde d'auth, login — lit le
// CLAUDE_CONFIG_DIR du compte actif par ce seul canal. Tant qu'aucun second compte n'existe, il
// rend {} et le comportement est celui d'avant.
const claudeAccounts = new ClaudeAccountsStore(
  join(app.getPath('userData'), 'claude-accounts.json'),
  join(app.getPath('userData'), 'claude-accounts')
)
configureClaudeAccountEnv(() => claudeAccounts.env())
// Le cache est chargé AVANT la topologie : un bridge momentanément incomplet ne rase pas les bindings existants.
let agentModels = loadCachedImportedModels(modelCatalogCachePath)
const fabricControlPlane = new FabricControlPlane({
  statePath: join(app.getPath('userData'), 'compute-fabric.json'),
  manifestClient: new FetchFabricManifestClient(),
  transportStoreFactory: createFabricNodeTransportStore
})
let fabricModels: ImportedModel[] = []
let isolatedFabricFixtureSummary: FabricNodeSummary | null = null

function applyFabricSummaries(summaries: FabricNodeSummary[]): void {
  fabricModels = summaries.flatMap((summary) => {
    const bindings = createFabricProductBindings(summary)
    for (const resource of summary.resources) {
      if (resource.modes.includes('local-tools')) {
        os.registry.register(
          fabricControlPlane.createLocalToolsAdapter(summary.nodeId, resource.id)
        )
      }
    }
    return bindings.models
  })
  agentModels = [
    ...agentModels.filter((model) => model.compute?.kind !== 'fabric'),
    ...fabricModels
  ]
  os.roles.setCatalog(agentModels)
}

async function refreshFabricNodes(): Promise<FabricNodeSummary[]> {
  await Promise.allSettled(
    fabricControlPlane
      .list()
      .filter((node) => node.trust === 'paired')
      .map((node) => fabricControlPlane.refresh(node.nodeId))
  )
  const summaries = fabricControlPlane.list()
  applyFabricSummaries(summaries)
  return summaries
}
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
          ...agentTopology.panels.frame,
          ...agentTopology.panels.terrain,
          ...agentTopology.panels.judge
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
      applyFabricSummaries(fabricControlPlane.list())
      // Les défauts de rôle (provider-only) se résolvent désormais par alias de famille
      // contre le catalogue découvert ; les bindings existants (modèle explicite) restent intacts.
      os.roles.setCatalog(agentModels)
      agentTopology = loadAgentTopology(agentTopologyPath, agentModels)
      syncRuntimeTopology(agentTopology)
      os.setTaskReadiness(runtimeTopologyReadiness(agentTopology))
      broadcast({ type: 'refresh', scope: 'roles' })
    }
  }
)
// Le cache est une source valide même si la découverte live revient vide ou échoue. Projeter la
// topologie AVANT le refresh empêche un ancien roles.json de survivre à tout le démarrage.
syncRuntimeTopology(agentTopology)
const agentModelsReady = modelCatalog.refresh(true)
const fabricNodesReady = agentModelsReady.then(() => refreshFabricNodes())
os.setTaskReadiness(
  Promise.all([agentModelsReady, fabricNodesReady]).then(() =>
    assertRuntimeTopologyAvailable(agentTopology, agentModels)
  )
)

function runtimeTopologyReadiness(topology: AgentTopology): Promise<void> {
  return Promise.resolve().then(() => assertRuntimeTopologyAvailable(topology, agentModels))
}

function syncRuntimeTopology(topology: AgentTopology): void {
  const sync = (role: Role, binding: SlotBinding): void => {
    try {
      os.setRole(role, runtimeRoleBinding(binding, agentModels))
    } catch (error) {
      if (!(error instanceof UnresolvedRuntimeModelError)) throw error
      // Identité visible et fail-closed : aucun ancien rôle d'un autre provider ne survit, mais la
      // readiness bloque l'appel provider tant que l'alias n'a pas de transport découvert.
      os.setRole(role, {
        provider: binding.provider,
        model: binding.modelId,
        reasoningEffort: binding.reasoningEffort
      })
    }
  }
  for (const [role, binding] of Object.entries(runtimeRoleSlots(topology)) as Array<
    [Role, SlotBinding]
  >) {
    sync(role, binding)
  }
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
    terrain: toMembers(topology.panels.terrain),
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
bus.setTraceStore(causalTrace)

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
  //
  // `os.executionWorkspace` et NON `process.cwd()` : dans l'app PACKAGÉE, le cwd est le dossier de
  // lancement de l'exécutable, pas le dépôt. `git fetch` y échoue (« not a git repository »),
  // l'erreur est capturée en `{ available: false }` et la bannière reste MUETTE. Symptôme observé
  // le 2026-08-04 : des merges sur `main` ne faisaient apparaître aucun bouton chez les collègues,
  // alors que la bannière fonctionnait en développement — où le cwd EST le dépôt, par accident.
  // Tout le reste de ce fichier utilise déjà `os.executionWorkspace` ; ces deux appels étaient les
  // seuls à ne pas le faire.
  ipcMain.handle('update:check', (event) => {
    assertTrustedRendererSender(event, 'Update')
    return checkForUpdate(os.executionWorkspace)
  })
  ipcMain.handle('update:apply', async (event, strategy?: UpdateStrategy) => {
    assertTrustedRendererSender(event, 'Update')
    // La stratégie vient du BOUTON cliqué : hors de main, c'est ce qui distingue une intégration
    // demandée d'un merge fabriqué dans le dos de l'utilisateur.
    const result = await applyUpdate(os.executionWorkspace, strategy ? { strategy } : {})
    if (result.ok && result.reload) {
      // Le changement ne touche que le renderer : on recharge les FENÊTRES et le process principal
      // reste vivant — donc les runs en cours, les connexions et l'état en mémoire survivent.
      // `reloadIgnoringCache` et pas `reload` : un bundle reconstruit sous le même nom serait
      // resservi depuis le cache, et l'utilisateur verrait l'ANCIEN écran en croyant l'avoir mis
      // à jour — un faux vert particulièrement traître puisqu'il ressemble à un succès.
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.reloadIgnoringCache()
      }
    } else if (result.ok && result.relaunch) {
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
  ipcMain.handle('app:test:seed-artifact-previews', (event, htmlOnly = false) => {
    assertTrustedRendererSender(event, 'Fixture artifact previews')
    if (!isolatedTestInstance) throw new Error('Fixture indisponible hors instance isolée')
    const conversation = os.conversations.create({
      title: htmlOnly ? 'HTML rendu · fixture' : 'Galerie · artefacts modèles',
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
    os.conversations.applyTurnEvent(conversation.id, previewTurnId, {
      kind: 'delta',
      streamId: 'html-render-fixture',
      text: `Voici la même réponse, mais pensée comme une surface plutôt qu'un mur de texte.

\`\`\`html-render
<!-- <head> hostile : la CSP doit rester active malgré ce faux tag -->
<!doctype html>
<html lang="fr">
<head>
  <meta http-equiv="refresh" content="0;url=http://127.0.0.1:9262/autowin-html-render-meta-refresh-canary">
  <style>
    :root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 22px; color: #f7f9fb; background: radial-gradient(circle at 12% 0%, #163f38, #080d12 50%); }
    .eyebrow { color: #6ee7c0; font: 700 11px/1.2 ui-monospace, monospace; letter-spacing: .14em; text-transform: uppercase; }
    h1 { max-width: 620px; margin: 10px 0 18px; font-size: clamp(25px, 5vw, 43px); line-height: 1.03; }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .card { min-width: 0; padding: 14px; border: 1px solid #ffffff18; border-radius: 13px; background: #ffffff0a; }
    .card strong { display: block; margin-bottom: 6px; color: #8ef0d2; font-size: 20px; }
    .card span { color: #a9b4c0; font-size: 12px; line-height: 1.45; }
    .security { display: flex; flex-wrap: wrap; gap: 7px; margin: 18px 0; }
    .pill { padding: 6px 9px; border: 1px solid #52d6ab55; border-radius: 999px; color: #9debd3; background: #13352c; font-size: 11px; }
    details { padding: 10px 12px; border: 1px solid #52d6ab55; border-radius: 10px; color: #b7c1cc; background: #0c1717; font-size: 12px; }
    summary { color: #75e8c5; font-weight: 800; cursor: pointer; }
    details p { margin: 10px 0 2px; }
    @media (max-width: 560px) { .grid { grid-template-columns: 1fr; } body { padding: 16px; } }
  </style>
</head>
<body>
  <img src="http://127.0.0.1:9262/autowin-html-render-network-canary.png" alt="" hidden>
  <div class="eyebrow">Autowin · réponse vivante</div>
  <h1>Comprendre en un regard, explorer si besoin.</h1>
  <div class="grid">
    <div class="card"><strong>01</strong><span>Le texte normal reste simple et rapide.</span></div>
    <div class="card"><strong>02</strong><span>Le HTML compose cartes, rythme et hiérarchie.</span></div>
    <div class="card"><strong>03</strong><span>Les interactions restent enfermées ici.</span></div>
  </div>
  <div class="security">
    <span class="pill">DOM parent isolé</span><span class="pill">API Autowin absente</span><span class="pill">Réseau coupé</span>
  </div>
  <details id="native-interaction"><summary>Explorer le détail</summary><p>Interaction HTML native, toujours sans accès à Autowin.</p></details>
  <a id="network-navigation-canary" href="http://127.0.0.1:9262/autowin-html-render-link-canary">Lien réseau canari</a>
  <script>document.documentElement.dataset.forbiddenScript = 'executed';</script>
</body>
</html>
\`\`\`

Le fil reprend ensuite normalement.`
    })
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
    if (!htmlOnly) {
      for (const artifact of fixtureArtifacts) {
        const stored = materializeChatArtifact(artifact, conversation.id, previewTurnId)
        os.conversations.applyTurnEvent(conversation.id, previewTurnId, {
          kind: 'artifact',
          artifact: stored
        })
      }
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
    if (
      appEvent.type === 'refresh' &&
      appEvent.scope !== 'conversations' &&
      appEvent.scope !== 'chat'
    )
      throw new Error('Scope de refresh de test interdit')
    broadcast(appEvent as unknown as AppEvent)
    return true
  })
  ipcMain.handle('app:test:conversation-read-count', (event, reset?: unknown) => {
    assertTrustedRendererSender(event, 'Compteur conversation de test')
    if (!isolatedTestInstance) throw new Error('Compteur de test indisponible hors instance isolée')
    const count = isolatedConversationReadCount
    if (reset === true) isolatedConversationReadCount = 0
    return count
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
  // --- Comptes Claude multiples : lister / basculer / ajouter / retirer ---
  // Un compte = un CLAUDE_CONFIG_DIR (mecanisme verifie sur le CLI reel). Basculer ne relance
  // aucun login : les sessions restent stockees cote a cote, comme dans claude.exe.
  const claudeAccountsPayload = (): {
    activeId: string
    accounts: Array<{
      id: string
      displayName: string
      tier: string
      email?: string
      active: boolean
    }>
  } => {
    const state = claudeAccounts.current()
    return {
      activeId: state.activeId,
      accounts: describeAccounts(state.accounts, state.activeId).map((account) => ({
        id: account.id,
        displayName: account.displayName,
        tier: account.tier,
        email: account.email,
        active: account.active
      }))
    }
  }

  /**
   * Sonde l'identite REELLE d'un compte : `claude auth status` dans SON dossier de configuration.
   * C'est le seul moyen de distinguer deux comptes qui partagent la meme adresse mail et ne
   * different que par le niveau d'abonnement (`subscriptionType`) — le cas d'usage demande.
   * Borne dans le temps et fail-open : une sonde muette laisse le compte tel quel, elle ne doit
   * jamais bloquer l'affichage de la liste.
   */
  const probeAccountIdentity = async (accountId: string): Promise<void> => {
    const account = claudeAccounts.find(accountId)
    if (!account) return
    const identity = await new Promise<ClaudeIdentity | undefined>((resolve) => {
      let out = ''
      let settled = false
      const done = (value: ClaudeIdentity | undefined): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      }
      const timer = setTimeout(() => done(undefined), 8000)
      try {
        const child = spawn(resolveClaudeBin(), ['auth', 'status'], {
          windowsHide: true,
          shell: false,
          env: { ...process.env, ...accountEnv(account) }
        })
        child.stdout?.on('data', (chunk: Buffer) => {
          out += chunk.toString('utf8')
        })
        child.on('error', () => done(undefined))
        child.on('close', () => done(parseIdentity(out)))
      } catch {
        done(undefined)
      }
    })
    claudeAccounts.setIdentity(accountId, identity)
  }

  /** Sonde TOUS les comptes en parallele — la liste ne vaut que si chaque puce dit vrai. */
  const refreshAllAccountIdentities = async (): Promise<void> => {
    await Promise.all(
      claudeAccounts.current().accounts.map((account) => probeAccountIdentity(account.id))
    )
  }

  ipcMain.handle('os:claudeAccounts:list', async (event) => {
    assertTrustedRendererSender(event, 'Claude accounts list')
    await refreshAllAccountIdentities()
    return claudeAccountsPayload()
  })
  ipcMain.handle('os:claudeAccounts:refresh', async (event) => {
    assertTrustedRendererSender(event, 'Claude accounts refresh')
    await refreshAllAccountIdentities()
    return claudeAccountsPayload()
  })
  ipcMain.handle('os:claudeAccounts:add', (event, label: unknown) => {
    assertTrustedRendererSender(event, 'Claude accounts add')
    const account = claudeAccounts.add(typeof label === 'string' ? label : undefined)
    // On enchaine directement sur le login DANS LE DOSSIER DU NOUVEAU COMPTE : un compte ajoute
    // mais jamais authentifie ne servirait a rien, et l'utilisateur n'a aucun moyen de le faire
    // lui-meme depuis l'app.
    os.startProviderLogin('claude', account.dir)
    return claudeAccountsPayload()
  })
  ipcMain.handle('os:claudeAccounts:switch', (event, id: unknown) => {
    assertTrustedRendererSender(event, 'Claude accounts switch')
    claudeAccounts.switchTo(guardString(id, 'id'))
    return claudeAccountsPayload()
  })
  ipcMain.handle('os:claudeAccounts:remove', (event, id: unknown) => {
    assertTrustedRendererSender(event, 'Claude accounts remove')
    claudeAccounts.remove(guardString(id, 'id'))
    return claudeAccountsPayload()
  })
  ipcMain.handle('os:claudeAccounts:login', (event, id: unknown) => {
    assertTrustedRendererSender(event, 'Claude accounts login')
    const wanted = guardString(id, 'id')
    const account = claudeAccounts.current().accounts.find((entry) => entry.id === wanted)
    if (!account) throw new Error(`compte Claude inconnu : ${wanted}`)
    os.startProviderLogin('claude', account.dir)
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
    await os.waitUntilReady()
    const runtimeSnapshot = os.captureOrchestrationRuntime()
    const orchestratorBinding = runtimeSnapshot.roles.orchestrator
    // #6 — un conversationId explicite (ex. traitement ticket) lance la VRAIE pipeline scout→frame→
    // build→judge SUR cette conversation ; sinon on retombe sur la conversation active (comportement historique).
    const conversationId = targetConversationId ?? bus.activeConversationId ?? '__autonomous__'
    // #2 — run STOPPABLE : on enregistre un AbortController dans le registre du bus pour que
    // `os:orchestrate:cancel` → abortOrchestration(conversationId) le coupe réellement (sinon no-op).
    const controller = bus.registerOrchestration(conversationId)
    const turnId = randomUUID()
    // FRONTIÈRE DE PERSISTANCE : le run direct n'écrivait que le ledger et `orchestrate:step` (canal
    // sans aucun abonné renderer) — le fil restait VIDE, échec compris. On persiste donc le tour
    // comme le fait `os:pilotChat` : ouverture, une carte par étape, état terminal systématique.
    const durableTurn = createOrchestrateTurnPersistence({
      conversations: os.conversations,
      conversationId,
      turnId,
      runtime: {
        provider: orchestratorBinding.provider,
        model: orchestratorBinding.model,
        reasoningEffort: orchestratorBinding.reasoningEffort
      },
      journal: (durableEvent) =>
        appendTurnEvent(turnJournalRoot, conversationId, turnId, {
          ...durableEvent,
          at: Date.now()
        })
    })
    const emittedArtifactIds = new Set<string>()
    let currentRunId: string | undefined
    let terminalLifecycle: Extract<RunLifecycleEvent, { stage: 'closure' }> | undefined
    let resumedCheckpointReleased = false
    let phaseStartIteration = 0
    try {
      durableTurn.begin(guardString(task, 'task'))
      // Acquis d'un run interrompu portant la MÊME tâche dans CETTE conversation.
      const resumedAcquis =
        os.resumableOrchestrationForTask?.(
          guardString(task, 'task'),
          conversationId,
          Date.now(),
          undefined,
          runtimeSnapshot
        ) ?? null
      const result = await os.runTask(
        guardString(task, 'task'),
        (step) => {
          persistOrchestrationStep(
            step,
            {
              conversationId,
              turnId,
              iteration: step.step === 'exec' ? 0 : 1,
              runId: currentRunId
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
        },
        (phase) => {
          if (!currentRunId) return
          persistOrchestrationPhaseStart(
            phase,
            {
              conversationId,
              turnId,
              iteration: phaseStartIteration++,
              runId: currentRunId
            },
            causalTrace
          )
        },
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
        turnId,
        (lifecycle) => {
          currentRunId = lifecycle.runId
          if (resumedAcquis && !resumedCheckpointReleased) {
            resumedCheckpointReleased = true
            os.forgetResumableOrchestration(resumedAcquis.runId)
          }
          if (lifecycle.stage === 'closure') terminalLifecycle = lifecycle
          persistRunLifecycle(lifecycle, { conversationId, turnId }, causalTrace)
        },
        resumedAcquis ?? undefined,
        (usage) => {
          if (!currentRunId) return
          const settledLifecycle = reconcileLateRunLifecycle(terminalLifecycle, usage)
          if (!settledLifecycle) return
          terminalLifecycle = settledLifecycle
          persistRunLifecycle(terminalLifecycle, { conversationId, turnId }, causalTrace)
          broadcast({ type: 'orchestrate-usage', convId: conversationId })
          broadcast({ type: 'refresh', scope: 'workflows' })
          broadcast({ type: 'refresh', scope: 'orchestration' })
        },
        runtimeSnapshot
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
  ipcMain.handle('os:behaviourComposition', async (event, requestedWorkspace?: unknown) => {
    assertTrustedRendererSender(event, 'Behaviour composition')
    const workspace = requestedWorkspace
      ? behaviourAccess.require(guardString(requestedWorkspace, 'workspace'))
      : defaultBehaviourRoot
    const composition = buildBehaviourComposition(
      os.roles,
      process.env,
      agentTopology,
      loadOrchestrationBudget(orchestrationBudgetPath).maxUsd
    )
    const files = await listBehaviourFiles(workspace)
    const inspectedFiles = await Promise.all(
      files.map(async (file) => ({
        ...file,
        excerpt:
          file.active || file.state === 'declared'
            ? (await readBehaviourFileFromManifest(file.id, files, workspace)).slice(0, 2_000)
            : undefined
      }))
    )
    return { ...composition, inspection: { workspace, files: inspectedFiles } }
  })
  ipcMain.handle('app:test:behaviour-fixture:install', (event) => {
    assertTrustedRendererSender(event, 'Fixture Behaviour')
    if (!isolatedTestInstance)
      throw new Error('Fixture Behaviour indisponible hors instance isolée')
    const workspace = join(app.getPath('userData'), 'wire-behaviour-workspace')
    mkdirSync(workspace, { recursive: true })
    writeFileSync(
      join(workspace, 'AGENTS.md'),
      '# Wire Behaviour\n\nINSTRUCTION_WORKSPACE_WIRE_ACTIVE\n',
      'utf8'
    )
    return behaviourAccess.approve(workspace)
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
  // Vue Worktrees : état des copies git enrichi du retard, de la saleté et de la taille disque —
  // trois grandeurs que `git worktree list --porcelain` ne donne pas. Lecture seule.
  ipcMain.handle('git:worktreeMap', (event, cwd?: string) => {
    assertTrustedRendererSender(event, 'GitWorktreeMap')
    return readWorktreeMap(
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
  ipcMain.handle('os:roles', async () => {
    await agentModelsReady
    return os.roles.all()
  })
  // WORKFLOWS NOMMÉS : lire, écrire, sélectionner. La sélection ne PILOTE encore rien — c'est la
  // pièce qui rend un workflow nommable et choisissable, préalable à la comparaison de plusieurs
  // façons de faire sur un même objectif.
  /**
   * Porte le workflow ACTIF jusqu'au moteur.
   *
   * Sans cet appel, `activeId` n'était qu'une préférence écrite sur disque que PERSONNE ne lisait :
   * `setActiveWorkflow` n'était sollicité que par le banc de comparaison, qui le pose puis le retire
   * aussitôt. Le graphe composé, ses personas et ses retours bornés n'avaient donc AUCUN effet sur un
   * tour de chat — la feature était entièrement décorative. On applique à l'ouverture ET à chaque
   * changement de sélection, sinon l'un des deux chemins retombe dans le même piège.
   */
  const appliquerWorkflowActif = (fichier: WorkflowProfilesFile): void => {
    const actif = activeWorkflowProfile(fichier)
    const override = overrideFor(actif ?? null)
    // Activé depuis la vue = choix EXPLICITE : la proportionnalité ne doit pas l'écarter en silence.
    os.setActiveWorkflow(override ? { ...override, explicit: true } : undefined)
  }
  // Le semis d'origine précède l'application : sinon la toute première ouverture montrerait une vue
  // vide, et le moteur n'aurait rien à porter.
  appliquerWorkflowActif(seedDefaultWorkflows())

  ipcMain.handle('os:workflowProfiles:get', (event) => {
    assertTrustedRendererSender(event, 'Workflow profiles')
    return loadWorkflowProfiles()
  })
  ipcMain.handle('os:workflowProfiles:upsert', (event, raw: unknown) => {
    assertTrustedRendererSender(event, 'Workflow profiles')
    const next = upsertWorkflowProfile(loadWorkflowProfiles(), raw as WorkflowProfile)
    saveWorkflowProfiles(next)
    // Éditer le graphe du workflow ACTIF doit prendre effet tout de suite : sinon le moteur
    // continuerait de jouer la version d'avant, sans que rien ne le signale.
    appliquerWorkflowActif(next)
    return next
  })
  ipcMain.handle('os:workflowProfiles:remove', (event, rawId: unknown) => {
    assertTrustedRendererSender(event, 'Workflow profiles')
    const next = removeWorkflowProfile(loadWorkflowProfiles(), guardString(rawId, 'id'))
    saveWorkflowProfiles(next)
    // Supprimer le workflow actif doit le retirer du moteur, pas le laisser piloter un profil mort.
    appliquerWorkflowActif(next)
    return next
  })
  ipcMain.handle('os:workflowProfiles:select', (event, rawId: unknown) => {
    assertTrustedRendererSender(event, 'Workflow profiles')
    const id = rawId === null ? null : guardString(rawId, 'id')
    const next = selectWorkflowProfile(loadWorkflowProfiles(), id)
    saveWorkflowProfiles(next)
    appliquerWorkflowActif(next)
    return next
  })
  /**
   * Sortir un ou tous les workflows vers un fichier. Un workflow est une façon de travailler : elle
   * se partage et se versionne, elle ne doit pas rester prisonnière d'un %APPDATA%.
   */
  ipcMain.handle('os:workflowProfiles:export', async (event, rawId: unknown) => {
    assertTrustedRendererSender(event, 'Workflow profiles')
    const fichier = loadWorkflowProfiles()
    const id = rawId === null || rawId === undefined ? null : guardString(rawId, 'id')
    const choisis = id ? fichier.profiles.filter((p) => p.id === id) : fichier.profiles
    if (!choisis.length) return { ok: false as const, reason: 'aucun workflow à exporter' }
    const win = BrowserWindow.fromWebContents(event.sender)
    const cible = await (win
      ? dialog.showSaveDialog(win, { defaultPath: suggestedFileName(id ? choisis[0] : undefined) })
      : dialog.showSaveDialog({ defaultPath: suggestedFileName(id ? choisis[0] : undefined) }))
    if (cible.canceled || !cible.filePath) return { ok: false as const, reason: 'annulé' }
    const paquet = buildExport(choisis, new Date().toISOString())
    writeFileSync(cible.filePath, JSON.stringify(paquet, null, 2), 'utf8')
    return { ok: true as const, path: cible.filePath, count: choisis.length }
  })
  /**
   * Faire entrer des workflows depuis un fichier. Le contenu n'est JAMAIS cru : il passe par le même
   * assainisseur que la relecture locale, et un identifiant en collision est ré-attribué plutôt que
   * d'écraser en silence le workflow d'à côté.
   */
  ipcMain.handle('os:workflowProfiles:import', async (event) => {
    assertTrustedRendererSender(event, 'Workflow profiles')
    const win = BrowserWindow.fromWebContents(event.sender)
    const choix = await (win
      ? dialog.showOpenDialog(win, { properties: ['openFile'] })
      : dialog.showOpenDialog({ properties: ['openFile'] }))
    if (choix.canceled || !choix.filePaths.length) {
      return { ok: false as const, reason: 'annulé', file: loadWorkflowProfiles() }
    }
    let brut: unknown
    try {
      // Le BOM est retiré : sous Windows, presque tout ce qui écrit un JSON à la main en pose un.
      brut = JSON.parse(readFileSync(choix.filePaths[0], 'utf8').replace(/^﻿/, ''))
    } catch {
      return { ok: false as const, reason: 'fichier illisible', file: loadWorkflowProfiles() }
    }
    let fichier = loadWorkflowProfiles()
    const { profiles, rejected } = readImport(brut, fichier.profiles)
    for (const profil of profiles) fichier = upsertWorkflowProfile(fichier, profil)
    if (profiles.length) saveWorkflowProfiles(fichier)
    return { ok: true as const, imported: profiles.length, rejected, file: fichier }
  })
  // La validité d'un graphe composé. Calculée côté main pour que le canevas et l'exécution partagent
  // exactement la même règle — deux vérités divergeraient tôt ou tard.
  //
  // `inertReturns` a disparu de ce contrat : depuis que l'orchestrateur MARCHE le graphe, aucun
  // retour n'est inerte. Le champ ne rendait plus qu'un tableau vide, et la mention qu'il pilotait
  // à l'écran (« le moteur ne sait pas encore le jouer ») était devenue un mensonge inatteignable.
  ipcMain.handle('os:workflowGraph:check', (event, raw: unknown) => {
    assertTrustedRendererSender(event, 'Workflow graph')
    const graph = raw as WorkflowGraph
    const defects = graphDefects(graph)
    return {
      defects,
      worstCaseNodeExecutions: defects.length ? null : worstCaseNodeExecutions(graph)
    }
  })
  // Quel workflow pilote CETTE conversation. Par conversation et non global : on veut un fil en
  // Rapide pendant qu'un autre tourne en Rigoureux.
  ipcMain.handle('os:workflowSelection:get', (event, rawConvId: unknown) => {
    assertTrustedRendererSender(event, 'Workflow selection')
    return os.conversationWorkflow(guardString(rawConvId, 'conversationId'))
  })
  ipcMain.handle('os:workflowSelection:set', (event, rawConvId: unknown, rawId: unknown) => {
    assertTrustedRendererSender(event, 'Workflow selection')
    const profileId = rawId === null ? null : guardString(rawId, 'profileId')
    return os.selectConversationWorkflow(guardString(rawConvId, 'conversationId'), profileId)
  })
  // Confronter plusieurs workflows sur un même objectif. La logique vit dans son module : ce point
  // d'entrée n'a qu'à la brancher.
  registerWorkflowBenchIpc({
    ipcMain,
    assertTrusted: (event, label) => assertTrustedRendererSender(event, label),
    setActiveWorkflow: (workflow) => os.setActiveWorkflow(workflow),
    // Le juge de QUALITE. Sans lui, le banc departageait sur le PRIX en laissant croire qu'il
    // departageait la valeur — mesure du 2026-08-06 : un workflow recommande parce qu'il coutait
    // 0,65 $ de moins, sans que rien n'ait lu ce qu'il produisait. La comparaison qu'il recoit est
    // AVEUGLE (livrables etiquetes A/B, aucun nom de workflow).
    judgeQuality: async (prompt) => {
      const binding = os.roles.all().judge ?? os.roles.all().orchestrator
      if (!binding?.provider) return ''
      const res = await os.registry.send(
        binding.provider,
        [{ role: 'user', content: prompt }],
        { model: binding.model, reasoningEffort: 'low' }
      )
      return res.text ?? ''
    },
    runOrchestration: (objective, bindingOverride, signal) =>
      os.orchestrator.run(
        objective,
        undefined,
        undefined,
        undefined,
        signal,
        '',
        [],
        undefined,
        bindingOverride
      )
  })
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
    async (event, role: Role, provider: string, model?: string, reasoningEffort?: string) => {
      assertTrustedRendererSender(event, 'SetRole')
      await agentModelsReady
      const next = topologyWithRuntimeRole(
        agentTopology,
        role,
        {
          provider,
          model,
          reasoningEffort: reasoningEffort as ReasoningEffort | undefined
        },
        agentModels
      )
      agentTopology = saveAgentTopology(agentTopologyPath, next, agentModels)
      syncRuntimeTopology(agentTopology)
      broadcast({ type: 'refresh', scope: 'roles' })
      return os.roles.all()
    }
  )
  ipcMain.handle('os:models:list', async (event, force = false) => {
    assertTrustedRendererSender(event, 'Model catalog')
    if (typeof force !== 'boolean') throw new Error('Option de rafraîchissement invalide')
    if (!force) return agentModels
    const refresh = modelCatalog.refresh(true)
    // Armer la barriere avant le premier await : aucun tour ne part sur l'ancien catalogue
    // pendant qu'un rafraichissement force est en vol.
    os.setTaskReadiness(
      refresh.then(() => assertRuntimeTopologyAvailable(agentTopology, agentModels))
    )
    await refresh
    applyFabricSummaries(fabricControlPlane.list())
    return agentModels
  })
  ipcMain.handle('os:fabric:list', (event) => {
    assertTrustedRendererSender(event, 'Compute Fabric')
    const live = fabricControlPlane.list()
    return isolatedFabricFixtureSummary
      ? [
          ...live.filter((node) => node.nodeId !== isolatedFabricFixtureSummary?.nodeId),
          isolatedFabricFixtureSummary
        ]
      : live
  })
  ipcMain.handle('app:test:fabric-fixture:install', (event) => {
    assertTrustedRendererSender(event, 'Fixture Compute Fabric')
    if (!isolatedTestInstance)
      throw new Error('Fixture Compute Fabric indisponible hors instance isolée')
    const summary: FabricNodeSummary = {
      nodeId: 'wire-node',
      trust: 'paired',
      availability: 'online',
      lastSequence: 1,
      lastManifestDigest: 'wire-manifest-digest',
      lastVerifiedAt: new Date().toISOString(),
      resources: [
        {
          id: 'wire-resource',
          nodeId: 'wire-node',
          kind: 'model',
          adapterId: 'wire-adapter',
          displayName: 'Wire local tools',
          runtimeVersion: '1.0.0',
          modes: ['local-tools'],
          capabilities: ['chat'],
          limits: { contextTokens: 4096, maxConcurrentRuns: 1 }
        }
      ]
    }
    const [model] = createFabricProductBindings(summary).models
    if (!model) throw new Error('La fixture Compute Fabric ne produit aucun modèle')
    const fixtureAdapter: ProviderAdapter = {
      id: model.provider,
      supportsExecution: false,
      async auth() {
        return true
      },
      async *send(_messages, opts = {}) {
        yield { delta: 'fixture-ok' }
        return {
          text: 'fixture-ok',
          provider: model.provider,
          model: model.model,
          systemInjected: Boolean(opts.system)
        }
      }
    }
    os.registry.register(fixtureAdapter)
    isolatedFabricFixtureSummary = summary
    agentModels = [...agentModels.filter((candidate) => candidate.id !== model.id), model]
    os.roles.setCatalog(agentModels)
    return { summary, model }
  })
  ipcMain.handle('app:test:fabric-fixture:send', async (event, execution?: unknown) => {
    assertTrustedRendererSender(event, 'Exécution fixture Compute Fabric')
    if (!isolatedTestInstance)
      throw new Error('Fixture Compute Fabric indisponible hors instance isolée')
    if (!isolatedFabricFixtureSummary) throw new Error('Fixture Compute Fabric non installée')
    if (execution !== undefined && typeof execution !== 'boolean') {
      throw new Error('Mode d’exécution fixture invalide')
    }
    return os.registry.send(
      'fabric:wire-node:wire-resource',
      [{ role: 'user', content: 'preuve Compute Fabric packagée' }],
      execution ? { execution: { cwd: os.executionWorkspace, sandbox: 'read-only' } } : {}
    )
  })
  ipcMain.handle('os:fabric:refresh', async (event, nodeId?: unknown) => {
    assertTrustedRendererSender(event, 'Compute Fabric')
    const summary = await fabricControlPlane.refresh(guardString(nodeId, 'nodeId'))
    applyFabricSummaries(fabricControlPlane.list())
    broadcast({ type: 'refresh', scope: 'roles' })
    return summary
  })
  ipcMain.handle('os:fabric:pair', async (event, request: unknown) => {
    assertTrustedRendererSender(event, 'Compute Fabric')
    const summary = await fabricControlPlane.pair(
      request as Parameters<FabricControlPlane['pair']>[0]
    )
    applyFabricSummaries(fabricControlPlane.list())
    broadcast({ type: 'refresh', scope: 'roles' })
    return summary
  })
  ipcMain.handle('os:checkpointForks:list', (event) => {
    assertTrustedRendererSender(event, 'Checkpoint forks')
    return os.resumableOrchestrations().map((checkpoint) => ({
      id: checkpoint.runId,
      runId: checkpoint.runId,
      createdAt: new Date(checkpoint.updatedAt).toISOString(),
      sourceSnapshot: {
        workspaceId: os.executionWorkspace,
        baseSha: checkpoint.runtimeSnapshot ? 'runtime-snapshot' : 'legacy-checkpoint',
        contentHash: createHash('sha256').update(JSON.stringify(checkpoint)).digest('hex')
      },
      state: checkpoint
    }))
  })
  ipcMain.handle('os:checkpointFork:create', (event, checkpointId?: unknown, forkId?: unknown) => {
    assertTrustedRendererSender(event, 'Checkpoint fork')
    const safeForkId = guardString(forkId, 'forkId')
    const checkpoints = os.resumableOrchestrations().map((checkpoint) => ({
      id: checkpoint.runId,
      runId: checkpoint.runId,
      createdAt: new Date(checkpoint.updatedAt).toISOString(),
      sourceSnapshot: {
        workspaceId: os.executionWorkspace,
        baseSha: checkpoint.runtimeSnapshot ? 'runtime-snapshot' : 'legacy-checkpoint',
        contentHash: createHash('sha256').update(JSON.stringify(checkpoint)).digest('hex')
      },
      state: checkpoint
    }))
    const manifest = createCheckpointForkManifest(checkpoints, {
      checkpointId: guardString(checkpointId, 'checkpointId'),
      forkId: safeForkId,
      createdAt: new Date().toISOString(),
      deriveState: (state) => ({ ...state, runId: safeForkId })
    })
    os.persistCheckpointFork(structuredClone(manifest.branchState) as OrchestrationRunState, {
      checkpointId: manifest.ancestor.checkpointId,
      runId: manifest.ancestor.runId,
      checkpointCreatedAt: manifest.ancestor.checkpointCreatedAt,
      contentHash: manifest.sourceSnapshot.contentHash
    })
    return manifest
  })
  ipcMain.handle('os:shadowRoute:recommend', (event, phase?: unknown, champion?: unknown) => {
    assertTrustedRendererSender(event, 'Shadow router')
    const safePhase = guardString(phase, 'phase')
    if (!champion || typeof champion !== 'object') throw new Error('Champion invalide')
    const route = champion as { provider?: unknown; model?: unknown }
    const samples = loadAllPromptCalls().map((call) => ({
      phase: call.actor || call.boundary,
      provider: call.provider,
      model: call.model ?? 'default',
      cost: call.usage?.costUsd ?? 0,
      durationMs: call.durationMs ?? 0,
      green: call.status !== 'failed'
    }))
    return recommendShadowRoute(samples, {
      phase: safePhase,
      champion: {
        provider: guardString(route.provider, 'champion.provider'),
        model: guardString(route.model, 'champion.model')
      }
    })
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
    const [claudeResponds, kimiResponds, geminiResponds] = await Promise.all([
      responds('claude'),
      responds('kimi'),
      responds('gemini')
    ])
    return buildProviderStatuses({
      codexTokens: loadTokens(),
      claudeResponds,
      kimiResponds,
      geminiResponds,
      now: Date.now(),
      states: {
        codex: providerStateStore.get('codex'),
        claude: providerStateStore.get('claude'),
        kimi: providerStateStore.get('kimi'),
        gemini: providerStateStore.get('gemini')
      }
    })
  })
  ipcMain.handle('os:providerMode:set', (event, provider: unknown, mode: unknown) => {
    assertTrustedRendererSender(event, 'Provider mode')
    const id = guardString(provider, 'provider')
    if (!ROUTED_PROVIDERS.includes(id as RoutedProvider)) {
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
    if (!ROUTED_PROVIDERS.includes(id as RoutedProvider)) {
      throw new Error('Provider non supporté.')
    }
    return probeProviderConnection(id as RoutedProvider)
  })
  ipcMain.handle('os:profiles:list', () =>
    profiles.list().map((profile) => ({
      ...profile,
      topology: migrateTopologyShape(profile.topology) as AgentTopology
    }))
  )
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
    // Rétrocompat : un profil sauvegardé avant un panel récent peut ne pas l'avoir → on migre
    // la forme avant validation (sinon assertTopology jetterait « Profil introuvable/incohérent »).
    agentTopology = saveAgentTopology(
      agentTopologyPath,
      migrateTopologyShape(profile.topology) as AgentTopology,
      agentModels
    )
    syncRuntimeTopology(agentTopology)
    // `roles` reste dans le schéma des anciens profils pour la lecture rétrocompatible, mais Agent
    // Studio n'édite que `topology`. Le réappliquer ici recréerait une seconde autorité invisible.
    broadcast({ type: 'refresh', scope: 'roles' })
    return { ...profile, topology: agentTopology }
  })
  ipcMain.handle('os:topology:get', async () => {
    await agentModelsReady
    return agentTopology
  })
  ipcMain.handle('os:topology:set', async (event, topology: AgentTopology) => {
    assertTrustedRendererSender(event, 'Topology')
    await agentModelsReady
    guardString(JSON.stringify(topology), 'topology')
    agentTopology = saveAgentTopology(
      agentTopologyPath,
      migrateTopologyShape(topology) as AgentTopology,
      agentModels
    )
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
  ipcMain.handle('os:conversations', () => os.conversations.listSummaries())
  ipcMain.handle('os:conversation', (event, rawId: unknown) => {
    assertTrustedRendererSender(event, 'Conversation detail')
    if (isolatedTestInstance) isolatedConversationReadCount += 1
    return os.conversations.get(guardString(rawId, 'conversationId')) ?? null
  })
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
  /**
   * Ranger une conversation dans un dossier de travail. `null` la remet dans « Divers ».
   *
   * Le sélecteur natif est ouvert ICI et non côté renderer : le renderer n'a pas accès au disque, et
   * lui laisser passer un chemin arbitraire ferait de ce canal une écriture non contrôlée. Il envoie
   * soit un chemin déjà connu (glisser-déposer vers un groupe existant), soit `undefined` pour
   * demander l'ouverture du sélecteur.
   */
  ipcMain.handle(
    'os:conversations:setProject',
    async (event, rawId: string, rawPath?: string | null) => {
      assertTrustedRendererSender(event, 'Conversations')
      const id = guardString(rawId, 'id')
      let chemin: string | null
      if (rawPath === undefined) {
        if (headlessTestInstance) return null
        const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
        if (result.canceled) return null
        chemin = result.filePaths[0] ?? null
      } else {
        chemin = rawPath === null ? null : guardString(rawPath, 'projectPath')
      }
      const updated = os.conversations.setProjectPath(id, chemin)
      if (updated) broadcast({ type: 'refresh', scope: 'conversations' })
      return updated?.projectPath ?? null
    }
  )
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
  ipcMain.handle('os:searchBrain', async (event, path: string, query: string) => {
    assertTrustedRendererSender(event, 'BrainSearch')
    const selectedPath = guardString(path, 'path')
    const boundedQuery = guardString(query, 'query')
    const [local, retrieval] = await Promise.all([
      brainWorker.request<BrainNoteSearchResult[]>('searchBrain', selectedPath, boundedQuery),
      retrieveBrainContext(boundedQuery)
    ])
    return applyBrainRetrievalScores(local, retrieval.navigation)
  })
  ipcMain.handle('os:refreshBrain', async (event, path: string) => {
    assertTrustedRendererSender(event, 'BrainRefresh')
    clearBrainRetrievalCache()
    await brainWorker.request('invalidate', guardString(path, 'path'))
    return { ok: true }
  })
  ipcMain.handle('os:listRuns', () => os.listRuns())
  ipcMain.handle('os:runs:delete', async (event, rawPath: string) => {
    assertTrustedRendererSender(event, 'DeleteRun')
    await deleteListedRun(guardString(rawPath, 'path'))
    return { ok: true }
  })

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
    text?: string
    error?: string
    verification?: { complete: boolean; evidence: string }
  }> => {
    await os.waitUntilReady()
    const turnRuntimeBinding = bindingOverride ?? os.roles.getBinding('orchestrator')
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
    const chatTokenCap = Number(process.env.AUTOWIN_CHAT_TOKEN_CAP)
    const chatCallCap = Number(process.env.AUTOWIN_CHAT_CALL_CAP)
    const chatBreaker = new CostCircuitBreaker({
      maxUsd: Number.isFinite(chatUsdCap) && chatUsdCap > 0 ? chatUsdCap : 2,
      maxTokens: Number.isFinite(chatTokenCap) && chatTokenCap > 0 ? chatTokenCap : 1_500_000,
      maxCalls: Number.isFinite(chatCallCap) && chatCallCap > 0 ? chatCallCap : 6
    })
    const spoken: string[] = []
    let streamedSpoken = ''
    let completedText = ''
    let verification: { complete: boolean; evidence: string } | undefined
    let turnUsage: { inputTokens: number; outputTokens: number; costUsd?: number } | undefined
    let turnPromptIdentity:
      { provider: string; model?: string; reasoningEffort?: string } | undefined
    let activityLabel = 'tour agent'
    let supervisedUsage: ExecutionUsageSnapshot | undefined
    let persistedSupervisedUsage: ExecutionUsageSnapshot | undefined
    let usagePersistenceReady = false
    const persistSupervisedChatUsage = (usage: ExecutionUsageSnapshot): void => {
      if (!conversationId) return
      if (sameExecutionUsage(persistedSupervisedUsage, usage)) return
      persistedSupervisedUsage = persistChatUsageSettlement({
        conversationId,
        turnId,
        usage,
        previous: persistedSupervisedUsage,
        provider: turnPromptIdentity?.provider ?? turnRuntimeBinding.provider,
        model: turnPromptIdentity?.model ?? turnRuntimeBinding.model,
        reasoningEffort: turnPromptIdentity?.reasoningEffort ?? turnRuntimeBinding.reasoningEffort,
        label: activityLabel,
        durationMs: Math.round(performance.now() - turnStartedAtMs),
        text: (streamedSpoken || spoken.join('\n')).slice(0, 600) || undefined,
        traceStore: causalTrace
      })
      broadcast({ type: 'refresh', scope: 'workflows' })
      broadcast({ type: 'causal-trace-updated', convId: conversationId })
    }
    const onSupervisedUsageSettlement = (usage: ExecutionUsageSnapshot): void => {
      supervisedUsage = usage
      if (usagePersistenceReady) persistSupervisedChatUsage(usage)
    }
    if (conversationId) activeChatTurns.set(conversationId, controller, completion)
    try {
      const safe = (Array.isArray(messages) ? messages : []).slice(-40).map((m) => ({
        role: m.role,
        content: guardString(m.content, 'content'),
        ...(m.attachments?.length ? { attachments: guardAttachments(m.attachments) } : {})
      }))
      let traceParentId: string | undefined
      let traceSequence = conversationId ? causalTrace.nextSequence(conversationId) : 0
      let traceActionIndex = 0
      /**
       * Ordinal MONOTONE du tour pour les identifiants de trace. Distinct de `traceActionIndex`, qui est
       * remis a zero a chaque `prompt-call` et sert d'index LOCAL au bloc : s'appuyer sur lui pour un
       * identifiant produisait des doublons. Celui-ci ne redescend jamais.
       */
      let traceActionOrdinal = 0
      let turnSessionId: string | undefined
      const last = safe[safe.length - 1]
      activityLabel = last?.role === 'user' ? last.content : 'tour agent'
      if (conversationId && last?.role === 'user' && os.conversations.get(conversationId)) {
        os.conversations.beginTurn(
          conversationId,
          {
            content: last.content,
            attachments: last.attachments?.map(
              ({ name, mimeType, size, kind, content, thumbnail }) => {
                const metadata = {
                  name,
                  mimeType,
                  size,
                  ...(thumbnail && { thumbnail })
                }
                if (kind !== 'image') return metadata
                try {
                  return {
                    ...metadata,
                    turnId,
                    artifact: materializeUserImageArtifact(
                      { name, mimeType, size, content },
                      conversationId,
                      turnId
                    )
                  }
                } catch {
                  return {
                    ...metadata,
                    turnId,
                    originalUnavailable: true
                  }
                }
              }
            )
          },
          {
            turnId,
            runtime: {
              provider: turnRuntimeBinding.provider,
              model: turnRuntimeBinding.model,
              reasoningEffort: turnRuntimeBinding.reasoningEffort
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
        if (conversationId) {
          const structuredIncident = incidentFromPilotEvent({
            kind: pilotEvent.kind,
            name: pilotEvent.name,
            text: pilotEvent.kind === 'prompt-call' ? pilotEvent.error : pilotEvent.text,
            ok: pilotEvent.ok,
            data: pilotEvent.data,
            status: pilotEvent.kind === 'prompt-call' ? pilotEvent.status : undefined
          })
          // ARRÊT VOULU ⇒ AUCUN incident. Le chemin du tour pilote était déjà protégé (`signal.aborted`),
          // mais pas celui de l'ORCHESTRATION : un run coupé finit rouge, et rouge valait incident. D'où
          // la boucle rapportée — couper un run kaizen en engendrait un autre.
          if (structuredIncident && !activeChatTurns.wasDeliberatelyStopped(conversationId)) {
            const resultData =
              pilotEvent.data && typeof pilotEvent.data === 'object'
                ? (pilotEvent.data as Record<string, unknown>)
                : undefined
            const runPath =
              typeof resultData?.runPath === 'string'
                ? resultData.runPath
                : typeof resultData?.runId === 'string'
                  ? resultData.runId
                  : undefined
            const terminalRunError =
              pilotEvent.name === 'orchestrate' && runPath
                ? `orchestration-end:${runPath}:red`
                : undefined
            reportAutoKaizen({
              dedupeKey:
                terminalRunError ??
                `pilot:${conversationId}:${turnId}:${pilotEvent.actionId ?? pilotEvent.iteration ?? 0}:${pilotEvent.kind}:${pilotEvent.name ?? 'provider'}`,
              sourceConversationId: conversationId,
              sourceTurnId: turnId,
              ...structuredIncident
            })
          }
        }
        if (
          pilotEvent.kind === 'result' &&
          pilotEvent.name === 'orchestrate' &&
          pilotEvent.ok !== false &&
          pilotEvent.data &&
          typeof pilotEvent.data === 'object'
        ) {
          const outcome = pilotEvent.data as Record<string, unknown>
          if (outcome.valid === true && outcome.gateBlocked !== true) {
            verification = {
              complete: true,
              evidence:
                typeof outcome.runPath === 'string'
                  ? `judge vert, RUN ${outcome.runPath}`
                  : 'judge vert et gate validée'
            }
          }
        }
        if (pilotEvent.kind === 'delta' && pilotEvent.text) streamedSpoken += pilotEvent.text
        if (pilotEvent.kind === 'think' && pilotEvent.text) spoken.push(pilotEvent.text)
        if (pilotEvent.kind === 'command' && pilotEvent.name)
          spoken.push(`[a exécuté ${pilotEvent.name}]`)
        if (pilotEvent.kind === 'done' && pilotEvent.usage) turnUsage = pilotEvent.usage
        if (pilotEvent.kind === 'done' && pilotEvent.text?.trim())
          completedText = pilotEvent.text.trim()
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
          traceSequence = rebaseTraceSequence(causalTrace, conversationId, traceSequence)
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
          traceSequence = rebaseTraceSequence(causalTrace, conversationId, traceSequence)
          traceActionIndex++
          const action = pilotActionToTraceEvent({
            // `traceActionOrdinal` et NON `traceActionIndex` : ce dernier est remis a zero a chaque
            // `prompt-call`, ce qui faisait collisionner deux `retry` d'un meme tour sur
            // `…:action:0:retry` — `TraceStore.append` jetait alors « evenement duplique » et le tour
            // entier echouait. L'ordinal, lui, ne se reinitialise jamais.
            id: traceActionEventId({
              turnId,
              kind: pilotEvent.kind,
              actionId: pilotEvent.actionId,
              iteration: pilotEvent.iteration,
              ordinal: traceActionOrdinal++
            }),
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
      const autoKaizenFailureFixture =
        isolatedTestInstance &&
        safe.at(-1)?.content.startsWith('[[autowin-fixture-auto-kaizen-error]]')
      const durableStreamPrefix = '[[autowin-fixture-durable-stream]]'
      const durableStreamFixture =
        isolatedTestInstance && safe.at(-1)?.content.startsWith(durableStreamPrefix)
      if (autoKaizenFailureFixture) {
        const fixtureEvents: PilotEvent[] = [
          {
            kind: 'command',
            actionId: `${turnId}:fixture-auto-kaizen`,
            name: 'verify',
            args: { command: 'fixture rouge' }
          },
          {
            kind: 'result',
            actionId: `${turnId}:fixture-auto-kaizen`,
            name: 'verify',
            ok: false,
            data: { error: 'Exit code: 1', source: 'isolated-auto-kaizen-fixture' }
          },
          { kind: 'done', text: 'Erreur structurée de fixture transmise à Auto-Kaizen.' }
        ]
        for (const fixtureEvent of fixtureEvents) handlePilotEvent(fixtureEvent)
      } else if (durableStreamFixture) {
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
        await os.runChatTurn(
          last?.content ?? 'chat',
          controller.signal,
          () => {
            // Le supervisor peut annuler pour budget/watchdog sans que le controller UI soit lui-meme
            // aborté. Le pilote doit voir CE signal combine pour ne jamais retenter apres le cut-off.
            const supervisedSignal = os.executionSupervisor.currentSignal() ?? controller.signal
            return pilot.chat(
              safe,
              handlePilotEvent,
              (question) =>
                sender
                  ? askModelQuestion(sender, 'chat', question, 'Chat', supervisedSignal)
                  : Promise.reject(
                      new Error(
                        'Une tâche planifiée ne peut pas répondre à une question interactive du modèle.'
                      )
                    ),
              6,
              conversationId,
              supervisedSignal,
              conversationId
                ? (os.conversations.get(conversationId)?.authorityMode ?? 'ask')
                : 'ask',
              conversationId ? () => drainPendingDirectives(conversationId) : undefined,
              bindingOverride,
              turnId,
              turnRuntimeBinding
            )
          },
          onSupervisedUsageSettlement
        )
      // Journal d'activité de la conversation : le tour de chat, avec son coût ET sa durée.
      const turnDurationMs = Math.round(performance.now() - turnStartedAtMs)
      if (conversationId) {
        if (supervisedUsage) persistSupervisedChatUsage(supervisedUsage)
        else {
          appendConvActivity(conversationId, {
            kind: 'chat',
            label: activityLabel,
            provider: turnPromptIdentity?.provider ?? turnRuntimeBinding.provider,
            model: turnPromptIdentity?.model ?? turnRuntimeBinding.model,
            reasoningEffort:
              turnPromptIdentity?.reasoningEffort ?? turnRuntimeBinding.reasoningEffort,
            inputTokens: turnUsage?.inputTokens,
            outputTokens: turnUsage?.outputTokens,
            costUsd: turnUsage?.costUsd,
            durationMs: turnDurationMs,
            text: (streamedSpoken || spoken.join('\n')).slice(0, 600)
          })
        }
      }
      usagePersistenceReady = true
      broadcast({ type: 'refresh', scope: 'workflows' })
      return {
        ok: true,
        cancelled: false,
        turnId,
        text: completedText || streamedSpoken.trim() || spoken.join('\n').trim(),
        verification
      }
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
      if (supervisedUsage) persistSupervisedChatUsage(supervisedUsage)
      usagePersistenceReady = true
      broadcast({ type: 'refresh', scope: 'workflows' })
      if (controller.signal.aborted)
        return {
          ok: true,
          cancelled: true,
          turnId,
          text: completedText || streamedSpoken.trim() || spoken.join('\n').trim()
        }
      // Le `return` ci-dessus couvre l'abort du contrôleur du TOUR. Ce garde couvre le cas où l'arrêt de
      // l'ORCHESTRATION fait jeter le tour sans que son propre contrôleur ait été aborté : même geste
      // volontaire, même absence d'incident.
      if (conversationId && !activeChatTurns.wasDeliberatelyStopped(conversationId)) {
        reportAutoKaizen({
          dedupeKey: `chat-turn:${conversationId}:${turnId}:failed`,
          sourceConversationId: conversationId,
          sourceTurnId: turnId,
          kind: 'chat-turn-failed',
          summary: 'Le tour de conversation a échoué',
          detail: e instanceof Error ? e.message : String(e)
        })
      }
      return {
        ok: false,
        cancelled: false,
        turnId,
        error: e instanceof Error ? e.message : String(e)
      }
    } finally {
      usagePersistenceReady = true
      if (supervisedUsage) persistSupervisedChatUsage(supervisedUsage)
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
  autoKaizenSupervisor = new AutoKaizenSupervisor({
    path: join(app.getPath('userData'), 'auto-kaizen-incidents.json'),
    runtime: {
      createConversation: ({ title, link }) => {
        const source = os.conversations.get(link.sourceConversationId)
        return os.conversations.create({
          title: title.slice(0, 140),
          category: source?.category ?? 'codex',
          provider: source?.provider ?? os.roles.getBinding('orchestrator').provider,
          authorityMode: inheritAutoKaizenAuthority(source?.authorityMode),
          autoKaizen: link
        })
      },
      appendSourceUpdate: (conversationId, text) => {
        if (!os.conversations.get(conversationId)) return
        os.conversations.append(conversationId, { role: 'assistant', content: text })
        broadcast({ type: 'refresh', scope: 'conversations' })
      },
      runAnalysis: async (conversationId, prompt) => {
        if (isolatedTestInstance) {
          const turnId = `${conversationId}:isolated-auto-kaizen-analysis`
          os.conversations.append(conversationId, { role: 'user', content: prompt })
          const text = 'Diagnostic Auto-Kaizen isolé : erreur structurée reproduite et bornée.'
          os.conversations.append(conversationId, { role: 'assistant', content: text })
          return { ok: true, turnId, text }
        }
        const result = await runPilotChat(
          undefined,
          [{ role: 'user', content: prompt }],
          conversationId
        )
        return {
          ok: result.ok && !result.cancelled,
          turnId: result.turnId,
          text: result.text,
          error: result.cancelled ? 'Analyse Auto-Kaizen interrompue' : result.error
        }
      },
      runFix: async (conversationId, prompt) => {
        if (isolatedTestInstance) {
          const turnId = `${conversationId}:isolated-auto-kaizen-fix`
          os.conversations.append(conversationId, { role: 'user', content: prompt })
          const text = 'Correctif Auto-Kaizen isolé vérifié rouge→vert.'
          os.conversations.append(conversationId, { role: 'assistant', content: text })
          return {
            ok: true,
            turnId,
            text,
            verification: { complete: true, evidence: 'fixture rouge→vert, gate isolée validée' }
          }
        }
        const result = await runPilotChat(
          undefined,
          [{ role: 'user', content: prompt }],
          conversationId
        )
        return {
          ok: result.ok && !result.cancelled,
          turnId: result.turnId,
          text: result.text,
          verification: result.verification,
          error: result.cancelled ? 'Correction Auto-Kaizen interrompue' : result.error
        }
      },
      isConversationRunning: (conversationId) =>
        Boolean(activeChatTurns.get(conversationId)) ||
        os
          .resumableOrchestrations()
          .some((candidate) => candidate.conversationId === conversationId),
      readConversationResult: (conversationId) => {
        const message = os.conversations
          .get(conversationId)
          ?.messages.slice()
          .reverse()
          .find(
            (candidate) =>
              candidate.role === 'assistant' &&
              candidate.status !== 'failed' &&
              candidate.status !== 'cancelled' &&
              candidate.status !== 'interrupted' &&
              candidate.content.trim()
          )
        return message ? { turnId: message.turnId, text: message.content } : undefined
      }
    }
  })
  autoKaizenSupervisor.resumePending()
  const autoKaizenResumeTimer = setInterval(() => autoKaizenSupervisor?.resumePending(), 15_000)
  autoKaizenResumeTimer.unref()

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
    // Ce chemin ne coupe QUE l'orchestration, donc ne passe pas par `activeChatTurns.abort` : sans ce
    // marquage explicite, la moitié des arrêts resterait indiscernable d'une panne.
    activeChatTurns.markDeliberateStop(conversationId)
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
  ipcMain.handle(
    'os:conversationRuns:delete',
    async (event, rawConvId: string, rawPath: string) => {
      assertTrustedRendererSender(event, 'DeleteConversationRun')
      const convId = guardString(rawConvId, 'convId')
      const path = guardString(rawPath, 'path')
      const conversation = os.conversations.get(convId)
      if (!conversation) throw new Error(`Conversation inconnue: ${convId}`)
      const result = await deleteConvRun(convId, path, conversation.runPaths ?? [])
      if (result.kind === 'detached') os.conversations.detachRun(convId, result.attachedPath)
      return { ok: true, kind: result.kind }
    }
  )
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
  ipcMain.handle('os:activity:sessions', (event) => {
    assertTrustedRendererSender(event, 'Activity sessions')
    return listSessionsAsync(60)
  })
  ipcMain.handle('os:activity:session', async (event, ref: unknown) => {
    assertTrustedRendererSender(event, 'Activity session')
    if (!ref || typeof ref !== 'object') throw new Error('Référence de session invalide')
    const raw = ref as Record<string, unknown>
    const session = await resolveListedSessionAsync({
      id: guardString(raw.id, 'session.id'),
      project: guardString(raw.project, 'session.project')
    })
    if (!session) throw new Error('Session non autorisée ou hors inventaire')
    return parseSession(session)
  })

  // Affichage des screenshots consultés : whitelist extensions + cap taille, lecture seule.
  ipcMain.handle('os:activity:image', async (event, ref: unknown, path: string) => {
    assertTrustedRendererSender(event, 'ActivityImage')
    if (!ref || typeof ref !== 'object') throw new Error('Référence de session invalide')
    const raw = ref as Record<string, unknown>
    const p = guardString(path, 'path')
    if (!/\.(png|jpe?g|webp|gif|bmp)$/i.test(p)) throw new Error('extension non autorisée')
    const authorizedPath = await resolveListedSessionImage(
      {
        id: guardString(raw.id, 'session.id'),
        project: guardString(raw.project, 'session.project')
      },
      p
    )
    if (!authorizedPath) throw new Error('Image absente des transcripts autorisés')
    const { statSync, readFileSync } = await import('node:fs')
    if (statSync(authorizedPath).size > 8_000_000) throw new Error('image trop volumineuse')
    const ext = p.split('.').pop()!.toLowerCase()
    const mime =
      ext === 'png'
        ? 'image/png'
        : ext === 'webp'
          ? 'image/webp'
          : `image/${ext === 'jpg' ? 'jpeg' : ext}`
    return { dataUrl: `data:${mime};base64,${readFileSync(authorizedPath).toString('base64')}` }
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
    title: isolatedTestInstance ? 'Autowin OS Test' : 'Autowin OS',
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
  mainWindow.webContents.on('will-frame-navigate', (details) => {
    if (details.isMainFrame) return
    const currentUrl = details.frame?.url ?? ''
    const isInitialLocalFrameLoad =
      (currentUrl === '' || currentUrl === 'about:blank') &&
      (details.url.startsWith('data:') || details.url.startsWith('blob:'))
    if (!isInitialLocalFrameLoad) details.preventDefault()
  })

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
    const rendererUrl = new URL(process.env['ELECTRON_RENDERER_URL'])
    if (isolatedTestInstance) rendererUrl.searchParams.set('instance', 'test')
    mainWindow.loadURL(rendererUrl.toString())
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      query: isolatedTestInstance ? { instance: 'test' } : undefined
    })
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
  // Aucun tour modèle au démarrage. Le statut initial vient des tokens/CLI locaux ; le seul probe
  // payant est l'action explicite « Tester », elle-même bornée par ExecutionSupervisor ci-dessus.
  startupProviderChecks = Promise.resolve()
  createWindow()
  setupTray() // l'app vit en tray → fermer la fenêtre ne tue plus les runs en cours

  // RÉCONCILIATION DES RUNS ABANDONNÉS. Un run dont l'app est morte en cours gardait `status: open`
  // à vie : mesuré le 2026-08-05, 141 runs ouverts depuis plus de 24 h, ni succès ni échec, alors
  // que ce sont des échecs — ils faussaient donc en silence toute lecture du taux de réussite.
  // APRÈS `createWindow` et sans `await` : le démarrage ne doit rien attendre de cette hygiène. Le
  // seuil de 24 h laisse intacts les runs en vol et ceux que la reprise va récupérer.
  setImmediate(() => {
    try {
      const bilan = reconcileAbandonedConvRuns({})
      if (bilan.closed || bilan.remaining) {
        // Le reste est dit à voix haute : une borne muette se lirait « tout est traité ».
        console.log(
          `[runs] ${bilan.closed} run(s) abandonné(s) clos en red, ${bilan.remaining} en attente du prochain démarrage`
        )
      }
    } catch (error) {
      console.warn('[runs] réconciliation des runs abandonnés impossible', error)
    }
    // COPIES ISOLÉES ORPHELINES. Un run tué avec l'app laisse son bureau isolé sur le disque ;
    // il est déjà marqué `interrupted` par le coordinateur, mais restait introuvable. On les NOMME
    // ici. Jamais de suppression automatique : le travail de l'agent est récupérable, et une
    // copie effacée ne revient pas — le nettoyage reste une décision humaine, prise sur cette liste.
    try {
      const orphelins = os.worktrees?.interruptedWorktrees() ?? []
      for (const orphelin of orphelins) {
        console.log(
          `[worktrees] copie isolée orpheline (run interrompu) : ${orphelin.runId}` +
            `${orphelin.worktreePath ? ` → ${orphelin.worktreePath}` : ''}` +
            `${orphelin.conversationId ? ` (${orphelin.conversationId})` : ''}`
        )
      }
    } catch (error) {
      console.warn('[worktrees] inventaire des copies interrompues impossible', error)
    }
  })

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
  const resumableRuns = os.resumableOrchestrations()
  for (const resumableRun of resumableRuns) {
    let durableLiveReattachment: ReturnType<typeof createOrchestrateTurnPersistence> | undefined
    let liveReattachment: ReturnType<typeof admitLiveReattachment> | undefined
    // GARDE DE VIVACITÉ : les CLI sont détachés, donc un agent du run précédent peut ÊTRE ENCORE EN
    // TRAIN DE TRAVAILLER. Relancer par-dessus mettrait deux agents sur la même copie, à s'écraser
    // l'un l'autre. On vérifie chaque run avant de le relancer — et on l'écrit, pour que ce silence
    // soit lisible sans empêcher les autres reprises.
    const reprise = resumeActionFor(resumableRun, defaultProcessIdentity)
    if (reprise === 'rattacher' && resumableRun) {
      const conversationId = resumableRun.conversationId ?? '__autonomous__'
      const recordedTurnRuntime = resumableRun.turnId
        ? os.conversations
            .get(conversationId)
            ?.messages.find(
              (message) => message.role === 'assistant' && message.turnId === resumableRun.turnId
            )?.runtime
        : undefined
      liveReattachment = admitLiveReattachment(resumableRun, recordedTurnRuntime, randomUUID())
      const resumeTurnId = liveReattachment.turnId
      durableLiveReattachment = createOrchestrateTurnPersistence({
        conversations: os.conversations,
        conversationId,
        turnId: resumeTurnId,
        runtime: liveReattachment.turnBinding,
        resumeExisting: liveReattachment.resumeExisting,
        journal: (event) => appendTurnEvent(turnJournalRoot, conversationId, resumeTurnId, event)
      })
      durableLiveReattachment.begin(liveReattachment.task)
      console.log(
        '[resume-orchestration]',
        resumableRun.runId,
        '→ un agent travaille ENCORE : aucune relance. Son journal reste la source de vérité.'
      )
      // RATTACHEMENT : on relit ce que l'agent a produit PENDANT l'absence de l'app, depuis l'offset
      // déjà lu, et on le remet dans la conversation. Sans ça le travail existait sur le disque mais
      // restait invisible — donc réputé perdu, donc relancé.
      try {
        const conversationId = resumableRun.conversationId
        const lignes: string[] = []
        const agentsApres = (resumableRun.agents ?? []).map((agent) => {
          if (!agent.journalPath) return agent
          const { offset } = tailJournalOnce(agent.journalPath, agent.offset ?? 0, (ligne) =>
            lignes.push(ligne)
          )
          return { ...agent, offset }
        })
        const recap = summarizeJournal(lignes)
        // `true` était écrit EN DUR ici : l'app affirmait « l'agent travaille encore » sans l'avoir
        // vérifié une seule fois, et la branche `false` de `recapMessage` — pourtant écrite — n'était
        // atteignable que par les tests. Un agent bloqué depuis une heure était annoncé au travail.
        //
        // On mesure maintenant la seule trace de production qu'on ait sur disque : la date de
        // dernière écriture du journal. Sans journal lisible, `runIsProducing` rend `true`, donc le
        // comportement historique est conservé partout où l'on ne sait pas.
        const produitEncore = runIsProducing(resumableRun, Date.now(), (chemin) => {
          try {
            return statSync(chemin).mtimeMs
          } catch {
            return undefined
          }
        })
        const message = recapMessage(recap, produitEncore)
        if (conversationId && message) {
          os.conversations.append(conversationId, { role: 'assistant', content: message })
          broadcast({ type: 'refresh', scope: 'chat', convId: conversationId })
        }
        if (conversationId && (recap.coverage.lostProof > 0 || recap.diagnostics.length > 0)) {
          const replayWindow = (resumableRun.agents ?? [])
            .map((agent) => `${agent.token}:${agent.offset ?? 0}`)
            .join('|')
          if (recap.coverage.lostProof > 0) {
            reportAutoKaizen({
              dedupeKey: `journal-replay-loss:${resumableRun.runId}:${replayWindow}:${lignes.length}`,
              sourceConversationId: conversationId,
              sourceTurnId: resumeTurnId,
              kind: 'journal-replay-loss',
              summary: `${recap.coverage.lostProof} perte(s) de preuve dans le journal`,
              detail:
                `Couverture structurée ${recap.coverage.structuredPercent} % ; ` +
                `${recap.coverage.noise} bruit(s), ${recap.coverage.diagnostics} diagnostic(s), ` +
                `${recap.coverage.blockages} blocage(s), ${recap.coverage.lostProof} perte(s) de preuve.`
            })
          }
          for (const diagnostic of recap.diagnostics) {
            reportAutoKaizen({
              dedupeKey: `journal-diagnostic:${resumableRun.runId}:${replayWindow}:${diagnostic.line}:${diagnostic.summary}`,
              sourceConversationId: conversationId,
              sourceTurnId: resumeTurnId,
              kind: diagnostic.kind,
              summary: diagnostic.summary,
              detail: diagnostic.detail
            })
          }
        }
        // L'offset atteint est repersisté : ce qui vient d'être montré ne sera pas remontré.
        os.rememberAgentOffsets(resumableRun.runId, agentsApres)
      } catch (error) {
        console.warn('[resume-orchestration] rattachement impossible :', error)
      }
    }
    const relaunchResumableRun = async (
      candidate: ReturnType<typeof os.resumableOrchestrations>[number]
    ): Promise<void> => {
      const resumableRun = os.reconcileResumableOrchestrationForRelaunch(
        candidate.runId,
        defaultProcessIdentity
      )
      if (!resumableRun) return
      try {
        await os.waitUntilReady()
      } catch (error) {
        console.warn('[resume-orchestration] topologie indisponible, checkpoint conserve :', error)
        return
      }
      const conversationId = resumableRun.conversationId ?? '__autonomous__'
      const recordedTurnRuntime = resumableRun.turnId
        ? os.conversations
            .get(conversationId)
            ?.messages.find(
              (message) => message.role === 'assistant' && message.turnId === resumableRun.turnId
            )?.runtime
        : undefined
      const resumedRuntime = admitAutomaticResumeRuntime(
        resumableRun,
        os.captureOrchestrationRuntime(),
        randomUUID(),
        recordedTurnRuntime
      )
      const { resumeExisting, turnId: resumeTurnId, turnBinding: resumeBinding } = resumedRuntime
      const durableResumeTurn = createOrchestrateTurnPersistence({
        conversations: os.conversations,
        conversationId,
        turnId: resumeTurnId,
        runtime: {
          provider: resumeBinding.provider,
          model: resumeBinding.model,
          reasoningEffort: resumeBinding.reasoningEffort
        },
        resumeExisting,
        journal: (event) => appendTurnEvent(turnJournalRoot, conversationId, resumeTurnId, event)
      })
      const resumedArtifactIds = new Set<string>()
      let resumedCurrentRunId: string | undefined
      let resumedTerminalLifecycle: Extract<RunLifecycleEvent, { stage: 'closure' }> | undefined
      let resumedCheckpointReleased = false
      let resumedPhaseStartIteration = 0
      durableResumeTurn.begin(resumedRuntime.task)
      broadcast({ type: 'orchestrate-start', convId: conversationId, task: resumableRun.task })
      console.log(
        '[resume-orchestration]',
        resumableRun.runId,
        '→ phases déjà acquises :',
        resumableRun.phaseOutputs.map((output) => output.phase).join(', ')
      )
      void resumedRuntime
        .run((runtimeSnapshot) =>
          os.runTask(
            resumableRun.task,
            (step) => {
              durableResumeTurn.step(step)
              broadcast({ type: 'orchestrate-step', convId: conversationId, step })
              persistOrchestrationStep(
                step,
                {
                  conversationId,
                  turnId: resumeTurnId,
                  iteration: step.step === 'exec' ? 0 : 1,
                  runId: resumedCurrentRunId
                },
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
                  durableResumeTurn.artifact(stored)
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
            (phase) => {
              broadcast({ type: 'orchestrate-phase', convId: conversationId, phase })
              if (!resumedCurrentRunId) return
              persistOrchestrationPhaseStart(
                phase,
                {
                  conversationId,
                  turnId: resumeTurnId,
                  iteration: resumedPhaseStartIteration++,
                  runId: resumedCurrentRunId
                },
                causalTrace
              )
            },
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
            resumeTurnId,
            (lifecycle) => {
              // Le nouveau runId n'effacera jamais l'ancien checkpoint. On le libère au premier
              // lifecycle seulement : cet événement prouve que le superviseur a admis la reprise.
              // Un refus avant admission conserve donc les acquis pour le prochain démarrage.
              if (!resumedCheckpointReleased) {
                resumedCheckpointReleased = true
                os.forgetResumableOrchestration(resumableRun.runId)
              }
              resumedCurrentRunId = lifecycle.runId
              if (lifecycle.stage === 'closure') resumedTerminalLifecycle = lifecycle
              persistRunLifecycle(lifecycle, { conversationId, turnId: resumeTurnId }, causalTrace)
            },
            resumableRun,
            (usage) => {
              if (!resumedCurrentRunId) return
              const settledLifecycle = reconcileLateRunLifecycle(resumedTerminalLifecycle, usage)
              if (!settledLifecycle) return
              resumedTerminalLifecycle = settledLifecycle
              persistRunLifecycle(
                resumedTerminalLifecycle,
                { conversationId, turnId: resumeTurnId },
                causalTrace
              )
              broadcast({ type: 'orchestrate-usage', convId: conversationId })
              broadcast({ type: 'refresh', scope: 'workflows' })
              broadcast({ type: 'refresh', scope: 'orchestration' })
            },
            runtimeSnapshot
          )
        )
        .then((result) => {
          durableResumeTurn.succeed(result)
          broadcast({ type: 'orchestrate-end', convId: conversationId, status: 'green' })
          broadcast({ type: 'refresh', scope: 'chat', convId: conversationId })
          return result
        })
        .catch((error: unknown) => {
          durableResumeTurn.fail(error instanceof Error ? error.message : String(error), false)
          broadcast({ type: 'orchestrate-end', convId: conversationId, status: 'red' })
          broadcast({ type: 'refresh', scope: 'chat', convId: conversationId })
          console.warn('[resume-orchestration] échec de la reprise :', error)
        })
    }
    if (reprise === 'rattacher') {
      void waitUntilRunCanResume(() => {
        const latest = os
          .resumableOrchestrations()
          .find((candidate) => candidate.runId === resumableRun.runId)
        return latest ? resumeActionFor(latest, defaultProcessIdentity) : 'ignorer'
      }).then((action) => {
        const latest = os
          .resumableOrchestrations()
          .find((candidate) => candidate.runId === resumableRun.runId)
        if (action !== 'relancer' || !latest) {
          durableLiveReattachment?.succeed({ result: 'Rattachement terminé.' })
          return
        }
        if (!liveReattachment?.resumeExisting) {
          durableLiveReattachment?.succeed({
            result: 'Agent détaché terminé — reprise du workflow dans un nouveau tour.'
          })
        }
        void relaunchResumableRun(latest)
      })
    }
    if (reprise === 'relancer') void relaunchResumableRun(resumableRun)
  }

  const preflightStartedAt = Date.now()
  let brainLaunch: BrainLaunchOutcome | undefined
  preflightWatchHandle = watchAppPreflight((raw) => {
    // #2 — un rouge « brain » → tenter de DÉMARRER le service local (garde anti-doublon + tentative
    // unique par session dans ensureBrainServerStarted). Le backoff de watchAppPreflight re-sondera
    // ensuite jusqu'à sa disponibilité (warm-up fastembed). Fire-and-forget : ne bloque pas le push.
    if (raw.checks.some((c) => c.id === 'brain' && !c.ok)) {
      void ensureBrainServerStarted(() => appPreflightProbes().pingBrain()).then((r) => {
        // Retenu pour DIRE POURQUOI si le délai de grâce expire : la première sonde ne pouvait pas
        // le savoir, cette tentative l'a appris.
        brainLaunch = { status: r.status, detail: r.detail }
        console.log('[brain-launch]', r.status, '—', r.detail)
      })
    }
    // Un Brain qui n'a pas fini de démarrer n'est pas une panne : on lui laisse un délai avant d'en
    // parler. Ce qui ne se répare pas seul, lui, s'annonce tout de suite.
    const decision = decidePreflightAnnouncement(raw, {
      elapsedMs: Date.now() - preflightStartedAt,
      graceMs: DEFAULT_BRAIN_GRACE_MS,
      brainLaunch
    })
    if (!decision.announce) return
    const result = decision.result
    const signature = `${result.ok}|${result.checks
      .filter((c) => !c.ok)
      .map((c) => c.id)
      .sort()
      .join(',')}`
    if (signature === lastPreflightSignature) return
    lastPreflightSignature = signature
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('preflight:result', result)
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
