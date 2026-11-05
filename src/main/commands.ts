import { filtrerListeBrain, type Condenseur } from './brain-condenseur'
import { dossierDeTravailDuTour } from './bascule-dossier-conversation'
import { avecDossierDuTour, dossierDuTourCourant } from './dossier-du-tour-courant'
import {
  existsSync,
  writeFileSync
} from 'node:fs'
import { brainCorpusForWorkspace, scopeBrainRetrieval } from './brain-corpus-scope'
import { buildBrainOutcome, decideBrainQuery, type BrainQueryOutcome } from './brain-query-command'
import {
  demarrerBrainPerso,
  envDuBrainPerso,
  fusionnerListesBrain
} from './brain-perso'
import { retrieveBrainContext } from './brain-retrieval'
import {
  type VerifyOutcome
} from './verify-command'
import { refusAvecIssue } from './issue-de-refus'
import { rappelDesEchangesPasses } from './rappel-conversations'
import type { VerificationAvantPublication } from './run-autoclose'
import type { AutowinOS } from './os'
import type { ActiveChatTurns } from './active-chat-turns'
import { arreterLesTravauxDuFil } from './arret-avant-suppression'
import type { Message } from './providers/types'
import type { RoleBinding } from './roles'
import { appendBrainTrace } from './activity/brain-trace-spool'
import {
  blocMessagesPourTour,
  ecrireAUnFil,
  type ContexteFils
} from './messages-entre-fils-app'
import type { CoordinateurDesPlans } from './plans-de-lots-app'
import { SEUIL_ARCHIVE_MS } from './store/conversations-disk'
import {
  type TaskCreateDeps
} from './task-manager/task-create-command'
import { preparerVideoAMontrer } from './show-video-command'
import { preparerBlocAMontrer } from './montrer-bloc-command'
import type { PorteProd } from './prod-gate'
import type { GuichetProd } from './prod-guichet'
import type {
  TicketCreateRequest,
  TicketGetRequest,
  TicketUpdateRequest
} from './ticket-providers/provider-contract'
import type { TicketItem, TicketListRequest, TicketSourceProfile } from '../shared/tickets'
import { type AppDestination } from '../shared/navigation'
import type { TraceStore } from './activity/trace-store'
import type { DesktopController } from './desktop-control'
import type {
  DemandeFermeture,
  EntreeRegistre,
  GesteElement,
  GesteTv,
  ImageTv,
  ResultatFermeture,
  ResultatGeste
} from './hdesk-tv'
import type { DemandeCreationBureau, ResultatCreationBureau } from '../shared/hdesk-gestion'
import type {
  ActionAgentNavigateur
} from '../shared/navigateur'
import {
  OutcomeLearningSupervisor,
  type OutcomeLearningResult
} from './outcome-learning-supervisor'
import {
  type IndependentLearningAttestation
} from './outcome-learning-proposal'

// Le code libre du bus vit dans commands/*.ts (conv-1580, lot 5) ; ré-exporté pour les appelants.
export type { CommandSpec, CommandResult, AppSnapshot, PromptSnapshot, AppEvent } from './commands/types'
import type { CommandSpec, CommandResult, AppSnapshot, PromptSnapshot, AppEvent } from './commands/types'
import { DEFAULT_COMMAND_ANNOTATIONS } from './commands/types'
export { ligneDeSkill, skillsInvocables } from './commands/skills'
export { parseDisplayArg, listeEnvoyee, argumentAbsent, entierEnvoye, booleenEnvoye } from './commands/arguments'
import { parseDisplayArg } from './commands/arguments'
export { demandeEcranReel } from './commands/refus'
import { refusEcranReel, refusActionSansDemande, demandeEcranReel, assumeEcranReel } from './commands/refus'
export { actionFingerprint } from './commands/rejeu'
import { actionFingerprint, OUTILS_REFUSES_SI_REJEU_APRES_ECHEC, avecNoteDeRejeu, redactedArgs } from './commands/rejeu'
import type { RejeuConnu } from './commands/rejeu'
export type { NavigateurDeLAgent, TerminalDeLAgent } from './commands/navigateur-terminal'
import type { NavigateurDeLAgent, TerminalDeLAgent, OutilNavigateur } from './commands/navigateur-terminal'
import { estOutilNavigateur } from './commands/navigateur-terminal'
export { ORCHESTRATE_PHASES, isolateWatchdogPromptPaths, watchdogEvidenceIdentity } from './commands/orchestration-entrees'
export { circonstanceDePublication, restaurer } from './commands/publication'
import type { MesureVerifiee } from './commands/publication'

// Le catalogue vit dans commands/catalogue.ts (conv-1508, lot 2) ; ré-exporté pour les appelants.
export { CATALOG, TRANCHE_MESSAGE_LU } from './commands/catalogue'
import { CATALOG } from './commands/catalogue'

import { executerInterface } from './commands/interface'
import { executerOrchestration } from './commands/orchestration'
import { executerConversations } from './commands/conversations'
import { executerApplication } from './commands/application'
import { executerOutilsMetier } from './commands/outils-metier'
import { executerMemoire } from './commands/memoire'
import { executerFichiers } from './commands/fichiers'
import { executerFils } from './commands/fils'
import * as fichiersDuBus from './commands/fichiers'
import * as verificationAvantPublication from './commands/verification-avant-publication'
import * as verificationDuBus from './commands/verification'
import * as editionIsolee from './commands/edition-isolee'
import * as outilsBureauNavigateur from './commands/outils-bureau-navigateur'
import * as instantanes from './commands/instantanes'
import * as apprentissage from './commands/apprentissage'

export class AppCommandBus {
  /**
   * La vue d'OUVERTURE, et elle doit etre la meme que celle du renderer.
   *
   * Le renderer ouvre sur `accueil` ; laisser `chat` ici faisait diverger les deux cotes tant que
   * l'utilisateur n'avait pas navigue une premiere fois — un agent qui lisait `appState().tab`
   * croyait donc l'app sur le chat alors qu'elle affichait l'accueil. Verifie hors-modele par
   * `autowin-cdp-proof.mjs --verify-navigation`, qui compare exactement ces deux valeurs.
   */
  /** @internal (conv-1508) */ tab: AppDestination = 'accueil'
  /** @internal (conv-1508) */ traceStore?: TraceStore
  /** Hook de traçage (ledger) — chaque commande exécutée y laisse une ligne. */
  trace?: (name: string, args: Record<string, unknown>, ok: boolean) => void
  /** Conversation active (contexte posé par le chat) : les workflows créés s'y rattachent. */
  activeConversationId?: string
  /** Orchestrations en vol, par conversation : permet de STOPPER le sous-agent. */
  private readonly activeOrchestrations = new Map<string, AbortController>()
  /**
   * Rang d'appel des orchestrations, par conversation. L'AbortController n'est armé qu'APRÈS un
   * préambule asynchrone : deux lancements rapprochés sur la même conversation peuvent l'atteindre
   * dans l'ordre INVERSE de leur appel. Sans ce rang, le run le plus ANCIEN écrasait l'entrée du
   * plus récent, puis la supprimait dans son `finally` (la garde d'identité ne voit rien : l'entrée
   * courante est bien la sienne) → le bouton Stop du run en cours devenait un no-op silencieux.
   */
  /** @internal (conv-1508) */ orchestrationRank = 0
  private readonly orchestrationRankByConv = new Map<string, number>()

