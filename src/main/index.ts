import { observerLeMoteur } from './observer-les-sources'
import { spawn } from 'node:child_process'
import { creerServiceWhisper, racineWhisper, type ServiceWhisper } from './whisper-local'
import { creerServicePiper, racinePiper, type ServicePiper } from './piper-local'
import { ServiceTranscripts, dossierTranscripts } from './transcripts'
import { registerPiperIpc } from './ipc/piper'
import { registerActivityIpc } from './ipc/activity'
import { registerWorktreeIpc, type WorktreeFixtureDeTest } from './ipc/worktree'
import { registerConversationsIpc } from './ipc/conversations'
import { registerTranscriptsIpc } from './ipc/transcripts'
import { registerPreflightIpc } from './ipc/preflight'
import { registerGitIpc } from './ipc/git'
import { registerTestsViewIpc } from './ipc/tests-view'
import { registerPerfIpc } from './ipc/perf'
import { registerBrainIpc } from './ipc/brain'
import { registerClaudeAccountsIpc } from './ipc/claude-accounts'
import { registerProfilesIpc } from './ipc/profiles'
import { registerTopologyIpc } from './ipc/topology'
import { registerProvidersIpc } from './ipc/providers'
import { registerRolesIpc } from './ipc/roles'
import { registerModelsIpc } from './ipc/models'
import { registerFabricIpc } from './ipc/fabric'
import { registerCapabilitiesIpc } from './ipc/capabilities'
/**
 * CHRONOLOGIE DU DÉMARRAGE — ces jalons ont trouvé la cause, ils restent pour la surveiller.
 *
 * Constat de départ : ~30 secondes de fenêtre absente au lancement, au point de relancer
 * l'application en croyant qu'elle n'avait pas démarré. Quatre hypothèses ont été essayées de
 * l'EXTÉRIEUR (écran d'attente en HTML statique, URL `data:`, séquencement des chargements, attente
 * de la migration de stockage) ; aucune ne tenait. Ces jalons ont réglé la question en trois mesures.
 *
 * CE QU'ILS ONT MONTRÉ, chiffres relevés en développement :
 *   · `electron-vite` a fini sa part en 1,6 s — le retard n'est pas dans l'outil de construction.
 *   · le CORPS de ce module coûte ~25 à 35 s, et `app.whenReady` se déclenche 0,1 s après : Electron
 *     attendait notre code, pas l'inverse.
 *   · dans ce corps, `new AutowinOS()` pèse à lui seul ~24 s, soit 74 % du total.
 *   · à l'intérieur, tout est instantané (71 ms) jusqu'à `new RunWorktreeCoordinator`, qui lance un
 *     inventaire de récupération des worktrees. La machine en portait 51, dont 46 copies d'agents :
 *     le coût du démarrage suit donc la taille de cette pile.
 *
 * L'instant zéro est l'évaluation de ce module — les imports sont déjà résolus à ce point.
 */
import {
  instrumenterCanauxIpc,
  pendantOperation,
  marquerOperation as marquerOperationDemarrage
} from './gel-main'

const T0_DEMARRAGE = Date.now()
function jalonDemarrage(etape: string): void {
  console.log(`[demarrage] ${String(Date.now() - T0_DEMARRAGE).padStart(6)} ms  ${etape}`)
  // Le demarrage est la fenetre ou les gels mesures sont les plus longs (33 s le 2026-08-28) : le
  // jalon deja pose ici sert aussi a NOMMER la phase au detecteur, sans nouveau point de couture.
  marquerOperationDemarrage(`demarrage:${etape}`)
}
jalonDemarrage('module principal évalué')
import { emitToLiveWindows } from './renderer-emit'
import {
  ClaudeAccountsStore,
  configureClaudeAccountEnv,
  configureClaudeActiveAccountId,
  configureClaudeAccountRotation
} from './claude-accounts'
import { app, shell, BrowserWindow, dialog, ipcMain } from 'electron'
import { dirname, join } from 'path'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { buildExport, readImport, suggestedFileName } from './workflow-transfer'
import { createHash, randomUUID } from 'node:crypto'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import type { ExecutionEvidence, ProviderAdapter } from './providers/types'
import { guardBrokenProcessPipes } from './process-stream-guards'
import { AutowinOS } from './os'
import { projectContextBlock } from './context-files'
import { DEFAULT_CDP_PORT, listeningPorts, resolveCdpPort } from './cdp-port'
import { execFileSync } from 'node:child_process'
import { ensureBrainServerStarted } from './brain-server-launch'
import { startBrainCuration } from './brain-curation-run'
import { configureSessionMemoryEcho } from './session-memory-echo'
import { configureRememberDepositStore } from './brain-remember'
import {
  promoteOutcomeLearningCandidate,
  restoreTrashedKnowledge,
  retractKnowledgeCandidate,
  supersedeKnowledgeCandidate
} from './brain-inbox'
import { installCrashHandlers } from './crash-handlers'
import { loadOrchestrationBudget, saveOrchestrationBudget } from './orchestration-budget'
import { appPreflightProbes, resolveBinOnPath, watchAppPreflight } from './preflight-probes'
import { type ReasoningEffort, type Role } from './roles'
import { AppCommandBus, type AppEvent } from './commands'
import { compensateOutcomeCuration } from './outcome-learning-curation'
import {
  executeCurationTransaction,
  reconcileCurationIntents
} from './outcome-learning-curation-transaction'
import { OutcomeLearningLedger } from './activity/outcome-learning-ledger'
import { PariPhaseStore } from './activity/pari-phase-store'
import { resumerMesure, traiterStepPourPari } from './activity/pari-step'
import { OutcomeLearningSupervisor, parseOutcomeLearningMode } from './outcome-learning-supervisor'
import { WindowsDesktopController } from './desktop-control'
import { captureElectronDesktop } from './electron-desktop-capture'
import { AgentPilot } from './agent-pilot'
import { ActiveChatTurns } from './active-chat-turns'
import { createRunPilotChat } from './chat/run-pilot-chat'
import { enregistrerDirectiveDansLeFil } from './directive-dans-le-fil'
import { ConversationRouteCoordinator, ConversationRouter } from './conversation-router'
import { buildContinuationProviderHistory } from './chat-continuation'
import { parseFileRef, resolveFileRef } from '../shared/file-ref'
import { commandeEditeur, ligneDemandee, racinesRevelation } from './reveal-file'
import { type ChatTurnEvent } from '../shared/chat-turn'
import type { RunLifecycleEvent } from '../shared/run-execution'
import { TraceLedger, evenementRefusIntegration } from './activity/ledger'
import { persistConversations } from './store/conversations-disk'
import { collectStdoutJournals } from './runs/journal-gc'
import { collectRunWorkspaces } from './runs/workspace-gc'
import { pruneLegacyContextValues } from './runs/context-value-gc'
import {
  closeConvRun,
  convRunsRoot,
  deleteConvRun,
  listConvRuns,
  loadConvRunTrace,
  populateConvRunSections,
  reconcileAbandonedConvRuns,
  reuseOrCreateConvRun,
  saveConvRunTrace
} from './runs/conv-runs'
import { phasesAvecJuge } from './orchestration-memoire'
import { deleteListedRun } from './dashboards/runs-scan'
import { regimePhases } from './task-regime'
import { createOrchestrateTurnPersistence } from './runs/orchestrate-turn-persistence'
import { StartupResumeQueue } from './runs/startup-resume-queue'
import { publishedWorktreeProofForResume } from './runs/startup-resume-publication'
import { classifierRefusDeReprise } from './runs/resume-refusal'
import { creerRelanceDeRunReprenable } from './runs/relaunch-resumable-run'
import {
  admitAutomaticResumeRuntime,
  admitLiveReattachment,
  electStartupOrchestrationResumes,
  type OrchestrationRunState
} from './runs/orchestration-state'
import {
  appendTurnEvent,
  flushAllTurnJournals,
  isTurnFinished,
  listUnfinishedTurns,
  pruneFinishedTurnJournals,
  removeConversationTurnJournals,
  readTurnJournal
} from './runs/turn-journal'
import {
  listRecoverableChatProviderCalls,
  recoverCompletedChatProviderCall,
  streamedPrefixForProviderCall,
  waitForRecoverableChatProviderExit
} from './runs/chat-provider-recovery'
import { appendConvActivity, loadConvActivity } from './activity/conv-activity'
import { reconcileLateRunLifecycle } from './activity/late-run-usage-settlement'
import {
  deletePromptCalls,
  loadAllPromptCalls,
  loadPromptCalls,
  costSamplesFrom,
  summarizeCostSamples
} from './activity/prompt-observability'
import { promptCallToTraceEvents } from './activity/prompt-call-trace'
import { appendObservedOrchestrationOutcome } from './activity/orchestration-outcome-trace'
import { executionCostCoverageFields } from '../shared/orchestration-outcome'
import { installTraceEventSink, TraceStore } from './activity/trace-store'
import { resolveOtelGenAiConfig } from './activity/otel-genai-config'
import { MetadataOnlyOtlpExporter } from './activity/otel-genai-exporter'
import { DiagnosticCapabilities } from './activity/diagnostic-capability'
import { responseDisplayedTrace } from './activity/response-displayed-trace'
import {
  persistOrchestrationPhaseStart,
  persistOrchestrationStep,
  persistRunLifecycle
} from './activity/orchestration-observability'
import { aggregateToolUsage } from './activity/tool-usage'

import { ProfileStore } from './profile-store'
import { capabilityEnabled } from './capability-controls'
import { seedRegistrySnapshot } from './native-registry'
import { ROUTED_PROVIDERS, type RoutedProvider } from './routed-providers'
import {
  defaultBehaviourWorkspace,
  listBehaviourFiles,
  readBehaviourFileFromManifest
} from './behaviour-files'
import { ApprovedBehaviourWorkspaces, isTrustedRendererUrl } from './behaviour-access'
import {
  assertTrustedBehaviourSender,
  assertTrustedRendererSender,
  behaviourRendererOptions
} from './ipc-senders'
import { createWindowing } from './window'
import { discoverConfiguredSkillRegistry } from './skill-registry'
import { ModelQuestionHub, type ModelQuestion } from './model-questions'
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
import { createShadowRoutingRuntime, shadowRoutingEnvOverride } from './model-routing-shadow'
import {
  loadShadowRoutingPilotSetting,
  saveShadowRoutingPilotSetting,
  type ShadowRoutingPilotState
} from './model-routing-shadow-setting'
import { rebuildSemanticTemporalProjection } from './knowledge/semantic-temporal-store'
import { causalLearningContext } from './knowledge/semantic-temporal-projection'
import { ModelCatalogRefresher } from './model-refresh'
import { loadAgentTopology, saveAgentTopology, type IncidentTopologie } from './topology-disk'
import type { AgentTopology, SlotBinding } from './topology'
import {
  assertRuntimeBindingAvailable,
  assertRuntimeTopologyAvailable,
  runtimeRoleBinding,
  runtimeRoleSlots,
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
import { demarrerDetecteurDeGel, instrumenterEntreesSortiesDuMain } from './gel-main'
import { AUTOWIN_APP_ID, AUTOWIN_DISPLAY_NAME } from '../shared/app-identity'
import {
  createStorageMigrationReadHandler,
  isRendererStorageMigrationComplete,
  markRendererStorageMigrationComplete,
  readLegacyRendererStorage,
  type MigratedRendererStorage
} from './renderer-storage-migration'
import { guardString, guardStringOrNull } from './ipc-guards'
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
import { abortUpdateConflict, checkForUpdate, applyUpdate } from './git-update'
import type { UpdateAction } from '../shared/update-contract'
import { restartApplication } from './app-restart'
import { annoncerFermeture, cheminJournalArrets, journaliserCauseFermeture } from './journal-arrets'
import { consommerReprise } from './redemarrage-reprise'
import {
  ChatArtifactPreviewBudget,
  MAX_ARTIFACT_PREVIEW_BYTES,
  materializeChatArtifact,
  readConversationArtifact,
  removeConversationArtifacts,
  revealableConversationArtifactPath
} from './store/chat-artifact-store'

import { BrainWorkerClient } from './viz/brain-worker-client'
import { BrainSearchCoordinator } from './viz/brain-search-coordinator'
import { filterNativePreflight, readNativePreflight } from './activity/native-preflight'
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
  WorkflowRefusalMailbox,
  type WorkflowProfile,
  type WorkflowProfilesFile
} from './workflow-profiles'
import { overrideFor, registerWorkflowBenchIpc } from './workflow-bench-ipc'
import {
  captureRetainedWorkspaceState,
  captureWorkflowBenchCheckpoint
} from './workflow-bench-checkpoint'
import {
  DEFAULT_BRAIN_GRACE_MS,
  decidePreflightAnnouncement,
  type BrainLaunchOutcome
} from './preflight-announce'
import { graphDefects, worstCaseNodeExecutions, type WorkflowGraph } from './workflow-graph'
import { recapMessage, summarizeJournal } from './runs/journal-replay'
import type { FinishedRunOutcome } from './runs/run-interruption'
import { tailJournalOnce } from './runs/stdout-journal'
import { summarizeInterruptedWorktrees } from './store/interrupted-worktree-summary'
import { journaliserSaisie } from './store/journal-saisie'
import { defaultProcessIdentity } from './store/worktree-manager'
import {
  appendConversationFileTrace,
  appendExecutionEvidenceFileTrace,
  readConversationFileTraces,
  readConversationTurnFileMutations,
  readConversationTurnFilePaths,
  workspaceTracePathKey
} from './activity/conversation-file-trace-spool'
import { buildBehaviourComposition } from './behaviour-composition'
import { ProviderStateStore } from './provider-state-store'
import { artifactsFromExecutionEvidence } from './providers/artifacts'

import { amitelBrainRoot, createAmitelContextProvider } from './amitel-context'
import {
  captureWorkspaceMutationSnapshot,
  captureWorkspacePathGenerationMarker
} from './providers/workspace-mutation-evidence'
import {
  automationAppIdentity,
  resolveAutomationInstanceMode,
  resolveExplicitUserDataDir,
  resolveInstanceAppDataBase
} from './headless-instance'
import { TaskStore } from './task-manager/task-store'
import { persistTaskStore } from './task-manager/task-store-disk'
import { TaskScheduler } from './task-manager/task-scheduler'
import { WatchdogEngine } from './task-manager/watchdog-engine'
import { seedWatchdogTasks } from './task-manager/watchdog-seeds'
import type { WatchdogAppEvent } from './task-manager/types'
import {
  ScheduledChatDispatcher,
  scheduledTaskBinding,
  type ScheduledChatRuntime
} from './task-manager/chat-dispatch'
import { runWatchdogOrchestration } from './task-manager/watchdog-orchestration-adapter'
import {
  isolatedRelayLaunchArguments,
  PowerShellWindowsRelay,
  taskOccurrenceFromAdditionalData,
  taskOccurrenceFromArgs,
  windowsRelayTaskName
} from './task-manager/windows-relay'
import { registerTaskManagerIpc } from './task-manager/task-manager-ipc'
import { OutlookLocalGateway } from './outlook/outlook-local'
import { registerVeilleIpc } from './veille/veille-ipc'
import { executerPasse } from './veille/passe'
import { genererCandidatsEnConversation } from './veille/scout-visible'
import { unePasseALaFois } from './veille/une-passe-a-la-fois'
import { lancerScoutVeille } from './veille/scout-claude'
import { candidatsInternesDuDepot } from './veille/audit-depot'
import { dispatcherAvecVeille } from './veille/dispatch-veille'
import {
  AutoKaizenSupervisor,
  legacyAutoKaizenSupervisorEnabled,
  type AutoKaizenIncidentInput
} from './auto-kaizen-supervisor'
import { OUTILS_NOEUD_SKILL } from './skill-node-tools'

