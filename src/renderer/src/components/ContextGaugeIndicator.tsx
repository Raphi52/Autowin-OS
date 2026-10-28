import { useEffect, useRef, useState } from 'react'
import type { ContextGauge } from '../../../shared/context-gauge'
import { tokensCourts, type ContexteDetaille } from '../../../shared/contexte-detaille'
import { formaterDate, formaterNombre, langueCourante } from '../langue'
import { traduireChatPanneaux, useTextesChatPanneaux } from '../textes-ecrans/chat-panneaux'
import './ModelQuotaIndicator.css'
import './ContexteDetaille.css'

/**
 * LA JAUGE DE CONTEXTE, CLIQUABLE — demande utilisateur du 2026-09-06.
 *
 * Elle vivait comme un simple libellé dans l'en-tête, et son détail était logé dans la popup des
 * QUOTAS : deux sujets différents dans le même panneau. Elle ouvre désormais son propre panneau,
 * exactement comme la barre de quotas (ancrage sur la FENÊTRE, fermeture au clic dehors / Échap),
 * et le bloc contexte a quitté la popup des quotas.
 *
 * Rien n'est rendu quand la jauge est inconnue : afficher 0 % dirait « ce fil est vide » là où la
 * vérité est « on l'ignore ».
 */
export function ContextGaugeIndicator({
  gauge,
  onCompact,
  busy
}: {
  gauge?: ContextGauge
  /** Absent = AUCUN bouton Compacter : le panneau ne fabrique pas une action sans destinataire. */
  onCompact?: () => void
  busy?: boolean
}): React.JSX.Element | null {
  const { t } = useTextesChatPanneaux()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [ancrage, setAncrage] = useState<{ left: number; top: number; width: number }>()

  // Ancrage sur la FENETRE : le panneau de chat qui contient l'en-tete coupe (overflow: hidden)
  // tout ce qui deborde, un positionnement relatif au parent serait donc rogne.
  useEffect(() => {
    if (!open) return
    const placer = (): void => {
      const trigger = triggerRef.current?.getBoundingClientRect()
      if (!trigger) return
      // Meme correction que ModelQuotaIndicator : le zoom du mode malvoyant multiplie left/top.
      const z =
        (triggerRef.current as (HTMLElement & { currentCSSZoom?: number }) | null)
          ?.currentCSSZoom || 1
      const vw = window.innerWidth / z
      const width = Math.min(380, vw - 16)
      const left = Math.max(8, Math.min(trigger.left / z, vw - width - 8))
      setAncrage({ left, top: trigger.bottom / z + 8, width })
    }
    placer()
    window.addEventListener('resize', placer)
    return () => window.removeEventListener('resize', placer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  if (!gauge) return null
  const pourcent = Math.round(gauge.ratio * 100)
  const titre = t('contexte.titre', {
    utilises: formaterNombre(gauge.used),
    limite: formaterNombre(gauge.limit),
    pourcent,
    cache: formaterNombre(gauge.cacheRead)
  })
  return (
    <div
      className="chat-context-gauge-root"
      ref={rootRef}
      /*
      SURVOL = OUVERTURE — demande utilisateur du 2026-09-08. Le detail n'attend plus un clic :
      passer la souris sur la barre (meme vide, a 0 %) ouvre le panneau, le quitter le referme.
      Le panneau est un ENFANT de ce conteneur, donc y aller ne declenche pas la sortie.
      Le clic reste actif : il fige l'ouverture pour ceux qui naviguent au clavier ou au doigt.
      */
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
    >
      <button
        type="button"
        ref={triggerRef}
        className={`chat-context-gauge is-${gauge.level}`}
        title={titre}
        aria-label={titre}
        aria-expanded={open}
        data-testid="chat-context-gauge"
        onClick={() => setOpen((etat) => !etat)}
      >
        <span className="chat-context-gauge-track">
          <span className="chat-context-gauge-fill" style={{ width: `${pourcent}%` }} />
        </span>
        {t('contexte.pourcent', { n: pourcent })}
      </button>
      {open && (
        <ContextGaugeDetail
          gauge={gauge}
          onCompact={onCompact}
          busy={busy}
          fermer={() => setOpen(false)}
          style={
            ancrage
              ? {
                  position: 'fixed',
                  left: `${ancrage.left}px`,
                  top: `${ancrage.top}px`,
                  bottom: 'auto',
                  right: 'auto',
                  width: `${ancrage.width}px`
                }
              : undefined
          }
        />
      )}
    </div>
  )
}

/**
 * LE DETAIL DU CONTEXTE, SANS SON DECLENCHEUR.
 *
 * Extrait pour etre montre par DEUX endroits : la barre de l en-tete, et le filet colore
 * au-dessus du champ de saisie (demande utilisateur du 2026-09-08). Deux affichages de la MEME
 * donnee devaient offrir le meme detail ; le dupliquer les aurait fait diverger.
 *
 * Le placement n appartient pas a ce composant : chaque appelant passe son propre `style`.
 */
export function ContextGaugeDetail({
  gauge,
  contexte,
  onCompact,
  busy,
  style,
  fermer
}: {
  gauge: ContextGauge
  /** Detail par categorie mesure par le CLI : present, le panneau prend la forme de claude.exe. */
  contexte?: ContexteDetaille
  onCompact?: () => void
  busy?: boolean
  style?: React.CSSProperties
  /** Appele quand une action du panneau doit le refermer. */
  fermer?: () => void
}): React.JSX.Element {
  const { t } = useTextesChatPanneaux()
  if (contexte)
    return (
      <ContexteParCategorie
        contexte={contexte}
        level={gauge.level}
        onCompact={onCompact}
        busy={busy}
        style={style}
        fermer={fermer}
      />
    )
  const pourcent = Math.round(gauge.ratio * 100)
  const titre = t('contexte.titre', {
    utilises: formaterNombre(gauge.used),
    limite: formaterNombre(gauge.limit),
    pourcent,
    cache: formaterNombre(gauge.cacheRead)
  })
  return (
    <section
      className="model-quota-popover"
      data-testid="chat-context-popover"
      aria-label={t('contexte.aria')}
      style={style}
    >
      <header>
        <div>
          <strong>{t('contexte.aria')}</strong>
          <small>{t('contexte.fenetre')}</small>
        </div>
      </header>
      <div className="model-quota-list">
        <article
          className={`model-quota-row quota-context-gauge is-${gauge.level}`}
          data-testid="quota-context-gauge"
          aria-label={titre}
          title={titre}
        >
          <div className="model-quota-name">
            <span>
              <strong>{t('contexte.occupation')}</strong>
              <small>
                {t('contexte.detail', {
                  utilises: formaterNombre(gauge.used),
                  limite: formaterNombre(gauge.limit),
                  cache: formaterNombre(gauge.cacheRead)
                })}
              </small>
            </span>
          </div>
          <div className="model-quota-window">
            <div className="quota-context-gauge-track" aria-hidden="true">
              <i className="quota-context-gauge-fill" style={{ width: `${pourcent}%` }} />
            </div>
            <strong className="model-quota-values">
              <span>{t('contexte.occupe', { n: pourcent })}</span>
              <small>{t('contexte.frais', { n: formaterNombre(gauge.fresh) })}</small>
            </strong>
            {onCompact && (
              <button
                type="button"
                className="quota-context-compact"
                data-testid="quota-context-compact"
                disabled={busy === true}
                title={
                  busy === true
                    ? t('contexte.compaction.indisponible')
                    : // La carte du fil (conv-1059, à la place du carnet de conv-1038) montre
                      // ensuite les étapes que l'agent ne relit plus.
                      t('contexte.compaction.carte')
                }
                onClick={() => {
                  fermer?.()
                  onCompact()
                }}
              >
                {t('contexte.compacter')}
              </button>
            )}
          </div>
        </article>
      </div>
    </section>
  )
}

/**
 * « 2,5 % » — une decimale, comme les lignes du panneau de claude.exe ; separateur et signe suivent
 * la langue de l'interface (conv-1170 : « 2.5% » en anglais).
 */
function partDeFenetre(tokens: number, limite: number): string {
  return traduireChatPanneaux('contexte.pourcent', langueCourante(), {
    n: formaterNombre((tokens / limite) * 100, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    })
  })
}

/** Une liste repliable du panneau (outils MCP, fichiers memoire, skills). */
function ListeContexte({
  titre,
  elements,
  ouverte,
  testid,
  nomCourt
}: {
  titre: string
  elements: ContexteDetaille['outilsMcp']
  ouverte: boolean
  testid: string
  /** Un chemin de fichier se lit par sa FIN : le nom du fichier compte plus que le disque. */
  nomCourt?: (nom: string) => string
}): React.JSX.Element | null {
  if (elements.length === 0) return null
  return (
    <details className="ctx-liste" open={ouverte} data-testid={testid}>
      <summary>
        <span>{titre}</span>
        <span className="ctx-nombre">{elements.length}</span>
      </summary>
      <ul>
        {elements.map((e, i) => (
          <li key={`${e.nom}-${i}`} title={`${e.nom} — ${formaterNombre(e.tokens)} tokens`}>
            <span className="ctx-nom">{nomCourt ? nomCourt(e.nom) : e.nom}</span>
            <span className="ctx-tokens">{tokensCourts(e.tokens)}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}

/**
 * LE PANNEAU « CONTEXTE » A LA MANIERE DE CLAUDE.EXE (conv-1000, 2026-10-16, capture fournie) :
 * « N % utilise » et « utilise / fenetre », une barre segmentee par categorie, la liste des
 * categories (pastille, tokens, part de la fenetre), les categories DIFFEREES en fin de liste avec
 * « — » (chargees a la demande, elles n'occupent rien tant que le modele ne les appelle pas), puis
 * les listes repliables : outils MCP, fichiers memoire, skills.
 *
 * Les nombres viennent du CLI (`get_context_usage`) ; les Messages sont DEDUITS de l'occupation
 * reelle du dernier appel (`composerContexte`). L'heure de mesure est ecrite : un detail d'un tour
 * precedent ne se fait pas passer pour celui du dernier.
 */
function ContexteParCategorie({
  contexte,
  level,
  onCompact,
  busy,
  style,
  fermer
}: {
  contexte: ContexteDetaille
  level: ContextGauge['level']
  onCompact?: () => void
  busy?: boolean
  style?: React.CSSProperties
  fermer?: () => void
}): React.JSX.Element {
  const { t } = useTextesChatPanneaux()
  const { utilise, limite, categories } = contexte
  const pourcent = Math.round((utilise / limite) * 100)
  const segments = categories.filter((c) => c.genre === 'utilise' || c.genre === 'reserve')
  const heure = formaterDate(contexte.mesureLe, {
    hour: '2-digit',
    minute: '2-digit'
  })
  return (
    <section
      className="model-quota-popover ctx-panneau"
      data-testid="chat-context-popover"
      data-context-level={level}
      aria-label={t('contexte.aria')}
      style={style}
    >
      <header className="ctx-entete">
        <strong>{t('contexte.court')}</strong>
        <small title={t('contexte.mesure.titre')}>{t('contexte.mesureA', { heure })}</small>
      </header>
      <div className="ctx-resume" data-testid="ctx-resume">
        <span>
          <b>{t('contexte.pourcent', { n: pourcent })}</b> {t('contexte.utilise')}
        </span>
        <span className="ctx-total">
          {tokensCourts(utilise)} / {tokensCourts(limite)}
        </span>
      </div>
      <div className="ctx-barre" aria-hidden="true">
        {segments.map((c) => (
          <i
            key={c.cle}
            className={`ctx-c-${c.cle}`}
            style={{ width: `${(c.tokens / limite) * 100}%` }}
          />
        ))}
      </div>
      <ul className="ctx-categories" data-testid="ctx-categories">
        {categories.map((c) => (
          <li
            key={`${c.genre}-${c.cle}`}
            className={`ctx-cat is-${c.genre}`}
            data-categorie={c.cle}
            title={`${c.libelle} — ${formaterNombre(c.tokens)} tokens`}
          >
            <i className={`ctx-pastille ctx-c-${c.cle}`} aria-hidden="true" />
            <span className="ctx-nom">{c.libelle}</span>
            <span className="ctx-tokens">{tokensCourts(c.tokens)}</span>
            <span className="ctx-part">
              {c.genre === 'differe' ? '—' : partDeFenetre(c.tokens, limite)}
            </span>
          </li>
        ))}
      </ul>
      <div className="ctx-listes">
        <ListeContexte
          titre={t('contexte.outilsMcp')}
          elements={contexte.outilsMcp}
          ouverte
          testid="ctx-outils-mcp"
        />
        <ListeContexte
          titre={t('contexte.fichiersMemoire')}
          elements={contexte.fichiersMemoire}
          ouverte
          testid="ctx-fichiers-memoire"
          nomCourt={(chemin) => {
            const parties = chemin.split(/[\\/]/)
            return parties.length > 2 ? `…/${parties.slice(-2).join('/')}` : chemin
          }}
        />
        <ListeContexte
          // « Skills » : identique dans les deux langues.
          titre="Skills"
          elements={contexte.skills}
          ouverte={false}
          testid="ctx-skills"
        />
      </div>
      {onCompact && (
        <footer className="ctx-pied">
          <button
            type="button"
            className="quota-context-compact"
            data-testid="quota-context-compact"
            disabled={busy === true}
            title={busy === true ? t('contexte.compaction.indisponible') : t('contexte.compaction')}
            onClick={() => {
              fermer?.()
              onCompact()
            }}
          >
            {t('contexte.compacter')}
          </button>
        </footer>
      )}
    </section>
  )
}
