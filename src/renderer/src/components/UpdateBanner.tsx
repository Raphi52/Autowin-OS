import { useCallback, useEffect, useRef, useState } from 'react'
import {
  UPDATE_STRATEGY_HINTS,
  UPDATE_STRATEGY_LABELS,
  type IncomingCommit,
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
  /** Ce qui arrivera : auteur, date, sujet, fichiers. Absent si git n'a pas pu le lire. */
  incoming?: IncomingCommit[]
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
 *
 * Salvage du 2026-08-27 (branche autowin/recovery/command-edit-…-updatebanner-tsx, f4a52bb) : la
 * STRUCTURE de main est conservée (table + classe `is-glyph`), seules les VALEURS sont reprises du
 * travail bloqué — ⤳ et ⑃ tombent en glyphe de substitution sur les polices Windows par défaut.
 */
const UPDATE_STRATEGY_GLYPHS: Record<UpdateStrategy, string> = {
  'fast-forward': '⇧',
  merge: '⎇',
  rebase: '↻',
  'switch-main': '↰'
}

/** « il y a 2 h » — une date ISO en relatif français ; la date brute si elle est illisible. */
export function depuis(dateIso: string, maintenant: number = Date.now()): string {
  const instant = Date.parse(dateIso)
  if (!Number.isFinite(instant)) return dateIso
  const secondes = Math.round((instant - maintenant) / 1000)
  const format = new Intl.RelativeTimeFormat('fr', { numeric: 'auto', style: 'short' })
  const paliers: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60]
  ]
  for (const [unite, duree] of paliers) {
    if (Math.abs(secondes) >= duree) return format.format(Math.round(secondes / duree), unite)
  }
  return 'à l’instant'
}

/** Le NOM du fichier : le chemin entier ne tient pas dans le rail, il reste dans l'infobulle. */
function nomDeFichier(chemin: string): string {
  return chemin.split('/').pop() || chemin
}

/** Infobulle d'un commit : ce que la ligne compacte ne peut pas montrer (hash, date exacte, TOUS les fichiers lus). */
function infobulleCommit(commit: IncomingCommit): string {
  const reste = commit.fileCount - commit.files.length
  return [
    `${commit.hash.slice(0, 10)} · ${commit.author} · ${commit.date}`,
    commit.subject,
    ...commit.files,
    ...(reste > 0 ? [`… et ${reste} autre(s) fichier(s)`] : [])
  ].join('\n')
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback
}