  /** Arme le Stop pour ce run — sauf si un lancement PLUS RÉCENT a déjà pris la place. */
  /** @internal (conv-1508) */ claimOrchestration(convId: string, rank: number, controller: AbortController): void {
    if ((this.orchestrationRankByConv.get(convId) ?? 0) > rank) return
    this.orchestrationRankByConv.set(convId, rank)
    this.activeOrchestrations.set(convId, controller)
  }
  /** Déduplique un même lancement tant que son orchestration est encore en vol. */
  /** @internal (conv-1508) */ readonly activeOrchestrationByFingerprint = new Map<
    string,
    Promise<{ path: string; reused: boolean } | undefined>
  >()
  /** Sérialise écriture → snapshot → journal : aucune autre conversation ne peut s'intercaler. */
  /** @internal (conv-1580) */ editFileTail: Promise<void> = Promise.resolve()

  /**
   * Abort l'orchestration (sous-agent/juge) en cours pour une conversation.
   *
   * La RAISON est obligatoire, et ce n'est pas une politesse. Mesure sur conv-1369 : un run de 28 min
   * s'est termine par « [abort] claude CLI interrompu : raison non rapportee par l'appelant », et
   * l'application ne pouvait pas dire a l'utilisateur pourquoi son travail avait ete coupe. Le motif
   * existait UNE LIGNE plus haut chez l'appelant (`os:pilotChat:cancel` passe deja 'user' au tour de
   * chat) et il etait jete ici — or c'est CE signal-la que le provider observe.
   *
   * Rendre le parametre obligatoire plutot que facultatif est delibere : un defaut par defaut se
   * reintroduit au prochain appelant, en silence.
   */
  abortOrchestration(convId: string, reason: string): boolean {
    const controller = this.activeOrchestrations.get(convId)
    if (!controller) return false
    controller.abort(reason)
    return true
  }

  /**
   * Arrête le tour et le run du fil `id` avant sa suppression par l'agent (conv-1060). `appelant` est
   * le fil du tour qui supprime ; sans lui, le fil actif. S'il s'agit du même fil, le tour est coupé
   * SANS être attendu : il attend lui-même la fin de cet appel.
   */
  /** @internal (conv-1508) */ arreterAvantSuppression(id: string, appelant: string | undefined): Promise<void> {
    return arreterLesTravauxDuFil(
      id,
      { couperLeRun: (fil, motif) => this.abortOrchestration(fil, motif), tours: this.toursDeChat },
      id === (appelant ?? this.activeConversationId)
    )
  }

  /** Nombre d'orchestrations en vol : la relance automatique du moteur attend qu'il tombe à zéro. */
  orchestrationsEnVol(): number {
    return this.activeOrchestrations.size
  }

  /**
   * Abort + vide TOUTES les orchestrations en vol. Appelé par le filet de crash global : sur une
   * exception non catchée, le `finally` du handler os:orchestrate ne s'exécute pas → sans ça, les
   * AbortControllers resteraient dans le registre et `abortOrchestration` deviendrait un no-op
   * permanent jusqu'au redémarrage. (Faithful minor.)
   */
  abortAllOrchestrations(
    reason = 'filet de crash : exception non catchee dans le process principal'
  ): void {
    for (const controller of this.activeOrchestrations.values()) {
      try {
        controller.abort(reason)
      } catch {
        /* best-effort : couper les autres même si l'un jette */
      }
    }
    this.activeOrchestrations.clear()
    this.orchestrationRankByConv.clear()
    this.activeOrchestrationByFingerprint.clear()
  }

  /**
   * Enregistre une orchestration STOPPABLE dans le MÊME registre que le chemin `commands.ts` interne,
   * pour que `abortOrchestration(convId)` puisse la couper. Utilisé par le handler IPC direct
   * `os:orchestrate` (#2) qui, sinon, ne câblait aucun AbortController → bouton annuler no-op.
   * Retourne le controller dont il faut passer `.signal` à `runTask`. Toujours appeler
   * `clearOrchestration(convId)` en `finally`.
   */
  registerOrchestration(convId: string): AbortController {
    // Coupe une orchestration précédente laissée pendante sur la même conversation avant d'en armer une.
    // Le motif est DIT : c'est precisement l'hypothese que le diagnostic suggerait a l'utilisateur
    // (« verifie qu'un second lancement n'a pas interrompu le premier ») sans pouvoir la confirmer.
    this.activeOrchestrations
      .get(convId)
      ?.abort('remplacee par un nouveau lancement sur la meme conversation')
    const controller = new AbortController()
    this.claimOrchestration(convId, ++this.orchestrationRank, controller)
    return controller
  }

  /**
   * Retire l'orchestration du registre (à appeler en finally). Ne supprime QUE si l'entrée courante
   * est bien CE controller : si un run plus récent (même conversation) l'a remplacé entre-temps, on
   * ne doit pas effacer son entrée (sinon son cancel deviendrait un no-op silencieux). (Corrector #2.)
   */
  clearOrchestration(convId: string, controller?: AbortController): void {
    if (controller && this.activeOrchestrations.get(convId) !== controller) return
    this.activeOrchestrations.delete(convId)
    this.orchestrationRankByConv.delete(convId)
  }

  setTraceStore(traceStore: TraceStore): void {
    this.traceStore = traceStore
  }

  /** Corps : `commands/apprentissage.ts` (conv-1580, lot 6). */
  observeOutcomeLearning(input: {
    conversationId: string
    turnId: string
    runId: string
    resultText: string
    valid: boolean
    gateBlocked: boolean
    gateReasons: string[]
    reused: boolean
    evidence: import('./providers/types').ExecutionEvidence[]
    model?: string
    role?: string
    terminalClass?: 'delivered' | 'defect' | 'external' | 'expected-negative' | 'indeterminate'
    proposalAttestations?: IndependentLearningAttestation[]
  }): Promise<OutcomeLearningResult | undefined> {
    return apprentissage.observeOutcomeLearning(this, input)
  }

  /**
   * SKILL `save` INTÉGRÉE AU WORKFLOW (demande utilisateur du 14/08) : après un run VERT dont la
   * publication Git est acquise, l'app propose la mise à jour de l'EMPREINTE du dépôt — dans une
   * conversation VISIBLE, jamais en tâche muette. Câblé tardivement depuis index.ts (le runtime des
   * conversations n'existe pas encore quand le bus est construit), même motif que les fermetures
   * Tickets ci-dessous. Absent → aucun save, jamais d'erreur.
   */
  onRunVertPublie?: (resume: { task: string; publishedCommitSha: string }) => void

  /**
   * Nettoyage des SATELLITES d'une conversation supprimée (artefacts de chat, trace causale, appels
   * de prompt). Le canal IPC `os:conversations:remove` le faisait déjà ; la commande agent
   * `remove_conversation` retirait la conversation SEULE et laissait ces fichiers sur le disque.
   * Câblé tardivement depuis index.ts. Absent → la conversation part quand même, sans nettoyage.
   */
  onConversationRemoved?: (id: string) => void

  /**
   * Redemarrage REEL de l'application, cable tardivement depuis index.ts (le bus ne connait ni
   * Electron ni le lanceur dev). Absent -> `restart_app` annonce l'indisponibilite au lieu de
   * promettre une relance qui n'arrivera pas.
   */
  redemarrerApp?: () => void

  /**
   * Conversations dont un tour de chat est EN VOL, câblé depuis index.ts. Absent -> `restart_app`
   * ne voit que les orchestrations et garde son redémarrage immédiat.
   */
  conversationsEnVol?: () => string[]

  /**
   * Les tours de chat en vol, câblés depuis index.ts : `remove_conversation(s)` les coupe avant de
   * supprimer, comme le fait l'écran (conv-1060, `arret-avant-suppression.ts`). Absent -> seul le
   * run du fil est coupé.
   */
  toursDeChat?: Pick<ActiveChatTurns, 'abort' | 'abortAndWait'>

