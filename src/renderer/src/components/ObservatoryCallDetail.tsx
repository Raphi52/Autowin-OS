import { useRef, useState } from 'react'
import { HumanJson } from './HumanJson'
import { LatestRequestGate } from './observatory-reliability'
import type {
  ShadowRouteInsufficientData,
  ShadowRouteRecommendation
} from '../../../main/shadow-router'
import type { PromptCall } from './observatory-view-types'
import { injectionInventory } from './observatory-injection-inventory'
import { Spinner } from './Spinner'

/**
 * LA LISTE DES INJECTIONS — ce qu'Autowin a ajouté au prompt, nommé bloc par bloc.
 *
 * La vue affichait le `system` en un seul `<pre>` : lisible, mais impossible à inventorier. Le
 * reste NON ATTRIBUÉ est affiché au même rang que les blocs, jamais masqué : c'est le seul moyen
 * de distinguer « voici tout ce qui a été injecté » de « voici ce qu'on sait nommer ».
 */
function InjectionInventoryList({ call }: { call: PromptCall }): React.JSX.Element | null {
  const inventory = injectionInventory(call)
  if (inventory.empty) return null
  return (
    <section className="observatory-injections" data-testid="observatory-injections">
      <b>
        Injections · {inventory.blocks.length} bloc{inventory.blocks.length > 1 ? 's' : ''} nommé
        {inventory.blocks.length > 1 ? 's' : ''}
        {inventory.exhaustive ? '' : ' · liste incomplète'}
      </b>
      <ul>
        {inventory.blocks.map((block) => (
          <li key={`${block.channel}:${block.name}`}>
            <span>{block.name}</span>
            <small>{block.channel === 'system' ? 'système' : 'contexte poussé'}</small>
            <b>{block.chars.toLocaleString('fr-FR')} car.</b>
            <small>{block.share}&nbsp;%</small>
          </li>
        ))}
        {inventory.unattributedChars > 0 && (
          <li data-testid="observatory-injection-unattributed">
            <span>non attribué</span>
            <small>
              système · aucun bloc ne revendique ces caractères, le site d’appel ne déclare pas sa
              décomposition
            </small>
            <b>{inventory.unattributedChars.toLocaleString('fr-FR')} car.</b>
            <small>
              {inventory.systemChars > 0
                ? Math.round((inventory.unattributedChars / inventory.systemChars) * 100)
                : 0}
              &nbsp;%
            </small>
          </li>
        )}
      </ul>
    </section>
  )
}

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
      <InjectionInventoryList call={call} />
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
