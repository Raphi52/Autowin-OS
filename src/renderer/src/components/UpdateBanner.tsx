import { useCallback, useEffect, useRef, useState } from 'react'
import { depuis } from './depuis'
import { type IncomingCommit, type UpdateStrategy } from '../../../shared/update-contract'
import { langueCourante } from '../langue'
import {
  traduireArtefactsEtBandeaux,
  useTextesArtefactsEtBandeaux,
  type CleArtefactsEtBandeaux
} from '../textes-ecrans/artefacts-et-bandeaux'
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
/**
 * Nom et aide de chaque voie, dans la langue de l'app (conv-1170). Le français est celui de
 * `UPDATE_STRATEGY_LABELS` / `UPDATE_STRATEGY_HINTS` (shared/update-contract.ts), recopié dans la
 * table des textes ; ArtefactsEtBandeaux.langue.test.tsx refuse que les deux divergent.
 */
const CLES_DES_VOIES: Record<
  UpdateStrategy,
  { nom: CleArtefactsEtBandeaux; aide: CleArtefactsEtBandeaux }
> = {
  'fast-forward': { nom: 'maj.voie.fast-forward', aide: 'maj.aide.fast-forward' },
  merge: { nom: 'maj.voie.merge', aide: 'maj.aide.merge' },
  rebase: { nom: 'maj.voie.rebase', aide: 'maj.aide.rebase' },
  'switch-main': { nom: 'maj.voie.switch-main', aide: 'maj.aide.switch-main' }
}

/** Un texte de la table, dans la langue du moment de l'appel (hors rendu : messages d'échec). */
const texte = (cle: CleArtefactsEtBandeaux, valeurs?: Record<string, string | number>): string =>
  traduireArtefactsEtBandeaux(cle, langueCourante(), valeurs)

const UPDATE_STRATEGY_GLYPHS: Record<UpdateStrategy, string> = {
  'fast-forward': '⇧',
  merge: '⎇',
  rebase: '↻',
  'switch-main': '↰'
}

/** Le NOM du fichier : le chemin entier ne tient pas dans le rail, il reste dans l'infobulle. */
function nomDeFichier(chemin: string): string {
  return chemin.split('/').pop() || chemin
}

/**
 * Le sujet tel qu'une NOTE DE VERSION le dit. Les commits automatiques portent `auto(conv-NNN): `
 * ou `auto(<run>): ` (chat-turn-publication.ts, run-autoclose.ts) pour être reconnaissables dans
 * l'historique git ; dans cette liste, ce préfixe n'apprend rien à qui lit — retiré à l'affichage
 * seulement, l'infobulle garde le sujet entier (demande du 2026-10-19, conv-1020).
 * Depuis conv-1069, ces commits prennent le format du dépôt `type(zone): phrase (conv-N)`
 * (titre-de-commit.ts) : le préfixe `type(zone):` et le suffixe `(conv-N)` / `(run-…)` sont retirés
 * de la même façon, sinon la règle de conv-1020 ne cachait plus rien.
 */
function sujetLisible(sujet: string): string {
  return (
    sujet
      .replace(/^auto\([^)]*\):\s*/, '')
      .replace(/^[a-z]+\([^)]*\)!?:\s*/, '')
      .replace(/\s*\((?:conv|run)-[\w-]+\)\s*$/, '')
      .trim() || sujet
  )
}

