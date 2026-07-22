import React, { useCallback, useEffect, useRef, useState } from 'react'
import './FirstRunWizard.css'

/**
 * #5 — Wizard first-run. L'installeur NSIS installe l'APP, mais ne peut pas tout automatiser (OAuth
 * codex/claude interactif, brain_server = service Python séparé, tokens secrets). Ce wizard DÉTECTE
 * l'état réel (via preflight:recheck), GUIDE explicitement le reste (étapes/commandes exactes), et
 * offre un bouton "re-vérifier". HONNÊTE : il ne prétend JAMAIS avoir configuré ce qu'il n'a pas fait.
 * S'affiche au 1er lancement (drapeau localStorage) ou sur demande.
 */
const DONE_KEY = 'autowin:first-run-done'

interface Check {
  id: string
  label: string
  ok: boolean
  detail?: string
}
interface PreflightResult {
  ok: boolean
  summary: string
  checks: Check[]
}

export function FirstRunWizard(): React.JSX.Element | null {
  const [open, setOpen] = useState(() => localStorage.getItem(DONE_KEY) !== '1')
  const [result, setResult] = useState<PreflightResult | null>(null)
  const [checking, setChecking] = useState(false)

  const reqRef = useRef(0)
  const recheck = useCallback(async (force = false) => {
    if (!window.api?.recheckPreflight) return
    const req = ++reqRef.current
    setChecking(true)
    try {
      const r = await window.api.recheckPreflight(force)
      // Anti-race (Corrector) : ignorer une réponse périmée si un appel plus récent a démarré.
      if (req === reqRef.current) setResult(r)
    } finally {
      if (req === reqRef.current) setChecking(false)
    }
  }, [])

  useEffect(() => {
    if (open) void recheck(false) // montage : sans force → partage le cache du run de démarrage
  }, [open, recheck])

  if (!open) return null
  const finish = (): void => {
    localStorage.setItem(DONE_KEY, '1')
    setOpen(false)
  }
  return (
    <div className="frw-overlay" role="dialog" aria-modal="true" data-testid="first-run-wizard">
      <div className="frw-card">
        <h2>Bienvenue dans Autowin OS</h2>
        <p className="frw-sub">
          Vérification des dépendances externes. L'installeur a posé l'app ; certaines dépendances se
          configurent une seule fois, ici.
        </p>
        <ul className="frw-checks">
          {(result?.checks ?? []).map((c) => (
            <li key={c.id} className={c.ok ? 'ok' : 'ko'} data-testid={`frw-check-${c.id}`}>
              <span className="frw-icon">{c.ok ? '✓' : '✗'}</span>
              <span className="frw-label">{c.label}</span>
              {!c.ok && c.detail ? <span className="frw-detail">{c.detail}</span> : null}
            </li>
          ))}
          {!result && <li className="frw-loading">Vérification…</li>}
        </ul>
        <div className="frw-actions">
          <button type="button" onClick={() => void recheck(true)} disabled={checking}>
            {checking ? 'Vérification…' : 'Re-vérifier'}
          </button>
          <button type="button" className="frw-primary" onClick={finish}>
            {result?.ok ? 'Terminer' : 'Continuer quand même'}
          </button>
        </div>
      </div>
    </div>
  )
}