/**
 * ATTRIBUTION du démarrage. Le jalon « module principal évalué » est posé AVANT les 167 imports
 * ci-dessus ; une fois le bundle produit, ces imports sont exécutés en séquence à cet endroit. Sans
 * ce second jalon, les 43,9 s mesurées le 2026-08-12 entre les deux marqueurs existants restaient
 * inattribuables : impossible de savoir si elles vont à l'exécution des modules importés ou au corps
 * de ce fichier — donc impossible de choisir quoi optimiser.
 */
jalonDemarrage('imports du process principal évalués')

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
const appDataRoot = resolveInstanceAppDataBase(
  resolveAutowinAppDataBase(
    portableAppDataBase(app.getAppPath(), dirname(app.getPath('exe')), app.isPackaged),
    app.isPackaged
  ),
  explicitUserDataPath
)
app.setName(isolatedTestInstance ? `${AUTOWIN_DISPLAY_NAME} Test` : AUTOWIN_DISPLAY_NAME)
const explicitUserDataDir = explicitUserDataPath !== undefined
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
// Electron exige un dossier existant pour `setPath`. Cette création vide et idempotente est la
// seule I/O autorisée avant le verrou : le chemin obtenu est À LA FOIS l'identité Electron et la
// racine effective de tous les stores, donc deux propriétaires distincts ne partagent jamais un run.
const canonicalAppDataRoot = createAutowinAppDataRoot(appDataRoot)
jalonDemarrage('racine de donnees preparee')
app.setPath('userData', canonicalAppDataRoot)
// Publie la racine de donnees EFFECTIVE pour les processus enfants et les workers (Brain) : eux ne
// voient pas `app.getPath('userData')`. Sans elle, la lecture d'un RUN.md ecrit sous une racine
// portable etait refusee ("fichier hors perimetre autorise").
process.env.AUTOWIN_APP_DATA_ROOT = canonicalAppDataRoot
// Le verrou Electron est rattaché au `userData` : deux instances de test isolées avec deux racines
// restent indépendantes, tandis que DEUX processus sur la même racine ne peuvent jamais parcourir
// ensemble les checkpoints de reprise. Cette exclusion vaut aussi en dev : sans elle, deux boots
// concurrents élisent le même run puis lancent chacun son provider. Le second lancement réveille la
// fenêtre de l'instance propriétaire via `second-instance` au lieu de reprendre le travail lui-même.
const ownsInstanceLock = app.requestSingleInstanceLock(
  startupTaskOccurrence ? { autowinTaskOccurrence: startupTaskOccurrence } : {}
)
if (!ownsInstanceLock) {
  app.quit()
  // `app.quit()` programme la fermeture mais laisse le module continuer synchroniquement. Sans cet
  // arrêt dur, le perdant construit encore l'OS et peut lire/reprendre les mêmes checkpoints.
  process.exit(0)
}
// Chaque canal IPC declare son nom au detecteur AVANT le premier enregistrement : sans cette
// couture unique, un gel survenu dans un handler ressort sous « inconnu ».
instrumenterCanauxIpc(ipcMain as unknown as Parameters<typeof instrumenterCanauxIpc>[0])
configureAutowinAppDataBase(appDataRoot)
configureTurnTiming(ensureAutowinAppData(appDataRoot))
// Battement du main : seul instrument capable de dater un « ce programme ne repond pas ».
demarrerDetecteurDeGel(ensureAutowinAppData(appDataRoot))
// Le temoin ordonnance a prouve que nos gels sont des « entree-sortie-bloquante » : mesure DIRECTE
// des appels disque/reseau synchrones pour NOMMER l'appel et le partage en cause.
instrumenterEntreesSortiesDuMain()
/**
 * Le service de reconnaissance vocale locale, construit PARESSEUSEMENT : au démarrage il ne fait que
 * lire un dossier, et tant que l'utilisateur n'a pas installé whisper, il ne coûte rien du tout.
 */
let whisperMemo: ServiceWhisper | null = null
const serviceWhisper = (): ServiceWhisper =>
  (whisperMemo ??= creerServiceWhisper({ racine: racineWhisper(app.getPath('userData')) }))

/**
 * La voix neuronale hors ligne (Piper), construite PARESSEUSEMENT elle aussi : tant que
 * l'utilisateur ne l'a pas installée, elle ne fait que lire un dossier et ne coûte rien.
 */
let piperMemo: ServicePiper | null = null
const servicePiper = (): ServicePiper =>
  (piperMemo ??= creerServicePiper({ racine: racinePiper(app.getPath('userData')) }))

/**
 * Les enregistrements parlés, eux aussi construits PARESSEUSEMENT : tant que personne n'appuie sur
 * « Enregistrer », aucun dossier n'est créé.
 */
let transcriptsMemo: ServiceTranscripts | null = null
const serviceTranscripts = (): ServiceTranscripts =>
  (transcriptsMemo ??= new ServiceTranscripts(dossierTranscripts(app.getPath('userData'))))

configureSessionMemoryEcho(join(app.getPath('userData'), 'session-memory.json'))
configureRememberDepositStore(join(app.getPath('userData'), 'remember-deposits.json'))

/** Noyau applicatif unique (P0-P4 câblés) : kit SOUL injecté, 2 voies, modules. */
jalonDemarrage('verrou instance obtenu')
const os = new AutowinOS()
jalonDemarrage('noyau applicatif construit')
const turnJournalRoot = join(app.getPath('userData'), 'turn-journals')
const brainWorkerPath = join(__dirname, 'brain-worker.js')
const brainWorker = new BrainWorkerClient(brainWorkerPath)
const brainSearchWorker = new BrainWorkerClient(brainWorkerPath)
const brainInboxWorker = new BrainWorkerClient(brainWorkerPath)
const brainSearchCoordinator = new BrainSearchCoordinator()
jalonDemarrage('clients Brain crees')
const invalidateBrainRuntime = async (): Promise<void> => {
  brainSearchCoordinator.invalidate()
  await Promise.all([
    brainWorker.invalidate(),
    brainSearchWorker.invalidate(),
    brainInboxWorker.invalidate()
  ])
}
// Conversations persistées sur disque : rechargées au démarrage, sauvées à chaque mutation.
// SORTIE DE L'ÉTAT D'ATTENTE. Un tour laissé `streaming` sur disque appartient à un run mort avec
// l'app : plus aucun process ne viendra le clore. Le chargement le clôt donc et le DIT dans la
// conversation d'origine — sauf pour les tours dont le checkpoint survit, qui vont vraiment
// reprendre quelques lignes plus bas. Sans ce discriminant on mentirait dans un sens ou dans l'autre.
// La sonde doit précéder l'hydratation : un PID mort ne doit pas maintenir son tour `streaming`.
const persistedJournalLastWriteMs = (path: string): number | undefined => {
  try {
    return statSync(path).mtimeMs
  } catch {
    return undefined
  }
}
const terminatePersistedProviderPid = (pid: number): boolean => {
  try {
    process.kill(pid, 'SIGTERM')
    return true
  } catch {
    return defaultProcessIdentity(pid) === undefined
  }
}
const persistedRunTerminalizationProbes = {
  lastWriteMs: persistedJournalLastWriteMs,
  terminatePid: terminatePersistedProviderPid
}
os.terminalizeAbandonedOrchestrations(
  defaultProcessIdentity,
  false,
  Date.now(),
  persistedRunTerminalizationProbes
)
const startupRecoverableChatCalls = listRecoverableChatProviderCalls(turnJournalRoot)
jalonDemarrage('appels chat recuperables inventories')
const resumableTurnIds = new Set([
  ...os
    .resumableOrchestrations()
    .map((state) => state.turnId)
    .filter((turnId): turnId is string => Boolean(turnId)),
  ...startupRecoverableChatCalls.map((call) => call.turnId)
])
/**
 * RESTITUER un run TERMINÉ après une coupure.
 *
 * Un tour absent de `resumableTurnIds` peut l'être pour la raison INVERSE de l'interruption : son
 * run est allé au bout pendant que l'app était fermée. Le fil l'annonçait alors « interrompu » sans
 * un mot sur le résultat — vert, publié, ses commits — que l'utilisateur ne pouvait lire nulle part.
 * L'index est construit à la PREMIÈRE demande seulement : sans tour à clore, il n'est jamais lu.
 */
const finishedRunOutcomeByTurnId = ((): ((turnId: string) => FinishedRunOutcome | undefined) => {
  let index: Map<string, FinishedRunOutcome> | undefined
  return (turnId: string) => {
    if (!index) {
      index = new Map()
      try {
        for (const record of os.worktrees?.runRecords() ?? []) {
          // `running`/`unknown` ne sont pas des fins : sur eux, l'avis d'interruption reste le vrai.
          if (!record.turnId || !['green', 'red', 'cancelled'].includes(record.verdict)) continue
          index.set(record.turnId, {
            runId: record.runId,
            verdict: record.verdict,
            ...(record.publication ? { publication: record.publication } : {}),
            ...(record.publishedSha ? { publishedSha: record.publishedSha } : {}),
            ...(record.task ? { task: record.task } : {}),
            ...(record.files?.length ? { fileCount: record.files.length } : {})
          })
        }
      } catch (error) {
        // Une lecture d'état illisible ne doit pas empêcher le chargement des conversations :
        // sans issue connue, on retombe exactement sur l'avis d'interruption d'avant.
        console.warn('[startup] issues des runs terminés illisibles', error)
      }
    }
    return index.get(turnId)
  }
})()
const flushConversations = persistConversations(os.conversations, undefined, {
  resumableTurnIds,
  finishedRunOutcome: finishedRunOutcomeByTurnId
})
const scheduledTasks = new TaskStore()
/** Alertes déjà transmises au moteur de réveil : le store rediffuse tout son instantané à chaque
 *  changement, donc sans cette mémoire la même alerte réveillerait un agent en boucle. */
const notifiedTaskAlerts = new Set<string>()
const flushScheduledTasks = persistTaskStore(scheduledTasks)
jalonDemarrage('stores conversations et taches charges')
// Les alertes restaurées sont déjà connues de l'utilisateur. Les rejouer au démarrage créerait un
// faux nouvel événement et pourrait réveiller un watchdog plusieurs heures après l'incident.
for (const alert of scheduledTasks.listAlerts(true)) notifiedTaskAlerts.add(alert.id)
let scheduledTaskScheduler: TaskScheduler | undefined
let watchdogEngine: WatchdogEngine | undefined
let autoKaizenSupervisor: AutoKaizenSupervisor | undefined
/**
 * L'ancien superviseur auto-kaizen, DÉSARMÉ.
 *
 * Son rôle est repris par la règle Watchdog « Auto-kaizen » (`watchdog-seeds.ts`), qui écoute les
 * mêmes incidents mais est VISIBLE et réglable dans le Task Manager. Ses trois filtres mesurés
 * (abandon volontaire, quota épuisé, panne amont) ont été déplacés dans `watchdog-suppression.ts`
 * avec leurs mesures ; sa borne de largeur de cascade est devenue `maxPerRoot`.
 *
 * Désarmé plutôt que SUPPRIMÉ, délibérément : le retirer demande 23 points de chirurgie dans ce
 * fichier et touche `conversations.ts`, qui persiste un `autoKaizenConversationLink`. Le faire tant
 * que la suite complète n'est pas rejouable serait un changement non prouvable. Passer ce drapeau à
 * `true` restaure l'ancien comportement à l'identique — ce qui rend la bascule vérifiable dans les
 * deux sens avant que le code ne parte.
 */
const AUTO_KAIZEN_SUPERVISOR_ENABLED = legacyAutoKaizenSupervisorEnabled(process.env)
const pendingScheduledOccurrences = new Set<string>()
const chatArtifactPreviewBudget = new ChatArtifactPreviewBudget()
const budgetedArtifactRenderers = new Set<number>()

/** Diffuse un événement d'app à toutes les fenêtres (UI live quand un agent pilote). */
/** Réveille les règles Watchdog sur un incident interne. Volontairement best-effort. */
function wakeWatchdog(
  event: WatchdogAppEvent,
  context: string,
  sourceConversationId?: string
): void {
  void watchdogEngine?.notifyAppEvent(event, context, sourceConversationId)
}

/**
 * Traduit un incident STRUCTURÉ du pilote en événement Watchdog, quand il en est un.
 *
 * Seuls les trois « problèmes de workflow » vérifiés passent — un échec provider ou un refus
 * d'autorité n'est pas un problème de workflow, c'est un problème d'infrastructure ou de droits.
 */
function notifyWatchdogWorkflowIncident(
  incident: {
    kind: string
    summary: string
    detail: string
  },
  sourceConversationId?: string
): void {
  const event =
    incident.kind === 'gate-failed'
      ? 'workflow-gate-failed'
      : incident.kind === 'verification-incomplete'
        ? 'workflow-unverified'
        : undefined
  if (!event) return
  wakeWatchdog(
    event,
    `${incident.summary}
${incident.detail}`,
    sourceConversationId
  )
}

/**
 * Ouvre un selecteur de dossier natif — ou REFUSE de l'ouvrir quand personne ne peut y repondre.
 *
 * Un `showOpenDialog` sans fenetre parente est modal au niveau de l'APPLICATION : il vole le focus
 * et attend indefiniment. Constate le 2026-08-10 : une session pilotant l'app a declenche « ranger
 * la conversation dans un dossier » sans chemin, et un selecteur natif a surgi sur le bureau de
 * l'utilisateur, bloquant le handler, alors que personne ne regardait cet ecran.
 *
 * Deux corrections, et la seconde est la vraie :
 *  1. la fenetre PARENTE est passee quand elle existe — le dialogue devient modal a sa fenetre au
 *     lieu de l'application entiere (c'est ce que `git:pickRepo` faisait deja, seul des trois) ;
 *  2. sans fenetre visible, on REND `null` au lieu d'ouvrir. Le garde qui existait ne couvrait que
 *     `headlessTestInstance`, c'est-a-dire les instances de TEST — pas une instance normale pilotee
 *     par un agent, qui est precisement le cas ou personne n'est devant l'ecran. Un dialogue
 *     bloquant n'a de sens que s'il existe un humain pour le fermer.
 *
 * `null` est deja le contrat de l'annulation sur les trois appelants : refuser ressemble donc, pour
 * eux, a un utilisateur qui a clique « Annuler ». Aucun n'a besoin d'apprendre un nouveau cas.
 */
