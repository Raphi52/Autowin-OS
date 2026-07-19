import { useEffect, useMemo, useRef, useState } from 'react'
import { Markdown } from './Markdown'
import { ActivityPane } from './ActivityPane'
import { HumanJson } from './HumanJson'
import {
  CHAT_PANE_LIMITS,
  clampConversationPaneWidth,
  coalesceAssistantParts,
  isChatNearBottom,
  resolveChatRuntimeIdentity,
  type ChatActionPart,
  type ChatPart,
  type ChatRuntimeIdentity
} from './chat-view-model'
import { searchConversations } from './conversation-search'
import './ChatView.css'

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
interface UserMsg {
  role: 'user'
  content: string
  attachments?: AttachmentMeta[]
}
interface AsstMsg {
  role: 'assistant'
  parts: Part[]
  done: boolean
}
type Msg = UserMsg | AsstMsg

interface PilotEvent {
  conversationId?: string
  kind: 'think' | 'command' | 'result' | 'done' | 'error'
  text?: string
  name?: string
  args?: unknown
  ok?: boolean
  data?: unknown
}

type Conv = {
  id: string
  title: string
  category: string
  provider: string
  messages: Array<{
    role: 'user' | 'assistant'
    content: string
    ts: number
    attachments?: AttachmentMeta[]
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

type RuntimeTopology = Parameters<typeof resolveChatRuntimeIdentity>[0]
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
type LiveRun = {
  convId?: string
  runPath?: string
  task: string
  steps: OrchStep[]
  status: 'running' | 'green' | 'red'
}

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

/* ---------- Vue ---------- */

/**
 * Chat façon Claude Code : conversations à gauche, fil transparent au centre
 * (l'agent parle ET pilote — ses actions en puces inline), workflows (RUN.md)
 * repliables à droite. Tout se passe ici.
 */
export function ChatView({ isActive = true }: { isActive?: boolean }): React.JSX.Element {
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
  const [conversationsPaneWidth, setConversationsPaneWidth] = useState(() => {
    const saved = Number(window.localStorage.getItem('autowin.chat.conversationsPaneWidth'))
    return clampConversationPaneWidth(Number.isFinite(saved) && saved > 0 ? saved : 292)
  })
  const [hasNewActivity, setHasNewActivity] = useState(false)
  const [showRuns, setShowRuns] = useState(false)
  const [runsPaneWidth, setRunsPaneWidth] = useState(340)
  const [paneTab, setPaneTab] = useState<'runs' | 'activite'>('runs')
  const [runScope, setRunScope] = useState<'conv' | 'tous'>('conv')
  const [runs, setRuns] = useState<RunEntry[]>([])
  const [openRun, setOpenRun] = useState<{ path: string; content: string } | null>(null)
  const [openTrace, setOpenTrace] = useState<OrchStep[] | null>(null)
  const [liveRun, setLiveRun] = useState<LiveRun | null>(null)
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [showDecisions, setShowDecisions] = useState(false)
  const [decisionError, setDecisionError] = useState<string | null>(null)
  const [deleteCandidate, setDeleteCandidate] = useState<Conv | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const composerInputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const liveMessagesRef = useRef(new Map<string, Msg[]>())
  const busyConversationsRef = useRef(new Set<string>())
  const activeRef = useRef<string | null>(null)
  const followTailRef = useRef(true)

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
    const onMove = (move: PointerEvent): void =>
      setRunsPaneWidth(Math.min(760, Math.max(260, startWidth + startX - move.clientX)))
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  async function refreshRuntimeIdentity(): Promise<ChatRuntimeIdentity> {
    const [topology, models] = await Promise.all([window.api.topology(), window.api.models()])
    const resolved = resolveChatRuntimeIdentity(
      topology as RuntimeTopology,
      models as RuntimeModel[]
    )
    setRuntimeIdentity(resolved)
    return resolved
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
    setAttachmentError(null)
    const seen = new Set(attachments.map((file) => `${file.name}\u0000${file.size}`))
    const candidates = Array.from(files).filter((file) => {
      const key = `${file.name}\u0000${file.size}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    if (attachments.length + candidates.length > MAX_ATTACHMENTS) {
      setAttachmentError(`Maximum ${MAX_ATTACHMENTS} fichiers par message.`)
      return
    }
    const oversized = candidates.find((file) => file.size > MAX_ATTACHMENT_BYTES)
    if (oversized) {
      setAttachmentError(`${oversized.name} dépasse la limite de 10 Mo.`)
      return
    }
    const totalBytes =
      attachments.reduce((sum, file) => sum + file.size, 0) +
      candidates.reduce((sum, file) => sum + file.size, 0)
    if (totalBytes > MAX_ATTACHMENTS_BYTES) {
      setAttachmentError('Le total des pièces jointes dépasse 20 Mo.')
      return
    }
    try {
      const encoded = await Promise.all(candidates.map(encodeAttachment))
      setAttachments((current) => [...current, ...encoded])
    } catch (error) {
      setAttachmentError(
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
    if (runScopeRef.current === 'tous') {
      setRuns(await window.api.listRuns())
    } else if (activeRef.current) {
      setRuns((await window.api.conversationRuns(activeRef.current)) as RunEntry[])
    } else {
      setRuns([])
    }
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
      } else if (e.type === 'orchestrate-start') {
        // Orchestration lancée pour CETTE conversation → statut temps réel visible.
        if (e.convId && e.convId !== activeRef.current) return
        setShowRuns(true)
        setPaneTab('runs')
        setLiveRun({
          convId: e.convId,
          runPath: e.runPath,
          task: e.task ?? 'tâche',
          steps: [],
          status: 'running'
        })
      } else if (e.type === 'orchestrate-step' && e.step) {
        const step = e.step as OrchStep
        setLiveRun((lr) => (lr ? { ...lr, steps: [...lr.steps, step] } : lr))
      } else if (e.type === 'orchestrate-end') {
        setLiveRun((lr) => (lr ? { ...lr, status: (e.status as 'green' | 'red') ?? 'green' } : lr))
        refreshRuns()
        // Laisse le run terminé visible ~4 s en tant que « live », puis il rejoint la liste.
        setTimeout(() => setLiveRun(null), 4000)
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
      if (e.kind === 'think' && e.text) {
        patchLast(conversationId, (m) => m.parts.push({ kind: 'text', text: e.text! }))
      } else if (e.kind === 'command') {
        patchLast(conversationId, (m) => m.parts.push({ kind: 'action', name: e.name!, args: e.args }))
      } else if (e.kind === 'result') {
        patchLast(conversationId, (m) => {
          for (let i = m.parts.length - 1; i >= 0; i--) {
            const p = m.parts[i]
            if (p.kind === 'action' && p.name === e.name && p.ok === undefined) {
              m.parts[i] = { ...p, ok: e.ok, data: e.data }
              return
            }
          }
        })
      } else if (e.kind === 'error') {
        patchLast(conversationId, (m) => m.parts.push({ kind: 'text', text: `⚠️ ${e.text ?? 'erreur'}` }))
      } else if (e.kind === 'done') {
        patchLast(conversationId, (m) => {
          if (e.text && !m.parts.some((p) => p.kind === 'text' && p.text === e.text)) {
            m.parts.push({ kind: 'text', text: e.text })
          }
          m.done = true
        })
      }
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
    setActiveId(c.id)
    const stored = liveMessagesRef.current.get(c.id) ??
      c.messages.map((m) =>
        m.role === 'user'
          ? { role: 'user' as const, content: m.content, attachments: m.attachments }
          : {
              role: 'assistant' as const,
              parts: [{ kind: 'text' as const, text: m.content }],
              done: true
            }
      )
    liveMessagesRef.current.set(c.id, stored)
    setMessages(stored)
    setInput('')
    setAttachments([])
    setAttachmentError(null)
  }

  function newConv(): void {
    followTailRef.current = true
    setHasNewActivity(false)
    setActiveId(null)
    setMessages([])
    setInput('')
    setAttachments([])
    setAttachmentError(null)
  }

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
    if (activeId === c.id) newConv()
    await refreshConvs()
  }

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
    if ((!value && attachments.length === 0) || busy) return
    const outgoingAttachments = attachments

    // Pas de conversation active → on en crée une (titre = début du message).
    let convId = activeId
    if (!convId) {
      const identity = runtimeIdentity ?? (await refreshRuntimeIdentity())
      const titleSource = value || outgoingAttachments[0].name
      const title = titleSource.length > 42 ? `${titleSource.slice(0, 42)}…` : titleSource
      const c = await window.api.conversationsCreate({
        title,
        category: identity.provider,
        provider: identity.provider
      })
      convId = c.id
      setActiveId(c.id)
      activeRef.current = c.id
      refreshConvs()
    }

    const history: Msg[] = [
      ...messages,
      {
        role: 'user',
        content: value,
        attachments: outgoingAttachments.map(({ name, mimeType, size }) => ({
          name,
          mimeType,
          size
        }))
      },
      { role: 'assistant', parts: [], done: false }
    ]
    setMessages(history)
    liveMessagesRef.current.set(convId, history)
    setInput('')
    setAttachments([])
    setAttachmentError(null)
    followTailRef.current = true
    setConversationBusy(convId, true)
    const payload: Array<{
      role: 'user' | 'assistant'
      content: string
      attachments?: ChatAttachment[]
    }> = flatten(history.slice(0, -1))
    payload[payload.length - 1].attachments = outgoingAttachments
    try {
      const res = await window.api.pilotChat(payload, convId)
      if (!res.ok)
        patchLast(convId, (m) => m.parts.push({ kind: 'text', text: `⚠️ ${res.error ?? 'erreur'}` }))
    } catch (error) {
      patchLast(convId, (m) =>
        m.parts.push({
          kind: 'text',
          text: `⚠️ ${error instanceof Error ? error.message : String(error)}`
        })
      )
    } finally {
      setConversationBusy(convId, false)
      patchLast(convId, (m) => {
        m.done = true
        if (m.parts.length === 0) m.parts.push({ kind: 'text', text: '_(aucune réponse)_' })
      })
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      const rendered = [...(liveMessagesRef.current.get(convId) ?? [])].reverse().find((message) => message.role === 'assistant') as AsstMsg | undefined
      const renderedText = rendered?.parts.filter((part) => part.kind === 'text').map((part) => part.text).join('\n') ?? ''
      if (renderedText.trim()) await window.api.markResponseDisplayed(convId, renderedText)
    }
    refreshConvs()
    refreshRuns()
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
    <div className="chat-layout">
      {/* ---- Panneau gauche : conversations ---- */}
      <aside className="conv-pane" style={{ width: `${conversationsPaneWidth}px` }}>
        <div className="conv-head">
          <div className="conv-heading-copy">
            <span className="conv-kicker">Espace de travail</span>
            <strong className="conv-title">Conversations</strong>
          </div>
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
                <span className={`chat-runtime-provider is-${runtimeIdentity?.provider ?? 'loading'}`}>
                  {runtimeIdentity?.provider ?? 'connexion…'}
                </span>
                <span>{runtimeIdentity?.modelLabel ?? 'modèle en cours de résolution'}</span>
                {runtimeIdentity?.reasoningEffort && (
                  <span>effort {runtimeIdentity.reasoningEffort}</span>
                )}
                <span className={`chat-runtime-state${busy ? ' is-busy' : ''}`}>
                  <span className="status-dot" />
                  {busy ? 'en cours' : 'prêt'}
                </span>
              </div>
            </div>
          </div>
          <div className="row gap2">
            {busy && activeId && <button className="btn btn-sm" onClick={()=>void window.api.cancelPilotChat(activeId)}>Arrêter</button>}
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
          <div className="delete-confirm-layer" role="presentation" onClick={() => setDeleteCandidate(null)}>
            <section
              className="delete-confirm-card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-confirm-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="delete-confirm-orbit" aria-hidden="true">✦</div>
              <span className="delete-confirm-kicker">ACTION IRRÉVERSIBLE</span>
              <h2 id="delete-confirm-title">Supprimer la conversation ?</h2>
              <p>
                <strong>« {deleteCandidate.title} »</strong> et son historique local seront retirés de cet appareil.
              </p>
              <div className="delete-confirm-actions">
                <button className="btn delete-confirm-cancel" onClick={() => setDeleteCandidate(null)} autoFocus>
                  Garder la conversation
                </button>
                <button className="btn delete-confirm-danger" onClick={() => void confirmRemoveConv()}>
                  Supprimer définitivement
                </button>
              </div>
            </section>
          </div>
        )}

        <div
          className="chat-scroll scroll-y"
          ref={scrollRef}
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

          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="msg user fade-in">
                <div className="msg-meta">
                  <span className="msg-role">Toi</span>
                </div>
                {m.content && <div className="msg-body">{m.content}</div>}
                {m.attachments && m.attachments.length > 0 && (
                  <div className="attachment-list sent">
                    {m.attachments.map((file, fileIndex) => (
                      <span className="attachment-chip" key={`${file.name}-${fileIndex}`}>
                        <span aria-hidden="true">
                          {file.mimeType.startsWith('image/') ? '▧' : '▤'}
                        </span>
                        <span className="attachment-name">{file.name}</span>
                        <small>{formatFileSize(file.size)}</small>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div key={i} className="msg assistant fade-in">
                <div className="msg-meta">
                  <span className="msg-role">Agent</span>
                  {!m.done && <span className="spinner" />}
                </div>
                <div className="msg-turn">
                  {m.parts.length === 0 && !m.done && (
                    <div className="msg-body c-faint">réflexion…</div>
                  )}
                  {coalesceAssistantParts(m.parts).map((p, j) =>
                    p.kind === 'text' ? (
                      <div key={j} className="msg-body">
                        <Markdown text={p.text} />
                      </div>
                    ) : (
                      <AssistantActionEvent key={j} part={p} />
                    )
                  )}
                </div>
              </div>
            )
          )}
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
                  <span className="attachment-chip" key={`${file.name}-${fileIndex}`}>
                    <span aria-hidden="true">{file.kind === 'image' ? '▧' : '▤'}</span>
                    <span className="attachment-name">{file.name}</span>
                    <small>{formatFileSize(file.size)}</small>
                    <button
                      type="button"
                      onClick={() =>
                        setAttachments((current) =>
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
              <textarea
                ref={composerInputRef}
                className="input grow"
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    send()
                  }
                }}
                placeholder="Écrire à l’agent ou déposer des fichiers…"
                disabled={busy && activeId !== null}
              />
              <button
                className="btn-accent btn composer-send"
                onClick={() => send()}
                disabled={busy || (!input.trim() && attachments.length === 0)}
              >
                {busy ? <span className="spinner" /> : 'Envoyer'}
              </button>
            </div>
            <div className="composer-meta">
              <span className="composer-hint">
                Entrée pour envoyer · Maj + Entrée pour une nouvelle ligne · 8 fichiers max
              </span>
              {runtimeIdentity && (
                <span className="composer-runtime">
                  {runtimeIdentity.modelLabel} · {runtimeIdentity.reasoningEffort}
                </span>
              )}
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
                onClick={() => setRunScope('conv')}
              >
                cette conversation
              </button>
              <button
                className={`btn btn-sm${runScope === 'tous' ? ' btn-accent' : ''}`}
                onClick={() => setRunScope('tous')}
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
            {liveRun && (
              <div className={`card live-run stripe stripe-accent fade-in`}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div className="row gap2" style={{ minWidth: 0 }}>
                    {liveRun.status === 'running' ? (
                      <span className="spinner" />
                    ) : (
                      <span
                        className={`status-dot ${liveRun.status === 'green' ? 'st-ok' : 'st-err'}`}
                      />
                    )}
                    <span className="run-subject">{liveRun.task}</span>
                  </div>
                  <span className="badge">
                    {liveRun.status === 'running' ? 'en cours' : liveRun.status}
                  </span>
                </div>
                <div style={{ marginTop: 'var(--s2)' }}>
                  <StepThread steps={liveRun.steps} />
                  {liveRun.status === 'running' && (
                    <div className="c-faint" style={{ fontSize: 11, marginTop: 4 }}>
                      <span className="spinner" /> le sous-agent travaille…
                    </div>
                  )}
                </div>
              </div>
            )}
            {runs.length === 0 && !liveRun && (
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
                            background: r.summary.status === 'green' ? 'var(--ok)' : 'var(--accent)'
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
                        openRun && <pre className="run-detail mono scroll-y">{openRun.content}</pre>
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
