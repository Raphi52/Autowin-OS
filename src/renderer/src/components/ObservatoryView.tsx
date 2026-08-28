import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildHarnessTimelineFromTrace,
  type HarnessTraceEvent,
  type HarnessTimelineEvent,
  type HarnessTimeline
} from './harness-timeline-model'
import { QUICK_FILTERS, matchesQuickFilter, type QuickFilter } from './observatory-quick-filters'
import { compareObservatoryEvents } from './observatory-comparison-model'
import { buildObservatoryDecisionLedger } from './observatory-decision-ledger'
import { buildObservatoryPrioritySignals } from './observatory-priority-signals'
import { HumanJson } from './HumanJson'
import { BrainMarkdown } from './BrainMarkdown'
import { summarizeNativeTraces, type NativeTraceSummaryInput } from './native-trace-summary'
import { eventTurnId, humanEventPreview, splitLabeledJson } from './observatory-event-preview'
import './ViewPage.css'
import './ObservatoryView.css'
import { ModuleHeader } from './ModuleHeader'
import { useObservatorySources, type ActivitySessionMeta } from './useObservatorySources'
import { ObservatoryRail } from './ObservatoryRail'
import { ObservatoryCallDetail } from './ObservatoryCallDetail'
import type {
  ActivitySession,
  ConversationItem,
  NativeRawTrace,
  PromptCall
} from './observatory-view-types'
import { ObservatoryRagCausalStep } from './ObservatoryRagCausalStep'
import { RagTraceCard } from './RagTraceCard'
import { BrainNavigationCard, type BrainTraceView } from './BrainNavigationCard'
import { summarizeRagTrace } from './rag-trace-model'
import { LatestRequestGate, settleObservatorySources } from './observatory-reliability'
import { buildObservatoryExport } from './observatory-export-model'
import { buildCausalPath, flattenCausalNodes } from './causal-path-model'
import type { ObservatoryFocus } from '../observatory-focus'
import { layoutTurnEvents } from './observatory-turn-layout'
import { Spinner } from './Spinner'

const EMPTY: HarnessTimeline = { turns: [], anomalies: [], totalTokens: 0, totalCostUsd: 0 }
const LABEL: Record<HarnessTimelineEvent['kind'], string> = {
  'response-displayed': 'Réponse affichée',
  artifact: 'Artefact produit',
  message: 'Message',
  injection: 'Injection',
  decision: 'Décision',
  'tool-call': 'TOOL',
  'tool-result': 'TOOL RESULT',
  'model-response': 'Réponse',
  handoff: 'Délégation',
  verdict: 'Verdict',
  gate: 'Contrôle',
  retry: 'Retry',
  cancellation: 'Annulation',
  error: 'Erreur',
  boundary: 'Options'
}
const ZONE_LABEL: Record<'sortant' | 'reponse' | 'sousagent', string> = {
  sortant: 'Sortant',
  reponse: 'Réponse',
  sousagent: 'Sous-agents'
}
const ZONE_HINT: Record<'sortant' | 'reponse' | 'sousagent', string> = {
  sortant: 'ce qui part au provider · message + injection + options',
  reponse: 'ce que le modèle a produit et ce qui a été affiché',
  sousagent: 'délégation et jugements des sous-agents'
}
type CausalScope = 'all' | 'critical' | 'signals'
/**
 * Fenetre de rendu du rail. Mesure du 2026-08-11 : 905 conversations etaient montees d'un bloc,
 * soit 905 boutons DOM pour ~8 lignes visibles. Un rail se cherche, il ne se defile pas.
 */
const CONVERSATION_PAGE = 30

/** Rendu lisible d'un contenu de payload : JSON embarqué → arbre HumanJson ; sinon Markdown. */
function PayloadContent({ content }: { content: string }): React.JSX.Element {
  const text = content || '(vide)'
  const split = splitLabeledJson(text)
  if (!split)
    return (
      <div className="observatory-payload observatory-payload--markdown">
        <BrainMarkdown source={text} />
      </div>
    )
  return (
    <div className="observatory-payload">
      {split.prefix && <div className="observatory-payload-label">{split.prefix}</div>}
      <HumanJson value={split.json} />
    </div>
  )
}

