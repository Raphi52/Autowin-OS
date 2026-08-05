import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Markdown, extractRecommendation } from './Markdown'
import { SuggestionGrid } from './SuggestionGrid'
import { ScoutTable } from './ScoutTable'
import { ModuleHeader } from './ModuleHeader'
import { pickTurnToResume, type UnfinishedTurn } from './resume-unfinished'
import { refreshesActiveConversation } from './chat-event-routing'
import { pickRunForTrace } from './run-trace-target'
import {
  CHAT_PANE_LIMITS,
  clampConversationPaneWidth,
  createLiveRunDeltaBatcher,
  deriveConversationState,
  groupAssistantActivity,
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
  type HydratedAssistantMessage,
  type ChatRuntimeIdentity,
  type OrchestratorModelOption,
  type RunRequestIdentity,
  type ScopedLiveRun
} from './chat-view-model'
import { visibleScopedRuns, type WorkflowPanelSection } from './workflows-panel-sections'
import { ForkIcon, InspectIcon } from './chat-view-icons'
import { formatFileSize, encodeAttachment } from './chat-attachments'
import { searchConversations } from './conversation-search'
import { OrchestratorModelSelector } from './OrchestratorModelSelector'
import { ConversationCostIndicator } from './ConversationCostIndicator'
import { ModelQuotaIndicator } from './ModelQuotaIndicator'
import { AssistantActivityGroup } from './ChatView.parts'
import { WorkflowsPanel } from './WorkflowsPanel'
import { ArtifactPreview } from './ArtifactPreview'
import { buildHarnessTimelineFromTrace, type HarnessTraceEvent } from './harness-timeline-model'
import {
  mergeLiveAndPersisted,
  scopedRunsFromTimeline,
  type TurnRuntimeIdentity
} from './subagent-thread-from-trace'
import './ChatView.css'
import './SlashPalette.css'
import type { InspectTurnTarget } from '../observatory-focus'
import type { ChatArtifact } from '../../../shared/artifacts'
import type { PilotEventKind } from '../../../shared/pilot-events'

/* ---------- Types ---------- */

type Part = ChatPart

interface AttachmentMeta {
  name: string
  mimeType: string
  size: number
  /** Miniature downscalée (data URL) pour les images — persistée, affichée dans le fil. */
  thumbnail?: string
  /** Original gardé uniquement dans le fil live, avant rechargement depuis le store. */
  content?: string
  /** Original durable matérialisé côté main après l’envoi. */
  artifact?: ChatArtifact
  turnId?: string
  /** L’écriture durable a échoué ; la miniature ne doit pas usurper l’original. */
  originalUnavailable?: boolean
}
interface ChatAttachment extends AttachmentMeta {
  kind: 'text' | 'image' | 'file'
  content: string
}
interface ComposerDraft {
  input: string
  attachments: ChatAttachment[]
  error: string | null
}
type SendOptions = { keepComposerDraft?: boolean; targetConversationId?: string }
interface UserMsg {
  role: 'user'
  content: string
  attachments?: AttachmentMeta[]
}
type AsstMsg = HydratedAssistantMessage
type Msg = (UserMsg | AsstMsg) & { messageId?: string }

interface PilotEvent {
  conversationId?: string
  turnId?: string
  /**
   * Même vocabulaire que le main (`src/shared/pilot-events.ts`), plus recopié ici. Cette liste avait
   * dérivé : il lui manquait `reasoning` et `prompt-call`, que le main émet — et comme la réception
   * fait `raw as PilotEvent`, le renderer les ignorait en silence au lieu de ne pas compiler.
   */
  kind: PilotEventKind
  text?: string
  streamId?: string
  actionId?: string
  iteration?: number
  name?: string
  args?: unknown
  ok?: boolean
  data?: unknown
  artifact?: ChatArtifact
  usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number }
}

type Conv = {
  id: string
  title: string
  category: string
  provider: string
  messages?: Array<{
    role: 'user' | 'assistant'
    content: string
    ts: number
    attachments?: AttachmentMeta[]
    messageId?: string
    parentMessageId?: string
    turnId?: string
    turnConversationId?: string
    status?: 'streaming' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
    runtime?: TurnRuntimeIdentity
    parts?: Part[]
    error?: string
  }>
  messageCount?: number
  lastMessageRole?: 'user' | 'assistant'
  lastAssistantStatus?: 'streaming' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
  updatedAt: number
}