  /**
   * FILE DE REDÉMARRAGE (`relance-auto-moteur.ts`, `mettreEnFile`) : relance au prochain repos, après
   * préavis. Rend `false` si la file n'existe pas (version installée, relance auto désactivée).
   * Conv-304, tour 48eb0f5b-a0df-4028-876a-557d9c7e88eb : sans elle, `restart_app` coupait conv-303
   * et l'agent a renvoyé le choix à l'utilisateur au lieu de redémarrer.
   */
  redemarrerAuRepos?: (demande: { cause: string; avantRelance?: () => void }) => boolean

  /**
   * Fermeture d'un bureau caché (`bureau_cache_fermer`), câblée tardivement depuis index.ts sur
   * `fermerHdesk` : le bus ne connaît pas le chemin des scripts de l'app installée. Absent ->
   * l'outil annonce l'indisponibilité au lieu de prétendre avoir fermé.
   */
  fermerBureauCache?: (demande: DemandeFermeture) => Promise<ResultatFermeture>

  /**
   * Outils `bureau_cache_lancer / observer / agir` (conv-344), câblés depuis index.ts sur
   * `creerBureau`, le processus de capture et `agirHdesk`. `ficheBureauCache` lit la fiche du
   * registre : observer et agir refusent un bureau sans fiche ou d'un autre fil. Absents -> l'outil
   * annonce l'indisponibilité.
   */
  lancerBureauCache?: (demande: DemandeCreationBureau) => Promise<ResultatCreationBureau>
  /** L'image, et l'arbre d'accessibilité en texte quand il a pu être lu (conv-1457, hdesk-arbre.ts). */
  observerBureauCache?: (id: string) => Promise<ImageTv & { arbre?: string }>
  agirBureauCache?: (geste: GesteTv | GesteElement) => Promise<ResultatGeste>
  ficheBureauCache?: (id: string) => EntreeRegistre | undefined

  /**
   * Outils `navigateur_*` (conv-1286, lot 4/5), câblés depuis index.ts sur
   * `gestionnaireNavigateur()` : redemandé à CHAQUE appel, la fenêtre principale rouverte en porte
   * un neuf. Absent, ou `null` (fenêtre fermée) -> l'outil annonce l'indisponibilité.
   */
  navigateur?: () => NavigateurDeLAgent | null

  /**
   * Outil `terminal_lire` (conv-1362, lot 3/3), câblé depuis index.ts sur `gestionnaireTerminal()`.
   * Absent, ou `null` -> l'outil annonce l'indisponibilité.
   */
  terminal?: () => TerminalDeLAgent | null

  /**
   * Lance un VRAI tour dans une conversation NOMMEE, cable tardivement depuis index.ts sur la
   * meme capacite que les taches planifiees (`runPrompt`). Absent -> `chat_send` refuse la
   * destination au lieu de faire croire qu'un fil a recu le message.
   */
  lancerDansConversation?: (
    conversationId: string,
    prompt: string,
    /** Modele du tour — absent : le tour suit l'orchestrateur, comme avant. */
    binding?: { provider: string; model: string }
  ) => Promise<{ ok: boolean; turnId?: string; error?: string }>

  /** Existence REELLE d'une conversation, cablee depuis index.ts. */
  conversationExiste?: (conversationId: string) => boolean

  /**
   * Un tour de chat tourne-t-il REELLEMENT dans cette conversation ? Cable tardivement depuis
   * index.ts sur `activeChatTurns`, la meme autorite que la sonde du renderer. Absent -> aucune
   * conversation n'est declaree en vol (fail-closed : on ne PROMET pas une vie qu'on ne sait pas
   * verifier).
   */
  tourDeChatActif?: (conversationId: string) => boolean

  /**
   * Coordinateur des plans de lots (conv-1150), câblé tardivement depuis index.ts. Absent -> refus.
   * `lancerParOrdre` (conv-1284) : l'ordre d'un chef vers un lot bloqué vaut relance du lot.
   */
  plansDeLots?: Pick<CoordinateurDesPlans, 'outil' | 'lancerParOrdre'>

  /**
   * Le Task Manager (stockage, minuteur, rafraîchissement de l'écran), câblé TARDIVEMENT depuis
   * index.ts : le minuteur n'existe qu'après la construction du bus. Absent -> `task_create` refuse.
   */
  taskManager?: TaskCreateDeps

  /**
   * Condensé des notes lues par `brain_read` (conv-1469, `brain-condenseur.ts`), câblé depuis
   * index.ts. Absent -> la note part entière, comme avant.
   */
  condenseurBrain?: Condenseur

  constructor(
    /** @internal (conv-1508) */ readonly os: AutowinOS,
    /** @internal (conv-1508) */ readonly broadcast: (e: AppEvent) => void,
    /** @internal (conv-1508) */ readonly onChat?: (
      provider: string | undefined,
      role: string | undefined,
      msg: string
    ) => Promise<string>,
    private readonly isCommandEnabled: (name: string) => boolean = () => true,
    private readonly retrieveBrain: typeof retrieveBrainContext = retrieveBrainContext,
    /**
     * Sources Tickets configurées, relues à CHAQUE appel : le modèle nomme au plus un `sourceId`,
     * jamais un profil. Défaut vide → `ticket_create` refusera en disant de configurer une source.
     */
    /** @internal (conv-1508) */ readonly listTicketSources: () => readonly TicketSourceProfile[] = () => [],
    /** Créateur réel, câblé depuis index.ts. Absent → la commande annonce l'indisponibilité. */
    /** @internal (conv-1508) */ readonly createTicket?: (request: TicketCreateRequest) => Promise<TicketItem>,
    /** Lecture réelle des tickets, câblée depuis index.ts. Absente → la commande annonce l'indisponibilité. */
    /** @internal (conv-1508) */ readonly listTickets?: (
      request: TicketListRequest
    ) => Promise<{ items: TicketItem[]; hasMore: boolean; cursor?: string }>,
    /** Lecture d'UNE fiche par id, câblée depuis index.ts. */
    /** @internal (conv-1508) */ readonly getTicket?: (request: TicketGetRequest) => Promise<TicketItem>,
    /** Controle Windows local, reserve aux commandes explicites du chat. */
    /** @internal (conv-1508) */ readonly desktop?: DesktopController,
    /** Retour réel vers une fiche existante, câblé depuis index.ts. */
    /** @internal (conv-1508) */ readonly updateTicket?: (request: TicketUpdateRequest) => Promise<TicketItem>,
    /**
     * Chemin de `sqlcmd`, résolu au démarrage. Absent → `sql_query` annonce l'indisponibilité au lieu
     * de tenter un binaire inexistant.
     *
     * Ajouté EN DERNIER lors de la fusion de `main` : les paramètres de ce constructeur sont
     * positionnels, donc l'insérer avant `desktop`/`updateTicket` aurait décalé tous les sites d'appel
     * de l'amont — mes valeurs auraient pris la place des leurs, sans que le typage s'en plaigne
     * forcément.
     */
    private readonly sqlcmdPath?: string,
    /** Ledger causal des leçons de run. Dernier paramètre pour préserver les appels positionnels. */
    /** @internal (conv-1508) */ readonly outcomeLearning?: OutcomeLearningSupervisor,
    /**
     * LE POINT DE PASSAGE DE PRODUCTION (`prod-gate.ts`). Absent → rien ne change : les gardes
     * historiques s'appliquent seules. Présent → il décide, AVANT toute connexion, si la cible exige
     * une autorisation saisie par l'utilisateur.
     *
     * Ajouté en DERNIER, comme `sqlcmdPath` avant lui et pour la même raison : les paramètres de ce
     * constructeur sont positionnels, l'insérer plus haut décalerait silencieusement les appels.
     */
    /** @internal (conv-1508) */ readonly porteProd?: PorteProd,
    /**
     * LE GUICHET (`prod-guichet.ts`) : au refus de la porte, il ouvre l'écran de saisie chez
     * l'utilisateur et attend le jeton, puis le geste est rejoué. Absent → le refus part tel quel.
     * Positionnel lui aussi, donc ajouté APRÈS `porteProd`.
     */
    /** @internal (conv-1508) */ readonly guichetProd?: GuichetProd
  ) {}

