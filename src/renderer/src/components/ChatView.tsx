/* eslint-disable react-hooks/refs, react-hooks/immutability, react-hooks/purity, react-hooks/set-state-in-effect -- (conv-1508) le code de ce fichier vient de ChatView.tsx, déplacé tel quel. Ces règles du compilateur React ne s'y appliquaient pas : il renonçait à analyser le composant de 10 000 lignes (lint vert sur le même code avant la découpe). Les rendre vraies demande de CHANGER le code, hors de cette découpe sans changement de comportement. */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { formaterNombre } from '../langue'
import { useTextesChatFil } from '../textes-ecrans/chat-fil'
import { useBrancheCourante } from './branche-courante'
import { presenceDepuisRunsVivants } from './run-presence'
import { useClampDansFenetre } from './useClampDansFenetre'
import { createPortal } from 'react-dom'
import { mesurerMessagesRendus } from './chat-mesure-messages'
import { filAffichable } from './fil-affichable'
import { AnimationAccueilChat } from './AnimationAccueilChat'
import { pickTurnToResume, rejeuDejaEnregistre, type UnfinishedTurn } from './resume-unfinished'
import { reclamerOuvertureConversation } from './pending-conversation-open'
import { reclamerFicheAOuvrir, runDeLaFiche } from './fiches-du-fil'
import type { FicheDeDemande } from '../../../shared/fiche-de-demande'
import { fermerEcouteurPrefill, ouvrirEcouteurPrefill } from './relais-prefill'
import { refreshesActiveConversation } from './chat-event-routing'
import { pickRunForTrace } from './run-trace-target'
import {
  type ConversationsVues,
  ecrireConversationsVues,
  lireConversationsVues,
  marquerVue
} from './conversation-seen'
import {
  CHAT_PANE_LIMITS,
  clampConversationPaneWidth,
  densiteSuivante,
  libelleDensite,
  lireDensiteConversations,
  traitsDensite,
  type DensiteConversation,
  createLiveRunDeltaBatcher,
  hydrateStoredAssistant,
  isRunRequestCurrent,
  doitSuivreLeBas,
  compenserRetrecissementDuFil,
  doitIgnorerDefilementDeBascule,
  doitRattraperApresReapparition,
  isChatNearBottom,
  scrollChatToBottom,
  reduceScopedLiveRuns,
  reduceAssistantPilotEvent,
  settleIfDone,
  resolveChatRuntimeIdentity,
  skillSlashCommands,
  type SlashCommand,
  type OrchStep,
  type ChatRuntimeIdentity,
  type OrchestratorModelOption,
  type RunRequestIdentity,
  type ScopedLiveRun,
  settleOrchestrationOnRunEnd,
  noterChoixDePipeline,
  completerChoixDePipeline,
  ajouterRaisonnementDePipeline,
  indexDeLaBulleQuiPorte,
  porteUneOrchestrationOuverte,
  texteDuPrompt
} from './chat-view-model'
import { shortModelLabel } from './model-display-label'
import { buildHomeSuggestions, usagesDesSkills } from './chat-home-suggestions'
import { lotsRetenusParLeQuota } from './lots-retenus-quota'
import { BarrePassage, type PassageAffiche } from './BarrePassage'
import {
  ajouterAuBrouillon,
  passageDuFil,
  texteDeLActionSurPassage,
  type ActionPassage
} from './passage-selectionne'
import { ecouterElementsCibles, type ElementCible } from './alt-clic'
import { SuppressionConversationsCarte } from './SuppressionConversationsCarte'
import { departPourModifier } from './modifier-relancer'
import { demandePourLaFacon, titreDeLaFacon } from './trois-facons'
import { ComparaisonDesFacons } from './ComparaisonDesFacons'
import { ChatComposer, type ChatComposerHandle } from './ChatComposer'
import { PointerMomentVideo, type MomentPointe } from './video-pointage-context'
// La demande d'autorisation de production s'affiche DANS LE FIL, en bas, juste au-dessus de la zone
// de saisie — et non plus en fenêtre flottante (demande utilisateur du 2026-09-16, conv-626).
import { ProdAutorisationHote } from './ProdAutorisationHote'
import { TableauDesLots } from './TableauDesLots'
import { SuperConvDuChat } from './SuperConvMosaique'
import { DirectiveReceiptRow } from './ChatMessageRow'
import { rejouerOrientations } from './orientations-rejouees'
import { promptDeRelanceGratuite } from './auto-relance'
import {
  arretReglableDansBehaviour,
  lireSeuilsChaine,
  CLE_SEUILS_CHAINE_AUTO
} from './chat-auto-mode'
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
import { buildMentionSources } from './chat-mentions'
import { ForkIcon } from './chat-view-icons'
import { encodeAttachment } from './chat-attachments'
import { derniereConversationOuverte, memoriserDerniereConversation } from './derniere-conversation'
import {
  brouillonEnAttente,
  lireBrouillons,
  memoriserBrouillon,
  oublierBrouillons
} from './brouillons-persistes'
import {
  memoriserPositionLecture,
  oublierPositionLecture,
  positionLectureMemorisee,
  type PositionLecture
} from './position-lecture'
import { conversationsRecentes } from './conversation-search'
import { nomDeDossier } from './conversation-groups'
import { canonicalProjectPath, estCheminDeDossier } from '../../../shared/project-path'
import { OrchestratorModelSelector, type OrchestratorAccounts } from './OrchestratorModelSelector'
import { ChatMosaic } from './ChatMosaic'
import { ConversationCostIndicator } from './ConversationCostIndicator'
import { ModelQuotaIndicator } from './ModelQuotaIndicator'
import { ContextGaugeDetail } from './ContextGaugeIndicator'
import { ChatContextRule } from './ChatContextRule'
import { COMPACT_REQUEST } from '../../../shared/context-gauge'
import { WorkflowsPanel, type OpenRunState, type RunDetailTab } from './WorkflowsPanel'
// La classe `.lisere-dessus` vit dans cette feuille : importee ICI et non « heritee » d'une
// autre vue, sinon l'apparence de Chat dependrait de l'ordre de chargement des AUTRES vues.
import './ViewPage.css'
import { jaugeVide, type ContextGauge } from '../../../shared/context-gauge'
import { composerContexte, type ContexteStatique } from '../../../shared/contexte-detaille'
import './ChatView.css'
import './SlashPalette.css'
import './ChatComposerExtras.css'
import { frictionEchecsRepetes } from '../../../shared/friction-echecs-repetes'
import type { HypotheseDeCadrage } from '../../../shared/cadrage-confiance'
import { CadrageHypotheses } from './CadrageHypotheses'
import { orchestrationOutcomesFromMessages } from './action-outcome-summary'
import type { InspectTurnTarget } from '../observatory-focus'

/* ---------- Types ---------- */

