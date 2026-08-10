import { useCallback, useEffect, useRef, useState } from 'react'
import {
  UPDATE_STRATEGY_HINTS,
  UPDATE_STRATEGY_LABELS,
  type UpdateStrategy
} from '../../../shared/update-contract'
import './UpdateBanner.css'

interface UpdateInfo {
  available: boolean
  behind: number
  /** Branche SORTIE — n'est PAS ce qui est comparé (cf. `reference`). */
  branch?: string
  /** Référence réellement comparée (`origin/main`, ou l'upstream en repli). */
  reference?: string
  /** Travail en cours : il sera mis de côté puis remis (`--autostash`), plus jamais un refus. */
  dirty?: boolean
  /** Voies d'intégration possibles ici, la première étant la recommandée. */
  strategies?: UpdateStrategy[]
  error?: string
}

/**
 * Sonde toutes les 3 minutes. C'était UNE SEULE fois au montage : un collègue qui laissait l'app
 * ouverte toute la journée ne voyait un nouveau commit qu'au redémarrage suivant. 3 minutes est un
 * `git fetch --quiet` local — négligeable — pour une information dont la fraîcheur est tout l'intérêt.
 */
const POLL_INTERVAL_MS = 180_000

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback
}

/**
 * Bouton de mise à jour, au bas du rail.
 *
 * C'était une bannière pleine largeur en tête d'application : elle mangeait la moitié de l'écran
 * pour une information qui n'est jamais urgente. Une mise à jour disponible se SIGNALE, elle
 * n'interrompt pas — d'où un bouton discret, à sa place au bas de la barre, qui attend d'être
 * cliqué. Pas de « plus tard » : un bouton qui ne gêne personne n'a pas besoin d'être congédié.
 *
 * SOUPLESSE (et sa limite) : hors de `main`, on ne refuse plus — on PROPOSE les trois voies
 * (fusionner, rebaser, basculer) et chaque bouton DIT ce qu'il fait. Ce qui reste interdit est de
 * choisir à la place de l'utilisateur : aucune fusion n'est fabriquée sur sa branche sans son clic.
 *
 * Rail replié → l'icône seule, l'information reste dans l'infobulle.
 */
