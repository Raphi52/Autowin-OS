import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { langueCourante, formaterDate, formaterNombre } from '../langue'
import {
  useTextesObservatory,
  traduireObservatory,
  type CleObservatory
} from '../textes-ecrans/observatory'
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
import type { BrainInjectionInventory as BrainInjectionInventoryView } from '../../../main/activity/brain-injection-inventory'
import { summarizeRagTrace } from './rag-trace-model'
import { LatestRequestGate, settleObservatorySources } from './observatory-reliability'
import { buildObservatoryExport } from './observatory-export-model'
import { computeObservatoryTotals, formatObservatoryDuration } from './observatory-totals'
import { buildCausalPath, flattenCausalNodes } from './causal-path-model'
import type { ObservatoryFocus } from '../observatory-focus'
import { isReasoningEvent, layoutTurnEvents } from './observatory-turn-layout'
import { buildTimelineMarks, turnSpan, type TimelineMark } from './observatory-timeline-axis'
import { buildAgentGantt, type AgentGantt } from './observatory-agent-gantt'
import { DerouleRejouable } from './ObservatoryAgentGantt'
import { Spinner } from './Spinner'

const EMPTY: HarnessTimeline = { turns: [], anomalies: [], totalTokens: 0, totalCostUsd: 0 }
// Libellés : des CLÉS de la table de textes, traduites au rendu pour suivre la langue (conv-1170).
const LABEL: Record<HarnessTimelineEvent['kind'], CleObservatory> = {
  'response-displayed': 'vue.genre.reponseAffichee',
  artifact: 'vue.genre.artefact',
  message: 'vue.genre.message',
  injection: 'vue.genre.injection',
  decision: 'vue.genre.decision',
  'tool-call': 'vue.genre.outil',
  'tool-result': 'vue.genre.resultatOutil',
  'model-response': 'vue.genre.reponse',
  handoff: 'vue.genre.delegation',
  verdict: 'vue.genre.verdict',
  gate: 'vue.genre.controle',
  retry: 'vue.genre.retry',
  cancellation: 'vue.genre.annulation',
  error: 'vue.genre.erreur',
  boundary: 'vue.genre.options'
}
const ZONE_LABEL: Record<'sortant' | 'reponse' | 'sousagent', CleObservatory> = {
  sortant: 'vue.zone.sortant',
  reponse: 'vue.zone.reponse',
  sousagent: 'vue.zone.sousAgents'
}
const ZONE_HINT: Record<'sortant' | 'reponse' | 'sousagent', CleObservatory> = {
  sortant: 'vue.zone.sortant.aide',
  reponse: 'vue.zone.reponse.aide',
  sousagent: 'vue.zone.sousAgents.aide'
}
// La couverture des requêtes natives est une valeur du code (native-trace-summary.ts) : seul son
// affichage se traduit.
const COUVERTURE: Record<ReturnType<typeof summarizeNativeTraces>['coverage'], CleObservatory> = {
  aucune: 'vue.couverture.aucune',
  partielle: 'vue.couverture.partielle',
  rattachée: 'vue.couverture.rattachee',
  'non-rattachée': 'vue.couverture.nonRattachee'
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
  const { t, langue } = useTextesObservatory()
  const [conversations, setConversations] = useState<ConversationItem[]>([])
  const [conversationId, setConversationId] = useState('')
  const [timeline, setTimeline] = useState<HarnessTimeline>(EMPTY)
  const [promptCalls, setPromptCalls] = useState<PromptCall[]>([])
  const [selectedCall, setSelectedCall] = useState<PromptCall | null>(null)
  const [nativeMetadata, setNativeMetadata] = useState<NativeTraceSummaryInput[]>([])
  const [brainTraces, setBrainTraces] = useState<BrainTraceView[]>([])
  const [brainInventory, setBrainInventory] = useState<BrainInjectionInventoryView | null>(null)
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
  /** Résultat du dernier import de transcript — succès comme échec, sinon clic muet. */
  const [sessionImportNotice, setSessionImportNotice] = useState('')
  const [sessionImportPending, setSessionImportPending] = useState(false)
  const causalRequestGate = useRef(new LatestRequestGate())
  const promptRequestGate = useRef(new LatestRequestGate())
  const brainRequestGate = useRef(new LatestRequestGate())
  const inventoryRequestGate = useRef(new LatestRequestGate())
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
        for (const [source, message] of Object.entries(errors))
          next[source] = message ?? traduireObservatory('vue.erreur', langueCourante())
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

  /**
   * INVENTAIRE EXHAUSTIF des points d'appel Brain. Il ne dérive PAS des traces affichées : il vient
   * du registre du main, pour qu'un point d'injection JAMAIS appelé apparaisse quand même — à zéro.
   * Une chronologie ne peut pas dire « ce point n'a pas servi » ; cet inventaire le peut.
   */
  useEffect(() => {
    const request = inventoryRequestGate.current.begin()
    if (!active || !conversationId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBrainInventory(null)
      updateSourceError('brainInventory')
      return
    }
    void (window.api.brainInjectionInventory?.(conversationId) ?? Promise.resolve(null))
      .then((inventaire) => {
        if (!inventoryRequestGate.current.isCurrent(request)) return
        setBrainInventory(inventaire ?? null)
        updateSourceError('brainInventory')
      })
      .catch((error: unknown) => {
        if (!inventoryRequestGate.current.isCurrent(request)) return
        setBrainInventory(null)
        updateSourceError('brainInventory', error instanceof Error ? error.message : String(error))
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
  const observed = useMemo(() => computeObservatoryTotals(currentCalls), [currentCalls])
  const semanticComparison = useMemo(
    () => (compare.length === 2 ? compareObservatoryEvents(compare[0], compare[1], langue) : null),
    [compare, langue]
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
  /**
   * Déroulé par agent de chaque tour (conv-232). Calculé sur TOUS les événements du tour, pas sur la
   * vue filtrée : un filtre « Outils » ne doit pas faire disparaître la barre de l'agent qui les a
   * lancés. Seuil de deux lignes : un tour de simple conversation n'aurait qu'une barre, que la
   * liste dit déjà. Les OUTILS de l'orchestrateur ont leur ligne (conv-1105 : « observatory doit
   * ressembler au graph timeline des bilans de runs ») : un tour de chat qui a agi reçoit le même
   * graphe qu'un run, et non plus la seule liste.
   */
  const ganttByTurn = useMemo(() => {
    const byTurn = new Map<string, AgentGantt>()
    for (const turn of scopedTurns) {
      const gantt = buildAgentGantt(turn.events, { minLanes: 2, outils: true, langue })
      if (gantt) byTurn.set(turn.id, gantt)
    }
    return byTurn
  }, [scopedTurns, langue])
  const authorityEvents = useMemo(() => allEvents.filter((event) => event.authority), [allEvents])
  const decisionLedger = useMemo(
    () => buildObservatoryDecisionLedger(allEvents, langue),
    [allEvents, langue]
  )
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
          traduireObservatory('vue.sessionIllisible', langueCourante(), {
            chemin: session.path,
            raison: error instanceof Error ? error.message : String(error)
          })
        )
      })
  }

  function importActivitySession(session: ActivitySessionMeta): void {
    // fix-ok: cause mesurée des reprises — 1re version : clic MUET, le rejet IPC n'apparaissait
    // nulle part (test ux rouge : « Import impossible » absent du DOM) ; 2e rouge : état d'attente
    // sans <Spinner /> refusé par la garde spinner-partout → notice succès/échec + pending, vert.
    // Le libellé d'attente vit dans le JSX du rail, à côté du <Spinner /> (garde spinner-partout) :
    // ici on ne pose que l'état « en vol », jamais la chaîne.
    setSessionImportPending(true)
    setSessionImportNotice('')
    // Même exigence que les deux handlers voisins : un rejet SILENCIEUX = clic muet.
    void window.api
      .conversationsImportSession({ id: session.id, project: session.project })
      .then((result) => {
        setSessionImportNotice(
          traduireObservatory('vue.importee', langueCourante(), {
            titre: result.title,
            n: result.messageCount
          })
        )
      })
      .catch((error: unknown) => {
        setSessionImportNotice(
          traduireObservatory('vue.importImpossible', langueCourante(), {
            raison: error instanceof Error ? error.message : String(error)
          })
        )
      })
      .finally(() => {
        setSessionImportPending(false)
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
          traduireObservatory('vue.captureIllisible', langueCourante(), {
            chemin: path,
            raison: error instanceof Error ? error.message : String(error)
          })
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

  /**
   * Clic sur une barre du déroulé : ouvre l'événement dans la liste du tour et l'amène à l'écran.
   * Les filtres ne sont remis à zéro QUE si l'événement est masqué par eux — sinon le clic
   * effacerait sans raison un filtre que l'utilisateur vient de poser.
   */
  function focusGanttEvent(eventId: string): void {
    const event = allEvents.find((item) => item.id === eventId)
    if (!event) return
    const shown = visibleTurns.some((turn) => turn.events.some((item) => item.id === eventId))
    if (!shown) resetTimelineFilters()
    setSelectedCall(null)
    setSelected((current) => (current?.id === eventId ? null : event))
    // Deux trames : la première monte le détail, la seconde le trouve à sa place définitive.
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        document
          .querySelector(`[data-event-id="${eventId.replace(/"/g, '\\"')}"]`)
          ?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
      )
    )
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
          ? traduireObservatory('vue.cetExportContientUniquement', langueCourante())
          : traduireObservatory('vue.cetExportContientTrace', langueCourante()),
        traduireObservatory('vue.tracesGlobalesSansConversationid', langueCourante()),
        traduireObservatory('vue.payloadsExportesSontExact', langueCourante())
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
    turnId = '',
    mark?: TimelineMark
  ): React.JSX.Element => (
    <div key={event.id} className="observatory-event-wrap" data-event-id={event.id}>
      <ObservatoryRagCausalStep
        event={event}
        turnId={turnId}
        scopedTurns={scopedTurns}
        currentCalls={currentCalls}
        convBrainTraces={convBrainTraces}
      />
      {/* Ligne de FRISE : l'heure et l'écart vivent dans la gouttière de gauche, sur l'axe du tour,
          hors du bouton — son contenu et ses sélecteurs (`span:nth-child(2)`) restent intacts. */}
      <div className="observatory-event-row" data-kind={event.kind}>
        <time
          className="observatory-event-when"
          data-testid="observatory-event-when"
          data-pause={mark?.pause ? 'true' : undefined}
          dateTime={mark?.clock ? event.timestamp : undefined}
          title={
            mark?.clock
              ? `${formaterDate(event.timestamp!)}${mark.delta ? t('vue.depuisPrecedent', { delta: mark.delta }) : ''}`
              : t('vue.horodatageAbsentTrace')
          }
        >
          <b>{mark?.clock ?? '—'}</b>
          {mark?.delta && <small>{mark.delta}</small>}
        </time>
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
            <b>{isReasoningEvent(event) ? t('vue.raisonnementModele') : t(LABEL[event.kind])}</b>
            {diverges && <em className="observatory-diverge-badge">{t('vue.divergeant')}</em>}
            <small>{event.actor}</small>
          </span>
          <p>
            <strong>
              {event.content
                ? humanEventPreview(event.kind, event.content, 140)
                : t('vue.aucunContenuObservable')}
            </strong>
            <small>
              {event.provider
                ? `${event.provider}${event.model ? ` · ${event.model}` : ''}`
                : event.detail}
            </small>
          </p>
          <span className="observatory-load">
            {event.inputTokens != null && <b>{formaterNombre(event.inputTokens)} in</b>}
            {event.cacheReadTokens != null && (
              <small>{formaterNombre(event.cacheReadTokens)} cache</small>
            )}
            {event.outputTokens != null && <small>{formaterNombre(event.outputTokens)} out</small>}
            {event.costUsd != null && <small>${event.costUsd.toFixed(4)}</small>}
            {event.durationMs != null && <small>{Math.round(event.durationMs)} ms</small>}
            {event.inputTokens == null && event.outputTokens == null && (
              <small>{t('vue.caracteres', { n: formaterNombre(event.content.length) })}</small>
            )}
          </span>
        </button>
      </div>
      {selected?.id === event.id && (
        <article className="observatory-event-detail" onClick={(click) => click.stopPropagation()}>
          <header>
            <div>
              <b>{t('vue.payloadExact')}</b>
              <small>
                {event.channel} · {event.injector ?? event.actor} →{' '}
                {event.recipient ?? t('vue.nonExpose')}
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
              {compare.some((item) => item.id === event.id)
                ? t('vue.retirerDiff')
                : t('vue.comparer')}
            </button>
          </header>
          {/* `event.content` = concaténation des payloads (harness-timeline-model). Redondant dès
              qu'il y a des blocs → on ne l'affiche qu'en FALLBACK (aucun bloc), sinon on montre
              uniquement les blocs décomposés + nommés ci-dessous. */}
          {event.payloads.length === 0 && <PayloadContent content={event.content} />}
          <p>{event.detail}</p>
          {event.payloads.length > 0 && (
            <section className="observatory-payload-list">
              <b>{t('vue.blocs', { n: event.payloads.length })}</b>
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
          eyebrow={t('vue.tracabiliteConversations')}
          title="Observatory"
          description={t('vue.suisAppelsCoutsDurees')}
        />
        <div className="observatory-metrics">
          <strong data-metric="calls">
            {formaterNombre(currentCalls.length)}
            <small>{t('vue.appelsConversation')}</small>
          </strong>
          <strong data-metric="input">
            {formaterNombre(observed.input)}
            <small>tokens in</small>
          </strong>
          <strong data-metric="cache">
            {formaterNombre(observed.cache)}
            <small>{t('vue.cacheLu')}</small>
          </strong>
          {observed.cost === 0 && observed.input + observed.output > 0 ? (
            // Des tokens sans prix ne prouvent ni une gratuite ni un abonnement : le fournisseur
            // peut simplement ne pas exposer la tarification dans son retour d'usage.
            <strong data-metric="cost" title={t('vue.prixNonExposeFournisseur')}>
              {t('vue.nonExpose')}
              <small>{t('vue.coutInconnu')}</small>
            </strong>
          ) : (
            <strong data-metric="cost">
              ${observed.cost.toFixed(3)}
              <small>{t('vue.cout')}</small>
            </strong>
          )}
          <strong data-metric="output">
            {formaterNombre(observed.output)}
            <small>tokens out</small>
          </strong>
          {/* DURÉE : 0 avec des appels ne veut pas dire « instantané » — le fournisseur peut ne pas
              l'exposer. Même traitement que le coût : on le DIT au lieu d'afficher un faux zéro. */}
          <strong data-metric="duration" title={t('vue.sommeDureesMesureesAppels')}>
            {observed.durationMs > 0 ? (
              <>
                {formatObservatoryDuration(observed.durationMs)}
                <small>{t('vue.dureeCumulee')}</small>
              </>
            ) : (
              <>
                {t('vue.nonExpose')}
                <small>{t('vue.dureeInconnue')}</small>
              </>
            )}
          </strong>
          <strong data-metric="errors" title={t('vue.appelsModeleTerminesEchec')}>
            {formaterNombre(observed.errors)}
            <small>{t('vue.erreurs')}</small>
          </strong>
          <strong data-metric="actions" title={t('vue.actionsReellesExecuteesSous')}>
            {formaterNombre(allEvents.filter((event) => event.kind === 'tool-call').length)}
            <small>{t('vue.actionsReelles')}</small>
          </strong>
          {hasNativeTraces && (
            <strong data-metric="native">
              {formaterNombre(nativeSummary.count)}
              <small>
                {t('vue.requetes', { couverture: t(COUVERTURE[nativeSummary.coverage]) })}
              </small>
            </strong>
          )}
        </div>
      </header>
      <div className="observatory-toolbar">
        <div className="observatory-toolbar__scope" data-toolbar-zone="scope">
          <span data-testid="observatory-result-count">
            <strong>
              {formaterNombre(
                viewMode === 'timeline' ? visibleEventCount : visibleCausalNodes.length
              )}
            </strong>
            {' / '}
            {formaterNombre(viewMode === 'timeline' ? allEvents.length : causalNodes.length)}{' '}
            {viewMode === 'timeline' ? t('vue.evenements') : t('vue.etapes')}
          </span>
          <small
            data-testid="observatory-freshness"
            data-refreshed-at={lastRefreshedAt ?? ''}
            data-refresh-status={
              lastRefreshedAt ? (Object.keys(sourceErrors).length ? 'partial' : 'complete') : 'idle'
            }
          >
            {lastRefreshedAt
              ? Object.keys(sourceErrors).length
                ? t('vue.actualisationPartielle', {
                    heure: formaterDate(lastRefreshedAt, { timeStyle: 'medium' })
                  })
                : t('vue.actualise', {
                    heure: formaterDate(lastRefreshedAt, { timeStyle: 'medium' })
                  })
              : t('vue.attenteDonnees')}
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
          <div
            className="observatory-view-switch"
            role="group"
            aria-label={t('vue.modeVisualisation')}
          >
            <button
              className={viewMode === 'timeline' ? 'is-active' : ''}
              aria-pressed={viewMode === 'timeline'}
              onClick={() => setViewMode('timeline')}
            >
              {t('vue.chronologie')}
            </button>
            <button
              className={viewMode === 'causal' ? 'is-active' : ''}
              aria-pressed={viewMode === 'causal'}
              onClick={() => setViewMode('causal')}
            >
              {t('vue.cheminCritique')}
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
              {t(compare.length > 1 ? 'vue.selection.pluriel' : 'vue.selection', {
                n: compare.length
              })}
            </b>
            <small>{t('vue.shiftClicDeuxEvenements')}</small>
          </span>

          {viewMode === 'timeline' ? (
            <div className="observatory-toolbar__timeline" data-testid="timeline-controls">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('vue.rechercherActeurModeleContenu')}
                aria-label={t('vue.rechercherChronologie')}
              />
              <div className="observatory-quick-filters" aria-label={t('vue.filtresRapides')}>
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
                <summary>
                  {t('vue.filtres')}
                  {activeFilterCount ? ` · ${activeFilterCount}` : ''}
                </summary>
                <div>
                  <select
                    value={typeFilter}
                    onChange={(event) => setTypeFilter(event.target.value)}
                    aria-label="Type"
                  >
                    <option value="all">{t('vue.tousTypes')}</option>
                    {typeOptions.map((type) => (
                      <option key={type} value={type}>
                        {t(LABEL[type])}
                      </option>
                    ))}
                  </select>
                  <select
                    value={providerFilter}
                    onChange={(event) => setProviderFilter(event.target.value)}
                    aria-label="Provider"
                  >
                    <option value="all">{t('vue.tousProviders')}</option>
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
                {t('vue.reinitialiser')}
              </button>
            </div>
          ) : (
            <div className="observatory-causal-controls" data-testid="causal-controls">
              {(
                [
                  ['all', t('vue.tousLiens')],
                  ['critical', t('vue.critiqueSeul')],
                  ['signals', t('vue.signaux')]
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
                {t('vue.reinitialiser')}
                {causalFilterCount ? ` · ${causalFilterCount}` : ''}
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
            {refreshing ? t('vue.actualisation') : t('vue.actualiser')}
          </button>
          <details>
            <summary>Actions</summary>
            <div>
              <button
                type="button"
                onClick={() => onOpenCapabilities?.()}
                title={t('vue.editerCapacitesInjecteesPrompt')}
              >
                {t('vue.capacitesPrompt')}
              </button>
              <button
                type="button"
                disabled={!conversationId}
                onClick={() => void exportTrace('view')}
              >
                {t('vue.exporterVue')}
              </button>
              <button
                type="button"
                disabled={!conversationId}
                onClick={() => void exportTrace('full')}
              >
                {t('vue.exporterTouteTrace')}
              </button>
            </div>
          </details>
        </div>
      </div>
      {turnFocus && (
        <aside className="observatory-turn-focus" role="status">
          <span>
            {focusUnavailable === 'conversation'
              ? t('vue.conversationCibleeIntrouvable')
              : focusUnavailable === 'source'
                ? t('vue.conversationCibleeIndisponible')
                : focusUnavailable === 'turn'
                  ? t('vue.tourIntrouvable', { tour: turnFocus.turnId })
                  : causalTracePartial
                    ? t('vue.tourCiblePartiel', { tour: turnFocus.turnId })
                    : t('vue.tourCible', { tour: turnFocus.turnId })}
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
            {t('vue.touteConversation')}
          </button>
        </aside>
      )}
      {Object.keys(sourceErrors).length > 0 && (
        <aside className="observatory-source-errors" role="alert">
          <div>
            <strong>{t('vue.certainesSourcesTelemetrieSont')}</strong>
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
            {t('vue.reessayer')}
          </button>
        </aside>
      )}
      {conversationId && semanticTimeline && (
        <aside className="observatory-semantic-timeline" data-testid="semantic-timeline-summary">
          <strong>{t('vue.memoireTemporelleReconstruite')}</strong>
          <small>
            {t('vue.memoire.compte', {
              noeuds: semanticTimeline.nodes.length,
              sNoeuds: semanticTimeline.nodes.length > 1 ? 's' : '',
              liens: semanticTimeline.edges.length,
              sLiens: semanticTimeline.edges.length > 1 ? 's' : ''
            })}
          </small>
        </aside>
      )}
      {brainInventory && (
        <details
          className="observatory-native-diagnostics observatory-brain-inventory"
          data-testid="brain-injection-inventory"
        >
          <summary>
            {t('vue.inventaire.resume', {
              appeles: brainInventory.points.filter((point) => point.appelsTotal > 0).length,
              total: brainInventory.points.length
            })}
          </summary>
          <p>
            {t('vue.registre.avant')} <code>brain-injection-points.ts</code>{' '}
            {t('vue.registre.apres')}
          </p>
          <table>
            <thead>
              <tr>
                <th>{t('vue.pointAppel')}</th>
                <th>{t('vue.nature')}</th>
                <th>{t('vue.cetteConversation')}</th>
                <th>{t('vue.totalTrace')}</th>
              </tr>
            </thead>
            <tbody>
              {brainInventory.points.map((point) => (
                <tr
                  key={point.id}
                  data-testid="brain-injection-point"
                  data-point={point.id}
                  data-appels={point.appelsConversation}
                >
                  <td>
                    <strong>{point.label}</strong>
                    <small>{point.pourquoi}</small>
                  </td>
                  <td>
                    {point.injecte ? t('vue.injectePrompt') : t('vue.appelSansInjection')}
                    {point.emission === 'porte-par-appelant' ? t('vue.traceAppelants') : ''}
                  </td>
                  <td>
                    {point.appelsConversation === 0
                      ? t('vue.aucunAppel')
                      : t('vue.appelsInjectes', {
                          n: point.appelsConversation,
                          s: point.appelsConversation > 1 ? 's' : '',
                          caracteres: formaterNombre(point.caracteresConversation)
                        })}
                  </td>
                  <td>{point.appelsTotal}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {brainInventory.tracesNonRattachees > 0 && (
            <p data-testid="brain-inventory-orphelines">
              {t('vue.inventaire.orphelines', {
                n: brainInventory.tracesNonRattachees,
                s: brainInventory.tracesNonRattachees > 1 ? 's' : ''
              })}
            </p>
          )}
        </details>
      )}
      {legacyBrainTraces.length > 0 && (
        <details className="observatory-native-diagnostics">
          <summary>
            {t('vue.anciennesTraces', {
              n: legacyBrainTraces.length,
              s: legacyBrainTraces.length > 1 ? 's' : ''
            })}
          </summary>
          <p>{t('vue.cesTracesHistoriquesN')}</p>
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
            {t('vue.payloadsBruts', {
              n: unlinkedNativeTraces.length,
              s: unlinkedNativeTraces.length > 1 ? 's' : ''
            })}
          </summary>
          <p>{t('vue.cesRequetesSontAttribuees')}</p>
          <div>
            {[...unlinkedNativeTraces]
              .reverse()
              .slice(0, 20)
              .map((trace) => (
                <details key={trace.apiRequestId}>
                  <summary>
                    {t('vue.traceNative', {
                      date: formaterDate(trace.timestamp),
                      provider: trace.provider,
                      modele: trace.model,
                      messages: trace.messageCount,
                      outils: trace.toolCount
                    })}
                  </summary>
                  <RagTraceCard request={trace.request} />
                  <details className="observatory-rag-payload">
                    <summary>{t('vue.payloadExactExactRedacted')}</summary>
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
          onImportSession={importActivitySession}
          sessionImportNotice={sessionImportNotice}
          sessionImportPending={sessionImportPending}
          activityImage={activityImage}
          onOpenImage={openActivityImage}
          runs={runs}
          runsLoading={loadingRuns}
          // Révéler le fichier plutôt qu'en afficher un aperçu : un RUN.md se lit et s'ÉDITE, et
          // Observatory n'est pas un éditeur. `showItemInFolder` côté main fait le reste.
          onOpenRun={(path) => void window.api.openFolder?.(path)}
          onOpenRunConversation={(id) => setConversationId(id)}
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
              <Spinner /> {t('vue.lectureTraces')}
            </div>
          )}
          {/* Trois CAUSES distinctes derriere un flux vide : aucune conversation, aucune trace, ou
              filtre trop strict. Un message unique laissait l'utilisateur sans action suivante. */}
          {!loading &&
            viewMode === 'timeline' &&
            visibleTurns.length === 0 &&
            (!conversationId ? (
              <div className="observatory-empty" data-testid="observatory-empty-no-conversation">
                {t('vue.aucuneConversationObserverSelectionnez')}
              </div>
            ) : allEvents.length === 0 ? (
              <div className="observatory-empty" data-testid="observatory-empty-no-trace">
                {t('vue.cetteConversationNAucune')}
              </div>
            ) : (
              <div className="observatory-empty" data-testid="observatory-empty-filtered">
                <span>
                  {t('vue.aucunEvenementFiltre', { n: formaterNombre(allEvents.length) })}
                </span>
                <button type="button" onClick={resetTimelineFilters}>
                  {t('vue.reinitialiserFiltres')}
                </button>
              </div>
            ))}
          {!loading && viewMode === 'causal' && causalNodes.length === 0 && (
            <div className="observatory-empty">{t('vue.aucunLienCausalObservable')}</div>
          )}
          {!loading &&
            viewMode === 'causal' &&
            causalNodes.length > 0 &&
            visibleCausalNodes.length === 0 && (
              <div className="observatory-empty" data-testid="observatory-empty-causal-filtered">
                <span>{t('vue.aucuneEtapeFiltre', { n: formaterNombre(causalNodes.length) })}</span>
                <button type="button" onClick={() => setCausalScope('all')}>
                  {t('vue.voirTousLiens')}
                </button>
              </div>
            )}
          {!loading && viewMode === 'causal' && visibleCausalNodes.length > 0 && (
            <section className="observatory-causal-path" aria-label={t('vue.cheminCausalCritique')}>
              <header>
                <div>
                  <b>{t('vue.cheminCausalCritique')}</b>
                  <small>
                    {t('vue.cheminCritique.resume', {
                      n: causalPath.criticalPathIds.length,
                      s: causalPath.criticalPathIds.length > 1 ? 's' : '',
                      goulot: causalPath.bottleneckId
                        ? (causalPath.byId.get(causalPath.bottleneckId)?.event.label ?? '')
                        : t('vue.nonCalculable')
                    })}
                  </small>
                </div>
                <span>{t('vue.inclusifExclusif')}</span>
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
                            ? t('vue.exclusifInconnu')
                            : t('vue.msPropre', { n: Math.round(node.exclusiveDurationMs) })}
                        </small>
                      </span>
                      {node.issues.length > 0 && <em>{node.issues.join(' · ')}</em>}
                      {node.event.kind === 'injection' &&
                        summarizeRagTrace({ system: node.event.content }).status === 'injected' && (
                          <em className="observatory-rag-node-badge">{t('vue.ragInjecte')}</em>
                        )}
                    </button>
                    {selected?.id === node.id && (
                      <article
                        className="observatory-causal-detail"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <header>
                          <div>
                            <b>{t('vue.payloadExactDe', { etiquette: node.event.label })}</b>
                            <small>
                              {node.event.channel} · {node.event.injector ?? node.event.actor} →{' '}
                              {node.event.recipient ?? t('vue.nonExpose')}
                            </small>
                          </div>
                          <button onClick={() => setSelected(null)}>{t('vue.fermer')}</button>
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
                  <b>{t('vue.comparaisonCausaleB')}</b>
                  <small>
                    {t('vue.changements', {
                      n: semanticComparison.changed,
                      s: semanticComparison.changed > 1 ? 's' : ''
                    })}
                  </small>
                </div>
                <button
                  onClick={(event) => {
                    event.stopPropagation()
                    setCompare([])
                  }}
                >
                  {t('vue.fermer')}
                </button>
              </header>
              <table>
                <thead>
                  <tr>
                    <th>{t('vue.champ')}</th>
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
                  <b>{t('vue.decisionsPreuves')}</b>
                  <small>
                    {t(
                      decisionLedger.filter((entry) => entry.status === 'open').length > 1
                        ? 'vue.ouvertes'
                        : 'vue.ouverte',
                      { n: decisionLedger.filter((entry) => entry.status === 'open').length }
                    )}
                  </small>
                </div>
                <span>{t('vue.hypotheseSignalObservationVerdict')}</span>
              </summary>
              <div>
                {decisionLedger.map((entry) => (
                  <article key={entry.decisionId} data-status={entry.status}>
                    <header>
                      <strong>{entry.hypothesis}</strong>
                      <b>{entry.status === 'open' ? t('vue.etatOuverte') : t('vue.cloturee')}</b>
                    </header>
                    <dl>
                      <div>
                        <dt>{t('vue.signalAttendu')}</dt>
                        <dd>{entry.expectedSignal ?? t('vue.nonDeclare')}</dd>
                      </div>
                      <div>
                        <dt>Observation</dt>
                        <dd>{entry.observation ?? t('vue.nonObservee')}</dd>
                      </div>
                      <div>
                        <dt>Gate</dt>
                        <dd>{entry.gate ?? t('vue.nonPasse')}</dd>
                      </div>
                      <div>
                        <dt>Verdict</dt>
                        <dd>{entry.verdict ?? t('vue.attente')}</dd>
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
                    <span>{t('vue.tourNumero', { n: timeline.turns.length - turnIndex })}</span>
                    <time>{formaterDate(turn.ts)}</time>
                    {turnSpan(turn.events) && (
                      <small
                        className="observatory-turn-span"
                        data-testid="observatory-turn-span"
                        title={t('vue.dureeCouverteEvenementsAffiches')}
                      >
                        {t('vue.surDuree', { duree: turnSpan(turn.events) ?? '' })}
                      </small>
                    )}
                  </div>
                  <small>
                    {formaterNombre(turn.tokens)} tokens ·{' '}
                    {turn.costUsd
                      ? `$${turn.costUsd.toFixed(4)}`
                      : `${formaterNombre(turn.inputTokens)} in · ${formaterNombre(turn.outputTokens)} out`}
                  </small>
                </header>
                {ganttByTurn.get(turn.id) && (
                  <DerouleRejouable
                    libelle={t('vue.rejouerTour')}
                    gantt={ganttByTurn.get(turn.id)!}
                    selectedId={selected?.id}
                    onSelect={focusGanttEvent}
                  />
                )}
                {(() => {
                  let n = 0
                  const items = layoutTurnEvents(turn.events)
                  // Les écarts se mesurent dans l'ORDRE AFFICHÉ (réponse dédupliquée comprise) : la
                  // frise dit « +2,4 s depuis la ligne au-dessus », pas depuis un événement masqué.
                  const marks = buildTimelineMarks(
                    items.flatMap((item) =>
                      item.type === 'group' ? item.events.map(({ event }) => event) : [item.event]
                    )
                  )
                  return items.map((item, itemIndex) =>
                    item.type === 'group' ? (
                      <div
                        key={`${item.zone}:${turn.id}:${itemIndex}`}
                        className={`observatory-group is-${item.zone}`}
                      >
                        <div className="observatory-group-head">
                          <b>{t(ZONE_LABEL[item.zone])}</b>
                          <small>{t(ZONE_HINT[item.zone])}</small>
                        </div>
                        {item.events.map(({ event, diverges }) =>
                          renderEvent(event, n++, diverges, turn.id, marks.get(event.id))
                        )}
                      </div>
                    ) : (
                      renderEvent(item.event, n++, false, turn.id, marks.get(item.event.id))
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
                  <b>{t('vue.ancienneAutoriteMutations')}</b>
                  <small>
                    {t('vue.recus', {
                      n: authorityEvents.length,
                      s: authorityEvents.length > 1 ? 's' : ''
                    })}
                  </small>
                </div>
                <span>{t('vue.historiqueAnterieurPolitiqueUnique')}</span>
              </summary>
              <div>
                {authorityEvents.map((event) => {
                  const receipt = event.authority!
                  const decisionLabel =
                    receipt.decision === 'confirm'
                      ? 'confirmation'
                      : receipt.decision === 'allow'
                        ? t('vue.autorisee')
                        : t('vue.refusee')
                  const resolutionLabel =
                    receipt.resolution === 'approve'
                      ? t('vue.approuvee')
                      : receipt.resolution === 'cancel'
                        ? t('vue.annulee')
                        : receipt.decision === 'allow'
                          ? t('vue.autorisee')
                          : receipt.decision === 'deny'
                            ? t('vue.refusee')
                            : t('vue.nonResolueHistoriquement')
                  return (
                    <article key={event.id} data-decision={receipt.decision}>
                      <header>
                        <strong>{event.recipient ?? event.label ?? t('vue.commande')}</strong>
                        <b>{resolutionLabel}</b>
                      </header>
                      <dl>
                        <div>
                          <dt>Mode</dt>
                          <dd>{receipt.mode}</dd>
                        </div>
                        <div>
                          <dt>{t('vue.risque')}</dt>
                          <dd>{receipt.commandAuthority}</dd>
                        </div>
                        <div>
                          <dt>Mutation</dt>
                          <dd>{receipt.mutates ? t('vue.oui') : t('vue.non')}</dd>
                        </div>
                        <div>
                          <dt>{t('vue.decision')}</dt>
                          <dd>{decisionLabel}</dd>
                        </div>
                        <div>
                          <dt>{t('vue.arbitre')}</dt>
                          <dd>{receipt.resolvedBy ?? t('vue.nonApplicable')}</dd>
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