export type RunEntry = {
  subject: string
  session: string
  path: string
  mtime: number
  summary: {
    status: string
    regime?: string
    dodTotal: number
    dodChecked: number
    journalEvents: number
    defauts: number
  }
}
export type CheckpointEntry = { id: string; runId: string; createdAt: string }

type Decision = { id: string; question: string; options?: unknown[]; safeDefault?: unknown }

type RuntimeModel = Parameters<typeof resolveChatRuntimeIdentity>[1][number]
type QueuedDirective = { id: number; text: string; mode?: 'btw' }
type DirectiveReceipt = {
  id: number
  text: string
  status: 'sending' | 'sent' | 'failed'
  afterMessageIndex: number
  afterPartIndex: number
  afterTextOffset?: number
}

function DirectiveReceiptRow({ receipt }: { receipt: DirectiveReceipt }): React.JSX.Element {
  return (
    <div className={`msg user directive-receipt is-${receipt.status}`}>
      <div className="msg-meta">
        <span className="msg-role">Toi</span>
        <span className="directive-receipt-status" role="status">
          {receipt.status === 'sending'
            ? '⏳ Orientation…'
            : receipt.status === 'sent'
              ? '✓ Orienté'
              : '⚠ Échec — remis en file'}
        </span>
      </div>
      <div className="msg-body" dir="auto">
        {receipt.text}
      </div>
    </div>
  )
}

type AssistantTimelineItem =
  { kind: 'parts'; parts: ChatPart[] } | { kind: 'receipt'; receipt: DirectiveReceipt }

function splitAssistantTimeline(
  parts: ChatPart[],
  receipts: DirectiveReceipt[]
): AssistantTimelineItem[] {
  if (receipts.length === 0) return [{ kind: 'parts', parts }]
  const ordered = receipts
    .slice()
    .sort(
      (left, right) =>
        left.afterPartIndex - right.afterPartIndex ||
        (left.afterTextOffset ?? Number.MAX_SAFE_INTEGER) -
          (right.afterTextOffset ?? Number.MAX_SAFE_INTEGER) ||
        left.id - right.id
    )
  const timeline: AssistantTimelineItem[] = []
  let pendingParts: ChatPart[] = []
  let receiptIndex = 0
  const flushParts = (): void => {
    if (pendingParts.length === 0) return
    timeline.push({ kind: 'parts', parts: pendingParts })
    pendingParts = []
  }
  const appendReceipt = (receipt: DirectiveReceipt): void => {
    flushParts()
    timeline.push({ kind: 'receipt', receipt })
  }

  while (ordered[receiptIndex]?.afterPartIndex < 0) {
    appendReceipt(ordered[receiptIndex])
    receiptIndex += 1
  }
  parts.forEach((part, partIndex) => {
    if (part.kind === 'text') {
      let textOffset = 0
      while (ordered[receiptIndex]?.afterPartIndex === partIndex) {
        const receipt = ordered[receiptIndex]
        const receiptOffset = Math.max(
          textOffset,
          Math.min(part.text.length, receipt.afterTextOffset ?? part.text.length)
        )
        if (receiptOffset > textOffset)
          pendingParts.push({ ...part, text: part.text.slice(textOffset, receiptOffset) })
        appendReceipt(receipt)
        textOffset = receiptOffset
        receiptIndex += 1
      }
      if (textOffset < part.text.length)
        pendingParts.push({ ...part, text: part.text.slice(textOffset) })
      return
    }
    pendingParts.push(part)
    while (ordered[receiptIndex]?.afterPartIndex === partIndex) {
      appendReceipt(ordered[receiptIndex])
      receiptIndex += 1
    }
  })
  while (receiptIndex < ordered.length) {
    appendReceipt(ordered[receiptIndex])
    receiptIndex += 1
  }
  flushParts()
  return timeline
}

/* ---------- Constantes ---------- */

const SUGGESTIONS = [
  'Crée une conversation « Revue archi » en catégorie codex',
  'Mets le juge sur codex',
  'Ouvre le graphe du brain rig-tv',
  'Quel est l’état des workflows ?'
]

