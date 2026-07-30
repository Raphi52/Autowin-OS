import { useEffect, useState } from 'react'
import './UpdateBanner.css'

interface UpdateInfo {
  available: boolean
  behind: number
  branch?: string
}

/**
 * Bouton de mise à jour, au bas du rail.
 *
 * C'était une bannière pleine largeur en tête d'application : elle mangeait la moitié de l'écran
 * pour une information qui n'est jamais urgente. Une mise à jour disponible se SIGNALE, elle
 * n'interrompt pas — d'où un bouton discret, à sa place au bas de la barre, qui attend d'être
 * cliqué. Pas de « plus tard » : un bouton qui ne gêne personne n'a pas besoin d'être congédié.
 *
 * Rail replié → l'icône seule, l'information reste dans l'infobulle.
 */
export function UpdateBanner({ collapsed = false }: { collapsed?: boolean }): React.JSX.Element | null {
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let alive = true
    void window.api.checkUpdate?.().then((r) => {
      if (alive) setInfo(r as UpdateInfo)
    })
    return () => {
      alive = false
    }
  }, [])

  if (!info?.available) return null

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

  const detail = `${info.behind} commit(s) sur ${info.branch ?? 'la branche'}`
  return (
    <div className="rail-update" data-testid="update-banner">
      <button
        type="button"
        className="rail-update-btn"
        data-testid="update-apply"
        disabled={applying}
        title={applying ? 'Mise à jour en cours…' : `Mettre à jour — ${detail}, puis redémarrer`}
        onClick={() => void apply()}
      >
        <span className="rail-update-icon" aria-hidden="true">
          ⟳
        </span>
        {!collapsed && (
          <span className="rail-update-label">
            {applying ? 'Mise à jour…' : 'Mettre à jour'}
            <span className="rail-update-count">{info.behind}</span>
          </span>
        )}
      </button>
      {error && !collapsed && (
        <span className="rail-update-error" data-testid="update-error" role="status">
          {error}
        </span>
      )}
    </div>
  )
}
