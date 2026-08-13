import { useCallback, useEffect, useState } from 'react'
import { ModuleHeader } from './ModuleHeader'

interface PilotState {
  enabled: boolean
  active: boolean
  envOverride: boolean | null
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Opt-in DEPUIS L'APPLICATION du pilote de routage shadow.
 *
 * Pourquoi cette vue : la boucle de mesure « quelle route tient le vert au coût le plus bas » était
 * entièrement construite mais n'avait qu'un seul interrupteur, une variable d'environnement
 * qu'aucun utilisateur d'app packagée ne peut poser. Elle ne s'est donc jamais remplie.
 *
 * Le défaut reste OFF : aucune donnée n'est collectée sans ce clic.
 */
export function ShadowRoutingPilotSettings(): React.JSX.Element {
  const [state, setState] = useState<PilotState | null>(null)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async (): Promise<void> => {
    const read = window.api?.shadowRoutingPilot
    if (typeof read !== 'function') {
      setLoadError("Le pilote de routage shadow n'est pas exposé par l'application.")
      return
    }
    try {
      setState((await read()) as PilotState)
      setLoadError('')
    } catch (error) {
      setLoadError(`Le réglage n'a pas pu être lu : ${reason(error)}`)
    }
  }, [])

  useEffect(() => {
    // queueMicrotask : le chargement initial ne pousse pas d'état SYNCHRONE depuis l'effet
    // (même discipline que OrchestrationBudgetSettings).
    queueMicrotask(() => void load())
  }, [load])

  const toggle = async (enabled: boolean): Promise<void> => {
    const write = window.api?.setShadowRoutingPilot
    if (typeof write !== 'function') {
      setMessage("La bascule n'est pas exposée par l'application.")
      return
    }
    setSaving(true)
    setMessage('')
    try {
      const saved = (await write(enabled)) as PilotState
      setState(saved)
      setMessage(
        saved.active
          ? 'Mesure active : chaque appel modèle est désormais rapproché de l’issue vérifiée de son run.'
          : 'Mesure arrêtée : aucune nouvelle observation n’est enregistrée.'
      )
    } catch (error) {
      setMessage(`L’enregistrement a échoué : ${reason(error)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section
      className="shadow-routing-pilot surface-panel"
      aria-label="Pilote de routage shadow"
      data-testid="shadow-routing-pilot"
    >
      <ModuleHeader eyebrow="Apprentissage du routage" title="Mesure des routes (pilote shadow)" />
      <p>
        Cochez pour que l’application mesure elle-même{' '}
        <b>quelle route tient le vert au coût le plus bas</b> : pour chaque appel modèle, elle
        enregistre le fournisseur, le modèle, la phase, le coût, la durée, puis l’issue{' '}
        <b>vérifiée</b> du run. L’Observatory peut alors comparer les routes observées. Rien n’est
        appliqué automatiquement : la recommandation reste un avis.
      </p>
      {loadError && (
        <div className="domain-warning">
          <p role="alert">{loadError}</p>
          <button type="button" onClick={() => void load()}>
            Réessayer
          </button>
        </div>
      )}
      <label>
        <input
          type="checkbox"
          data-testid="shadow-routing-pilot-toggle"
          checked={state?.enabled === true}
          disabled={state === null || saving}
          onChange={(event) => void toggle(event.target.checked)}
        />
        <span>Mesurer les routes (pilote shadow) — décoché, aucune donnée n’est collectée</span>
      </label>
      {state?.envOverride != null && (
        <p className="domain-hint" role="status" data-testid="shadow-routing-pilot-env">
          La variable d’environnement AUTOWIN_MODEL_ROUTING_SHADOW_ENABLED force actuellement le
          pilote à {state.envOverride ? 'ACTIF' : 'INACTIF'} : elle l’emporte sur ce réglage
          jusqu’au prochain démarrage sans elle.
        </p>
      )}
      {message && (
        <p className="shadow-routing-pilot-message" role="status">
          {message}
        </p>
      )}
    </section>
  )
}