const MAX_ATTACHMENTS = 8
const NEW_DRAFT_KEY = '__new__'
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MAX_ATTACHMENTS_BYTES = 20 * 1024 * 1024
function messageKey(message: Msg, index: number): string {
  return `${message.role}:${index}`
}

function sentImageArtifact(file: AttachmentMeta, index: number): ChatArtifact | undefined {
  if (!file.mimeType.startsWith('image/')) return undefined
  if (file.artifact?.kind === 'image') return file.artifact
  if (file.content)
    return {
      id: `sent-image-${index}-${file.name}-${file.size}`,
      name: file.name,
      mimeType: file.mimeType,
      kind: 'image',
      size: file.size,
      createdAt: 0,
      encoding: 'base64',
      content: file.content,
      source: { provider: 'user' }
    }
  if (file.originalUnavailable)
    return {
      id: `sent-image-unavailable-${index}-${file.name}-${file.size}`,
      name: file.name,
      mimeType: file.mimeType,
      kind: 'image',
      size: file.size,
      createdAt: 0,
      source: { provider: 'user' }
    }
  if (!file.thumbnail?.startsWith('data:image/')) return undefined
  return {
    id: `sent-image-${index}-${file.name}-${file.size}`,
    name: file.name,
    mimeType: file.mimeType,
    kind: 'image',
    size: file.size,
    createdAt: 0,
    url: file.thumbnail,
    source: { provider: 'utilisateur' }
  }
}

