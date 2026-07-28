import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ModelQuota, ModelQuotaSnapshot, ModelQuotaWindow } from '../../../shared/model-quotas'
import './ModelQuotaIndicator.css'

const providerLabels: Record<string, string> = {
  claude: 'Claude',
  codex: 'ChatGPT',
  gemini: 'Gemini',
  kimi: 'Kimi'
}

function windowKey(window: ModelQuotaWindow): string {
  return `${window.id}\0${window.modelFamily ?? ''}`
}

function quotasByProvider(models: readonly ModelQuota[]): ModelQuota[] {
  const providers = new Map<string, ModelQuota>()
  for (const model of models) {
    const current = providers.get(model.provider)
    if (!current) {
      providers.set(model.provider, {
        ...model,
        modelId: model.provider,
        label: providerLabels[model.provider] ?? model.provider,
        windows: [...model.windows]
      })
      continue
    }
    const knownWindows = new Set(current.windows.map(windowKey))
    for (const window of model.windows) {
      const key = windowKey(window)
      if (!knownWindows.has(key)) {
        current.windows.push(window)
        knownWindows.add(key)
      }
    }
  }
  return [...providers.values()]
}

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
  const requestSequenceRef = useRef(0)

  const refresh = useCallback(async (): Promise<void> => {
    if (typeof window.api?.modelQuotas !== 'function') {
      setError('Redémarrage requis pour activer les quotas')
      return
    }
    const requestSequence = ++requestSequenceRef.current
    setLoading(true)
    setError(undefined)
    try {
      const value = await window.api.modelQuotas(true)
      if (requestSequence === requestSequenceRef.current) setSnapshot(value)
    } catch (failure) {
      if (requestSequence === requestSequenceRef.current) {
        setError(failure instanceof Error ? failure.message : 'Quotas indisponibles')
      }
    } finally {
      if (requestSequence === requestSequenceRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    if (typeof window.api?.modelQuotas !== 'function') return
    const load = (): void => {
      const requestSequence = ++requestSequenceRef.current
      void window.api
        .modelQuotas()
        .then((value) => {
          if (active && requestSequence === requestSequenceRef.current) {
            setSnapshot(value)
            setError(undefined)
          }
        })
        .catch((failure: unknown) => {
          if (active && requestSequence === requestSequenceRef.current) {
            setError(failure instanceof Error ? failure.message : 'Quotas indisponibles')
          }
        })
    }
    load()
    const timer = window.setInterval(load, 60_000)
    return () => {
      active = false
      window.clearInterval(timer)
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
  const providerQuotas = quotasByProvider(snapshot?.models ?? [])
  return (
    <div className="model-quota" ref={rootRef}>
      <button
        type="button"
        className={`model-quota-trigger is-${level}`}
        data-testid="model-quota-trigger"
        style={{ '--quota-angle': `${remaining ?? 0}%` } as CSSProperties}
        aria-label={
          remaining === undefined
            ? 'Afficher les quotas fournisseurs'
            : `Afficher les quotas fournisseurs, ${Math.round(remaining)} % minimum restant`
        }
        aria-expanded={open}
        title="Quotas par fournisseur"
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
          aria-label="Quotas par fournisseur"
        >
          <header>
            <div>
              <strong>Quotas fournisseurs</strong>
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
            {providerQuotas.map((model) => (
              <article key={model.modelId} className="model-quota-row">
                <div className="model-quota-name">
                  <span>
                    <strong>{model.label}</strong>
                    <small>
                      {model.source}
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
                    <div className="model-quota-window" key={windowKey(window)}>
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
                      {window.limitKnown === false ? (
                        // Aucun plafond officiel exposé (mesure locale) : afficher les tokens
                        // CONSOMMÉS, jamais une jauge de « restant » qui serait inventée.
                        <strong className="model-quota-values">
                          <span>
                            {(window.usedTokens ?? 0).toLocaleString('fr-FR')} tokens consommés
                          </span>
                          <small>plafond non exposé par le fournisseur</small>
                        </strong>
                      ) : (
                        <>
                          <div className="model-quota-meter" aria-hidden="true">
                            <i style={{ width: `${window.remainingPercent}%` }} />
                          </div>
                          <strong className="model-quota-values">
                            <span>{Math.round(window.remainingPercent)} % restant</span>
                            <small>{Math.round(window.usedPercent)} % utilisé</small>
                          </strong>
                        </>
                      )}
                    </div>
                  ))
                )}
              </article>
            ))}
          </div>
          <footer>Capacité restante · un quota de compte par fournisseur</footer>
        </section>
      )}
    </div>
  )
}
