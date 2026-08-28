import { useRef, useState } from 'react'
import { HumanJson } from './HumanJson'
import { LatestRequestGate } from './observatory-reliability'
import type {
  ShadowRouteInsufficientData,
  ShadowRouteRecommendation
} from '../../../main/shadow-router'
import type { PromptCall } from './observatory-view-types'
import { Spinner } from './Spinner'

/**
 * Détail d'un appel observé, y compris la comparaison shadow.
 *
 * Extrait d'`ObservatoryView.tsx` le 2026-08-11 SANS changement de comportement. L'état shadow suit
 * l'appel affiché : la vue monte ce composant avec `key={call.id}`, ce qui remplace exactement
 * l'effet de remise à zéro qui vivait dans la vue. Le `LatestRequestGate` est conservé : il protège
 * la course À L'INTÉRIEUR d'un même appel (deux clics sur « Comparer en shadow »).
 */
export function ObservatoryCallDetail({
  call,
  onClose
}: {
  call: PromptCall
  onClose: () => void
}): React.JSX.Element {
  const [shadowRecommendation, setShadowRecommendation] = useState<
    ShadowRouteRecommendation | ShadowRouteInsufficientData | null
  >(null)
  const [shadowLoading, setShadowLoading] = useState(false)
  const [shadowError, setShadowError] = useState('')
  const shadowRequestGate = useRef(new LatestRequestGate())

  return (
    <article className="observatory-call-detail" onClick={(click) => click.stopPropagation()}>
      <header>
        <div>
          <b>
            Appel exact · {call.provider}
            {call.model ? ` · ${call.model}` : ''}
          </b>
          <small>
            {call.boundary} · {call.turnId}
          </small>
        </div>
        <button onClick={onClose}>Fermer</button>
      </header>
      <div className="observatory-call-metrics">
        <b>{(call.usage?.inputTokens ?? 0).toLocaleString('fr-FR')} in</b>
        <span>{(call.usage?.cacheReadTokens ?? 0).toLocaleString('fr-FR')} cache</span>
        <span>{(call.usage?.outputTokens ?? 0).toLocaleString('fr-FR')} out</span>
        <span>${(call.usage?.costUsd ?? 0).toFixed(4)}</span>
      </div>
      <small>{call.limitation}</small>
      <button
        type="button"
        disabled={!call.phase}
        title={
          call.phase
            ? 'Comparer les routes observées pour cette phase'
            : 'Phase inconnue pour cet ancien appel'
        }
        onClick={() => {
          if (!call.phase) return
          const requestId = shadowRequestGate.current.begin()
          setShadowRecommendation(null)
          setShadowError('')
          setShadowLoading(true)
          void window.api
            .shadowRouteRecommendation(call.phase, {
              provider: call.provider,
              model: call.model ?? 'default'
            })
            .then((recommendation) => {
              if (shadowRequestGate.current.isCurrent(requestId))
                setShadowRecommendation(recommendation)
            })
            .catch((error: unknown) => {
              if (shadowRequestGate.current.isCurrent(requestId))
                setShadowError(error instanceof Error ? error.message : String(error))
            })
            .finally(() => {
              if (shadowRequestGate.current.isCurrent(requestId)) setShadowLoading(false)
            })
        }}
      >
        Comparer en shadow
      </button>
      {shadowLoading && (
        <small role="status">
          <Spinner /> Comparaison shadow en cours…
        </small>
      )}
      {shadowError && <small role="alert">Shadow indisponible : {shadowError}</small>}
      {shadowRecommendation != null && (
        <section data-testid="shadow-route-recommendation">
          <b>Recommandation shadow · jamais appliquée automatiquement</b>
          <HumanJson value={shadowRecommendation} />
        </section>
      )}
      {call.system && (
        <>
          <b>System</b>
          <pre className="observatory-payload">{call.system}</pre>
        </>
      )}
      <b>Messages</b>
      <HumanJson className="observatory-payload" value={call.messages} />
      <b>Options</b>
      <HumanJson className="observatory-payload" value={call.options} />
      <b>Réponse</b>
      <pre className="observatory-payload">{call.response || '(vide)'}</pre>
    </article>
  )
}
