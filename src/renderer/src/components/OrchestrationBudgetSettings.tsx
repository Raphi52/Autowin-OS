import { useEffect, useState } from 'react'
import { ModuleHeader } from './ModuleHeader'
import './OrchestrationBudgetSettings.css'

interface BudgetSettings {
  maxProviderCalls: number
  maxTotalTokens: number
  maxUsd: number | null
}

export function OrchestrationBudgetSettings(): React.JSX.Element {
  const [calls, setCalls] = useState('')
  const [tokens, setTokens] = useState('')
  const [usd, setUsd] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const show = (settings: BudgetSettings): void => {
    setCalls(String(settings.maxProviderCalls))
    setTokens(String(settings.maxTotalTokens))
    setUsd(settings.maxUsd === null ? '' : String(settings.maxUsd))
  }

  useEffect(() => {
    window.api
      .orchestrationBudget()
      .then(show)
      .catch((reason) => setMessage(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoading(false))
  }, [])

  const save = async (): Promise<void> => {
    const maxProviderCalls = Number(calls)
    const maxTotalTokens = Number(tokens)
    const maxUsd = usd.trim() === '' ? null : Number(usd)
    if (!Number.isSafeInteger(maxProviderCalls) || maxProviderCalls <= 0) {
      setMessage('Le plafond d appels doit etre un entier strictement positif.')
      return
    }
    if (!Number.isSafeInteger(maxTotalTokens) || maxTotalTokens <= 0) {
      setMessage('Le plafond de tokens doit etre un entier strictement positif.')
      return
    }
    if (maxUsd !== null && (!Number.isFinite(maxUsd) || maxUsd <= 0)) {
      setMessage('Le plafond USD doit etre positif ou vide.')
      return
    }
    setSaving(true)
    setMessage('')
    try {
      const saved = await window.api.setOrchestrationBudget({
        maxProviderCalls,
        maxTotalTokens,
        maxUsd
      })
      show(saved)
      setMessage('Garde-fous enregistres : ils s appliquent au prochain run.')
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  const disabled = loading || saving
  return (
    <section className="orchestration-budget surface-panel" aria-label="Budget d orchestration">
      <ModuleHeader eyebrow="Protection des runs" title="Budget d orchestration" />
      <p>
        Trois plafonds par run. Un nouvel appel est refuse avant son depart des que le budget est
        atteint, meme quand le fournisseur ne communique aucun prix.
      </p>
      <label>
        <span>Maximum d appels fournisseur</span>
        <div className="orchestration-budget-input">
          <input type="number" min="1" step="1" value={calls} disabled={disabled} onChange={(event) => setCalls(event.target.value)} />
          <b>appels</b>
        </div>
      </label>
      <label>
        <span>Budget de tokens totaux</span>
        <div className="orchestration-budget-input">
          <input type="number" min="1" step="1" value={tokens} disabled={disabled} onChange={(event) => setTokens(event.target.value)} />
          <b>tokens</b>
        </div>
      </label>
      <label>
        <span>Maximum de cout connu (optionnel)</span>
        <div className="orchestration-budget-input">
          <input type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="Optionnel" value={usd} disabled={disabled} onChange={(event) => setUsd(event.target.value)} />
          <b>USD</b>
        </div>
      </label>
      <small>
        Le devis du run peut appliquer des limites encore plus strictes selon la complexite de la
        demande. Une limite utilisateur ne peut jamais agrandir ce devis. L usage final d&apos;un appel
        CLI n etant connu qu a sa reponse, un depassement de cet appel est affiche puis interdit tout
        appel suivant.
      </small>
      <button type="button" onClick={() => void save()} disabled={disabled}>
        {saving ? 'Enregistrement...' : 'Enregistrer'}
      </button>
      {message && <p className="orchestration-budget-message" role="status">{message}</p>}
    </section>
  )
}
