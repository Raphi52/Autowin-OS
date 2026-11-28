import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTextesChatFil } from '../textes-ecrans/chat-fil'
import { useBrancheCourante } from './branche-courante'
import { copieAfficheeDuFil, dossierDeLaBranche } from './copie-du-fil-entete'
import { createPortal } from 'react-dom'
import type { FicheDeDemande } from '../../../shared/fiche-de-demande'
import {
  type ConversationsVues,
  ecrireConversationsVues,
  lireConversationsVues,
  marquerVue
} from './conversation-seen'
import {
  CHAT_PANE_LIMITS,
  compenserRetrecissementDuFil,
  doitRattraperApresReapparition,
  scrollChatToBottom,
  type ChatRuntimeIdentity,
  type OrchestratorModelOption,
  resolveChatRuntimeIdentity,
  type RunRequestIdentity
} from './chat-view-model'
import { type ActionPassage } from './passage-selectionne'
import { type ElementCible } from './alt-clic'
import { type ChatComposerHandle } from './ChatComposer'
import { type MomentPointe } from './video-pointage-context'
import type {
  AsstMsg,
  ChatAttachment,
  ComposerDraft,
  Conv,
  DirectiveReceipt,
  Msg,
  QueuedDirective,
  RunEntry
} from './chat-view-types'
import { declarerVueChatMontee } from './vue-chat-montee'
import { lireBrouillons } from './brouillons-persistes'
import { type OrchestratorAccounts } from './OrchestratorModelSelector'
import { ChatMosaic } from './ChatMosaic'
import { WorkflowsPanel } from './WorkflowsPanel'
// La classe `.lisere-dessus` vit dans cette feuille : importee ICI et non « heritee » d'une
// autre vue, sinon l'apparence de Chat dependrait de l'ordre de chargement des AUTRES vues.
import './ViewPage.css'
import { jaugeVide, type ContextGauge } from '../../../shared/context-gauge'
import { type ContexteStatique } from '../../../shared/contexte-detaille'
import './ChatView.css'
import './SlashPalette.css'
import './ChatComposerExtras.css'
import type { HypotheseDeCadrage } from '../../../shared/cadrage-confiance'
import type { InspectTurnTarget } from '../observatory-focus'

/* ---------- Types ---------- */

// Types partagés : dans `chat-view-types.ts` depuis la découpe. Ré-exportés ici pour que les
// importateurs historiques (`RunEntry`, `CheckpointEntry`) n'aient RIEN à changer.
export type { RunEntry, CheckpointEntry } from './chat-view-types'
import { BarriereErreur } from './BarriereErreur'
import { VueMesuree } from './VueMesuree'
import { lireArretsChaine, oublierArretChaine } from './arrets-chaine-persistes'
import { HdeskGestionView } from './HdeskGestionView'
import { NavigateurIntegre } from './NavigateurIntegre'
import type { ElementChoisiNavigateur } from '../../../shared/navigateur'
import {
  type RuntimeModel,
  type ModeleDuFil,
  texteFil,
  lireJaugesMemorisees,
  lireContextesMemorises,
  NEW_DRAFT_KEY,
  type AppNotice,
  cleNomTaille
} from './chat-view-outils'
import { useRepriseDesTours } from './chat-view-reprise'
import { useToursEtEnvoi } from './chat-view-envoi'
import { useListeDesConversations } from './chat-view-liste'
import { useRenduMosaique } from './chat-view-mosaique'
import { useRepriseDeLecture } from './chat-view-defilement'
import { useFluxDuPilote } from './chat-view-flux-pilote'
import { fermerDans, ouvrirDans } from './panneau-outil'
import { MenuBrancheDuFil, MenuConversation, MenuDossierConversation } from './chat-view-menus'
import { PanneauDesConversations } from './chat-view-panneau-liste'
import * as montage from './chat-view-montage'
import * as chargementFil from './chat-view-fil'
import * as ecouteurs from './chat-view-ecouteurs'
import * as gestesFil from './chat-view-gestes-fil'
import * as gestesListe from './chat-view-gestes-liste'
import * as gestesMosaique from './chat-view-gestes-mosaique'
import * as recus from './chat-view-recus'
import * as fileAttente from './chat-view-file-attente'
import * as brouillons from './chat-view-brouillons'
import * as passageFil from './chat-view-passage'
import * as modeleFil from './chat-view-modele'
import * as panneauRuns from './chat-view-panneau-runs'
import { useTenirRefAJour } from './tenir-ref-a-jour'
import { useComptesClaude } from './chat-view-modele'
import { usePassageSelectionne } from './chat-view-passage'
import { usePanneauOutils } from './chat-view-panneau-outils'
import { useRunOuvert } from './chat-view-panneau-runs'
import { useSkillsEtDepot, useSuggestionsDAccueil } from './chat-view-suggestions'
import { useAffichageDeLaListe, useMenusDeLaListe } from './chat-view-affichage-liste'
import { useRecusDuFil } from './chat-view-recus'
import { useSurcouchesDuFil, useTravailNonPublie } from './chat-view-bandeaux'
import { useModeAutoDuChat } from './chat-view-mode-auto'
import { SectionDuFil } from './chat-view-section-fil'
import type { PositionLecture } from './position-lecture'
import { ImageAgrandie } from './chat-view-cartes'

