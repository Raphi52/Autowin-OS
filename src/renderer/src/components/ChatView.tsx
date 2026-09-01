import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useBrancheCourante } from './branche-courante'
import { createPortal } from 'react-dom'
import { extractRecommendation } from './Markdown'
import { extrairePromptSuivant } from '../../../shared/prompt-suivant'
import { SuggestionGrid } from './SuggestionGrid'
import { ModuleHeader } from './ModuleHeader'
import { pickTurnToResume, type UnfinishedTurn } from './resume-unfinished'
import { refreshesActiveConversation } from './chat-event-routing'
import { pickRunForTrace } from './run-trace-target'
import {
  type ConversationsVues,
  ecrireConversationsVues,
  estNonVue,
  lireConversationsVues,
  marquerVue
} from './conversation-seen'
import {
  CHAT_PANE_LIMITS,
  clampConversationPaneWidth,
  createLiveRunDeltaBatcher,
  deriveConversationState,
  hydrateStoredAssistant,
  isRunRequestCurrent,
  isChatNearBottom,
  scrollChatToBottom,
  reduceScopedLiveRuns,
  reduceAssistantPilotEvent,
  settleIfDone,
  resolveChatRuntimeIdentity,
  parseBtw,
  skillSlashCommands,
  type SlashCommand,
  type OrchStep,
  type ChatPart,
  type ChatRuntimeIdentity,
  type OrchestratorModelOption,
  type RunRequestIdentity,
  type ScopedLiveRun,
  type StoredAssistantMessage,
  settleOrchestrationOnRunEnd
} from './chat-view-model'
import { shortModelLabel } from './model-display-label'
import { buildHomeSuggestions } from './chat-home-suggestions'
import { buildRefineDraft, type TerminalStatus } from './chat-resume-refine'
import { moveQueueEntry } from './chat-queue-order'
import { ChatQueuePanel } from './ChatQueuePanel'
import { ChatComposer, type ChatComposerHandle } from './ChatComposer'
import { ChatMessageRow, DirectiveReceiptRow } from './ChatMessageRow'
import {
  aUneReponseApres,
  askEnAttente,
  lastUserPromptBefore,
  messageKey
} from './chat-message-keys'
import { promptDeRelanceGratuite } from './auto-relance'
import { reprendreApresRedemarrage } from './chat-reprise'
import type {
  AsstMsg,
  ChatAttachment,
  ComposerDraft,
  Conv,
  DirectiveReceipt,
  Msg,
  PilotEvent,
  QueuedDirective,
  RunEntry,
  SendOptions,
  UserMsg
} from './chat-view-types'
import { buildMentionSources, resolveMentionsForSend } from './chat-mentions'
import { visibleScopedRuns, type WorkflowPanelSection } from './workflows-panel-sections'
import { ForkIcon } from './chat-view-icons'
import { formatFileSize, encodeAttachment, pieceJointePasseePourLeFil } from './chat-attachments'
import { derniereConversationOuverte, memoriserDerniereConversation } from './derniere-conversation'
import {
  memoriserPositionLecture,
  positionLectureMemorisee,
  restaurerPositionLecture,
  type PositionLecture
} from './position-lecture'
import {
  conversationsRecentes,
  recenceUtilisateur,
  searchConversations,
  segmentsSurlignes,
  trierParRecenceUtilisateur
} from './conversation-search'
import {
  canoniserReplis,
  estReplie,
  groupesVisibles,
  grouperConversations,
  nomDeDossier,
  ordonnerGroupes
} from './conversation-groups'
import { OrchestratorModelSelector } from './OrchestratorModelSelector'
import { ChatMosaic, type ChatMosaicWindow } from './ChatMosaic'
import { ConversationCostIndicator } from './ConversationCostIndicator'
import { ModelQuotaIndicator } from './ModelQuotaIndicator'
import { COMPACT_REQUEST } from '../../../shared/context-gauge'
import { WorkflowsPanel, type RunDetailTab } from './WorkflowsPanel'
import { buildHarnessTimelineFromTrace, type HarnessTraceEvent } from './harness-timeline-model'
import {
  mergeLiveAndPersisted,
  scopedRunsFromTimeline,
  type TurnRuntimeIdentity
} from './subagent-thread-from-trace'
// La classe `.lisere-dessus` vit dans cette feuille : importee ICI et non « heritee » d'une
// autre vue, sinon l'apparence de Chat dependrait de l'ordre de chargement des AUTRES vues.
import './ViewPage.css'
import { contextGauge, type ContextGauge } from '../../../shared/context-gauge'
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
import type { CheckpointEntry } from './chat-view-types'
import { useSkillsCatalog } from './useSkillsInventory'
import { messageTravailNonPublie, promptTravauxNonPublies } from './travail-non-publie'
import { TravauxNonPublies } from './TravauxNonPublies'
import { Spinner } from './Spinner'
type RuntimeModel = Parameters<typeof resolveChatRuntimeIdentity>[1][number]

/* ---------- Constantes ---------- */

/**
 * Ghost-text d'un FIL donne : prompt suivant ecrit par le modele, sinon rubrique Recommande.
 * Extrait du composant pour que la MOSAIQUE l'obtienne aussi, par conversation (2026-08-30).
 */
/**
 * SURLIGNE dans un libelle les portions qui correspondent au terme cherche.
 *
 * Une liste filtree qui ne montre pas POURQUOI chaque ligne est la oblige a ouvrir chaque
 * conversation pour comprendre. `<mark>` porte aussi le sens semantiquement, pas seulement une
 * couleur : un lecteur d'ecran l'annonce.
 */
function TexteSurligne({ texte, terme }: { texte: string; terme: string }): React.JSX.Element {
  const segments = segmentsSurlignes(texte, terme)
  return (
    <>
      {segments.map((segment, index) =>
        segment.marque ? (
          <mark key={index} className="conv-highlight">
            {segment.texte}
          </mark>
        ) : (
          <span key={index}>{segment.texte}</span>
        )
      )}
    </>
  )
}

function ghostDuFil(fil: Msg[]): string | null {
  const lastAssistant = [...fil].reverse().find((m) => m.role === 'assistant') as
    AsstMsg | undefined
  if (!lastAssistant) return null
  const text = lastAssistant.parts
    .filter((p): p is Extract<ChatPart, { kind: 'text' }> => p.kind === 'text')
    .map((p) => p.text)
    .join('\n')
  return extrairePromptSuivant(text) ?? extractRecommendation(text)
}

// Les suggestions d'accueil ne sont plus figées : elles se DÉRIVENT de l'état réel
// (`buildHomeSuggestions`), le jeu historique restant le repli quand l'état est vide.

const MAX_ATTACHMENTS = 8
/** Cadence de la veille sur un tour declare vivant (sonde d'autorite cote main). */
const TOUR_VIVANT_SONDE_MS = 4000
/**
 * Delai au bout duquel le libelle « Arret... » rend la main quand le tour survit a son annulation.
 */
const STOP_REARMEMENT_MS = 10000
const NEW_DRAFT_KEY = '__new__'
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MAX_ATTACHMENTS_BYTES = 20 * 1024 * 1024
/* ---------- Vue ---------- */

/**
 * Chat façon Claude Code : conversations à gauche, fil transparent au centre
 * (l'agent parle ET pilote — ses actions en puces inline), workflows (RUN.md)
 * repliables à droite. Tout se passe ici.
 */
/**
 * Un échec AVALÉ ne doit jamais disparaître : même quand le repli est correct (on garde l'écran
 * précédent), la cause doit rester diagnosticable. Trace unique, préfixée par sa portée.
 */
function traceSilentFailure(scope: string, error: unknown): void {
  console.warn(`[chat] ${scope} — échec ignoré`, error)
}

type AppNotice = { text: string; noticeId?: number }

function newestNotice(current: AppNotice | null, incoming: AppNotice): AppNotice {
  if (
    current?.noticeId !== undefined &&
    incoming.noticeId !== undefined &&
    incoming.noticeId < current.noticeId
  ) {
    return current
  }
  return incoming
}

/**
 * Fil PERSISTÉ → fil live. Extrait de `loadConv` parce qu'un second appelant en a besoin : l'amorce
 * d'un tour initié côté main doit partir du store, sinon elle écrase l'historique dans le cache live
 * — qui fait autorité à la réouverture (conv-1376, « ma conversation était tronquée »).
 */
type MessageStocke = Partial<StoredAssistantMessage> & {
  role: string
  content: string
  messageId?: string
  attachments?: UserMsg['attachments']
  done?: boolean
}

function hydraterFilStocke(messages: readonly MessageStocke[]): Msg[] {
  return messages.map((m) =>
    m.role === 'user'
      ? {
          role: 'user' as const,
          content: m.content,
          attachments: m.attachments,
          messageId: m.messageId
        }
      : { ...hydrateStoredAssistant(m as StoredAssistantMessage), messageId: m.messageId }
  )
}

/**
 * Haut de CHAQUE message rendu, relatif au conteneur de défilement — l'ancre structurelle de la
 * reprise de lecture. `offsetTop` est relatif au parent positionné : on le ramène au conteneur en
 * retranchant le sien, ce qui reste juste même si un ancêtre intermédiaire est positionné.
 */
export function mesurerMessagesRendus(conteneur: HTMLElement): { offsetTop: number }[] {
  const hautConteneur = conteneur.getBoundingClientRect().top + conteneur.scrollTop
  return Array.from(conteneur.querySelectorAll<HTMLElement>('.msg')).map((element) => ({
    offsetTop: Math.round(element.getBoundingClientRect().top + conteneur.scrollTop - hautConteneur)
  }))
}