export function UpdateBanner({
  collapsed = false
}: {
  collapsed?: boolean
}): React.JSX.Element | null {
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [applying, setApplying] = useState<UpdateStrategy | null>(null)
  const [checkError, setCheckError] = useState<string>()
  const [applyError, setApplyError] = useState<string>()
  const [choicesOpen, setChoicesOpen] = useState(false)
  const checkGeneration = useRef(0)
  const applyOwnsBanner = useRef(false)

  const check = useCallback((): void => {
    const generation = ++checkGeneration.current
    const request = window.api.checkUpdate
    if (!request) return
    void request()
      .then((result) => {
        if (generation !== checkGeneration.current || applyOwnsBanner.current) return
        const nextInfo = result as UpdateInfo
        if (nextInfo.error !== undefined) {
          setCheckError(nextInfo.error || 'Verification des mises a jour impossible.')
          return
        }
        setInfo(nextInfo)
        setCheckError(undefined)
      })
      .catch((reason: unknown) => {
        if (generation !== checkGeneration.current || applyOwnsBanner.current) return
        setCheckError(errorMessage(reason, 'Verification des mises a jour impossible.'))
      })
  }, [])

  useEffect(() => {
    check()
    const timer = window.setInterval(check, POLL_INTERVAL_MS)
    // Revenir sur l'app est le moment où l'on veut l'information à jour : on sonde alors sans attendre
    // le prochain tour d'horloge.
    const onWake = (): void => {
      if (document.visibilityState === 'visible') check()
    }
    window.addEventListener('focus', onWake)
    document.addEventListener('visibilitychange', onWake)
    return () => {
      checkGeneration.current += 1
      window.clearInterval(timer)
      window.removeEventListener('focus', onWake)
      document.removeEventListener('visibilitychange', onWake)
    }
  }, [check])

  if (checkError) {
    const retryLabel = `Verification des mises a jour impossible : ${checkError}. Reessayer`
    return (
      <div className="rail-update" data-testid="update-banner">
        <button
          type="button"
          className="rail-update-btn is-error"
          data-testid="update-retry"
          aria-label={retryLabel}
          title={retryLabel}
          onClick={check}
        >
          <span className="rail-update-icon" aria-hidden="true">
            &#8635;
          </span>
          {!collapsed && <span className="rail-update-label">Reessayer</span>}
        </button>
        <span
          className={`rail-update-error${collapsed ? ' is-visually-hidden' : ''}`}
          data-testid="update-error"
          role="status"
        >
          {checkError}
        </span>
      </div>
    )
  }

  if (!info?.available) return null

  const strategies = info.strategies?.length
    ? info.strategies
    : (['fast-forward'] as UpdateStrategy[])
  const primary = strategies[0]
  const alternatives = strategies.slice(1)

  const apply = async (strategy: UpdateStrategy): Promise<void> => {
    applyOwnsBanner.current = true
    setApplying(strategy)
    setApplyError(undefined)
    setChoicesOpen(false)
    try {
      const r = await window.api.applyUpdate?.(strategy)
      // Succès → le main relance l'app (app.relaunch/quit) : rien à faire ici. Échec → afficher la raison.
      if (r?.ok) {
        const noEffect = r.effect === 'none' || (r.reload === false && r.relaunch === false)
        if (noEffect) {
          applyOwnsBanner.current = false
          setApplying(null)
          check()
        }
        return
      }
      setApplyError(r?.error ?? 'Échec de la mise à jour.')
      setApplying(null)
    } catch (reason) {
      setApplyError(errorMessage(reason, 'Échec de la mise à jour.'))
      setApplying(null)
    }
  }

  // Nommer la RÉFÉRENCE comparée, pas la branche sortie : le compte vient de `origin/main`, donc
  // afficher « N commits sur feat/x » était faux. Si l'utilisateur n'est pas sur main, on le dit.
  const reference = info.reference ?? 'origin/main'
  const elsewhere = info.branch && info.branch !== 'main' ? ` · tu es sur ${info.branch}` : ''
  const stash = info.dirty ? ' · ton travail en cours sera mis de côté puis remis' : ''
  const detail = `${info.behind} commit(s) à récupérer depuis ${reference}${elsewhere}${stash}`
  const buttonState = applying ? ' is-applying' : applyError ? ' is-error' : ''
  const actionLabel = applying
    ? 'Mise à jour en cours'
    : applyError
      ? `Échec de la mise à jour : ${applyError}. Réessayer`
      : `${UPDATE_STRATEGY_LABELS[primary]} — ${detail}. ${UPDATE_STRATEGY_HINTS[primary]}`
  return (
    <div className="rail-update" data-testid="update-banner">
      <button
        type="button"
        className={`rail-update-btn${buttonState}`}
        data-testid="update-apply"
        disabled={applying !== null}
        aria-label={actionLabel}
        title={actionLabel}
        onClick={() => void apply(primary)}
      >
        <span className="rail-update-icon" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            width="17"
            height="17"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4.5 9A8 8 0 0 1 18 5.5" />
            <path d="M18 2.5v3h-3.5" />
            <path d="M19.5 15A8 8 0 0 1 6 18.5" />
            <path d="M6 21.5v-3h3.5" />
          </svg>
        </span>
        {!collapsed && (
          <span className="rail-update-label">
            {applying ? 'Mise à jour…' : UPDATE_STRATEGY_LABELS[primary]}
            <span className="rail-update-count">+{info.behind}</span>
          </span>
        )}
      </button>
      {alternatives.length > 0 && (
        <button
          type="button"
          className="rail-update-more"
          data-testid="update-more"
          disabled={applying !== null}
          aria-expanded={choicesOpen}
          aria-label={`Autres façons d’intégrer ${reference}`}
          title={`Autres façons d’intégrer ${reference}`}
          onClick={() => setChoicesOpen((open) => !open)}
        >
          ⋯
        </button>
      )}
      {choicesOpen && (
        <div className="rail-update-choices" data-testid="update-choices" role="group">
          {alternatives.map((strategy) => (
            <button
              key={strategy}
              type="button"
              className="rail-update-choice"
              data-testid={`update-choice-${strategy}`}
              disabled={applying !== null}
              title={UPDATE_STRATEGY_HINTS[strategy]}
              onClick={() => void apply(strategy)}
            >
              {UPDATE_STRATEGY_LABELS[strategy]}
            </button>
          ))}
        </div>
      )}
      {applyError && (
        <span
          className={`rail-update-error${collapsed ? ' is-visually-hidden' : ''}`}
          data-testid="update-error"
          role="status"
        >
          {applyError}
        </span>
      )}
    </div>
  )
}
