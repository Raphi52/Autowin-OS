import type { ProviderRegistry } from '../providers/registry'
import type { RoleBinding, RoleModelConfig } from '../profil/roles'
import type { AppCommandBus } from '../commands/commands'
import type { Message, SendOptions } from '../providers/types'
import { parseModelQuestion, type ModelQuestion } from '../modeles/model-questions'
import { contientUneQuestionPosee, masquerLesQuestionsPosees } from '../../shared/balise-question'
import { motsUtilisateur } from '../chat/chat-turn-messages'
import { courtCircuiteLeModele, routeSkillRequest } from '../skills/skill-routing'
import { AVIS_DEUX_LECTURES, type TraceDesLectures } from '../chat/deux-lectures'
import { startTurnTimer } from '../chat/turn-timing'
import { blocEtatSuivant } from '../chat/etat-diff'
import type { OuvertureOutilsNatifs } from '../chat/chat-mcp'

// Code libre du pilote rangé dans agent-pilot/ (lot 1) ; ré-exporté plus bas pour que
// les importeurs de './agent-pilot' ne changent pas.
import {
  CAP_ITERATIONS_TOUR,
  resolveLatestUserMessage,
  snapshotDuTour,
  waitForAnswer,
  type MotifDeRallonge
} from './aides-du-tour'
import {
  DeltaCollageTracker,
  consumeStreamedPrefix,
  detacherFenceCollee,
  separationDeltaCollee,
  soudureDePhrases
} from './collage-des-deltas'
import type {
  PilotEvent,
  PilotEventVariant,
  PilotProviderJournalLink,
  RecoveredPilotActionResult,
  RecoveredPilotProviderCall
} from './evenements'
import { commandResultSucceeded } from './issue-des-commandes'
import {
  REJECTED_QUESTION_MARKER,
  normaliserFermeturesCmd,
  parseOrderedPilotTokens,
  reparerAccoladeFinaleManquante,
  texteCmdIlisible,
  type OrderedPilotToken
} from './jetons-de-commande'
// Préparation du tour sortie de chat() (lot 2).
import { commandesDuTour } from './commandes-du-tour'
import { emetteurDuTour } from './emission-du-tour'
import { lecturesDuTour } from './lectures-du-tour'
import { messageDuTour } from './message-du-tour'
import { piecesJointesDuFil } from './pieces-jointes-du-fil'
import { jouerLaRouteSansModele } from './route-directe'
import { sessionDuTour } from './session-du-tour'
import { systemeDuTour } from './systeme-du-tour'
// État mutable du tour (lot 3).
import { etatInitialDuTour } from './etat-du-tour'
import { appelsNatifsDuTour } from './appels-natifs'
import { texteDeClotureDuTour, fermerAuCapDesIterations } from './texte-de-cloture'
// Boucle d'itérations sortie de chat() (lot 4).
import type { ContexteDuTour } from './contexte-du-tour'
import { appelDuModele } from './envoi-du-tour'
import { executerLesCommandes } from './execution-des-commandes'
import type { IterationDuTour } from './iteration-du-tour'
import {
  CONSIGNES_QUESTION_REFUSEE,
  consignesDifferees,
  consignesDuBudget,
  relanceAnnonceSansAction,
  relanceBlocVisuelNonFerme,
  relanceCheminsApresRemember,
  relanceCheminsIncomplets,
  relanceChiffreNonVerifie,
  relanceClotureApresRemember,
  relanceCommandeIllisible,
  relanceConclusionAbsente,
  relanceCorrectionApresEchec,
  relanceEchecTaise,
  relanceGesteRendu,
  relanceOutilPretenduAbsent,
  relancePreuveAbsente,
  relancePreuvePromise,
  relanceQuestionRefusee,
  relanceQuestionSansLecture,
  relanceRepriseRemember,
  relanceTourMuet,
  type Relance
} from './relances-du-tour'
import {
  afficherLaReponseSansCommande,
  fermerSiLectureSeuleEnfreinte,
  lireLaReponse,
  publierLesArtefacts,
  reinjecterLesDirectivesTardives
} from './reponse-du-tour'
import {
  consommerCompteRenduEnAttente,
  deposerCompteRenduEnAttente,
  hydraterSessionsDuChat,
  oublierSessionPersistee,
  persisterSessionDuChat
} from './persistance-entre-tours'
export {
  CAP_ITERATIONS_TOUR,
  DeltaCollageTracker,
  commandResultSucceeded,
  consumeStreamedPrefix,
  detacherFenceCollee,
  normaliserFermeturesCmd,
  parseOrderedPilotTokens,
  reparerAccoladeFinaleManquante,
  resolveLatestUserMessage,
  separationDeltaCollee,
  snapshotDuTour,
  soudureDePhrases,
  texteCmdIlisible
}
export type {
  OrderedPilotToken,
  PilotEvent,
  PilotEventVariant,
  PilotProviderJournalLink,
  RecoveredPilotActionResult,
  RecoveredPilotProviderCall
}

