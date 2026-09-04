import { useCallback, useEffect, useRef, useState } from 'react'
import { ModuleHeader } from './ModuleHeader'
import './OrchestrationBudgetSettings.css'

interface BudgetSettings {
  maxProviderCalls: number
  maxChatProviderCalls: number
  maxTotalTokens: number
  maxUsd: number | null
}

export function OrchestrationBudgetSettings(): React.JSX.Element {
  const [calls, setCalls] = useState('')
  const [chatCalls, setChatCalls] = useState('')
  const [tokens, setTokens] = useState('')
  const [usd, setUsd] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  // Un chargement en échec laissait les champs VIDES : un save envoyait alors Number('') = 0 et
  // écrasait les garde-fous. L'état d'échec est désormais explicite et bloque l'enregistrement.
  const [loadError, setLoadError] = useState('')
  // Une saisie en cours n'est JAMAIS écrasée par un rechargement : seul un save réussi fait
  // autorité sur le contenu des champs.
  const [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(false)
  const markDirty = (value: boolean): void => {
    dirtyRef.current = value
    setDirty(value)
  }

  const show = (settings: BudgetSettings): void => {
    setCalls(String(settings.maxProviderCalls))
    setChatCalls(String(settings.maxChatProviderCalls))
    setTokens(String(settings.maxTotalTokens))
    setUsd(settings.maxUsd === null ? '' : String(settings.maxUsd))
  }

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setLoadError('')
    try {
      const settings = await window.api.orchestrationBudget()
      if (!dirtyRef.current) show(settings)
    } catch (reason) {
      setLoadError(
        `Les plafonds n'ont pas pu être lus : ${reason instanceof Error ? reason.message : String(reason)}`
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // queueMicrotask : le chargement initial ne pousse pas d'état SYNCHRONE depuis l'effet
    // (même discipline que CapabilitiesView).
    queueMicrotask(() => void load())
  }, [load])

  const save = async (): Promise<void> => {
    const maxProviderCalls = Number(calls)
    const maxChatProviderCalls = Number(chatCalls)
    const maxTotalTokens = Number(tokens)
    const maxUsd = usd.trim() === '' ? null : Number(usd)
    if (!Number.isSafeInteger(maxProviderCalls) || maxProviderCalls <= 0) {
      setMessage("Le plafond d'appels doit être un entier strictement positif.")
      return
    }
    if (!Number.isSafeInteger(maxChatProviderCalls) || maxChatProviderCalls <= 0) {
      setMessage("Le plafond d'appels par tour de chat doit etre un entier strictement positif.")
      return
    }
    if (!Number.isSafeInteger(maxTotalTokens) || maxTotalTokens <= 0) {
      setMessage('Le plafond de tokens doit être un entier strictement positif.')
      return
    }
    if (maxUsd !== null && (!Number.isFinite(maxUsd) || maxUsd <= 0)) {
      setMessage('Le plafond USD doit être positif ou vide.')
      return
    }
    setSaving(true)
    setMessage('')
    try {
      const saved = await window.api.setOrchestrationBudget({
        maxProviderCalls,
        maxChatProviderCalls,
        maxTotalTokens,
        maxUsd
      })
      show(saved)
      markDirty(false)
      setMessage("Garde-fous enregistrés : ils s'appliquent au prochain run.")
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  const inputsDisabled = loading || saving
  const saveDisabled = inputsDisabled || (loadError !== '' && !dirty)
  const edit = (setter: (value: string) => void) => (value: string) => {
    markDirty(true)
    setter(value)
  }
  return (
    <section className="orchestration-budget surface-panel" aria-label="Budget d'orchestration">
      <ModuleHeader eyebrow="Protection des runs" title="Budget d'orchestration" />
      <p>
        Des plafonds par run, de <strong>deux natures différentes</strong>. Les plafonds d’
        <strong>appels</strong> coupent : un nouvel appel est refusé avant son départ dès qu’ils sont
        atteints, même quand le fournisseur ne communique aucun prix. Les plafonds de{' '}
        <strong>coût et de tokens</strong> ne coupent pas : ils <strong>mesurent</strong>. Un run les
        dépasse sans être arrêté — c’est voulu, pour qu’une réparation puisse enchaîner sans
        attendre une décision, et c’est le nombre d’appels qui borne alors la dépense.
      </p>
      <p>
        Le plafond du tour de chat est séparé : un tour agentique consomme un appel PAR ÉTAPE, il en
        faut donc beaucoup plus que pour un run — le mettre trop bas coupe le travail en plein
        milieu.
      </p>
      {loadError && (
        <div className="orchestration-budget-failure">
          <p role="alert">{loadError}</p>
          <button type="button" onClick={() => void load()} disabled={loading}>
            Réessayer
          </button>
        </div>
      )}
      <label>
        <span>Maximum d&apos;appels fournisseur</span>
        <div className="orchestration-budget-input">
          <input
            type="number"
            min="1"
            step="1"
            value={calls}
            disabled={inputsDisabled}
            onChange={(event) => edit(setCalls)(event.target.value)}
          />
          <b>appels</b>
        </div>
      </label>
      <label>
        <span>Maximum d&apos;appels par tour de chat</span>
        <div className="orchestration-budget-input">
          <input
            type="number"
            min="1"
            step="1"
            value={chatCalls}
            disabled={inputsDisabled}
            onChange={(event) => edit(setChatCalls)(event.target.value)}
          />
          <b>appels</b>
        </div>
      </label>
      <label>
        <span>Budget de tokens totaux (mesure, ne coupe pas)</span>
        <div className="orchestration-budget-input">
          <input
            type="number"
            min="1"
            step="1"
            value={tokens}
            disabled={inputsDisabled}
            onChange={(event) => edit(setTokens)(event.target.value)}
          />
          <b>tokens</b>
        </div>
      </label>
      <label>
        <span>Maximum de coût connu (optionnel — mesure, ne coupe pas)</span>
        <div className="orchestration-budget-input">
          <input
            type="number"
            min="0.01"
            step="0.01"
            inputMode="decimal"
            placeholder="Optionnel"
            value={usd}
            disabled={inputsDisabled}
            onChange={(event) => edit(setUsd)(event.target.value)}
          />
          <b>USD</b>
        </div>
      </label>
      <small>
        Le plan d&apos;exécution du run, calculé selon la complexité de la demande, peut appliquer
        des limites plus strictes que celles-ci — et une limite saisie ici ne peut jamais
        l&apos;élargir. Le coût réel d&apos;un appel n&apos;étant connu qu&apos;à sa réponse, un
        dépassement n&apos;annule jamais le travail déjà payé : il est affiché, puis interdit
        l&apos;appel suivant.
      </small>
      <button type="button" onClick={() => void save()} disabled={saveDisabled}>
        {saving ? 'Enregistrement...' : 'Enregistrer'}
      </button>
      {message && (
        <p className="orchestration-budget-message" role="status">
          {message}
        </p>
      )}
    </section>
  )
}