async function pickPath(
  sender: Electron.WebContents,
  kind: 'openDirectory' | 'openFile'
): Promise<string | null> {
  if (headlessTestInstance) return null
  const parent = BrowserWindow.fromWebContents(sender)
  const visible = parent && !parent.isDestroyed() && parent.isVisible() ? parent : undefined
  if (!visible) {
    console.warn(
      `[dialog] sélecteur (${kind}) refusé : aucune fenêtre visible pour le porter. ` +
        'Fournis le chemin explicitement plutôt que de compter sur le dialogue natif.'
    )
    return null
  }
  const result = await dialog.showOpenDialog(visible, { properties: [kind] })
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

const pickDirectory = (sender: Electron.WebContents): Promise<string | null> =>
  pickPath(sender, 'openDirectory')

/** Meme garde pour l'ENREGISTREMENT : un « ou sauvegarder ? » bloque tout autant. */
async function pickSavePath(
  sender: Electron.WebContents,
  defaultPath: string
): Promise<string | null> {
  if (headlessTestInstance) return null
  const parent = BrowserWindow.fromWebContents(sender)
  const visible = parent && !parent.isDestroyed() && parent.isVisible() ? parent : undefined
  if (!visible) {
    console.warn(
      '[dialog] sélecteur d’enregistrement refusé : aucune fenêtre visible pour le porter.'
    )
    return null
  }
  const result = await dialog.showSaveDialog(visible, { defaultPath })
  return result.canceled ? null : (result.filePath ?? null)
}

function broadcast(e: AppEvent): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('app:event', e)
  // Réveil événementiel : `broadcast` est le point de passage UNIQUE de tout AppEvent, donc le seul
  // endroit où brancher un incident sans risquer d'en rater une source. Seuls les incidents dont
  // l'émission a été vérifiée dans le code sont branchés — pas un catalogue souhaité.
  if (e.type === 'orchestrate-end' && e.status === 'red') {
    void watchdogEngine?.notifyAppEvent(
      'orchestration-red',
      `Une orchestration s'est terminée en ROUGE.${e.runPath ? ` RUN : ${e.runPath}` : ''}${
        e.convId ? ` Conversation : ${e.convId}` : ''
      }${e.detail ? `\nCause terminale : ${e.detail}` : ''}`,
      e.convId
    )
  }
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

const desktopController = new WindowsDesktopController({ capture: captureElectronDesktop })
const outcomeLearningDirectory = join(app.getPath('userData'), 'outcome-learning')
const outcomeLearningModePath = join(outcomeLearningDirectory, 'mode.txt')
/**
 * Journal des paris de phase — voisin du journal outcome-learning, jamais mélangé avec lui (un `kind`
 * inconnu y ferait échouer la lecture de TOUT le fichier pour une version antérieure d'Autowin).
 */
const parisDePhase = new PariPhaseStore(join(outcomeLearningDirectory, 'paris-v1.jsonl'))
let persistedOutcomeLearningMode: string | undefined
try {
  persistedOutcomeLearningMode = readFileSync(outcomeLearningModePath, 'utf8')
} catch {
  // Premier démarrage : le défaut auto reste explicite et le contrôle UI créera le fichier.
}
const outcomeLearning = new OutcomeLearningSupervisor({
  ledger: new OutcomeLearningLedger(join(outcomeLearningDirectory, 'events-v1.jsonl')),
  mode: parseOutcomeLearningMode(
    process.env.AUTOWIN_OUTCOME_LEARNING_MODE ?? persistedOutcomeLearningMode
  ),
  promote: (candidateId, scope) =>
    promoteOutcomeLearningCandidate(amitelBrainRoot(), candidateId, scope),
  invalidate: invalidateBrainRuntime
})
void outcomeLearning.reconcilePending()
const curationRecoveryReady = reconcileCurationIntents(
  outcomeLearning,
  (intent) => {
    if (intent.requestedTargetId?.startsWith('undo:')) {
      const event = outcomeLearning.eventById(intent.requestedTargetId.slice('undo:'.length))
      if (!event || event.kind !== 'curation') throw new Error('curation undo introuvable')
      const compensation = compensateOutcomeCuration(event.value, {
        restore: (id) => restoreTrashedKnowledge(amitelBrainRoot(), id),
        retract: (id) => retractKnowledgeCandidate(amitelBrainRoot(), id)
      })
      return {
        moved: compensation.moved,
        knowledgeId: compensation.knowledgeId,
        targetId: compensation.targetId,
        rollbackId: compensation.rollbackId,
        previousEventId: compensation.previousEventId
      }
    }
    if (intent.action === 'retract') {
      const moved = retractKnowledgeCandidate(amitelBrainRoot(), intent.knowledgeId)
      return { moved, knowledgeId: intent.knowledgeId, targetId: moved.to }
    }
    if (intent.action === 'restore') {
      const previous = outcomeLearning.latestCurationForStoredId(intent.knowledgeId)
      const moved = restoreTrashedKnowledge(amitelBrainRoot(), intent.knowledgeId)
      return {
        moved,
        knowledgeId: previous?.value.knowledgeId ?? moved.to,
        targetId: moved.to,
        rollbackId: intent.knowledgeId,
        previousEventId: previous?.value.eventId
      }
    }
    if (!intent.requestedTargetId) throw new Error('supersession sans remplacement demandé')
    const result = supersedeKnowledgeCandidate(
      amitelBrainRoot(),
      intent.knowledgeId,
      intent.requestedTargetId
    )
    return {
      moved: result.moved,
      knowledgeId: intent.knowledgeId,
      targetId: result.replacementId,
      rollbackId: result.moved.to
    }
  },
  invalidateBrainRuntime
)
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
  (request) => tickets.get(request),
  desktopController,
  (request) => tickets.update(request),
  // `sqlcmd` est resolu UNE fois au demarrage, par lecture du PATH (jamais en lancant un process).
  // Absent -> `sql_query` annoncera l'indisponibilite plutot que de tenter un binaire inexistant.
  // L'ORDRE compte : ce parametre est le DERNIER du constructeur, apres desktop et updateTicket.
  resolveBinOnPath('sqlcmd') ?? undefined,
  outcomeLearning
)
/**
 * Les outils Brain des noeuds SKILL d'un workflow.
 *
 * Liaison TARDIVE assumee : `os` est construit bien avant `bus` dans ce module, et l'orchestrateur
 * lit cette dependance au moment de la phase, pas a sa construction. Sans cette ligne, un noeud
 * `think` ou `learn` s'executerait sans outil — il DECRIRAIT l'action au lieu de l'accomplir.
 *
 * La liste blanche vit dans `skill-node-tools` (`brain_query`, `remember`) : le bus complet n'est
 * PAS expose ici, sans quoi un noeud pourrait appeler `orchestrate` et lancer un run depuis
 * l'interieur d'un run.
 */
os.setSkillCommandRunner({
  exec: (name, args) =>
    /**
     * DEUXIEME barriere, volontairement redondante. La liste blanche vit dans `skill-node-tools`,
     * mais ce qu'on remet ici est le bus COMPLET : un appelant futur qui oublierait le filtre
     * disposerait de `orchestrate`, donc de la capacite de lancer un run depuis l'interieur d'un
     * run. Une garantie qui ne tient qu'a la discipline d'un seul appelant n'en est pas une.
     */
    OUTILS_NOEUD_SKILL.includes(name as (typeof OUTILS_NOEUD_SKILL)[number])
      ? bus.exec(name, args)
      : Promise.resolve({
          ok: false,
          error: `Commande indisponible depuis un noeud de workflow: ${name}`
        }),
  /**
   * Les specs REELLES des deux commandes, pour que le prompt d'outillage soit COPIE de la commande
   * au lieu d'etre ecrit de memoire. Mesure du 2026-08-20 sur le run `conv-1339` : ecrit de memoire,
   * il annoncait `brain_query {"query": ...}` la ou la commande attend `question`, et `remember`
   * sans `scope` ni `source` alors que les deux sont obligatoires. L'outil etait branche, teste,
   * et strictement inutilisable.
   */
  catalogue: () =>
    bus
      .catalog()
      .filter((c) => OUTILS_NOEUD_SKILL.includes(c.name as (typeof OUTILS_NOEUD_SKILL)[number]))
      .map((c) => ({ name: c.name, description: c.description, args: c.args }))
})
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
      brainWorker.request('graphifyEvidence', raw, query, limit),
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
// Le fenetrage vit dans src/main/window.ts : il ne prenait ici que les valeurs listees ci-dessous.
const fenetres = createWindowing({
  T0_DEMARRAGE,
  jalonDemarrage,
  automationInstanceMode,
  isolatedTestInstance,
  headlessTestInstance,
  modelQuestions
})
const { createWindow, setupTray, openQuestionWindow, rendererLocation, questionWindows } = fenetres
const diagnosticCapabilities = new DiagnosticCapabilities()
/** Boucle de re-probe du diagnostic de démarrage (#4) — arrêtée à la fermeture pour ne pas fuir de timer. */
let preflightWatchHandle: { stop: () => void } | null = null

const providerStateStore = new ProviderStateStore(
  join(app.getPath('userData'), 'provider-state.json')
)

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
// Meme cablage pour l'ID du compte actif : le mur de quota du registre doit separer les abonnements
// (un compte epuise ne doit pas condamner l'autre). Sans cette ligne, le mecanisme existerait sans
// jamais etre alimente.
configureClaudeActiveAccountId(() => claudeAccounts.active().id)
// Rotation d'abonnement : quand le quota du compte actif est epuise, le registre demande une bascule
// vers un compte encore vivant. Sans ce cablage, la rotation existerait sans jamais se declencher.
configureClaudeAccountRotation((walled) => claudeAccounts.rotateAwayFrom(walled))
// Le cache est chargé AVANT la topologie : un bridge momentanément incomplet ne rase pas les bindings existants.
let agentModels = loadCachedImportedModels(modelCatalogCachePath)
jalonDemarrage('catalogue de modeles relu')
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
/**
 * Un echec de chargement de topologie doit se VOIR. Le repli sur la topologie par defaut restait
 * silencieux : l'utilisateur constatait que ses reglages de roles avaient « disparu » sans qu'aucune
 * ligne ne dise pourquoi. Candidat du scout interne (score 91), cadre par l'app elle-meme.
 */
function signalerIncidentTopologie(incident: IncidentTopologie): void {
  console.warn(
    `[topologie] ${incident.cause === 'acces' ? 'lecture impossible' : 'contenu invalide'} — ` +
      `repli sur la topologie par defaut. Fichier : ${incident.chemin}. Cause : ${incident.detail}`
  )
}

let agentTopology = loadAgentTopology(agentTopologyPath, agentModels, signalerIncidentTopologie)
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
      agentTopology = loadAgentTopology(agentTopologyPath, agentModels, signalerIncidentTopologie)
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
/** Journaux de tour : racine initialisée avant l'hydratation des conversations. */
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
const shadowRoutingObservationsPath = join(
  app.getPath('userData'),
  'model-routing-shadow',
  'observations-v1.jsonl'
)
const shadowRoutingPilotPath = join(app.getPath('userData'), 'model-routing-shadow-pilot.json')
/**
 * `let` DELIBERE : la bascule de la vue Settings reconstruit ce runtime, et le sink de trace
 * ci-dessous relit la reference a chaque evenement — l'opt-in prend donc effet sans redemarrage.
 */
let shadowRoutingRuntime = createShadowRoutingRuntime(
  shadowRoutingObservationsPath,
  process.env,
  loadShadowRoutingPilotSetting(shadowRoutingPilotPath).enabled
)
/** État rendu à l'UI : réglage persistant, effet RÉEL du runtime, surcharge d'environnement. */
function shadowRoutingPilotState(
  setting = loadShadowRoutingPilotSetting(shadowRoutingPilotPath)
): ShadowRoutingPilotState {
  return {
    enabled: setting.enabled,
    active: shadowRoutingRuntime.enabled,
    envOverride: shadowRoutingEnvOverride(process.env) ?? null
  }
}
const otelGenAiExporter = new MetadataOnlyOtlpExporter(
  resolveOtelGenAiConfig(),
  undefined,
  app.getVersion()
)
installTraceEventSink((event) => {
  otelGenAiExporter.enqueue(event)
  if (shadowRoutingRuntime.enabled) shadowRoutingRuntime.observer.observe(event)
  broadcast({ type: 'causal-trace-updated', convId: event.conversationId })
})
bus.setTraceStore(causalTrace)
/**
 * Les satellites disque d'une conversation supprimée PAR LE MODÈLE (commande `remove_conversation`)
 * partent avec elle, exactement comme sur le canal IPC de l'interface.
 */
bus.onConversationRemoved = (id: string): void => {
  removeConversationArtifacts(id)
  causalTrace.deleteConversation(id)
  deletePromptCalls(id)
  removeConversationTurnJournals(turnJournalRoot, id)
}
/**
 * REDEMARRAGE PILOTE PAR L'AGENT — meme chemin que la relance d'auto-update, donc meme lanceur dev
 * (`launch_dev.py`) et memes gardes. Cable ici parce que le bus de commandes ne connait ni Electron
 * ni le lanceur : sans ce branchement, `restart_app` annonce son indisponibilite plutot que de
 * promettre une relance qui n'arriverait pas.
 */
bus.redemarrerApp = (): void => restartApplication(app)
os.setCausalMemoryRetriever((conversationId) =>
  causalLearningContext(causalTrace.readConversation(conversationId))
)

const profiles = new ProfileStore(join(app.getPath('userData'), 'profiles.json'))
/**
 * L'INSTANT ou ce processus a demarre. Un processus ne peut pas contenir un fichier ecrit
 * APRES lui : c'est le seul discriminant necessaire, et il couvre les deux formes de
 * peremption (bundle non reconstruit, ou bundle reconstruit sans relance du processus).
 */
const demarrageDuMoteurMs = Date.now()
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

/** Ce que la lecture historique finit par produire — attendu au moment où le renderer le demande. */
type LectureHistorique = { values: MigratedRendererStorage; canWriteMarker: boolean }

/**
 * IPC one-shot : lecture historique, import renderer, acquittement, puis marqueur.
 *
 * La lecture arrive en PROMESSE, et c'est le cœur du correctif de démarrage. Elle était auparavant
 * attendue AVANT la création de la fenêtre, or elle ouvre une fenêtre cachée et y charge le renderer
 * ENTIER — juste pour relire quelques clés de `localStorage`. En développement, cela paie la
 * compilation complète du bundle avant que la moindre fenêtre existe : mesuré au chronomètre,
 * 30 à 44 secondes d'écran totalement vide, pendant lesquelles on relance l'application en croyant
 * qu'elle n'a pas démarré.
 *
 * En l'attendant ICI plutôt que là-bas, la fenêtre s'ouvre tout de suite et c'est le seul appel qui
 * a réellement besoin des valeurs qui patiente.
 */
function registerStorageMigrationIpc(lecture: Promise<LectureHistorique>): void {
  ipcMain.handle('app:storage-migration', async (event) => {
    const { values } = await lecture
    // Le handler est construit à l'appel, une fois les valeurs connues : il les capture, donc il ne
    // peut pas être fabriqué à l'enregistrement, quand elles n'existent pas encore.
    //
    // `assertTrustedRendererSender` est passée TELLE QUELLE et non enveloppée dans une lambda : la
    // fabrique est générique sur le type d'évènement, qu'elle déduit de cette fonction. Une lambda
    // aux paramètres implicites la faisait déduire `unknown`, et le typecheck refusait l'évènement.
    const handler = createStorageMigrationReadHandler(values, assertTrustedRendererSender)
    return handler(event)
  })
  ipcMain.handle('app:storage-migration-complete', async (event) => {
    if (!isTrustedRendererUrl(event.senderFrame?.url ?? '', behaviourRendererOptions())) {
      throw new Error('Origine renderer non autorisee pour la migration')
    }
    const { canWriteMarker } = await lecture
    if (!canWriteMarker) return false
    markRendererStorageMigrationComplete(canonicalAppDataRoot)
    return true
  })
}