  /**
   * Le signal d'arret du TOUR DE CHAT en cours sur une conversation, cable depuis `index.ts`.
   *
   * Propriete assignable plutot que parametre du constructeur : celui-ci est POSITIONNEL, et son
   * propre commentaire (cf. `sqlcmdPath`) rappelle qu'y inserer un argument decale silencieusement
   * tous les sites d'appel de l'amont.
   *
   * Non cable -> `undefined` -> comportement d'avant, a l'identique : la commande n'est bornee que
   * par son horloge. C'est ce qui rend ce branchement sur : il ne peut rien casser par son absence.
   */
  signalDuTour?: (conversationId: string) => AbortSignal | undefined

  /**
   * Chemin de `sqlcmd`, choisi AU MOMENT DE L'APPEL et non au demarrage.
   *
   * DEFAUT VECU (conv-152, 2026-09-02) : `sqlcmd` etait absent du poste, donc `sql_query` repondait
   * « non localise sur ce poste ». Installe puis ajoute au PATH utilisateur, il restait INVISIBLE :
   * une modification du PATH ne se propage jamais aux processus deja lances, et le redemarrage passe
   * par le lanceur, qui herite de l'ancien environnement. Le chemin resolu une seule fois au
   * demarrage etait donc DEFINITIVEMENT vide pour toute la vie du process.
   *
   * `AUTOWIN_SQLCMD_BIN` (rechargeable a chaud, cf. `env-reload.ts`) permet de DESIGNER le binaire
   * sans redemarrer — meme motif que `CODEX_BIN`. L'existence du fichier
   * est verifiee : un reglage qui pointe a cote doit laisser la main a la resolution par le PATH,
   * jamais faire echouer l'appel sur un binaire fantome.
   */
  /** @internal (conv-1508) */ cheminSqlcmd(): string | undefined {
    const designe = process.env.AUTOWIN_SQLCMD_BIN?.trim()
    if (designe && existsSync(designe)) return designe
    return this.sqlcmdPath
  }

  /**
   * Les echanges passes que la demande suppose connus, prets a etre injectes dans le tour.
   *
   * Passe par le bus plutot que d'exposer le store : l'appelant (`agent-pilot`) n'a pas a connaitre
   * la forme des conversations pour poser une question aussi simple que « de quoi parle-t-on ».
   */
  rappelPourDemande(demande: string | undefined, conversationCouranteId?: string): string {
    try {
      // Le fournisseur de la conversation COURANTE borne le rappel : on ne rappelle que ce qui a
      // deja ete servi par lui. Inconnu -> aucun rappel (voir `rappelDesEchangesPasses`).
      const courante = conversationCouranteId
        ? this.os.conversations.get(conversationCouranteId)
        : undefined
      return rappelDesEchangesPasses(
        this.os.conversations,
        demande,
        conversationCouranteId,
        courante?.provider,
        courante?.projectPath ?? undefined
      )
    } catch {
      // Un rappel est un CONFORT : s'il echoue, le tour doit partir quand meme. L'inverse ferait
      // dependre chaque message d'une commodite.
      return ''
    }
  }

  catalog(): CommandSpec[] {
    return CATALOG.filter((command) => this.isCommandEnabled(command.name)).map((command) => ({
      ...command,
      annotations:
        command.annotations ??
        (command.name === 'get_state'
          ? { ...DEFAULT_COMMAND_ANNOTATIONS, readOnlyHint: true, idempotentHint: true }
          : DEFAULT_COMMAND_ANNOTATIONS)
    }))
  }

  /** Corps : `commands/instantanes.ts` (conv-1580, lot 6). */
  snapshot(jalon?: (nom: string) => void): Promise<AppSnapshot> {
    return instantanes.snapshot(this, jalon)
  }

  /** Corps : `commands/instantanes.ts` (conv-1580, lot 6). */
  /** @internal (conv-1580) */ jalonne<T>(jalon: ((nom: string) => void) | undefined, nom: string, lecture: () => T): T {
    return instantanes.jalonne<T>(jalon, nom, lecture)
  }

  /*
   * LA CONSIGNE SE DIT UNE FOIS PAR TRAVAIL, PAS A CHAQUE TOUR.
   *
   * Defaut vecu le 2026-09-04 (« je passe ma vie a /salvage »). Ce champ etait pose des que la file
   * n'etait pas vide, donc REPETE a chaque tour, dans chaque conversation, tant que l'utilisateur
   * n'avait pas tout trie. Ce n'etait meme plus lui qui decidait d'ecrire `/salvage` : l'application
   * le lui remettait sous le nez indefiniment. Une consigne qui revient sans fin n'est plus une
   * consigne, c'est un bruit de fond — et on finit par la lire en diagonale, ce que le commentaire
   * d'origine redoutait deja pour une regle permanente.
   *
   * La consigne parle donc au moment ou elle APPREND quelque chose : un travail JAMAIS annonce. Un
   * travail deja presente et laisse de cote est une decision prise, on ne la redemande pas. Un
   * travail NOUVEAU rouvre la bouche, pour lui et pour ceux qui l'accompagnent — l'apercu reste
   * complet, car trier un travail sans voir ses voisins est ce qui produisait les balayages
   * partiels.
   *
   * La memoire est volontairement EN MEMOIRE : au redemarrage, l'application redit une fois ce qui
   * reste. Se taire pour toujours serait le defaut inverse, et le pire des deux.
   */
  /** @internal (conv-1580) */ readonly travauxDejaAnnonces = new Set<string>()

  /** Corps : `commands/instantanes.ts` (conv-1580, lot 6). */
  /** @internal (conv-1580) */ travauxNonAnnonces(
    travaux: Array<{ agentId: string; date: string; fichiers: string[] }>
  ): Array<{ agentId: string; date: string; fichiers: string[] }> {
    return instantanes.travauxNonAnnonces(this, travaux)
  }

  /** Corps : `commands/instantanes.ts` (conv-1580, lot 6). */
  snapshotForPrompt(jalon?: (nom: string) => void): Promise<PromptSnapshot> {
    return instantanes.snapshotForPrompt(this, jalon)
  }

  /**
   * REGISTRE DES APPELS DU TOUR — contre le rejeu à l'identique.
   *
   * Mesure du 2026-09-09 sur les 331 fichiers de `causal-trace` : 761 appels d'outils ont été
   * ré-émis avec des arguments STRICTEMENT identiques dans la même conversation, sur 112
   * conversations (une sur trois). Écart médian entre l'appel et son rejeu : 1 à 2 appels — donc
   * du rejeu immédiat, pas de l'oubli lointain. La constitution l'interdit déjà en prose
   * (« ne jamais re-tenter à l'identique en aveugle ») ; la prose n'a pas suffi, d'où ce registre.
   *
   * Il ne BLOQUE pas par défaut, et c'est délibéré : `desktop_observe` réémis après une édition est
   * LÉGITIME (l'écran a changé), et un cache aveugle casserait la boucle « j'édite → je regarde ».
   * On se contente donc de faire SAVOIR au modèle qu'il rejoue. Une seule famille est refusée :
   * l'édition déjà REFUSÉE puis renvoyée telle quelle — là le rejeu ne peut rien produire d'autre
   * que le même refus (38 rejeux d'`Edit` et 22 d'`edit_file` mesurés, écart médian 1, 100 % dans
   * le même tour).
   *
   * La portée est le TOUR, pas la conversation : au tour suivant l'utilisateur a parlé, le monde a
   * pu changer, et refaire le même appel redevient légitime.
   */
  private registreDuTour?: { turnId: string; appels: Map<string, RejeuConnu> }

