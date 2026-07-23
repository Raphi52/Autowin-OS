import React, { useEffect, useState } from 'react'
import './PreflightBanner.css'

/**
 * #4 — Bannière de diagnostic de démarrage. Le main pousse `preflight:result` UNIQUEMENT si la
 * config est dégradée (brain down, CLI provider absent, token manquant). L'utilisateur voit le
 * problème AVANT de lancer un run, au lieu d'un échec silencieux en plein run. Dismissible.
 */
interface PreflightResult {
  ok: boolean
  summary: string
  checks: { id: string; label: string; ok: boolean; detail?: string }[]
}

const PROVIDER_CHECK_IDS = new Set(['claude', 'codex', 'codex-session', 'kimi'])

export function PreflightBanner(): React.JSX.Element | null {
  const [result, setResult] = useState<PreflightResult | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!window.api) return
    let active = true
    const unsubscribe = window.api.onPreflight?.((r) => {
      setResult(r)
      setDismissed(false)
    })
    void window.api
      .getPreflight?.()
      .then((r) => {
        if (active && r) setResult(r)
      })
      .catch(() => {
        // Best-effort : l'événement live reste disponible si la lecture initiale échoue.
      })
    return () => {
      active = false
      unsubscribe?.()
    }
  }, [])

  if (!result || result.ok || dismissed) return null
  const failed = result.checks.filter((c) => !c.ok && !PROVIDER_CHECK_IDS.has(c.id))
  if (failed.length === 0) return null
  return (
    <div className="preflight-banner" role="alert" data-testid="preflight-banner">
      <div className="preflight-banner-body">
        <strong>⚠️ Configuration incomplète</strong>
        <ul>
          {failed.map((c) => (
            <li key={c.id}>
              <b>{c.label}</b>
              {c.detail ? ` — ${c.detail}` : ''}
            </li>
          ))}
        </ul>
      </div>
      <button type="button" className="preflight-banner-close" onClick={() => setDismissed(true)}>
        ×
      </button>
    </div>
  )
}
