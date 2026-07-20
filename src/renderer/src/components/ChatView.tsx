import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Markdown } from './Markdown'
import { ActivityPane } from './ActivityPane'
import { HumanJson } from './HumanJson'
import { ModuleHeader } from './ModuleHeader'
import {
  CHAT_PANE_LIMITS,
  clampConversationPaneWidth,
  groupAssistantActivity,
  hydrateStoredAssistant,
  isRunRequestCurrent,
  isChatNearBottom,
  reduceScopedLiveRuns,
  reduceAssistantPilotEvent,
  resolveChatRuntimeIdentity,
  type ChatActionPart,
  type ChatPart,
  type HydratedAssistantMessage,
  type ChatRuntimeIdentity,
  type OrchestratorModelOption,
  type RunRequestIdentity,
  type ScopedLiveRun
} from './chat-view-model'
import { searchConversations } from './conversation-search'
import { OrchestratorModelSelector } from './OrchestratorModelSelector'
import { reconstructBranchChain } from '../../../shared/conversation-branches'
import './ChatView.css'
import type { InspectTurnTarget } from '../observatory-focus'

/* ---------- Types ---------- */

type Part = ChatPart

interface AttachmentMeta {
  name: string
  mimeType: string
  size: number
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
  kind:
    | 'delta'
    | 'stream-reset'
    | 'think'
    | 'command'
    | 'result'
    | 'done'
    | 'error'
    | 'retry'
    | 'cancellation'
  text?: string
  streamId?: string
  actionId?: string
  iteration?: number
  name?: string
  args?: unknown
  ok?: boolean
  data?: unknown
}

type ConvBranch = { id: string; parentBranchId?: string; forkedFromMessageId?: string }
type Conv = {
  id: string
  title: string
  category: string
  provider: string
  rootBranchId?: string
  activeBranchId?: string
  branches?: ConvBranch[]
  messages: Array<{
    role: 'user' | 'assistant'
    content: string
    ts: number
    attachments?: AttachmentMeta[]
    messageId?: string
    branchId?: string
    parentMessageId?: string
    turnId?: string
    status?: 'streaming' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
    parts?: Part[]
    error?: string
  }>
  updatedAt: number
}

