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
  const [error, setError] = useState<string | null>(null)

  const reqRef = useRef(0)
  const initialActionRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const recheck = useCallback(async (force = false) => {
    if (!window.api?.recheckPreflight) {
      setError('Le diagnostic est indisponible. Réessayez après le redémarrage de l’application.')
      return
    }
    const req = ++reqRef.current
    setChecking(true)
    setError(null)
    try {
      const r = await window.api.recheckPreflight(force)
      // Anti-race (Corrector) : ignorer une réponse périmée si un appel plus récent a démarré.
      if (req === reqRef.current) setResult(r)
    } catch {
      if (req === reqRef.current) setError('Le diagnostic a échoué. Vérifiez la configuration puis réessayez.')
    } finally {
      if (req === reqRef.current) setChecking(false)
    }
  }, [])

  useEffect(() => {
    if (open) void recheck(false) // montage : sans force → partage le cache du run de démarrage
  }, [open, recheck])

  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    initialActionRef.current?.focus()
    return () => {
      previousFocusRef.current?.focus()
      previousFocusRef.current = null
    }
  }, [open])

  if (!open) return null
  const trapFocus = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab') return
    const actions = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])')
    )
    if (actions.length === 0) return
    const first = actions[0]
    const last = actions[actions.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }
  const finish = (): void => {
    localStorage.setItem(DONE_KEY, '1')
    setOpen(false)
  }
  return (
    <div
      className="frw-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="first-run-wizard-title"
      data-testid="first-run-wizard"
      onKeyDown={trapFocus}
    >
      <div className="frw-card">
        <h2 id="first-run-wizard-title">Bienvenue dans Autowin OS</h2>
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
          {error ? (
            <li className="frw-error" role="alert">
              {error}
            </li>
          ) : null}
          {!result && !error && <li className="frw-loading">Vérification…</li>}
        </ul>
        <div className="frw-actions">
          <button
            ref={initialActionRef}
            type="button"
            onClick={() => void recheck(true)}
            disabled={checking}
          >
            {checking ? 'Vérification…' : error ? 'Réessayer' : 'Re-vérifier'}
          </button>
          <button type="button" className="frw-primary" onClick={finish}>
            {result?.ok ? 'Terminer' : 'Continuer quand même'}
          </button>
        </div>
      </div>
    </div>
  )
}