  /** Tours dont la capture d'ecran reel a deja ete refusee une fois (voir `refusEcranReel`). */
  private tourEcranReelRefuse?: string

  /** Idem pour `desktop_act` (kaizen conv-854) : compteur distinct, une observation n'arme pas un clic. */
  private tourActionReelleRefusee?: string

  /** Vrai si ce tour a deja recu le refus : on ne facture pas la friction deux fois. */
  private ecranReelDejaRefuse(turnId?: string): boolean {
    const cle = turnId ?? 'sans-tour'
    if (this.tourEcranReelRefuse === cle) return true
    this.tourEcranReelRefuse = cle
    return false
  }

  /** Enregistre l'appel et rend ce qu'on savait déjà de lui, ou `undefined` si c'est un premier. */
  private noterAppelDuTour(turnId: string, empreinte: string): RejeuConnu | undefined {
    if (this.registreDuTour?.turnId !== turnId) {
      this.registreDuTour = { turnId, appels: new Map() }
    }
    const connu = this.registreDuTour.appels.get(empreinte)
    if (connu) {
      connu.occurrences += 1
      return connu
    }
    this.registreDuTour.appels.set(empreinte, { occurrences: 1, refuse: false })
    return undefined
  }

  /** Referme l'appel : c'est l'issue qui décide si un rejeu ultérieur sera refusé. */
  private cloreAppelDuTour(turnId: string, empreinte: string, ok: boolean): void {
    if (this.registreDuTour?.turnId !== turnId) return
    const connu = this.registreDuTour.appels.get(empreinte)
    if (connu) connu.refuse = !ok
  }

  /** Exécute une commande nommée, mute l'app, diffuse le changement. */
  /**
   * LE DOSSIER DE TRAVAIL DE CE TOUR — celui range sur la conversation, sinon le dossier global.
   *
   * Toutes les commandes qui touchent au disque passent par ici (`run`, `read_file`, `list_files`,
   * `find_in_files`, `create_file`, `move_file`, `delete_file`, `edit_file`, `verify`, Brain...).
   * Avant le 2026-09-16 elles lisaient `os.executionWorkspace`, fige au demarrage de l'app : une
   * conversation rangee sur un projet voyait son chat partir dans le bon dossier (corrige le
   * 2026-09-08) mais ses commandes agir dans un AUTRE — `delete_file` supprimait le fichier du
   * mauvais depot. Hors de tout tour (appel IPC direct), le repli est le dossier global : le
   * comportement d'avant, a l'identique.
   */
  /** @internal (conv-1508) */ get workspaceDuTour(): string {
    return dossierDuTourCourant() ?? this.os.executionWorkspace
  }

  /**
   * Le dossier range sur la conversation quand il designe un dossier REEL, sinon le dossier global.
   * Meme regle que le tour de chat (`dossierDeTravailDuTour`) : un libelle de categorie ou un
   * dossier disparu ne pilote rien. Lecture defensive : plusieurs tests montent un `os` partiel.
   */
  private dossierRangeSur(conversationId?: string): string {
    const range = conversationId
      ? this.os.conversations?.get?.(conversationId)?.projectPath
      : undefined
    return dossierDeTravailDuTour(range, this.os.executionWorkspace)
  }

  /**
   * Les fils vus par `ecrire_a_un_fil` (conv-1139). Actif = connu ET touché depuis moins que le
   * seuil d'archivage (`SEUIL_ARCHIVE_MS`) ; lu dans la liste en mémoire, sans charger d'archive.
   * Le dossier d'un fil suit la même règle que son tour (`dossierRangeSur`).
   */
  /** @internal (conv-1508) */ contexteDesFils(maintenant = Date.now()): ContexteFils {
    const actifs = new Map<string, true>()
    for (const c of this.os.conversations?.list?.() ?? []) {
      if (typeof c.updatedAt === 'number' && maintenant - c.updatedAt < SEUIL_ARCHIVE_MS)
        actifs.set(c.id, true)
    }
    return {
      estActif: (fil) => actifs.has(fil),
      filsActifs: () => [...actifs.keys()],
      dossierDe: (fil) => (actifs.has(fil) ? this.dossierRangeSur(fil) : undefined)
    }
  }

  /**
   * Un message écrit par l'APP au nom du fil `de` (compte rendu d'un lot au fil chef, conv-1150) :
   * mêmes règles que `ecrire_a_un_fil` (même dépôt, bornes, doublon), sans tour lancé.
   */
  ecrireDepuisLeFil(de: string, a: string, texte: string): void {
    ecrireAUnFil({ destinataire: a, texte, nature: 'info' }, { fil: de }, this.contexteDesFils())
    this.broadcast({ type: 'refresh', scope: 'messages-fils' })
  }

  /**
   * Bloc « messages d'autres fils » remis en tête du tour de `conversationId` (conv-1139). Un
   * CONFORT, comme `rappelPourDemande` : une panne rend '' et le tour part quand même.
   */
  messagesDesFilsPourTour(conversationId?: string): string {
    const bloc = blocMessagesPourTour(conversationId)
    if (bloc) this.broadcast({ type: 'refresh', scope: 'messages-fils' })
    return bloc
  }

  async exec(
    name: string,
    args: Record<string, unknown> = {},
    conversationId?: string,
    bindingOverride?: RoleBinding,
    turnId?: string,
    /** Signe de vie d'une commande LONGUE, relaye tel quel au fil (voir `verify-battement`). */
    onProgress?: (text: string) => void
  ): Promise<CommandResult> {
    // Le dossier est POSE pour la duree de cet appel (et de ses `await`), jamais dans un champ
    // partage : deux tours paralleles ranges dans deux projets se voleraient le dossier.
    return avecDossierDuTour(this.dossierRangeSur(conversationId), () =>
      this.execDansLeDossierDuTour(name, args, conversationId, bindingOverride, turnId, onProgress)
    )
  }

