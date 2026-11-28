import { app } from 'electron'
import { join } from 'path'
import type { RunPilotChat } from '../chat/run-pilot-chat'
import { lancerSansAttendre } from '../chat/lancer-sans-attendre'
import { demarrerPointEntreeLocal } from '../app/point-entree-local'
import { creerRelanceurSurDisque, type RelanceurTachesDeFond } from '../chat/relance-taches-de-fond'
import { ensureAutowinAppData } from '../app/app-data'
import { homedir } from 'node:os'
import { canonicalProjectPath } from '../../shared/project-path'
import { CoordinateurDesPlans } from '../orchestration/plans-de-lots-app'
import { dossierDuFilOuvertPar } from '../conversations/bascule-dossier-conversation'
import {
  readConversationTurnFileMutations,
  readConversationTurnFilePaths,
  readCurrentPathOwners
} from '../activity/conversation-file-trace-spool'
import { type ScheduledChatRuntime, scheduledTaskBinding } from '../task-manager/chat-dispatch'
import { runWatchdogOrchestration } from '../task-manager/watchdog-orchestration-adapter'
import { lanceurDuLot } from '../orchestration/outils-du-lot'
import type { SuiviDesPlans, RelanceTachesDeFond, ReparationDuRefus } from './chat-boites'
import type { ContexteIpcChat } from '../index'

/**
 * LES TOURS QUE L’APP LANCE TOUTE SEULE : runtime des tâches planifiées, coordinateur des plans
 * de lots, outils du lot, relance des tâches de fond.
 *
 * Appelé par `registerChatIpc` (src/main/ipc/chat.ts), à sa place dans l’ordre du démarrage.
 * L’état du démarrage arrive par `ctx` : les `let` d’index.ts s’y lisent par accesseur (`ctx.x`)
 * pour rester vivants.
 * Ce que construit un autre module du chat arrive par `deps`.
 */

/** Ce que `demarrerLesPlansEtLesTaches` reçoit de `registerChatIpc`, construit avant ou à côté de lui. */
export interface DependancesPlansEtTaches {
  runPilotChat: RunPilotChat
  suiviDesPlans: SuiviDesPlans
  relanceTachesDeFond: RelanceTachesDeFond
  reparationDuRefus: ReparationDuRefus
}

/** Ce que `demarrerLesPlansEtLesTaches` rend à `registerChatIpc`, qui le passe aux modules suivants. */
export interface PlansEtTaches {
  relanceurTachesDeFond: RelanceurTachesDeFond
  scheduledChatRuntime: ScheduledChatRuntime
  relayScriptPath: string
}

/** Le runtime des tâches planifiées et le coordinateur des plans de lots. */
export function demarrerLesPlansEtLesTaches(
  ctx: ContexteIpcChat,
  deps: DependancesPlansEtTaches
): PlansEtTaches {
  const { activeChatTurns, appDataRoot, broadcast, bus, dossierDuTour, os, scheduledTasks } = ctx
  const { runPilotChat, suiviDesPlans, relanceTachesDeFond, reparationDuRefus } = deps
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
    // Le dossier choisi dans le formulaire de la tâche (déjà canonique) ; une catégorie posée à la
    // main sur le fil cède, comme pour le dossier global : c'est le dossier que la tâche a demandé.
    alignerSurDossier: (conversationId, dossier) => {
      const fil = os.conversations.get(conversationId)
      if (fil?.projectPath === dossier && !fil.categorie) return
      if (os.conversations.rangerDansDossier(conversationId, dossier))
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
      // Le dépôt du chef, jamais sa copie : le lot y aurait écrit par-dessus son chef.
      const dossier = dossierDuFilOuvertPar(source)
      return os.conversations.create({
        title: titre,
        provider: source?.provider ?? 'claude',
        ...(dossier ? { projectPath: dossier } : {})
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
    // Le registre des coûts : coût attendu au dépôt, dépense réelle à chaque réveil du chef.
    depenseDuFil: (fil) => os.cost.depenseDuFil(fil),
    ecrire: (de, a, texte) => bus.ecrireDepuisLeFil(de, a, texte),
    // Les fils qui tiennent les fichiers d'un lot refusé par la base : leurs traces de fichiers
    // (celles de `proprietaire_fichier`), hors fils qui les ont seulement VUS changer.
    proprietaires: (chef, fichiers) =>
      readCurrentPathOwners(dossierDuTour(chef), fichiers)
        .flat()
        .filter((p) => !p.vuSeulement)
        .map((p) => p.conversationId),
    // Lu à chaque lancement : la file de redémarrage n'existe qu'une fois index.ts l'a armée.
    redemarrageEnAttente: () => bus.redemarrageEnAttente?.() ?? false,
    // Même voie qu'un agent qui envoie un ordre : un fil inactif reçoit un tour.
    ordonner: async (de, a, texte) => {
      const r = await bus.exec('ecrire_a_un_fil', { destinataire: a, texte, nature: 'ordre' }, de)
      if (!r.ok) throw new Error(r.error ?? 'ordre refusé')
      return r.data
    },
    signaler: () => {
      broadcast({ type: 'refresh', scope: 'plans-de-lots' })
      broadcast({ type: 'refresh', scope: 'conversations' })
    }
  })
  bus.plansDeLots = coordinateurDesPlans
  suiviDesPlans.coordinateur = coordinateurDesPlans
  // Les étapes d'un run lancé par un fil de lot écrivent au chef, signées de ce fil, et lisent à qui
  // est un fichier depuis la copie de leur run (`dossier`).
  os.setOutilsDuLot((conversationId, dossier) =>
    lanceurDuLot(
      conversationId,
      {
        estUnLot: (fil) => coordinateurDesPlans.planDuFil(fil)?.role === 'enfant',
        exec: (name, args, fil) => bus.exec(name, args, fil),
        catalogue: () => bus.catalog()
      },
      dossier
    )
  )
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
  // Même voie que la reprise d'une tâche de fond : un tour dans le fil, hors du devis du tour refusé.
  reparationDuRefus.envoyerTour = (conversationId, prompt) =>
    os.executionSupervisor.runOutsideCurrent(() =>
      scheduledChatRuntime.runPrompt(conversationId, prompt)
    )
  return { relanceurTachesDeFond, scheduledChatRuntime, relayScriptPath }
}
