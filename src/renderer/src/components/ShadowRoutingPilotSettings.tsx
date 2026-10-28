import { useCallback, useEffect, useState } from 'react'
import { langueCourante } from '../langue'
import { riche } from '../textes'
import { traduireSettings, useTextesSettings } from '../textes-ecrans/settings'
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
  // Messages posés dans l'état : traduits au moment où ils sont posés (`langueCourante`), comme
  // BrainSettings ; les raisons venues du moteur restent telles quelles (conv-1170).
  const { t } = useTextesSettings()
  const [state, setState] = useState<PilotState | null>(null)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async (): Promise<void> => {
    const read = window.api?.shadowRoutingPilot
    if (typeof read !== 'function') {
      setLoadError(traduireSettings('shadow.nonExpose', langueCourante()))
      return
    }
    try {
      setState((await read()) as PilotState)
      setLoadError('')
    } catch (error) {
      setLoadError(
        traduireSettings('shadow.lectureEchec', langueCourante(), { raison: reason(error) })
      )
    }
  }, [])

  useEffect(() => {
    // queueMicrotask : le chargement initial ne pousse pas d'état SYNCHRONE depuis l'effet
    // (même discipline que CapabilitiesView).
    queueMicrotask(() => void load())
  }, [load])

  const toggle = async (enabled: boolean): Promise<void> => {
    const write = window.api?.setShadowRoutingPilot
    if (typeof write !== 'function') {
      setMessage(t('shadow.basculeNonExposee'))
      return
    }
    setSaving(true)
    setMessage('')
    try {
      const saved = (await write(enabled)) as PilotState
      setState(saved)
      setMessage(saved.active ? t('shadow.mesureActive') : t('shadow.mesureArretee'))
    } catch (error) {
      setMessage(t('shadow.enregistrementEchec', { raison: reason(error) }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section
      className="shadow-routing-pilot surface-panel"
      aria-label={t('shadow.aria')}
      data-testid="shadow-routing-pilot"
    >
      <ModuleHeader eyebrow={t('shadow.eyebrow')} title={t('shadow.titre')} />
      <p>{riche(t('shadow.description'), 'b')}</p>
      {loadError && (
        <div className="domain-warning">
          <p role="alert">{loadError}</p>
          <button type="button" className="btn" onClick={() => void load()}>
            {t('shadow.reessayer')}
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
        <span>{t('shadow.case')}</span>
      </label>
      {state?.envOverride != null && (
        <p className="domain-hint" role="status" data-testid="shadow-routing-pilot-env">
          {t('shadow.env', { etat: state.envOverride ? t('shadow.actif') : t('shadow.inactif') })}
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