  private async execDansLeDossierDuTour(
    name: string,
    args: Record<string, unknown> = {},
    conversationId?: string,
    bindingOverride?: RoleBinding,
    turnId?: string,
    onProgress?: (text: string) => void
  ): Promise<CommandResult> {
    // Voir `registreDuTour` : l'empreinte porte le TOUR, pas la conversation — au tour suivant
    // l'utilisateur a parlé et le même appel redevient légitime. Sans `turnId`, pas de registre :
    // on ne sait pas de quel tour relève l'appel, et deviner reviendrait à bloquer au hasard.
    const empreinteDuTour = turnId
      ? actionFingerprint(name, args, { conversationId: turnId })
      : undefined
    const dejaVu =
      empreinteDuTour && turnId ? this.noterAppelDuTour(turnId, empreinteDuTour) : undefined
    if (dejaVu?.refuse && OUTILS_REFUSES_SI_REJEU_APRES_ECHEC.has(name)) {
      const refus =
        `Appel REFUSÉ : tu viens d'émettre exactement ce même \`${name}\` dans ce tour et il a ` +
        'échoué. Le renvoyer à l’identique produira le même échec. Relis le fichier — son contenu ' +
        'a peut-être changé — puis change d’approche au lieu de rejouer.'
      this.trace?.(name, redactedArgs(name, args), false)
      return { ok: false, error: refus }
    }
    const noterIssue = (ok: boolean): void => {
      if (empreinteDuTour && turnId) this.cloreAppelDuTour(turnId, empreinteDuTour, ok)
    }
    try {
      const specification = CATALOG.find((command) => command.name === name)
      if (!specification) throw new Error(refusAvecIssue('commande-inconnue', name))
      if (!this.isCommandEnabled(name)) throw new Error(refusAvecIssue('capacite-desactivee', name))
      if (name === 'desktop_observe') {
        // Voir `refusEcranReel` : refus du PREMIER appel du tour seulement, porte de sortie exposee.
        if (!assumeEcranReel(args) && !this.ecranReelDejaRefuse(turnId)) {
          this.trace?.(name, redactedArgs(name, args), false)
          noterIssue(false)
          return { ok: false, error: refusEcranReel }
        }
        if (!this.desktop) throw new Error('Controle desktop indisponible')
        const observed = await this.desktop.observe({ display: parseDisplayArg(args.display) })
        this.trace?.(name, redactedArgs(name, args), true)
        noterIssue(true)
        return {
          ok: true,
          data: avecNoteDeRejeu(observed.data, dejaVu, name),
          attachments: [observed.attachment]
        }
      }
      if (name === 'show_video') {
        // La carte part par `artifacts` (le fil), jamais par `attachments` (le modèle IA).
        const video = await preparerVideoAMontrer(args, this.workspaceDuTour)
        if (!video.ok) throw new Error(`show_video refusé : ${video.raison}`)
        this.trace?.(name, redactedArgs(name, args), true)
        noterIssue(true)
        return { ok: true, data: video.resume, artifacts: [video.artifact] }
      }
      if (name === 'montrer_bloc') {
        // Le bloc part par `blocs` (le texte du fil), jamais par `data` (le modèle IA).
        const bloc = preparerBlocAMontrer(args, this.workspaceDuTour)
        if (!bloc.ok) throw new Error(`montrer_bloc refusé : ${bloc.raison}`)
        this.trace?.(name, redactedArgs(name, args), true)
        noterIssue(true)
        return { ok: true, data: bloc.resume, blocs: [bloc.bloc] }
      }
      if (name === 'desktop_act') {
        // kaizen conv-854, tour 78a0d7d3-6a84-4d86-a3a7-fd1b5cc1393f : un clic sur la barre des taches
        // de l'utilisateur est passe sans aucune garde (decision « confirm » jamais bloquante). Meme
        // friction d'un appel que `refusEcranReel`, porte de sortie `ecran_utilisateur: true`.
        // Le drapeau pose d'office au PREMIER appel ne compte pas (meme tour : le modele l'a ajoute
        // seul, sans demande) : le premier geste du tour est toujours refuse, le drapeau ne vaut
        // qu'apres avoir lu le refus qui nomme le bureau cache.
        // Kaizen conv-854 (saisie ts 1790278416518) : le drapeau seul restait un contournement au 2e
        // appel. Agir sur l'ecran reel exige desormais que le DERNIER message de l'utilisateur parle
        // de son ecran ; le modele ne peut plus s'y autoriser lui-meme. Dans le tour 78a0d7d3 le
        // message etait « fais le toi stp » : le clic aurait ete refuse.
        // Lu AVANT le premier refus (kaizen conv-835) : c'est lui qui dit si la porte de sortie
        // `ecran_utilisateur: true` existe vraiment — voir `refusActionSansDemande`.
        const dernierMessage = [...(this.os.conversations?.get?.(conversationId ?? '')?.messages ?? [])]
          .reverse()
          .find((m) => m.role === 'user')?.content
        const demande = demandeEcranReel(dernierMessage)
        const cle = turnId ?? 'sans-tour'
        if (this.tourActionReelleRefusee !== cle) {
          this.tourActionReelleRefusee = cle
          this.trace?.(name, redactedArgs(name, args), false)
          noterIssue(false)
          return {
            ok: false,
            error: demande
              ? refusEcranReel.replace('`desktop_observe` regarde', '`desktop_act` agit sur') + ' Pour cliquer ou taper dans le bureau cache : `powershell -NoProfile -File scripts/hdesk-act.ps1 -InstanceId <id> -X <x> -Y <y> [-Texte "..."] [-Entree]`.'
              : refusActionSansDemande
          }
        }
        if (!demande) {
          this.trace?.(name, redactedArgs(name, args), false)
          noterIssue(false)
          return { ok: false, error: refusActionSansDemande }
        }
      }
      if (
        name === 'bureau_cache_lancer' ||
        name === 'bureau_cache_observer' ||
        name === 'bureau_cache_agir'
      ) {
        const r = await this.outilBureauCache(name, args, conversationId)
        this.trace?.(name, redactedArgs(name, args), true)
        noterIssue(r.data.ok)
        return { ok: true, data: r.data, ...(r.attachments ? { attachments: r.attachments } : {}) }
      }
      if (estOutilNavigateur(name)) {
        const r = await this.outilNavigateur(name, args, conversationId)
        this.trace?.(name, redactedArgs(name, args), true)
        noterIssue(r.data.ok)
        return { ok: true, data: r.data, ...(r.attachments ? { attachments: r.attachments } : {}) }
      }
      if (name === 'terminal_lire') {
        const lecture = this.outilTerminalLire(args, conversationId)
        this.trace?.(name, redactedArgs(name, args), true)
        noterIssue(lecture.ok)
        return { ok: true, data: lecture }
      }
      const data = await this.run(name, args, conversationId, bindingOverride, turnId, onProgress)
      this.trace?.(name, redactedArgs(name, args), true)
      noterIssue(true)
      return { ok: true, data: avecNoteDeRejeu(data, dejaVu, name) }
    } catch (e) {
      this.trace?.(name, redactedArgs(name, args), false)
      noterIssue(false)
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /** Corps : `commands/outils-bureau-navigateur.ts` (conv-1580, lot 6). */
  private outilBureauCache(
    name: 'bureau_cache_lancer' | 'bureau_cache_observer' | 'bureau_cache_agir',
    a: Record<string, unknown>,
    conversationId?: string
  ): Promise<{
    data: Record<string, unknown> & { ok: boolean }
    attachments?: NonNullable<Message['attachments']>
  }> {
    return outilsBureauNavigateur.outilBureauCache(this, name, a, conversationId)
  }

  /** Corps : `commands/outils-bureau-navigateur.ts` (conv-1580, lot 6). */
  private outilNavigateur(
    name: OutilNavigateur,
    a: Record<string, unknown>,
    conversationId?: string
  ): Promise<{
    data: Record<string, unknown> & { ok: boolean }
    attachments?: NonNullable<Message['attachments']>
  }> {
    return outilsBureauNavigateur.outilNavigateur(this, name, a, conversationId)
  }

  /** Corps : `commands/outils-bureau-navigateur.ts` (conv-1580, lot 6). */
  private outilTerminalLire(
    a: Record<string, unknown>,
    conversationId?: string
  ): Record<string, unknown> & { ok: boolean } {
    return outilsBureauNavigateur.outilTerminalLire(this, a, conversationId)
  }

  /** Corps : `commands/outils-bureau-navigateur.ts` (conv-1580, lot 6). */
  /** @internal (conv-1580) */ actionNavigateur(a: Record<string, unknown>): ActionAgentNavigateur | string {
    return outilsBureauNavigateur.actionNavigateur(a)
  }

  private async run(
    name: string,
    a: Record<string, unknown>,
    conversationId?: string,
    bindingOverride?: RoleBinding,
    turnId?: string,
    onProgress?: (text: string) => void
  ): Promise<unknown> {
    switch (name) {
      // Chaque groupe de cas vit dans son module commands/<groupe>.ts (conv-1508, lot 2).
      case 'desktop_act':
      case 'navigate':
      case 'ask':
      case 'chat_send':
        return executerInterface(this, name, a, conversationId)
      case 'orchestrate':
        return executerOrchestration(this, name, a, conversationId, bindingOverride, turnId, onProgress)
      case 'create_conversation':
      case 'classer_conversation':
      case 'retrospective':
      case 'conversation_search':
      case 'conversation_read':
      case 'rename_conversation':
      case 'remove_conversation':
      case 'remove_conversations':
      case 'attach_run':
      case 'load_graph':
      case 'marquer_travail_trie':
      case 'confirmer_verdict_juge':
      case 'marquer_travaux_tries':
        return executerConversations(this, name, a, conversationId)
      case 'get_state':
      case 'run':
      case 'restart_app':
      case 'bureau_cache_fermer':
      case 'reload_env':
        return executerApplication(this, name, a, conversationId, onProgress)
      case 'verify':
      case 'brain_query':
      case 'profil_ajouter':
      case 'profil_retirer':
      case 'brain_graph':
      case 'brain_read':
      case 'skill_charger':
      case 'ticket_create':
      case 'task_create':
      case 'task_update':
      case 'task_delete':
      case 'task_list':
      case 'sql_query':
      case 'ticket_get':
      case 'ticket_update':
      case 'ticket_search':
        return executerOutilsMetier(this, name, a, conversationId, turnId, onProgress)
      case 'remember':
        return executerMemoire(this, name, a, conversationId, bindingOverride, turnId)
      case 'read_file':
      case 'list_files':
      case 'find_in_files':
      case 'edit_file':
      case 'create_file':
      case 'move_file':
      case 'delete_file':
      case 'run_status':
      case 'proprietaire_fichier':
        return executerFichiers(this, name, a, conversationId, turnId)
      case 'ecrire_a_un_fil':
      case 'lire_mes_messages':
      case 'arreter_un_fil':
      case 'plan_de_lots':
        return executerFils(this, name, a, conversationId, turnId)
      default:
        throw new Error(`commande inconnue: ${name}`)
    }
  }

  /** Corps : `commands/edition-isolee.ts` (conv-1580, lot 6). */
  /** @internal (conv-1580) */ identiteDeBureau(
    famille: string,
    conversationId: string | undefined,
    cible: string | undefined
  ): Promise<string> {
    return editionIsolee.identiteDeBureau(this, famille, conversationId, cible)
  }

  /** Corps : `commands/edition-isolee.ts` (conv-1580, lot 6). */
  /** @internal (conv-1580) */ withIsolatedMutation<T>(
    command: 'edit_file',
    conversationId: string | undefined,
    action: (workspaceRoot: string) => T | Promise<T>,
    /** Fichier vise par la tache : c'est lui qui donne au bureau une IDENTITE stable. */
    cible?: string,
    /** Octets du fichier AVANT l'edition, lus APRES l'action — socle de la baseline. */
    lireOctetsAvant?: () => Buffer | undefined
  ): Promise<T> {
    return editionIsolee.withIsolatedMutation<T>(this, command, conversationId, action, cible, lireOctetsAvant)
  }

  /** Ecriture de fichier, remplacable par un test pour prouver la branche « non restaure ». */
  /** @internal (conv-1580) */ ecrireFichier: (chemin: string, contenu: Buffer) => void = writeFileSync

  /** Corps : `commands/verification-avant-publication.ts` (conv-1580, lot 6). */
  verifierAvantPublication(
    repo: string,
    fichiers: readonly string[]
  ): Promise<VerificationAvantPublication> {
    return verificationAvantPublication.verifierAvantPublication(this, repo, fichiers)
  }

  /** Corps : `commands/verification-avant-publication.ts` (conv-1580, lot 6). */
  /** @internal (conv-1580) */ mesurerParLots(
    workspaceRoot: string,
    cible: readonly string[],
    binDir?: string
  ): Promise<MesureVerifiee> {
    return verificationAvantPublication.mesurerParLots(this, workspaceRoot, cible, binDir)
  }

  /** Corps : `commands/verification-avant-publication.ts` (conv-1580, lot 6). */
  /** @internal (conv-1580) */ mesurerAvecRapport(
    workspaceRoot: string,
    cible: readonly string[],
    /** Binaires du dépôt mesuré (voir `spawnVerify`) ; défaut : ceux du dossier du tour. */
    binDir?: string,
    /** Signal d'arrêt du tour : le Stop de l'utilisateur tue la mesure en cours. */
    signal?: AbortSignal
  ): Promise<MesureVerifiee> {
    return verificationAvantPublication.mesurerAvecRapport(this, workspaceRoot, cible, binDir, signal)
  }

  /** Corps : `commands/verification-avant-publication.ts` (conv-1580, lot 6). */
  /** @internal (conv-1580) */ baselineAvantEdition(
    absolu: string,
    octetsAvant: Buffer,
    rejouer: () => Promise<MesureVerifiee>,
    commandeAttendue: string
  ): Promise<MesureVerifiee | undefined> {
    return verificationAvantPublication.baselineAvantEdition(this, absolu, octetsAvant, rejouer, commandeAttendue)
  }

  /** Corps : `commands/edition-isolee.ts` (conv-1580, lot 6). */
  /** @internal (conv-1580) */ runEditFile(
    input: { path: unknown; oldText: unknown; newText: unknown },
    workspaceRoot: string,
    /** Reçoit les octets du fichier AVANT l'écriture — socle de la baseline différentielle. */
    avantEdition?: (octets: Buffer) => void
  ): {
    allowed: boolean
    reason?: string
    path?: string
    diff?: string
  } {
    return editionIsolee.runEditFile(this, input, workspaceRoot, avantEdition)
  }

  /** Corps : `commands/fichiers.ts` (conv-1580, lot 6). */
  /** @internal (conv-1508) */ runTracedFileCommand<R extends { allowed: boolean }>(
    rawPaths: unknown[],
    run: () => R,
    conversationId?: string,
    turnId?: string
  ): Promise<R> {
    return fichiersDuBus.runTracedFileCommand<R>(this, rawPaths, run, conversationId, turnId)
  }

  /** Corps : `commands/fichiers.ts` (conv-1580, lot 6). */
  /** @internal (conv-1508) */ runCreateFile(input: { path: unknown; content: unknown }): {
    allowed: boolean
    reason?: string
    path?: string
    octets?: number
  } {
    return fichiersDuBus.runCreateFile(this, input)
  }

  /** Corps : `commands/fichiers.ts` (conv-1580, lot 6). */
  /** @internal (conv-1508) */ runMoveFile(input: { from: unknown; to: unknown }): {
    allowed: boolean
    reason?: string
    from?: string
    to?: string
  } {
    return fichiersDuBus.runMoveFile(this, input)
  }

  /** Corps : `commands/fichiers.ts` (conv-1580, lot 6). */
  /** @internal (conv-1508) */ runDeleteFile(input: { path: unknown }): {
    allowed: boolean
    reason?: string
    path?: string
  } {
    return fichiersDuBus.runDeleteFile(this, input)
  }

  /** Corps : `commands/fichiers.ts` (conv-1580, lot 6). */
  /** @internal (conv-1508) */ runWorktreeStatus(
    agentId: unknown
  ): Promise<{ allowed: boolean; reason?: string; status?: unknown; conflit?: unknown }> {
    return fichiersDuBus.runWorktreeStatus(this, agentId)
  }

  /** Corps : `commands/edition-isolee.ts` (conv-1580, lot 6). */
  /** @internal (conv-1508) */ runTracedEditFile(
    input: { path: unknown; oldText: unknown; newText: unknown },
    conversationId?: string,
    turnId?: string
  ): Promise<{ allowed: boolean; reason?: string; path?: string; diff?: string }> {
    return editionIsolee.runTracedEditFile(this, input, conversationId, turnId)
  }

  /**
   * Interrogation du Brain a la demande. Lecture seule : aucun effet de bord possible.
   * `retrieveBrainContext` degrade deja proprement (pas de token, serveur absent, timeout 5s → ''),
   * et `buildBrainOutcome` distingue « rien trouve » d'une panne — l'agent ne doit pas transformer un
   * silence en reponse negative.
   */
  /** @internal (conv-1508) */ async runBrainQuery(
    question: unknown,
    conversationId?: string,
    turnId?: string,
    /** `true` : la liste complète, sans le filtre du petit modèle (conv-1571). */
    entier?: unknown
  ): Promise<BrainQueryOutcome & { allowed: boolean; reason?: string }> {
    const decision = decideBrainQuery(question)
    if (!decision.allowed) {
      return {
        allowed: false,
        reason: decision.reason,
        found: false,
        query: '',
        knowledge: '',
        status: 'not-requested'
      }
    }
    const corpus = brainCorpusForWorkspace(this.workspaceDuTour)
    // DEUX BRAINS (conv-1233, 2026-10-28) : celui de l'équipe et, s'il est réglé, le Brain perso,
    // interrogés EN MÊME TEMPS. Le perso n'a pas de filtre de dépôt : ses notes ne sont rangées
    // par aucun projet.
    const envPerso = envDuBrainPerso()
    const [brain, perso] = await Promise.all([
      corpus?.length === 0
        ? { context: '', status: 'empty' as const }
        : // La LISTE des notes candidates (titre, chemin, taille) : l'agent ouvre ensuite en entier,
          // avec `brain_read`, celles qu'il juge nécessaires — aucune borne de taille ni de nombre.
          this.retrieveBrain(decision.query, { corpus, mode: 'candidates' }),
      envPerso
        ? this.retrieveBrain(decision.query, { env: envPerso, mode: 'candidates' })
        : undefined
    ])
    // Serveur perso éteint : on le démarre en fond ; la question suivante le trouvera debout.
    if (perso?.status === 'unavailable' && perso.unavailableReason === 'network') {
      void demarrerBrainPerso().then(
        (r) => r && console.log('[brain-perso]', r.status, '—', r.detail)
      )
    }
    // MEME PORTEE que la voie poussee : le contexte, le statut et la navigation sont projetés ensemble.
    const scoped = scopeBrainRetrieval(brain, corpus)
    // Même règle pour le perso : seules les sources SIGNÉES comptent, et jamais `inbox/` — sans
    // filtre de dépôt (`undefined`), ses notes n'appartiennent à aucun projet.
    const persoScoped = perso ? scopeBrainRetrieval(perso, undefined) : undefined
    const persoTrouve = persoScoped?.status === 'found' && persoScoped.context.trim().length > 0
    const outcome = persoTrouve
      ? buildBrainOutcome(
          decision.query,
          fusionnerListesBrain(scoped.context, persoScoped.context),
          'found'
        )
      : buildBrainOutcome(decision.query, scoped.context, scoped.status, scoped.unavailableReason)
    if (envPerso && perso && !persoTrouve && perso.status !== 'empty') {
      // Le Brain perso n'a pas répondu : le DIRE, sinon son silence passe pour « rien de perso ».
      const avis = `Brain perso indisponible (${perso.unavailableReason ?? perso.status}) — ses notes n’ont pas été cherchées`
      outcome.note = outcome.note ? `${outcome.note} · ${avis}` : avis
    }
    if (persoTrouve && scoped.status !== 'found' && scoped.status !== 'empty') {
      outcome.note = `Brain d’équipe indisponible (${scoped.unavailableReason ?? scoped.status}) — seules les notes perso sont listées`
    }
    // Filtre du petit modèle AVANT la trace (conv-1571) : `injectedChars` mesure ce qui est
    // réellement servi au modèle principal, donc l'économie se relit dans le spool Brain.
    const servi = await filtrerListeBrain(outcome, { entier }, this.condenseurBrain, conversationId)
    if (conversationId) {
      appendBrainTrace({
        timestamp: new Date().toISOString(),
        conversationId,
        ...(turnId ? { turnId } : {}),
        kind: 'query',
        query: decision.query,
        found: servi.found,
        status: scoped.status,
        injectedChars: servi.knowledge.length,
        navigation: scoped.navigation
      })
    }
    return { allowed: true, ...servi }
  }

  /** Corps : `commands/verification.ts` (conv-1580, lot 6). */
  /** @internal (conv-1508) */ runVerify(
    onProgress?: (text: string) => void,
    cible?: string,
    conversationId?: string,
    type?: string
  ): Promise<VerifyOutcome & { allowed: boolean; reason?: string }> {
    return verificationDuBus.runVerify(this, onProgress, cible, conversationId, type)
  }

  /** Corps : `commands/verification.ts` (conv-1580, lot 6). */
  /** @internal (conv-1580) */ bureauDeVerification(
    conversationId?: string,
    onProgress?: (text: string) => void
  ): Promise<string | undefined> {
    return verificationDuBus.bureauDeVerification(this, conversationId, onProgress)
  }

  /** Corps : `commands/verification.ts` (conv-1580, lot 6). */
  /** @internal (conv-1580) */ runVerifyAt(
    workspaceRoot: string | undefined,
    onProgress?: (text: string) => void,
    cible?: string,
    /** Signal d'arret du tour : le Stop de l'utilisateur tue la verification en cours. */
    signal?: AbortSignal
  ): Promise<VerifyOutcome & { allowed: boolean; reason?: string }> {
    return verificationDuBus.runVerifyAt(this, workspaceRoot, onProgress, cible, signal)
  }

  /** Corps : `commands/verification.ts` (conv-1580, lot 6). */
  /** @internal (conv-1580) */ fichiersNonCommites(cwd: string): Promise<string[]> {
    return verificationDuBus.fichiersNonCommites(cwd)
  }

  /** Corps : `commands/verification.ts` (conv-1580, lot 6). */
  /** @internal (conv-1580) */ runRelatedVerifyAt(
    workspaceRoot: string | undefined,
    paths: readonly string[],
    signal?: AbortSignal
  ): Promise<VerifyOutcome & { allowed: boolean; reason?: string }> {
    return verificationDuBus.runRelatedVerifyAt(this, workspaceRoot, paths, signal)
  }

  /** Corps : `commands/verification.ts` (conv-1580, lot 6). */
  /** @internal (conv-1508) */ spawnVerify(
    argv: string[],
    cwd: string,
    label: string,
    onProgress?: (text: string) => void,
    signal?: AbortSignal,
    /** Dossier des binaires à mettre en tête du PATH ; défaut : celui du dossier du tour. */
    binDir?: string
  ): Promise<VerifyOutcome & { allowed: boolean; reason?: string }> {
    return verificationDuBus.spawnVerify(this, argv, cwd, label, onProgress, signal, binDir)
  }
}
