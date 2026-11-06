import { commandeNonInjectable } from '../skills/skill-routing'
import { isAppDestination } from '../../shared/view-tabs'
import { observerLeMoteur } from '../app/observer-les-sources'
import { MOTIF_STOP_DU_CHAT } from '../../shared/arret-par-stop'
import { HAUTEUR_BOUTONS_FENETRE } from '../../shared/barre-fenetre'
import { nomUtilisateurCourant } from '../profil/identite-utilisateur'
import { spawn } from 'node:child_process'
import { registerPiperIpc } from './piper'
import { registerActivityIpc } from './activity'
import { registerWorktreeIpc, type WorktreeFixtureDeTest } from './worktree'
import { registerConversationsIpc } from './conversations'
import { registerCarteDesBesoinsIpc } from './carte-des-besoins'
import { creerDossierDuBoard, sousDossierDuPoste } from '../board/board-dossier'
import { creerPublicationDeLaPresence } from '../mascotte/quartier-presence'
import { ANIMAL_PAR_DEFAUT } from '../../shared/quartier-presence'
import { registerQuartierPresenceIpc } from './quartier-presence'
import { registerLangueIpc } from './langue'
import { registerCaptureElementIpc } from './capture-element'
import { creerMesureDesEcarts } from '../board/ecarts-des-fiches'
import type { ConversationPourLaCarte } from '../board/carte-des-besoins'
import { messagesRecopies, type BranchePourLaFiche } from '../board/fiches-de-demande'
import { lireDossiersProjetsClaude } from '../providers/dossiers-claude-cli'
import { registerTranscriptsIpc } from './transcripts'
import { registerPreflightIpc } from './preflight'
import { registerGitIpc } from './git'
import { registerProjectFilesIpc } from './project-files'
import { registerLancementIpc } from './lancement'
import { registerTestsViewIpc } from './tests-view'
import { registerPerfIpc } from './perf'
import { registerBrainIpc } from './brain'
import { registerClaudeAccountsIpc } from './claude-accounts'
import { registerProfilesIpc } from './profiles'
import { registerTopologyIpc } from './topology'
import { registerProvidersIpc } from './providers'
import { registerRolesIpc } from './roles'
import { registerModelsIpc } from './models'
import { registerFabricIpc } from './fabric'
import { registerCapabilitiesIpc } from './capabilities'
import { registerWorkflowProfilesIpc } from './workflow-profiles'
import { registerChatArtifactsIpc } from './chat-artifacts'
import { registerSkillsIpc } from './skills'
import { registerWhisperIpc } from './whisper'
import { registerDiarisationIpc } from './diarisation'
import { pendantOperation } from '../gel/gel-main'
import { emitToLiveWindows } from '../app/renderer-emit'
import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  nativeTheme,
  Notification,
  safeStorage
} from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import type { ExecutionEvidence, Message, ProviderAdapter } from '../providers/types'
import {
  clearExecutionWorkspacePreference,
  readExecutionWorkspacePreference,
  writeExecutionWorkspacePreference
} from '../orchestration/execution-workspace-preference'
import { execFileSync } from 'node:child_process'
import { estDansUnDepotGit } from '../git/depot-git'
import { readBrainHealth } from '../brain/brain-index-refresh'
import { appliquerBrainReglage, effacerBrainReglage, lireBrainReglage } from '../brain/brain-reglage'
import {
  defaultBrainPersoRoot,
  demarrerBrainPerso,
  envDuBrainPerso,
  origineBrainPerso,
  pingBrainPerso,
  preparerDossierBrainPerso,
  racineBrainPerso
} from '../brain/brain-perso'
import { defaultBrainRoot } from '../brain/brain-paths'
import type { BrainPersoState, BrainReglageState } from '../../shared/preload-contracts'
import { restoreTrashedKnowledge, retractKnowledgeCandidate } from '../brain/brain-inbox'
import { DEFAULT_ORCHESTRATION_BUDGET } from '../orchestration/orchestration-budget'
import { type AppEvent } from '../commands/commands'
import { compensateOutcomeCuration } from '../brain/outcome-learning-curation'
import { executeCurationTransaction } from '../brain/outcome-learning-curation-transaction'
import { resumerMesure, traiterStepPourPari } from '../activity/pari-step'
import {
  annoncerLaFinDuTour,
  createRunPilotChat,
  issueDeCloture,
  issueDuResultat,
  suivreLaFinDuTour,
  type ObservateurFinDeTour
} from '../chat/run-pilot-chat'
import { anciensPlansDuChef, plansPourLaListe, type IssueDuTour } from '../../shared/plan-de-lots'
import { phrasesDesLots } from '../../shared/phrase-du-fil'
import { lancerSansAttendre } from '../chat/lancer-sans-attendre'
import { demarrerPointEntreeLocal } from '../app/point-entree-local'
import { modeleDuTour } from '../chat/modele-de-conversation'
import { creerRelanceurSurDisque, type RelanceurTachesDeFond } from '../chat/relance-taches-de-fond'
import { enregistrerDirectiveDansLeFil } from '../chat/directive-dans-le-fil'
import { buildContinuationProviderHistory } from '../chat/chat-continuation'
import { parseFileRef, resolveFileRef } from '../../shared/file-ref'
import { commandeEditeur, ligneDemandee, racinesRevelation } from '../fichiers/reveal-file'
import { type ChatTurnEvent } from '../../shared/chat-turn'
import type { RunLifecycleEvent } from '../../shared/run-execution'
import { evenementRefusIntegration } from '../activity/ledger'
import { classeTerminaleDEchec } from '../orchestration/classe-terminale-echec'
import { pruneLegacyContextValues } from '../runs/context-value-gc'
import { deleteConvRun, listConvRuns, loadConvRunTrace } from '../runs/conv-runs'
import { phasesAvecJuge } from '../orchestration/orchestration-memoire'
import { deleteListedRun } from '../dashboards/runs-scan'
import { createOrchestrateTurnPersistence } from '../runs/orchestrate-turn-persistence'
import { StartupResumeQueue } from '../runs/startup-resume-queue'
import { creerRepriseDesFils } from '../chat/reprise-fil-apres-quota'
import { type SuiviDuPlan } from '../runs/relaunch-resumable-run'
import { type OrchestrationRunState } from '../runs/orchestration-state'
import {
  appendTurnEvent,
  isTurnFinished,
  listUnfinishedTurnsPuisMenageAsync,
  pruneFinishedTurnJournals,
  readTurnJournal
} from '../runs/turn-journal'
import {
  listRecoverableChatProviderCallsAsync,
  recoverCompletedChatProviderCall,
  reglagesDeReprise,
  type RecoverableChatProviderCall,
  streamedPrefixForProviderCall,
  waitForRecoverableChatProviderExit
} from '../runs/chat-provider-recovery'
import { relayerAppelChatRepris } from '../runs/relais-appel-repris'
import { loadConvActivity } from '../activity/conv-activity'
import { reconcileLateRunLifecycle } from '../activity/late-run-usage-settlement'
import {
  loadAllPromptCalls,
  loadPromptCalls,
  applyRecoveredUsage,
  costSamplesFrom,
  summarizeCostSamples
} from '../activity/prompt-observability'
import { recoverUnpricedCallsUsage } from '../activity/cli-usage-recovery'
import { appendObservedOrchestrationOutcome } from '../activity/orchestration-outcome-trace'
import { executionCostCoverageFields } from '../../shared/orchestration-outcome'
import { allegerTracePourGraphe, chargesDesEvenements } from '../activity/trace-allegee'
import { responseDisplayedTrace } from '../activity/response-displayed-trace'
import {
  persistOrchestrationPhaseStart,
  persistOrchestrationStep,
  persistRunLifecycle
} from '../activity/orchestration-observability'
import { aggregateToolUsage } from '../activity/tool-usage'
import { listBehaviourFiles, readBehaviourFileFromManifest } from '../behaviour/behaviour-files'
import { assertTrustedBehaviourSender, assertTrustedRendererSender } from './ipc-senders'
import { type FabricNodeSummary } from '../compute-fabric/control-plane'
import { createFabricProductBindings } from '../compute-fabric/product-bridge'
import { createCheckpointForkManifest } from '../topologie/wire-checkpoint-fork'
import { recommendShadowRoute } from '../modeles/shadow-router'
import { createShadowRoutingRuntime } from '../modeles/model-routing-shadow'
import { saveShadowRoutingPilotSetting } from '../modeles/model-routing-shadow-setting'
import { rebuildSemanticTemporalProjection } from '../knowledge/semantic-temporal-store'
import { saveAgentTopology } from '../topologie/topology-disk'
import type { AgentTopology } from '../topologie/topology'
import { autowinAppDataRoot, ensureAutowinAppData } from '../app/app-data'
import { typerCeQuiPart, typeurTsc } from '../verify/typage-avant-publication'
import { materializeClaudeAttachments } from '../providers/claude'
import { homedir } from 'node:os'
import { canonicalProjectPath } from '../../shared/project-path'
import { guardAttachments, guardString, guardStringOrNull } from './ipc-guards'
import { messagesAAfficher } from '../conversations/messages-entre-fils-app'
import { CoordinateurDesPlans } from '../orchestration/plans-de-lots-app'
import { abortUpdateConflict, checkForUpdate, applyUpdate } from '../git/git-update'
import type { UpdateAction } from '../../shared/update-contract'
import { restartApplication } from '../app/app-restart'
import { annoncerFermeture } from '../app/journal-arrets'
import { consommerReprise } from '../app/redemarrage-reprise'
import {
  avertissementDossierConversation,
  refuserTourSiDossierDisparu,
  diagnostiqueDossierConversation
} from '../conversations/bascule-dossier-conversation'
import { depotCiteDansLeMessage } from '../git/depot-cite-dans-le-message'
import { rangerConversationSurLePremierMessage } from '../conversations/rangement-premier-message'
import { noterAppelCourt, signalerPanneAppelCourt } from '../orchestration/petites-taches-trace'
import { condenseurDuBrain } from '../brain/brain-condenseur'
import {
  partageLeDepot,
  photographierDebutDeTour,
  verifierCeQuiPart
} from '../chat/chat-turn-publication'
import { publierSansTour, redacteurDeCommit } from '../git/git-apres-fil-sans-tour'
import { lireProprietairesDeFichiers } from '../fichiers/proprietaire-fichier'
import {
  blocDuTour,
  commitsPublies,
  decisionGitApresFil,
  estDepotAutowin,
  FileGitApresFil,
  filDeLaPasse,
  lireAmont,
  planTourneEncore,
  publicationInterditeDans,
  travauxParFil,
  travauxTentesSurDisque
} from '../git/git-apres-fil'
import {
  autoCloseBranch,
  autoCloseRun,
  defaultGitRunner,
  type AutoCloseReport
} from '../runs/run-autoclose'
import {
  creerNotifieurDeFinDeTour,
  libelleDeBouton,
  type ContenuNotification
} from '../app/notification-fin-de-tour'
import { creerPopupsDeFinDeTour, definirPaletteDeCarte } from '../app/notification-popup-fenetre'
import {
  cssDeLAccueil,
  HAUTEUR_MASCOTTE,
  HUMEURS_ACCUEIL,
  htmlDeMascotte,
  LARGEUR_MASCOTTE,
  type HumeurAccueil
} from '../mascotte/mascotte'
import {
  ecrireMascotteAffichee,
  ecrireStyleMascotte,
  lireMascotteAffichee,
  lireStyleMascotte,
  styleAffiche
} from '../mascotte/mascotte-reglage'
import { photographierLeCode } from '../git/photo-du-code'
import { materializeChatArtifact } from '../store/chat-artifact-store'
import { filterNativePreflight, readNativePreflight } from '../activity/native-preflight'
import { nativeSpoolRoot, appendNativeTrace } from '../activity/native-trace-spool'
import { appendBrainTrace, readBrainTraces } from '../activity/brain-trace-spool'
import {
  activeWorkflowProfile,
  seedDefaultWorkflows,
  WorkflowRefusalMailbox,
  type WorkflowProfilesFile
} from '../workflow/workflow-profiles'
import { overrideFor } from '../workflow/workflow-run-override'
import { graphDefects, worstCaseNodeExecutions, type WorkflowGraph } from '../workflow/workflow-graph'
import { journaliserSaisie, lireOrientationsRattachees } from '../store/journal-saisie'
import { inventorierDisque, menageDemarrage } from '../store/inventaire-disque'
import { jouerPasseDeRetention } from '../store/balayage-retention'
import { chargerShaConsignes } from '../store/registres-consignes'
import {
  appendExecutionEvidenceFileTrace,
  readConversationFileTraces,
  readConversationTurnFileMutations,
  readConversationTurnFilePaths
} from '../activity/conversation-file-trace-spool'
import { buildBehaviourComposition } from '../behaviour/behaviour-composition'
import { artifactsFromExecutionEvidence } from '../providers/artifacts'
import { sharedBrainRoot } from '../brain/brain-context'
import { TaskScheduler } from '../task-manager/task-scheduler'
import { WatchdogEngine } from '../task-manager/watchdog-engine'
import { seedWatchdogTasks } from '../task-manager/watchdog-seeds'
import { seedMaintenanceTask } from '../task-manager/maintenance-seed'
import { seedGcTask } from '../task-manager/gc-seed'
import { seedCurateTask } from '../task-manager/curate-seed'
import { seedVeilleTask } from '../task-manager/veille-seed'
import {
  MailChannelWatcher,
  MailWatchMemory,
  describeMail,
  liftLegacyMailWatchdogCaps,
  listeningChannels,
  mailDiagnostics,
  reglesMailsPersoAutorisees,
  retargetTeamsWatchdogPrompt,
  splitMailWatchdogByChannel,
  seedMailWatchdogTask
} from '../task-manager/watchdog-mail'
import {
  TeamsGraphClient,
  describeTeamsMessage,
  parseTeamsItemId,
  replyTeams
} from '../task-manager/watchdog-teams'
import { sourceTeams, TeamsLocalClient } from '../task-manager/watchdog-teams-local'
import {
  cheminJournalWatchdogTeams,
  creerBattementWatchdog,
  creerJournalWatchdog,
  detailPilotage,
  empreinteConversation
} from '../task-manager/journal-watchdog-teams'
import {
  ScheduledChatDispatcher,
  scheduledTaskBinding,
  type ScheduledChatRuntime
} from '../task-manager/chat-dispatch'
import { runWatchdogOrchestration } from '../task-manager/watchdog-orchestration-adapter'
import {
  isolatedRelayLaunchArguments,
  PowerShellWindowsRelay,
  windowsRelayTaskName
} from '../task-manager/windows-relay'
import { registerTaskManagerIpc } from '../task-manager/task-manager-ipc'
import { OUTLOOK_HORS_INSTANCE_CACHEE, OutlookLocalGateway } from '../outlook/outlook-local'
import { registerVeilleIpc } from '../veille/veille-ipc'
import { executerPasse } from '../veille/passe'
import { genererCandidatsEnConversation } from '../veille/scout-visible'
import { unePasseALaFois } from '../veille/une-passe-a-la-fois'
import { lancerScoutVeille } from '../veille/scout-claude'
import { candidatsInternesDuDepot } from '../veille/audit-depot'
import { dispatcherAvecVeille } from '../veille/dispatch-veille'
import { deposerOrientationDuFil } from '../conversations/orientations-en-cours-app'
import type { ContexteIpcChat } from '../index'

