import { useEffect, useMemo, useRef, useState } from 'react'
import {
  buildHarnessTimelineFromTrace,
  type HarnessTraceEvent,
  type HarnessTimelineEvent,
  type HarnessTimeline
} from './harness-timeline-model'
import { HumanJson } from './HumanJson'
import { BrainMarkdown } from './BrainMarkdown'
import { summarizeNativeTraces, type NativeTraceSummaryInput } from './native-trace-summary'
import './ObservatoryView.css'
import { ModuleHeader } from './ModuleHeader'
import { RagTraceCard } from './RagTraceCard'
import { BrainNavigationCard, type BrainTraceView } from './BrainNavigationCard'
import { summarizeRagTrace } from './rag-trace-model'
import { LatestRequestGate, settleObservatorySources } from './observatory-reliability'
import { buildObservatoryExport } from './observatory-export-model'
import { buildCausalPath, flattenCausalNodes } from './causal-path-model'
import type { ObservatoryFocus } from '../observatory-focus'
import { layoutTurnEvents } from './observatory-turn-layout'

interface ConversationItem {
  id: string
  title: string
  provider: string
  updatedAt: number
}
interface PromptCall {
  id: string
  ts: string
  conversationId: string
  turnId: string
  provider: string
  model?: string
  boundary: string
  limitation: string
  system?: string
  messages: Array<{ role: string; content: string }>
  options: Record<string, unknown>
  response: string
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; costUsd?: number }
}
interface NativeDiagnosticTrace extends NativeTraceSummaryInput {
  apiRequestId: string
  messageCount: number
  toolCount: number
  request: Record<string, unknown>
  fidelity: 'exact-redacted'
}
const EMPTY: HarnessTimeline = { turns: [], anomalies: [], totalTokens: 0, totalCostUsd: 0 }
const LABEL: Record<HarnessTimelineEvent['kind'], string> = {
  'response-displayed': 'Réponse affichée',
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
type QuickFilter = 'all' | 'errors' | 'tools' | 'prompt' | 'agents'
type CausalScope = 'all' | 'critical' | 'signals'

const QUICK_FILTERS: Array<{ value: QuickFilter; label: string }> = [
  { value: 'errors', label: 'Erreurs' },
  { value: 'tools', label: 'Outils' },
  { value: 'prompt', label: 'Prompt / RAG' },
  { value: 'agents', label: 'Sous-agents' }
]

function matchesQuickFilter(event: HarnessTimelineEvent, filter: QuickFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'errors') return ['error', 'retry', 'cancellation'].includes(event.kind)
  if (filter === 'tools') return ['tool-call', 'tool-result'].includes(event.kind)
  if (filter === 'prompt') return ['injection', 'boundary'].includes(event.kind)
  return ['handoff', 'verdict'].includes(event.kind)
}

function eventTurnId(event: HarnessTimelineEvent): string {
  if (!event.raw || typeof event.raw !== 'object') return ''
  const turnId = (event.raw as { turnId?: unknown }).turnId
  return typeof turnId === 'string' ? turnId : ''
}

