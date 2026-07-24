import { useEffect, useState } from 'react'
import './UpdateBanner.css'

interface UpdateInfo {
  available: boolean
  behind: number
  branch?: string
}

/**
 * Bannière auto-update git : au montage, interroge `update:check` (non-bloquant). Si la branche locale
 * est en retard, propose « Appliquer + redémarrer » (pull + npm install si besoin + relaunch côté main).
 * Silencieuse si à jour, hors repo git, ou fermée par l'utilisateur.
 */
export function UpdateBanner(): React.JSX.Element | null {
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string>()
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let alive = true
    void window.api.checkUpdate?.().then((r) => {
      if (alive) setInfo(r as UpdateInfo)
    })
    return () => {
      alive = false
    }
  }, [])

  if (dismissed || !info?.available) return null

  const apply = async (): Promise<void> => {
    setApplying(true)
    setError(undefined)
    const r = await window.api.applyUpdate?.()
    // Succès → le main relance l'app (app.relaunch/quit) : rien à faire ici. Échec → afficher la raison.
    if (!r?.ok) {
      setError(r?.error ?? 'Échec de la mise à jour.')
      setApplying(false)
    }
  }

  return (
    <div className="update-banner" data-testid="update-banner" role="status">
      <span className="update-banner-msg">
        🔄 Mise à jour disponible — <strong>{info.behind}</strong> commit(s) sur{' '}
        <code>{info.branch ?? 'la branche'}</code>.
      </span>
      {error && <span className="update-banner-error">{error}</span>}
      <span className="update-banner-actions">
        <button
          className="update-banner-apply"
          data-testid="update-apply"
          disabled={applying}
          onClick={() => void apply()}
        >
          {applying ? 'Application…' : 'Appliquer + redémarrer'}
        </button>
        <button
          className="update-banner-later"
          data-testid="update-later"
          disabled={applying}
          onClick={() => setDismissed(true)}
        >
          Plus tard
        </button>
      </span>
    </div>
  )
}