/** Infobulle d'un commit : ce que la ligne compacte ne peut pas montrer (hash, date exacte, TOUS les fichiers lus). */
function infobulleCommit(commit: IncomingCommit): string {
  const reste = commit.fileCount - commit.files.length
  return [
    `${commit.hash.slice(0, 10)} · ${commit.author} · ${commit.date}`,
    commit.subject,
    ...commit.files,
    ...(reste > 0 ? [texte('maj.autresFichiers', { nombre: reste })] : [])
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
    title: texte('maj.titreConversation'),
    category: provider,
    provider
  })
  if (!conversation?.id) return
  try {
    await window.api.appCommand?.('navigate', { tab: 'chat' })
  } catch {
    /* navigation refusée : le prompt reste préparé dans la conversation */
  }
  /*
   * LA PROCÉDURE VIT DANS `skills/maj/SKILL.md`, le bouton ne fait que l'invoquer (conv-1036).
   * L'ancienne consigne en ligne disait « mets le fichier de côté (git stash) » : le garde-fou le
   * refuse aux agents (src/shared/garde-git-destructeur.ts), et conv-1023 s'est rabattu sur une
   * branche `autowin/recovery/…` que l'app a publiée et poussée toute seule. La skill porte la voie
   * sûre (branche `sauvegarde/…`) et la règle « ne réintroduis jamais ce que main a retiré ».
   * Ce prompt RESTE EN FRANÇAIS quelle que soit la langue de l'app (conv-1170) : c'est une consigne
   * pour l'agent, et `skills-gel-maj.routables.test.ts` vérifie qu'il route vers `/maj`.
   */
  const prompt =
    `/maj La mise à jour d'Autowin est bloquée : « ${raison} ». Résous le blocage puis relance la ` +
    `mise à jour. Termine par la liste de ce que tu as gardé et de ce que tu as écarté.`
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
  const { t } = useTextesArtefactsEtBandeaux()
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
          // Message figé dans la langue du moment de l'échec, comme ceux que rend le main.
          setCheckError(nextInfo.error || texte('maj.verificationImpossible'))
          return
        }
        setInfo(nextInfo)
        setCheckError(undefined)
      })
      .catch((reason: unknown) => {
        if (generation !== checkGeneration.current || applyOwnsBanner.current) return
        setCheckError(errorMessage(reason, texte('maj.verificationImpossible')))
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
    const retryLabel = t('maj.verificationReessayer', { erreur: checkError })
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
          {!collapsed && <span className="rail-update-label">{t('maj.reessayer')}</span>}
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
          setApplyError(texte('maj.etatChange', { voie: texte(CLES_DES_VOIES[strategy].nom) }))
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
      setApplyError(r?.error ?? texte('maj.echec'))
      setApplying(null)
    } catch (reason) {
      applyOwnsBanner.current = false
      setApplyError(errorMessage(reason, texte('maj.echec')))
      setApplying(null)
    }
  }

  // Nommer la RÉFÉRENCE comparée, pas la branche sortie : le compte vient de `origin/main`, donc
  // afficher « N commits sur feat/x » était faux. Si l'utilisateur n'est pas sur main, on le dit.
  const reference = info.reference ?? 'origin/main'
  const elsewhere =
    info.branch && info.branch !== 'main' ? t('maj.ailleurs', { branche: info.branch }) : ''
  const dirtyNote = info.dirty ? t('maj.travailEnCours') : ''
  const detail = t('maj.detail', {
    nombre: info.behind,
    reference,
    ailleurs: elsewhere,
    travail: dirtyNote
  })
  const nomDeVoie = (voie: UpdateStrategy): string => t(CLES_DES_VOIES[voie].nom)
  const aideDeVoie = (voie: UpdateStrategy): string => t(CLES_DES_VOIES[voie].aide)
  const buttonState = applying ? ' is-applying' : applyError ? ' is-error' : ''
  const incoming = info.incoming ?? []
  const incomingHidden = info.behind - incoming.length
  const whoLabel =
    incoming.length === 1
      ? t('maj.quiLeCommit', { reference })
      : t('maj.quiLesCommits', { nombre: incoming.length, reference })
  const actionLabel = applying
    ? t('maj.enCours')
    : applyError
      ? t('maj.echecReessayer', { erreur: applyError })
      : `${nomDeVoie(primary)} — ${detail}. ${aideDeVoie(primary)}`
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
            {/* A5 « Œil qui s'ouvre » (conv-182) : FERMÉ (paupière et trois cils) tant que la liste
                est repliée, OUVERT quand elle est dépliée — le dessin dit l'état. Le rond qui
                l'entoure est dessiné par `.rail-update-who` (UpdateBanner.css). */}
            <svg
              viewBox="0 0 24 24"
              width="12"
              height="12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              data-oeil={incomingOpen ? 'ouvert' : 'ferme'}
            >
              {incomingOpen ? (
                <>
                  <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
                  <circle cx="12" cy="12" r="3" />
                </>
              ) : (
                <>
                  <path d="M2.5 8c2.7 3.8 6 5.6 9.5 5.6s6.8-1.8 9.5-5.6" />
                  <path d="M5.6 11.4l-1.7 2.1" />
                  <path d="M12 13.7v2.7" />
                  <path d="M18.4 11.4l1.7 2.1" />
                </>
              )}
            </svg>
          </button>
        )}
        <button
          type="button"
          className={`rail-update-btn capsule-bouton${buttonState}`}
          data-testid="update-apply"
          disabled={applying !== null}
          aria-label={actionLabel}
          title={actionLabel}
          onClick={() => void apply(primary)}
        >
          {/* MÊME GUEULE QUE DÉTAILS (conv-181) : le balisage de la capsule, dessiné par les règles
              `.capsule-bouton` de ChatView.css. Le nombre de commits va dans la pastille sombre. */}
          <span className="thinking-capsule">
            <span className="thinking-capsule-icone rail-update-icon" aria-hidden="true">
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
              <>
                <span className="thinking-label rail-update-label">
                  {applying ? t('maj.miseAJour') : nomDeVoie(primary)}
                </span>
                <span className="thinking-duree rail-update-count">+{info.behind}</span>
              </>
            )}
          </span>
        </button>
      </div>
      {incomingOpen && incoming.length > 0 && (
        <ol
          id="rail-update-incoming"
          className={`rail-update-incoming${collapsed ? ' is-floating' : ''}`}
          data-testid="update-incoming"
          aria-label={t('maj.commitsARecuperer', { reference })}
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
              <div className="rail-update-commit-subject">{sujetLisible(commit.subject)}</div>
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
              {t('maj.plusAnciens', { nombre: incomingHidden })}
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
          aria-label={t('maj.autresFacons', { reference })}
          title={t('maj.autresFacons', { reference })}
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
              aria-label={`${nomDeVoie(strategy)} — ${aideDeVoie(strategy)}`}
              title={`${nomDeVoie(strategy)} — ${aideDeVoie(strategy)}`}
              onClick={() => void apply(strategy)}
            >
              {collapsed ? (
                <span aria-hidden="true">{UPDATE_STRATEGY_GLYPHS[strategy]}</span>
              ) : (
                nomDeVoie(strategy)
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
            className={`rail-update-repair capsule-bouton${collapsed ? ' is-glyph' : ''}`}
            data-testid="update-repair"
            aria-label={t('maj.faireReparerAria')}
            onClick={() => void reparerBlocageUpdate(applyError)}
            title={t('maj.faireReparerAide')}
          >
            {/* Capsule comme Détails (conv-181) : la clé est DESSINÉE (trait blanc dans le rond
                dégradé, comme l'icône de Détails), plus l'emoji clé en couleur. */}
            <span className="thinking-capsule">
              <span className="thinking-capsule-icone" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                </svg>
              </span>
              {!collapsed && <span className="thinking-label">{t('maj.faireReparer')}</span>}
            </span>
          </button>
        </>
      )}
    </div>
  )
}
