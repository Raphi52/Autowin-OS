import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { extractRecommendation } from './Markdown'
import { SuggestionGrid } from './SuggestionGrid'
import { ModuleHeader } from './ModuleHeader'
import { pickTurnToResume, type UnfinishedTurn } from './resume-unfinished'
import { refreshesActiveConversation } from './chat-event-routing'
import { pickRunForTrace } from './run-trace-target'
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
  modelCostTier,
  turnCostEq,
  costEqTier,
  phaseLabel,
  parseBtw,
  matchSlashCommands,
  type SlashCommand,
  type OrchStep,
  type ChatPart,
  type ChatRuntimeIdentity,
  type OrchestratorModelOption,
  type RunRequestIdentity,
  type ScopedLiveRun
} from './chat-view-model'
import { buildHomeSuggestions } from './chat-home-suggestions'
import { buildRefineDraft, type TerminalStatus } from './chat-resume-refine'
import { buildScopeEcho, formatScopeEcho } from './chat-scope-echo'
import { moveQueueEntry } from './chat-queue-order'
import { ChatQueuePanel } from './ChatQueuePanel'
import { ChatMessageRow, DirectiveReceiptRow } from './ChatMessageRow'
import { lastUserPromptBefore, messageKey } from './chat-message-keys'
import { promptDeRelanceGratuite } from './auto-relance'
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
  SendOptions
} from './chat-view-types'
import {
  applyMention,
  buildMentionSources,
  matchMentions,
  resolveMentionsForSend,
  type MentionCandidate
} from './chat-mentions'
import { visibleScopedRuns, type WorkflowPanelSection } from './workflows-panel-sections'
import { ForkIcon } from './chat-view-icons'
import { formatFileSize, encodeAttachment } from './chat-attachments'
import { searchConversations } from './conversation-search'
import { estReplie, grouperConversations } from './conversation-groups'
import { OrchestratorModelSelector } from './OrchestratorModelSelector'
import { ConversationCostIndicator } from './ConversationCostIndicator'
import { ModelQuotaIndicator } from './ModelQuotaIndicator'
import { WorkflowsPanel } from './WorkflowsPanel'
import { buildHarnessTimelineFromTrace, type HarnessTraceEvent } from './harness-timeline-model'
import {
  mergeLiveAndPersisted,
  scopedRunsFromTimeline,
  type TurnRuntimeIdentity
} from './subagent-thread-from-trace'
// La classe `.lisere-dessus` vit dans cette feuille : importee ICI et non « heritee » d'une
// autre vue, sinon l'apparence de Chat dependrait de l'ordre de chargement des AUTRES vues.
import './ViewPage.css'
import './ChatView.css'
import './SlashPalette.css'
import './ChatComposerExtras.css'
import type { InspectTurnTarget } from '../observatory-focus'

/* ---------- Types ---------- */

// Types partagés : dans `chat-view-types.ts` depuis la découpe. Ré-exportés ici pour que les
// importateurs historiques (`RunEntry`, `CheckpointEntry`) n'aient RIEN à changer.
export type { RunEntry, CheckpointEntry } from './chat-view-types'
import type { CheckpointEntry } from './chat-view-types'
type RuntimeModel = Parameters<typeof resolveChatRuntimeIdentity>[1][number]

/* ---------- Constantes ---------- */

// Les suggestions d'accueil ne sont plus figées : elles se DÉRIVENT de l'état réel
// (`buildHomeSuggestions`), le jeu historique restant le repli quand l'état est vide.

