import { useEffect, useMemo, useState } from 'react'
import { buildHarnessTimelineFromTrace, type HarnessTraceEvent, type HarnessTimelineEvent, type HarnessTimeline } from './harness-timeline-model'
import { PromptLoadView } from './PromptLoadView'
import { HumanJson } from './HumanJson'
import { summarizeHermesTraces, type HermesTraceSummaryInput } from './hermes-trace-summary'
import './ObservatoryView.css'
import { ModuleHeader } from './ModuleHeader'

interface ConversationItem { id: string; title: string; provider: string; updatedAt: number }
interface PromptCall {
  id: string; ts: string; conversationId: string; turnId: string; provider: string; model?: string; boundary: string; limitation: string
  system?: string; messages: Array<{ role: string; content: string }>; options: Record<string, unknown>; response: string
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; costUsd?: number }
}
interface HermesDiagnosticTrace extends HermesTraceSummaryInput {
  apiRequestId: string; messageCount: number; toolCount: number; request: Record<string, unknown>
}
const EMPTY: HarnessTimeline = { turns: [], anomalies: [], totalTokens: 0, totalCostUsd: 0 }
const LABEL: Record<HarnessTimelineEvent['kind'], string> = {
  'response-displayed': 'Réponse affichée',
  message: 'Message', injection: 'Injection', decision: 'Décision', 'tool-call': 'Commande', 'tool-result': 'Résultat outil',
  'model-response': 'Réponse', handoff: 'Délégation', verdict: 'Verdict', gate: 'Contrôle', retry: 'Retry',
  cancellation: 'Annulation', error: 'Erreur', boundary: 'Frontière'
}

