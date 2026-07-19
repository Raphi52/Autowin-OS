import { useEffect, useState } from 'react'
import {
  buildHarnessTimelineFromTrace,
  type HarnessTraceEvent,
  type HarnessTimelineEvent,
  type HarnessTimeline
} from './harness-timeline-model'
import './HarnessView.css'
import { diffPayloadLines } from './harness-payload-diff'
import { summarizeHermesTraces, type HermesTraceSummaryInput } from './hermes-trace-summary'
import { HumanJson } from './HumanJson'

interface ConversationItem { id: string; title: string; provider: string; updatedAt: number }
interface HermesTrace extends HermesTraceSummaryInput { messageCount: number; toolCount: number }
const EMPTY: HarnessTimeline = { turns: [], anomalies: [], totalTokens: 0, totalCostUsd: 0 }

const EVENT_LABEL: Record<HarnessTimelineEvent['kind'], string> = {
  'response-displayed': 'RÃ©ponse affichÃ©e',
  message: 'Message', injection: 'Injection', decision: 'Décision', 'tool-call': 'Commande',
  'tool-result': 'Résultat outil', 'model-response': 'Réponse modèle', handoff: 'Délégation',
  verdict: 'Verdict', gate: 'Contrôle', retry: 'Nouvelle tentative', cancellation: 'Annulation',
  error: 'Erreur', boundary: 'Frontière modèle'
}

