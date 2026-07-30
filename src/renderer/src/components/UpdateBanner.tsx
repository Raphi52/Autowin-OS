import { useEffect, useState } from 'react'
import './UpdateBanner.css'

interface UpdateInfo {
  available: boolean
  behind: number
  /** Branche SORTIE — n'est PAS ce qui est comparé (cf. `reference`). */
  branch?: string
  /** Référence réellement comparée (`origin/main`, ou l'upstream en repli). */
  reference?: string
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

  // Nommer la RÉFÉRENCE comparée, pas la branche sortie : le compte vient de `origin/main`, donc
  // afficher « N commits sur feat/x » était faux. Si l'utilisateur n'est pas sur main, on le dit —
  // le bouton refusera de muter sa branche, autant qu'il le sache avant de cliquer.
  const reference = info.reference ?? 'origin/main'
  const elsewhere = info.branch && info.branch !== 'main' ? ` · tu es sur ${info.branch}` : ''
  const detail = `${info.behind} commit(s) à récupérer depuis ${reference}${elsewhere}`
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
