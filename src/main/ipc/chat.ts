import { registerPiperIpc } from './piper'
import { registerActivityIpc } from './activity'
import { registerTranscriptsIpc } from './transcripts'
import { registerPreflightIpc } from './preflight'
import { registerGitIpc } from './git'
import { registerProjectFilesIpc } from './project-files'
import { registerLancementIpc } from './lancement'
import { registerTestsViewIpc } from './tests-view'
import { registerPerfIpc } from './perf'
import { registerClaudeAccountsIpc } from './claude-accounts'
import { registerProvidersIpc } from './providers'
import { registerSkillsIpc } from './skills'
import { registerWhisperIpc } from './whisper'
import { registerDiarisationIpc } from './diarisation'
import { app, shell, ipcMain } from 'electron'
import { join } from 'path'
import { execFileSync } from 'node:child_process'
import { createRunPilotChat } from '../chat/run-pilot-chat'
import { creerAvisAvantTour } from '../chat/avis-avant-tour'
import { buildContinuationProviderHistory } from '../chat/chat-continuation'
import { type SuiviDuPlan } from '../runs/relaunch-resumable-run'
import { assertTrustedRendererSender } from './ipc-senders'
import { homedir } from 'node:os'
import { canonicalProjectPath } from '../../shared/project-path'
import { guardString } from './ipc-guards'
import { seedWatchdogTasks } from '../task-manager/watchdog-seeds'
import { seedMaintenanceTask } from '../task-manager/maintenance-seed'
import { seedGcTask } from '../task-manager/gc-seed'
import { seedCurateTask } from '../task-manager/curate-seed'
import { seedVeilleTask } from '../task-manager/veille-seed'
import {
  liftLegacyMailWatchdogCaps,
  mailDiagnostics,
  reglesMailsPersoAutorisees,
  retargetTeamsWatchdogPrompt,
  splitMailWatchdogByChannel,
  seedMailWatchdogTask
} from '../task-manager/watchdog-mail'
import { registerTaskManagerIpc } from '../task-manager/task-manager-ipc'
import type { ContexteIpcChat } from '../index'
import { registerApplicationIpc } from './chat-application'
import { registerFixturesDeTestIpc } from './chat-fixtures-de-test'
import { registerOrchestrateIpc } from './chat-orchestrate'
import { registerComportementIpc } from './chat-comportement'
import { registerClotureDesRunsIpc } from './chat-cloture-des-runs'
import { registerModelesEtTopologieIpc } from './chat-modeles-et-topologie'
import { registerReglagesIpc } from './chat-reglages'
import { registerConversationsEtBoardIpc } from './chat-conversations-et-board'
import { registerBrainEtApprentissageIpc } from './chat-brain'
import { registerRunsEtPlansIpc } from './chat-runs-et-plans'
import { creerLeDossierDuTour } from './chat-dossier-du-tour'
import { creerLaNotificationDeFinDeTour } from './chat-fin-de-tour'
import { creerLeTourDuChat } from './chat-tour'
import { reprendreLesAppelsDuChat } from './chat-reprise-des-appels'
import { demarrerLeMenageDuChat } from './chat-menage'
import { demarrerLesPlansEtLesTaches } from './chat-plans-et-taches'
import { demarrerLaPublicationDesTravaux } from './chat-travaux-d-agents'
import { demarrerLeDispatchEtLaVeille } from './chat-veille'
import { registerCourrierIpc } from './chat-courrier'
import { registerTourEnCoursIpc } from './chat-tour-en-cours'
import { registerTracesIpc } from './chat-traces'
import type {
  RelanceTachesDeFond,
  ReparationDuRefus,
  SuiviDesFilsCoupes,
  SuiviDesPlans,
  SuiviGitApresFil
} from './chat-boites'

