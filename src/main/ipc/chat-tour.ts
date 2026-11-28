import { registerCarteDesBesoinsIpc } from './carte-des-besoins'
import { creerMesureDesEcarts } from '../board/ecarts-des-fiches'
import type { ConversationPourLaCarte } from '../board/carte-des-besoins'
import {
  type ObservateurFinDeTour,
  suivreLaFinDuTour,
  annoncerLaFinDuTour,
  type RunPilotChat
} from '../chat/run-pilot-chat'
import { creerAvisAvantTour } from '../chat/avis-avant-tour'
import { modeleDuTour } from '../chat/modele-de-conversation'
import { lancerLaReparationDuRefus } from '../chat/reparation-du-refus'
import type { SuiviDuPlan } from '../runs/relaunch-resumable-run'
import { typerCeQuiPart, typeurTsc } from '../verify/typage-avant-publication'
import {
  revenirSiSaCopieADisparu,
  refuserTourSiDossierDisparu,
  type IssueDuPassage
} from '../conversations/bascule-dossier-conversation'
import { photographierDebutDeTour } from '../chat/chat-turn-publication'
import {
  lireAmont,
  decisionGitApresFil,
  filDeLaPasse,
  commitsPublies,
  blocDuTour
} from '../git/git-apres-fil'
import { defaultGitRunner, type AutoCloseReport } from '../runs/run-autoclose'
import { creerNotifieurDeFinDeTour } from '../app/notification-fin-de-tour'
import { photographierLeCode } from '../git/photo-du-code'
import { inscrireCopieALaDemande } from '../copies/copie-a-la-demande-app'
import { branchesARattacher } from '../store/conversations'
import type { DossierDuTourDuChat } from './chat-dossier-du-tour'
import type {
  SuiviGitApresFil,
  SuiviDesPlans,
  ReparationDuRefus,
  SuiviDesFilsCoupes
} from './chat-boites'
import type { ContexteIpcChat } from '../index'

/**
 * LE TOUR DE CHAT TEL QUE LE LANCENT LES CANAUX : compté dès la réception, passé dans sa copie,
 * photographié avant et après, suivi jusqu’à sa fin (plans de lots, Board, publication).
 *
 * Appelé par `registerChatIpc` (src/main/ipc/chat.ts), à sa place dans l’ordre du démarrage.
 * L’état du démarrage arrive par `ctx` : les `let` d’index.ts s’y lisent par accesseur (`ctx.x`)
 * pour rester vivants.
 * Ce que construit un autre module du chat arrive par `deps`.
 */

/** Ce que `creerLeTourDuChat` reçoit de `registerChatIpc`, construit avant ou à côté de lui. */
export interface DependancesTourDuChat {
  lancerTour: RunPilotChat
  avisAvantTour: ReturnType<typeof creerAvisAvantTour>
  alignerDossierSurLaDemande: DossierDuTourDuChat['alignerDossierSurLaDemande']
  avertirDossierSansEffet: DossierDuTourDuChat['avertirDossierSansEffet']
  passerLeFilDansSaCopie: DossierDuTourDuChat['passerLeFilDansSaCopie']
  rangerSurLePremierMessage: DossierDuTourDuChat['rangerSurLePremierMessage']
  ouvrirLaCopieEnPleinTour: DossierDuTourDuChat['ouvrirLaCopieEnPleinTour']
  rattacherLaBranche: ContexteIpcChat['rattacherLaBrancheAuxFiches']
  mesureDesEcarts: ReturnType<typeof creerMesureDesEcarts>
  notifierFinDeTour: ReturnType<typeof creerNotifieurDeFinDeTour>
  suiviGitApresFil: SuiviGitApresFil
  suiviDesPlans: SuiviDesPlans
  reparationDuRefus: ReparationDuRefus
  planifierLeMenageDesCopies: () => void
  suiviDesFilsCoupes: SuiviDesFilsCoupes
  boardDuPoste: ReturnType<typeof registerCarteDesBesoinsIpc>
}

/** Ce que `creerLeTourDuChat` rend à `registerChatIpc`, qui le passe aux modules suivants. */
export interface TourDuChat {
  tourCompteDesReception: RunPilotChat
  observateurDesPlans: ObservateurFinDeTour
  runPilotChat: RunPilotChat
  suiviDuPlan: SuiviDuPlan
}