/** Sépare un préfixe libellé ("ÉTAT DE L'APP: {…}") du JSON qui suit, si le JSON parse. */
function splitLabeledJson(content: string): { prefix: string; json: string } | null {
  const start = content.search(/[{[]/)
  if (start < 0) return null
  const json = content.slice(start).trim()
  try {
    JSON.parse(json)
  } catch {
    return null
  }
  return { prefix: content.slice(0, start).trim(), json }
}

/**
 * Extrait le message HUMAIN d'un contenu composé ("ÉTAT DE L'APP:\n{json}\n\nUTILISATEUR: …").
 * Prend le dernier segment "UTILISATEUR:" ; sinon un contenu normal est rendu tel quel ;
 * un pur blob d'état retombe sur un libellé court.
 */
function extractHumanMessage(content: string, max = 100): string {
  const segments = (content ?? '').split('\n\n')
  const utilisateur = segments.filter((s) => /^\s*UTILISATEUR\s*:/.test(s))
  let human: string
  if (utilisateur.length) {
    human = utilisateur[utilisateur.length - 1].replace(/^\s*UTILISATEUR\s*:\s*/, '')
  } else if (/^\s*(ÉTAT|ETAT)\b/.test(content ?? '')) {
    human =
      segments.find((s) => {
        const t = s.trim()
        return t && !/^(ÉTAT|ETAT|TOI\s*:|\()/.test(t) && !t.startsWith('{')
      }) ?? '(état de l’app)'
  } else {
    human = content ?? ''
  }
  const text = human.replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** Tente de parser le contenu JSON d'un événement ; null si ce n'est pas du JSON objet. */
function parseEventJson(content: string): Record<string, unknown> | null {
  const trimmed = (content ?? '').trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const value = JSON.parse(trimmed)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

/** Aperçu HUMAIN d'un événement selon son type (retry/frontière lisibles ; sinon message ou brut). */
function humanEventPreview(kind: string, content: string, max = 140): string {
  const data = parseEventJson(content)
  if (kind === 'retry' && data) {
    const attempt = Number(data.attempt ?? data.attemptNumber ?? 0)
    const maxAttempts = Number(data.maxAttempts ?? data.max ?? 0)
    const reason = typeof data.reason === 'string' ? ` — ${data.reason}` : ''
    if (attempt && maxAttempts)
      return `Nouvel essai · tentative ${attempt} sur ${maxAttempts}${reason}`
    return `Nouvel essai${reason}`
  }
  if (kind === 'boundary' && data) {
    const parts: string[] = []
    if ('stream' in data) parts.push(data.stream ? 'streaming' : 'sans streaming')
    if (typeof data.reasoningEffort === 'string')
      parts.push(
        data.reasoningEffort === 'none' ? 'effort par défaut' : `effort ${data.reasoningEffort}`
      )
    if ('resumed' in data) parts.push(data.resumed ? 'session réutilisée' : 'nouvelle session')
    if (typeof data.model === 'string') parts.push(`modèle ${data.model}`)
    // Clés restantes non couvertes, pour ne rien cacher.
    for (const [k, v] of Object.entries(data)) {
      if (['stream', 'reasoningEffort', 'resumed', 'model'].includes(k)) continue
      if (v != null && typeof v !== 'object') parts.push(`${k} : ${v}`)
    }
    if (parts.length) {
      const text = `Passage au provider · ${parts.join(' · ')}`
      return text.length > max ? `${text.slice(0, max)}…` : text
    }
  }
  if (kind === 'cancellation' && data) {
    const reason = typeof data.reason === 'string' ? data.reason : ''
    if (reason === 'user') return 'Annulé par l’utilisateur'
    return reason ? `Annulé — ${reason}` : 'Annulé'
  }
  // Filet générique : tout objet JSON restant → « clé : valeur · … » (jamais de JSON brut).
  if (data) {
    const pairs = Object.entries(data)
      .filter(([, v]) => v != null && typeof v !== 'object')
      .map(([k, v]) => `${k} : ${v}`)
    if (pairs.length) {
      const text = pairs.join(' · ')
      return text.length > max ? `${text.slice(0, max)}…` : text
    }
  }
  return extractHumanMessage(content, max)
}

/** Aperçu du dernier message humain d'un appel (liste + détail). */
function lastUserMessagePreview(
  messages: Array<{ role: string; content: string }>,
  max = 100
): string {
  const userMsg = [...messages].reverse().find((m) => m.role === 'user')
  return userMsg ? extractHumanMessage(userMsg.content, max) : ''
}

/** Refuse les enveloppes provider : elles ne constituent pas une action humaine observable. */
function trustworthyRagTrigger(content: string, max = 180): string {
  const trimmed = content.trim()
  if (
    !trimmed ||
    trimmed.length > 500 ||
    /^[{[]/.test(trimmed) ||
    /"(?:instructions|messages|model)"\s*:/.test(trimmed)
  ) {
    return ''
  }
  return extractHumanMessage(trimmed, max)
}

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
  onOpenCapabilities
}: {
  active: boolean
  focus?: ObservatoryFocus | null
  onOpenCapabilities?: () => void
}): React.JSX.Element {
  const [conversations, setConversations] = useState<ConversationItem[]>([])
  const [conversationId, setConversationId] = useState('')
  const [timeline, setTimeline] = useState<HarnessTimeline>(EMPTY)
  const [promptCalls, setPromptCalls] = useState<PromptCall[]>([])
  const [selectedCall, setSelectedCall] = useState<PromptCall | null>(null)
  const [nativeTraces, setNativeTraces] = useState<NativeDiagnosticTrace[]>([])
  const [nativeMetadata, setNativeMetadata] = useState<NativeTraceSummaryInput[]>([])
  const [brainTraces, setBrainTraces] = useState<BrainTraceView[]>([])
  const [selected, setSelected] = useState<HarnessTimelineEvent | null>(null)
  const [compare, setCompare] = useState<HarnessTimelineEvent[]>([])
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [providerFilter, setProviderFilter] = useState('all')
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all')
  const [causalScope, setCausalScope] = useState<CausalScope>('all')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number>()
  const [refreshKey, setRefreshKey] = useState(0)
  const [viewMode, setViewMode] = useState<'timeline' | 'causal'>('timeline')
  const [sourceErrors, setSourceErrors] = useState<Record<string, string>>({})
  const [turnFocus, setTurnFocus] = useState<ObservatoryFocus | null>(null)
  const [focusUnavailable, setFocusUnavailable] = useState<
    'conversation' | 'turn' | 'source' | null
  >(null)
  const [causalTracePartial, setCausalTracePartial] = useState(false)
  const causalRequestGate = useRef(new LatestRequestGate())
  const refreshStartedAt = useRef(0)

  function updateSourceError(source: string, message?: string): void {
    setSourceErrors((current) => {
      const next = { ...current }
      if (message) next[source] = message
      else delete next[source]
      return next
    })
  }

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
    void window.api
      .brainTraces?.()
      ?.then((t) => {
        if (!disposed) setBrainTraces(t as BrainTraceView[])
      })
      ?.catch(() => undefined)
    void settleObservatorySources({
      conversations: window.api.conversations(),
      promptCalls: window.api.promptCalls(),
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
      if (values.promptCalls) setPromptCalls(values.promptCalls as PromptCall[])
      if (values.native) setNativeMetadata(values.native as NativeTraceSummaryInput[])
      setSourceErrors((current) => {
        const next = { ...current }
        for (const source of ['conversations', 'promptCalls', 'native']) delete next[source]
        for (const [source, message] of Object.entries(errors)) next[source] = message ?? 'Erreur'
        return next
      })
      if (focus && errors.conversations) setFocusUnavailable('source')
    })
    return () => {
      disposed = true
    }
  }, [active, refreshKey, focus])

  useEffect(() => {
    if (!active) return
    let disposed = false
    void window.api
      .authorizeDiagnostics()
      .then((capability) =>
        capability ? window.api.promptTracesGlobal(capability) : Promise.resolve([])
      )
      .then((traces) => {
        if (!disposed) {
          setNativeTraces(traces as NativeDiagnosticTrace[])
          updateSourceError('nativeDetails')
        }
      })
      .catch((error: unknown) => {
        if (!disposed)
          updateSourceError('nativeDetails', error instanceof Error ? error.message : String(error))
      })
    return () => {
      disposed = true
    }
  }, [active, refreshKey])

  useEffect(() => {
    if (!active || !conversationId) {
      causalRequestGate.current.begin()
      // Évite d'afficher la timeline de la conversation précédente hors contexte.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTimeline(EMPTY)
      setSelected(null)
      setSelectedCall(null)
      setCompare([])
      setLoading(false)
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
  }, [active, conversationId, refreshKey, turnFocus])

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
  const unlinkedNativeTraces = nativeTraces.filter(
    (trace) => !trace.conversationId || !trace.turnId || trace.turnId === 'unknown'
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
  const visibleEventCount = visibleTurns.reduce((sum, turn) => sum + turn.events.length, 0)
  const activeFilterCount =
    Number(Boolean(needle)) +
    Number(typeFilter !== 'all') +
    Number(providerFilter !== 'all') +
    Number(quickFilter !== 'all')
  const visibleCausalNodes = causalNodes.filter((node) => {
    if (causalScope === 'critical') return node.onCriticalPath
    if (causalScope === 'signals')
      return node.isBottleneck || node.issues.length > 0 || node.event.kind === 'error'
    return true
  })

  function resetTimelineFilters(): void {
    setQuery('')
    setTypeFilter('all')
    setProviderFilter('all')
    setQuickFilter('all')
  }

  function resetConversationFilters(): void {
    resetTimelineFilters()
    setCausalScope('all')
  }

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

  function refreshSources(): void {
    refreshStartedAt.current = Date.now()
    setRefreshing(true)
    setRefreshKey((value) => value + 1)
  }

  function openEvent(eventId: string): void {
    setQuery('')
    setTypeFilter('all')
    setProviderFilter('all')
    setQuickFilter('all')
    setCausalScope('all')
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
      nativeTraces
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
  const renderRagCausalStep = (
    event: HarnessTimelineEvent,
    turnId: string
  ): React.JSX.Element | null => {
    if (event.kind !== 'injection') return null
    const rag = summarizeRagTrace({ system: event.content })
    if (rag.status !== 'injected' || rag.engine !== 'Amitel Brain') return null
    const turn = scopedTurns.find((candidate) => candidate.id === turnId)
    const firstRagEvent = turn?.events.find((candidate) => {
      if (candidate.kind !== 'injection') return false
      const summary = summarizeRagTrace({ system: candidate.content })
      return summary.status === 'injected' && summary.engine === 'Amitel Brain'
    })
    const isFirstDelivery = firstRagEvent?.id === event.id
    const call = currentCalls.find((candidate) => event.id.startsWith(`${candidate.id}:`))
    const brainTrace = convBrainTraces.find((trace) => trace.turnId === turnId)
    const callTrigger = call ? lastUserMessagePreview(call.messages, 500) : ''
    const trigger = brainTrace?.query?.trim() || trustworthyRagTrigger(callTrigger)
    const hasRetrievalTime = Boolean(isFirstDelivery && brainTrace?.timestamp)
    const observedAt = hasRetrievalTime ? brainTrace!.timestamp : (event.timestamp ?? '')
    const timeKind = hasRetrievalTime ? 'retrieval' : 'trace'
    const provider = event.provider ?? event.recipient ?? call?.provider ?? 'provider non exposé'

    return (
      <section
        className="observatory-rag-causal-step"
        data-testid="observatory-rag-causal-step"
        data-turn-id={turnId}
        data-provider={provider}
        data-observed-at={observedAt}
        data-time-kind={timeKind}
        data-evidence={isFirstDelivery && brainTrace ? 'retrieval' : 'injection'}
      >
        <header>
          <span aria-hidden="true">↳</span>
          <div>
            <strong>
              {isFirstDelivery && brainTrace
                ? 'Autowin interroge Amitel Brain'
                : 'Autowin remet le contexte Brain au modèle'}
            </strong>
            <small>
              {hasRetrievalTime
                ? `${new Date(observedAt).toLocaleTimeString('fr-FR')} · récupération terminée · remis à ${provider}`
                : observedAt
                  ? `${new Date(observedAt).toLocaleTimeString('fr-FR')} · heure de trace · remise non horodatée à ${provider}`
                  : `heure et remise non exposées · destinataire ${provider}`}
            </small>
          </div>
          <b>
            {rag.sources.length} source{rag.sources.length > 1 ? 's' : ''} ·{' '}
            {rag.injectedCharacters.toLocaleString('fr-FR')} caractères
          </b>
        </header>
        <p>
          <b>Déclenché par</b>
          <span>{trigger ? `« ${trigger} »` : 'Action déclenchante non exposée'}</span>
        </p>
        <RagTraceCard
          request={{ system: event.content }}
          queryOverride={brainTrace?.query || trigger || null}
        />
        {isFirstDelivery && brainTrace?.navigation && <BrainNavigationCard trace={brainTrace} />}
        <small className="observatory-rag-boundary">
          Preuve observée à la frontière Autowin → provider · le fournisseur peut encore transformer
          l’enveloppe.
        </small>
      </section>
    )
  }

  const renderEvent = (
    event: HarnessTimelineEvent,
    index: number,
    diverges = false,
    turnId = ''
  ): React.JSX.Element => (
    <div key={event.id} className="observatory-event-wrap">
      {renderRagCausalStep(event, turnId)}
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
    <section className="observatory-view" data-testid="observatory-view">
      <header className="observatory-head">
        <ModuleHeader eyebrow="Traçabilité des conversations" title="Observatory" />
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
            // A1 — coût 0 alors que des tokens ont été consommés = usage sur abonnement forfaitaire
            // (ex. codex/sol via OAuth ChatGPT, non facturé au token). Ne pas afficher « $0.000 »
            // qui se lit comme une panne d'observabilité.
            <strong
              data-metric="cost"
              title="Providers sur abonnement (OAuth) — non facturés au token"
            >
              forfait
              <small>abonnement</small>
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
          <button onClick={() => setRefreshKey((value) => value + 1)}>Réessayer</button>
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
        <aside className="observatory-rail">
          <span className="observatory-panel-title">conversations</span>
          <div className="observatory-conversations">
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                className={conversation.id === conversationId ? 'is-active' : ''}
                onClick={() => selectConversation(conversation.id)}
              >
                <strong>{conversation.title}</strong>
                <small>{conversation.provider}</small>
              </button>
            ))}
          </div>
          <section className="observatory-calls">
            <span className="observatory-panel-title">APPELS OBSERVÉS</span>
            {currentCalls.map((call) => (
              <button
                key={call.id}
                className={selectedCall?.id === call.id ? 'is-active' : ''}
                onClick={() => {
                  setSelected(null)
                  setSelectedCall(call)
                }}
              >
                <strong>
                  {call.provider}
                  {call.model ? ` · ${call.model}` : ''}
                </strong>
                {(() => {
                  const preview = lastUserMessagePreview(call.messages)
                  return preview ? (
                    <span className="observatory-call-preview" title={preview}>
                      « {preview} »
                    </span>
                  ) : null
                })()}
                <small>
                  {new Date(call.ts).toLocaleTimeString('fr-FR')} ·{' '}
                  {(call.usage?.inputTokens ?? 0).toLocaleString('fr-FR')} in ·{' '}
                  {(call.usage?.cacheReadTokens ?? 0).toLocaleString('fr-FR')} cache
                </small>
              </button>
            ))}
          </section>
          <section className="observatory-diagnostics">
            <span className="observatory-panel-title">SIGNAUX PRIORITAIRES</span>
            {visibleAnomalies.length === 0 ? (
              <p>Aucun signal évident.</p>
            ) : (
              visibleAnomalies.map((item) => (
                <button
                  key={`${item.kind}:${item.eventId}`}
                  onClick={() => openEvent(item.eventId)}
                >
                  <strong>{item.impact.toLocaleString('fr-FR')} caractères</strong>
                  <span>
                    {item.label} · {item.turnIds.length} tour{item.turnIds.length > 1 ? 's' : ''}
                  </span>
                </button>
              ))
            )}
          </section>
        </aside>
        <main
          className="observatory-stream"
          onClick={() => {
            setSelected(null)
            setSelectedCall(null)
          }}
          data-testid="observatory-stream"
          aria-busy={loading}
        >
          {loading && <div className="observatory-empty">Lecture des traces…</div>}
          {!loading && viewMode === 'timeline' && visibleTurns.length === 0 && (
            <div className="observatory-empty">Aucune trace dans ce filtre.</div>
          )}
          {!loading && viewMode === 'causal' && causalNodes.length === 0 && (
            <div className="observatory-empty">Aucun lien causal observable.</div>
          )}
          {!loading &&
            viewMode === 'causal' &&
            causalNodes.length > 0 &&
            visibleCausalNodes.length === 0 && (
              <div className="observatory-empty">Aucun signal dans ce filtre.</div>
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
                        {renderRagCausalStep(node.event, eventTurnId(node.event))}
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
            <article
              className="observatory-call-detail"
              onClick={(click) => click.stopPropagation()}
            >
              <header>
                <div>
                  <b>
                    Appel exact · {selectedCall.provider}
                    {selectedCall.model ? ` · ${selectedCall.model}` : ''}
                  </b>
                  <small>
                    {selectedCall.boundary} · {selectedCall.turnId}
                  </small>
                </div>
                <button onClick={() => setSelectedCall(null)}>Fermer</button>
              </header>
              <div className="observatory-call-metrics">
                <b>{(selectedCall.usage?.inputTokens ?? 0).toLocaleString('fr-FR')} in</b>
                <span>
                  {(selectedCall.usage?.cacheReadTokens ?? 0).toLocaleString('fr-FR')} cache
                </span>
                <span>{(selectedCall.usage?.outputTokens ?? 0).toLocaleString('fr-FR')} out</span>
                <span>${(selectedCall.usage?.costUsd ?? 0).toFixed(4)}</span>
              </div>
              <small>{selectedCall.limitation}</small>
              {selectedCall.system && (
                <>
                  <b>System</b>
                  <pre className="observatory-payload">{selectedCall.system}</pre>
                </>
              )}
              <b>Messages</b>
              <HumanJson className="observatory-payload" value={selectedCall.messages} />
              <b>Options</b>
              <HumanJson className="observatory-payload" value={selectedCall.options} />
              <b>Réponse</b>
              <pre className="observatory-payload">{selectedCall.response || '(vide)'}</pre>
            </article>
          )}
          {compare.length === 2 && (
            <section className="observatory-diff">
              <header>
                <b>Comparaison de payloads</b>
                <button
                  onClick={(event) => {
                    event.stopPropagation()
                    setCompare([])
                  }}
                >
                  Fermer
                </button>
              </header>
              <div>
                <pre>{compare[0].content || '(vide)'}</pre>
                <pre>{compare[1].content || '(vide)'}</pre>
              </div>
            </section>
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
        </main>
      </div>
    </section>
  )
}
