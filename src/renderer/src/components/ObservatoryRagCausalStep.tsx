import { summarizeRagTrace } from './rag-trace-model'
import { RagTraceCard } from './RagTraceCard'
import { BrainNavigationCard, type BrainTraceView } from './BrainNavigationCard'
import { lastUserMessagePreview, trustworthyRagTrigger } from './observatory-event-preview'
import type { HarnessTimelineEvent, HarnessTimeline } from './harness-timeline-model'

interface PromptCallLike {
  id: string
  brainTraceId?: string
  provider?: string
  messages: Array<{ role: string; content: string }>
}

/**
 * Etape causale RAG / Brain d'un evenement d'injection.
 *
 * Extrait d'`ObservatoryView.tsx` le 2026-08-07. C'etait une fonction definie DANS le composant,
 * fermant implicitement sur `scopedTurns`, `currentCalls` et `convBrainTraces` : impossible de savoir,
 * en la lisant, de quoi son rendu dependait reellement. Ces trois dependances sont desormais des
 * props NOMMEES — la meme logique, mais dont le contrat est visible.
 */
export function ObservatoryRagCausalStep({
  event,
  turnId,
  scopedTurns,
  currentCalls,
  convBrainTraces
}: {
  event: HarnessTimelineEvent
  turnId: string
  scopedTurns: HarnessTimeline['turns']
  currentCalls: PromptCallLike[]
  convBrainTraces: BrainTraceView[]
}): React.JSX.Element | null {
  if (event.kind !== 'injection') return null
  const rag = summarizeRagTrace({ system: event.content })
  if (rag.status !== 'injected' || rag.engine !== 'Amitel Brain') return null
  const turn = scopedTurns.find((candidate) => candidate.id === turnId)
  const callForEvent = (candidate: HarnessTimelineEvent): PromptCallLike | undefined =>
    currentCalls.find((callCandidate) => candidate.id.startsWith(`${callCandidate.id}:`))
  const call = callForEvent(event)
  const exactBrainTrace = call?.brainTraceId
    ? convBrainTraces.find((trace) => trace.id === call.brainTraceId)
    : undefined
  const brainTrace = exactBrainTrace ?? convBrainTraces.find((trace) => trace.turnId === turnId)
  const correlation = exactBrainTrace ? 'exact' : brainTrace ? 'estimated' : 'none'
  const firstRagEvent = turn?.events.find((candidate) => {
    if (candidate.kind !== 'injection') return false
    const summary = summarizeRagTrace({ system: candidate.content })
    if (summary.status !== 'injected' || summary.engine !== 'Amitel Brain') return false
    return call?.brainTraceId
      ? callForEvent(candidate)?.brainTraceId === call.brainTraceId
      : true
  })
  const isFirstDelivery = firstRagEvent?.id === event.id
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
      data-correlation={correlation}
      data-brain-kind={brainTrace?.kind ?? 'legacy'}
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
        l’enveloppe. {correlation === 'estimated' ? 'Corrélation estimée (trace historique).' : ''}
      </small>
    </section>
  )
}