/**
 * Boucle de PILOTAGE : un agent LLM conduit l'app lui-même.
 * Il reçoit le catalogue de commandes + l'état courant, ÉMET des appels
 * `<cmd>{"name":..,"args":..}</cmd>`, qu'on exécute sur le bus (l'UI se met à jour
 * en direct), puis on lui renvoie le résultat + le nouvel état, et il reboucle
 * jusqu'à écrire DONE (ou cap d'itérations). C'est « l'agent voit ce qu'il update ».
 */
export class AgentPilot {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly roles: RoleModelConfig,
    private readonly bus: AppCommandBus,
    private readonly retrieveContext?: (
      query: string,
      /** Identite du tour : sans elle, le contexte pousse ne laisse aucune trace lisible. */
      meta?: { conversationId?: string; turnId?: string }
    ) => Promise<string>,
    /**
     * Contexte projet plié (CLAUDE.md/AGENTS.md du workspace), MÊME source que les phases
     * orchestrées (context-files). Défaut vide → le chat reste fonctionnel sans workspace.
     */
    private readonly projectContext: (conversationId?: string) => string = () => '',
    /**
     * Dossier de travail DU TOUR, resolu depuis la conversation courante (plus de dossier global fige
     * au demarrage). Sert au cwd du CLI, a la cle de session et au filtrage des faits provisoires.
     */
    private readonly executionWorkspace: (conversationId?: string) => string = () => '',
    /**
     * Servir AUSSI les commandes du chat comme outils directs du modele (MCP, `chat-mcp.ts`), en
     * plus du texte `<cmd>`. Faux par defaut : seul `index.ts` l'active, les fixtures et les tests
     * existants restent au texte seul. Un objet sert aux tests a injecter le demarrage du serveur.
     */
    private readonly outilsNatifs: boolean | Pick<OuvertureOutilsNatifs, 'demarrer'> = false,
    /**
     * Le petit modèle qui lit la demande AVANT un run payant ou un changement d'affichage, et dit
     * si elle a deux lectures plausibles (`deux-lectures.ts`). Absent = aucun contrôle :
     * seul `index.ts` le branche, les fixtures et les tests existants gardent leurs appels exacts.
     * `trace` : le fil du tour et la décision tirée de la réponse, pour la ligne de coût.
     */
    private readonly demanderDeuxLectures?: (
      systeme: string,
      charge: string,
      trace: TraceDesLectures,
      /** Les images jointes à la demande : elles désignent souvent seules son objet. */
      images?: NonNullable<Message['attachments']>
    ) => Promise<string>
  ) {}

  /**
   * Sessions CLI du CHAT, par conversation (levier coût — mesure 2026-07-28 : 1,85 M de tokens de
   * cache_write en 1h, ~79 k de contexte re-payé à chaque tour). Même levier que le session-resume
   * chaîné de l'orchestrateur : quand le provider rend un sessionId, le tour suivant REPREND cette
   * session — l'historique est déjà connu du CLI, on n'envoie donc que le nouveau message.
   *
   * La clé inclut provider+modèle : un changement de binding INVALIDE la session (reprendre une
   * session ouverte avec un autre modèle n'a pas de sens). Cache mémoire volontairement : le gain
   * visé est intra-session d'app (les tours consécutifs), et une session CLI ne survit de toute
   * façon pas indéfiniment — pas de sessionId réutilisable ⇒ retour au comportement actuel.
   */
  private readonly chatSessions = new Map<string, { key: string; sessionId: string }>()

  /**
   * Comptes-rendus de tours executes SANS le modele, en attente d'etre reinjectes au tour suivant.
   *
   * Le trou constate par l'utilisateur le 2026-08-14 : la route `explicit-skill` ci-dessous lance
   * l'orchestration elle-meme puis rend la main AVANT tout appel au modele. Le tour suivant reprend la
   * session CLI et n'envoie que le dernier message — donc ce tour n'existe nulle part pour lui, et il
   * repond « la trace ne contient ni son runId, ni ses phases, ni son resultat ». Reponse honnete face
   * a un trou ; le defaut etait le trou.
   *
   * DURABLE depuis le 2026-10-16 : la carte memoire est doublee d'un fichier a part
   * (`runs/compte-rendu-non-vu-store.ts`). Avant, un redemarrage entre les deux tours perdait la
   * note alors que la session, elle, etait rehydratee depuis le disque — le trou revenait. Les
   * methodes ci-dessous sont le SEUL acces : memoire d'abord, disque ensuite, oubli des deux.
   */
  private readonly comptesRendusNonVus = new Map<string, string>()

  // Corps dans agent-pilot/persistance-entre-tours.ts (lot 1).
  private deposerCompteRendu(conversationId: string, texte: string): void {
    deposerCompteRenduEnAttente(this.comptesRendusNonVus, conversationId, texte)
  }

  private consommerCompteRendu(conversationId: string): string | undefined {
    return consommerCompteRenduEnAttente(this.comptesRendusNonVus, conversationId)
  }

  /**
   * DERNIER etat de l'app deja pousse dans chaque conversation.
   *
   * Sert a n'envoyer QUE le changement quand la session du modele est reprise : cet etat part
   * cote MESSAGE, il change a chaque tour, donc il nest jamais mis en cache et se repaie PLEIN
   * TARIF. Mesure : 3 043 caracteres par tour, dont 2 821 pour la seule
   * liste des skills, identique dun tour a lautre.
   */
  private readonly dernierEtatPousse = new Map<string, unknown>()

  /** Extraits de rappel deja envoyes dans la session courante de chaque conversation. */
  private readonly rappelDejaEnvoye = new Map<string, Set<string>>()

  /**
   * Conversations dont la session COURANTE du modele a deja recu la procedure grow entiere
   * (`chat/grow-au-debut.ts`). Session neuve = historique renvoye sans ce bloc : il
   * repart en entier.
   */
  private readonly growDejaEnvoye = new Set<string>()

  /** Même règle pour les règles de travail visuel (`blocVisuelDuTour`, chat-pilotage-prompt.ts). */
  private readonly visuelDejaEnvoye = new Set<string>()

  /**
   * L'index memoire ci-dessus est HYDRATE une fois depuis le disque, puis maintenu en miroir.
   *
   * Sans cela, le gain de la reprise de session s'evaporait a CHAQUE redemarrage de l'app : la `Map`
   * repartait vide, donc le premier tour de chaque conversation re-payait l'historique entier. Le
   * chiffrage est dans le commentaire de `chat()` plus bas (mesure du 2026-07-28 : ~79 k tokens
   * re-payes par tour, 1,85 M de `cache_write` par heure).
   *
   * TOUT est en fail-open : la persistance est un CACHE, jamais une autorite. Un disque plein, un
   * fichier verrouille ou un JSON corrompu doivent couter un renvoi d'historique — cher, jamais faux —
   * et surtout PAS casser le tour de l'utilisateur. D'ou les `try/catch` muets ici, qui seraient une
   * faute sur une frontiere de securite et sont le bon choix sur un cache. Corps des methodes dans
   * `agent-pilot/persistance-entre-tours.ts` (lot 1).
   */
  private chatSessionsHydrated = false

  private hydrateChatSessions(): void {
    if (this.chatSessionsHydrated) return
    this.chatSessionsHydrated = true
    hydraterSessionsDuChat(this.chatSessions)
  }

  private persistChatSession(conversationId: string, key: string, sessionId: string): void {
    persisterSessionDuChat(conversationId, key, sessionId)
  }

  private forgetPersistedChatSession(conversationId: string): void {
    oublierSessionPersistee(conversationId)
  }

  /**
   * Mode CONVERSATION (chat transparent) : l'agent parle À l'utilisateur ET peut
   * piloter l'app dans le même tour. Le texte hors-commande est sa réponse parlée ;
   * les `<cmd>` sont exécutées et rendues comme des actions inline. L'historique
   * complet est réinjecté pour un vrai multi-tours. Un tour peut enchaîner plusieurs
   * itérations (agir → constater → répondre) jusqu'à ce qu'il ne reste plus de commande.
   */
  async chat(
    history: Message[],
    onEvent: (e: PilotEvent) => void,
    ask?: (question: ModelQuestion) => Promise<string>,
    /**
     * Cap d'iterations d'un tour. Releve de 6 a 12 le 2026-07-29 : sur un blocage reel, l'agent avait
     * consomme 4 iterations en `edit_file` rates avant meme de pouvoir chercher une autre voie, puis
     * s'est arrete sur « cap atteint sans reponse finale » — en laissant des mutations partielles.
     * La regle anti-abandon lui demande desormais de CHERCHER, ESSAYER puis NETTOYER : il faut de quoi
     * le faire. Le cout n'est plus borne du tout depuis la suppression du budget du tour
     * (2026-09-16) : il est MESURE et ecrit, jamais coupe.
     */
    maxIter = CAP_ITERATIONS_TOUR,
    conversationId?: string,
    signal?: AbortSignal,
    /** Directives injectées par l'utilisateur PENDANT le tour — drainées à chaque itération. */
    drainDirectives?: () => string[],
    /** Binding figé pour ce tour uniquement (ex. tâche planifiée), sans mutation du rôle global. */
    bindingOverride?: RoleBinding,
    /** Identité causale du tour créée par le contrôleur de chat. */
    turnId?: string,
    /** Snapshot du runtime affiche pour ce tour ; distinct de l'override des commandes orchestrees. */
    runtimeBinding?: RoleBinding,
    /** Appel déjà payé à reprendre sans invoquer une seconde fois le provider. */
    recoveredProviderCall?: RecoveredPilotProviderCall,
    /** Persistance du lien tour → journal avant le spawn d'un chat direct. */
    onProviderJournal?: (link: PilotProviderJournalLink) => void,
    /** Bornes provider propres a ce tour de fond, distinctes des preferences du role. */
    sendLimits?: Pick<SendOptions, 'maxBudgetUsd'> & {
      /** Profil minimal du triage automatique : aucune commande, aucun pipeline, aucun gros kit. */
      systemProfile?: 'watchdog-read-only'
      /**
       * Tour lancé sans humain devant (tâche planifiée, veille). Personne ne répondrait à une
       * question : le contrôle des deux lectures ne joue pas.
       */
      tourDeFond?: boolean
    },
    /** Dernière vraie demande humaine, quand le dernier message transport est une instruction interne. */
    routingUserMessageOverride?: string,
    /** Ce tour REPREND un tour coupe net pour laisser passer le dernier message utilisateur. */
    tourCoupePourCeMessage?: boolean,
    /**
     * Exiger le BLOC DE CLOTURE et l'aveu d'echec — politique d'EXPERIENCE, pas regle du pilote.
     *
     * Demandee par l'utilisateur le 2026-08-15 apres lecture de ses conversations : « y'en a pas une
     * qui a fini avec le bloc fait / a faire, c'est pas du tout l'experience que je veux offrir ».
     *
     * En OPTION plutot qu'en dur, parce qu'elle appartient a la SURFACE de chat et non au coeur du
     * tour : imposee a tous, elle changeait le contrat de tours internes (recuperation, streaming,
     * contrat de tour) dont les fixtures figent un nombre d'appels precis. L'expliciter dit QUI la
     * veut, au lieu de la faire subir a tout le monde.
     */
    exigerExperienceSoignee = false
  ): Promise<void> {
    // Chronométrage des jalons jusqu'au PREMIER token : c'est la latence réellement perçue au clic.
    const timer = startTurnTimer('chat', {
      ...(turnId ? { turnId } : {}),
      ...(conversationId ? { conversationId } : {})
    })
    // Émission du tour (rappel protégé, reprise des échecs, anti-collage) :
    // agent-pilot/emission-du-tour.ts (lot 2).
    const { publier, emit, tourEstClos, armerEchecsAbandonnes } = emetteurDuTour(onEvent)
    const binding = runtimeBinding ?? bindingOverride ?? this.roles.getBinding('orchestrator')
    // Exécution des commandes du tour : agent-pilot/commandes-du-tour.ts (lot 2).
    const { execCommand, execCommandTolerante } = commandesDuTour({
      bus: this.bus,
      conversationId,
      bindingOverride,
      turnId,
      signal
    })
    const provider = binding.provider
    const catalog = this.bus.catalog()
    // Sous-jalons : `snapshot` recouvre trois lectures (runs, bureaux, recensement git). Les
    // marquer sépare la cause de l'effet dans l'onglet Latence de la vue Tests.
    const snapshot = snapshotDuTour(
      await this.bus.snapshotForPrompt((nom) => timer.mark(nom)),
      conversationId
    )
    timer.mark('snapshot')

    const latestUserMessage = resolveLatestUserMessage(history, routingUserMessageOverride)
    // Une continuation réutilise le vrai prompt pour les permissions et le RAG, jamais pour
    // déclencher une seconde fois son raccourci /skill : ce geste exige un nouveau message humain.
    const directRoute =
      routingUserMessageOverride === undefined && latestUserMessage
        ? routeSkillRequest(latestUserMessage)
        : undefined
    // COURT-CIRCUIT reserve a la demande EXPLICITE (« /scout … », « /build … »).
    //
    // L'ancienne branche heuristique (`workspace-action`, deduite d'un verbe + une cible) est RETIREE.
    // MESURE sur 251 messages reels : elle se declenchait 8 fois, dont 6 a tort — precision 25 %,
    // rappel 2 % — alors que le MODELE a decide correctement dans 101 cas. Deviner dans le code
    // court-circuitait `chat()` AVANT le modele, donc aucune consigne de prompt ne pouvait corriger
    // l'erreur : c'est le mecanisme exact de la regression du 2026-07-28, qui etait toujours arme.
    // Une commande explicite, elle, ne devine RIEN : l'utilisateur a nomme la phase.
    // Seule une PHASE nommee (`/scout`, `/build`...) court-circuite vers l'orchestration. Une skill
    // hors pipeline (`/look`, `/think`, `/remake`...) est reconnue comme commande — elle garde le fil
    // courant — mais reste jouee par le MODELE avec le corps de sa skill injecte : la router vers un
    // run payant serait une orchestration que l'utilisateur n'a jamais demandee. `/kaizen` suit
    // cette seconde voie (`courtCircuiteLeModele`).
    const routeSansModele = courtCircuiteLeModele(directRoute)
    // Les deux lectures du tour : agent-pilot/lectures-du-tour.ts (lot 2).
    const {
      deuxLecturesDuTour,
      poserLaQuestionDesLectures,
      fermerSurLaQuestionDesLectures,
      annoncerLaLectureRetenue,
      lancerAvantLeModele,
      lectureRetenue: lectureRetenueDuTour
    } = lecturesDuTour({
      demanderDeuxLectures: this.demanderDeuxLectures,
      routingUserMessageOverride,
      sendLimits,
      latestUserMessage,
      history,
      conversationId,
      emit,
      execCommand,
      tourEstClos
    })
    // Phase nommée : orchestration sans le modèle, agent-pilot/route-directe.ts (lot 2).
    if (routeSansModele) {
      await jouerLaRouteSansModele({
        tache: directRoute?.task ?? '',
        deuxLecturesDuTour,
        fermerSurLaQuestionDesLectures,
        annoncerLaLectureRetenue,
        emit,
        signal,
        execCommand,
        drainDirectives,
        conversationId,
        deposerCompteRendu: (id, texte) => this.deposerCompteRendu(id, texte)
      })
      return
    }
    // Attendue après la recherche Brain si la demande change l'affichage, sinon lue en parallèle.
    const lecturesAvantRendu = lancerAvantLeModele()
    const retrievedContext =
      this.retrieveContext && latestUserMessage
        ? await this.retrieveContext(latestUserMessage, { conversationId, turnId }).catch(() => '')
        : ''
    timer.mark('ragBrain')
    const issueDuRendu = await lecturesAvantRendu
    if (issueDuRendu?.kind === 'question') {
      await fermerSurLaQuestionDesLectures('lectures:0', issueDuRendu.lectures)
      return
    }
    if (issueDuRendu?.kind === 'retenue') annoncerLaLectureRetenue(issueDuRendu)

    // Consigne système, lecture seule et dossier du tour : agent-pilot/systeme-du-tour.ts
    // (lot 2).
    const systeme = systemeDuTour({
      sendLimits,
      conversationId,
      catalog,
      executionWorkspace: (id) => this.executionWorkspace(id),
      projectContext: (id) => this.projectContext(id)
    })

    // Reprise de session CLI et clé de session : agent-pilot/session-du-tour.ts (lot 2).
    const session = sessionDuTour({
      provider,
      binding,
      workspaceDuTour: systeme.workspaceDuTour,
      history,
      conversationId,
      chatSessions: this.chatSessions,
      hydraterSessions: () => this.hydrateChatSessions(),
      oublierSession: (id) => this.forgetPersistedChatSession(id),
      registry: this.registry
    })
    // Message d'ouverture du tour : agent-pilot/message-du-tour.ts (lot 2).
    const ouverture = messageDuTour({
      history,
      conversationId,
      workspaceDuTour: systeme.workspaceDuTour,
      resumeSessionId: session.resumeSessionId,
      snapshot,
      retrievedContext,
      tourCoupePourCeMessage,
      lectureRetenue: lectureRetenueDuTour(),
      bus: this.bus,
      growDejaEnvoye: this.growDejaEnvoye,
      visuelDejaEnvoye: this.visuelDejaEnvoye,
      rappelDejaEnvoye: this.rappelDejaEnvoye,
      dernierEtatPousse: this.dernierEtatPousse,
      consommerCompteRendu: (id) => this.consommerCompteRendu(id)
    })
    // Le fil du tour, mutable : la boucle d'itérations y pousse les échanges suivants.
    const { convo } = ouverture
    // Pièces jointes de tout le fil, la plus récente d'abord : agent-pilot/pieces-jointes-du-fil.ts
    // (lot 2).
    const currentAttachments = piecesJointesDuFil(history)

    // État mutable du tour — drapeaux, compteurs et registres partagés par les closures de la
    // boucle —, regroupé dans agent-pilot/etat-du-tour.ts et lu `etat.<nom>` (lot 3).
    const etat = etatInitialDuTour({
      resumeSessionId: session.resumeSessionId,
      compteAuDepart: session.compteAuDepart,
      blocsDuTour: ouverture.blocsDuTour,
      maxIter,
      conversationId,
      snapshot
    })
    /**
     * T1a — POINT UNIQUE de recovery du cap d'itérations. Avant, `iterationLimit += 1` était
     * dispersé à 4 endroits distincts, chacun avec son propre garde « une seule fois » : ajouter un
     * 5ᵉ cas de recovery obligeait à deviner où placer un nouvel incrément. Chaque site nommé
     * appelle désormais cette fonction avec un motif — la logique d'incrément elle-même ne vit
     * qu'ICI, même si les gardes anti-boucle (`invalidQuestionRecoveryAvailable`, etc.) restent
     * locales à chaque cas puisqu'elles portent un sens métier différent par motif.
     */
    const recoveryReasons: MotifDeRallonge[] = []
    const grantRecoveryIteration = (reason: MotifDeRallonge): void => {
      recoveryReasons.push(reason)
      etat.iterationLimit += 1
    }
    armerEchecsAbandonnes((): void => {
      if (etat.commandesEnEchecNonRattrape.size === 0) return
      publier({
        kind: 'echecs-abandonnes',
        name: 'échecs abandonnés',
        data: [...etat.commandesEnEchecNonRattrape].map((cible) => ({
          actionId: etat.actionIdParEchec.get(cible) ?? '',
          cible
        }))
      })
    })
    // Outils directs du modèle et comptabilité commune des commandes du tour :
    // agent-pilot/appels-natifs.ts (lot 3).
    const natifs = appelsNatifsDuTour({
      etat,
      conversationId,
      provider,
      signal,
      emit,
      execCommandTolerante
    })
    // Texte d'un tour qui se termine, jamais vide : agent-pilot/texte-de-cloture.ts
    // (lot 3).
    const texteDeCloture = (spoken: string): string => texteDeClotureDuTour(etat, spoken)
    // Envoi d'une relance : rallonge du cap, réponse affichée remplacée, consignes poussées dans le
    // fil. Les contrôles qui la décident : agent-pilot/relances-du-tour.ts (lot 4).
    const relancer = (iter: IterationDuTour, relance: Relance): void => {
      grantRecoveryIteration(relance.motif)
      if (relance.remplace) iter.effacerReponseRelancee()
      convo.push(...relance.consignes)
    }
    // Ce que les modules de la boucle lisent du tour : agent-pilot/contexte-du-tour.ts
    // (lot 4).
    const tour: ContexteDuTour = {
      ...systeme,
      ...session,
      ...ouverture,
      ...natifs,
      deuxLecturesDuTour,
      poserLaQuestionDesLectures,
      annoncerLaLectureRetenue,
      lectureRetenue: lectureRetenueDuTour,
      etat,
      emit,
      grantRecoveryIteration,
      execCommandTolerante,
      registry: this.registry,
      chatSessions: this.chatSessions,
      persisterSession: (id, cle, sessionId) => this.persistChatSession(id, cle, sessionId),
      oublierSession: (id) => this.forgetPersistedChatSession(id),
      outilsNatifs: this.outilsNatifs,
      timer,
      provider,
      binding,
      catalog,
      history,
      latestUserMessage,
      currentAttachments,
      conversationId,
      turnId,
      signal,
      drainDirectives,
      recoveredProviderCall,
      onProviderJournal,
      sendLimits,
      exigerExperienceSoignee
    }
    for (let i = recoveredProviderCall?.iteration ?? 0; i < etat.iterationLimit; i++) {
      // Pilotage continu : les directives envoyées PENDANT le tour entrent au prochain
      // point d'itération (priorité immédiate, sans attendre la fin du tour).
      for (const directive of drainDirectives?.() ?? []) {
        convo.push(
          `UTILISATEUR (DIRECTIVE INJECTÉE EN COURS DE TOUR — PRIORITAIRE): ${motsUtilisateur(directive)}`
        )
      }
      // Budget annoncé à mi-parcours, clôture forcée au dernier appel :
      // agent-pilot/relances-du-tour.ts (lot 4).
      convo.push(...consignesDuBudget(etat, i))
      // Envoi au modèle, flux en direct, reprises après erreur et journal de l'appel :
      // agent-pilot/envoi-du-tour.ts (lot 4).
      const { res, iter } = await appelDuModele(tour, i)
      // Directive arrivée pendant l'appel, artefacts livrés : agent-pilot/reponse-du-tour.ts
      // (lot 4).
      if (reinjecterLesDirectivesTardives(tour, res)) continue
      await publierLesArtefacts(tour, i, res)
      /**
       * Le texte du provider, NORMALISE une fois pour toutes.
       *
       * Un provider peut ne rien rendre — et le tour ne doit pas PLANTER pour autant. Constate le
       * 2026-08-15 : une relance de forme supplementaire epuisait la reponse d'un test, et le pilote
       * tombait successivement sur `.replace`, puis `.slice`, d'un `undefined`. Rustiner chaque usage
       * aurait laisse le suivant exploser ; on assainit donc a la SOURCE. L'absence de texte reste un
       * cas METIER, traite par la garde du tour muet, pas une panne d'interpreteur.
       */
      const texteProvider = res.text ?? ''
      // Seule une balise POSÉE est refusée : citée dans du code, elle reste du texte.
      const rejectedQuestion = contientUneQuestionPosee(texteProvider)
      const text = masquerLesQuestionsPosees(texteProvider, REJECTED_QUESTION_MARKER).trim()
      const question = parseModelQuestion(text)
      if (question && ask) {
        const answer = await waitForAnswer(ask(question), signal)
        convo.push(`TOI: ${text}`)
        convo.push(`UTILISATEUR: ${motsUtilisateur(answer)}`)
        continue
      }
      if (!question && rejectedQuestion) {
        convo.push(...CONSIGNES_QUESTION_REFUSEE)
        const relance = relanceQuestionRefusee(etat)
        if (relance) {
          relancer(iter, relance)
          continue
        }
        // JAMAIS de bulle vide : une question refusee + reprises epuisees laissait l'utilisateur
        // devant un message VIDE, sans savoir ce qui s'etait passe.
        emit({
          kind: 'done',
          text:
            'Je n’ai pas pu poser de question recevable et j’ai epuise les reprises — ' +
            'je m’arrete sans solliciter l’utilisateur.',
          usage: etat.usage
        })
        return
      }

      // Jetons et texte parlé, refus d'une commande en lecture seule : agent-pilot/reponse-du-tour.ts
      // (lot 4).
      const { ordered, hasCommand, spoken, onlyAuxiliaryRemember } = lireLaReponse(
        tour,
        iter,
        texteProvider
      )
      if (fermerSiLectureSeuleEnfreinte(tour, ordered, hasCommand, spoken)) return

      if (!hasCommand) {
        const blocsIllisibles = afficherLaReponseSansCommande(tour, iter, ordered, spoken)
        // UNE relance part : la première qui s'applique, dans cet ordre, chacune bornée par son
        // propre crédit. Contrôles : agent-pilot/relances-du-tour.ts (lot 4).
        const relance =
          relanceCommandeIllisible(etat, blocsIllisibles, texteProvider) ??
          relanceTourMuet(etat) ??
          relanceOutilPretenduAbsent(tour) ??
          relanceAnnonceSansAction(tour) ??
          relanceCorrectionApresEchec(tour) ??
          relanceEchecTaise(tour) ??
          relanceGesteRendu(tour) ??
          relancePreuveAbsente(tour) ??
          relancePreuvePromise(tour) ??
          relanceBlocVisuelNonFerme(tour) ??
          relanceConclusionAbsente(tour) ??
          relanceCheminsIncomplets(tour) ??
          relanceQuestionSansLecture(etat) ??
          relanceChiffreNonVerifie(tour)
        if (relance) {
          relancer(iter, relance)
          continue
        }
        // JAMAIS de bulle vide. Cause racine des « conversations qui echouent » :
        // le tour a AGI (« [a execute exec (echec)] ») mais n'a rien DIT, la reprise de conclusion
        // etait deja consommee, et `spoken` vide produisait une bulle VIDE — l'utilisateur renvoyait
        // alors le meme prompt en boucle sans jamais savoir ce qui ratait.
        emit({
          kind: 'done',
          // Un tour MUET apres une orchestration retombe sur son compte-rendu, jamais sur du vide :
          // le resultat est paye, il doit s'afficher meme si le modele n'a rien redige.
          text: spoken.trim()
            ? texteDeCloture(spoken)
            : (etat.compteRenduOrchestration ?? texteDeCloture(spoken)),
          ...(etat.orchestrationOutcome ? { outcome: etat.orchestrationOutcome } : {}),
          usage: etat.usage
        })
        return
      }

      // Exécution des `<cmd>` de la réponse : agent-pilot/execution-des-commandes.ts
      // (lot 4).
      const results = await executerLesCommandes(tour, iter, ordered)

      // `remember` est une écriture auxiliaire : son résultat est déjà visible dans la carte action.
      // Quand le modèle a livré sa réponse dans le même message, repayer une génération uniquement
      // pour commenter un refus déterministe (type/locator/SHA) ne peut améliorer le travail rendu.
      // Ses trois contrôles, dans cet ordre : agent-pilot/relances-du-tour.ts (lot 4).
      const rallongeDuRaccourci =
        relanceClotureApresRemember(tour, onlyAuxiliaryRemember, spoken) ??
        relanceRepriseRemember(etat, onlyAuxiliaryRemember) ??
        relanceCheminsApresRemember(tour, onlyAuxiliaryRemember, spoken)
      if (rallongeDuRaccourci) {
        grantRecoveryIteration(rallongeDuRaccourci)
      } else if (onlyAuxiliaryRemember) {
        // Le modele a livre sa reponse ET sauve une memoire. On emettait VIDE — donc on JETAIT son
        // texte reel, laissant une bulle vide. `spoken` est garanti non vide ici.
        emit({
          kind: 'done',
          text: etat.refusRememberAuxiliaire
            ? `${spoken}

⚠️ Mémoire NON déposée — ${etat.refusRememberAuxiliaire}`
            : spoken,
          usage: etat.usage
        })
        return
      }

      /*
       * UNE QUESTION CLOT LE TOUR.
       *
       * `ask` ne suspendait rien : la commande rendait la question et le pilote enchainait. La
       * conversation restait donc OCCUPEE, et repondre passait par une DIRECTIVE -- affichee
       * « ORIENTÉ », avec un composer bloque sur « Orienter l'agent sans l'interrompre ». Vecu
       * L'utilisateur repondait a une question et le systeme enregistrait une
       * orientation. Toute cette gymnastique n'existait que parce qu'un `ask` ne terminait pas le tour.
       *
       * L'agent vient de dire qu'il lui manque une entree : son tour est fini, c'est celui de
       * l'utilisateur. La conversation cesse d'etre occupee, donc la reponse arrive comme un message
       * ORDINAIRE. On ne fait attendre PERSONNE -- pas de run suspendu, pas de delai a choisir, pas
       * d'echappatoire a prevoir.
       *
       * APRES l'execution de l'iteration, jamais a la rencontre du token : le modele peut poser une
       * question ET avoir produit du travail utile dans le meme souffle. On clot apres le travail, on
       * ne l'annule pas.
       *
       * LA GARDE « question sans lecture » PASSE DEVANT, et ce n'est pas un detail : elle vit dans la
       * branche SANS commande, donc cloturer ici sans la consulter la rendrait INATTEIGNABLE -- on
       * aurait echange un defaut contre un autre. Un modele qui questionne sans avoir rien lu est
       * donc relance, comme avant ; on ne clot que la question legitime.
       */
      if (etat.questionPoseeCeTour) {
        if (etat.questionDesLecturesPosee) {
          // Le modèle avait annoncé le run : la clôture dit qu'il n'est pas parti, et pourquoi.
          emit({
            kind: 'done',
            text: [spoken.trim() ? texteDeCloture(spoken) : '', AVIS_DEUX_LECTURES]
              .filter(Boolean)
              .join('\n\n'),
            usage: etat.usage
          })
          return
        }
        const relance = relanceQuestionSansLecture(etat)
        if (relance) {
          relancer(iter, relance)
          continue
        }
        emit({
          kind: 'done',
          // Un tour MUET apres une orchestration retombe sur son compte-rendu, jamais sur du vide :
          // le resultat est paye, il doit s'afficher meme si le modele n'a rien redige.
          text: spoken.trim()
            ? texteDeCloture(spoken)
            : (etat.compteRenduOrchestration ?? texteDeCloture(spoken)),
          ...(etat.orchestrationOutcome ? { outcome: etat.orchestrationOutcome } : {}),
          usage: etat.usage
        })
        return
      }

      const state = snapshotDuTour(await this.bus.snapshotForPrompt(), conversationId)
      const bloc = blocEtatSuivant(etat.dernierEtatEnvoye, state)
      etat.dernierEtatEnvoye = state
      convo.push(`TU AS ÉMIS: ${text}`)
      convo.push(`RÉSULTATS:\n${results.join('\n')}\n\n${bloc}`)
      // Consignes laissées par le raccourci `remember` : agent-pilot/relances-du-tour.ts
      // (lot 4).
      for (const differee of consignesDifferees(etat)) {
        if (differee.remplace) iter.effacerReponseRelancee()
        convo.push(differee.consigne)
      }
    }
    // Cap atteint sans réponse finale : agent-pilot/texte-de-cloture.ts (suite du plan).
    fermerAuCapDesIterations(etat, emit)
  }
}