// Extrait tel quel d’index.ts (lot 5) : l’enregistrement des IPC du chat pesait ~3 500 lignes
// du démarrage. Le corps est INCHANGÉ ; l’état du module principal arrive par `ctx`. Les `let` du
// démarrage y sont lus/écrits par accesseurs (`ctx.x`) pour rester vivants, les autres sont déstructurés.
/** IPC : chat, orchestration, dashboards et graphe. */
export function registerChatIpc(ctx: ContexteIpcChat): SuiviDuPlan {
  const {
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
    turnJournalRoot
  } = ctx

  // Survie niveau 2 : au démarrage, le renderer demande les tours restés INACHEVÉS (app fermée en
  // pleine exécution) pour les rejouer/afficher. Le ménage des journaux terminés suit la réponse
  // (25 gels, 69 s cumulées, quand il la PRÉCÉDAIT) — cf. listUnfinishedTurnsPuisMenageAsync
  // (runs/turn-journal.ts).
  ipcMain.handle('runs:unfinishedTurns', (event) => {
    assertTrustedRendererSender(event, 'UnfinishedTurns')
    // La LISTE part tout de suite (tampons vides d'abord, sinon un tour en vol serait invisible) ;
    // scan et suppressions passent apres le premier rendu. 25 gels, 69 s, ~2,8 s par ouverture.
    return listUnfinishedTurnsPuisMenageAsync(turnJournalRoot, {
      menage: () => {
        pruneFinishedTurnJournals(turnJournalRoot)
        pruneLegacyContextValues()
      }
    })
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
  /**
   * COULEUR DES BOUTONS DE FENETRE — reduire / agrandir / fermer.
   *
   * Ces trois boutons sont dessines par WINDOWS, pas par la page : aucune feuille de style ne les
   * atteint. Leur couleur se fixe a la creation de la fenetre (`window.ts`, `titleBarOverlay`),
   * donc dans le processus principal, alors que le theme choisi vit dans le renderer. Sans ce
   * canal, la barre ne peut suivre AUCUN theme : elle garde son quasi-blanc de depart, invisible
   * des que la page passe en clair. Constate a l'ecran le 2026-09-07.
   *
   * Le renderer envoie une couleur, pas un nom de theme : c'est lui qui sait ce que vaut
   * `--text` dans le theme courant, et cela reste vrai pour les themes a venir sans toucher ici.
   * ENTREE QUI DOIT FAIRE ECHOUER LE GARDE : retirer cet appel, ou remettre une couleur en dur
   * dans `window.ts` sans point de mise a jour — le defaut reviendrait en silence.
   */
  /**
   * PRÉSENCE SYSTÈME des runs. Le renderer est le seul à tenir la liste des runs vivants ; il
   * l'envoie ici comme il envoie déjà la couleur des boutons de fenêtre juste en dessous.
   */
  ipcMain.handle('os:presence', (event, etat: unknown) => {
    assertTrustedRendererSender(event, 'Présence système des runs')
    const brut = (etat ?? {}) as Record<string, unknown>
    const nombre = (cle: string): number =>
      typeof brut[cle] === 'number' ? (brut[cle] as number) : 0
    refleterRunsVivants({
      runsActifs: nombre('runsActifs'),
      etapesFaites: nombre('etapesFaites'),
      etapesTotales: nombre('etapesTotales')
    })
    return true
  })
  // L'interrupteur « Mascotte du bureau » de Settings · Interface. Le moteur garde le
  // choix (`mascotte-reglage.ts`) : la mascotte vit hors de la fenêtre, fenêtre fermée comprise.
  ipcMain.handle('os:mascotte', (event) => {
    assertTrustedRendererSender(event, 'Mascotte du bureau')
    return lireMascotteAffichee()
  })
  ipcMain.handle('os:mascotte:afficher', (event, affichee: unknown) => {
    assertTrustedRendererSender(event, 'Mascotte du bureau')
    ecrireMascotteAffichee(affichee)
    mascotteDuBureau.afficher(lireMascotteAffichee())
    return lireMascotteAffichee()
  })
  // Le choix « Magicien / Basique » de la même ligne de Settings · Interface.
  ipcMain.handle('os:mascotte:style', (event) => {
    assertTrustedRendererSender(event, 'Mascotte du bureau')
    return lireStyleMascotte()
  })
  ipcMain.handle('os:mascotte:choisir-style', (event, style: unknown) => {
    assertTrustedRendererSender(event, 'Mascotte du bureau')
    ecrireStyleMascotte(style)
    mascotteDuBureau.changerStyle(styleAffiche(lireStyleMascotte(), ctx.themeDeLaMascotte))
    return lireStyleMascotte()
  })
  // Le thème appliqué par la fenêtre : le thème NieR montre la machine, sans toucher au
  // style gardé. Seul un identifiant de thème court en lettres, chiffres et tirets est accepté.
  ipcMain.handle('os:mascotte:theme', (event, theme: unknown) => {
    assertTrustedRendererSender(event, 'Mascotte du bureau')
    if (typeof theme !== 'string' || !/^[a-z0-9-]{1,40}$/u.test(theme)) return false
    ctx.themeDeLaMascotte = theme
    mascotteDuBureau.changerStyle(styleAffiche(lireStyleMascotte(), ctx.themeDeLaMascotte))
    return true
  })
  // La même mascotte sur l'accueil d'un fil vide : sa vraie page, puis son humeur.
  ipcMain.handle('os:mascotte:page', (event) => {
    assertTrustedRendererSender(event, 'Mascotte du bureau')
    return {
      html: htmlDeMascotte(lireStyleMascotte()),
      largeur: LARGEUR_MASCOTTE,
      hauteur: HAUTEUR_MASCOTTE
    }
  })
  ipcMain.handle('os:mascotte:feuille-accueil', (event, humeur: unknown, agents: unknown) => {
    assertTrustedRendererSender(event, 'Mascotte du bureau')
    const connue = HUMEURS_ACCUEIL.includes(humeur as HumeurAccueil)
    return cssDeLAccueil(
      connue ? (humeur as HumeurAccueil) : 'eveil',
      typeof agents === 'number' && Number.isFinite(agents) ? Math.floor(agents) : 0,
      lireStyleMascotte()
    )
  })
  ipcMain.handle('app:titlebar-symbol-color', (event, couleur: unknown) => {
    assertTrustedRendererSender(event, 'Couleur des boutons de fenêtre')
    // On n'accepte qu'un hexadecimal : cette valeur part vers une API natice de Windows.
    if (typeof couleur !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(couleur)) return false
    const fenetre = BrowserWindow.fromWebContents(event.sender)
    if (!fenetre || fenetre.isDestroyed()) return false
    try {
      fenetre.setTitleBarOverlay({
        color: '#00000000',
        symbolColor: couleur,
        height: HAUTEUR_BOUTONS_FENETRE
      })
      return true
    } catch {
      // Plateforme sans overlay de barre de titre (macOS, Linux) : ce n'est pas une panne.
      return false
    }
  })
  /*
   * `prefers-color-scheme` suit le THEME AUTOWIN, pas celui de Windows. Sans ce reglage, Electron
   * repond la preference du systeme (`themeSource: 'system'`) : un Windows en mode clair faisait
   * matcher `prefers-color-scheme: light` dans une app SOMBRE, et le HTML rendu dans le fil
   * appliquait ses couleurs de theme clair -- texte bleu marine sur fond noir (
   * 2026-10-08, `AppsUseLightTheme = 1`). Doc : https://www.electronjs.org/docs/latest/api/native-theme
   * Seules deux valeurs passent : `system` reviendrait exactement au defaut corrige ici.
   */
  ipcMain.handle('app:color-scheme', (event, schema: unknown) => {
    assertTrustedRendererSender(event, 'Schema de couleurs')
    if (schema !== 'dark' && schema !== 'light') return false
    nativeTheme.themeSource = schema
    return true
  })
  // Les couleurs du thème choisi pour la carte de fin de tour, qui vit hors de la page.
  // `definirPaletteDeCarte` n'accepte que huit `#rrggbb` : ces valeurs finissent dans du CSS.
  ipcMain.handle('app:carte-fin-de-tour-palette', (event, palette: unknown) => {
    assertTrustedRendererSender(event, 'Couleurs de la carte de fin de tour')
    return definirPaletteDeCarte(palette)
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

Et le meme fil porte un DIAGRAMME, rendu par mermaid :

\`\`\`mermaid
flowchart LR
  A[Message] --> B{Fence fermee ?}
  B -- oui --> C[Diagramme rendu]
  B -- non --> D[Bloc de code]
\`\`\`

Un diagramme TRES HAUT doit rester sous le plafond de hauteur du fil (300 px) :

\`\`\`mermaid
flowchart TD
  H1[Etape 1] --> H2[Etape 2] --> H3[Etape 3] --> H4[Etape 4] --> H5[Etape 5]
  H5 --> H6[Etape 6] --> H7[Etape 7] --> H8[Etape 8] --> H9[Etape 9] --> H10[Etape 10]
  H10 --> H11[Etape 11] --> H12[Etape 12] --> H13[Etape 13] --> H14[Etape 14] --> H15[Etape 15]
\`\`\`

Un diagramme dont la syntaxe est fausse doit retomber sur sa source, sans casser le fil :

\`\`\`mermaid
flowchart LR
  A --> ((((  cette ligne n'est pas du mermaid
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
    const count = ctx.isolatedConversationReadCount
    if (reset === true) ctx.isolatedConversationReadCount = 0
    return count
  })
  // Le canal de l'inventaire des skills vit dans src/main/ipc/skills.ts.
  registerSkillsIpc({ skillSourcesPath: join(app.getPath('userData'), 'skill-sources.json') })
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
      onClosed: () => broadcast({ type: 'refresh', scope: 'conversations' }),
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
              workspaceRoot: dossierDuTour(conversationId)
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
          workspaceRoot: dossierDuTour(conversationId),
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
        // Le JUGE joue compte parmi les phases, comme sur la lignee `commands.ts`.
        phaseOutputs: phasesAvecJuge(result.phaseOutputs, result.judgeText),
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
        // Même classement que le chemin du chat (`commands.ts`) : `classe-terminale-echec.ts`.
        terminalClass: classeTerminaleDEchec(e, aborted)
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
      ctx.agentTopology,
      DEFAULT_ORCHESTRATION_BUDGET.maxUsd
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
      { base: app.getPath('userData'), brainRoot: sharedBrainRoot() }
    )
  })
  // Les canaux du diagnostic de prérequis vivent dans src/main/ipc/preflight.ts.
  registerPreflightIpc({ preflightProviderOptions })
  // Les canaux git (lecture seule) vivent dans src/main/ipc/git.ts.
  registerGitIpc({ os, pickDirectory })
  // Les canaux « Projet » (arborescence + éditeur) vivent dans src/main/ipc/project-files.ts.
  registerProjectFilesIpc({ os })
  // Le bouton « Lancer » du panneau Fichiers vit dans src/main/ipc/lancement.ts.
  ctx.lancementIpc = registerLancementIpc({ os })
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
  ipcMain.handle('run:gitApresFil:set', (event, enabled: unknown) => {
    assertTrustedRendererSender(event, 'GitApresFil')
    os.setGitApresFil(enabled === true)
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
  const lireTopologie = (): AgentTopology => ctx.agentTopology
  const appliquerTopologie = (topology: AgentTopology): AgentTopology => {
    ctx.agentTopology = saveAgentTopology(agentTopologyPath, topology, ctx.agentModels)
    syncRuntimeTopology(ctx.agentTopology)
    return ctx.agentTopology
  }
  const broadcastRolesRefresh = (): void => broadcast({ type: 'refresh', scope: 'roles' })
  registerRolesIpc({
    os,
    agentModelsReady,
    lireModeles: () => ctx.agentModels,
    lireTopologie,
    appliquerTopologie,
    broadcastRolesRefresh,
    broadcastConversationsRefresh: () => broadcast({ type: 'refresh', scope: 'conversations' })
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

  // Les canaux des workflows nommés vivent dans src/main/ipc/workflow-profiles.ts.
  registerWorkflowProfilesIpc({
    workflowRefusalMailbox,
    appliquerWorkflowActif,
    pickPath,
    pickSavePath,
    broadcast
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
  ipcMain.handle('os:shadowRoutingPilot:get', (event) => {
    assertTrustedRendererSender(event, 'Pilote de routage shadow')
    return shadowRoutingPilotState()
  })
  ipcMain.handle('os:shadowRoutingPilot:set', (event, enabled: unknown) => {
    assertTrustedRendererSender(event, 'Pilote de routage shadow')
    const saved = saveShadowRoutingPilotSetting(shadowRoutingPilotPath, enabled)
    // Reconstruction IMMEDIATE : le sink de trace relit `shadowRoutingRuntime` a chaque evenement,
    // la bascule prend donc effet sans redemarrage. L'environnement garde la priorite.
    ctx.shadowRoutingRuntime = createShadowRoutingRuntime(
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
    lireModeles: () => ctx.agentModels,
    lireTopologie,
    synchroniserFabric,
    isolatedTestInstance,
    // Le compte actif n'a rien à sonder de plus : c'est déjà lui que décrit le relevé général.
    compteClaudeDuReleve: (id) => {
      const compte = claudeAccounts.find(id)
      return compte && id !== claudeAccounts.active().id ? { configDir: compte.dir } : undefined
    }
  })
  registerFabricIpc({
    fabricControlPlane,
    lireFixtureIsolee: () => ctx.isolatedFabricFixtureSummary,
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
    ctx.isolatedFabricFixtureSummary = summary
    ctx.agentModels = [...ctx.agentModels.filter((candidate) => candidate.id !== model.id), model]
    os.roles.setCatalog(ctx.agentModels)
    return { summary, model }
  })
  ipcMain.handle('app:test:fabric-fixture:send', async (event, execution?: unknown) => {
    assertTrustedRendererSender(event, 'Exécution fixture Compute Fabric')
    if (!isolatedTestInstance)
      throw new Error('Fixture Compute Fabric indisponible hors instance isolée')
    if (!ctx.isolatedFabricFixtureSummary) throw new Error('Fixture Compute Fabric non installée')
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
    if (!ctx.shadowRoutingRuntime.enabled) {
      return {
        status: 'insufficient-data' as const,
        confidence: 'insufficient' as const,
        phase: safePhase,
        reason:
          'Routeur shadow desactive : activez « Mesurer les routes (pilote shadow) » dans Settings > Routage pour que l app commence a mesurer quelle route tient le vert au cout le plus bas.'
      }
    }
    if (!champion || typeof champion !== 'object') throw new Error('Champion invalide')
    const route = champion as { provider?: unknown; model?: unknown }
    const samples = ctx.shadowRoutingRuntime.store.read().map((observation) => ({
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

  // Le DOSSIER DE TRAVAIL : le depot sur lequel les runs s'executent. Distinct du selecteur de
  // BehaviourView juste en dessous, qui ne sert qu'a INSPECTER les fichiers d'instructions d'un
  // dossier sans rien changer a l'execution.
  const executionWorkspaceState = (): {
    path: string
    chosen: string | null
    isGitRepo: boolean
    restartRequired: boolean
  } => {
    const chosen = readExecutionWorkspacePreference() ?? null
    return {
      path: os.executionWorkspace,
      chosen,
      isGitRepo: estDansUnDepotGit(os.executionWorkspace),
      // Le workspace est fige au demarrage : un choix different de l'actif exige un redemarrage.
      restartRequired: chosen !== null && chosen !== os.executionWorkspace
    }
  }

  // LE BRAIN renseigne dans les Reglages (2026-10-13) : un chemin et/ou un depot git.
  // Le dossier du demarrage sert de reference : le serveur Brain et la vue du graphe le gardent
  // jusqu'au redemarrage (`SHARED_BRAIN_ROOT` est lu a l'import de viz/fs-brains.ts).
  const racineBrainAuDemarrage = sharedBrainRoot()
  const memeDossier = (a: string, b: string): boolean => {
    const n = (v: string): string => v.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
    return n(a) === n(b)
  }
  const brainReglageState = async (erreur?: string): Promise<BrainReglageState> => {
    const reglage = lireBrainReglage()
    const effectif = sharedBrainRoot()
    // Borne courte : l'ecran des Reglages ne doit pas attendre un serveur qui ne repond pas.
    const serveurRacine = (await readBrainHealth(fetch, process.env, 2000))?.root ?? null
    return {
      actif: racineBrainAuDemarrage,
      effectif,
      choisi: reglage.chemin || reglage.depot ? reglage : null,
      estUnDepot: Boolean(reglage.depot),
      redemarrageNecessaire: !memeDossier(effectif, racineBrainAuDemarrage),
      serveurRacine,
      serveurSurUnAutreDossier: serveurRacine !== null && !memeDossier(serveurRacine, effectif),
      // Une adresse de depot peut porter un identifiant (`https://nom:jeton@…`) : jamais affiche.
      ...(erreur ? { erreur: erreur.replace(/\/\/[^@/\s]*@/g, '//***@') } : {})
    }
  }

  /*
   * LES CONSIGNES DONNEES PENDANT UN TOUR, RENDUES AU FIL.
   *
   * Elles etaient ecrites dans `saisies-utilisateur.jsonl` (101 le 2026-09-12) mais ne vivaient a
   * l'ecran que dans un etat React : un changement de conversation les effaçait. Lecture seule,
   * bornee, et jamais bloquante -- une defaillance rend une liste vide.
   */
  /*
   * CE QU'AUTOWIN OCCUPE SUR LE DISQUE. La question a du etre POSEE par l'utilisateur le
   * 2026-09-11 (« est-ce qu'autowin OS accumule des Go en l'utilisant ? ») : aucune vue ne le
   * disait. Familles NOMMEES uniquement -- la racine porte aussi les caches de Chromium, qui ne
   * sont pas de l'accumulation d'Autowin.
   */
  const FAMILLES_DISQUE = [
    'worktrees',
    'prompt-observability',
    'causal-trace',
    'turn-journals',
    'run-stdout',
    'runs',
    'chat-artifacts',
    'transcripts',
    'activity',
    'trace',
    'semantic-timeline'
  ]

  ipcMain.handle('os:disk-usage', (event) => {
    assertTrustedRendererSender(event, 'Espace disque')
    return inventorierDisque(app.getPath('userData'), FAMILLES_DISQUE, menageDemarrage())
  })

  ipcMain.handle('chat:orientations', (event, conversationId: unknown) => {
    assertTrustedRendererSender(event, 'Consignes du tour')
    if (typeof conversationId !== 'string' || !conversationId.trim()) return []
    return lireOrientationsRattachees(conversationId)
  })

  ipcMain.handle('os:execution-workspace', (event) => {
    assertTrustedRendererSender(event, 'Dossier de travail')
    return executionWorkspaceState()
  })

  ipcMain.handle('os:execution-workspace:choose', async (event) => {
    assertTrustedRendererSender(event, 'Dossier de travail')
    const selected = await pickDirectory(event.sender)
    if (!selected) return executionWorkspaceState()
    writeExecutionWorkspacePreference(selected)
    return executionWorkspaceState()
  })

  ipcMain.handle('os:execution-workspace:reset', (event) => {
    assertTrustedRendererSender(event, 'Dossier de travail')
    clearExecutionWorkspacePreference()
    return executionWorkspaceState()
  })

  ipcMain.handle('os:brain-reglage', (event) => {
    assertTrustedRendererSender(event, 'Brain')
    return brainReglageState()
  })

  ipcMain.handle('os:brain-reglage:choisir-dossier', (event) => {
    assertTrustedRendererSender(event, 'Brain')
    return pickDirectory(event.sender)
  })

  ipcMain.handle('os:brain-reglage:enregistrer', async (event, entree: unknown) => {
    assertTrustedRendererSender(event, 'Brain')
    const champs = (entree && typeof entree === 'object' ? entree : {}) as {
      chemin?: unknown
      depot?: unknown
    }
    try {
      await appliquerBrainReglage(
        { chemin: champs.chemin, depot: champs.depot },
        { racineParDefaut: defaultBrainRoot() }
      )
      return brainReglageState()
    } catch (error) {
      return brainReglageState(error instanceof Error ? error.message : String(error))
    }
  })

  ipcMain.handle('os:brain-reglage:reset', (event) => {
    assertTrustedRendererSender(event, 'Brain')
    effacerBrainReglage()
    return brainReglageState()
  })

  // BRAIN PERSO (2026-10-28) : même formulaire que celui de l'équipe, son propre fichier
  // (`brain-perso.json`). Pas de redémarrage : le serveur perso démarre dès l'enregistrement.
  const brainPersoState = async (erreur?: string): Promise<BrainPersoState> => {
    const reglage = lireBrainReglage(process.env, 'perso')
    const racine = racineBrainPerso() ?? null
    const envPerso = envDuBrainPerso()
    // Un serveur perso lancé AVANT un changement de dossier sert encore l'ancien (même garde que
    // pour l'équipe : /health porte la racine servie).
    const serveurRacine = envPerso
      ? ((await readBrainHealth(fetch, envPerso, 2000))?.root ?? null)
      : null
    return {
      choisi: reglage.chemin || reglage.depot ? reglage : null,
      racine,
      origine: origineBrainPerso(),
      serveurJoignable: racine ? await pingBrainPerso() : false,
      serveurRacine,
      serveurSurUnAutreDossier:
        racine !== null && serveurRacine !== null && !memeDossier(serveurRacine, racine),
      ...(erreur ? { erreur: erreur.replace(/\/\/[^@/\s]*@/g, '//***@') } : {})
    }
  }

  ipcMain.handle('os:brain-perso', (event) => {
    assertTrustedRendererSender(event, 'Brain perso')
    return brainPersoState()
  })

  ipcMain.handle('os:brain-perso:enregistrer', async (event, entree: unknown) => {
    assertTrustedRendererSender(event, 'Brain perso')
    const champs = (entree && typeof entree === 'object' ? entree : {}) as {
      chemin?: unknown
      depot?: unknown
    }
    try {
      const reglage = await appliquerBrainReglage(
        { chemin: champs.chemin, depot: champs.depot },
        { racineParDefaut: defaultBrainPersoRoot(), quel: 'perso' }
      )
      const racine = reglage.chemin ?? (reglage.depot ? defaultBrainPersoRoot() : undefined)
      if (racine) preparerDossierBrainPerso(racine)
      const lancement = await demarrerBrainPerso()
      if (lancement) console.log('[brain-perso] serveur', lancement.status, '—', lancement.detail)
      return brainPersoState()
    } catch (error) {
      return brainPersoState(error instanceof Error ? error.message : String(error))
    }
  })

  ipcMain.handle('os:brain-perso:reset', (event) => {
    assertTrustedRendererSender(event, 'Brain perso')
    // Retire le RÉGLAGE seulement : le dossier et ses notes restent sur le disque.
    effacerBrainReglage(process.env, 'perso')
    return brainPersoState()
  })

  ipcMain.handle('os:behaviour:choose-workspace', async (event) => {
    assertTrustedBehaviourSender(event)
    const selected = await pickDirectory(event.sender)
    return selected ? behaviourAccess.approve(selected) : null
  })

  ipcMain.handle(
    'window:detach-view',
    (event, view: unknown, screenX: unknown, screenY: unknown) => {
      assertTrustedRendererSender(event, 'Detach view')
      if (!isAppDestination(view)) throw new Error('Vue inconnue')
      if (!Number.isFinite(screenX) || !Number.isFinite(screenY))
        throw new Error('Position invalide')
      openViewWindow(view, screenX as number, screenY as number)
      return { ok: true }
    }
  )

  // La page de question demande la sienne quand elle est prête : rien à perdre si elle
  // charge lentement, et un rechargement la retrouve. Une page ne lit que la question de sa fenêtre.
  ipcMain.handle('model:question:pending', (event) => {
    assertTrustedRendererSender(event, 'Model question')
    return questionDeLaPage(event.sender.id)
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

  /** Assigné plus bas, une fois le coordinateur des plans construit : la reprise le consulte. */
  const suiviDesFilsCoupes: { reprise?: ReturnType<typeof creerRepriseDesFils> } = {}
  /*
   * UNE BRANCHE REPREND LE JOURNAL ET LES FICHES DE SA SOURCE. Le journal d'abord : une
   * question recopiée y redevient une question, au lieu d'une demande sans fiche. Fail-open, comme
   * le journal : un échec ici ne retient jamais le rattachement des fiches.
   */
  const rattacherLaBranche = (
    branche: Parameters<typeof rattacherLaBrancheAuxFiches>[0],
    source: Parameters<typeof rattacherLaBrancheAuxFiches>[1]
  ): Promise<number> => {
    try {
      journalDesBesoins.recopierLaBranche({
        branche: (branche as BranchePourLaFiche).id,
        source: (source as ConversationPourLaCarte).id,
        paires: messagesRecopies(branche as BranchePourLaFiche, source as ConversationPourLaCarte)
      })
    } catch (error) {
      console.warn('[besoins] branche non recopiée au journal :', error)
    }
    return rattacherLaBrancheAuxFiches(branche, source)
  }
  // Les canaux des conversations vivent dans src/main/ipc/conversations.ts.
  registerConversationsIpc({
    os,
    activeChatTurns,
    causalTrace,
    turnJournalRoot,
    isolatedTestInstance,
    broadcast,
    pickDirectory,
    compterLectureIsolee: () => {
      ctx.isolatedConversationReadCount += 1
    },
    etatDeReprise: (fil) => suiviDesFilsCoupes.reprise?.etatDuFil(fil),
    relireLesFilsCoupes: () => {
      if (repriseDesFilsActive) suiviDesFilsCoupes.reprise?.replanifier()
    },
    dossierDuFil: (id) => dossierDuTour(id),
    dossierDesRetours: () => join(ensureAutowinAppData(appDataRoot), 'retours-de-tour'),
    couperLeRun: (id, motif) => bus.abortOrchestration(id, motif),
    retirerLesFiches: fichesDeDemande.retirerLeFil,
    rattacherLesFiches: rattacherLaBranche
  })
  // Les canaux des artefacts du chat vivent dans src/main/ipc/chat-artifacts.ts.
  registerChatArtifactsIpc({ os })
  // La langue de Settings · Interface : l'agent répond dans celle qui est choisie.
  registerLangueIpc()
  // La capture de l'élément désigné par Alt+clic, jointe au brouillon du fil.
  registerCaptureElementIpc()
  // La carte des besoins : lecture seule, calculée ici où vivent tous les fils.
  // Work items : les liens prompt → task dans `liens-work-items.jsonl`, et la seule
  // LECTURE des fiches — aucune écriture chez le fournisseur n'est transmise.
  // Le dossier où le Board est recopié : réglé sur ce poste, rangé sous userData. Partagé
  // avec la présence du village commun, qui écrit à côté de `board.json`.
  const dossierDuBoard = creerDossierDuBoard({
    racine: app.getPath('userData'),
    utilisateur: nomUtilisateurCourant()
  })
  // La présence de ce poste dans le village commun : les tanukis de la vue, filtrés, dans
  // `<dossier du Board>\<compte>\presence.json`. Le réglage est relu à chaque écriture.
  registerQuartierPresenceIpc({
    dossierDuBoard,
    publication: creerPublicationDeLaPresence({
      poste: sousDossierDuPoste(nomUtilisateurCourant()),
      reglage: () => {
        const etat = dossierDuBoard.etat()
        return {
          dossier: etat.dossier,
          nom: dossierDuBoard.nomDuPoste().nom,
          partager: etat.partagerPresence !== false,
          // Toujours écrit, même sans choix : le réglage de l'Accueil montre l'animal que
          // les collègues voient, pas celui d'un tirage sur le nom du poste.
          animal: etat.animal ?? ANIMAL_PAR_DEFAUT,
          // La couleur de leur tenue ; absente = la tenue d'origine, rien à écrire.
          ...(etat.tenue ? { tenue: etat.tenue } : {}),
          // « Afficher mes agents à » des réglages de l'Accueil.
          masquesPour: etat.masquerPresencePour ?? []
        }
      }
    })
  })
  // Rend la copie du Board de fin de tour, appelée par l'observateur de fin de tour.
  const boardDuPoste = registerCarteDesBesoinsIpc({
    os,
    journal: journalDesBesoins,
    racineDesLiens: app.getPath('userData'),
    tickets: {
      listSources: () => ticketSources.list(),
      get: (request) => tickets.get(request)
    },
    dossierDuBoard,
    choisirDossier: pickDirectory,
    // Où la copie de fin de tour garde les états posés à la main.
    racineDuPoste: app.getPath('userData'),
    // Un post-it par RUN.md léger : la fiche de chaque demande rangée.
    lireFiches: fichesDeDemande.fichesParDemande
  })
  // Les RUN.md légers comparés au Board : le Board est lu, jamais changé.
  const mesureDesEcarts = creerMesureDesEcarts({
    racine: app.getPath('userData'),
    lireLaCarte: boardDuPoste.lireLaCarte,
    lireLignes: fichesDeDemande.lignes
  })
  /*
   * Les branches nées avant le rattachement (les « façon 1/3 », seules
   * demandes sans fiche de `ecarts.json`) : leurs demandes recopiées rejoignent la fiche d'origine,
   * une fois, quand tous les fils sont chargés. Rejoué au démarrage suivant, cela n'ajoute rien.
   */
  void os.conversations.archivesChargees
    .then(async () => {
      let rattachees = 0
      for (const branche of os.conversations.list()) {
        const source = branche.forkedFrom && os.conversations.get(branche.forkedFrom.conversationId)
        if (source) rattachees += await rattacherLaBranche(branche, source)
      }
      if (rattachees > 0) mesureDesEcarts.planifier()
    })
    .catch((error) => console.warn('[fiches] branches non rattachées :', error))

  // fix-ok: cause mesurée — aucun code du dépôt ne lisait `~/.claude.json` (grep « claude.json »
  // vide dans src/ avant ce travail) : la liste des dossiers du Chat ne pouvait donc pas
  // s'enrichir des projets claude.exe. Sonde réelle sur le poste : 24 entrées `projects`,
  // 5 vrais projets après filtre.
  // Les projets déjà ouverts dans claude.exe : le main lit et FILTRE `~/.claude.json`,
  // le renderer ne reçoit que des chemins de dossiers — jamais le contenu du profil (jetons,
  // comptes). Relu à CHAQUE appel plutôt que mis en cache : le fichier bouge à chaque session
  // claude.exe, et le renderer n'appelle qu'une fois par montage du Chat.
  ipcMain.handle('os:dossiersClaudeCli', (event) => {
    assertTrustedRendererSender(event, 'Dossiers Claude CLI')
    return lireDossiersProjetsClaude()
  })
  // « This computer » dans le choix du dossier de travail : travailler sur la machine
  // sans projet, comme claude.exe lancé depuis le dossier personnel. Le renderer n'a pas le
  // disque : seul le main connaît ce dossier.
  ipcMain.handle('os:dossierPersonnel', (event) => {
    assertTrustedRendererSender(event, 'Dossier personnel')
    return canonicalProjectPath(homedir()) ?? homedir()
  })

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
    const root = sharedBrainRoot()
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
  // Un chemin mort (run supprime, disque demonte, lecteur reseau absent) passe tel quel a
  // l'explorateur produit une boite Windows opaque (« Le lecteur specifie est introuvable »).
  // On verifie donc l'existence AVANT d'appeler le shell, et on rend un refus nomme.
  ipcMain.handle('os:openFolder', (event, path: string) => {
    assertTrustedRendererSender(event, 'Open folder')
    const cible = guardString(path, 'path')
    if (!existsSync(cible)) return { ok: false, reason: 'introuvable', path: cible }
    shell.showItemInFolder(cible)
    return { ok: true }
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
    // `introuvable` sur tout fichier cree pendant le run — la plainte d'origine.
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
  // Messages entre fils : ce que le fil affiche, envoyés et reçus. Lecture SEULE —
  // afficher ne marque rien comme livré à l'agent.
  ipcMain.handle('os:messagesEntreFils', (event, conversationId: unknown) => {
    assertTrustedRendererSender(event, 'Messages entre fils')
    return messagesAAfficher(guardString(conversationId, 'conversationId'))
  })
  // Plans de lots d'un fil chef : le tableau, et les SEULS gestes qui lancent ou
  // reprennent un plan — le clic de l'utilisateur. L'agent n'a que dépôt, état et relance d'un lot ;
  // la relance a aussi son bouton (lot 3), qui porte le numéro du lot.
  ipcMain.handle(
    'os:plansDeLots',
    async (
      event,
      action: unknown,
      conversationId: unknown,
      planId?: unknown,
      lot?: unknown,
      selection?: unknown
    ) => {
      assertTrustedRendererSender(event, 'Plans de lots')
      const geste = guardString(action, 'action')
      const coordinateur = suiviDesPlans.coordinateur
      if (!coordinateur) return { ok: false, erreur: 'coordinateur des plans pas encore démarré.' }
      // Lecture groupée, sans fil : la liste des conversations range tous les fils de
      // lots sous leur chef en UN appel, au lieu de deviner les lots à leur titre « Lot N/M — ».
      if (geste === 'tous') return { ok: true, plans: plansPourLaListe(coordinateur.plans()) }
      const fil = guardString(conversationId, 'conversationId')
      if (geste === 'voir') return { ok: true, vue: coordinateur.planDuFil(fil) ?? null }
      // Les plans que le chef ne montre plus : leurs lots n'ont plus de ligne dans la
      // liste, le bloc du chef les liste à leur place.
      if (geste === 'anciens')
        return { ok: true, anciens: anciensPlansDuChef(coordinateur.plans(), fil) }
      // Ce que dit chaque lot : lu ici, où TOUS les fils sont en mémoire, tour en cours
      // compris ; l'écran n'a que ceux qu'il a déjà peints, et une piste de lot jamais ouvert restait
      // vide. Seules les phrases traversent le canal, pas les messages.
      if (geste === 'phrases') {
        const vue = coordinateur.planDuFil(fil)
        const phrases = vue
          ? phrasesDesLots(vue.plan, (lotFil) => os.conversations.get(lotFil)?.messages)
          : {}
        return { ok: true, phrases }
      }
      // Le bouton du workflow intelligent : le plan n'existe pas encore, il n'a pas d'id.
      if (geste === 'lancer-selection') return coordinateur.lancerSelection(fil, selection)
      const id = guardString(planId, 'planId')
      if (geste === 'accepter') return coordinateur.accepter(fil, id)
      if (geste === 'refuser') return coordinateur.refuser(fil, id)
      if (geste === 'arreter') return coordinateur.arreter(fil, id)
      if (geste === 'reprendre') return coordinateur.reprendre(fil, id)
      if (geste === 'relancer') {
        const rang = Number(lot)
        if (!Number.isInteger(rang) || rang < 1)
          return { ok: false, erreur: '« lot » : numéro du lot à relancer attendu (1, 2…).' }
        return coordinateur.relancer(fil, rang, id)
      }
      return { ok: false, erreur: `geste « ${geste} » inconnu.` }
    }
  )
  // Chat transparent : l'agent converse ET pilote l'app dans le même tour.
  // conversationId (optionnel) → le tour est PERSISTÉ dans la conversation (fil rechargeable).
  // Le corps du tour vit dans src/main/chat/run-pilot-chat.ts : il ne capturait rien d'autre que
  // les valeurs listees ici, qui lui sont desormais passees explicitement.
  /** Assigné plus bas, une fois `scheduledChatRuntime` construit (il ouvre le tour de reprise). */
  const relanceTachesDeFond: { relanceur?: RelanceurTachesDeFond } = {}
  /** Assigné plus bas, une fois `lancerDansConversation` câblé (plans de lots). */
  const suiviDesPlans: { coordinateur?: CoordinateurDesPlans } = {}
  /** Assigné plus bas, une fois `scheduledChatRuntime` construit (il ouvre le tour `/git`). */
  const suiviGitApresFil: { file?: FileGitApresFil } = {}
  const lancerTour = createRunPilotChat({
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
    watchdogEngine: () => ctx.watchdogEngine,
    relancerTachesDeFond: (conversationId, taches) => {
      const relanceur = relanceTachesDeFond.relanceur
      if (!relanceur) {
        console.warn('[taches de fond] relanceur pas encore prêt : relance perdue', conversationId)
        return
      }
      void relanceur
        .relancer(conversationId, taches)
        .catch((erreur) => console.warn('[taches de fond] relance en échec :', erreur))
    }
  })
  /**
   * SILENCE INTERDIT : un rangement qui ne pilote PAS le dossier de travail doit le DIRE.
   *
   * Un libelle de classement (« Clients/Acme ») ou un dossier disparu laissait le modele
   * travailler dans le depot d'Autowin sans un mot — l'utilisateur croyait etre dans son projet,
   * et c'est l'AGENTS.md d'Autowin qui etait lu. On ecrit donc l'avertissement dans le fil, UNE
   * seule fois par conversation et par motif : le repeter a chaque message serait du bruit.
   */
  const dossiersDejaAvertis = new Map<string, string>()
  const avertirDossierSansEffet = (
    conversationId: string,
    projectPath: string | undefined | null
  ): void => {
    const motif = diagnostiqueDossierConversation(projectPath, os.executionWorkspace)
    const texte = avertissementDossierConversation(motif, projectPath, os.executionWorkspace)
    if (!texte) return
    const empreinte = `${motif}|${projectPath?.trim() ?? ''}|${os.executionWorkspace}`
    if (dossiersDejaAvertis.get(conversationId) === empreinte) return
    dossiersDejaAvertis.set(conversationId, empreinte)
    try {
      os.conversations.append(conversationId, { role: 'assistant', content: texte })
      broadcast({ type: 'refresh', scope: 'chat', convId: conversationId })
    } catch {
      // Un avertissement manque ne doit JAMAIS empecher le tour de partir.
    }
  }

  /**
   * TOUS les tours passent ICI. L avertissement etait accroche au seul IPC de la frappe
   * utilisateur : un tour lance autrement (outil `chat_send`, tache planifiee, reprise) restait
   * muet alors que le dossier range ne pilotait rien. Mesure du 2026-09-08.
   */

  /**
   * BASCULE AUTOMATIQUE quand la demande NOMME un autre depot que celui du tour.
   *
   * L'oubli de ranger la conversation faisait partir le tour dans le depot d'Autowin alors que
   * l'utilisateur avait ecrit noir sur blanc le chemin d'un autre projet. On aligne AVANT que le
   * tour parte (donc avant que `dossierDuTour` soit lu pour le cwd du CLI), et on l'ECRIT dans le
   * fil : une bascule silencieuse serait pire que pas de bascule. Aucun redemarrage — le dossier
   * est resolu a chaque tour depuis la conversation (`dossierDeTravailDuTour`).
   */
  const alignerDossierSurLaDemande = (conversationId: string, messages: Message[]): void => {
    const dernier = [...messages].reverse().find((m) => m.role === 'user')?.content
    if (typeof dernier !== 'string') return
    const actif = dossierDuTour(conversationId)
    const cite = depotCiteDansLeMessage(dernier, actif)
    if (!cite) return
    try {
      os.conversations.rangerDansDossier(conversationId, cite)
      os.conversations.append(conversationId, {
        role: 'assistant',
        content:
          `📂 Ta demande nomme ${cite}, qui n'était pas le dossier de travail de cette ` +
          `conversation (${actif}). J'y bascule avant de traiter — c'est son AGENTS.md qui sera lu.`
      })
      broadcast({ type: 'refresh', scope: 'chat', convId: conversationId })
      broadcast({ type: 'refresh', scope: 'conversations' })
    } catch {
      // Une bascule ratee ne doit JAMAIS empecher le tour de partir : on reste sur le dossier d'avant.
    }
  }

  /**
   * RANGEMENT AUTOMATIQUE AU PREMIER MESSAGE, quand la demande NOMME un projet connu sans donner
   * son chemin.
   *
   * Cas mesure (2026-09-16) : conversation ouverte dans D:\BrainRotRoyale, premier
   * message sur les bureaux virtuels d'Autowin -> restee au mauvais endroit jusqu'a un deplacement
   * a la main. `alignerDossierSurLaDemande` ne couvre que le chemin ECRIT ; ici l'utilisateur
   * nomme seulement son projet. On ne choisit QUE parmi les dossiers deja utilises sur ce poste,
   * jamais sur une conversation deja rangee, et seulement au PREMIER message : au-dela, le fil a
   * un sujet etabli et un deplacement serait une surprise. Comme la bascule par chemin, la
   * decision est ECRITE dans le fil et un echec ne doit pas empecher le tour de partir.
   */
  const rangerSurLePremierMessage = async (
    conversationId: string,
    messages: Message[],
    finDuTour: Promise<unknown>
  ): Promise<void> => {
    const conversation = os.conversations.get(conversationId)
    if (!conversation) return
    const dernierUtilisateur = [...messages].reverse().find((m) => m.role === 'user')?.content
    const messagesConversation = conversation.messages.some((m) => m.role === 'user')
      ? conversation.messages
      : typeof dernierUtilisateur === 'string'
        ? [{ role: 'user', content: dernierUtilisateur }]
        : conversation.messages
    const actif = dossierDuTour(conversationId)
    const applique = await rangerConversationSurLePremierMessage({
      conversation: { projectPath: conversation.projectPath, messages: messagesConversation },
      categorie: conversation.categorie,
      dossiersConnus: [
        ...new Set(
          os.conversations
            .list()
            .map((c) => c.projectPath?.trim())
            .filter((chemin): chemin is string => Boolean(chemin))
        )
      ],
      // Le « dossier » de la barre laterale est souvent une CATEGORIE, pas un chemin
      // portait `categorie = "Autowin OS"` et aucun projectPath (mesure du 2026-09-16). Sans cette
      // liste, le cas fondateur ne pouvait pas etre range.
      categoriesConnues: [
        ...new Set(
          os.conversations
            .list()
            .map((c) => c.categorie?.trim())
            .filter((libelle): libelle is string => Boolean(libelle))
        )
      ],
      dossierActif: actif,
      // Un seul appel court, sur le PREMIER message : le nom du projet est souvent absent du
      // message, seul le SUJET le rattache. Une panne du modele rend null et le
      // tour part comme avant. Un choix dans une liste, sans outil : le modèle des PETITES TÂCHES
      // (`roles.ts`, Haiku par défaut). Il partait sur le modèle du chat, effort xhigh.
      demanderAuModele: async (systeme, charge) => {
        await os.waitUntilReady()
        const binding = os.roles.bindingDesPetitesTaches()
        const reponse = await os.registry
          .send(binding.provider, [{ role: 'user', content: charge }], {
            system: systeme,
            systemBlocks: [{ name: 'rangementPremierMessage', chars: systeme.length }],
            model: binding.model,
            reasoningEffort: binding.reasoningEffort,
            requestId: randomUUID()
          })
          .catch((error: unknown) => {
            signalerPanneAppelCourt('rangementPremierMessage', error)
            throw error
          })
        noterAppelCourt(os.cost, {
          appel: 'rangementPremierMessage',
          binding,
          res: reponse,
          issue: reponse.text ?? '',
          conversationId
        })
        return reponse.text
      },
      finDuTour,
      toujoursNonRangee: () => {
        const actuelle = os.conversations.get(conversationId)
        return Boolean(actuelle && !actuelle.projectPath?.trim() && !actuelle.categorie?.trim())
      },
      ranger: (chemin) => os.conversations.rangerDansDossier(conversationId, chemin),
      // Le tour est deja parti : l'annonce passe AU-DESSUS de sa reponse, vierge, en cours OU finie.
      // Un rangement differe l'ecrit APRES la fin du tour : en fin de fil, elle masquait la suite
      // proposee au champ pre-rempli et au mode auto (tour 2fefb532-3b2c-489c-9bc4-ef90c6ee4eba).
      annoncer: (message) =>
        os.conversations.append(conversationId, {
          role: 'assistant',
          content: message,
          avantLaReponseEnCours: true,
          auDessusDeLaReponseDuTour: true
        })
    })
    if (!applique) return
    broadcast({ type: 'refresh', scope: 'chat', convId: conversationId })
    broadcast({ type: 'refresh', scope: 'conversations' })
  }

  /*
   * FIL ASYNCHRONE (2026-10-21) : un tour fini SONNE quand aucune fenetre d'Autowin
   * n'est regardee (tour median 226 s, p90 ~17 min). Le clic ouvre le fil du tour ; la decision et
   * le texte vivent dans `notification-fin-de-tour.ts`, testes sans fenetre.
   */
  /*
   * POPUP « VERRE NACRE » (2026-10-22) : la fin d'un tour s'affiche dans une carte au
   * theme d'Autowin en bas a droite (`notification-popup.ts`), plus dans la bulle Windows, que
   * rien ne permet de styler. La bulle reste le SECOURS si la carte ne peut pas se creer.
   * Les cartes n'existent que tant qu'Autowin n'est pas regarde : une fenetre d'Autowin qui
   * reprend le focus les ferme toutes (elles couvriraient sinon le bas de la fenetre, la saisie).
   */
  const bulleWindows = (contenu: ContenuNotification): Notification => {
    if (!Notification.isSupported()) throw new Error('Notifications non supportees')
    return new Notification({
      title: contenu.title,
      body: contenu.body,
      // Les suites du tour en boutons (Windows et macOS depuis Electron 44) : la suite part entiere.
      ...(contenu.suites
        ? {
            actions: contenu.suites.map((suite) => ({
              type: 'button' as const,
              text: libelleDeBouton(suite)
            }))
          }
        : {})
    })
  }
  // La bulle sert DEUX fois de secours : carte impossible a creer (`fabriquer` jette, ci-dessous) et
  // page de carte non chargee, qui n'arrive qu'APRES `fabriquer` (la pile passe alors la main).
  const popupsDeFinDeTour = creerPopupsDeFinDeTour({
    secours: bulleWindows,
    zone: mascotteDuBureau.zoneDesCartes,
    page: mascotteDuBureau.decorerCarte
  })
  // Les cartes collees a la bille la suivent quand on la glisse (« snap ensemble »).
  mascotteDuBureau.quandElleBouge(popupsDeFinDeTour.replacer)
  app.on('browser-window-focus', (_evenement, fenetre) => {
    if (!popupsDeFinDeTour.estUneCarte(fenetre)) popupsDeFinDeTour.toutFermer()
  })
  const notifierFinDeTour = creerNotifieurDeFinDeTour({
    fabrique: (contenu) => {
      try {
        return popupsDeFinDeTour.fabriquer(contenu)
      } catch (erreur) {
        console.warn('[fin-de-tour] carte impossible, bulle Windows a la place —', String(erreur))
      }
      return bulleWindows(contenu)
    },
    // Une carte n'est pas une fenetre d'Autowin « regardee » (elle ne prend jamais le focus, mais
    // si Windows la lui donnait, la carte suivante ne doit pas se taire pour autant).
    fenetreRegardee: () => {
      const fenetre = BrowserWindow.getFocusedWindow()
      return fenetre !== null && !popupsDeFinDeTour.estUneCarte(fenetre)
    },
    // Les instances cachees (capture, tache planifiee) ne s'affichent jamais chez l'utilisateur.
    instanceDeTest: isolatedTestInstance || headlessTestInstance,
    titreDuFil: (id) => os.conversations.get(id)?.title,
    ouvrirFil: (id) => {
      showMainWindow()
      // L'interface bascule elle-meme sur le chat (`App.tsx`, `openTaskConversation`).
      broadcast({ type: 'open-conversation', convId: id })
    },
    // Sans ramener la fenetre : l'interface envoie la suite dans ce fil (`ChatView`, `App.tsx`).
    envoyerSuite: (id, suite) =>
      broadcast({ type: 'suite-depuis-notification', convId: id, texte: suite })
  })
  // La mascotte du bureau : jamais dans une instance cachée (capture, tâche planifiée),
  // pour la même raison que les cartes — elle s'afficherait sur l'écran de l'utilisateur.
  if (!isolatedTestInstance && !headlessTestInstance)
    mascotteDuBureau.demarrer(
      {
        toursEnCours: () => activeChatTurns.inFlightConversations().length,
        autowinRegardee: () => {
          const fenetre = BrowserWindow.getFocusedWindow()
          return (
            fenetre !== null &&
            // Une fenêtre cachée ou réduite ne se regarde pas, même si Electron la croit active.
            fenetre.isVisible() &&
            !fenetre.isMinimized() &&
            !popupsDeFinDeTour.estUneCarte(fenetre) &&
            !mascotteDuBureau.estLaMascotte(fenetre)
          )
        },
        ouvrirFil: (id) => {
          showMainWindow()
          broadcast({ type: 'open-conversation', convId: id })
        },
        ouvrirAutowin: () => showMainWindow(),
        titreDuFil: (id) => os.conversations.get(id)?.title
      },
      lireMascotteAffichee(),
      styleAffiche(lireStyleMascotte(), ctx.themeDeLaMascotte)
    )

  /*
   * LA REPONSE PART TOUT DE SUITE, LE RANGEMENT SE FAIT A COTE (2026-09-26).
   *
   * Avant, le tour ATTENDAIT l'appel au modele qui range la conversation (~5 s au premier message) :
   * attente sans un mot, et faux « Reponse interrompue avant la fin » pendant ce trou.
   * Le rangement n'est plus attendu. Il demarre APRES la bascule par chemin cite (qui
   * prime et le rend inutile), et un rangement qui deplacerait le dossier de travail attend
   * `finDuTour` : un tour ne change jamais de dossier en cours de route.
   * La demande compte toujours comme EN COURS des sa reception (voir trackPreparation).
   */
  const tourCompteDesReception: typeof lancerTour = (...args) =>
    activeChatTurns.trackPreparation(args[2], async () => {
      const conversationId = args[2]
      if (typeof conversationId !== 'string' || !conversationId.trim()) return lancerTour(...args)
      /*
       * DOSSIER RANGÉ DISPARU : LE TOUR EST REFUSÉ, il ne part jamais dans le dépôt partagé. Le fil
       * reçoit la raison (chemin perdu + geste pour en choisir un autre) AVANT toute autre étape ;
       * l'erreur levée est celle des autres refus d'avant-tour (`suivreLaFinDuTour` la relaie), donc
       * sans plantage : l'issue du tour passe simplement en échec.
       */
      refuserTourSiDossierDisparu(os.conversations.get(conversationId)?.projectPath, (raison) => {
        os.conversations.append(conversationId, { role: 'assistant', content: raison })
        broadcast({ type: 'refresh', scope: 'chat', convId: conversationId })
      })
      alignerDossierSurLaDemande(conversationId, args[1])
      avertirDossierSansEffet(conversationId, os.conversations.get(conversationId)?.projectPath)
      /*
       * LE MODÈLE DU FIL (2026-10-11) : une conversation peut porter son propre modèle.
       * Un modèle imposé par l'appelant (reprise d'un tour coupé, qui rejoue SON modèle d'origine)
       * prime : on ne remplit que la place vide. Un choix devenu indisponible est DIT dans le fil,
       * puis le tour part sur le modèle par défaut au lieu d'échouer au premier appel.
       */
      if (args[3] === undefined) {
        await agentModelsReady.catch(() => undefined)
        const modele = modeleDuTour(
          os.conversations.get(conversationId)?.modeleChoisi,
          ctx.agentModels
        )
        if (modele.kind === 'choisi') args[3] = modele.binding
        else if (modele.kind === 'indisponible') {
          // Même forme que la bascule de dossier (`alignerDossierSurLaDemande`) : avis écrit
          // dans le fil AVANT que le tour parte, puis rafraîchissement.
          os.conversations.append(conversationId, {
            role: 'assistant',
            content: `⚠️ Le modèle choisi pour cette conversation (${modele.voulu.provider} · ${modele.voulu.model ?? 'modèle par défaut'}) n'est plus disponible : ${modele.motif}. Ce tour part sur le modèle par défaut de l'application.`
          })
          broadcast({ type: 'refresh', scope: 'chat', convId: conversationId })
        }
      }
      let finirTour!: () => void
      const finDuTour = new Promise<void>((resolve) => {
        finirTour = resolve
      })
      void rangerSurLePremierMessage(conversationId, args[1], finDuTour).catch((error) => {
        // Un rangement rate ne doit JAMAIS toucher la reponse : il est seulement journalise.
        console.warn('[rangement] premier message non range :', error)
      })
      /*
       * ENCHAINEMENT AUTO DU CHAT : l'interrupteur ne publiait que les taches d'agent.
       * Photo de l'arbre AVANT le tour (~65 ms), publication APRES un tour reussi, sans faire
       * attendre la reponse. Un tour arrete ou en echec ne publie rien.
       */
      // L'amont AVANT le tour : ses commits publiés (par lui ou par l'enchaînement) ont leur bloc à
      // la fin. Jamais attendu ici : une lecture lente ne retient pas la réponse.
      const amontAuDebut = defaultGitRunner()
        .then((git) => lireAmont(git, dossierDuTour(conversationId)))
        .catch(() => undefined)
      const debutPublication = os.autoCloseEnabled()
        ? await photographierDebutDeTour(dossierDuTour(conversationId))
        : undefined
      /*
       * PHOTO DU CODE AU DEBUT DU TOUR (2026-10-21) : de quoi « revenir a ce tour » plus
       * tard, dans une copie separee (`photo-du-code.ts`, ~200 ms, jamais bloquante au-dela de 5 s).
       * Pas pour un tour REPRIS apres un redemarrage (`args[4]`) : il a commence avant, la photo
       * montrerait un etat a moitie ecrit sous le nom de son debut.
       */
      if (args[4] === undefined)
        await photographierLeCode({ dossier: dossierDuTour(conversationId), conversationId })
      try {
        const resultat = await lancerTour(...args)
        // Carte des besoins : jamais attendu, un échec n'atteint jamais la réponse.
        void journalDesBesoins
          .noterTour({
            conversationId,
            turnId: resultat.turnId,
            messages: os.conversations.get(conversationId)?.messages ?? [],
            dossier: dossierDuTour(conversationId),
            texteReponse: resultat.text
          })
          // RUN.md léger : même garantie, un échec n'atteint jamais la réponse.
          .then((evenement) =>
            evenement
              ? fichesDeDemande.noterTour({
                  evenement,
                  conversation: os.conversations.get(conversationId) as unknown as
                    ConversationPourLaCarte | undefined
                })
              : null
          )
          .then(async (ligne) => {
            if (!ligne) return
            /*
             * Une branche née PENDANT ce tour n'a rien trouvé à
             * rattacher : la fiche de cette demande n'existait pas encore. Elle la rejoint maintenant,
             * sans attendre le prochain démarrage.
             */
            const source = os.conversations.get(conversationId)
            if (source)
              for (const branche of os.conversations.list())
                if (branche.forkedFrom?.conversationId === conversationId)
                  await rattacherLaBranche(branche, source)
            mesureDesEcarts.planifier()
            // Le panneau RUN.md du fil relit ses fiches : la nouvelle s'y montre sans rouvrir le fil.
            broadcast({ type: 'refresh', scope: 'workflows' })
          })
          .catch((error) => console.warn('[besoins] tour non noté :', error))
        notifierFinDeTour(conversationId, {
          ...resultat,
          tourDeFond: args[5]?.background === true,
          // Les gardes de publication des suites lisent la demande du tour (boutons de la bulle).
          demandeDuTour: [...args[1]].reverse().find((m) => m.role === 'user')?.content
        })
        mascotteDuBureau.finDeTour(conversationId, {
          ...resultat,
          tourDeFond: args[5]?.background === true
        })
        let publicationDuTour: Promise<AutoCloseReport | undefined> = Promise.resolve(undefined)
        if (debutPublication && resultat.ok && !resultat.cancelled) {
          const demande = [...args[1]].reverse().find((m) => m.role === 'user')?.content ?? ''
          const finPublication = publicationsEnVol.debut(conversationId)
          const rapportDuTour = os.publishChatTurn({
            conversationId,
            turnId: resultat.turnId,
            request: demande,
            compteRendu: resultat.text,
            debut: debutPublication,
            // Un autre fil encore en cours n'a peut-être rien écrit au journal des fichiers.
            autresToursEnCours: () =>
              activeChatTurns
                .inFlightConversations()
                .filter((id) => id !== conversationId)
                .map((id) => dossierDuTour(id)),
            // Les tests des fichiers du tour sont rejoués AVANT de pousser : `b6d2a3fc`
            // a été poussé sans test et a laissé main rouge 20 h (mesuré le 2026-10-01).
            verifierAvantPublication: (repo, fichiers) =>
              bus.verifierAvantPublication(repo, fichiers),
            // Le TYPAGE de ce qui part, avant les tests : `9d6bb850` a publié un fichier
            // sans son appelant, et main ne compilait plus alors que les tests de l'arbre étaient verts.
            typerAvantPublication: (repo, fichiers) =>
              typerCeQuiPart({ repo, fichiers, typer: typeurTsc(process.execPath) })
          })
          publicationDuTour = rapportDuTour.catch(() => undefined)
          void rapportDuTour
            // Ce que l'enchaînement n'a pas pu rendre à son fil : `/git` s'en charge, si
            // l'utilisateur l'a accordé (voir git-apres-fil.ts).
            .then((rapport) => {
              const decision = decisionGitApresFil({
                accord: os.gitApresFilActif(),
                dossierAutowin: estDepotAutowin(dossierDuTour(conversationId)),
                deFond: args[5]?.background === true,
                demande,
                demandesDuFil: (os.conversations.get(conversationId)?.messages ?? [])
                  .filter((message) => message.role === 'user')
                  .map((message) => String(message.content)),
                compteRendu: resultat.text ?? '',
                rapport
              })
              // Un lot de plan : sa passe tourne dans le CHEF, à la fin du plan.
              if (decision.lancer)
                suiviGitApresFil.file?.ajouter(
                  filDeLaPasse(
                    conversationId,
                    suiviDesPlans.coordinateur?.planDuFil(conversationId)
                  ),
                  decision.fichiers,
                  conversationId
                )
            })
            .catch((error) => console.warn('[enchainement chat] publication impossible :', error))
            .finally(finPublication)
        }
        // Le bloc git des commits que CE tour a publiés, par lui-même ou par l'enchaînement auto,
        // une fois l'enchaînement fini (Ces publications ne posaient aucun bloc).
        void Promise.all([amontAuDebut, publicationDuTour])
          .then(async ([depuis, rapport]) => {
            if (!depuis) return
            const dossier = dossierDuTour(conversationId)
            const commits = await commitsPublies(await defaultGitRunner(), dossier, depuis, [
              conversationId
            ])
            const messages = os.conversations.get(conversationId)?.messages ?? []
            const bloc = blocDuTour({
              commits,
              actionsLog:
                [...messages].reverse().find((m) => m.turnId === resultat.turnId)?.actionsLog ?? [],
              rapport,
              contenusDuFil: messages.map((m) => String(m.content ?? ''))
            })
            if (!bloc) return
            os.conversations.append(conversationId, { role: 'assistant', content: bloc })
            broadcast({ type: 'refresh', scope: 'chat', convId: conversationId })
            broadcast({ type: 'refresh', scope: 'conversations' })
          })
          .catch((error) => console.warn('[bloc git du tour] non posé :', error))
        return resultat
      } finally {
        finirTour()
      }
    })
  /*
   * LA FIN DU TOUR ANNONCÉE AUTOUR DU COMPTAGE, PAS DEDANS (2026-10-26).
   * Le coordinateur des plans de lots réveille un chef inactif à la fin de chaque tour. Annoncée
   * depuis `createRunPilotChat`, la fin partait de l'intérieur de `trackPreparation` : le chef était
   * encore compté « en cours » et son réveil était perdu (reproduit par le juge avec le vrai registre).
   * fix-ok: annonce de fin émise avant la sortie de `trackPreparation` (`isInFlight` vrai) — mesuré.
   * Garde : `plans-de-lots.fin-de-tour.test.ts` (vrai `ActiveChatTurns`, et cette composition).
   */
  const observateurDesPlans: ObservateurFinDeTour = (conversationId, issue) => {
    suiviDesPlans.coordinateur?.surFinDeTour(conversationId, issue)
    // Ici et pas sur `os.onMurDeQuota` : ce crochet n'a qu'un écouteur, celui du réveil des runs. Un
    // tour en échec relit tout : seul un mur y trouve une heure, et rien n'est prévu sinon.
    if (!issue.ok && repriseDesFilsActive) suiviDesFilsCoupes.reprise?.replanifier()
    // LE BOARD RECOPIÉ À CHAQUE FIN DE TOUR (« que la copie du Board vers la GED se
    // mette à jour même quand le Board n'est pas affiché ») : sans attendre, ni calcul sans dossier
    // choisi ; une rafale de fins de tour ne calcule qu'une fois par délai (`board-dossier.ts`).
    boardDuPoste.recopierLeBoard()
  }
  const runPilotChat = suivreLaFinDuTour(tourCompteDesReception, observateurDesPlans)
  /** Rendu au démarrage : les runs repris y préviennent les plans de lots. */
  const suiviDuPlan: SuiviDuPlan = {
    agentRepris: (fil, tour) => suiviDesPlans.coordinateur?.agentRepris(fil, tour),
    finDuRun: (fil, issue) => annoncerLaFinDuTour(observateurDesPlans, fil, issue)
  }
  /**
   * Reprend les appels de chat dont le CLI a survécu au main. La réservation (`setRecovered`) fait
   * refuser un nouveau message par `os:pilotChat` et répondre « actif » à la sonde de l'écran,
   * qui adopte alors le tour (`reconcilierTourNonClos`) pendant qu'on attend la preuve `.exit.json`.
   * Aucun timeout ne transforme une ignorance en relance : seule une sortie certifiée est traitée.
   */
  const reprendreAppelChat = (call: RecoverableChatProviderCall): void => {
    const recoveryController = new AbortController()
    let resolveRecovery!: () => void
    const recoveryCompletion = new Promise<void>((resolve) => {
      resolveRecovery = resolve
    })
    activeChatTurns.setRecovered(call.conversationId, recoveryController, recoveryCompletion)
    // Le plan de lots suit cet agent. Les appels reconnus au chargement passent ici avant
    // que le coordinateur existe : il lira alors cette réservation lui-même (`tourActif`).
    suiviDesPlans.coordinateur?.agentRepris(call.conversationId, call.turnId)
    setImmediate(() => {
      void (async () => {
        // L'issue, annoncée aux plans de lots APRÈS le relâchement de la réservation.
        let issueDeReprise: IssueDuTour | undefined
        try {
          // Pendant l'attente, le fil voit ce que fait le CLI : actions et étapes (
          // est resté 20 min sans une ligne après le redémarrage de 20:01). Arrêté avant la suite.
          const relais = relayerAppelChatRepris(call, {
            racineJournaux: turnJournalRoot,
            actionsEnregistrees: () =>
              [...(os.conversations.get(call.conversationId)?.messages ?? [])]
                .reverse()
                .find((message) => message.role === 'assistant' && message.turnId === call.turnId)
                ?.actionsLog,
            enregistrer: (lines) => {
              if (os.conversations.get(call.conversationId))
                os.conversations.applyTurnEvent(call.conversationId, call.turnId, {
                  kind: 'actions-log',
                  lines
                })
            },
            versLeFil: (event) =>
              emitToLiveWindows(BrowserWindow.getAllWindows(), 'pilot:event', {
                ...event,
                conversationId: call.conversationId,
                turnId: call.turnId
              })
          })
          const terminal = await waitForRecoverableChatProviderExit(call.journalPath, {
            signal: recoveryController.signal,
            fallbackActivityAt: call.updatedAt
          }).finally(() => relais.arreter())

          const closeWithoutRecovery = (event: ChatTurnEvent): void => {
            issueDeReprise = issueDeCloture(event)
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
          if (isTurnFinished(events)) {
            const clos = [...events].reverse().find((e) => isTurnFinished([e]))
            issueDeReprise = issueDeCloture(clos ?? { kind: 'done' })
            return
          }
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
            issueDeReprise = { ok: false, erreur: 'conversation ou tour d’origine introuvable' }
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
          // Le modèle du chat repart avec le chat ; seul un réglage réellement imposé au tour
          // d'origine est rejoué sur ses commandes. L'imposer à tort figeait l'effort des runs
          // lancés par ce tour (`reglagesDeReprise`).
          const reglages = reglagesDeReprise(call, assistant.runtime)
          // Rejoué SANS l'annonce de `runPilotChat` : elle partirait réservation encore tenue.
          const rejoue = await tourCompteDesReception(
            undefined,
            messages,
            call.conversationId,
            reglages.bindingOverride,
            {
              turnId: call.turnId,
              call,
              runtimeBinding: reglages.runtimeBinding,
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
          issueDeReprise = issueDuResultat(rejoue)
        } catch (error) {
          issueDeReprise = {
            ok: false,
            erreur: error instanceof Error ? error.message : String(error)
          }
          console.warn('[resume-chat-provider] reprise impossible :', call.turnId, error)
        } finally {
          activeChatTurns.delete(call.conversationId, recoveryController)
          /*
           * ORIENTATIONS TAPÉES PENDANT LA REPRISE : rendues à l'écran, jamais perdues.
           * L'écran voit désormais un tour repris comme occupé, donc ce qu'on tape part en
           * orientation (`os:pilotChat:inject`). Quand la reprise se termine SANS rejouer de tour
           * (arrêt, CLI en échec, journal muet), aucun `finally` de `runPilotChat` ne les rend :
           * on le fait ici, avec le même signal. Après un rejeu, la file est déjà vide.
           */
          const orphelines = drainPendingDirectives(call.conversationId)
          if (orphelines.length) {
            broadcast({
              type: 'directives-orphelines',
              convId: call.conversationId,
              textes: orphelines
            })
          }
          resolveRecovery()
          // Après `delete` : le fil ne compte plus « occupé », un chef repris peut être réveillé.
          if (issueDeReprise)
            annoncerLaFinDuTour(observateurDesPlans, call.conversationId, {
              ...issueDeReprise,
              repris: true
            })
        }
      })()
    })
  }
  // Les appels reconnus au chargement (message resté « en cours ») réservent leur conversation
  // TOUT DE SUITE, avant la fenêtre : c'est eux que l'utilisateur voit tourner.
  for (const call of appelsChatReconnusAuChargement.values()) reprendreAppelChat(call)
  // Le reste — tour inachevé dont le message n'était pas « en cours » sur disque — vient de
  // l'inventaire NON bloquant. La fenêtre est ouverte entre-temps : un tour lancé depuis doit
  // garder la main, et son propre journal (touché après le chargement) n'est pas un survivant.
  void listRecoverableChatProviderCallsAsync(turnJournalRoot).then(
    (calls) => {
      for (const call of calls) {
        if (appelsChatReconnusAuChargement.has(call.turnId)) continue
        if (call.updatedAt >= debutInventaireAppelsChat) continue
        if (activeChatTurns.get(call.conversationId)) continue
        reprendreAppelChat(call)
      }
    },
    (erreur) => console.warn('[resume-chat-provider] inventaire impossible :', erreur)
  )

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

  /**
   * LE BALAYAGE DE RETENTION — il SIGNALE, il ne supprime RIEN. Volontairement.
   *
   * Le stock de sauvegardes n'avait aucune politique : 89 branches `autowin/*` accumulees en 22
   * jours et 208 refs `refs/autowin/*` invisibles de `git branch`, releve du 2026-09-08. Le tri
   * dependait d'une journee entiere passee a la main.
   *
   * POURQUOI AUCUNE SUPPRESSION N'EST BRANCHEE ICI, et c'est un choix, pas un oubli : un balayage
   * automatique a DEJA fait des degats sur ce depot. Le 2026-08-24, la reprise automatique a tourne
   * sans plafond et RECREE 682 Mo en rejouant vingt-et-une copies impubliables. On observe donc un
   * passage reel avant d'autoriser le moindre geste — le plan est journalise, l'humain decide.
   *
   * Meme minuteur horaire que le balayage voisin : le stock bouge a l'echelle du jour, pas de la
   * minute, et un second minuteur n'ajouterait qu'un reveil.
   */
  const passeDeRetention = (): void => {
    void pendantOperation('timer:balayage:retention', async () => {
      const worktrees = os.worktreeManager
      if (!worktrees) return
      // Le rejet d'un recensement trop long est GERE dans `jouerPasseDeRetention` (crash.log du
      // 2026-10-28 : « unhandledRejection », bulletin de maintenance du 30/10).
      await jouerPasseDeRetention({
        recenser: () => {
          const consignes = chargerShaConsignes(app.getAppPath())
          /*
           * ASYNCHRONE, et ce n'est pas un detail de style. La version synchrone lance un `git cherry`
           * par ref de secours -- 97 ce 2026-09-08 -- en `execFileSync` : 11 720 ms de fenetre figee
           * pendant la construction de la fenetre, journalises dans `gels.jsonl`. Meme prix, meme
           * verdict, mais paye sans tenir la boucle d'evenements.
           */
          return worktrees.recenserRetentionAsync((sha) => consignes.has(sha))
        },
        poserRapport: (rapport) => os.poserRapportRetention(rapport)
      })
    })
  }
  /*
   * UNE PASSE AU DEMARRAGE, puis toutes les heures. Un minuteur seul ne dit RIEN avant sa premiere
   * echeance : le cas reel est « l'app demarre et le stock dort deja » -- celui qui a laisse
   * quatorze travaux sur des branches de secours (2026-08-24). Un rapport qu'il faut attendre une
   * heure est un rapport qu'on ne lit pas.
   */
  passeDeRetention()
  const balayageRetentionTimer = setInterval(passeDeRetention, 60 * 60 * 1_000)
  balayageRetentionTimer.unref()

  ipcMain.handle('os:pilotChat', (event, messages, conversationId) => {
    assertTrustedRendererSender(event, 'PilotChat')
    /*
     * UN SEUL AGENT PAR FIL, même après un redémarrage (2026-10-11) : un tour repris
     * attend encore son CLI survivant. En lancer un second ouvrirait un deuxième `claude --resume`
     * sur la même session. L'écran route déjà la saisie en orientation pendant ce temps ; ce refus
     * est le filet si un envoi passe quand même (écran pas encore réconcilié).
     */
    if (typeof conversationId === 'string' && activeChatTurns.isRecovering(conversationId)) {
      throw new Error(
        'Un tour repris après le redémarrage tourne encore dans cette conversation : attends sa fin ou arrête-le avant d’envoyer un nouveau message.'
      )
    }
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
    // « This computer » : même dossier que le choix du dossier de travail du Chat.
    dossierPersonnel: () => canonicalProjectPath(homedir()) ?? homedir(),
    bindConversation: (taskId, conversationId) => {
      scheduledTasks.bindConversation(taskId, conversationId)
    },
    alignerSurDossierGlobal: (conversationId) => {
      const global = os.executionWorkspace
      if (os.conversations.get(conversationId)?.projectPath === global) return
      if (os.conversations.rangerDansDossier(conversationId, global))
        broadcast({ type: 'refresh', scope: 'conversations' })
    },
    isConversationBusy: (conversationId) => Boolean(activeChatTurns.get(conversationId)),
    interruptAndWait: (conversationId, reason) =>
      activeChatTurns.abortAndWait(conversationId, reason),
    waitForInteractiveIdle: (timeoutMs) => activeChatTurns.waitForIdle(timeoutMs),
    releaseInteractiveIdle: () => activeChatTurns.releaseIdleLease(),
    replyToMail: async (itemId, body) =>
      ctx.mailWatchdogReplier
        ? ctx.mailWatchdogReplier(itemId, body)
        : { ok: false, erreur: 'passerelle Outlook non initialisée' },
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
  // CABLAGE TARDIF de `chat_send` vers une conversation NOMMEE. La capacite existait deja
  // (`runPrompt`, utilisee par les taches planifiees) mais n'etait branchee sur aucune commande
  // du chat : un agent qui creait un fil ne pouvait rien y lancer (Un fil vide, 2026-09-05).
  bus.conversationExiste = (conversationId) => scheduledChatRuntime.hasConversation(conversationId)
  // MEME autorite que la sonde `os:pilotChat:active` du renderer : l'agent du chat doit pouvoir
  // repondre « est-ce que ca tourne encore ? » sans deviner en lisant des journaux de fin de tour.
  bus.tourDeChatActif = (conversationId) => activeChatTurns.isInFlight(conversationId)
  // Rend la main des que le tour DEMARRE dans le fil cible, pas a sa fin : sinon un agent qui ouvre
  // N fils les lance un par un (2026-10-02). Voir chat/lancer-sans-attendre.ts.
  bus.lancerDansConversation = (conversationId, prompt, binding) =>
    lancerSansAttendre(
      async () => {
        // HORS du devis du tour appelant : sinon le tour cible hérite de ses compteurs, dont l'appel
        // est déjà actif, et il est annulé sur « Budget de concurrence atteint (1) » alors que
        // chat_send a déjà répondu « envoyé » (2026-10-05). Même isolement que
        // le réveil des watchdogs plus bas.
        const resultat = await os.executionSupervisor.runOutsideCurrent(() =>
          scheduledChatRuntime.runPrompt(conversationId, prompt, binding)
        )
        return {
          ok: resultat.ok,
          ...(resultat.turnId ? { turnId: resultat.turnId } : {}),
          ...(resultat.error ? { error: resultat.error } : {})
        }
      },
      () => activeChatTurns.waitForActive(conversationId, 120_000),
      (erreur) =>
        console.warn(`[chat_send] tour de ${conversationId} en echec apres son envoi :`, erreur)
    )
  /*
   * SUPER CONVERSATION : le coordinateur des plans de lots. Un fil par lot, ouvert dans
   * le dossier du chef ; lancé par la MÊME capacité que `chat_send` (hors du devis du tour appelant) ;
   * comptes rendus par le journal des messages entre fils, l'expéditeur étant le fil du lot.
   */
  const coordinateurDesPlans = new CoordinateurDesPlans({
    creerFil: (chef, titre) => {
      const source = os.conversations.get(chef)
      return os.conversations.create({
        title: titre,
        provider: source?.provider ?? 'claude',
        ...(source?.projectPath ? { projectPath: source.projectPath } : {})
      }).id
    },
    // Le modèle d'un lot passe par la même capacité que `chat_send` (« model »).
    lancer: (fil, prompt, modele) =>
      bus.lancerDansConversation
        ? modele
          ? bus.lancerDansConversation(fil, prompt, {
              provider: os.conversations.get(fil)?.provider ?? 'claude',
              model: modele
            })
          : bus.lancerDansConversation(fil, prompt)
        : Promise.resolve({ ok: false, error: 'lancement dans un fil non câblé' }),
    tourActif: (fil) => activeChatTurns.isInFlight(fil),
    existe: (fil) => Boolean(os.conversations.get(fil)),
    ecrire: (de, a, texte) => bus.ecrireDepuisLeFil(de, a, texte),
    signaler: () => {
      broadcast({ type: 'refresh', scope: 'plans-de-lots' })
      broadcast({ type: 'refresh', scope: 'conversations' })
    }
  })
  bus.plansDeLots = coordinateurDesPlans
  suiviDesPlans.coordinateur = coordinateurDesPlans
  // POINT D'ENTRÉE LOCAL : un script du poste crée un fil, y lance un tour et le relit,
  // par le même protocole que les outils du chat. Ouvert ICI, une fois `chat_send` et la sonde
  // `tourDeChatActif` câblés. Le jeton n'est jamais journalisé : il ne vit que dans le fichier.
  // fix-ok: pas une correction répétée : les 4 éditions de ce fichier sont les 4 points
  // de branchement distincts d'un même ajout (import, variable, démarrage ici, arrêt à before-quit).
  void demarrerPointEntreeLocal({
    dossierDonnees: ensureAutowinAppData(appDataRoot),
    catalogue: () => bus.catalog(),
    exec: (nom, args) => bus.exec(nom, args)
  })
    .then((point) => {
      ctx.pointEntreeLocal = point
      console.info(`[point d'entree local] 127.0.0.1:${point.port} — adresse dans ${point.fichier}`)
    })
    .catch((erreur) => console.warn("[point d'entree local] non demarre :", erreur))
  /*
   * TACHES DE FOND COUPEES EN FIN DE TOUR : relancees hors du tour, puis UN tour
   * de reprise rend leur resultat dans la meme conversation. Hors du devis du tour appelant, comme
   * `chat_send` ci-dessus. Les lots restes sur disque (app fermee pendant la commande) reprennent ici.
   */
  const relanceurTachesDeFond = creerRelanceurSurDisque({
    dossier: join(app.getPath('userData'), 'taches-de-fond'),
    conversationOccupee: (conversationId) => activeChatTurns.isInFlight(conversationId),
    envoyerTour: async (conversationId, prompt) => {
      const resultat = await os.executionSupervisor.runOutsideCurrent(() =>
        scheduledChatRuntime.runPrompt(conversationId, prompt)
      )
      if (!resultat.ok)
        console.warn(
          `[taches de fond] tour de reprise en echec dans ${conversationId} :`,
          resultat.error
        )
    }
  })
  relanceTachesDeFond.relanceur = relanceurTachesDeFond
  /*
   * « PUBLIER LES FILS FINIS » : une passe à la fois. AUCUN tour ni
   * message dans le fil : l'app vérifie, commite et pousse elle-même, et seul le titre du commit part
   * au petit modèle d'Agent Studio. Le fil ne reçoit que le bloc git (ou la note de ce qui reste à trier).
   */
  const redigerUnCommit = redacteurDeCommit(os)
  const travauxTentes = travauxTentesSurDisque(
    join(autowinAppDataRoot(), 'git-apres-fil-travaux-tentes.json')
  )
  suiviGitApresFil.file = new FileGitApresFil({
    publier: async (fil, passe) => {
      const repo = dossierDuTour(fil)
      const runGit = await defaultGitRunner()
      return publierSansTour(
        {
          repo,
          runGit,
          proprietaires: (chemins) =>
            lireProprietairesDeFichiers({ workspace: repo, chemins, conversationId: fil }),
          typer: (fichiers) =>
            typerCeQuiPart({ repo, fichiers, typer: typeurTsc(process.execPath) }),
          verifier: (fichiers) =>
            verifierCeQuiPart(repo, fichiers, (racine, liste) =>
              bus.verifierAvantPublication(racine, liste)
            ),
          rediger: (charge) => redigerUnCommit(charge, fil),
          // Un tour d'un autre fil du dépôt en cours : ce qu'il écrit n'a pas encore d'auteur.
          autreTourEnCours: () =>
            activeChatTurns
              .inFlightConversations()
              .some((id) => !passe.fils.includes(id) && partageLeDepot(repo, dossierDuTour(id))),
          commiter: (message, fichiers, runGitTrace) =>
            autoCloseRun({
              repo,
              branch: autoCloseBranch(`${fil}-git`),
              message,
              paths: fichiers,
              runGit: runGitTrace,
              direct: true
            })
        },
        { fil, fichiers: passe.fichiers, fils: passe.fils, travaux: passe.travaux.length }
      )
    },
    // Le chef d'un plan qui tourne encore attend : ses lots écrivent toujours.
    filOccupe: (fil) =>
      activeChatTurns.isInFlight(fil) ||
      planTourneEncore(suiviDesPlans.coordinateur?.planDuFil(fil)),
    lireAmont: async (fil) => lireAmont(await defaultGitRunner(), dossierDuTour(fil)),
    commitsDepuis: async (fil, depuis, fils) =>
      commitsPublies(await defaultGitRunner(), dossierDuTour(fil), depuis, fils),
    annoncer: (fil, contenu) => {
      os.conversations.append(fil, { role: 'assistant', content: contenu })
      broadcast({ type: 'refresh', scope: 'chat', convId: fil })
      broadcast({ type: 'refresh', scope: 'conversations' })
    },
    noterTravauxTentes: (agentIds) => travauxTentes.noter(agentIds),
    journal: (message, detail) => console.warn('[git apres fil]', message, detail ?? '')
  })
  /*
   * LES TRAVAUX D'AGENTS RESTÉS HORS DE LA BRANCHE — le bandeau « 1 travail terminé n'a
   * jamais été publié ». Relus à chaque fin de run et une fois après le démarrage, rangés par fil qui
   * a lancé le run, puis confiés à la même file : un /git par fil, après son calme. Même accord que
   * le reste de « Publication auto », mêmes refus (autre dépôt, publication interdite dans le fil).
   */
  const balayerLesTravauxDAgents = async (): Promise<void> => {
    if (!os.autoCloseEnabled() || !os.gitApresFilActif()) return
    const travaux = await os.travauxNonPubliesAsync()
    if (!travaux.length) return
    const filDuRun = new Map(
      os.getWorktreeActivity().map((agent) => [agent.agentId, agent.conversationId])
    )
    const parFil = travauxParFil({
      travaux: travaux.map((travail) => ({
        ...travail,
        conversationId: filDuRun.get(travail.agentId)
      })),
      dejaTentes: travauxTentes.lire(),
      publiable: (fil) =>
        Boolean(os.conversations.get(fil)) &&
        estDepotAutowin(dossierDuTour(fil)) &&
        !publicationInterditeDans(
          (os.conversations.get(fil)?.messages ?? [])
            .filter((message) => message.role === 'user')
            .map((message) => String(message.content))
        )
    })
    for (const [fil, liste] of parFil)
      suiviGitApresFil.file?.ajouterTravaux(
        filDeLaPasse(fil, suiviDesPlans.coordinateur?.planDuFil(fil)),
        liste,
        fil
      )
  }
  const balayerSansBruit = (): void =>
    void balayerLesTravauxDAgents().catch((erreur) =>
      console.warn('[git apres fil] travaux d’agents illisibles :', erreur)
    )
  os.onFinDeRun(balayerSansBruit)
  // Une minute après le démarrage : le recensement git ne s'ajoute pas au coût du lancement.
  setTimeout(balayerSansBruit, 60_000).unref?.()
  void relanceurTachesDeFond
    .reprendreAuDemarrage()
    .catch((erreur) => console.warn('[taches de fond] reprise au demarrage impossible :', erreur))
  /*
   * LES FILS COUPÉS PAR LE QUOTA : une reprise automatique, à l'heure annoncée. File à
   * elle : elle attend la fin de chaque tour, et un long tour ne doit pas retenir le réveil d'un run.
   * Historique complet : sans session à reprendre, `runPrompt` ne laisserait à l'agent qu'une phrase.
   * fix-ok: mesuré sur 30 jours : 21 tours coupés, 16 suivis d'un « reprend » tapé à la main.
   */
  const fileDesFilsCoupes = new StartupResumeQueue()
  suiviDesFilsCoupes.reprise = creerRepriseDesFils({
    lireFils: () => os.conversations.list(),
    filOccupe: (id) => activeChatTurns.isInFlight(id),
    filDansUnPlan: (id) => Boolean(suiviDesPlans.coordinateur?.planDuFil(id)),
    filsAvecRunAReprendre: () =>
      new Set(os.resumableOrchestrations().flatMap((run) => run.conversationId ?? [])),
    mettreEnFile: (tache) => fileDesFilsCoupes.enqueue(tache),
    lancerTour: (id, messages) =>
      os.executionSupervisor.runOutsideCurrent(() => runPilotChat(undefined, messages, id)),
    journal: (message) => console.warn('[reprise apres quota]', message)
  })
  if (repriseDesFilsActive) suiviDesFilsCoupes.reprise.replanifier()
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
  ctx.scheduledTaskScheduler = new TaskScheduler(scheduledTasks, dispatcherVeille, relay)
  // `task_create` de l'agent : MÊME chemin que le bouton « Créer » du Task Manager.
  const schedulerPourAgent = ctx.scheduledTaskScheduler
  // Les notes lues par brain_read passent par le petit modèle avant le fil.
  bus.condenseurBrain = condenseurDuBrain(os)
  bus.taskManager = {
    create: (input) => scheduledTasks.create(input),
    list: () => scheduledTasks.listTasks(),
    // `task_update` / `task_delete` (2026-10-31) : les boutons de l'écran, pas un second chemin.
    get: (id) => scheduledTasks.getTask(id),
    update: (id, input) => scheduledTasks.update(id, input),
    remove: (id) => scheduledTasks.remove(id),
    refresh: () => schedulerPourAgent.refresh(),
    onChanged: () => broadcast({ type: 'refresh', scope: 'task-manager' })
  }
  // Le moteur de réveil OBSERVE et délègue à ce même scheduler : il n'y a qu'un chemin d'exécution.
  ctx.watchdogEngine = new WatchdogEngine(
    () => scheduledTasks.listTasks(),
    {
      runWatchdog: async (taskId, signal, onLateMutationClaims, onLateUsageSettlement) => {
        const result = await os.executionSupervisor.runOutsideCurrent(
          async () =>
            (await ctx.scheduledTaskScheduler?.runWatchdog(
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

  os.onRecoveredCausalMutationClaims((claims) => {
    ctx.watchdogEngine?.rememberRecoveredMutationClaims(claims)
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
      void ctx.watchdogEngine?.notifyAppEvent(
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
    genererInterne: genererCandidatsInternesVisibles,
    // Le dépôt que ce même scout lit : ses ancrages `src/…:N` y sont relatifs. Chaque service du
    // stock re-vérifie que la ligne citée d'une correction y est encore, sinon elle sort « périmée ».
    racineDepot: os.executionWorkspace
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
  /*
   * UN RUN SE MET EN PAUSE POUR TE DEMANDER (2026-10-25) : objection d'étendue répétée en
   * mode jusqu'au vert (`gates/etendue-repetee.ts`). Même fenêtre de question que `askModelQuestion`,
   * sur n'importe quelle fenêtre vivante ; aucune fenêtre = aucune réponse, et le run s'arrête au lieu
   * de relancer une réparation.
   */
  os.questionALUtilisateur = (question, contexte, signal) => {
    const hote = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
    if (!hote) return Promise.resolve('')
    return askModelQuestion(hote.webContents, 'loop', question, contexte, signal)
  }

  /**
   * La passerelle Outlook LOCALE, pour les widgets Interlocuteurs et Agenda de la vue Accueil.
   *
   * Lecture seule du profil Outlook de la machine, par automation COM. Rien ne sort du poste : c'est
   * la raison pour laquelle Microsoft Graph a ete ecarte. Elle est construite ICI, une fois, parce
   * qu'elle porte un cache — en fabriquer une par appel relancerait un dialogue COM a chaque
   * rafraichissement de la page d'accueil.
   */
  // Instance de test CACHÉE : aucun Outlook. Lu par COM depuis un bureau caché, Outlook démarre DANS
  // ce bureau, invisible, et le garde vivant après la capture (2026-10-17).
  const outlookGateway = new OutlookLocalGateway({
    appRoot: app.getAppPath(),
    // Ouvre une piece jointe RECUE, une fois copiee par Outlook. `shell.openPath` rend
    // '' en cas de succes et la cause sinon : la passerelle affiche cette cause telle quelle.
    ouvreurFichier: (chemin) => shell.openPath(chemin),
    ...(headlessTestInstance ? { horsService: OUTLOOK_HORS_INSTANCE_CACHEE } : {})
  })
  // fix-ok: 3 edits mesures - (1) remplacement Python a casse les antislashs, (2) bloc finally repris, (3) format de mes seules lignes (index.ts deja rouge au format avant moi).
  // Teams (Microsoft Graph) : configuration PERSONNELLE, lue dans l'environnement ou HKCU comme
  // AUTOWIN_WATCHDOG_MAILS. Sans AUTOWIN_TEAMS_CLIENT_ID, aucun appel reseau n'est fait.
  const variablePerso = (name: string): string | undefined => {
    const direct = process.env[name]?.trim()
    if (direct) return direct
    if (process.platform !== 'win32') return undefined
    try {
      const match = new RegExp(`${name}\\s+REG_\\w+\\s+(\\S+)\\s*$`, 'm').exec(
        execFileSync('reg', ['query', 'HKCU\\Environment', '/v', name], {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 3_000
        })
      )
      return match?.[1]
    } catch {
      return undefined
    }
  }
  const teamsClientId = variablePerso('AUTOWIN_TEAMS_CLIENT_ID')
  const teamsVaultPath = join(app.getPath('userData'), 'teams-graph-token.bin')
  // Le jeton de renouvellement est un secret : chiffre par le systeme, jamais en clair.
  const chargerJetonTeams = (): string | undefined => {
    try {
      if (!existsSync(teamsVaultPath) || !safeStorage.isEncryptionAvailable()) return undefined
      return safeStorage.decryptString(readFileSync(teamsVaultPath))
    } catch {
      return undefined
    }
  }
  // Graph seulement s'il est deja CONNECTE ; sinon lecture locale (sourceTeams).
  const modeTeams = sourceTeams({
    clientId: teamsClientId,
    jetonGraph: chargerJetonTeams() !== undefined,
    windows: process.platform === 'win32'
  })
  console.log(`[watchdog] Teams : ${modeTeams ?? 'désactivé'}`)
  // Seul temoin lisible apres un redemarrage : la console du processus principal est jetee.
  const journalTeams = creerJournalWatchdog(cheminJournalWatchdogTeams(appDataRoot))
  // Une ligne « actif » par heure, écrite par la boucle de lecture elle-même : plus d'une heure sans
  // elle = surveillance arrêtée.
  const battementTeams = creerBattementWatchdog(journalTeams)
  journalTeams('source', {
    mode: modeTeams ?? 'désactivé',
    identifiantGraph: teamsClientId ? 'présent' : 'absent',
    jetonGraph: chargerJetonTeams() !== undefined ? 'présent' : 'absent'
  })
  const teamsClient =
    modeTeams === 'graph' && teamsClientId
      ? new TeamsGraphClient(
          {
            clientId: teamsClientId,
            tenantId: variablePerso('AUTOWIN_TEAMS_TENANT_ID') ?? 'organizations'
          },
          {
            load: chargerJetonTeams,
            save: (token) => {
              if (safeStorage.isEncryptionAvailable())
                writeFileSync(teamsVaultPath, safeStorage.encryptString(token))
            }
          },
          (prompt) => {
            console.log(
              `[watchdog] connexion Teams demandée : code ${prompt.userCode} sur ${prompt.verificationUri}`
            )
            // Plus de fenetre (demande utilisateur, 2026-09-25) : le code reste dans le journal.
          }
        )
      : undefined
  // Sans connexion Microsoft (2026-09-25) : lecture du stockage local du client Teams
  // deja connecte, reponse en pilotant sa fenetre, repli par mail si ce pilotage echoue.
  const teamsLocal =
    modeTeams === 'local'
      ? new TeamsLocalClient({
          mail: (adresse, objet, corps) => outlookGateway.sendNew(adresse, objet, corps),
          log: (ligne) => {
            console.warn(ligne)
            journalTeams('pilotage', { detail: detailPilotage(ligne) })
          }
        })
      : undefined
  const teamsSource = teamsClient ?? teamsLocal
  ctx.mailWatchdogReplier = async (itemId, body) => {
    if (parseTeamsItemId(itemId)) {
      const resultat = await (teamsLocal
        ? teamsLocal.reply(itemId, body)
        : replyTeams(teamsClient, itemId, body))
      journalTeams('reponse', {
        conv: empreinteConversation(itemId),
        ok: resultat.ok,
        erreur: resultat.ok ? undefined : resultat.erreur
      })
      return resultat
    }
    const sent = await outlookGateway.replyToItem(itemId, body)
    if (sent.ok) await outlookGateway.markRead([itemId])
    return sent
  }
  // Surveillance des mails pour les regles `outlook-mail`. Un canal n'est interroge que si une regle
  // ACTIVE l'ecoute : sans elle, aucun dialogue COM (Outlook) ni appel reseau (Teams).
  // fix-ok: une seule regle mail active suffisait a interroger Outlook ET Teams (ancien test `.some(kind === 'outlook-mail')`), et chaque `await notifyMail` attendait la FIN de l'agent : la lecture suivante, et Teams, attendaient l'agent Outlook.
  // Salvage 2026-09-26 : cette surveillance et la source Teams locale + son journal
  // ont ete ecrites en parallele ; la surveillance lit desormais `teamsSource`.
  // Le journal ne note une lecture qu'a son RETABLISSEMENT et une erreur qu'a son CHANGEMENT : pas
  // une ligne par minute.
  let lectureTeamsAnnoncee = false
  let derniereErreurTeams: string | undefined
  const mailMemoryPath = join(app.getPath('userData'), 'watchdog-mail-state.json')
  const mailMemory = new MailWatchMemory({
    load: () => (existsSync(mailMemoryPath) ? readFileSync(mailMemoryPath, 'utf8') : undefined),
    save: (text) => writeFileSync(mailMemoryPath, text)
  })
  const mailWatcher = new MailChannelWatcher({
    store: scheduledTasks,
    memory: mailMemory,
    notifyMail: async (mail) => {
      const bilan = (await ctx.watchdogEngine?.notifyMail(mail)) ?? []
      if (mail.channel !== 'teams') return
      // Journal Teams : POURQUOI un message detecte a eu, ou non, une reponse.
      const conv = empreinteConversation(mail.itemId)
      const concernees = bilan.filter((b) => b.issue !== 'autre-canal')
      if (!concernees.length) journalTeams('ignore', { conv, raison: 'aucune-regle-teams-active' })
      for (const b of concernees)
        journalTeams(b.issue === 'declenche' ? 'declenche' : 'refus', {
          conv,
          regle: b.taskId.slice(0, 8),
          raison: b.issue === 'declenche' ? undefined : b.issue
        })
    }
  })
  let mailPolling = false
  setInterval(() => {
    if (mailPolling || !ctx.watchdogEngine) return
    const listening = listeningChannels(scheduledTasks.listTasks())
    if (!listening.outlook && !(listening.teams && teamsSource)) return
    mailPolling = true
    void (async () => {
      if (listening.outlook) {
        try {
          await mailWatcher.watch(
            'outlook',
            await outlookGateway.snapshot(true),
            async (mail, full) => {
              if (!full) return describeMail(mail)
              // L'instantane coupe chaque corps a 800 caracteres (tuile d'accueil) : l'agent relit donc
              // ce seul mail en entier. Un echec de relecture garde l'apercu, et il se voit au journal.
              // fix-ok: MaxCorps=800 dans outlook-local-snapshot.ps1 — 54 mails sur 80 coupes pile a 800 (mesure 2026-09-26), describeMail recevait donc l'apercu.
              const complet = await outlookGateway.readBody(mail.id)
              if (!complet.ok)
                console.warn(
                  '[watchdog] mail relu en entier impossible, aperçu gardé :',
                  complet.erreur
                )
              return describeMail(complet.ok ? { ...mail, corps: complet.corps } : mail)
            }
          )
        } catch (error) {
          console.warn('[watchdog] lecture des mails impossible', error)
        }
      }
      // Un echec Teams ne prive pas les mails, et inversement. Source : Graph s'il est connecte,
      // sinon le stockage local du client Teams.
      if (listening.teams && teamsSource) {
        let snapshot: unknown
        try {
          const instantane = await teamsSource.snapshot()
          snapshot = instantane
          battementTeams(true)
          if (!lectureTeamsAnnoncee || derniereErreurTeams !== undefined)
            journalTeams('lecture-ok', { conversations: instantane.mails.length })
          lectureTeamsAnnoncee = true
          derniereErreurTeams = undefined
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          snapshot = { ok: false, erreur: message }
          battementTeams(false)
          console.warn('[watchdog] lecture Teams impossible :', message)
          if (message !== derniereErreurTeams)
            journalTeams('lecture-impossible', { erreur: message })
          derniereErreurTeams = message
        }
        try {
          await mailWatcher.watch('teams', snapshot, async (message) => {
            journalTeams('detecte', {
              conv: empreinteConversation(message.id),
              recuLe: message.recuLe ?? undefined
            })
            return describeTeamsMessage(message)
          })
        } catch (error) {
          console.warn('[watchdog] messages Teams non traités', error)
        }
      }
      mailPolling = false
    })()
  }, 60_000).unref?.()
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
  // OUVRE une piece jointe RECUE : Outlook la copie dans un dossier temporaire, Windows
  // l'ouvre. Rien n'est ecrit dans la boite. Identifiant, rang et nom sont revalides cote main, et un
  // type de fichier qui LANCE un programme (liste « Level 1 » d'Outlook) est refuse avant tout script.
  ipcMain.handle(
    'outlook:ouvrir-piece',
    async (event, id: unknown, rang: unknown, nom: unknown) => {
      assertTrustedRendererSender(event, 'Outlook')
      return outlookGateway.openAttachment(id, rang, nom)
    }
  )
  // Le seul canal Outlook qui ECRIT : il envoie une reponse, donc un acte irreversible. La
  // confirmation appartient a l'interface, qui est le seul endroit ou l'utilisateur est present ; ici
  // on garde la validation du contenu, parce qu'une frontiere de confiance ne se garde pas d'un cote.
  // Les PIECES JOINTES arrivent en contenu (base64) et non en chemin, comme pour un message neuf :
  // un fichier glisse depuis Outlook n'existe pas sur le disque. Elles sont donc revalidees par la
  // passerelle -- nom, forme du base64, taille -- avant de redevenir des fichiers dans un dossier
  // temporaire.
  ipcMain.handle(
    'outlook:repondre',
    async (event, id: unknown, corps: unknown, pieces: unknown) => {
      assertTrustedRendererSender(event, 'Outlook')
      return outlookGateway.replyToItem(id, corps, pieces)
    }
  )
  // MARQUE des messages comme lus. Ecrit aussi dans la boite, mais rien n'en sort : declenche par le
  // geste de l'utilisateur qui OUVRE un fil, jamais par la relecture periodique -- une relecture qui
  // marque lu viderait la boite de ses non-lus pendant qu'il regarde ailleurs.
  ipcMain.handle('outlook:marquer-lu', async (event, ids: unknown) => {
    assertTrustedRendererSender(event, 'Outlook')
    return outlookGateway.markRead(ids)
  })
  // ENVOIE un message NEUF, hors de tout fil existant : une adresse, un objet, un premier message.
  // Il ECRIT et il SORT du poste, comme `outlook:repondre`, mais rien n'est herite d'un element
  // existant -- l'adresse vient d'une saisie. Elle est donc contrainte a un motif ASCII cote main
  // AVANT de partir dans un appel COM, et l'objet comme le corps voyagent par des fichiers
  // temporaires : jamais concatenes dans une ligne de commande.
  // Les PIECES JOINTES arrivent en contenu (base64) et non en chemin : un fichier glisse depuis
  // Outlook n'existe pas sur le disque. Elles sont donc revalidees par la passerelle -- nom, forme
  // du base64, taille -- avant de redevenir des fichiers dans un dossier temporaire.
  ipcMain.handle(
    'outlook:nouveau-message',
    async (event, adresse: unknown, objet: unknown, corps: unknown, pieces: unknown) => {
      assertTrustedRendererSender(event, 'Outlook')
      return outlookGateway.sendNew(adresse, objet, corps, pieces)
    }
  )

  registerTaskManagerIpc({
    ipc: ipcMain,
    store: scheduledTasks,
    scheduler: ctx.scheduledTaskScheduler,
    watchdogDiagnostics: (taskId) => {
      const task = scheduledTasks.getTask(taskId)
      return {
        admittedLastHour: ctx.watchdogEngine?.admittedLastHour(taskId) ?? 0,
        ...(ctx.watchdogEngine?.complaint(taskId)
          ? { complaint: ctx.watchdogEngine.complaint(taskId) }
          : {}),
        // Pourquoi un mail n'a rien declenche : journal et lecture en panne, gardes sur le disque.
        // Regle Teams : etat de la connexion Microsoft et code a saisir (bouton « Connecter Teams »).
        ...(task
          ? mailDiagnostics(
              mailMemory,
              task,
              teamsClient ? teamsClient.signInState() : { state: 'unconfigured' }
            )
          : {})
      }
    },
    assertTrusted: assertTrustedRendererSender,
    onChanged: () => {
      broadcast({ type: 'refresh', scope: 'task-manager' })
    },
    ...(teamsClient ? { teams: teamsClient } : {})
  })
  void ctx.scheduledTaskScheduler
    .start(startupTaskOccurrence)
    .then(async () => {
      for (const occurrenceId of pendingScheduledOccurrences) {
        await ctx.scheduledTaskScheduler?.runOccurrence(occurrenceId)
      }
      pendingScheduledOccurrences.clear()
      // Plus aucune règle n'est livrée d'origine : l'auto-kaizen a été retiré. Cet appel EFFACE la
      // règle auto-kaizen encore posée quand elle est restée intacte, avant que le moteur ne la voie.
      const seeded = seedWatchdogTasks(scheduledTasks)
      if (seeded.length) console.log(`[watchdog] règles livrées posées : ${seeded.length}`)
      if (seedMaintenanceTask(scheduledTasks))
        console.log('[task-manager] tâche Maintenance quotidienne posée')
      if (seedGcTask(scheduledTasks))
        console.log('[task-manager] tâche Garbage collector quotidienne posée')
      // Regle PERSONNELLE : posee seulement sur le poste qui l'a demandee (`setx AUTOWIN_WATCHDOG_MAILS 1`),
      // jamais chez tout le monde — elle lit la boite de l'utilisateur et repond en son nom.
      // `setx` n'atteint pas un lanceur deja ouvert : la relance heritait d'un environnement sans la
      // variable (2026-09-24). On relit donc aussi la valeur persistee HKCU.
      const mailsPerso = (): boolean => {
        if (process.env.AUTOWIN_WATCHDOG_MAILS === '1') return true
        if (process.platform !== 'win32') return false
        try {
          return /AUTOWIN_WATCHDOG_MAILS\s+REG_\w+\s+1\s*$/m.test(
            execFileSync('reg', ['query', 'HKCU\\Environment', '/v', 'AUTOWIN_WATCHDOG_MAILS'], {
              encoding: 'utf8',
              windowsHide: true,
              timeout: 3_000
            })
          )
        } catch {
          return false // variable absente : regle non posee, c'est le cas normal des autres postes
        }
      }
      // fix-ok: copie de test du 30/09 : règles mails + Teams posées par le seul réglage HKCU.
      if (
        reglesMailsPersoAutorisees({
          instanceIsolee: isolatedTestInstance,
          reglagePose: mailsPerso
        }) &&
        seedMailWatchdogTask(scheduledTasks)
      )
        console.log('[watchdog] règle Assistant mails posée')
      if (splitMailWatchdogByChannel(scheduledTasks))
        console.log('[watchdog] règle mails séparée en Outlook + Teams')
      if (retargetTeamsWatchdogPrompt(scheduledTasks))
        console.log('[watchdog] règle Teams : consigne Teams posée')
      if (liftLegacyMailWatchdogCaps(scheduledTasks))
        console.log('[watchdog] règles mails : plafond relevé à 240/h, sans plafond du jour')
      if (seedCurateTask(scheduledTasks))
        console.log('[task-manager] tâche Curation quotidienne posée')
      // Sans elle, `dispatcherVeille` ne voyait jamais de tâche `veille` : aucun scout web n'avait
      // tourné sur ce poste (2026-10-21).
      if (seedVeilleTask(scheduledTasks))
        console.log('[task-manager] tâche Veille concurrents hebdomadaire posée')
      // Après le scheduler : chaque règle fichier se positionne à la FIN de son fichier, donc
      // l'historique déjà écrit ne réveille personne au démarrage.
      await ctx.watchdogEngine?.start()
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
    // Motif partagé avec le graphe, qui y reconnaît un arrêt voulu et non une panne.
    const orchestrationAborted = bus.abortOrchestration(conversationId, MOTIF_STOP_DU_CHAT)
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
    return { active: activeChatTurns.isInFlight(conversationId) }
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
    async (event, rawConversationId: string, rawDirective: string, rawAttachments?: unknown) => {
      assertTrustedRendererSender(event, 'Pilot chat directive')
      const conversationId = guardString(rawConversationId, 'conversationId')
      const directive = guardString(rawDirective, 'directive').trim()
      const jointes = guardAttachments(rawAttachments)
      if (!directive && jointes.length === 0) return { ok: false, motif: 'vide' as const }
      // UNE COMMANDE DE SKILL NE S'INJECTE PAS EN TEXTE (turn 6d0e352f-0624-4c9a-b2f5-c6aabf57d310,
      // saisie ts 1790275118313) : « /judge mon watchdog » envoye pendant un tour a ete colle dans le
      // fil comme simple phrase ; la skill judge n'a jamais ete chargee et le modele a juge lui-meme.
      // Refus -> le renderer met le texte en FILE, il repart en message normal, donc route par
      // `routeSkillRequest` comme n'importe quel `/judge`.
      // Le refus porte son MOTIF : sans lui, l'ecran affichait « ⚠ Échec » sur un refus voulu.
      const commande = jointes.length === 0 ? commandeNonInjectable(directive) : undefined
      if (commande) return { ok: false, motif: 'commande' as const, commande }
      // Le renderer passe busy avant que l'IPC `pilotChat` ait fini d'enregistrer son controleur.
      // Une attente courte absorbe cette course de demarrage sans accepter de directive hors tour.
      if (!(await activeChatTurns.waitForActive(conversationId, 500)))
        return { ok: false, motif: 'hors-tour' as const }
      // PIECES JOINTES EN COURS DE TOUR (2026-09-23) : elles attendaient la fin du tour, parfois
      // plusieurs minutes (« j'ai envoye un message avec une image et ca n'a rien envoye »). Elles
      // sont ecrites sur disque comme pour un message normal, et leurs chemins suivent le texte.
      // Pas de nettoyage ici : le tour doit pouvoir les lire ; les temporaires orphelins sont
      // balayes par `temporaires-orphelins.ts`.
      const suffixe = jointes.length > 0 ? materializeClaudeAttachments(jointes).promptSuffix : ''
      const queued = pendingDirectives.get(conversationId) ?? []
      queued.push((directive || '(image envoyée sans texte)') + suffixe)
      pendingDirectives.set(conversationId, queued)
      // REMISE EN PLEIN APPEL : la boucle pilote ne relit la file qu'ENTRE deux appels ;
      // un appel du CLI Claude peut durer 16 minutes (tour 2e218711 : saisie ts
      // 1793225455947 absente du premier appel, lue au second). Doublée sur disque, le contrôle
      // avant chaque outil la remet.
      deposerOrientationDuFil(conversationId, queued[queued.length - 1])
      broadcast({ type: 'refresh', scope: 'directives' })
      // La directive est acceptee -> elle devient un VRAI message du fil. Sans cette ecriture, le
      // seul temoin etait un recu vivant dans la memoire de l'ecran : un rechargement l'effacait et
      // l'utilisateur devait recliquer (2026-09-01). L'echec de l'ecriture ne remonte
      // jamais : la directive est deja empilee, une trace manquee n'annule pas un envoi reussi.
      const messageId = enregistrerDirectiveDansLeFil({
        conversations: os.conversations,
        conversationId,
        texte: directive,
        attachments: jointes,
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
   * volatiles tant qu'aucun tour n'est créé (mesure du 2026-09-01, : deux messages disparus
   * sans trace). Cette écriture précède donc l'envoi, et son échec ne remonte jamais : elle rend
   * `{ ok: false }` plutôt que de lever, pour ne pas transformer une trace manquée en envoi manqué.
   */
  ipcMain.handle(
    'os:saisie:journaliser',
    (event, rawConversationId: string, rawTexte: string, rawVoie: string, rawOrigine?: unknown) => {
      assertTrustedRendererSender(event, 'User input journal')
      const conversationId = guardString(rawConversationId, 'conversationId')
      const texte = guardString(rawTexte, 'texte')
      const voie = guardString(rawVoie, 'voie')
      if (voie !== 'message' && voie !== 'orientation') {
        return { ok: false }
      }
      // Un envoi du mode auto doit se distinguer d'un texte tapé (seule valeur admise).
      const origine = rawOrigine === 'mode-auto' ? ('mode-auto' as const) : undefined
      return {
        ok: journaliserSaisie({ conversationId, texte, voie, ...(origine ? { origine } : {}) })
      }
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
  // Les RUN.md LÉGERS (une fiche par demande) : le panneau RUN.md du fil et les post-it du Board les
  // montrent. Ils s'écrivaient sans qu'aucun écran les lise.
  ipcMain.handle('os:fichesDuFil', (event, convId: string) => {
    assertTrustedRendererSender(event, 'Fiches du fil')
    return fichesDeDemande.fichesDuFil(guardString(convId, 'convId'))
  })
  ipcMain.handle('os:fichesDesDemandes', (event) => {
    assertTrustedRendererSender(event, 'Fiches des demandes')
    return fichesDeDemande.fichesDesDemandes()
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
      // Le cout n'a pas besoin du prompt systeme : ne pas le relire (gel mesure, voir loadPromptCalls).
      const calls = id
        ? loadPromptCalls(id, undefined, { systeme: false })
        : loadAllPromptCalls(undefined, { systeme: false })
      // LES DEUX journaux : les sous-agents les plus couteux n'existent que dans l'activite
      // (mesure : 2,83 $ vus contre ~20,70 $ reels). costSamplesFrom deduplique.
      const activity = id ? loadConvActivity(id) : []
      // Un appel tue par le watchdog meurt avant l'event `result` : le journal n'a ni tokens ni
      // prix, et l'indicateur affichait « 4,20 $ + non expose ». Ces chiffres existent dans le
      // transcript du CLI — on va les y relire avant de resumer, plutot que d'avouer une absence.
      const recovered = recoverUnpricedCallsUsage(calls)
      return summarizeCostSamples(
        applyRecoveredUsage(costSamplesFrom(calls, activity), recovered),
        dim as (typeof allowed)[number]
      )
    }
  )
  const loadNativeTraces = (): ReturnType<typeof readNativePreflight> => {
    // Spool NATIF Autowin : les traces sont écrites par Autowin lui-même (native-trace-spool) →
    // l'Observatory (RAG/injection) se peuple sur les vraies requêtes de l'app. Plus aucun fallback
    // externe (spool externe retiré).
    return readNativePreflight(nativeSpoolRoot(), 100)
  }
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
  // Le graphe du chat : la structure sans les contenus (relue chaque seconde en direct), puis les
  // charges de la seule étape ouverte. Voir `activity/trace-allegee.ts` pour la mesure.
  ipcMain.handle('os:causalTrace:graphe', (event, convId: string) => {
    assertTrustedRendererSender(event, 'Causal trace graph')
    const conversationId = guardString(convId, 'convId')
    return allegerTracePourGraphe(causalTrace.readConversation(conversationId))
  })
  ipcMain.handle(
    'os:causalTrace:charges',
    (event, convId: string, eventIds: unknown, kinds: unknown) => {
      assertTrustedRendererSender(event, 'Causal trace payloads')
      const conversationId = guardString(convId, 'convId')
      return chargesDesEvenements(causalTrace.readConversation(conversationId), eventIds, kinds)
    }
  )

  // --- Observatoire d'activité : transcripts Claude Code (lecture seule) + ledger in-app ---
  // Les canaux de la reconnaissance vocale locale vivent dans src/main/ipc/whisper.ts : ils ne
  // prenaient ici que leur service, construit paresseusement.
  registerWhisperIpc({ serviceWhisper })
  // Séparation des voix d'un fichier déjà enregistré (pyannote) : état lu, brique posée sur clic.
  registerDiarisationIpc()

  /**
   * OUVRIR LA PAGE MICRO DE WINDOWS. DEMANDE DE L'UTILISATEUR (2026-09-03) : le message « autorisez
   * le microphone » n'offrait aucun geste — « fais sauter le garde fou ».
   *
   * LE GARDE-FOU QUI SAUTE, ET CELUI QUI RESTE. Le filtre de `setWindowOpenHandler` (window.ts)
   * n'ouvre a l'exterieur que http/https, parce qu'un lien vient la d'un TEXTE de modele et
   * pourrait etre `file://un.exe`. Ce canal-ci ne prend AUCUNE url : l'adresse est une constante
   * ecrite ici, le rendu ne peut que la declencher. Le filtre general n'est donc pas touche.
   */
  ipcMain.handle('os:micro:reglages', async (event) => {
    assertTrustedRendererSender(event, 'Réglages micro')
    if (process.platform !== 'win32') return { ouvert: false, raison: 'hors-windows' }
    await shell.openExternal('ms-settings:privacy-microphone')
    return { ouvert: true }
  })

  // Les canaux de la voix neuronale et des enregistrements parles vivent dans src/main/ipc/ :
  // ils ne prenaient ici que leur service, construit paresseusement.
  registerPiperIpc({ servicePiper })
  registerTranscriptsIpc({ serviceTranscripts })

  // Les canaux de l'activite (sessions consultees et leurs captures) vivent dans
  // src/main/ipc/activity.ts : ils ne prenaient rien ici.
  registerActivityIpc()
  return suiviDuPlan
}