const ChatMessageRow = memo(
  function ChatMessageRow({
    message,
    conversationId,
    onInspectTurn,
    onFork,
    onOpenImage,
    onPickSuggestion,
    onOpenLiveAction,
    directiveReceipts
  }: {
    message: Msg
    conversationId: string | null
    onInspectTurn?: (target: InspectTurnTarget) => void
    onFork?: (messageId: string) => void
    onOpenImage?: (image: { src: string; name: string }) => void
    onPickSuggestion?: (prompt: string) => void
    onOpenLiveAction?: (mode: 'live' | 'history') => void
    directiveReceipts?: DirectiveReceipt[]
  }): React.JSX.Element {
    if (message.role === 'user') {
      return (
        <div className="msg user fade-in">
          <div className="msg-meta">
            <span className="msg-role">Toi</span>
          </div>
          {message.content && (
            <div className="msg-body" dir="auto">
              {message.content}
            </div>
          )}
          {message.attachments && message.attachments.length > 0 && (
            <div
              className={`attachment-list sent${
                message.attachments.some((file) => sentImageArtifact(file, 0)) ? ' has-preview' : ''
              }`}
            >
              {message.attachments.map((file, fileIndex) => {
                const artifact = sentImageArtifact(file, fileIndex)
                return artifact ? (
                  <ArtifactPreview
                    key={`${file.name}-${fileIndex}`}
                    artifact={artifact}
                    displayName="image envoyée"
                    sourceLabel={`Envoyée · ${file.name}`}
                    previewError={
                      file.originalUnavailable
                        ? 'Image originale non conservée · stockage indisponible'
                        : undefined
                    }
                    conversationId={conversationId}
                    turnId={file.turnId}
                    onOpenImage={onOpenImage}
                  />
                ) : (
                  <span className="attachment-chip" key={`${file.name}-${fileIndex}`}>
                    <span aria-hidden="true">{file.mimeType.startsWith('image/') ? '▧' : '▤'}</span>
                    <span className="attachment-name">{file.name}</span>
                    <small>{formatFileSize(file.size)}</small>
                  </span>
                )
              })}
            </div>
          )}
          {message.messageId && onFork && (
            <div className="msg-turn-actions">
              {onFork && (
                <button
                  type="button"
                  className="msg-turn-icon"
                  title="Créer une branche à partir de ce message"
                  aria-label="Créer une branche à partir de ce message"
                  onClick={() => onFork(message.messageId!)}
                >
                  <ForkIcon />
                </button>
              )}
            </div>
          )}
        </div>
      )
    }
    return (
      <div className="msg assistant fade-in">
        <div className="msg-meta">
          <span className="msg-role">Agent</span>
          {!message.done && <span className="spinner" />}
        </div>
        {/* Réflexion EN DIRECT : seule chose qui se passe pendant les secondes d'attente avant le
            premier mot. Disparaît dès que la réponse arrive (transitoire, jamais persistée). */}
        {!message.done && message.reasoning && message.parts.length === 0 && (
          <div className="msg-reasoning" data-testid="msg-reasoning">
            <span className="msg-reasoning-label">réflexion</span>
            <p>{message.reasoning}</p>
          </div>
        )}
        <div className="msg-turn">
          {message.parts.length === 0 && !message.done && (
            <div className="msg-body c-faint">réflexion…</div>
          )}
          {splitAssistantTimeline(message.parts, directiveReceipts ?? []).map(
            (timelineItem, timelineIndex) =>
              timelineItem.kind === 'receipt' ? (
                <DirectiveReceiptRow
                  key={`receipt-${timelineItem.receipt.id}`}
                  receipt={timelineItem.receipt}
                />
              ) : (
                <Fragment key={`parts-${timelineIndex}`}>
                  {groupAssistantActivity(timelineItem.parts).map((part, index) =>
                    part.kind === 'text' ? (
                      <div key={index} className="msg-body" dir="auto">
                        <Markdown text={part.text} highlightFinalSummary />
                      </div>
                    ) : part.kind === 'suggestions' ? (
                      <SuggestionGrid
                        key={index}
                        groups={part.groups}
                        onPick={(prompt) => onPickSuggestion?.(prompt)}
                      />
                    ) : part.kind === 'scout-table' ? (
                      <ScoutTable
                        key={index}
                        rows={part.rows}
                        onPick={(prompt) => onPickSuggestion?.(prompt)}
                      />
                    ) : part.kind === 'artifact' ? (
                      <ArtifactPreview
                        key={part.artifact.id}
                        artifact={part.artifact}
                        conversationId={conversationId}
                        turnId={message.turnId}
                        onOpenImage={onOpenImage}
                      />
                    ) : (
                      <AssistantActivityGroup
                        key={index}
                        actions={part.actions}
                        onOpenLiveAction={onOpenLiveAction}
                        // Reprendre passe par le canal d'orchestration DIRECT : le main y retrouve l'acquis
                        // persisté et repart à la phase suivante, sans écrire dans le fil un message que
                        // l'utilisateur n'a pas tapé (le renvoi par le composer fabriquait un faux tour).
                        // Le résultat est RENVOYÉ au bouton (plus de `void`) : il porte l'état de
                        // chargement et rend visible un `{ok:false, error}` au lieu de le jeter.
                        onResume={(task) =>
                          window.api?.orchestrate?.(task, conversationId ?? undefined) ??
                          Promise.resolve({ ok: false, error: 'orchestration indisponible' })
                        }
                      />
                    )
                  )}
                </Fragment>
              )
          )}
        </div>
        <div className="msg-turn-actions">
          {message.turnId && message.turnId !== 'pending' && conversationId && onInspectTurn && (
            <button
              type="button"
              className="msg-turn-icon"
              title="Inspecter ce tour dans l'Observatory"
              aria-label="Inspecter ce tour"
              // Un message COPIE par un fork garde son tour, mais le journal de ce tour vit dans
              // la conversation d'origine : on l'ouvre LA-BAS plutot que de chercher sous le fork.
              onClick={() =>
                onInspectTurn({
                  conversationId: message.turnConversationId ?? conversationId,
                  turnId: message.turnId!
                })
              }
            >
              <InspectIcon />
            </button>
          )}
          {message.messageId && onFork && (
            <button
              type="button"
              className="msg-turn-icon"
              title="Créer une branche à partir de ce tour"
              aria-label="Créer une branche à partir de ce tour"
              onClick={() => onFork(message.messageId!)}
            >
              <ForkIcon />
            </button>
          )}
        </div>
      </div>
    )
  },
  (prev, next) =>
    // Comparateur DATA-ONLY : la ligne ne re-rend QUE si sa donnée change (message/conversation/reçus).
    // Les props callbacks sont déjà stables (send via sendRef→pickSuggestion, fork/inspect via useCallback,
    // setters useState) → les ignorer n'introduit aucun stale et immunise la ligne contre le churn du
    // composer (frappe/ghost-text) : garantit l'invariant perf « composer change ≠ re-render des lignes ».
    prev.message === next.message &&
    prev.conversationId === next.conversationId &&
    prev.directiveReceipts === next.directiveReceipts
)

/* ---------- Vue ---------- */