export function ChatView({
  isActive = true,
  onInspectTurn,
  demandeBureaux = 0
}: {
  isActive?: boolean
  onInspectTurn?: (target: InspectTurnTarget) => void
  /** Compteur de « va sur les bureaux cachés » (App.tsx) : chaque hausse ouvre le panneau. */
  demandeBureaux?: number
}): React.JSX.Element {
  // La vue se redessine quand la langue change (`texteFil` lit la langue courante).
  const { langue } = useTextesChatFil()
  const [convs, setConvs] = useState<Conv[]>([])
  /** Comptes Claude connus (liste + compte actif de l'application), pour la pop-up de modele. */
  const [comptesClaude, setComptesClaude] = useState<{
    activeId: string
    accounts: Array<{ id: string; displayName: string; tier?: string; email?: string }>
  } | null>(null)
  const [compteBusy, setCompteBusy] = useState(false)
  const [compteError, setCompteError] = useState<string | null>(null)
  /** Miroir stable de `convs` pour les écouteurs d'événements (pas de re-abonnement à chaque render). */
  const convsRef = useRef<Conv[]>([])
  useTenirRefAJour(convsRef, convs)
  const [convQuery, setConvQuery] = useState('')
  const conversationDateOrder: 'desc' | 'asc' = 'desc'
  const [activeId, setActiveId] = useState<string | null>(null)
  // L'identifiant que le clic sur « conv-XXX » de l'en-tête vient de copier ; null après 1,5 s.
  const [identifiantCopie, setIdentifiantCopie] = useState<string | null>(null)
  useEffect(() => {
    if (!identifiantCopie) return
    const minuteur = window.setTimeout(() => setIdentifiantCopie(null), 1500)
    return () => window.clearTimeout(minuteur)
  }, [identifiantCopie])
  // VERSION TÉLÉPHONE : la liste des conversations devient un tiroir par-dessus le fil,
  // ouvert par le bouton ☰ de l'en-tête (affichage-session.css) ; choisir un fil le referme.
  const [listeTelOuverte, setListeTelOuverte] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  /** Le fil courant pour la carte du fil, dont le clic peut attendre quelques images. */
  const messagesRef = useRef<Msg[]>(messages)
  useTenirRefAJour(messagesRef, messages)
  /**
   * Le TEXTE en cours de frappe ne vit plus ici : il appartient à `ChatComposer`.
   * ChatView ne garde que la carte des brouillons (`composerDraftsRef`, source de vérité) et ce
   * handle, par lequel il RÉIMPOSE une valeur — sans qu'une frappe le re-rende.
   */
  const composerRef = useRef<ChatComposerHandle | null>(null)
  /** Seule retombée d'une frappe sur la vue : vide ↔ non-vide (la home s'y accroche). */
  const [brouillonPresent, setBrouillonPresent] = useState(false)
  const {
    autoConvs,
    setAutoConvs,
    autoArmePour,
    autoActif,
    autoNouveauFil,
    setAutoNouveauFil,
    autoNouveauFilRef,
    dossierNouveauFil,
    setDossierNouveauFil,
    dossierNouveauFilRef,
    modeleNouveauFil,
    setModeleNouveauFil,
    modeleNouveauFilRef,
    compteNouveauFil,
    setCompteNouveauFil,
    compteNouveauFilRef,
    autoProgrammeesRef,
    autoDiffereesRef,
    annulerRelanceProgrammee,
    desarmerAuto,
    autoEtatsRef,
    quotaHebdoRef,
    quotaHebdoConnu,
    setQuotaHebdoConnu,
    toursAutoRef,
    gardeChaine,
    autoSuiviesRef,
    autoEssaisRef,
    autoTic,
    setAutoTic,
    autoAllumageManuelRef,
    autoRepriseApresRedemarrageRef,
    autoFilAmorceRef
  } = useModeAutoDuChat({ activeId })
  /*
   * Les suppositions du cadrage en cours, par conversation. Vivantes seulement : elles viennent d'un
   * evenement de run, sont remplacees par un nouveau cadrage et disparaissent a la fin du run. Rien
   * n'est persiste — le cadrage lui-meme l'est, dans l'etat du run.
   */
  const [hypothesesCadrage, setHypothesesCadrage] = useState<Record<string, HypotheseDeCadrage[]>>(
    {}
  )
  /*
   * REPLI DU BLOC CADRAGE, PAR CONVERSATION (19/10 : « garde l'etat replie [...] pour qu'il
   * reste ferme quand je change de fil et que je reviens »). La valeur est le run replie : un cadrage
   * d'un AUTRE run arrive ouvert (suppositions neuves), meme si la fin du precedent s'est perdue.
   * La fin du run efface l'entree avec les suppositions.
   */
  const [cadrageReplie, setCadrageReplie] = useState<Record<string, string>>({})
  const runDuCadrageRef = useRef<Record<string, string>>({})
  const { skillCommands, depotPresent, dossierParDefaut, ghostRecommendation, propositionsSuite } =
    useSkillsEtDepot({ messages })
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [appNotice, setAppNotice] = useState<AppNotice | null>(null)
  /**
   * ARRÊTS DU MODE AUTO, FIL PAR FIL (2026-09-30). Ils passaient par `appNotice`, un
   * emplacement UNIQUE pour tout l'écran : la pause levée le 29/09 à 10:47 s'affichait
   * encore 26 h plus tard au-dessus, qui n'attendait rien, sans dire d'où elle venait.
   * Clé = id de la conversation qui l'a levée ; effacée par ×, par un message de l'utilisateur dans
   * ce fil, ou par le rallumage du mode auto sur ce fil.
   */
  // Les arrêts du garde-fou de la chaîne ∞ sont relus du disque : ils survivent au redémarrage.
  // fix-ok: arrêt et compte des tours ∞ perdus au redémarrage (tests de remontage rouges) → gardés sur le poste.
  const [arretsAuto, setArretsAuto] = useState<Record<string, string>>(() =>
    lireArretsChaine(window.localStorage)
  )
  function effacerArretAuto(conversationId: string): void {
    oublierArretChaine(window.localStorage, conversationId)
    setArretsAuto((courant) => {
      if (!(conversationId in courant)) return courant
      const suivant = { ...courant }
      delete suivant[conversationId]
      return suivant
    })
  }
  const {
    travailNonPublie,
    messageNonPublieMasque,
    setMessageNonPublieMasque,
    listeNonPubliee,
    setListeNonPubliee
  } = useTravailNonPublie({ isActive })
  const {
    openImage,
    setOpenImage,
    dragActive,
    setDragActive,
    rechercheFilOuverte,
    setRechercheFilOuverte
  } = useSurcouchesDuFil({ appNotice })
  const [busyConversations, setBusyConversations] = useState<Set<string>>(() => new Set())
  /**
   * Conversations DEJA OUVERTES depuis leur derniere mise a jour. Un run vert dont l'utilisateur
   * n'a pas encore lu le resultat reste jaune (`unread`) et verdit a l'ouverture.
   */
  const [conversationsVues, setConversationsVues] = useState<ConversationsVues>(() =>
    lireConversationsVues(typeof localStorage === 'undefined' ? undefined : localStorage)
  )
  const marquerConversationVue = useCallback((id: string, updatedAt?: number): void => {
    setConversationsVues((actuelles) => {
      const suivantes = marquerVue(actuelles, id, updatedAt)
      if (suivantes !== actuelles)
        ecrireConversationsVues(
          suivantes,
          typeof localStorage === 'undefined' ? undefined : localStorage
        )
      return suivantes
    })
  }, [])
  const [runtimeIdentity, setRuntimeIdentity] = useState<ChatRuntimeIdentity | null>(null)
  /*
    LA BRANCHE GIT COURANTE, en tete de conversation, a la place du niveau d’effort.

    « effort low » ne disait rien d’actionnable ; savoir sur QUELLE branche on travaille change
    ce qu’on s’autorise a demander a l’agent. Lecture seule (git:read), silencieuse en cas
    d’echec : mieux vaut rien qu’un nom de branche invente.

    La RELECTURE vit dans `useBrancheCourante` : lue une seule fois au montage, la valeur
    affichait `main` des que le depot changeait de branche pendant la session — un nom PERIME,
    pire que pas de nom sur un badge cense dire ce qu’on s’autorise.
  */
  // Appel OPTIONNEL : certaines surfaces (tests, preload partiel) n’exposent pas cette lecture.
  const [defaultWorkspace, setDefaultWorkspace] = useState<string | undefined>(undefined)
  /*
    DEFAUT MESURE : le badge lisait le depot du PROCESSUS (aucun cwd), alors que le menu liste et
    bascule les branches du depot de la CONVERSATION. Cliquer une branche basculait donc un depot
    dont le badge ne parlait pas : l'ecran ne « se positionnait » jamais dessus. Meme cwd des deux
    cotes, sinon le badge ment.

    Meme regle pour un fil NEUF (2026-10-19 : « je suis oblige d'ecrire un premier
    message avant que ca affiche la branche ») : sans conversation ouverte, le dossier est celui
    ARME sur la pastille. Le badge l'ignorait et lisait le depot par defaut — il annoncait, listait
    et basculait les branches d'un autre depot jusqu'a la creation du fil. Une seule source pour la
    pastille et le badge : `dossierProjetAffiche`.
  */
  const convAffichee = convs.find((c) => c.id === activeId)
  // Mémorisée : le compilateur React tiendrait sinon le fil pour modifiable par cet appel.
  const copieAffichee = useMemo(() => copieAfficheeDuFil(convAffichee), [convAffichee])
  const dossierProjetAffiche = convAffichee
    ? convAffichee.projectPath?.trim()
    : (dossierNouveauFil ?? undefined)
  const gitCwd = dossierProjetAffiche || defaultWorkspace || undefined
  // Un fil dans sa copie lit la branche du dépôt où son travail entre : la copie n'en a aucune.
  const cwdDeLaBranche = dossierDeLaBranche(gitCwd, copieAffichee)
  // `getGitBranch`, pas `getGitState` : ce dernier creait 2 processus git sur le fil principal a
  // chaque relecture (toutes les 5 s) — 9 gels de 3,3 a 9,8 s.
  const lireEtatGit = useCallback(
    () => Promise.resolve(window.api.getGitBranch?.(cwdDeLaBranche)),
    [cwdDeLaBranche]
  )
  const gitBranch = useBrancheCourante(lireEtatGit)
  /*
   * Occupation de la fenetre de contexte, par conversation.
   *
   * Voisine du cout, et pourtant l'inverse : le cout dit ce que le tour a DEPENSE, la jauge dit
   * ce que le fil PORTE encore. Autowin savait repondre a la premiere question et pas a la
   * seconde -- un fil pouvait s'approcher de la saturation sans qu'un ecran ne l'indique.
   */
  /** Fils dont la compaction automatique a deja ete demandee pour ce franchissement du palier. */
  const compactionAutoRef = useRef<Set<string>>(new Set())
  /** Dernier message ecrit par l'utilisateur dans un fil — ancre du garde-fou anti-boucle. */
  const dernierMessageUtilisateurDe = (conversationId: string): string | undefined =>
    [...(liveMessagesRef.current.get(conversationId) ?? [])]
      .reverse()
      .find((message) => message.role === 'user')?.content
  const [contextGauges, setContextGauges] = useState<Record<string, ContextGauge>>(() =>
    lireJaugesMemorisees()
  )
  const [contextesStatiques, setContextesStatiques] = useState<Record<string, ContexteStatique>>(
    () => lireContextesMemorises()
  )
  const {
    convMenu,
    setConvMenu,
    convMenuRef,
    brancheMenuRef,
    convFolderMenuRef,
    convFolderMenu,
    setConvFolderMenu,
    brancheMenu,
    setBrancheMenu
  } = useMenusDeLaListe()
  const { setDirectiveReceipts, activeDirectiveReceipts, activeDirectiveReceiptsByMessage } =
    useRecusDuFil({ activeId, messagesRef })
  const [interruptingConversations, setInterruptingConversations] = useState<Set<string>>(
    () => new Set()
  )
  const [modelCatalog, setModelCatalog] = useState<RuntimeModel[]>([])
  const [orchestratorBinding, setOrchestratorBinding] = useState<{
    provider: string
    model?: string
    reasoningEffort?: string
  } | null>(null)
  /**
   * LE MODÈLE DU FIL AFFICHÉ : son choix propre, sinon le modèle armé pour un fil neuf,
   * sinon le défaut de l'application (rôle orchestrateur). C'est CE binding que l'en-tête, la
   * jauge et les quotas décrivent : c'est celui que le prochain tour utilisera.
   */
  const modeleDuFil: ModeleDuFil | null = activeId
    ? (convs.find((conv) => conv.id === activeId)?.modeleChoisi ?? null)
    : modeleNouveauFil
  const bindingEffectif = modeleDuFil ?? orchestratorBinding
  /**
   * LA JAUGE DU FIL COURANT — mesuree si un tour l a etablie, sinon le repli a 0 %.
   *
   * UNE seule source pour les DEUX vues : la barre de l en-tete et le filet colore au-dessus du
   * champ. Le filet la calculait a part et restait gris tant qu aucun tour n avait ete mesure : sur
   * un fil vierge il n y avait donc rien a survoler, ni bulle ni panneau (signale le 2026-09-08).
   * Le repli ne depend pas d une conversation active : « Nouveau fil » met l id a null.
   */
  const jaugeCourante =
    (activeId != null ? contextGauges[activeId] : undefined) ??
    jaugeVide(bindingEffectif?.model, bindingEffectif?.provider)
  const [modelCatalogLoaded, setModelCatalogLoaded] = useState(false)
  const [modelChangePending, setModelChangePending] = useState(false)
  const [modelChangeError, setModelChangeError] = useState<string | null>(null)
  const {
    mosaicIds,
    setMosaicIds,
    mosaicIdsRef,
    mosaicFils,
    setMosaicFils,
    repeindreLesFenetresVidesRef,
    convViewMode,
    setConvViewMode,
    convViewModeRef,
    convDensity,
    setConvDensity,
    conversationsPaneWidth,
    setConversationsPaneWidth
  } = useAffichageDeLaListe({ repeindreLesFenetresVides })
  const [hasNewActivity, setHasNewActivity] = useState(false)
  /* Fil remonté : le saut vers le dernier message ne dépend pas d'une nouvelle activité. */
  const [scrolledAwayFromTail, setScrolledAwayFromTail] = useState(false)
  const [showRuns, setShowRuns] = useState(false)
  // LE PANNEAU RESTE AFFICHE LE TEMPS DE SORTIR (2026-10-16 : « je veux une animation
  // d'ouverture fermeture pour le paneau de droite ») : fermer (`showRuns` a faux) le fait glisser
  // vers la droite, et il n'est demonte qu'a la fin de son glissement (`onFermee`, WorkflowsPanel).
  // Ouvrir le monte tout de suite : l'etat suit pendant le rendu, sans image de retard.
  const [runsAffiche, setRunsAffiche] = useState(showRuns)
  if (showRuns && !runsAffiche) setRunsAffiche(true)
  const runsSorti = useCallback(() => setRunsAffiche(false), [])
  // Panneau « Réflexion » : le raisonnement du modèle, hors du fil (colonne droite).
  const [runsPaneWidth, setRunsPaneWidth] = useState(() => {
    const saved = Number(window.localStorage.getItem('autowin.chat.runsPaneWidth'))
    const value = Number.isFinite(saved) && saved > 0 ? saved : 340
    return Math.min(CHAT_PANE_LIMITS.workflows.max, Math.max(CHAT_PANE_LIMITS.workflows.min, value))
  })
  // Quatre sections : Sous-agents · Run · Graphe · Source control. Défaut = Sous-agents, la section qu'on regarde
  // pendant une orchestration — garder « Run » par défaut aurait retiré les sous-agents de la vue.
  const [runs, setRuns] = useState<RunEntry[]>([])
  // Les fiches de demande du fil actif, tenues À PART des runs : une fiche n'entre dans
  // aucun calcul sur les runs (trace à ouvrir, run en cours, suppression).
  const [fiches, setFiches] = useState<FicheDeDemande[]>([])
  const fichesRequestRef = useRef(0)
  /** Miroir stable : `revealLiveAction` lit la liste courante sans se recreer a chaque chargement. */
  const runsRef = useRef<RunEntry[]>([])
  useTenirRefAJour(runsRef, runs)
  const { mentionSources, mentionSourcesRef, friction, usagesAccueil, phrasesAccueil } =
    useSuggestionsDAccueil({ attachments, brouillonPresent, langue, messages, runs })
  const {
    openRun,
    setOpenRun,
    openRunPathRef,
    openTrace,
    setOpenTrace,
    runDetailTab,
    setRunDetailTab,
    liveRuns,
    setLiveRuns,
    liveRunCardRef,
    ongletPanneau,
    setOngletPanneau,
    viewRunRef,
    revealLiveAction
  } = useRunOuvert({ runsRef, setShowRuns })
  const [deleteCandidate, setDeleteCandidate] = useState<Conv | null>(null)
  /**
   * Renommage d'une conversation. Le DÉFAUT corrigé : le menu appelait `window.prompt`, qu'Electron
   * ne sait PAS afficher — la fonction rendait `null` sans rien montrer, donc le renommage depuis la
   * barre latérale était structurellement inatteignable. On reprend la fenêtre React déjà utilisée
   * par la confirmation de suppression, à un champ de saisie près.
   */
  const [renameCandidate, setRenameCandidate] = useState<{ conv: Conv; value: string } | null>(null)
  /**
   * Purge en LOT. `selectedConvIds` n'existe QUE en mode sélection : hors mode, aucune case n'est
   * rendue et la liste retrouve son comportement de clic unique. Sortir du mode vide la sélection —
   * une sélection invisible qui survit est un piège à suppression accidentelle.
   */
  const [convSelectionMode, setConvSelectionMode] = useState(false)
  const [selectedConvIds, setSelectedConvIds] = useState<ReadonlySet<string>>(new Set())
  const [bulkDeleteAsking, setBulkDeleteAsking] = useState(false)
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null)
  const [deleteRunCandidate, setDeleteRunCandidate] = useState<{
    run: RunEntry
    scope: 'conv' | 'tous'
    conversationId?: string
  } | null>(null)
  const [runDeletePending, setRunDeletePending] = useState(false)
  const [runDeleteError, setRunDeleteError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const liveMessagesRef = useRef(new Map<string, Msg[]>())
  // La fin d'un tour lit le fil de la vue MONTÉE, jamais une copie morte (`vue-chat-montee.ts`).
  const vueMonteeRef = useRef(false)
  useEffect(() => {
    vueMonteeRef.current = true
    const retirer = declarerVueChatMontee(() => liveMessagesRef.current)
    return () => {
      vueMonteeRef.current = false
      retirer()
    }
  }, [])
  /*
   * VIDE LE TAMPON DE STREAMING. Les deltas de texte dorment une frame dans `pilotBatcher` : une
   * action qui doit ANCRER sur le fil reellement affiche (le recu d'orientation) lisait sinon un
   * `liveMessagesRef` en retard, et son ancre tombait avant tout le texte deja lu par l'utilisateur.
   */
  const pilotFlushRef = useRef<() => void>(() => {})
  const busyConversationsRef = useRef(new Set<string>())
  const interruptingConversationsRef = useRef(new Set<string>())
  const stoppedQueueDrainRef = useRef(new Set<string>())
  /*
   * STOP DEMANDE, tenu jusqu'au prochain envoi MANUEL dans ce fil. Le gel ci-dessus est a usage
   * unique et la transition busy→false le consomme AVANT que le main renvoie les orientations non
   * lues (`directives-orphelines`, emis dans le `finally` du tour) : sans ce drapeau, une orientation
   * envoyee pendant un tour STOPPE repartait seule comme un nouveau message (2026-10-02).
   */
  const stopDemandeRef = useRef(new Set<string>())
  /**
   * Fils dont les lots de sélection scout sont RETENUS par la limite de quota. Tenu
   * jusqu'au prochain tour du fil (la reprise) : relire le fil ne suffit pas à l'ouverture d'un fil,
   * dont le cache peut manquer le temps d'une relecture — le lot partirait alors dans le mur.
   */
  const lotsRetenusRef = useRef(new Set<string>())
  const sendLocksRef = useRef(new Set<string>())
  const composerDraftKeyRef = useRef(NEW_DRAFT_KEY)
  const [draftsVersion, setDraftsVersion] = useState(0)
  const composerSelectionGenerationRef = useRef(0)
  /**
   * Les brouillons du composer, indexes par conversation. HYDRATES depuis le stockage local au
   * montage : un rechargement de fenetre (mise a jour appliquee, rechargement a chaud, plantage du
   * renderer) effacait sinon TOUT le texte en cours de frappe — perte signalee le 2026-09-01
   * (« ca m'enleve de la conversation ou j'ecris et ca m'efface le message »). Les pieces jointes ne
   * se rechargent pas : leur contenu n'est pas persiste.
   */
  const composerDraftsRef = useRef(
    (() => {
      const carte = new Map<string, ComposerDraft>([
        [NEW_DRAFT_KEY, { input: '', attachments: [], error: null }]
      ])
      for (const [cle, input] of Object.entries(lireBrouillons()))
        carte.set(cle, { input, attachments: [], error: null })
      return carte
    })()
  )
  const activeRef = useRef<string | null>(null)
  const {
    setPanneaux,
    signalerNouveaute,
    oublierNouveaute,
    placePanneau,
    navigateurOuvert,
    bureauxOuverts,
    pagesNonVues,
    bureauxNonVus,
    basculerNavigateur,
    adopterPanneauDuFilNeuf,
    setFilDuMontagePose,
    questionACoteOuverte,
    setQuestionACoteOuverte,
    reglagesNavigateurRef
  } = usePanneauOutils({ activeId, activeRef, convViewMode, demandeBureaux, isActive })
  const loadConversationRequestRef = useRef(0)
  /** Tours déjà rejoués depuis le journal fichier — clé de dédup du rejeu (voir replayTurnJournal). */
  const replayedTurnsRef = useRef(new Set<string>())
  const runtimeRefreshGenerationRef = useRef(0)
  const runsRequestRef = useRef<RunRequestIdentity>({ id: 0, scope: 'conv', convId: null })
  const followTailRef = useRef(true)
  /** Derniere position de defilement OBSERVEE : sert a lire le SENS du mouvement (cf. doitSuivreLeBas). */
  const dernierScrollTopRef = useRef(0)
  /**
   * UNE DESCENTE AUTOMATIQUE EST EN VOL. L'evenement `scroll` ne dit pas qui l'a provoque : pendant
   * une descente, c'est NOUS qui bougeons `scrollTop` alors que le contenu grandit encore, donc la
   * mesure « pres du bas » repond `false` et le suivi etait COUPE des la premiere frame — le fil
   * s'arretait juste apres l'envoi et le bouton « ↓ Derniere reponse » s'allumait sans geste du
   * lecteur. Tant qu'une descente est en vol, seul un RECUL de `scrollTop` rend la main au lecteur
   * (cf. `doitSuivreLeBas`).
   */
  const descenteEnVolRef = useRef(false)
  /**
   * LE LECTEUR A-T-IL BOUGE LE FIL LUI-MEME ?
   *
   * DEFAUT VECU le 2026-09-01 : « je clique sur dernier message, je suis en bas ; je
   * change de conversation, je reviens, et je suis scrolle au MILIEU ». Un evenement `scroll` ne dit
   * PAS qui l'a provoque. Or l'app en emet beaucoup elle-meme (ouverture d'une conversation, reprise
   * de lecture, descente automatique pendant un tour) : chacun etait memorise comme une position
   * CHOISIE, et la derniere frame d'une descente qui n'atterrit pas ecrivait un milieu de fil.
   *
   * Ce drapeau ne s'arme que sur un geste REEL — molette, doigt, clavier, ou saisie de la barre de
   * defilement — et se desarme des que l'app reprend la main sur le fil. Rien d'autre n'ecrit une
   * position de lecture.
   */
  const gesteLecteurRef = useRef(false)
  /**
   * Position A RESTAURER a la prochaine peinture du fil : posee par `loadConv` quand la conversation
   * ouverte avait ete quittee EN COURS de lecture. Un ref et pas un state : l'effet de scroll doit la
   * consommer sur la meme frame que les messages, sans re-rendu intermediaire.
   */
  const positionARestaurerRef = useRef<PositionLecture | null>(null)
  /**
   * BASCULE EN COURS : vrai depuis l'ouverture d'une autre conversation jusqu'a l'atterrissage
   * (descente vers le bas ou reprise de lecture). Pendant ce temps, les evenements `scroll` viennent
   * du remplacement du contenu, pas du lecteur (cf. `doitIgnorerDefilementDeBascule`).
   */
  const basculeConvRef = useRef(false)
  /**
   * MASQUE PENDANT LA REPRISE. La restauration re-applique la cible sur ~20 frames pendant que le
   * markdown se rend : l'utilisateur voyait le fil sauter (clignotement signale le 2026-08-30).
   * On masque le fil le temps de la reprise, et on le revele une fois la position tenue.
   */
  const [repriseEnCours, setRepriseEnCours] = useState(false)
  /**
   * DEMANDE D'ATTERRISSAGE DU FIL, quand rien d'autre ne le declenche.
   *
   * Defaut vecu le 2026-09-02 : « quand je clique depuis la mosaique sur aller vers la conversation
   * en grand, ca me met pas scrolle jusqu'au dernier message ». Le fil plein ecran n'existe PAS en
   * mosaique : il est MONTE au clic, donc il nait en haut. Et si la conversation ouverte etait deja
   * l'active, `loadConv` repose le MEME tableau de messages — React ne re-rend pas, l'effet de
   * descente (dependant de `messages`) ne se rejoue jamais, et personne ne descend.
   */
  const [atterrissageDemande, setAtterrissageDemande] = useState(0)
  const { passageSelectionne, setPassageSelectionne } = usePassageSelectionne({ scrollRef })
  const { choisirCompteDeConversation } = useComptesClaude({
    activeId,
    compteBusy,
    setCompteBusy,
    setCompteError,
    setCompteNouveauFil,
    setComptesClaude,
    setConvs
  })
  useEffect(() => {
    activeRef.current = activeId
  }, [activeId])

  const busy = activeId ? busyConversations.has(activeId) : false
  /**
   * Le choix de compte Claude de la conversation ouverte, partagé par la pop-up de modèle ET la
   * pop-up des quotas (demande du 2026-09-23) : un seul chemin, celui qui mémorise le compte sur le
   * fil — une bascule seulement globale ne vaudrait pas pour lui (chaque appel du fil lit son compte
   * sur la conversation).
   * Sans conversation ouverte (fil neuf pas encore créé), le bloc reste AFFICHÉ et montre le compte
   * armé, sinon le compte actif de l'application : le faire disparaître donnait l'impression que la
   * fonctionnalité avait été retirée.
   */
  const comptesDeConversation: OrchestratorAccounts | undefined = comptesClaude
    ? {
        accounts: comptesClaude.accounts,
        selectedId: activeId
          ? convs.find((conv) => conv.id === activeId)?.claudeAccountId
          : (compteNouveauFil ?? undefined),
        activeId: comptesClaude.activeId,
        // Seule la bascule elle-même verrouille les puces, JAMAIS le tour en cours (2026-10-21) :
        // c'est pendant un tour qu'on bute sur un quota épuisé, et changer de compte ne touche pas
        // le CLI déjà lancé — il a lu son compte au départ, le tour suivant repart sur le nouveau.
        busy: compteBusy,
        error: compteError,
        onSelect: (accountId) => void choisirCompteDeConversation(accountId)
      }
    : undefined

  function getComposerDraft(key: string): ComposerDraft {
    return composerDraftsRef.current.get(key) ?? { input: '', attachments: [], error: null }
  }
  async function refreshRuntimeIdentity(forceModels = false): Promise<ChatRuntimeIdentity> {
    const generation = ++runtimeRefreshGenerationRef.current
    const [models, roles] = await Promise.all([window.api.models(forceModels), window.api.roles()])
    const catalog = models as RuntimeModel[]
    const binding = roles.orchestrator
    const resolved = resolveChatRuntimeIdentity(
      {
        orchestrator: {
          slotId: 'orchestrator',
          provider: binding.provider,
          modelId: binding.model ?? '',
          reasoningEffort: binding.reasoningEffort ?? 'auto'
        }
      },
      catalog,
      binding
    )
    if (generation === runtimeRefreshGenerationRef.current) {
      setModelCatalog(catalog)
      setOrchestratorBinding(binding)
      setModelCatalogLoaded(true)
      setRuntimeIdentity(resolved)
    }
    return resolved
  }

  // ---- Relais vers les modules voisins (chat-view-*.ts) : mêmes noms, mêmes signatures ; chaque
  // relais passe au module les valeurs de CE rendu, comme le faisait la fonction quand elle vivait ici.
  function poserCompteArme(conversationId: string): Promise<void> {
    return modeleFil.poserCompteArme(ctxModele(), conversationId)
  }
  function poserModeleArme(conversationId: string): Promise<void> {
    return modeleFil.poserModeleArme(ctxModele(), conversationId)
  }
  function repeindreLesFenetresVides(ids: string[], fils: Record<string, Msg[]>): void {
    return gestesMosaique.repeindreLesFenetresVides(ctxGestesMosaique(), ids, fils)
  }
  function texteDuComposer(): string {
    return brouillons.texteDuComposer(ctxBrouillons())
  }
  function ctxPassage(): passageFil.PassageCtx {
    return {
      activeRef,
      addFiles,
      brouillonVisible,
      composerDraftKeyRef,
      composerRef,
      composersMosaiqueRef,
      convViewMode,
      getComposerDraft,
      ouvrirDansLeNavigateur,
      reglagesNavigateurRef,
      scrollRef,
      setConvViewMode,
      setDraftError,
      setDraftInput,
      setPanneaux,
      setPassageSelectionne,
      texteDuComposer
    }
  }
  function surRelachementDansLeFil(): void {
    return passageFil.surRelachementDansLeFil(ctxPassage())
  }
  function agirSurPassage(action: ActionPassage, texte: string): void {
    return passageFil.agirSurPassage(ctxPassage(), action, texte)
  }
  function insererElementChoisi(element: ElementChoisiNavigateur): void {
    return passageFil.insererElementChoisi(ctxPassage(), element)
  }
  function surClicLienDuFil(event: React.MouseEvent<HTMLElement>): void {
    return passageFil.surClicLienDuFil(ctxPassage(), event)
  }
  function ouvrirDansLeNavigateur(conversationId: string, adresse: string): Promise<void> {
    return passageFil.ouvrirDansLeNavigateur(ctxPassage(), conversationId, adresse)
  }
  function brouillonVisible(): string {
    return brouillons.brouillonVisible(ctxBrouillons())
  }
  function recevoirElementCible(arg0: ElementCible): void {
    return passageFil.recevoirElementCible(ctxPassage(), arg0)
  }
  function ctxBrouillons(): brouillons.BrouillonsCtx {
    return {
      activeRef,
      composerDraftKeyRef,
      composerDraftsRef,
      composerRef,
      composerSelectionGenerationRef,
      composersMosaiqueRef,
      convViewMode,
      getComposerDraft,
      setAttachmentError,
      setAttachments,
      setDraftAttachments,
      setDraftError,
      setDraftsVersion
    }
  }
  function setDraftInput(key: string, value: string): void {
    return brouillons.setDraftInput(ctxBrouillons(), key, value)
  }
  function setDraftAttachments(
    key: string,
    update: (current: ChatAttachment[]) => ChatAttachment[]
  ): void {
    return brouillons.setDraftAttachments(ctxBrouillons(), key, update)
  }
  function retirerPieceJointeDuBrouillonCourant(fileIndex: number): void {
    return brouillons.retirerPieceJointeDuBrouillonCourant(ctxBrouillons(), fileIndex)
  }
  function setDraftError(key: string, error: string | null): void {
    return brouillons.setDraftError(ctxBrouillons(), key, error)
  }
  function switchComposerDraft(key: string): void {
    return brouillons.switchComposerDraft(ctxBrouillons(), key)
  }
  function beginConversationsResize(event: React.PointerEvent<HTMLDivElement>): void {
    return gestesListe.beginConversationsResize(ctxGestesListe(), event)
  }
  function beginRunsResize(event: React.PointerEvent<HTMLDivElement>): void {
    return panneauRuns.beginRunsResize(ctxPanneauRuns(), event)
  }
  function ctxModele(): modeleFil.ModeleCtx {
    return {
      activeId,
      busy,
      compteNouveauFilRef,
      modelChangePending,
      modeleNouveauFilRef,
      poserOrchestrateurDuStudio,
      setCompteError,
      setCompteNouveauFil,
      setConvs,
      setModelChangeError,
      setModelChangePending,
      setModeleNouveauFil
    }
  }
  function poserOrchestrateurDuStudio(option: OrchestratorModelOption): Promise<void> {
    return modeleFil.poserOrchestrateurDuStudio(ctxModele(), option)
  }
  function changerModeleDuFil(option: OrchestratorModelOption | null): Promise<void> {
    return modeleFil.changerModeleDuFil(ctxModele(), option)
  }
  function ctxFileAttente(): fileAttente.FileAttenteCtx {
    return {
      busyConversationsRef,
      compactionEnAttenteRef,
      dernierMessageUtilisateurDe,
      drainApresVerrouRef,
      interruptingConversationsRef,
      liveMessagesRef,
      lotsRetenusDansLeFil,
      lotsRetenusRef,
      marquerRecusDesLots,
      nextQueueEntryIdRef,
      queueRef,
      retirerRecusEnAttente,
      send,
      sendLocksRef,
      setBusyConversations,
      setConversationQueue,
      setDirectiveReceipts,
      setInterruptingConversations,
      stopDemandeRef,
      stoppedQueueDrainRef,
      teteRetenueParLeVerrou
    }
  }
  function setConversationBusy(id: string, value: boolean): void {
    return fileAttente.setConversationBusy(ctxFileAttente(), id, value)
  }
  function setConversationInterrupting(id: string, value: boolean): void {
    return fileAttente.setConversationInterrupting(ctxFileAttente(), id, value)
  }
  function ctxRecus(): recus.RecusCtx {
    return {
      liveMessagesRef,
      pilotFlushRef,
      queueRef,
      retirerDirectiveReceipt,
      setConversationQueue,
      setDirectiveReceipts
    }
  }
  function journaliserSaisie(
    conversationId: string,
    texte: string,
    voie: 'message' | 'orientation',
    origine?: 'mode-auto'
  ): void {
    return recus.journaliserSaisie(conversationId, texte, voie, origine)
  }
  function setDirectiveReceipt(
    conversationId: string,
    entry: QueuedDirective,
    status: DirectiveReceipt['status'],
    reponse?: boolean,
    attente?: Pick<DirectiveReceipt, 'attenteMotif' | 'commande'>
  ): void {
    return recus.setDirectiveReceipt(ctxRecus(), conversationId, entry, status, reponse, attente)
  }
  function retirerRecusEnAttente(conversationId: string, textes: string[]): void {
    return recus.retirerRecusEnAttente(ctxRecus(), conversationId, textes)
  }
  function retirerDirectiveReceipt(conversationId: string, entryId: number): void {
    return recus.retirerDirectiveReceipt(ctxRecus(), conversationId, entryId)
  }
  function annulerEnvoiEnAttente(conversationId: string, receipt: DirectiveReceipt): void {
    return recus.annulerEnvoiEnAttente(ctxRecus(), conversationId, receipt)
  }
  function rebaseDirectiveReceiptsAfterStreamReset(
    conversationId: string,
    reset: { streamId: string; conclusionSeule?: true }
  ): void {
    return recus.rebaseDirectiveReceiptsAfterStreamReset(ctxRecus(), conversationId, reset)
  }
  function addFiles(
    files: FileList | File[],
    cible?: string,
    cleDeDoublon: (fichier: { name: string; size: number }) => string = cleNomTaille
  ): Promise<void> {
    return brouillons.addFiles(ctxBrouillons(), files, cible, cleDeDoublon)
  }
  function autoResumeOnce(loaded: Conv[]): Promise<void> {
    return chargementFil.autoResumeOnce(ctxFil(), loaded)
  }
  function refreshConvs(): Promise<void> {
    return chargementFil.refreshConvs(ctxFil())
  }
  function setConversationQueue(id: string, next: QueuedDirective[]): void {
    return fileAttente.setConversationQueue(ctxFileAttente(), id, next)
  }
  function marquerRecusDesLots(id: string, motif: 'lot' | 'lot-quota'): void {
    return fileAttente.marquerRecusDesLots(ctxFileAttente(), id, motif)
  }
  function lotsRetenusDansLeFil(id: string): boolean {
    return fileAttente.lotsRetenusDansLeFil(ctxFileAttente(), id)
  }
  function teteRetenueParLeVerrou(id: string): boolean {
    return fileAttente.teteRetenueParLeVerrou(ctxFileAttente(), id)
  }
  function lancerCompactionAuto(conversationId: string): void {
    return fileAttente.lancerCompactionAuto(ctxFileAttente(), conversationId)
  }
  function drainerApresVerrou(id: string): void {
    return fileAttente.drainerApresVerrou(ctxFileAttente(), id)
  }
  function enqueueMessage(
    id: string,
    text: string,
    mode?: QueuedDirective['mode'],
    attachments?: ChatAttachment[],
    origine?: Pick<QueuedDirective, 'lot'>
  ): void {
    return fileAttente.enqueueMessage(ctxFileAttente(), id, text, mode, attachments, origine)
  }
  function ctxPanneauRuns(): panneauRuns.PanneauRunsCtx {
    return {
      activeRef,
      fichesRequestRef,
      refreshFiches,
      refreshRuns,
      runsPaneWidth,
      runsRequestRef,
      setFiches,
      setOngletPanneau,
      setRuns,
      setRunsPaneWidth,
      setShowRuns,
      viewRun
    }
  }
  function refreshRuns(): Promise<void> {
    return panneauRuns.refreshRuns(ctxPanneauRuns())
  }
  function refreshFiches(): Promise<void> {
    return panneauRuns.refreshFiches(ctxPanneauRuns())
  }
  function rechargerRunsEtFiches(): void {
    return panneauRuns.rechargerRunsEtFiches(ctxPanneauRuns())
  }
  function ctxMontage(): montage.MontageCtx {
    return {
      activeRef,
      busyConversationsRef,
      convsRef,
      enqueueMessage,
      liveMessagesRef,
      loadConv,
      lotsRetenusDansLeFil,
      patchLast,
      queueRef,
      recevoirElementCibleRef,
      refreshConvs,
      refreshFiches,
      refreshRuns,
      refreshRuntimeIdentity,
      relirePlansRef,
      rendreLaFileAuComposer,
      repriseDemarrageRef,
      runDuCadrageRef,
      send,
      setAppNotice,
      setCadrageReplie,
      setComptesClaude,
      setConversationQueue,
      setDefaultWorkspace,
      setFilDuMontagePose,
      setHypothesesCadrage,
      setLiveRuns,
      stopDemandeRef,
      stoppedQueueDrainRef,
      teteRetenueParLeVerrou
    }
  }
  function brancherLeChatAuMontage(): () => void {
    return montage.brancherLeChatAuMontage(ctxMontage())
  }
  function publierFil(conversationId: string | null, fil: Msg[]): void {
    return chargementFil.publierFil(ctxFil(), conversationId, fil)
  }
  function patchLast(
    conversationId: string,
    fn: (m: AsstMsg) => void,
    porte?: (m: AsstMsg) => boolean
  ): void {
    return chargementFil.patchLast(ctxFil(), conversationId, fn, porte)
  }
  function ctxFil(): chargementFil.FilCtx {
    return {
      activeRef,
      autoResumeOnce,
      basculeConvRef,
      busyConversationsRef,
      convsRef,
      followTailRef,
      gesteLecteurRef,
      liveMessagesRef,
      loadConv,
      loadConversationRequestRef,
      marquerConversationVue,
      mosaicIdsRef,
      patchLast,
      positionARestaurerRef,
      publierFil,
      reconcilierTourNonClos,
      replayedTurnsRef,
      replayTurnJournal,
      repriseDemarrageRef,
      resetConvLoad,
      sendRef,
      setActiveId,
      setConversationBusy,
      setConvLoad,
      setConvs,
      setHasNewActivity,
      setListeTelOuverte,
      setMessages,
      setMosaicFils,
      setScrolledAwayFromTail,
      switchComposerDraft
    }
  }
  function loadConv(c: Conv, filDeRepli?: readonly Msg[]): Promise<void> {
    return chargementFil.loadConv(ctxFil(), c, filDeRepli)
  }
  function reconcilierTourNonClos(id: string): Promise<void> {
    return chargementFil.reconcilierTourNonClos(ctxFil(), id)
  }
  function traiterTravauxNonPublies(): Promise<void> {
    return gestesFil.traiterTravauxNonPublies(ctxGestesFil())
  }
  function ctxGestesMosaique(): gestesMosaique.GestesMosaiqueCtx {
    return {
      activeRef,
      composerRef,
      composersMosaiqueRef,
      convsRef,
      convViewModeRef,
      dossierNouveauFilRef,
      fermerFenetreMosaique,
      followTailRef,
      liveMessagesRef,
      loadConv,
      loadConversationRequestRef,
      mosaicIdsRef,
      newConv,
      nouvelleFenetreMosaique,
      ouvrirDansMosaique,
      poserCompteArme,
      poserDansFenetreMosaique,
      poserModeleArme,
      refreshRuntimeIdentity,
      resetConvLoad,
      setActiveId,
      setAtterrissageDemande,
      setConvs,
      setConvViewMode,
      setDraftInput,
      setHasNewActivity,
      setListeTelOuverte,
      setMessages,
      setMosaicFils,
      setMosaicIds,
      switchComposerDraft
    }
  }
  function ouvrirDansMosaique(id: string): Promise<void> {
    return gestesMosaique.ouvrirDansMosaique(ctxGestesMosaique(), id)
  }
  function nouvelleFenetreMosaique(brouillon?: string): Promise<void> {
    return gestesMosaique.nouvelleFenetreMosaique(ctxGestesMosaique(), brouillon)
  }
  function poserDansFenetreMosaique(id: string, texte: string): void {
    return gestesMosaique.poserDansFenetreMosaique(ctxGestesMosaique(), id, texte)
  }
  function signalerFils(ids: readonly string[]): void {
    return gestesMosaique.signalerFils(ctxGestesMosaique(), ids)
  }
  function basculerDansMosaique(id: string): Promise<void> {
    return gestesMosaique.basculerDansMosaique(ctxGestesMosaique(), id)
  }
  function ouvrirSeuleDepuisMosaique(id: string): Promise<void> {
    return gestesMosaique.ouvrirSeuleDepuisMosaique(ctxGestesMosaique(), id)
  }
  function fermerFenetreMosaique(id: string): void {
    return gestesMosaique.fermerFenetreMosaique(ctxGestesMosaique(), id)
  }
  function fermerToutesFenetresMosaique(): void {
    return gestesMosaique.fermerToutesFenetresMosaique(ctxGestesMosaique())
  }
  function newConv(): void {
    return gestesMosaique.newConv(ctxGestesMosaique())
  }
  function ctxEcouteurs(): ecouteurs.EcouteursCtx {
    return {
      activeRef,
      composerRef,
      convsRef,
      convViewModeRef,
      loadConv,
      newConv,
      ouvrirDansMosaique,
      poserDansFenetreMosaique,
      refreshConvs,
      refreshFiches,
      replayTurnJournal,
      send,
      setActiveId,
      setDraftInput,
      setMessages,
      switchComposerDraft
    }
  }
  function ecouterPrefillEtBrainwash(): () => void {
    return ecouteurs.ecouterPrefillEtBrainwash(ctxEcouteurs())
  }
  function replayTurnJournal(conversationId: string, turnId: string): Promise<void> {
    return chargementFil.replayTurnJournal(ctxFil(), conversationId, turnId)
  }
  function ecouterOuvertureDeConversation(): () => void {
    return ecouteurs.ecouterOuvertureDeConversation(ctxEcouteurs())
  }
  function ctxGestesListe(): gestesListe.GestesListeCtx {
    return {
      activeId,
      composerDraftsRef,
      conversationsPaneWidth,
      deleteCandidate,
      deleteRunCandidate,
      newConv,
      openRun,
      quitterModeSelection,
      refreshConvs,
      refreshRuns,
      renameCandidate,
      runDeletePending,
      selectedConvIds,
      setBulkDeleteAsking,
      setBulkDeleteError,
      setConversationsPaneWidth,
      setConvSelectionMode,
      setDeleteCandidate,
      setDeleteRunCandidate,
      setOpenRun,
      setOpenTrace,
      setRenameCandidate,
      setRunDeleteError,
      setRunDeletePending,
      setSelectedConvIds
    }
  }
  function renameConv(c: Conv): void {
    return gestesListe.renameConv(ctxGestesListe(), c)
  }
  function confirmRenameConv(): Promise<void> {
    return gestesListe.confirmRenameConv(ctxGestesListe())
  }
  function removeConv(c: Conv): Promise<void> {
    return gestesListe.removeConv(ctxGestesListe(), c)
  }
  function confirmRemoveConv(): Promise<void> {
    return gestesListe.confirmRemoveConv(ctxGestesListe())
  }
  function toggleConvSelection(id: string): void {
    return gestesListe.toggleConvSelection(ctxGestesListe(), id)
  }
  function quitterModeSelection(): void {
    return gestesListe.quitterModeSelection(ctxGestesListe())
  }
  function confirmBulkDelete(): Promise<void> {
    return gestesListe.confirmBulkDelete(ctxGestesListe())
  }
  function requestDeleteRun(run: RunEntry): void {
    return gestesListe.requestDeleteRun(ctxGestesListe(), run)
  }
  function confirmDeleteRun(): Promise<void> {
    return gestesListe.confirmDeleteRun(ctxGestesListe())
  }
  function reloadActiveFromStore(id: string): Promise<void> {
    return chargementFil.reloadActiveFromStore(ctxFil(), id)
  }
  function ctxGestesFil(): gestesFil.GestesFilCtx {
    return {
      activeId,
      activeRef,
      brancheDansLaCopie,
      busyConversationsRef,
      composerRef,
      enqueueMessage,
      filsAvecLotsRef,
      loadConv,
      messages,
      newConv,
      nextQueueEntryIdRef,
      refreshRuntimeIdentity,
      reloadActiveFromStore,
      send,
      setAppNotice,
      setConvs,
      setDirectiveReceipt,
      setDraftInput
    }
  }
  function forkFromMessage(messageId: string): Promise<void> {
    return gestesFil.forkFromMessage(ctxGestesFil(), messageId)
  }
  function modifierEtRelancer(messageId: string): Promise<void> {
    return gestesFil.modifierEtRelancer(ctxGestesFil(), messageId)
  }
  function revenirAuTour(messageId: string): Promise<void> {
    return gestesFil.revenirAuTour(ctxGestesFil(), messageId)
  }
  function brancheDansLaCopie(
    source: string,
    ancre: string | undefined,
    chemin: string,
    titre: string
  ): Promise<{ ok: true; id: string } | { ok: false; raison: string }> {
    return gestesFil.brancheDansLaCopie(ctxGestesFil(), source, ancre, chemin, titre)
  }
  function envoyerALaSuite(id: string, textes: readonly string[]): void {
    return gestesFil.envoyerALaSuite(ctxGestesFil(), id, textes)
  }

  /*
   * POINTER UN MOMENT D'UNE VIDÉO DU FIL (2026-10-11) : la référence va au curseur de la
   * saisie, l'image passe par `addFiles` (mêmes plafonds, même dédoublonnage nom + taille). La
   * référence est insérée même si l'image est refusée (9e pièce jointe…). Valeur STABLE : le fil
   * mémoïsé (`filRendu`) n'a pas à se recalculer.
   */
  const addFilesRef = useRef(addFiles)
  useTenirRefAJour(addFilesRef, addFiles)
  const recevoirElementCibleRef = useRef<((element: ElementCible) => void) | null>(null)
  const pointerMomentVideo = useCallback((moment: MomentPointe): void => {
    composerRef.current?.insererAuCurseur(moment.reference)
    // Doublon par NOM seul : `<vidéo>-i<N>.png` désigne une image précise ; deux encodages PNG du
    // même instant n'ont pas de taille garantie identique (non mesuré).
    if (moment.image) void addFilesRef.current([moment.image], undefined, (fichier) => fichier.name)
  }, [])

  /* --- données latérales --- */

  /**
   * Survie niveau 2 — REPRISE AUTOMATIQUE, déclenchée ICI (et pas dans App) parce que c'est ChatView
   * qui sait quand les conversations sont réellement chargées : dispatcher à l'aveugle après un délai
   * ratait la reprise (course au démarrage, constatée en essai réel). Une seule fois par session.
   */
  const repriseDemarrageRef = useRef<Promise<void> | null>(null)
  // File d'attente LOCALE (renderer) : messages tapés pendant un tour, envoyés comme des tours
  // NORMAUX un par un à la fin du tour courant → chaque message = sa propre paire Q/R (rendu propre).
  const nextQueueEntryIdRef = useRef(0)
  const queueRef = useRef<Map<string, QueuedDirective[]>>(new Map())
  /**
   * LA TÊTE DE LA FILE ATTEND LE VERROU D'ENVOI, ELLE NE SORT PAS POUR ÊTRE JETÉE.
   *
   * `busy` tombe à l'événement `done`, mais le verrou d'envoi (`sendLocksRef`) ne se relâche que dans
   * le `finally` de `send`, à la RÉPONSE de `pilotChat` — que le main rend après son propre `finally`
   * (`run-pilot-chat.ts`, qui diffuse aussi `directives-orphelines` avant de répondre). Entre les
   * deux, un drain voyait le fil libre, sortait la tête de la file, et `send` la refusait sans un mot.
   * Perte réelle : 2026-10-16, orientation « basé sur les axes que t'as généré tour 1 scout
   * des améliorations » (saisie ts 1792149113401), jamais lue ni renvoyée ; la suite du mode auto est
   * partie à sa place 22 ms après le `done`.
   *
   * À consulter par CHAQUE sortie automatique de la file, avant d'en retirer la tête : verrou tenu =
   * elle reste en file, visible, et `send` relance le drain à la fin de sa clôture
   * (`drainerApresVerrou`).
   */
  const drainApresVerrouRef = useRef(new Set<string>())
  /**
   * LA COMPACTION AUTOMATIQUE ATTEND LE VERROU, ELLE AUSSI (2026-10-22).
   *
   * Décidée au `done` qui franchit le palier critique — donc dans l'intervalle où le verrou d'envoi
   * tient encore (voir `teteRetenueParLeVerrou`). `send` la refusait sans un mot, alors que le fil
   * était déjà noté compacté (`compactionAutoRef`) : plus aucune tentative avant que la jauge
   * redescende, ce qu'elle ne fait pas sans résumé. Verrou tenu ou tour reparti = elle attend, et la
   * fin de clôture de `send` la relance. Témoin : `ChatView.compaction-auto-verrou.test.tsx`.
   */
  const compactionEnAttenteRef = useRef(new Set<string>())
  const rechargerRunsEtFichesRef = useRef(rechargerRunsEtFiches)
  // À chaque changement de fil. Corps posé en fin de composant, comme les effets suivants.
  useEffect(() => rechargerRunsEtFichesRef.current(), [activeId])
  // Tient le bus au courant de la conversation active → les orchestrations s'y rattachent.
  useEffect(() => {
    window.api.setActiveConversation(activeId)
  }, [activeId])
  /**
   * REPOSE le brouillon restaure dans le composer, a chaque fois que ce composer nait : au montage,
   * et au retour de la mosaique, qui le demonte. La carte est hydratee depuis le stockage
   * local, mais le composer garde son texte chez lui (handle imperatif) : sans cette remise, le
   * texte retrouve restait invisible tant qu'aucune conversation n'etait rouverte.
   */
  useEffect(() => {
    const restaure = getComposerDraft(composerDraftKeyRef.current).input
    if (restaure) composerRef.current?.setInput(restaure)
  }, [convViewMode])
  const brancherLeChatAuMontageRef = useRef(brancherLeChatAuMontage)
  useEffect(() => brancherLeChatAuMontageRef.current(), [])

  useEffect(() => {
    if (isActive) void Promise.resolve().then(() => refreshRuntimeIdentity())
  }, [isActive])
  useFluxDuPilote({
    busyConversationsRef, compactionAutoRef, compactionEnAttenteRef, dernierMessageUtilisateurDe,
    lancerCompactionAuto, liveMessagesRef, patchLast, pilotFlushRef, publierFil,
    rebaseDirectiveReceiptsAfterStreamReset, setContextesStatiques, setContextGauges,
    setConversationBusy
  })
  useRepriseDeLecture({
    activeDirectiveReceipts, atterrissageDemande, basculeConvRef, dernierScrollTopRef,
    descenteEnVolRef, followTailRef, gesteLecteurRef, messages, positionARestaurerRef, scrollRef,
    setHasNewActivity, setRepriseEnCours, setScrolledAwayFromTail
  })

  /**
   * FIN DE TOUR — descente de RATTRAPAGE. L'effet ci-dessus ne se rejoue que sur `messages` : or la
   * fin d'un tour change la HAUTEUR du fil sans toucher aux messages (le bandeau « en cours »
   * disparait, la file d'attente se vide, le bloc de cloture finit de se peindre). Personne ne
   * redescendait donc, et le fil restait arrete au milieu de la derniere reponse avec le bouton
   * « ↓ Derniere reponse » alors que l'utilisateur n'avait rien remonte (rapporte le 2026-09-01,
   * Capture a l'appui).
   *
   * Le plafond de frames est plus large qu'en streaming : le contenu tardif d'une fin de tour
   * (markdown final, blocs `html-render`, images) se stabilise en plusieurs centaines de
   * millisecondes, et une boucle de 40 frames atterrissait court. On poursuit le bas plus longtemps
   * — et si malgre tout on n'atterrit pas, le bouton le DIT au lieu de mentir.
   */
  const busyPrecedentRef = useRef(busy)
  useEffect(() => {
    const finDeTour = busyPrecedentRef.current && !busy
    busyPrecedentRef.current = busy
    if (!finDeTour) return
    const scroll = scrollRef.current
    // On ne force RIEN si le lecteur a quitte le bas de lui-meme : sa position lui appartient.
    if (!scroll || !followTailRef.current) return
    gesteLecteurRef.current = false
    descenteEnVolRef.current = true
    dernierScrollTopRef.current = scroll.scrollTop
    const annulerDescente = scrollChatToBottom(
      scroll,
      requestAnimationFrame,
      120,
      (landed) => {
        descenteEnVolRef.current = false
        if (!landed) setHasNewActivity(true)
      },
      () => gesteLecteurRef.current
    )
    return () => {
      descenteEnVolRef.current = false
      annulerDescente()
    }
  }, [busy])

  /**
   * FIL QUI REMONTE PENDANT LA FRAPPE. La barre de saisie grandit ligne par ligne et vole de la
   * hauteur au fil ; le navigateur garde `scrollTop`, donc le bas sort du champ tout seul. On
   * rend au fil ce que la fenetre lui a pris, uniquement quand le lecteur suivait le bas.
   */
  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll || typeof ResizeObserver === 'undefined') return
    let hauteurPrecedente = scroll.clientHeight
    const observer = new ResizeObserver(() => {
      // REAPPARITION du fil : il etait masque (hauteur 0) pendant que le tour ecrivait, donc toutes
      // les descentes se sont exécutées dans le vide. On rattrape le bas AVANT toute compensation.
      if (
        doitRattraperApresReapparition({
          suivaitLeBas: followTailRef.current,
          hauteurPrecedente,
          metrics: scroll
        })
      ) {
        hauteurPrecedente = scroll.clientHeight
        gesteLecteurRef.current = false
        descenteEnVolRef.current = true
        dernierScrollTopRef.current = scroll.scrollTop
        scrollChatToBottom(
          scroll,
          requestAnimationFrame,
          120,
          (landed) => {
            descenteEnVolRef.current = false
            if (!landed) setHasNewActivity(true)
          },
          () => gesteLecteurRef.current
        )
        return
      }
      const cible = compenserRetrecissementDuFil({
        suivaitLeBas: followTailRef.current,
        hauteurPrecedente,
        metrics: scroll
      })
      hauteurPrecedente = scroll.clientHeight
      if (cible === null) return
      // Repositionnement MECANIQUE, pas un geste de lecture : le suivi du bas doit survivre.
      gesteLecteurRef.current = false
      dernierScrollTopRef.current = cible
      scroll.scrollTop = cible
    })
    observer.observe(scroll)
    return () => observer.disconnect()
  }, [])

  /* --- conversations : sélection = fil rechargé depuis le store --- */

  /**
   * ÉTAT DE CHARGEMENT du fil. Sans lui, une IPC `conversation()` qui rejette (ou qui rend `null`)
   * laissait une promesse non gérée et un fil VIDE, impossible à distinguer d'une conversation
   * réellement vide — et sans aucun moyen de réessayer.
   */
  const [convLoad, setConvLoad] = useState<{
    status: 'idle' | 'loading' | 'error'
    target?: Conv
    error?: string
  }>({ status: 'idle' })
  const resetConvLoad = (): void =>
    setConvLoad((prev) => (prev.status === 'idle' ? prev : { status: 'idle' }))
  const ecouterPrefillEtBrainwashRef = useRef(ecouterPrefillEtBrainwash)
  useEffect(() => ecouterPrefillEtBrainwashRef.current(), [])
  const ecouterOuvertureDeConversationRef = useRef(ecouterOuvertureDeConversation)
  useEffect(() => ecouterOuvertureDeConversationRef.current(), [])
  const { queueCurrentMessage, tourEncoreVivant, rendreLaFileAuComposer, stopPilotTurn, submitBtw, handleBtw, filsAvecLotsRef, basculerModeAuto, basculerModeAutoPour, handleFork, handleModifier, handleRevenir, sendRef, pickSuggestion, annulerEnvoi, planSelection, doitAutoLancerCandidats, answerAsk, submitBtwRef, refineResumeDraft, ouvrirLogin, send } = useToursEtEnvoi({
    activeId,
    activeRef,
    adopterPanneauDuFilNeuf,
    annulerEnvoiEnAttente,
    annulerRelanceProgrammee,
    autoActif,
    autoAllumageManuelRef,
    autoArmePour,
    autoConvs,
    autoDiffereesRef,
    autoEssaisRef,
    autoEtatsRef,
    autoFilAmorceRef,
    autoNouveauFilRef,
    autoProgrammeesRef,
    autoRepriseApresRedemarrageRef,
    autoSuiviesRef,
    autoTic,
    brouillonPresent,
    busy,
    busyConversations,
    busyConversationsRef,
    compactionEnAttenteRef,
    composerDraftKeyRef,
    composerDraftsRef,
    composerRef,
    composerSelectionGenerationRef,
    convs,
    convsRef,
    depotPresent,
    dernierScrollTopRef,
    desarmerAuto,
    dossierNouveauFilRef,
    drainApresVerrouRef,
    drainerApresVerrou,
    effacerArretAuto,
    enqueueMessage,
    envoyerALaSuite,
    followTailRef,
    forkFromMessage,
    gardeChaine,
    gesteLecteurRef,
    getComposerDraft,
    interruptingConversationsRef,
    journaliserSaisie,
    lancerCompactionAuto,
    liveMessagesRef,
    liveRuns,
    loadConv,
    lotsRetenusDansLeFil,
    mentionSourcesRef,
    messages,
    modifierEtRelancer,
    nextQueueEntryIdRef,
    ouvrirDansMosaique,
    patchLast,
    poserCompteArme,
    poserModeleArme,
    positionARestaurerRef,
    publierFil,
    queueRef,
    quotaHebdoRef,
    refreshRuntimeIdentity,
    retirerDirectiveReceipt,
    revenirAuTour,
    scrollRef,
    sendLocksRef,
    setActiveId,
    setAppNotice,
    setArretsAuto,
    setAtterrissageDemande,
    setAutoConvs,
    setAutoNouveauFil,
    setAutoTic,
    setConversationBusy,
    setConversationInterrupting,
    setConversationQueue,
    setConvs,
    setConvViewMode,
    setDirectiveReceipt,
    setDraftAttachments,
    setDraftError,
    setDraftInput,
    setHasNewActivity,
    setQuotaHebdoConnu,
    setScrolledAwayFromTail,
    stopDemandeRef,
    stoppedQueueDrainRef,
    teteRetenueParLeVerrou,
    texteDuComposer,
    toursAutoRef,
    vueMonteeRef
  })
  const { convsCoupeesParQuota, situationsDeLaReprise, repriseQuotaNotice, repriseQuotaMasqueePour, setRepriseQuotaMasqueePour, cleRepriseQuota, reprendreConversationsCoupeesParQuota, coupuresParModele, reprendreSurUnAutreModele, resumePilotTurn, viewRun, relireRunOuvert } = useRepriseDesTours({
    activeRef,
    busyConversations,
    busyConversationsRef,
    convs,
    followTailRef,
    liveMessagesRef,
    openRunPathRef,
    openTrace,
    patchLast,
    publierFil,
    sendLocksRef,
    setConversationBusy,
    setOpenRun,
    setOpenTrace,
    setRunDetailTab,
    tourEncoreVivant
  })
  useTenirRefAJour(viewRunRef, viewRun)
  const {
    active, resumeAvailable, composersMosaiqueRef, rendrePiecesJointesEnAttente, fenetresMosaique, ouvrirFilMosaiqueStable,
    fermerFenetreStable, ouvrirSeuleStable, nouvelleFenetreStable, rendreComposerStable,
    repondreAskMosaiqueStable, remplirSaisie, remplirSaisieMosaique, signatureComposerMosaique,
    correspondancesContenu, convStatusFilter, setConvStatusFilter, conversationHits,
    groupesReplies, basculerGroupe, surviole, setSurvole, dossiersMemorises, setDossiersMemorises,
    estRetire, memoriserDossier, oublierDossier, rangerDans
  } = useRenduMosaique({
    activeId, addFiles, autoConvs, basculerModeAutoPour, busy, busyConversations,
    busyConversationsRef, composerDraftKeyRef, composerRef, conversationDateOrder, convQuery,
    convs, depotPresent, draftsVersion, fermerFenetreMosaique, getComposerDraft,
    interruptingConversations, mentionSources, messages, mosaicFils, mosaicIds,
    nouvelleFenetreMosaique, ouvrirDansMosaique, ouvrirSeuleDepuisMosaique, refreshConvs, send,
    sendRef, setDraftAttachments, setDraftInput, setOpenImage, skillCommands, stopPilotTurn,
    submitBtw, submitBtwRef
  })
  useTenirRefAJour(recevoirElementCibleRef, recevoirElementCible)
  const {
    marquerInactive, marquerPrive, surligner, appliquerRangement, dossierPersonnel,
    estDossierPersonnel, dossiersConversations, categoriesConnues, saisieCategorie,
    setSaisieCategorie, liensDeLots, relirePlansRef, planDuFilOuvert, ongletDuFilOuvert,
    filsDesBureaux, questionsDesLots, openRunsCount, visibleLiveRuns,
    messagesUtilisateurAvantDebut, filRendu, rendreLignesListe, lignesAffichables, avisApp
  } = useListeDesConversations({
    active, activeDirectiveReceiptsByMessage, activeId, annulerEnvoi, answerAsk, appNotice,
    basculerDansMosaique, basculerGroupe, busy, busyConversations, conversationDateOrder,
    conversationHits, conversationsVues, convQuery, convs, convSelectionMode, convStatusFilter,
    convViewMode, correspondancesContenu, doitAutoLancerCandidats, dossierParDefaut,
    dossiersMemorises, groupesReplies, handleFork, handleModifier, handleRevenir, isActive, langue,
    liveRuns, loadConv, memoriserDossier, messages, mosaicIds, onInspectTurn, oublierNouveaute,
    ouvrirLogin,
    pickSuggestion, planSelection, rangerDans, refineResumeDraft, refreshConvs, revealLiveAction,
    runs, selectedConvIds, setAppNotice, setConvMenu, setConvSelectionMode, setDossierNouveauFil,
    setDossiersMemorises, setOpenImage, setSelectedConvIds, setSurvole, showRuns, signalerNouveaute,
    surviole, toggleConvSelection
  })
  /*
   * CORPS DES EFFETS de plus haut, posés ICI, sous les hooks dont ils appellent les fonctions
   * (`send`, `viewRun`, `composersMosaiqueRef`…).
   * fix-ok: cause mesurée — le compilateur React refusait ces effets (« Cannot access variable
   * before it is declared ») : leur corps lit des noms que ces hooks ne rendent que plus bas.
   * Les effets eux-mêmes restent À LEUR PLACE : descendus ici, ils auraient tourné après une
   * vingtaine d'autres effets, dont ceux des hooks d'envoi, et le pré-remplissage gardé au montage
   * (`ouvrirEcouteurPrefill`) aurait changé de rang. L'effet d'insertion pose chaque corps avant
   * tout effet du même rendu : chacun appelle donc les fonctions de son rendu, comme avant.
   */
  useTenirRefAJour(repeindreLesFenetresVidesRef, repeindreLesFenetresVides)
  useTenirRefAJour(rechargerRunsEtFichesRef, rechargerRunsEtFiches)
  useTenirRefAJour(brancherLeChatAuMontageRef, brancherLeChatAuMontage)
  useTenirRefAJour(ecouterPrefillEtBrainwashRef, ecouterPrefillEtBrainwash)
  useTenirRefAJour(ecouterOuvertureDeConversationRef, ecouterOuvertureDeConversation)

  return (
    <div
      className={`chat-layout${showRuns ? '' : ' is-runs-collapsed'}${
        convViewMode === 'mosaic' ? ' is-mosaic' : ''
      }${listeTelOuverte ? ' is-liste-tel' : ''}`}
      data-testid="chat-view"
      data-active-conversation-id={activeId ?? ''}
    >
      {/* HARNAIS DE PROFILAGE (heal gels vue chat, 2026-09-18) : `vue-chat` seul ne disait pas QUELLE
          zone tenait le fil d'affichage (1,3 a 2,8 s). Chaque zone signale son propre
          rendu long sous `vue-chat-<zone>`, par le canal existant de `gels.jsonl`. */}
      {/* ---- Panneau gauche : conversations ---- */}
      <PanneauDesConversations
        activeId={activeId}
        cleRepriseQuota={cleRepriseQuota}
        convDensity={convDensity}
        conversationHits={conversationHits}
        conversationsPaneWidth={conversationsPaneWidth}
        convQuery={convQuery}
        convs={convs}
        convsCoupeesParQuota={convsCoupeesParQuota}
        convSelectionMode={convSelectionMode}
        convStatusFilter={convStatusFilter}
        convViewMode={convViewMode}
        coupuresParModele={coupuresParModele}
        fermerToutesFenetresMosaique={fermerToutesFenetresMosaique}
        lignesAffichables={lignesAffichables}
        marquerInactive={marquerInactive}
        modelCatalog={modelCatalog}
        mosaicIds={mosaicIds}
        mosaicIdsRef={mosaicIdsRef}
        newConv={newConv}
        nouvelleFenetreMosaique={nouvelleFenetreMosaique}
        ouvrirDansMosaique={ouvrirDansMosaique}
        quitterModeSelection={quitterModeSelection}
        rendreLignesListe={rendreLignesListe}
        reprendreConversationsCoupeesParQuota={reprendreConversationsCoupeesParQuota}
        reprendreSurUnAutreModele={reprendreSurUnAutreModele}
        repriseQuotaMasqueePour={repriseQuotaMasqueePour}
        repriseQuotaNotice={repriseQuotaNotice}
        selectedConvIds={selectedConvIds}
        setBulkDeleteAsking={setBulkDeleteAsking}
        setConvDensity={setConvDensity}
        setConvFolderMenu={setConvFolderMenu}
        setConvQuery={setConvQuery}
        setConvStatusFilter={setConvStatusFilter}
        setConvViewMode={setConvViewMode}
        setListeTelOuverte={setListeTelOuverte}
        setRepriseQuotaMasqueePour={setRepriseQuotaMasqueePour}
        setSaisieCategorie={setSaisieCategorie}
        signalerFils={signalerFils}
        situationsDeLaReprise={situationsDeLaReprise}
      />
      {convMenu &&
        createPortal(
          <MenuConversation
            convMenu={convMenu}
            convMenuRef={convMenuRef}
            convViewMode={convViewMode}
            marquerInactive={marquerInactive}
            marquerPrive={marquerPrive}
            rangerDans={rangerDans}
            removeConv={removeConv}
            renameConv={renameConv}
            setConvFolderMenu={setConvFolderMenu}
            setConvMenu={setConvMenu}
            setConvSelectionMode={setConvSelectionMode}
            setSelectedConvIds={setSelectedConvIds}
            signalerFils={signalerFils}
            surligner={surligner}
          />,
          document.body
        )}
      {brancheMenu &&
        createPortal(
          <MenuBrancheDuFil
            brancheMenu={brancheMenu}
            brancheMenuRef={brancheMenuRef}
            gitBranch={gitBranch}
            gitCwd={gitCwd}
            setBrancheMenu={setBrancheMenu}
          />,
          document.body
        )}
      {convFolderMenu &&
        createPortal(
          <MenuDossierConversation
            appliquerRangement={appliquerRangement}
            categoriesConnues={categoriesConnues}
            convFolderMenu={convFolderMenu}
            convFolderMenuRef={convFolderMenuRef}
            defaultWorkspace={defaultWorkspace}
            dossierPersonnel={dossierPersonnel}
            dossiersConversations={dossiersConversations}
            estDossierPersonnel={estDossierPersonnel}
            estRetire={estRetire}
            oublierDossier={oublierDossier}
            saisieCategorie={saisieCategorie}
            setConvFolderMenu={setConvFolderMenu}
            setSaisieCategorie={setSaisieCategorie}
          />,
          document.body
        )}
      <div
        className="conv-pane-resizer"
        role="separator"
        aria-label={texteFil('liste.redimensionner')}
        aria-orientation="vertical"
        aria-valuemin={CHAT_PANE_LIMITS.conversations.min}
        aria-valuemax={CHAT_PANE_LIMITS.conversations.max}
        aria-valuenow={conversationsPaneWidth}
        onPointerDown={beginConversationsResize}
      />

      {/* ---- Centre : mosaique multi-chat, ou le fil unique ---- */}
      {convViewMode === 'mosaic' && avisApp && <div className="chat-avis-mosaique">{avisApp}</div>}
      {convViewMode === 'mosaic' ? (
        <ChatMosaic
          fenetres={fenetresMosaique}
          onClose={fermerFenetreStable}
          onOuvrirSeule={ouvrirSeuleStable}
          rendreComposer={rendreComposerStable}
          onNouvelleConversation={nouvelleFenetreStable}
          onAnswerAsk={repondreAskMosaiqueStable}
          onRemplirSaisie={remplirSaisieMosaique}
          signatureComposer={signatureComposerMosaique}
          liensDeLots={liensDeLots}
          questionsDesLots={questionsDesLots}
          onOuvrirFil={ouvrirFilMosaiqueStable}
        />
      ) : (
        <SectionDuFil
          active={active}
          activeDirectiveReceipts={activeDirectiveReceipts}
          activeId={activeId}
          activeRef={activeRef}
          addFiles={addFiles}
          agirSurPassage={agirSurPassage}
          annulerEnvoi={annulerEnvoi}
          arretsAuto={arretsAuto}
          attachmentError={attachmentError}
          attachments={attachments}
          autoActif={autoActif}
          autoConvs={autoConvs}
          autoNouveauFil={autoNouveauFil}
          avisApp={avisApp}
          basculeConvRef={basculeConvRef}
          basculerModeAuto={basculerModeAuto}
          basculerNavigateur={basculerNavigateur}
          bindingEffectif={bindingEffectif}
          brouillonPresent={brouillonPresent}
          bulkDeleteAsking={bulkDeleteAsking}
          bulkDeleteError={bulkDeleteError}
          bureauxNonVus={bureauxNonVus}
          bureauxOuverts={bureauxOuverts}
          busy={busy}
          busyConversations={busyConversations}
          cadrageReplie={cadrageReplie}
          changerModeleDuFil={changerModeleDuFil}
          composerDraftKeyRef={composerDraftKeyRef}
          composerRef={composerRef}
          comptesDeConversation={comptesDeConversation}
          confirmBulkDelete={confirmBulkDelete}
          confirmDeleteRun={confirmDeleteRun}
          confirmRemoveConv={confirmRemoveConv}
          confirmRenameConv={confirmRenameConv}
          contextesStatiques={contextesStatiques}
          convLoad={convLoad}
          convs={convs}
          copieAffichee={copieAffichee}
          defaultWorkspace={defaultWorkspace}
          deleteCandidate={deleteCandidate}
          deleteRunCandidate={deleteRunCandidate}
          dernierScrollTopRef={dernierScrollTopRef}
          descenteEnVolRef={descenteEnVolRef}
          dossierProjetAffiche={dossierProjetAffiche}
          dragActive={dragActive}
          effacerArretAuto={effacerArretAuto}
          estDossierPersonnel={estDossierPersonnel}
          fileInputRef={fileInputRef}
          filRendu={filRendu}
          followTailRef={followTailRef}
          friction={friction}
          gesteLecteurRef={gesteLecteurRef}
          ghostRecommendation={ghostRecommendation}
          gitBranch={gitBranch}
          gitCwd={gitCwd}
          handleBtw={handleBtw}
          hasNewActivity={hasNewActivity}
          hypothesesCadrage={hypothesesCadrage}
          identifiantCopie={identifiantCopie}
          interruptingConversations={interruptingConversations}
          isActive={isActive}
          jaugeCourante={jaugeCourante}
          listeNonPubliee={listeNonPubliee}
          listeTelOuverte={listeTelOuverte}
          liveRuns={liveRuns}
          loadConv={loadConv}
          mentionSources={mentionSources}
          messageNonPublieMasque={messageNonPublieMasque}
          messages={messages}
          messagesUtilisateurAvantDebut={messagesUtilisateurAvantDebut}
          modelCatalog={modelCatalog}
          modelCatalogLoaded={modelCatalogLoaded}
          modelChangeError={modelChangeError}
          modelChangePending={modelChangePending}
          modeleDuFil={modeleDuFil}
          navigateurOuvert={navigateurOuvert}
          ongletDuFilOuvert={ongletDuFilOuvert}
          openRunsCount={openRunsCount}
          pagesNonVues={pagesNonVues}
          passageSelectionne={passageSelectionne}
          phrasesAccueil={phrasesAccueil}
          placePanneau={placePanneau}
          planDuFilOuvert={planDuFilOuvert}
          pointerMomentVideo={pointerMomentVideo}
          positionARestaurerRef={positionARestaurerRef}
          propositionsSuite={propositionsSuite}
          questionACoteOuverte={questionACoteOuverte}
          questionsDesLots={questionsDesLots}
          queueCurrentMessage={queueCurrentMessage}
          quotaHebdoConnu={quotaHebdoConnu}
          rechercheFilOuverte={rechercheFilOuverte}
          remplirSaisie={remplirSaisie}
          renameCandidate={renameCandidate}
          rendrePiecesJointesEnAttente={rendrePiecesJointesEnAttente}
          repriseEnCours={repriseEnCours}
          resumeAvailable={resumeAvailable}
          resumePilotTurn={resumePilotTurn}
          retirerPieceJointeDuBrouillonCourant={retirerPieceJointeDuBrouillonCourant}
          runDeleteError={runDeleteError}
          runDeletePending={runDeletePending}
          runDuCadrageRef={runDuCadrageRef}
          runtimeIdentity={runtimeIdentity}
          scrolledAwayFromTail={scrolledAwayFromTail}
          scrollRef={scrollRef}
          selectedConvIds={selectedConvIds}
          send={send}
          setBrancheMenu={setBrancheMenu}
          setBrouillonPresent={setBrouillonPresent}
          setBulkDeleteAsking={setBulkDeleteAsking}
          setCadrageReplie={setCadrageReplie}
          setConvFolderMenu={setConvFolderMenu}
          setDeleteCandidate={setDeleteCandidate}
          setDeleteRunCandidate={setDeleteRunCandidate}
          setDraftInput={setDraftInput}
          setDragActive={setDragActive}
          setHasNewActivity={setHasNewActivity}
          setIdentifiantCopie={setIdentifiantCopie}
          setListeNonPubliee={setListeNonPubliee}
          setListeTelOuverte={setListeTelOuverte}
          setMessageNonPublieMasque={setMessageNonPublieMasque}
          setPanneaux={setPanneaux}
          setQuestionACoteOuverte={setQuestionACoteOuverte}
          setRechercheFilOuverte={setRechercheFilOuverte}
          setRenameCandidate={setRenameCandidate}
          setScrolledAwayFromTail={setScrolledAwayFromTail}
          setShowRuns={setShowRuns}
          showRuns={showRuns}
          skillCommands={skillCommands}
          stopPilotTurn={stopPilotTurn}
          surClicLienDuFil={surClicLienDuFil}
          surRelachementDansLeFil={surRelachementDansLeFil}
          traiterTravauxNonPublies={traiterTravauxNonPublies}
          travailNonPublie={travailNonPublie}
          usagesAccueil={usagesAccueil}
        />
      )}

      {/* ---- Navigateur intégré (lot 3/5) : entre le fil et les Détails, fil unique
          seulement. Démonté en mosaïque ou fermé : il retire alors la page native (poserCadre(null)). */}
      {convViewMode !== 'mosaic' && navigateurOuvert && activeId && (
        <BarriereErreur zone="chat-navigateur" cle={activeId}>
          <NavigateurIntegre
            key={activeId}
            conversationId={activeId}
            visible={isActive && !openImage}
            onFermer={() => setPanneaux((ouverts) => fermerDans(ouverts, activeId))}
            onElementChoisi={insererElementChoisi}
            onReglages={(reglages) => {
              reglagesNavigateurRef.current = reglages
            }}
          />
        </BarriereErreur>
      )}

      {/* ---- Bureaux cachés : à la place du navigateur. Aussi sans fil ouvert et en
          mosaïque, contrairement à lui : une demande « va sur les bureaux cachés » ne doit pas rester
          sans effet visible. */}
      {bureauxOuverts && (
        <BarriereErreur zone="chat-bureaux" cle="bureaux">
          <HdeskGestionView
            active={isActive}
            fils={filsDesBureaux}
            onFermer={() => setPanneaux((ouverts) => fermerDans(ouverts, placePanneau))}
            onOpenConversation={(cible) => {
              // Aller au fil d'un bureau depuis ce panneau, c'est vouloir y voir ce bureau : le
              // panneau s'ouvre aussi dans le fil d'arrivée.
              setPanneaux((ouverts) => ouvrirDans(ouverts, cible.conversationId, 'bureaux'))
              // Le même chemin que le reste de l'app : il sait attendre un fil pas encore listé.
              window.dispatchEvent(new CustomEvent('autowin:open-conversation', { detail: cible }))
            }}
          />
        </BarriereErreur>
      )}

      {/* ---- Panneau droit : workflows + observatoire d'activité (repliable) ---- */}
      {runsAffiche && (
        <VueMesuree id="chat-workflows" bloc cle={activeId}>
          <WorkflowsPanel
            fermeture={!showRuns}
            onFermee={runsSorti}
            depotConversation={gitCwd}
            runsPaneWidth={runsPaneWidth}
            beginRunsResize={beginRunsResize}
            setShowRuns={setShowRuns}
            activeId={activeId}
            send={send}
            isActive={isActive}
            requestLabel={
              [...messages].reverse().find((message) => message.role === 'user')?.content
            }
            messages={messages}
            liveGraphActive={
              Boolean(activeId && busyConversations.has(activeId)) ||
              liveRuns[activeId ?? '']?.status === 'running'
            }
            visibleLiveRuns={visibleLiveRuns}
            runs={runs}
            fiches={fiches}
            openRun={openRun}
            viewRun={viewRun}
            relireRunOuvert={(r) => void relireRunOuvert(r)}
            setOpenRun={setOpenRun}
            setOpenTrace={setOpenTrace}
            requestDeleteRun={requestDeleteRun}
            openTrace={openTrace}
            runDetailTab={runDetailTab}
            setRunDetailTab={setRunDetailTab}
            liveRunCardRef={liveRunCardRef}
            {...(ongletPanneau ? { ongletDemande: ongletPanneau } : {})}
            {...(onInspectTurn ? { onInspectTurn } : {})}
          />
        </VueMesuree>
      )}
      {openImage &&
        createPortal(
          <ImageAgrandie
            openImage={openImage}
            setOpenImage={setOpenImage}
          />,
          document.body
        )}
    </div>
  )
}