/**
 * « Faire réparer » : le fix que l'utilisateur relance À LA MAIN à chaque update bloqué (committer /
 * mettre de côté son travail, ou résoudre le conflit). On le pré-remplit dans une conversation dédiée
 * — même chemin que « Prompter dans Autowin » du veille (`autowin:prefill-conversation`) —
 * et on l'ENVOIE tout de suite (`send: true`) : le clic EST la validation. Redemander une seconde
 * validation par Entrée faisait refaire à l'utilisateur le geste qu'il venait de faire
 * (demande du 2026-09-03). Provider résolu depuis les RÔLES, jamais un défaut inventé ;
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
    `La mise à jour d'Autowin est bloquée : « ${raison} ». Résous le blocage puis relance la mise à ` +
    `jour. Mon travail local peut être PÉRIMÉ : une vieille copie reprise ici contient souvent des ` +
    `choses que main a retirées depuis (annulation, suppression). Avant de committer ou de trancher un ` +
    `conflit, compare chaque fichier à la version entrante (git fetch puis git diff HEAD..origin/main, ` +
    `et git log origin/main sur ces fichiers) : ne réintroduis jamais ce que main a supprimé ou annulé, ` +
    `garde seulement mes vraies modifications récentes. Dans le doute, mets le fichier de côté ` +
    `(git stash) plutôt que de le committer. Termine par la liste de ce que tu as gardé et de ce que ` +
    `tu as écarté.`
  window.dispatchEvent(
    new CustomEvent('autowin:prefill-conversation', {
      detail: { conversationId: conversation.id, prompt, send: true }
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
  const [incomingOpen, setIncomingOpen] = useState(false)
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

  /**
   * Relit l'état du dépôt, ou `undefined` si la sonde est indisponible/en erreur. Un échec de sonde
   * ne doit RIEN bloquer : on retombe alors sur le choix cliqué, et la garde du main reste le
   * dernier rempart.
   */
  const relireEtat = async (): Promise<UpdateInfo | undefined> => {
    try {
      const fresh = (await window.api.checkUpdate?.()) as UpdateInfo | undefined
      return fresh && fresh.error === undefined ? fresh : undefined
    } catch {
      return undefined
    }
  }

  /**
   * Applique une voie d'intégration, mais RE-SONDE le dépôt juste avant.
   *
   * Le choix affiché peut avoir jusqu'à trois minutes de retard (durée du cycle de sonde), et
   * l'état réel bouge sans passer par ce bouton : un `git pull` dans un terminal, une copie de
   * travail d'agent, un commit poussé entre-temps. On envoyait alors au main une voie devenue
   * inapplicable, et il la refusait à juste titre — « La stratégie « rebase » ne s'applique pas
   * depuis « main ». ». Un refus qui ne dit rien de l'état courant et n'offre aucune issue :
   * l'utilisateur ne pouvait que recliquer le même bouton périmé (constaté le 2026-09-04, alors
   * que `main` était déjà exactement alignée sur `origin/main`).
   *
   * Trois issues après la re-sonde, et AUCUNE n'est un refus :
   * - plus rien à intégrer → on rafraîchit, le bouton disparaît de lui-même ;
   * - une seule voie reste → ce n'est plus un choix mais la seule porte, on la prend ;
   * - plusieurs voies restent → on REPOSE la question avec la liste à jour. Choisir à la place de
   *   l'utilisateur quand plusieurs historiques sont possibles reste interdit : c'est exactement la
   *   garde que ce composant protège (aucune fusion fabriquée sur la branche de quelqu'un).
   */
  const apply = async (strategy: UpdateStrategy): Promise<void> => {
    applyOwnsBanner.current = true
    setApplying(strategy)
    setApplyError(undefined)
    setChoicesOpen(false)

    let retenue = strategy
    const fresh = await relireEtat()
    if (fresh) {
      const encorePossibles = fresh.strategies?.length
        ? fresh.strategies
        : (['fast-forward'] as UpdateStrategy[])
      if (!fresh.available) {
        applyOwnsBanner.current = false
        setApplying(null)
        setInfo(fresh)
        return
      }
      if (!encorePossibles.includes(strategy)) {
        if (encorePossibles.length === 1) {
          retenue = encorePossibles[0]
          setApplying(retenue)
        } else {
          applyOwnsBanner.current = false
          setApplying(null)
          setInfo(fresh)
          setChoicesOpen(true)
          setApplyError(
            `L’état du dépôt a changé : « ${UPDATE_STRATEGY_LABELS[strategy]} » ne s’applique plus. ` +
              `Choisis parmi les voies encore possibles.`
          )
          return
        }
      }
      setInfo(fresh)
    }

    try {
      const r = await window.api.applyUpdate?.(retenue)
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
      // ÉCHEC → le bouton REND la main aux sondes. Ce relâchement manquait ici et dans le `catch` :
      // le verrou posé au début d'`apply` restait pris à vie, donc `check()` (cycle de 3 minutes ET
      // retour de focus) jetait tous ses résultats et le bouton figeait le dernier compte connu.
      applyOwnsBanner.current = false
      setApplyError(r?.error ?? 'Échec de la mise à jour.')
      setApplying(null)
    } catch (reason) {
      applyOwnsBanner.current = false
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
  const incoming = info.incoming ?? []
  const incomingHidden = info.behind - incoming.length
  const whoLabel = `Qui a poussé quoi ? — voir ${incoming.length === 1 ? 'le commit' : `les ${incoming.length} commits`} à récupérer depuis ${reference}`
  const actionLabel = applying
    ? 'Mise à jour en cours'
    : applyError
      ? `Échec de la mise à jour : ${applyError}. Réessayer`
      : `${UPDATE_STRATEGY_LABELS[primary]} — ${detail}. ${UPDATE_STRATEGY_HINTS[primary]}`
  return (
    <div className="rail-update" data-testid="update-banner">
      <div className="rail-update-row">
        {incoming.length > 0 && (
          <button
            type="button"
            className="rail-update-who"
            data-testid="update-incoming-toggle"
            aria-expanded={incomingOpen}
            aria-controls="rail-update-incoming"
            aria-label={whoLabel}
            title={whoLabel}
            onClick={() => setIncomingOpen((open) => !open)}
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        )}
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
      </div>
      {incomingOpen && incoming.length > 0 && (
        <ol
          id="rail-update-incoming"
          className={`rail-update-incoming${collapsed ? ' is-floating' : ''}`}
          data-testid="update-incoming"
          aria-label={`Commits à récupérer depuis ${reference}`}
        >
          {incoming.map((commit) => (
            <li
              key={commit.hash}
              className="rail-update-commit"
              data-testid="update-incoming-commit"
              title={infobulleCommit(commit)}
            >
              <div className="rail-update-commit-head">
                <b className="rail-update-commit-author">{commit.author}</b>
                <span className="rail-update-commit-when">{depuis(commit.date)}</span>
              </div>
              <div className="rail-update-commit-subject">{commit.subject}</div>
              {commit.fileCount > 0 && (
                <div className="rail-update-commit-files">
                  {commit.files.slice(0, 3).map(nomDeFichier).join(', ')}
                  {commit.fileCount > 3 && ` +${commit.fileCount - 3}`}
                </div>
              )}
            </li>
          ))}
          {incomingHidden > 0 && (
            <li className="rail-update-commit-more">
              … et {incomingHidden} commit(s) plus ancien(s)
            </li>
          )}
        </ol>
      )}
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
            title={applyError}
          >
            {applyError}
          </span>
          {/* Le geste que l'utilisateur refaisait à chaque blocage : on l'automatise (pré-rempli). */}
          <button
            type="button"
            className={`rail-update-repair${collapsed ? ' is-glyph' : ''}`}
            data-testid="update-repair"
            aria-label="Faire réparer le blocage de mise à jour"
            onClick={() => void reparerBlocageUpdate(applyError)}
            title="Ouvre une conversation et pré-remplit un prompt pour que l'agent résolve ce blocage, puis relance la mise à jour"
          >
            {collapsed ? <span aria-hidden="true">🔧</span> : '🔧 Faire réparer'}
          </button>
        </>
      )}
    </div>
  )
}
