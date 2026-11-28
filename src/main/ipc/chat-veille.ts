import { app, ipcMain } from 'electron'
import type { RunPilotChat } from '../chat/run-pilot-chat'
import { StartupResumeQueue } from '../runs/startup-resume-queue'
import { creerRepriseDesFils, filsCoupesALire } from '../chat/reprise-fil-apres-quota'
import { assertTrustedRendererSender } from './ipc-senders'
import { ensureAutowinAppData } from '../app/app-data'
import { condenseurDuBrain } from '../brain/brain-condenseur'
import { TaskScheduler } from '../task-manager/task-scheduler'
import { WatchdogEngine } from '../task-manager/watchdog-engine'
import { ScheduledChatDispatcher, type ScheduledChatRuntime } from '../task-manager/chat-dispatch'
import {
  PowerShellWindowsRelay,
  windowsRelayTaskName,
  isolatedRelayLaunchArguments
} from '../task-manager/windows-relay'
import { registerVeilleIpc } from '../veille/veille-ipc'
import { executerPasse } from '../veille/passe'
import { genererCandidatsEnConversation } from '../veille/scout-visible'
import { unePasseALaFois } from '../veille/une-passe-a-la-fois'
import { lancerScoutVeille } from '../veille/scout-claude'
import { candidatsInternesDuDepot, lireRegistreDesMurs } from '../veille/audit-depot'
import { mursStorePath } from '../runs/murs-store'
import { dispatcherAvecVeille } from '../veille/dispatch-veille'
import type { SuiviDesFilsCoupes, SuiviDesPlans } from './chat-boites'
import type { ContexteIpcChat } from '../index'

/**
 * LE RÉVEIL DES TÂCHES : fils coupés par le quota, dispatch des tâches planifiées, relais
 * Windows, veille concurrentielle et directives entre deux phases.
 *
 * Appelé par `registerChatIpc` (src/main/ipc/chat.ts), à sa place dans l’ordre du démarrage.
 * L’état du démarrage arrive par `ctx` : les `let` d’index.ts s’y lisent par accesseur (`ctx.x`)
 * pour rester vivants.
 * Ce que construit un autre module du chat arrive par `deps`.
 */

/** Ce que `demarrerLeDispatchEtLaVeille` reçoit de `registerChatIpc`, construit avant ou à côté de lui. */
export interface DependancesDispatchEtVeille {
  suiviDesFilsCoupes: SuiviDesFilsCoupes
  suiviDesPlans: SuiviDesPlans
  runPilotChat: RunPilotChat
  scheduledChatRuntime: ScheduledChatRuntime
  relayScriptPath: string
}

/** Ce que `demarrerLeDispatchEtLaVeille` rend à `registerChatIpc`, qui le passe aux modules suivants. */
export interface DispatchEtVeille {
  taskDispatcher: ScheduledChatDispatcher
  /**
   * Le planificateur posé ici sur `ctx` : rendu pour que chat.ts le démarre sans relire un
   * `TaskScheduler | undefined`. C’est le même objet que `ctx.scheduledTaskScheduler`.
   */
  scheduledTaskScheduler: TaskScheduler
}

/** Le dispatch des tâches planifiées et la veille. */
export function demarrerLeDispatchEtLaVeille(
  ctx: ContexteIpcChat,
  deps: DependancesDispatchEtVeille
): DispatchEtVeille {
  const {
    activeChatTurns,
    appDataRoot,
    broadcast,
    bus,
    drainPendingDirectives,
    explicitUserDataDir,
    isolatedTestInstance,
    notifiedTaskAlerts,
    os,
    repriseDesFilsActive,
    scheduledTasks
  } = ctx
  const { suiviDesFilsCoupes, suiviDesPlans, runPilotChat, scheduledChatRuntime, relayScriptPath } =
    deps
  /*
   * LES FILS COUPÉS PAR LE QUOTA : une reprise automatique, à l'heure annoncée. File à
   * elle : elle attend la fin de chaque tour, et un long tour ne doit pas retenir le réveil d'un run.
   * Historique complet : sans session à reprendre, `runPrompt` ne laisserait à l'agent qu'une phrase.
   * fix-ok: mesuré sur 30 jours : 21 tours coupés, 16 suivis d'un « reprend » tapé à la main.
   */
  const fileDesFilsCoupes = new StartupResumeQueue()
  suiviDesFilsCoupes.reprise = creerRepriseDesFils({
    lireFils: () => filsCoupesALire(os.conversations),
    lireFil: (id) => os.conversations.get(id),
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
        // Les murs qui reviennent d'un fil à l'autre, mesurés : voir `veille/murs-recurrents.ts`.
        candidatsInternes: candidatsInternesDuDepot(os.executionWorkspace, {
          murs: lireRegistreDesMurs(mursStorePath())
        })
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
  // Aucun run ne se met en pause pour poser une question dans une fenêtre (2026-11-08, choix de
  // l'utilisateur) : un run bloqué tranche lui-même (`gates/etendue-repetee.ts`, `juge/relecture-froide.ts`).
  return { taskDispatcher, scheduledTaskScheduler: ctx.scheduledTaskScheduler }
}
