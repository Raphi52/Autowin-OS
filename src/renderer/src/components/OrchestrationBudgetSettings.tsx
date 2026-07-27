import { useEffect, useState } from 'react'
import { ModuleHeader } from './ModuleHeader'
import './OrchestrationBudgetSettings.css'

export function OrchestrationBudgetSettings(): React.JSX.Element {
  const [value, setValue] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    window.api
      .orchestrationBudget()
      .then((settings) => setValue(settings.maxUsd === null ? '' : String(settings.maxUsd)))
      .catch((reason) => setMessage(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoading(false))
  }, [])

  const save = async (): Promise<void> => {
    const trimmed = value.trim()
    const maxUsd = trimmed === '' ? null : Number(trimmed)
    if (maxUsd !== null && (!Number.isFinite(maxUsd) || maxUsd <= 0)) {
      setMessage(
        'Saisissez un montant USD strictement positif, ou videz le champ pour désactiver la limite.'
      )
      return
    }
    setSaving(true)
    setMessage('')
    try {
      const saved = await window.api.setOrchestrationBudget({ maxUsd })
      setValue(saved.maxUsd === null ? '' : String(saved.maxUsd))
      setMessage(
        saved.maxUsd === null
          ? 'Limite désactivée : les prochains runs ne seront pas coupés sur le coût.'
          : 'Budget enregistré : appliqué au prochain run.'
      )
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="orchestration-budget surface-panel" aria-label="Budget d’orchestration">
      <ModuleHeader eyebrow="Protection des runs" title="Budget d’orchestration" />
      <p>
        Coupe un run lorsque son coût cumulé dépasse ce montant. Devise : dollars américains (USD).
      </p>
      <label>
        <span>Plafond par run (USD)</span>
        <div className="orchestration-budget-input">
          <input
            type="number"
            min="0.01"
            step="0.01"
            inputMode="decimal"
            placeholder="Aucune limite"
            aria-describedby="orchestration-budget-help"
            value={value}
            disabled={loading || saving}
            onChange={(event) => setValue(event.target.value)}
          />
          <b>USD</b>
        </div>
      </label>
      <small id="orchestration-budget-help">
        Champ vide = aucune limite de coût. Cette absence est explicite : le gate reste actif, mais
        ne coupe pas le run sur le coût.
      </small>
      <button type="button" onClick={() => void save()} disabled={loading || saving}>
        {saving ? 'Enregistrement…' : 'Enregistrer'}
      </button>
      {message && (
        <p className="orchestration-budget-message" role="status">
          {message}
        </p>
      )}
    </section>
  )
}