const MAX_ATTACHMENTS = 8
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
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [slashIndex, setSlashIndex] = useState(0)
  const [slashDismissed, setSlashDismissed] = useState(false)
  // Palette de MENTIONS (`@run…`, `@fichier…`) : même mécanique d'état que la palette slash.
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionDismissed, setMentionDismissed] = useState(false)
  // Ghost-text (façon CLI) : la recommandation « 👉 Recommandé » du DERNIER message assistant,
  // proposée en placeholder grisé quand le champ est vide et acceptée par Tab. null si aucune.
  const ghostRecommendation = useMemo(() => {
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant') as
      AsstMsg | undefined
    if (!lastAssistant) return null
    const text = lastAssistant.parts
      .filter((p): p is Extract<ChatPart, { kind: 'text' }> => p.kind === 'text')
      .map((p) => p.text)
      .join('\n')
    return extractRecommendation(text)
  }, [messages])
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [appNotice, setAppNotice] = useState<AppNotice | null>(null)
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
  const [runtimeIdentity, setRuntimeIdentity] = useState<ChatRuntimeIdentity | null>(null)
  // Coût-eq du dernier tour par conversation → pastille coût live.
  const [lastTurnCost, setLastTurnCost] = useState<Record<string, number>>({})
  // Menu ⋮ d'une conversation, rendu en position fixe (déborde du conteneur scrollable).
  const [convMenu, setConvMenu] = useState<{ conv: Conv; top: number; left: number } | null>(null)
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
  const [conversationsPaneWidth, setConversationsPaneWidth] = useState(() => {
    const saved = Number(window.localStorage.getItem('autowin.chat.conversationsPaneWidth'))
    return clampConversationPaneWidth(Number.isFinite(saved) && saved > 0 ? saved : 232)
  })
  const [hasNewActivity, setHasNewActivity] = useState(false)
  /* Fil remonté : le saut vers le dernier message ne dépend pas d'une nouvelle activité. */
  const [scrolledAwayFromTail, setScrolledAwayFromTail] = useState(false)
  const [showRuns, setShowRuns] = useState(false)
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
  /** Récapitulatif de visée affiché au-dessus du composer (null = rien à dire, pas de bruit). */
  const scopeEcho = useMemo(() => buildScopeEcho(input, mentionSources), [input, mentionSources])
  const homeSuggestions = useMemo(
    () => buildHomeSuggestions({ runs, resumedDraft: input }),
    [runs, input]
  )
  const [openRun, setOpenRun] = useState<{ path: string; content: string } | null>(null)
  const [openTrace, setOpenTrace] = useState<OrchStep[] | null>(null)
  // Détail d'un run : bascule entre le fil des sous-agents (trace) et le RUN.md brut.
  const [runDetailTab, setRunDetailTab] = useState<'trace' | 'runmd'>('trace')
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
  const [deleteRunCandidate, setDeleteRunCandidate] = useState<{
    run: RunEntry
    scope: 'conv' | 'tous'
    conversationId?: string
  } | null>(null)
  const [runDeletePending, setRunDeletePending] = useState(false)
  const [runDeleteError, setRunDeleteError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const composerInputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const liveMessagesRef = useRef(new Map<string, Msg[]>())
  const busyConversationsRef = useRef(new Set<string>())
  const interruptingConversationsRef = useRef(new Set<string>())
  const stoppedQueueDrainRef = useRef(new Set<string>())
  const steeringRef = useRef(new Set<number>())
  const sendLocksRef = useRef(new Set<string>())
  const composerDraftKeyRef = useRef(NEW_DRAFT_KEY)
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

  function getComposerDraft(key: string): ComposerDraft {
    return composerDraftsRef.current.get(key) ?? { input: '', attachments: [], error: null }
  }

  function setDraftInput(key: string, value: string): void {
    composerDraftsRef.current.set(key, { ...getComposerDraft(key), input: value })
    if (composerDraftKeyRef.current === key) setInput(value)
  }

  function setDraftAttachments(
    key: string,
    update: (current: ChatAttachment[]) => ChatAttachment[]
  ): void {
    const draft = getComposerDraft(key)
    const next = update(draft.attachments)
    composerDraftsRef.current.set(key, { ...draft, attachments: next })
    if (composerDraftKeyRef.current === key) setAttachments(next)
  }

  function setDraftError(key: string, error: string | null): void {
    composerDraftsRef.current.set(key, { ...getComposerDraft(key), error })
    if (composerDraftKeyRef.current === key) setAttachmentError(error)
  }

  function switchComposerDraft(key: string): void {
    composerSelectionGenerationRef.current += 1
    composerDraftKeyRef.current = key
    const draft = getComposerDraft(key)
    composerDraftsRef.current.set(key, draft)
    setInput(draft.input)
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
    status: DirectiveReceipt['status']
  ): void {
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

  async function addFiles(files: FileList | File[]): Promise<void> {
    if (busy) return
    const originDraftKey = composerDraftKeyRef.current
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
    const target = pickTurnToResume(turns)
    if (target) {
      const conversation = loaded.find((candidate) => candidate.id === target.conversationId)
      if (conversation) {
        await loadConv(conversation)
        await replayTurnJournal(target.conversationId, target.turnId)
        return
      }
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
          liveMessagesRef.current.delete(id)
          // `.catch` obligatoire : ce handler tourne à CHAQUE event `refresh` ; si la conversation a
          // été supprimée entre l'émission et l'appel (course normale), le rejet produisait un
          // unhandledRejection en usage courant. L'échec est ATTENDU ici (la conv n'existe plus) →
          // on l'absorbe sans message : rien à recharger, l'UI se met à jour par le refresh de liste.
          void window.api
            .conversation(id)
            .then((conversation) => {
              if (conversation && activeRef.current === id) void loadConv(conversation as Conv)
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
    if (activeRef.current === conversationId) setMessages(next)
  }

  useEffect(() => {
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
        const fil = liveMessagesRef.current.get(conversationId) ?? []
        if (!fil.some((message) => message.role === 'assistant' && !message.done)) {
          const amorce = [
            ...fil,
            { role: 'assistant', content: '', parts: [], status: 'streaming' } as unknown as Msg
          ]
          liveMessagesRef.current.set(conversationId, amorce)
          if (activeRef.current === conversationId) setMessages(amorce)
        }
      }
      if (e.kind === 'done' || e.kind === 'error') setConversationBusy(conversationId, false)
      // Coût du dernier tour → pastille live (coût-eq tokens).
      if (e.kind === 'done' && e.usage) {
        const cost = turnCostEq(e.usage)
        setLastTurnCost((current) => ({ ...current, [conversationId]: cost }))
      }
      if (e.kind === 'stream-reset' && e.streamId)
        rebaseDirectiveReceiptsAfterStreamReset(conversationId, e.streamId)
      patchLast(conversationId, (message) =>
        Object.assign(message, reduceAssistantPilotEvent(message, e))
      )
    })
    return off
  }, [])

  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    if (!followTailRef.current) {
      setHasNewActivity(true)
      return
    }
    requestAnimationFrame(() => {
      // L'utilisateur a pu remonter le fil ENTRE la décision et la frame : on relit son intention au
      // lieu de la présumer. Sans cette relecture, un message qui arrive juste avant un scroll vers
      // le haut le ramène de force en bas et efface le bouton de retour.
      if (!followTailRef.current) return
      scrollChatToBottom(scroll)
      setHasNewActivity(false)
      setScrolledAwayFromTail(false)
    })
  }, [messages, activeDirectiveReceipts])

  useEffect(() => {
    const inputElement = composerInputRef.current
    if (!inputElement) return
    inputElement.style.height = 'auto'
    inputElement.style.height = `${Math.min(inputElement.scrollHeight, 180)}px`
  }, [input])

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

  async function loadConv(c: Conv): Promise<void> {
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
    followTailRef.current = true
    setHasNewActivity(false)
    activeRef.current = c.id
    setActiveId(c.id)
    const branchMessages = detailed.messages ?? []
    const stored =
      liveMessagesRef.current.get(c.id) ??
      branchMessages.map((m) =>
        m.role === 'user'
          ? {
              role: 'user' as const,
              content: m.content,
              attachments: m.attachments,
              messageId: m.messageId
            }
          : {
              ...hydrateStoredAssistant(m),
              messageId: m.messageId
            }
      )
    liveMessagesRef.current.set(c.id, stored)
    setMessages(stored)
    switchComposerDraft(c.id)
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
      requestAnimationFrame(() => composerInputRef.current?.focus())
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
      else requestAnimationFrame(() => composerInputRef.current?.focus())
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
    if (activeRef.current === conversationId) setMessages(next)
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
   * CHOIX EXPLICITE (tour en cours) : le message tapé pendant un run est MIS EN FILE, jamais
   * appliqué automatiquement. Le bloc de file affiche alors les deux actions — 🧭 Orienter
   * (injecte dans le tour sans l'interrompre) et ⏹ Interrompre et envoyer. Le raccourci `/btw`
   * reste, lui, une injection explicite immédiate.
   */
  function queueCurrentMessage(): void {
    if (!activeId) return
    const text = input.trim()
    if (!text) return
    const id = activeId
    setDraftInput(id, '')
    enqueueMessage(id, text)
  }

  /**
   * Interrompre le tour en cours → la file se draine depuis le début via l'effet `busy→false`
   * (le message choisi + ses antérieurs partent d'abord ; les postérieurs suivent en auto-drain).
   * Sert au bouton « Interrompre et envoyer tout » (en tête de file) ET aux boutons par-message.
   */
  function interruptAndFlushQueue(): void {
    const id = activeRef.current
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
        if (result?.ok === false) setConversationInterrupting(id, false)
      })
      .catch(() => setConversationInterrupting(id, false))
  }

  /** Stop simple : annule le tour sans transformer la file en relance automatique. */
  function stopPilotTurn(): void {
    const id = activeRef.current
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
        if (result?.ok === false) setConversationInterrupting(id, false)
      })
      .catch(() => setConversationInterrupting(id, false))
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
      setDirectiveReceipt(id, entry, 'sent')
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
  async function submitBtw(body: string): Promise<void> {
    const text = body.trim()
    if (!text) {
      setDraftInput(composerDraftKeyRef.current, '') // "/btw" seul → rien à injecter, on nettoie
      return
    }
    if (!busy) {
      void send(text) // aucun tour en cours → le texte part comme message normal
      return
    }
    const id = activeRef.current
    if (!id) return
    setDraftInput(composerDraftKeyRef.current, '')
    // REÇU, comme `steerWithoutInterrupt` : les deux chemins appellent la MÊME IPC `injectDirective`,
    // et seul l'autre en rendait compte. Sans ce reçu, le texte quittait le composer et RIEN
    // n'apparaissait dans le fil — d'où « je clique et ça devrait m'envoyer le message et me donner une
    // réponse ». Une divergence entre deux chemins du même mécanisme, pas un oubli isolé.
    // Même compteur que la file : un reçu et une entrée de file ne doivent jamais partager un id,
    // sinon le repli en file (ci-dessous) écraserait le reçu qu'on vient de poser.
    const entry: QueuedDirective = { id: nextQueueEntryIdRef.current++, text, mode: 'btw' }
    setDirectiveReceipt(id, entry, 'sending')
    let injected = false
    try {
      injected = (await window.api.injectDirective(id, text))?.ok === true
    } catch (error) {
      traceSilentFailure('inject-directive:btw', error)
      injected = false
    }
    // Repli explicite : l'injection a échoué → file d'attente (drainée en fin de tour), rien n'est perdu.
    if (!injected) enqueueMessage(id, text, 'btw')
    setDirectiveReceipt(id, entry, injected ? 'sent' : 'failed')
  }
  /** True (et déclenche submitBtw) si le composer commence par `/btw` ; sinon false (submit normal). */
  function handleBtw(): boolean {
    const parsed = parseBtw(input)
    if (!parsed.isBtw) return false
    void submitBtw(parsed.body)
    return true
  }
  /** Palette « / » : insère la commande choisie dans le composer, l'utilisateur complète le corps. */
  function acceptSlash(cmd: SlashCommand): void {
    setDraftInput(composerDraftKeyRef.current, cmd.insert)
    setSlashIndex(0)
    requestAnimationFrame(() => composerInputRef.current?.focus())
  }
  /** Palette « @ » : remplace la frappe par la référence RÉSOLUE de la cible choisie. */
  function acceptMention(candidate: MentionCandidate): void {
    const caret = composerInputRef.current?.selectionStart ?? input.length
    const { text, caret: nextCaret } = applyMention(input, candidate, caret)
    setDraftInput(composerDraftKeyRef.current, text)
    setMentionIndex(0)
    setMentionDismissed(true)
    requestAnimationFrame(() => {
      const el = composerInputRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(nextCaret, nextCaret)
    })
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
  // `send` est recréé à chaque render → une prop instable casserait le memo de ChatMessageRow.
  // On la stabilise via un ref (même pattern que forkRef) → onPickSuggestion référentiellement stable.
  const sendRef = useRef(send)
  sendRef.current = send
  const pickSuggestion = useCallback((prompt: string) => void sendRef.current(prompt), [])
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
    requestAnimationFrame(() => {
      const el = composerInputRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })
  }
  const refineResumeDraft = useCallback(
    (prompt: string, status: TerminalStatus, reason?: string | null) =>
      refineDraftRef.current(prompt, status, reason),
    []
  )

  /* --- envoi --- */

  function flatten(msgs: Msg[]): Array<{ role: 'user' | 'assistant'; content: string }> {
    return msgs.map((m) => {
      if (m.role === 'user') return { role: 'user' as const, content: m.content }
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
    const value = (text ?? input).trim()
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
    if (activeRef.current === sourceConversationId) setMessages(optimisticHistory)
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
      if (activeRef.current === convId) setMessages(history)
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
        if (activeRef.current === sourceConversationId) setMessages(sourcePreviousMessages)
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
    if (activeRef.current === conversationId) setMessages(history)
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
  const canResumePilotTurn =
    !busy &&
    Boolean(activeId) &&
    !input.trim() &&
    attachments.length === 0 &&
    (latestAssistant?.status === 'cancelled' || latestAssistant?.status === 'interrupted')
  const conversationHits = useMemo(() => searchConversations(convs, convQuery), [convs, convQuery])

  /**
   * Repli des groupes, PERSISTÉ. Le redéplier à chaque ouverture annulerait tout le bénéfice :
   * l'utilisateur replie « Auto-kaizen » pour ne plus le voir, pas pour le refermer chaque matin.
   * `localStorage` et non le store disque : c'est une préférence d'affichage locale, elle n'a rien à
   * faire dans `conversations.json` que d'autres chemins relisent.
   */
  const [groupesReplies, setGroupesReplies] = useState<Record<string, boolean>>(() => {
    try {
      const brut = localStorage.getItem('autowin.conv-groups.collapsed')
      return brut ? (JSON.parse(brut) as Record<string, boolean>) : {}
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

  /**
   * Les résultats de recherche, groupés. On transporte le HIT entier (`snippet` compris) plutôt que
   * d'aplatir la conversation dedans : l'aplatissement faisait collisionner des champs homonymes et
   * rendait impossible de savoir, à la lecture, d'où venait chaque valeur.
   */
  const groupes = useMemo(
    () =>
      grouperConversations(
        conversationHits.map((hit) => ({
          id: hit.conversation.id,
          projectPath: hit.conversation.projectPath,
          autoKaizen: hit.conversation.autoKaizen,
          hit
        }))
      ),
    [conversationHits]
  )

  /**
   * Inbox d'agents : conversations avec un agent EN TRAVAIL (tour en cours) ou une
   * orchestration live — visible en tête, même quand la conv active est ailleurs.
   */
  const activeAgents = useMemo(() => {
    const byId = new Map(convs.map((c) => [c.id, c]))
    const ids = new Set<string>([
      ...busyConversations,
      ...Object.keys(liveRuns).filter((id) => liveRuns[id]?.status === 'running')
    ])
    return [...ids].map((id) => {
      const run = liveRuns[id]
      const phase = run?.phase ? phaseLabel(run.phase) : undefined
      return {
        id,
        title: byId.get(id)?.title ?? 'Conversation',
        state: run ? (phase ? `${phase} en cours` : 'orchestration') : 'réponse en cours',
        task: run?.task
      }
    })
  }, [convs, busyConversations, liveRuns])
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

  return (
    <div
      className={`chat-layout${showRuns ? '' : ' is-runs-collapsed'}`}
      data-testid="chat-view"
      data-active-conversation-id={activeId ?? ''}
    >
      {/* ---- Panneau gauche : conversations ---- */}
      <aside className="lisere-dessus conv-pane" style={{ width: `${conversationsPaneWidth}px` }}>
        <div className="conv-head">
          <ModuleHeader
            eyebrow="Espace de travail"
            title="Conversations"
            description="Retrouve, organise et reprends tes échanges."
          />
        </div>
        {activeAgents.length > 0 && (
          <section className="agent-inbox" aria-label="Agents actifs">
            <span className="agent-inbox-title">
              Agents actifs<span className="agent-inbox-count">{activeAgents.length}</span>
            </span>
            {activeAgents.map((agent) => (
              <div className="agent-inbox-item" key={agent.id}>
                <button
                  className={`agent-inbox-row${agent.id === activeId ? ' active' : ''}`}
                  onClick={() => {
                    const target = convs.find((c) => c.id === agent.id)
                    if (target) void loadConv(target)
                  }}
                  title={agent.task ?? agent.title}
                >
                  <span className="agent-inbox-pulse" aria-hidden="true" />
                  <span className="agent-inbox-copy">
                    <span className="agent-inbox-name">{agent.title}</span>
                    <span className="agent-inbox-state">{agent.state}</span>
                  </span>
                </button>
              </div>
            ))}
          </section>
        )}
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
        <div className="conv-list scroll-y">
          <button
            className={`conv-new-row${activeId === null ? ' active' : ''}`}
            onClick={newConv}
            title="Démarrer une nouvelle conversation"
            aria-current={activeId === null ? 'page' : undefined}
          >
            <span className="conv-new-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M13.6 5.4 18.6 10.4M4 20l3.7-.8L19.4 7.5a1.8 1.8 0 0 0 0-2.5l-.4-.4a1.8 1.8 0 0 0-2.5 0L4.8 16.3 4 20ZM13 20h7" />
              </svg>
            </span>
            <span className="conv-new-title">Nouveau</span>
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
                  onDragOver={(e) => {
                    if (groupe.kind !== 'projet') return
                    e.preventDefault()
                    setSurvole(groupe.key)
                  }}
                  onDragLeave={() => setSurvole((c) => (c === groupe.key ? null : c))}
                  onDrop={(e) => {
                    e.preventDefault()
                    setSurvole(null)
                    const id = e.dataTransfer.getData('text/autowin-conversation')
                    if (id && groupe.kind === 'projet') void rangerDans(id, groupe.key)
                  }}
                >
                  <button
                    className="conv-group-head"
                    onClick={() => basculerGroupe(groupe.key, replie)}
                    aria-expanded={!replie}
                    title={groupe.kind === 'projet' ? groupe.key : groupe.label}
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
                      lastAssistantStatus: c.lastAssistantStatus
                    })
                    const stateDescription = `${conversationState.label} — ${conversationState.detail}`
                    return (
                      <div
                        key={c.id}
                        className={`conv-item${c.id === activeId ? ' active' : ''}`}
                        // Le glisser est un RACCOURCI, pas le seul chemin : le menu ⋮ offre la même
                        // action au clavier. Une fonction qui n'existe qu'au glisser exclut de fait
                        // ceux qui ne peuvent pas glisser.
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/autowin-conversation', c.id)
                          e.dataTransfer.effectAllowed = 'move'
                        }}
                      >
                        <button className="conv-pick" onClick={() => void loadConv(c)}>
                          <span
                            className={`conversation-state is-${conversationState.key}`}
                            data-conversation-state={conversationState.key}
                            role="img"
                            aria-label={`État de la conversation : ${stateDescription}`}
                            title={stateDescription}
                          />
                          <span className="conv-copy">
                            <span className="conv-label">{c.title}</span>
                            {convQuery && snippet && (
                              <span className="conv-snippet">{snippet}</span>
                            )}
                            {!convQuery && (
                              <span className="conv-meta">
                                <span>{c.provider}</span>
                                <span>{c.messageCount ?? c.messages?.length ?? 0} messages</span>
                              </span>
                            )}
                          </span>
                          {convQuery && (
                            <span className="conv-count tnum">
                              {c.messageCount ?? c.messages?.length ?? 0}
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
                  const conv = convMenu.conv
                  setConvMenu(null)
                  // Chemin OMIS : c'est le main qui ouvre le sélecteur natif — le renderer n'a pas
                  // le disque, et lui laisser fabriquer un chemin ferait de ce canal une écriture
                  // non contrôlée.
                  void rangerDans(conv.id)
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

      {/* ---- Centre : fil ---- */}
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
                <span>{runtimeIdentity?.modelLabel ?? 'modèle en cours de résolution'}</span>
                {runtimeIdentity?.model &&
                  (() => {
                    // Coût-eq du dernier tour (live) si dispo pour la conv active ; sinon palier modèle.
                    const liveCost = activeId != null ? lastTurnCost[activeId] : undefined
                    const cost =
                      liveCost !== undefined
                        ? costEqTier(liveCost)
                        : modelCostTier(runtimeIdentity.model)
                    return (
                      <span className="chat-cost-dot" title={cost.label} aria-label={cost.label}>
                        <span className={`status-dot ${cost.dotClass}`} />
                        {cost.label}
                      </span>
                    )
                  })()}
                {runtimeIdentity?.reasoningEffort && (
                  <span>effort {runtimeIdentity.reasoningEffort}</span>
                )}
                <span className={`chat-runtime-state${busy ? ' is-busy' : ''}`}>
                  <span className="status-dot" />
                  {busy ? 'en cours' : 'interface prête'}
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
                <strong>« {deleteCandidate.title} »</strong> et son historique local seront retirés
                de cet appareil.
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
                {deleteRunCandidate.scope === 'conv' && deleteRunCandidate.run.session === 'attaché'
                  ? 'PIÈCE JOINTE EXTERNE'
                  : 'ACTION IRRÉVERSIBLE'}
              </span>
              <h2 id="run-delete-confirm-title">
                {deleteRunCandidate.scope === 'conv' && deleteRunCandidate.run.session === 'attaché'
                  ? 'Détacher ce RUN ?'
                  : 'Supprimer ce RUN ?'}
              </h2>
              <p>
                <strong>« {deleteRunCandidate.run.subject} »</strong>{' '}
                {deleteRunCandidate.scope === 'conv' && deleteRunCandidate.run.session === 'attaché'
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
          className="chat-scroll scroll-y"
          ref={scrollRef}
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          onScroll={(event) => {
            const nearBottom = isChatNearBottom(event.currentTarget)
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

          {convLoad.status === 'idle' && messages.length === 0 && (!busy || activeId === null) && (
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

          {messages.map((message, index) => (
            <Fragment key={messageKey(message, index)}>
              <ChatMessageRow
                onPickSuggestion={pickSuggestion}
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
                  message.role === 'assistant'
                    ? activeDirectiveReceiptsByMessage.get(index)
                    : undefined
                }
              />
              {message.role === 'user' &&
                (activeDirectiveReceiptsByMessage.get(index) ?? []).map((receipt) => (
                  <DirectiveReceiptRow key={`directive-receipt-${receipt.id}`} receipt={receipt} />
                ))}
            </Fragment>
          ))}
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
          interruptAndFlushQueue={interruptAndFlushQueue}
          steerWithoutInterrupt={(directive) => void steerWithoutInterrupt(directive)}
          moveQueuedMessage={moveQueuedMessage}
          moveQueuedMessageToBtw={moveQueuedMessageToBtw}
          restoreQueuedMessageToDraft={restoreQueuedMessageToDraft}
        />
        <div className="composer">
          <div className="composer-field">
            {attachments.length > 0 && (
              <div className="attachment-list pending">
                {attachments.map((file, fileIndex) => (
                  <span
                    className={`attachment-chip${file.kind === 'image' ? ' has-thumb' : ''}`}
                    key={`${file.name}-${fileIndex}`}
                  >
                    {file.kind === 'image' ? (
                      <img
                        className="attachment-thumb"
                        src={`data:${file.mimeType};base64,${file.content}`}
                        alt={file.name}
                      />
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
            )}
            {attachmentError && <div className="attachment-error">{attachmentError}</div>}
            {/* Écho de PÉRIMÈTRE : ce que le tour va probablement faire, et sur quoi — AVANT
                l'envoi, pour pouvoir corriger la visée plutôt que de découvrir l'écart après. */}
            {scopeEcho && (
              <div className="composer-scope-echo" data-testid="scope-echo">
                <span aria-hidden="true">◎</span> {formatScopeEcho(scopeEcho)}
              </div>
            )}
            {(() => {
              const items = matchMentions(input, mentionSources)
              if (mentionDismissed || items.length === 0) return null
              const sel = Math.min(mentionIndex, items.length - 1)
              return (
                <ul
                  className="slash-palette mention-palette"
                  role="listbox"
                  aria-label="Cibles"
                  data-testid="mention-palette"
                >
                  {items.map((c, i) => (
                    <li
                      key={`${c.kind}:${c.id}`}
                      role="option"
                      aria-selected={i === sel}
                      className={`slash-item${i === sel ? ' is-selected' : ''}`}
                      data-testid="mention-item"
                      onMouseDown={(ev) => {
                        ev.preventDefault() // garde le focus du composer
                        acceptMention(c)
                      }}
                    >
                      <span className="slash-name mono">
                        {c.kind === 'run' ? '@run' : '@fichier'} {c.label}
                      </span>
                      {c.hint && <span className="slash-hint">{c.hint}</span>}
                    </li>
                  ))}
                </ul>
              )
            })()}
            {(() => {
              const items = matchSlashCommands(input)
              if (slashDismissed || items.length === 0) return null
              const sel = Math.min(slashIndex, items.length - 1)
              return (
                <ul className="slash-palette" role="listbox" aria-label="Commandes">
                  {items.map((c, i) => (
                    <li
                      key={c.name}
                      role="option"
                      aria-selected={i === sel}
                      className={`slash-item${i === sel ? ' is-selected' : ''}`}
                      onMouseDown={(ev) => {
                        ev.preventDefault() // garde le focus du composer
                        acceptSlash(c)
                      }}
                    >
                      <span className="slash-name mono">/{c.name}</span>
                      <span className="slash-hint">{c.hint}</span>
                    </li>
                  ))}
                </ul>
              )
            })()}
            <div className="composer-input-row">
              <button
                type="button"
                className="attachment-button"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                aria-label="Joindre des fichiers"
                title="Joindre des fichiers"
              >
                <svg className="attachment-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
              <textarea
                ref={composerInputRef}
                className="input grow"
                rows={1}
                value={input}
                onChange={(e) => {
                  setDraftInput(composerDraftKeyRef.current, e.target.value)
                  setSlashDismissed(false)
                  setSlashIndex(0)
                  setMentionDismissed(false)
                  setMentionIndex(0)
                }}
                onKeyDown={(e) => {
                  // La palette de MENTIONS passe avant la slash : les deux ne peuvent pas être
                  // ouvertes en même temps (une mention exclut un `/` en tête de frappe).
                  const mentions = matchMentions(input, mentionSources)
                  if (!mentionDismissed && mentions.length > 0) {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault()
                      setMentionIndex((i) => (i + 1) % mentions.length)
                      return
                    }
                    if (e.key === 'ArrowUp') {
                      e.preventDefault()
                      setMentionIndex((i) => (i - 1 + mentions.length) % mentions.length)
                      return
                    }
                    if (e.key === 'Enter' || e.key === 'Tab') {
                      e.preventDefault()
                      acceptMention(mentions[Math.min(mentionIndex, mentions.length - 1)])
                      return
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      setMentionDismissed(true)
                      return
                    }
                  }
                  const items = matchSlashCommands(input)
                  if (!slashDismissed && items.length > 0) {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault()
                      setSlashIndex((i) => (i + 1) % items.length)
                      return
                    }
                    if (e.key === 'ArrowUp') {
                      e.preventDefault()
                      setSlashIndex((i) => (i - 1 + items.length) % items.length)
                      return
                    }
                    if (e.key === 'Enter' || e.key === 'Tab') {
                      e.preventDefault()
                      acceptSlash(items[Math.min(slashIndex, items.length - 1)])
                      return
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      setSlashDismissed(true)
                      return
                    }
                  }
                  // Ghost-text (CLI-like) : Tab accepte la recommandation quand le champ est vide
                  // et qu'aucun menu slash n'est actif. Remplit l'input avec l'étape recommandée.
                  if (e.key === 'Tab' && ghostRecommendation && input.trim() === '') {
                    e.preventDefault()
                    setDraftInput(composerDraftKeyRef.current, ghostRecommendation)
                    return
                  }
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    if (handleBtw()) return
                    if (busy && activeId) queueCurrentMessage()
                    else send()
                  }
                }}
                onPaste={(e) => {
                  const pasted = e.clipboardData?.files
                  if (pasted && pasted.length > 0) {
                    e.preventDefault()
                    void addFiles(pasted)
                  }
                }}
                placeholder={
                  busy && activeId !== null
                    ? 'Mettre en file… envoyé à la fin du tour (Entrée)'
                    : ghostRecommendation
                      ? `⇥ ${ghostRecommendation}`
                      : 'Écrire à l’agent ou déposer des fichiers…'
                }
              />
              {/*
                ARRÊTER ne doit dépendre de RIEN d'autre que « un tour est en cours ». Avant, un SEUL
                bouton portait trois rôles : `busy && !input.trim()` → Stop, `busy && input.trim()` →
                Mettre en file, sinon Envoyer. Conséquence : dès qu'on avait tapé quelque chose, il
                fallait d'abord VIDER la barre de prompt pour que le clic agisse comme stop — l'action
                la plus urgente masquée derrière un état accessoire. Stop a désormais son propre bouton.
              */}
              {busy && (
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
              )}
              <button
                className={`btn-accent btn composer-send${canResumePilotTurn ? ' is-resume' : ''}`}
                data-testid="composer-send"
                onClick={() => {
                  if (handleBtw()) return
                  // Plus de branche « composer vide → arrêter » : Stop a son propre bouton, ce bouton
                  // ne fait plus qu'une chose à la fois — reprendre, mettre en file, ou envoyer.
                  if (canResumePilotTurn) {
                    void resumePilotTurn()
                    return
                  }
                  if (busy && activeId) queueCurrentMessage()
                  else send()
                }}
                disabled={
                  busy
                    ? !activeId || !input.trim()
                    : canResumePilotTurn
                      ? false
                      : !input.trim() && attachments.length === 0
                }
                aria-label={
                  canResumePilotTurn
                    ? 'Reprendre la réponse'
                    : busy
                      ? 'Mettre le message en file d’attente'
                      : 'Envoyer le message'
                }
              >
                {canResumePilotTurn ? '↻ Reprendre' : busy ? '⚡ Mettre en file' : 'Envoyer'}
              </button>
            </div>
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
                <ModelQuotaIndicator provider={runtimeIdentity?.provider} />
              </div>
            </div>
          </div>
        </div>
      </section>

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