/** IPC : chat, orchestration, dashboards et graphe. */
function registerChatIpc(): void {
  // Survie niveau 2 : au démarrage, le renderer demande les tours restés INACHEVÉS (app fermée en
  // pleine exécution) pour les rejouer/afficher. GC des journaux terminés au passage.
  ipcMain.handle('runs:unfinishedTurns', (event) => {
    assertTrustedRendererSender(event, 'UnfinishedTurns')
    try {
      pruneFinishedTurnJournals(turnJournalRoot)
      pruneLegacyContextValues()
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
  /**
   * La consigne posee avant un redemarrage, rendue UNE SEULE FOIS puis effacee du disque.
   * Le renderer la rejoue comme un message ordinaire dans la conversation d'origine.
   */
  ipcMain.handle('app:reprise-en-attente', (event) => {
    assertTrustedRendererSender(event, 'Reprise après redémarrage')
    return consommerReprise(ensureAutowinAppData(appDataRoot))
  })
  ipcMain.handle('update:check', (event) => {
    assertTrustedRendererSender(event, 'Update')
    return checkForUpdate(os.executionWorkspace)
  })
  ipcMain.handle('update:apply', async (event, action?: UpdateAction) => {
    assertTrustedRendererSender(event, 'Update')
    // La stratégie vient du BOUTON cliqué : hors de main, c'est ce qui distingue une intégration
    // demandée d'un merge fabriqué dans le dos de l'utilisateur.
    const result =
      action === 'abort-conflict'
        ? await abortUpdateConflict(os.executionWorkspace)
        : await applyUpdate(os.executionWorkspace, action ? { strategy: action } : {})
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
      annoncerFermeture('mise a jour appliquee — relance demandee')
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
  registerProvidersIpc({ os, providerStateStore })
  // Les canaux des comptes Claude multiples vivent dans src/main/ipc/claude-accounts.ts.
  registerClaudeAccountsIpc({ os, claudeAccounts })
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
    // `os:orchestrate:cancel` → `abortOrchestration(conversationId, motif)` le coupe réellement
    // (sinon no-op), et le MOTIF traverse jusqu'au message que l'utilisateur lit.
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
    const pendingExecutionEvidence: ExecutionEvidence[] = []
    let currentRunId: string | undefined
    let terminalLifecycle: Extract<RunLifecycleEvent, { stage: 'closure' }> | undefined
    let resumedCheckpointReleased = false
    let phaseStartIteration = 0
    let learningAuthor: { model?: string; role?: string } = {}
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
          if (step.text?.includes('AUTOWIN_LESSON_V1:')) {
            learningAuthor = { model: step.model, role: step.role }
          }
          /*
           * LE PARI ET SON ARBITRE. Une phase qui parie sur « mon travail passera le juge » ecrit sa
           * prediction AVANT que le verdict existe ; a l'arrivee du verdict de SYNTHESE (jamais sur
           * le vote d'un membre du panel), on apparie. Toute la logique vit dans
           * `activity/pari-step.ts` pour etre testable : ici, seulement le branchement.
           */
          {
            const mesure = traiterStepPourPari(step, currentRunId, parisDePhase, (message, cause) =>
              console.warn(message, cause)
            )
            if (mesure) console.log(resumerMesure(mesure))
          }
          pendingExecutionEvidence.push(...(step.evidence ?? []))
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
            kind: brain.kind ?? 'automatic'
          }),
        turnId,
        (lifecycle) => {
          currentRunId = lifecycle.runId
          if (resumedAcquis && !resumedCheckpointReleased) {
            resumedCheckpointReleased = true
            if (currentRunId !== resumedAcquis.runId) {
              os.forgetResumableOrchestration(resumedAcquis.runId)
            }
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
      if (!result.gateBlocked) {
        appendExecutionEvidenceFileTrace(pendingExecutionEvidence, {
          conversationId,
          turnId,
          workspaceRoot: os.executionWorkspace,
          published: true
        })
      }
      try {
        appendObservedOrchestrationOutcome(causalTrace, {
          conversationId,
          turnId,
          outcome: { ...(result as unknown as Record<string, unknown>), runId: currentRunId }
        })
      } catch {
        /* observabilité best-effort : l'issue utilisateur reste prioritaire */
      }
      const learning = await bus.observeOutcomeLearning({
        conversationId,
        turnId,
        runId: currentRunId ?? turnId,
        resultText: result.result,
        valid: result.valid,
        gateBlocked: result.gateBlocked,
        gateReasons: result.gateReasons,
        reused: Boolean(resumedAcquis),
        evidence: result.phaseOutputs.flatMap((output) => output.executionEvidence ?? []),
        model: learningAuthor.model ?? orchestratorBinding.model,
        role: learningAuthor.role ?? 'orchestrator',
        proposalAttestations: result.learningAttestations
      })
      // La COUVERTURE de coût, projetée comme sur la lignée `commands.ts` : sans elle cette issue ne
      // portait que `costUsd` — la somme des étapes, où un tour non tarifé compte 0 — et un run dont
      // aucun appel n'est chiffré s'affichait « 0.00 $ ».
      const delivered = {
        ...result,
        ...executionCostCoverageFields(
          result.usage,
          learningAuthor.model ?? orchestratorBinding.model
        ),
        ...(learning ? { learning } : {})
      }
      durableTurn.succeed(delivered)
      // fix-ok: publier immédiatement la clôture persistée du run direct, sans attendre un reprompt.
      broadcast({ type: 'refresh', scope: 'chat', convId: conversationId })
      return { ok: true, result: delivered }
    } catch (e) {
      const aborted = controller.signal.aborted
      const error = aborted ? 'Run annulé' : e instanceof Error ? e.message : String(e)
      await bus.observeOutcomeLearning({
        conversationId,
        turnId,
        runId: currentRunId ?? turnId,
        resultText: '',
        valid: false,
        gateBlocked: true,
        gateReasons: [error],
        reused: false,
        evidence: pendingExecutionEvidence,
        model: orchestratorBinding.model,
        terminalClass: aborted ? 'external' : 'defect'
      })
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
  // CE QUE LE TRAVAIL A TOUCHE : chemins lus et ecrits, tour par tour, avec l'auteur du geste.
  // La matiere existait depuis le debut cote main ; aucun canal ne la rendait au journal du chat.
  ipcMain.handle('os:conversationFileTraces', (event, rawConversationId: unknown) => {
    assertTrustedRendererSender(event, 'Conversation file traces')
    const conversationId = guardString(rawConversationId, 'conversationId')
    return readConversationFileTraces(conversationId)
  })
  ipcMain.handle('os:brainTraces', (event, rawConversationId: unknown) => {
    assertTrustedRendererSender(event, 'Brain traces')
    const conversationId = guardString(rawConversationId, 'conversationId')
    return readBrainTraces(conversationId)
  })
  ipcMain.handle('os:semanticTimeline', (event, rawConversationId: unknown) => {
    assertTrustedRendererSender(event, 'Semantic timeline')
    const conversationId = guardString(rawConversationId, 'conversationId')
    return rebuildSemanticTemporalProjection(
      {
        events: causalTrace.readConversationBestEffort(conversationId),
        brainTraces: readBrainTraces(conversationId)
      },
      { base: app.getPath('userData'), brainRoot: amitelBrainRoot() }
    )
  })
  // Les canaux du diagnostic de prérequis vivent dans src/main/ipc/preflight.ts.
  registerPreflightIpc({ preflightProviderOptions })
  // Les canaux git (lecture seule) vivent dans src/main/ipc/git.ts.
  registerGitIpc({ os, pickDirectory })
  // Les canaux de la vue Tests vivent dans src/main/ipc/tests-view.ts.
  registerTestsViewIpc({ os, pickDirectory })
  // Les canaux de l'onglet Latence vivent dans src/main/ipc/perf.ts.
  registerPerfIpc({ appDataRoot })
  // Racine du Brain partagé : permet à Source control de basculer sur SON dépôt git en un clic
  // (les notes du Brain sont versionnées comme le code). Lecture seule, aucun secret exposé.
  // Clôture automatique d'un run vert (commit + push sur branche dédiée). OFF par défaut.
  ipcMain.handle('run:autoClose:get', (event) => {
    assertTrustedRendererSender(event, 'AutoClose')
    return os.getAutoClose()
  })
  ipcMain.handle('run:autoClose:set', (event, enabled: unknown) => {
    assertTrustedRendererSender(event, 'AutoClose')
    os.setAutoClose(enabled === true)
    return os.getAutoClose()
  })
  // Les canaux des copies de travail vivent dans src/main/ipc/worktree.ts. La fixture de test
  // reste posee d'ici (canal `app:test:worktree-fixture`), mais l'etat vit la-bas.
  const worktreeIpc = registerWorktreeIpc({ os })
  ipcMain.handle('app:test:worktree-fixture', (event, value: unknown) => {
    assertTrustedRendererSender(event, 'Fixture worktree')
    if (!isolatedTestInstance) throw new Error('Fixture worktree indisponible hors instance isolée')
    if (!value || typeof value !== 'object') throw new Error('Fixture worktree invalide')
    const fixture = value as Record<string, unknown>
    if (!Array.isArray(fixture.activity) || !fixture.status || typeof fixture.status !== 'object') {
      throw new Error('Fixture worktree incomplète')
    }
    const nextFixture = fixture as WorktreeFixtureDeTest
    worktreeIpc.poserFixtureDeTest(nextFixture)
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('worktree:activity-changed', nextFixture.activity)
    }
    return true
  })
  os.onWorktreeActivity((activity) => {
    for (const w of BrowserWindow.getAllWindows())
      w.webContents.send('worktree:activity-changed', activity)
  })
  // COMPTER les refus d'intégration. Rien ne les comptait : `trace.json` n'a pas de champ `reason`
  // (ses occurrences du mot sont du code source cité par des agents), les 1995 RUN.md n'en gardent
  // rien, et le journal de conversations est rotatif. Un chantier antérieur s'est pourtant priorisé
  // sur un décompte tiré de cet artefact. Ici l'événement est ÉMIS, jamais lu d'un fichier : il ne
  // peut pas se polluer de la même façon.
  os.onRefusIntegration((refus) => ledger.append(evenementRefusIntegration(refus)))
  // `index.ts` garde la SEULE autorité sur `agentTopology` (variable réassignée) : les modules la
  // reçoivent en lecture/écriture, jamais en valeur.
  const lireTopologie = (): AgentTopology => agentTopology
  const appliquerTopologie = (topology: AgentTopology): AgentTopology => {
    agentTopology = saveAgentTopology(agentTopologyPath, topology, agentModels)
    syncRuntimeTopology(agentTopology)
    return agentTopology
  }
  const broadcastRolesRefresh = (): void => broadcast({ type: 'refresh', scope: 'roles' })
  registerRolesIpc({
    os,
    agentModelsReady,
    lireModeles: () => agentModels,
    lireTopologie,
    appliquerTopologie,
    broadcastRolesRefresh
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
  const workflowRefusalMailbox = new WorkflowRefusalMailbox()
  const appliquerWorkflowActif = (fichier: WorkflowProfilesFile): void => {
    // Un workflow imposé puis CASSÉ par une édition ne doit pas rester le workflow du chat :
    // `activeWorkflowProfile` le refuse, et le refus se dit au lieu de disparaître en silence.
    const refus = workflowRefusalMailbox.update(fichier)
    if (refus) {
      console.warn(`[workflow] ${refus.message}`)
      broadcast({
        type: 'toast',
        text: refus.message,
        noticeId: workflowRefusalMailbox.peek()?.id
      })
    }
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
  ipcMain.handle('os:workflowProfiles:notice', (event) => {
    assertTrustedRendererSender(event, 'Workflow profile notice')
    return workflowRefusalMailbox.peek()
  })
  ipcMain.handle('os:workflowProfiles:acknowledgeNotice', (event, rawId: unknown) => {
    assertTrustedRendererSender(event, 'Workflow profile notice acknowledgement')
    if (typeof rawId !== 'number' || !Number.isSafeInteger(rawId)) {
      throw new Error('Identifiant de notice invalide')
    }
    return workflowRefusalMailbox.acknowledge(rawId)
  })
  ipcMain.handle('os:workflowProfiles:upsert', (event, raw: unknown) => {
    assertTrustedRendererSender(event, 'Workflow profiles')
    const next = upsertWorkflowProfile(loadWorkflowProfiles(), raw as WorkflowProfile)
    saveWorkflowProfiles(next)
    // Éditer le graphe du workflow ACTIF doit prendre effet tout de suite : sinon le moteur
    // continuerait de jouer la version d'avant, sans que rien ne le signale.
    appliquerWorkflowActif(next)
    broadcast({ type: 'refresh', scope: 'workflows' })
    return next
  })
  ipcMain.handle('os:workflowProfiles:remove', (event, rawId: unknown) => {
    assertTrustedRendererSender(event, 'Workflow profiles')
    const next = removeWorkflowProfile(loadWorkflowProfiles(), guardString(rawId, 'id'))
    saveWorkflowProfiles(next)
    // Supprimer le workflow actif doit le retirer du moteur, pas le laisser piloter un profil mort.
    appliquerWorkflowActif(next)
    broadcast({ type: 'refresh', scope: 'workflows' })
    return next
  })
  ipcMain.handle('os:workflowProfiles:select', (event, rawId: unknown) => {
    assertTrustedRendererSender(event, 'Workflow profiles')
    const id = rawId === null ? null : guardString(rawId, 'id')
    const next = selectWorkflowProfile(loadWorkflowProfiles(), id)
    saveWorkflowProfiles(next)
    appliquerWorkflowActif(next)
    broadcast({ type: 'refresh', scope: 'workflows' })
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
    const cible = await pickSavePath(event.sender, suggestedFileName(id ? choisis[0] : undefined))
    if (!cible) return { ok: false as const, reason: 'annulé' }
    const paquet = buildExport(choisis, new Date().toISOString())
    writeFileSync(cible, JSON.stringify(paquet, null, 2), 'utf8')
    return { ok: true as const, path: cible, count: choisis.length }
  })
  /**
   * Faire entrer des workflows depuis un fichier. Le contenu n'est JAMAIS cru : il passe par le même
   * assainisseur que la relecture locale, et un identifiant en collision est ré-attribué plutôt que
   * d'écraser en silence le workflow d'à côté.
   */
  ipcMain.handle('os:workflowProfiles:import', async (event) => {
    assertTrustedRendererSender(event, 'Workflow profiles')
    const choisi = await pickPath(event.sender, 'openFile')
    if (!choisi) {
      return { ok: false as const, reason: 'annulé', file: loadWorkflowProfiles() }
    }
    let brut: unknown
    try {
      // Le BOM est retiré : sous Windows, presque tout ce qui écrit un JSON à la main en pose un.
      brut = JSON.parse(readFileSync(choisi, 'utf8').replace(/^\uFEFF/, ''))
    } catch {
      return { ok: false as const, reason: 'fichier illisible', file: loadWorkflowProfiles() }
    }
    let fichier = loadWorkflowProfiles()
    const { profiles, rejected } = readImport(brut, fichier.profiles)
    for (const profil of profiles) fichier = upsertWorkflowProfile(fichier, profil)
    if (profiles.length) {
      saveWorkflowProfiles(fichier)
      appliquerWorkflowActif(fichier)
      broadcast({ type: 'refresh', scope: 'workflows' })
    }
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
  // Confronter plusieurs workflows sur un même objectif. La logique vit dans son module : ce point
  // d'entrée n'a qu'à la brancher.
  registerWorkflowBenchIpc({
    ipcMain,
    assertTrusted: (event, label) => assertTrustedRendererSender(event, label),
    assertBindingAvailable: (binding) => assertRuntimeBindingAvailable(binding, agentModels),
    currentRoles: () => os.roles.all(),
    captureCheckpoint: (objective) =>
      captureWorkflowBenchCheckpoint(os.executionWorkspace, objective),
    captureWorkspaceState: captureRetainedWorkspaceState,
    // Le juge de QUALITE. Sans lui, le banc departageait sur le PRIX en laissant croire qu'il
    // departageait la valeur — mesure du 2026-08-06 : un workflow recommande parce qu'il coutait
    // 0,65 $ de moins, sans que rien n'ait lu ce qu'il produisait. La comparaison qu'il recoit est
    // AVEUGLE (livrables etiquetes A/B, aucun nom de workflow).
    judgeQuality: async (prompt) => {
      const binding = os.roles.all().judge ?? os.roles.all().orchestrator
      if (!binding?.provider) return ''
      const res = await os.registry.send(binding.provider, [{ role: 'user', content: prompt }], {
        model: binding.model,
        reasoningEffort: 'low'
      })
      return res.text ?? ''
    },
    runOrchestration: (
      objective,
      bindingOverride,
      signal,
      workflowOverride,
      publication,
      sourceSnapshot
    ) =>
      os.runTask(
        objective,
        undefined,
        undefined,
        undefined,
        signal,
        '',
        [],
        undefined,
        bindingOverride,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        [],
        undefined,
        { workflowOverride, publication, sourceSnapshot }
      )
  })
  /*
   * ETAT DU MOTEUR — le pied de page doit pouvoir dire que le code qui tourne n'est plus celui des
   * sources. Mesure du 2026-08-25 : `electron-vite dev` ne reconstruit PAS le processus principal,
   * donc un correctif reste invisible jusqu'a un redemarrage manuel, sans que rien ne le signale.
   *
   * On MONTRE au lieu de redemarrer : `--watch` a deja ete essaye et tuait l'application pendant le
   * travail (`dev-sans-watch.test.ts` l'interdit depuis).
   *
   * Le balayage est fait A LA DEMANDE et non au demarrage : appele une fois par ouverture de
   * fenetre, il ne coute rien, et la reponse reste fraiche si l'utilisateur laisse l'app ouverte.
   */
  ipcMain.handle('os:moteur:etat', (event) => {
    assertTrustedRendererSender(event, 'Etat du moteur')
    try {
      return observerLeMoteur(app.getAppPath(), demarrageDuMoteurMs, app.isPackaged)
    } catch {
      // Un pied de page ne fait jamais tomber l'application : sans reponse, il n'affiche rien.
      return { perime: false }
    }
  })
  ipcMain.handle('os:orchestrationBudget:get', (event) => {
    assertTrustedRendererSender(event, 'Orchestration budget')
    return loadOrchestrationBudget(orchestrationBudgetPath)
  })
  ipcMain.handle('os:orchestrationBudget:set', (event, value: unknown) => {
    assertTrustedRendererSender(event, 'Orchestration budget')
    return saveOrchestrationBudget(orchestrationBudgetPath, value)
  })
  ipcMain.handle('os:shadowRoutingPilot:get', (event) => {
    assertTrustedRendererSender(event, 'Pilote de routage shadow')
    return shadowRoutingPilotState()
  })
  ipcMain.handle('os:shadowRoutingPilot:set', (event, enabled: unknown) => {
    assertTrustedRendererSender(event, 'Pilote de routage shadow')
    const saved = saveShadowRoutingPilotSetting(shadowRoutingPilotPath, enabled)
    // Reconstruction IMMEDIATE : le sink de trace relit `shadowRoutingRuntime` a chaque evenement,
    // la bascule prend donc effet sans redemarrage. L'environnement garde la priorite.
    shadowRoutingRuntime = createShadowRoutingRuntime(
      shadowRoutingObservationsPath,
      process.env,
      saved.enabled
    )
    return shadowRoutingPilotState(saved)
  })
  // Reprojeter les modeles de Compute Fabric : `applyFabricSummaries` a d'autres appelants au
  // demarrage, elle reste donc dans `index.ts` et les modules la recoivent.
  const synchroniserFabric = (): void => applyFabricSummaries(fabricControlPlane.list())
  registerModelsIpc({
    os,
    modelCatalog,
    lireModeles: () => agentModels,
    lireTopologie,
    synchroniserFabric,
    isolatedTestInstance
  })
  registerFabricIpc({
    fabricControlPlane,
    lireFixtureIsolee: () => isolatedFabricFixtureSummary,
    synchroniserFabric,
    broadcastRolesRefresh
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
    if (!shadowRoutingRuntime.enabled) {
      return {
        status: 'insufficient-data' as const,
        confidence: 'insufficient' as const,
        phase: safePhase,
        reason:
          'Routeur shadow desactive : activez « Mesurer les routes (pilote shadow) » dans Settings > Budget pour que l app commence a mesurer quelle route tient le vert au cout le plus bas.'
      }
    }
    if (!champion || typeof champion !== 'object') throw new Error('Champion invalide')
    const route = champion as { provider?: unknown; model?: unknown }
    const samples = shadowRoutingRuntime.store.read().map((observation) => ({
      phase: observation.phase,
      provider: observation.provider,
      model: observation.model,
      cost: observation.costUsd ?? 0,
      durationMs: observation.durationMs ?? 0,
      green: observation.outcome === 'verified-success'
    }))
    return recommendShadowRoute(samples, {
      phase: safePhase,
      champion: {
        provider: guardString(route.provider, 'champion.provider'),
        model: guardString(route.model, 'champion.model')
      }
    })
  })
  registerProfilesIpc({
    os,
    profiles,
    agentModelsReady,
    lireTopologie,
    appliquerTopologie,
    broadcastRolesRefresh
  })
  registerTopologyIpc({
    agentModelsReady,
    lireTopologie,
    appliquerTopologie,
    broadcastRolesRefresh
  })
  // Les canaux de l'inventaire des capacités vivent dans src/main/ipc/capabilities.ts.
  registerCapabilitiesIpc({
    lireConversationActive: () => bus.activeConversationId,
    broadcast
  })

  ipcMain.handle('os:behaviour:choose-workspace', async (event) => {
    assertTrustedBehaviourSender(event)
    const selected = await pickDirectory(event.sender)
    return selected ? behaviourAccess.approve(selected) : null
  })

  ipcMain.handle('model:question:answer', (event, id: string, answer: unknown) => {
    assertTrustedRendererSender(event, 'Model question')
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
  ipcMain.handle('os:toolUsage', (event) => {
    assertTrustedRendererSender(event, 'Tool usage')
    return aggregateToolUsage()
  })

  // Les canaux des conversations vivent dans src/main/ipc/conversations.ts.
  registerConversationsIpc({
    os,
    activeChatTurns,
    causalTrace,
    ledger,
    conversationRouteCoordinator,
    turnJournalRoot,
    isolatedTestInstance,
    broadcast,
    pickDirectory,
    compterLectureIsolee: () => {
      isolatedConversationReadCount += 1
    }
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

  // Les canaux du Brain (graphe 3D, recherche, boite de reception) vivent dans
  // src/main/ipc/brain.ts.
  registerBrainIpc({
    os,
    bus,
    brainWorker,
    brainSearchWorker,
    brainInboxWorker,
    brainSearchCoordinator,
    outcomeLearning,
    curationRecoveryReady,
    invalidateBrainRuntime
  })
  ipcMain.handle('os:outcomeLearning:get', (event) => {
    assertTrustedRendererSender(event, 'OutcomeLearningRead')
    return { mode: outcomeLearning.getMode(), events: outcomeLearning.audit(30) }
  })
  ipcMain.handle(
    'os:outcomeLearning:curations',
    (event, rawOffset: number = 0, rawLimit: number = 20) => {
      assertTrustedRendererSender(event, 'OutcomeLearningCurations')
      return outcomeLearning.curationPage(rawOffset, rawLimit)
    }
  )
  ipcMain.handle('os:outcomeLearning:setMode', (event, rawMode: string) => {
    assertTrustedRendererSender(event, 'OutcomeLearningMode')
    const mode = guardString(rawMode, 'mode').trim().toLowerCase()
    if (!['off', 'shadow', 'inbox', 'auto'].includes(mode)) {
      throw new Error('mode outcome-learning invalide')
    }
    mkdirSync(outcomeLearningDirectory, { recursive: true })
    writeFileSync(outcomeLearningModePath, `${mode}\n`, { encoding: 'utf8', mode: 0o600 })
    return { mode: outcomeLearning.setMode(mode as 'off' | 'shadow' | 'inbox' | 'auto') }
  })
  ipcMain.handle('os:outcomeLearning:undoCuration', async (event, rawEventId: string) => {
    assertTrustedRendererSender(event, 'OutcomeLearningUndo')
    const eventId = guardString(rawEventId, 'eventId')
    await curationRecoveryReady
    const curation = outcomeLearning.eventById(eventId)
    if (!curation || curation.kind !== 'curation') throw new Error('curation introuvable')
    const root = amitelBrainRoot()
    const inverseAction = curation.value.action === 'restore' ? 'retract' : 'restore'
    const inverseSource =
      curation.value.action === 'retract'
        ? curation.value.targetId
        : curation.value.action === 'restore'
          ? curation.value.targetId
          : curation.value.rollbackId
    if (!inverseSource) throw new Error('curation sans point de rollback')
    return executeCurationTransaction(
      outcomeLearning,
      {
        action: inverseAction,
        knowledgeId: inverseSource,
        requestedTargetId: `undo:${curation.value.eventId}`
      },
      {
        mutate: () => {
          const compensation = compensateOutcomeCuration(curation.value, {
            restore: (id) => restoreTrashedKnowledge(root, id),
            retract: (id) => retractKnowledgeCandidate(root, id)
          })
          return {
            moved: compensation.moved,
            knowledgeId: compensation.knowledgeId,
            targetId: compensation.targetId,
            rollbackId: compensation.rollbackId,
            previousEventId: compensation.previousEventId
          }
        },
        compensate: (result) =>
          inverseAction === 'restore'
            ? retractKnowledgeCandidate(root, result.targetId)
            : restoreTrashedKnowledge(root, result.targetId),
        invalidate: invalidateBrainRuntime
      }
    )
  })
  ipcMain.handle('os:listRuns', (event) => {
    assertTrustedRendererSender(event, 'Runs')
    return os.listRuns()
  })
  ipcMain.handle('os:runs:delete', async (event, rawPath: string) => {
    assertTrustedRendererSender(event, 'DeleteRun')
    await deleteListedRun(guardString(rawPath, 'path'))
    return { ok: true }
  })

  // Ouvre le dossier contenant un fichier dans l'explorateur (vue Workflow).
  ipcMain.handle('os:openFolder', (event, path: string) => {
    assertTrustedRendererSender(event, 'Open folder')
    shell.showItemInFolder(guardString(path, 'path'))
  })

  // Liens de fichiers du markdown : le renderer envoie la cible BRUTE citee par l'agent, le main
  // decide. Il re-parse (le renderer n'est pas cru), resout contre la racine du workspace et
  // REFUSE tout ce qui sort de cette racine ou n'existe pas. Ouvre le fichier ; a defaut le
  // revele dans l'explorateur.
  ipcMain.handle('os:revealFile', async (event, rawPath: unknown, rawLine?: unknown) => {
    assertTrustedRendererSender(event, 'Reveal file')
    const cible = parseFileRef(guardString(rawPath, 'path'))
    if (!cible) return { ok: false, reason: 'cible-non-fichier' }
    // Le renderer envoie `revealFile(path, line)` : le chemin n'a plus son suffixe `:80`. On prend
    // donc l'argument separe, APRES validation, et la cible ne sert que de repli.
    const ligne = ligneDemandee(rawLine, cible.line)

    // Un agent cite ce qu'il voit depuis SA copie. Chercher dans le seul workspace rendait
    // `introuvable` sur tout fichier cree pendant le run — la plainte d'origine (conv-1427).
    const worktreesRoot = join(ensureAutowinAppData(appDataRoot), 'worktrees')
    const racines = racinesRevelation({
      workspace: process.env.AUTOWIN_OS_WORKSPACE ?? process.cwd(),
      worktreesRoot: existsSync(worktreesRoot) ? worktreesRoot : undefined,
      lister: (dir) => {
        try {
          return readdirSync(dir, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
        } catch {
          return []
        }
      }
    })

    let absolu: string | null = null
    let horsRacine = true
    for (const racine of racines) {
      const candidat = resolveFileRef(racine, cible.path)
      if (!candidat) continue
      horsRacine = false
      if (existsSync(candidat)) {
        absolu = candidat
        break
      }
    }
    if (horsRacine) return { ok: false, reason: 'hors-racine' }
    if (!absolu) return { ok: false, reason: 'introuvable' }

    // Ouvrir A LA LIGNE demande de savoir quel editeur : `shell.openPath` ne le peut pas. Quand on
    // ne sait pas, on ouvre quand meme ET on le DIT — taire l'ecart etait le defaut d'origine.
    const editeur = commandeEditeur({
      editeur: process.env.AUTOWIN_OS_EDITOR,
      chemin: absolu,
      ligne
    })
    if (editeur) {
      try {
        spawn(editeur.commande, editeur.args, { detached: true, stdio: 'ignore' }).unref()
        return { ok: true, reason: 'ouvert-a-la-ligne' }
      } catch {
        // Editeur mal configure : on retombe sur l'ouverture simple plutot que de ne rien faire.
      }
    }
    const erreur = await shell.openPath(absolu)
    if (erreur) {
      shell.showItemInFolder(absolu)
      return { ok: true, reason: 'revele-dans-explorateur' }
    }
    return ligne === undefined ? { ok: true } : { ok: true, reason: 'ligne-non-honoree' }
  })

  // --- Plan de contrôle : l'app pilotable par les agents ---
  ipcMain.handle('os:appState', (event) => {
    assertTrustedRendererSender(event, 'App state')
    return bus.snapshot()
  })
  ipcMain.handle('os:appCommand', (event, name: string, args?: Record<string, unknown>) => {
    assertTrustedRendererSender(event, 'App command')
    return bus.exec(guardString(name, 'name'), args)
  })
  // Chat transparent : l'agent converse ET pilote l'app dans le même tour.
  // conversationId (optionnel) → le tour est PERSISTÉ dans la conversation (fil rechargeable).
  // Le corps du tour vit dans src/main/chat/run-pilot-chat.ts : il ne capturait rien d'autre que
  // les valeurs listees ici, qui lui sont desormais passees explicitement.
  const runPilotChat = createRunPilotChat({
    os,
    pilot,
    bus,
    activeChatTurns,
    scheduledTasks,
    causalTrace,
    ledger,
    pendingDirectives,
    turnJournalRoot,
    isolatedTestInstance,
    broadcast,
    drainPendingDirectives,
    askModelQuestion,
    notifyWatchdogWorkflowIncident,
    reportAutoKaizen,
    watchdogEngine: () => watchdogEngine
  })
  /**
   * Reprend les appels de chat dont le CLI a survécu au main. La réservation locale empêche un
   * nouveau message d'entrer dans la même conversation pendant qu'on attend la preuve `.exit.json`.
   * Aucun timeout ne transforme une ignorance en relance : seule une sortie certifiée est traitée.
   */
  for (const call of startupRecoverableChatCalls) {
    const recoveryController = new AbortController()
    let resolveRecovery!: () => void
    const recoveryCompletion = new Promise<void>((resolve) => {
      resolveRecovery = resolve
    })
    activeChatTurns.set(call.conversationId, recoveryController, recoveryCompletion)
    setImmediate(() => {
      void (async () => {
        try {
          const terminal = await waitForRecoverableChatProviderExit(call.journalPath, {
            signal: recoveryController.signal,
            fallbackActivityAt: call.updatedAt
          })

          const closeWithoutRecovery = (event: ChatTurnEvent): void => {
            if (os.conversations.get(call.conversationId)) {
              os.conversations.applyTurnEvent(call.conversationId, call.turnId, event)
            }
            appendTurnEvent(turnJournalRoot, call.conversationId, call.turnId, {
              ...event,
              at: Date.now()
            })
            broadcast({ type: 'refresh', scope: 'conversations' })
          }
          if (terminal.kind === 'aborted') {
            closeWithoutRecovery({ kind: 'cancelled' })
            return
          }
          if (terminal.kind === 'stale') {
            closeWithoutRecovery({ kind: 'interrupted' })
            return
          }
          const { exitCode } = terminal
          if (exitCode !== 0) {
            closeWithoutRecovery({
              kind: 'failed',
              error: `Appel provider détaché terminé avec le code ${exitCode ?? 'inconnu'}`
            })
            return
          }

          const events = readTurnJournal(turnJournalRoot, call.conversationId, call.turnId)
          if (isTurnFinished(events)) return
          const result = recoverCompletedChatProviderCall(call.provider, call.journalPath)
          if (!result) {
            closeWithoutRecovery({
              kind: 'failed',
              error: 'Sortie provider certifiée mais résultat terminal illisible ou incomplet'
            })
            return
          }

          const conversation = os.conversations.get(call.conversationId)
          const assistantIndex = conversation?.messages.findIndex(
            (message) => message.role === 'assistant' && message.turnId === call.turnId
          )
          if (!conversation || assistantIndex === undefined || assistantIndex < 1) {
            appendTurnEvent(turnJournalRoot, call.conversationId, call.turnId, {
              kind: 'failed',
              error: 'Conversation ou tour d’origine introuvable pour la reprise',
              at: Date.now()
            })
            return
          }
          const assistant = conversation.messages[assistantIndex]
          const messages = conversation.messages
            .slice(0, assistantIndex)
            .filter(
              (message): message is typeof message & { role: 'user' | 'assistant' } =>
                message.role === 'user' || message.role === 'assistant'
            )
            .map((message) => ({ role: message.role, content: message.content }))
          const runtime = assistant.runtime
          const binding = runtime
            ? {
                provider: runtime.provider,
                model: runtime.model,
                reasoningEffort: runtime.reasoningEffort as ReasoningEffort | undefined
              }
            : undefined
          await runPilotChat(
            undefined,
            messages,
            call.conversationId,
            binding,
            {
              turnId: call.turnId,
              call,
              providerCall: {
                iteration: call.iteration,
                attempt: call.attempt,
                streamId: call.streamId,
                streamedPrefix: streamedPrefixForProviderCall(events, call.streamId),
                ...(call.settledActions?.length ? { settledActions: call.settledActions } : {}),
                result
              }
            },
            call.policy
          )
        } catch (error) {
          console.warn('[resume-chat-provider] reprise impossible :', call.turnId, error)
        } finally {
          activeChatTurns.delete(call.conversationId, recoveryController)
          resolveRecovery()
        }
      })()
    })
  }
  // Désarmé : la règle Watchdog « Auto-kaizen » a repris son rôle (voir
  // AUTO_KAIZEN_SUPERVISOR_ENABLED). Laisser les deux actifs déclencherait DEUX agents par incident.
  if (AUTO_KAIZEN_SUPERVISOR_ENABLED)
    autoKaizenSupervisor = new AutoKaizenSupervisor({
      path: join(app.getPath('userData'), 'auto-kaizen-incidents.json'),
      runtime: {
        createConversation: ({ title, link }) => {
          const source = os.conversations.get(link.sourceConversationId)
          return os.conversations.create({
            title: title.slice(0, 140),
            provider: source?.provider ?? os.roles.getBinding('orchestrator').provider,
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
  autoKaizenSupervisor?.resumePending()
  /*
   * DECLARE au detecteur de gel. Mesure du 2026-08-30 : les gels de 6 a 10 s reviennent en RAFALES
   * espacees d'une dizaine de secondes — la cadence de CE minuteur. `resumePending` traverse
   * `persist()`, donc `archiveIncidents` + `saveSnapshot`, deux ecritures SYNCHRONES. Suspect, pas
   * coupable : on le NOMME d'abord, on corrigera ce que le journal designe.
   */
  const autoKaizenResumeTimer = setInterval(
    () =>
      pendantOperation('timer:autoKaizen:resumePending', () =>
        autoKaizenSupervisor?.resumePending()
      ),
    15_000
  )
  autoKaizenResumeTimer.unref()

  /**
   * Le balayage des copies d'agent abandonnées, RÉPÉTÉ pendant la session et non plus au seul démarrage.
   *
   * Mesuré le 2026-08-14 sur l'installation de l'utilisateur : 49 copies pour 1 453 Mo. Une copie
   * abandonnée à 9 h attendait le prochain lancement pour être vue, alors que les sessions durent la
   * journée. L'heure est calibrée sur l'âge minimal du balayage (24 h) : plus court n'avancerait aucun
   * verdict, plus long laisserait le disque grossir sans raison. `unref()` comme le minuteur voisin,
   * sinon un minuteur horaire retient la boucle d'événements et la fermeture ne se fait plus proprement.
   */
  const balayagePeriodiqueTimer = setInterval(
    () => {
      void pendantOperation('timer:balayage:copiesAbandonnees', () =>
        os.worktrees?.balayerLesCopiesAbandonnees()
      )
    },
    60 * 60 * 1_000
  )
  balayagePeriodiqueTimer.unref()

  ipcMain.handle('os:pilotChat', (event, messages, conversationId) => {
    assertTrustedRendererSender(event, 'PilotChat')
    return runPilotChat(event.sender, messages, conversationId)
  })
  ipcMain.handle('os:pilotChat:resume', (event, rawConversationId: unknown) => {
    assertTrustedRendererSender(event, 'ResumePilotChat')
    const conversationId = guardString(rawConversationId, 'conversationId')
    const conversation = os.conversations.get(conversationId)
    if (!conversation) throw new Error(`Conversation inconnue: ${conversationId}`)
    if (activeChatTurns.get(conversationId))
      throw new Error('Un tour est déjà en cours dans cette conversation')
    const history = conversation.messages.map((message) => ({
      role: message.role,
      content: message.content
    }))
    return runPilotChat(
      event.sender,
      buildContinuationProviderHistory(history),
      conversationId,
      undefined,
      undefined,
      undefined,
      undefined,
      true
    )
  })

  const relayScriptPath = app.isPackaged
    ? join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'autowin-task-relay.ps1')
    : join(app.getAppPath(), 'resources', 'autowin-task-relay.ps1')
  // Runtime partagé : les tâches planifiées ET le scout de veille visible passent par le même
  // chemin de conversation — un agent de fond reste un agent du cockpit, jamais un process muet.
  const scheduledChatRuntime: ScheduledChatRuntime = {
    agentStudioBinding: () => os.roles.getBinding('orchestrator'),
    hasConversation: (conversationId) => Boolean(os.conversations.get(conversationId)),
    createConversation: (input) => os.conversations.create(input),
    bindConversation: (taskId, conversationId) => {
      scheduledTasks.bindConversation(taskId, conversationId)
    },
    isConversationBusy: (conversationId) => Boolean(activeChatTurns.get(conversationId)),
    interruptAndWait: (conversationId, reason) =>
      activeChatTurns.abortAndWait(conversationId, reason),
    waitForInteractiveIdle: (timeoutMs) => activeChatTurns.waitForIdle(timeoutMs),
    releaseInteractiveIdle: () => activeChatTurns.releaseIdleLease(),
    runPrompt: async (conversationId, prompt, binding, policy, onLateUsageSettlement) => {
      const result = await runPilotChat(
        undefined,
        [{ role: 'user', content: prompt }],
        conversationId,
        binding,
        undefined,
        policy,
        onLateUsageSettlement
      )
      const mutations = readConversationTurnFileMutations(conversationId, result.turnId)
      return {
        ...result,
        mutatedPaths: mutations.paths,
        mutatedLineFingerprints: mutations.lineFingerprintsByPath,
        mutatedPathGenerationMarkers: mutations.generationMarkersByPath
      }
    },
    /**
     * Règle Watchdog en action `orchestration` : on passe par le MÊME `orchestrate` que le chat et
     * les agents, donc par le pipeline complet avec son gate à preuve et son juge.
     */
    runOrchestration: (conversationId, request, task, onLateMutationClaims) =>
      runWatchdogOrchestration(
        {
          exec: (requested, convId, causalWatchPaths, onLateClaims) =>
            bus.exec(
              'orchestrate',
              {
                task: requested.instruction,
                causalWatchPaths,
                ...(requested.evidence ? { watchdogEvidence: requested.evidence } : {}),
                ...(onLateClaims ? { onLateMutationClaims: onLateClaims } : {})
              },
              convId,
              scheduledTaskBinding(task)
            ),
          readMutatedPaths: (convId, turnId) => readConversationTurnFilePaths(convId, turnId),
          readMutatedLineFingerprints: (convId, turnId) =>
            readConversationTurnFileMutations(convId, turnId).lineFingerprintsByPath,
          readMutatedPathGenerationMarkers: (convId, turnId) =>
            readConversationTurnFileMutations(convId, turnId).generationMarkersByPath
        },
        conversationId,
        request,
        task,
        onLateMutationClaims
      )
  }
  const taskDispatcher = new ScheduledChatDispatcher(scheduledChatRuntime)
  const relay = new PowerShellWindowsRelay({
    scriptPath: relayScriptPath,
    executablePath: process.execPath,
    taskName: windowsRelayTaskName(app.getPath('userData')),
    migrateUnscopedLegacy: !explicitUserDataDir,
    launchArguments: isolatedRelayLaunchArguments({
      isolated: isolatedTestInstance,
      remoteDebuggingPort: app.commandLine.getSwitchValue('remote-debugging-port'),
      userDataPath: app.getPath('userData')
    })
  })
  // La tâche planifiée « veille » passe ENFIN par le scheduler (le dispatcheur existait mais n'était
  // branché nulle part — exposé-jamais-appelé). Sa passe : le scout interne en conversation VISIBLE,
  // puis les scouts web + l'audit de corrections du dépôt, fusionnés dans le même stock.
  const dispatcherVeille = dispatcherAvecVeille({
    suivant: taskDispatcher,
    // La passe planifiee COMPLETE est gardee a son tour : deux occurrences qui se recouvrent (une
    // passe plus longue que son intervalle) rejoignent la premiere au lieu de doubler les scouts web.
    executerPasse: unePasseALaFois(async () => {
      await genererCandidatsInternesVisibles()
      return executerPasse({
        lancerScout: lancerScoutVeille,
        candidatsInternes: candidatsInternesDuDepot(os.executionWorkspace)
      })
    })
  })
  scheduledTaskScheduler = new TaskScheduler(scheduledTasks, dispatcherVeille, relay)
  // Le moteur de réveil OBSERVE et délègue à ce même scheduler : il n'y a qu'un chemin d'exécution.
  if (!AUTO_KAIZEN_SUPERVISOR_ENABLED) {
    watchdogEngine = new WatchdogEngine(
      () => scheduledTasks.listTasks(),
      {
        runWatchdog: async (taskId, signal, onLateMutationClaims, onLateUsageSettlement) => {
          const result = await os.executionSupervisor.runOutsideCurrent(
            async () =>
              (await scheduledTaskScheduler?.runWatchdog(
                taskId,
                signal,
                onLateMutationClaims,
                onLateUsageSettlement
              )) ?? {
                fired: false
              }
          )
          if (result.fired) broadcast({ type: 'refresh', scope: 'task-manager' })
          return result
        }
      },
      undefined,
      undefined,
      () => broadcast({ type: 'refresh', scope: 'task-manager' }),
      (taskId) =>
        scheduledTasks
          .listOccurrences(taskId)
          .filter(
            (occurrence) => occurrence.trigger === 'watchdog' && occurrence.watchdog !== undefined
          )
          .map((occurrence) => ({
            eventId: occurrence.id,
            signature: occurrence.watchdog!.signature,
            rootSignature: occurrence.watchdog!.rootSignature,
            admittedAt: occurrence.claimedAt,
            knownCostUsd: occurrence.knownCostUsd,
            unpricedCalls: occurrence.unpricedCalls
          }))
    )
  }
  os.onRecoveredCausalMutationClaims((claims) => {
    watchdogEngine?.rememberRecoveredMutationClaims(claims)
  })
  // Le scheduler modifie le store hors IPC. L'abonnement au point de vérité garantit qu'un échec ou
  // une échéance manquée devient un événement live immédiatement, quel que soit son appelant.
  scheduledTasks.subscribe((snapshot) => {
    const retainedAlertIds = new Set(snapshot.alerts.map((alert) => alert.id))
    for (const alertId of notifiedTaskAlerts) {
      if (!retainedAlertIds.has(alertId)) notifiedTaskAlerts.delete(alertId)
    }
    for (const alert of snapshot.alerts) {
      if (alert.acknowledgedAt !== undefined || notifiedTaskAlerts.has(alert.id)) continue
      notifiedTaskAlerts.add(alert.id)
      void watchdogEngine?.notifyAppEvent(
        alert.kind === 'failed' ? 'task-failed' : 'task-missed',
        `Tâche « ${scheduledTasks.getTask(alert.taskId)?.title ?? alert.taskId} » : ${alert.message}`
      )
    }
    broadcast({ type: 'refresh', scope: 'task-manager' })
  })
  // Veille concurrents : la vue Tickets lit le stock et marque un candidat. Deux gestes, pas plus —
  // elle ne peut pas FABRIQUER de candidat, ce qui contournerait le controle de citation.
  /** Le binding du scout de veille : la config de rôles de l'utilisateur, jamais un défaut inventé. */
  const bindingScoutVeille = (): { provider: string; model?: string } => {
    const roleMap = os.roles.all()
    const choisi = roleMap.subagent ?? roleMap.orchestrator ?? Object.values(roleMap)[0]
    if (!choisi?.provider) throw new Error('aucun provider configuré pour le scout de veille')
    return { provider: choisi.provider, ...(choisi.model ? { model: choisi.model } : {}) }
  }
  /** Le scout interne comme AGENT VISIBLE : conversation dédiée, tour interruptible, coût compté. */
  const genererCandidatsInternesVisiblesBrut = (
    conversationId?: string
  ): ReturnType<typeof genererCandidatsEnConversation> =>
    genererCandidatsEnConversation({
      runtime: scheduledChatRuntime,
      binding: bindingScoutVeille(),
      racineDepot: os.executionWorkspace,
      racineDonnees: ensureAutowinAppData(appDataRoot),
      ...(conversationId ? { conversationId } : {})
    })
  /**
   * LA garde PARTAGEE de la generation interne — une seule, donnee aux DEUX chemins.
   *
   * `veille-ipc` portait deja une garde de simultaneite, mais INTERNE : elle ne dedoublonnait que
   * l'IPC contre lui-meme. Le planificateur appelle cette generation depuis son `executerPasse`,
   * donc passait a cote. Cliquer « En generer plus » pendant qu'une veille planifiee tournait
   * lancait un SECOND fan-out de scouts sur le meme stock — deux fois le cout, deux ecritures
   * concurrentes du meme magasin.
   *
   * CONSEQUENCE ASSUMEE : l'appelant tardif REJOINT la passe en cours, donc son `conversationId`
   * n'est pas honore — un clic pendant une passe planifiee remplit bien le stock, mais la
   * conversation visible est celle de la passe deja partie. Une passe partagee valait mieux que deux
   * fan-outs concurrents sur le meme magasin.
   */
  const genererCandidatsInternesVisibles = unePasseALaFois(genererCandidatsInternesVisiblesBrut)
  registerVeilleIpc({
    ipc: ipcMain,
    assertTrusted: assertTrustedRendererSender,
    // « En générer plus » : le scout interne seul (pas les scouts web), dans une conversation VISIBLE.
    genererInterne: genererCandidatsInternesVisibles
  })
  /**
   * CAPITALISATION : plus AUCUN declenchement automatique.
   *
   * Une conversation « [save] empreinte du depot » partait toute seule apres chaque run vert publie
   * (et la cloture auto etant active, cela arrivait a chaque fois). Retire a la demande explicite de
   * l'utilisateur le 2026-08-20 : « je veux pas que ca soit automatique, ca doit etre une brique
   * qu'on choisit ou pas d'invoquer selon le besoin ».
   *
   * `learn` reste ENTIEREMENT disponible, et de deux facons qui sont toutes deux un CHOIX : la
   * commande `/learn` dans le chat, ou un noeud `learn` place dans un workflow. Rien n'est perdu —
   * seul le declenchement subi disparait. `bus.onRunVertPublie` n'a plus d'abonne ; le point
   * d'extension reste en place pour qui voudrait s'y brancher explicitement.
   */
  /*
   * ORIENTER UN RUN : l'orchestrateur draine cette meme file ENTRE DEUX PHASES. Sans ce branchement,
   * `injectDirective` acceptait la directive et personne ne pouvait la lire avant la fin du run —
   * « j'ai oriente et rien ne se passe » (20/08). Meme file que le pilote de chat, donc une directive
   * est lue par le premier des deux qui atteint son point de drainage, jamais deux fois.
   */
  os.directivesEnAttente = (conversationId) => drainPendingDirectives(conversationId)

  /**
   * La passerelle Outlook LOCALE, pour les widgets Interlocuteurs et Agenda de la vue Accueil.
   *
   * Lecture seule du profil Outlook de la machine, par automation COM. Rien ne sort du poste : c'est
   * la raison pour laquelle Microsoft Graph a ete ecarte. Elle est construite ICI, une fois, parce
   * qu'elle porte un cache — en fabriquer une par appel relancerait un dialogue COM a chaque
   * rafraichissement de la page d'accueil.
   */
  const outlookGateway = new OutlookLocalGateway({ appRoot: app.getAppPath() })
  ipcMain.handle('outlook:snapshot', async (event, force: unknown) => {
    assertTrustedRendererSender(event, 'Outlook')
    return outlookGateway.snapshot(force === true)
  })
  // Canal DISTINCT de la lecture : ouvrir est un acte, lire n'en est pas un. Les separer garde la
  // garantie « lecture seule » de la passerelle lisible d'un coup d'oeil.
  ipcMain.handle('outlook:ouvrir', async (event, id: unknown) => {
    assertTrustedRendererSender(event, 'Outlook')
    return outlookGateway.openItem(id)
  })

  registerTaskManagerIpc({
    ipc: ipcMain,
    store: scheduledTasks,
    scheduler: scheduledTaskScheduler,
    watchdogDiagnostics: (taskId) => ({
      admittedLastHour: watchdogEngine?.admittedLastHour(taskId) ?? 0,
      ...(watchdogEngine?.complaint(taskId) ? { complaint: watchdogEngine.complaint(taskId) } : {})
    }),
    assertTrusted: assertTrustedRendererSender,
    onChanged: () => {
      broadcast({ type: 'refresh', scope: 'task-manager' })
    }
  })
  void scheduledTaskScheduler
    .start(startupTaskOccurrence)
    .then(async () => {
      for (const occurrenceId of pendingScheduledOccurrences) {
        await scheduledTaskScheduler?.runOccurrence(occurrenceId)
      }
      pendingScheduledOccurrences.clear()
      // Règles livrées d'origine (l'auto-kaizen). Posées AVANT le démarrage du moteur pour qu'il les
      // voie dès son premier passage, et UNE SEULE FOIS : supprimée par l'utilisateur, une règle
      // semée ne revient pas.
      if (!AUTO_KAIZEN_SUPERVISOR_ENABLED) {
        const seeded = seedWatchdogTasks(scheduledTasks)
        if (seeded.length) console.log(`[watchdog] règles livrées posées : ${seeded.length}`)
        // Après le scheduler : chaque règle fichier se positionne à la FIN de son fichier, donc
        // l'historique déjà écrit ne réveille personne au démarrage.
        await watchdogEngine?.start()
      }
      broadcast({ type: 'refresh', scope: 'task-manager' })
    })
    .catch((error) => {
      console.error('[task-manager] démarrage du scheduler impossible', error)
      broadcast({ type: 'refresh', scope: 'task-manager' })
    })

  ipcMain.handle('os:pilotChat:cancel', (event, rawConversationId: string) => {
    assertTrustedRendererSender(event, 'Pilot chat cancel')
    const conversationId = guardString(rawConversationId, 'conversationId')
    // Stoppe le tour pilote ET le sous-agent en vol rattaché à cette conversation.
    const orchestrationAborted = bus.abortOrchestration(
      conversationId,
      "arret demande par l'utilisateur (Stop du chat)"
    )
    const pilotAborted = activeChatTurns.abort(conversationId, 'user')
    return { ok: pilotAborted || orchestrationAborted }
  })
  /**
   * Un tour est-il REELLEMENT en vol pour cette conversation ?
   *
   * Le main est la seule autorite sur cette question, et le renderer n'avait aucun moyen de la poser.
   * Sans elle, un message persiste en `streaming` — l'app tuee en plein tour — se relisait au
   * demarrage comme un tour vivant : indicateur « N action en cours » colle, composer qui met les
   * messages EN FILE au lieu de les envoyer, et rien pour en sortir puisque l'annulation n'a aucun
   * tour a couper. Vecu par l'utilisateur le 20/08.
   *
   * Limite assumee : la sonde regarde le tour PILOTE. Une orchestration ne vit jamais hors d'un tour
   * pilote, mais si cela changeait, cette reponse deviendrait incomplete.
   */
  ipcMain.handle('os:pilotChat:active', (event, rawConversationId: string) => {
    assertTrustedRendererSender(event, 'Pilot chat active probe')
    const conversationId = guardString(rawConversationId, 'conversationId')
    return { active: Boolean(activeChatTurns.get(conversationId)) }
  })
  ipcMain.handle('os:orchestrate:cancel', (event, rawConversationId: string) => {
    assertTrustedRendererSender(event, 'Orchestration cancel')
    const conversationId = guardString(rawConversationId, 'conversationId')
    // Ce chemin ne coupe QUE l'orchestration, donc ne passe pas par `activeChatTurns.abort` : sans ce
    // marquage explicite, la moitié des arrêts resterait indiscernable d'une panne.
    activeChatTurns.markDeliberateStop(conversationId)
    return {
      ok: bus.abortOrchestration(
        conversationId,
        "arret demande par l'utilisateur (Stop de l'orchestration)"
      )
    }
  })
  // Injection LIVE : une directive envoyée pendant un tour atteint la boucle pilote
  // au prochain point d'itération (pilotage continu, sans attendre la fin du tour).
  ipcMain.handle(
    'os:pilotChat:inject',
    async (event, rawConversationId: string, rawDirective: string) => {
      assertTrustedRendererSender(event, 'Pilot chat directive')
      const conversationId = guardString(rawConversationId, 'conversationId')
      const directive = guardString(rawDirective, 'directive').trim()
      if (!directive) return { ok: false }
      // Le renderer passe busy avant que l'IPC `pilotChat` ait fini d'enregistrer son controleur.
      // Une attente courte absorbe cette course de demarrage sans accepter de directive hors tour.
      if (!(await activeChatTurns.waitForActive(conversationId, 500))) return { ok: false }
      const queued = pendingDirectives.get(conversationId) ?? []
      queued.push(directive)
      pendingDirectives.set(conversationId, queued)
      broadcast({ type: 'refresh', scope: 'directives' })
      // La directive est acceptee -> elle devient un VRAI message du fil. Sans cette ecriture, le
      // seul temoin etait un recu vivant dans la memoire de l'ecran : un rechargement l'effacait et
      // l'utilisateur devait recliquer (conv-38, 2026-09-01). L'echec de l'ecriture ne remonte
      // jamais : la directive est deja empilee, une trace manquee n'annule pas un envoi reussi.
      const messageId = enregistrerDirectiveDansLeFil({
        conversations: os.conversations,
        conversationId,
        texte: directive,
        broadcast: (event) => broadcast(event),
        onError: (error) => console.error('[inject] message non ecrit dans le fil', error)
      })
      if (messageId) return { ok: true, messageId }
      return { ok: true }
    }
  )

  /**
   * FILET DE SÉCURITÉ DU TEXTE UTILISATEUR — appelé AVANT tout envoi, quelle que soit la suite.
   *
   * Le renderer vide son composer dès qu'un texte part, et ce texte ne vit ensuite que dans des refs
   * volatiles tant qu'aucun tour n'est créé (mesure du 2026-09-01, conv-30 : deux messages disparus
   * sans trace). Cette écriture précède donc l'envoi, et son échec ne remonte jamais : elle rend
   * `{ ok: false }` plutôt que de lever, pour ne pas transformer une trace manquée en envoi manqué.
   */
  ipcMain.handle(
    'os:saisie:journaliser',
    (event, rawConversationId: string, rawTexte: string, rawVoie: string) => {
      assertTrustedRendererSender(event, 'User input journal')
      const conversationId = guardString(rawConversationId, 'conversationId')
      const texte = guardString(rawTexte, 'texte')
      const voie = guardString(rawVoie, 'voie')
      if (voie !== 'message' && voie !== 'orientation') {
        return { ok: false }
      }
      return { ok: journaliserSaisie({ conversationId, texte, voie }) }
    }
  )

  ipcMain.handle(
    'os:causalTrace:displayed',
    (event, rawConversationId: string, rawContent: string) => {
      assertTrustedRendererSender(event, 'Displayed response trace')
      const conversationId = guardString(rawConversationId, 'conversationId')
      const content = guardString(rawContent, 'content')
      const existing = causalTrace.readConversation(conversationId)
      const parentId = existing.at(-1)?.id
      const sequence = causalTrace.nextSequence(conversationId)
      const displayedEvent = responseDisplayedTrace({
        conversationId,
        turnId: existing.at(-1)?.turnId ?? `${conversationId}:displayed`,
        parentId,
        sequence,
        content,
        timestamp: new Date().toISOString()
      })
      causalTrace.append(displayedEvent)
      return { ok: true, eventId: displayedEvent.id }
    }
  )

  // --- Workflows PAR CONVERSATION : créés par ses orchestrations + RUN.md attachés ---
  ipcMain.handle('os:conversationRuns', (event, convId: string) => {
    assertTrustedRendererSender(event, 'Conversation runs')
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
  ipcMain.handle('os:setActiveConversation', (event, convId: unknown) => {
    assertTrustedRendererSender(event, 'Active conversation')
    // Etat en memoire seulement, donc pas de donnee pourrie persistee -- mais une garde d'une ligne
    // vaut mieux qu'un `activeConversationId` portant un objet ou un nombre.
    bus.activeConversationId = guardStringOrNull(convId, 'convId') ?? undefined
    return { ok: true }
  })
  // Activité (scopée conversation) : timeline des étapes facturées + coût tokens.
  ipcMain.handle('os:conversationActivity', (event, convId: string) => {
    assertTrustedRendererSender(event, 'Conversation activity')
    return loadConvActivity(guardString(convId, 'convId'))
  })
  ipcMain.handle('os:promptCalls', (event, convId: unknown) => {
    assertTrustedRendererSender(event, 'Prompt calls')
    return loadPromptCalls(guardString(convId, 'convId'))
  })
  /**
   * « Ou est passe l'argent ? » sans ecrire de script. Repartition du cout par role, modele ou
   * provider, triee par cout decroissant, avec le cacheHitRatio (un ratio proche de 0 signale un
   * contexte REECRIT au lieu d'etre relu — c'est ce symptome qui a mene a la cause racine du
   * 2026-07-28, ou 114 fichiers .jsonl avaient du etre parses a la main).
   */
  ipcMain.handle(
    'os:costBreakdown',
    (event, dimension?: 'actor' | 'model' | 'provider', convId?: string) => {
      assertTrustedRendererSender(event, 'Cost breakdown')
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
      // (aucun appel natif). Les diagnostics globaux restent disponibles via promptTracesGlobal.
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
  ipcMain.handle('os:promptTraceSummary', (event) => {
    assertTrustedRendererSender(event, 'Native trace summary')
    // La requête brute est volontairement exclue de ce résumé IPC.

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
  ipcMain.handle('os:causalTrace', (event, convId: string) => {
    assertTrustedRendererSender(event, 'Causal trace')
    const conversationId = guardString(convId, 'convId')
    return causalTrace.readConversation(conversationId)
  })

  // --- Observatoire d'activité : transcripts Claude Code (lecture seule) + ledger in-app ---
  /**
   * RECONNAISSANCE VOCALE LOCALE. MESURÉ sur cette application : le moteur
   * `webkitSpeechRecognition` rend le code d'erreur `network`, affiché à l'écran et conservé en
   * capture datée (voir l'en-tête de `whisper-local.ts` pour le chemin de l'artefact) — Jarvis
   * ouvrait le micro et n'entendait jamais rien. La CAUSE de ce code n'est pas établie ici et
   * n'est pas nécessaire : ces trois canaux exposent whisper.cpp installé en local — téléchargé
   * UNE fois, puis plus aucun réseau.
   */
  ipcMain.handle('os:whisper:etat', (event) => {
    assertTrustedRendererSender(event, 'Whisper état')
    return serviceWhisper().etat()
  })
  ipcMain.handle('os:whisper:installer', async (event) => {
    assertTrustedRendererSender(event, 'Whisper installation')
    return serviceWhisper().installer()
  })
  ipcMain.handle('os:whisper:transcrire', async (event, wav: unknown) => {
    assertTrustedRendererSender(event, 'Whisper transcription')
    if (!(wav instanceof Uint8Array) && !Buffer.isBuffer(wav)) {
      throw new Error('Segment audio invalide')
    }
    const octets = wav as Uint8Array
    // Un WAV de 15 s à 16 kHz/16 bits pèse ~480 Ko : au-delà de 8 Mo, ce n'est plus un segment.
    if (octets.byteLength > 8_000_000) throw new Error('Segment audio trop volumineux')
    return serviceWhisper().transcrire(octets)
  })

  // Les canaux de la voix neuronale et des enregistrements parles vivent dans src/main/ipc/ :
  // ils ne prenaient ici que leur service, construit paresseusement.
  registerPiperIpc({ servicePiper })
  registerTranscriptsIpc({ serviceTranscripts })

  // Les canaux de l'activite (sessions consultees et leurs captures) vivent dans
  // src/main/ipc/activity.ts : ils ne prenaient rien ici.
  registerActivityIpc()
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
// Ce jalon DÉPARTAGE les deux causes possibles des ~34 secondes qui précèdent `whenReady` : si le
// temps est déjà écoulé ICI, il est consommé par le corps du module (tout ce qui s'exécute au premier
// niveau avant cette ligne). S'il est proche de zéro, c'est l'évènement `ready` d'Electron qui tarde,
// et la cause est alors hors de notre code.
jalonDemarrage('corps du module terminé, whenReady enregistré')
app.whenReady().then(async () => {
  jalonDemarrage('app.whenReady')
  // Set app user model id for windows
  electronApp.setAppUserModelId(automationAppIdentity(AUTOWIN_APP_ID, automationInstanceMode))

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const dejaMigre = isRendererStorageMigrationComplete(canonicalAppDataRoot)
  // PAS de `await` ici : cette lecture ouvre une fenêtre cachée et y charge le renderer entier, ce
  // qui coûte en développement la compilation complète du bundle. L'attendre à cet endroit repoussait
  // la création de la fenêtre principale de 30 à 44 secondes — mesuré — et l'utilisateur relançait
  // l'application faute de voir quoi que ce soit. La promesse est attendue par le seul appel IPC qui
  // en a besoin.
  const lectureHistorique: Promise<LectureHistorique> =
    !explicitUserDataDir && !dejaMigre
      ? readLegacyRendererStorage(legacyAppDataRoot(appDataRoot), rendererLocation()).then(
          (legacyRead) => {
            if (legacyRead.status === 'failed') {
              console.warn(
                `[Autowin migration] legacy LocalStorage read failed at ${legacyRead.stage ?? 'unknown-stage'} (${legacyRead.errorCode ?? 'UNKNOWN'}); will retry on next application launch`
              )
            }
            return { values: legacyRead.values, canWriteMarker: legacyRead.status !== 'failed' }
          },
          // Un échec de migration ne doit jamais empêcher l'application de démarrer : on repart sur
          // rien à importer, et le marqueur n'est pas écrit pour que la prochaine ouverture réessaie.
          () => ({ values: {}, canWriteMarker: false })
        )
      : Promise.resolve({ values: {}, canWriteMarker: dejaMigre })
  registerStorageMigrationIpc(lectureHistorique)
  registerChatIpc()
  registerTicketsIpc({
    ipc: ipcMain,
    service: tickets,
    // L'annuaire n'appelle pas le service Tickets : il interroge Azure DevOps avec les MEMES
    // identifiants que `tickets:list`. Cette authentification reste ici, partagee avec le
    // demarrage ; le module ne recoit que le geste.
    people: {
      estAutorisee: (source) => ticketSources.list().some((candidat) => candidat.id === source.id),
      list: async (source) => {
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
      }
    },
    assertTrusted: assertTrustedRendererSender
  })
  jalonDemarrage('avant createWindow')
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
    // RAMASSE-MIETTES DES WORKSPACES DE RUNS. La réconciliation ci-dessus ne SUPPRIME rien : elle
    // repeint `open` en `red`, donc elle fait grossir la population de bloqués. Mesuré le
    // 2026-08-18 sur la racine dev : 11 784 RUN.md dont 9 341 verts — c'est là qu'est la masse.
    // Trois gardes cumulatives (non clos jamais touché · moins de 7 j gardé · 50 plus récents par
    // conversation gardés) + les runs reprenables explicitement protégés. Voir `workspace-gc.ts`.
    try {
      const gc = collectRunWorkspaces(convRunsRoot(), {
        protectedRunIds: os.resumableOrchestrations().map((state) => state.runId)
      })
      if (gc.removed || gc.remaining) {
        // Journalisé, jamais muet : une suppression de masse silencieuse est indéfendable.
        console.log(
          `[runs] GC workspaces : ${gc.removed} dossier(s) clos et anciens supprimé(s), ${gc.remaining} au prochain démarrage`
        )
        for (const chemin of gc.paths) console.log('[runs] GC workspace supprimé', chemin)
      }
    } catch (error) {
      console.warn('[runs] GC des workspaces de runs impossible', error)
    }

    // COPIES ISOLÉES ORPHELINES. Un run tué avec l'app laisse son bureau isolé sur le disque ;
    // il est déjà marqué `interrupted` par le coordinateur, mais restait introuvable. On les NOMME
    // ici. Jamais de suppression automatique : le travail de l'agent est récupérable, et une
    // copie effacée ne revient pas — le nettoyage reste une décision humaine, prise sur cette liste.
    try {
      for (const line of summarizeInterruptedWorktrees(os.worktrees?.interruptedWorktrees() ?? []))
        console.log(line)
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
  const worktreeActivityAtStartup = os.getWorktreeActivity()
  const resumableRuns = os.resumableOrchestrations().filter((state) => {
    const publication = publishedWorktreeProofForResume(state.runId, worktreeActivityAtStartup)
    if (!publication) return true

    // Le coordinateur ecrit `publication=complete|published|...` AVANT le callback de publication.
    // Une ecriture dans src/main peut ensuite tuer Electron par hot-reload avant le `.then()` du run.
    // Cette preuve Git durable est donc plus forte que le checkpoint de phases encore present : on
    // clot le tour, on retire le checkpoint et surtout on ne repaie AUCUN provider au boot suivant.
    if (state.conversationId && state.turnId) {
      const turn = createOrchestrateTurnPersistence({
        conversations: os.conversations,
        conversationId: state.conversationId,
        turnId: state.turnId,
        resumeExisting: true,
        journal: (event) =>
          appendTurnEvent(turnJournalRoot, state.conversationId!, state.turnId!, event)
      })
      turn.begin(state.task)
      turn.succeed({
        result: `Publication Git deja acquise (${publication.publication}) ; reprise automatique annulee sans nouvel appel provider.`
      })
    }
    os.forgetResumableOrchestration(state.runId)
    console.warn(
      '[resume-orchestration]',
      state.runId,
      `-> checkpoint terminal retire: publication Git ${publication.publication} deja prouvee`
    )
    return false
  })
  const resumeElection = electStartupOrchestrationResumes(resumableRuns)
  const suppressedDuplicateByRunId = new Map(
    resumeElection.suppressed.map(({ state, electedRunId }) => [state.runId, electedRunId])
  )
  const failedResumeElectionRunIds = new Set<string>()
  for (const { state, electedRunId } of resumeElection.suppressed) {
    if (state.resumeDisposition) continue
    try {
      os.suppressDuplicateOrchestrationPipeline(state.runId, electedRunId)
    } catch (error) {
      failedResumeElectionRunIds.add(electedRunId)
      console.warn(
        '[resume-orchestration]',
        state.runId,
        '-> election non persistable, toutes les relances de cette demande restent bloquees',
        error
      )
    }
  }
  const startupResumeQueue = new StartupResumeQueue()
  for (const resumableRun of resumableRuns) {
    let durableLiveReattachment: ReturnType<typeof createOrchestrateTurnPersistence> | undefined
    let liveReattachment: ReturnType<typeof admitLiveReattachment> | undefined
    const electedDuplicateRunId = suppressedDuplicateByRunId.get(resumableRun.runId)
    if (failedResumeElectionRunIds.has(electedDuplicateRunId ?? resumableRun.runId)) {
      console.warn(
        '[resume-orchestration]',
        resumableRun.runId,
        '-> reprise bloquee: la decision anti-doublon n est pas durable'
      )
      continue
    }
    // GARDE DE VIVACITÉ : les CLI sont détachés, donc un agent du run précédent peut ÊTRE ENCORE EN
    // TRAIN DE TRAVAILLER. Relancer par-dessus mettrait deux agents sur la même copie, à s'écraser
    // l'un l'autre. On vérifie chaque run avant de le relancer — et on l'écrit, pour que ce silence
    // soit lisible sans empêcher les autres reprises.
    const reprise = resumeActionFor(
      resumableRun,
      defaultProcessIdentity,
      Date.now(),
      persistedJournalLastWriteMs
    )
    if (electedDuplicateRunId) {
      // Un doublon supprime n'est PAS un run a reprendre : aucun tour Chat n'est ouvert et aucune
      // cloture verte/rouge n'est fabriquee. On observe uniquement la preuve de fin du provider,
      // puis on retire son checkpoint. La disposition durable survit aux boots intermediaires.
      const refreshSuppressedCheckpoint = (): void => {
        broadcast({ type: 'refresh', scope: 'workflows' })
        broadcast({ type: 'refresh', scope: 'orchestration' })
      }
      const suppressAfterProof = (
        latest: ReturnType<typeof os.resumableOrchestrations>[number]
      ): void => {
        os.forgetResumableOrchestration(latest.runId)
        refreshSuppressedCheckpoint()
        console.warn(
          '[resume-orchestration]',
          latest.runId,
          `-> pipeline doublon retire apres preuve de fin; workflow elu: ${electedDuplicateRunId}`
        )
      }

      if (reprise === 'relancer') {
        suppressAfterProof(resumableRun)
        continue
      }
      if (reprise === 'bloquer') {
        refreshSuppressedCheckpoint()
        console.warn(
          '[resume-orchestration]',
          resumableRun.runId,
          `-> pipeline doublon de ${electedDuplicateRunId} conserve sans relance: fin provider indemontrable`
        )
        continue
      }

      void waitUntilRunCanResume(() => {
        const latest = os
          .resumableOrchestrations()
          .find((candidate) => candidate.runId === resumableRun.runId)
        return latest
          ? resumeActionFor(latest, defaultProcessIdentity, Date.now(), persistedJournalLastWriteMs)
          : 'ignorer'
      }).then((action) => {
        const latest = os
          .resumableOrchestrations()
          .find((candidate) => candidate.runId === resumableRun.runId)
        if (action === 'relancer' && latest) {
          suppressAfterProof(latest)
          return
        }
        refreshSuppressedCheckpoint()
        console.warn(
          '[resume-orchestration]',
          resumableRun.runId,
          action === 'bloquer'
            ? '-> pipeline doublon conserve: fin provider sans preuve recuperable, aucune relance'
            : '-> observation du pipeline doublon expiree, aucune relance ni nouveau tour'
        )
      })
      continue
    }
    if ((reprise === 'rattacher' || reprise === 'bloquer') && resumableRun) {
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
            void wakeWatchdog(
              'workflow-proof-lost',
              `${recap.coverage.lostProof} perte(s) de preuve dans le journal du run ${resumableRun.runId}.`
            )
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
    // La relance vit dans son propre module : sortie de cette fermeture, elle est EXERCEE par ses
    // tests (faux os, faux runTask) au lieu d'etre relue caractere par caractere dans ce fichier.
    const relaunchResumableRun = creerRelanceDeRunReprenable({
      os,
      bus,
      broadcast,
      causalTrace,
      turnJournalRoot,
      appendConvActivity,
      admitAutomaticResumeRuntime,
      createOrchestrateTurnPersistence,
      appendTurnEvent,
      reuseOrCreateConvRun,
      regimePhases,
      saveConvRunTrace,
      populateConvRunSections,
      closeConvRun,
      phasesAvecJuge,
      persistOrchestrationStep,
      persistOrchestrationPhaseStart,
      persistRunLifecycle,
      materializeChatArtifact,
      artifactsFromExecutionEvidence,
      emitToLiveWindows,
      appendBrainTrace,
      appendExecutionEvidenceFileTrace,
      appendObservedOrchestrationOutcome,
      executionCostCoverageFields,
      reconcileLateRunLifecycle,
      classifierRefusDeReprise,
      randomUUID,
      fenetresVivantes: () => BrowserWindow.getAllWindows(),
      defaultProcessIdentity
    })
    if (reprise === 'bloquer') {
      const reason =
        'Appel provider terminé sans preuve récupérable — relance bloquée pour éviter un double coût.'
      const conversationId = resumableRun.conversationId ?? '__autonomous__'
      os.terminalizeAbandonedOrchestration(
        resumableRun.runId,
        defaultProcessIdentity,
        false,
        Date.now(),
        persistedRunTerminalizationProbes
      )
      durableLiveReattachment?.fail(reason, false)
      broadcast({
        type: 'orchestrate-end',
        convId: conversationId,
        runPath: resumableRun.runId,
        status: 'red'
      })
      broadcast({ type: 'refresh', scope: 'chat', convId: conversationId })
      console.warn('[resume-orchestration]', resumableRun.runId, '→', reason)
      continue
    }
    if (reprise === 'rattacher') {
      void waitUntilRunCanResume(() => {
        const latest = os
          .resumableOrchestrations()
          .find((candidate) => candidate.runId === resumableRun.runId)
        return latest
          ? resumeActionFor(latest, defaultProcessIdentity, Date.now(), persistedJournalLastWriteMs)
          : 'ignorer'
      }).then(async (action) => {
        const latest = os
          .resumableOrchestrations()
          .find((candidate) => candidate.runId === resumableRun.runId)
        if (action !== 'relancer' || !latest) {
          if ((action === 'ignorer' || action === 'bloquer') && latest) {
            const reason =
              action === 'bloquer'
                ? 'Appel provider terminé sans preuve récupérable — relance bloquée pour éviter un double coût.'
                : 'Rattachement expiré sans preuve de fin — aucun appel provider n’a été relancé.'
            const conversationId = latest.conversationId ?? '__autonomous__'
            os.terminalizeAbandonedOrchestration(
              latest.runId,
              defaultProcessIdentity,
              action === 'ignorer',
              Date.now(),
              persistedRunTerminalizationProbes
            )
            durableLiveReattachment?.fail(reason, false)
            broadcast({
              type: 'orchestrate-end',
              convId: conversationId,
              runPath: latest.runId,
              status: 'red'
            })
            broadcast({ type: 'refresh', scope: 'chat', convId: conversationId })
            console.warn('[resume-orchestration]', latest.runId, '→', reason)
          } else {
            durableLiveReattachment?.succeed({ result: 'Rattachement terminé.' })
          }
          return
        }
        if (!liveReattachment?.resumeExisting) {
          durableLiveReattachment?.succeed({
            result: 'Agent détaché terminé — reprise du workflow dans un nouveau tour.'
          })
        }
        await startupResumeQueue.enqueue(() => relaunchResumableRun(latest))
      })
    }
    if (reprise === 'relancer') {
      void startupResumeQueue.enqueue(() => relaunchResumableRun(resumableRun))
    }
  }

  const preflightStartedAt = Date.now()
  let brainLaunch: BrainLaunchOutcome | undefined
  preflightWatchHandle = watchAppPreflight((raw) => {
    // #1 bis - la file de candidats Brain se VIDE toute seule au demarrage. Sans ce declencheur,
    // rien dans l'app n'executait l'etape 3 du protocole (inbox/README.md) : 109 candidats
    // dormants mesures le 2026-09-02, dont 67 deposes le jour meme. Ne promeut que le mecanique.
    const curation = startBrainCuration()
    if (curation.status === 'launched') console.log('[brain-curation]', curation.detail)
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
let otelQuitDrainStarted = false
app.on('before-quit', (event) => {
  flushConversations()
  flushScheduledTasks()
  // Le journal de tour ecrit par LOTS : ce qui dort en tampon doit atteindre le disque avant
  // l'arret, sinon la reprise d'un tour en vol perdrait ses derniers deltas.
  flushAllTurnJournals()
  preflightWatchHandle?.stop() // couper la boucle de re-probe démarrage (pas de timer résiduel)
  preflightWatchHandle = null
  if (!otelQuitDrainStarted && otelGenAiExporter.stats().queued > 0) {
    event.preventDefault()
    otelQuitDrainStarted = true
    void otelGenAiExporter.drain().finally(() => {
      otelGenAiExporter.close()
      app.quit()
    })
  } else {
    otelGenAiExporter.close()
    // DERNIER moment ou la fermeture est certaine : la branche du dessus a pu l'annuler pour vider
    // sa file, et elle repassera ici. Une ligne par fermeture reellement consommee, pas une de plus.
    journaliserCauseFermeture(cheminJournalArrets(appDataRoot))
  }
})

app.on('window-all-closed', () => {
  // Robustesse niveau 1 : on NE QUITTE PLUS quand la dernière fenêtre se ferme — l'app reste vivante
  // en tray pour que les runs en cours continuent (et que le résultat soit là à la réouverture). Le
  // quit réel passe UNIQUEMENT par le menu tray (isQuitting). La migration de démarrage garde son
  // comportement historique (elle ne quittait pas ici — elle gère son propre relaunch).
  if (fenetres.estEnFermeture()) {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