// Types partagés : dans `chat-view-types.ts` depuis la découpe. Ré-exportés ici pour que les
// importateurs historiques (`RunEntry`, `CheckpointEntry`) n'aient RIEN à changer.
export type { RunEntry, CheckpointEntry } from './chat-view-types'
import { useSkillsCatalog } from './useSkillsInventory'
import { messageTravailNonPublie, promptTravauxNonPublies } from './travail-non-publie'
import { TravauxNonPublies } from './TravauxNonPublies'
import { ChatFindBar } from './ChatFindBar'
import { Spinner } from './Spinner'
import { BarriereErreur } from './BarriereErreur'
import { VueMesuree } from './VueMesuree'
import { reutiliserConversationsInchangees } from './conversations-stables'
import { AscenseurDuFil } from './AscenseurDuFil'
import { rangsEffacesParLeReset } from '../../../shared/chat-turn'
/** Fils armes en mode auto (reglage PAR conversation ; `*` = ancien reglage global migre). */
import { CLE_MODE_AUTO_CONVS, EVT_ARMER_MODE_AUTO } from './chat-auto-convs'
import { lireArretsChaine, oublierArretChaine } from './arrets-chaine-persistes'
import { lireToursAuto } from './tours-auto-persistes'
import { RunsEnDirect } from './runs-en-direct'
import { RemplirSaisieDuFil } from './saisie-du-fil'
import { BoutonBureauxCaches, BoutonDetails, BoutonNavigateur } from './BoutonNavigateur'
import { HdeskGestionView } from './HdeskGestionView'
import { NavigateurIntegre } from './NavigateurIntegre'
import { useRaccourciQuestionACote } from './question-a-cote-outils'
import { BoutonQuestionACote, QuestionACote } from './QuestionACote'
import {
  apiNavigateur,
  blocPourLeChat,
  lienAOuvrirDansLePanneau
} from './navigateur-integre-outils'
import type { ElementChoisiNavigateur, ReglagesNavigateur } from '../../../shared/navigateur'
import {
  type RuntimeModel,
  type ModeleDuFil,
  texteFil,
  texteDeLaSituation,
  LIBELLE_FILTRE_STATUT,
  CLE_DOSSIER_NOUVEAU_FIL,
  lireJaugesMemorisees,
  lireContextesMemorises,
  IconeInfini,
  PastilleEnTete,
  propositionsDuFil,
  ghostDuFil,
  MAX_ATTACHMENTS,
  NEW_DRAFT_KEY,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_BYTES,
  traceSilentFailure,
  type AppNotice,
  newestNotice,
  type MessageStocke,
  hydraterFilStocke,
  cleNomTaille
} from './chat-view-outils'
import { useRepriseDesTours } from './chat-view-reprise'
import { useToursEtEnvoi } from './chat-view-envoi'
import { useListeDesConversations } from './chat-view-liste'
import { useRenduMosaique } from './chat-view-mosaique'
import { useRepriseDeLecture } from './chat-view-defilement'
import { useFluxDuPilote } from './chat-view-flux-pilote'

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
  convsRef.current = convs
  const [convQuery, setConvQuery] = useState('')
  const conversationDateOrder: 'desc' | 'asc' = 'desc'
  const [activeId, setActiveId] = useState<string | null>(null)
  // VERSION TÉLÉPHONE (conv-1568) : la liste des conversations devient un tiroir par-dessus le fil,
  // ouvert par le bouton ☰ de l'en-tête (affichage-session.css) ; choisir un fil le referme.
  const [listeTelOuverte, setListeTelOuverte] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  /** Le fil courant pour la carte du fil, dont le clic peut attendre quelques images (conv-1059). */
  const messagesRef = useRef<Msg[]>(messages)
  messagesRef.current = messages
  /**
   * Le TEXTE en cours de frappe ne vit plus ici : il appartient à `ChatComposer` (conv-1466).
   * ChatView ne garde que la carte des brouillons (`composerDraftsRef`, source de vérité) et ce
   * handle, par lequel il RÉIMPOSE une valeur — sans qu'une frappe le re-rende.
   */
  const composerRef = useRef<ChatComposerHandle | null>(null)
  /** Seule retombée d'une frappe sur la vue : vide ↔ non-vide (la home s'y accroche). */
  const [brouillonPresent, setBrouillonPresent] = useState(false)
  /*
   * MODE AUTO — « renvoie tout seul la suite proposée jusqu'à ce qu'il ne reste rien ».
   *
   * Cadrage utilisateur (2026-09-02) : l'interrupteur est dans la barre de gauche et le mode reste
   * ACTIF jusqu'à ce qu'on le coupe — pas de plafond de tours, pas d'extinction au changement de
   * fil. Il s'applique donc à la conversation qu'on a sous les yeux, quelle qu'elle soit.
   * Toute la décision d'envoyer vit dans `chat-auto-mode.ts` (fonction pure testée).
   */
  /**
   * L'INTERRUPTEUR SURVIT AU REDÉMARRAGE (demande utilisateur du 2026-09-02 : « fais que le mode
   * auto survive à un redémarrage de l'app »). Il vivait en mémoire seule, donc un rafraîchissement
   * de l'interface l'éteignait EN SILENCE — indistinguable d'un arrêt légitime sur « rien ».
   *
   * Aucun tour payant n'est déclenché par cette reprise : au premier passage dans un fil, la boucle
   * marque le tour déjà présent comme traité (`autoAllumageManuelRef` reste faux au démarrage), donc
   * elle repart sur le PROCHAIN tour terminé, jamais sur une réponse d'avant la fermeture.
   */
  /**
   * REGLAGE PAR CONVERSATION (demande utilisateur du 2026-09-07 : « je veux pouvoir regler le mode
   * auto a l'echelle d'une conversation »). L'interrupteur ne vit plus en booleen unique : on
   * memorise l'ENSEMBLE des fils armes. Le bouton porte donc sur le fil AFFICHE, et un fil arme
   * continue d'enchainer en arriere-plan pendant qu'on regarde ailleurs.
   *
   * L'ancien reglage global est migre en joker `*` : « tous les fils », jusqu'a la premiere
   * extinction. Ainsi une session qui redemarre avec le mode global allume le retrouve allume.
   */
  const [autoConvs, setAutoConvs] = useState<Set<string>>(() => {
    const brut = window.localStorage.getItem(CLE_MODE_AUTO_CONVS)
    if (brut) {
      try {
        const lu = JSON.parse(brut)
        if (Array.isArray(lu)) return new Set(lu.filter((x): x is string => typeof x === 'string'))
      } catch {
        /* reglage illisible : on repart a vide plutot que de planter l'ecran */
      }
    }
    return window.localStorage.getItem('autowin.chat.modeAuto') === '1' ? new Set(['*']) : new Set()
  })
  useEffect(() => {
    window.localStorage.setItem(CLE_MODE_AUTO_CONVS, JSON.stringify([...autoConvs]))
  }, [autoConvs])
  // Un fil arme de l'exterieur (mode auto Tickets) rejoint l'ensemble sans etre ecrase.
  useEffect(() => {
    const armer = (e: Event): void => {
      const id = (e as CustomEvent<unknown>).detail
      if (typeof id === 'string' && id)
        setAutoConvs((prev) => (prev.has(id) ? prev : new Set([...prev, id])))
    }
    window.addEventListener(EVT_ARMER_MODE_AUTO, armer)
    return () => window.removeEventListener(EVT_ARMER_MODE_AUTO, armer)
  }, [])
  const autoArmePour = useCallback(
    (id: string | null | undefined): boolean =>
      // `id`, PAS le fil affiche : cette fonction est appelee pour les fils d'ARRIERE-PLAN.
      autoConvs.has('*') || (!!id && autoConvs.has(id)),
    [autoConvs]
  )
  /** Vrai quand le fil AFFICHE est arme — c'est ce que montre le bouton. */
  const autoActif = autoArmePour(activeId)
  /**
   * MODE AUTO ARME SUR UN FIL PAS ENCORE CREE. Sans cela le bouton ne faisait RIEN dans un
   * nouveau fil : il n'y a pas encore d'identifiant a armer, donc le clic sortait en silence
   * — « quand j'ouvre un nouveau fil je peux pas toggle le mode auto » (2026-09-07).
   * L'intention est gardee ici, puis posee sur la conversation des sa creation.
   */
  const [autoNouveauFil, setAutoNouveauFil] = useState(false)
  const autoNouveauFilRef = useRef(false)
  autoNouveauFilRef.current = autoNouveauFil
  /**
   * DOSSIER DE TRAVAIL ARME SUR UN FIL PAS ENCORE CREE. Meme defaut que le mode auto : le dossier
   * ne se choisissait que sur une conversation EXISTANTE (menu ⋮), donc le premier tour d'un fil
   * neuf tournait toujours dans le depot de repli. L'intention est gardee ici, puis posee sur la
   * conversation des sa creation — `dossierDeTravailDuTour` la lit alors des le premier tour.
   *
   * Un LIBELLE deja memorise ici est ignore (conv-81) : avant la separation, le menu proposait des
   * categories parmi les dossiers, et en choisir une armait le prochain fil sur un dossier qui
   * n'existe pas. La pastille du haut affichait alors ce libelle comme dossier de travail.
   */
  const [dossierNouveauFil, setDossierNouveauFil] = useState<string | null>(() => {
    try {
      const lu = window.localStorage.getItem(CLE_DOSSIER_NOUVEAU_FIL)
      return lu && estCheminDeDossier(lu) ? lu : null
    } catch {
      return null
    }
  })
  const dossierNouveauFilRef = useRef<string | null>(null)
  dossierNouveauFilRef.current = dossierNouveauFil
  useEffect(() => {
    if (dossierNouveauFil) window.localStorage.setItem(CLE_DOSSIER_NOUVEAU_FIL, dossierNouveauFil)
    else window.localStorage.removeItem(CLE_DOSSIER_NOUVEAU_FIL)
  }, [dossierNouveauFil])
  /**
   * fix-ok: kaizen conv-113 — cause mesuree : `autowin.chat.dossierNouveauFil` n'etait jamais vide
   * apres usage (journal des conversations : conv-113 recoit ce dossier a sa creation, 08:15:43) ;
   * ChatView.dossier-nouveau-fil.test.tsx rouge (garde 'D:/Projets/Cible') puis vert.
   * Le dossier arme sert au fil qui NAIT, puis se vide — comme ∞ arme sur un fil neuf. Il n'etait
   * jamais vide (kaizen conv-113) : `conv-113`, ne d'un lien vers PaperTrading, a recu a sa creation
   * `D:\Chirurgien\AssistantChirurgien`, arme des semaines plus tot pour un autre fil, et toute la
   * suite du fil a derive vers ce depot.
   */
  function consommerDossierNouveauFil(): void {
    dossierNouveauFilRef.current = null
    setDossierNouveauFil(null)
  }
  /**
   * MODÈLE ARMÉ SUR UN FIL PAS ENCORE CRÉÉ (conv-239, 2026-10-11 : « rends le modèle propre à
   * chaque conversation »). Même logique que le dossier armé ci-dessus : l'intention est gardée
   * ici, posée sur la conversation dès sa création, puis vidée. Volontairement en MÉMOIRE seule —
   * pas de localStorage : un choix qui survit des jours et retombe sur un fil sans rapport est
   * exactement le défaut du dossier armé (kaizen conv-113).
   */
  const [modeleNouveauFil, setModeleNouveauFil] = useState<ModeleDuFil | null>(null)
  const modeleNouveauFilRef = useRef<ModeleDuFil | null>(null)
  modeleNouveauFilRef.current = modeleNouveauFil
  /**
   * LE COMPTE ARMÉ POUR LE FIL QUI VA NAÎTRE (conv-1416), même chemin que le modèle ci-dessus : un clic
   * sur une puce avant le premier message vaut pour ce fil, qui ne changera pas de compte tout seul.
   */
  const [compteNouveauFil, setCompteNouveauFil] = useState<string | null>(null)
  const compteNouveauFilRef = useRef<string | null>(null)
  compteNouveauFilRef.current = compteNouveauFil
  /** Pose le compte armé sur le fil qui vient de naître, puis le vide. Un échec se dit, sans bloquer. */
  async function poserCompteArme(conversationId: string): Promise<void> {
    const arme = compteNouveauFilRef.current
    if (!arme) return
    compteNouveauFilRef.current = null
    setCompteNouveauFil(null)
    try {
      await window.api.conversationSetClaudeAccount?.(conversationId, arme)
    } catch (error) {
      setCompteError(error instanceof Error ? error.message : String(error))
    }
  }
  /** Pose le modèle armé sur le fil qui vient de naître, puis le vide. Best-effort : jamais bloquant. */
  async function poserModeleArme(conversationId: string): Promise<void> {
    const arme = modeleNouveauFilRef.current
    if (!arme) return
    modeleNouveauFilRef.current = null
    setModeleNouveauFil(null)
    try {
      const retenu = await window.api.conversationSetModel?.(
        conversationId,
        arme.provider,
        arme.model,
        arme.reasoningEffort
      )
      if (retenu)
        setConvs((courant) =>
          courant.map((conv) =>
            conv.id === conversationId ? { ...conv, modeleChoisi: retenu } : conv
          )
        )
    } catch (error) {
      // Le fil part alors sur le modèle par défaut — et l'en-tête le MONTRE ; on dit pourquoi.
      setModelChangeError(
        texteFil('modele.nonEnregistreNouveauFil', {
          raison: error instanceof Error ? error.message : String(error)
        })
      )
    }
  }
  /**
   * RELANCES DIFFÉRÉES PROGRAMMÉES, PAR CONVERSATION (conv-826 : « faudrait que le mode auto gère ce
   * cas au lieu de s'arrêter »). Le minuteur vit ici, pas dans l'effet du fil affiché : changer de
   * fil ne le tue pas. `differees` = nombre de relances différées d'affilée (borne dans
   * `deciderRelanceAuto`), remis à zéro au premier envoi ordinaire.
   */
  const autoProgrammeesRef = useRef(new Map<string, { minuteur: number; signature: string }>())
  const autoDiffereesRef = useRef(new Map<string, number>())
  const annulerRelanceProgrammee = useCallback((id: string): void => {
    const p = autoProgrammeesRef.current.get(id)
    if (p) window.clearTimeout(p.minuteur)
    autoProgrammeesRef.current.delete(id)
  }, [])
  /** Desarme un fil precis (le joker `*` disparait : eteindre ici eteint le reglage herite). */
  const desarmerAuto = useCallback((id: string | null | undefined): void => {
    setAutoConvs((precedent) => {
      const suivant = new Set(precedent)
      suivant.delete('*')
      if (id) suivant.delete(id)
      return suivant
    })
    // Éteindre le mode annule aussi la relance différée qui attendait son heure dans ce fil.
    if (id) annulerRelanceProgrammee(id)
  }, [annulerRelanceProgrammee])
  /**
   * L'avancement de la boucle, PAR CONVERSATION — `tour` = dernier tour déjà traité (un re-rendu du
   * même tour ne renvoie rien), `prompt` = dernier texte envoyé (la même suite deux fois = boucle).
   *
   * DÉFAUT VÉCU le 2026-09-02 : « j'étais en mode auto et t'as pas enchaîné le workflow ». Les
   * horaires des journaux de tours le montrent — trois conversations tournaient en parallèle
   * (conv-131, conv-133, conv-134) et la boucle, tenue par des compteurs UNIQUES, ne pouvait suivre
   * que le fil affiché. Un état par conversation est la condition pour enchaîner les autres.
   */
  const autoEtatsRef = useRef(new Map<string, { tour: string | null; prompt: string | null }>())
  /*
   * GARDE-FOU DE LA CHAÎNE ∞ (conv-38, 2026-10-02) : quota hebdomadaire Claude relevé (cache 60 s
   * côté main) et tours automatiques d'affilée comptés par fil. La DÉCISION reste dans
   * `deciderRelanceAuto` : ici on ne fait que lui fournir ces deux chiffres et les seuils réglés.
   */
  const quotaHebdoRef = useRef<number | null>(null)
  /** Faux tant qu'aucun relevé n'a donné le quota : le fil le dit quand ∞ est allumé (cadrage conv-38). */
  const [quotaHebdoConnu, setQuotaHebdoConnu] = useState(false)
  const toursAutoRef = useRef(lireToursAuto(window.localStorage))
  function gardeChaine(id: string): {
    quotaHebdoPct: number | null
    toursAutoDAffilee: number
    seuilsChaine: ReturnType<typeof lireSeuilsChaine>
  } {
    return {
      quotaHebdoPct: quotaHebdoRef.current,
      toursAutoDAffilee: toursAutoRef.current.get(id) ?? 0,
      seuilsChaine: lireSeuilsChaine(window.localStorage.getItem(CLE_SEUILS_CHAINE_AUTO))
    }
  }
  /**
   * Fils dont un tour a été VU tourner pendant que l'interrupteur est armé. C'est ce qui distingue
   * « un tour vient de finir sous mon autorité » (à enchaîner, même si l'écran est ailleurs) d'une
   * « vieille réponse d'un fil qu'on rouvre » (à ne JAMAIS relancer — le tour serait payé sans que
   * personne l'ait demandé, règle déjà figée par `ChatView.mode-auto-allumage.test.tsx`).
   */
  const autoSuiviesRef = useRef(new Set<string>())
  /** Nombre de repassages déjà faits sur un fil dont le texte n'était pas encore complet. */
  const autoEssaisRef = useRef(new Map<string, number>())
  /** Simple réveil de la boucle d'arrière-plan : rien d'autre ne change quand un fil est en retard. */
  const [autoTic, setAutoTic] = useState(0)
  /**
   * L'interrupteur vient d'être allumé À LA MAIN : ce clic PORTE sur la réponse affichée, donc la
   * suite proposée part tout de suite. Défaut vécu le 2026-09-02 (« j'ai mis le mode auto et je
   * dois encore faire tab+entrée ») : l'amorce anti-vieille-réponse, faite pour le CHANGEMENT de
   * fil, marquait aussi ce tour-là comme déjà traité, et il ne partait rien.
   */
  const autoAllumageManuelRef = useRef(false)
  /**
   * REDEMARRAGE VOULU PAR L'AGENT — ce n'est PAS l'ouverture d'un fil.
   *
   * Defaut vecu le 2026-09-05 (conv-303) : l'agent appelle `restart_app` au milieu d'une chaine en
   * mode auto. Au retour, le repere « premier passage dans ce fil » vit en memoire seule, donc il
   * est vide : la boucle croit ARRIVER dans la conversation, fige le dernier tour comme deja traite
   * et saute le maillon suivant. L'interrupteur reste allume, mais la chaine s'arrete en silence —
   * l'utilisateur voit une suite proposee qui ne part jamais et doit la renvoyer a la main.
   *
   * Une consigne de reprise POSEE SUR LE DISQUE prouve que le redemarrage etait volontaire et que
   * la chaine continue. On ne fige donc pas ce tour-la. Sans consigne (fermeture subie, simple
   * rafraichissement), le garde-fou d'origine s'applique tel quel : on ne relance pas un vieux fil.
   */
  const autoRepriseApresRedemarrageRef = useRef(false)
  /** Fil où la boucle a déjà pris son point de départ (anti-relance d'une vieille réponse). */
  const autoFilAmorceRef = useRef<string | null>(null)
  /*
   * Les suppositions du cadrage en cours, par conversation. Vivantes seulement : elles viennent d'un
   * evenement de run, sont remplacees par un nouveau cadrage et disparaissent a la fin du run. Rien
   * n'est persiste — le cadrage lui-meme l'est, dans l'etat du run.
   */
  const [hypothesesCadrage, setHypothesesCadrage] = useState<Record<string, HypotheseDeCadrage[]>>(
    {}
  )
  /*
   * REPLI DU BLOC CADRAGE, PAR CONVERSATION (conv-358, 19/10 : « garde l'etat replie [...] pour qu'il
   * reste ferme quand je change de fil et que je reviens »). La valeur est le run replie : un cadrage
   * d'un AUTRE run arrive ouvert (suppositions neuves), meme si la fin du precedent s'est perdue.
   * La fin du run efface l'entree avec les suppositions.
   */
  const [cadrageReplie, setCadrageReplie] = useState<Record<string, string>>({})
  const runDuCadrageRef = useRef<Record<string, string>>({})
  /**
   * Palette `/` déduite des skills réellement installées. MÊME source que l'exécutabilité et que la
   * palette de briques (`useSkillsInventory`) : deux lectures écrites à la main divergeraient, et
   * une vue proposerait ce qu'une autre déclare inconnu.
   */
  const skillsInstallees = useSkillsCatalog()
  const skillCommands = useMemo<SlashCommand[]>(
    () => skillSlashCommands(skillsInstallees ?? []),
    [skillsInstallees]
  )
  /*
   * Ghost-text (façon CLI) du DERNIER message assistant : placeholder grisé quand le champ est vide,
   * accepté par Tab.
   *
   * D'ABORD le PROMPT que le modèle a écrit POUR ce champ, ENSUITE seulement la rubrique
   * « 👉 Recommandé » en repli. Les deux ne disent pas la même chose : la rubrique est un état
   * adressé au lecteur (« passer en terrain »), donc la recopier ici donnait une phrase qu'il fallait
   * réécrire avant de l'envoyer. Le repli garantit qu'un tour sans prompt garde l'ancien comportement.
   */
  /*
   * LE DOSSIER DE TRAVAIL EST-IL UN DEPOT GIT ? Lu une fois : le dossier actif est fige au
   * demarrage cote main. `true` par defaut tant que la reponse n'est pas arrivee, pour ne jamais
   * relacher le garde-fou de publication sur une simple latence de lecture.
   */
  const [depotPresent, setDepotPresent] = useState(true)
  /**
   * Le depot selectionne dans la barre du haut : il sert d'EN-TETE de repli pour les fils qui n'ont
   * aucun rangement propre. Sans lui ils tombaient tous dans « Divers », alors qu'ils travaillent
   * dans ce depot-la (demande du 2026-09-17). Vide tant que la lecture n'a pas repondu -> « Divers »,
   * exactement le comportement d'avant.
   */
  const [dossierParDefaut, setDossierParDefaut] = useState('')
  useEffect(() => {
    // Canal ABSENT : on garde `true`, donc l'ancien comportement — jamais un relachement du
    // garde-fou de publication sur une simple indisponibilite de lecture.
    if (typeof window.api?.executionWorkspace !== 'function') return
    let vivant = true
    void window.api
      .executionWorkspace()
      .then((etat) => {
        if (!vivant) return
        setDepotPresent(etat.isGitRepo)
        setDossierParDefaut(etat.path ?? '')
      })
      .catch(() => {
        /* Lecture impossible : on garde le comportement d'avant, jamais un relachement. */
      })
    return () => {
      vivant = false
    }
  }, [])
  const ghostRecommendation = useMemo(
    () => ghostDuFil(messages, depotPresent),
    [messages, depotPresent]
  )
  const propositionsSuite = useMemo(
    () => propositionsDuFil(messages, depotPresent),
    [messages, depotPresent]
  )
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [appNotice, setAppNotice] = useState<AppNotice | null>(null)
  /**
   * ARRÊTS DU MODE AUTO, FIL PAR FIL (conv-891, 2026-09-30). Ils passaient par `appNotice`, un
   * emplacement UNIQUE pour tout l'écran : la pause levée par conv-885 le 29/09 à 10:47 s'affichait
   * encore 26 h plus tard au-dessus de conv-890, qui n'attendait rien, sans dire d'où elle venait.
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
  /**
   * TRAVAIL FINI, JAMAIS PUBLIE. Mesure du 2026-08-23 : trois travaux termines et prouves ont ete
   * perdus de vue le meme jour, chacun sur une branche que personne n'a fusionnee -- pendant que
   * l'utilisateur ecrivait « T'as toujours pas fais le fond d'ecran de l'accueuil ». Pire : un run
   * bloque a la PUBLICATION s'affiche en rouge, donc comme un echec, alors que son travail est fait.
   * Ce bandeau vit dans le chat parce que c'est la que l'utilisateur regarde, pas dans une vue
   * qu'il faut penser a ouvrir.
   */
  const [travailNonPublie, setTravailNonPublie] = useState<string | null>(null)
  /**
   * LE MESSAGE QU'ON A REFERME, et non un simple « ferme ». Le releve repasse toutes les 30 s et
   * reecrit `travailNonPublie` : un booleen laisserait le bandeau revenir au tick suivant, donc une
   * croix qui ne promet rien. En retenant le TEXTE, la fermeture tient tant que la situation ne
   * bouge pas -- et un travail de plus, qui change le message, rouvre l'alerte. Ce bandeau existe
   * parce que trois travaux finis ont ete perdus de vue le 2026-08-23 : le masquer pour toujours
   * etoufferait le prochain.
   */
  const [messageNonPublieMasque, setMessageNonPublieMasque] = useState<string | null>(null)
  /**
   * La LISTE des travaux non publies. Deux versions de ce bouton ont echoue avant : la premiere
   * ouvrait la vue Worktrees, la seconde la vue Workspace -- toutes deux ne montrent que les bureaux
   * VIVANTS, et affichaient donc « 0 bureau » pendant que 14 travaux attendaient. Il fallait une vue
   * qui montre les BRANCHES, pas les copies.
   */
  const [listeNonPubliee, setListeNonPubliee] = useState(false)
  useEffect(() => {
    // La vue Chat reste MONTÉE quand un autre onglet est à l'écran (App.tsx : isActive={tab==='chat'}).
    // Sonder les worktrees toutes les 30 s pour une vue invisible, c'est un IPC + une énumération git
    // payés pour un bandeau que personne ne regarde. La sonde suit donc la visibilité.
    if (!isActive) return
    let vivant = true
    const relever = async (): Promise<void> => {
      try {
        const agents = (await window.api.getWorktreeActivity?.()) ?? []
        if (vivant) setTravailNonPublie(messageTravailNonPublie(agents))
      } catch {
        // Une activite indisponible ne prouve AUCUNE perte : on se tait plutot que d'alarmer.
      }
    }
    void relever()
    const minuterie = setInterval(() => void relever(), 30_000)
    return () => {
      vivant = false
      clearInterval(minuterie)
    }
  }, [isActive])
  const [openImage, setOpenImage] = useState<{ src: string; name: string } | null>(null)
  const [dragActive, setDragActive] = useState(false)

  /**
   * CTRL+F DANS LA CONVERSATION (conv-21).
   *
   * On intercepte le raccourci du navigateur : sa recherche native n'existe pas dans une fenêtre
   * Electron sans chrome, et l'utilisateur n'avait donc AUCUN moyen de retrouver un mot dans un
   * fil long. Seul l'état ouvert/fermé vit ici — le terme cherché reste dans `ChatFindBar`, pour
   * que la frappe ne re-rende pas le fil.
   */
  const [rechercheFilOuverte, setRechercheFilOuverte] = useState(false)
  useEffect(() => {
    const surTouche = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      if (event.key !== 'f' && event.key !== 'F') return
      event.preventDefault()
      setRechercheFilOuverte(true)
      // Barre deja ouverte : le raccourci REPREND la main dessus (et selectionne le terme, pour
      // le remplacer d'une frappe) au lieu de ne rien faire.
      document.querySelector<HTMLInputElement>('.chat-find-input')?.select()
    }
    document.addEventListener('keydown', surTouche)
    return () => document.removeEventListener('keydown', surTouche)
  }, [])

  useEffect(() => {
    if (!openImage) return
    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpenImage(null)
    }
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [openImage])
  useEffect(() => {
    if (appNotice?.noticeId === undefined) return
    const noticeId = appNotice.noticeId
    // Acquitter APRÈS un frame rendu. Si React démonte la vue avant, le cleanup annule l'ack et le
    // prochain montage relira la notice au lieu de la perdre entre main et renderer.
    const frame = window.requestAnimationFrame(() => {
      void Promise.resolve(window.api.workflowProfileAcknowledgeNotice?.(noticeId)).catch(
        () => undefined
      )
    })
    return () => window.cancelAnimationFrame(frame)
  }, [appNotice])
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

    Meme regle pour un fil NEUF (conv-354, 2026-10-19 : « je suis oblige d'ecrire un premier
    message avant que ca affiche la branche ») : sans conversation ouverte, le dossier est celui
    ARME sur la pastille. Le badge l'ignorait et lisait le depot par defaut — il annoncait, listait
    et basculait les branches d'un autre depot jusqu'a la creation du fil. Une seule source pour la
    pastille et le badge : `dossierProjetAffiche`.
  */
  const convAffichee = convs.find((c) => c.id === activeId)
  const dossierProjetAffiche = convAffichee
    ? convAffichee.projectPath?.trim()
    : (dossierNouveauFil ?? undefined)
  const gitCwd = dossierProjetAffiche || defaultWorkspace || undefined
  // `getGitBranch`, pas `getGitState` : ce dernier creait 2 processus git sur le fil principal a
  // chaque relecture (toutes les 5 s) — 9 gels de 3,3 a 9,8 s (heal conv-1013).
  const lireEtatGit = useCallback(
    () => Promise.resolve(window.api.getGitBranch?.(gitCwd)),
    [gitCwd]
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
  // Menu ⋮ d'une conversation, rendu en position fixe (déborde du conteneur scrollable).
  const [convMenu, setConvMenu] = useState<{ conv: Conv; top: number; left: number } | null>(null)
  /*
    Menu de choix du dossier de travail. `conv: null` = la cible est le PROCHAIN fil, pas une
    conversation existante : la pastille de la barre du haut s'ouvre aussi quand aucun fil n'est
    ouvert, et le dossier choisi est alors garde puis pose sur la conversation des sa creation.
  */
  const convMenuRef = useRef<HTMLDivElement | null>(null)
  const brancheMenuRef = useRef<HTMLDivElement | null>(null)
  const convFolderMenuRef = useRef<HTMLDivElement | null>(null)
  const [convFolderMenu, setConvFolderMenu] = useState<{
    conv: Conv | null
    /**
     * LOT de conversations cochées (mode sélection). Champ DISTINCT de `conv` : `conv: null` veut
     * déjà dire « dossier du prochain fil » (voir `choisirDossier`) ; coder le lot par `null`
     * rangerait en silence le prochain fil au lieu des conversations cochées.
     */
    ids?: string[]
    top: number
    left: number
    /**
     * QUEL des deux rangements ce menu sert.
     *
     * `categorie` = le classement de la barre laterale (un libelle libre). `dossier` = le
     * repertoire de travail de l'agent (un vrai chemin). Les deux tenaient dans une seule liste :
     * on choisissait sa categorie sous une pile de chemins de depots qui n'avaient rien a y faire
     * (conv-79, 2026-09-17). Le choix se fait donc a l'etape D'AVANT — l'entree cliquee dans le
     * menu de la conversation dit lequel des deux on veut — et ce menu-ci n'en montre qu'un.
     */
    mode: 'categorie' | 'dossier'
  } | null>(null)
  /*
   * Menu de choix de la branche, ouvert depuis la barre du haut du chat.
   *
   * `branches: null` = la liste n'est pas encore lue. La lecture part a l'OUVERTURE du menu, en
   * asynchrone : recenser les branches pendant le dessin de la fenetre a deja fige l'interface
   * plusieurs secondes.
   */
  const [brancheMenu, setBrancheMenu] = useState<{
    top: number
    left: number
    branches: string[] | null
    /** Motif de refus rendu par l'application (arbre sale, branche absente). Affiche tel quel. */
    refus?: string
  } | null>(null)
  // Ces trois menus sont poses aux coordonnees de leur bouton : pres du bas ou du bord droit,
  // une partie sortait de la fenetre et devenait inatteignable. On les y ramene.
  useClampDansFenetre(convMenuRef, convMenu !== null)
  useClampDansFenetre(convFolderMenuRef, convFolderMenu !== null)
  useClampDansFenetre(brancheMenuRef, brancheMenu !== null)
  /**
   * Saisie du dossier en cours de creation, dans le sous-menu « Ranger dans un dossier ».
   *
   * `undefined` = pas en train de creer. La liste du menu est DERIVEE des conversations deja
   * rangees : sans ce champ, zero dossier signifiait zero moyen d'en creer un, donc zero dossier
   * pour toujours (constate le 2026-08-18). On saisit ICI plutot que via le selecteur natif :
   * un dossier de conversations est une etiquette, pas un repertoire Windows.
   */
  // File d'attente : directives injectées pendant le tour, pas encore consommées (conv active).
  // Elle n'a PLUS d'affichage (choix utilisateur du 2026-09-17 : le panneau ne servait à rien) —
  // les messages en attente se drainent seuls à la fin du tour. L'état reste tenu ici parce que
  // c'est lui que le drain lit.
  const [directiveReceipts, setDirectiveReceipts] = useState<Record<string, DirectiveReceipt[]>>({})
  /*
   * REJOUER LES CONSIGNES DU TOUR A L'OUVERTURE D'UNE CONVERSATION.
   *
   * Sans cela, une consigne tapee pendant un run disparaissait au premier changement de
   * conversation : elle ne vivait que dans `directiveReceipts`, jamais relue du journal.
   * On n'ECRASE JAMAIS des recus deja presents -- ceux du direct sont plus riches (ancre fine
   * dans le flux, statut reel) ; on ne remplit que les fils encore vides.
   */
  useEffect(() => {
    if (!activeId) return
    // Canal ABSENT (preload plus ancien, ou harnais de test) : on ne rejoue rien plutot que de
    // faire tomber tout le fil. Meme motif defensif que `PerfLagPanel` sur `perfGels`.
    if (typeof window.api?.orientationsDeConversation !== 'function') return
    let vivant = true
    void window.api
      .orientationsDeConversation(activeId)
      .then((orientations) => {
        if (!vivant || orientations.length === 0) return
        setDirectiveReceipts((current) => {
          if (current[activeId]?.length) return current
          const rejoues = rejouerOrientations(orientations, messages)
          return rejoues.length ? { ...current, [activeId]: rejoues } : current
        })
      })
      .catch(() => {
        /* Le journal est une trace de dernier recours : ne pas le lire n'est jamais une panne. */
      })
    return () => {
      vivant = false
    }
    // `messages` volontairement hors dependances : la relecture se fait a l'OUVERTURE du fil, pas a
    // chaque delta de flux -- sinon elle rejouerait a chaque token recu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])
  const activeDirectiveReceipts = useMemo(
    () => (activeId ? (directiveReceipts[activeId] ?? []) : []),
    [activeId, directiveReceipts]
  )
  const activeDirectiveReceiptsByMessage = useMemo(() => {
    const byMessage = new Map<number, DirectiveReceipt[]>()
    for (const receipt of activeDirectiveReceipts) {
      if (receipt.afterMessageIndex < 0) continue
      const current = byMessage.get(receipt.afterMessageIndex) ?? []
      byMessage.set(receipt.afterMessageIndex, [...current, receipt])
    }
    return byMessage
  }, [activeDirectiveReceipts])
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
   * LE MODÈLE DU FIL AFFICHÉ (conv-239) : son choix propre, sinon le modèle armé pour un fil neuf,
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
  /**
   * Mode d'affichage du panneau conversations. PERSISTE en localStorage comme la largeur du
   * panneau : c'est une preference locale d'affichage, elle n'a rien a faire dans le store disque.
   */
  /**
   * Conversations OUVERTES en mosaique, dans l'ordre d'ouverture. Persiste : rouvrir l'app doit
   * rendre le meme plan de travail, comme le mode d'affichage lui-meme.
   */
  const [mosaicIds, setMosaicIds] = useState<string[]>(() => {
    try {
      const brut = window.localStorage.getItem('autowin.chat.mosaicOpenIds')
      const lu: unknown = brut ? JSON.parse(brut) : []
      return Array.isArray(lu) ? lu.filter((id): id is string => typeof id === 'string') : []
    } catch {
      return []
    }
  })
  const mosaicIdsRef = useRef(mosaicIds)
  useEffect(() => {
    mosaicIdsRef.current = mosaicIds
    window.localStorage.setItem('autowin.chat.mosaicOpenIds', JSON.stringify(mosaicIds))
  }, [mosaicIds])
  /** Fils PEINTS des fenetres ouvertes — le fil actif garde son propre etat `messages`. */
  const [mosaicFils, setMosaicFils] = useState<Record<string, Msg[]>>({})
  /**
   * RE-HYDRATATION apres rafraichissement. `mosaicIds` persiste en localStorage, `mosaicFils` non :
   * au remontage, les fenetres revenaient avec leur titre mais un fil VIDE (« Aucun message. »),
   * indiscernable d'une perte de donnees. On recharge donc le fil de toute fenetre non peinte.
   */
  useEffect(() => {
    for (const id of mosaicIds) {
      if (mosaicFils[id]) continue
      void ouvrirDansMosaique(id)
    }
  }, [mosaicIds, mosaicFils])
  const [convViewMode, setConvViewMode] = useState<'list' | 'mosaic'>(() =>
    window.localStorage.getItem('autowin.chat.conversationsViewMode') === 'mosaic'
      ? 'mosaic'
      : 'list'
  )
  /**
   * Le mode d'affichage lu depuis un ECOUTEUR monte une seule fois (`prefill`, deps []) : sans cette
   * ref, il verrait eternellement le mode du premier rendu et un message pre-ecrit atterrirait dans
   * le chat unique... qui n'est pas affiche en mosaique (bug mesure le 01/09, conv-44 : « Faire
   * reparer » semblait mort).
   */
  const convViewModeRef = useRef(convViewMode)
  useEffect(() => {
    convViewModeRef.current = convViewMode
    window.localStorage.setItem('autowin.chat.conversationsViewMode', convViewMode)
  }, [convViewMode])
  /**
   * DENSITE de la liste — cran CHOISI, independant de la largeur de la colonne, et memorise comme
   * elle. Avant ce reglage, le rendu serre n'etait atteignable qu'en tirant la colonne sous 170 px :
   * on ne pouvait pas avoir a la fois des titres larges et des lignes serrees (demande du
   * 2026-09-17). Le cran par defaut est celui d'AVANT, pour que personne ne voie sa liste changer
   * sans l'avoir demande.
   */
  const [convDensity, setConvDensity] = useState<DensiteConversation>(() =>
    lireDensiteConversations(window.localStorage.getItem('autowin.chat.conversationsDensity'))
  )
  useEffect(() => {
    window.localStorage.setItem('autowin.chat.conversationsDensity', convDensity)
  }, [convDensity])
  const [conversationsPaneWidth, setConversationsPaneWidth] = useState(() => {
    const saved = Number(window.localStorage.getItem('autowin.chat.conversationsPaneWidth'))
    return clampConversationPaneWidth(Number.isFinite(saved) && saved > 0 ? saved : 232)
  })
  const [hasNewActivity, setHasNewActivity] = useState(false)
  /* Fil remonté : le saut vers le dernier message ne dépend pas d'une nouvelle activité. */
  const [scrolledAwayFromTail, setScrolledAwayFromTail] = useState(false)
  const [showRuns, setShowRuns] = useState(false)
  // LE PANNEAU RESTE AFFICHE LE TEMPS DE SORTIR (conv-987, 2026-10-16 : « je veux une animation
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
  // Les fiches de demande du fil actif (conv-1441), tenues À PART des runs : une fiche n'entre dans
  // aucun calcul sur les runs (trace à ouvrir, run en cours, suppression).
  const [fiches, setFiches] = useState<FicheDeDemande[]>([])
  const fichesRequestRef = useRef(0)
  /** Miroir stable : `revealLiveAction` lit la liste courante sans se recreer a chaque chargement. */
  const runsRef = useRef<RunEntry[]>([])
  runsRef.current = runs
  /**
   * Cibles mentionnables, dérivées de l'état DÉJÀ chargé (aucun nouvel IPC, aucun balayage disque).
   * Ne dépend PAS de `input` : taper dans le composer ne recalcule donc rien ici.
   */
  const mentionSources = useMemo(
    () =>
      buildMentionSources({
        runs,
        attachments,
        citedTexts: messages
          .filter((m) => m.role === 'user')
          .slice(-6)
          .map((m) => m.content)
      }),
    [runs, attachments, messages]
  )
  const mentionSourcesRef = useRef(mentionSources)
  mentionSourcesRef.current = mentionSources
  /**
   * Suggestions d'accueil dérivées de l'état RÉEL (runs bloqués, brouillon repris) ; repli
   * statique si rien à dire. `AnimationAccueilChat` les écrit une à une.
   */
  /**
   * FRICTION sur une série d'orchestrations sans livraison. Mesuré (conv-1302, 2026-08-18) : douze
   * runs d'affilée sur la même demande, plus de 20 $, et rien à l'écran ne disait qu'on était dans
   * une série — l'utilisateur a relancé neuf fois, ce qui est le comportement rationnel quand
   * personne ne lui montre le mur. Ce bandeau ne bloque RIEN : la relance reste à un geste, la
   * décision reste humaine. Il rend seulement la série et son coût lisibles avant le geste suivant.
   */
  const friction = useMemo(
    () => frictionEchecsRepetes(orchestrationOutcomesFromMessages(messages)),
    [messages]
  )
  const homeSuggestions = useMemo(
    // `brouillonPresent` et non le texte : `buildHomeSuggestions` ne teste que sa présence. Puces dans
    // la langue de l'interface (conv-1170) : la puce cliquée part telle qu'affichée.
    () => buildHomeSuggestions({ runs, resumedDraft: brouillonPresent ? 'brouillon' : '' }, langue),
    [runs, brouillonPresent, langue]
  )
  const usagesAccueil = useMemo(() => usagesDesSkills(langue), [langue])
  const phrasesAccueil = useMemo(
    () => homeSuggestions.flatMap((groupe) => groupe.items.map((item) => item.label)),
    [homeSuggestions]
  )
  const [openRun, setOpenRun] = useState<OpenRunState | null>(null)
  // Chemin du run déplié à l'instant présent : une relecture en vol vérifie dessus que
  // l'utilisateur n'a pas replié ou changé de run pendant qu'elle lisait le disque.
  const openRunPathRef = useRef<string | null>(null)
  useEffect(() => {
    openRunPathRef.current = openRun?.path ?? null
  })
  const [openTrace, setOpenTrace] = useState<OrchStep[] | null>(null)
  // Détail d'un run : bascule entre le fil des sous-agents (trace) et le RUN.md brut.
  const [runDetailTab, setRunDetailTab] = useState<RunDetailTab>('trace')
  const [liveRuns, setLiveRuns] = useState<Record<string, ScopedLiveRun<OrchStep>>>({})
  // Carte de l'orchestration EN COURS dans le panneau Workflows : cible du clic sur
  // l'indicateur « action en cours » d'un message (ouvre le panneau + cadre le run/step actif).
  const liveRunCardRef = useRef<HTMLDivElement>(null)
  /** Onglet a imposer au panneau droit (voir `revealLiveAction`). */
  const [ongletPanneau, setOngletPanneau] = useState<{ tab: 'runs'; jeton: number } | null>(null)
  // Clic sur le bloc d'activité d'un message → Workflows, à l'endroit qui montre RÉELLEMENT ce qui
  // s'est passé : la section Sous-agents pour le fil du run, l'onglet Activité (historique) quand on
  // veut la trace d'un run précis (elle survit au redémarrage, l'écho de session non).
  const revealLiveAction = useCallback((mode: 'live' | 'history' = 'live', runId?: string) => {
    setShowRuns(true)
    // Le fil des sous-agents et les RUN.md vivent tous deux dans l'onglet Runs : ouvrir le panneau
    // sur le graphe laisserait l'utilisateur a un clic de ce qu'il vient justement de demander.
    setOngletPanneau((precedent) => ({ tab: 'runs', jeton: (precedent?.jeton ?? 0) + 1 }))
    if (mode === 'history') {
      // Action déjà terminée/interrompue : sa carte live n'existe plus. On OUVRE LA TRACE du run
      // concerné — cadrer la seule liste laissait l'utilisateur chercher lequel regarder.
      // `pickRunForTrace` dégrade proprement : chemin portant le runId → sinon le plus récent →
      // sinon rien, et dans ce dernier cas on retombe sur le cadrage d'origine (aucune régression).
      const target = pickRunForTrace(runsRef.current, runId)
      if (target) void viewRun(target)
      return
    }
    requestAnimationFrame(() =>
      liveRunCardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    )
  }, [])
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
   * envoyee pendant un tour STOPPE repartait seule comme un nouveau message (conv-61, 2026-10-02).
   */
  const stopDemandeRef = useRef(new Set<string>())
  /**
   * Fils dont les lots de sélection scout sont RETENUS par la limite de quota (conv-1080). Tenu
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
  /*
   * NAVIGATEUR INTÉGRÉ DU CHAT (conv-1286, lot 3/5) : panneau ouvert ou fermé (Ctrl+Shift+B, bouton
   * de l'en-tête), et ouvert TOUT SEUL quand l'agent ouvre une page dans le fil actif. Les onglets
   * déjà vus par fil vivent dans une REF : un événement d'état (chargement, titre) ne re-rend pas la
   * vue chat, seule une ouverture de panneau le fait.
   * UN SEUL PANNEAU À LA FOIS (conv-1378, 2026-10-31) : navigateur et Bureaux cachés se partagent cette
   * valeur, parce qu'à 1280 px les deux ensemble ne laissent plus de place au fil. Une valeur unique
   * rend « les deux ouverts » impossible à écrire, là où deux booléens auraient dû se fermer l'un l'autre.
   */
  const [panneauOutil, setPanneauOutil] = useState<'navigateur' | 'bureaux' | null>(null)
  const navigateurOuvert = panneauOutil === 'navigateur'
  const bureauxOuverts = panneauOutil === 'bureaux'
  const basculerNavigateur = (): void =>
    setPanneauOutil((ouvert) => (ouvert === 'navigateur' ? null : 'navigateur'))
  // Une demande venue d'ailleurs (menu de commandes, agent) rouvre le panneau, même refermé ; une
  // référence à zéro et pas à la prop : une demande faite avant le montage du chat compte aussi.
  const demandeBureauxVueRef = useRef(0)
  useEffect(() => {
    if (demandeBureaux === demandeBureauxVueRef.current) return
    demandeBureauxVueRef.current = demandeBureaux
    setPanneauOutil('bureaux')
  }, [demandeBureaux])
  // Question à côté (conv-1362) : Ctrl+;, fil unique. Son état de saisie vit dans son composant.
  const [questionACoteOuverte, setQuestionACoteOuverte] = useState(false)
  useRaccourciQuestionACote(isActive && convViewMode !== 'mosaic' && Boolean(activeId), () =>
    setQuestionACoteOuverte((ouverte) => !ouverte)
  )
  const reglagesNavigateurRef = useRef<ReglagesNavigateur | null>(null)
  const ongletsConnusRef = useRef(new Map<string, Set<string>>())
  useEffect(() => {
    const api = apiNavigateur()
    if (!api) return
    void api.reglages.lire().then((lus) => {
      reglagesNavigateurRef.current = lus
    })
    return api.surEtat((etat) => {
      const connus = ongletsConnusRef.current.get(etat.conversationId)
      const ids = etat.onglets.map((onglet) => onglet.id)
      ongletsConnusRef.current.set(etat.conversationId, new Set(ids))
      // Fil pas encore relu : on apprend ses onglets sans ouvrir — ce n'est pas une ouverture vue.
      if (!connus || etat.conversationId !== activeRef.current) return
      if (ids.some((id) => !connus.has(id))) setPanneauOutil('navigateur')
    })
  }, [])
  useEffect(() => {
    const api = apiNavigateur()
    if (!api || !activeId) return
    void api.etat(activeId).then((etat) => {
      if (!ongletsConnusRef.current.has(activeId)) {
        ongletsConnusRef.current.set(activeId, new Set(etat.onglets.map((onglet) => onglet.id)))
      }
    })
  }, [activeId])
  useEffect(() => {
    // Fil unique seulement : en mosaïque, le panneau n'a pas de place à côté d'un fil.
    if (!isActive || convViewMode === 'mosaic') return
    const surTouche = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey) return
      // Sans fil ouvert, pas d'onglets à montrer : le raccourci ne bascule rien d'invisible.
      if (event.key.toLowerCase() !== 'b' || !activeRef.current) return
      event.preventDefault()
      setPanneauOutil((ouvert) => (ouvert === 'navigateur' ? null : 'navigateur'))
    }
    document.addEventListener('keydown', surTouche)
    return () => document.removeEventListener('keydown', surTouche)
  }, [isActive, convViewMode])
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
   * DEFAUT VECU le 2026-09-01 (conv-61) : « je clique sur dernier message, je suis en bas ; je
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
  /**
   * Passage du fil sélectionné à la souris, où poser sa barre, et le fil où il a été pris
   * (conv-1038) : changer de fil la fait disparaître sans effet de remise à zéro.
   */
  const [passageSelectionne, setPassageSelectionne] = useState<
    (PassageAffiche & { fil: string | null }) | null
  >(null)
  /*
   * La barre suit la sélection : elle disparaît quand la sélection se vide (clic ailleurs), quand
   * le fil défile (elle resterait à l'écran, plus collée au passage), et sur Échap.
   */
  const barrePassageOuverte = passageSelectionne !== null
  useEffect(() => {
    if (!barrePassageOuverte) return
    const fermer = (): void => setPassageSelectionne(null)
    const surSelection = (): void => {
      if (window.getSelection()?.isCollapsed !== false) fermer()
    }
    const surTouche = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') fermer()
    }
    const fil = scrollRef.current
    document.addEventListener('selectionchange', surSelection)
    document.addEventListener('keydown', surTouche)
    fil?.addEventListener('scroll', fermer, { passive: true })
    return () => {
      document.removeEventListener('selectionchange', surSelection)
      document.removeEventListener('keydown', surTouche)
      fil?.removeEventListener('scroll', fermer)
    }
  }, [barrePassageOuverte])

  /** Le texte en cours de frappe, lu dans la carte des brouillons (le composer y écrit à chaque touche). */
  function texteDuComposer(): string {
    return getComposerDraft(composerDraftKeyRef.current).input
  }

  /**
   * RÉPONDRE À UN PASSAGE (conv-1038, 2026-10-21) : au relâchement de la souris dans le fil, une
   * sélection DANS un message fait apparaître sa barre, posée au-dessus du passage (coordonnées
   * dans le cadre du fil, celui du bouton « ↓ Dernier message »).
   */
  function surRelachementDansLeFil(): void {
    const selection = window.getSelection()
    const texte = passageDuFil(selection, scrollRef.current)
    const cadre = scrollRef.current?.parentElement
    if (!texte || !selection || !cadre) {
      setPassageSelectionne(null)
      return
    }
    const zone = selection.getRangeAt(0).getBoundingClientRect()
    const bord = cadre.getBoundingClientRect()
    setPassageSelectionne({
      fil: activeRef.current,
      texte,
      gauche: Math.max(0, zone.left - bord.left),
      // La barre se pose AU-DESSUS du passage : jamais au ras du haut, où elle serait coupée.
      haut: Math.max(40, zone.top - bord.top)
    })
  }

  /** Le geste choisi pose son texte dans la saisie, SANS envoyer : l'utilisateur relit et envoie. */
  function agirSurPassage(action: ActionPassage, texte: string): void {
    setDraftInput(
      composerDraftKeyRef.current,
      ajouterAuBrouillon(texteDuComposer(), texteDeLActionSurPassage(action, texte))
    )
    window.getSelection()?.removeAllRanges()
    setPassageSelectionne(null)
    requestAnimationFrame(() => composerRef.current?.focusAt(-1))
  }

  /**
   * ÉLÉMENT CHOISI → SAISIE (conv-1286, lot 3/5) : même chemin que la référence d'Alt+clic (texte
   * ajouté au brouillon du fil, sans envoyer) et que l'instant de vidéo pointé (capture jointe par
   * `addFiles`, dédoublonnée par NOM : chaque nom porte l'id de l'élément).
   */
  function insererElementChoisi(element: ElementChoisiNavigateur): void {
    const { texte, images } = blocPourLeChat(element)
    setDraftInput(composerDraftKeyRef.current, ajouterAuBrouillon(texteDuComposer(), texte))
    if (images.length > 0) void addFiles(images, undefined, (fichier) => fichier.name)
    requestAnimationFrame(() => composerRef.current?.focusAt(-1))
  }

  /**
   * LIENS DU FIL DANS LE NAVIGATEUR INTÉGRÉ (conv-1286, lot 3/5). Un serveur local (localhost,
   * 127.0.0.1, [::1]) s'ouvre dans le panneau ; les autres liens aussi quand le réglage « Ouvrir ici
   * les liens du chat » est actif, sinon ils gardent leur chemin actuel (`target=_blank` de
   * Markdown.tsx → navigateur du système). Un clic déjà traité (référence de fichier) ou modifié
   * (Ctrl, Maj, Cmd : « ailleurs ») n'est pas repris.
   */
  function surClicLienDuFil(event: React.MouseEvent<HTMLElement>): void {
    if (event.defaultPrevented || event.button !== 0) return
    if (event.ctrlKey || event.shiftKey || event.metaKey || !(event.target instanceof Element))
      return
    const lien = event.target.closest('a[href]')
    const conversationId = activeRef.current
    if (!lien || !conversationId || !apiNavigateur()) return
    const adresse = lienAOuvrirDansLePanneau(
      lien.getAttribute('href') ?? '',
      reglagesNavigateurRef.current?.ouvrirLiensDuChatIci === true
    )
    if (!adresse) return
    event.preventDefault()
    void ouvrirDansLeNavigateur(conversationId, adresse)
  }

  async function ouvrirDansLeNavigateur(conversationId: string, adresse: string): Promise<void> {
    const api = apiNavigateur()
    if (!api) return
    setPanneauOutil('navigateur')
    try {
      // Le même lien recliqué REPREND son onglet au lieu d'en empiler un de plus.
      const etat = await api.etat(conversationId)
      const deja = etat.onglets.find((onglet) => onglet.url === adresse)
      if (deja) await api.activerOnglet(deja.id)
      else await api.ouvrir(conversationId, adresse)
    } catch (erreur) {
      // Adresse refusée ou plafond d'onglets : dit sous la saisie, là où l'utilisateur regarde.
      setDraftError(
        composerDraftKeyRef.current,
        erreur instanceof Error ? erreur.message : String(erreur)
      )
    }
  }

  /** La saisie qui reçoit un élément venu d'ailleurs : en mosaïque, une fenêtre à l'écran. */
  function brouillonVisible(): string {
    if (convViewMode !== 'mosaic') return composerDraftKeyRef.current
    const fenetres = [...composersMosaiqueRef.current.keys()]
    const actif = activeRef.current
    return actif && fenetres.includes(actif) ? actif : (fenetres[0] ?? composerDraftKeyRef.current)
  }

  /**
   * L'ÉLÉMENT DÉSIGNÉ PAR ALT+CLIC (conv-1038, étendu à toute l'app conv-1338, voir `alt-clic.ts`) :
   * sa référence s'AJOUTE au brouillon, sans envoyer, et sa capture arrive en pièce jointe. Recliqué
   * ou double-cliqué, le même élément n'est pas redit ; une image refusée (plafond de pièces jointes)
   * laisse le texte et s'explique sous la saisie (`addFiles`).
   */
  function recevoirElementCible({ texte, image, fenetre }: ElementCible): void {
    const cle = fenetre ?? brouillonVisible()
    // fix-ok: conv-1338 — une mosaïque sans fenêtre n'a aucune saisie : le texte finissait dans un
    // brouillon que rien n'affichait. Le chat normal en a une, et l'effet de `convViewMode` l'y repose.
    if (convViewMode === 'mosaic' && composersMosaiqueRef.current.size === 0)
      setConvViewMode('list')
    const brouillon = getComposerDraft(cle).input
    if (!brouillon.includes(texte)) {
      const suite = ajouterAuBrouillon(brouillon, texte)
      setDraftInput(cle, suite)
      composersMosaiqueRef.current.get(cle)?.setInput(suite)
    }
    if (image) void addFiles([image], cle, (fichier) => fichier.name)
    requestAnimationFrame(() =>
      (composersMosaiqueRef.current.get(cle) ?? composerRef.current)?.focusAt(-1)
    )
  }

  function getComposerDraft(key: string): ComposerDraft {
    return composerDraftsRef.current.get(key) ?? { input: '', attachments: [], error: null }
  }

  function setDraftInput(key: string, value: string): void {
    composerDraftsRef.current.set(key, { ...getComposerDraft(key), input: value })
    // Le texte part AUSSI sur le stockage local, a chaque frappe : c'est le seul endroit ou il
    // survit a un rechargement de la fenetre. Un vide efface l'entree (envoi, nettoyage).
    memoriserBrouillon(key, value)
    if (composerDraftKeyRef.current === key) composerRef.current?.setInput(value)
  }

  function setDraftAttachments(
    key: string,
    update: (current: ChatAttachment[]) => ChatAttachment[]
  ): void {
    const draft = getComposerDraft(key)
    const next = update(draft.attachments)
    composerDraftsRef.current.set(key, { ...draft, attachments: next })
    if (composerDraftKeyRef.current === key) setAttachments(next)
    // Les brouillons vivent dans une REF (une frappe ne doit pas re-rendre la vue). La mosaique
    // affiche pourtant les pieces jointes de N brouillons a la fois : ce compteur est le SEUL
    // signal de rendu, et il ne bouge que sur une piece jointe, jamais sur une frappe.
    setDraftsVersion((n) => n + 1)
  }

  function setDraftError(key: string, error: string | null): void {
    composerDraftsRef.current.set(key, { ...getComposerDraft(key), error })
    if (composerDraftKeyRef.current === key) setAttachmentError(error)
    setDraftsVersion((n) => n + 1)
  }

  function switchComposerDraft(key: string): void {
    composerSelectionGenerationRef.current += 1
    composerDraftKeyRef.current = key
    const draft = getComposerDraft(key)
    composerDraftsRef.current.set(key, draft)
    composerRef.current?.setInput(draft.input)
    setAttachments(draft.attachments)
    setAttachmentError(draft.error)
    // Ouvrir une conversation (existante ou neuve) pose le curseur DANS le champ de saisie :
    // sans ça, chaque bascule coûtait un clic de plus (demandé le 2026-09-06).
    requestAnimationFrame(() => composerRef.current?.focus())
  }

  function beginConversationsResize(event: React.PointerEvent<HTMLDivElement>): void {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = conversationsPaneWidth
    let latestWidth = startWidth
    const onMove = (move: PointerEvent): void => {
      latestWidth = clampConversationPaneWidth(startWidth + move.clientX - startX)
      setConversationsPaneWidth(latestWidth)
    }
    const onUp = (): void => {
      window.localStorage.setItem('autowin.chat.conversationsPaneWidth', String(latestWidth))
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function beginRunsResize(event: React.PointerEvent<HTMLDivElement>): void {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = runsPaneWidth
    let latestWidth = startWidth
    const onMove = (move: PointerEvent): void => {
      latestWidth = Math.min(
        CHAT_PANE_LIMITS.workflows.max,
        Math.max(CHAT_PANE_LIMITS.workflows.min, startWidth + startX - move.clientX)
      )
      setRunsPaneWidth(latestWidth)
    }
    const onUp = (): void => {
      window.localStorage.setItem('autowin.chat.runsPaneWidth', String(latestWidth))
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
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

  useEffect(() => {
    // Differe d'une micro-tache et appel OPTIONNEL, comme dans Routage : un preload plus ancien
    // que le renderer ne doit pas produire de rejet non gere, et un `setState` atteint
    // synchronement depuis un effet declenche des rendus en cascade.
    // UN SEUL ESSAI NE SUFFIT PAS. Vecu le 2026-09-12 : quand cet appel echoue au demarrage (main
    // pas encore pret, preload plus ancien qu'un renderer recharge a chaud), la liste restait nulle
    // POUR TOUTE LA SESSION et le bloc « Compte » disparaissait de la pop-up, sans aucun message.
    let annule = false
    let essais = 0
    const charger = async (): Promise<void> => {
      if (annule) return
      const payload = await window.api.claudeAccounts?.().catch(() => null)
      if (annule) return
      if (payload && payload.accounts.length > 0) {
        setComptesClaude(payload)
        return
      }
      essais += 1
      if (essais < 5) setTimeout(() => void charger(), 1000 * essais)
    }
    void Promise.resolve().then(charger)
    return () => {
      annule = true
    }
  }, [])

  /**
   * LE COMPTE CLAUDE, A L'ECHELLE DE LA CONVERSATION.
   *
   * Le choix est memorise sur la conversation ouverte (`conversationSetClaudeAccount`) ET rendu
   * actif tout de suite, pour que le badge d'auth parle du bon compte. Chaque appel du fil lit ensuite
   * ce compte sur la conversation (`claudeCompteDuFil`, conv-1416) : c'est le main qui tient la verite.
   */
  const choisirCompteDeConversation = async (accountId: string): Promise<void> => {
    if (compteBusy) return
    setCompteBusy(true)
    setCompteError(null)
    try {
      // Sans conversation ouverte, le choix est ARME pour le fil qui va naitre (conv-1416).
      if (activeId) await window.api.conversationSetClaudeAccount?.(activeId, accountId)
      else setCompteNouveauFil(accountId)
      const payload = await window.api.claudeAccountSwitch?.(accountId)
      if (payload) setComptesClaude(payload)
      if (activeId)
        setConvs((courant) =>
          courant.map((conv) =>
            conv.id === activeId ? { ...conv, claudeAccountId: accountId } : conv
          )
        )
      window.dispatchEvent(new CustomEvent('autowin:quotas-stale'))
    } catch (error) {
      setCompteError(error instanceof Error ? error.message : String(error))
    } finally {
      setCompteBusy(false)
    }
  }

  /**
   * LE MODÈLE, À L'ÉCHELLE DE LA CONVERSATION (conv-239, 2026-10-11).
   *
   * Avant, ce choix réécrivait le rôle orchestrateur GLOBAL (`setRole`) : changer de modèle dans
   * un fil le changeait dans tous. Il est désormais mémorisé sur la conversation ouverte, que le
   * main relit au départ de chacun de ses tours. Sans conversation ouverte, il est ARMÉ pour le
   * fil qui va naître. Le défaut de l'application se règle toujours dans Routage.
   * `option === null` : revenir au modèle par défaut.
   *
   * ET L'ORCHESTRATEUR D'AGENTS STUDIO SUIT (conv-1529, 2026-11-04 : « quand je change de model et
   * d'effort depuis un chat ca doit changer l'orchestrator de agents studio »). Le fil garde son
   * choix propre (conv-239) : un fil qui a choisi son modèle ne bouge pas quand un autre change ;
   * seuls les fils sans choix propre suivent le nouveau défaut. Revenir au défaut ne touche pas
   * Agents Studio.
   */
  async function poserOrchestrateurDuStudio(option: OrchestratorModelOption): Promise<void> {
    try {
      // `setRole` réécrit la topologie puis prévient les écrans (`scope: 'roles'`) : Agents Studio
      // et l'en-tête de ce fil se relisent seuls.
      await window.api.setRole(
        'orchestrator',
        option.provider,
        option.model,
        option.reasoningEffort
      )
    } catch (error) {
      setModelChangeError(
        texteFil('modele.studioNonMisAJour', {
          raison: error instanceof Error ? error.message : String(error)
        })
      )
    }
  }
  async function changerModeleDuFil(option: OrchestratorModelOption | null): Promise<void> {
    if (busy || modelChangePending) return
    setModelChangeError(null)
    if (!activeId) {
      setModeleNouveauFil(
        option
          ? {
              provider: option.provider,
              model: option.model,
              ...(option.reasoningEffort ? { reasoningEffort: option.reasoningEffort } : {})
            }
          : null
      )
      if (option) await poserOrchestrateurDuStudio(option)
      return
    }
    const cible = activeId
    setModelChangePending(true)
    try {
      if (!window.api.conversationSetModel)
        // Le pont (preload) n'est relu qu'au démarrage : une app lancée avant ce changement ne le
        // connaît pas. On le DIT au lieu d'écrire le défaut global à la place.
        throw new Error(texteFil('modele.redemarrer'))
      const retenu = await window.api.conversationSetModel(
        cible,
        option ? option.provider : null,
        option?.model,
        option?.reasoningEffort
      )
      setConvs((courant) =>
        courant.map((conv) => {
          if (conv.id !== cible) return conv
          if (retenu) return { ...conv, modeleChoisi: retenu }
          const { modeleChoisi: _retire, ...reste } = conv
          return reste
        })
      )
      if (option) await poserOrchestrateurDuStudio(option)
    } catch (error) {
      setModelChangeError(
        texteFil('modele.changementNonEnregistre', {
          raison: error instanceof Error ? error.message : String(error)
        })
      )
    } finally {
      setModelChangePending(false)
    }
  }
  useEffect(() => {
    activeRef.current = activeId
  }, [activeId])

  const busy = activeId ? busyConversations.has(activeId) : false
  /**
   * Le choix de compte Claude de la conversation ouverte, partagé par la pop-up de modèle ET la
   * pop-up des quotas (demande du 2026-09-23) : un seul chemin, celui qui mémorise le compte sur le
   * fil — une bascule seulement globale ne vaudrait pas pour lui (chaque appel du fil lit son compte
   * sur la conversation, conv-1416).
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
  function setConversationBusy(id: string, value: boolean): void {
    if (value) busyConversationsRef.current.add(id)
    else busyConversationsRef.current.delete(id)
    setBusyConversations(new Set(busyConversationsRef.current))
    // UN TOUR REPART DANS LE FIL : c'est la reprise. Les lots retenus par le quota attendent de
    // nouveau la fin d'un tour, et leur reçu le redit ; sa fin dira s'ils partent (conv-1080).
    if (value && lotsRetenusRef.current.delete(id)) marquerRecusDesLots(id, 'lot')
  }
  function setConversationInterrupting(id: string, value: boolean): void {
    if (value) interruptingConversationsRef.current.add(id)
    else interruptingConversationsRef.current.delete(id)
    setInterruptingConversations(new Set(interruptingConversationsRef.current))
  }
  /**
   * FILET DE SÉCURITÉ : écrit le texte de l'utilisateur sur disque AVANT qu'il ne quitte le composer.
   *
   * Mesure du 2026-09-01 (conv-30) : deux messages tapés pendant un tour ont disparu sans trace.
   * Le composer se vide dès l'envoi, et le texte ne vit ensuite que dans des refs volatiles
   * (`composerDraftsRef`, `queueRef`, `directiveReceipts`) tant qu'aucun TOUR n'est créé — un
   * rechargement, un changement de conversation ou une injection refusée l'effaçait définitivement.
   *
   * Volontairement « fire and forget » : un journal indisponible ne doit jamais retarder ni faire
   * échouer un envoi. L'échec est tracé silencieusement, jamais remonté à l'utilisateur.
   */
  function journaliserSaisie(
    conversationId: string,
    texte: string,
    voie: 'message' | 'orientation',
    origine?: 'mode-auto'
  ): void {
    try {
      // L'origine n'est transmise que si elle existe : un texte tapé garde l'appel d'origine à 3 arguments.
      const ecrit = origine
        ? window.api.journaliserSaisie?.(conversationId, texte, voie, origine)
        : window.api.journaliserSaisie?.(conversationId, texte, voie)
      void ecrit?.catch((error: unknown) => {
        traceSilentFailure('journal-saisie', error)
      })
    } catch (error) {
      traceSilentFailure('journal-saisie', error)
    }
  }
  function setDirectiveReceipt(
    conversationId: string,
    entry: QueuedDirective,
    status: DirectiveReceipt['status'],
    // Une REPONSE a une question `ask` emprunte le meme transport qu'une orientation, mais ce
    // n'en est pas une : sans ce drapeau, le fil affichait « ✓ Orienté » sur une reponse.
    reponse?: boolean,
    /** Pourquoi le texte attend (statut `attente`) — dit par l'app principale quand elle le sait. */
    attente?: Pick<DirectiveReceipt, 'attenteMotif' | 'commande'>
  ): void {
    // L'ancre doit porter sur le fil TEL QU'AFFICHE : sans ce vidage, les deltas encore en tampon
    // manquaient a l'appel, et le recu se posait AVANT le texte deja lu (un seul bloc au rendu).
    pilotFlushRef.current()
    const liveMessages = liveMessagesRef.current.get(conversationId) ?? []
    const afterMessageIndex = liveMessages.length - 1
    const anchorMessage = liveMessages[afterMessageIndex]
    const afterPartIndex = anchorMessage?.role === 'assistant' ? anchorMessage.parts.length - 1 : -1
    const anchorPart =
      anchorMessage?.role === 'assistant' && afterPartIndex >= 0
        ? anchorMessage.parts[afterPartIndex]
        : undefined
    setDirectiveReceipts((current) => {
      const receipts = current[conversationId] ?? []
      const existing = receipts.findIndex((receipt) => receipt.id === entry.id)
      const next =
        existing >= 0
          ? receipts.map((receipt, index) =>
              index === existing ? { ...receipt, status, ...attente } : receipt
            )
          : [
              ...receipts,
              {
                id: entry.id,
                text: entry.text,
                status,
                ...attente,
                ...(reponse ? { reponse: true as const } : {}),
                afterMessageIndex,
                afterPartIndex,
                ...(anchorPart?.kind === 'text' ? { afterTextOffset: anchorPart.text.length } : {})
              }
            ]
      return { ...current, [conversationId]: next }
    })
  }
  /** Retire les reçus « mis de côté » dont le texte vient de quitter la file (voir `setConversationQueue`). */
  function retirerRecusEnAttente(conversationId: string, textes: string[]): void {
    const partis = new Set(textes)
    setDirectiveReceipts((current) => {
      const receipts = current[conversationId]
      if (!receipts?.length) return current
      const next = receipts.filter(
        (receipt) =>
          !(
            (receipt.status === 'attente' || receipt.status === 'failed') &&
            partis.has(receipt.text)
          )
      )
      if (next.length === receipts.length) return current
      return { ...current, [conversationId]: next }
    })
  }
  /**
   * Le main a ecrit un VRAI message pour ce texte : le recu provisoire n'a plus lieu d'etre.
   * Sans ce retrait, l'utilisateur verrait DEUX fois son texte (le recu + le message relu).
   */
  function retirerDirectiveReceipt(conversationId: string, entryId: number): void {
    setDirectiveReceipts((current) => {
      const receipts = current[conversationId]
      if (!receipts?.length) return current
      const next = receipts.filter((receipt) => receipt.id !== entryId)
      if (next.length === receipts.length) return current
      return { ...current, [conversationId]: next }
    })
  }
  /**
   * ANNULER UN ENVOI EN ATTENTE (conv-1452, 2026-11-03) : « /git » tapé pendant un tour attendait sa
   * fin, et seul Stop pouvait l'en sortir — en coupant aussi le tour. Le reçu et la file ne partagent
   * pas d'identifiant (`submitBtw`), seulement le TEXTE : on retire la PREMIÈRE entrée de ce texte,
   * pas toutes (deux envois identiques restent deux envois), puis ce reçu-là par son id.
   */
  function annulerEnvoiEnAttente(conversationId: string, receipt: DirectiveReceipt): void {
    const file = queueRef.current.get(conversationId) ?? []
    const rang = file.findIndex((entree) => entree.text === receipt.text)
    if (rang >= 0)
      setConversationQueue(conversationId, [...file.slice(0, rang), ...file.slice(rang + 1)])
    retirerDirectiveReceipt(conversationId, receipt.id)
  }
  function rebaseDirectiveReceiptsAfterStreamReset(
    conversationId: string,
    reset: { streamId: string; conclusionSeule?: true }
  ): void {
    const liveMessages = liveMessagesRef.current.get(conversationId) ?? []
    setDirectiveReceipts((current) => {
      const receipts = current[conversationId]
      if (!receipts?.length) return current
      let changed = false
      const next = receipts.map((receipt) => {
        if (receipt.afterPartIndex < 0) return receipt
        const anchorMessage = liveMessages[receipt.afterMessageIndex]
        if (anchorMessage?.role !== 'assistant') return receipt
        // Les MÊMES parts que retire le réducteur : une relance ne retire plus que la conclusion
        // (conv-1401), compter tout le texte du flux décalerait le reçu à tort.
        const effaces = rangsEffacesParLeReset(anchorMessage.parts, reset)
        const removedBefore = effaces.filter((rang) => rang < receipt.afterPartIndex).length
        const anchorRemoved = effaces.includes(receipt.afterPartIndex)
        if (removedBefore === 0 && !anchorRemoved) return receipt
        changed = true
        const nouvelIndex = receipt.afterPartIndex - removedBefore - (anchorRemoved ? 1 : 0)
        // Tout ce qui precedait ce recu vient d'etre efface : il se pose AVANT ce qui reste.
        // On ne redescend PAS a un index negatif — au rendu, `afterPartIndex < 0` veut dire
        // « aucun point d'accroche, ce recu passe en dernier », ce qui l'aurait renvoye APRES le
        // flux de remplacement alors qu'il l'a precede.
        if (nouvelIndex < 0) return { ...receipt, afterPartIndex: 0, afterTextOffset: 0 }
        return {
          ...receipt,
          afterPartIndex: nouvelIndex,
          ...(anchorRemoved ? { afterTextOffset: undefined } : {})
        }
      })
      return changed ? { ...current, [conversationId]: next } : current
    })
  }

  async function addFiles(
    files: FileList | File[],
    cible?: string,
    cleDeDoublon: (fichier: { name: string; size: number }) => string = cleNomTaille
  ): Promise<void> {
    /*
     * PLUS DE REFUS SILENCIEUX PENDANT UN TOUR (conv-44, 2026-09-01).
     *
     * Ces deux lignes rendaient tout ajout de fichier inopérant tant qu'un tour tournait —
     * collage, dépôt, bouton fichier — sans un mot à l'écran : « ça la met juste dans la barre
     * comme si je la collais pas pendant un tour ». La pièce jointe s'attache donc maintenant
     * comme hors tour ; elle n'est PAS envoyée à l'agent en vol (le canal d'orientation ne porte
     * que du texte, `injectDirective`), elle attend le prochain message. Les plafonds ci-dessous
     * (nombre, 10 Mo par fichier, 20 Mo au total) restent les seuls refus, et ils PARLENT.
     */
    const originDraftKey = cible ?? composerDraftKeyRef.current
    const originDraft = getComposerDraft(originDraftKey)
    setDraftError(originDraftKey, null)
    const seen = new Set(originDraft.attachments.map(cleDeDoublon))
    const candidates = Array.from(files).filter((file) => {
      const key = cleDeDoublon(file)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    if (originDraft.attachments.length + candidates.length > MAX_ATTACHMENTS) {
      setDraftError(originDraftKey, texteFil('pj.maximum', { max: MAX_ATTACHMENTS }))
      return
    }
    const oversized = candidates.find((file) => file.size > MAX_ATTACHMENT_BYTES)
    if (oversized) {
      setDraftError(originDraftKey, texteFil('pj.tropGros', { nom: oversized.name }))
      return
    }
    /*
     * IMAGE VIDE (conv-321, 2026-10-17). Le presse-papiers peut annoncer une image sans en livrer les
     * octets : Chromium rend alors une `image.png` de 0 octet (conv-182 et conv-321 : `size: 0`, pas
     * de miniature, fichier vide dans chat-artifacts). Attachée, elle partait à l'agent comme une
     * vraie capture — l'utilisateur croyait l'avoir montrée, l'agent ne recevait rien. Ici, au seul
     * moment où l'utilisateur peut encore la recopier, on le lui dit.
     */
    const imageVide = candidates.find((file) => file.size === 0 && file.type.startsWith('image/'))
    if (imageVide) {
      setDraftError(originDraftKey, texteFil('pj.imageVide', { nom: imageVide.name }))
      return
    }
    const totalBytes =
      originDraft.attachments.reduce((sum, file) => sum + file.size, 0) +
      candidates.reduce((sum, file) => sum + file.size, 0)
    if (totalBytes > MAX_ATTACHMENTS_BYTES) {
      setDraftError(originDraftKey, texteFil('pj.totalTropGros'))
      return
    }
    try {
      const encoded = await Promise.all(candidates.map(encodeAttachment))
      // Dédoublonner AUSSI sur le brouillon ACTUEL (conv-253) : deux ajouts lancés avant la fin du
      // premier encodage se comparaient tous deux au brouillon d'AVANT (`originDraft`), et le même
      // instant vidéo pointé deux fois joignait deux PNG.
      // fix-ok: cause mesurée — le filtre ne comparait qu'à `originDraft`, lu avant l'await de l'encodage : sans ce second filtre, deux clics sans attente joignent 2 PNG et ChatView.pointer-video.test.tsx échoue (code 1) ; avec lui, 1 PNG (code 0).
      setDraftAttachments(originDraftKey, (current) => {
        const presents = new Set(current.map(cleDeDoublon))
        return [...current, ...encoded.filter((piece) => !presents.has(cleDeDoublon(piece)))]
      })
    } catch (error) {
      setDraftError(
        originDraftKey,
        texteFil('pj.lectureImpossible', {
          raison: error instanceof Error ? error.message : String(error)
        })
      )
    }
  }

  /*
   * POINTER UN MOMENT D'UNE VIDÉO DU FIL (conv-253, 2026-10-11) : la référence va au curseur de la
   * saisie, l'image passe par `addFiles` (mêmes plafonds, même dédoublonnage nom + taille). La
   * référence est insérée même si l'image est refusée (9e pièce jointe…). Valeur STABLE : le fil
   * mémoïsé (`filRendu`) n'a pas à se recalculer.
   */
  const addFilesRef = useRef(addFiles)
  addFilesRef.current = addFiles
  const recevoirElementCibleRef = useRef(recevoirElementCible)
  recevoirElementCibleRef.current = recevoirElementCible
  const pointerMomentVideo = useCallback((moment: MomentPointe): void => {
    composerRef.current?.insererAuCurseur(moment.reference)
    // Doublon par NOM seul : `<vidéo>-i<N>.png` désigne une image précise ; deux encodages PNG du
    // même instant n'ont pas de taille garantie identique (non mesuré).
    if (moment.image) void addFilesRef.current([moment.image], undefined, (fichier) => fichier.name)
  }, [])

  /* --- données latérales --- */

  async function refreshConvs(): Promise<void> {
    // Les fils inchangés gardent leur objet : seules leurs lignes modifiées se redessinent (gel
    // `renderer:vue-chat-liste`, conv-1115 — l'IPC rend des copies neuves, ~1 000 lignes refaites).
    const loaded = reutiliserConversationsInchangees(
      convsRef.current,
      (await window.api.conversations()) as Conv[]
    )
    convsRef.current = loaded // dispo IMMÉDIATEMENT pour la reprise auto (sans attendre le render)
    setConvs(loaded)
    repriseDemarrageRef.current ??= autoResumeOnce(loaded)
  }

  /**
   * Survie niveau 2 — REPRISE AUTOMATIQUE, déclenchée ICI (et pas dans App) parce que c'est ChatView
   * qui sait quand les conversations sont réellement chargées : dispatcher à l'aveugle après un délai
   * ratait la reprise (course au démarrage, constatée en essai réel). Une seule fois par session.
   */
  const repriseDemarrageRef = useRef<Promise<void> | null>(null)
  async function autoResumeOnce(loaded: Conv[]): Promise<void> {
    let turns: UnfinishedTurn[] = []
    try {
      turns = ((await window.api.unfinishedTurns?.()) ?? []) as UnfinishedTurn[]
    } catch (error) {
      traceSilentFailure('unfinished-turns', error)
      return
    }
    // L'horloge ECARTE les vestiges : un tour interrompu la veille ne doit plus voler le demarrage
    // a la conversation ou l'utilisateur travaille (mesure conv-1267, 2026-08-18).
    const target = pickTurnToResume(turns, Date.now())
    /**
     * UN MESSAGE A MOITIE ECRIT GAGNE SUR LA REPRISE. Symptome du 2026-09-01 : « de temps en temps
     * ca m'enleve de la conversation dans laquelle je suis en train d'ecrire ». Un rechargement de
     * fenetre relance cette reprise, qui ouvrait la conversation d'un tour interrompu AILLEURS et
     * plantait l'utilisateur devant un fil qui n'etait pas le sien.
     *
     * Rien n'est perdu de l'autre cote : le journal du tour interrompu est rejoue quand meme, son
     * fil est donc a jour des qu'on l'ouvre — seule la SELECTION reste a l'utilisateur.
     */
    const ouJEcrivais = derniereConversationOuverte(loaded)
    if (target) {
      const conversation = loaded.find((candidate) => candidate.id === target.conversationId)
      if (conversation) {
        if (brouillonEnAttente(ouJEcrivais) && ouJEcrivais !== target.conversationId) {
          await replayTurnJournal(target.conversationId, target.turnId)
          const restons = loaded.find((candidate) => candidate.id === ouJEcrivais)
          if (restons) {
            await loadConv(restons)
            return
          }
        }
        await loadConv(conversation)
        await replayTurnJournal(target.conversationId, target.turnId)
        return
      }
    }
    // Pas de tour a reprendre : on rouvre la ou l'utilisateur etait (demande du 2026-08-18). La
    // reprise d'un tour inacheve reste PRIORITAIRE — elle repare quelque chose, celle-ci ne fait
    // que replacer le curseur. Aucune selection inventee si la memoire est vide ou perimee.
    const derniere = ouJEcrivais
    if (derniere) {
      const conversation = loaded.find((candidate) => candidate.id === derniere)
      if (conversation) await loadConv(conversation)
    } else {
      // MEMOIRE VIDE (premier lancement, stockage efface, conversation supprimee depuis) : on ouvre
      // LA PLUS RECENTE au sens de la RECENCE UTILISATEUR — la ou l'utilisateur a parle en dernier,
      // jamais la derniere TOUCHEE (`updatedAt` bouge sur un rangement, un RUN.md attache, un delta
      // de streaming). Avant, ce cas n'ouvrait RIEN et laissait le panneau vide.
      const plusRecente = conversationsRecentes(loaded, 1)[0]
      if (plusRecente) await loadConv(plusRecente)
    }
    // Survie niveau 3 — RELANCE GRATUITE (demande user 2026-08-13 : « faire en sorte que ça tue
    // pas les runs »). `pickTurnToResume` exige `events > 0` : un tour mort AVANT d'avoir rien
    // produit (0 événement, 0 texte, 0 action réglée — donc 0 dépense) passait au travers et
    // restait abandonné jusqu'à un clic humain sur « Renvoyer ». Mesuré trois fois sur les
    // campagnes des 12-13/08. Ce chemin tourne UNE fois au boot, avant toute activité vivante —
    // pas dans la boucle de rendu, où un routage en vol marque transitoirement un tour
    // `interrupted` et déclenchait un envoi parasite (pilotChat appelé 2 fois, mesuré).
    // UNE seule conversation relancée par boot : deux orchestrations parallèles s'annulent
    // mutuellement dans l'app (défaut mesuré le 13/08 — la seconde a tué la première).
    // Les candidats viennent d'`unfinishedTurns` (events === 0 : rien produit, donc rien payé),
    // PAS d'un balayage de toutes les conversations — un fetch systématique au boot consommait
    // les réponses moquées des tests de chargement et interférait avec le premier chargement réel.
    const candidats = turns
      .filter((turn) => turn && turn.conversationId && turn.events === 0)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((turn) => loaded.find((conversation) => conversation.id === turn.conversationId))
      .filter((conversation): conversation is Conv => Boolean(conversation))
    for (const candidate of candidats) {
      try {
        const detail = (await window.api.conversation(candidate.id)) as { messages?: unknown[] }
        const hydrated = (detail?.messages ?? []).map((message) =>
          (message as { role?: string }).role === 'assistant'
            ? hydrateStoredAssistant(message as never)
            : message
        ) as Parameters<typeof promptDeRelanceGratuite>[0]
        const prompt = promptDeRelanceGratuite(hydrated)
        if (!prompt) continue
        void sendRef.current(prompt, { targetConversationId: candidate.id })
        return
      } catch (error) {
        traceSilentFailure('relance-gratuite', error)
      }
    }
  }
  // File d'attente LOCALE (renderer) : messages tapés pendant un tour, envoyés comme des tours
  // NORMAUX un par un à la fin du tour courant → chaque message = sa propre paire Q/R (rendu propre).
  const nextQueueEntryIdRef = useRef(0)
  const queueRef = useRef<Map<string, QueuedDirective[]>>(new Map())
  function setConversationQueue(id: string, next: QueuedDirective[]): void {
    const avant = queueRef.current.get(id) ?? []
    if (next.length) queueRef.current.set(id, next)
    else queueRef.current.delete(id)
    // UN TEXTE QUI QUITTE LA FILE N'ATTEND PLUS RIEN — parti en message, ou rendu au composer par
    // Stop. Son reçu « Attend la fin du tour » mentirait alors, et doublait le vrai message dans le
    // fil (conv-890 : message parti à 12:26:29, reçu toujours affiché). Point UNIQUE : les trois
    // sorties de la file passent toutes par ici.
    const restants = new Set(next.map((entree) => entree.text))
    const sortis = avant.filter((entree) => !restants.has(entree.text)).map((e) => e.text)
    if (sortis.length) retirerRecusEnAttente(id, sortis)
    // Plus rien en file (parti, ou rendu au composer par Stop) : plus rien à retenir.
    if (next.length === 0) lotsRetenusRef.current.delete(id)
  }
  /** Le reçu des lots en attente dit pourquoi ils attendent : fin du tour, ou reprise après le quota. */
  function marquerRecusDesLots(id: string, motif: 'lot' | 'lot-quota'): void {
    setDirectiveReceipts((current) => {
      const receipts = current[id]
      if (!receipts?.some((r) => r.attenteMotif === 'lot' || r.attenteMotif === 'lot-quota'))
        return current
      return {
        ...current,
        [id]: receipts.map((receipt) =>
          receipt.status === 'attente' &&
          (receipt.attenteMotif === 'lot' || receipt.attenteMotif === 'lot-quota')
            ? { ...receipt, attenteMotif: motif }
            : receipt
        )
      }
    })
  }
  /**
   * LE LOT SUIVANT NE PART PAS DANS LE MUR DE QUOTA (conv-1080, 2026-10-22). À consulter par CHAQUE
   * sortie automatique de la file, avant d'en relâcher la tête : le lot d'avant coupé par la limite
   * (`lots-retenus-quota.ts`), le suivant partait aussitôt, retombait sur le même refus et relâchait le
   * troisième — la sélection entière se vidait en échecs. Retenus, ils restent en file, visibles, et
   * partent à la fin du prochain tour qui ne bute pas sur la limite (la reprise, par l'utilisateur).
   */
  function lotsRetenusDansLeFil(id: string): boolean {
    const file = queueRef.current.get(id) ?? []
    if (file[0]?.lot !== true) return false
    if (lotsRetenusRef.current.has(id)) return true
    if (!lotsRetenusParLeQuota(file, liveMessagesRef.current.get(id) ?? [])) return false
    lotsRetenusRef.current.add(id)
    marquerRecusDesLots(id, 'lot-quota')
    return true
  }
  /**
   * LA TÊTE DE LA FILE ATTEND LE VERROU D'ENVOI, ELLE NE SORT PAS POUR ÊTRE JETÉE (conv-1080).
   *
   * `busy` tombe à l'événement `done`, mais le verrou d'envoi (`sendLocksRef`) ne se relâche que dans
   * le `finally` de `send`, à la RÉPONSE de `pilotChat` — que le main rend après son propre `finally`
   * (`run-pilot-chat.ts`, qui diffuse aussi `directives-orphelines` avant de répondre). Entre les
   * deux, un drain voyait le fil libre, sortait la tête de la file, et `send` la refusait sans un mot.
   * Perte réelle : conv-996, 2026-10-16, orientation « basé sur les axes que t'as généré tour 1 scout
   * des améliorations » (saisie ts 1792149113401), jamais lue ni renvoyée ; la suite du mode auto est
   * partie à sa place 22 ms après le `done`.
   *
   * À consulter par CHAQUE sortie automatique de la file, avant d'en retirer la tête : verrou tenu =
   * elle reste en file, visible, et `send` relance le drain à la fin de sa clôture
   * (`drainerApresVerrou`).
   */
  const drainApresVerrouRef = useRef(new Set<string>())
  function teteRetenueParLeVerrou(id: string): boolean {
    if (!sendLocksRef.current.has(id)) return false
    drainApresVerrouRef.current.add(id)
    return true
  }
  /**
   * LA COMPACTION AUTOMATIQUE ATTEND LE VERROU, ELLE AUSSI (conv-1080, 2026-10-22).
   *
   * Décidée au `done` qui franchit le palier critique — donc dans l'intervalle où le verrou d'envoi
   * tient encore (voir `teteRetenueParLeVerrou`). `send` la refusait sans un mot, alors que le fil
   * était déjà noté compacté (`compactionAutoRef`) : plus aucune tentative avant que la jauge
   * redescende, ce qu'elle ne fait pas sans résumé. Verrou tenu ou tour reparti = elle attend, et la
   * fin de clôture de `send` la relance. Témoin : `ChatView.compaction-auto-verrou.test.tsx`.
   */
  const compactionEnAttenteRef = useRef(new Set<string>())
  function lancerCompactionAuto(conversationId: string): void {
    if (
      sendLocksRef.current.has(conversationId) ||
      busyConversationsRef.current.has(conversationId)
    ) {
      compactionEnAttenteRef.current.add(conversationId)
      return
    }
    compactionEnAttenteRef.current.delete(conversationId)
    // Un résumé est déjà parti pendant l'attente (bouton Compacter) : un second serait payé pour rien.
    if (dernierMessageUtilisateurDe(conversationId)?.trim() === COMPACT_REQUEST) return
    void send(COMPACT_REQUEST, { targetConversationId: conversationId })
  }
  /** Le drain retenu par le verrou, rejoué quand l'envoi qui le tenait s'est clos. */
  function drainerApresVerrou(id: string): void {
    // Un tour est reparti entre-temps (mode auto, message tapé) : la fin de CE tour drainera.
    if (busyConversationsRef.current.has(id) || teteRetenueParLeVerrou(id)) return
    // Un Stop survenu pendant l'attente garde sa promesse : rien ne repart seul.
    if (stoppedQueueDrainRef.current.has(id) || stopDemandeRef.current.has(id)) return
    if (lotsRetenusDansLeFil(id)) return
    const [tete, ...reste] = queueRef.current.get(id) ?? []
    if (!tete) return
    setConversationQueue(id, reste)
    void send(tete.text, {
      keepComposerDraft: true,
      automatique: true,
      targetConversationId: id,
      ...(tete.attachments?.length ? { piecesJointesImposees: tete.attachments } : {})
    })
  }
  /**
   * `mode: 'btw'` = « celui-la passe EN DERNIER ». Il ne suffit pas de deplacer l'entree une fois :
   * sans cette insertion, le message suivant tape par l'utilisateur atterrissait APRES le message
   * marque BTW, ce qui defaisait silencieusement la promesse du bouton (« remettre a la fin ») —
   * `mode` n'etait alors lu que pour l'affichage, donc le clic n'avait aucun effet durable.
   * Un nouvel envoi BTW, lui, se range derriere les BTW deja presents (ordre d'arrivee conserve).
   */
  function enqueueMessage(
    id: string,
    text: string,
    mode?: QueuedDirective['mode'],
    attachments?: ChatAttachment[],
    /** `lot` : un lot de sélection scout mis en file par le panneau (conv-1080). */
    origine?: Pick<QueuedDirective, 'lot'>
  ): void {
    // Un texte qui arrive en file APRES un Stop est un geste explicite de l'utilisateur : il LEVE le
    // gel one-shot pose par Stop. Sans cette ligne, « stop puis j'ecris dans la foulee » perdait le
    // message — le tour n'etait pas encore retombe, l'injection echouait, la file recevait le texte
    // et la transition busy→false l'avalait au titre du gel (constate le 03/09). Le gel ne doit
    // arreter QUE la relance automatique de ce qui restait en file, jamais une nouvelle demande.
    stoppedQueueDrainRef.current.delete(id)
    const current = queueRef.current.get(id) ?? []
    const entry: QueuedDirective = {
      id: nextQueueEntryIdRef.current++,
      text,
      mode,
      ...(attachments && attachments.length ? { attachments } : {}),
      ...(origine?.lot ? { lot: true as const } : {})
    }
    if (mode === 'btw') {
      setConversationQueue(id, [...current, entry])
      return
    }
    let insertAt = current.length
    while (insertAt > 0 && current[insertAt - 1].mode === 'btw') insertAt -= 1
    const next = current.slice()
    next.splice(insertAt, 0, entry)
    setConversationQueue(id, next)
  }
  /**
   * Workflows affichés : ceux de la CONVERSATION ACTIVE, et rien d'autre. Le cadrage « tous »
   * a été retiré — cette barre montre le contexte courant, le global relève de l'Observatory.
   */
  async function refreshRuns(): Promise<void> {
    const request: RunRequestIdentity = {
      id: runsRequestRef.current.id + 1,
      scope: 'conv',
      convId: activeRef.current
    }
    runsRequestRef.current = request
    const nextRuns = request.convId
      ? ((await window.api.conversationRuns(request.convId)) as RunEntry[])
      : []
    const currentRequest = {
      id: runsRequestRef.current.id,
      scope: 'conv' as const,
      convId: activeRef.current
    }
    if (isRunRequestCurrent(request, currentRequest)) setRuns(nextRuns)
  }
  /**
   * Relit les fiches de demande du fil actif (conv-1441). Un échec de lecture vide la liste au lieu
   * de garder celle d'un autre fil, et ne touche pas aux runs. Une ouverture demandée depuis un
   * post-it du Board (`demanderFicheAOuvrir`) est honorée ici, une fois les fiches de CE fil lues.
   */
  async function refreshFiches(): Promise<void> {
    const convId = activeRef.current
    const demande = ++fichesRequestRef.current
    let lues: FicheDeDemande[] = []
    if (convId) {
      try {
        lues = await window.api.fichesDuFil(convId)
      } catch (error) {
        traceSilentFailure('fiches-du-fil', error)
      }
    }
    if (demande !== fichesRequestRef.current || convId !== activeRef.current) return
    setFiches(lues)
    const chemin = convId ? reclamerFicheAOuvrir(convId) : null
    const fiche = chemin ? lues.find((f) => f.chemin === chemin) : undefined
    if (!fiche) return
    setShowRuns(true)
    setOngletPanneau((precedent) => ({ tab: 'runs', jeton: (precedent?.jeton ?? 0) + 1 }))
    void viewRun(runDeLaFiche(fiche))
  }
  useEffect(() => {
    void Promise.resolve().then(refreshRuns)
    void Promise.resolve().then(refreshFiches)
  }, [activeId])
  // Tient le bus au courant de la conversation active → les orchestrations s'y rattachent.
  useEffect(() => {
    window.api.setActiveConversation(activeId)
  }, [activeId])
  /**
   * REPOSE le brouillon restaure dans le composer, a chaque fois que ce composer nait : au montage,
   * et au retour de la mosaique, qui le demonte (conv-1338). La carte est hydratee depuis le stockage
   * local, mais le composer garde son texte chez lui (handle imperatif) : sans cette remise, le
   * texte retrouve restait invisible tant qu'aucune conversation n'etait rouverte.
   */
  useEffect(() => {
    const restaure = getComposerDraft(composerDraftKeyRef.current).input
    if (restaure) composerRef.current?.setInput(restaure)
  }, [convViewMode])
  useEffect(() => {
    let disposed = false
    const selectionInitiale = Promise.resolve().then(async () => {
      await refreshConvs()
      // ALIGNEMENT AU MONTAGE : le main est la source de vérité de la conversation active. Le scout
      // de veille (et tout flux né hors du chat) sélectionne sa conversation PENDANT que cette vue
      // est démontée — l'événement de sélection n'a alors aucun auditeur, et la vue remontait sur
      // son ancienne sélection avec un panneau vide (mesuré le 14/08, conv-1164/1165).
      // DEMANDE EXPLICITE D'ABORD : un autre écran (la bulle d'un ticket) a pu demander une
      // conversation PENDANT que cette vue était démontée — l'événement n'avait alors aucun
      // auditeur. Cette demande déposée est PRIORITAIRE sur l'alignement ci-dessous, qui ouvrirait
      // la conversation active du main (la dernière créée) et volerait la sélection.
      const demandee = reclamerOuvertureConversation()
      let ouvertureHonoree = false
      if (!disposed && demandee) {
        const cible = convsRef.current.find((conversation) => conversation.id === demandee)
        if (cible) {
          await loadConv(cible)
          ouvertureHonoree = true
        }
      }
      try {
        const etat = ouvertureHonoree
          ? {}
          : ((await window.api.appState()) as { activeConversationId?: string })
        const cibleId = (etat as { activeConversationId?: string })?.activeConversationId
        if (!disposed && cibleId && cibleId !== activeRef.current) {
          const cible = convsRef.current.find((conversation) => conversation.id === cibleId)
          if (cible) await loadConv(cible)
        }
      } catch {
        // L'alignement est un confort : son échec ne doit pas empêcher la vue de fonctionner.
      }
      void refreshRuntimeIdentity()
      void Promise.resolve(window.api.behaviourComposition?.())
        .then((comp) => {
          if (!disposed && comp?.inspection?.workspace) {
            setDefaultWorkspace(comp.inspection.workspace)
          }
        })
        .catch(() => undefined)
    })
    // ÉLÉMENTS DÉSIGNÉS AVANT LE PREMIER AFFICHAGE DU CHAT (Alt+clic depuis une autre vue, conv-1338).
    // Le fil ouvert au démarrage n'est connu qu'après ces deux étapes : écouter plus tôt posait le
    // texte dans le brouillon « nouveau fil », que l'ouverture du dernier fil cachait aussitôt.
    let couperElementsCibles: (() => void) | undefined
    const ecouterLesElements = (): void => {
      if (disposed) return
      couperElementsCibles = ecouterElementsCibles((element) =>
        recevoirElementCibleRef.current(element)
      )
    }
    void selectionInitiale
      .then(() => repriseDemarrageRef.current)
      .catch((erreur: unknown) => traceSilentFailure('selection-initiale', erreur))
      .finally(ecouterLesElements)
    void Promise.resolve(window.api.workflowProfileNotice?.())
      .then((notice) => {
        if (!disposed && notice && typeof notice.text === 'string') {
          setAppNotice((current) =>
            newestNotice(current, { text: notice.text, noticeId: notice.id })
          )
        }
      })
      .catch(() => undefined)
    // Les mutations faites par l'agent (bus) rafraîchissent les listes SANS toucher le fil.
    const deltaBatcher = createLiveRunDeltaBatcher<{
      convId: string
      runPath?: string
      delta: string
    }>(
      (batch) =>
        setLiveRuns((current) =>
          batch.reduce(
            (next, event) =>
              reduceScopedLiveRuns(next, {
                type: 'delta',
                convId: event.convId,
                runPath: event.runPath,
                delta: event.delta
              }),
            current
          )
        ),
      (flush) => window.setTimeout(flush, 50),
      (handle) => window.clearTimeout(handle)
    )
    /*
     * LE RAISONNEMENT DES SOUS-AGENTS, range sous sa phase dans le bloc Orchestration (conv-918,
     * 2026-10-13). Il arrive par fragments de quelques mots, plusieurs par seconde : on les regroupe
     * le temps d'un court delai, puis UN seul patch par conversation, au lieu d'un re-rendu du fil
     * par fragment. Les fragments consecutifs d'une meme phase sont recolles avant d'etre ranges.
     */
    const raisonnementBatcher = createLiveRunDeltaBatcher<{
      convId: string
      phase?: string
      texte: string
    }>(
      (batch) => {
        const parConversation = new Map<string, Array<{ phase?: string; texte: string }>>()
        for (const item of batch) {
          const liste = parConversation.get(item.convId) ?? []
          const dernier = liste[liste.length - 1]
          if (dernier && dernier.phase === item.phase) dernier.texte += item.texte
          else liste.push({ phase: item.phase, texte: item.texte })
          parConversation.set(item.convId, liste)
        }
        for (const [convId, fragments] of parConversation)
          patchLast(
            convId,
            (m) => {
              let parts = m.parts
              for (const fragment of fragments)
                parts = ajouterRaisonnementDePipeline(
                  parts,
                  fragment.texte,
                  fragment.phase
                ) as typeof m.parts
              m.parts = parts
            },
            porteUneOrchestrationOuverte
          )
      },
      (flush) => window.setTimeout(flush, 200),
      (handle) => window.clearTimeout(handle)
    )
    const offApp = window.api.onAppEvent((e) => {
      if (e.type !== 'orchestrate-delta') {
        deltaBatcher.flush()
        // Avant toute fin d'etape : le direct doit etre range AVANT que l'etape ne complete sa ligne.
        raisonnementBatcher.flush()
      }
      /*
       * LA LISTE DES RUNS SE RAFRAICHIT SEULE (demande du 2026-09-26 : « tout doit se rafraichir
       * tout seul »). Le bouton « Rafraichir » du panneau Détails a disparu ; il couvrait un trou :
       * le main n'emet `refresh/workflows` qu'en FIN de tour ou d'orchestration, alors que le RUN.md
       * naît au démarrage (`orchestrate-start`) et avance à chaque phase. On relit donc la liste à
       * ces battements, pour la seule conversation affichée. `refreshRuns` ignore d'elle-même une
       * réponse périmée : deux relectures rapprochées ne se marchent pas dessus.
       */
      if (
        (e.type === 'orchestrate-start' ||
          e.type === 'orchestrate-phase' ||
          e.type === 'orchestrate-step') &&
        e.convId &&
        e.convId === activeRef.current
      ) {
        void refreshRuns()
      }
      if (e.type === 'toast') {
        if (e.text) {
          const text = e.text
          setAppNotice((current) => newestNotice(current, { text, noticeId: e.noticeId }))
        }
      } else if (e.type === 'suite-depuis-notification') {
        /*
         * BOUTON DE SUITE DE LA NOTIFICATION DE FIN DE TOUR (conv-1038, 2026-10-21) : la suite part
         * dans le fil DU TOUR comme un message tapé, sans changer le fil affiché ni vider son
         * brouillon. Fil encore occupé (un tour est reparti entre-temps) : elle attend en file et
         * part à la fin du tour, comme un message tapé pendant un tour.
         */
        const convId = e.convId
        const texte = typeof e.texte === 'string' ? e.texte.trim() : ''
        if (convId && texte) {
          if (busyConversationsRef.current.has(convId)) enqueueMessage(convId, texte)
          else void send(texte, { targetConversationId: convId, keepComposerDraft: true })
        }
      } else if (e.type === 'directives-orphelines') {
        /*
         * ORIENTATION ARRIVEE TROP TARD : le tour s'est termine sans jamais la lire.
         *
         * Le tour la jetait en silence (`run-pilot-chat.ts`, finally). Elle revient maintenant ici
         * et repart en FILE : le drain `busy→false` l'envoie comme un tour normal, donc elle finit
         * traitee au lieu d'etre perdue. Une mention le dit, comme le chemin `/skill` le fait deja.
         *
         * STOP RESPECTE : `enqueueMessage` leve le gel one-shot pose par un Stop (c'est voulu pour
         * un texte TAPE apres le Stop). Ici, personne n'a rien tape : reposer le gel garde la
         * promesse du bouton — Stop ne doit pas se faire relancer par une phrase deja a l'ecran.
         */
        const convId = e.convId
        const textes = (e.textes ?? []).filter((t) => typeof t === 'string' && t.trim())
        if (convId && textes.length) {
          const gele =
            stoppedQueueDrainRef.current.has(convId) || stopDemandeRef.current.has(convId)
          for (const texte of textes) enqueueMessage(convId, texte)
          if (gele) stoppedQueueDrainRef.current.add(convId)
          /*
           * APRES UN STOP, RENDUES AU COMPOSER — jamais gardees dans une file invisible.
           * conv-61, 2026-10-02 : orientation `ts 1790960554261` pendant le tour 11229cd2, Stop,
           * puis elle revient ICI, apres que Stop a deja rendu la file au composer. Restee en file
           * (sans affichage), elle est partie seule a `ts 1790960868134` (tour b9f32631), alors que
           * l'utilisateur l'avait corrigee entre-temps (`ts 1790960608859`) : « ca a envoyé 2 fois ».
           */
          // fix-ok: le gel Stop etait consomme a la fin du tour 11229cd2, avant le retour des orientations non lues -> drain auto (tour b9f32631) ; test ChatView.orientation-orpheline-apres-stop rouge->vert
          if (gele) rendreLaFileAuComposer(convId)
          /*
           * DRAIN IMMEDIAT : l'effet de drain se declenche sur la transition `busy→false`, or cet
           * evenement arrive PRECISEMENT a la fin du tour — la transition peut etre deja passee.
           * Sans ce coup de pouce, la file resterait dormante jusqu'au prochain tour, et l'oubli
           * qu'on corrige se rejouerait sous une autre forme (message en attente que rien ne part).
           */
          // Des lots de sélection retenus par la limite de quota gardent la tête de la file : les
          // orientations attendent derrière eux, la reprise du fil les relâchera (conv-1080).
          const retenues = !gele && lotsRetenusDansLeFil(convId)
          // Cet événement part du `finally` du main, AVANT la réponse de `pilotChat` : le verrou
          // d'envoi est encore tenu, la tête attend donc sa levée (conv-996, conv-1080).
          if (
            !gele &&
            !retenues &&
            convId === activeRef.current &&
            !busyConversationsRef.current.has(convId) &&
            !teteRetenueParLeVerrou(convId)
          ) {
            const enFile = queueRef.current.get(convId) ?? []
            const [tete, ...suite] = enFile
            if (tete) {
              setConversationQueue(convId, suite)
              // `targetConversationId` EXPLICITE : ce handler est monte une fois et capture un
              // `activeId` qui peut valoir null, alors que le fil vise bien cette conversation.
              void send(tete.text, {
                keepComposerDraft: true,
                automatique: true,
                targetConversationId: convId
              })
            }
          }
          // LE BANDEAU NOMME SON FIL (conv-1241) : il est commun à la vue et survit au changement de
          // fil ; celui de conv-1227 (Stop à 22:09:11) s'affichait au-dessus de conv-1240, dont le
          // tour tournait encore, et se lisait comme parlant de l'orientation de conv-1240.
          const titreDuFil =
            convsRef.current.find((conversation) => conversation.id === convId)?.title?.trim() ||
            convId
          const text = texteFil('orientation.apresFin', {
            titre: titreDuFil.length > 48 ? `${titreDuFil.slice(0, 47)}…` : titreDuFil,
            n: textes.length,
            suite: texteFil(
              gele
                ? 'orientation.remises'
                : retenues
                  ? 'orientation.gardees'
                  : 'orientation.renvoyees'
            )
          })
          setAppNotice((current) => newestNotice(current, { text }))
        }
      } else if (e.type === 'refresh') {
        if (e.scope === 'conversations') refreshConvs()
        // Un plan a changé (lot ouvert, fini, relancé) : la liste relit tous les plans en UN appel
        // (conv-1158), sans re-rendre la vue tant qu'aucun lien chef → lot ne change.
        if (e.scope === 'plans-de-lots') relirePlansRef.current()
        if (e.scope === 'workflows') {
          refreshRuns()
          // Écrite en fin de tour, une fiche neuve se montre sans rouvrir le fil (conv-1441).
          void refreshFiches()
        }
        if (e.scope === 'roles') refreshRuntimeIdentity()
        // Le compte Claude actif a change COTE MAIN (depart d'un tour, rotation sur quota epuise) :
        // la puce « compte actif » et la barre de quota parlaient encore de l'ancien.
        if (e.scope === 'claudeAccounts') {
          void window.api.claudeAccounts?.()
            .then((payload) => {
              if (payload && payload.accounts.length > 0) setComptesClaude(payload)
            })
            .catch((error: unknown) => traceSilentFailure('claude-accounts-refresh', error))
          window.dispatchEvent(new CustomEvent('autowin:quotas-stale'))
        }
        if (refreshesActiveConversation(e, activeRef.current)) {
          const id = activeRef.current!
          // Le fil affiché est GARDÉ comme repli : la relecture qui suit peut rendre un fil vide
          // (tour en vol non persisté) et effacerait sinon la conversation à l'écran.
          const filAffiche = liveMessagesRef.current.get(id)
          liveMessagesRef.current.delete(id)
          // `.catch` obligatoire : ce handler tourne à CHAQUE event `refresh` ; si la conversation a
          // été supprimée entre l'émission et l'appel (course normale), le rejet produisait un
          // unhandledRejection en usage courant. L'échec est ATTENDU ici (la conv n'existe plus) →
          // on l'absorbe sans message : rien à recharger, l'UI se met à jour par le refresh de liste.
          void window.api
            .conversation(id)
            .then((conversation) => {
              if (conversation && activeRef.current === id)
                void loadConv(conversation as Conv, filAffiche)
            })
            .catch(() => {})
        }
      } else if (e.type === 'orchestrate-start') {
        if (!e.convId) return
        setLiveRuns((current) =>
          reduceScopedLiveRuns(current, {
            type: 'start',
            convId: e.convId!,
            runPath: e.runPath,
            task: e.task ?? texteFil('fil.tache')
          })
        )
        // Le panneau NE s’ouvre PAS tout seul au démarrage d’une orchestration (jugé invasif) :
        // il reste à un clic, via « Détails » ou l’indicateur d’action en cours d’un message.
      } else if (e.type === 'orchestrate-phase' && e.phase && e.convId) {
        setLiveRuns((current) =>
          reduceScopedLiveRuns(current, {
            type: 'phase',
            convId: e.convId!,
            runPath: e.runPath,
            phase: e.phase as {
              step: string
              provider?: string
              role?: string
              model?: string
              reasoningEffort?: string
              phase?: string
              execution?: { groupId?: string }
            }
          })
        )
        /*
         * LE MEME SIGNAL PART DANS LE FIL — correctif du 2026-09-02.
         *
         * Ce qui precede n'alimentait que la carte du panneau Workflows : dans le chat,
         * « 1 action en cours · Orchestration » ne disait NI quelle phase tourne, NI quel modele
         * la joue, et l'etape n'offrait aucun chevron faute de resultat. On reutilise l'evenement
         * existant — en fabriquer un second ferait diverger deux verites sur le meme fait.
         */
        const choix = e.phase as {
          provider?: string
          role?: string
          model?: string
          phase?: string
          step?: string
          prompt?: OrchStep['prompt']
        }
        patchLast(
          e.convId,
          (m) => {
            m.parts = noterChoixDePipeline(m.parts, {
              phase: choix.phase ?? choix.step,
              role: choix.role,
              provider: choix.provider,
              model: choix.model,
              // Le prompt voyage AVEC le démarrage de phase : la ligne ne l'attend plus jusqu'à la fin.
              prompt: texteDuPrompt(choix.prompt)
            }) as typeof m.parts
          },
          porteUneOrchestrationOuverte
        )
      } else if (
        e.type === 'orchestrate-delta' &&
        typeof e.reasoning === 'string' &&
        e.reasoning &&
        e.convId
      ) {
        // Le raisonnement n'est NI le livrable (`delta`) NI une ligne d'etat (`note`) : il se range
        // sous sa phase, lisible en depliant le bloc Orchestration.
        raisonnementBatcher.enqueue({
          convId: e.convId,
          ...(e.reasoningPhase ? { phase: e.reasoningPhase } : {}),
          texte: e.reasoning
        })
      } else if (
        e.type === 'orchestrate-delta' &&
        typeof e.note === 'string' &&
        e.note &&
        e.convId
      ) {
        // NOTE d'activité : elle ne passe PAS par le batcher de deltas, qui accumule du livrable.
        // Elle remplace l'état courant, pour que la carte cesse d'être muette pendant qu'un outil
        // tourne 15 min — le défaut vécu le 2026-08-22, où l'utilisateur concluait à un blocage.
        const convId = e.convId
        const note = e.note
        setLiveRuns((current) =>
          reduceScopedLiveRuns(current, { type: 'note', convId, runPath: e.runPath, note })
        )
        /*
         * UN RUN REPRIS N'A PAS DE TOUR DE CHAT (conv-1330, 2026-10-30). Un tour de chat pose cette
         * note dans la bulle par son battement (`action-progress`) ; une orchestration reprise par le
         * main après un redémarrage n'en envoie pas, et sa bulle restait muette 35 min (conv-1324,
         * spinner allumé). Fil non occupé = aucun tour de chat ne pilote cette ligne : l'écran la
         * pose lui-même sur l'orchestration encore ouverte. Fil occupé : le battement du tour suffit.
         */
        const fil = liveMessagesRef.current.get(convId) ?? []
        if (
          !busyConversationsRef.current.has(convId) &&
          fil.some((m) => m.role === 'assistant' && porteUneOrchestrationOuverte(m as AsstMsg))
        )
          patchLast(
            convId,
            (message) => {
              const ouverte = [...message.parts]
                .reverse()
                .find((part) => part.kind === 'action' && part.name === 'orchestrate')
              if (ouverte?.kind !== 'action' || !ouverte.actionId) return
              Object.assign(
                message,
                reduceAssistantPilotEvent(message, {
                  kind: 'action-progress',
                  actionId: ouverte.actionId,
                  text: note
                })
              )
            },
            porteUneOrchestrationOuverte
          )
      } else if (e.type === 'orchestrate-delta' && typeof e.delta === 'string' && e.convId) {
        deltaBatcher.enqueue({ convId: e.convId, runPath: e.runPath, delta: e.delta })
      } else if (e.type === 'orchestrate-step' && e.step && e.convId) {
        const step = e.step as OrchStep
        setLiveRuns((current) =>
          reduceScopedLiveRuns(current, {
            type: 'step',
            convId: e.convId!,
            runPath: e.runPath,
            step
          })
        )
        /*
         * LA MEME ETAPE COMPLETE SA LIGNE DANS LE FIL (demande du 2026-09-03).
         *
         * Le battement de phase avait deja pose la ligne (« qui joue ») ; seul le step termine porte
         * le prompt envoye et, pour le controle final, la decision et son motif. On les rattache a
         * cette ligne au lieu d'ouvrir un second affichage : une seule verite, deux niveaux de zoom.
         */
        patchLast(
          e.convId,
          (m) => {
            m.parts = completerChoixDePipeline(m.parts, step) as typeof m.parts
          },
          porteUneOrchestrationOuverte
        )
      } else if (
        e.type === 'orchestrate-hypotheses' &&
        e.convId &&
        Array.isArray(e.hypotheses) &&
        e.hypotheses.length
      ) {
        const convId = e.convId
        const recues = e.hypotheses as HypotheseDeCadrage[]
        const run = typeof e.runPath === 'string' ? e.runPath : ''
        runDuCadrageRef.current[convId] = run
        setHypothesesCadrage((current) => ({ ...current, [convId]: recues }))
        setCadrageReplie((current) => {
          if (current[convId] === undefined || current[convId] === run) return current
          const suivant = { ...current }
          delete suivant[convId]
          return suivant
        })
      } else if (e.type === 'orchestrate-end' && e.convId) {
        const convId = e.convId
        const runPath = e.runPath
        /*
         * LES SUPPOSITIONS MEURENT AVEC LE RUN QUI LES PORTAIT.
         *
         * Leur pied dit « Le run continue — rien n'attend ta réponse ». Tant que rien ne les
         * effaçait, cette phrase survivait à la fin du run : sur conv-512, le run se termine à
         * 16:31:43 (tour `24bf5294-7ab1-4104-aa0c-1c0f62009fb8`) et la capture jointe à la saisie
         * `ts` 1789233975928 (55 min plus tard) montre encore le bloc. L'utilisateur lisait donc
         * « ça continue » devant une application à l'arrêt.
         */
        setHypothesesCadrage((current) => {
          if (!current[convId]) return current
          const suivant = { ...current }
          delete suivant[convId]
          return suivant
        })
        setCadrageReplie((current) => {
          if (current[convId] === undefined) return current
          const suivant = { ...current }
          delete suivant[convId]
          return suivant
        })
        delete runDuCadrageRef.current[convId]
        setLiveRuns((current) =>
          reduceScopedLiveRuns(current, {
            type: 'end',
            convId,
            runPath,
            status: (e.status as 'green' | 'red') ?? 'green'
          })
        )
        /*
         * L'action d'orchestration recoit son issue ICI, du statut du run.
         *
         * Sans cela, le fil affichait « 1 action en cours » pendant que le panneau Sous-agents etait
         * vide : le badge lit les parts du tour, le panneau lit les runs vivants, et rien ne les
         * reconciliait. Le tour n'est PAS clos ici — le modele peut encore ecrire sa cloture apres
         * le retour de l'outil, et fermer maintenant tronquerait sa reponse.
         */
        patchLast(convId, (m) => {
          m.parts = settleOrchestrationOnRunEnd(
            m.parts,
            (e.status as 'green' | 'red') ?? 'green'
          ) as typeof m.parts
        })
        // Le run terminé RESTE dans la section Sous-agents avec son fil.
        //
        // Il y avait ici un `setTimeout(4000)` qui dispatchait `clear`, au motif que le run « rejoignait
        // la liste » : c'était faux pour le FIL, car `RunSummary` ne porte aucun step. Le fil était donc
        // détruit et rien ne le reprenait — alors qu'il est précisément la preuve de ce qui a été fait.
        // L'entrée est remplacée au prochain `start` de la même conversation : rien ne s'accumule.
      }
    })
    return () => {
      disposed = true
      couperElementsCibles?.()
      deltaBatcher.cancel()
      raisonnementBatcher.cancel()
      offApp()
    }
  }, [])

  useEffect(() => {
    if (isActive) void Promise.resolve().then(() => refreshRuntimeIdentity())
  }, [isActive])

  /* --- fil : événements de pilotage → patch de la dernière bulle agent --- */

  /**
   * ENTONNOIR DE PEINTURE. Avant la mosaique, chaque site faisait `if (actif) setMessages(fil)` :
   * une conversation non active n'etait jamais peinte, donc une fenetre de mosaique serait restee
   * figee pendant son propre streaming. Tout passe desormais ICI.
   */
  function publierFil(conversationId: string | null, fil: Msg[]): void {
    if (activeRef.current === conversationId) setMessages(fil)
    if (conversationId !== null && mosaicIdsRef.current.includes(conversationId)) {
      setMosaicFils((courant) => ({ ...courant, [conversationId]: fil }))
    }
  }

  function patchLast(
    conversationId: string,
    fn: (m: AsstMsg) => void,
    /**
     * L'evenement vise une part DEJA posee (battement, verdict, ligne de pipeline) : il rejoint la
     * bulle qui la porte, meme si une orientation a ete ecrite dessous (conv-955, 2026-10-15 — sans
     * cela, une bulle vide s'ouvrait sous l'orientation et le run semblait plante pendant 29 min).
     */
    porte?: (m: AsstMsg) => boolean
  ): void {
    // RIEN A PATCHER N'EST PAS « FIL VIDE ». Le cache peut avoir ete retire le temps d'une relecture
    // (handler `refresh`) : publier le tableau vide qui en resulte EFFACAIT la fenetre de mosaique
    // a l'ecran, avant qu'elle ne se repeigne — le clignotement signale par l'utilisateur.
    const courant = liveMessagesRef.current.get(conversationId)
    if (!courant || courant.length === 0) return
    const next = courant.slice()
    // OU ECRIRE : la bulle qui porte la part visee, sinon la bulle ouverte EN FIN DE FIL, jamais
    // au-dessus d'une demande.
    let cible = porte ? indexDeLaBulleQuiPorte(next, porte) : -1
    for (let i = next.length - 1; cible === -1 && i >= 0; i--) {
      if (next[i].role === 'user') break
      if (next[i].role === 'assistant') {
        cible = i
        break
      }
    }
    if (cible === -1) {
      next.push(hydrateStoredAssistant({ content: '', parts: [], status: 'streaming' }))
      cible = next.length - 1
    }
    const copy: AsstMsg = {
      ...(next[cible] as AsstMsg),
      parts: (next[cible] as AsstMsg).parts.slice()
    }
    fn(copy)
    // Invariant impose ICI, dans l'entonnoir UNIQUE de mutation, et non aux trois sites qui closent
    // un tour (annule / echoue / termine) : un quatrieme site futur l'oublierait. Un tour `done` ne
    // laisse aucune action « en cours » — sinon l'indicateur tourne indefiniment et le bouton
    // « Reprendre » n'apparait qu'apres un redemarrage de l'app.
    next[cible] = settleIfDone(copy) as AsstMsg
    liveMessagesRef.current.set(conversationId, next)
    publierFil(conversationId, next)
  }
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
   * conv-44, capture a l'appui).
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

  /**
   * `filDeRepli` : le fil AFFICHÉ juste avant un rechargement qui a invalidé le cache live. Un store
   * qui répond un fil VIDE (tour en vol pas encore persisté, écriture en cours) ne fait PAS foi : sans
   * ce repli, la conversation « arrêtait de s'afficher » et l'écran retombait sur l'accueil « Parle à
   * l'agent » avec ses chips de runs, alors que les messages étaient bien là (constaté le 27/08).
   */
  async function loadConv(c: Conv, filDeRepli?: readonly Msg[]): Promise<void> {
    // Retenu ICI : `loadConv` est le point de passage unique de toute ouverture (clic, reprise,
    // inbox d'agents), donc le seul endroit ou la memoire ne peut pas se desynchroniser.
    memoriserDerniereConversation(c.id)
    marquerConversationVue(c.id, c.updatedAt)
    const requestId = ++loadConversationRequestRef.current
    // Le numéro de requête arbitre AUSSI l'affichage : une réponse (ou un échec) PÉRIMÉ ne
    // repeint plus rien — c'est la dernière sélection de l'utilisateur qui fait foi.
    const perime = (): boolean => requestId !== loadConversationRequestRef.current
    let detailed: Conv | null
    if (c.messages) detailed = c
    else {
      setConvLoad({ status: 'loading', target: c })
      try {
        detailed = (await window.api.conversation(c.id)) as Conv | null
      } catch (error) {
        if (perime()) return
        setConvLoad({
          status: 'error',
          target: c,
          error: error instanceof Error ? error.message : String(error)
        })
        return
      }
    }
    if (perime()) return
    if (!detailed) {
      setConvLoad({ status: 'error', target: c, error: texteFil('fil.introuvableStore') })
      return
    }
    resetConvLoad()
    const reprise = positionLectureMemorisee(c.id)
    positionARestaurerRef.current = reprise ?? null
    followTailRef.current = !reprise
    setHasNewActivity(false)
    // Le « fil remonte » appartient a LA conversation qu'on quitte. Sans cette remise a l'etat de la
    // conversation OUVERTE, le bouton « ↓ Dernier message » restait peint pendant le rendu du
    // nouveau fil et ne partait qu'a la frame de descente : un CLIGNOTEMENT a chaque bascule
    // (rapporte le 2026-09-01). Une reprise, elle, s'ouvre bien remontee : le bouton y est du.
    setScrolledAwayFromTail(!!reprise)
    // Le fil va etre REMPLACE : les `scroll` qui suivent viennent du navigateur, pas du lecteur.
    basculeConvRef.current = true
    gesteLecteurRef.current = false
    activeRef.current = c.id
    setActiveId(c.id)
    setListeTelOuverte(false)
    const branchMessages = detailed.messages ?? []
    const duStore = hydraterFilStocke(branchMessages)
    // Un rechargement ne RÉTRÉCIT pas le fil à zéro : le vide du store est une absence d'information,
    // pas une conversation vidée.
    const relu =
      duStore.length === 0 && filDeRepli && filDeRepli.length > 0 ? [...filDeRepli] : duStore
    /*
     * UN CACHE VIDE EST UNE ABSENCE, PAS UN FIL.
     *
     * Vecu le 2026-09-01 (conv-82) : « les messages de conv-82 ont disparu » — la conversation
     * existait, la barre laterale comptait ses 5 messages, le disque les rendait tous, l'ecran
     * n'affichait RIEN. Une conversation ouverte alors qu'elle etait encore VIDE (elle vient d'etre
     * creee) laisse un tableau vide dans le cache d'affichage ; l'agent la remplit ensuite cote
     * processus principal, sans passer par ce cache. A la reouverture, `?? relu` ne se declenchait
     * pas — un tableau vide n'est pas `undefined` — et ce vide gagnait sur un store PLEIN.
     *
     * Meme regle que juste au-dessus pour le store : le fil ne RETRECIT pas a zero.
     */
    /*
     * ... ET UN CACHE PLUS COURT QUE LE STORE N'EST PAS LE FIL.
     *
     * Vecu conv-152 (saisie ts=1788413114634 : « la moitié de cette convers s'est effacé j'arrive
     * pas a remonter le fil », tour 57656364-053f-40e6-bc8e-91efd5b74e39). Le disque portait les 41
     * messages, l'ecran la seule fin. Un tour lance cote main amorce ce cache avec le SEUL message
     * en cours ; `cache.length > 0` le faisait alors gagner sur un store PLEIN. `filAffichable`
     * repose la tete du store et garde la queue vivante : le fil ne RETRECIT plus.
     */
    const cacheAffiche = liveMessagesRef.current.get(c.id)
    const stored = filAffichable(cacheAffiche, relu)
    liveMessagesRef.current.set(c.id, stored)
    setMessages(stored)
    switchComposerDraft(c.id)
    void reconcilierTourNonClos(c.id)
  }

  /**
   * Un tour relu comme NON CLOS est-il vraiment en vol ? Le main seul le sait.
   *
   * Un message persiste en `streaming` — l'app tuee en plein tour — se relisait comme un tour vivant :
   * ses actions restaient sans issue, donc l'indicateur « N action en cours » collait alors que le
   * panneau Sous-agents etait vide. On INTERROGE donc l'autorite, au lieu de supposer dans un sens ou
   * dans l'autre : un tour reellement en vol est ADOPTE (fil occupe), un tour mort est clos.
   *
   * Best-effort : si la sonde echoue, on ne change rien — mieux vaut un indicateur trop prudent qu'un
   * tour vivant declare mort.
   */
  async function reconcilierTourNonClos(id: string): Promise<void> {
    const messages = liveMessagesRef.current.get(id) ?? []
    const dernier = [...messages].reverse().find((message) => message.role === 'assistant')
    /*
     * N'IMPORTE QUELLE bulle non close justifie la sonde, pas seulement la DERNIÈRE (conv-913,
     * 2026-10-13). Au redémarrage, le main rattache une orchestration encore vivante et AJOUTE en bas
     * du fil un récapitulatif « Reprise du fil… » sans statut, donc relu comme terminé
     * (`index.ts`, `recapMessage`). La bulle du tour vivant n'était plus la dernière : l'écran ne
     * sondait pas, croyait le fil libre, et la saisie partait en message normal, refusé par le main.
     */
    const unTourNonClos = messages.some(
      (message) => message.role === 'assistant' && !(message as AsstMsg).done
    )
    if (!unTourNonClos) return
    let actif: boolean | undefined
    try {
      actif = (await window.api.pilotChatActive?.(id))?.active
    } catch {
      return
    }
    if (actif === undefined) return
    if (activeRef.current !== id && !liveMessagesRef.current.has(id)) return
    if (actif) {
      /*
       * UN TOUR VIVANT QUE L'ÉCRAN N'A PAS LANCÉ : il l'ADOPTE (conv-260, 2026-10-11).
       * Cas réel : le main redémarre pendant un tour, le CLI survit et le main le REPREND, mais sans
       * émettre le moindre événement pilote pendant l'attente. L'écran ne passait un fil en
       * « occupé » que sur un tel événement : il croyait le fil libre, et le message suivant lançait
       * un second agent sur la même session. Adopté, le fil montre Stop, la saisie part en
       * orientation, et la veille des tours (`TOUR_VIVANT_SONDE_MS`) le relâche à sa vraie fin.
       */
      if (!busyConversationsRef.current.has(id)) setConversationBusy(id, true)
      return
    }
    // Tour mort : on ne clôt que la DERNIÈRE bulle, comme avant. Une bulle plus haute restée
    // « en cours » n'est pas réécrite ici : rien ne dit qu'elle appartienne au tour sondé.
    if (!dernier || (dernier as AsstMsg).done) return
    setConversationBusy(id, false)
    patchLast(id, (message) => {
      message.done = true
      if (message.status === 'streaming') message.status = 'interrupted'
    })
  }

  /**
   * « Traiter » DELEGUE, au lieu d'ouvrir une liste.
   *
   * L'utilisateur a clique, lu les quatorze lignes, et demande « et apres je fais quoi avec ca ? ».
   * La liste informait sans permettre d'agir : elle deplacait le probleme sur lui. Le bouton ecrit
   * desormais le prompt dans une conversation NEUVE et l'ENVOIE : l'utilisateur a deja decide en
   * cliquant, et le tri des travaux non publies est une lecture qui ne supprime rien.
   *
   * La liste reste accessible par « Voir la liste » : elle sert a LIRE un diff, et supprimer cet
   * acces aurait ete une perte silencieuse.
   */
  async function traiterTravauxNonPublies(): Promise<void> {
    let prompt: string | null = null
    try {
      const agents = (await window.api.getWorktreeActivity?.()) ?? []
      prompt = promptTravauxNonPublies(agents)
    } catch {
      // Activite indisponible : on ne fabrique PAS un prompt qui parlerait de travaux inconnus.
      return
    }
    if (!prompt) return
    newConv()
    setDraftInput(NEW_DRAFT_KEY, prompt)
    /*
     * ENVOYE, pas depose. Le geste s'arretait au brouillon « l'utilisateur lit et decide » : il
     * n'avait plus rien a decider — il a clique « Traiter », le prompt est un `/salvage` que lui
     * seul pouvait envoyer, et il l'a envoye a la main a chaque fois. Demande du 2026-09-03 : « je
     * passe mon temps a envoyer des salvages alors que ca pourrait etre fait tout seul ». Le tri est
     * une LECTURE qui juge par contenu et ne supprime rien sans SHA consigne : sur, borne, reversible.
     * Le prompt reste ECRIT dans le fil, donc visible et relisible.
     */
    requestAnimationFrame(() => void send(prompt))
  }

  /**
   * OUVRIR une conversation DE PLUS dans la mosaique (elle ne remplace pas l'active). Le fil vient
   * du cache vivant s'il existe, sinon du store : une fenetre vide le temps d'un aller-retour IPC
   * serait indiscernable d'une conversation reellement vide.
   */
  async function ouvrirDansMosaique(id: string): Promise<void> {
    if (!mosaicIdsRef.current.includes(id)) mosaicIdsRef.current = [...mosaicIdsRef.current, id]
    setMosaicIds((courant) => (courant.includes(id) ? courant : [...courant, id]))
    // UN CACHE VIDE EST UNE ABSENCE, PAS UN FIL — meme regle qu'au chat plein (conv-82). Une
    // conversation ouverte alors qu'elle etait encore vide laisse un tableau vide ici ; l'agent la
    // remplit ensuite cote main, sans passer par ce cache. Un `if (cache)` laissait donc ce vide
    // gagner sur un store PLEIN et la fenetre revenait « creuse » (« Aucun message. »).
    const cache = liveMessagesRef.current.get(id)
    if (cache && cache.length > 0) {
      setMosaicFils((courant) => ({ ...courant, [id]: cache }))
      return
    }
    try {
      const detail = (await window.api.conversation(id)) as Conv | null
      const fil = hydraterFilStocke(detail?.messages ?? [])
      liveMessagesRef.current.set(id, fil)
      setMosaicFils((courant) => ({ ...courant, [id]: fil }))
    } catch {
      setMosaicFils((courant) => ({ ...courant, [id]: [] }))
    }
  }

  /**
   * NOUVELLE conversation DANS la mosaique. Elle est creee tout de suite cote store (au lieu d'un
   * brouillon sans identite) : une fenetre a besoin d'un id des sa premiere frappe — c'est lui qui
   * porte le brouillon, les pieces jointes, le tour et sa peinture.
   */
  async function nouvelleFenetreMosaique(): Promise<void> {
    const identity = await refreshRuntimeIdentity()
    const creee = await window.api.conversationsCreate({
      // Reste en français : titre PROVISOIRE que le stockage reconnaît pour le remplacer par le
      // premier message (voir plus bas, « provisoire « Nouvelle conversation » »).
      title: 'Nouvelle conversation',
      category: identity.provider,
      provider: identity.provider
    })
    // Le dossier de travail choisi pour un fil neuf se pose AVANT le premier tour.
    const dossierArme = dossierNouveauFilRef.current
    if (dossierArme) {
      await window.api.conversationsSetProject?.(creee.id, dossierArme)
      consommerDossierNouveauFil()
    }
    // Le modèle et le compte armés, eux aussi, se posent AVANT le premier tour (le main les lit alors).
    await poserModeleArme(creee.id)
    await poserCompteArme(creee.id)
    setConvs((courant) =>
      courant.some((c) => c.id === creee.id)
        ? courant
        : [
            {
              ...creee,
              ...(dossierArme ? { projectPath: dossierArme } : {}),
              updatedAt: Date.now(),
              messages: []
            } as unknown as Conv,
            ...courant
          ]
    )
    liveMessagesRef.current.set(creee.id, [])
    await ouvrirDansMosaique(creee.id)
  }

  /** Le MEME clic ouvre ou referme : en mosaique la liste est un jeu d'interrupteurs. */
  async function basculerDansMosaique(id: string): Promise<void> {
    if (mosaicIdsRef.current.includes(id)) {
      fermerFenetreMosaique(id)
      return
    }
    await ouvrirDansMosaique(id)
  }

  /** Quitter la mosaique EN emportant la conversation cliquee : elle devient le fil unique actif. */
  async function ouvrirSeuleDepuisMosaique(id: string): Promise<void> {
    setConvViewMode('list')
    const cible = convsRef.current.find((c) => c.id === id)
    if (cible) await loadConv(cible)
    // Le fil plein ecran vient d'etre monte : il nait en haut. On demande explicitement son
    // atterrissage (bas du fil, ou reprise de lecture memorisee), car `loadConv` peut n'avoir
    // re-rendu AUCUN message quand la conversation ouverte etait deja l'active.
    setAtterrissageDemande((tour) => tour + 1)
  }

  function fermerFenetreMosaique(id: string): void {
    mosaicIdsRef.current = mosaicIdsRef.current.filter((autre) => autre !== id)
    setMosaicIds((courant) => courant.filter((autre) => autre !== id))
    setMosaicFils((courant) => {
      const suite = { ...courant }
      delete suite[id]
      return suite
    })
  }

  /** Referme TOUTES les fenetres d'un coup : la mosaique reste, elle redevient vide. */
  function fermerToutesFenetresMosaique(): void {
    mosaicIdsRef.current = []
    setMosaicIds([])
    setMosaicFils({})
  }

  function newConv(): void {
    loadConversationRequestRef.current += 1
    resetConvLoad()
    followTailRef.current = true
    setHasNewActivity(false)
    activeRef.current = null
    setActiveId(null)
    setListeTelOuverte(false)
    setMessages([])
    switchComposerDraft(NEW_DRAFT_KEY)
    void refreshRuntimeIdentity(true)
  }

  useEffect(() => {
    const openBrainwash = (event: Event): void => {
      const prompt = (event as CustomEvent<{ prompt?: string }>).detail?.prompt
      if (!prompt) return
      newConv()
      setDraftInput(NEW_DRAFT_KEY, prompt)
      requestAnimationFrame(() => composerRef.current?.focus())
    }
    /**
     * Tickets → Chat (refonte du 2026-07-28). Ouvre la conversation de la sélection et y PRÉ-REMPLIT
     * le prompt sans l'envoyer : c'est l'utilisateur qui déclenche. `send: true` (case « Traiter
     * réellement ») envoie immédiatement. Avant, la vue Tickets lançait N orchestrations sans que le
     * prompt soit jamais visible.
     */
    const prefill = (event: Event): void => {
      const detail = (
        event as CustomEvent<{
          conversationId?: string
          prompt?: string
          send?: boolean
        }>
      ).detail
      // Un événement SANS prompt mais AVEC conversationId est une demande de SÉLECTION : « ouvre
      // cette conversation ». Le scout de veille s'en sert pour amener l'utilisateur devant le tour
      // qui démarre — l'ignorer laissait la conversation active inchangée (mesuré le 14/08 : le clic
      // « En générer plus » atterrissait sur l'ancienne conversation).
      if (!detail?.prompt && !detail?.conversationId) return
      const id = detail.conversationId
      /**
       * MOSAIQUE. Le chat unique n'est pas rendu du tout dans ce mode : remplir son champ
       * n'affichait RIEN, et « Faire reparer » (comme « Prompter dans Autowin » ou « Preparer le
       * prompt » des tickets) paraissait mort alors que la conversation etait bien creee. On ouvre
       * donc une fenetre DE PLUS — la mosaique reste en place —, on y depose le brouillon (deja
       * indexe par conversation) et on impose la valeur au composer de cette fenetre des qu'il est
       * monte. Choix utilisateur du 2026-09-01 (conv-44) contre la sortie de mosaique.
       */
      if (id && convViewModeRef.current === 'mosaic') {
        const prompt = detail.prompt
        void (async () => {
          if (!convsRef.current.some((conversation) => conversation.id === id)) await refreshConvs()
          await ouvrirDansMosaique(id)
          if (!prompt) return
          setDraftInput(id, prompt)
          if (detail.send) {
            void send(prompt, { targetConversationId: id })
            return
          }
          // La fenetre vient d'etre ajoutee : son composer peut n'etre pas encore monte au premier
          // repaint. On retente quelques images avant d'abandonner, plutot qu'un delai devine.
          let restantes = 5
          const poser = (): void => {
            const composer = composersMosaiqueRef.current.get(id)
            if (composer) {
              composer.setInput(prompt)
              composer.focus()
              return
            }
            if (--restantes > 0) requestAnimationFrame(poser)
          }
          requestAnimationFrame(poser)
        })()
        return
      }
      if (id) {
        const target = convsRef.current.find((conversation) => conversation.id === id)
        if (target) void loadConv(target)
        else {
          // Conversation créée À L'INSTANT (scout de veille) : la liste du renderer ne la porte pas
          // encore. La rafraîchir PUIS charger, sinon le panneau restait sur l'état vide « Parle à
          // l'agent » pendant que le tour tournait dans le store (mesuré le 14/08, conv-1164).
          activeRef.current = id
          setActiveId(id)
          setMessages([])
          void (async () => {
            await refreshConvs()
            const fraiche = convsRef.current.find((conversation) => conversation.id === id)
            if (fraiche && activeRef.current === id) await loadConv(fraiche)
          })()
        }
      }
      if (!detail.prompt) return
      const draftKey = id ?? NEW_DRAFT_KEY
      switchComposerDraft(draftKey)
      setDraftInput(draftKey, detail.prompt)
      if (detail.send) void send(detail.prompt, { targetConversationId: id })
      else requestAnimationFrame(() => composerRef.current?.focus())
    }
    window.addEventListener('autowin:prefill-conversation', prefill)
    window.addEventListener('autowin:brainwash', openBrainwash)
    // Une demande émise AVANT le premier affichage du chat a été gardée par le relais (conv-1101,
    // `relais-prefill.ts`) : on la réclame dans le MÊME bloc que la pose de l'écouteur.
    const gardee = ouvrirEcouteurPrefill()
    if (gardee) prefill(new CustomEvent('autowin:prefill-conversation', { detail: gardee }))
    return () => {
      fermerEcouteurPrefill()
      window.removeEventListener('autowin:prefill-conversation', prefill)
      window.removeEventListener('autowin:brainwash', openBrainwash)
    }
  }, [])

  /**
   * Survie niveau 2 — REJEU : reconstruit, depuis le journal fichier du tour, ce que le CLI a produit
   * pendant que l'app était fermée (le store de conversation, lui, n'a rien reçu), puis l'affiche
   * comme réponse assistant. N'ajoute rien si le contenu est déjà présent (pas de doublon).
   */
  async function replayTurnJournal(conversationId: string, turnId: string): Promise<void> {
    let events: Array<Record<string, unknown>> = []
    try {
      events = (await window.api.turnJournal?.(conversationId, turnId)) ?? []
    } catch (error) {
      traceSilentFailure('turn-journal', error)
      return
    }
    const replayed = events
      .filter((event) => event.kind === 'delta' && typeof event.text === 'string')
      .map((event) => event.text as string)
      .join('')
    if (!replayed.trim()) return
    // Dédup par TOUR, pas par texte : `JSON.stringify(message).includes(80 premiers caractères)`
    // sérialisait tout le fil à chaque rejeu ET se trompait dans les deux sens — deux tours au
    // préambule identique se masquaient, un tour reformulé à la persistance se dupliquait.
    if (replayedTurnsRef.current.has(turnId)) return
    // L'ENREGISTREMENT D'ABORD (conv-1149) : un tour encore en vol, ou dont le texte est déjà
    // enregistré, n'a rien à rejouer — sa bulle rejouée remplaçait la demande et l'action en cours.
    let enregistre: MessageStocke[] = []
    try {
      enregistre =
        ((await window.api.conversation(conversationId)) as { messages?: MessageStocke[] } | null)
          ?.messages ?? []
    } catch (error) {
      traceSilentFailure('turn-journal', error)
    }
    if (rejeuDejaEnregistre(enregistre, turnId, replayed)) {
      replayedTurnsRef.current.add(turnId)
      return
    }
    // Relu APRÈS l'attente : un événement du tour a pu poser son fil entre-temps.
    const current = liveMessagesRef.current.get(conversationId) ?? []
    if (replayedTurnsRef.current.has(turnId)) return
    if (current.some((message) => message.role === 'assistant' && message.turnId === turnId)) {
      replayedTurnsRef.current.add(turnId)
      return
    }
    const next: Msg[] = [
      ...current,
      // `parts` EXPLICITE : un tableau vide passerait le `??` de hydrateStoredAssistant et donnerait
      // un message sans aucune part → invisible (cause du rejeu muet constatée en essai réel).
      hydrateStoredAssistant({
        content: replayed,
        parts: [{ kind: 'text', text: replayed }],
        status: 'completed',
        // Le tour est PORTÉ par le message : c'est lui qui rend la dédup exacte au rejeu suivant.
        turnId
      })
    ]
    replayedTurnsRef.current.add(turnId)
    liveMessagesRef.current.set(conversationId, next)
    publierFil(conversationId, next)
  }

  // Survie niveau 2 : « Reprendre » depuis le bandeau de démarrage ouvre la conversation dont le
  // tour a été interrompu par la fermeture de l'app (son fil est rechargé depuis le store).
  useEffect(() => {
    const openConversation = (event: Event): void => {
      // DEUX FORMES acceptées : l'objet `{ conversationId }` (bandeau de reprise) et l'id NU en
      // chaîne, envoyé par l'écran des fiches et l'accueil. Avant, la chaîne tombait dans
      // `detail?.conversationId === undefined` et l'ouverture était silencieusement ignorée : le
      // chat restait sur la conversation courante, d'où l'impression d'« aller vers la dernière ».
      const raw = (event as CustomEvent<{ conversationId?: string; turnId?: string } | string>)
        .detail
      const detail = typeof raw === 'string' ? { conversationId: raw } : raw
      const id = detail?.conversationId
      if (!id) return
      // La conversation demandée peut ne PAS être dans la liste en mémoire : celle créée depuis
      // l'écran des fiches est plus récente que le dernier chargement. Sans ce rafraîchissement, la
      // recherche échouait et le chat restait sur la conversation affichée — on croyait « atterrir
      // sur la dernière ». Même garde que le chemin de pré-remplissage voisin.
      void (async () => {
        if (!convsRef.current.some((conversation) => conversation.id === id)) await refreshConvs()
        const target = convsRef.current.find((conversation) => conversation.id === id)
        if (target) await loadConv(target)
        // Fil déjà ouvert : `activeId` ne change pas, l'effet ne relirait pas ses fiches, et la fiche
        // demandée depuis le Board ne se déplierait pas (conv-1441).
        if (target) await refreshFiches()
      })()
      // REJEU du journal : l'app était fermée pendant le tour → le store n'a pas reçu ces événements,
      // seul le journal fichier les contient. On reconstruit le texte produit et on l'affiche.
      if (detail?.turnId) void replayTurnJournal(id, detail.turnId)
    }
    window.addEventListener('autowin:open-conversation', openConversation)
    return () => window.removeEventListener('autowin:open-conversation', openConversation)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function renameConv(c: Conv): void {
    setRenameCandidate({ conv: c, value: c.title })
  }
  async function confirmRenameConv(): Promise<void> {
    const candidate = renameCandidate
    if (!candidate) return
    const titre = candidate.value.trim()
    if (!titre || titre === candidate.conv.title) {
      setRenameCandidate(null)
      return
    }
    setRenameCandidate(null)
    await window.api.conversationsRename(candidate.conv.id, titre)
    await refreshConvs()
  }
  async function removeConv(c: Conv): Promise<void> {
    setDeleteCandidate(c)
  }
  async function confirmRemoveConv(): Promise<void> {
    const c = deleteCandidate
    if (!c) return
    setDeleteCandidate(null)
    await window.api.conversationsRemove(c.id)
    composerDraftsRef.current.delete(c.id)
    oublierBrouillons([c.id])
    if (activeId === c.id) newConv()
    await refreshConvs()
  }

  function toggleConvSelection(id: string): void {
    setSelectedConvIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function quitterModeSelection(): void {
    setConvSelectionMode(false)
    setSelectedConvIds(new Set())
    setBulkDeleteError(null)
  }

  /** Supprime le LOT sélectionné en UNE confirmation. Les ids non sélectionnés restent intacts. */
  async function confirmBulkDelete(): Promise<void> {
    const ids = [...selectedConvIds]
    if (ids.length === 0) return
    setBulkDeleteError(null)
    try {
      const removed = await window.api.conversationsRemoveMany(ids)
      for (const id of removed) composerDraftsRef.current.delete(id)
      oublierBrouillons(removed)
      if (activeId && removed.includes(activeId)) newConv()
      setBulkDeleteAsking(false)
      quitterModeSelection()
      await refreshConvs()
    } catch (error) {
      setBulkDeleteError(error instanceof Error ? error.message : String(error))
    }
  }

  function requestDeleteRun(run: RunEntry): void {
    // Portée toujours « conv » : on ne supprime que dans la conversation affichée.
    if (!activeId) return
    setRunDeleteError(null)
    setDeleteRunCandidate({ run, scope: 'conv', conversationId: activeId })
  }

  async function confirmDeleteRun(): Promise<void> {
    const candidate = deleteRunCandidate
    if (!candidate || runDeletePending) return
    setRunDeletePending(true)
    setRunDeleteError(null)
    try {
      if (candidate.scope === 'tous') {
        await window.api.deleteRun(candidate.run.path)
      } else if (candidate.conversationId) {
        await window.api.deleteConversationRun(candidate.conversationId, candidate.run.path)
      } else {
        throw new Error(texteFil('run.conversationIntrouvable'))
      }
      if (openRun?.path === candidate.run.path) {
        setOpenRun(null)
        setOpenTrace(null)
      }
      setDeleteRunCandidate(null)
      await refreshRuns()
    } catch (error) {
      setRunDeleteError(error instanceof Error ? error.message : String(error))
    } finally {
      setRunDeletePending(false)
    }
  }

  /** Recharge la conversation active depuis le store à jour (invalide le cache live). */
  async function reloadActiveFromStore(id: string): Promise<void> {
    liveMessagesRef.current.delete(id)
    const fresh = (await window.api.conversations()) as Conv[]
    setConvs(fresh)
    const updated = fresh.find((c) => c.id === id)
    if (updated) void loadConv(updated)
  }
  /**
   * Forker ouvre la conversation CRÉÉE — c'est le geste attendu : on continue dans la copie, pas
   * dans l'originale. L'ancienne version rechargeait la conversation courante, parce que le fork
   * n'était qu'une branche interne à laquelle il fallait une barre d'onglets pour accéder.
   */
  async function forkFromMessage(messageId: string): Promise<void> {
    if (!activeId) return
    /*
     * Ouvre la branche MÊME pendant un tour (conv-1543, 2026-11-04) : la retenue sur place avec un
     * bandeau « la branche vous attend dans la liste » (2026-09-03) a été refusée par l'utilisateur —
     * cliquer la branche doit toujours l'y emmener. Le tour du fil d'origine continue en fond.
     */
    const forked = (await window.api.conversationsFork(activeId, messageId)) as Conv | undefined
    const fresh = (await window.api.conversations()) as Conv[]
    setConvs(fresh)
    const target = (forked?.id && fresh.find((c) => c.id === forked.id)) || undefined
    if (!target) {
      await reloadActiveFromStore(activeId) // fork refusé : on reste où on est
      return
    }
    void loadConv(target)
  }
  /**
   * « MODIFIER ET RELANCER » (conv-1038, 2026-10-21) : reprendre un de ses messages en le corrigeant.
   * La copie du fil s'arrête JUSTE AVANT lui (`departPourModifier`), s'ouvre, et le texte du message
   * attend dans sa saisie : rien n'est envoyé, l'utilisateur corrige puis envoie. Avant le premier
   * message, il n'y a rien à copier : un fil neuf. Même retenue que la branche pendant un tour : on ne
   * quitte pas le fil qui travaille, un avis dit où la copie attend. Seule la conversation revient en
   * arrière, pas les fichiers (décision « branches-rewind », étape 1).
   */
  async function modifierEtRelancer(messageId: string): Promise<void> {
    const source = activeRef.current
    if (!source) return
    const message = messages.find((candidat) => candidat.messageId === messageId)
    if (!message || message.role !== 'user' || !message.content) return
    const depart = departPourModifier(messages, messageId)
    if (!depart) return
    if (depart.kind === 'fil-neuf') {
      newConv()
      setDraftInput(NEW_DRAFT_KEY, message.content)
      requestAnimationFrame(() => composerRef.current?.focusAt(-1))
      return
    }
    const tourEnCours = busyConversationsRef.current.has(source)
    const copie = (await window.api.conversationsFork(source, depart.ancre)) as Conv | undefined
    const fraiches = (await window.api.conversations()) as Conv[]
    setConvs(fraiches)
    const cible = copie?.id
      ? fraiches.find((conversation) => conversation.id === copie.id)
      : undefined
    if (!cible) {
      await reloadActiveFromStore(source) // copie refusée : on reste où on est
      return
    }
    // Le brouillon de la copie est posé AVANT son ouverture : l'ouverture le relit tel quel.
    setDraftInput(cible.id, message.content)
    if (tourEnCours) {
      setAppNotice((current) =>
        newestNotice(current, {
          text: texteFil('copie.creee', { titre: cible.title })
        })
      )
      return
    }
    await loadConv(cible)
    requestAnimationFrame(() => composerRef.current?.focusAt(-1))
  }
  /**
   * « REVENIR À CE TOUR, CODE ET FIL » (conv-1038, 2026-10-21 — décision « branches-rewind »,
   * étape 2). Le main rouvre la photo du code prise au début du tour de ce message dans une COPIE
   * SÉPARÉE (`photo-du-code.ts`) ; ici, la copie du fil s'arrête juste avant le message (comme
   * « Modifier et relancer ») et travaille DANS cette copie : son tour suivant n'écrit jamais dans le
   * dossier partagé. Le texte du message attend dans la saisie, rien n'est envoyé. Sans photo, aucune
   * branche n'est créée et la raison est dite.
   */
  async function revenirAuTour(messageId: string): Promise<void> {
    const source = activeRef.current
    if (!source) return
    const message = messages.find((candidat) => candidat.messageId === messageId)
    if (!message || message.role !== 'user') return
    const depart = departPourModifier(messages, messageId)
    if (!depart) return
    const retour = await window.api.conversationRevenirAuTour?.(source, messageId)
    if (!retour) return
    if (!retour.ok) {
      setAppNotice((current) => newestNotice(current, { text: retour.raison }))
      return
    }
    const branche = await brancheDansLaCopie(
      source,
      depart.kind === 'copie' ? depart.ancre : undefined,
      retour.chemin,
      texteFil('revenir.titre')
    )
    if (!branche.ok) {
      setAppNotice((current) =>
        newestNotice(current, {
          text: texteFil('revenir.brancheRefusee', {
            chemin: retour.chemin,
            raison: branche.raison
          })
        })
      )
      return
    }
    const cibleId = branche.id
    const fraiches = (await window.api.conversations()) as Conv[]
    setConvs(fraiches)
    const cible = fraiches.find((conversation) => conversation.id === cibleId)
    if (!cible) return
    setDraftInput(cible.id, message.content)
    setAppNotice((current) =>
      newestNotice(current, {
        text: texteFil('revenir.fait', { chemin: retour.chemin })
      })
    )
    if (busyConversationsRef.current.has(source)) return
    await loadConv(cible)
    requestAnimationFrame(() => composerRef.current?.focusAt(-1))
  }
  /**
   * « ESSAIE 3 FAÇONS » (conv-1038, 2026-10-21) : la demande tapée part dans TROIS branches du fil,
   * chacune rattachée à SA copie séparée du code (le main les ouvre à une même photo) et chacune avec
   * une façon imposée (`trois-facons.ts`). Les trois s'ouvrent en mosaïque pour être comparées. Rien
   * n'est fusionné dans le dossier partagé : garder une façon reste un geste de l'utilisateur. Chaque
   * branche est un tour payé — trois fois le coût d'un tour, et l'avis le dit.
   */
  // Armé POUR UN FIL (conv-1491) : un booléen global restait allumé en changeant de fil, et
  // l'envoi suivant partait en 3 branches dans un AUTRE fil que celui où ×3 avait été cliqué.
  const [troisFaconsFil, setTroisFaconsFil] = useState<string | null>(null)
  const troisFaconsArme = troisFaconsFil !== null && troisFaconsFil === activeId
  const setTroisFaconsArme = (arme: boolean | ((courant: boolean) => boolean)): void => {
    const suivant = typeof arme === 'function' ? arme(troisFaconsArme) : arme
    setTroisFaconsFil(suivant && activeId ? activeId : null)
  }
  async function essayerTroisFacons(): Promise<void> {
    const source = activeRef.current
    const demande = texteDuComposer().trim()
    if (!source || !demande) {
      setAppNotice((current) =>
        newestNotice(current, {
          text: source ? texteFil('essai.ecrisDabord') : texteFil('essai.ouvreDabord')
        })
      )
      return
    }
    const essai = await window.api.conversationEssaisEnParallele?.(source, 3)
    if (!essai) return
    if (!essai.ok) {
      setAppNotice((current) => newestNotice(current, { text: essai.raison }))
      return
    }
    const filSource = liveMessagesRef.current.get(source) ?? messages
    const ancre = [...filSource].reverse().find((message) => message.messageId)?.messageId
    const titre =
      convsRef.current.find((conversation) => conversation.id === source)?.title ??
      texteFil('essai.titre')
    const total = essai.chemins.length
    // Chaque branche garde SON rang : son titre (« façon 3/3 ») et sa façon imposée restent
    // d'accord même quand une autre façon n'a pas pu partir.
    const branches: Array<{ id: string; rang: number }> = []
    const refusees: string[] = []
    for (const [rang, chemin] of essai.chemins.entries()) {
      const branche = await brancheDansLaCopie(source, ancre, chemin, titre)
      if (!branche.ok) {
        refusees.push(texteFil('essai.refusee', { rang: rang + 1, raison: branche.raison }))
        continue
      }
      await window.api.conversationsRename?.(branche.id, titreDeLaFacon(titre, rang, total))
      branches.push({ id: branche.id, rang })
    }
    if (branches.length > 0) setDraftInput(composerDraftKeyRef.current, '')
    const fraiches = (await window.api.conversations()) as Conv[]
    convsRef.current = fraiches
    setConvs(fraiches)
    if (branches.length > 0) setConvViewMode('mosaic')
    for (const { id, rang } of branches) {
      await ouvrirDansMosaique(id)
      void send(demandePourLaFacon(demande, rang, total), { targetConversationId: id })
    }
    const lancees = texteFil(branches.length > 1 ? 'essai.lancees' : 'essai.lancee', {
      n: branches.length,
      chemins: essai.chemins.join(' · ')
    })
    const nonParties = refusees.length
      ? ` ${texteFil(refusees.length > 1 ? 'essai.nonEnvoyees' : 'essai.nonEnvoyee', {
          refus: refusees.join(' · ')
        })}`
      : ''
    setAppNotice((current) => newestNotice(current, { text: `${lancees}${nonParties}` }))
  }
  /**
   * Une branche du fil NÉE dans sa copie séparée (conv-1038, 2026-10-21) : le dossier part AVEC la
   * branche (`fork(…, { dossier })`, ou la création d'un fil neuf quand il n'y a rien à copier), et
   * la réponse est RELUE. Mesuré avant : la branche était créée puis rangée par un second appel dont
   * l'échec n'était pas lu — elle s'ouvrait, recevait la demande et travaillait dans le dossier
   * PARTAGÉ. Un processus principal d'avant ce correctif ignore `dossier` : la relecture le voit.
   * fix-ok: cause mesurée (conv-1038, rejeu du 2026-10-21) — rattachement par un 2e appel dont l'échec n'était pas lu. Sans la relecture ci-dessous, 2 tests rouges (revenir-au-tour, trois-facons) ; sans `{ dossier }` passé au fork, 3 rouges. Entrée décisive : une branche rendue sans `projectPath`.
   */
  async function brancheDansLaCopie(
    source: string,
    ancre: string | undefined,
    chemin: string,
    titre: string
  ): Promise<{ ok: true; id: string } | { ok: false; raison: string }> {
    const attendu = canonicalProjectPath(chemin)
    try {
      let branche: { id?: string; projectPath?: string } | undefined
      if (ancre) {
        branche = (await window.api.conversationsFork(source, ancre, { dossier: chemin })) as Conv
      } else {
        const identity = await refreshRuntimeIdentity()
        branche = await window.api.conversationsCreate({
          title: titre,
          category: identity.provider,
          provider: identity.provider,
          projectPath: chemin
        })
      }
      if (!branche?.id) return { ok: false, raison: texteFil('branche.refusee') }
      if (!attendu || branche.projectPath !== attendu)
        return { ok: false, raison: texteFil('branche.dossierNonPose') }
      return { ok: true, id: branche.id }
    } catch (erreur) {
      return { ok: false, raison: erreur instanceof Error ? erreur.message : String(erreur) }
    }
  }
  /**
   * DES MESSAGES À LA SUITE DANS UN FIL (conv-1147) : le premier part, les autres attendent dans la
   * file du fil, un par tour. C'est le même geste que les lots du scout (`pickRef`, conv-1080), mais
   * pour N'IMPORTE QUEL fil, affiché ou non. `filsAvecLotsRef` relâche la file d'un fil quitté, et
   * la marque `lot` la retient après une coupure par la limite d'abonnement (`lots-retenus-quota.ts`).
   */
  function envoyerALaSuite(id: string, textes: readonly string[]): void {
    const mettreEnFile = (texte: string): void => {
      setDirectiveReceipt(
        id,
        { id: nextQueueEntryIdRef.current++, text: texte },
        'attente',
        undefined,
        { attenteMotif: 'lot' }
      )
      enqueueMessage(id, texte, undefined, undefined, { lot: true })
      filsAvecLotsRef.current.add(id)
    }
    const [premier, ...suite] = textes
    if (premier === undefined) return
    if (busyConversationsRef.current.has(id)) {
      for (const texte of textes) mettreEnFile(texte)
      return
    }
    // `keepComposerDraft` : le clic sur la carte n'est pas un envoi depuis la saisie. Sans lui,
    // « Tout ici » (fil visé = fil affiché) emportait les pièces jointes en attente de l'utilisateur
    // et vidait le texte qu'il tapait (défaut 1 du juge, conv-1147).
    void send(premier, { targetConversationId: id, keepComposerDraft: true })
    for (const texte of suite) mettreEnFile(texte)
  }
  const { queueCurrentMessage, tourEncoreVivant, rendreLaFileAuComposer, stopPilotTurn, submitBtw, handleBtw, filsAvecLotsRef, basculerModeAuto, basculerModeAutoPour, handleFork, handleModifier, handleRevenir, sendRef, pickSuggestion, annulerEnvoi, planSelection, doitAutoLancerCandidats, answerAsk, submitBtwRef, refineResumeDraft, ouvrirLogin, send } = useToursEtEnvoi({
    activeId,
    activeRef,
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
    consommerDossierNouveauFil,
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
  const { convsCoupeesParQuota, situationsDeLaReprise, repriseQuotaEnCours, repriseQuotaProgres, repriseQuotaNotice, repriseQuotaMasqueePour, setRepriseQuotaMasqueePour, cleRepriseQuota, reprendreConversationsCoupeesParQuota, resumePilotTurn, viewRun, relireRunOuvert } = useRepriseDesTours({
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
  const {
    active, resumeAvailable, composersMosaiqueRef, rendrePiecesJointesEnAttente, faconsDuFilActif,
    faconsDeLaMosaique, signatureDesFacons, fenetresMosaique, ouvrirFilMosaiqueStable,
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
  const {
    marquerInactive, marquerPrive, surligner, appliquerRangement, dossierPersonnel,
    estDossierPersonnel, dossiersConversations, categoriesConnues, saisieCategorie,
    setSaisieCategorie, liensDeLots, relirePlansRef, planDuFilOuvert, ongletDuFilOuvert,
    filsDesBureaux, questionsDesLots, openRunsCount, visibleLiveRuns,
    messagesUtilisateurAvantDebut, filRendu, lignesListe, avisApp
  } = useListeDesConversations({
    active, activeDirectiveReceiptsByMessage, activeId, annulerEnvoi, answerAsk, appNotice,
    basculerDansMosaique, basculerGroupe, busy, busyConversations, conversationDateOrder,
    conversationHits, conversationsVues, convQuery, convs, convSelectionMode, convStatusFilter,
    convViewMode, correspondancesContenu, doitAutoLancerCandidats, dossierParDefaut,
    dossiersMemorises, groupesReplies, handleFork, handleModifier, handleRevenir, isActive, langue,
    liveRuns, loadConv, memoriserDossier, messages, mosaicIds, onInspectTurn, ouvrirLogin,
    pickSuggestion, planSelection, rangerDans, refineResumeDraft, refreshConvs, revealLiveAction,
    runs, selectedConvIds, setAppNotice, setConvMenu, setConvSelectionMode, setDossierNouveauFil,
    setDossiersMemorises, setOpenImage, setPanneauOutil, setSelectedConvIds, setSurvole, showRuns,
    surviole, toggleConvSelection
  })

  return (
    <div
      className={`chat-layout${showRuns ? '' : ' is-runs-collapsed'}${
        convViewMode === 'mosaic' ? ' is-mosaic' : ''
      }${listeTelOuverte ? ' is-liste-tel' : ''}`}
      data-testid="chat-view"
      data-active-conversation-id={activeId ?? ''}
    >
      {/* HARNAIS DE PROFILAGE (heal gels vue chat, 2026-09-18) : `vue-chat` seul ne disait pas QUELLE
          zone tenait le fil d'affichage (1,3 a 2,8 s sur conv-680). Chaque zone signale son propre
          rendu long sous `vue-chat-<zone>`, par le canal existant de `gels.jsonl`. */}
      {/* ---- Panneau gauche : conversations ---- */}
      <VueMesuree id="chat-liste">
        <aside
          className="lisere-dessus conv-pane"
          // Le titre visible est parti (2026-10-15) : le panneau garde son NOM pour les lecteurs d'ecran.
          // « Conversations » s'écrit pareil en anglais.
          aria-label="Conversations"
          data-view-mode={convViewMode}
          data-density={convDensity}
          // Une RECHERCHE en cours re-montre la ligne d'identifiant meme en cran serre : taper « 171 »
          // doit continuer de prouver qu'on a trouve la bonne conversation (lecon du 2026-09-03).
          data-recherche={convQuery.trim() ? 'oui' : undefined}
          style={{ width: `${conversationsPaneWidth}px` }}
        >
          {/* Le tiroir téléphone porte SON bouton de fermeture (conv-1568) : posé sous l'en-tête à une
              hauteur devinée, il recouvrait le ☰ de l'en-tête sur le vrai écran de l'utilisateur. */}
          <button
            type="button"
            className="chat-liste-tel-btn conv-pane-fermer-tel"
            aria-label="Fermer la liste des conversations"
            onClick={() => setListeTelOuverte(false)}
          >
            ✕
          </button>
          {/* SANS TITRE (demande du 2026-10-15) : « Conversations » prenait une ligne pour ne rien
            dire. La ligne d'en-tete n'existe plus que pour « Tout fermer », en mosaique. */}
          {convViewMode === 'mosaic' && mosaicIds.length > 0 && (
            <div className="conv-head">
              <button
                type="button"
                className="conv-mosaic-close-all"
                data-testid="conv-mosaic-close-all"
                title={texteFil('mosaique.fermerTout.titre')}
                aria-label={texteFil('mosaique.fermerTout.titre')}
                onClick={fermerToutesFenetresMosaique}
              >
                {texteFil('mosaique.fermerTout')}
              </button>
            </div>
          )}
          {/* RECHERCHE EN TETE, « Nouveau fil » juste dessous (2026-10-15 : « inverse la position de
            recherche et nouveau fil »). Les deux restent HORS de la liste qui defile : le bouton
            etait sinon emporte par le defilement.
            fix-ok: cause mesuree — le bouton etait le 1er enfant de `.conv-list` (le conteneur
            scroll-y) ; ChatView.tete-panneau.test.tsx rouge sur l'ancien code
            (« expected true to be false »), vert ici. */}
          <div className="conv-search">
            <span aria-hidden="true">⌕</span>
            <input
              value={convQuery}
              onChange={(event) => setConvQuery(event.target.value)}
              placeholder={texteFil('liste.recherche')}
              aria-label={texteFil('liste.recherche.aria')}
            />
            {convQuery && (
              <button onClick={() => setConvQuery('')} title={texteFil('liste.recherche.effacer')}>
                ×
              </button>
            )}
          </div>
          <button
            className={`conv-new-row${convViewMode !== 'mosaic' && activeId === null ? ' active' : ''}`}
            onClick={() => {
              // En mosaique, « Nouveau » doit OUVRIR UNE FENETRE de plus : vider le fil unique,
              // masque derriere la grille, ne produisait aucun effet visible.
              if (convViewMode === 'mosaic') void nouvelleFenetreMosaique()
              else newConv()
            }}
            title={texteFil('liste.nouveau.titre')}
            aria-current={activeId === null ? 'page' : undefined}
          >
            <span className="conv-new-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
            <span className="conv-new-title">{texteFil('liste.nouveau')}</span>
          </button>
          {/*
          La barre n'existe QUE pendant une sélection en cours : hors de ce moment elle n'offrait
          qu'un bouton « Sélectionner » vu toute la journée pour un geste rare. L'entrée est
          désormais dans le menu contextuel d'une conversation, au-dessus de « Supprimer ».
        */}
          {convSelectionMode && convViewMode !== 'mosaic' && (
            <div className="conv-bulk-bar">
              <button
                type="button"
                className="conv-date-sort"
                onClick={() => quitterModeSelection()}
              >
                {texteFil('selection.annuler')}
              </button>
              {(() => {
                // Si TOUT le lot est déjà inactif, le geste utile est l'inverse.
                const lot = convs.filter((c) => selectedConvIds.has(c.id))
                const toutInactif = lot.length > 0 && lot.every((c) => c.inactive)
                return (
                  <button
                    type="button"
                    className="conv-date-sort"
                    data-testid="conv-bulk-inactive"
                    disabled={selectedConvIds.size === 0}
                    onClick={() => {
                      const ids = [...selectedConvIds]
                      quitterModeSelection()
                      void (async () => {
                        for (const id of ids) await marquerInactive(id, !toutInactif)
                      })()
                    }}
                  >
                    {toutInactif ? texteFil('liste.desarchiver') : texteFil('liste.archiver')}
                  </button>
                )
              })()}
              <button
                type="button"
                className="conv-date-sort"
                data-testid="conv-bulk-category"
                disabled={selectedConvIds.size === 0}
                onClick={(event) => {
                  const r = event.currentTarget.getBoundingClientRect()
                  setSaisieCategorie(null)
                  setConvFolderMenu({
                    conv: null,
                    ids: [...selectedConvIds],
                    top: r.bottom + 4,
                    left: r.left,
                    mode: 'categorie'
                  })
                }}
              >
                {texteFil('liste.rangerCategorie')}
              </button>
              <button
                type="button"
                className="conv-date-sort conv-bulk-del"
                disabled={selectedConvIds.size === 0}
                onClick={() => setBulkDeleteAsking(true)}
              >
                {texteFil('selection.supprimer', { n: selectedConvIds.size })}
              </button>
            </div>
          )}
          {/* MASQUE quand rien n'est coupe : un bouton « 0 » vu toute la journee devient du decor.
            MAIS reste VISIBLE tant qu'une reprise tourne : les fils repris sortent de la liste des
            coupes des qu'ils passent occupes, si bien que le bloc disparaissait au premier clic et
            emportait la progression avec lui — « ca n'en a repris qu'une sur 3 » (2026-09-05),
            alors que les deux autres attendaient leur tour, invisibles. */}
          {(convsCoupeesParQuota.length > 0 || repriseQuotaEnCours || repriseQuotaNotice) &&
            (repriseQuotaEnCours || repriseQuotaMasqueePour !== cleRepriseQuota) && (
              <div className="conv-reprise-quota" data-testid="conv-reprise-quota">
                {!repriseQuotaEnCours ? (
                  <button
                    type="button"
                    className="conv-reprise-quota-fermer"
                    data-testid="conv-reprise-quota-fermer"
                    aria-label={texteFil('quota.masquer')}
                    title={texteFil('quota.masquer.titre')}
                    onClick={() => setRepriseQuotaMasqueePour(cleRepriseQuota)}
                  >
                    ×
                  </button>
                ) : null}
                {/* Le BOUTON lui-meme ne s'affiche que s'il a quelque chose a reprendre : apres une
                reprise, la notice reste seule quelques secondes, sans un « (0) » qui n'offre
                rien a cliquer. */}
                {convsCoupeesParQuota.length > 0 || repriseQuotaEnCours ? (
                  <button
                    type="button"
                    className="conv-date-sort"
                    data-testid="conv-reprise-quota-bouton"
                    disabled={repriseQuotaEnCours}
                    onClick={() => void reprendreConversationsCoupeesParQuota()}
                    title={texteFil('quota.reprendre.titre')}
                  >
                    {repriseQuotaEnCours ? (
                      <>
                        <Spinner size={12} label={texteFil('quota.repriseEnCours.aria')} />
                        {repriseQuotaProgres ?? texteFil('quota.repriseEnCours')}
                      </>
                    ) : (
                      texteFil('quota.reprendre', { n: convsCoupeesParQuota.length })
                    )}
                  </button>
                ) : null}
                {situationsDeLaReprise.map((situation) => (
                  <span
                    key={`${situation.etat}:${situation.etat === 'manuelle' ? situation.raison : ''}`}
                    className="conv-auto-notice"
                    data-testid="conv-reprise-quota-etat"
                  >
                    {texteDeLaSituation(situation)}
                  </span>
                ))}
                {repriseQuotaNotice ? (
                  <span className="conv-auto-notice" data-testid="conv-reprise-quota-notice">
                    {repriseQuotaNotice}
                  </span>
                ) : null}
              </div>
            )}
          <div className="conv-list scroll-y">
            {convs.length === 0 && (
              <div className="c-faint" style={{ fontSize: 12, padding: 'var(--s2)' }}>
                {texteFil('liste.vide')}
              </div>
            )}
            {convs.length > 0 && conversationHits.length === 0 && (
              <div className="conv-search-empty">{texteFil('liste.aucunResultat')}</div>
            )}
            {lignesListe}
          </div>
          {/* PIED DE LISTE (demande du 2026-09-23) : filtre de statut, densite et mosaique
            vivent ici, plus dans l'en-tete. */}
          <div className="conv-foot" data-testid="conv-foot">
            <button
              type="button"
              className="conv-status-filter"
              data-testid="conv-status-filter"
              data-filter={convStatusFilter}
              title={texteFil('liste.filtre.titre', {
                statut: texteFil(LIBELLE_FILTRE_STATUT[convStatusFilter])
              })}
              aria-label={texteFil('liste.filtre.aria', {
                statut: texteFil(LIBELLE_FILTRE_STATUT[convStatusFilter])
              })}
              onClick={() =>
                setConvStatusFilter((f) =>
                  f === 'toutes' ? 'actives' : f === 'actives' ? 'inactives' : 'toutes'
                )
              }
            >
              {/* Icone et libelles du pied : MASQUES par defaut (ChatView.css), montres par le
                theme qui les dessine (Nebuleuse de verre, capsule D2-6 choisie en conv-171). */}
              {convStatusFilter === 'toutes' && (
                <svg className="conv-foot-icone" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M4 5h16l-6 7v6l-4 2v-8z" />
                </svg>
              )}
              {convStatusFilter === 'toutes'
                ? texteFil('liste.filtre.toutes')
                : convStatusFilter === 'actives'
                  ? texteFil('liste.filtre.activesPied')
                  : texteFil('liste.filtre.archiveesPied')}
            </button>
            <span className="conv-foot-spacer" />
        <button
          type="button"
          className="conv-density-toggle"
          data-testid="conv-density-toggle"
          data-density={convDensity}
          title={texteFil('densite.titre', {
            densite: libelleDensite(convDensity),
            suivante: libelleDensite(densiteSuivante(convDensity))
          })}
          aria-label={texteFil('densite.aria', { densite: libelleDensite(convDensity) })}
          onClick={() => setConvDensity(densiteSuivante(convDensity))}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            {traitsDensite(convDensity).map((y) => (
              <rect key={y} x="2" y={y} width="12" height="1.5" rx="0.75" />
            ))}
          </svg>
          <span className="conv-foot-libelle">{libelleDensite(convDensity)}</span>
        </button>
        <button
          type="button"
          className="conv-view-toggle"
          data-testid="conv-view-toggle"
          role="switch"
          aria-checked={convViewMode === 'mosaic'}
          aria-label={texteFil('vue.mosaique.aria')}
          title={convViewMode === 'mosaic' ? texteFil('vue.revenirListe') : texteFil('vue.passerMosaique')}
          onClick={() => {
            if (convViewMode === 'mosaic') {
              setConvViewMode('list')
              return
            }
            setConvViewMode('mosaic')
            // La mosaique s'ouvre SUR ce qu'on regardait. Sans cette reprise, la bascule
            // laissait la moitie droite VIDE alors qu'une conversation etait ouverte juste
            // avant le clic (demande du 2026-09-17). On ne sert QUE la mosaique vide : si
            // des fenetres sont deja ouvertes, l'utilisateur a deja choisi son plan de
            // travail, et « Tout fermer » doit rester une mosaique vide.
            if (mosaicIdsRef.current.length === 0 && activeId)
              void ouvrirDansMosaique(activeId)
          }}
        >
          <svg className="conv-foot-icone" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
            <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
            <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
            <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
          </svg>
          {/* « Chat » s'écrit pareil en anglais. */}
          <span className="conv-foot-libelle">{convViewMode === 'mosaic' ? texteFil('vue.mosaique') : 'Chat'}</span>
          <span className="conv-view-toggle-knob" aria-hidden="true" />
        </button>
          </div>
        </aside>
      </VueMesuree>
      {convMenu &&
        createPortal(
          <>
            <div className="conv-menu-backdrop" onClick={() => setConvMenu(null)} />
            <div
              ref={convMenuRef}
              className="conv-menu-pop"
              role="menu"
              style={{ top: convMenu.top, left: convMenu.left }}
            >
              <button
                role="menuitem"
                onClick={() => {
                  const conv = convMenu.conv
                  setConvMenu(null)
                  renameConv(conv)
                }}
              >
                <span className="conv-menu-ic" aria-hidden="true">
                  ✎
                </span>
                {texteFil('menu.renommer')}
              </button>
              {/*
                La MÊME action que le glisser-déposer, au clavier. Ce n'est pas un doublon de confort :
                une fonctionnalité qui n'existe qu'au glisser est inatteignable sans souris.
              */}
              <button
                role="menuitem"
                data-testid="conv-menu-set-project"
                onClick={() => {
                  const { conv, top, left } = convMenu
                  setConvMenu(null)
                  setConvFolderMenu({ conv, top, left, mode: 'categorie' })
                }}
              >
                <span className="conv-menu-ic" aria-hidden="true">
                  🗂
                </span>
                {texteFil('liste.rangerCategorie')}
              </button>
              {/*
                L'entree « Choisir le repertoire de travail… » a ete RETIREE de ce menu sur demande
                (conv-674, 2026-09-17). Le choix du depot de travail reste entier : il se fait par la
                pastille 📁 de la barre du haut (data-testid="chat-project-dot"), qui ouvre le meme
                selecteur en mode 'dossier', et par le glisser-deposer.
              */}
              {/*
                La categorie compte autant que le dossier : sans elle dans ce test, un fil range
                sous un libelle n'avait plus AUCUN moyen d'en sortir depuis le menu (conv-81).
              */}
              {(convMenu.conv.projectPath || convMenu.conv.categorie) && (
                <button
                  role="menuitem"
                  data-testid="conv-menu-clear-project"
                  onClick={() => {
                    const conv = convMenu.conv
                    setConvMenu(null)
                    void rangerDans(conv.id, null)
                  }}
                >
                  <span className="conv-menu-ic" aria-hidden="true">
                    ↩
                  </span>
                  {texteFil('menu.sortirDossier')}
                </button>
              )}
              {/*
                Le repère visuel : la MEME entree pose et retire, comme une bascule. Deux entrees
                distinctes auraient allonge le menu pour un etat qui n'en a que deux.
              */}
              <button
                role="menuitem"
                data-testid="conv-menu-highlight"
                onClick={() => {
                  const conv = convMenu.conv
                  setConvMenu(null)
                  void surligner(conv.id, !conv.surlignee)
                }}
              >
                <span className="conv-menu-ic" aria-hidden="true">
                  ★
                </span>
                {convMenu.conv.surlignee
                  ? texteFil('menu.retirerSurlignage')
                  : texteFil('menu.surligner')}
              </button>
              <button
                role="menuitem"
                data-testid="conv-menu-inactive"
                onClick={() => {
                  const conv = convMenu.conv
                  setConvMenu(null)
                  void marquerInactive(conv.id, conv.inactive !== true)
                }}
              >
                <span className="conv-menu-ic" aria-hidden="true">
                  {convMenu.conv.inactive ? '●' : '○'}
                </span>
                {convMenu.conv.inactive
                  ? texteFil('liste.desarchiver')
                  : texteFil('liste.archiver')}
              </button>
              {/* Fil privé du village commun (D6, conv-1429) : une bascule, comme le surlignage. */}
              <button
                role="menuitem"
                data-testid="conv-menu-prive"
                title={texteFil('menu.prive.titre')}
                onClick={() => {
                  const conv = convMenu.conv
                  setConvMenu(null)
                  void marquerPrive(conv.id, conv.prive !== true)
                }}
              >
                <span className="conv-menu-ic" aria-hidden="true">
                  {convMenu.conv.prive ? '◉' : '◌'}
                </span>
                {convMenu.conv.prive
                  ? texteFil('menu.retirerPrive')
                  : texteFil('menu.marquerPrive')}
              </button>
              {/*
                Le mode selection entre PAR ICI : garder un bouton permanent en haut du panneau
                coutait un item d'interface visible toute la journee pour un geste rare.
              */}
              {convViewMode !== 'mosaic' && (
                <button
                  role="menuitem"
                  data-testid="conv-menu-select-mode"
                  onClick={() => {
                    const conv = convMenu.conv
                    setConvMenu(null)
                    setConvSelectionMode(true)
                    setSelectedConvIds(new Set([conv.id]))
                  }}
                >
                  <span className="conv-menu-ic" aria-hidden="true">
                    ☑
                  </span>
                  {texteFil('menu.selectionner')}
                </button>
              )}
              <button
                role="menuitem"
                className="c-err"
                onClick={() => {
                  const conv = convMenu.conv
                  setConvMenu(null)
                  removeConv(conv)
                }}
              >
                <span className="conv-menu-ic" aria-hidden="true">
                  🗑
                </span>
                {texteFil('menu.supprimer')}
              </button>
            </div>
          </>,
          document.body
        )}
      {brancheMenu &&
        createPortal(
          <>
            <div className="conv-menu-backdrop" onClick={() => setBrancheMenu(null)} />
            <div
              ref={brancheMenuRef}
              className="conv-menu-pop"
              role="menu"
              aria-label={texteFil('branches.aria')}
              style={{ top: brancheMenu.top, left: brancheMenu.left }}
            >
              {brancheMenu.branches === null ? (
                <span
                  className="conv-menu-empty"
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <Spinner size={12} label={texteFil('branches.lecture.aria')} />
                  {texteFil('branches.lecture')}
                </span>
              ) : brancheMenu.branches.length === 0 ? (
                <span className="conv-menu-empty">{texteFil('branches.aucune')}</span>
              ) : (
                brancheMenu.branches.map((nom) => (
                  <button
                    key={nom}
                    role="menuitem"
                    data-testid="chat-branch-choice"
                    data-branch={nom}
                    onClick={() => {
                      /*
                        BASCULE REELLE, et bornee : l'application refuse si l'arbre de travail porte
                        des modifications non enregistrees. On NE ferme PAS le menu tout de suite --
                        un refus doit rester visible la ou l'utilisateur vient de cliquer, sinon la
                        branche « ne change pas » sans que rien ne l'explique.
                      */
                      setBrancheMenu((m) => (m ? { ...m, refus: undefined } : m))
                      void window.api
                        .checkoutGitBranch?.(nom, gitCwd)
                        .then((r) => {
                          if (r?.ok) {
                            setBrancheMenu(null)
                            // Relecture IMMEDIATE du badge : sans elle, il garde l'ancien nom
                            // jusqu'au prochain battement (5 s) et la bascule parait sans effet.
                            window.dispatchEvent(new Event('focus'))
                          } else
                            setBrancheMenu((m) =>
                              m ? { ...m, refus: r?.reason ?? texteFil('branches.refusee') } : m
                            )
                        })
                        .catch((e: unknown) =>
                          setBrancheMenu((m) => (m ? { ...m, refus: String(e) } : m))
                        )
                    }}
                  >
                    <span className="conv-menu-ic" aria-hidden="true">
                      ⑂
                    </span>
                    {nom}
                    {nom === gitBranch ? texteFil('branches.courante') : ''}
                  </button>
                ))
              )}
              {brancheMenu.refus && (
                <span className="conv-menu-empty" role="alert" data-testid="chat-branch-refus">
                  {brancheMenu.refus}
                </span>
              )}
            </div>
          </>,
          document.body
        )}
      {convFolderMenu &&
        createPortal(
          <>
            <div
              className="conv-menu-backdrop"
              onClick={() => {
                setConvFolderMenu(null)
              }}
            />
            <div
              ref={convFolderMenuRef}
              className="conv-menu-pop"
              role="menu"
              aria-label={
                convFolderMenu.mode === 'categorie'
                  ? texteFil('dossiers.categories.aria')
                  : texteFil('dossiers.repertoires.aria')
              }
              style={{ top: convFolderMenu.top, left: convFolderMenu.left }}
            >
              {/*
                Le dossier de REPLI est ce que la pastille affiche quand aucun dossier n'est
                assigne. Il n'entrait jamais dans la memoire des dossiers connus : l'utilisateur
                lisait donc « ContosoApp » sur l'en-tete sans le trouver dans ce menu
                (conv-79, 2026-09-16). On l'expose en tete, marque « par defaut », et il devient
                choisissable comme les autres.
              */}
              {/* « This computer » est TOUJOURS là (conv-1231), même si une ancienne croix du Board
                  l'a mémorisé comme retiré : il ne se retire pas. */}
              {convFolderMenu.mode === 'dossier' && dossierPersonnel && (
                <button
                  role="menuitem"
                  data-testid="conv-project-this-computer"
                  data-project-path={dossierPersonnel}
                  title={texteFil('dossiers.cetOrdinateur.titre', { chemin: dossierPersonnel })}
                  onClick={() => {
                    const menu = convFolderMenu
                    setConvFolderMenu(null)
                    appliquerRangement(menu, dossierPersonnel)
                  }}
                >
                  <span className="conv-menu-ic" aria-hidden="true">
                    💻
                  </span>
                  This computer
                </button>
              )}
              {convFolderMenu.mode === 'dossier' &&
                defaultWorkspace?.trim() &&
                !estDossierPersonnel(defaultWorkspace) &&
                !estRetire(defaultWorkspace) &&
                !dossiersConversations.includes(defaultWorkspace.trim()) && (
                  <button
                    role="menuitem"
                    data-testid="conv-project-default"
                    data-project-path={defaultWorkspace.trim()}
                    title={defaultWorkspace.trim()}
                    onClick={() => {
                      const menu = convFolderMenu
                      const repli = defaultWorkspace.trim()
                      setConvFolderMenu(null)
                      appliquerRangement(menu, repli)
                    }}
                  >
                    <span className="conv-menu-ic" aria-hidden="true">
                      🗂
                    </span>
                    {texteFil('dossiers.parDefaut', { nom: nomDeDossier(defaultWorkspace.trim()) })}
                  </button>
                )}
              {convFolderMenu.mode !== 'dossier' ? null : dossiersConversations.length === 0 &&
                !defaultWorkspace?.trim() &&
                !dossierPersonnel ? (
                <span className="conv-menu-empty">{texteFil('dossiers.aucun')}</span>
              ) : (
                // Le dossier personnel est déjà proposé sous son nom, « This computer ».
                dossiersConversations
                  .filter((chemin) => !estDossierPersonnel(chemin))
                  .map((chemin) => (
                    <div className="conv-menu-ligne" key={chemin}>
                      <button
                        role="menuitem"
                        data-testid="conv-project-choice"
                        data-project-path={chemin}
                        onClick={() => {
                          const menu = convFolderMenu
                          setConvFolderMenu(null)
                          appliquerRangement(menu, chemin)
                        }}
                      >
                        <span className="conv-menu-ic" aria-hidden="true">
                          🗂
                        </span>
                        {chemin}
                      </button>
                      <button
                        className="conv-menu-oubli"
                        data-testid="conv-project-forget"
                        data-project-path={chemin}
                        aria-label={texteFil('dossiers.retirerNom', { chemin })}
                        title={texteFil('dossiers.retirer')}
                        onClick={(event) => {
                          // Le clic ne doit PAS ranger la conversation dans le dossier qu'on retire.
                          event.stopPropagation()
                          oublierDossier(chemin)
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))
              )}
              {convFolderMenu.mode === 'dossier' && (
                <button
                  role="menuitem"
                  data-testid="conv-project-pick"
                  onClick={() => {
                    const menu = convFolderMenu
                    setConvFolderMenu(null)
                    void window.api.pickGitRepo?.().then((chemin) => {
                      if (chemin) appliquerRangement(menu, chemin)
                    })
                  }}
                >
                  <span className="conv-menu-ic" aria-hidden="true">
                    📁
                  </span>
                  {texteFil('dossiers.parcourir')}
                </button>
              )}
              {/*
                CATEGORIES — l'autre moitie du geste « ranger ». Depuis que le dossier de travail
                et le libelle de classement sont deux champs distincts (conv-81), ce menu ne
                proposait plus que des chemins : « Fiches Team » etait devenu inatteignable a la
                souris alors que des fils y vivaient toujours (conv-79). Le tri entre les deux se
                fait plus bas, sur la FORME de la valeur — un libelle n'ecrase jamais le dossier.
              */}
              {/*
                Les DOSSIERS sont aussi des categories dans la barre laterale (AUTOWINOS,
                CONTOSOV3DESKTOP…). Sans eux ici, le menu ouvert depuis la selection multiple etait
                vide des qu'aucun libelle libre n'existait (conv-815, 2026-09-23).
              */}
              {convFolderMenu.mode === 'categorie' &&
                (categoriesConnues.length > 0 || dossiersConversations.length > 0) && (
                  <span className="conv-menu-titre">{texteFil('dossiers.categories')}</span>
                )}
              {(convFolderMenu.mode === 'categorie' ? dossiersConversations : []).map((chemin) => (
                <button
                  key={`dossier:${chemin}`}
                  role="menuitem"
                  data-testid="conv-category-folder-choice"
                  data-project-path={chemin}
                  title={chemin}
                  onClick={() => {
                    const menu = convFolderMenu
                    setConvFolderMenu(null)
                    setSaisieCategorie(null)
                    appliquerRangement(menu, chemin)
                  }}
                >
                  <span className="conv-menu-ic" aria-hidden="true">
                    🗂
                  </span>
                  {nomDeDossier(chemin)}
                </button>
              ))}
              {(convFolderMenu.mode === 'categorie' ? categoriesConnues : []).map((libelle) => (
                <button
                  key={libelle}
                  role="menuitem"
                  data-testid="conv-category-choice"
                  data-category={libelle}
                  onClick={() => {
                    const menu = convFolderMenu
                    setConvFolderMenu(null)
                    setSaisieCategorie(null)
                    appliquerRangement(menu, libelle)
                  }}
                >
                  <span className="conv-menu-ic" aria-hidden="true">
                    🏷
                  </span>
                  {libelle}
                </button>
              ))}
              {convFolderMenu.mode !== 'categorie' ? null : saisieCategorie === null ? (
                <button
                  role="menuitem"
                  data-testid="conv-category-new"
                  onClick={() => setSaisieCategorie('')}
                >
                  <span className="conv-menu-ic" aria-hidden="true">
                    ＋
                  </span>
                  {texteFil('dossiers.nouvelleCategorie')}
                </button>
              ) : (
                <input
                  className="conv-menu-saisie"
                  data-testid="conv-category-input"
                  aria-label={texteFil('dossiers.nomNouvelleCategorie')}
                  placeholder={texteFil('dossiers.nomCategorie')}
                  autoFocus
                  value={saisieCategorie}
                  onChange={(event) => setSaisieCategorie(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      setSaisieCategorie(null)
                      return
                    }
                    if (event.key !== 'Enter') return
                    const libelle = saisieCategorie.trim()
                    if (!libelle) return
                    const menu = convFolderMenu
                    setSaisieCategorie(null)
                    setConvFolderMenu(null)
                    appliquerRangement(menu, libelle)
                  }}
                />
              )}
            </div>
          </>,
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
          entete={
            faconsDeLaMosaique.length > 0 ? (
              <ComparaisonDesFacons
                facons={faconsDeLaMosaique}
                signature={signatureDesFacons(faconsDeLaMosaique)}
              />
            ) : undefined
          }
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
        <section
          className={`lisere-dessus chat${dragActive ? ' is-file-dragging' : ''}`}
          onDragEnter={(event) => {
            if (Array.from(event.dataTransfer.types).includes('Files')) {
              event.preventDefault()
              setDragActive(true)
            }
          }}
          onDragOver={(event) => {
            if (Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault()
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
            setDragActive(false)
          }}
          onDrop={(event) => {
            event.preventDefault()
            setDragActive(false)
            void addFiles(event.dataTransfer.files)
          }}
          onClick={surClicLienDuFil}
        >
          {dragActive && (
            <div className="file-drop-overlay" aria-hidden="true">
              <strong>{texteFil('depot.titre')}</strong>
              <span>{texteFil('depot.detail')}</span>
            </div>
          )}
          {rechercheFilOuverte && (
            <ChatFindBar
              racine={() => scrollRef.current}
              onFermer={() => setRechercheFilOuverte(false)}
            />
          )}
          <header className="chat-head row">
            <div className="row gap2 chat-head-titre" style={{ alignItems: 'center', minWidth: 0 }}>
              <button
                type="button"
                className="chat-liste-tel-btn"
                aria-label="Conversations"
                aria-expanded={listeTelOuverte}
                onClick={() => setListeTelOuverte((o) => !o)}
              >
                ☰
              </button>
              <div className="col" style={{ gap: 1, minWidth: 0 }}>
                <span className="chat-head-kicker">
                  {active ? active.title : texteFil('entete.nouvelle')}
                </span>
                <div className="chat-runtime" data-testid="chat-runtime-identity">
                  {/* La perle d'etat remplace l'ancienne boule de 26 px (conv-158) : meme case,
                      meme perle, meme spinner que la liste des fils. */}
                  <PastilleEnTete
                    occupe={busy}
                    messageCount={active ? (active.messageCount ?? active.messages?.length ?? 0) : 0}
                    lastMessageRole={
                      active
                        ? (active.lastMessageRole ??
                          [...(active.messages ?? [])].reverse().find((m) => m.orientation !== true)
                            ?.role)
                        : undefined
                    }
                    lastAssistantStatus={active?.lastAssistantStatus}
                    asksUser={active?.lastAssistantAsksUser === true}
                    tourEnCours={active?.hasStreamingTurn === true}
                  />
                  <span
                    className={`chat-runtime-provider is-${bindingEffectif?.provider ?? 'loading'}`}
                  >
                    {bindingEffectif?.provider ?? texteFil('entete.connexion')}
                  </span>
                  {/*
                    LE MODÈLE DU FIL, EN LISTE DÉROULANTE (conv-239, 2026-10-11). Il était affiché
                    ici en simple texte ET choisi dans la barre de saisie : deux fois la même
                    information. Le choix vit désormais ici seul, et il ne vaut QUE pour cette
                    conversation (`changerModeleDuFil`). Menu ouvert VERS LE BAS : vers le haut,
                    il sortirait de la fenêtre.
                  */}
                  <OrchestratorModelSelector
                    busy={busy}
                    catalogLoaded={modelCatalogLoaded}
                    models={modelCatalog}
                    binding={bindingEffectif}
                    pending={modelChangePending}
                    error={modelChangeError}
                    onSelect={(option) => void changerModeleDuFil(option)}
                    comptes={comptesDeConversation}
                    ouverture="bas"
                    defaut={{
                      label: runtimeIdentity?.modelLabel
                        ? shortModelLabel(runtimeIdentity.modelLabel, runtimeIdentity.provider)
                        : texteFil('entete.modeleApplication'),
                      actif: modeleDuFil === null,
                      onChoisir: () => void changerModeleDuFil(null)
                    }}
                  />
                  {/*
                  L'IDENTIFIANT de la conversation, a la place de « interface prete ».

                  Ce libelle ne disait rien : une interface affichee est prete, sinon on ne la
                  lirait pas. Pendant ce temps l'agent cite des conversations par leur id
                  (« conv-12 ») sans que rien a l'ecran ne permette de savoir laquelle on regarde.
                  La place etait donc occupee par du bruit alors qu'il manquait la seule
                  information qui relie ce que l'agent dit a ce que l'utilisateur voit.

                  L'etat occupe reste porte par la classe `is-busy`. La mention « · en cours »
                  qui suivait l'id a ete retiree (2026-10-11, « ca prend de la place pour rien ») :
                  le fil en cours se voit deja dans la conversation elle-meme.
                */}
                  <span
                    className={`chat-runtime-state${busy ? ' is-busy' : ''}`}
                    data-testid="chat-runtime-conv"
                    title={
                      activeId
                        ? texteFil('entete.identifiant', { id: activeId })
                        : texteFil('entete.aucuneOuverte')
                    }
                  >
                    {activeId ?? texteFil('entete.aucune')}
                  </span>
                  {(() => {
                    /*
                      SANS conversation ouverte, la pastille parle du PROCHAIN fil. Elle etait
                      `disabled` dans ce cas : le dossier de travail ne pouvait se choisir qu'apres
                      le premier tour, donc ce premier tour partait toujours dans le depot de repli
                      (« je dois pouvoir choisir mon CWD dans un nouveau fil », 2026-09-09).
                    */
                    // Meme source que le badge de branche (`gitCwd`), sinon les deux divergent.
                    const dossierProjet = dossierProjetAffiche
                    const cheminEffectif = dossierProjet || defaultWorkspace
                    const surCetOrdinateur = estDossierPersonnel(cheminEffectif)
                    const labelDossier = surCetOrdinateur
                      ? 'This computer'
                      : cheminEffectif
                        ? nomDeDossier(cheminEffectif)
                        : 'Autowin OS'
                    // Même icône que sa ligne du menu (💻), pas le 📁 d'un projet (conv-1231).
                    const iconeDossier = surCetOrdinateur ? '💻' : '📁'
                    const titreDossier = dossierProjet
                      ? active
                        ? texteFil('entete.dossierAssigne', { chemin: dossierProjet })
                        : texteFil('entete.dossierProchainFil', { chemin: dossierProjet })
                      : texteFil('entete.dossierRacine', {
                          chemin: cheminEffectif ?? texteFil('entete.racineDepot')
                        })
                    return (
                      <button
                        type="button"
                        className="chat-cost-dot chat-project-dot"
                        title={texteFil('entete.dossier.titre', { titre: titreDossier })}
                        aria-label={titreDossier}
                        data-testid="chat-project-dot"
                        onClick={(event) => {
                          const r = event.currentTarget.getBoundingClientRect()
                          setConvFolderMenu({
                            conv: active ?? null,
                            top: r.bottom + 4,
                            left: r.left,
                            // La pastille de la barre du haut PARLE du repertoire de travail : elle
                            // n'ouvre donc que celui-la, jamais le classement.
                            mode: 'dossier'
                          })
                        }}
                      >
                        {iconeDossier} {labelDossier}
                      </button>
                    )
                  })()}
                  {gitBranch && (
                    <button
                      type="button"
                      className="chat-git-branch-btn"
                      data-testid="chat-git-branch"
                      title={texteFil('entete.branche.titre', { branche: gitBranch })}
                      onClick={(event) => {
                        const r = event.currentTarget.getBoundingClientRect()
                        setBrancheMenu({ top: r.bottom + 4, left: r.left, branches: null })
                        void window.api
                          .getGitBranches?.(gitCwd)
                          .then((liste) =>
                            setBrancheMenu((m) => (m ? { ...m, branches: liste ?? [] } : m))
                          )
                          .catch(() => setBrancheMenu((m) => (m ? { ...m, branches: [] } : m)))
                      }}
                    >
                      <ForkIcon /> {gitBranch}
                    </button>
                  )}
                  {/* La depense du fil vit dans la barre du haut, plus dans la zone de saisie. */}
                  <ConversationCostIndicator conversationId={activeId ?? undefined} busy={busy} />
                </div>
              </div>
            </div>
            <div className="row gap2 chat-head-actions">
              {/* NAVIGATEUR INTÉGRÉ (conv-1286, lot 3/5 ; Mini-adresse, conv-1317) : ouvre ou ferme le
                  panneau, comme Ctrl+Shift+B. */}
              <BoutonNavigateur
                conversationId={activeId}
                ouvert={navigateurOuvert}
                onBasculer={basculerNavigateur}
              />
              <BoutonBureauxCaches
                ouvert={bureauxOuverts}
                onBasculer={() =>
                  setPanneauOutil((ouvert) => (ouvert === 'bureaux' ? null : 'bureaux'))
                }
              />
              {/* DÉTAILS, LE MÊME BOUTON CREUX QUE LA MINI-ADRESSE (conv-1317, 2026-10-30 : « le bouton
                  détail met lui le meme look »). Il portait le balisage de ThinkingBlock (conv-178),
                  donc ses règles, ses reflets et le chanfrein de chaque thème : un vrai bouton de
                  la même classe que son voisin garde les deux identiques. */}
              <BoutonDetails
                ouvert={showRuns}
                libelle={texteFil('entete.details')}
                titre={texteFil('entete.details.titre')}
                runsOuverts={openRunsCount}
                onBasculer={() => setShowRuns((v) => !v)}
              />
            </div>
            {/* LA JAUGE DE CONTEXTE EST LE SEPARATEUR ENTRE L'EN-TETE ET LE FIL (conv-179) : posee sur
               le filet du bas de l'en-tete. Meme source que tout le reste : `jaugeCourante`. Au survol,
               le panneau de detail et son action Compacter. */}
            <ChatContextRule
              ratio={jaugeCourante?.ratio}
              level={jaugeCourante?.level}
              title={(() => {
                const j = jaugeCourante
                if (!j) return undefined
                return texteFil('contexte.jauge', {
                  utilises: formaterNombre(j.used),
                  limite: formaterNombre(j.limit),
                  pourcent: Math.round(j.ratio * 100),
                  cache: formaterNombre(j.cacheRead)
                })
              })()}
              panelNode={(() => {
                const j = jaugeCourante
                if (!j) return undefined
                const statique = activeId != null ? contextesStatiques[activeId] : undefined
                return (
                  <ContextGaugeDetail
                    gauge={j}
                    contexte={statique ? composerContexte(statique, j.used, j.limit) : undefined}
                    busy={busy}
                    onCompact={activeId != null ? () => void send(COMPACT_REQUEST) : undefined}
                  />
                )
              })()}
            />
          </header>

          {travailNonPublie && travailNonPublie !== messageNonPublieMasque && (
            <div
              className="chat-workflow-notice chat-travail-non-publie fade-in"
              data-testid="chat-travail-non-publie"
              role="status"
            >
              <span>{travailNonPublie}</span>
              <button
                type="button"
                data-testid="chat-travail-non-publie-traiter"
                onClick={() => void traiterTravauxNonPublies()}
                title={texteFil('nonPublie.traiter.titre')}
              >
                {texteFil('nonPublie.traiter')}
              </button>
              <button
                type="button"
                data-testid="chat-travail-non-publie-ouvrir"
                onClick={() => setListeNonPubliee((v) => !v)}
                title={texteFil('nonPublie.liste.titre')}
              >
                {texteFil('nonPublie.liste')}
              </button>
              <button
                type="button"
                data-testid="chat-travail-non-publie-fermer"
                className="chat-travail-non-publie__fermer"
                onClick={() => setMessageNonPublieMasque(travailNonPublie)}
                aria-label={texteFil('nonPublie.fermer')}
                title={texteFil('nonPublie.masquer')}
              >
                ×
              </button>
            </div>
          )}
          {listeNonPubliee && <TravauxNonPublies onFermer={() => setListeNonPubliee(false)} />}

          {avisApp}
          {activeId && arretsAuto[activeId] && (
            <div
              className="chat-workflow-notice fade-in"
              data-testid="chat-auto-arret"
              role="alert"
            >
              <span>
                {`« ${convs.find((c) => c.id === activeId)?.title || activeId} » — ${arretsAuto[activeId]}`}
              </span>
              {/* Seuil réglable : le bandeau ouvre Settings › Behaviour au lieu d'un chemin à recopier,
                  qui avait vieilli sans bruit (« Settings › Budget », section retirée le 23/10). Le
                  nom `behaviour` mène à cette section (shared/navigation.ts) (conv-1602). */}
              {arretReglableDansBehaviour(arretsAuto[activeId]) && (
                <button
                  type="button"
                  data-testid="chat-auto-arret-reglages"
                  className="chat-workflow-notice__action"
                  onClick={() => void window.api.appCommand?.('navigate', { tab: 'behaviour' })}
                  title={texteFil('auto.ouvrirSeuils.titre')}
                >
                  {texteFil('auto.ouvrirSeuils')}
                </button>
              )}
              <button
                type="button"
                onClick={() => effacerArretAuto(activeId)}
                aria-label={texteFil('auto.fermerArret')}
              >
                ×
              </button>
            </div>
          )}

          {activeId && autoActif && !quotaHebdoConnu && (
            <div
              className="chat-workflow-notice fade-in"
              data-testid="chat-auto-quota-inconnu"
              role="status"
            >
              <span>
                {texteFil('auto.quotaInconnu', {
                  tours: lireSeuilsChaine(window.localStorage.getItem(CLE_SEUILS_CHAINE_AUTO))
                    .toursAutoMax
                })}
              </span>
            </div>
          )}

          {/* Rendues dans `body`, comme la carte de suppression des fils (conv-1078) : dans le panneau
              du chat, la poignée de largeur de la liste (`.conv-pane-resizer`) passait au-dessus. */}
          {renameCandidate &&
            createPortal(
              <div
                className="delete-confirm-layer"
                role="presentation"
                onClick={() => setRenameCandidate(null)}
              >
                <form
                  className="delete-confirm-card"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="rename-conv-title"
                  data-testid="rename-conv-dialog"
                  onClick={(event) => event.stopPropagation()}
                  onSubmit={(event) => {
                    event.preventDefault()
                    void confirmRenameConv()
                  }}
                >
                  <span className="delete-confirm-kicker">{texteFil('renommer.surtitre')}</span>
                  <h2 id="rename-conv-title">{texteFil('renommer.titre')}</h2>
                  <input
                    className="rename-conv-input"
                    data-testid="rename-conv-input"
                    aria-label={texteFil('renommer.champ')}
                    value={renameCandidate.value}
                    autoFocus
                    onChange={(event) =>
                      setRenameCandidate((current) =>
                        current ? { ...current, value: event.target.value } : current
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setRenameCandidate(null)
                    }}
                  />
                  <div className="delete-confirm-actions">
                    <button
                      type="button"
                      className="btn delete-confirm-cancel"
                      onClick={() => setRenameCandidate(null)}
                    >
                      {texteFil('dialogue.annuler')}
                    </button>
                    <button type="submit" className="btn" data-testid="rename-conv-confirm">
                      {texteFil('menu.renommer')}
                    </button>
                  </div>
                </form>
              </div>,
              document.body
            )}

          {/* Une conversation ou un lot : la même carte, qui nomme les fils et leurs messages
              (conv-1078, « Implémenter la 2 · En-tête en ligne »). */}
          {deleteCandidate && (
            <SuppressionConversationsCarte
              fils={[deleteCandidate]}
              total={1}
              onGarder={() => setDeleteCandidate(null)}
              onSupprimer={() => void confirmRemoveConv()}
            />
          )}

          {bulkDeleteAsking && (
            <SuppressionConversationsCarte
              fils={convs.filter((c) => selectedConvIds.has(c.id))}
              total={selectedConvIds.size}
              erreur={bulkDeleteError}
              onGarder={() => setBulkDeleteAsking(false)}
              onSupprimer={() => void confirmBulkDelete()}
            />
          )}

          {deleteRunCandidate &&
            createPortal(
              <div
                className="delete-confirm-layer"
                role="presentation"
                onClick={() => {
                  if (!runDeletePending) setDeleteRunCandidate(null)
                }}
              >
                <section
                  className="delete-confirm-card"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="run-delete-confirm-title"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="delete-confirm-orbit" aria-hidden="true">
                    ✦
                  </div>
                  <span className="delete-confirm-kicker">
                    {deleteRunCandidate.scope === 'conv' &&
                    deleteRunCandidate.run.session === 'attaché'
                      ? texteFil('run.pieceJointe')
                      : texteFil('run.irreversible')}
                  </span>
                  <h2 id="run-delete-confirm-title">
                    {deleteRunCandidate.scope === 'conv' &&
                    deleteRunCandidate.run.session === 'attaché'
                      ? texteFil('run.detacherTitre')
                      : texteFil('run.supprimerTitre')}
                  </h2>
                  <p>
                    <strong>« {deleteRunCandidate.run.subject} »</strong>{' '}
                    {deleteRunCandidate.scope === 'conv' &&
                    deleteRunCandidate.run.session === 'attaché'
                      ? texteFil('run.detacherDetail')
                      : texteFil('run.supprimerDetail')}
                  </p>
                  {runDeleteError && <div className="attachment-error">⚠️ {runDeleteError}</div>}
                  <div className="delete-confirm-actions">
                    <button
                      className="btn delete-confirm-cancel run-delete-cancel"
                      onClick={() => setDeleteRunCandidate(null)}
                      disabled={runDeletePending}
                      autoFocus
                    >
                      {texteFil('dialogue.annuler')}
                    </button>
                    <button
                      className="btn delete-confirm-danger run-delete-confirm"
                      onClick={() => void confirmDeleteRun()}
                      disabled={runDeletePending}
                    >
                      {runDeletePending
                        ? texteFil('run.traitement')
                        : deleteRunCandidate.scope === 'conv' &&
                            deleteRunCandidate.run.session === 'attaché'
                          ? texteFil('run.detacher')
                          : texteFil('run.supprimer')}
                    </button>
                  </div>
                </section>
              </div>,
              document.body
            )}

          {activeId && faconsDuFilActif.length > 0 && (
            <ComparaisonDesFacons
              facons={faconsDuFilActif}
              signature={signatureDesFacons(faconsDuFilActif)}
              onOuvrir={(id) => {
                const cible = convsRef.current.find((conversation) => conversation.id === id)
                if (cible && id !== activeId) void loadConv(cible)
              }}
            />
          )}
          <div
            className={`chat-scroll scroll-y chat-scroll--ascenseur${repriseEnCours ? ' chat-scroll--reprise' : ''}`}
            ref={scrollRef}
            onMouseUp={surRelachementDansLeFil}
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            // LES GESTES QUI COMPTENT : molette, doigt, clavier, prise de la barre de defilement.
            onWheel={() => {
              gesteLecteurRef.current = true
            }}
            onTouchStart={() => {
              gesteLecteurRef.current = true
            }}
            onPointerDown={() => {
              gesteLecteurRef.current = true
            }}
            onKeyDown={() => {
              gesteLecteurRef.current = true
            }}
            onScroll={(event) => {
              const conteneur = event.currentTarget
              // Defilement FANTOME de la bascule : mesure sur l'ancienne position, aucune intention
              // de lecture. Le lire allumait « ↓ Dernier message » une frame — le clignotement.
              if (
                doitIgnorerDefilementDeBascule({
                  basculeEnCours: basculeConvRef.current,
                  gesteLecteur: gesteLecteurRef.current
                })
              ) {
                dernierScrollTopRef.current = conteneur.scrollTop
                return
              }
              const nearBottom = isChatNearBottom(conteneur)
              // La position de lecture se retient a chaque mouvement DU LECTEUR : quitter une
              // conversation ne passe pas toujours par un evenement de fermeture (changement de
              // conversation, fermeture brutale de l'app). Un defilement provoque par l'APP, lui,
              // n'ecrit rien : c'est ce qui rouvrait le fil au milieu (conv-61).
              if (activeRef.current && gesteLecteurRef.current)
                memoriserPositionLecture(
                  activeRef.current,
                  conteneur,
                  mesurerMessagesRendus(conteneur)
                )
              // Pendant une descente automatique (envoi d'un message, streaming, fin de tour), les
              // evenements `scroll` viennent de NOUS : les prendre pour un geste de lecture coupait le
              // suivi et laissait le fil arrete au milieu du tour. Seul un recul rend la main.
              /*
               * UN DEFILEMENT QUE PERSONNE N'A PROVOQUE NE COUPE PAS LE SUIVI.
               *
               * Defaut vecu le 2026-09-06 : « quand je prompt ca met pas la vue sur le dernier
               * message ». Entre l'envoi et la frame de descente, l'app bouge le fil elle-meme (le
               * champ de saisie se vide et rend sa hauteur). Cet evenement arrivait ici avec le fil
               * encore en haut, `nearBottom` repondait faux, le suivi tombait, et la descente
               * s'annulait a la frame suivante — personne ne descendait.
               *
               * Le discriminant existe deja : `gesteLecteurRef` n'est vrai que si la molette, un
               * doigt, le clavier ou le pointeur ont touche le fil. Un `scroll` sans geste vient
               * donc de NOUS, exactement comme pendant une descente en vol, et se juge sur le SIGNE
               * du deplacement au lieu de la seule distance au bas.
               */
              const suit =
                descenteEnVolRef.current || !gesteLecteurRef.current
                  ? doitSuivreLeBas({
                      suivaitLeBas: followTailRef.current,
                      precedentTop: dernierScrollTopRef.current,
                      top: conteneur.scrollTop,
                      nearBottom
                    })
                  : nearBottom
              dernierScrollTopRef.current = conteneur.scrollTop
              followTailRef.current = suit
              setScrolledAwayFromTail(!suit)
              if (suit) setHasNewActivity(false)
            }}
          >
            {/* Chargement du fil : squelette pendant l'attente, bandeau ACTIONNABLE en cas d'échec.
              Un fil vide muet ne disait pas la différence entre « rien à afficher » et « la
              lecture a planté ». */}
            {convLoad.status === 'loading' && (
              <div
                className="conv-load-skeleton"
                role="status"
                aria-label={texteFil('fil.chargement')}
              >
                <span className="conv-load-skeleton-line" />
                <span className="conv-load-skeleton-line" />
                <span className="conv-load-skeleton-line" />
              </div>
            )}
            {convLoad.status === 'error' && (
              <div className="conv-load-error" role="alert">
                <span className="conv-load-error-text">
                  {texteFil('fil.illisible', { erreur: convLoad.error ?? '' })}
                </span>
                {convLoad.target && (
                  <button
                    type="button"
                    className="conv-load-retry"
                    onClick={() => void loadConv(convLoad.target as Conv)}
                  >
                    {texteFil('fil.reessayer')}
                  </button>
                )}
              </div>
            )}

            {/* Sans cadre autour : le panneau de l'ancien bloc restait gris sur les thèmes clairs.
                La phrase REMPLIT la saisie, elle ne l'envoie pas (draft conv-1401, « 3+5 »). */}
            {convLoad.status === 'idle' &&
              messages.length === 0 &&
              (!busy || activeId === null) && (
                <AnimationAccueilChat
                  libelle={texteFil('accueil.titre')}
                  detail={texteFil('accueil.detail')}
                  phrases={phrasesAccueil}
                  usages={usagesAccueil}
                  agentsAuTravail={
                    busyConversations.size + presenceDepuisRunsVivants(liveRuns).runsActifs
                  }
                  saisieRemplie={brouillonPresent}
                  actif={isActive}
                  onChoisir={remplirSaisie}
                />
              )}

            {activeDirectiveReceipts
              .filter((receipt) => receipt.afterMessageIndex < 0)
              .map((receipt) => (
                <DirectiveReceiptRow
                  key={`directive-receipt-${receipt.id}`}
                  receipt={receipt}
                  onAnnuler={annulerEnvoi}
                />
              ))}

            <VueMesuree id="chat-fil" bloc cle={activeId}>
              <PointerMomentVideo.Provider value={pointerMomentVideo}>
                {/* Les runs en cours, pour le bloc des juges qui se remplit en direct (conv-1021). */}
                <RunsEnDirect.Provider value={liveRuns}>
                  {/* Boutons de choix des pages interactives : ils remplissent CETTE saisie. */}
                  <RemplirSaisieDuFil.Provider value={remplirSaisie}>
                    {filRendu}
                  </RemplirSaisieDuFil.Provider>
                </RunsEnDirect.Provider>
              </PointerMomentVideo.Provider>
            </VueMesuree>

          </div>

          {/* Ascenseur à crans du fil (draft conv-1114, « 1 · Dépli en place ») : remplace l'ascenseur
              du système, un cran par message de l'utilisateur, carte du fil à la molette. */}
          <AscenseurDuFil
            key={activeId ?? 'aucune'}
            conteneurRef={scrollRef}
            numeroDepart={messagesUtilisateurAvantDebut}
            onGesteLecteur={() => {
              gesteLecteurRef.current = true
            }}
          />

          {passageSelectionne && passageSelectionne.fil === activeId && (
            <BarrePassage passage={passageSelectionne} onAction={agirSurPassage} />
          )}

          {(hasNewActivity || scrolledAwayFromTail) && (
            <button
              type="button"
              className="chat-jump-latest"
              onClick={() => {
                followTailRef.current = true
                setHasNewActivity(false)
                setScrolledAwayFromTail(false)
                /*
                 * DESCENDRE PAR LE BOUTON, C'EST QUITTER SA LECTURE (conv-1128, 2026-10-23). La
                 * position retenue ne partait que si un `scroll` touchait le bas pendant que le
                 * drapeau « geste du lecteur » etait leve ; apres une reprise de lecture, il est
                 * baisse, et le rechargement suivant du fil y RAMENAIT le lecteur. Meme regle qu'a
                 * l'envoi. Temoin : `ChatView.bouton-dernier-message-rechargement.test.tsx`.
                 */
                positionARestaurerRef.current = null
                if (activeRef.current) oublierPositionLecture(activeRef.current)
                if (scrollRef.current) scrollChatToBottom(scrollRef.current)
              }}
            >
              {hasNewActivity ? texteFil('fil.derniereReponse') : texteFil('fil.dernierMessage')}
            </button>
          )}

          {/*
           * LA DEMANDE D'AUTORISATION DE PRODUCTION VIT ICI, DANS LE FIL — pas en fenêtre flottante.
           * Elle se pose au bas de la conversation, juste au-dessus de la file d'attente et de la
           * zone de saisie : l'utilisateur lit la cible et l'opération SANS perdre de vue ce que
           * l'agent venait de dire, et le reste de l'application reste utilisable pendant qu'il
           * décide. La version précédente couvrait tout l'écran d'un voile translucide et rendait le
           * fil et la question illisibles l'un à travers l'autre (capture, conv-626).
           */}
          <ProdAutorisationHote conversationId={activeId} />
          {/* Les messages entre agents de fils du même dépôt vivent dans Détails > Runs
              (conv-1139, 2026-10-25 : « ranges ce bloc dans Détails > Runs »), plus ici. */}
          {/*
           * LA FRISE DE LA SUPER CONV, EN BAS (conv-1393, 2026-10-31 : « ce bloc mets-le plutôt en
           * bas »). Sous l'en-tête, elle poussait le fil vers le bas et le lecteur la traversait à
           * chaque arrivée sur le fil. Elle se pose ici, juste au-dessus du tableau du plan, qui
           * complète sa ligne de chiffres. Les onglets ne bougent pas : `fixed`, dans la bande des
           * boutons de fenêtre (SuperConvMosaique.css), quel que soit l'endroit du bloc.
           */}
          {planDuFilOuvert && ongletDuFilOuvert !== null ? (
            <BarriereErreur zone="chat-lots" cle={planDuFilOuvert.id}>
              <SuperConvDuChat
                key={planDuFilOuvert.id}
                plan={planDuFilOuvert}
                onglet={ongletDuFilOuvert}
                questions={questionsDesLots}
              />
            </BarriereErreur>
          ) : null}
          {/* Plan de lots d'un fil chef (conv-1150) : avancement, et le seul clic qui le lance. */}
          <BarriereErreur zone="chat-lots" cle={activeId}>
            <TableauDesLots conversationId={activeId} aCoteDeLaFrise={ongletDuFilOuvert !== null} />
          </BarriereErreur>
          {questionACoteOuverte && activeId && (
            <BarriereErreur zone="chat-question-a-cote" cle={activeId}>
              <QuestionACote
                key={activeId}
                conversationId={activeId}
                onFermer={() => {
                  setQuestionACoteOuverte(false)
                  composerRef.current?.focus()
                }}
              />
            </BarriereErreur>
          )}
          <VueMesuree id="chat-saisie" bloc cle={activeId}>
            <ChatComposer
              ref={composerRef}
              busy={busy}
              hasActiveConversation={Boolean(activeId)}
              resumeAvailable={resumeAvailable}
              attachmentCount={attachments.length}
              mentionSources={mentionSources}
              skillCommands={skillCommands}
              ghostRecommendation={ghostRecommendation}
              propositionsSuite={propositionsSuite}
              placeholderPendantTour={busy && activeId !== null}
              onDraftInput={(value) => setDraftInput(composerDraftKeyRef.current, value)}
              onDraftPresence={setBrouillonPresent}
              onBtw={handleBtw}
              onSend={() => {
                // Bascule ×3 (conv-1479) : un clic ARME le mode, l'envoi suivant part en 3 façons
                // puis le mode retombe. Avant, chaque clic lançait 3 tours payés : spam.
                if (troisFaconsArme) {
                  setTroisFaconsArme(false)
                  void essayerTroisFacons()
                  return
                }
                void send()
              }}
              onQueue={() => {
                // ×3 pendant un tour (conv-1491) : la file l'ignorait en silence et ×3 restait
                // allumé pour un envoi plus tard. On refuse en clair et on éteint.
                if (troisFaconsArme) {
                  setTroisFaconsArme(false)
                  setAppNotice((current) =>
                    newestNotice(current, { text: texteFil('essai.pendantTour') })
                  )
                  return
                }
                queueCurrentMessage()
              }}
              onResume={() => void resumePilotTurn()}
              onPaste={(files) => void addFiles(files)}
              attachmentsNode={rendrePiecesJointesEnAttente(attachments, (fileIndex) =>
                // Clé lue AU CLIC, comme avant la mise en commun : le brouillon courant peut avoir
                // changé depuis le rendu.
                setDraftAttachments(composerDraftKeyRef.current, (current) =>
                  current.filter((_, index) => index !== fileIndex)
                )
              )}
              errorNode={
                attachmentError ? <div className="attachment-error">{attachmentError}</div> : null
              }
              cadrageNode={
                /* CADRAGE : ce sur quoi le run repose SANS l'avoir vérifié, montré pendant qu'il
               tourne. Ne bloque rien ; un clic pré-remplit le composer pour corriger. */
                activeId && hypothesesCadrage[activeId]?.length ? (
                  <CadrageHypotheses
                    hypotheses={hypothesesCadrage[activeId]}
                    onCorriger={(amorce) => setDraftInput(composerDraftKeyRef.current, amorce)}
                    replie={cadrageReplie[activeId] !== undefined}
                    onBasculerRepli={() =>
                      setCadrageReplie((current) => {
                        const suivant = { ...current }
                        if (suivant[activeId] !== undefined) delete suivant[activeId]
                        else suivant[activeId] = runDuCadrageRef.current[activeId] ?? ''
                        return suivant
                      })
                    }
                  />
                ) : null
              }
              frictionNode={
                /* FRICTION : une série d'orchestrations sans livraison, visible AVANT la relance
               suivante. Ne bloque rien — la décision reste humaine. */
                friction ? (
                  <div
                    className="composer-friction"
                    data-testid="friction-echecs-repetes"
                    role="status"
                  >
                    <span aria-hidden="true">⚠</span> {friction.message}
                  </div>
                ) : null
              }
              leadingNode={
                <>
                  {/* La barre des quotas ouvre la popup et detache la rangee d'outils du champ. */}
                  <ModelQuotaIndicator
                    provider={bindingEffectif?.provider}
                    comptes={comptesDeConversation}
                  />
                  {/* MODE AUTO DE CE FIL — distinct du bouton global de la liste des conversations. */}
                  <button
                    type="button"
                    className={`btn composer-auto${
                      (activeId ? autoConvs.has(activeId) : autoNouveauFil) || autoConvs.has('*')
                        ? ' actif'
                        : ''
                    }`}
                    data-testid="composer-auto-toggle"
                    aria-pressed={
                      (activeId ? autoConvs.has(activeId) : autoNouveauFil) || autoConvs.has('*')
                    }
                    aria-label={
                      autoConvs.has(activeId ?? '')
                        ? texteFil('saisie.auto.arreter')
                        : texteFil('saisie.auto')
                    }
                    onClick={() => basculerModeAuto()}
                    title={
                      autoConvs.has('*')
                        ? texteFil('saisie.auto.tous')
                        : autoConvs.has(activeId ?? '')
                          ? texteFil('saisie.auto.arreter')
                          : // « Recommandé : rien » reste en français : c'est la ligne que l'agent écrit.
                            texteFil('saisie.auto.titre')
                    }
                  >
                    {/* Rond du mode auto, signe INFINI : « ça continue sans moi ». */}
                    <IconeInfini />
                  </button>
                  {/* `btn` comme ∞ et le micro voisins : même fond, même survol, même état
                      désactivé. Sans elle, le trombone gardait un style à part (survol vert,
                      contour voilé) que les thèmes générés recopiaient.
                      JAMAIS DÉSACTIVÉ PENDANT UN TOUR (conv-937, 2026-10-13 : « ça m'empêche
                      d'upload et de préparer mon prochain prompt pendant que la conv travaille »).
                      Le glisser-déposer et le collage joignaient déjà pendant le tour ; l'envoi en
                      cours de tour emporte les pièces jointes (submitBtw, repli en file avec elles). */}
                  <button
                    type="button"
                    className="btn attachment-button"
                    onClick={() => fileInputRef.current?.click()}
                    aria-label={texteFil('saisie.joindre')}
                    title={texteFil('saisie.joindre')}
                  >
                    <svg
                      className="attachment-icon"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="m8.75 12.85 5.9-5.9a3.05 3.05 0 0 1 4.31 4.31l-7.42 7.42a5.05 5.05 0 0 1-7.14-7.14l7.25-7.25"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="m7.55 15.45 7.16-7.16a1.25 1.25 0 0 1 1.77 1.77l-6.12 6.12"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  {activeId && (
                    <BoutonQuestionACote
                      ouvert={questionACoteOuverte}
                      onBasculer={() => setQuestionACoteOuverte((ouverte) => !ouverte)}
                    />
                  )}
                  {/* « ESSAIE 3 FAÇONS » (conv-1038) : la demande tapée, en trois branches comparées. */}
                  <button
                    type="button"
                    className={`btn composer-trois-facons${troisFaconsArme ? ' actif' : ''}`}
                    aria-pressed={troisFaconsArme}
                    onClick={() => setTroisFaconsArme((arme) => !arme)}
                    aria-label={texteFil('saisie.troisFacons')}
                    title={texteFil('saisie.troisFacons.titre')}
                  >
                    ×3
                  </button>
                  <input
                    ref={fileInputRef}
                    className="attachment-input"
                    type="file"
                    multiple
                    onChange={(event) => {
                      if (event.currentTarget.files) void addFiles(event.currentTarget.files)
                      event.currentTarget.value = ''
                    }}
                  />
                </>
              }
              stopNode={
                /*
              ARRÊTER ne doit dépendre de RIEN d'autre que « un tour est en cours » : ni du texte
              tapé, ni d'un état accessoire. Stop a donc son propre bouton, et il reste dans le
              parent — il ne dépend pas de la frappe.
            */
                busy ? (
                  <button
                    className="btn composer-stop"
                    data-testid="composer-stop"
                    onClick={() => stopPilotTurn()}
                    disabled={!activeId || interruptingConversations.has(activeId ?? '')}
                    aria-label={texteFil('saisie.arreterReponse')}
                    title={texteFil('saisie.arreterReponse.titre')}
                  >
                    <span className="composer-btn-glyph" aria-hidden="true">
                      ■
                    </span>
                    <span className="composer-btn-label">
                      {/* « Stop » s'écrit pareil en anglais. */}
                      {interruptingConversations.has(activeId ?? '')
                        ? texteFil('saisie.arret')
                        : 'Stop'}
                    </span>
                  </button>
                ) : null
              }
              metaNode={
                <div className="composer-meta">
                  <span className="composer-hint">{texteFil('saisie.aide')}</span>
                </div>
              }
            />
          </VueMesuree>
        </section>
      )}

      {/* ---- Navigateur intégré (conv-1286, lot 3/5) : entre le fil et les Détails, fil unique
          seulement. Démonté en mosaïque ou fermé : il retire alors la page native (poserCadre(null)). */}
      {convViewMode !== 'mosaic' && navigateurOuvert && activeId && (
        <BarriereErreur zone="chat-navigateur" cle={activeId}>
          <NavigateurIntegre
            key={activeId}
            conversationId={activeId}
            visible={isActive && !openImage}
            onFermer={() => setPanneauOutil(null)}
            onElementChoisi={insererElementChoisi}
            onReglages={(reglages) => {
              reglagesNavigateurRef.current = reglages
            }}
          />
        </BarriereErreur>
      )}

      {/* ---- Bureaux cachés (conv-1378) : à la place du navigateur. Aussi sans fil ouvert et en
          mosaïque, contrairement à lui : une demande « va sur les bureaux cachés » ne doit pas rester
          sans effet visible. */}
      {bureauxOuverts && (
        <BarriereErreur zone="chat-bureaux" cle="bureaux">
          <HdeskGestionView
            active={isActive}
            fils={filsDesBureaux}
            onFermer={() => setPanneauOutil(null)}
            onOpenConversation={(cible) => {
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
          <div
            className="image-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label={texteFil('apercu.aria', { nom: openImage.name })}
            onClick={() => setOpenImage(null)}
          >
            <div className="image-lightbox-content" onClick={(event) => event.stopPropagation()}>
              <button
                type="button"
                className="image-lightbox-close"
                aria-label={texteFil('apercu.fermer')}
                onClick={() => setOpenImage(null)}
              >
                ×
              </button>
              <img src={openImage.src} alt={openImage.name} />
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
