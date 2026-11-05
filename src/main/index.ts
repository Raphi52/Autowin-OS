
import { enregistrerIpcServeursMcp } from './mcp-servers'
import { registerProdPassphraseIpc } from './prod-passphrase-ipc'
import { PorteProd } from './prod-gate'
import { GuichetProd } from './prod-guichet'
import { chargerAutoriteProd, cheminAutoriteProd } from './store/prod-autorite-store'
import { CoffreAutorisationProd, definirPhrase } from './prod-passphrase'
import { ecrireEmpreinteProd, lireEmpreinteProd } from './store/prod-passphrase-store'
import { ecrireNiveauProd, lireNiveauProd } from './store/prod-niveau-store'
import { estNiveauProtection } from '../shared/prod-protection'
import { nomUtilisateurCourant } from './identite-utilisateur'
import { creerServiceWhisper, racineWhisper, type ServiceWhisper } from './whisper-local'
import { creerServicePiper, racinePiper, type ServicePiper } from './piper-local'
import { ServiceTranscripts, dossierTranscripts } from './transcripts'
import { registerChatIpc } from './ipc/chat'
import { creerIdentitesEnCache, creerJournalDesBesoins } from './journal-des-besoins'
import { creerFichesDeDemande, type BranchePourLaFiche } from './fiches-de-demande'
import type { ConversationPourLaCarte } from './carte-des-besoins'
import { gestionnaireNavigateur, registerNavigateurIpc } from './ipc/navigateur'
import { registerQuestionACoteIpc } from './ipc/question-a-cote'
import { registerTerminalIpc } from './ipc/terminal'
import {
  environnementDuTerminal,
  fermerTerminauxAvantSortie,
  gestionnaireTerminal
} from './terminal-integre'
import { declarerSchemaMediaDuFil } from './chat-media-protocol'
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
  configureClaudeCompteDuFil,
  configureClaudeActiveAccountId,
  configureClaudeAccountRotation,
  configureClaudePreventiveSwitch,
  withClaudeAccountEnv
} from './claude-accounts'
import { basculerAvantLancement, utilisationDuCompte } from './bascule-quota'
import {
  app,
  shell,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain
} from 'electron'
import { installerRaccourciCapture, type RaccourciInstalle } from './raccourci-global'
import { dirname, join } from 'path'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { devTargets, lireBasesExploitees, loadSqlCatalogConfigFile } from './sql-read-catalog'
import { propositionPourEcran } from './prod-autorite-depuis-catalogue'
import { randomUUID } from 'node:crypto'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { guardBrokenProcessPipes } from './process-stream-guards'
import { AutowinOS } from './os'
import { projectContextBlock } from './context-files'
import {
  DEFAULT_CDP_PORT,
  listeningPorts,
  resolveCdpPort,
  resolveRemoteDebuggingPort
} from './cdp-port'
import { execFileSync } from 'node:child_process'
import { ensureBrainServerStarted, resetBrainLaunchAttempt } from './brain-server-launch'
import { superviseBrainServer } from './brain-server-supervision'
import { startBrainCuration } from './brain-curation-run'
import { ensureBrainIndexFresh, reindexerApresMutation } from './brain-index-refresh'
import {
  demarrerBrainPerso,
  demarrerBrainPersoAuLancement,
  envDuBrainPerso
} from './brain-perso'
import { configureSessionMemoryEcho } from './session-memory-echo'
import { configureRememberDepositStore } from './brain-remember'
import {
  promoteOutcomeLearningCandidate,
  restoreTrashedKnowledge,
  retractKnowledgeCandidate,
  supersedeKnowledgeCandidate
} from './brain-inbox'
import { installCrashHandlers } from './crash-handlers'
import {
  CapteurHdesk,
  racineScriptsHorsArchive,
  agirHdesk,
  basculerHdesk,
  fermerHdesk,
  lireRegistre,
  type GesteTv
} from './hdesk-tv'
import { lireArbreHdesk, outilsBureauCacheDuChat } from './hdesk-arbre'
import {
  bureauxGeres,
  choisirExecutable,
  creerBureau,
  fermerBureauGere,
  registreParDefaut
} from './hdesk-gestion'
import type { DemandeCreationBureau } from '../shared/hdesk-gestion'
import {
  configureClaudeSessionRenewal,
  invalidateModelQuotaCache,
  quotaClaudeDuCompte
} from './model-quotas'
import { renouvelerSessionClaude } from './claude-session-renewal'
import { appPreflightProbes, resolveBinOnPath, watchAppPreflight } from './preflight-probes'
import { type ReasoningEffort, type Role, type RoleBinding } from './roles'
import { AppCommandBus, type AppEvent } from './commands'
import { compensateOutcomeCuration } from './outcome-learning-curation'
import {
  reconcileCurationIntents
} from './outcome-learning-curation-transaction'
import { OutcomeLearningLedger } from './activity/outcome-learning-ledger'
import { resultatsDesEvenements } from './scout-memoire'
import { PariPhaseStore } from './activity/pari-phase-store'
import { OutcomeLearningSupervisor, parseOutcomeLearningMode } from './outcome-learning-supervisor'
import { WindowsDesktopController } from './desktop-control'
import { captureElectronDesktop } from './electron-desktop-capture'
import { AgentPilot } from './agent-pilot'
import { ActiveChatTurns } from './active-chat-turns'
import { type PointEntreeLocal } from './point-entree-local'
import { TraceLedger } from './activity/ledger'
import { ecarterStoreIllisible, persistConversations } from './store/conversations-disk'
import { causeDInterruption } from './classe-terminale-echec'
import { collectStdoutJournals, journauxReferencesParUneReservation } from './runs/journal-gc'
import { collectCausalTraces } from './activity/causal-trace-gc'
import { loadOrchestrationStates } from './runs/orchestration-state'
import { collectRunWorkspaces } from './runs/workspace-gc'
import { balayerCopiesDeBaseOrphelines } from './comparaison-a-la-base'
import { interfaceVisible } from './startup-gate'
import {
  closeConvRun,
  statutDuRunMd,
  convRunsRoot,
  loadConvRunTrace,
  populateConvRunSections,
  reconcileAbandonedConvRuns,
  reuseOrCreateConvRun,
  saveConvRunTrace
} from './runs/conv-runs'
import { phasesAvecJuge } from './orchestration-memoire'
import { regimePhases } from './task-regime'
import { createOrchestrateTurnPersistence } from './runs/orchestrate-turn-persistence'
import { StartupResumeQueue } from './runs/startup-resume-queue'
import { creerReprendreTout } from './runs/resume-all-interrupted-runs'
import { creerReveilApresQuota } from './runs/reveil-apres-quota'
import { publishedWorktreeProofForResume } from './runs/startup-resume-publication'
import { classifierRefusDeReprise } from './runs/resume-refusal'
import {
  annoncerFinDuRun,
  creerRelanceDeRunReprenable,
  issueDuRunPerdu
} from './runs/relaunch-resumable-run'
import { cheminGardeRepriseCrash, creerGardeRepriseCrash } from './runs/garde-reprise-plantage'
import {
  admitAutomaticResumeRuntime,
  admitLiveReattachment,
  electStartupOrchestrationResumes,
  repriseAutoRetenueParQuota,
  type OrchestrationRunState
} from './runs/orchestration-state'
import {
  appendTurnEvent,
  flushAllTurnJournals,
  removeConversationTurnJournals
} from './runs/turn-journal'
import {
  recoverableChatProviderCallForTurn,
  type RecoverableChatProviderCall
} from './runs/chat-provider-recovery'
import { appendConvActivity } from './activity/conv-activity'
import { reconcileLateRunLifecycle } from './activity/late-run-usage-settlement'
import {
  deletePromptCalls,
  flushAllPromptCalls
} from './activity/prompt-observability'
import { appendObservedOrchestrationOutcome } from './activity/orchestration-outcome-trace'
import { executionCostCoverageFields } from '../shared/orchestration-outcome'
import { installTraceEventSink, TraceStore } from './activity/trace-store'
import { resolveOtelGenAiConfig } from './activity/otel-genai-config'
import { MetadataOnlyOtlpExporter } from './activity/otel-genai-exporter'
import { DiagnosticCapabilities } from './activity/diagnostic-capability'
import {
  persistOrchestrationPhaseStart,
  persistOrchestrationStep,
  persistRunLifecycle
} from './activity/orchestration-observability'