/**
 * Chat façon Claude Code : conversations à gauche, fil transparent au centre
 * (l'agent parle ET pilote — ses actions en puces inline), workflows (RUN.md)
 * repliables à droite. Tout se passe ici.
 */
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
  const [runScope, setRunScope] = useState<'conv' | 'tous'>('conv')
  const [runs, setRuns] = useState<RunEntry[]>([])
  const [checkpoints, setCheckpoints] = useState<CheckpointEntry[]>([])
  const [forkedCheckpoint, setForkedCheckpoint] = useState('')
  /** Miroir stable : `revealLiveAction` lit la liste courante sans se recreer a chaque chargement. */
  const runsRef = useRef<RunEntry[]>([])
  runsRef.current = runs
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
      setRunScope('conv')
      const target = pickRunForTrace(runsRef.current, runId)
      if (target) void viewRun(target)
      return
    }
    requestAnimationFrame(() =>
      liveRunCardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    )
  }, [])
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [showDecisions, setShowDecisions] = useState(false)
  const [decisionError, setDecisionError] = useState<string | null>(null)
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
  const steeringRef = useRef(new Set<number>())
  const sendLocksRef = useRef(new Set<string>())
  const composerDraftKeyRef = useRef(NEW_DRAFT_KEY)
  const composerSelectionGenerationRef = useRef(0)
  const composerDraftsRef = useRef(
    new Map<string, ComposerDraft>([[NEW_DRAFT_KEY, { input: '', attachments: [], error: null }]])
  )
  const activeRef = useRef<string | null>(null)
  const loadConversationRequestRef = useRef(0)
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
      } catch {
        // L'identité affichée reste la dernière identité confirmée.
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
    } catch {
      return
    }
    const target = pickTurnToResume(turns)
    if (!target) return
    const conversation = loaded.find((candidate) => candidate.id === target.conversationId)
    if (!conversation) return
    await loadConv(conversation)
    await replayTurnJournal(target.conversationId, target.turnId)
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
  const runScopeRef = useRef(runScope)
  useEffect(() => {
    runScopeRef.current = runScope
  }, [runScope])
  /** Workflows affichés : ceux de la CONVERSATION ACTIVE par défaut, global sur demande. */
  async function refreshRuns(): Promise<void> {
    const request: RunRequestIdentity = {
      id: runsRequestRef.current.id + 1,
      scope: runScopeRef.current,
      convId: activeRef.current
    }
    runsRequestRef.current = request
    const nextRuns =
      request.scope === 'tous'
        ? await window.api.listRuns()
        : request.convId
          ? ((await window.api.conversationRuns(request.convId)) as RunEntry[])
          : []
    const currentRequest = {
      id: runsRequestRef.current.id,
      scope: runScopeRef.current,
      convId: activeRef.current
    }
    if (isRunRequestCurrent(request, currentRequest)) setRuns(nextRuns)
    if (window.api.checkpointForks) {
      const nextCheckpoints = await window.api.checkpointForks()
      if (isRunRequestCurrent(request, currentRequest)) setCheckpoints(nextCheckpoints)
    }
  }
  function selectRunScope(scope: 'conv' | 'tous'): void {
    runScopeRef.current = scope
    setRunScope(scope)
  }
  useEffect(() => {
    void Promise.resolve().then(refreshRuns)
  }, [runScope, activeId])
  // Tient le bus au courant de la conversation active → les orchestrations s'y rattachent.
  useEffect(() => {
    window.api.setActiveConversation(activeId)
  }, [activeId])
  // Une décision en attente doit se VOIR (questionnaire déplié), pas rester derrière un toggle.
  useEffect(() => {
    if (decisions.length > 0) setShowDecisions(true)
  }, [decisions.length])
  async function refreshDecisions(): Promise<void> {
    const d = (await window.api.authorityPending()) as Decision[]
    setDecisions(Array.isArray(d) ? d : [])
  }

  useEffect(() => {
    void Promise.resolve().then(() => {
      void refreshConvs()
      void refreshDecisions()
      void refreshRuntimeIdentity()
    })
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
      if (e.type === 'refresh') {
        if (e.scope === 'conversations') refreshConvs()
        if (e.scope === 'decisions') refreshDecisions()
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
      deltaBatcher.cancel()
      offApp()
    }
  }, [])

  useEffect(() => {
    if (!isActive) return
    void Promise.resolve().then(refreshDecisions)
    void Promise.resolve().then(() => refreshRuntimeIdentity())
    const timer = setInterval(refreshDecisions, 8000)
    return () => clearInterval(timer)
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
      if (!conversationId || !busyConversationsRef.current.has(conversationId)) return
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

  async function loadConv(c: Conv): Promise<void> {
    const requestId = ++loadConversationRequestRef.current
    const detailed = c.messages ? c : ((await window.api.conversation(c.id)) as Conv | null)
    if (!detailed || requestId !== loadConversationRequestRef.current) return
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
      if (!detail?.prompt) return
      const id = detail.conversationId
      if (id) {
        const target = convsRef.current.find((conversation) => conversation.id === id)
        if (target) loadConv(target)
        else {
          activeRef.current = id
          setActiveId(id)
          setMessages([])
        }
      }
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
    } catch {
      return
    }
    const replayed = events
      .filter((event) => event.kind === 'delta' && typeof event.text === 'string')
      .map((event) => event.text as string)
      .join('')
    if (!replayed.trim()) return
    const current = liveMessagesRef.current.get(conversationId) ?? []
    const already = current.some((message) =>
      JSON.stringify(message).includes(replayed.trim().slice(0, 80))
    )
    if (already) return
    const next: Msg[] = [
      ...current,
      // `parts` EXPLICITE : un tableau vide passerait le `??` de hydrateStoredAssistant et donnerait
      // un message sans aucune part → invisible (cause du rejeu muet constatée en essai réel).
      hydrateStoredAssistant({
        content: replayed,
        parts: [{ kind: 'text', text: replayed }],
        status: 'completed'
      })
    ]
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
      if (target) loadConv(target)
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
    const scope = runScopeRef.current
    if (scope === 'conv' && !activeId) return
    setRunDeleteError(null)
    setDeleteRunCandidate({
      run,
      scope,
      ...(scope === 'conv' && activeId ? { conversationId: activeId } : {})
    })
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
    if (updated) loadConv(updated)
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
    if (target) loadConv(target)
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
    setConversationInterrupting(id, true)
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
    } catch {
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
    } catch {
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
  // À la libération de `busy` (render frais, busy=false), on draine la FILE D'ATTENTE — un message
  // par tour (chacun = sa propre paire Q/R). Vaut aussi bien pour l'auto-drain fin de tour que pour
  // une interruption manuelle (les deux passent par une transition busy→false).
  useEffect(() => {
    const id = activeRef.current
    if (!id) return
    if (busy) return
    if (interruptingConversationsRef.current.has(id)) setConversationInterrupting(id, false)
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

  /* --- envoi --- */

  function flatten(msgs: Msg[]): Array<{ role: 'user' | 'assistant'; content: string }> {
    return msgs.map((m) => {
      if (m.role === 'user') return { role: 'user' as const, content: m.content }
      const content = m.parts
        .map((p) => {
          if (p.kind === 'text') return p.text
          if (p.kind === 'artifact') return `[artefact ${p.artifact.name}]`
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
      const res = await window.api.pilotChat(payload, convId)
      if (!res.ok || res.cancelled)
        patchLast(convId, (m) => {
          m.status = res.cancelled ? 'cancelled' : 'failed'
          m.done = true
          if (!res.cancelled) m.parts.push({ kind: 'text', text: `⚠️ ${res.error ?? 'erreur'}` })
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
            kind: 'text',
            text: `⚠️ ${error instanceof Error ? error.message : String(error)}`
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
          if (m.parts.length === 0) m.parts.push({ kind: 'text', text: '_(aucune réponse)_' })
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

  /* --- workflows --- */

  async function viewRun(r: RunEntry): Promise<void> {
    // Fil des sous-agents (trace) d'abord ; à défaut, le RUN.md brut.
    try {
      const trace = (await window.api.runTrace(r.path)) as OrchStep[] | null
      setOpenTrace(trace && trace.length > 0 ? trace : null)
    } catch {
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
  const conversationHits = useMemo(() => searchConversations(convs, convQuery), [convs, convQuery])

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
      } catch {
        /* trace illisible : on garde le direct, jamais d'écran vide à cause de la relecture */
      }
    })()
    return () => {
      alive = false
    }
  }, [isActive, activeId, showRuns, paneTab, liveRuns, active])

  const visibleLiveRuns = mergeLiveAndPersisted<OrchStep>(
    visibleScopedRuns<OrchStep>(liveRuns, activeId ?? undefined, runScope),
    runScope === 'tous' ? persistedRuns : persistedRuns.filter((run) => run.convId === activeId)
  )

  return (
    <div
      className={`chat-layout${showRuns ? '' : ' is-runs-collapsed'}`}
      data-testid="chat-view"
      data-active-conversation-id={activeId ?? ''}
    >
      {/* ---- Panneau gauche : conversations ---- */}
      <aside className="conv-pane" style={{ width: `${conversationsPaneWidth}px` }}>
        <div className="conv-head">
          <ModuleHeader eyebrow="Espace de travail" title="Conversations" />
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
                    if (target) loadConv(target)
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
          {conversationHits.map(({ conversation: c, snippet }) => {
            const conversationState = deriveConversationState({
              busy: busyConversations.has(c.id),
              messageCount: c.messageCount ?? c.messages?.length ?? 0,
              lastMessageRole: c.lastMessageRole ?? c.messages?.at(-1)?.role,
              lastAssistantStatus: c.lastAssistantStatus
            })
            const stateDescription = `${conversationState.label} — ${conversationState.detail}`
            return (
              <div key={c.id} className={`conv-item${c.id === activeId ? ' active' : ''}`}>
                <button className="conv-pick" onClick={() => loadConv(c)}>
                  <span
                    className={`conversation-state is-${conversationState.key}`}
                    data-conversation-state={conversationState.key}
                    role="img"
                    aria-label={`État de la conversation : ${stateDescription}`}
                    title={stateDescription}
                  />
                  <span className="conv-copy">
                    <span className="conv-label">{c.title}</span>
                    {convQuery && snippet && <span className="conv-snippet">{snippet}</span>}
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
        className={`chat${dragActive ? ' is-file-dragging' : ''}`}
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
            {decisions.length > 0 && (
              <button
                className={`btn btn-sm${showDecisions ? ' btn-accent' : ''}`}
                onClick={() => setShowDecisions((v) => !v)}
              >
                <span className="status-dot st-warn" /> {decisions.length} décision
                {decisions.length > 1 ? 's' : ''}
              </button>
            )}
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

        {showDecisions && decisions.length > 0 && (
          <div className="decision-strip col fade-in">
            {decisions.map((d) => (
              <div key={d.id} className="decision-row">
                <span className="decision-q">{d.question}</span>
                <div className="row gap2">
                  {(d.options ?? []).slice(0, 4).map((o, i) => (
                    <button
                      key={i}
                      className="btn btn-sm"
                      onClick={async () => {
                        try {
                          setDecisionError(null)
                          await window.api.authorityResolve(d.id, o)
                          refreshDecisions()
                        } catch (error) {
                          setDecisionError(error instanceof Error ? error.message : String(error))
                        }
                      }}
                    >
                      {String(o)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {decisionError && <div className="attachment-error">⚠️ {decisionError}</div>}
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
          {messages.length === 0 && (!busy || activeId === null) && (
            <div className="chat-welcome">
              <div className="empty">
                <h3>Parle à l’agent</h3>
                <div className="c-faint">
                  Il répond ET peut agir sur l’app (naviguer, créer une conversation, régler un
                  rôle, ouvrir un graphe…). Ses actions apparaissent en direct.
                </div>
              </div>
              <div className="chat-suggest">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="btn btn-sm btn-ghost" onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
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

        {pendingDirectives.length > 0 && (
          <div className="directive-queue" aria-label="Messages en attente">
            <div className="directive-queue-head">
              <span className="directive-queue-title">
                ⚡ File d’attente · {pendingDirectives.length}
              </span>
              <span className="directive-queue-hint">
                envoyés un par un à la fin du tour en cours
              </span>
              {busy && (
                <button
                  type="button"
                  className="directive-queue-send directive-queue-send-all"
                  title="Interrompre le tour en cours et envoyer tous les messages en file maintenant"
                  aria-label="Interrompre et envoyer tout"
                  disabled={interruptingConversations.has(activeId ?? '')}
                  onClick={interruptAndFlushQueue}
                >
                  {interruptingConversations.has(activeId ?? '')
                    ? '⏳ Interruption…'
                    : '⏹ Interrompre et envoyer tout'}
                </button>
              )}
            </div>
            {pendingDirectives.map((directive, index) => (
              <div className="directive-queue-item" key={directive.id}>
                <span className="directive-queue-index">{index + 1}</span>
                <span className="directive-queue-text" title={directive.text}>
                  {directive.text}
                </span>
                {/* Hors tour actif il n'y a RIEN à interrompre : afficher le bouton donnait un clic
                    mort qui figeait la file sur « ⏳ Interruption… ». La file se draine alors seule. */}
                {busy && (
                  <button
                    type="button"
                    className="directive-queue-send"
                    title="Interrompre le tour en cours et envoyer la file maintenant, en commençant par ce message"
                    aria-label={`Interrompre et envoyer à partir du message ${index + 1}`}
                    disabled={interruptingConversations.has(activeId ?? '')}
                    onClick={interruptAndFlushQueue}
                  >
                    {interruptingConversations.has(activeId ?? '')
                      ? '⏳ Interruption…'
                      : '⏹ Interrompre et envoyer'}
                  </button>
                )}
                {busy && (
                  <button
                    type="button"
                    className="directive-queue-steer"
                    title="Orienter maintenant — injecter ce message comme directive PRIORITAIRE dans le tour en cours, sans l’interrompre"
                    aria-label={`Orienter le tour en cours avec le message ${index + 1}`}
                    disabled={steeringDirectives.has(directive.id)}
                    onClick={() => void steerWithoutInterrupt(directive)}
                  >
                    {steeringDirectives.has(directive.id) ? '⏳ Orientation…' : '🧭 Orienter'}
                  </button>
                )}
                {busy && (
                  <button
                    type="button"
                    className="directive-queue-send directive-queue-btw"
                    title={
                      directive.mode === 'btw'
                        ? 'BTW confirmé — ce message reste en dernier : il partira après les autres messages en file, y compris ceux tapés ensuite'
                        : 'BTW — remettre ce message à la fin de la file sans interrompre le tour en cours'
                    }
                    aria-label={`Remettre le message ${index + 1} en file via BTW`}
                    disabled={directive.mode === 'btw'}
                    onClick={() => moveQueuedMessageToBtw(directive)}
                  >
                    {directive.mode === 'btw' ? '✓ BTW' : 'BTW'}
                  </button>
                )}
                <button
                  type="button"
                  className="directive-queue-remove"
                  title="Retirer de la file"
                  aria-label={`Retirer le message ${index + 1}`}
                  onClick={() => restoreQueuedMessageToDraft(directive)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
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
                }}
                onKeyDown={(e) => {
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
                ARRÊTER ne doit dépendre de RIEN d'autre que « un tour est en cours ».
                Avant, un SEUL bouton portait trois comportements : `busy && !input.trim()` → Stop,
                `busy && input.trim()` → Mettre en file, sinon Envoyer. Conséquence rapportée par
                l'utilisateur : dès qu'il avait tapé quelque chose, il devait d'abord aller VIDER la
                barre de prompt pour que le clic agisse comme stop. L'action la plus urgente du produit
                était masquée derrière un état accessoire.
              */}
              {busy && (
                <button
                  className="btn composer-stop"
                  data-testid="composer-stop"
                  onClick={() => {
                    if (activeId) void window.api.cancelPilotChat(activeId)
                  }}
                  disabled={!activeId}
                  aria-label="Arrêter la réponse"
                  title="Arrêter la réponse en cours (indépendant de ce qui est tapé)"
                >
                  ■ Stop
                </button>
              )}
              <button
                className="btn-accent btn composer-send"
                data-testid="composer-send"
                onClick={() => {
                  if (handleBtw()) return
                  // Plus de branche « composer vide → annuler » : arrêter a son propre bouton, donc ce
                  // bouton ne fait plus qu'une chose à la fois — envoyer, ou mettre en file.
                  if (busy && activeId) queueCurrentMessage()
                  else send()
                }}
                disabled={
                  busy ? !activeId || !input.trim() : !input.trim() && attachments.length === 0
                }
                aria-label={busy ? 'Mettre le message en file d’attente' : 'Envoyer le message'}
              >
                {busy ? '⚡ Mettre en file' : 'Envoyer'}
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
          runScope={runScope}
          selectRunScope={selectRunScope}
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