export function ChatView({
  isActive = true,
  onInspectTurn
}: {
  isActive?: boolean
  onInspectTurn?: (target: InspectTurnTarget) => void
}): React.JSX.Element {
  const [convs, setConvs] = useState<Conv[]>([])
  /** Miroir stable de `convs` pour les écouteurs d'événements (pas de re-abonnement à chaque render). */
  const convsRef = useRef<Conv[]>([])
  convsRef.current = convs
  const [convQuery, setConvQuery] = useState('')
  const conversationDateOrder: 'desc' | 'asc' = 'desc'
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  /**
   * Le TEXTE en cours de frappe ne vit plus ici : il appartient à `ChatComposer` (conv-1466).
   * ChatView ne garde que la carte des brouillons (`composerDraftsRef`, source de vérité) et ce
   * handle, par lequel il RÉIMPOSE une valeur — sans qu'une frappe le re-rende.
   */
  const composerRef = useRef<ChatComposerHandle | null>(null)
  /** Seule retombée d'une frappe sur la vue : vide ↔ non-vide (la home s'y accroche). */
  const [brouillonPresent, setBrouillonPresent] = useState(false)
  /*
   * Les suppositions du cadrage en cours, par conversation. Vivantes seulement : elles viennent d'un
   * evenement de run, disparaissent quand l'utilisateur les masque ou quand un nouveau cadrage
   * arrive. Rien n'est persiste — le cadrage lui-meme l'est, dans l'etat du run.
   */
  const [hypothesesCadrage, setHypothesesCadrage] = useState<Record<string, HypotheseDeCadrage[]>>(
    {}
  )
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
  const ghostRecommendation = useMemo(() => ghostDuFil(messages), [messages])
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [appNotice, setAppNotice] = useState<AppNotice | null>(null)
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
  const lireEtatGit = useCallback(() => Promise.resolve(window.api.getGitState?.()), [])
  const gitBranch = useBrancheCourante(lireEtatGit)
  const [defaultWorkspace, setDefaultWorkspace] = useState<string | undefined>(undefined)
  /*
   * Occupation de la fenetre de contexte, par conversation.
   *
   * Voisine du cout, et pourtant l'inverse : le cout dit ce que le tour a DEPENSE, la jauge dit
   * ce que le fil PORTE encore. Autowin savait repondre a la premiere question et pas a la
   * seconde -- un fil pouvait s'approcher de la saturation sans qu'un ecran ne l'indique.
   */
  const [contextGauges, setContextGauges] = useState<Record<string, ContextGauge>>({})
  // Menu ⋮ d'une conversation, rendu en position fixe (déborde du conteneur scrollable).
  const [convMenu, setConvMenu] = useState<{ conv: Conv; top: number; left: number } | null>(null)
  const [convFolderMenu, setConvFolderMenu] = useState<{
    conv: Conv
    top: number
    left: number
  } | null>(null)
  /**
   * Saisie du dossier en cours de creation, dans le sous-menu « Ranger dans un dossier ».
   *
   * `undefined` = pas en train de creer. La liste du menu est DERIVEE des conversations deja
   * rangees : sans ce champ, zero dossier signifiait zero moyen d'en creer un, donc zero dossier
   * pour toujours (constate le 2026-08-18). On saisit ICI plutot que via le selecteur natif :
   * un dossier de conversations est une etiquette, pas un repertoire Windows.
   */
  const [nouveauDossier, setNouveauDossier] = useState<string | undefined>(undefined)
  // File d'attente : directives injectées pendant le tour, pas encore consommées (conv active).
  const [pendingDirectives, setPendingDirectives] = useState<QueuedDirective[]>([])
  const [steeringDirectives, setSteeringDirectives] = useState<Set<number>>(() => new Set())
  const [directiveReceipts, setDirectiveReceipts] = useState<Record<string, DirectiveReceipt[]>>({})
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mosaicIds, mosaicFils])
  const [convViewMode, setConvViewMode] = useState<'list' | 'mosaic'>(() =>
    window.localStorage.getItem('autowin.chat.conversationsViewMode') === 'mosaic'
      ? 'mosaic'
      : 'list'
  )
  useEffect(() => {
    window.localStorage.setItem('autowin.chat.conversationsViewMode', convViewMode)
  }, [convViewMode])
  const [conversationsPaneWidth, setConversationsPaneWidth] = useState(() => {
    const saved = Number(window.localStorage.getItem('autowin.chat.conversationsPaneWidth'))
    return clampConversationPaneWidth(Number.isFinite(saved) && saved > 0 ? saved : 232)
  })
  const [hasNewActivity, setHasNewActivity] = useState(false)
  /* Fil remonté : le saut vers le dernier message ne dépend pas d'une nouvelle activité. */
  const [scrolledAwayFromTail, setScrolledAwayFromTail] = useState(false)
  const [showRuns, setShowRuns] = useState(false)
  // Panneau « Réflexion » : le raisonnement du modèle, hors du fil (colonne droite).
  const [runsPaneWidth, setRunsPaneWidth] = useState(() => {
    const saved = Number(window.localStorage.getItem('autowin.chat.runsPaneWidth'))
    const value = Number.isFinite(saved) && saved > 0 ? saved : 340
    return Math.min(CHAT_PANE_LIMITS.workflows.max, Math.max(CHAT_PANE_LIMITS.workflows.min, value))
  })
  // Quatre sections : Sous-agents · Run · Graphe · Source control. Défaut = Sous-agents, la section qu'on regarde
  // pendant une orchestration — garder « Run » par défaut aurait retiré les sous-agents de la vue.
  const [paneTab, setPaneTab] = useState<WorkflowPanelSection>('subagents')
  const [runs, setRuns] = useState<RunEntry[]>([])
  const [checkpoints, setCheckpoints] = useState<CheckpointEntry[]>([])
  const [forkedCheckpoint, setForkedCheckpoint] = useState('')
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
   * Chips d'accueil dérivées de l'état RÉEL (runs bloqués, brouillon repris) ; repli
   * statique si rien à dire. Rendues par le `SuggestionGrid` déjà existant.
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
    // `brouillonPresent` et non le texte : `buildHomeSuggestions` ne teste que sa présence.
    () => buildHomeSuggestions({ runs, resumedDraft: brouillonPresent ? 'brouillon' : '' }),
    [runs, brouillonPresent]
  )
  const [openRun, setOpenRun] = useState<{ path: string; content: string } | null>(null)
  const [openTrace, setOpenTrace] = useState<OrchStep[] | null>(null)
  // Détail d'un run : bascule entre le fil des sous-agents (trace) et le RUN.md brut.
  const [runDetailTab, setRunDetailTab] = useState<RunDetailTab>('progress')
  const [liveRuns, setLiveRuns] = useState<Record<string, ScopedLiveRun<OrchStep>>>({})
  // Carte de l'orchestration EN COURS dans le panneau Workflows : cible du clic sur
  // l'indicateur « action en cours » d'un message (ouvre le panneau + cadre le run/step actif).
  const liveRunCardRef = useRef<HTMLDivElement>(null)
  // Clic sur le bloc d'activité d'un message → Workflows, à l'endroit qui montre RÉELLEMENT ce qui
  // s'est passé : la section Sous-agents pour le fil du run, l'onglet Activité (historique) quand on
  // veut la trace d'un run précis (elle survit au redémarrage, l'écho de session non).
  const revealLiveAction = useCallback((mode: 'live' | 'history' = 'live', runId?: string) => {
    setShowRuns(true)
    setPaneTab('subagents')
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
  /*
   * VIDE LE TAMPON DE STREAMING. Les deltas de texte dorment une frame dans `pilotBatcher` : une
   * action qui doit ANCRER sur le fil reellement affiche (le recu d'orientation) lisait sinon un
   * `liveMessagesRef` en retard, et son ancre tombait avant tout le texte deja lu par l'utilisateur.
   */
  const pilotFlushRef = useRef<() => void>(() => {})
  const busyConversationsRef = useRef(new Set<string>())
  const interruptingConversationsRef = useRef(new Set<string>())
  const stoppedQueueDrainRef = useRef(new Set<string>())
  const steeringRef = useRef(new Set<number>())
  const sendLocksRef = useRef(new Set<string>())
  const composerDraftKeyRef = useRef(NEW_DRAFT_KEY)
  const [draftsVersion, setDraftsVersion] = useState(0)
  const composerSelectionGenerationRef = useRef(0)
  const composerDraftsRef = useRef(
    new Map<string, ComposerDraft>([[NEW_DRAFT_KEY, { input: '', attachments: [], error: null }]])
  )
  const activeRef = useRef<string | null>(null)
  const loadConversationRequestRef = useRef(0)
  /** Tours déjà rejoués depuis le journal fichier — clé de dédup du rejeu (voir replayTurnJournal). */
  const replayedTurnsRef = useRef(new Set<string>())
  const runtimeRefreshGenerationRef = useRef(0)
  const runsRequestRef = useRef<RunRequestIdentity>({ id: 0, scope: 'conv', convId: null })
  const followTailRef = useRef(true)
  /**
   * Position A RESTAURER a la prochaine peinture du fil : posee par `loadConv` quand la conversation
   * ouverte avait ete quittee EN COURS de lecture. Un ref et pas un state : l'effet de scroll doit la
   * consommer sur la meme frame que les messages, sans re-rendu intermediaire.
   */
  const positionARestaurerRef = useRef<PositionLecture | null>(null)
  /**
   * MASQUE PENDANT LA REPRISE. La restauration re-applique la cible sur ~20 frames pendant que le
   * markdown se rend : l'utilisateur voyait le fil sauter (clignotement signale le 2026-08-30).
   * On masque le fil le temps de la reprise, et on le revele une fois la position tenue.
   */
  const [repriseEnCours, setRepriseEnCours] = useState(false)

  /** Le texte en cours de frappe, lu dans la carte des brouillons (le composer y écrit à chaque touche). */
  function texteDuComposer(): string {
    return getComposerDraft(composerDraftKeyRef.current).input
  }

  function getComposerDraft(key: string): ComposerDraft {
    return composerDraftsRef.current.get(key) ?? { input: '', attachments: [], error: null }
  }

  function setDraftInput(key: string, value: string): void {
    composerDraftsRef.current.set(key, { ...getComposerDraft(key), input: value })
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

  async function changeOrchestratorModel(option: OrchestratorModelOption): Promise<void> {
    if (busy || modelChangePending) return
    setModelChangePending(true)
    setModelChangeError(null)
    try {
      await window.api.setRole(
        'orchestrator',
        option.provider,
        option.model,
        option.reasoningEffort
      )
      await refreshRuntimeIdentity()
    } catch (error) {
      setModelChangeError(
        `Changement non enregistré : ${error instanceof Error ? error.message : String(error)}`
      )
      try {
        await refreshRuntimeIdentity()
      } catch (error) {
        // L'identité affichée reste la dernière identité confirmée.
        traceSilentFailure('runtime-identity', error)
      }
    } finally {
      setModelChangePending(false)
    }
  }
  useEffect(() => {
    activeRef.current = activeId
  }, [activeId])

  const busy = activeId ? busyConversations.has(activeId) : false
  function setConversationBusy(id: string, value: boolean): void {
    if (value) busyConversationsRef.current.add(id)
    else busyConversationsRef.current.delete(id)
    setBusyConversations(new Set(busyConversationsRef.current))
  }
  function setConversationInterrupting(id: string, value: boolean): void {
    if (value) interruptingConversationsRef.current.add(id)
    else interruptingConversationsRef.current.delete(id)
    setInterruptingConversations(new Set(interruptingConversationsRef.current))
  }
  /** Injection « Orienter » en vol, par DIRECTIVE (deux messages peuvent être orientés de suite). */
  function setDirectiveSteering(directiveId: number, value: boolean): void {
    if (value) steeringRef.current.add(directiveId)
    else steeringRef.current.delete(directiveId)
    setSteeringDirectives(new Set(steeringRef.current))
  }
  function setDirectiveReceipt(
    conversationId: string,
    entry: QueuedDirective,
    status: DirectiveReceipt['status'],
    // Une REPONSE a une question `ask` emprunte le meme transport qu'une orientation, mais ce
    // n'en est pas une : sans ce drapeau, le fil affichait « ✓ Orienté » sur une reponse.
    reponse?: boolean
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
              index === existing ? { ...receipt, status } : receipt
            )
          : [
              ...receipts,
              {
                id: entry.id,
                text: entry.text,
                status,
                ...(reponse ? { reponse: true as const } : {}),
                afterMessageIndex,
                afterPartIndex,
                ...(anchorPart?.kind === 'text' ? { afterTextOffset: anchorPart.text.length } : {})
              }
            ]
      return { ...current, [conversationId]: next }
    })
  }
  function rebaseDirectiveReceiptsAfterStreamReset(conversationId: string, streamId: string): void {
    const liveMessages = liveMessagesRef.current.get(conversationId) ?? []
    setDirectiveReceipts((current) => {
      const receipts = current[conversationId]
      if (!receipts?.length) return current
      let changed = false
      const next = receipts.map((receipt) => {
        if (receipt.afterPartIndex < 0) return receipt
        const anchorMessage = liveMessages[receipt.afterMessageIndex]
        if (anchorMessage?.role !== 'assistant') return receipt
        const partsBeforeAnchor = anchorMessage.parts.slice(0, receipt.afterPartIndex)
        const removedBefore = partsBeforeAnchor.filter(
          (part) => part.kind === 'text' && part.streamId === streamId
        ).length
        const anchorPart = anchorMessage.parts[receipt.afterPartIndex]
        const anchorRemoved = anchorPart?.kind === 'text' && anchorPart.streamId === streamId
        if (removedBefore === 0 && !anchorRemoved) return receipt
        changed = true
        return {
          ...receipt,
          afterPartIndex: receipt.afterPartIndex - removedBefore - (anchorRemoved ? 1 : 0),
          ...(anchorRemoved ? { afterTextOffset: undefined } : {})
        }
      })
      return changed ? { ...current, [conversationId]: next } : current
    })
  }

  async function addFiles(files: FileList | File[], cible?: string): Promise<void> {
    if (!cible && busy) return
    if (cible && busyConversationsRef.current.has(cible)) return
    const originDraftKey = cible ?? composerDraftKeyRef.current
    const originDraft = getComposerDraft(originDraftKey)
    setDraftError(originDraftKey, null)
    const seen = new Set(originDraft.attachments.map((file) => `${file.name}\u0000${file.size}`))
    const candidates = Array.from(files).filter((file) => {
      const key = `${file.name}\u0000${file.size}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    if (originDraft.attachments.length + candidates.length > MAX_ATTACHMENTS) {
      setDraftError(originDraftKey, `Maximum ${MAX_ATTACHMENTS} fichiers par message.`)
      return
    }
    const oversized = candidates.find((file) => file.size > MAX_ATTACHMENT_BYTES)
    if (oversized) {
      setDraftError(originDraftKey, `${oversized.name} dépasse la limite de 10 Mo.`)
      return
    }
    const totalBytes =
      originDraft.attachments.reduce((sum, file) => sum + file.size, 0) +
      candidates.reduce((sum, file) => sum + file.size, 0)
    if (totalBytes > MAX_ATTACHMENTS_BYTES) {
      setDraftError(originDraftKey, 'Le total des pièces jointes dépasse 20 Mo.')
      return
    }
    try {
      const encoded = await Promise.all(candidates.map(encodeAttachment))
      setDraftAttachments(originDraftKey, (current) => [...current, ...encoded])
    } catch (error) {
      setDraftError(
        originDraftKey,
        `Lecture impossible : ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /* --- données latérales --- */

  async function refreshConvs(): Promise<void> {
    const loaded = (await window.api.conversations()) as Conv[]
    convsRef.current = loaded // dispo IMMÉDIATEMENT pour la reprise auto (sans attendre le render)
    setConvs(loaded)
    void autoResumeOnce(loaded)
  }

  /**
   * Survie niveau 2 — REPRISE AUTOMATIQUE, déclenchée ICI (et pas dans App) parce que c'est ChatView
   * qui sait quand les conversations sont réellement chargées : dispatcher à l'aveugle après un délai
   * ratait la reprise (course au démarrage, constatée en essai réel). Une seule fois par session.
   */
  const autoResumeDoneRef = useRef(false)
  async function autoResumeOnce(loaded: Conv[]): Promise<void> {
    if (autoResumeDoneRef.current) return
    autoResumeDoneRef.current = true
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
    if (target) {
      const conversation = loaded.find((candidate) => candidate.id === target.conversationId)
      if (conversation) {
        await loadConv(conversation)
        await replayTurnJournal(target.conversationId, target.turnId)
        return
      }
    }
    // Pas de tour a reprendre : on rouvre la ou l'utilisateur etait (demande du 2026-08-18). La
    // reprise d'un tour inacheve reste PRIORITAIRE — elle repare quelque chose, celle-ci ne fait
    // que replacer le curseur. Aucune selection inventee si la memoire est vide ou perimee.
    const derniere = derniereConversationOuverte(loaded)
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
    if (next.length) queueRef.current.set(id, next)
    else queueRef.current.delete(id)
    if (activeRef.current === id) setPendingDirectives(next)
  }
  /**
   * `mode: 'btw'` = « celui-la passe EN DERNIER ». Il ne suffit pas de deplacer l'entree une fois :
   * sans cette insertion, le message suivant tape par l'utilisateur atterrissait APRES le message
   * marque BTW, ce qui defaisait silencieusement la promesse du bouton (« remettre a la fin ») —
   * `mode` n'etait alors lu que pour l'affichage, donc le clic n'avait aucun effet durable.
   * Un nouvel envoi BTW, lui, se range derriere les BTW deja presents (ordre d'arrivee conserve).
   */
  function enqueueMessage(id: string, text: string, mode?: QueuedDirective['mode']): void {
    const current = queueRef.current.get(id) ?? []
    const entry = { id: nextQueueEntryIdRef.current++, text, mode }
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
  useEffect(() => {
    setPendingDirectives(queueRef.current.get(activeId ?? '') ?? [])
  }, [activeId])
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
    if (window.api.checkpointForks) {
      const nextCheckpoints = await window.api.checkpointForks()
      if (isRunRequestCurrent(request, currentRequest)) setCheckpoints(nextCheckpoints)
    }
  }
  useEffect(() => {
    void Promise.resolve().then(refreshRuns)
  }, [activeId])
  // Tient le bus au courant de la conversation active → les orchestrations s'y rattachent.
  useEffect(() => {
    window.api.setActiveConversation(activeId)
  }, [activeId])
  useEffect(() => {
    let disposed = false
    void Promise.resolve().then(async () => {
      await refreshConvs()
      // ALIGNEMENT AU MONTAGE : le main est la source de vérité de la conversation active. Le scout
      // de veille (et tout flux né hors du chat) sélectionne sa conversation PENDANT que cette vue
      // est démontée — l'événement de sélection n'a alors aucun auditeur, et la vue remontait sur
      // son ancienne sélection avec un panneau vide (mesuré le 14/08, conv-1164/1165).
      try {
        const etat = (await window.api.appState()) as { activeConversationId?: string }
        const cibleId = etat?.activeConversationId
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
    const offApp = window.api.onAppEvent((e) => {
      if (e.type !== 'orchestrate-delta') deltaBatcher.flush()
      if (e.type === 'toast') {
        if (e.text) {
          const text = e.text
          setAppNotice((current) => newestNotice(current, { text, noticeId: e.noticeId }))
        }
      } else if (e.type === 'refresh') {
        if (e.scope === 'conversations') refreshConvs()
        if (e.scope === 'workflows') refreshRuns()
        if (e.scope === 'roles') refreshRuntimeIdentity()
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
            task: e.task ?? 'tâche'
          })
        )
        if (e.convId === activeRef.current) {
          setShowRuns(true)
          // Une orchestration démarre → on ouvre la section qui montre ses sous-agents.
          setPaneTab('subagents')
        }
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
            }
          })
        )
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
      } else if (
        e.type === 'orchestrate-hypotheses' &&
        e.convId &&
        Array.isArray(e.hypotheses) &&
        e.hypotheses.length
      ) {
        const convId = e.convId
        const recues = e.hypotheses as HypotheseDeCadrage[]
        setHypothesesCadrage((current) => ({ ...current, [convId]: recues }))
      } else if (e.type === 'orchestrate-end' && e.convId) {
        const convId = e.convId
        const runPath = e.runPath
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
      deltaBatcher.cancel()
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

  function patchLast(conversationId: string, fn: (m: AsstMsg) => void): void {
    const next = (liveMessagesRef.current.get(conversationId) ?? []).slice()
    for (let i = next.length - 1; i >= 0; i--) {
      if (next[i].role !== 'assistant') continue
      const copy: AsstMsg = { ...(next[i] as AsstMsg), parts: (next[i] as AsstMsg).parts.slice() }
      fn(copy)
      // Invariant impose ICI, dans l'entonnoir UNIQUE de mutation, et non aux trois sites qui closent
      // un tour (annule / echoue / termine) : un quatrieme site futur l'oublierait. Un tour `done` ne
      // laisse aucune action « en cours » — sinon l'indicateur tourne indefiniment et le bouton
      // « Reprendre » n'apparait qu'apres un redemarrage de l'app.
      next[i] = settleIfDone(copy) as AsstMsg
      break
    }
    liveMessagesRef.current.set(conversationId, next)
    publierFil(conversationId, next)
  }

  useEffect(() => {
    /*
     * UN RE-RENDU PAR FRAME, PAS PAR TOKEN.
     *
     * Chaque delta pilote arrive dans sa propre tâche IPC et appelait `patchLast` → `setMessages` :
     * 300 tokens = 300 recopies du fil et 300 rendus, chacun en O(taille du message). Le batcher
     * existait déjà (branché sur `orchestrate-delta`) ; le chemin le PLUS fréquent — le streaming du
     * chat — ne l'utilisait pas.
     *
     * Ce qui est batché : seulement le TEXTE qui s'accumule (`delta`, `reasoning`, `think`). Tout le
     * reste — `command`, `result`, `stream-reset`, `done`, `error`, `cancellation` — vide le tampon
     * puis s'applique IMMÉDIATEMENT : une clôture ne doit jamais dormir une frame, et l'ordre des
     * événements dans le réducteur est préservé par ce flush.
     */
    const pilotBatcher = createLiveRunDeltaBatcher<{
      conversationId: string
      event: PilotEvent
    }>(
      (batch) => {
        const parConversation = new Map<string, PilotEvent[]>()
        for (const item of batch) {
          const liste = parConversation.get(item.conversationId) ?? []
          liste.push(item.event)
          parConversation.set(item.conversationId, liste)
        }
        for (const [conversationId, events] of parConversation)
          patchLast(conversationId, (message) => {
            let etat = message as AsstMsg
            for (const event of events) etat = reduceAssistantPilotEvent(etat, event) as AsstMsg
            Object.assign(message, etat)
          })
      },
      (flush) => window.requestAnimationFrame(flush),
      (handle) => window.cancelAnimationFrame(handle)
    )
    // Rend le vidage du tampon atteignable HORS de cet effet (voir `pilotFlushRef`).
    pilotFlushRef.current = () => pilotBatcher.flush()
    // Rend le vidage du tampon atteignable HORS de cet effet (voir `pilotFlushRef`).
    pilotFlushRef.current = () => pilotBatcher.flush()
    const off = window.api.onPilotEvent((raw) => {
      const e = raw as PilotEvent
      const conversationId = e.conversationId
      if (!conversationId) return
      // TOUR INITIÉ CÔTÉ MAIN (scout de veille, tâche planifiée) : la vue ne l'a pas lancé, donc il
      // n'est pas dans `busyConversationsRef` — et ses événements étaient JETÉS : la conversation
      // s'ouvrait sur un panneau vide pendant que l'agent travaillait (mesuré le 14/08,
      // conv-1164→1166). Le premier événement pilote PROUVE qu'un tour tourne : on marque la
      // conversation occupée et on amorce un fil live pour que les patchs aient une cible.
      if (!busyConversationsRef.current.has(conversationId)) {
        if (e.kind === 'done' || e.kind === 'error') return
        setConversationBusy(conversationId, true)
        // Le cache live fait AUTORITÉ à la réouverture (`loadConv` le préfère au store). S'il est
        // ABSENT ici, l'amorce ci-dessous en ferait un fil réduit au seul tour en cours : la
        // conversation rouvrait TRONQUÉE de tout son historique (conv-1376). D'où l'amorce du cache
        // depuis le store, faite AVANT d'y écrire l'amorce du tour.
        const cacheAbsent = !liveMessagesRef.current.has(conversationId)
        const fil = liveMessagesRef.current.get(conversationId) ?? []
        if (!fil.some((message) => message.role === 'assistant' && !message.done)) {
          const amorce = [
            ...fil,
            { role: 'assistant', content: '', parts: [], status: 'streaming' } as unknown as Msg
          ]
          liveMessagesRef.current.set(conversationId, amorce)
          publierFil(conversationId, amorce)
        }
        // L'HISTORIQUE — dont le MESSAGE ENVOYÉ du tour — vit dans le store, pas dans les événements :
        // sans ce rattrapage, le fil montrait la réponse sans la demande (« j'ai pas vu le message
        // envoyé », 14/08), et le cache tronquait la conversation à la réouverture (conv-1376).
        // On met le fil persisté en tête du fil adopté, sans écraser les patchs déjà arrivés.
        if (cacheAbsent) {
          void window.api
            .conversation(conversationId)
            .then((conversation) => {
              const historique = hydraterFilStocke(
                (conversation as { messages?: MessageStocke[] })?.messages ?? []
              ).filter(
                // Un tour en vol peut être persisté NON CLOS : il ferait doublon avec l'amorce.
                (message) => message.role !== 'assistant' || (message as AsstMsg).done === true
              )
              if (historique.length === 0) return
              const courant = liveMessagesRef.current.get(conversationId) ?? []
              if (courant.some((message) => message.role === 'user')) return
              const complet = [...historique, ...courant]
              liveMessagesRef.current.set(conversationId, complet)
              publierFil(conversationId, complet)
            })
            .catch(() => {})
        }
      }
      if (e.kind === 'done' || e.kind === 'error') setConversationBusy(conversationId, false)
      if (e.kind === 'done' && e.usage) {
        // `inputTokens` du dernier tour EST l'occupation courante : le prefixe est renvoye a chaque
        // appel, donc le dernier tour porte le fil entier. Une somme des tours le compterait N fois.
        const jauge = contextGauge(e.usage)
        if (jauge) setContextGauges((current) => ({ ...current, [conversationId]: jauge }))
      }
      if (e.kind === 'stream-reset' && e.streamId)
        rebaseDirectiveReceiptsAfterStreamReset(conversationId, e.streamId)
      if (e.kind === 'delta' || e.kind === 'reasoning' || e.kind === 'think') {
        pilotBatcher.enqueue({ conversationId, event: e })
        return
      }
      pilotBatcher.flush()
      patchLast(conversationId, (message) =>
        Object.assign(message, reduceAssistantPilotEvent(message, e))
      )
    })
    return () => {
      // `cancel` et non `flush` : poser un état sur une vue démontée n'aide personne, et le fil
      // persisté par le main reste la source de vérité à la réouverture.
      pilotBatcher.cancel()
      off()
    }
  }, [])

  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    // REPRISE DE LECTURE : la conversation a ete quittee au milieu du fil. On restaure l'endroit
    // exact AVANT toute descente, sinon l'ouverture viserait le bas comme avant (defaut du 2026-08-30).
    const aRestaurer = positionARestaurerRef.current
    if (aRestaurer) {
      positionARestaurerRef.current = null
      followTailRef.current = false
      setScrolledAwayFromTail(true)
      setRepriseEnCours(true)
      // Filet : si la boucle ne rend jamais la main (fil demonte en pleine reprise), le fil ne doit
      // PAS rester invisible. Le masque tombe de toute facon.
      const filet = window.setTimeout(() => setRepriseEnCours(false), 800)
      requestAnimationFrame(() =>
        restaurerPositionLecture(
          scroll,
          aRestaurer,
          requestAnimationFrame,
          20,
          () => {
            window.clearTimeout(filet)
            setRepriseEnCours(false)
          },
          () => mesurerMessagesRendus(scroll)
        )
      )
      return
    }
    if (!followTailRef.current) {
      setHasNewActivity(true)
      return
    }
    let annulerDescente: (() => void) | undefined
    const frame = requestAnimationFrame(() => {
      // L'utilisateur a pu remonter le fil ENTRE la décision et la frame : on relit son intention au
      // lieu de la présumer. Sans cette relecture, un message qui arrive juste avant un scroll vers
      // le haut le ramène de force en bas et efface le bouton de retour.
      if (!followTailRef.current) return
      // Le troisième argument est le défaut de `scrollChatToBottom` ; on ne le passe que pour atteindre
      // le filet. Si la descente n'atterrit PAS (re-rendu qui repose le fil en haut, contenu qui grandit
      // plus vite qu'on ne descend), le texte tardif — typiquement le bloc de clôture — reste hors
      // champ : le bouton « ↓ Dernière réponse » doit alors le dire, au lieu d'un silence.
      annulerDescente = scrollChatToBottom(scroll, requestAnimationFrame, 40, (landed) => {
        if (!landed) setHasNewActivity(true)
      })
      setHasNewActivity(false)
      setScrolledAwayFromTail(false)
    })
    // UNE SEULE descente vivante. Chaque delta de streaming re-déclenche cet effet ; sans cette
    // annulation, les boucles s'empilaient sur le même conteneur et se contredisaient frame par
    // frame — le fil VIBRAIT juste après l'envoi (rapporté le 2026-08-30).
    return () => {
      cancelAnimationFrame(frame)
      annulerDescente?.()
    }
  }, [messages, activeDirectiveReceipts])

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
      setConvLoad({ status: 'error', target: c, error: 'conversation introuvable dans le store' })
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
    activeRef.current = c.id
    setActiveId(c.id)
    const branchMessages = detailed.messages ?? []
    const duStore = hydraterFilStocke(branchMessages)
    // Un rechargement ne RÉTRÉCIT pas le fil à zéro : le vide du store est une absence d'information,
    // pas une conversation vidée.
    const relu =
      duStore.length === 0 && filDeRepli && filDeRepli.length > 0 ? [...filDeRepli] : duStore
    const stored = liveMessagesRef.current.get(c.id) ?? relu
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
   * dans l'autre : un tour reellement en vol n'est pas touche, un tour mort est clos.
   *
   * Best-effort : si la sonde echoue, on ne change rien — mieux vaut un indicateur trop prudent qu'un
   * tour vivant declare mort.
   */
  async function reconcilierTourNonClos(id: string): Promise<void> {
    const messages = liveMessagesRef.current.get(id) ?? []
    const dernier = [...messages].reverse().find((message) => message.role === 'assistant')
    if (!dernier || (dernier as AsstMsg).done) return
    try {
      const sonde = await window.api.pilotChatActive?.(id)
      if (sonde?.active !== false) return
    } catch {
      return
    }
    if (activeRef.current !== id && !liveMessagesRef.current.has(id)) return
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
   * La liste informait sans permettre d'agir : elle deplacait le probleme sur lui. Le bouton depose
   * desormais un prompt dans une conversation NEUVE, sans l'envoyer -- meme regle que la vue Tickets,
   * pour la meme raison : preparer un prompt qu'il ne voit pas serait inutile.
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
    requestAnimationFrame(() => composerRef.current?.focus())
  }

  /**
   * OUVRIR une conversation DE PLUS dans la mosaique (elle ne remplace pas l'active). Le fil vient
   * du cache vivant s'il existe, sinon du store : une fenetre vide le temps d'un aller-retour IPC
   * serait indiscernable d'une conversation reellement vide.
   */
  async function ouvrirDansMosaique(id: string): Promise<void> {
    if (!mosaicIdsRef.current.includes(id)) mosaicIdsRef.current = [...mosaicIdsRef.current, id]
    setMosaicIds((courant) => (courant.includes(id) ? courant : [...courant, id]))
    const cache = liveMessagesRef.current.get(id)
    if (cache) {
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
      title: 'Nouvelle conversation',
      category: identity.provider,
      provider: identity.provider
    })
    setConvs((courant) =>
      courant.some((c) => c.id === creee.id)
        ? courant
        : [{ ...creee, updatedAt: Date.now(), messages: [] } as unknown as Conv, ...courant]
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

  function newConv(): void {
    loadConversationRequestRef.current += 1
    resetConvLoad()
    followTailRef.current = true
    setHasNewActivity(false)
    activeRef.current = null
    setActiveId(null)
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
    return () => {
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
    const current = liveMessagesRef.current.get(conversationId) ?? []
    // Dédup par TOUR, pas par texte : `JSON.stringify(message).includes(80 premiers caractères)`
    // sérialisait tout le fil à chaque rejeu ET se trompait dans les deux sens — deux tours au
    // préambule identique se masquaient, un tour reformulé à la persistance se dupliquait.
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
      const detail = (event as CustomEvent<{ conversationId?: string; turnId?: string }>).detail
      const id = detail?.conversationId
      if (!id) return
      const target = convsRef.current.find((conversation) => conversation.id === id)
      if (target) void loadConv(target)
      // REJEU du journal : l'app était fermée pendant le tour → le store n'a pas reçu ces événements,
      // seul le journal fichier les contient. On reconstruit le texte produit et on l'affiche.
      if (detail?.turnId) void replayTurnJournal(id, detail.turnId)
    }
    window.addEventListener('autowin:open-conversation', openConversation)
    return () => window.removeEventListener('autowin:open-conversation', openConversation)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function renameConv(c: Conv): Promise<void> {
    const t = prompt('Nouveau titre', c.title)
    if (t && t.trim()) {
      await window.api.conversationsRename(c.id, t.trim())
      await refreshConvs()
    }
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
        throw new Error('Conversation introuvable pour ce RUN')
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
    const forked = (await window.api.conversationsFork(activeId, messageId)) as Conv | undefined
    const fresh = (await window.api.conversations()) as Conv[]
    setConvs(fresh)
    const target = (forked?.id && fresh.find((c) => c.id === forked.id)) || undefined
    if (target) void loadConv(target)
    else await reloadActiveFromStore(activeId) // fork refusé : on reste où on est
  }
  /**
   * PARITÉ claude.exe (demande du 2026-08-21) : le message tapé pendant un tour ORIENTE le tour en
   * cours, il n'est PLUS mis en file. C'est exactement le chemin `/btw` — même IPC `injectDirective`,
   * même reçu — donc plus deux comportements pour un seul geste. La file survit uniquement comme
   * REPLI de `submitBtw` quand l'injection est refusée (rien n'est perdu), et ses actions manuelles
   * (🧭 Orienter, ⏹ Interrompre et envoyer) restent disponibles sur ces entrées de repli.
   */
  function queueCurrentMessage(): void {
    if (!activeId) return
    const input = texteDuComposer()
    if (!input.trim()) return
    // Une question `ask` encore ouverte au bout du fil : ce texte y REPOND, meme tape a la main.
    // Sans ce test, seul le clic sur un bouton comptait comme reponse et le reçu disait « Orienté ».
    void submitBtw(input, 'normal', askEnAttente(liveMessagesRef.current.get(activeId) ?? []))
  }

  /**
   * Interrompre le tour en cours → la file se draine depuis le début via l'effet `busy→false`
   * (le message choisi + ses antérieurs partent d'abord ; les postérieurs suivent en auto-drain).
   * Sert au bouton « Interrompre et envoyer tout » (en tête de file) ET aux boutons par-message.
   */
  /** `cible` : la mosaique arrete une fenetre NON active — sans elle, Stop viserait l'autre fil. */
  function interruptAndFlushQueue(cible?: string): void {
    const id = cible ?? activeRef.current
    if (!id || interruptingConversationsRef.current.has(id)) return
    // Rien à interrompre → ne PAS armer l'état « interruption en cours ». Sans cette garde, le
    // drapeau n'est remis à false que par la transition `busy→false` de l'effet de drain : hors tour
    // actif, cette transition n'arrive jamais et les boutons restent figés sur « ⏳ Interruption… »
    // pour toujours, file bloquée. Constaté sur une file survivante à un changement de conversation.
    if (!busyConversationsRef.current.has(id)) return
    // Ce nouveau geste explicite remplace un éventuel Stop simple raté : la file doit désormais
    // partir dès la fin du tour, même si le premier IPC avait laissé son gel one-shot armé.
    stoppedQueueDrainRef.current.delete(id)
    setConversationInterrupting(id, true)
    void window.api
      .cancelPilotChat(id)
      .then((result) => {
        if (result?.ok === false) libererTourFantome(id)
        else armerReprisesStop(id)
      })
      .catch(() => setConversationInterrupting(id, false))
  }

  /**
   * TOUR FANTOME : le renderer se croit occupe, le main dit que rien ne tourne.
   *
   * `os:pilotChat:cancel` rend `{ ok: pilotAborted || orchestrationAborted }` : un `ok: false` n'est
   * pas un echec d'annulation, c'est la PREUVE — venant du processus qui detient la verite — qu'il
   * n'y avait aucun tour ni orchestration a couper. Cette reponse etait jetee : on ne relachait que
   * le libelle « Arret… » en laissant `busy` arme. Consequences vecues par l'utilisateur le 20/08 :
   * l'indicateur « 1 action en cours » restait colle alors que le panneau Sous-agents etait vide,
   * les messages tapes partaient EN FILE au lieu d'etre envoyes, et le bouton Stop ne pouvait plus
   * rien debloquer — la conversation etait definitivement muette.
   *
   * On passe par `patchLast`, l'entonnoir unique : `done = true` y declenche `settleIfDone`, donc les
   * actions sans issue deviennent `interrupted` et cessent de se lire « en cours ». L'issue ne
   * viendra jamais — le dire est la verite, la maquiller en echec constate (`ok: false`) serait faux.
   */
  function libererTourFantome(id: string): void {
    setConversationInterrupting(id, false)
    if (!busyConversationsRef.current.has(id)) return
    setConversationBusy(id, false)
    /**
     * Le VERROU D'ENVOI aussi, sans quoi la conversation reste muette par un autre chemin.
     *
     * `sendLocksRef` n'est relache que dans le `finally` de l'envoi, donc a la resolution de l'appel
     * IPC. Or c'est precisement ce cas-la qu'on traite : le main affirme que rien ne tourne pendant
     * que la promesse du renderer, elle, ne revient pas. Liberer `busy` sans liberer le verrou rend
     * l'interface debloquee EN APPARENCE — le bouton Envoyer repond, et il ne part rien. Le defaut
     * du 20/08 se serait rejoue d'un cran plus bas, en plus silencieux.
     *
     * Sur : le verrou existe pour empecher un DOUBLE envoi ; quand l'autorite dit qu'aucun tour ne
     * tourne, un second envoi est legitime. Si la promesse d'origine revient plus tard, son `finally`
     * supprime une cle deja absente — sans effet.
     */
    sendLocksRef.current.delete(id)
    patchLast(id, (message) => {
      message.done = true
      if (message.status === 'streaming') message.status = 'interrupted'
    })
  }

  /**
   * VEILLE sur les tours declares vivants : la sonde d'autorite tire aussi SANS changer de vue.
   *
   * DEFAUT VECU le 20/08 : « la conversation affiche une action en cours quand le workflow est
   * arrete ». La reconciliation existait deja (`reconcilierTourNonClos`, `libererTourFantome`) mais
   * ses deux seuls declencheurs sont l'OUVERTURE d'une conversation et un geste Stop. Sur la
   * conversation deja ouverte — celle qu'on regarde — un tour qui meurt sans rendre son evenement de
   * fin (workflow arrete, evenement perdu, main redemarre) n'etait interroge par personne : le badge
   * tournait jusqu'a un changement de conversation ou un redemarrage de l'app.
   *
   * DEUX sondes negatives consecutives sont exigees avant de clore : le renderer passe `busy` AVANT
   * que le main ait enregistre le controleur du tour (meme course que le `waitForActive(500)` de
   * l'injection), donc une seule sonde pourrait tuer un tour qui demarre.
   */
  useEffect(() => {
    if (!busyConversations.size) return
    const manques = new Map<string, number>()
    const timer = window.setInterval(() => {
      for (const id of busyConversationsRef.current) {
        void (async () => {
          let active: boolean
          try {
            const sonde = await window.api.pilotChatActive?.(id)
            // Sonde absente ou en echec : on ne declare pas mort ce qu'on n'a pas pu verifier.
            if (sonde?.active !== false) {
              manques.delete(id)
              return
            }
            active = false
          } catch {
            manques.delete(id)
            return
          }
          if (active) return
          const negatives = (manques.get(id) ?? 0) + 1
          manques.set(id, negatives)
          if (negatives < 2) return
          manques.delete(id)
          libererTourFantome(id)
        })()
      }
    }, TOUR_VIVANT_SONDE_MS)
    return () => window.clearInterval(timer)
  }, [busyConversations])

  /**
   * BORNE le libelle « Arret... ».
   *
   * DEFAUT VECU : `cancelPilotChat` repond `ok: true` (l'annulation A ete prise en charge) mais le
   * tour ne meurt pas — le pilote est bloque dans un appel provider ou dans `orchestrate`, sur
   * lequel l'abort n'a aucune prise. `interrupting` n'est alors relache par PERSONNE : le bouton
   * reste ecrit « Arret... », DESACTIVE, pour toujours — l'utilisateur ne peut meme plus recliquer.
   *
   * On ne masque pas la cause (le tour tourne vraiment) : on rend seulement la MAIN. Passe le delai,
   * si le tour est encore vivant, le bouton redevient cliquable pour un second Stop ; la veille des
   * tours fantomes reste seule juge de la liberation de `busy`.
   */
  function armerReprisesStop(id: string): void {
    window.setTimeout(() => {
      if (!interruptingConversationsRef.current.has(id)) return
      if (!busyConversationsRef.current.has(id)) return
      setConversationInterrupting(id, false)
    }, STOP_REARMEMENT_MS)
  }

  /** Stop simple : annule le tour sans transformer la file en relance automatique. */
  /** `cible` : en mosaique, Stop vise SA fenetre — sinon il couperait le tour de la conversation active. */
  function stopPilotTurn(cible?: string): void {
    const id = cible ?? activeRef.current
    if (
      !id ||
      interruptingConversationsRef.current.has(id) ||
      !busyConversationsRef.current.has(id)
    )
      return
    stoppedQueueDrainRef.current.add(id)
    setConversationInterrupting(id, true)
    // Même si l'IPC perd la course avec la fin réelle du tour, le geste Stop garde la file.
    // En revanche, libère le feedback « Arrêt… » si aucune annulation n'a été prise en charge.
    void window.api
      .cancelPilotChat(id)
      .then((result) => {
        if (result?.ok === false) libererTourFantome(id)
        else armerReprisesStop(id)
      })
      .catch(() => setConversationInterrupting(id, false))
  }

  /**
   * L'issue HONNETE d'une injection acceptee.
   *
   * `injectDirective` repond `ok` des que la directive est empilee et qu'un tour est actif. Mais un
   * RUN ne peut pas la lire : le pilote ne draine les directives qu'entre deux de ses iterations, et
   * pendant une orchestration il est bloque dans l'appel `orchestrate` — l'orchestrateur n'ayant
   * aucune prise dessus. Annoncer « Oriente » ici est ce qui faisait dire « j'ai oriente et rien ne
   * se passe » (20/08). On distingue donc les deux cas au lieu de les confondre.
   */
  function issueDeLInjection(conversationId: string): 'sent' | 'differee' {
    return liveRuns[conversationId]?.status === 'running' ? 'differee' : 'sent'
  }

  /**
   * ORIENTER SANS INTERROMPRE : injecte le message comme directive dans le tour EN COURS
   * (drainée à l'itération suivante du pilote) sans l'annuler, puis le retire de la file.
   * Différent de « Interrompre et envoyer » qui coupe le tour.
   */
  async function steerWithoutInterrupt(entry: QueuedDirective): Promise<void> {
    const id = activeRef.current
    if (!id) return
    const original = queueRef.current.get(id) ?? []
    const originalIndex = original.findIndex((queued) => queued.id === entry.id)
    if (originalIndex < 0) return
    // L'injection est un aller-retour IPC : sans état d'attente, le clic ne rend RIEN de visible et
    // rien n'empêche de recliquer (double injection de la même directive dans le tour).
    if (steeringRef.current.has(entry.id)) return
    setDirectiveSteering(entry.id, true)
    followTailRef.current = true
    setHasNewActivity(false)
    setDirectiveReceipt(id, entry, 'sending')
    const settle = (): void => setDirectiveSteering(entry.id, false)
    setConversationQueue(
      id,
      original.filter((queued) => queued.id !== entry.id)
    )
    const restore = (): void => {
      const current = queueRef.current.get(id) ?? []
      if (current.some((queued) => queued.id === entry.id)) return
      const next = current.slice()
      next.splice(Math.min(originalIndex, next.length), 0, entry)
      setConversationQueue(id, next)
    }
    let result: { ok: boolean }
    try {
      result = await window.api.injectDirective(id, entry.text)
    } catch (error) {
      traceSilentFailure('inject-directive', error)
      restore()
      setDirectiveReceipt(id, entry, 'failed')
      settle()
      return
    }
    if (!result.ok) {
      restore()
      setDirectiveReceipt(id, entry, 'failed')
    } else {
      setDirectiveReceipt(id, entry, issueDeLInjection(id))
    }
    settle()
  }

  function restoreQueuedMessageToDraft(entry: QueuedDirective): void {
    const id = activeRef.current
    if (!id) return
    const draftKey = composerDraftKeyRef.current
    const draft = getComposerDraft(draftKey).input
    setDraftInput(draftKey, draft ? `${draft}\n\n${entry.text}` : entry.text)
    const q = queueRef.current.get(id) ?? []
    setConversationQueue(
      id,
      q.filter((queued) => queued.id !== entry.id)
    )
  }

  /** Réordonne la file d'un cran. L'ordre de frappe n'est plus une fatalité. */
  function moveQueuedMessage(entry: QueuedDirective, delta: -1 | 1): void {
    const id = activeRef.current
    if (!id) return
    const q = queueRef.current.get(id) ?? []
    const next = moveQueueEntry(q, entry.id, delta)
    if (next === q) return
    setConversationQueue(id, next)
  }

  function moveQueuedMessageToBtw(entry: QueuedDirective): void {
    const id = activeRef.current
    if (!id) return
    const q = queueRef.current.get(id) ?? []
    if (!q.some((queued) => queued.id === entry.id)) return
    setConversationQueue(
      id,
      q.filter((queued) => queued.id !== entry.id).concat({ ...entry, mode: 'btw' })
    )
  }

  /**
   * `/btw <texte>` — parité CLAUDE CODE : écrire pendant que l'agent travaille LIVRE le message
   * DANS LE TOUR EN COURS (drainé à l'itération suivante du pilote), sans l'interrompre. Ce n'est
   * donc PAS une mise en file : l'agent en tient compte immédiatement.
   * Repli : si l'injection échoue (tour non injectable), on enfile pour ne rien perdre.
   * Idle (aucun tour) → envoi normal.
   */
  async function submitBtw(
    body: string,
    // Mode du REPLI en file si l'injection échoue. `/btw` garde 'btw' (« celui-là passe en dernier ») ;
    // un message ORDINAIRE tapé pendant le tour doit, lui, retomber en file NORMALE — sinon le repli
    // le marquait btw et l'ordre de la file mentait sur ce que l'utilisateur avait tapé.
    repli: 'btw' | 'normal' = 'btw',
    /** Ce texte repond a une question `ask` — le reçu doit dire « Répondu », pas « Orienté ». */
    reponse = false,
    /**
     * CIBLE explicite : en mosaique, la fenetre qui oriente n'est pas forcement la conversation
     * ACTIVE. Sans elle, « Orienter » d'une case n'injectait nulle part (onQueue etait un no-op).
     */
    cible?: string
  ): Promise<void> {
    const replimode: QueuedDirective['mode'] = repli === 'btw' ? 'btw' : undefined
    const text = body.trim()
    const cleDraft = cible ?? composerDraftKeyRef.current
    if (!text) {
      setDraftInput(cleDraft, '') // "/btw" seul → rien à injecter, on nettoie
      return
    }
    const id = cible ?? activeRef.current
    if (!id) return
    const occupe = cible ? busyConversationsRef.current.has(cible) : busy
    if (!occupe) {
      // aucun tour en cours → le texte part comme message normal
      void send(text, cible ? { targetConversationId: cible } : undefined)
      return
    }
    setDraftInput(cleDraft, '')
    // REÇU, comme `steerWithoutInterrupt` : les deux chemins appellent la MÊME IPC `injectDirective`,
    // et seul l'autre en rendait compte. Sans ce reçu, le texte quittait le composer et RIEN
    // n'apparaissait dans le fil — d'où « je clique et ça devrait m'envoyer le message et me donner une
    // réponse ». Une divergence entre deux chemins du même mécanisme, pas un oubli isolé.
    // Même compteur que la file : un reçu et une entrée de file ne doivent jamais partager un id,
    // sinon le repli en file (ci-dessous) écraserait le reçu qu'on vient de poser.
    const entry: QueuedDirective = { id: nextQueueEntryIdRef.current++, text, mode: replimode }
    setDirectiveReceipt(id, entry, 'sending', reponse)
    let injected = false
    try {
      injected = (await window.api.injectDirective(id, text))?.ok === true
    } catch (error) {
      traceSilentFailure('inject-directive:btw', error)
      injected = false
    }
    // Repli explicite : l'injection a échoué → file d'attente (drainée en fin de tour), rien n'est perdu.
    if (!injected) enqueueMessage(id, text, replimode)
    setDirectiveReceipt(id, entry, injected ? issueDeLInjection(id) : 'failed', reponse)
  }
  /** True (et déclenche submitBtw) si le composer commence par `/btw` ; sinon false (submit normal). */
  function handleBtw(): boolean {
    const parsed = parseBtw(texteDuComposer())
    if (!parsed.isBtw) return false
    void submitBtw(parsed.body)
    return true
  }
  // À la libération de `busy` (render frais, busy=false), on draine la FILE D'ATTENTE — un message
  // par tour (chacun = sa propre paire Q/R). Vaut aussi bien pour l'auto-drain fin de tour que pour
  // une interruption manuelle (les deux passent par une transition busy→false).
  useEffect(() => {
    const id = activeRef.current
    if (!id) return
    if (busy) return
    if (interruptingConversationsRef.current.has(id)) setConversationInterrupting(id, false)
    if (stoppedQueueDrainRef.current.delete(id)) return
    const queued = queueRef.current.get(id)
    if (!queued || queued.length === 0) return
    const [nextMessage, ...rest] = queued
    setConversationQueue(id, rest)
    // Le drain n'est PAS un geste de l'utilisateur : il ne doit rien prendre au composer.
    void send(nextMessage.text, { keepComposerDraft: true })
    // `activeId` AUTANT que `busy` : une file remplie pendant le tour de A survit à un aller-retour
    // vers une autre conversation. Le tour de A se terminant PENDANT l'absence, la transition
    // busy→false ne concerne plus A — sans `activeId` la file restait échouée là, et il fallait
    // renvoyer les messages à la main. Sûr par construction : les files vivent dans un `useRef` (rien
    // sur disque), donc un redémarrage ne peut pas ressusciter une file oubliée et envoyer à l'insu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, activeId])

  // Callback STABLE (le row est memo'd — une ref inline casserait la mémoïsation).
  const forkRef = useRef(forkFromMessage)
  forkRef.current = forkFromMessage
  const handleFork = useCallback((messageId: string) => void forkRef.current(messageId), [])
  /**
   * Un choix cliqué se comporte comme un message TAPÉ, tour en cours ou non.
   *
   * DÉFAUT VÉCU le 22/08 (conv-1363) : `ask` ne SUSPEND pas le tour — le pilote enchaîne son
   * itération suivante sans attendre la réponse. Le bloc reste donc affiché pendant que la
   * conversation est occupée, et le clic partait dans `send()`, qui sort EN SILENCE sur `busy` :
   * ni file, ni reçu, ni message. « Je clique dans le bloc ask, il se passe rien » — littéralement.
   * Le composer traite déjà ce cas (`submitBtw`, parité claude.exe) ; c'est le même geste, donc le
   * même chemin, y compris son repli en file si l'injection est refusée.
   */
  // `send` est recréé à chaque render → une prop instable casserait le memo de ChatMessageRow.
  // On la stabilise via un ref (même pattern que forkRef), ici comme pour la relance gratuite.
  const sendRef = useRef(send)
  sendRef.current = send
  /**
   * REPRISE APRES UN REDEMARRAGE DEMANDE PAR L'AGENT (`restart_app`).
   *
   * On attend que la liste des conversations soit chargee : la consigne vise une conversation
   * precise, et l'ouvrir avant que le store ait repondu la ferait passer pour disparue. Une seule
   * tentative par demarrage (`repriseTenteeRef`) — le main a deja efface la consigne en la rendant.
   */
  const repriseTenteeRef = useRef(false)
  useEffect(() => {
    if (repriseTenteeRef.current || convs.length === 0) return
    repriseTenteeRef.current = true
    void reprendreApresRedemarrage({
      lire: async () => (await window.api.repriseEnAttente?.()) ?? null,
      ouvrir: async (conversationId) => {
        const cible = convsRef.current.find((conversation) => conversation.id === conversationId)
        if (!cible) return false
        await loadConv(cible)
        return true
      },
      envoyer: async (consigne, conversationId) => {
        await sendRef.current(consigne, { targetConversationId: conversationId })
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convs])
  const pickRef = useRef<(prompt: string) => void>(() => {})
  pickRef.current = (prompt: string) => {
    if (busy) void submitBtw(prompt, 'normal')
    else void sendRef.current(prompt)
  }
  const pickSuggestion = useCallback((prompt: string) => pickRef.current(prompt), [])
  /**
   * REPONDRE A UNE QUESTION `ask` — parite claude.exe : c'est un MESSAGE, jamais une orientation.
   *
   * `ask` clot desormais le tour (cf. `agent-pilot`), donc le cas normal est un envoi ordinaire.
   * Un run peut malgre tout tourner encore (orchestration en vol) : le transport passe alors par
   * l'injection, comme le composer, mais le reçu est marque `reponse` — le fil affiche
   * « ✓ Répondu » et non « ✓ Orienté », qui decrivait un geste que l'utilisateur n'avait pas fait.
   */
  const answerAskRef = useRef<(prompt: string) => void>(() => {})
  answerAskRef.current = (prompt: string) => {
    if (busy) void submitBtw(prompt, 'normal', true)
    else void sendRef.current(prompt)
  }
  const answerAsk = useCallback((prompt: string) => answerAskRef.current(prompt), [])
  /**
   * « Reprendre en précisant… » : REMPLIT le composer (prompt d'origine + motif), et s'arrête là.
   * Aucun envoi, aucune orchestration — le geste appartient à l'utilisateur.
   * Callback STABLE (le row est memo'd) : passe par un ref, comme fork/send.
   */
  const refineDraftRef = useRef<
    (prompt: string, status: TerminalStatus, reason?: string | null) => void
  >(() => {})
  refineDraftRef.current = (prompt, status, reason) => {
    setDraftInput(composerDraftKeyRef.current, buildRefineDraft(prompt, status, reason))
    requestAnimationFrame(() => composerRef.current?.focusAt(-1))
  }
  const refineResumeDraft = useCallback(
    (prompt: string, status: TerminalStatus, reason?: string | null) =>
      refineDraftRef.current(prompt, status, reason),
    []
  )

  /* --- envoi --- */

  function flatten(
    msgs: Msg[]
  ): Array<{ role: 'user' | 'assistant'; content: string; attachments?: ChatAttachment[] }> {
    return msgs.map((m) => {
      if (m.role === 'user') {
        /*
         * LES PIECES JOINTES DES TOURS PASSES TRAVERSENT L'IPC.
         *
         * Avant, cette fonction rendait `{ role, content }` : le process principal ne voyait que
         * les pieces jointes du message COURANT, rattachees a la main juste apres l'appel. Une
         * image jointe au tour 1 etait donc invisible au tour 2 — mesure le 2026-08-27, avec la
         * trace de prompt pour preuve : le tour 2 ne portait AUCUN chemin de piece jointe.
         *
         * Miniature seulement, et jamais le binaire : voir `pieceJointePasseePourLeFil`. Le message
         * courant, lui, garde son original — il est rattache apres coup par l'appelant.
         */
        const passees = (m.attachments ?? [])
          .map((piece) => pieceJointePasseePourLeFil(piece))
          .filter((piece): piece is NonNullable<typeof piece> => piece !== undefined)
        return {
          role: 'user' as const,
          content: m.content,
          ...(passees.length ? { attachments: passees as ChatAttachment[] } : {})
        }
      }
      const content = m.parts
        .map((p) => {
          if (p.kind === 'text') return p.text
          if (p.kind === 'artifact') return `[artefact ${p.artifact.name}]`
          if (p.kind === 'error') return `⚠️ ${p.message}`
          return `[a exécuté ${p.name}${p.ok === false ? ' (échec)' : ''}]`
        })
        .join('\n')
      return { role: 'assistant' as const, content }
    })
  }

  /**
   * `keepComposerDraft` — envoi qui N'EMPRUNTE RIEN au composer : ni son texte en cours de frappe, ni
   * ses pièces jointes, et qui ne le vide pas. Indispensable pour le drain de la file d'attente : il
   * part sur une transition (fin de tour, retour sur la conversation) et non sur un geste de l'utilisateur.
   * Sans cette porte, le drain effaçait un brouillon jamais envoyé et accrochait ses pièces jointes en
   * attente au message de la FILE — deux pertes silencieuses, aucune reliée à une action visible.
   */
  async function send(text?: string, options?: SendOptions): Promise<void> {
    const value = (text ?? texteDuComposer()).trim()
    const sourceConversationId = options?.targetConversationId ?? activeId
    const sendDraftKey = options?.targetConversationId ?? composerDraftKeyRef.current
    const keepComposerDraft = options?.keepComposerDraft === true
    const outgoingDraft = getComposerDraft(sendDraftKey)
    const outgoingAttachments = keepComposerDraft ? [] : outgoingDraft.attachments
    const sendSelectionGeneration = composerSelectionGenerationRef.current
    const sendLockKey = sourceConversationId ?? NEW_DRAFT_KEY
    if (
      (!value && outgoingAttachments.length === 0) ||
      (sourceConversationId ? busyConversationsRef.current.has(sourceConversationId) : busy) ||
      sendLocksRef.current.has(sendLockKey)
    )
      return
    sendLocksRef.current.add(sendLockKey)

    let convId = sourceConversationId
    let messageCommitted = false
    const sourcePreviousMessages = sourceConversationId
      ? (liveMessagesRef.current.get(sourceConversationId) ?? [])
      : messages
    let previousMessagesForTarget = sourcePreviousMessages
    const optimisticHistory: Msg[] = [
      ...sourcePreviousMessages,
      {
        role: 'user',
        content: value,
        attachments: outgoingAttachments.map(
          ({ name, mimeType, size, kind, content, thumbnail }) => ({
            name,
            mimeType,
            size,
            ...(kind === 'image' && { content }),
            ...(thumbnail && { thumbnail })
          })
        )
      },
      hydrateStoredAssistant({ content: '', parts: [], status: 'streaming' })
    ]

    // Commit VISUEL avant tout await : Entrée vide le composer et affiche le prompt sans exposer
    // la latence du classifieur de routage. Ce commit reste local jusqu'à pilotChat.
    if (sourceConversationId) liveMessagesRef.current.set(sourceConversationId, optimisticHistory)
    publierFil(sourceConversationId, optimisticHistory)
    // La LISTE se reordonne au meme instant que le fil. Sans cela, la recence utilisee par la barre
    // laterale (`lastUserMessageAt`) n'arrive qu'au refresh diffuse par le main, donc la conversation
    // ou l'on vient d'ecrire ne remontait pas en tete — constate le 2026-08-30, capture a l'appui.
    // Valeur OPTIMISTE assumee : le prochain rafraichissement du store l'ecrase par la vraie date.
    if (sourceConversationId) {
      const ecritA = Date.now()
      const rafraichir = (liste: Conv[]): Conv[] =>
        liste.map((conversation) =>
          conversation.id === sourceConversationId
            ? { ...conversation, lastUserMessageAt: ecritA, updatedAt: ecritA }
            : conversation
        )
      convsRef.current = rafraichir(convsRef.current)
      setConvs(rafraichir)
    }
    if (!keepComposerDraft) {
      setDraftInput(sendDraftKey, '')
      setDraftAttachments(sendDraftKey, () => [])
      setDraftError(sendDraftKey, null)
    }
    followTailRef.current = true
    if (sourceConversationId) setConversationBusy(sourceConversationId, true)

    try {
      if (convId) {
        const sourceId = convId
        const route = await window.api.routeConversationMessage(
          sourceId,
          value,
          outgoingAttachments.map((attachment) => attachment.name)
        )
        if (route.routed && route.conversationId !== sourceId) {
          convId = route.conversationId
          sendLocksRef.current.add(convId)
          liveMessagesRef.current.set(sourceId, sourcePreviousMessages)
          setConversationBusy(sourceId, false)
          /*
           * Le VERROU D'ENVOI de la source part avec son drapeau `busy` : ce tour ne lui appartient
           * plus. Sans cela il restait pris jusqu'au `finally`, donc jusqu'a la FIN du tour sur la
           * cible — des minutes. La source affichait « Envoyer », bouton actif, et le clic ne faisait
           * RIEN : `send()` sortait en tete sur le verrou. Symptome vecu le 20/08 : « quand une
           * conversation travaille, je peux pas cliquer sur Envoyer dans la conversation B ».
           *
           * Sur : le verrou existe contre un DOUBLE envoi du meme message ; celui-ci est parti
           * ailleurs et la source ne porte plus rien, donc un nouvel envoi est legitime.
           */
          sendLocksRef.current.delete(sendLockKey)
          previousMessagesForTarget = liveMessagesRef.current.get(convId) ?? []
          const shouldAdoptRoutedConversation =
            activeRef.current === sourceId &&
            composerDraftKeyRef.current === sendDraftKey &&
            composerSelectionGenerationRef.current === sendSelectionGeneration
          if (shouldAdoptRoutedConversation) {
            activeRef.current = convId
            setActiveId(convId)
            switchComposerDraft(convId)
          }
        }
      }

      // Pas de conversation active → on en crée une (titre = début du message).
      if (!convId) {
        const identity = await refreshRuntimeIdentity()
        const titleSource = value || outgoingAttachments[0].name
        const title = titleSource.length > 42 ? `${titleSource.slice(0, 42)}…` : titleSource
        const c = await window.api.conversationsCreate({
          title,
          category: identity.provider,
          provider: identity.provider
        })
        convId = c.id
        const shouldAdoptCreatedConversation =
          activeRef.current === null &&
          composerDraftKeyRef.current === sendDraftKey &&
          composerSelectionGenerationRef.current === sendSelectionGeneration
        sendLocksRef.current.add(convId)
        sendLocksRef.current.delete(sendLockKey)
        previousMessagesForTarget = liveMessagesRef.current.get(convId) ?? []
        if (shouldAdoptCreatedConversation) {
          activeRef.current = c.id
          setActiveId(c.id)
          composerDraftKeyRef.current = c.id
          composerDraftsRef.current.set(c.id, { input: '', attachments: [], error: null })
        }
      }

      /*
       * Conversation CREEE D'AVANCE (fenetre mosaique, ouverture directe) : elle porte encore le
       * titre placeholder « Nouvelle conversation », et rien ne la renommait ensuite. C'est le
       * PREMIER message utilisateur qui la nomme — sinon la barre laterale se remplit d'homonymes.
       */
      if (convId && previousMessagesForTarget.length === 0) {
        const cibleRenommage = convId
        const existant = convsRef.current.find((c) => c.id === cibleRenommage)
        if (existant && existant.title === 'Nouvelle conversation') {
          const sourceTitre = value || outgoingAttachments[0]?.name || ''
          const titre = sourceTitre.length > 42 ? `${sourceTitre.slice(0, 42)}…` : sourceTitre
          if (titre.trim()) {
            try {
              await window.api.conversationsRename(cibleRenommage, titre)
              setConvs((courant) =>
                courant.map((c) => (c.id === cibleRenommage ? { ...c, title: titre } : c))
              )
            } catch {
              /* le titre reste le placeholder : jamais bloquant pour l'envoi */
            }
          }
        }
      }

      const history: Msg[] = [
        ...previousMessagesForTarget,
        {
          role: 'user',
          content: value,
          attachments: outgoingAttachments.map(
            ({ name, mimeType, size, kind, content, thumbnail }) => ({
              name,
              mimeType,
              size,
              ...(kind === 'image' && { content }),
              ...(thumbnail && { thumbnail })
            })
          )
        },
        hydrateStoredAssistant({ content: '', parts: [], status: 'streaming' })
      ]
      liveMessagesRef.current.set(convId, history)
      publierFil(convId, history)
      setConversationBusy(convId, true)
      messageCommitted = true
      const payload: Array<{
        role: 'user' | 'assistant'
        content: string
        attachments?: ChatAttachment[]
      }> = flatten(history.slice(0, -1))
      payload[payload.length - 1].attachments = outgoingAttachments
      // Mentions `@run:` / `@fichier:` : le fil garde le texte TAPÉ (lisible), le prompt ENVOYÉ porte
      // en plus le bloc de cibles résolues — désigner au lieu de décrire, sans polluer l'affichage.
      payload[payload.length - 1].content = resolveMentionsForSend(
        payload[payload.length - 1].content,
        mentionSourcesRef.current
      )
      const res = await window.api.pilotChat(payload, convId)
      if (!res.ok || res.cancelled)
        patchLast(convId, (m) => {
          m.status = res.cancelled ? 'cancelled' : 'failed'
          m.done = true
          // Part d'ERREUR structurée (et non plus un `⚠️ …` texte, que rien ne distinguait d'une
          // réponse du modèle) : cause + message, rendus par un bloc `role="alert"` dédié.
          if (!res.cancelled)
            m.parts.push({ kind: 'error', cause: 'turn', message: res.error ?? 'erreur' })
        })
    } catch (error) {
      if (!messageCommitted) {
        if (sourceConversationId) {
          liveMessagesRef.current.set(sourceConversationId, sourcePreviousMessages)
          setConversationBusy(sourceConversationId, false)
        }
        if (convId && convId !== sourceConversationId) {
          liveMessagesRef.current.delete(convId)
          setConversationBusy(convId, false)
        }
        publierFil(sourceConversationId, sourcePreviousMessages)
        setDraftInput(sendDraftKey, value)
        setDraftAttachments(sendDraftKey, () => outgoingAttachments)
        setDraftError(
          sendDraftKey,
          `Envoi impossible : ${error instanceof Error ? error.message : String(error)}`
        )
      } else if (convId) {
        patchLast(convId, (m) => {
          m.status = 'failed'
          m.done = true
          m.parts.push({
            kind: 'error',
            cause: 'send',
            message: error instanceof Error ? error.message : String(error)
          })
        })
      }
    } finally {
      sendLocksRef.current.delete(sendLockKey)
      if (convId) sendLocksRef.current.delete(convId)
      if (messageCommitted && convId) {
        // Les derniers événements pilote peuvent encore être EN VOL (IPC) quand la promesse
        // se résout : on les laisse se réduire AVANT de finaliser et de couper la garde busy,
        // sinon la fin de la réponse est silencieusement perdue (course busy-flag).
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
        patchLast(convId, (m) => {
          if (m.status === 'streaming') m.status = 'interrupted'
          m.done = true
          // Un tour annulé/interrompu porte désormais son propre libellé terminal (msg-terminal) :
          // le remplissage « aucune réponse » ferait doublon et masquerait la vraie raison.
          if (m.parts.length === 0 && m.status !== 'cancelled' && m.status !== 'interrupted')
            m.parts.push({ kind: 'text', text: '_(aucune réponse)_' })
        })
        setConversationBusy(convId, false)
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
        const rendered = [...(liveMessagesRef.current.get(convId) ?? [])]
          .reverse()
          .find((message) => message.role === 'assistant') as AsstMsg | undefined
        const renderedText =
          rendered?.parts
            .filter((part) => part.kind === 'text')
            .map((part) => part.text)
            .join('\n') ?? ''
        if (renderedText.trim()) await window.api.markResponseDisplayed(convId, renderedText)
      }
    }
  }

  /** Continue le fil sans recréer ni renvoyer le dernier message utilisateur. */
  async function resumePilotTurn(): Promise<void> {
    const conversationId = activeRef.current
    if (
      !conversationId ||
      busyConversationsRef.current.has(conversationId) ||
      sendLocksRef.current.has(conversationId)
    )
      return
    const history: Msg[] = [
      ...(liveMessagesRef.current.get(conversationId) ?? []),
      hydrateStoredAssistant({ content: '', parts: [], status: 'streaming' })
    ]
    sendLocksRef.current.add(conversationId)
    liveMessagesRef.current.set(conversationId, history)
    publierFil(conversationId, history)
    setConversationBusy(conversationId, true)
    followTailRef.current = true
    try {
      const result = await window.api.resumePilotChat(conversationId)
      if (!result.ok || result.cancelled)
        patchLast(conversationId, (message) => {
          message.status = result.cancelled ? 'cancelled' : 'failed'
          message.done = true
          if (!result.cancelled)
            message.parts.push({ kind: 'error', cause: 'turn', message: result.error ?? 'erreur' })
        })
    } catch (error) {
      patchLast(conversationId, (message) => {
        message.status = 'failed'
        message.done = true
        message.parts.push({
          kind: 'error',
          cause: 'send',
          message: error instanceof Error ? error.message : String(error)
        })
      })
    } finally {
      sendLocksRef.current.delete(conversationId)
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
      patchLast(conversationId, (message) => {
        if (message.status === 'streaming') message.status = 'interrupted'
        message.done = true
      })
      setConversationBusy(conversationId, false)
    }
  }

  /* --- workflows --- */

  async function viewRun(r: RunEntry): Promise<void> {
    // Fil des sous-agents (trace) d'abord ; à défaut, le RUN.md brut.
    try {
      const trace = (await window.api.runTrace(r.path)) as OrchStep[] | null
      setOpenTrace(trace && trace.length > 0 ? trace : null)
    } catch (error) {
      traceSilentFailure('run-trace', error)
      setOpenTrace(null)
    }
    try {
      setOpenRun(await window.api.readNodeFile(r.path))
    } catch (e) {
      setOpenRun({ path: r.path, content: String(e) })
    }
  }

  /* --- rendu --- */

  const active = convs.find((c) => c.id === activeId)

  const latestAssistant = [...messages]
    .reverse()
    .find((message): message is AsstMsg => message.role === 'assistant')
  // Le composer y ajoute « et rien n'est tapé, aucune pièce jointe » : ces deux-là sont chez lui.
  const resumeAvailable =
    !busy &&
    Boolean(activeId) &&
    (latestAssistant?.status === 'cancelled' || latestAssistant?.status === 'interrupted')
  // « Plus récentes » = là où L'UTILISATEUR a parlé en dernier, pas la dernière touche : ranger une
  // conversation dans un dossier bougeait `updatedAt` et la propulsait en tête (2026-08-18).
  /** Handles des composers de la mosaique — un par fenetre, pour vider le champ apres envoi. */
  const composersMosaiqueRef = useRef(new Map<string, ChatComposerHandle>())

  /**
   * Pieces jointes de CHAQUE brouillon ouvert en mosaique. Recalculees sur `draftsVersion` : la
   * source de verite reste `composerDraftsRef`, on n'en duplique pas une seconde copie.
   */
  const piecesJointesMosaique = useMemo<Record<string, ChatAttachment[]>>(
    () => Object.fromEntries(mosaicIds.map((id) => [id, getComposerDraft(id).attachments])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mosaicIds, draftsVersion]
  )

  /**
   * LE VRAI composer, une instance par fenetre — c'est ce qui garantit zero divergence entre la
   * mosaique et le chat plein : memes palettes `/` et `@`, memes pieces jointes, meme brouillon
   * (`composerDraftsRef` est deja indexe par conversation).
   */
  /** Vide le champ d'UNE fenetre (etat interne du composer + brouillon partage). */
  function viderComposerMosaique(id: string): void {
    composersMosaiqueRef.current.get(id)?.setInput('')
    setDraftInput(id, '')
  }

  function rendreComposerMosaique(id: string): React.ReactNode {
    const occupe = busyConversations.has(id)
    const fichiers = piecesJointesMosaique[id] ?? []
    return (
      <ChatComposer
        ref={(handle) => {
          if (handle) composersMosaiqueRef.current.set(id, handle)
          else composersMosaiqueRef.current.delete(id)
        }}
        busy={occupe}
        hasActiveConversation
        resumeAvailable={false}
        attachmentCount={fichiers.length}
        mentionSources={mentionSources}
        skillCommands={skillCommands}
        ghostRecommendation={ghostDuFil(mosaicFils[id] ?? [])}
        placeholderPendantTour={occupe}
        onDraftInput={(value) => setDraftInput(id, value)}
        onDraftPresence={() => {}}
        onBtw={() => {
          const parsed = parseBtw(getComposerDraft(id).input)
          if (!parsed.isBtw) return false
          viderComposerMosaique(id)
          void submitBtw(parsed.body, 'btw', false, id)
          return true
        }}
        onSend={() => {
          const texte = getComposerDraft(id).input
          viderComposerMosaique(id)
          void send(texte, { targetConversationId: id })
        }}
        onQueue={() => {
          const texte = getComposerDraft(id).input
          if (!texte.trim()) return
          viderComposerMosaique(id)
          void submitBtw(texte, 'normal', askEnAttente(mosaicFils[id] ?? []), id)
        }}
        onResume={() => {}}
        onPaste={(files) => void addFiles(files, id)}
        attachmentsNode={
          fichiers.length > 0 ? (
            <div className="attachment-list pending">
              {fichiers.map((file, fileIndex) => (
                <span
                  className={`attachment-chip${file.kind === 'image' ? ' has-thumb' : ''}`}
                  key={`${file.name}-${fileIndex}`}
                >
                  <span aria-hidden="true">▤</span>
                  <span className="attachment-name">{file.name}</span>
                  <small>{formatFileSize(file.size)}</small>
                  <button
                    type="button"
                    onClick={() =>
                      setDraftAttachments(id, (current) =>
                        current.filter((_, index) => index !== fileIndex)
                      )
                    }
                    aria-label={`Retirer ${file.name}`}
                    title="Retirer"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null
        }
        errorNode={
          getComposerDraft(id).error ? (
            <div className="attachment-error">{getComposerDraft(id).error}</div>
          ) : null
        }
        stopNode={
          occupe ? (
            <button
              type="button"
              className="btn composer-stop"
              data-testid="composer-stop"
              onClick={() => stopPilotTurn(id)}
              disabled={interruptingConversations.has(id)}
              title="Arrêter ce tour"
            >
              {interruptingConversations.has(id) ? 'Arrêt…' : '■ Stop'}
            </button>
          ) : null
        }
      />
    )
  }

  /** Fenetres de la mosaique, dans l'ordre d'ouverture, avec leur fil peint et leur etat occupe. */
  const fenetresMosaique = useMemo<ChatMosaicWindow[]>(
    () =>
      mosaicIds.map((id) => ({
        id,
        title: convs.find((c) => c.id === id)?.title ?? id,
        messages: mosaicFils[id] ?? [],
        busy: busyConversations.has(id)
      })),
    [mosaicIds, mosaicFils, convs, busyConversations]
  )

  /**
   * RAPPELS STABLES POUR LA MOSAIQUE (conv-1581, le gel).
   *
   * `ChatMosaic` memoise chaque fenetre : le memo ne mord QUE si les rappels gardent la meme
   * reference d'un rendu a l'autre. Ces trois-la sont redefinis a chaque rendu de ChatView — d'ou
   * le passage par une ref « derniere version », le meme motif que `forkRef`/`pickRef`.
   */
  const rappelsMosaiqueRef = useRef({
    fermer: fermerFenetreMosaique,
    ouvrirSeule: ouvrirSeuleDepuisMosaique,
    nouvelle: nouvelleFenetreMosaique,
    composer: rendreComposerMosaique
  })
  rappelsMosaiqueRef.current = {
    fermer: fermerFenetreMosaique,
    ouvrirSeule: ouvrirSeuleDepuisMosaique,
    nouvelle: nouvelleFenetreMosaique,
    composer: rendreComposerMosaique
  }
  const fermerFenetreStable = useCallback(
    (id: string) => rappelsMosaiqueRef.current.fermer(id),
    []
  )
  const ouvrirSeuleStable = useCallback(
    (id: string) => void rappelsMosaiqueRef.current.ouvrirSeule(id),
    []
  )
  const nouvelleFenetreStable = useCallback(() => void rappelsMosaiqueRef.current.nouvelle(), [])
  const rendreComposerStable = useCallback(
    (id: string) => rappelsMosaiqueRef.current.composer(id),
    []
  )
  /**
   * Ce qui oblige un composer a se redessiner SANS passer par `fenetre` : brouillons et pieces
   * jointes (`draftsVersion`), palettes `@` et `/`. Le fil et l'etat occupe, eux, sont deja dans
   * `fenetre` — donc absents d'ici a dessein.
   */
  const versionMentionsRef = useRef(0)
  const mentionsPrecedentesRef = useRef(mentionSources)
  if (mentionsPrecedentesRef.current !== mentionSources) {
    mentionsPrecedentesRef.current = mentionSources
    versionMentionsRef.current += 1
  }
  const signatureComposerMosaique = `${draftsVersion}|${versionMentionsRef.current}|${skillCommands.length}`

  /**
   * Ce que le RENDERER ne peut pas savoir : quelles conversations CONTIENNENT le terme.
   *
   * La liste laterale est une projection sans `messages` (`ConversationSummary`) -- chercher
   * localement ne voyait donc que le titre, c'est-a-dire le debut du premier prompt. Le processus
   * principal, lui, a tout le corpus en memoire : on lui demande la carte id -> extrait.
   */
  const [correspondancesContenu, setCorrespondancesContenu] = useState<Map<string, string>>(
    () => new Map()
  )
  useEffect(() => {
    const terme = convQuery.trim()
    if (!terme) {
      setCorrespondancesContenu(new Map())
      return
    }
    // Le pont peut ne pas exposer ce canal (preload ancien, harnais de test) : la liste doit alors
    // rester utilisable en recherche locale, pas jeter une exception depuis un timer.
    const chercherContenu = window.api?.conversationsSearchContent
    if (typeof chercherContenu !== 'function') return
    let annule = false
    // Anti-rebond : une frappe ne doit pas declencher un parcours du corpus par caractere.
    const minuterie = setTimeout(() => {
      void Promise.resolve()
        .then(() => chercherContenu(terme))
        .then((resultats) => {
          if (annule) return
          setCorrespondancesContenu(new Map(resultats.map((r) => [r.id, r.extrait])))
        })
        .catch(() => {
          // Une recherche de contenu indisponible ne doit pas casser la liste : on retombe sur la
          // recherche locale (titre / id), qui reste juste, seulement moins large.
          if (!annule) setCorrespondancesContenu(new Map())
        })
    }, 160)
    return () => {
      annule = true
      clearTimeout(minuterie)
    }
  }, [convQuery])

  const conversationHits = useMemo(
    () =>
      trierParRecenceUtilisateur(
        searchConversations(convs, convQuery, undefined, correspondancesContenu),
        conversationDateOrder
      ),
    [convs, convQuery, conversationDateOrder, correspondancesContenu]
  )

  /**
   * Repli des groupes, PERSISTÉ. Le redéplier à chaque ouverture annulerait tout le bénéfice :
   * l'utilisateur replie « Auto-kaizen » pour ne plus le voir, pas pour le refermer chaque matin.
   * `localStorage` et non le store disque : c'est une préférence d'affichage locale, elle n'a rien à
   * faire dans `conversations.json` que d'autres chemins relisent.
   */
  const [groupesReplies, setGroupesReplies] = useState<Record<string, boolean>>(() => {
    try {
      const brut = localStorage.getItem('autowin.conv-groups.collapsed')
      // Canonise a la LECTURE : un etat enregistre avant la canonisation des chemins porte encore
      // `C:/Clients`, alors que le groupe s'appelle desormais `C:\Clients`. Sans cela, tout se deplie.
      return brut ? canoniserReplis(JSON.parse(brut) as Record<string, boolean>) : {}
    } catch {
      // Un JSON corrompu ne doit pas empêcher la liste de s'afficher : on repart des défauts.
      return {}
    }
  })
  const basculerGroupe = useCallback((key: string, replieActuel: boolean): void => {
    setGroupesReplies((courant) => {
      const suivant = { ...courant, [key]: !replieActuel }
      try {
        localStorage.setItem('autowin.conv-groups.collapsed', JSON.stringify(suivant))
      } catch (error) {
        // Quota plein ou stockage indisponible : le repli reste valable pour la session en cours.
        traceSilentFailure('groupes-replies:persist', error)
      }
      return suivant
    })
  }, [])

  /** La cible d'un glisser en cours, pour que l'utilisateur VOIE où il va déposer. */
  const [surviole, setSurvole] = useState<string | null>(null)

  const rangerDans = useCallback(
    async (conversationId: string, chemin?: string | null): Promise<void> => {
      await window.api.conversationsSetProject?.(conversationId, chemin)
      await refreshConvs()
    },
    [refreshConvs]
  )
  const dossiersConversations = useMemo(
    () =>
      [...new Set(convs.map((conv) => conv.projectPath?.trim()).filter(Boolean) as string[])].sort(
        (a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' })
      ),
    [convs]
  )

  /**
   * Les résultats de recherche, groupés. On transporte le HIT entier (`snippet` compris) plutôt que
   * d'aplatir la conversation dedans : l'aplatissement faisait collisionner des champs homonymes et
   * rendait impossible de savoir, à la lecture, d'où venait chaque valeur.
   */
  const groupes = useMemo(
    () =>
      ordonnerGroupes(
        groupesVisibles(
          grouperConversations(
            conversationHits.map((hit) => ({
              id: hit.conversation.id,
              projectPath: hit.conversation.projectPath,
              autoKaizen: hit.conversation.autoKaizen,
              hit
            }))
          ),
          groupesReplies
        ),
        // La date n'arbitre qu'entre FRERES : un `.sort()` a plat ecrasait le rang par nature
        // (« Auto-kaizen » remontait en tete) et l'ordre parent-avant-enfant (un sous-dossier
        // s'affichait au-dessus de son parent, indente comme s'il y etait niche).
        //
        // MEME CLE que le tri a plat (`recenceUtilisateur`) : ce second tri portait encore sur
        // `updatedAt` et ECRASAIT donc le premier — mesure le 2026-08-18, la liste affichee ne
        // suivait pas l'ordre calcule juste au-dessus. Deux tris, une seule verite.
        (groupe) => recenceUtilisateur(groupe.items[0].hit.conversation),
        conversationDateOrder
      ),
    [conversationHits, groupesReplies, conversationDateOrder]
  )

  const openRunsCount = runs.filter((r) => r.summary.status === 'open').length
  const greenRunsCount = runs.filter((r) => r.summary.status === 'green').length
  /**
   * Fils de sous-agents RELUS depuis la trace persistée — la même source que le graphe. Sans eux, le
   * panneau affichait « Aucune orchestration » dès que la vue se remontait, alors que son propre
   * message vide promet que le fil RESTE une fois la tâche terminée.
   */
  const [persistedRuns, setPersistedRuns] = useState<ScopedLiveRun<OrchStep>[]>([])
  useEffect(() => {
    // Chargement PARESSEUX : la trace n'est lue qu'a l'ouverture de la section (garde testee).
    if (!isActive || !activeId || !showRuns || paneTab !== 'subagents') return
    let alive = true
    void (async () => {
      try {
        const trace = (await window.api.causalTrace?.(activeId)) as HarnessTraceEvent[] | undefined
        if (!alive || !trace) return
        const runtimeByTurn = new Map<string, TurnRuntimeIdentity>()
        for (const message of active?.messages ?? []) {
          if (message.role === 'assistant' && message.turnId && message.runtime) {
            runtimeByTurn.set(message.turnId, message.runtime)
          }
        }
        setPersistedRuns(
          scopedRunsFromTimeline(
            buildHarnessTimelineFromTrace(trace),
            activeId,
            runtimeByTurn
          ) as ScopedLiveRun<OrchStep>[]
        )
      } catch (error) {
        /* trace illisible : on garde le direct, jamais d'écran vide à cause de la relecture */
        traceSilentFailure('live-action-trace', error)
      }
    })()
    return () => {
      alive = false
    }
  }, [isActive, activeId, showRuns, paneTab, liveRuns, active])

  const visibleLiveRuns = mergeLiveAndPersisted<OrchStep>(
    visibleScopedRuns<OrchStep>(liveRuns, activeId ?? undefined, 'conv'),
    persistedRuns.filter((run) => run.convId === activeId)
  )

  /**
   * FIL RENDU, MÉMOÏSÉ. Mesuré (conv-1464) : chaque caractère tapé dans le composer re-rendait la
   * liste ENTIÈRE, et `aUneReponseApres`/`lastUserPromptBefore` balaient le fil pour CHAQUE
   * message → O(n²) balayages par touche (400 pour 5 caractères sur 80 messages, mesuré par
   * `ChatView.frappe-cout.test.tsx`). D'où le gel à la frappe sur une conversation longue.
   * `input` n'est VOLONTAIREMENT pas une dépendance : le composer ne touche pas au fil.
   */
  const filRendu = useMemo(
    () =>
      messages.map((message, index) => (
        <Fragment key={messageKey(message, index)}>
          <ChatMessageRow
            onPickSuggestion={pickSuggestion}
            onAnswerAsk={answerAsk}
            /* VERROU DURABLE : un message utilisateur posterieur EST la reponse. Derive du fil,
             donc vrai apres un remontage comme apres un redemarrage — la ou l'etat local du
             bloc, lui, disparaissait et rouvrait la porte au spam-clic. */
            askRepondu={
              message.role === 'assistant' ? aUneReponseApres(messages, index) : undefined
            }
            message={message}
            conversationId={activeId}
            onInspectTurn={onInspectTurn}
            onFork={handleFork}
            onOpenImage={setOpenImage}
            onOpenLiveAction={revealLiveAction}
            retryPrompt={
              message.role === 'assistant' ? lastUserPromptBefore(messages, index) : undefined
            }
            onResend={pickSuggestion}
            onRefineResume={refineResumeDraft}
            directiveReceipts={
              message.role === 'assistant' ? activeDirectiveReceiptsByMessage.get(index) : undefined
            }
          />
          {message.role === 'user' &&
            (activeDirectiveReceiptsByMessage.get(index) ?? []).map((receipt) => (
              <DirectiveReceiptRow key={`directive-receipt-${receipt.id}`} receipt={receipt} />
            ))}
        </Fragment>
      )),
    [
      messages,
      activeId,
      activeDirectiveReceiptsByMessage,
      pickSuggestion,
      answerAsk,
      onInspectTurn,
      handleFork,
      revealLiveAction,
      refineResumeDraft
    ]
  )

  return (
    <div
      className={`chat-layout${showRuns ? '' : ' is-runs-collapsed'}${
        convViewMode === 'mosaic' ? ' is-mosaic' : ''
      }`}
      data-testid="chat-view"
      data-active-conversation-id={activeId ?? ''}
    >
      {/* ---- Panneau gauche : conversations ---- */}
      <aside
        className="lisere-dessus conv-pane"
        data-view-mode={convViewMode}
        style={{ width: `${conversationsPaneWidth}px` }}
      >
        <div className="conv-head">
          <ModuleHeader
            eyebrow="Espace de travail"
            title="Conversations"
            actions={
              <button
                type="button"
                className="conv-view-toggle"
                data-testid="conv-view-toggle"
                role="switch"
                aria-checked={convViewMode === 'mosaic'}
                aria-label="Vue mosaïque"
                title={convViewMode === 'mosaic' ? 'Revenir à la liste' : 'Passer en mosaïque'}
                onClick={() => setConvViewMode(convViewMode === 'mosaic' ? 'list' : 'mosaic')}
              >
                <span className="conv-view-toggle-knob" aria-hidden="true" />
              </button>
            }
          />
        </div>
        <div className="conv-search">
          <span aria-hidden="true">⌕</span>
          <input
            value={convQuery}
            onChange={(event) => setConvQuery(event.target.value)}
            placeholder="Rechercher partout…"
            aria-label="Rechercher dans les conversations"
          />
          {convQuery && (
            <button onClick={() => setConvQuery('')} title="Effacer la recherche">
              ×
            </button>
          )}
        </div>
        {/*
          La barre n'existe QUE pendant une sélection en cours : hors de ce moment elle n'offrait
          qu'un bouton « Sélectionner » vu toute la journée pour un geste rare. L'entrée est
          désormais dans le menu contextuel d'une conversation, au-dessus de « Supprimer ».
        */}
        {convSelectionMode && convViewMode !== 'mosaic' && (
          <div className="conv-bulk-bar">
            <button type="button" className="conv-date-sort" onClick={() => quitterModeSelection()}>
              Annuler la sélection
            </button>
            <button
              type="button"
              className="conv-date-sort"
              disabled={selectedConvIds.size === 0}
              onClick={() => setBulkDeleteAsking(true)}
            >
              Supprimer ({selectedConvIds.size})
            </button>
          </div>
        )}
        <div className="conv-list scroll-y">
          <button
            className={`conv-new-row${convViewMode !== 'mosaic' && activeId === null ? ' active' : ''}`}
            onClick={() => {
              // En mosaique, « Nouveau » doit OUVRIR UNE FENETRE de plus : vider le fil unique,
              // masque derriere la grille, ne produisait aucun effet visible.
              if (convViewMode === 'mosaic') void nouvelleFenetreMosaique()
              else newConv()
            }}
            title="Démarrer une nouvelle conversation"
            aria-current={activeId === null ? 'page' : undefined}
          >
            <span className="conv-new-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
            <span className="conv-new-title">Nouveau fil</span>
          </button>
          {convs.length === 0 && (
            <div className="c-faint" style={{ fontSize: 12, padding: 'var(--s2)' }}>
              Aucune conversation — écris un message pour en démarrer une.
            </div>
          )}
          {convs.length > 0 && conversationHits.length === 0 && (
            <div className="conv-search-empty">Aucun message ou titre trouvé.</div>
          )}
          {groupes.map((groupe) => {
            const replie = estReplie(groupe.key, groupesReplies)
            return (
              <Fragment key={groupe.key}>
                {/*
                  L'en-tête est AUSSI la zone de dépôt : viser un titre est plus facile que viser un
                  interstice, et ça évite d'inventer une cible invisible. On ne dépose pas sur un
                  groupe dérivé (« Auto-kaizen » vient du champ `autoKaizen`, « Divers » est l'absence
                  de dossier) — y traîner une conversation ne voudrait rien dire.
                */}
                <div
                  className={`conv-group${replie ? ' is-collapsed' : ''}${
                    surviole === groupe.key ? ' is-drop' : ''
                  }`}
                  data-testid={`conv-group-${groupe.key}`}
                  data-depth={groupe.depth}
                  onDragOver={(e) => {
                    if (groupe.kind !== 'dossier') return
                    e.preventDefault()
                    setSurvole(groupe.key)
                  }}
                  onDragLeave={() => setSurvole((c) => (c === groupe.key ? null : c))}
                  onDrop={(e) => {
                    e.preventDefault()
                    setSurvole(null)
                    const id = e.dataTransfer.getData('text/autowin-conversation')
                    if (id && groupe.kind === 'dossier') void rangerDans(id, groupe.key)
                  }}
                >
                  <button
                    className="conv-group-head"
                    onClick={() => basculerGroupe(groupe.key, replie)}
                    aria-expanded={!replie}
                    title={groupe.kind === 'dossier' ? groupe.key : groupe.label}
                    style={{ paddingLeft: 8 + groupe.depth * 14 }}
                  >
                    <span className="conv-group-chevron" aria-hidden="true">
                      {replie ? '▸' : '▾'}
                    </span>
                    <span className="conv-group-label">{groupe.label}</span>
                    <span className="conv-group-count tnum">{groupe.items.length}</span>
                  </button>
                </div>
                {!replie &&
                  groupe.items.map(({ hit: { conversation: c, snippet } }) => {
                    const conversationState = deriveConversationState({
                      busy: busyConversations.has(c.id),
                      messageCount: c.messageCount ?? c.messages?.length ?? 0,
                      lastMessageRole: c.lastMessageRole ?? c.messages?.at(-1)?.role,
                      lastAssistantStatus: c.lastAssistantStatus,
                      asksUser: c.lastAssistantAsksUser === true,
                      // La conversation OUVERTE est lue par definition : elle ne doit jamais
                      // s'afficher « non lue » sous les yeux de celui qui la regarde.
                      unseen: c.id !== activeId && estNonVue(c, conversationsVues)
                    })
                    const stateDescription = `${conversationState.label} — ${conversationState.detail}`
                    return (
                      <div
                        key={c.id}
                        className={`conv-item${c.id === activeId ? ' active' : ''}`}
                        style={{ marginLeft: groupe.depth * 14 }}
                        // Le glisser est un RACCOURCI, pas le seul chemin : le menu ⋮ offre la même
                        // action au clavier. Une fonction qui n'existe qu'au glisser exclut de fait
                        // ceux qui ne peuvent pas glisser.
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/autowin-conversation', c.id)
                          e.dataTransfer.effectAllowed = 'move'
                        }}
                      >
                        {convSelectionMode && convViewMode !== 'mosaic' && (
                          <input
                            type="checkbox"
                            className="conv-select-box"
                            checked={selectedConvIds.has(c.id)}
                            onChange={() => toggleConvSelection(c.id)}
                            aria-label={`Sélectionner « ${c.title} »`}
                          />
                        )}
                        <button
                          className="conv-pick"
                          onClick={() =>
                            convViewMode === 'mosaic'
                              ? void basculerDansMosaique(c.id)
                              : void loadConv(c)
                          }
                        >
                          {/* EN COURS = le MEME atome que partout ailleurs : le composant
                              <Spinner/>. La pastille etait le dernier endroit a rendre l'ancien
                              atome CSS a bordures (.spinner), d'ou un indicateur qui ne
                              ressemblait a aucun autre. Les autres etats restent une pastille. */}
                          {conversationState.key === 'running' ? (
                            <Spinner
                              size={14}
                              className="conversation-state is-running"
                              label={`État de la conversation : ${stateDescription}`}
                              data-conversation-state={conversationState.key}
                            />
                          ) : (
                            <span
                              className={`conversation-state is-${conversationState.key}`}
                              data-conversation-state={conversationState.key}
                              role="img"
                              aria-label={`État de la conversation : ${stateDescription}`}
                              title={stateDescription}
                            />
                          )}
                          <span className="conv-copy">
                            <span className="conv-label">
                              {convQuery ? <TexteSurligne texte={c.title} terme={convQuery} /> : c.title}
                            </span>
                            {convQuery && snippet && (
                              <span className="conv-snippet">
                                <TexteSurligne texte={snippet} terme={convQuery} />
                              </span>
                            )}
                            {!convQuery && (
                              <span className="conv-meta">
                                <span>{c.id}</span>
                                <span>{c.messageCount ?? c.messages?.length ?? 0} messages</span>
                              </span>
                            )}
                          </span>
                          {convQuery && (
                            <span className="conv-count tnum">
                              {c.messageCount ?? c.messages?.length ?? 0}
                            </span>
                          )}
                          {/* En mosaique, la liste n'est plus une SELECTION mais un jeu
                              d'interrupteurs : l'etat ouvert/ferme se lit a droite du titre. */}
                          {convViewMode === 'mosaic' && (
                            <span
                              className={`conv-mosaic-toggle${mosaicIds.includes(c.id) ? ' is-open' : ''}`}
                              data-testid={`conv-mosaic-toggle-${c.id}`}
                              role="img"
                              aria-pressed={mosaicIds.includes(c.id) ? 'true' : 'false'}
                              aria-label={
                                mosaicIds.includes(c.id)
                                  ? `« ${c.title} » ouverte en mosaïque — cliquer pour fermer`
                                  : `« ${c.title} » fermée — cliquer pour ouvrir`
                              }
                              title={mosaicIds.includes(c.id) ? 'Ouverte' : 'Fermée'}
                            >
                              <span className="conv-mosaic-toggle-knob" aria-hidden="true" />
                            </span>
                          )}
                        </button>
                        <button
                          className="conv-menu-trigger"
                          title="Actions"
                          aria-label="Actions de la conversation"
                          onClick={(event) => {
                            event.stopPropagation()
                            const rect = event.currentTarget.getBoundingClientRect()
                            setConvMenu((current) =>
                              current?.conv.id === c.id
                                ? null
                                : { conv: c, top: rect.top, left: rect.right + 6 }
                            )
                          }}
                        >
                          ⋮
                        </button>
                      </div>
                    )
                  })}
              </Fragment>
            )
          })}
        </div>
      </aside>
      {convMenu &&
        createPortal(
          <>
            <div className="conv-menu-backdrop" onClick={() => setConvMenu(null)} />
            <div
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
                Renommer
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
                  setConvFolderMenu({ conv, top, left })
                }}
              >
                <span className="conv-menu-ic" aria-hidden="true">
                  🗂
                </span>
                Ranger dans un dossier…
              </button>
              {convMenu.conv.projectPath && (
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
                  Sortir du dossier
                </button>
              )}
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
                  Sélectionner
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
                Supprimer
              </button>
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
                setNouveauDossier(undefined)
                setConvFolderMenu(null)
              }}
            />
            <div
              className="conv-menu-pop"
              role="menu"
              aria-label="Dossiers de conversations"
              style={{ top: convFolderMenu.top, left: convFolderMenu.left }}
            >
              {dossiersConversations.length === 0 ? (
                <span className="conv-menu-empty">Aucun dossier de conversations</span>
              ) : (
                dossiersConversations.map((chemin) => (
                  <button
                    key={chemin}
                    role="menuitem"
                    data-testid="conv-project-choice"
                    data-project-path={chemin}
                    onClick={() => {
                      const conv = convFolderMenu.conv
                      setConvFolderMenu(null)
                      void rangerDans(conv.id, chemin)
                    }}
                  >
                    <span className="conv-menu-ic" aria-hidden="true">
                      🗂
                    </span>
                    {chemin}
                  </button>
                ))
              )}
              {nouveauDossier === undefined ? (
                <button
                  role="menuitem"
                  data-testid="conv-project-new"
                  onClick={() => setNouveauDossier('')}
                >
                  <span className="conv-menu-ic" aria-hidden="true">
                    ＋
                  </span>
                  Nouveau dossier…
                </button>
              ) : (
                <input
                  className="conv-menu-input"
                  data-testid="conv-project-new-input"
                  autoFocus
                  value={nouveauDossier}
                  placeholder="Nom du dossier"
                  aria-label="Nom du nouveau dossier de conversations"
                  onChange={(event) => setNouveauDossier(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      setNouveauDossier(undefined)
                      return
                    }
                    if (event.key !== 'Enter') return
                    // Une saisie vide n'est PAS un dossier : sans cette garde, `rangerDans` partait
                    // avec une chaine vide et le classement se faisait silencieusement sur rien.
                    const chemin = nouveauDossier.trim()
                    if (!chemin) return
                    const conv = convFolderMenu.conv
                    setNouveauDossier(undefined)
                    setConvFolderMenu(null)
                    void rangerDans(conv.id, chemin)
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
        aria-label="Redimensionner la bibliothèque de conversations"
        aria-orientation="vertical"
        aria-valuemin={CHAT_PANE_LIMITS.conversations.min}
        aria-valuemax={CHAT_PANE_LIMITS.conversations.max}
        aria-valuenow={conversationsPaneWidth}
        onPointerDown={beginConversationsResize}
      />

      {/* ---- Centre : mosaique multi-chat, ou le fil unique ---- */}
      {convViewMode === 'mosaic' ? (
        <ChatMosaic
          fenetres={fenetresMosaique}
          onClose={fermerFenetreStable}
          onOuvrirSeule={ouvrirSeuleStable}
          rendreComposer={rendreComposerStable}
          onNouvelleConversation={nouvelleFenetreStable}
          signatureComposer={signatureComposerMosaique}
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
        >
          {dragActive && (
            <div className="file-drop-overlay" aria-hidden="true">
              <strong>Dépose tes fichiers ici</strong>
              <span>Ils seront joints au prochain message</span>
            </div>
          )}
          <header className="chat-head row">
            <div className="row gap2" style={{ alignItems: 'center', minWidth: 0 }}>
              <span className="chat-head-signal" aria-hidden="true" />
              <div className="col" style={{ gap: 1, minWidth: 0 }}>
                <span className="chat-head-kicker">Conversation active</span>
                <b className="chat-conv-title">{active ? active.title : 'Nouvelle conversation'}</b>
                <div className="chat-runtime" data-testid="chat-runtime-identity">
                  <span
                    className={`chat-runtime-provider is-${runtimeIdentity?.provider ?? 'loading'}`}
                  >
                    {runtimeIdentity?.provider ?? 'connexion…'}
                  </span>
                  <span>
                    {runtimeIdentity?.modelLabel
                      ? shortModelLabel(runtimeIdentity.modelLabel, runtimeIdentity.provider)
                      : 'modèle en cours de résolution'}
                  </span>
                  {(() => {
                    const dossierProjet = active?.projectPath?.trim()
                    const cheminEffectif = dossierProjet || defaultWorkspace
                    const labelDossier = cheminEffectif
                      ? nomDeDossier(cheminEffectif)
                      : 'Autowin OS'
                    const titreDossier = dossierProjet
                      ? `Dossier de travail assigné à cette conversation : ${dossierProjet}`
                      : `Dossier racine par défaut de l’agent : ${cheminEffectif ?? 'racine du dépôt'}`
                    return (
                      <span
                        className="chat-cost-dot chat-project-dot"
                        title={titreDossier}
                        aria-label={titreDossier}
                        data-testid="chat-project-dot"
                      >
                        <span className={`status-dot ${dossierProjet ? 'st-ok' : 'st-ok'}`} />
                        📁 {labelDossier}
                      </span>
                    )
                  })()}
                  {(() => {
                    /*
                    LA JAUGE DE CONTEXTE.

                    Absente tant qu'on ne SAIT pas — fenetre du modele non declaree, ou entree non
                    mesuree. Afficher 0 % dirait « ce fil est vide », une affirmation la ou la
                    verite est « on l'ignore ».
                  */
                    const jauge = activeId != null ? contextGauges[activeId] : undefined
                    if (!jauge) return null
                    const pourcent = Math.round(jauge.ratio * 100)
                    const titre =
                      `Contexte : ${jauge.used.toLocaleString('fr-FR')} tokens sur ` +
                      `${jauge.limit.toLocaleString('fr-FR')} (${pourcent} %), dont ` +
                      `${jauge.cacheRead.toLocaleString('fr-FR')} relus du cache.`
                    return (
                      <span
                        className={`chat-context-gauge is-${jauge.level}`}
                        title={titre}
                        aria-label={titre}
                        data-testid="chat-context-gauge"
                      >
                        <span className="chat-context-gauge-track">
                          <span
                            className="chat-context-gauge-fill"
                            style={{ width: `${pourcent}%` }}
                          />
                        </span>
                        {pourcent} %
                      </span>
                    )
                  })()}
                  {gitBranch && (
                    <span
                      data-testid="chat-git-branch"
                      title={`Branche git courante du depot : ${gitBranch}`}
                    >
                      ⑂ {gitBranch}
                    </span>
                  )}
                  {/*
                  L'IDENTIFIANT de la conversation, a la place de « interface prete ».

                  Ce libelle ne disait rien : une interface affichee est prete, sinon on ne la
                  lirait pas. Pendant ce temps l'agent cite des conversations par leur id
                  (« conv-12 ») sans que rien a l'ecran ne permette de savoir laquelle on regarde.
                  La place etait donc occupee par du bruit alors qu'il manquait la seule
                  information qui relie ce que l'agent dit a ce que l'utilisateur voit.

                  L'etat occupe n'est PAS perdu : il reste porte par la classe `is-busy`, par la
                  pastille, et par la mention ajoutee a la suite de l'id.
                */}
                  <span
                    className={`chat-runtime-state${busy ? ' is-busy' : ''}`}
                    data-testid="chat-runtime-conv"
                    title={
                      activeId
                        ? `Identifiant de cette conversation : ${activeId}. C'est ce nom que l'agent emploie quand il parle d'une conversation.`
                        : 'Aucune conversation ouverte'
                    }
                  >
                    <span className="status-dot" />
                    {activeId ?? 'aucune conversation'}
                    {busy && ' · en cours'}
                  </span>
                </div>
              </div>
            </div>
            <div className="row gap2 chat-head-actions">
              <button
                type="button"
                className={`workflow-toggle${showRuns ? ' is-active' : ''}`}
                onClick={() => setShowRuns((v) => !v)}
                title="Workflows (RUN.md)"
              >
                <ForkIcon />
                Workflows{openRunsCount > 0 ? ` · ${openRunsCount} open` : ''}
                {greenRunsCount > 0 ? ` · ${greenRunsCount} green` : ''}
              </button>
            </div>
          </header>

          {travailNonPublie && travailNonPublie !== messageNonPublieMasque && (
            <div
              className="chat-workflow-notice chat-travail-non-publie"
              data-testid="chat-travail-non-publie"
              role="status"
            >
              <span>{travailNonPublie}</span>
              <button
                type="button"
                data-testid="chat-travail-non-publie-traiter"
                onClick={() => void traiterTravauxNonPublies()}
                title="Ouvrir une conversation neuve avec un prompt pret a envoyer"
              >
                Traiter
              </button>
              <button
                type="button"
                data-testid="chat-travail-non-publie-ouvrir"
                onClick={() => setListeNonPubliee((v) => !v)}
                title="Lister ces travaux et lire leur diff"
              >
                Voir la liste
              </button>
              <button
                type="button"
                data-testid="chat-travail-non-publie-fermer"
                className="chat-travail-non-publie__fermer"
                onClick={() => setMessageNonPublieMasque(travailNonPublie)}
                aria-label="Fermer cet avertissement"
                title="Masquer jusqu’au prochain changement"
              >
                ×
              </button>
            </div>
          )}
          {listeNonPubliee && <TravauxNonPublies onFermer={() => setListeNonPubliee(false)} />}

          {appNotice && (
            <div className="chat-workflow-notice" data-testid="chat-workflow-notice" role="alert">
              <span>{appNotice.text}</span>
              <button
                type="button"
                onClick={() => setAppNotice(null)}
                aria-label="Fermer l’avertissement"
              >
                ×
              </button>
            </div>
          )}

          {deleteCandidate && (
            <div
              className="delete-confirm-layer"
              role="presentation"
              onClick={() => setDeleteCandidate(null)}
            >
              <section
                className="delete-confirm-card"
                role="dialog"
                aria-modal="true"
                aria-labelledby="delete-confirm-title"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="delete-confirm-orbit" aria-hidden="true">
                  ✦
                </div>
                <span className="delete-confirm-kicker">ACTION IRRÉVERSIBLE</span>
                <h2 id="delete-confirm-title">Supprimer la conversation ?</h2>
                <p>
                  <strong>« {deleteCandidate.title} »</strong> et son historique local seront
                  retirés de cet appareil.
                </p>
                <div className="delete-confirm-actions">
                  <button
                    className="btn delete-confirm-cancel"
                    onClick={() => setDeleteCandidate(null)}
                    autoFocus
                  >
                    Garder la conversation
                  </button>
                  <button
                    className="btn delete-confirm-danger"
                    onClick={() => void confirmRemoveConv()}
                  >
                    Supprimer définitivement
                  </button>
                </div>
              </section>
            </div>
          )}

          {bulkDeleteAsking && (
            <div
              className="delete-confirm-layer"
              role="presentation"
              onClick={() => setBulkDeleteAsking(false)}
            >
              <section
                className="delete-confirm-card"
                role="dialog"
                aria-modal="true"
                aria-labelledby="bulk-delete-title"
                onClick={(event) => event.stopPropagation()}
              >
                <span className="delete-confirm-kicker">ACTION IRRÉVERSIBLE</span>
                <h2 id="bulk-delete-title">Supprimer {selectedConvIds.size} conversations ?</h2>
                <p>
                  Leur historique local sera retiré de cet appareil. Les conversations non
                  sélectionnées ne sont pas touchées.
                </p>
                {bulkDeleteError && <p className="c-danger">{bulkDeleteError}</p>}
                <div className="delete-confirm-actions">
                  <button
                    className="btn delete-confirm-cancel"
                    onClick={() => setBulkDeleteAsking(false)}
                    autoFocus
                  >
                    Garder
                  </button>
                  <button
                    className="btn delete-confirm-danger"
                    onClick={() => void confirmBulkDelete()}
                  >
                    Supprimer définitivement
                  </button>
                </div>
              </section>
            </div>
          )}

          {deleteRunCandidate && (
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
                    ? 'PIÈCE JOINTE EXTERNE'
                    : 'ACTION IRRÉVERSIBLE'}
                </span>
                <h2 id="run-delete-confirm-title">
                  {deleteRunCandidate.scope === 'conv' &&
                  deleteRunCandidate.run.session === 'attaché'
                    ? 'Détacher ce RUN ?'
                    : 'Supprimer ce RUN ?'}
                </h2>
                <p>
                  <strong>« {deleteRunCandidate.run.subject} »</strong>{' '}
                  {deleteRunCandidate.scope === 'conv' &&
                  deleteRunCandidate.run.session === 'attaché'
                    ? 'sera retiré de cette conversation. Son fichier externe restera intact.'
                    : 'et sa trace locale seront supprimés de cet appareil.'}
                </p>
                {runDeleteError && <div className="attachment-error">⚠️ {runDeleteError}</div>}
                <div className="delete-confirm-actions">
                  <button
                    className="btn delete-confirm-cancel run-delete-cancel"
                    onClick={() => setDeleteRunCandidate(null)}
                    disabled={runDeletePending}
                    autoFocus
                  >
                    Annuler
                  </button>
                  <button
                    className="btn delete-confirm-danger run-delete-confirm"
                    onClick={() => void confirmDeleteRun()}
                    disabled={runDeletePending}
                  >
                    {runDeletePending
                      ? 'Traitement…'
                      : deleteRunCandidate.scope === 'conv' &&
                          deleteRunCandidate.run.session === 'attaché'
                        ? 'Détacher'
                        : 'Supprimer définitivement'}
                  </button>
                </div>
              </section>
            </div>
          )}

          <div
            className={`chat-scroll scroll-y${repriseEnCours ? ' chat-scroll--reprise' : ''}`}
            ref={scrollRef}
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            onScroll={(event) => {
              const nearBottom = isChatNearBottom(event.currentTarget)
              // La position de lecture se retient A CHAQUE mouvement : quitter une conversation ne
              // passe pas toujours par un evenement de fermeture (switch, fermeture brutale de l'app).
              if (activeRef.current)
                memoriserPositionLecture(
                  activeRef.current,
                  event.currentTarget,
                  mesurerMessagesRendus(event.currentTarget)
                )
              followTailRef.current = nearBottom
              setScrolledAwayFromTail(!nearBottom)
              if (nearBottom) setHasNewActivity(false)
            }}
          >
            {/* Chargement du fil : squelette pendant l'attente, bandeau ACTIONNABLE en cas d'échec.
              Un fil vide muet ne disait pas la différence entre « rien à afficher » et « la
              lecture a planté ». */}
            {convLoad.status === 'loading' && (
              <div className="conv-load-skeleton" role="status" aria-label="Chargement du fil…">
                <span className="conv-load-skeleton-line" />
                <span className="conv-load-skeleton-line" />
                <span className="conv-load-skeleton-line" />
              </div>
            )}
            {convLoad.status === 'error' && (
              <div className="conv-load-error" role="alert">
                <span className="conv-load-error-text">
                  ⚠️ Conversation illisible : {convLoad.error}
                </span>
                {convLoad.target && (
                  <button
                    type="button"
                    className="conv-load-retry"
                    onClick={() => void loadConv(convLoad.target as Conv)}
                  >
                    ↻ Réessayer
                  </button>
                )}
              </div>
            )}

            {convLoad.status === 'idle' &&
              messages.length === 0 &&
              (!busy || activeId === null) && (
                <div className="chat-welcome">
                  <div className="empty">
                    <h3>Parle à l’agent</h3>
                    <div className="c-faint">
                      Il répond ET peut agir sur l’app (naviguer, créer une conversation, régler un
                      rôle, ouvrir un graphe…). Ses actions apparaissent en direct.
                    </div>
                  </div>
                  <div className="chat-suggest">
                    <SuggestionGrid groups={homeSuggestions} onPick={pickSuggestion} />
                  </div>
                </div>
              )}

            {activeDirectiveReceipts
              .filter((receipt) => receipt.afterMessageIndex < 0)
              .map((receipt) => (
                <DirectiveReceiptRow key={`directive-receipt-${receipt.id}`} receipt={receipt} />
              ))}

            {filRendu}
          </div>

          {(hasNewActivity || scrolledAwayFromTail) && (
            <button
              type="button"
              className="chat-jump-latest"
              onClick={() => {
                followTailRef.current = true
                setHasNewActivity(false)
                setScrolledAwayFromTail(false)
                if (scrollRef.current) scrollChatToBottom(scrollRef.current)
              }}
            >
              {hasNewActivity ? '↓ Dernière réponse' : '↓ Dernier message'}
            </button>
          )}

          <ChatQueuePanel
            pendingDirectives={pendingDirectives}
            busy={busy}
            interrupting={interruptingConversations.has(activeId ?? '')}
            steeringDirectives={steeringDirectives}
            /* Enveloppe OBLIGATOIRE : passe directement, React lui donnerait l evenement
               comme `cible` et le Stop viserait une conversation inexistante. */
            interruptAndFlushQueue={() => interruptAndFlushQueue()}
            steerWithoutInterrupt={(directive) => void steerWithoutInterrupt(directive)}
            moveQueuedMessage={moveQueuedMessage}
            moveQueuedMessageToBtw={moveQueuedMessageToBtw}
            restoreQueuedMessageToDraft={restoreQueuedMessageToDraft}
          />
          <ChatComposer
            ref={composerRef}
            busy={busy}
            hasActiveConversation={Boolean(activeId)}
            resumeAvailable={resumeAvailable}
            attachmentCount={attachments.length}
            mentionSources={mentionSources}
            skillCommands={skillCommands}
            ghostRecommendation={ghostRecommendation}
            placeholderPendantTour={busy && activeId !== null}
            onDraftInput={(value) => setDraftInput(composerDraftKeyRef.current, value)}
            onDraftPresence={setBrouillonPresent}
            onBtw={handleBtw}
            onSend={() => send()}
            onQueue={queueCurrentMessage}
            onResume={() => void resumePilotTurn()}
            onPaste={(files) => void addFiles(files)}
            attachmentsNode={
              attachments.length > 0 ? (
                <div className="attachment-list pending">
                  {attachments.map((file, fileIndex) => (
                    <span
                      className={`attachment-chip${file.kind === 'image' ? ' has-thumb' : ''}`}
                      key={`${file.name}-${fileIndex}`}
                    >
                      {file.kind === 'image' ? (
                        <button
                          type="button"
                          className="attachment-thumb-button"
                          aria-label={`Agrandir ${file.name}`}
                          title="Agrandir"
                          onClick={() =>
                            setOpenImage({
                              src: `data:${file.mimeType};base64,${file.content}`,
                              name: file.name
                            })
                          }
                        >
                          <img
                            className="attachment-thumb"
                            src={`data:${file.mimeType};base64,${file.content}`}
                            alt={file.name}
                          />
                        </button>
                      ) : (
                        <span aria-hidden="true">▤</span>
                      )}
                      <span className="attachment-name">{file.name}</span>
                      <small>{formatFileSize(file.size)}</small>
                      <button
                        type="button"
                        onClick={() =>
                          setDraftAttachments(composerDraftKeyRef.current, (current) =>
                            current.filter((_, index) => index !== fileIndex)
                          )
                        }
                        aria-label={`Retirer ${file.name}`}
                        title="Retirer"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : null
            }
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
                  onMasquer={() =>
                    setHypothesesCadrage((current) => {
                      const suivant = { ...current }
                      delete suivant[activeId]
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
                <button
                  type="button"
                  className="attachment-button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy}
                  aria-label="Joindre des fichiers"
                  title="Joindre des fichiers"
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
                <input
                  ref={fileInputRef}
                  className="attachment-input"
                  type="file"
                  multiple
                  onChange={(event) => {
                    if (event.currentTarget.files) void addFiles(event.currentTarget.files)
                    event.currentTarget.value = ''
                  }}
                  disabled={busy}
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
                  aria-label="Arrêter la réponse"
                  title="Arrêter la réponse en cours (indépendant de ce qui est tapé)"
                >
                  {interruptingConversations.has(activeId ?? '') ? 'Arrêt…' : '■ Stop'}
                </button>
              ) : null
            }
            metaNode={
              <div className="composer-meta">
                <span className="composer-hint">
                  Entrée pour envoyer · Maj + Entrée pour une nouvelle ligne · 8 fichiers max
                </span>
                <div className="composer-meta-actions">
                  <OrchestratorModelSelector
                    busy={busy}
                    catalogLoaded={modelCatalogLoaded}
                    models={modelCatalog}
                    binding={orchestratorBinding}
                    pending={modelChangePending}
                    error={modelChangeError}
                    onSelect={(option) => void changeOrchestratorModel(option)}
                  />
                  <ConversationCostIndicator conversationId={activeId ?? undefined} busy={busy} />
                  <ModelQuotaIndicator
                    provider={runtimeIdentity?.provider}
                    contextGauge={activeId != null ? contextGauges[activeId] : undefined}
                    busy={busy}
                    onCompact={activeId != null ? () => void send(COMPACT_REQUEST) : undefined}
                  />
                </div>
              </div>
            }
          />
        </section>
      )}

      {/* ---- Panneau droit : workflows + observatoire d'activité (repliable) ---- */}
      {showRuns && (
        <WorkflowsPanel
          runsPaneWidth={runsPaneWidth}
          beginRunsResize={beginRunsResize}
          paneTab={paneTab}
          setPaneTab={setPaneTab}
          refreshRuns={refreshRuns}
          setShowRuns={setShowRuns}
          activeId={activeId}
          send={send}
          isActive={isActive}
          requestLabel={[...messages].reverse().find((message) => message.role === 'user')?.content}
          messages={messages}
          liveGraphActive={
            Boolean(activeId && busyConversations.has(activeId)) ||
            liveRuns[activeId ?? '']?.status === 'running'
          }
          visibleLiveRuns={visibleLiveRuns}
          checkpoints={checkpoints}
          forkedCheckpoint={forkedCheckpoint}
          setForkedCheckpoint={setForkedCheckpoint}
          runs={runs}
          openRun={openRun}
          viewRun={viewRun}
          setOpenRun={setOpenRun}
          setOpenTrace={setOpenTrace}
          requestDeleteRun={requestDeleteRun}
          openTrace={openTrace}
          runDetailTab={runDetailTab}
          setRunDetailTab={setRunDetailTab}
          liveRunCardRef={liveRunCardRef}
        />
      )}
      {openImage &&
        createPortal(
          <div
            className="image-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label={`Aperçu de ${openImage.name}`}
            onClick={() => setOpenImage(null)}
          >
            <div className="image-lightbox-content" onClick={(event) => event.stopPropagation()}>
              <button
                type="button"
                className="image-lightbox-close"
                aria-label="Fermer l’aperçu"
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