import { ProfileStore } from './profile-store'
import { capabilityEnabled } from './capability-controls'
import { amorcerRegistreOutils } from './registre-outils'
import { ROUTED_PROVIDERS, type RoutedProvider } from './routed-providers'
import {
  defaultBehaviourWorkspace
} from './behaviour-files'
import { ApprovedBehaviourWorkspaces, isTrustedRendererUrl } from './behaviour-access'
import {
  assertTrustedRendererSender,
  behaviourRendererOptions
} from './ipc-senders'
import { createWindowing } from './window'
import { ModelQuestionHub, type ModelQuestion } from './model-questions'
import { claudeExeEnCours, maybeUpdateClaudeCli } from './claude-cli-update'
import { hydraterClesFournisseurs } from './env-reload'
import {
  CLES_FOURNISSEURS,
  discoverImportedModels,
  findModel,
  loadCachedImportedModels,
  type ImportedModel
} from './models'
import { FabricControlPlane, type FabricNodeSummary } from './compute-fabric/control-plane'
import { FetchFabricManifestClient } from './compute-fabric/manifest-client'
import { createFabricNodeTransportStore } from './compute-fabric/node-transport-store'
import { createFabricProductBindings } from './compute-fabric/product-bridge'
import { createShadowRoutingRuntime, shadowRoutingEnvOverride } from './model-routing-shadow'
import {
  loadShadowRoutingPilotSetting,
  type ShadowRoutingPilotState
} from './model-routing-shadow-setting'
import { causalLearningContext } from './knowledge/semantic-temporal-projection'
import { ModelCatalogRefresher } from './model-refresh'
import { loadAgentTopology, type IncidentTopologie } from './topology-disk'
import type { AgentTopology, SlotBinding } from './topology'
import {
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
import { identiteEntreprise } from './identite-entreprise'
import {
  aligneIconeRaccourciBureauDev,
  aligneArgumentsRaccourciDemarrerDev,
  aligneRaccourciDemarrerDev,
  argumentsRaccourciDemarrerDev,
  cheminRaccourciBureauDev,
  cheminRaccourciDemarrerDev,
  cheminsRaccourcisDemarrerDev,
  DEV_TOAST_ACTIVATOR_CLSID,
  dossierIconesVersionnees,
  iconeRaccourciDev,
  poserIconeVersionnee,
  racineDepotDeLExeDev
} from './raccourci-demarrer-dev'
import {
  createStorageMigrationReadHandler,
  isRendererStorageMigrationComplete,
  markRendererStorageMigrationComplete,
  readLegacyRendererStorage,
  type MigratedRendererStorage
} from './renderer-storage-migration'
import { definirDossierModsAutowin, scriptDesGardesCourant } from './providers/claude'
import { rafraichirGardesDesAgents } from './providers/rafraichir-gardes'
import { tmpdir } from 'node:os'
import { guardString } from './ipc-guards'
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
import { restartApplication } from './app-restart'
import {
  armerRelanceAutoMoteur,
  compilerLeMoteur,
  relanceAutoMoteurPermise,
  sourcesDuMoteurPlusRecentesQue,
  surveillerSourcesDuMoteur,
  type RelanceMoteurArmee
} from './relance-auto-moteur'
import { creerSuiviDesPublications } from './publications-en-vol'
import { annoncerFermeture, cheminJournalArrets, journaliserCauseFermeture } from './journal-arrets'
import {
  dossierDeTravailDuTour
} from './bascule-dossier-conversation'
import { lecteurDeDeuxLectures } from './deux-lectures-appel'
import { creerMascotteDuBureau } from './mascotte-fenetre'
import { brancherAffichageSession } from './affichage-session'
import { materializeChatArtifact, removeConversationArtifacts } from './store/chat-artifact-store'

import { BrainWorkerClient } from './viz/brain-worker-client'
import { BrainSearchCoordinator } from './viz/brain-search-coordinator'
import { appendBrainTrace, flushBrainTraces, readBrainTraces } from './activity/brain-trace-spool'
import {
  releverDatesDesJournaux,
  resumeActionFor,
  runIsProducing,
  runJournalProgressMark,
  sonderJournauxDuRun,
  waitUntilRunCanResume
} from './runs/run-reattach'
import {
  DEFAULT_BRAIN_GRACE_MS,
  decidePreflightAnnouncement,
  type BrainLaunchOutcome
} from './preflight-announce'
import { fusionnerRepriseDuFil, recapMessage, summarizeJournal } from './runs/journal-replay'
import type { FinishedRunOutcome } from './runs/run-interruption'
import { tailJournalOnce } from './runs/stdout-journal'
import { summarizeInterruptedWorktrees } from './store/interrupted-worktree-summary'
import {
  retenirMenageDemarrage
} from './store/inventaire-disque'
import { defaultProcessIdentity } from './store/worktree-manager'
import {
  appendExecutionEvidenceFileTrace,
  flushConversationFileTraces
} from './activity/conversation-file-trace-spool'
import { ProviderStateStore } from './provider-state-store'
import { artifactsFromExecutionEvidence } from './providers/artifacts'

import { sharedBrainRoot, createBrainContextProvider } from './brain-context'
import { createBrainTitresDuTour } from './brain-titres-du-tour'
import {
  automationAppIdentity,
  resolveAutomationInstanceMode,
  resolveExplicitUserDataDir,
  resolveInstanceAppDataBase
} from './headless-instance'
import { TaskStore } from './task-manager/task-store'
import { persistTaskStore } from './task-manager/task-store-disk'
import { viderFichiersEnAttente } from './ecriture-hors-fil'
import { TaskScheduler } from './task-manager/task-scheduler'
import { WatchdogEngine } from './task-manager/watchdog-engine'
import type { WatchdogAppEvent } from './task-manager/types'
import {
  taskOccurrenceFromAdditionalData,
  taskOccurrenceFromArgs
} from './task-manager/windows-relay'
import { OUTILS_NOEUD_SKILL } from './skill-node-tools'
import { solderOrientationsDuFil } from './orientations-en-cours-app'

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
/** Le thème que la fenêtre a appliqué en dernier (conv-346) : le thème NieR montre la machine. */
let themeDeLaMascotte: string | null = null
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
/** Une instance de test ne dépense pas de quota toute seule sur les fils de sa copie de données. */
const repriseDesFilsActive = !isolatedTestInstance && !headlessTestInstance
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
// UN PROCESSUS PAR PAGE ISOLÉE DU FIL (conv-1304, 2026-10-30). Par défaut, Chromium range tous les
// cadres `sandbox` d'un même site dans UN processus : une page interactive en boucle infinie figeait
// donc ses voisines, et « Relancer » ouvrait un cadre vide dans ce processus occupé, sans message.
// Mesuré dans l'app construite, 6 pages : voisine vivante, relance qui marche, processus figé mort
// (0 % de processeur), pour 43 → 156 Mo de mémoire propre, soit ~19 Mo par page. Les pages loin de
// l'écran sont libérées (BlocHtmlInteractif.tsx). Doit être posé avant app ready.
app.commandLine.appendSwitch('enable-features', 'IsolateSandboxedIframes:grouping/per-document')
// Ouvre le port CDP pour piloter/inspecter le renderer réel. En DEV, systématiquement. En PACKAGÉ,
// uniquement pour une INSTANCE ISOLÉE DE TEST qui l'a demandé : ailleurs ce serait une surface de
// debug ouverte chez l'utilisateur. Doit être posé avant app ready — d'où la sonde SYNCHRONE du port.
// Un enfant de l'app peut hériter du socket d'écoute et garder le port après la mort de l'app (vécu,
// PID orphelin en LISTENING) : on prend alors le suivant libre au lieu de perdre le CDP.
// POURQUOI RÉÉMETTRE UN DRAPEAU DÉJÀ PASSÉ : depuis Electron 1.6.11, `--remote-debugging-port` posé
// seulement sur la ligne de commande n'ouvre plus rien (electron/electron#10445) ; seul
// `appendSwitch` avant `ready` active le port. Mesuré le 2026-09-06 : le harnais headless lançait le
// binaire packagé avec ce drapeau et n'obtenait JAMAIS de CDP — aucun socket en écoute, avec comme
// sans `--headless-test-instance`, donc toute sonde restait sans point d'accroche. Le port DEMANDÉ
// est repris tel quel : son lanceur vérifie que l'écoute appartient au PID qu'il a créé sur CE port.
const portCdpDemande = isolatedTestInstance ? resolveRemoteDebuggingPort(process.argv) : undefined
if (is.dev || portCdpDemande !== undefined) {
  const cdp =
    portCdpDemande === undefined
      ? resolveCdpPort(() =>
          listeningPorts(
            execFileSync('netstat', ['-ano'], {
              encoding: 'utf8',
              windowsHide: true,
              timeout: 5_000
            })
          )
        )
      : { port: portCdpDemande, moved: false, forced: false }
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
// Carte des besoins, lot 2 (conv-1089) : à chaque tour de chat, qui a prompté (identité git du
// dossier du fil) et la ligne AUTOWIN_BESOIN_V1 de la réponse, dans `besoins.jsonl`.
const journalDesBesoins = creerJournalDesBesoins({
  racine: app.getPath('userData'),
  identite: creerIdentitesEnCache()
})
// RUN.md léger (conv-1418) : une fiche par nouvelle demande, écrite par l'app à la fin du tour.
const fichesDeDemande = creerFichesDeDemande({ racine: app.getPath('userData') })
// Une branche du fil (« façon 1/3 », « revenir à ce tour ») pointe sur les fiches de sa source (conv-1441).
const rattacherLaBrancheAuxFiches = (branche: object, source: object): Promise<number> =>
  fichesDeDemande.rattacherLaBranche({
    branche: branche as BranchePourLaFiche,
    source: source as ConversationPourLaCarte
  })
const brainWorkerPath = join(__dirname, 'brain-worker.js')
const brainWorker = new BrainWorkerClient(brainWorkerPath)
const brainSearchWorker = new BrainWorkerClient(brainWorkerPath)
const brainInboxWorker = new BrainWorkerClient(brainWorkerPath)
const brainSearchCoordinator = new BrainSearchCoordinator()
jalonDemarrage('clients Brain crees')
/*
 * Le savoir vient de changer (promotion, retrait, restauration, remplacement) ou un rafraîchissement
 * est demandé. Le serveur Brain détecte alors un index périmé mais NE LE RECONSTRUIT PAS : il
 * refuse toute question (503) jusqu'à la prochaine reconstruction. Mesuré le 2026-09-29 : notes
 * promues à 08:32, Brain muet ensuite, car la réindexation ne partait qu'au démarrage. En tâche de
 * fond : l'appelant n'attend ni la sonde ni les minutes de reconstruction.
 */
const reindexerEnFond = (origine: string): void => {
  void reindexerApresMutation()
    .then((r) => {
      if (r.status !== 'not-needed') console.log('[brain-index]', origine, r.status, '—', r.detail)
    })
    .catch((erreur) => console.warn('[brain-index]', origine, 'sonde impossible —', String(erreur)))
}
const invalidateBrainRuntime = async (): Promise<void> => {
  brainSearchCoordinator.invalidate()
  await Promise.all([
    brainWorker.invalidate(),
    brainSearchWorker.invalidate(),
    brainInboxWorker.invalidate()
  ])
  reindexerEnFond('après modification du savoir')
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
/*
 * APPELS DE CHAT À REPRENDRE : plus d'inventaire complet au chargement.
 *
 * fix-ok: gels.jsonl 2026-09-26T09:30, 8951 ms pendant « corps du module terminé » dont `openSync`
 * 3438 ms dans `listUnfinishedTurns`, lancé ICI par `listRecoverableChatProviderCalls` : chaque
 * journal de tour était ouvert en synchrone avant la fenêtre. L'hydratation ne demande plus la
 * réponse que pour les messages restés `streaming` (un journal chacun, zéro à deux en pratique) ;
 * les appels ainsi reconnus sont gardés pour être repris sans relecture. L'inventaire complet,
 * non bloquant, est attendu par la boucle de reprise après `whenReady` (`registerChatIpc`).
 */
const appelsChatReconnusAuChargement = new Map<string, RecoverableChatProviderCall>()
/** Un journal touché APRÈS cet instant appartient à un tour de CETTE session, pas à un survivant. */
const debutInventaireAppelsChat = Date.now()
const appelChatReprenable = (conversationId: string, turnId: string): boolean => {
  const call = recoverableChatProviderCallForTurn(turnJournalRoot, conversationId, turnId)
  if (call) appelsChatReconnusAuChargement.set(turnId, call)
  return call !== undefined
}
/**
 * Une orchestration lancée depuis le chat partage le `turnId` de son tour de chat. Quand la reprise
 * d'APPEL CHAT possède ce tour, c'est elle qui le fermera : une reprise de RUN qui ouvre un nouveau
 * tour ne doit pas le passer en `interrupted` à sa place. On interroge le journal du tour lui-même,
 * pas `appelsChatReconnusAuChargement` : `hydrate` ne remplit cette Map que pour les tours ABSENTS
 * des checkpoints de run (court-circuit `resumable?.has(...) || appelChatReprenable(...)`), donc
 * jamais pour un tour partagé chat/run — exactement ceux qu'il faut protéger (juge, 2026-10-13).
 */
const appelChatReprisPourTour = (conversationId: string, turnId: string): boolean =>
  recoverableChatProviderCallForTurn(turnJournalRoot, conversationId, turnId) !== undefined
const resumableTurnIds = new Set([
  ...os
    .resumableOrchestrations()
    .map((state) => state.turnId)
    .filter((turnId): turnId is string => Boolean(turnId))
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
/*
 * MEME GARDE-FOU QUE POUR LA TOPOLOGIE, et pour la MEME raison.
 *
 * Mesure du 2026-09-06 par bissection sur le binaire packagé : un `conversations.json` dont un seul
 * message porte un `status` hors contrat (« done » au lieu de `completed`/`streaming`/…) fait lever
 * `loadConversations`. Cette erreur remontait au CORPS du module principal — donc AVANT
 * `app.whenReady` et avant les filets de crash : le chargement s'arrêtait, la boucle Electron
 * tournait à vide, aucune fenêtre ne s'ouvrait, Chromium n'était jamais initialisé et le port de
 * pilotage restait fermé. Échec TOTALEMENT MUET : un process vivant, figé à 78 ms, sans un mot ni
 * dans la console ni à l'écran. L'utilisateur voit une application qui « ne se lance plus », sans
 * la moindre piste — et le fichier fautif, lui, est nommé dans l'erreur qu'on ne lisait jamais.
 * On ne masque donc pas l'échec : il est NOMMÉ, avec le chemin du fichier.
 *
 * MAIS ON N'ABANDONNE PLUS L'UTILISATEUR DEVANT UNE APPLICATION QUI NE S'OUVRE PAS. Sortir
 * proprement valait mieux que se figer, pas mieux que démarrer : la seule issue restante était
 * d'aller réparer un JSON à la main. Le fichier fautif est donc MIS DE CÔTÉ — renommé avec un
 * horodatage, jamais supprimé, journal d'écritures compris — et l'application s'ouvre sur un store
 * vide. Le message dit où le fichier est parti : un démarrage à vide sans cette phrase serait vécu
 * comme une perte de données, même quand rien n'est perdu.
 *
 * Si l'échec PERSISTE après cette mise à l'écart, la cause n'est plus le contenu du fichier
 * (disque en lecture seule, dossier inaccessible) : là, on sort en nommant, code 79.
 */
/*
 * Chemins des conversations mises de cote au demarrage — vide en marche normale.
 * Renseigne juste dessous, au moment ou le store illisible est ecarte, et relu par le diagnostic de
 * demarrage : c est le seul canal qui pousse deja une banniere au renderer. Sans lui, l avertissement
 * ne vivait que dans la console, invisible pour l utilisateur qui decouvre un historique vide.
 */
const conversationsEcartees: string[] = []

/**
 * Les fils ARCHIVÉS (inactifs depuis 14 jours) ne sont pas relus par le démarrage : ils arrivent
 * juste après, et la liste est alors rafraîchie. La bascule vers l'archive tourne 2 minutes après
 * le démarrage, puis une fois par jour — jamais sur le chemin critique. Voir `conversations-disk.ts`.
 */
const persistanceConversations = {
  resumableTurnIds,
  appelChatReprenable,
  finishedRunOutcome: finishedRunOutcomeByTurnId,
  onArchivesChargees: (ajoutees: number) => {
    if (ajoutees > 0) broadcast({ type: 'refresh', scope: 'conversations' })
  },
  archivage: { apresMs: 2 * 60_000, intervalleMs: 24 * 60 * 60_000 },
  // Réécriture de `conversations.json` (0,4 à 0,9 s mesurées, conv-359) : après la fenêtre.
  compactionApres: interfaceVisible
}

let flushConversations: () => void
try {
  flushConversations = persistConversations(os.conversations, undefined, persistanceConversations)
} catch (erreur) {
  const cause = erreur instanceof Error ? erreur.message : String(erreur)
  const ecartes = ecarterStoreIllisible()
  conversationsEcartees.push(...ecartes)
  console.error(
    `[conversations] store illisible, mis de cote pour permettre le demarrage. Cause : ${cause}. ` +
      (ecartes.length
        ? `Fichier(s) conserve(s) : ${ecartes.join(', ')}. L'application s'ouvre sur un historique vide.`
        : `Aucun fichier n'a pu etre ecarte.`)
  )
  try {
    flushConversations = persistConversations(os.conversations, undefined, persistanceConversations)
  } catch (secondeErreur) {
    console.error(
      `[conversations] demarrage impossible meme apres mise de cote. ` +
        `Cause : ${secondeErreur instanceof Error ? secondeErreur.message : String(secondeErreur)}`
    )
    app.exit(79)
    throw secondeErreur
  }
}
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
/** Branche apres la creation de la passerelle Outlook : repond au mail d'une regle `outlook-mail`. */
let mailWatchdogReplier:
  | ((itemId: string, body: string) => Promise<{ ok: boolean; erreur?: string }>)
  | undefined
const pendingScheduledOccurrences = new Set<string>()

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
  kind: 'openDirectory' | 'openFile',
  // conv-344 : filtre facultatif (« Parcourir… » des bureaux cachés : .exe seulement).
  filters?: Electron.FileFilter[]
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
  const result = await dialog.showOpenDialog(visible, {
    properties: [kind],
    ...(filters ? { filters } : {})
  })
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
  // La mascotte compte les runs ICI, pas d'après l'interface : fenêtre fermée, son nombre se figeait
  // (conv-1196). Filtré avant l'accès : `mascotteDuBureau` est déclarée plus bas dans ce module.
  if (e.type === 'orchestrate-start' || e.type === 'orchestrate-end')
    mascotteDuBureau.evenementDeRun(e)
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
}
/** Bus de commandes (plan de contrôle) + pilote agent (tool-loop). */
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
const outcomeLearningLedger = new OutcomeLearningLedger(
  join(outcomeLearningDirectory, 'events-v1.jsonl')
)
const outcomeLearning = new OutcomeLearningSupervisor({
  ledger: outcomeLearningLedger,
  mode: parseOutcomeLearningMode(
    process.env.AUTOWIN_OUTCOME_LEARNING_MODE ?? persistedOutcomeLearningMode
  ),
  promote: (candidateId, scope) =>
    promoteOutcomeLearningCandidate(sharedBrainRoot(), candidateId, scope),
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
        restore: (id) => restoreTrashedKnowledge(sharedBrainRoot(), id),
        retract: (id) => retractKnowledgeCandidate(sharedBrainRoot(), id)
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
      const moved = retractKnowledgeCandidate(sharedBrainRoot(), intent.knowledgeId)
      return { moved, knowledgeId: intent.knowledgeId, targetId: moved.to }
    }
    if (intent.action === 'restore') {
      const previous = outcomeLearning.latestCurationForStoredId(intent.knowledgeId)
      const moved = restoreTrashedKnowledge(sharedBrainRoot(), intent.knowledgeId)
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
      sharedBrainRoot(),
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
/**
 * LE POINT DE PASSAGE DE PRODUCTION, donne aux commandes.
 *
 * Il DORT tant qu'aucune phrase de passe n'est definie : sans cet interrupteur, le brancher
 * rendrait `sql_query` inutilisable du jour au lendemain, puisqu'une liste de declaration absente
 * rend TOUTE cible « inconnue », donc bloquante.
 *
 * LA LISTE EST RELUE A CHAQUE VERIFICATION, pas seulement au demarrage : corriger une declaration
 * ne doit pas obliger a redemarrer l'application — surtout quand c'est une cible manquante qui
 * bloque le travail en cours. La lecture est un petit fichier JSON local ; son cout est sans
 * commune mesure avec une connexion SQL.
 *
 * LES ANOMALIES SONT DITES AU DEMARRAGE, une fois : un fichier absent ou fautif ferme la porte, et
 * l'utilisateur doit savoir POURQUOI plutot que de decouvrir un refus incomprehensible.
 */
const autoriteProdAuDemarrage = chargerAutoriteProd(ensureAutowinAppData(appDataRoot))
for (const anomalie of autoriteProdAuDemarrage.anomalies) {
  console.warn(`[prod] liste de declaration : ${anomalie}`)
}
const porteProd = new PorteProd({
  autorite: () => chargerAutoriteProd(ensureAutowinAppData(appDataRoot)).autorite,
  coffre: () => coffreAutorisationProd(),
  phraseDefinie: () => lireEmpreinteProd(ensureAutowinAppData(appDataRoot)) !== undefined,
  // Le NIVEAU est relu a chaque verification, comme la liste : changer le reglage doit prendre effet
  // tout de suite, sans redemarrer. Fichier absent -> « confirmation », jamais « aucun ».
  niveau: () => lireNiveauProd(ensureAutowinAppData(appDataRoot))
})

/**
 * LE GUICHET : il publie la demande d'autorisation vers la fenêtre et attend le jeton saisi. C'est
 * lui qui transforme un refus en question posée à l'utilisateur, au lieu d'un texte rendu au modèle.
 */
const guichetProd = new GuichetProd({
  notifier: (demande) => {
    const fenetres = BrowserWindow.getAllWindows()
    if (fenetres.length === 0) throw new Error('aucune fenêtre pour afficher la demande')
    for (const w of fenetres) w.webContents.send('prod:autorisation:demandee', demande)
  },
  retirer: (id) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('prod:autorisation:close', id)
  }
})

const bus = new AppCommandBus(
  os,
  broadcast,
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
  outcomeLearning,
  porteProd,
  guichetProd
)
/**
 * Le bouton Stop atteint desormais les programmes lances par la commande `run`.
 *
 * Le bus ne connait pas `activeChatTurns` -- et n'a pas a le connaitre : on lui remet une simple
 * question, « quel est le signal d'arret de cette conversation ». Sans cette ligne, `run` n'etait
 * borne que par son horloge, et un programme qui ne rend jamais la main (application a fenetre,
 * serveur) bloquait le tour jusqu'au plafond, Stop compris (conv-384, 2026-09-09).
 */
bus.signalDuTour = (conversationId) => activeChatTurns.get(conversationId)?.controller.signal
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
   * et strictement inutilisable. Les specs passent ENTIÈRES (conv-1370, 2026-10-31) : un `.map` ne
   * gardait que le nom, la description et `args`, donc annotations et vrais types n'arrivaient pas.
   */
  catalogue: () =>
    bus
      .catalog()
      .filter((c) => OUTILS_NOEUD_SKILL.includes(c.name as (typeof OUTILS_NOEUD_SKILL)[number]))
})
// Depuis le catalogue COMPLET, jamais `bus.catalog()` déjà filtré par l'interrupteur : un outil
// coupé à l'écran y perdait sa ligne et se rallumait un démarrage sur deux (registre-outils.ts).
amorcerRegistreOutils()
/**
 * LE DOSSIER DE TRAVAIL N'EST PLUS GLOBAL — il est resolu a CHAQUE tour depuis la conversation.
 *
 * `os.executionWorkspace` est fige au demarrage : il ne sert plus que de REPLI quand la conversation
 * n'est pas rangee sur un dossier reel. La valeur est PASSEE en argument (cwd du CLI, cle de session,
 * AGENTS.md, faits provisoires) et jamais posee dans `process.env` : des tours paralleles ranges dans
 * deux projets differents se voleraient le dossier.
 */
const dossierDuTour = (conversationId?: string): string =>
  dossierDeTravailDuTour(
    conversationId ? os.conversations.get(conversationId)?.projectPath : undefined,
    os.executionWorkspace
  )
/**
 * LE BRAIN À CHAQUE TOUR, AU PLUS BAS COÛT (conv-892, 2026-09-30). Mesure du 18/09 au 30/09 : 8 tours
 * de chat sur 824 ont lancé `brain_query`, jamais de leur propre initiative — « à la demande » voulait
 * dire « quand l'utilisateur y pense ». Choix de l'utilisateur : « a chaque tour mais via un mecanisme
 * qui coute le moins de token possible ». Chaque tour reçoit donc le CHEMIN des 3 notes les plus
 * proches au plus (rang ≤ 3, score ≥ 0,40), jamais leur contenu, et RIEN quand aucune n'est proche
 * (détail et mesure : `brain-titres-du-tour.ts`).
 */
/** Serveur du Brain perso injoignable : on le démarre en fond, la recherche suivante le trouvera. */
const relancerBrainPerso = (): void => {
  void demarrerBrainPerso()
    .then((r) => {
      if (r && r.status !== 'already-up') console.log('[brain-perso]', r.status, '—', r.detail)
    })
    .catch((e) => console.warn('[brain-perso] démarrage impossible —', String(e)))
}
const titresBrainDuTour = createBrainTitresDuTour({
  workspace: (conversationId?: string) => dossierDuTour(conversationId),
  // BRAIN PERSO (conv-1233, 2026-10-28) : ses notes proches arrivent aussi, préfixées `perso:`.
  brainPerso: () => envDuBrainPerso(),
  persoInjoignable: relancerBrainPerso,
  // conv-1303 : les notes déjà servies survivent au redémarrage (137 lignes resservies du 13 au 30/10).
  relireTraces: () => readBrainTraces()
})
// BRAIN PERSO dans le contexte des travaux en arrière-plan (conv-1233, 2026-10-28) : chaque run
// cherche aussi dans le Brain perso, notes préfixées `perso:` (`orchestrator.ts`).
os.brainPersoDuRun = () => envDuBrainPerso()
os.brainPersoInjoignable = relancerBrainPerso
const contexteGrapheDuTour = createBrainContextProvider({
  // PORTEE PAR WORKSPACE (O3) : le Brain est a 99 % de la doc CONTOSO, donc une question Autowin ramenait
  // majoritairement des sources d'un AUTRE projet. Le corpus autorise se DERIVE du workspace, il n'est
  // pas ecrit en dur : dans un workspace CONTOSO, la doc CONTOSO est exactement ce qu'il faut.
  // Cette voie ne pousse plus d'EXTRAITS Brain. MESURE 2026-07-29 : l'appel coutait ~430 ms de
  // mediane a chaque tour (jusqu'a 1 500 ms, son timeout) alors que 73 % des tours n'en tiraient
  // AUCUNE source utile. Le Brain revient a chaque tour le 2026-09-30, mais en CHEMINS seuls et par
  // `titresBrainDuTour` ci-dessus : « a la demande » avait donne 8 appels sur 824 tours.
  // POIDS MORT RETIRE (conv-703, mesure 2026-09-18) : le graphe poussait ~900 car. de noms de
  // fichiers sans rapport (« 0. Etat des lieux », `app-data.ts`...) sur 3 questions d'avis sur 3,
  // payes plein tarif a chaque tour. Pour une question sur le code, seule la recherche texte a la demande
  // (`find_in_files`) reste : ce n'est PAS la carte de structure du graphe (perte non evaluee).
  // fix-ok: graphe injecte a chaque tour de chat = 877/812/813 car. hors cache sur 3 questions d avis, 0 apres (createBrainContextProvider reel)
  sources: [],
  // RESOLU PAR TOUR : le corpus autorise derive du dossier RANGE sur la conversation, pas d'un global fige.
  workspace: (conversationId?: string) => dossierDuTour(conversationId),
  onScope: ({ kept, dropped, corpus }) => {
    if (dropped > 0) {
      console.info(
        `[brain-scope] corpus ${corpus.join('|')} : ${kept} source(s) gardee(s), ${dropped} hors corpus ecartee(s)`
      )
    }
  }
})
const pilot = new AgentPilot(
  os.registry,
  os.roles,
  bus,
  async (query, meta) =>
    (await Promise.all([titresBrainDuTour(query, meta), contexteGrapheDuTour(query, meta)]))
      .filter(Boolean)
      .join('\n\n'),
  // MÊME source de contexte projet que les phases orchestrées (fold du CLAUDE.md/AGENTS.md du workspace).
  // RESOLU PAR TOUR : c'est l'AGENTS.md du dossier RANGE sur la conversation qui doit être lu.
  (conversationId?: string) => projectContextBlock(dossierDuTour(conversationId)),
  (conversationId?: string) => dossierDuTour(conversationId),
  // Commandes du chat AUSSI servies comme outils directs du modèle quand il les porte (chat-mcp.ts).
  true,
  // Deux lectures plausibles → une question avant de payer (deux-lectures.ts, conv-1092). Le modèle
  // des petites tâches (réglage du Routeur) ; une panne rend une erreur, et le travail part comme avant.
  // Sa ligne de coût porte le fil du tour et la décision du contrôle (deux-lectures-appel.ts, conv-1431).
  lecteurDeDeuxLectures(os)
)
const modelQuestions = new ModelQuestionHub()
const activeChatTurns = new ActiveChatTurns()
/**
 * La mascotte du bureau (conv-1145, « Bille · pastille ») : la bille au-dessus de l'horloge qui dit
 * si Autowin travaille, t'attend ou a échoué. Tenue ici car les runs (`os:presence`) et les fins
 * de tour la nourrissent depuis deux endroits ; sa fenêtre n'existe qu'après `demarrer`.
 */
const mascotteDuBureau = creerMascotteDuBureau()
/** Directives utilisateur injectées PENDANT un tour, par conversation (drainées à chaque itération). */
const pendingDirectives = new Map<string, string[]>()
function drainPendingDirectives(conversationId: string): string[] {
  const enFile = pendingDirectives.get(conversationId) ?? []
  pendingDirectives.delete(conversationId)
  if (enFile.length) broadcast({ type: 'refresh', scope: 'directives' })
  // fix-ok: conv-1241 (tour 6e6212f1) — la file n'était relue qu'ENTRE deux appels : conv-1240, tour 2e218711, saisie ts 1793225455947 absente du premier appel (16 min, 22:10:38 → 22:27:00), lue seulement au second (22:27:07).
  // Celles que le contrôle avant outil a déjà remises au modèle EN PLEIN APPEL ne
  // repartent pas une seconde fois (`orientations-en-cours-app.ts`).
  const queued = solderOrientationsDuFil(conversationId, enFile, 'tour')
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
const {
  createWindow,
  setupTray,
  showMainWindow,
  openQuestionWindow,
  openViewWindow,
  rendererLocation,
  questionWindows,
  questionDeLaPage,
  refleterRunsVivants
} = fenetres
/** Raccourci clavier global : posé au démarrage, libéré à la fermeture (sinon il reste capté). */
let raccourciCapture: RaccourciInstalle | null = null
const diagnosticCapabilities = new DiagnosticCapabilities()
/** Boucle de re-probe du diagnostic de démarrage (#4) — arrêtée à la fermeture pour ne pas fuir de timer. */
let preflightWatchHandle: { stop: () => void } | null = null
// Surveillance du brain_server APRÈS le démarrage : la boucle de preflight est bornée, celle-ci dure
// toute la session et relance le service s'il meurt (conv-270, 2026-09-04).
let brainSupervisionHandle: { stop: () => void } | null = null
/** Relance automatique du moteur en développement (`relance-auto-moteur.ts`), coupée à la fermeture. */
let relanceMoteurHandle: Pick<RelanceMoteurArmee, 'arreter' | 'mettreEnFile'> | null = null

const providerStateStore = new ProviderStateStore(
  join(app.getPath('userData'), 'provider-state.json')
)

function preflightProviderOptions(): {
  standbyProviders: RoutedProvider[]
  conversationsEcartees: readonly string[]
} {
  return {
    standbyProviders: ROUTED_PROVIDERS.filter(
      (provider) => providerStateStore.get(provider).mode === 'standby'
    ),
    conversationsEcartees
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
// Le compte CHOISI pour un fil voyage avec ses appels (conv-1416) : il ne passe plus par le compte
// actif, global, que n'importe quel autre fil pouvait changer sous lui. Compte retire entre-temps :
// rien, le tour suit alors le compte de l'application au lieu de casser.
configureClaudeCompteDuFil((conversationId) => {
  const choisi = os.conversations.get(conversationId)?.claudeAccountId
  return choisi ? claudeAccounts.compteDuFil(choisi) : undefined
})
// Rotation d'abonnement : quand le quota du compte actif est epuise, le registre demande une bascule
// vers un compte encore vivant. Sans ce cablage, la rotation existerait sans jamais se declencher.
configureClaudeAccountRotation((walled) => claudeAccounts.rotateAwayFrom(walled))
// Bascule AVANT le lancement (conv-1069) : au-dela de 85 % sur le compte actif, on part sur le compte
// qui a le plus de marge, sans file ni plafond (« rien plafonner, juste basculer »). Un seul compte
// = aucune sonde. La bascule passe par `switchTo`, donc la barre de quota et les puces suivent.
configureClaudePreventiveSwitch(async (actifId) => {
  const cible = await basculerAvantLancement({
    actifId,
    comptes: claudeAccounts.current().accounts.map((compte) => compte.id),
    mesurer: async (id) => {
      const compte = claudeAccounts.find(id)
      if (!compte) return undefined // retire entre-temps : pas un refuge
      const fenetres = await quotaClaudeDuCompte(compte.dir)
      return fenetres ? utilisationDuCompte(fenetres) : undefined
    },
    actifCourant: () => claudeAccounts.active().id,
    basculer: (id) => void claudeAccounts.switchTo(id)
  })
  if (cible) console.info(`[claude-accounts] bascule avant lancement : ${actifId} -> ${cible}`)
  return cible
})
// La sonde de quota fait renouveler par le CLI la session expiree du compte qu'elle lit : sans ce
// cablage, la barre restait sur les chiffres d'avant la bascule jusqu'au prochain message (conv-1031).
configureClaudeSessionRenewal((configDir) => renouvelerSessionClaude(configDir))
// Tout changement du compte actif (interface, depart d'un tour, rotation) rend le quota memorise
// faux et la liste des comptes de l'interface perimee : on jette l'un et on previent l'autre.
claudeAccounts.onActiveChange(() => {
  invalidateModelQuotaCache()
  broadcast({ type: 'refresh', scope: 'claudeAccounts' })
})
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

/*
 * POURQUOI CE GARDE-FOU : sur un profil de donnees VIERGE, le cache de modeles est vide et
 * `agent-topology.json` est absent. `loadAgentTopology` part alors dans son catch, ou
 * `createDefaultTopology([])` LEVE a son tour (« Impossible de creer une topologie sans modele
 * importe »). Cette erreur remontait au CORPS du module principal, donc AVANT que
 * `app.whenReady` soit enregistre et avant `installCrashHandlers` : le chargement s'arretait, la
 * boucle Electron tournait a vide, aucune fenetre ne s'ouvrait, Chromium n'etait jamais initialise
 * et le port CDP restait donc ferme. Echec TOTALEMENT MUET, mesure le 2026-09-06 : le harnais
 * headless obtenait un process vivant, sans socket ni message, et toute sonde restait sans point
 * d'accroche. L'app ne peut objectivement PAS fonctionner sans modele : on ne masque donc pas
 * l'arret, on le NOMME et on sort proprement au lieu de laisser un process fantome.
 */
let agentTopology: AgentTopology
try {
  agentTopology = loadAgentTopology(agentTopologyPath, agentModels, signalerIncidentTopologie)
} catch (erreur) {
  console.error(
    `[topologie] demarrage impossible : aucune topologie utilisable et aucun modele en cache. ` +
      `Fichier : ${agentTopologyPath}. Cause : ${erreur instanceof Error ? erreur.message : String(erreur)}`
  )
  app.exit(78)
  throw erreur
}
const modelCatalog = new ModelCatalogRefresher(
  agentModels,
  () => {
    // Une clé posée par `setx` n'atteint pas le processus : le redémarrage hérite de l'ancien
    // environnement du lanceur. On la reprend de l'OS avant chaque relevé (env-reload.ts, conv-1499).
    hydraterClesFournisseurs(CLES_FOURNISSEURS)
    return discoverImportedModels(fetch, modelCatalogCachePath)
  },
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
// MISE A JOUR DU CLI CLAUDE, en tache de fond, au plus une fois par 12 h. C'est LUI qui porte la
// liste de modeles : mesure du 2026-09-09, `claude-fable-5-1` n'existait dans aucune source tant que
// le binaire installe restait en 2.1.251. On ne bloque PAS le demarrage dessus ; quand la mise a jour
// aboutit, la taille/date du binaire changent, donc le rafraichissement suivant du catalogue rescanne
// et les nouveaux modeles apparaissent sans redemarrer l'app.
// Binaire occupe (agents survivants, autre session Claude Code) : la mise a jour echouait a coup sur
// et bloquait 12 h (vecu le 2026-10-01). Elle est REPORTEE et retentee toutes les 15 min.
const REESSAI_MISE_A_JOUR_CLI_MS = 15 * 60_000
const tenterMiseAJourCli = (): void => {
  void maybeUpdateClaudeCli(join(app.getPath('userData'), 'claude-cli-update.json'), {
    binaireEnUsage: claudeExeEnCours
  })
    .then((resultat) => {
      if (resultat.outcome === 'skipped') return
      console.log(
        `[cli-claude] mise a jour ${resultat.outcome}${resultat.detail ? ` — ${resultat.detail}` : ''}`
      )
      if (resultat.outcome === 'postponed') {
        setTimeout(tenterMiseAJourCli, REESSAI_MISE_A_JOUR_CLI_MS).unref()
      }
      if (resultat.outcome === 'updated') void modelCatalog.refresh(true)
    })
    .catch(() => {
      // Deja neutralise dans le module : rien a faire ici.
    })
}
tenterMiseAJourCli()
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
  const resolve = (binding: SlotBinding): RoleBinding => {
    try {
      return runtimeRoleBinding(binding, agentModels)
    } catch (error) {
      if (!(error instanceof UnresolvedRuntimeModelError)) throw error
      // Identité visible et fail-closed : aucun ancien rôle d'un autre provider ne survit, mais la
      // readiness bloque l'appel provider tant que l'alias n'a pas de transport découvert.
      return {
        provider: binding.provider,
        model: binding.modelId,
        reasoningEffort: binding.reasoningEffort
      }
    }
  }
  // UNE écriture de roles.json pour tous les rôles (avant : une par rôle, gel mesuré de 20,7 s).
  os.setRoles(
    (Object.entries(runtimeRoleSlots(topology)) as Array<[Role, SlotBinding]>).map(
      ([role, binding]) => [role, resolve(binding)] as const
    )
  )
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
/**
 * LES MÉNAGES DE DÉMARRAGE, lancés APRÈS l'affichage de la fenêtre (`interfaceVisible`, dans
 * `app.whenReady`) et en lectures non bloquantes, un fichier à la fois.
 *
 * Mesure du 2026-10-19 (`gels.jsonl`, conv-359) : avant la fenêtre, les ménages de `run-stdout/`
 * (209 `statSync`, 8 s), de `causal-trace/` et des workspaces de runs (108 `openSync` + 120
 * `readSync`, 16,7 s) figeaient le démarrage du matin sur le disque D: saturé, alors qu'aucun n'est
 * nécessaire pour afficher quoi que ce soit. Ils s'enchaînent ici, l'un après l'autre : lancés
 * ensemble, ils se disputeraient le même disque mécanique.
 */
async function menagesApresAffichage(): Promise<void> {
  // Un journal est ecrit a CHAQUE spawn de CLI et rien ne les supprimait : 435 fichiers / 10,6 Mo
  // mesures en 2 jours d'usage. Les runs detaches en cours sont proteges par la garde d'inactivite
  // du GC ; best-effort : un echec de menage ne doit jamais gener l'app.
  //
  // PROTECTION PAR REFERENCE (2026-09-06). La garde d'inactivite ne suffisait pas : le journal de
  // l'agent `build` de conv-43 a ete supprime a 43 h alors que son appel provider n'etait pas solde.
  // Son run est devenu insolvable et s'est rejoue rouge a chaque demarrage. On passe donc au menage
  // la liste des journaux qu'un point de reprise ATTEND encore — un fait, pas une date.
  try {
    const journauxAttendus = journauxReferencesParUneReservation(
      loadOrchestrationStates(join(ensureAutowinAppData(), 'run-state'))
    )
    const collected = await collectStdoutJournals(process.env.AUTOWIN_RUN_JOURNAL_ROOT!, {
      protectedPaths: journauxAttendus
    })
    // Ces chiffres n'existaient que le temps d'un `console.log` de demarrage : on les RETIENT pour
    // que l'interface puisse enfin montrer ce que le menage a libere.
    retenirMenageDemarrage({
      famille: 'run-stdout',
      supprimes: collected.removed,
      octetsLiberes: collected.freedBytes
    })
    if (collected.removed > 0) {
      console.log(
        `[run-stdout] ${collected.removed} journaux purges (${Math.round(collected.freedBytes / 1024)} Ko)`
      )
    }
  } catch {
    /* menage best-effort */
  }
  // Traces causales : rien ne bornait cet arbre — 441 fichiers / 668 Mo en 12 jours mesurés le
  // 2026-09-12. Même fenêtre de 7 jours que les journaux de tour. Lancé AVANT la fenêtre, aucune
  // conversation ne pouvait écrire ; maintenant si : une conversation touchée depuis le démarrage
  // est protégée, quel que soit l'âge de sa trace (et `collectCausalTraces` relit chaque trace
  // juste avant de la supprimer).
  try {
    const tracesPurgees = await collectCausalTraces(join(app.getPath('userData'), 'causal-trace'), {
      protectedConversationIds: os.conversations
        .list()
        .filter((conversation) => conversation.updatedAt >= T0_DEMARRAGE)
        .map((conversation) => conversation.id)
    })
    retenirMenageDemarrage({
      famille: 'causal-trace',
      supprimes: tracesPurgees.removed,
      octetsLiberes: tracesPurgees.freedBytes,
      restants: tracesPurgees.remaining
    })
    if (tracesPurgees.removed > 0) {
      console.log(
        `[causal-trace] ${tracesPurgees.removed} traces purgees (${Math.round(tracesPurgees.freedBytes / 1048576)} Mo), reste ${tracesPurgees.remaining}`
      )
    }
  } catch {
    /* menage best-effort */
  }
  // RAMASSE-MIETTES DES WORKSPACES DE RUNS. La réconciliation des runs abandonnés ne SUPPRIME rien :
  // elle repeint `open` en `red`, donc elle fait grossir la population de bloqués. Mesuré le
  // 2026-08-18 sur la racine dev : 11 784 RUN.md dont 9 341 verts — c'est là qu'est la masse.
  // Trois gardes cumulatives (non clos jamais touché · moins de 7 j gardé · 50 plus récents par
  // conversation gardés) + les runs reprenables explicitement protégés. Voir `workspace-gc.ts`.
  try {
    const gc = await collectRunWorkspaces(convRunsRoot(), {
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
  // COPIES DE BASE ABANDONNÉES (conv-1583, 2026-11-05) : une publication coupée par la mort de l'app
  // laissait sa `%TEMP%\aw-base-*` sur le disque, inscrite dans `git worktree list`, sa jonction vers
  // `node_modules` encore posée. Seules celles de plus de 6 h partent ; voir `comparaison-a-la-base.ts`.
  const copiesDeBase = await balayerCopiesDeBaseOrphelines()
  if (copiesDeBase.supprimees.length || copiesDeBase.echecs.length) {
    console.log(
      `[comparaison a la base] ${copiesDeBase.supprimees.length} copie(s) abandonnée(s) retirée(s), ${copiesDeBase.echecs.length} restée(s)`
    )
    for (const echec of copiesDeBase.echecs)
      console.warn('[comparaison a la base] copie non retirée', echec.chemin, echec.raison)
  }
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
  void fichesDeDemande
    .retirerLeFil(id)
    .catch((error) => console.warn('[fiches] fil non retiré :', error))
}
/**
 * REDEMARRAGE PILOTE PAR L'AGENT — meme chemin que la relance d'auto-update, donc meme lanceur dev
 * (`launch_dev.py`) et memes gardes. Cable ici parce que le bus de commandes ne connait ni Electron
 * ni le lanceur : sans ce branchement, `restart_app` annonce son indisponibilite plutot que de
 * promettre une relance qui n'arriverait pas.
 */
bus.redemarrerApp = (): void => restartApplication(app)
// FILE DE REDÉMARRAGE (conv-304) : quand d'autres agents tournent, `restart_app` dépose sa demande
// dans la relance au repos au lieu de les couper. Pas de file (version installée) -> `false`.
// Un redémarrage attend aussi la publication d'un tour fini : elle part après la fin du tour, et il
// la coupait une minute plus tard, laissant ses fichiers non commités (2026-11-01, conv-1048).
const publicationsEnVol = creerSuiviDesPublications()
const conversationsOccupees = (): string[] => [
  ...new Set([...activeChatTurns.inFlightConversations(), ...publicationsEnVol.conversations()])
]
bus.conversationsEnVol = conversationsOccupees
// `remove_conversation(s)` arrête le tour et le run du fil supprimé, comme le Stop (conv-1060).
bus.toursDeChat = activeChatTurns
bus.redemarrerAuRepos = (demande) => relanceMoteurHandle?.mettreEnFile(demande) ?? false
// Outil `bureau_cache_fermer` (lot 1, conv-222) : meme racine de scripts que la TV et les gestes,
// `app.asar.unpacked` une fois installee.
bus.fermerBureauCache = (demande) =>
  fermerHdesk(racineScriptsHorsArchive(app.getAppPath()), demande)
// Outils `bureau_cache_lancer / observer / agir` (conv-344) : mêmes chemins que la vue « Bureaux
// cachés » — lanceur détaché (l'app survit au tour), processus de capture déjà ouvert, hdesk-act.
bus.lancerBureauCache = (demande) =>
  creerBureau(racineScriptsHorsArchive(app.getAppPath()), demande)
// conv-1457 (hdesk-arbre.ts) : l'observation joint l'arbre d'accessibilité, et le geste x/y suit
// l'image RECADRÉE comme la petite TV — avant, il partait tel quel et tombait à côté (origine (7,57)
// mesurée sur la Table des caractères) ; `element` appuie par nom.
const outilsHdeskDuChat = outilsBureauCacheDuChat({
  capteur: () => (capteurHdesk ??= new CapteurHdesk(racineScriptsHorsArchive(app.getAppPath()))),
  lireArbre: (id) => lireArbreHdesk(racineScriptsHorsArchive(app.getAppPath()), id),
  agir: (geste) => agirHdesk(racineScriptsHorsArchive(app.getAppPath()), geste)
})
bus.observerBureauCache = outilsHdeskDuChat.observer
bus.agirBureauCache = outilsHdeskDuChat.agir
bus.ficheBureauCache = (id) => lireRegistre(registreParDefaut()).find((e) => e.id === id)
// Outils `navigateur_*` de l'agent (conv-1286, lot 4/5) : le gestionnaire est redemandé à chaque
// appel — la fenêtre principale rouverte en porte un neuf ; fermée, il vaut `null`.
bus.navigateur = () => gestionnaireNavigateur()
// Outil `terminal_lire` de l'agent (conv-1362, lot 3/3) : `null` tant que l'IPC n'est pas branché.
bus.terminal = () => gestionnaireTerminal()
os.setCausalMemoryRetriever((conversationId) =>
  causalLearningContext(causalTrace.readConversation(conversationId))
)
// La mémoire du scout relit ici ce que sont devenues les pistes prises (piste 1, conv-1033). Un
// journal illisible ne prive le scout que de cette ligne du bilan : on le dit, on ne bloque rien.
os.setResultatsDesRuns(() => {
  try {
    return resultatsDesEvenements(outcomeLearningLedger.read().events)
  } catch (erreur) {
    console.warn(
      `[scout-memoire] résultats des runs illisibles — bilan sans livraison : ${erreur instanceof Error ? erreur.message : String(erreur)}`
    )
    return new Map()
  }
})

const profiles = new ProfileStore(join(app.getPath('userData'), 'profiles.json'))
/**
 * L'INSTANT ou ce processus a demarre. Un processus ne peut pas contenir un fichier ecrit
 * APRES lui : c'est le seul discriminant necessaire, et il couvre les deux formes de
 * peremption (bundle non reconstruit, ou bundle reconstruit sans relance du processus).
 */
const demarrageDuMoteurMs = Date.now()
// Catalogue SQL propre à l'utilisateur : sans ce fichier, aucune base n'est lisible.
loadSqlCatalogConfigFile(join(app.getPath('userData'), 'sql-catalog.json'))
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

/**
 * LE COFFRE DES AUTORISATIONS DE PRODUCTION — cree a la premiere demande, JAMAIS persiste.
 *
 * Il vit en memoire parce qu'une autorisation qui survivrait a un redemarrage serait un droit que
 * l'utilisateur ne sait plus avoir donne. Fermer l'app referme donc la production, et c'est voulu.
 */
let coffreProd: CoffreAutorisationProd | null = null
function coffreAutorisationProd(): CoffreAutorisationProd {
  return (coffreProd ??= new CoffreAutorisationProd(
    lireEmpreinteProd(ensureAutowinAppData(appDataRoot))
  ))
}

/**
 * Qui est connecte au poste. Lecture seule, aucun parametre venant de l'ecran : la tuile
 * Performance a besoin d'un sujet pour son mode « mes chiffres ».
 */
function registerIdentiteIpc(): void {
  ipcMain.handle('app:identite-utilisateur', (event) => {
    assertTrustedRendererSender(event, "Identite de l'utilisateur")
    return nomUtilisateurCourant()
  })
}

/** Petite TV du bureau cache (conv-528) : lecture seule, processus de capture cree a la demande. */
let capteurHdesk: CapteurHdesk | null = null
/** Processus lancés par le bouton « Lancer » : arrêtés, eux seuls, à la fermeture de l’app. */
let lancementIpc: { arreterTout: () => Promise<void> } | null = null
/** Serveur ouvert aux scripts du poste (conv-1144) : fermé, et son fichier retiré, à la fermeture. */
let pointEntreeLocal: PointEntreeLocal | null = null
function registerHdeskTvIpc(): void {
  const capteur = (): CapteurHdesk =>
    (capteurHdesk ??= new CapteurHdesk(racineScriptsHorsArchive(app.getAppPath())))
  ipcMain.handle('hdesk:tv:bureaux', (event, conversationId?: string) => {
    assertTrustedRendererSender(event, 'Petite TV du bureau caché')
    return process.platform === 'win32'
      ? capteur().bureaux(typeof conversationId === 'string' ? conversationId : undefined)
      : []
  })
  ipcMain.handle('hdesk:tv:image', (event, id: string) => {
    assertTrustedRendererSender(event, 'Petite TV du bureau caché')
    return capteur().image(String(id))
  })
  ipcMain.handle('hdesk:tv:act', (event, geste: GesteTv) => {
    assertTrustedRendererSender(event, 'Petite TV du bureau caché')
    if (process.platform !== 'win32') return { ok: false, message: 'Windows uniquement.' }
    // Le point arrive en pixels de l'image RECADREE affichee : on le ramene a l'ecran du bureau (conv-1009).
    return agirHdesk(racineScriptsHorsArchive(app.getAppPath()), capteur().versEcran(geste))
  })
  ipcMain.handle('hdesk:tv:basculer', (event, id: string) => {
    assertTrustedRendererSender(event, 'Petite TV du bureau caché')
    if (process.platform !== 'win32') return { ok: false, message: 'Windows uniquement.' }
    return basculerHdesk(racineScriptsHorsArchive(app.getAppPath()), String(id))
  })
  ipcMain.handle('hdesk:tv:arreter', (event) => {
    assertTrustedRendererSender(event, 'Petite TV du bureau caché')
    return capteurHdesk?.arreter()
  })
  // VUE « BUREAUX CACHÉS » (conv-951) : tous les bureaux, quel que soit le fil. Aperçu et bascule
  // reprennent les canaux de la TV ci-dessus. Fermer ne reçoit QUE l'identifiant : le fil vient de la
  // fiche du bureau (hdesk-gestion.ts), jamais de l'écran.
  ipcMain.handle('hdesk:gestion:bureaux', (event) => {
    assertTrustedRendererSender(event, 'Vue Bureaux cachés')
    if (process.platform !== 'win32') return { ok: true, bureaux: [] }
    // Le processus de capture DÉJÀ ouvert pour les aperçus répond aussi à la liste (conv-344).
    return bureauxGeres(() => capteur().listeVivants())
  })
  ipcMain.handle('hdesk:gestion:fermer', (event, id: string) => {
    assertTrustedRendererSender(event, 'Vue Bureaux cachés')
    if (process.platform !== 'win32')
      return { ok: false, code: null, message: 'Windows uniquement.' }
    return fermerBureauGere(racineScriptsHorsArchive(app.getAppPath()), String(id))
  })
  // « Parcourir… » (conv-344) : le sélecteur natif, filtré sur les .exe ; le main juge le résultat.
  ipcMain.handle('hdesk:gestion:choisirExe', (event) => {
    assertTrustedRendererSender(event, 'Vue Bureaux cachés')
    return choisirExecutable(() =>
      pickPath(event.sender, 'openFile', [{ name: 'Applications', extensions: ['exe'] }])
    )
  })
  ipcMain.handle('hdesk:gestion:creer', (event, demande: DemandeCreationBureau) => {
    assertTrustedRendererSender(event, 'Vue Bureaux cachés')
    if (process.platform !== 'win32')
      return { ok: false, code: null, message: 'Windows uniquement.' }
    return creerBureau(racineScriptsHorsArchive(app.getAppPath()), demande)
  })
}

/**
 * L’état du démarrage dont a besoin `registerChatIpc` (src/main/ipc/chat.ts), extrait le
 * 2026-11-04 (conv-1508). Les `let` passent par accesseurs : le module lit leur valeur VIVANTE.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- son type EST le contrat (ContexteIpcChat), conv-1508
function contexteIpcChat() {
  return {
    activeChatTurns,
    agentModelsReady,
    agentTopologyPath,
    appDataRoot,
    appelsChatReconnusAuChargement,
    applyFabricSummaries,
    askModelQuestion,
    behaviourAccess,
    brainInboxWorker,
    brainSearchCoordinator,
    brainSearchWorker,
    brainWorker,
    broadcast,
    bus,
    causalTrace,
    claudeAccounts,
    curationRecoveryReady,
    debutInventaireAppelsChat,
    defaultBehaviourRoot,
    demarrageDuMoteurMs,
    diagnosticCapabilities,
    dossierDuTour,
    drainPendingDirectives,
    explicitUserDataDir,
    fabricControlPlane,
    fichesDeDemande,
    headlessTestInstance,
    invalidateBrainRuntime,
    isolatedTestInstance,
    journalDesBesoins,
    ledger,
    mascotteDuBureau,
    modelCatalog,
    modelQuestions,
    notifiedTaskAlerts,
    notifyWatchdogWorkflowIncident,
    openViewWindow,
    os,
    outcomeLearning,
    outcomeLearningDirectory,
    outcomeLearningModePath,
    parisDePhase,
    pendingDirectives,
    pendingScheduledOccurrences,
    pickDirectory,
    pickPath,
    pickSavePath,
    pilot,
    preflightProviderOptions,
    profiles,
    providerStateStore,
    publicationsEnVol,
    questionDeLaPage,
    questionWindows,
    rattacherLaBrancheAuxFiches,
    refleterRunsVivants,
    repriseDesFilsActive,
    scheduledTasks,
    servicePiper,
    serviceTranscripts,
    serviceWhisper,
    shadowRoutingObservationsPath,
    shadowRoutingPilotPath,
    shadowRoutingPilotState,
    showMainWindow,
    startupTaskOccurrence,
    syncRuntimeTopology,
    ticketSources,
    tickets,
    turnJournalRoot,
    get agentModels() {
      return agentModels
    },
    set agentModels(valeur: typeof agentModels) {
      agentModels = valeur
    },
    get agentTopology() {
      return agentTopology
    },
    set agentTopology(valeur: typeof agentTopology) {
      agentTopology = valeur
    },
    get isolatedConversationReadCount() {
      return isolatedConversationReadCount
    },
    set isolatedConversationReadCount(valeur: typeof isolatedConversationReadCount) {
      isolatedConversationReadCount = valeur
    },
    get isolatedFabricFixtureSummary() {
      return isolatedFabricFixtureSummary
    },
    set isolatedFabricFixtureSummary(valeur: typeof isolatedFabricFixtureSummary) {
      isolatedFabricFixtureSummary = valeur
    },
    get lancementIpc() {
      return lancementIpc
    },
    set lancementIpc(valeur: typeof lancementIpc) {
      lancementIpc = valeur
    },
    get mailWatchdogReplier() {
      return mailWatchdogReplier
    },
    set mailWatchdogReplier(valeur: typeof mailWatchdogReplier) {
      mailWatchdogReplier = valeur
    },
    get pointEntreeLocal() {
      return pointEntreeLocal
    },
    set pointEntreeLocal(valeur: typeof pointEntreeLocal) {
      pointEntreeLocal = valeur
    },
    get scheduledTaskScheduler() {
      return scheduledTaskScheduler
    },
    set scheduledTaskScheduler(valeur: typeof scheduledTaskScheduler) {
      scheduledTaskScheduler = valeur
    },
    get shadowRoutingRuntime() {
      return shadowRoutingRuntime
    },
    set shadowRoutingRuntime(valeur: typeof shadowRoutingRuntime) {
      shadowRoutingRuntime = valeur
    },
    get themeDeLaMascotte() {
      return themeDeLaMascotte
    },
    set themeDeLaMascotte(valeur: typeof themeDeLaMascotte) {
      themeDeLaMascotte = valeur
    },
    get watchdogEngine() {
      return watchdogEngine
    },
    set watchdogEngine(valeur: typeof watchdogEngine) {
      watchdogEngine = valeur
    },
  }
}
export type ContexteIpcChat = ReturnType<typeof contexteIpcChat>

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
    // La fenêtre PRINCIPALE, pas la première venue : la mascotte du bureau peut l'être (conv-1142).
    showMainWindow()
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

// Vidéos du fil lues depuis le disque par plages (kaizen conv-260) : Electron n'accepte ce schéma
// qu'AVANT l'évènement `ready`. Le service des requêtes est branché avec les canaux des artefacts.
declarerSchemaMediaDuFil()

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
  electronApp.setAppUserModelId(
    automationAppIdentity(
      identiteEntreprise().application.appId ?? AUTOWIN_APP_ID,
      automationInstanceMode
    )
  )
  // En dev, Electron pose un raccourci menu Démarrer sans icône pour cette identité, et la barre
  // des tâches lui prend son icône : on le pose nous-mêmes, icône Autowin et CLSID fixe.
  if (process.platform === 'win32' && !app.isPackaged) {
    try {
      app.setToastActivatorCLSID(DEV_TOAST_ACTIVATOR_CLSID)
      // Sans argument, un clic dans le menu Démarrer ouvrait la page d'accueil d'Electron (conv-954).
      // Le script vient du dépôt de l'EXE, pas de `app.getAppPath()` : une instance de test lancée
      // sur une copie temporaire ne doit pas faire viser au raccourci un script qui disparaîtra.
      const racineExe = racineDepotDeLExeDev(process.execPath)
      const raccourci = aligneRaccourciDemarrerDev({
        shell,
        existe: existsSync,
        chemin: cheminRaccourciDemarrerDev(app.getPath('appData'), process.execPath),
        executable: process.execPath,
        args: racineExe ? argumentsRaccourciDemarrerDev(racineExe) : '',
        identite: process.execPath,
        clsid: DEV_TOAST_ACTIVATOR_CLSID,
        // Copie à nom VERSIONNÉ : sous un chemin inchangé, l'Explorateur garde l'ancienne image
        // (l'atome, mesuré conv-266). Détail : raccourci-demarrer-dev.ts, `cheminIconeVersionnee`.
        icone: poserIconeVersionnee({
          source: iconeRaccourciDev(app.getAppPath(), process.env['AUTOWIN_OS_DEV'] === '1'),
          dossier: dossierIconesVersionnees(process.env['LOCALAPPDATA'] ?? app.getPath('appData')),
          existe: existsSync,
          lire: (chemin) => readFileSync(chemin),
          ecrire: (chemin, contenu) => {
            mkdirSync(dirname(chemin), { recursive: true })
            writeFileSync(chemin, contenu)
          }
        })
      })
      if (raccourci.etat === 'echec') console.warn('[icone barre des taches dev]', raccourci.raison)
      // L'AUTRE raccourci de dev (l'ancien `Electron.lnk` d'un poste passé sur l'exe de dev) gardait
      // une cible sans argument : on lui donne les mêmes arguments, s'il vise un exe de CE dépôt.
      if (racineExe && !isolatedTestInstance) {
        const courant = cheminRaccourciDemarrerDev(app.getPath('appData'), process.execPath)
        for (const chemin of cheminsRaccourcisDemarrerDev(app.getPath('appData'))) {
          if (chemin === courant) continue
          const autre = aligneArgumentsRaccourciDemarrerDev({ shell, existe: existsSync, chemin, racineDepot: racineExe })
          if (autre.etat === 'echec') console.warn('[raccourci menu demarrer dev]', autre.raison)
        }
      }
    } catch (erreur) {
      console.warn('[icone barre des taches dev]', erreur)
    }
    // Le raccourci du BUREAU, posé une fois par create-dev-shortcut.ps1, gardait l'ancien logo après
    // une mise à jour (conv-930) : on ne repointe que son icône, et seulement s'il est celui de CE
    // dépôt. Une instance de test isolée n'a pas à toucher au Bureau de l'utilisateur.
    if (!isolatedTestInstance) {
      try {
        const bureau = aligneIconeRaccourciBureauDev({
          shell,
          existe: existsSync,
          chemin: cheminRaccourciBureauDev(app.getPath('desktop')),
          racineDepot: app.getAppPath(),
          icone: poserIconeVersionnee({
            source: iconeRaccourciDev(app.getAppPath(), true),
            dossier: dossierIconesVersionnees(process.env['LOCALAPPDATA'] ?? app.getPath('appData')),
            existe: existsSync,
            lire: (chemin) => readFileSync(chemin),
            ecrire: (chemin, contenu) => {
              mkdirSync(dirname(chemin), { recursive: true })
              writeFileSync(chemin, contenu)
            }
          })
        })
        if (bureau.etat === 'echec') console.warn('[icone raccourci bureau dev]', bureau.raison)
      } catch (erreur) {
        console.warn('[icone raccourci bureau dev]', erreur)
      }
    }
  }

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
  registerHdeskTvIpc()
  // Navigateur intégré du chat (conv-1286) : ses pages vivent DANS la fenêtre principale.
  registerNavigateurIpc({ fenetrePrincipale: fenetres.fenetrePrincipale })
  // Terminal intégré du chat (conv-1362, lot 3/3) : même dossier et même compte que les tours du fil.
  registerTerminalIpc({
    fenetrePrincipale: fenetres.fenetrePrincipale,
    dossierDuFil: dossierDuTour,
    environnement: () => environnementDuTerminal(withClaudeAccountEnv(process.env))
  })
  // Question à côté (conv-1362) : le catalogue du bus et les comptes, ceux du tour de chat.
  registerQuestionACoteIpc({
    catalogue: () => bus.catalog(),
    comptes: () => claudeAccounts.current().accounts
  })
  // Mods d'Autowin chargés par chaque run (conv-58) : hors archive, comme les scripts du bureau caché.
  definirDossierModsAutowin(join(racineScriptsHorsArchive(app.getAppPath()), 'mods', 'autowin'))
  registerProdPassphraseIpc(ipcMain, {
    lireEmpreinte: () => lireEmpreinteProd(ensureAutowinAppData(appDataRoot)),
    // La phrase entre ici et n'en ressort pas : on la transforme aussitot en empreinte, on l'ecrit,
    // et le coffre est REMPLACE — un jeton accorde sous l'ancienne phrase ne survit pas au changement.
    enregistrerPhrase: (phrase) => {
      const empreinte = definirPhrase(phrase)
      ecrireEmpreinteProd(ensureAutowinAppData(appDataRoot), empreinte)
      coffreProd = new CoffreAutorisationProd(empreinte)
    },
    coffre: () => coffreAutorisationProd(),
    verifierExpediteur: (event, libelle) => assertTrustedRendererSender(event, libelle)
  })
  /**
   * LE RETOUR DE L'ÉCRAN. Le jeton vient de la fenêtre, jamais du modèle ; l'expéditeur est donc
   * vérifié comme pour la phrase elle-même. Aucune phrase ne transite ici, seulement un jeton opaque
   * et l'identifiant de la demande qui l'a déclenché.
   */
  /**
   * L'ÉTAT DE LA PROTECTION, EN CLAIR. Deux faits que l'écran de réglages doit pouvoir dire sans
   * détour : la porte tourne-t-elle (une phrase est-elle définie), et que contient la liste de
   * déclaration. Une protection qui DORT ne doit jamais avoir l'air active.
   */
  ipcMain.handle('prod:porte:etat', (event) => {
    assertTrustedRendererSender(event, 'Protection de production')
    const liste = chargerAutoriteProd(ensureAutowinAppData(appDataRoot))
    return {
      ...porteProd.etat(),
      phraseDefinie: lireEmpreinteProd(ensureAutowinAppData(appDataRoot)) !== undefined,
      declarees: liste.autorite.entrees.length,
      anomalies: liste.anomalies,
      chemin: cheminAutoriteProd(ensureAutowinAppData(appDataRoot))
    }
  })
  /**
   * LA LISTE PROPOSÉE DEPUIS LE CATALOGUE SQL — lecture seule, au clic de l'utilisateur. Rien n'est
   * écrit : l'écran montre le contenu, l'utilisateur le colle lui-même dans son fichier de
   * déclaration (voir `prod-autorite-depuis-catalogue.ts`).
   */
  ipcMain.handle('prod:autorite:proposition', async (event) => {
    assertTrustedRendererSender(event, 'Protection de production')
    const lecture = await lireBasesExploitees()
    return propositionPourEcran(
      chargerAutoriteProd(ensureAutowinAppData(appDataRoot)),
      lecture,
      devTargets()
    )
  })
  /** Changer le niveau de protection (aucun / confirmation / phrase). Prend effet immediatement. */
  ipcMain.handle('prod:porte:niveau', (event, niveau: unknown) => {
    assertTrustedRendererSender(event, 'Protection de production')
    if (!estNiveauProtection(niveau)) return { ok: false, erreur: 'Niveau inconnu.' }
    // Exiger la phrase pour PASSER au niveau « phrase » n'aurait aucun sens : on la demande au
    // contraire pour BAISSER la garde quand elle est deja en service.
    if (porteProd.etat().niveau === 'phrase' && niveau !== 'phrase') {
      const empreinte = lireEmpreinteProd(ensureAutowinAppData(appDataRoot))
      if (empreinte)
        return { ok: false, erreur: 'Saisis la phrase de passe pour baisser la garde.' }
    }
    ecrireNiveauProd(ensureAutowinAppData(appDataRoot), niveau)
    return { ok: true }
  })
  ipcMain.handle('prod:autorisation:confirmer', (event, id: string) => {
    assertTrustedRendererSender(event, 'Autorisation de production')
    return { ok: guichetProd.confirmer(guardString(id, 'prodAutorisation.id')) }
  })
  ipcMain.handle('prod:autorisation:deposer', (event, id: string, jeton: string) => {
    assertTrustedRendererSender(event, 'Autorisation de production')
    return { ok: guichetProd.deposer(guardString(id, 'prodAutorisation.id'), String(jeton ?? '')) }
  })
  ipcMain.handle('prod:autorisation:annuler', (event, id: string) => {
    assertTrustedRendererSender(event, 'Autorisation de production')
    return { ok: guichetProd.annuler(guardString(id, 'prodAutorisation.id')) }
  })
  /** Les demandes encore ouvertes — pour une fenêtre qui se recharge pendant l'attente. */
  ipcMain.handle('prod:autorisation:en-attente', (event) => {
    assertTrustedRendererSender(event, 'Autorisation de production')
    return guichetProd.enAttente()
  })
  registerIdentiteIpc()
  // Version allégée à distance, version téléphone sur petit écran (conv-1442).
  brancherAffichageSession()
  // Serveurs MCP déclarés par l'utilisateur (conv-1558).
  enregistrerIpcServeursMcp({ ipc: ipcMain, assertTrusted: assertTrustedRendererSender })
  const suiviDuPlan = registerChatIpc(contexteIpcChat())
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
  // Ramener Autowin sans aller chercher sa fenêtre : les autres raccourcis sont tous locaux au
  // renderer, donc inertes quand l'app est en arrière-plan.
  raccourciCapture = installerRaccourciCapture(globalShortcut, () => showMainWindow())

  // RÉCONCILIATION DES RUNS ABANDONNÉS. Un run dont l'app est morte en cours gardait `status: open`
  // à vie : mesuré le 2026-08-05, 141 runs ouverts depuis plus de 24 h, ni succès ni échec, alors
  // que ce sont des échecs — ils faussaient donc en silence toute lecture du taux de réussite.
  // APRÈS `createWindow` et sans `await` : le démarrage ne doit rien attendre de cette hygiène. Le
  // seuil de 24 h laisse intacts les runs en vol et ceux que la reprise va récupérer.
  // ASYNCHRONE, et non plus `setImmediate` : différer un corps synchrone le laissait sur le fil de
  // la fenêtre qui se charge (`gels.jsonl` 2026-09-22 07:03 puis 2026-10-13 14:10 : ~1,1 s de
  // « construction de la fenêtre », 705 à 826 `openSync`). Voir `reconcileAbandonedConvRuns`.
  void reconcileAbandonedConvRuns({})
    .then((bilan) => {
      if (bilan.closed || bilan.remaining) {
        // Le reste est dit à voix haute : une borne muette se lirait « tout est traité ».
        console.log(
          `[runs] ${bilan.closed} run(s) abandonné(s) clos en red, ${bilan.remaining} en attente du prochain démarrage`
        )
      }
    })
    .catch((error: unknown) => {
      console.warn('[runs] réconciliation des runs abandonnés impossible', error)
    })
  // Ménages de `run-stdout/`, `causal-trace/` et des workspaces de runs : APRÈS l'affichage de la
  // fenêtre, en lectures non bloquantes (voir `menagesApresAffichage`).
  void interfaceVisible.then(() =>
    pendantOperation('menage:apres-affichage', menagesApresAffichage)
  )
  setImmediate(() => {
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
  // LES AGENTS QUI ONT SURVÉCU AU REDÉMARRAGE CHARGENT LA GARDE COURANTE (conv-770, 2026-10-01) :
  // leur script de hook était figé à leur lancement, donc l'ancienne garde restait active chez eux.
  try {
    const gardes = rafraichirGardesDesAgents({ racine: tmpdir(), script: scriptDesGardesCourant() })
    if (gardes.rafraichis.length || gardes.echecs.length) {
      console.log(
        '[gardes] scripts de hook des agents vivants :',
        `${gardes.rafraichis.length} mis à jour, ${gardes.aJour.length} déjà à jour,`,
        `${gardes.echecs.length} non remplaçables`
      )
    }
  } catch (error) {
    console.warn('[gardes] rafraîchissement impossible :', error)
  }
  // SURVIE NIVEAU 3 — reprise AUTOMATIQUE au démarrage (choix explicite de l'utilisateur : pas de
  // bouton, pas de question). Un run d'orchestration tué avec la mort du process main laisse son
  // acquis persisté ; on relance ICI à la phase suivante, en réinjectant les livrables déjà produits
  // (aucune phase refaite). Rien à reprendre → aucun effet (démarrage normal strictement inchangé).
  const worktreeActivityAtStartup = os.getWorktreeActivity()
  // UN SEUL instant pour le tri du démarrage ET le réveil après quota : un mur échu à cet instant
  // est relancé ici, un mur échu après l'est par `reveil-apres-quota.ts` — ni trou, ni doublon.
  const instantDuDemarrage = Date.now()
  const resumableRuns = os.resumableOrchestrations().filter((state) => {
    // Run SUSPENDU par le mur de quota avant l'heure que le refus annonçait : le relancer ne ferait
    // que se cogner au même refus. Il reste reprenable (et protégé du ménage des copies) ; seule la
    // relance AUTOMATIQUE attend. Après l'heure, ou sans heure annoncée, il repart comme les autres.
    if (repriseAutoRetenueParQuota(state, instantDuDemarrage)) {
      console.warn(
        '[resume-orchestration]',
        state.runId,
        `-> reprise automatique différée : mur de quota jusqu'à ${new Date(
          state.quotaWall?.resumeAfter ?? Date.now()
        ).toLocaleString('fr-FR')}`
      )
      return false
    }
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
        onClosed: () => broadcast({ type: 'refresh', scope: 'conversations' }),
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
    loadConvRunTrace,
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
    statutDuRunMd,
    causeDInterruption,
    randomUUID,
    fenetresVivantes: () => BrowserWindow.getAllWindows(),
    defaultProcessIdentity,
    appelChatReprisPourTour,
    gardePlantage: creerGardeRepriseCrash(cheminGardeRepriseCrash(app.getPath('userData'))),
    plansDeLots: suiviDuPlan
  })
  /** Un run rattaché se clôt ici sans repartir : le plan qui l'a adopté doit l'apprendre (conv-1308). */
  const annoncerFinDuRunRepris = (
    run: { conversationId?: string; turnId?: string },
    raison: string
  ): void =>
    annoncerFinDuRun(
      { plansDeLots: suiviDuPlan, appelChatReprisPourTour },
      run,
      issueDuRunPerdu(raison)
    )
  const startupResumeQueue = new StartupResumeQueue()

  // « REPRENDRE TOUT » A LA DEMANDE. Le demarrage ne relance que ce qu'il trouve AU BOOT ; un run
  // interrompu plus tard restait a reprendre conversation par conversation. Ce bouton refait le
  // MEME triage, avec la MEME file : jamais deux relances a la fois, jamais un run deja publie.
  const reprendreTousLesRuns = creerReprendreTout<OrchestrationRunState>({
    listerRunsReprenables: () => os.resumableOrchestrations(),
    publicationDejaProuvee: (state) =>
      Boolean(publishedWorktreeProofForResume(state.runId, os.getWorktreeActivity())),
    actionDeReprise: (state) =>
      resumeActionFor(state, defaultProcessIdentity, Date.now(), persistedJournalLastWriteMs),
    mettreEnFile: (tache) => startupResumeQueue.enqueue(tache),
    relancer: (state) => relaunchResumableRun(state)
  })
  /*
   * RÉVEIL APRÈS LE QUOTA (conv-1069). Un run suspendu par le quota ne repartait qu'au démarrage
   * suivant ou par « Reprendre tout » : app ouverte, il attendait indéfiniment. Même triage et même
   * file que « Reprendre tout » ; replanifié à chaque nouveau mur noté sur un checkpoint.
   */
  const reveilApresQuota = creerReveilApresQuota<OrchestrationRunState>({
    demarrageMs: instantDuDemarrage,
    listerRunsReprenables: () => os.resumableOrchestrations(),
    publicationDejaProuvee: (state) =>
      Boolean(publishedWorktreeProofForResume(state.runId, os.getWorktreeActivity())),
    actionDeReprise: (state) =>
      resumeActionFor(state, defaultProcessIdentity, Date.now(), persistedJournalLastWriteMs),
    mettreEnFile: (tache) => startupResumeQueue.enqueue(tache),
    relancer: (state) => relaunchResumableRun(state),
    journal: (message) => console.warn('[resume-orchestration]', message)
  })
  os.onMurDeQuota(() => reveilApresQuota.replanifier())
  reveilApresQuota.replanifier()
  ipcMain.handle('runs:resumeAll', (event) => {
    assertTrustedRendererSender(event, 'Reprendre tout')
    return reprendreTousLesRuns.reprendreTout()
  })
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

      void waitUntilRunCanResume(
        // Sondée CHAQUE SECONDE : le disque est relevé sans bloquer (voir `sonderJournauxDuRun`).
        async () => {
          const latest = os
            .resumableOrchestrations()
            .find((candidate) => candidate.runId === resumableRun.runId)
          if (!latest) return 'ignorer'
          const sonde = await sonderJournauxDuRun(latest)
          return resumeActionFor(
            latest,
            defaultProcessIdentity,
            Date.now(),
            sonde.lastWriteMs,
            sonde.exitCodeOf
          )
        },
        undefined,
        undefined,
        // Le plafond compte le SILENCE du journal : un doublon qui écrit encore reste observé.
        async () => {
          const latest = os
            .resumableOrchestrations()
            .find((candidate) => candidate.runId === resumableRun.runId)
          return runJournalProgressMark(latest, await releverDatesDesJournaux(latest))
        }
      ).then((action) => {
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
    // Le travail continue dans ce fil : son lot n'est pas interrompu (conv-1308). Fait AVANT d'attendre,
    // parce que la file de démarrage peut retarder la relance jusqu'à la fin d'un autre run : pendant
    // ce temps, « Reprendre » y aurait lancé un second agent. `bloquer` n'est pas adopté : plus rien
    // ne tourne, et son lot attend le clic.
    if ((reprise === 'rattacher' || reprise === 'relancer') && resumableRun.conversationId)
      suiviDuPlan.agentRepris(resumableRun.conversationId, resumableRun.turnId)
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
      const tourDOrigine =
        resumableRun.turnId && !appelChatReprisPourTour(conversationId, resumableRun.turnId)
          ? resumableRun.turnId
          : undefined
      durableLiveReattachment = createOrchestrateTurnPersistence({
        conversations: os.conversations,
        conversationId,
        turnId: resumeTurnId,
        runtime: liveReattachment.turnBinding,
        resumeExisting: liveReattachment.resumeExisting,
        supersededTurnId: tourDOrigine,
        journalSuperseded: (event) => {
          if (tourDOrigine) appendTurnEvent(turnJournalRoot, conversationId, tourDOrigine, event)
        },
        // fix-ok: la fin d'un run rattaché ne rechargeait pas la liste ; son spinner (hasStreamingTurn) restait allumé.
        onClosed: () => broadcast({ type: 'refresh', scope: 'conversations' }),
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
          // UN message par chantier, MIS À JOUR d'un redémarrage à l'autre (conv-913, 2026-10-13) :
          // l'ajouter à chaque fois empilait une bulle de plus en bas du fil, qui cachait à l'écran
          // le tour encore vivant.
          const heure = new Date().toLocaleTimeString('fr-FR', {
            hour: '2-digit',
            minute: '2-digit'
          })
          os.conversations.noterRepriseDuChantier(conversationId, resumableRun.runId, (precedent) =>
            fusionnerRepriseDuFil(precedent, message, heure)
          )
          broadcast({ type: 'refresh', scope: 'chat', convId: conversationId })
        }
        if (conversationId && recap.coverage.lostProof > 0) {
          void wakeWatchdog(
            'workflow-proof-lost',
            `${recap.coverage.lostProof} perte(s) de preuve dans le journal du run ${resumableRun.runId}.`
          )
        }
        // L'offset atteint est repersisté : ce qui vient d'être montré ne sera pas remontré.
        os.rememberAgentOffsets(resumableRun.runId, agentsApres)
      } catch (error) {
        console.warn('[resume-orchestration] rattachement impossible :', error)
      }
    }
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
      void waitUntilRunCanResume(
        // Sondée CHAQUE SECONDE : le disque est relevé sans bloquer. Les `statSync` du journal et
        // `readFileSync` du reçu `.exit.json` faits ici ont figé la fenêtre jusqu'à 6,6 s
        // (gels.jsonl 2026-10-11 15:23-15:24). Voir `sonderJournauxDuRun`.
        async () => {
          const latest = os
            .resumableOrchestrations()
            .find((candidate) => candidate.runId === resumableRun.runId)
          if (!latest) return 'ignorer'
          const sonde = await sonderJournauxDuRun(latest)
          return resumeActionFor(
            latest,
            defaultProcessIdentity,
            Date.now(),
            sonde.lastWriteMs,
            sonde.exitCodeOf
          )
        },
        undefined,
        undefined,
        // Le plafond compte le SILENCE du journal, pas la durée de l'étape : une construction de
        // plus de 10 min n'est plus déclarée « interrompue » en plein travail (conv-115, 2026-10-09).
        async () => {
          const latest = os
            .resumableOrchestrations()
            .find((candidate) => candidate.runId === resumableRun.runId)
          return runJournalProgressMark(latest, await releverDatesDesJournaux(latest))
        }
      ).then(async (action) => {
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
            annoncerFinDuRunRepris(latest, reason)
          } else {
            durableLiveReattachment?.succeed({ result: 'Rattachement terminé.' })
            // Le point de reprise a disparu : aucun résultat à lire, le lot ne vaut pas « fait ».
            annoncerFinDuRunRepris(resumableRun, 'run rattaché terminé sans résultat lisible.')
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
    // Sa FIN enchaîne la réindexation : `--apply` promeut des notes, donc périme l'index.
    // Une instance de TEST ne touche pas au Brain partagé (garde dans la fonction).
    const curation = startBrainCuration(
      process.env,
      undefined,
      () => reindexerEnFond('après la curation de démarrage'),
      isolatedTestInstance
    )
    // `busy` : une passe /curate tient inbox/.curation.lock — le renoncement doit se lire au journal.
    if (curation.status === 'launched' || curation.status === 'busy') {
      console.log('[brain-curation]', curation.detail)
    }
    // #2 — un rouge « brain » → tenter de DÉMARRER le service local (garde anti-doublon + tentative
    // unique par session dans ensureBrainServerStarted). Le backoff de watchAppPreflight re-sondera
    // ensuite jusqu'à sa disponibilité (warm-up fastembed). Fire-and-forget : ne bloque pas le push.
    const brainCheck = raw.checks.find((c) => c.id === 'brain')
    /*
     * REARMEMENT — mesure conv-152, 2026-09-02. `ensureBrainServerStarted` ne se rearme QUE
     * lorsqu'elle est appelee et trouve le service vivant ; or on ne l'appelait que sur un check
     * ROUGE. Donc apres UNE tentative infructueuse, `attempted` restait vrai pour toute la session
     * et l'app ne relancait plus JAMAIS le brain_server : elle repondait « injoignable » alors que
     * le service etait simplement a relancer (verifie : 100 s de service mort, aucun nouveau spawn).
     * On rearme donc des que le check est VERT : la prochaine chute redonne droit a une tentative.
     */
    if (brainCheck?.ok) resetBrainLaunchAttempt()
    /*
     * #2 bis — un service qui REPOND n'est pas un service SAIN. Mesure du 2026-09-04 : le ping
     * (GET /) passait au vert pendant que /health rendait 503 `degraded` (« index freshness
     * mismatch ») ; les questions au Brain revenaient vides et il fallait relancer brain_index.py
     * à la main. On lit donc /health et on réindexe, une seule fois par session, en tâche de fond.
     */
    if (brainCheck?.ok) {
      void ensureBrainIndexFresh({ instanceDeTest: isolatedTestInstance }).then((r) => {
        if (r.status !== 'not-needed') console.log('[brain-index]', r.status, '—', r.detail)
      })
    }
    if (brainCheck && !brainCheck.ok) {
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

  // Le preflight ne couvre que le DÉMARRAGE. Ce battement, lui, dure toute la session : si le
  // brain_server meurt, Autowin le relance lui-même — sans fenêtre — au lieu d'attendre un
  // démarrage à la main dans une console.
  brainSupervisionHandle = superviseBrainServer({
    pingBrain: () => appPreflightProbes().pingBrain(),
    onEvent: (message) => console.log(message)
  })

  // BRAIN PERSO (conv-1233, 2026-10-28) : son serveur démarre avec l'app, à côté de celui de
  // l'équipe. Une instance de TEST n'y touche pas, comme pour le Brain d'équipe.
  if (!isolatedTestInstance) {
    void demarrerBrainPersoAuLancement().catch((e) =>
      console.warn('[brain-perso] démarrage impossible —', String(e))
    )
  }

  // MOTEUR RECHARGÉ SANS TUER PERSONNE (dev seulement) : l'interface se recharge déjà à chaud ; le
  // moteur, lui, est recompilé en coulisse à chaque modification et l'app ne se relance que quand
  // aucun tour de chat ni aucune orchestration ne tourne, après un préavis. `--watch` reste interdit
  // (`dev-sans-watch.test.ts`) : il relançait en plein travail. Voir `relance-auto-moteur.ts`.
  if (
    relanceAutoMoteurPermise({
      isPackaged: app.isPackaged,
      instanceIsolee: isolatedTestInstance,
      executionDeTache: scheduledTaskDispatch,
      env: process.env
    })
  ) {
    const racineDuDepot = app.getAppPath()
    const demarrageDuProcessus = Date.now() - process.uptime() * 1000
    relanceMoteurHandle = armerRelanceAutoMoteur({
      surveiller: (surChangement) =>
        surveillerSourcesDuMoteur(racineDuDepot, surChangement, (ligne) =>
          console.warn(`[relance-moteur] ${ligne}`)
        ),
      compiler: () => compilerLeMoteur(racineDuDepot, process.execPath),
      auRepos: () => conversationsOccupees().length === 0 && bus.orchestrationsEnVol() === 0,
      annoncer: (text) => broadcast({ type: 'toast', text }),
      relancer: (cause) => {
        annoncerFermeture(cause)
        restartApplication(app)
      },
      sourcesModifieesDepuisLeDemarrage: () =>
        sourcesDuMoteurPlusRecentesQue(racineDuDepot, demarrageDuProcessus),
      journaliser: (ligne) => console.log(`[relance-moteur] ${ligne}`)
    })
  }

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
  // Nos terminaux, un par un, par leur processus (conv-1362, lot 3/3). S'il y en avait, on ressort
  // au tour suivant : quitter dans le même tour fige Electron (voir `fermerTerminauxAvantSortie`).
  if (fermerTerminauxAvantSortie(() => app.quit())) {
    event.preventDefault()
    return
  }
  capteurHdesk?.detruire()
  void lancementIpc?.arreterTout()
  capteurHdesk = null
  // Le fichier est retiré dès l'appel (synchrone) : un script ne visera pas une app qui s'en va.
  void pointEntreeLocal?.arreter()
  pointEntreeLocal = null
  // Un raccourci global laissé posé continue de capter la combinaison pour toute la session.
  raccourciCapture?.desinstaller()
  raccourciCapture = null
  flushConversations()
  flushScheduledTasks()
  // Les petits magasins JSON s'ecrivent hors du fil principal depuis conv-1368 : ce qui reste en
  // attente doit etre pose avant l'arret. `flushScheduledTasks` le fait deja, mais il peut disparaitre.
  viderFichiersEnAttente()
  // Le journal de tour ecrit par LOTS : ce qui dort en tampon doit atteindre le disque avant
  // l'arret, sinon la reprise d'un tour en vol perdrait ses derniers deltas.
  flushAllTurnJournals()
  // Les appels modele s'ecrivent hors du fil principal : ce qui est encore en vol doit atteindre
  // le disque avant l'arret, sinon l'Observatory perdrait les derniers appels de la session.
  flushAllPromptCalls()
  // Les traces de fichiers des fils s'ecrivent en DIFFERE depuis /gel conv-1118 (appendFileSync
  // figeait la fenetre jusqu'a 10 s) : ce qui reste en tampon doit atteindre le disque avant l'arret.
  flushConversationFileTraces()
  // Les traces Brain aussi, depuis conv-1598 (appendFileSync figeait la fenetre 29 s en une matinee).
  flushBrainTraces()
  // Le cout des tours s'ecrit desormais en DIFFERE (appendFileSync figeait l'interface 9,4 s,
  // mesure du 2026-09-12) : ce qui reste en tampon doit atteindre le disque avant l'arret.
  os.cost.flushPersistSync()
  preflightWatchHandle?.stop() // couper la boucle de re-probe démarrage (pas de timer résiduel)
  preflightWatchHandle = null
  brainSupervisionHandle?.stop() // couper le battement de surveillance du brain_server
  brainSupervisionHandle = null
  relanceMoteurHandle?.arreter() // plus de surveillance des sources ni de relance programmée
  relanceMoteurHandle = null
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
