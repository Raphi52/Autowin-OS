import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ModelQuotaSnapshot, ModelQuotaWindow } from '../../../shared/model-quotas'
import './ModelQuotaIndicator.css'

function resetLabel(window: ModelQuotaWindow): string {
  if (!window.resetsAt) return 'reset non exposé'
  const date = new Date(window.resetsAt)
  if (!Number.isFinite(date.valueOf())) return 'reset non exposé'
  return `reset ${date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })}`
}

function observedLabel(observedAt: string | undefined, stale: boolean): string {
  if (!observedAt) return ''
  const date = new Date(observedAt)
  if (!Number.isFinite(date.valueOf())) return ''
  return `${stale ? 'Mesure ancienne' : 'Mesuré'} ${date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })}`
}

export function ModelQuotaIndicator(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<ModelQuotaSnapshot>()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const rootRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async (): Promise<void> => {
    if (typeof window.api?.modelQuotas !== 'function') {
      setError('Redémarrage requis pour activer les quotas')
      return
    }
    setLoading(true)
    setError(undefined)
    try {
      setSnapshot(await window.api.modelQuotas())
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Quotas indisponibles')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    if (typeof window.api?.modelQuotas !== 'function') return
    void window.api
      .modelQuotas()
      .then((value) => {
        if (active) setSnapshot(value)
      })
      .catch((failure: unknown) => {
        if (active) setError(failure instanceof Error ? failure.message : 'Quotas indisponibles')
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  const remaining = snapshot?.summary.remainingPercent
  const level = snapshot?.summary.status ?? 'unknown'
  return (
    <div className="model-quota" ref={rootRef}>
      <button
        type="button"
        className={`model-quota-trigger is-${level}`}
        data-testid="model-quota-trigger"
        style={{ '--quota-angle': `${remaining ?? 0}%` } as CSSProperties}
        aria-label={
          remaining === undefined
            ? 'Afficher les quotas modèles'
            : `Afficher les quotas modèles, ${Math.round(remaining)} % minimum restant`
        }
        aria-expanded={open}
        title="Quotas de tous les modèles"
        onClick={() => {
          const next = !open
          setOpen(next)
          if (next) void refresh()
        }}
      >
        <span>{remaining === undefined ? '···' : Math.round(remaining)}</span>
      </button>
      {open && (
        <section
          className="model-quota-popover"
          data-testid="model-quota-popover"
          aria-label="Quotas de tous les modèles"
        >
          <header>
            <div>
              <strong>Quotas modèles</strong>
              <small>
                {error
                  ? 'Indisponible'
                  : snapshot
                    ? `Actualisé ${new Date(snapshot.observedAt).toLocaleTimeString('fr-FR', {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}`
                    : 'Lecture en cours'}
              </small>
            </div>
            <button
              type="button"
              aria-label="Actualiser les quotas"
              aria-busy={loading}
              onClick={() => void refresh()}
              disabled={loading}
            >
              {loading ? '…' : '↻'}
            </button>
          </header>
          {error && <p className="model-quota-error">{error}</p>}
          <div className="model-quota-list">
            {(snapshot?.models ?? []).map((model) => (
              <article key={model.modelId} className="model-quota-row">
                <div className="model-quota-name">
                  <span>
                    <strong>{model.label}</strong>
                    <small>
                      {model.provider}
                      {model.observedAt
                        ? ` · ${observedLabel(model.observedAt, model.status === 'stale')}`
                        : ''}
                    </small>
                  </span>
                </div>
                {model.windows.length === 0 ? (
                  <div className="model-quota-unavailable">
                    Non exposé
                    {model.error && <small>{model.error}</small>}
                  </div>
                ) : (
                  model.windows.map((window) => (
                    <div className="model-quota-window" key={window.id}>
                      <span>
                        <b>
                          {window.label}
                          <em className="model-quota-scope">
                            {window.modelFamily
                              ? `Spécifique ${window.modelFamily}`
                              : 'Quota partagé'}
                          </em>
                        </b>
                        <small>{resetLabel(window)}</small>
                      </span>
                      <div className="model-quota-meter" aria-hidden="true">
                        <i style={{ width: `${window.remainingPercent}%` }} />
                      </div>
                      <strong className="model-quota-values">
                        <span>{Math.round(window.remainingPercent)} % restant</span>
                        <small>{Math.round(window.usedPercent)} % utilisé</small>
                      </strong>
                    </div>
                  ))
                )}
              </article>
            ))}
          </div>
          <footer>Capacité restante · quotas de compte partagés selon le provider</footer>
        </section>
      )}
    </div>
  )
}