type RunEntry = {
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

type Decision = { id: string; question: string; options?: unknown[]; safeDefault?: unknown }

type RuntimeModel = Parameters<typeof resolveChatRuntimeIdentity>[1][number]

/** Une étape d'orchestration (sous-agent / juge / gate) — fil des sous-agents. */
type OrchStep = {
  step: 'exec' | 'judge' | 'gate' | string
  provider?: string
  role?: string
  text?: string
  detail?: string
  costUsd?: number
  prompt?: {
    provider: string
    model?: string
    transport: string
    system?: string
    messages: Array<{ role: string; content: string }>
    options: Record<string, unknown>
    limitation: string
  }
}
/** Orchestration en cours (statut temps réel). */
const STEP_META: Record<string, { icon: string; label: string }> = {
  exec: { icon: '🤖', label: 'sous-agent' },
  judge: { icon: '⚖️', label: 'juge' },
  gate: { icon: '🚦', label: 'gate' }
}

/** Fil des sous-agents (exec/juge/gate) — réutilisé en direct et dans le détail d'un run. */
function StepThread({ steps }: { steps: OrchStep[] }): React.JSX.Element {
  return (
    <div className="col" style={{ gap: 'var(--s2)' }}>
      {steps.map((s, i) => {
        const meta = STEP_META[s.step] ?? { icon: '•', label: s.step }
        return (
          <div key={i} className="subagent-step">
            <div className="row gap2" style={{ fontSize: 11 }}>
              <span>{meta.icon}</span>
              <span className="c-dim" style={{ fontWeight: 600 }}>
                {meta.label}
              </span>
              {s.provider && <span className="mono c-accent">{s.provider}</span>}
              {s.detail && <span className="c-faint">{s.detail}</span>}
              {typeof s.costUsd === 'number' && (
                <span className="c-faint tnum" style={{ marginLeft: 'auto' }}>
                  {s.costUsd.toFixed(4)} $
                </span>
              )}
            </div>
            {s.text && <div className="subagent-text c-dim">{s.text}</div>}
            {s.prompt && (
              <details className="prompt-envelope">
                <summary>Voir le prompt envoyé</summary>
                <div className="prompt-envelope-meta">
                  <span>{s.prompt.provider}</span>
                  {s.prompt.model && <span>{s.prompt.model}</span>}
                  <span>{s.prompt.transport}</span>
                </div>
                <p className="prompt-envelope-limit">{s.prompt.limitation}</p>
                <strong>Système · instructions + skills/contexte injectés</strong>
                <pre>{s.prompt.system || 'Aucun bloc système.'}</pre>
                <strong>Messages transmis</strong>
                {s.prompt.messages.map((message, messageIndex) => (
                  <section key={`${message.role}-${messageIndex}`}>
                    <small>{message.role}</small>
                    <pre>{message.content}</pre>
                  </section>
                ))}
                <strong>Options de transport</strong>
                <HumanJson value={s.prompt.options} />
              </details>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function AssistantActionEvent({ part }: { part: ChatActionPart }): React.JSX.Element {
  return (
    <details className={`action-event${part.ok === false ? ' failed' : ''}`}>
      <summary>
        <span
          className={`status-dot ${
            part.ok === undefined ? 'st-info' : part.ok ? 'st-ok' : 'st-err'
          }`}
        />
        <span className="action-name">{CMD_LABEL[part.name] ?? part.name}</span>
        {part.args != null && (
          <span className="action-args mono">{JSON.stringify(part.args).slice(0, 96)}</span>
        )}
        <span className="action-status">
          {part.ok === undefined ? 'en cours' : part.ok ? 'réussi' : 'échec'}
        </span>
        {part.ok === undefined && <span className="spinner" />}
      </summary>
      <div className="action-detail">
        {part.args != null && (
          <section>
            <small>Entrée</small>
            <HumanJson value={part.args} />
          </section>
        )}
        {part.data != null && (
          <section>
            <small>Résultat</small>
            <HumanJson value={part.data} />
          </section>
        )}
        {part.args == null && part.data == null && (
          <span className="c-faint">
            {part.ok === undefined ? 'Action en cours…' : 'Aucun détail supplémentaire.'}
          </span>
        )}
      </div>
    </details>
  )
}

export function AssistantActivityGroup({
  actions
}: {
  actions: ChatActionPart[]
}): React.JSX.Element {
  const failed = actions.some((action) => action.ok === false)
  const running = actions.some((action) => action.ok === undefined)
  const status = running
    ? 'en cours'
    : failed
      ? 'avec erreur'
      : actions.length > 1
        ? 'terminées'
        : 'terminée'
  return (
    <details className={`activity-group${failed ? ' failed' : ''}`}>
      <summary>
        <span className={`status-dot ${running ? 'st-info' : failed ? 'st-err' : 'st-ok'}`} />
        <span className="activity-group-title">
          {actions.length} action{actions.length > 1 ? 's' : ''} {status}
        </span>
        <span className="activity-group-tools">
          {actions.map((action) => CMD_LABEL[action.name] ?? action.name).join(' · ')}
        </span>
        {running && <span className="spinner" />}
      </summary>
      <div className="activity-group-list">
        {actions.map((action, index) => (
          <AssistantActionEvent key={action.actionId ?? `${action.name}-${index}`} part={action} />
        ))}
      </div>
    </details>
  )
}

/* ---------- Constantes ---------- */

const SUGGESTIONS = [
  'Crée une conversation « Revue archi » en catégorie codex',
  'Mets le juge sur codex',
  'Ouvre le graphe du brain rig-tv',
  'Quel est l’état des workflows ?'
]

const CMD_LABEL: Record<string, string> = {
  navigate: 'Navigation',
  chat_send: 'Message',
  orchestrate: 'Orchestration',
  create_conversation: 'Conversation créée',
  rename_conversation: 'Conversation renommée',
  remove_conversation: 'Conversation supprimée',
  set_role: 'Rôle réglé',
  resolve_decision: 'Décision résolue',
  load_graph: 'Graphe chargé',
  get_state: 'Lecture d’état'
}

const CAT_DOT: Record<string, string> = { claude: 'st-info', codex: 'st-violet', hermes: 'st-warn' }
const RUN_DOT: Record<string, string> = {
  green: 'st-ok',
  open: 'st-warn',
  red: 'st-err',
  'degraded-closed': 'st-violet'
}

const MAX_ATTACHMENTS = 8
const NEW_DRAFT_KEY = '__new__'
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MAX_ATTACHMENTS_BYTES = 20 * 1024 * 1024
const MAX_INLINE_TEXT_BYTES = 2 * 1024 * 1024
const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'json',
  'jsonl',
  'csv',
  'tsv',
  'log',
  'xml',
  'yaml',
  'yml',
  'toml',
  'ini',
  'sql',
  'js',
  'jsx',
  'ts',
  'tsx',
  'css',
  'html',
  'py',
  'cs',
  'vb'
])

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

function fileKind(file: File): ChatAttachment['kind'] {
  if (file.type.startsWith('image/')) return 'image'
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (
    file.size <= MAX_INLINE_TEXT_BYTES &&
    (file.type.startsWith('text/') || TEXT_EXTENSIONS.has(extension))
  )
    return 'text'
  return 'file'
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 32_768
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

async function encodeAttachment(file: File): Promise<ChatAttachment> {
  const kind = fileKind(file)
  return {
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    kind,
    content:
      kind === 'text' ? await file.text() : bytesToBase64(new Uint8Array(await file.arrayBuffer()))
  }
}

function messageKey(message: Msg, index: number): string {
  return `${message.role}:${index}`
}

const ChatMessageRow = memo(function ChatMessageRow({
  message,
  conversationId,
  onInspectTurn,
  onFork
}: {
  message: Msg
  conversationId: string | null
  onInspectTurn?: (target: InspectTurnTarget) => void
  onFork?: (messageId: string) => void
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
          <div className="attachment-list sent">
            {message.attachments.map((file, fileIndex) => (
              <span className="attachment-chip" key={`${file.name}-${fileIndex}`}>
                <span aria-hidden="true">{file.mimeType.startsWith('image/') ? '▧' : '▤'}</span>
                <span className="attachment-name">{file.name}</span>
                <small>{formatFileSize(file.size)}</small>
              </span>
            ))}
          </div>
        )}
        {message.messageId && onFork && (
          <div className="msg-turn-actions">
            <button
              type="button"
              className="msg-fork-turn"
              title="Créer une branche à partir de ce message"
              onClick={() => onFork(message.messageId!)}
            >
              Forker depuis ce tour
            </button>
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
      <div className="msg-turn">
        {message.parts.length === 0 && !message.done && (
          <div className="msg-body c-faint">réflexion…</div>
        )}
        {groupAssistantActivity(message.parts).map((part, index) =>
          part.kind === 'text' ? (
            <div key={index} className="msg-body" dir="auto">
              <Markdown text={part.text} />
            </div>
          ) : (
            <AssistantActivityGroup key={index} actions={part.actions} />
          )
        )}
      </div>
      <div className="msg-turn-actions">
        {message.turnId && message.turnId !== 'pending' && conversationId && onInspectTurn && (
          <button
            type="button"
            className="msg-inspect-turn"
            onClick={() => onInspectTurn({ conversationId, turnId: message.turnId! })}
          >
            Inspecter ce tour
          </button>
        )}
        {message.messageId && onFork && (
          <button
            type="button"
            className="msg-fork-turn"
            title="Créer une branche à partir de ce tour"
            onClick={() => onFork(message.messageId!)}
          >
            Forker depuis ce tour
          </button>
        )}
      </div>
    </div>
  )
})

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
  const [convQuery, setConvQuery] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [busyConversations, setBusyConversations] = useState<Set<string>>(() => new Set())
  const [runtimeIdentity, setRuntimeIdentity] = useState<ChatRuntimeIdentity | null>(null)
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
    return clampConversationPaneWidth(Number.isFinite(saved) && saved > 0 ? saved : 292)
  })
  const [hasNewActivity, setHasNewActivity] = useState(false)
  const [showRuns, setShowRuns] = useState(false)
  const [runsPaneWidth, setRunsPaneWidth] = useState(() => {
    const saved = Number(window.localStorage.getItem('autowin.chat.runsPaneWidth'))
    const value = Number.isFinite(saved) && saved > 0 ? saved : 340
    return Math.min(CHAT_PANE_LIMITS.workflows.max, Math.max(CHAT_PANE_LIMITS.workflows.min, value))
  })
  const [paneTab, setPaneTab] = useState<'runs' | 'activite'>('runs')
  const [runScope, setRunScope] = useState<'conv' | 'tous'>('conv')
  const [runs, setRuns] = useState<RunEntry[]>([])
  const [openRun, setOpenRun] = useState<{ path: string; content: string } | null>(null)
  const [openTrace, setOpenTrace] = useState<OrchStep[] | null>(null)
  const [liveRuns, setLiveRuns] = useState<Record<string, ScopedLiveRun<OrchStep>>>({})
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [showDecisions, setShowDecisions] = useState(false)
  const [decisionError, setDecisionError] = useState<string | null>(null)
  const [deleteCandidate, setDeleteCandidate] = useState<Conv | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const composerInputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const liveMessagesRef = useRef(new Map<string, Msg[]>())
  const busyConversationsRef = useRef(new Set<string>())
  const sendLocksRef = useRef(new Set<string>())
  const composerDraftKeyRef = useRef(NEW_DRAFT_KEY)
  const composerSelectionGenerationRef = useRef(0)
  const composerDraftsRef = useRef(
    new Map<string, ComposerDraft>([[NEW_DRAFT_KEY, { input: '', attachments: [], error: null }]])
  )
  const activeRef = useRef<string | null>(null)
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

  async function refreshRuntimeIdentity(): Promise<ChatRuntimeIdentity> {
    const generation = ++runtimeRefreshGenerationRef.current
    const [models, transport] = await Promise.all([
      window.api.models(),
      window.api.routerMigrationState?.() ??
        Promise.resolve({
          mode: 'omniroute' as const,
          routeModel: 'auto/coding',
          credentialConfigured: false
        })
    ])
    const omniRouteModels = (models as RuntimeModel[]).filter(
      (model) => model.provider === 'omniroute'
    )
    const resolved: ChatRuntimeIdentity = {
      provider: 'omniroute',
      model: transport.routeModel ?? 'auto/coding',
      modelLabel: transport.routeModel ?? 'auto/coding',
      reasoningEffort: 'none'
    }
    if (generation === runtimeRefreshGenerationRef.current) {
      setModelCatalog(omniRouteModels)
      setOrchestratorBinding({
        provider: 'omniroute',
        model: transport.routeModel ?? 'auto/coding',
        reasoningEffort: 'none'
      })
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
      if (option.provider !== 'omniroute') {
        throw new Error('Seules les routes OmniRoute peuvent être sélectionnées dans le chat')
      }
      await window.api.activateOmniRoute(option.model)
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
    setConvs((await window.api.conversations()) as Conv[])
  }
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
  async function refreshDecisions(): Promise<void> {
    const d = (await window.api.authorityPending()) as Decision[]
    setDecisions(Array.isArray(d) ? d : [])
  }

  useEffect(() => {
    void Promise.resolve().then(() => {
      void refreshConvs()
      void refreshRuns()
      void refreshDecisions()
      void refreshRuntimeIdentity()
    })
    // Les mutations faites par l'agent (bus) rafraîchissent les listes SANS toucher le fil.
    const offApp = window.api.onAppEvent((e) => {
      if (e.type === 'refresh') {
        if (e.scope === 'conversations') refreshConvs()
        if (e.scope === 'decisions') refreshDecisions()
        if (e.scope === 'workflows') refreshRuns()
        if (e.scope === 'roles') refreshRuntimeIdentity()
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
          setPaneTab('runs')
        }
      } else if (e.type === 'orchestrate-phase' && e.phase && e.convId) {
        setLiveRuns((current) =>
          reduceScopedLiveRuns(current, {
            type: 'phase',
            convId: e.convId!,
            runPath: e.runPath,
            phase: e.phase as { step: string; provider?: string; role?: string }
          })
        )
      } else if (e.type === 'orchestrate-delta' && typeof e.delta === 'string' && e.convId) {
        setLiveRuns((current) =>
          reduceScopedLiveRuns(current, {
            type: 'delta',
            convId: e.convId!,
            runPath: e.runPath,
            delta: e.delta as string
          })
        )
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
        void refreshRuns()
        // Laisse le run terminé visible ~4 s en tant que « live », puis il rejoint la liste.
        setTimeout(
          () =>
            setLiveRuns((current) =>
              reduceScopedLiveRuns(current, { type: 'clear', convId, runPath })
            ),
          4000
        )
      }
    })
    return () => {
      offApp()
    }
  }, [])

  useEffect(() => {
    if (!isActive) return
    void Promise.resolve().then(refreshDecisions)
    void Promise.resolve().then(refreshRuntimeIdentity)
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
      next[i] = copy
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
      scroll.scrollTo({ top: scroll.scrollHeight, behavior: 'smooth' })
      setHasNewActivity(false)
    })
  }, [messages])

  useEffect(() => {
    const inputElement = composerInputRef.current
    if (!inputElement) return
    inputElement.style.height = 'auto'
    inputElement.style.height = `${Math.min(inputElement.scrollHeight, 180)}px`
  }, [input])

  /* --- conversations : sélection = fil rechargé depuis le store --- */

  function loadConv(c: Conv): void {
    followTailRef.current = true
    setHasNewActivity(false)
    activeRef.current = c.id
    setActiveId(c.id)
    const activeBranch = c.activeBranchId ?? c.rootBranchId
    const branchMessages = activeBranch
      ? reconstructBranchChain(c.messages, c.branches, activeBranch)
      : c.messages
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
    followTailRef.current = true
    setHasNewActivity(false)
    activeRef.current = null
    setActiveId(null)
    setMessages([])
    switchComposerDraft(NEW_DRAFT_KEY)
  }

  useEffect(() => {
    const openBrainwash = (event: Event): void => {
      const prompt = (event as CustomEvent<{ prompt?: string }>).detail?.prompt
      if (!prompt) return
      newConv()
      setDraftInput(NEW_DRAFT_KEY, prompt)
      requestAnimationFrame(() => composerInputRef.current?.focus())
    }
    window.addEventListener('autowin:brainwash', openBrainwash)
    return () => window.removeEventListener('autowin:brainwash', openBrainwash)
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

  /** Recharge la conversation active depuis le store à jour (invalide le cache live). */
  async function reloadActiveFromStore(id: string): Promise<void> {
    liveMessagesRef.current.delete(id)
    const fresh = (await window.api.conversations()) as Conv[]
    setConvs(fresh)
    const updated = fresh.find((c) => c.id === id)
    if (updated) loadConv(updated)
  }
  async function forkFromMessage(messageId: string): Promise<void> {
    if (!activeId) return
    await window.api.conversationsFork(activeId, messageId)
    await reloadActiveFromStore(activeId)
  }
  async function switchBranch(branchId: string): Promise<void> {
    if (!activeId) return
    await window.api.conversationsSwitchBranch(activeId, branchId)
    await reloadActiveFromStore(activeId)
  }
  // Callback STABLE (le row est memo'd — une ref inline casserait la mémoïsation).
  const forkRef = useRef(forkFromMessage)
  forkRef.current = forkFromMessage
  const handleFork = useCallback((messageId: string) => void forkRef.current(messageId), [])

  /* --- envoi --- */

  function flatten(msgs: Msg[]): Array<{ role: 'user' | 'assistant'; content: string }> {
    return msgs.map((m) => {
      if (m.role === 'user') return { role: 'user' as const, content: m.content }
      const content = m.parts
        .map((p) =>
          p.kind === 'text' ? p.text : `[a exécuté ${p.name}${p.ok === false ? ' (échec)' : ''}]`
        )
        .join('\n')
      return { role: 'assistant' as const, content }
    })
  }

  async function send(text?: string): Promise<void> {
    const value = (text ?? input).trim()
    const sendDraftKey = composerDraftKeyRef.current
    const outgoingDraft = getComposerDraft(sendDraftKey)
    const outgoingAttachments = outgoingDraft.attachments
    const sendSelectionGeneration = composerSelectionGenerationRef.current
    const sendLockKey = activeId ?? NEW_DRAFT_KEY
    if (
      (!value && outgoingAttachments.length === 0) ||
      busy ||
      sendLocksRef.current.has(sendLockKey)
    )
      return
    sendLocksRef.current.add(sendLockKey)

    let convId = activeId
    let messageCommitted = false
    try {
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
        composerDraftsRef.current.set(c.id, outgoingDraft)
        if (getComposerDraft(NEW_DRAFT_KEY) === outgoingDraft) {
          composerDraftsRef.current.set(NEW_DRAFT_KEY, { input: '', attachments: [], error: null })
        }
        if (shouldAdoptCreatedConversation) {
          activeRef.current = c.id
          setActiveId(c.id)
          composerDraftKeyRef.current = c.id
        }
        void refreshConvs()
      }

      const previousMessages = liveMessagesRef.current.get(convId) ?? messages
      const history: Msg[] = [
        ...previousMessages,
        {
          role: 'user',
          content: value,
          attachments: outgoingAttachments.map(({ name, mimeType, size }) => ({
            name,
            mimeType,
            size
          }))
        },
        hydrateStoredAssistant({ content: '', parts: [], status: 'streaming' })
      ]
      liveMessagesRef.current.set(convId, history)
      if (activeRef.current === convId) setMessages(history)
      setDraftInput(convId, '')
      setDraftAttachments(convId, () => [])
      setDraftError(convId, null)
      followTailRef.current = true
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
        setConversationBusy(convId, false)
        patchLast(convId, (m) => {
          if (m.status === 'streaming') m.status = 'interrupted'
          m.done = true
          if (m.parts.length === 0) m.parts.push({ kind: 'text', text: '_(aucune réponse)_' })
        })
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
    if (messageCommitted) {
      void refreshConvs()
      void refreshRuns()
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
  const openRunsCount = runs.filter((r) => r.summary.status === 'open').length

  return (
    <div className="chat-layout" data-active-conversation-id={activeId ?? ''}>
      {/* ---- Panneau gauche : conversations ---- */}
      <aside className="conv-pane" style={{ width: `${conversationsPaneWidth}px` }}>
        <div className="conv-head">
          <ModuleHeader eyebrow="Espace de travail" title="Conversations" />
          <button className="btn btn-sm" onClick={newConv} title="Nouvelle conversation">
            +
          </button>
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
        <div className="conv-list scroll-y">
          {convs.length === 0 && (
            <div className="c-faint" style={{ fontSize: 12, padding: 'var(--s2)' }}>
              Aucune conversation — écris un message pour en démarrer une.
            </div>
          )}
          {convs.length > 0 && conversationHits.length === 0 && (
            <div className="conv-search-empty">Aucun message ou titre trouvé.</div>
          )}
          {conversationHits.map(({ conversation: c, snippet }) => (
            <div key={c.id} className={`conv-item${c.id === activeId ? ' active' : ''}`}>
              <button className="conv-pick" onClick={() => loadConv(c)}>
                <span className={`status-dot ${CAT_DOT[c.category] ?? 'st-info'}`} />
                <span className="conv-copy">
                  <span className="conv-label">{c.title}</span>
                  {busyConversations.has(c.id) && <span className="conv-live">EN COURS</span>}
                  {convQuery && snippet && <span className="conv-snippet">{snippet}</span>}
                  {!convQuery && (
                    <span className="conv-meta">
                      <span>{c.provider}</span>
                      <span>{c.messages.length} messages</span>
                    </span>
                  )}
                </span>
                {convQuery && <span className="conv-count tnum">{c.messages.length}</span>}
              </button>
              <div className="conv-actions">
                <button
                  className="btn-ghost btn btn-sm"
                  onClick={() => renameConv(c)}
                  title="Renommer"
                >
                  ✎
                </button>
                <button
                  className="btn-ghost btn btn-sm c-err"
                  onClick={() => removeConv(c)}
                  title="Supprimer"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      </aside>
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
              className={`btn btn-sm${showRuns ? ' btn-accent' : ''}`}
              onClick={() => setShowRuns((v) => !v)}
              title="Workflows (RUN.md)"
            >
              Workflows{openRunsCount > 0 ? ` · ${openRunsCount} open` : ''}
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

        {active && (active.branches?.length ?? 0) > 1 && (
          <div className="branch-bar" role="tablist" aria-label="Branches de la conversation">
            {active.branches!.map((b, i) => {
              const current = b.id === (active.activeBranchId ?? active.rootBranchId)
              return (
                <button
                  key={b.id}
                  role="tab"
                  aria-selected={current}
                  className={`branch-chip${current ? ' active' : ''}`}
                  title="Revenir à cette branche"
                  onClick={() => void switchBranch(b.id)}
                >
                  {b.id === active.rootBranchId ? 'Principale' : `Branche ${i}`}
                </button>
              )
            })}
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

          {messages.map((message, index) => (
            <ChatMessageRow
              key={messageKey(message, index)}
              message={message}
              conversationId={activeId}
              onInspectTurn={onInspectTurn}
              onFork={handleFork}
            />
          ))}
        </div>

        {hasNewActivity && (
          <button
            type="button"
            className="chat-jump-latest"
            onClick={() => {
              followTailRef.current = true
              setHasNewActivity(false)
              scrollRef.current?.scrollTo({
                top: scrollRef.current.scrollHeight,
                behavior: 'smooth'
              })
            }}
          >
            ↓ Dernière réponse
          </button>
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
                onChange={(e) => setDraftInput(composerDraftKeyRef.current, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    send()
                  }
                }}
                onPaste={(e) => {
                  const pasted = e.clipboardData?.files
                  if (pasted && pasted.length > 0) {
                    e.preventDefault()
                    void addFiles(pasted)
                  }
                }}
                placeholder="Écrire à l’agent ou déposer des fichiers…"
                disabled={busy && activeId !== null}
              />
              <button
                className={`btn-accent btn composer-send${busy ? ' is-stop' : ''}`}
                onClick={() =>
                  busy && activeId ? void window.api.cancelPilotChat(activeId) : send()
                }
                disabled={busy ? !activeId : !input.trim() && attachments.length === 0}
                aria-label={busy ? 'Arrêter la réponse' : 'Envoyer le message'}
              >
                {busy ? '■ Stop' : 'Envoyer'}
              </button>
            </div>
            <div className="composer-meta">
              <span className="composer-hint">
                Entrée pour envoyer · Maj + Entrée pour une nouvelle ligne · 8 fichiers max
              </span>
              <OrchestratorModelSelector
                busy={busy}
                catalogLoaded={modelCatalogLoaded}
                models={modelCatalog}
                binding={orchestratorBinding}
                pending={modelChangePending}
                error={modelChangeError}
                onSelect={(option) => void changeOrchestratorModel(option)}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ---- Panneau droit : workflows + observatoire d'activité (repliable) ---- */}
      {showRuns && (
        <>
          <div
            className="runs-pane-resizer"
            role="separator"
            aria-label="Redimensionner la colonne Workflows"
            aria-orientation="vertical"
            onPointerDown={beginRunsResize}
          />
          <aside
            className={`runs-pane fade-in${paneTab === 'activite' ? ' wide' : ''}`}
            style={{ width: `${runsPaneWidth}px` }}
          >
            <div className="conv-head">
              <div className="row gap2">
                <button
                  className={`btn btn-sm${paneTab === 'runs' ? ' btn-accent' : ''}`}
                  onClick={() => setPaneTab('runs')}
                >
                  Runs
                </button>
                <button
                  className={`btn btn-sm${paneTab === 'activite' ? ' btn-accent' : ''}`}
                  onClick={() => setPaneTab('activite')}
                >
                  Activité
                </button>
              </div>
              <div className="row gap2">
                {paneTab === 'runs' && (
                  <button className="btn btn-sm" onClick={refreshRuns} title="Rafraîchir">
                    ⟳
                  </button>
                )}
                <button className="btn btn-sm btn-ghost" onClick={() => setShowRuns(false)}>
                  ✕
                </button>
              </div>
            </div>
            {paneTab === 'activite' && <ActivityPane convId={activeId} />}
            {paneTab === 'runs' && (
              <div className="row gap2" style={{ fontSize: 11 }}>
                <button
                  className={`btn btn-sm${runScope === 'conv' ? ' btn-accent' : ''}`}
                  onClick={() => selectRunScope('conv')}
                >
                  cette conversation
                </button>
                <button
                  className={`btn btn-sm${runScope === 'tous' ? ' btn-accent' : ''}`}
                  onClick={() => selectRunScope('tous')}
                >
                  tous
                </button>
              </div>
            )}
            <div
              className="scroll-y col grow"
              style={{
                gap: 'var(--s2)',
                minHeight: 0,
                display: paneTab === 'runs' ? undefined : 'none'
              }}
            >
              {/* Orchestration EN COURS : statut temps réel + sous-agents qui se remplissent. */}
              {activeId && liveRuns[activeId] && (
                <div className={`card live-run stripe stripe-accent fade-in`}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <div className="row gap2" style={{ minWidth: 0 }}>
                      {liveRuns[activeId].status === 'running' ? (
                        <span className="spinner" />
                      ) : (
                        <span
                          className={`status-dot ${liveRuns[activeId].status === 'green' ? 'st-ok' : 'st-err'}`}
                        />
                      )}
                      <span className="run-subject live-subject" title={liveRuns[activeId].task}>
                        {liveRuns[activeId].task}
                      </span>
                    </div>
                    <div className="row gap2">
                      <span className="badge">
                        {liveRuns[activeId].status === 'running'
                          ? 'en cours'
                          : liveRuns[activeId].status}
                      </span>
                      {liveRuns[activeId].status === 'running' && (
                        <button
                          className="btn btn-sm btn-danger"
                          title="Stopper le sous-agent en cours"
                          onClick={() => void window.api.cancelOrchestration(activeId)}
                        >
                          ⏹ Stop
                        </button>
                      )}
                    </div>
                  </div>
                  <div style={{ marginTop: 'var(--s2)' }}>
                    <StepThread steps={liveRuns[activeId].steps} />
                    {liveRuns[activeId].status === 'running' &&
                      (() => {
                        const phase = liveRuns[activeId].phase
                        const meta = phase ? STEP_META[phase.step] : undefined
                        const label = meta?.label ?? phase?.step ?? 'sous-agent'
                        return (
                          <div className="c-faint" style={{ fontSize: 11, marginTop: 4 }}>
                            <span className="spinner" /> {meta?.icon ?? '⏳'} {label}
                            {phase?.provider && (
                              <span className="mono c-accent"> {phase.provider}</span>
                            )}{' '}
                            en cours…
                          </div>
                        )
                      })()}
                    {liveRuns[activeId].status === 'running' && liveRuns[activeId].liveText && (
                      <pre className="subagent-live-text">{liveRuns[activeId].liveText}</pre>
                    )}
                  </div>
                </div>
              )}
              {runs.length === 0 && (!activeId || !liveRuns[activeId]) && (
                <div className="c-faint" style={{ fontSize: 12, padding: 'var(--s2)' }}>
                  {runScope === 'conv'
                    ? activeId
                      ? 'Aucun workflow pour cette conversation — lance une tâche (orchestration) ou attache un RUN.md.'
                      : 'Sélectionne ou démarre une conversation pour voir ses workflows.'
                    : 'Aucun run.'}
                </div>
              )}
              {runs.map((r) => {
                const pct =
                  r.summary.dodTotal > 0
                    ? Math.round((r.summary.dodChecked / r.summary.dodTotal) * 100)
                    : 0
                const isOpen = openRun?.path === r.path
                return (
                  <div key={r.path} className="col" style={{ gap: 0 }}>
                    <button
                      className="card run-row"
                      onClick={() => {
                        if (isOpen) {
                          setOpenRun(null)
                          setOpenTrace(null)
                        } else {
                          viewRun(r)
                        }
                      }}
                    >
                      <div className="row" style={{ justifyContent: 'space-between' }}>
                        <div className="row gap2" style={{ minWidth: 0 }}>
                          <span className={`status-dot ${RUN_DOT[r.summary.status] ?? ''}`} />
                          <span className="run-subject">{r.subject}</span>
                        </div>
                        <span className="badge">{r.summary.status}</span>
                      </div>
                      <div className="row" style={{ marginTop: 6, gap: 'var(--s2)' }}>
                        <div className="meter grow">
                          <span
                            style={{
                              width: `${pct}%`,
                              background:
                                r.summary.status === 'green' ? 'var(--ok)' : 'var(--accent)'
                            }}
                          />
                        </div>
                        <span className="c-faint tnum" style={{ fontSize: 10 }}>
                          {r.summary.dodChecked}/{r.summary.dodTotal}
                        </span>
                      </div>
                    </button>
                    {isOpen && (
                      <div className="run-detail-box fade-in">
                        {openTrace ? (
                          <div className="col" style={{ gap: 'var(--s2)' }}>
                            <div
                              className="c-faint"
                              style={{
                                fontSize: 10,
                                textTransform: 'uppercase',
                                letterSpacing: '0.05em'
                              }}
                            >
                              Fil des sous-agents
                            </div>
                            <StepThread steps={openTrace} />
                          </div>
                        ) : (
                          openRun && (
                            <pre className="run-detail mono scroll-y">{openRun.content}</pre>
                          )
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </aside>
        </>
      )}
    </div>
  )
}