export function HarnessView(): React.JSX.Element {
  const [conversations, setConversations] = useState<ConversationItem[]>([])
  const [conversationId, setConversationId] = useState('')
  const [timeline, setTimeline] = useState<HarnessTimeline>(EMPTY)
  const [selected, setSelected] = useState<HarnessTimelineEvent | null>(null)
  const [expert, setExpert] = useState(false)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [providerFilter, setProviderFilter] = useState('all')
  const [actorFilter, setActorFilter] = useState('all')
  const [compare, setCompare] = useState<HarnessTimelineEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [hermesTraces, setHermesTraces] = useState<HermesTrace[]>([])

  useEffect(() => {
    void window.api.conversations().then((items) => {
      const sorted = [...items].sort((a,b)=>b.updatedAt-a.updatedAt)
      setConversations(sorted)
      setConversationId(sorted[0]?.id ?? '')
    })
  }, [])

  useEffect(() => {
    if (!conversationId) { setHermesTraces([]); return }
    void window.api.hermesPromptTraces(conversationId).then((traces) =>
      setHermesTraces((traces as HermesTrace[]).slice(-100))
    )
  }, [conversationId, refreshKey])

  useEffect(() => {
    if (!conversationId) { setTimeline(EMPTY); setLoading(false); return }
    setLoading(true); setSelected(null)
    void window.api.causalTrace(conversationId)
      .then((events) => setTimeline(buildHarnessTimelineFromTrace(events as HarnessTraceEvent[])))
      .finally(() => setLoading(false))
  }, [conversationId, refreshKey])

  const needle = query.trim().toLocaleLowerCase('fr')
  const allEvents = timeline.turns.flatMap((turn) => turn.events)
  const typeOptions = [...new Set(allEvents.map((event) => event.kind))]
  const providerOptions = [...new Set(allEvents.map((event) => event.provider).filter(Boolean))] as string[]
  const actorOptions = [...new Set(allEvents.map((event) => event.actor))]
  const visibleTurns = timeline.turns.map((turn) => ({
    ...turn,
    events: turn.events.filter((event) =>
      (typeFilter === 'all' || event.kind === typeFilter) &&
      (providerFilter === 'all' || event.provider === providerFilter) &&
      (actorFilter === 'all' || event.actor === actorFilter) &&
      (!needle || `${event.actor} ${event.label} ${event.content} ${event.detail}`.toLocaleLowerCase('fr').includes(needle))
    )
  })).filter((turn)=>turn.events.length>0)
  const hermesSummary = summarizeHermesTraces(hermesTraces)

  async function exportTrace(): Promise<void> {
    if (!conversationId) return
    const events = await window.api.causalTrace(conversationId)
    const blob = new Blob([JSON.stringify({ schema: 'autowin.trace-export/v1', conversationId, events }, null, 2)], { type: 'application/json' })
    const href = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = href; link.download = `autowin-trace-${conversationId}.json`; link.click()
    URL.revokeObjectURL(href)
  }

  function openAnomaly(eventId: string): void {
    setQuery('')
    setTypeFilter('all')
    setProviderFilter('all')
    setActorFilter('all')
    setSelected(allEvents.find((event) => event.id === eventId) ?? null)
  }

  return (
    <section className="harness-view harness-control-room">
      <header className="harness-head">
        <div><span className="harness-kicker">BOÎTE NOIRE · EXÉCUTION RÉELLE</span><h1>Tour de contrôle</h1><p>Qui a reçu quoi, pourquoi, et ce qui s’est réellement passé.</p></div>
        <div className="harness-badges"><span>{timeline.turns.length} tours</span><span>{timeline.totalTokens.toLocaleString('fr-FR')} tokens</span><span>{timeline.totalCostUsd ? `$${timeline.totalCostUsd.toFixed(4)}` : 'coût non mesuré'}</span><span className={hermesSummary.count ? 'is-observed' : ''}>{hermesSummary.count ? `${hermesSummary.count} appels Hermes · ${hermesSummary.coverage}` : 'Hermes non observé'}</span>{hermesSummary.lastTimestamp && <span>Dernier · {new Date(hermesSummary.lastTimestamp).toLocaleString('fr-FR')} · {hermesSummary.lastModel}</span>}{hermesSummary.boundary && <span>{hermesSummary.boundary} · exact-redacted</span>}</div>
      </header>

      <div className="harness-toolbar">
        <div className="harness-level"><button className={!expert?'is-active':''} onClick={()=>setExpert(false)}>Comprendre</button><button className={expert?'is-active':''} onClick={()=>setExpert(true)}>Expert</button></div>
        <input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Rechercher un acteur, une injection, un contenu…" />
        <select value={typeFilter} onChange={(event)=>setTypeFilter(event.target.value)} aria-label="Type d’événement"><option value="all">Tous les types</option>{typeOptions.map((type)=><option key={type} value={type}>{EVENT_LABEL[type]}</option>)}</select>
        <select value={providerFilter} onChange={(event)=>setProviderFilter(event.target.value)} aria-label="Provider"><option value="all">Tous providers</option>{providerOptions.map((provider)=><option key={provider}>{provider}</option>)}</select>
        <select value={actorFilter} onChange={(event)=>setActorFilter(event.target.value)} aria-label="Acteur"><option value="all">Tous acteurs</option>{actorOptions.map((actor)=><option key={actor}>{actor}</option>)}</select>
        <button className="harness-refresh" onClick={()=>void exportTrace()}>Exporter JSON</button>
        <button className="harness-refresh" onClick={()=>setRefreshKey((value)=>value+1)}>Actualiser</button>
      </div>

      <div className="harness-flightdeck">
        <aside className="harness-runs">
          <span className="harness-panel-title">CONVERSATIONS</span>
          {conversations.map((conversation)=><button key={conversation.id} className={conversation.id===conversationId?'is-active':''} onClick={()=>setConversationId(conversation.id)}><strong>{conversation.title}</strong><small>{conversation.provider}</small></button>)}
          <section className="harness-diagnostics">
            <span className="harness-panel-title">À REGARDER</span>
            {timeline.anomalies.length === 0 ? <p>Aucune répétition ou surcharge évidente détectée.</p> :
              timeline.anomalies.map((item) => <button
                key={`${item.kind}:${item.eventId}`}
                onClick={() => openAnomaly(item.eventId)}
              >
                <strong><b>{item.count}×</b>{item.label}</strong>
                <span><em>Mesuré</em>{item.fact}</span>
                <span><em>Hypothèse</em>{item.hypothesis}</span>
                <span><em>Recommandé</em>{item.recommendation}</span>
              </button>)}
          </section>
        </aside>

        <main className="harness-timeline" data-testid="harness-timeline" aria-busy={loading} onClick={()=>setSelected(null)}>
          {loading && <div className="harness-empty">Lecture de la boîte noire…</div>}
          {!loading && visibleTurns.length===0 && <div className="harness-empty"><strong>Aucune trace pour cette conversation</strong><span>Envoie un message dans le chat : son parcours apparaîtra ici automatiquement.</span></div>}
          {visibleTurns.map((turn,turnIndex)=><section className="harness-turn" key={turn.id}>
            <header><div><span>TOUR {timeline.turns.length-turnIndex}</span><time>{new Date(turn.ts).toLocaleString('fr-FR')}</time></div><small>{turn.tokens.toLocaleString('fr-FR')} tokens · {turn.costUsd?`$${turn.costUsd.toFixed(4)}`:'coût indisponible'}</small></header>
            <nav className="harness-causal-map" aria-label="Carte causale du tour">
              {turn.events.map((event)=><button key={event.id} title={`${event.actor} · ${event.label}\nParent: ${event.parentId??'début du tour'}`} className={selected?.id===event.id?'is-active':''} onClick={(clickEvent)=>{clickEvent.stopPropagation();setSelected(event)}}><span>{EVENT_LABEL[event.kind]}</span><b>{event.actor}</b>{turn.events.some((child)=>child.parentId===event.id)&&<i>{turn.events.filter((child)=>child.parentId===event.id).length}</i>}</button>)}
            </nav>
            <div className="harness-event-track">
              {turn.events.map((event,index)=><button key={event.id} className={`harness-event is-${event.kind}${selected?.id===event.id?' is-selected':''}${compare.some((item)=>item.id===event.id)?' is-compared':''}`} onClick={(clickEvent)=>{clickEvent.stopPropagation(); if(clickEvent.shiftKey){setCompare((items)=>items.some((item)=>item.id===event.id)?items.filter((item)=>item.id!==event.id):[...items,event].slice(-2))}else setSelected(event)}}>
                <i>{index+1}</i><span className="harness-event-kind">{EVENT_LABEL[event.kind]}</span><strong>{event.actor}</strong><em>{event.label}</em><p>{event.content || 'Aucun contenu sur cette étape.'}</p>{index<turn.events.length-1&&<span className="harness-causal-arrow">→</span>}
              </button>)}
            </div>
          </section>)}
        </main>

        <aside className="harness-detail">
          <span className="harness-panel-title">INSPECTEUR</span>
          <button className="harness-compare-action" onClick={()=>selected&&setCompare((items)=>items.some((item)=>item.id===selected.id)?items.filter((item)=>item.id!==selected.id):[...items,selected].slice(-2))}>{compare.length<2?'Ajouter à la comparaison':'Remplacer dans le diff'}</button>
          {compare.length===2&&<section className="harness-diff" data-testid="harness-diff"><h3>DIFF DE DEUX PAYLOADS</h3><div><article><b>{compare[0].actor} · {compare[0].label}</b>{diffPayloadLines(compare[0].content,compare[1].content).map((line,index)=><code key={index} className={`is-${line.kind}`}>{line.kind==='added'?'':line.left}</code>)}</article><article><b>{compare[1].actor} · {compare[1].label}</b>{diffPayloadLines(compare[0].content,compare[1].content).map((line,index)=><code key={index} className={`is-${line.kind}`}>{line.kind==='removed'?'':line.right}</code>)}</article></div><small>{compare[0].content===compare[1].content?'Contenu identique : injection répétée.':'Vert = ajouté · rouge = supprimé · ambre = modifié.'}</small></section>}
          {!selected?<div className="harness-detail-empty"><b>Sélectionne une étape</b><span>Tu verras son contenu, son origine et sa destination.</span></div>:<>
            <div className={`harness-detail-icon is-${selected.kind}`}>{EVENT_LABEL[selected.kind]}</div>
            <h2>{selected.actor}</h2><p>{selected.label}</p>
            <dl><div><dt>Parent causal</dt><dd>{selected.parentId??'début du tour'}</dd></div>{selected.timestamp&&<div><dt>Horodatage</dt><dd>{new Date(selected.timestamp).toLocaleString('fr-FR')}</dd></div>}{selected.channel&&<div><dt>Canal</dt><dd>{selected.channel}</dd></div>}{selected.injector&&<div><dt>Injecteur</dt><dd>{selected.injector}</dd></div>}{selected.recipient&&<div><dt>Destinataire</dt><dd>{selected.recipient}</dd></div>}{selected.model&&<div><dt>Modèle</dt><dd>{selected.model}</dd></div>}{selected.reasoningEffort&&<div><dt>Effort</dt><dd>{selected.reasoningEffort}</dd></div>}{selected.transport&&<div><dt>Transport</dt><dd>{selected.transport}</dd></div>}{selected.sessionId&&<div><dt>Session</dt><dd>{selected.sessionId}</dd></div>}{selected.inputTokens!=null&&<div><dt>Tokens entrée</dt><dd>{selected.inputTokens}</dd></div>}{selected.outputTokens!=null&&<div><dt>Tokens sortie</dt><dd>{selected.outputTokens}</dd></div>}{selected.cacheReadTokens!=null&&<div><dt>Cache</dt><dd>{selected.cacheReadTokens}</dd></div>}{selected.durationMs!=null&&<div><dt>Latence</dt><dd>{Math.round(selected.durationMs)} ms</dd></div>}</dl>
            <section><h3>Contenu exact · {selected.payloads.length} fragment{selected.payloads.length>1?'s':''}</h3><div className="harness-payloads">{selected.payloads.map((payload,index)=><article key={`${payload.kind}-${index}`}><header><b>{payload.kind}</b>{payload.name&&<span>{payload.name}</span>}{payload.mediaType&&<em>{payload.mediaType}</em>}</header><HumanJson value={payload.content||'(vide)'} /></article>)}</div></section>
            <section><h3>Ce qui est observable</h3><p>{selected.detail}</p></section>
            {expert&&<section><h3>Brut</h3><HumanJson value={selected.raw ?? selected} /></section>}
          </>}
        </aside>
      </div>
    </section>
  )
}
