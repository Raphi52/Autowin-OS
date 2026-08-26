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
  /** Travail en cours : la mise à jour est tentée telle quelle et refusée si elle entre en conflit (aucun stash). */
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

/**
 * Rail REPLIÉ : le libellé plein débordait du bouton (36 px de large). Une icône par voie, le nom
 * reste porté par `aria-label` / `title` — le sens n'est pas perdu, il est déplacé.
 */
const UPDATE_STRATEGY_GLYPHS: Record<UpdateStrategy, string> = {
  'fast-forward': '⇧',
  merge: '⑃',
  rebase: '⤳',
  'switch-main': '⎇'
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback
}

/**
 * « Faire réparer » : le fix que l'utilisateur relance À LA MAIN à chaque update bloqué (committer /
 * mettre de côté son travail, ou résoudre le conflit). On le pré-remplit dans une conversation dédiée
 * — même chemin que « Prompter dans Autowin » du veille (`autowin:prefill-conversation`, send:false) —
 * il n'a plus qu'à valider d'un Entrée. Provider résolu depuis les RÔLES, jamais un défaut inventé ;
 * sans provider on n'ouvre RIEN (mieux que créer une conversation inutilisable).
 */
async function reparerBlocageUpdate(raison: string): Promise<void> {
  const roleMap = await window.api.roles?.()
  const provider =
    roleMap?.orchestrator?.provider ??
    roleMap?.subagent?.provider ??
    (roleMap ? Object.values(roleMap)[0]?.provider : undefined)
  if (!provider) return
  const conversation = await window.api.conversationsCreate?.({
    title: 'Réparer la mise à jour',
    category: provider,
    provider
  })
  if (!conversation?.id) return
  try {
    await window.api.appCommand?.('navigate', { tab: 'chat' })
  } catch {
    /* navigation refusée : le prompt reste préparé dans la conversation */
  }
  const prompt =
    `La mise à jour d'Autowin est bloquée : « ${raison} ». Résous le blocage — committe ou mets de ` +
    `côté mon travail non committé selon le cas, ou résous le conflit d'intégration — puis relance la ` +
    `mise à jour.`
  window.dispatchEvent(
    new CustomEvent('autowin:prefill-conversation', {
      detail: { conversationId: conversation.id, prompt, send: false }
    })
  )
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
  const dirtyNote = info.dirty
    ? ' · ton travail en cours reste en place ; la mise à jour est refusée si elle entre en conflit'
    : ''
  const detail = `${info.behind} commit(s) à récupérer depuis ${reference}${elsewhere}${dirtyNote}`
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
              className={`rail-update-choice${collapsed ? ' is-glyph' : ''}`}
              data-testid={`update-choice-${strategy}`}
              disabled={applying !== null}
              aria-label={`${UPDATE_STRATEGY_LABELS[strategy]} — ${UPDATE_STRATEGY_HINTS[strategy]}`}
              title={`${UPDATE_STRATEGY_LABELS[strategy]} — ${UPDATE_STRATEGY_HINTS[strategy]}`}
              onClick={() => void apply(strategy)}
            >
              {collapsed ? (
                <span aria-hidden="true">{UPDATE_STRATEGY_GLYPHS[strategy]}</span>
              ) : (
                UPDATE_STRATEGY_LABELS[strategy]
              )}
            </button>
          ))}
        </div>
      )}
      {applyError && (
        <>
          <span
            className={`rail-update-error${collapsed ? ' is-visually-hidden' : ''}`}
            data-testid="update-error"
            role="status"
          >
            {applyError}
          </span>
          {/* Le geste que l'utilisateur refaisait à chaque blocage : on l'automatise (pré-rempli). */}
          <button
            type="button"
            className={`rail-update-repair${collapsed ? ' is-visually-hidden' : ''}`}
            data-testid="update-repair"
            onClick={() => void reparerBlocageUpdate(applyError)}
            title="Ouvre une conversation et pré-remplit un prompt pour que l'agent résolve ce blocage, puis relance la mise à jour"
          >
            🔧 Faire réparer
          </button>
        </>
      )}
    </div>
  )
}
