import { useRef, useState } from 'react'
import { formaterNombre } from '../langue'
import { useTextesObservatory } from '../textes-ecrans/observatory'
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
  const { t } = useTextesObservatory()
  const inventory = injectionInventory(call)
  if (inventory.empty) return null
  return (
    <section className="observatory-injections" data-testid="observatory-injections">
      <b>
        {t('appel.injections', {
          n: inventory.blocks.length,
          s: inventory.blocks.length > 1 ? 's' : ''
        })}
        {inventory.exhaustive ? '' : t('appel.listeIncomplete')}
      </b>
      <ul>
        {inventory.blocks.map((block) => (
          <li key={`${block.channel}:${block.name}`}>
            <span>{block.name}</span>
            <small>
              {block.channel === 'system' ? t('appel.systeme') : t('appel.contextePousse')}
            </small>
            <b>{t('appel.caracteres', { n: formaterNombre(block.chars) })}</b>
            <small>{block.share}&nbsp;%</small>
          </li>
        ))}
        {inventory.unattributedChars > 0 && (
          <li data-testid="observatory-injection-unattributed">
            <span>{t('appel.nonAttribue')}</span>
            <small>{t('appel.systemeAucunBlocRevendique')}</small>
            <b>{t('appel.caracteres', { n: formaterNombre(inventory.unattributedChars) })}</b>
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
  const { t } = useTextesObservatory()
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
            {t('appel.appelExact', { provider: call.provider })}
            {call.model ? ` · ${call.model}` : ''}
          </b>
          <small>
            {call.boundary} · {call.turnId}
          </small>
        </div>
        <button onClick={onClose}>{t('appel.fermer')}</button>
      </header>
      <div className="observatory-call-metrics">
        <b>{formaterNombre(call.usage?.inputTokens ?? 0)} in</b>
        <span>{formaterNombre(call.usage?.cacheReadTokens ?? 0)} cache</span>
        <span>{formaterNombre(call.usage?.outputTokens ?? 0)} out</span>
        <span>${(call.usage?.costUsd ?? 0).toFixed(4)}</span>
      </div>
      <small>{call.limitation}</small>
      <button
        type="button"
        disabled={!call.phase}
        title={
          call.phase ? t('appel.comparerRoutesObserveesCette') : t('appel.phaseInconnueCetAncien')
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
        {t('appel.comparerShadow')}
      </button>
      {shadowLoading && (
        <small role="status">
          <Spinner /> {t('appel.comparaisonShadowCours')}
        </small>
      )}
      {shadowError && (
        <small role="alert">{t('appel.shadowIndisponible', { raison: shadowError })}</small>
      )}
      {shadowRecommendation != null && (
        <section data-testid="shadow-route-recommendation">
          <b>{t('appel.recommandationShadowJamaisAppliquee')}</b>
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
      <b>{t('appel.reponse')}</b>
      <pre className="observatory-payload">{call.response || t('appel.vide')}</pre>
    </article>
  )
}
