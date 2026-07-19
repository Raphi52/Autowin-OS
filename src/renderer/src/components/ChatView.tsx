import { useEffect, useMemo, useRef, useState } from 'react'
import { Markdown } from './Markdown'
import { ActivityPane } from './ActivityPane'
import { searchConversations } from './conversation-search'
import './ChatView.css'

/* ---------- Types ---------- */

interface ActionPart {
  kind: 'action'
  name: string
  args?: unknown
  ok?: boolean
  data?: unknown
}
interface TextPart {
  kind: 'text'
  text: string
}
type Part = TextPart | ActionPart

interface UserMsg {
  role: 'user'
  content: string
}
interface AsstMsg {
  role: 'assistant'
  parts: Part[]
  done: boolean
}
type Msg = UserMsg | AsstMsg

interface PilotEvent {
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
  messages: Array<{ role: 'user' | 'assistant'; content: string; ts: number }>
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
    options: Record<string, string | boolean | undefined>
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
                <pre>{JSON.stringify(s.prompt.options, null, 2)}</pre>
              </details>
            )}
          </div>
        )
      })}
    </div>
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
  const [busy, setBusy] = useState(false)
  const [showRuns, setShowRuns] = useState(false)
  const [paneTab, setPaneTab] = useState<'runs' | 'activite'>('runs')
  const [runScope, setRunScope] = useState<'conv' | 'tous'>('conv')
  const [runs, setRuns] = useState<RunEntry[]>([])
  const [openRun, setOpenRun] = useState<{ path: string; content: string } | null>(null)
  const [openTrace, setOpenTrace] = useState<OrchStep[] | null>(null)
  const [liveRun, setLiveRun] = useState<LiveRun | null>(null)
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [showDecisions, setShowDecisions] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const busyRef = useRef(false)
  const activeRef = useRef<string | null>(null)
  useEffect(() => {
    activeRef.current = activeId
  }, [activeId])

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
    const timer = setInterval(refreshDecisions, 8000)
    return () => clearInterval(timer)
  }, [isActive])

  /* --- fil : événements de pilotage → patch de la dernière bulle agent --- */

  function patchLast(fn: (m: AsstMsg) => void): void {
    setMessages((prev) => {
      const next = prev.slice()
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === 'assistant') {
          const copy: AsstMsg = {
            ...(next[i] as AsstMsg),
            parts: (next[i] as AsstMsg).parts.slice()
          }
          fn(copy)
          next[i] = copy
          return next
        }
      }
      return next
    })
  }

  useEffect(() => {
    const off = window.api.onPilotEvent((raw) => {
      if (!busyRef.current) return
      const e = raw as PilotEvent
      if (e.kind === 'think' && e.text) {
        patchLast((m) => m.parts.push({ kind: 'text', text: e.text! }))
      } else if (e.kind === 'command') {
        patchLast((m) => m.parts.push({ kind: 'action', name: e.name!, args: e.args }))
      } else if (e.kind === 'result') {
        patchLast((m) => {
          for (let i = m.parts.length - 1; i >= 0; i--) {
            const p = m.parts[i]
            if (p.kind === 'action' && p.name === e.name && p.ok === undefined) {
              m.parts[i] = { ...p, ok: e.ok, data: e.data }
              return
            }
          }
        })
      } else if (e.kind === 'error') {
        patchLast((m) => m.parts.push({ kind: 'text', text: `⚠️ ${e.text ?? 'erreur'}` }))
      } else if (e.kind === 'done') {
        patchLast((m) => {
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
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  /* --- conversations : sélection = fil rechargé depuis le store --- */

  function loadConv(c: Conv): void {
    if (busy) return
    setActiveId(c.id)
    setMessages(
      c.messages.map((m) =>
        m.role === 'user'
          ? { role: 'user' as const, content: m.content }
          : {
              role: 'assistant' as const,
              parts: [{ kind: 'text' as const, text: m.content }],
              done: true
            }
      )
    )
  }

  function newConv(): void {
    if (busy) return
    setActiveId(null)
    setMessages([])
  }

  async function renameConv(c: Conv): Promise<void> {
    const t = prompt('Nouveau titre', c.title)
    if (t && t.trim()) {
      await window.api.conversationsRename(c.id, t.trim())
      await refreshConvs()
    }
  }
  async function removeConv(c: Conv): Promise<void> {
    if (!confirm(`Supprimer « ${c.title} » ?`)) return
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
    if (!value || busy) return

    // Pas de conversation active → on en crée une (titre = début du message).
    let convId = activeId
    if (!convId) {
      const title = value.length > 42 ? `${value.slice(0, 42)}…` : value
      const c = await window.api.conversationsCreate({
        title,
        category: 'claude',
        provider: 'claude'
      })
      convId = c.id
      setActiveId(c.id)
      activeRef.current = c.id
      refreshConvs()
    }

    const history: Msg[] = [
      ...messages,
      { role: 'user', content: value },
      { role: 'assistant', parts: [], done: false }
    ]
    setMessages(history)
    setInput('')
    setBusy(true)
    busyRef.current = true
    const res = await window.api.pilotChat(flatten(history.slice(0, -1)), convId)
    busyRef.current = false
    setBusy(false)
    if (!res.ok)
      patchLast((m) => m.parts.push({ kind: 'text', text: `⚠️ ${res.error ?? 'erreur'}` }))
    patchLast((m) => {
      m.done = true
      if (m.parts.length === 0) m.parts.push({ kind: 'text', text: '_(aucune réponse)_' })
    })
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
      <aside className="conv-pane">
        <div className="conv-head">
          <div className="conv-heading-copy">
            <span className="conv-kicker">Bibliothèque</span>
            <strong className="conv-title">Conversations</strong>
          </div>
          <button
            className="btn btn-sm"
            onClick={newConv}
            disabled={busy}
            title="Nouvelle conversation"
          >
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
              <button className="conv-pick" onClick={() => loadConv(c)} disabled={busy}>
                <span className={`status-dot ${CAT_DOT[c.category] ?? 'st-info'}`} />
                <span className="conv-copy">
                  <span className="conv-label">{c.title}</span>
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

      {/* ---- Centre : fil ---- */}
      <section className="chat">
        <header className="chat-head row">
          <div className="row gap2" style={{ alignItems: 'center', minWidth: 0 }}>
            <span className="chat-head-signal" aria-hidden="true" />
            <div className="col" style={{ gap: 1, minWidth: 0 }}>
              <span className="chat-head-kicker">Conversation active</span>
              <b className="chat-conv-title">{active ? active.title : 'Nouvelle conversation'}</b>
              <span className="chat-head-context">
                Historique durable · contexte local conservé
              </span>
            </div>
          </div>
          <div className="row gap2">
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
                        await window.api.authorityResolve(d.id, o)
                        refreshDecisions()
                      }}
                    >
                      {String(o)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="chat-scroll scroll-y" ref={scrollRef}>
          {messages.length === 0 && !busy && (
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
                <div className="msg-body">{m.content}</div>
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
                  {m.parts.map((p, j) =>
                    p.kind === 'text' ? (
                      <div key={j} className="msg-body">
                        <Markdown text={p.text} />
                      </div>
                    ) : (
                      <div key={j} className={`action-chip${p.ok === false ? ' failed' : ''}`}>
                        <span
                          className={`status-dot ${
                            p.ok === undefined ? 'st-info' : p.ok ? 'st-ok' : 'st-err'
                          }`}
                        />
                        <span className="action-name">{CMD_LABEL[p.name] ?? p.name}</span>
                        {p.args != null && (
                          <span className="action-args mono">
                            {JSON.stringify(p.args).slice(0, 120)}
                          </span>
                        )}
                        {p.ok === undefined && <span className="spinner" />}
                      </div>
                    )
                  )}
                </div>
              </div>
            )
          )}
        </div>

        <div className="composer">
          <div className="composer-field">
            <textarea
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
              placeholder="Écrire à l’agent…"
              disabled={busy}
            />
            <span>Entrée pour envoyer · Maj + Entrée pour une nouvelle ligne</span>
          </div>
          <button
            className="btn-accent btn"
            onClick={() => send()}
            disabled={busy || !input.trim()}
          >
            {busy ? <span className="spinner" /> : 'Envoyer'}
          </button>
        </div>
      </section>

      {/* ---- Panneau droit : workflows + observatoire d'activité (repliable) ---- */}
      {showRuns && (
        <aside className={`runs-pane fade-in${paneTab === 'activite' ? ' wide' : ''}`}>
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
      )}
    </div>
  )
}