/** Le tour de chat câblé : ce que lancent `os:pilotChat`, la reprise et les tâches. */
export function creerLeTourDuChat(ctx: ContexteIpcChat, deps: DependancesTourDuChat): TourDuChat {
  const {
    activeChatTurns,
    agentModelsReady,
    broadcast,
    bus,
    dossierDuTour,
    fichesDeDemande,
    journalDesBesoins,
    mascotteDuBureau,
    os,
    publicationsEnVol,
    repriseDesFilsActive
  } = ctx
  const {
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
    planifierLeMenageDesCopies,
    suiviDesFilsCoupes,
    boardDuPoste
  } = deps
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
      // Sauf pour SA copie de fil disparue (retirée par le ménage pendant que le fil dormait) : le fil
      // revient à son dossier d'avant, et son passage plus bas lui en rouvre une neuve. Un tour repris
      // après un redémarrage ne change jamais de dossier en route : lui reste refusé.
      if (
        args[4] === undefined &&
        revenirSiSaCopieADisparu(os.conversations.get(conversationId), () =>
          os.conversations.revenirDeLaCopie(conversationId)
        )
      )
        broadcast({ type: 'refresh', scope: 'conversations' })
      refuserTourSiDossierDisparu(os.conversations.get(conversationId)?.projectPath, (raison) => {
        os.conversations.append(conversationId, { role: 'assistant', content: raison })
        broadcast({ type: 'refresh', scope: 'chat', convId: conversationId })
      })
      // Les avis qui suivent (dossier basculé, copie ouverte, modèle indisponible) attendent le
      // début du tour, où le message envoyé est enregistré (`avis-avant-tour.ts`) : libérés là par
      // `run-pilot-chat.ts`, sinon dans le `finally` du tour, à côté de `finirTour()`.
      avisAvantTour.retenir(conversationId)
      alignerDossierSurLaDemande(conversationId, args[1])
      avertirDossierSansEffet(conversationId, os.conversations.get(conversationId)?.projectPath)
      /*
       * UNE COPIE PAR FIL D'AUTOWINOS, décidée ICI : après la bascule par chemin cité (qui prime),
       * avant que le dossier du tour soit lu (photos, cwd du CLI, clé de session). Un tour REPRIS
       * après un redémarrage (`args[4]`) a commencé avant : il ne change jamais de dossier en route.
       * fix-ok: cause mesurée — rien ne faisait passer un fil dans sa copie : les 10 cas de
       * `preparerLeDossierDuTour` (bascule-dossier-conversation.test.ts) et le passage sans reprise de
       * session (agent-pilot.session-resume.test.ts) étaient rouges sur le code d'avant.
       */
      const passage: IssueDuPassage =
        args[4] === undefined ? await passerLeFilDansSaCopie(conversationId, args[1]) : 'rien'
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
          // Même forme que la bascule de dossier (`alignerDossierSurLaDemande`) : avis retenu
          // jusqu'au départ du tour, sous le message envoyé.
          avisAvantTour.annoncer(
            conversationId,
            `⚠️ Le modèle choisi pour cette conversation (${modele.voulu.provider} · ${modele.voulu.model ?? 'modèle par défaut'}) n'est plus disponible : ${modele.motif}. Ce tour part sur le modèle par défaut de l'application.`
          )
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
      let debutPublication = os.autoCloseEnabled()
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
      /*
       * LA COPIE À LA PREMIÈRE ÉCRITURE : le tour part dans le dossier partagé, et sa copie s'ouvre
       * quand le contrôle du CLI voit la première écriture dans le code. La photo de publication
       * passe alors sur la copie, neuve : c'est elle que la porte publiera à la fin du tour.
       */
      const depotDuPassage = dossierDuTour(conversationId)
      const retirerCopieALaDemande =
        passage === 'a-la-demande'
          ? inscrireCopieALaDemande(conversationId, {
              depot: depotDuPassage,
              ouvrir: async () => {
                const ouverte = await ouvrirLaCopieEnPleinTour(conversationId, depotDuPassage)
                if (ouverte.ok && debutPublication)
                  debutPublication = await photographierDebutDeTour(ouverte.chemin)
                return ouverte
              }
            })
          : () => undefined
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
              for (const branche of branchesARattacher(os.conversations, conversationId))
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
                  conversationId,
                  { commitsLocaux: decision.commitsLocaux === true }
                )
            })
            .catch((error) => console.warn('[enchainement chat] publication impossible :', error))
            .finally(finPublication)
          // La porte a refusé le travail du fil : l'app lance elle-même le tour qui règle la cause, une
          // fois la publication close. Sans lui, l'utilisateur devait lire le refus et le demander.
          void publicationDuTour.then((rapport) => {
            const { envoyerTour } = reparationDuRefus
            if (!envoyerTour) return
            lancerLaReparationDuRefus(
              {
                envoyerTour,
                journal: (message, detail) =>
                  console.warn('[reparation du refus]', message, detail ?? '')
              },
              {
                conversationId,
                rapport,
                demande,
                deFond: args[5]?.background === true,
                lotDePlan: suiviDesPlans.coordinateur?.planDuFil(conversationId)?.role === 'enfant',
                filOccupe: activeChatTurns.isInFlight(conversationId)
              }
            )
          })
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
          // Après le bloc : c'est lui qui pose la dernière mise à jour du fil, donc le départ du calme.
          .finally(planifierLeMenageDesCopies)
        return resultat
      } finally {
        retirerCopieALaDemande()
        finirTour()
        // Un tour qui n'a pas commencé garde ses avis retenus : ils s'écrivent ici.
        avisAvantTour.liberer(conversationId)
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
    repriseEnFile: (fil, tour) => suiviDesPlans.coordinateur?.repriseEnFile(fil, tour),
    repriseAbandonnee: (fil, tour) =>
      suiviDesPlans.coordinateur?.repriseAbandonnee(fil, tour) ?? false,
    finDuRun: (fil, issue) => annoncerLaFinDuTour(observateurDesPlans, fil, issue)
  }
  return { tourCompteDesReception, observateurDesPlans, runPilotChat, suiviDuPlan }
}