export function ObservatoryView({ active }: { active: boolean }): React.JSX.Element {
  const [conversations, setConversations] = useState<ConversationItem[]>([])
  const [conversationId, setConversationId] = useState('')
  const [timeline, setTimeline] = useState<HarnessTimeline>(EMPTY)
  const [promptCalls, setPromptCalls] = useState<PromptCall[]>([])
  const [selectedCall, setSelectedCall] = useState<PromptCall | null>(null)
  const [hermesTraces, setHermesTraces] = useState<HermesDiagnosticTrace[]>([])
  const [hermesMetadata, setHermesMetadata] = useState<HermesTraceSummaryInput[]>([])
  const [selected, setSelected] = useState<HarnessTimelineEvent | null>(null)
  const [compare, setCompare] = useState<HarnessTimelineEvent[]>([])
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [providerFilter, setProviderFilter] = useState('all')
  const [configOpen, setConfigOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!active) return
    void Promise.all([window.api.conversations(), window.api.promptCalls(), window.api.hermesPromptTraceSummary()]).then(([items, calls, hermes]) => {
      const sorted = [...items].sort((a, b) => b.updatedAt - a.updatedAt)
      setConversations(sorted)
      setConversationId((current) => current || sorted[0]?.id || '')
      setPromptCalls(calls as PromptCall[])
      setHermesMetadata(hermes as HermesTraceSummaryInput[])
    })
  }, [active, refreshKey])

  useEffect(() => {
    if (!active || !conversationId) { setTimeline(EMPTY); setLoading(false); return }
    setLoading(true); setSelected(null); setSelectedCall(null); setCompare([])
    void window.api.causalTrace(conversationId)
      .then((events) => setTimeline(buildHarnessTimelineFromTrace(events as HarnessTraceEvent[])))
      .finally(() => setLoading(false))
  }, [active, conversationId, refreshKey])

  const currentCalls = useMemo(() => promptCalls.filter((call) => call.conversationId === conversationId), [promptCalls, conversationId])
  const observed = useMemo(() => currentCalls.reduce((sum, call) => ({
    input: sum.input + (call.usage?.inputTokens ?? 0), output: sum.output + (call.usage?.outputTokens ?? 0),
    cache: sum.cache + (call.usage?.cacheReadTokens ?? 0), cost: sum.cost + (call.usage?.costUsd ?? 0)
  }), { input: 0, output: 0, cache: 0, cost: 0 }), [currentCalls])
  const allEvents = timeline.turns.flatMap((turn) => turn.events)
  const hermesSummary = summarizeHermesTraces(hermesMetadata)
  const typeOptions = [...new Set(allEvents.map((event) => event.kind))]
  const providerOptions = [...new Set(allEvents.map((event) => event.provider).filter(Boolean))] as string[]
  const needle = query.trim().toLocaleLowerCase('fr')
  const visibleTurns = timeline.turns.map((turn) => ({ ...turn, events: turn.events.filter((event) =>
    (typeFilter === 'all' || event.kind === typeFilter) &&
    (providerFilter === 'all' || event.provider === providerFilter) &&
    (!needle || `${event.actor} ${event.label} ${event.content} ${event.detail}`.toLocaleLowerCase('fr').includes(needle))
  ) })).filter((turn) => turn.events.length)

  function openEvent(eventId: string): void {
    setQuery(''); setTypeFilter('all'); setProviderFilter('all')
    setSelectedCall(null)
    setSelected(allEvents.find((event) => event.id === eventId) ?? null)
  }

  async function exportTrace(): Promise<void> {
    if (!conversationId) return
    const events = await window.api.causalTrace(conversationId)
    const href = URL.createObjectURL(new Blob([JSON.stringify({ schema: 'autowin.trace-export/v1', conversationId, events }, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = href; link.download = `autowin-trace-${conversationId}.json`; link.click(); URL.revokeObjectURL(href)
  }

  async function unlockHermesDiagnostics(): Promise<void> {
    const capability = await window.api.authorizeHermesDiagnostics()
    if (!capability) return
    setHermesTraces(await window.api.hermesPromptTracesGlobal(capability) as HermesDiagnosticTrace[])
  }

  return <section className="observatory-view">
    <header className="observatory-head">
      <ModuleHeader eyebrow="Traçabilité des conversations" title="Observatory" />
      <div className="observatory-metrics">
        <strong data-metric="calls">{currentCalls.length.toLocaleString('fr-FR')}<small>appels · conversation</small></strong>
        <strong data-metric="input">{observed.input.toLocaleString('fr-FR')}<small>tokens in</small></strong>
        <strong data-metric="cache">{observed.cache.toLocaleString('fr-FR')}<small>cache lu</small></strong>
        <strong data-metric="cost">${observed.cost.toFixed(3)}<small>coût</small></strong>
        <strong data-metric="hermes">{hermesSummary.count.toLocaleString('fr-FR')}<small>Hermes · {hermesSummary.coverage}</small></strong>
      </div>
    </header>
    <div className="observatory-toolbar">
      {hermesSummary.lastTimestamp && <span className="observatory-hermes-proof">Dernier Hermes · {new Date(hermesSummary.lastTimestamp).toLocaleString('fr-FR')} · {hermesSummary.lastModel} · {hermesSummary.boundary} · exact-redacted</span>}
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher dans le flux…" />
      <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label="Type"><option value="all">Tous les types</option>{typeOptions.map((type) => <option key={type} value={type}>{LABEL[type]}</option>)}</select>
      <select value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)} aria-label="Provider"><option value="all">Tous providers</option>{providerOptions.map((provider) => <option key={provider}>{provider}</option>)}</select>
      <button onClick={() => setConfigOpen((value) => !value)}>{configOpen ? 'Fermer la configuration' : 'Configuration du prompt'}</button>
      <button onClick={() => void unlockHermesDiagnostics()}>Déverrouiller Hermes</button>
      <button onClick={() => void exportTrace()}>Exporter JSON</button><button onClick={() => setRefreshKey((value) => value + 1)}>Actualiser</button>
    </div>
    {hermesTraces.length > 0 && <details className="observatory-hermes-diagnostics">
      <summary>{hermesTraces.length} payload{hermesTraces.length > 1 ? 's' : ''} Hermes globaux · accès autorisé</summary>
      <p>Ces requêtes ne sont attribuées à aucune conversation sans identifiant partagé. Secrets masqués.</p>
      <div>{[...hermesTraces].reverse().slice(0, 20).map((trace) => <details key={trace.apiRequestId}>
        <summary>{new Date(trace.timestamp).toLocaleString('fr-FR')} · {trace.provider} → {trace.model} · {trace.messageCount} messages · {trace.toolCount} outils</summary>
        <HumanJson value={trace.request} />
      </details>)}</div>
    </details>}
    {configOpen && <aside className="observatory-config"><PromptLoadView active={active && configOpen} /></aside>}
    <div className="observatory-flightdeck">
      <aside className="observatory-rail">
        <span className="observatory-panel-title">FILTRES & DIAGNOSTICS</span>
        <div className="observatory-conversations">
          {conversations.map((conversation) => <button key={conversation.id} className={conversation.id === conversationId ? 'is-active' : ''} onClick={() => setConversationId(conversation.id)}><strong>{conversation.title}</strong><small>{conversation.provider}</small></button>)}
        </div>
        <section className="observatory-calls"><span className="observatory-panel-title">APPELS OBSERVÉS</span>
          {currentCalls.map((call) => <button key={call.id} className={selectedCall?.id === call.id ? 'is-active' : ''} onClick={() => { setSelected(null); setSelectedCall(call) }}><strong>{call.provider}{call.model ? ` · ${call.model}` : ''}</strong><small>{new Date(call.ts).toLocaleTimeString('fr-FR')} · {(call.usage?.inputTokens ?? 0).toLocaleString('fr-FR')} in · {(call.usage?.cacheReadTokens ?? 0).toLocaleString('fr-FR')} cache</small></button>)}
        </section>
        <section className="observatory-diagnostics"><span className="observatory-panel-title">SIGNAUX PRIORITAIRES</span>
          {timeline.anomalies.length === 0 ? <p>Aucun signal évident.</p> : timeline.anomalies.map((item) => <button key={`${item.kind}:${item.eventId}`} onClick={() => openEvent(item.eventId)}><strong>{item.impact.toLocaleString('fr-FR')} caractères</strong><span>{item.label} · {item.turnIds.length} tour{item.turnIds.length > 1 ? 's' : ''}</span></button>)}
        </section>
      </aside>
      <main className="observatory-stream" onClick={() => { setSelected(null); setSelectedCall(null) }} data-testid="observatory-stream" aria-busy={loading}>
        {loading && <div className="observatory-empty">Lecture des traces…</div>}
        {!loading && visibleTurns.length === 0 && <div className="observatory-empty">Aucune trace dans ce filtre.</div>}
        {selectedCall && <article className="observatory-call-detail" onClick={(click) => click.stopPropagation()}>
          <header><div><b>Appel exact · {selectedCall.provider}{selectedCall.model ? ` · ${selectedCall.model}` : ''}</b><small>{selectedCall.boundary} · {selectedCall.turnId}</small></div><button onClick={() => setSelectedCall(null)}>Fermer</button></header>
          <div className="observatory-call-metrics"><b>{(selectedCall.usage?.inputTokens ?? 0).toLocaleString('fr-FR')} in</b><span>{(selectedCall.usage?.cacheReadTokens ?? 0).toLocaleString('fr-FR')} cache</span><span>{(selectedCall.usage?.outputTokens ?? 0).toLocaleString('fr-FR')} out</span><span>${(selectedCall.usage?.costUsd ?? 0).toFixed(4)}</span></div>
          <small>{selectedCall.limitation}</small>
          {selectedCall.system && <><b>System</b><pre className="observatory-payload">{selectedCall.system}</pre></>}
          <b>Messages</b><HumanJson className="observatory-payload" value={selectedCall.messages} />
          <b>Options</b><HumanJson className="observatory-payload" value={selectedCall.options} />
          <b>Réponse</b><pre className="observatory-payload">{selectedCall.response || '(vide)'}</pre>
        </article>}
        {compare.length === 2 && <section className="observatory-diff"><header><b>Comparaison de payloads</b><button onClick={(event) => { event.stopPropagation(); setCompare([]) }}>Fermer</button></header><div><pre>{compare[0].content || '(vide)'}</pre><pre>{compare[1].content || '(vide)'}</pre></div></section>}
        {visibleTurns.map((turn, turnIndex) => <section className="observatory-turn" key={turn.id}>
          <header><div><span>TOUR {timeline.turns.length - turnIndex}</span><time>{new Date(turn.ts).toLocaleString('fr-FR')}</time></div><small>{turn.tokens.toLocaleString('fr-FR')} tokens · {turn.costUsd ? `$${turn.costUsd.toFixed(4)}` : 'coût indisponible'}</small></header>
          {turn.events.map((event, index) => <div key={event.id} className="observatory-event-wrap">
            <button className={`observatory-event is-${event.kind}${selected?.id === event.id ? ' is-selected' : ''}${compare.some((item) => item.id === event.id) ? ' is-compared' : ''}`} onClick={(click) => { click.stopPropagation(); if (click.shiftKey) setCompare((items) => items.some((item) => item.id === event.id) ? items.filter((item) => item.id !== event.id) : [...items, event].slice(-2)); else { setSelectedCall(null); setSelected(selected?.id === event.id ? null : event) } }}>
              <i>{index + 1}</i><span><b>{LABEL[event.kind]}</b><small>{event.actor}</small></span><p><strong>{event.content || 'Aucun contenu observable.'}</strong><small>{event.provider ? `${event.provider}${event.model ? ` · ${event.model}` : ''}` : event.detail}</small></p>
              <span className="observatory-load">{event.inputTokens != null && <b>{event.inputTokens.toLocaleString('fr-FR')} in</b>}{event.cacheReadTokens != null && <small>{event.cacheReadTokens.toLocaleString('fr-FR')} cache</small>}{event.outputTokens != null && <small>{event.outputTokens.toLocaleString('fr-FR')} out</small>}{event.costUsd != null && <small>${event.costUsd.toFixed(4)}</small>}{event.durationMs != null && <small>{Math.round(event.durationMs)} ms</small>}{event.inputTokens == null && event.outputTokens == null && <small>{event.content.length.toLocaleString('fr-FR')} caractères</small>}</span>
            </button>
            {selected?.id === event.id && <article className="observatory-event-detail" onClick={(click) => click.stopPropagation()}>
              <header><div><b>Payload exact</b><small>{event.channel} · {event.injector ?? event.actor} → {event.recipient ?? 'non exposé'}</small></div><button onClick={() => setCompare((items) => items.some((item) => item.id === event.id) ? items.filter((item) => item.id !== event.id) : [...items, event].slice(-2))}>{compare.some((item) => item.id === event.id) ? 'Retirer du diff' : 'Comparer'}</button></header>
              <pre className="observatory-payload">{event.content || '(vide)'}</pre><p>{event.detail}</p>
              {event.payloads.length > 0 && <section className="observatory-payload-list">
                <b>Fragments conservés · {event.payloads.length}</b>
                {event.payloads.map((payload, payloadIndex) => <article key={`${event.id}:payload:${payloadIndex}`}>
                  <header><strong>{payload.name || payload.kind}</strong><small>{payload.kind}{payload.mediaType ? ` · ${payload.mediaType}` : ''}</small></header>
                  <pre className="observatory-payload">{payload.content || '(vide)'}</pre>
                </article>)}
              </section>}
            </article>}
          </div>)}
          <div className="observatory-turn-load"><i style={{ width: `${Math.min(100, turn.tokens / Math.max(1, timeline.totalTokens) * 100)}%` }} /></div>
        </section>)}
      </main>
    </div>
  </section>
}