export function ObservatoryView({
  active,
  focus = null,
  onDismissFocus,
  onOpenCapabilities
}: {
  active: boolean
  focus?: ObservatoryFocus | null
  onDismissFocus?: () => void
  onOpenCapabilities?: () => void
}): React.JSX.Element {
  const [conversations, setConversations] = useState<ConversationItem[]>([])
  const [conversationId, setConversationId] = useState('')
  const [timeline, setTimeline] = useState<HarnessTimeline>(EMPTY)
  const [promptCalls, setPromptCalls] = useState<PromptCall[]>([])
  const [selectedCall, setSelectedCall] = useState<PromptCall | null>(null)
  const [nativeMetadata, setNativeMetadata] = useState<NativeTraceSummaryInput[]>([])
  const [brainTraces, setBrainTraces] = useState<BrainTraceView[]>([])
  const [selected, setSelected] = useState<HarnessTimelineEvent | null>(null)
  const [compare, setCompare] = useState<HarnessTimelineEvent[]>([])
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [providerFilter, setProviderFilter] = useState('all')
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all')
  const [causalScope, setCausalScope] = useState<CausalScope>('all')
  const [conversationQuery, setConversationQuery] = useState('')
  const [conversationLimit, setConversationLimit] = useState(CONVERSATION_PAGE)
  const [callsLoading, setCallsLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number>()
  const [refreshKey, setRefreshKey] = useState(0)
  const [semanticRetryKey, setSemanticRetryKey] = useState(0)
  const [viewMode, setViewMode] = useState<'timeline' | 'causal'>('timeline')
  const [sourceErrors, setSourceErrors] = useState<Record<string, string>>({})
  const [turnFocus, setTurnFocus] = useState<ObservatoryFocus | null>(null)
  const [focusUnavailable, setFocusUnavailable] = useState<
    'conversation' | 'turn' | 'source' | null
  >(null)
  const [causalTracePartial, setCausalTracePartial] = useState(false)
  const [activitySession, setActivitySession] = useState<ActivitySession | null>(null)
  const [activityImage, setActivityImage] = useState('')
  const causalRequestGate = useRef(new LatestRequestGate())
  const promptRequestGate = useRef(new LatestRequestGate())
  const brainRequestGate = useRef(new LatestRequestGate())
  const refreshStartedAt = useRef(0)
  const liveRefreshTimer = useRef<number | null>(null)

  const updateSourceError = useCallback((source: string, message?: string): void => {
    setSourceErrors((current) => {
      const next = { ...current }
      if (message) next[source] = message
      else delete next[source]
      return next
    })
  }, [])

  const {
    activitySessions,
    conversationActivity,
    nativeTraces,
    semanticTimeline,
    loadingActivitySessions,
    loadingConversationActivity,
    runs,
    loadingRuns
  } = useObservatorySources<NativeRawTrace>({
    active,
    conversationId,
    refreshKey,
    semanticRetryKey,
    onSourceError: updateSourceError
  })

  const resetTimelineFilters = useCallback((): void => {
    setQuery('')
    setTypeFilter('all')
    setProviderFilter('all')
    setQuickFilter('all')
  }, [])

  const resetConversationFilters = useCallback((): void => {
    resetTimelineFilters()
    setCausalScope('all')
  }, [resetTimelineFilters])

  useEffect(() => {
    if (!active) return
    let disposed = false
    if (focus) {
      causalRequestGate.current.begin()
      // Réinitialisation atomique requise avant le chargement asynchrone d'un focus externe.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTurnFocus(focus)
      resetConversationFilters()
      setFocusUnavailable('source')
      setCausalTracePartial(false)
      setConversationId('')
      setTimeline(EMPTY)
      setSelected(null)
      setSelectedCall(null)
      setCompare([])
    }
    void settleObservatorySources({
      conversations: window.api.conversations(),
      native: window.api.promptTraceSummary()
    }).then(({ values, errors }) => {
      if (disposed) return
      const items = values.conversations
      if (items) {
        const sorted = [...items].sort((a, b) => b.updatedAt - a.updatedAt)
        setConversations(sorted)
        if (focus) {
          const targetExists = sorted.some(
            (conversation) => conversation.id === focus.conversationId
          )
          setTurnFocus(focus)
          setFocusUnavailable(targetExists ? null : 'conversation')
          setCausalTracePartial(false)
          if (!targetExists) causalRequestGate.current.begin()
          setConversationId(targetExists ? focus.conversationId : '')
        } else {
          setConversationId((current) => current || sorted[0]?.id || '')
        }
      }
      if (values.native) setNativeMetadata(values.native as NativeTraceSummaryInput[])
      setSourceErrors((current) => {
        const next = { ...current }
        for (const source of ['conversations', 'native']) delete next[source]
        for (const [source, message] of Object.entries(errors)) next[source] = message ?? 'Erreur'
        return next
      })
      if (focus && errors.conversations) setFocusUnavailable('source')
    })
    return () => {
      disposed = true
    }
  }, [active, refreshKey, focus, resetConversationFilters, updateSourceError])

  useEffect(() => {
    const request = brainRequestGate.current.begin()
    if (!active || !conversationId) {
      // Efface explicitement la source de la conversation precedente quand aucun scope n'est actif.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBrainTraces([])
      updateSourceError('brainTraces')
      return
    }
    void (window.api.brainTraces?.(conversationId) ?? Promise.resolve([]))
      .then((traces) => {
        if (!brainRequestGate.current.isCurrent(request)) return
        setBrainTraces(traces)
        updateSourceError('brainTraces')
      })
      .catch((error: unknown) => {
        if (!brainRequestGate.current.isCurrent(request)) return
        setBrainTraces([])
        updateSourceError('brainTraces', error instanceof Error ? error.message : String(error))
      })
  }, [active, conversationId, refreshKey, updateSourceError])

  useEffect(() => {
    if (!conversationId) {
      const requestId = promptRequestGate.current.begin()
      queueMicrotask(() => {
        if (!promptRequestGate.current.isCurrent(requestId)) return
        setPromptCalls([])
        setCallsLoading(false)
        updateSourceError('promptCalls')
      })
      return
    }
    const requestId = promptRequestGate.current.begin()
    // Chargement PROPRE a cette section du rail : `loading` ne couvre que la trace causale.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCallsLoading(true)
    queueMicrotask(() => {
      if (promptRequestGate.current.isCurrent(requestId)) setPromptCalls([])
    })
    void window.api
      .promptCalls(conversationId)
      .then((calls) => {
        if (!promptRequestGate.current.isCurrent(requestId)) return
        setPromptCalls(calls as PromptCall[])
        updateSourceError('promptCalls')
      })
      .catch((error: unknown) => {
        if (!promptRequestGate.current.isCurrent(requestId)) return
        setPromptCalls([])
        updateSourceError('promptCalls', error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (promptRequestGate.current.isCurrent(requestId)) setCallsLoading(false)
      })
  }, [active, conversationId, refreshKey, updateSourceError])

  useEffect(() => {
    if (!conversationId) {
      causalRequestGate.current.begin()
      // Évite d'afficher la timeline de la conversation précédente hors contexte.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTimeline(EMPTY)
      setSelected(null)
      setSelectedCall(null)
      setCompare([])
      setLoading(false)
      setRefreshing(false)
      return
    }
    setLoading(true)
    setTimeline(EMPTY)
    setSelected(null)
    setSelectedCall(null)
    setCompare([])
    const requestId = causalRequestGate.current.begin()
    let requestSucceeded = false
    void window.api
      .causalTrace(conversationId)
      .then((events) => {
        if (!causalRequestGate.current.isCurrent(requestId)) return
        const nextTimeline = buildHarnessTimelineFromTrace(events as HarnessTraceEvent[])
        setTimeline(nextTimeline)
        updateSourceError('causalTrace')
        requestSucceeded = true
      })
      .catch((error: unknown) => {
        if (!causalRequestGate.current.isCurrent(requestId)) return
        setTimeline(EMPTY)
        updateSourceError('causalTrace', error instanceof Error ? error.message : String(error))
      })
      .finally(async () => {
        const remainingBusyTime = refreshing
          ? Math.max(0, 300 - (Date.now() - refreshStartedAt.current))
          : 0
        if (remainingBusyTime)
          await new Promise((resolve) => setTimeout(resolve, remainingBusyTime))
        if (causalRequestGate.current.isCurrent(requestId)) {
          setLoading(false)
          setRefreshing(false)
          if (requestSucceeded) setLastRefreshedAt(Date.now())
        }
      })
    // A tab change must not reload or clear Observatory's local state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, refreshKey, turnFocus])

  useEffect(() => {
    if (!conversationId || !window.api.onAppEvent) return
    const unsubscribe = window.api.onAppEvent((event) => {
      if (event.type !== 'causal-trace-updated' || event.convId !== conversationId) return
      if (liveRefreshTimer.current !== null) return
      liveRefreshTimer.current = window.setTimeout(() => {
        liveRefreshTimer.current = null
        setRefreshKey((value) => value + 1)
      }, 40)
    })
    return () => {
      unsubscribe()
      if (liveRefreshTimer.current !== null) window.clearTimeout(liveRefreshTimer.current)
      liveRefreshTimer.current = null
    }
  }, [conversationId])

  useEffect(() => {
    if (
      !turnFocus ||
      focusUnavailable === 'conversation' ||
      focusUnavailable === 'source' ||
      loading
    )
      return
    if (turnFocus.conversationId !== conversationId) return
    const hasCausalProof = timeline.turns.some((turn) => turn.id === turnFocus.turnId)
    const hasPromptProof = promptCalls.some(
      (call) => call.conversationId === turnFocus.conversationId && call.turnId === turnFocus.turnId
    )
    // État dérivé synchronisé après résolution des deux sources de preuve asynchrones.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFocusUnavailable(hasCausalProof || hasPromptProof ? null : 'turn')
    setCausalTracePartial(!hasCausalProof && hasPromptProof)
  }, [conversationId, focusUnavailable, loading, promptCalls, timeline, turnFocus])

  const conversationCalls = useMemo(
    () => promptCalls.filter((call) => call.conversationId === conversationId),
    [promptCalls, conversationId]
  )
  const currentCalls = useMemo(
    () =>
      turnFocus
        ? conversationCalls.filter((call) => !focusUnavailable && call.turnId === turnFocus.turnId)
        : conversationCalls,
    [conversationCalls, focusUnavailable, turnFocus]
  )
  const observed = useMemo(
    () =>
      currentCalls.reduce(
        (sum, call) => ({
          input: sum.input + (call.usage?.inputTokens ?? 0),
          output: sum.output + (call.usage?.outputTokens ?? 0),
          cache: sum.cache + (call.usage?.cacheReadTokens ?? 0),
          cost: sum.cost + (call.usage?.costUsd ?? 0)
        }),
        { input: 0, output: 0, cache: 0, cost: 0 }
      ),
    [currentCalls]
  )
  const semanticComparison = useMemo(
    () => (compare.length === 2 ? compareObservatoryEvents(compare[0], compare[1]) : null),
    [compare]
  )
  const scopedTurns = useMemo(
    () =>
      timeline.turns.filter(
        (turn) =>
          !turnFocus ||
          (!focusUnavailable &&
            turnFocus.conversationId === conversationId &&
            turn.id === turnFocus.turnId)
      ),
    [conversationId, focusUnavailable, timeline.turns, turnFocus]
  )
  const allEvents = useMemo(() => scopedTurns.flatMap((turn) => turn.events), [scopedTurns])
  const authorityEvents = useMemo(() => allEvents.filter((event) => event.authority), [allEvents])
  const decisionLedger = useMemo(() => buildObservatoryDecisionLedger(allEvents), [allEvents])
  const causalPath = useMemo(() => buildCausalPath(allEvents), [allEvents])
  const causalNodes = flattenCausalNodes(causalPath.roots)
  // Les traces/RAG ne concernent que les tours réellement capturés. On SCOPE à la conversation
  // affichée : sinon les payloads GLOBAUX legacy (chargés à part) polluent une conv codex/claude
  // avec un « Requêtes · 24 » et « 24 sans RAG » qui ne la décrivent pas.
  const convNativeMetadata = nativeMetadata.filter((t) => t.conversationId === conversationId)
  const convBrainTraces = brainTraces.filter((t) => t.conversationId === conversationId)
  const convNativeTraces = nativeTraces.filter((t) => t.conversationId === conversationId)
  const nativeSummary = summarizeNativeTraces(convNativeMetadata)
  const legacyBrainTraces = convBrainTraces.filter((trace) => !trace.turnId)
  // SCOPE : un payload natif SANS conversationId n'appartient à AUCUNE conversation — l'afficher
  // dans celle qui est ouverte le fait fuiter d'une conv à l'autre (même liste partout). On ne
  // remonte donc que les traces de CETTE conversation dont le rattachement causal (turnId) manque.
  const unlinkedNativeTraces = nativeTraces.filter(
    (trace) =>
      Boolean(conversationId) &&
      trace.conversationId === conversationId &&
      (!trace.turnId || trace.turnId === 'unknown')
  )
  const hasNativeTraces = convNativeTraces.length > 0 || nativeSummary.count > 0
  const typeOptions = [...new Set(allEvents.map((event) => event.kind))]
  const providerOptions = [
    ...new Set(allEvents.map((event) => event.provider).filter(Boolean))
  ] as string[]
  const needle = query.trim().toLocaleLowerCase('fr')
  const visibleTurns = scopedTurns
    .map((turn) => ({
      ...turn,
      events: turn.events.filter(
        (event) =>
          matchesQuickFilter(event, quickFilter) &&
          (typeFilter === 'all' || event.kind === typeFilter) &&
          (providerFilter === 'all' || event.provider === providerFilter) &&
          (!needle ||
            `${event.actor} ${event.label} ${event.content} ${event.detail} ${event.provider ?? ''} ${event.model ?? ''} ${event.status ?? ''}`
              .toLocaleLowerCase('fr')
              .includes(needle))
      )
    }))
    .filter((turn) => turn.events.length)
  const visibleAnomalies = turnFocus
    ? timeline.anomalies.filter(
        (anomaly) => !focusUnavailable && anomaly.turnIds.includes(turnFocus.turnId)
      )
    : timeline.anomalies
  const prioritySignals = buildObservatoryPrioritySignals(visibleAnomalies, allEvents)
  const visibleEventCount = visibleTurns.reduce((sum, turn) => sum + turn.events.length, 0)
  const activeFilterCount =
    Number(Boolean(needle)) +
    Number(typeFilter !== 'all') +
    Number(providerFilter !== 'all') +
    Number(quickFilter !== 'all')
  const conversationNeedle = conversationQuery.trim().toLocaleLowerCase('fr')
  const filteredConversations = conversationNeedle
    ? conversations.filter((conversation) =>
        `${conversation.title} ${conversation.provider}`
          .toLocaleLowerCase('fr')
          .includes(conversationNeedle)
      )
    : conversations
  const visibleConversations = filteredConversations.slice(0, conversationLimit)
  const hiddenConversationCount = filteredConversations.length - visibleConversations.length
  const causalFilterCount = Number(causalScope !== 'all')
  const visibleCausalNodes = causalNodes.filter((node) => {
    if (causalScope === 'critical') return node.onCriticalPath
    if (causalScope === 'signals')
      return node.isBottleneck || node.issues.length > 0 || node.event.kind === 'error'
    return true
  })

  function selectConversation(nextConversationId: string): void {
    setTurnFocus(null)
    setFocusUnavailable(null)
    setCausalTracePartial(false)
    resetConversationFilters()
    setSelected(null)
    setSelectedCall(null)
    setCompare([])
    setConversationId(nextConversationId)
  }

  function openActivitySession(session: ActivitySessionMeta): void {
    // `.catch` obligatoire : une session supprimée/déplacée entre le listing et le clic (nettoyage
    // auto des runs) rejetait en silence — clic muet, l'utilisateur reclique.
    void window.api
      .activitySession(session)
      .then((result) => {
        setActivitySession(result)
        setActivityImage('')
      })
      .catch((error: unknown) => {
        setActivitySession(null)
        setActivityImage('')
        // Visible : le bandeau d'erreurs de sources, plutôt qu'un clic sans effet.
        updateSourceError(
          'activitySession',
          `Session illisible (${session.path}) : ${error instanceof Error ? error.message : String(error)}`
        )
      })
  }

  function openActivityImage(path: string): void {
    if (!activitySession) return
    // Meme exigence que `activitySession` ci-dessus : une capture supprimee entre le listing et le
    // clic rejetait en SILENCE.
    void window.api
      .activityImage(activitySession.meta, path)
      .then((result) => {
        setActivityImage(result.dataUrl)
        updateSourceError('activityImage')
      })
      .catch((error: unknown) => {
        setActivityImage('')
        updateSourceError(
          'activityImage',
          `Capture illisible (${path}) : ${error instanceof Error ? error.message : String(error)}`
        )
      })
  }

  function refreshSources(): void {
    refreshStartedAt.current = Date.now()
    setRefreshing(true)
    setRefreshKey((value) => value + 1)
    setSemanticRetryKey((value) => value + 1)
  }

  function openEvent(eventId: string): void {
    // Recopiait les cinq mêmes setters que `resetConversationFilters` : une règle de remise à zéro
    // écrite à TROIS endroits divergeait au premier filtre ajouté — un filtre neuf aurait été remis
    // à zéro ici mais pas là, sans que rien ne le signale.
    resetConversationFilters()
    setSelectedCall(null)
    setSelected(allEvents.find((event) => event.id === eventId) ?? null)
  }

  async function exportTrace(scope: 'view' | 'full'): Promise<void> {
    if (!conversationId) return
    const visibleCausalIds = new Set(visibleCausalNodes.map((node) => node.id))
    const exportedCausalSource =
      scope === 'view' ? (viewMode === 'causal' ? visibleCausalNodes : []) : causalNodes
    const exportedCausalIds = new Set(exportedCausalSource.map((node) => node.id))
    const exportedCausalNodes = exportedCausalSource.map(({ children, ...node }) => ({
      ...node,
      childIds: children.map((child) => child.id).filter((id) => exportedCausalIds.has(id))
    }))
    const causalViewTimeline = {
      ...timeline,
      turns: timeline.turns
        .map((turn) => ({
          ...turn,
          events: turn.events.filter((event) => visibleCausalIds.has(event.id))
        }))
        .filter((turn) => turn.events.length),
      anomalies: visibleAnomalies
    }
    const exportedTimeline =
      scope === 'view'
        ? viewMode === 'causal'
          ? causalViewTimeline
          : { ...timeline, turns: visibleTurns, anomalies: visibleAnomalies }
        : timeline
    const exported = buildObservatoryExport({
      scope,
      exportedAt: new Date().toISOString(),
      conversationId,
      filters:
        scope === 'view'
          ? { query, type: typeFilter, provider: providerFilter }
          : { query: '', type: 'all', provider: 'all' },
      view: {
        mode: scope === 'view' ? viewMode : 'timeline',
        quickFilter: scope === 'view' ? quickFilter : 'all',
        causalScope: scope === 'view' ? causalScope : 'all'
      },
      limitations: [
        scope === 'view'
          ? 'Cet export contient uniquement les événements visibles dans la vue filtrée.'
          : 'Cet export contient la trace complète, indépendamment des filtres visibles.',
        'Les traces globales sans conversationId ne peuvent pas être attribuées à cette conversation.',
        'Les payloads exportés sont exact-redacted ; les secrets connus sont masqués à nouveau.'
      ],
      timeline: exportedTimeline,
      causalNodes: exportedCausalNodes,
      promptCalls: currentCalls,
      // SCOPE : `nativeTraces` est la liste GLOBALE. L'exporter contredisait la limitation affichee
      // juste au-dessus et faisait fuiter les requetes d'AUTRES conversations dans un fichier
      // presente comme celui de la conversation courante.
      nativeTraces: convNativeTraces
    })
    const href = URL.createObjectURL(
      new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' })
    )
    const link = document.createElement('a')
    link.href = href
    link.download = `autowin-trace-${scope}-${conversationId}.json`
    link.click()
    URL.revokeObjectURL(href)
  }

  /** Rend une ligne d'event de la timeline (extrait pour permettre le regroupement « Sortant »). */

  const renderEvent = (
    event: HarnessTimelineEvent,
    index: number,
    diverges = false,
    turnId = ''
  ): React.JSX.Element => (
    <div key={event.id} className="observatory-event-wrap">
      <ObservatoryRagCausalStep
        event={event}
        turnId={turnId}
        scopedTurns={scopedTurns}
        currentCalls={currentCalls}
        convBrainTraces={convBrainTraces}
      />
      <button
        className={`observatory-event is-${event.kind}${selected?.id === event.id ? ' is-selected' : ''}${compare.some((item) => item.id === event.id) ? ' is-compared' : ''}`}
        onClick={(click) => {
          click.stopPropagation()
          if (click.shiftKey)
            setCompare((items) =>
              items.some((item) => item.id === event.id)
                ? items.filter((item) => item.id !== event.id)
                : [...items, event].slice(-2)
            )
          else {
            setSelectedCall(null)
            setSelected(selected?.id === event.id ? null : event)
          }
        }}
      >
        <i>{index + 1}</i>
        <span>
          <b>{LABEL[event.kind]}</b>
          {diverges && <em className="observatory-diverge-badge">divergeant</em>}
          <small>{event.actor}</small>
        </span>
        <p>
          <strong>
            {event.content
              ? humanEventPreview(event.kind, event.content, 140)
              : 'Aucun contenu observable.'}
          </strong>
          <small>
            {event.provider
              ? `${event.provider}${event.model ? ` · ${event.model}` : ''}`
              : event.detail}
          </small>
        </p>
        <span className="observatory-load">
          {event.inputTokens != null && <b>{event.inputTokens.toLocaleString('fr-FR')} in</b>}
          {event.cacheReadTokens != null && (
            <small>{event.cacheReadTokens.toLocaleString('fr-FR')} cache</small>
          )}
          {event.outputTokens != null && (
            <small>{event.outputTokens.toLocaleString('fr-FR')} out</small>
          )}
          {event.costUsd != null && <small>${event.costUsd.toFixed(4)}</small>}
          {event.durationMs != null && <small>{Math.round(event.durationMs)} ms</small>}
          {event.inputTokens == null && event.outputTokens == null && (
            <small>{event.content.length.toLocaleString('fr-FR')} caractères</small>
          )}
        </span>
      </button>
      {selected?.id === event.id && (
        <article className="observatory-event-detail" onClick={(click) => click.stopPropagation()}>
          <header>
            <div>
              <b>Payload exact</b>
              <small>
                {event.channel} · {event.injector ?? event.actor} →{' '}
                {event.recipient ?? 'non exposé'}
              </small>
            </div>
            <button
              onClick={() =>
                setCompare((items) =>
                  items.some((item) => item.id === event.id)
                    ? items.filter((item) => item.id !== event.id)
                    : [...items, event].slice(-2)
                )
              }
            >
              {compare.some((item) => item.id === event.id) ? 'Retirer du diff' : 'Comparer'}
            </button>
          </header>
          {/* `event.content` = concaténation des payloads (harness-timeline-model). Redondant dès
              qu'il y a des blocs → on ne l'affiche qu'en FALLBACK (aucun bloc), sinon on montre
              uniquement les blocs décomposés + nommés ci-dessous. */}
          {event.payloads.length === 0 && <PayloadContent content={event.content} />}
          <p>{event.detail}</p>
          {event.payloads.length > 0 && (
            <section className="observatory-payload-list">
              <b>Blocs · {event.payloads.length}</b>
              {event.payloads.map((payload, payloadIndex) => (
                <article key={`${event.id}:payload:${payloadIndex}`}>
                  <header>
                    <strong>{payload.name || payload.kind}</strong>
                    <small>
                      {payload.kind}
                      {payload.mediaType ? ` · ${payload.mediaType}` : ''}
                    </small>
                  </header>
                  <PayloadContent content={payload.content} />
                </article>
              ))}
            </section>
          )}
        </article>
      )}
    </div>
  )

  return (
    <section className="view-page observatory-view" data-testid="observatory-view">
      <header className="observatory-head">
        <ModuleHeader
          eyebrow="Traçabilité des conversations"
          title="Observatory"
          description="Suis les appels, les coûts, les durées et les erreurs."
        />
        <div className="observatory-metrics">
          <strong data-metric="calls">
            {currentCalls.length.toLocaleString('fr-FR')}
            <small>appels · conversation</small>
          </strong>
          <strong data-metric="input">
            {observed.input.toLocaleString('fr-FR')}
            <small>tokens in</small>
          </strong>
          <strong data-metric="cache">
            {observed.cache.toLocaleString('fr-FR')}
            <small>cache lu</small>
          </strong>
          {observed.cost === 0 && observed.input + observed.output > 0 ? (
            // Des tokens sans prix ne prouvent ni une gratuite ni un abonnement : le fournisseur
            // peut simplement ne pas exposer la tarification dans son retour d'usage.
            <strong data-metric="cost" title="Prix non exposé par le fournisseur pour ces appels">
              non exposé
              <small>coût inconnu</small>
            </strong>
          ) : (
            <strong data-metric="cost">
              ${observed.cost.toFixed(3)}
              <small>coût</small>
            </strong>
          )}
          <strong
            data-metric="actions"
            title="Actions réelles exécutées par les sous-agents (commandes shell, patchs fichiers)"
          >
            {allEvents.filter((event) => event.kind === 'tool-call').length.toLocaleString('fr-FR')}
            <small>actions réelles</small>
          </strong>
          {hasNativeTraces && (
            <strong data-metric="native">
              {nativeSummary.count.toLocaleString('fr-FR')}
              <small>Requêtes · {nativeSummary.coverage}</small>
            </strong>
          )}
        </div>
      </header>
      <div className="observatory-toolbar">
        <div className="observatory-toolbar__scope" data-toolbar-zone="scope">
          <span data-testid="observatory-result-count">
            <strong>
              {(viewMode === 'timeline'
                ? visibleEventCount
                : visibleCausalNodes.length
              ).toLocaleString('fr-FR')}
            </strong>
            {' / '}
            {(viewMode === 'timeline' ? allEvents.length : causalNodes.length).toLocaleString(
              'fr-FR'
            )}{' '}
            {viewMode === 'timeline' ? 'événements' : 'étapes'}
          </span>
          <small
            data-testid="observatory-freshness"
            data-refreshed-at={lastRefreshedAt ?? ''}
            data-refresh-status={
              lastRefreshedAt ? (Object.keys(sourceErrors).length ? 'partial' : 'complete') : 'idle'
            }
          >
            {lastRefreshedAt
              ? `${Object.keys(sourceErrors).length ? 'Actualisation partielle' : 'Actualisé'} à ${new Date(lastRefreshedAt).toLocaleTimeString('fr-FR')}`
              : 'En attente de données'}
          </small>
          {hasNativeTraces && nativeSummary.lastTimestamp && (
            <small
              className="observatory-native-proof"
              title={`${nativeSummary.lastModel} · ${nativeSummary.boundary} · exact-redacted`}
            >
              Native exact-redacted
            </small>
          )}
        </div>

        <div className="observatory-toolbar__analysis" data-toolbar-zone="analysis">
          <div className="observatory-view-switch" role="group" aria-label="Mode de visualisation">
            <button
              className={viewMode === 'timeline' ? 'is-active' : ''}
              aria-pressed={viewMode === 'timeline'}
              onClick={() => setViewMode('timeline')}
            >
              Chronologie
            </button>
            <button
              className={viewMode === 'causal' ? 'is-active' : ''}
              aria-pressed={viewMode === 'causal'}
              onClick={() => setViewMode('causal')}
            >
              Chemin critique
            </button>
          </div>
          {/* La comparaison A/B n'existait que comme geste cache (Shift+clic) : rien ne l'annoncait
              ni ne montrait ou en etait la selection. */}
          <span
            className="observatory-compare-status"
            data-testid="observatory-compare-status"
            role="status"
          >
            <b>
              {compare.length}/2 sélectionné{compare.length > 1 ? 's' : ''}
            </b>
            <small>Shift+clic sur deux événements pour les comparer</small>
          </span>

          {viewMode === 'timeline' ? (
            <div className="observatory-toolbar__timeline" data-testid="timeline-controls">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Rechercher acteur, modèle, contenu…"
                aria-label="Rechercher dans la chronologie"
              />
              <div className="observatory-quick-filters" aria-label="Filtres rapides">
                {QUICK_FILTERS.map((filter) => (
                  <button
                    type="button"
                    key={filter.value}
                    className={quickFilter === filter.value ? 'is-active' : ''}
                    aria-pressed={quickFilter === filter.value}
                    onClick={() =>
                      setQuickFilter((current) => (current === filter.value ? 'all' : filter.value))
                    }
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
              <details className="observatory-filter-menu">
                <summary>Filtres{activeFilterCount ? ` · ${activeFilterCount}` : ''}</summary>
                <div>
                  <select
                    value={typeFilter}
                    onChange={(event) => setTypeFilter(event.target.value)}
                    aria-label="Type"
                  >
                    <option value="all">Tous les types</option>
                    {typeOptions.map((type) => (
                      <option key={type} value={type}>
                        {LABEL[type]}
                      </option>
                    ))}
                  </select>
                  <select
                    value={providerFilter}
                    onChange={(event) => setProviderFilter(event.target.value)}
                    aria-label="Provider"
                  >
                    <option value="all">Tous providers</option>
                    {providerOptions.map((provider) => (
                      <option key={provider}>{provider}</option>
                    ))}
                  </select>
                </div>
              </details>
              <button
                type="button"
                className="observatory-reset"
                onClick={resetTimelineFilters}
                disabled={activeFilterCount === 0}
              >
                Réinitialiser
              </button>
            </div>
          ) : (
            <div className="observatory-causal-controls" data-testid="causal-controls">
              {(
                [
                  ['all', 'Tous les liens'],
                  ['critical', 'Critique seul'],
                  ['signals', 'Signaux']
                ] as Array<[CausalScope, string]>
              ).map(([scope, label]) => (
                <button
                  type="button"
                  key={scope}
                  className={causalScope === scope ? 'is-active' : ''}
                  aria-pressed={causalScope === scope}
                  onClick={() => setCausalScope(scope)}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                className="observatory-reset"
                data-testid="observatory-causal-reset"
                onClick={() => setCausalScope('all')}
                disabled={causalFilterCount === 0}
              >
                Réinitialiser{causalFilterCount ? ` · ${causalFilterCount}` : ''}
              </button>
            </div>
          )}
        </div>

        <div className="observatory-toolbar__actions" data-toolbar-zone="actions">
          <button
            type="button"
            data-testid="observatory-refresh"
            onClick={refreshSources}
            disabled={refreshing}
          >
            {refreshing ? 'Actualisation…' : 'Actualiser'}
          </button>
          <details>
            <summary>Actions</summary>
            <div>
              <button
                type="button"
                onClick={() => onOpenCapabilities?.()}
                title="Éditer les capacités injectées dans le prompt (Skills · Hooks · Tools)"
              >
                Capacités du prompt
              </button>
              <button
                type="button"
                disabled={!conversationId}
                onClick={() => void exportTrace('view')}
              >
                Exporter la vue
              </button>
              <button
                type="button"
                disabled={!conversationId}
                onClick={() => void exportTrace('full')}
              >
                Exporter toute la trace
              </button>
            </div>
          </details>
        </div>
      </div>
      {turnFocus && (
        <aside className="observatory-turn-focus" role="status">
          <span>
            {focusUnavailable === 'conversation'
              ? 'Conversation ciblée introuvable'
              : focusUnavailable === 'source'
                ? 'Conversation ciblée indisponible'
                : focusUnavailable === 'turn'
                  ? `Tour ${turnFocus.turnId} introuvable dans cette conversation`
                  : causalTracePartial
                    ? `Tour ciblé · ${turnFocus.turnId} · trace causale partielle, preuves d’appel disponibles`
                    : `Tour ciblé · ${turnFocus.turnId}`}
          </span>
          <button
            type="button"
            onClick={() => {
              setTurnFocus(null)
              setFocusUnavailable(null)
              setCausalTracePartial(false)
              if (!conversationId) setConversationId(conversations[0]?.id ?? '')
              // Le congédiement doit remonter au parent : sinon la prop `focus` reste posée
              // et le prochain rafraîchissement live ré-enferme la vue sur l'ancien tour.
              onDismissFocus?.()
            }}
          >
            Toute la conversation
          </button>
        </aside>
      )}
      {Object.keys(sourceErrors).length > 0 && (
        <aside className="observatory-source-errors" role="alert">
          <div>
            <strong>Certaines sources de télémétrie sont indisponibles</strong>
            <small>
              {Object.entries(sourceErrors)
                .map(([source, message]) => `${source} : ${message}`)
                .join(' · ')}
            </small>
          </div>
          <button
            onClick={() => {
              setRefreshKey((value) => value + 1)
              setSemanticRetryKey((value) => value + 1)
            }}
          >
            Réessayer
          </button>
        </aside>
      )}
      {conversationId && semanticTimeline && (
        <aside className="observatory-semantic-timeline" data-testid="semantic-timeline-summary">
          <strong>Memoire temporelle reconstruite</strong>
          <small>
            {semanticTimeline.nodes.length} noeud{semanticTimeline.nodes.length > 1 ? 's' : ''} ·{' '}
            {semanticTimeline.edges.length} lien{semanticTimeline.edges.length > 1 ? 's' : ''}
          </small>
        </aside>
      )}
      {legacyBrainTraces.length > 0 && (
        <details className="observatory-native-diagnostics">
          <summary>
            {legacyBrainTraces.length} ancienne{legacyBrainTraces.length > 1 ? 's' : ''} trace
            {legacyBrainTraces.length > 1 ? 's' : ''} Brain · non rattachée
            {legacyBrainTraces.length > 1 ? 's' : ''} à un tour
          </summary>
          <p>
            Ces traces historiques n’ont pas de turnId. Observatory refuse de leur inventer une
            position causale.
          </p>
          <div>
            {legacyBrainTraces.map((trace) => (
              <BrainNavigationCard
                key={`${trace.timestamp}:${trace.conversationId}`}
                trace={trace}
              />
            ))}
          </div>
        </details>
      )}
      {unlinkedNativeTraces.length > 0 && (
        <details className="observatory-native-diagnostics">
          <summary>
            {unlinkedNativeTraces.length} payload
            {unlinkedNativeTraces.length > 1 ? 's' : ''} brut
            {unlinkedNativeTraces.length > 1 ? 's' : ''} · non rattaché
            {unlinkedNativeTraces.length > 1 ? 's' : ''}
          </summary>
          <p>
            Ces requêtes ne sont attribuées à aucune conversation sans identifiant partagé. Secrets
            masqués.
          </p>
          <div>
            {[...unlinkedNativeTraces]
              .reverse()
              .slice(0, 20)
              .map((trace) => (
                <details key={trace.apiRequestId}>
                  <summary>
                    {new Date(trace.timestamp).toLocaleString('fr-FR')} · {trace.provider} →{' '}
                    {trace.model} · {trace.messageCount} messages · {trace.toolCount} outils
                  </summary>
                  <RagTraceCard request={trace.request} />
                  <details className="observatory-rag-payload">
                    <summary>Payload exact · exact-redacted</summary>
                    <HumanJson value={trace.request} />
                  </details>
                </details>
              ))}
          </div>
        </details>
      )}
      <div className="observatory-flightdeck">
        <ObservatoryRail
          conversationQuery={conversationQuery}
          onConversationQueryChange={(value) => {
            setConversationQuery(value)
            setConversationLimit(CONVERSATION_PAGE)
          }}
          conversationLimitStep={CONVERSATION_PAGE}
          visibleConversations={visibleConversations}
          filteredConversationCount={filteredConversations.length}
          hiddenConversationCount={hiddenConversationCount}
          onShowMoreConversations={() => setConversationLimit((limit) => limit + CONVERSATION_PAGE)}
          conversationId={conversationId}
          onSelectConversation={selectConversation}
          callsLoading={callsLoading}
          currentCalls={currentCalls}
          selectedCallId={selectedCall?.id}
          onSelectCall={(call) => {
            setSelected(null)
            setSelectedCall(call)
          }}
          conversationActivity={conversationActivity}
          conversationActivityLoading={loadingConversationActivity}
          activitySessions={activitySessions}
          activitySessionsLoading={loadingActivitySessions}
          activitySession={activitySession}
          onOpenSession={openActivitySession}
          activityImage={activityImage}
          onOpenImage={openActivityImage}
          runs={runs}
          runsLoading={loadingRuns}
          // Révéler le fichier plutôt qu'en afficher un aperçu : un RUN.md se lit et s'ÉDITE, et
          // Observatory n'est pas un éditeur. `showItemInFolder` côté main fait le reste.
          onOpenRun={(path) => void window.api.openFolder?.(path)}
          prioritySignals={prioritySignals}
          onOpenSignal={openEvent}
        />
        <main
          className="observatory-stream"
          onClick={() => {
            setSelected(null)
            setSelectedCall(null)
          }}
          data-testid="observatory-stream"
          aria-busy={loading}
        >
          {loading && (
            <div className="observatory-empty">
              <Spinner /> Lecture des traces…
            </div>
          )}
          {/* Trois CAUSES distinctes derriere un flux vide : aucune conversation, aucune trace, ou
              filtre trop strict. Un message unique laissait l'utilisateur sans action suivante. */}
          {!loading &&
            viewMode === 'timeline' &&
            visibleTurns.length === 0 &&
            (!conversationId ? (
              <div className="observatory-empty" data-testid="observatory-empty-no-conversation">
                Aucune conversation à observer. Sélectionnez-en une dans le rail.
              </div>
            ) : allEvents.length === 0 ? (
              <div className="observatory-empty" data-testid="observatory-empty-no-trace">
                Cette conversation n’a aucune trace capturée.
              </div>
            ) : (
              <div className="observatory-empty" data-testid="observatory-empty-filtered">
                <span>
                  Aucun des {allEvents.length.toLocaleString('fr-FR')} événements ne passe les
                  filtres actifs.
                </span>
                <button type="button" onClick={resetTimelineFilters}>
                  Réinitialiser les filtres
                </button>
              </div>
            ))}
          {!loading && viewMode === 'causal' && causalNodes.length === 0 && (
            <div className="observatory-empty">Aucun lien causal observable.</div>
          )}
          {!loading &&
            viewMode === 'causal' &&
            causalNodes.length > 0 &&
            visibleCausalNodes.length === 0 && (
              <div className="observatory-empty" data-testid="observatory-empty-causal-filtered">
                <span>
                  Aucune des {causalNodes.length.toLocaleString('fr-FR')} étapes ne passe ce filtre
                  causal.
                </span>
                <button type="button" onClick={() => setCausalScope('all')}>
                  Voir tous les liens
                </button>
              </div>
            )}
          {!loading && viewMode === 'causal' && visibleCausalNodes.length > 0 && (
            <section className="observatory-causal-path" aria-label="Chemin causal critique">
              <header>
                <div>
                  <b>Chemin causal critique</b>
                  <small>
                    {causalPath.criticalPathIds.length} étape
                    {causalPath.criticalPathIds.length > 1 ? 's' : ''} · goulot{' '}
                    {causalPath.bottleneckId
                      ? causalPath.byId.get(causalPath.bottleneckId)?.event.label
                      : 'non calculable'}
                  </small>
                </div>
                <span>Inclusif / exclusif</span>
              </header>
              <div className="observatory-causal-tree">
                {visibleCausalNodes.map((node) => (
                  <div className="observatory-causal-node-wrap" key={node.id}>
                    <button
                      className={`${node.onCriticalPath ? 'is-critical' : ''}${node.isBottleneck ? ' is-bottleneck' : ''}${selected?.id === node.id ? ' is-selected' : ''}`}
                      style={{ '--causal-depth': node.depth } as React.CSSProperties}
                      onClick={(event) => {
                        event.stopPropagation()
                        setSelectedCall(null)
                        setSelected(selected?.id === node.id ? null : node.event)
                      }}
                    >
                      <i />
                      <span>
                        <strong>{node.event.label}</strong>
                        <small>
                          {node.event.actor} · {node.event.kind}
                        </small>
                      </span>
                      <span>
                        <b>
                          {node.inclusiveDurationMs == null
                            ? 'opaque'
                            : `${Math.round(node.inclusiveDurationMs)} ms`}
                        </b>
                        <small>
                          {node.exclusiveDurationMs == null
                            ? 'exclusif inconnu'
                            : `${Math.round(node.exclusiveDurationMs)} ms propre`}
                        </small>
                      </span>
                      {node.issues.length > 0 && <em>{node.issues.join(' · ')}</em>}
                      {node.event.kind === 'injection' &&
                        summarizeRagTrace({ system: node.event.content }).status === 'injected' && (
                          <em className="observatory-rag-node-badge">RAG injecté</em>
                        )}
                    </button>
                    {selected?.id === node.id && (
                      <article
                        className="observatory-causal-detail"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <header>
                          <div>
                            <b>Payload exact · {node.event.label}</b>
                            <small>
                              {node.event.channel} · {node.event.injector ?? node.event.actor} →{' '}
                              {node.event.recipient ?? 'non exposé'}
                            </small>
                          </div>
                          <button onClick={() => setSelected(null)}>Fermer</button>
                        </header>
                        <ObservatoryRagCausalStep
                          event={node.event}
                          turnId={eventTurnId(node.event)}
                          scopedTurns={scopedTurns}
                          currentCalls={currentCalls}
                          convBrainTraces={convBrainTraces}
                        />
                        <PayloadContent content={node.event.content} />
                        <p>{node.event.detail}</p>
                        {node.event.payloads.length > 0 && (
                          <HumanJson value={node.event.payloads} className="observatory-payload" />
                        )}
                      </article>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
          {selectedCall && (
            <ObservatoryCallDetail
              key={selectedCall.id}
              call={selectedCall}
              onClose={() => setSelectedCall(null)}
            />
          )}
          {compare.length === 2 && semanticComparison && (
            <section className="observatory-diff">
              <header>
                <div>
                  <b>Comparaison causale A/B</b>
                  <small>
                    {semanticComparison.changed} changement
                    {semanticComparison.changed > 1 ? 's' : ''}
                  </small>
                </div>
                <button
                  onClick={(event) => {
                    event.stopPropagation()
                    setCompare([])
                  }}
                >
                  Fermer
                </button>
              </header>
              <table>
                <thead>
                  <tr>
                    <th>Champ</th>
                    <th>A</th>
                    <th>B</th>
                    <th>Delta</th>
                  </tr>
                </thead>
                <tbody>
                  {semanticComparison.rows.map((row) => (
                    <tr key={row.key} data-change={row.change}>
                      <th>{row.label}</th>
                      <td>
                        <code>
                          {row.before == null || row.before === '' ? '—' : String(row.before)}
                        </code>
                      </td>
                      <td>
                        <code>
                          {row.after == null || row.after === '' ? '—' : String(row.after)}
                        </code>
                      </td>
                      <td>
                        {row.delta != null
                          ? `${row.delta > 0 ? '+' : ''}${row.delta}`
                          : row.change === 'same'
                            ? '='
                            : row.change}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          {!loading && decisionLedger.length > 0 && (
            <details
              className="observatory-decision-ledger"
              data-testid="observatory-decision-ledger"
              onClick={(event) => event.stopPropagation()}
            >
              <summary>
                <div>
                  <b>Décisions & preuves</b>
                  <small>
                    {decisionLedger.filter((entry) => entry.status === 'open').length} ouverte
                    {decisionLedger.filter((entry) => entry.status === 'open').length > 1
                      ? 's'
                      : ''}
                  </small>
                </div>
                <span>Hypothèse → signal → observation → verdict</span>
              </summary>
              <div>
                {decisionLedger.map((entry) => (
                  <article key={entry.decisionId} data-status={entry.status}>
                    <header>
                      <strong>{entry.hypothesis}</strong>
                      <b>{entry.status === 'open' ? 'ouverte' : 'clôturée'}</b>
                    </header>
                    <dl>
                      <div>
                        <dt>Signal attendu</dt>
                        <dd>{entry.expectedSignal ?? 'non déclaré'}</dd>
                      </div>
                      <div>
                        <dt>Observation</dt>
                        <dd>{entry.observation ?? 'non observée'}</dd>
                      </div>
                      <div>
                        <dt>Gate</dt>
                        <dd>{entry.gate ?? 'non passé'}</dd>
                      </div>
                      <div>
                        <dt>Verdict</dt>
                        <dd>{entry.verdict ?? 'en attente'}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
            </details>
          )}
          {viewMode === 'timeline' &&
            visibleTurns.map((turn, turnIndex) => (
              <section className="observatory-turn" key={turn.id}>
                <header>
                  <div>
                    <span>TOUR {timeline.turns.length - turnIndex}</span>
                    <time>{new Date(turn.ts).toLocaleString('fr-FR')}</time>
                  </div>
                  <small>
                    {turn.tokens.toLocaleString('fr-FR')} tokens ·{' '}
                    {turn.costUsd
                      ? `$${turn.costUsd.toFixed(4)}`
                      : `${turn.inputTokens.toLocaleString('fr-FR')} in · ${turn.outputTokens.toLocaleString('fr-FR')} out`}
                  </small>
                </header>
                {(() => {
                  let n = 0
                  return layoutTurnEvents(turn.events).map((item, itemIndex) =>
                    item.type === 'group' ? (
                      <div
                        key={`${item.zone}:${turn.id}:${itemIndex}`}
                        className={`observatory-group is-${item.zone}`}
                      >
                        <div className="observatory-group-head">
                          <b>{ZONE_LABEL[item.zone]}</b>
                          <small>{ZONE_HINT[item.zone]}</small>
                        </div>
                        {item.events.map(({ event, diverges }) =>
                          renderEvent(event, n++, diverges, turn.id)
                        )}
                      </div>
                    ) : (
                      renderEvent(item.event, n++, false, turn.id)
                    )
                  )
                })()}
                <div className="observatory-turn-load">
                  <i
                    style={{
                      width: `${Math.min(100, (turn.tokens / Math.max(1, timeline.totalTokens)) * 100)}%`
                    }}
                  />
                </div>
              </section>
            ))}
          {!loading && authorityEvents.length > 0 && (
            <details
              className="observatory-authority-ledger"
              data-testid="observatory-authority-ledger"
              onClick={(event) => event.stopPropagation()}
            >
              <summary>
                <div>
                  <b>Ancienne autorité & mutations</b>
                  <small>
                    {authorityEvents.length} reçu{authorityEvents.length > 1 ? 's' : ''}
                  </small>
                </div>
                <span>Historique antérieur à la politique unique</span>
              </summary>
              <div>
                {authorityEvents.map((event) => {
                  const receipt = event.authority!
                  const decisionLabel =
                    receipt.decision === 'confirm'
                      ? 'confirmation'
                      : receipt.decision === 'allow'
                        ? 'autorisée'
                        : 'refusée'
                  const resolutionLabel =
                    receipt.resolution === 'approve'
                      ? 'approuvée'
                      : receipt.resolution === 'cancel'
                        ? 'annulée'
                        : receipt.decision === 'allow'
                          ? 'autorisée'
                          : receipt.decision === 'deny'
                            ? 'refusée'
                            : 'non résolue historiquement'
                  return (
                    <article key={event.id} data-decision={receipt.decision}>
                      <header>
                        <strong>{event.recipient ?? event.label ?? 'commande'}</strong>
                        <b>{resolutionLabel}</b>
                      </header>
                      <dl>
                        <div>
                          <dt>Mode</dt>
                          <dd>{receipt.mode}</dd>
                        </div>
                        <div>
                          <dt>Risque</dt>
                          <dd>{receipt.commandAuthority}</dd>
                        </div>
                        <div>
                          <dt>Mutation</dt>
                          <dd>{receipt.mutates ? 'oui' : 'non'}</dd>
                        </div>
                        <div>
                          <dt>Décision</dt>
                          <dd>{decisionLabel}</dd>
                        </div>
                        <div>
                          <dt>Arbitre</dt>
                          <dd>{receipt.resolvedBy ?? 'non applicable'}</dd>
                        </div>
                      </dl>
                    </article>
                  )
                })}
              </div>
            </details>
          )}
        </main>
      </div>
    </section>
  )
}