// Extrait tel quel d’index.ts (lot 5) : l’enregistrement des IPC du chat pesait ~3 500 lignes
// du démarrage. Le corps est INCHANGÉ ; l’état du module principal arrive par `ctx`. Les `let` du
// démarrage y sont lus/écrits par accesseurs (`ctx.x`) pour rester vivants, les autres sont déstructurés.
// Les familles de canaux vivent dans les modules voisins `src/main/ipc/chat-*.ts` ; cette fonction les
// appelle dans l’ORDRE du démarrage d’origine, qui compte : minuteries, écouteurs et boîtes partagées.
/** IPC : chat, orchestration, dashboards et graphe. */
export function registerChatIpc(ctx: ContexteIpcChat): SuiviDuPlan {
  const {
    activeChatTurns,
    appDataRoot,
    broadcast,
    bus,
    causalTrace,
    claudeAccounts,
    drainPendingDirectives,
    isolatedTestInstance,
    ledger,
    notifyWatchdogWorkflowIncident,
    os,
    pendingDirectives,
    pendingScheduledOccurrences,
    pickDirectory,
    pilot,
    preflightProviderOptions,
    providerStateStore,
    scheduledTasks,
    servicePiper,
    serviceTranscripts,
    serviceWhisper,
    startupTaskOccurrence,
    turnJournalRoot
  } = ctx
  // Les boîtes partagées entre les modules du chat : vides ici, assignées une fois leur
  // producteur construit. Déclarées AVANT le premier module qui les reçoit (types :
  // src/main/ipc/chat-boites.ts).
  /** Assigné plus bas, une fois le coordinateur des plans construit : la reprise le consulte. */
  const suiviDesFilsCoupes: SuiviDesFilsCoupes = {}
  /** Assigné plus bas, une fois `scheduledChatRuntime` construit (il ouvre le tour de reprise). */
  const relanceTachesDeFond: RelanceTachesDeFond = {}
  /** Assigné plus bas, une fois `lancerDansConversation` câblé (plans de lots). */
  const suiviDesPlans: SuiviDesPlans = {}
  /** Assigné plus bas, une fois `scheduledChatRuntime` construit (il ouvre le tour `/git`). */
  const suiviGitApresFil: SuiviGitApresFil = {}
  /** Assigné plus bas, une fois `scheduledChatRuntime` construit (il ouvre le tour de réparation). */
  const reparationDuRefus: ReparationDuRefus = {}

  // L’application elle-même (reprise, présence, mascotte, fenêtre, mise à jour) :
  // src/main/ipc/chat-application.ts.
  registerApplicationIpc(ctx)
  // Les fixtures des instances de test isolées : src/main/ipc/chat-fixtures-de-test.ts.
  registerFixturesDeTestIpc(ctx)
  // Le canal de l'inventaire des skills vit dans src/main/ipc/skills.ts.
  registerSkillsIpc({ skillSourcesPath: join(app.getPath('userData'), 'skill-sources.json') })
  registerProvidersIpc({ os, providerStateStore })
  // Les canaux des comptes Claude multiples vivent dans src/main/ipc/claude-accounts.ts.
  registerClaudeAccountsIpc({ os, claudeAccounts })
  // L’orchestration disciplinée (`os:orchestrate`) : src/main/ipc/chat-orchestrate.ts.
  registerOrchestrateIpc(ctx)

  // Composition des comportements et traces du fil : src/main/ipc/chat-comportement.ts.
  registerComportementIpc(ctx)
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
  // Clôture des runs et copies de travail : src/main/ipc/chat-cloture-des-runs.ts.
  registerClotureDesRunsIpc(ctx, { suiviDesPlans })
  // Topologie, workflows, modèles et fabric : src/main/ipc/chat-modeles-et-topologie.ts.
  registerModelesEtTopologieIpc(ctx)

  // Réglages du poste (dossier de travail, Brain, disque) : src/main/ipc/chat-reglages.ts.
  const { reglageCopieParFil } = registerReglagesIpc(ctx)

  // Conversations, Board et carte des besoins : src/main/ipc/chat-conversations-et-board.ts.
  const {
    rattacherLaBranche,
    dossierDesRetours,
    dossierDesCopiesDeFil,
    boardDuPoste,
    mesureDesEcarts
  } = registerConversationsEtBoardIpc(ctx, { suiviDesFilsCoupes })

  // Brain et apprentissage par l’issue : src/main/ipc/chat-brain.ts.
  registerBrainEtApprentissageIpc(ctx)
  // Runs, fichiers, état de l’app et plans de lots : src/main/ipc/chat-runs-et-plans.ts.
  registerRunsEtPlansIpc(ctx, { suiviDesPlans })
  // Chat transparent : l'agent converse ET pilote l'app dans le même tour.
  // conversationId (optionnel) → le tour est PERSISTÉ dans la conversation (fil rechargeable).
  // Le corps du tour vit dans src/main/chat/run-pilot-chat.ts : il ne capturait rien d'autre que
  // les valeurs listees ici, qui lui sont desormais passees explicitement.
  /** Les avis écrits avant le départ d'un tour passent sous le message envoyé, jamais au-dessus. */
  const avisAvantTour = creerAvisAvantTour({
    fil: os.conversations,
    rafraichir: (conversationId) =>
      broadcast({ type: 'refresh', scope: 'chat', convId: conversationId })
  })
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
    },
    libererLesAvisDAvantTour: (conversationId) => avisAvantTour.liberer(conversationId)
  })
  // Le dossier où travaille chaque tour (copie par fil, rangement) :
  // src/main/ipc/chat-dossier-du-tour.ts.
  const {
    alignerDossierSurLaDemande,
    avertirDossierSansEffet,
    passerLeFilDansSaCopie,
    rangerSurLePremierMessage,
    ouvrirLaCopieEnPleinTour
  } = creerLeDossierDuTour(ctx, { avisAvantTour, reglageCopieParFil })

  // La notification de fin de tour (bulle, carte, mascotte) : src/main/ipc/chat-fin-de-tour.ts.
  const { notifierFinDeTour } = creerLaNotificationDeFinDeTour(ctx)

  // Le tour de chat, de la réception à sa fin : src/main/ipc/chat-tour.ts.
  const { tourCompteDesReception, observateurDesPlans, runPilotChat, suiviDuPlan } =
    creerLeTourDuChat(ctx, {
      lancerTour,
      avisAvantTour,
      alignerDossierSurLaDemande,
      avertirDossierSansEffet,
      passerLeFilDansSaCopie,
      rangerSurLePremierMessage,
      ouvrirLaCopieEnPleinTour,
      rattacherLaBranche,
      mesureDesEcarts,
      notifierFinDeTour,
      suiviGitApresFil,
      suiviDesPlans,
      reparationDuRefus,
      planifierLeMenageDesCopies: () => planifierLeMenageDesCopies(),
      suiviDesFilsCoupes,
      boardDuPoste
    })
  // La reprise des appels de chat survivants : src/main/ipc/chat-reprise-des-appels.ts.
  reprendreLesAppelsDuChat(ctx, { suiviDesPlans, tourCompteDesReception, observateurDesPlans })

  // Les balayages périodiques (copies, rétention) : src/main/ipc/chat-menage.ts.
  const { planifierLeMenageDesCopies } = demarrerLeMenageDuChat(ctx, {
    dossierDesRetours,
    dossierDesCopiesDeFil
  })

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

  // Tâches planifiées, plans de lots et tâches de fond : src/main/ipc/chat-plans-et-taches.ts.
  const { relanceurTachesDeFond, scheduledChatRuntime, relayScriptPath } =
    demarrerLesPlansEtLesTaches(ctx, {
      runPilotChat,
      suiviDesPlans,
      relanceTachesDeFond,
      reparationDuRefus
    })
  // La publication des fils finis (git après fil, commits locaux) :
  // src/main/ipc/chat-travaux-d-agents.ts.
  demarrerLaPublicationDesTravaux(ctx, { suiviGitApresFil, suiviDesPlans, relanceurTachesDeFond })
  // Dispatch des tâches, fils coupés et veille : src/main/ipc/chat-veille.ts.
  const { taskDispatcher, scheduledTaskScheduler } = demarrerLeDispatchEtLaVeille(ctx, {
    suiviDesFilsCoupes,
    suiviDesPlans,
    runPilotChat,
    scheduledChatRuntime,
    relayScriptPath
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
  // Outlook, Teams et surveillance des mails : src/main/ipc/chat-courrier.ts.
  const { mailMemory, teamsClient } = registerCourrierIpc(ctx, { variablePerso })

  registerTaskManagerIpc({
    ipc: ipcMain,
    store: scheduledTasks,
    scheduler: scheduledTaskScheduler,
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
  void scheduledTaskScheduler
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
      // Le ménage du poste travaille sur « This computer » : son fil n'est le travail d'aucun projet,
      // et ne part donc pas avec le projet Autowin chez les collègues. Même calcul que le réveil.
      const dossierPersonnel = canonicalProjectPath(homedir()) ?? homedir()
      if (seedGcTask(scheduledTasks, dossierPersonnel))
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
      if (seedCurateTask(scheduledTasks, dossierPersonnel))
        console.log('[task-manager] tâche Curation quotidienne posée')
      // Le fil déjà créé d'une tâche rejoint son dossier choisi dès maintenant, pas au réveil suivant.
      taskDispatcher.alignerSurLeursDossiers(scheduledTasks.listTasks())
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

  // Arrêter, sonder ou orienter un tour en cours : src/main/ipc/chat-tour-en-cours.ts.
  registerTourEnCoursIpc(ctx)

  // Runs, fiches, activité et traces d’un fil : src/main/ipc/chat-traces.ts.
  registerTracesIpc(ctx)

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
