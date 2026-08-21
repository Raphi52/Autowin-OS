import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createDecorScene, type DecorScene } from './home-decor-scene'
import {
  formatEventDay,
  formatEventTime,
  formatExchangeDate,
  groupByInterlocutor,
  parseOutlookResult,
  splitAgenda,
  totalUnread,
  type Agenda,
  type Interlocuteur
} from './outlook-model'
import {
  agentNotices,
  nextDepartures,
  unacknowledgedCount,
  type AgentNotice,
  type RoutineDeparture
} from './home-widgets-model'
import {
  defaultHomeLayout,
  HOME_WIDGET_TITLES,
  reconcileLayout,
  moveWidgetBox,
  parseHomeLayout,
  replaceWidget,
  resizeWidgetBox,
  scatterHomeLayout,
  serializeHomeLayout,
  type HomeLayout,
  type HomeWidgetBox,
  type HomeWidgetId,
  type ResizeEdge
} from './home-layout'
import { autowinStorageKey } from '../storage-keys'
import './HomeView.css'

/**
 * LA page d'accueil : des tuiles qu'on POSE, au-dessus d'un décor spatial rendu en temps réel.
 *
 * Elle ne produit aucune donnée. Les heures de départ et les remontées d'agents viennent du snapshot
 * du Task Manager, qui les portait déjà ; l'accueil est l'endroit où on les lit toutes d'un coup au
 * lieu d'aller les chercher onglet par onglet. Le Task Manager reste seul à pouvoir les MODIFIER — un
 * widget qui laisserait éditer une tâche dupliquerait un formulaire qui existe déjà.
 *
 * Deux règles de conduite viennent de rejets explicites de l'utilisateur, et ne doivent pas être
 * « améliorées » par inadvertance :
 *  - on POSE, on ne lance pas : aucun élan, aucun point d'accroche. La tuile reste au pixel lâché.
 *  - la taille suit le curseur SÈCHEMENT : le moindre ressort sur la largeur se lit comme un
 *    gonflement, et c'est ce qui a fait rejeter une première version.
 */

const LAYOUT_STORAGE_KEY = autowinStorageKey('home.layout.v1')
const REFRESH_MS = 30_000
/** Outlook se relit moins souvent : chaque lecture est un dialogue COM avec une application lourde. */
const OUTLOOK_REFRESH_MS = 120_000

interface TaskSnapshotLike {
  tasks: {
    id: string
    title: string
    enabled: boolean
    nextRunAt: number | null
    watchdog?: unknown
  }[]
  alerts: {
    id: string
    taskId: string
    kind: 'missed' | 'failed'
    message: string
    createdAt: number
    acknowledgedAt?: number
  }[]
}

interface HoldState {
  id: HomeWidgetId
  edge: ResizeEdge | 'move'
  startX: number
  startY: number
  from: HomeWidgetBox
}

function readStoredLayout(viewport: { width: number; height: number }): HomeLayout {
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY)
    if (raw === null) return defaultHomeLayout(viewport)
    return reconcileLayout(parseHomeLayout(JSON.parse(raw), viewport), viewport)
  } catch {
    // Une disposition illisible ne doit pas empêcher l'accueil de s'ouvrir : on repart du défaut.
    return defaultHomeLayout(viewport)
  }
}

export function HomeView({
  active,
  onNavigate
}: {
  active: boolean
  onNavigate?: (destination: string) => void
}): React.JSX.Element {
  // Au premier rendu la surface n'est pas encore mesurée : on part de la fenêtre, et l'effet de
  // recadrage ci-dessous corrige dès que les dimensions réelles sont connues.
  const [layout, setLayout] = useState<HomeLayout>(() =>
    readStoredLayout({ width: window.innerWidth || 1440, height: window.innerHeight || 900 })
  )
  const [snapshot, setSnapshot] = useState<TaskSnapshotLike | null>(null)
  const [snapshotError, setSnapshotError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [outlook, setOutlook] = useState<
    { etat: 'chargement' } | { etat: 'ok'; fils: Interlocuteur[]; agenda: Agenda } | { etat: 'panne'; cause: string }
  >({ etat: 'chargement' })
  const [held, setHeld] = useState<HomeWidgetId | null>(null)

  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const decorHostRef = useRef<HTMLDivElement | null>(null)
  const headerRef = useRef<HTMLDivElement | null>(null)
  const holdRef = useRef<HoldState | null>(null)
  const frontRef = useRef(10)
  const zIndexRef = useRef<Map<HomeWidgetId, number>>(new Map())

  // `active` est lu par la boucle de rendu, qui ne doit PAS se remonter à chaque bascule d'onglet :
  // recréer la scène coûterait plus cher que le rendu qu'on économise.
  const activeRef = useRef(active)
  activeRef.current = active


  useEffect(() => {
    try {
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, serializeHomeLayout(layout))
    } catch {
      // Pas d'écriture possible : la disposition vivra le temps de la session, sans casser la vue.
    }
  }, [layout])

  const viewport = useCallback((): { width: number; height: number; top: number } => {
    const surface = surfaceRef.current
    // Le haut reserve est MESURE sur l'en-tete, jamais suppose : il se replie sur deux rangees quand
    // la fenetre est etroite, et une constante ne peut pas suivre.
    const headerHeight = headerRef.current?.offsetHeight ?? 0
    return {
      width: surface?.clientWidth || window.innerWidth || 1440,
      height: surface?.clientHeight || window.innerHeight || 900,
      top: (headerHeight > 0 ? headerHeight + 32 : 142)
    }
  }, [])

  /* ---------------------------------------------------------------- *
   * Le recadrage. Au montage et à chaque redimensionnement de la vue.
   *
   * Sans lui, une disposition posée sur un écran large laisse les tuiles ENTIÈREMENT hors champ
   * quand la fenêtre rétrécit : mesuré le 2026-08-21 dans l'app, quatre tuiles sur cinq étaient
   * inatteignables dans une fenêtre de 491 px, et rien ne le signalait.
   * ---------------------------------------------------------------- */
  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return
    const refit = (): void => {
      const size = viewport()
      if (size.width === 0 || size.height === 0) return
      setLayout((current) => {
        const fitted = reconcileLayout(current, size)
        // Comparaison avant écriture : un recadrage sans effet ne doit pas provoquer un rendu, ni
        // réécrire la disposition enregistrée à chaque pixel de redimensionnement.
        const changed = fitted.some(
          (box, index) =>
            box.x !== current[index].x ||
            box.y !== current[index].y ||
            box.w !== current[index].w ||
            box.h !== current[index].h
        )
        return changed ? fitted : current
      })
    }
    refit()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(refit) : null
    observer?.observe(surface)
    return () => observer?.disconnect()
  }, [viewport])

  /* ---------------------------------------------------------------- *
   * Le décor. Monté une fois, suspendu quand la vue n'est pas affichée.
   * ---------------------------------------------------------------- */
  useEffect(() => {
    const host = decorHostRef.current
    if (!host) return
    const scene: DecorScene | null = createDecorScene()
    // Pas de WebGL (happy-dom en test, pilote absent) : la page s'affiche sans décor, ce qui est le
    // comportement voulu — un décor n'est pas une dépendance de la fonction.
    if (!scene) return
    host.appendChild(scene.canvas)

    const fit = (): void => scene.resize(host.clientWidth, host.clientHeight)
    fit()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null
    observer?.observe(host)

    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const aim = { x: 0, y: 0 }
    const look = { x: 0, y: 0 }
    const onPointerMove = (event: PointerEvent): void => {
      aim.x = (event.clientX / window.innerWidth - 0.5) * 2
      aim.y = (event.clientY / window.innerHeight - 0.5) * 2
    }
    window.addEventListener('pointermove', onPointerMove)

    let frame = 0
    let last = 0
    const draw = (time: number): void => {
      frame = requestAnimationFrame(draw)
      // Suspendu hors de la vue active : faire tourner un rendu 3D pour une page que personne ne
      // regarde coûte un GPU entier pour rien.
      if (!activeRef.current) return
      // ~40 images/s : la scène dérive lentement, doubler la cadence ne se voit pas et double la
      // facture d'une vue qui reste ouverte toute la journée.
      if (time - last < 25) return
      last = time
      look.x += (aim.x - look.x) * 0.05
      look.y += (aim.y - look.y) * 0.05
      scene.render(reduceMotion ? 12 : time / 1000, reduceMotion ? { x: 0, y: 0 } : look)
    }

    if (reduceMotion) {
      // Mouvement réduit : une seule image, figée. Le décor reste présent, il ne bouge plus.
      scene.render(12, { x: 0, y: 0 })
    } else {
      frame = requestAnimationFrame(draw)
    }

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onPointerMove)
      observer?.disconnect()
      scene.dispose()
    }
  }, [])

  /* ---------------------------------------------------------------- *
   * Les données. Lues seulement quand la vue est affichée.
   * ---------------------------------------------------------------- */
  useEffect(() => {
    if (!active) return
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const api = (window as unknown as { api?: { taskManagerSnapshot?: () => Promise<unknown> } })
          .api
        if (!api?.taskManagerSnapshot) return
        const result = (await api.taskManagerSnapshot()) as TaskSnapshotLike
        if (cancelled) return
        setSnapshot(result)
        setSnapshotError(null)
      } catch (error) {
        if (!cancelled) setSnapshotError(error instanceof Error ? error.message : String(error))
      }
    }
    void load()
    const timer = window.setInterval(() => {
      setNow(Date.now())
      void load()
    }, REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [active])

  /* ---------------------------------------------------------------- *
   * Outlook. Lu seulement quand la vue est affichee, et plus lentement que le Task Manager : chaque
   * lecture est un dialogue COM avec une application lourde.
   * ---------------------------------------------------------------- */
  const readOutlook = useCallback(async (force = false): Promise<void> => {
    const api = (window as unknown as { api?: { outlookSnapshot?: (f?: boolean) => Promise<unknown> } })
      .api
    if (!api?.outlookSnapshot) {
      setOutlook({ etat: 'panne', cause: "la passerelle Outlook n'est pas disponible" })
      return
    }
    try {
      const resultat = parseOutlookResult(await api.outlookSnapshot(force))
      if (!resultat.ok) {
        setOutlook({ etat: 'panne', cause: resultat.erreur })
        return
      }
      setOutlook({
        etat: 'ok',
        fils: groupByInterlocutor(resultat.mails),
        agenda: splitAgenda(resultat.evenements, Date.now())
      })
    } catch (error) {
      setOutlook({
        etat: 'panne',
        cause: error instanceof Error ? error.message : String(error)
      })
    }
  }, [])

  useEffect(() => {
    if (!active) return
    void readOutlook()
    const timer = window.setInterval(() => void readOutlook(), OUTLOOK_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [active, readOutlook])

  const departures = useMemo(
    () => (snapshot ? nextDepartures(snapshot.tasks, now) : []),
    [snapshot, now]
  )
  const notices = useMemo(
    () => (snapshot ? agentNotices(snapshot.alerts, snapshot.tasks) : []),
    [snapshot]
  )
  const pending = unacknowledgedCount(notices)
  const mailsNonLus = outlook.etat === 'ok' ? totalUnread(outlook.fils) : 0

  /* ---------------------------------------------------------------- *
   * La pose.
   *
   * Le geste écrit la disposition IMMÉDIATEMENT, dans son propre gestionnaire. Il ne passe par
   * aucune boucle d'animation : mesuré sur prototype, adosser la position au rythme des images
   * rendait les tuiles totalement immobiles dès que « réduire les animations » était actif ou que la
   * fenêtre passait en arrière-plan — un réglage d'accessibilité supprimait la fonction principale
   * de la page.
   * ---------------------------------------------------------------- */
  const grab = useCallback(
    (event: React.PointerEvent, id: HomeWidgetId, edge: ResizeEdge | 'move'): void => {
      const from = layout.find((entry) => entry.id === id)
      if (!from) return
      event.stopPropagation()
      holdRef.current = { id, edge, startX: event.clientX, startY: event.clientY, from }
      frontRef.current += 1
      zIndexRef.current.set(id, frontRef.current)
      setHeld(id)
    },
    [layout]
  )

  useEffect(() => {
    if (held === null) return
    const onMove = (event: PointerEvent): void => {
      const hold = holdRef.current
      if (!hold) return
      const dx = event.clientX - hold.startX
      const dy = event.clientY - hold.startY
      const box =
        hold.edge === 'move'
          ? moveWidgetBox(hold.from, dx, dy, viewport())
          : resizeWidgetBox(hold.from, hold.edge, dx, dy, viewport())
      setLayout((current) => replaceWidget(current, box))
    }
    const onUp = (): void => {
      // Rien d'autre à faire : la tuile est déjà exactement là où elle a été lâchée. Aucun élan,
      // aucune remise en place — c'est ça, poser.
      holdRef.current = null
      setHeld(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    // Filet : un pointeur perdu hors de la fenêtre laisserait une tuile collée au curseur.
    window.addEventListener('blur', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('blur', onUp)
    }
  }, [held, viewport])

  const resetLayout = useCallback(() => setLayout(defaultHomeLayout(viewport())), [viewport])
  const scatter = useCallback(
    () => setLayout((current) => scatterHomeLayout(current, viewport(), Math.random)),
    [viewport]
  )

  return (
    <div className="home-view" ref={surfaceRef} data-testid="home-view">
      <div className="home-view__decor" ref={decorHostRef} aria-hidden="true" />
      {/* UNE seule rangée, qui se replie. Deux blocs positionnés en absolu se recouvraient dès que la
          fenêtre devenait étroite : le titre passait sous les boutons. Une rangée qui se replie rend
          ce chevauchement impossible, quelle que soit la largeur. */}
      <div className="home-view__header" ref={headerRef}>
        <div className="home-view__masthead">
          <h1>
            Autowin <b>Accueil</b>
          </h1>
          <p>
            Prenez une tuile n’importe où et posez-la : elle reste exactement là où vous la lâchez.
            Les huit bords la redimensionnent.
          </p>
        </div>
        <div className="home-view__tools">
          <button type="button" onClick={scatter}>
            Disperser
          </button>
          <button type="button" onClick={resetLayout}>
            Rétablir la disposition
          </button>
        </div>
      </div>

      {layout.map((box) => (
        <section
          key={box.id}
          className="home-tile"
          data-widget={box.id}
          data-held={held === box.id ? 'true' : undefined}
          data-window={box.id === 'hublot' ? 'true' : undefined}
          data-testid={`home-widget-${box.id}`}
          style={{
            width: `${box.w}px`,
            height: `${box.h}px`,
            zIndex: zIndexRef.current.get(box.id) ?? 10,
            transform: `translate3d(${box.x}px, ${box.y}px, ${box.z}px)`
          }}
          onPointerDown={(event) => grab(event, box.id, 'move')}
        >
          <div className="home-tile__label">
            <h2>{HOME_WIDGET_TITLES[box.id]}</h2>
            <i className="home-tile__rule" />
            {box.id === 'notifications' && pending > 0 ? (
              <span className="home-tile__count" title={`${pending} remontée(s) à lire`}>
                {pending}
              </span>
            ) : null}
            {box.id === 'mails' && mailsNonLus > 0 ? (
              <span className="home-tile__count" title={`${mailsNonLus} message(s) non lu(s)`}>
                {mailsNonLus}
              </span>
            ) : null}
          </div>
          <div className="home-tile__panel">
            <div className="home-tile__scroll">
              <WidgetBody
                id={box.id}
                departures={departures}
                notices={notices}
                outlook={outlook}
                now={now}
                loading={snapshot === null && snapshotError === null}
                error={snapshotError}
                onNavigate={onNavigate}
              />
            </div>
            {(['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'] as ResizeEdge[]).map((edge) => (
              <i
                key={edge}
                className="home-tile__grip"
                data-edge={edge}
                data-testid={`home-grip-${box.id}-${edge}`}
                onPointerDown={(event) => grab(event, box.id, edge)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

type OutlookState =
  | { etat: 'chargement' }
  | { etat: 'ok'; fils: Interlocuteur[]; agenda: Agenda }
  | { etat: 'panne'; cause: string }

function WidgetBody({
  id,
  departures,
  notices,
  outlook,
  now,
  loading,
  error,
  onNavigate
}: {
  id: HomeWidgetId
  departures: RoutineDeparture[]
  notices: AgentNotice[]
  outlook: OutlookState
  now: number
  loading: boolean
  error: string | null
  onNavigate?: (destination: string) => void
}): React.JSX.Element {
  if (id === 'hublot') {
    return (
      <p className="home-hint">
        Ce cadre est un hublot : il n’opacifie pas son fond, le décor le traverse. Posez-le sur une
        nébuleuse.
      </p>
    )
  }

  if (id === 'mails' || id === 'agenda') {
    if (outlook.etat === 'chargement') return <p className="home-hint">Lecture d’Outlook…</p>
    if (outlook.etat === 'panne') {
      // La cause est AFFICHÉE. Une liste vide se lirait « vous n'avez pas de mail » alors qu'elle
      // veut dire « la lecture a échoué » — et l'utilisateur ne saurait pas quoi faire.
      return <p className="home-error">Outlook injoignable : {outlook.cause}</p>
    }
    return id === 'mails' ? (
      <InterlocuteursList fils={outlook.fils} now={now} />
    ) : (
      <AgendaList agenda={outlook.agenda} />
    )
  }

  if (error) {
    return <p className="home-error">Task Manager injoignable : {error}</p>
  }
  if (loading) {
    return <p className="home-hint">Lecture du Task Manager…</p>
  }

  if (id === 'routines') {
    if (departures.length === 0) {
      return <p className="home-hint">Aucune routine horaire n’est programmée.</p>
    }
    return (
      <ul className="home-list">
        {departures.map((departure) => (
          <li key={departure.id} data-suspended={departure.suspended ? 'true' : undefined}>
            <time>
              {new Date(departure.at).toLocaleTimeString('fr-FR', {
                hour: '2-digit',
                minute: '2-digit'
              })}
            </time>
            <span>{departure.title}</span>
            <em>{departure.suspended ? 'désactivée' : departure.relative}</em>
          </li>
        ))}
      </ul>
    )
  }

  if (notices.length === 0) {
    return <p className="home-hint">Rien à signaler. Vos agents n’ont rien remonté.</p>
  }
  return (
    <ul className="home-notices">
      {notices.map((notice) => (
        <li
          key={notice.id}
          data-kind={notice.kind}
          data-read={notice.acknowledged ? 'true' : undefined}
        >
          <button type="button" onClick={() => onNavigate?.('watchdog')} title="Ouvrir le Watchdog">
            <span>{notice.message}</span>
            <small>
              {notice.origin} · {notice.kind === 'missed' ? 'occurrence ratée' : 'échec'}
            </small>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Les interlocuteurs : un fil par contact, non lus en tête, comme une messagerie. */
function InterlocuteursList({
  fils,
  now
}: {
  fils: Interlocuteur[]
  now: number
}): React.JSX.Element {
  if (fils.length === 0) {
    return <p className="home-hint">Aucun message dans votre boîte de réception.</p>
  }
  return (
    <ul className="home-threads">
      {fils.map((fil) => (
        <li key={fil.cle} data-unread={fil.nonLus > 0 ? 'true' : undefined}>
          <span className="home-threads__who" aria-hidden="true">
            {initiales(fil.nom)}
          </span>
          <span className="home-threads__lines">
            <span className="home-threads__name">
              <b title={fil.adresse}>{fil.nom}</b>
              <em>{formatExchangeDate(fil.dernierEchange, now)}</em>
            </span>
            <span className="home-threads__last">{fil.messages[0]?.sujet}</span>
          </span>
          {/* Le compte du fil, pas celui de la boîte : c'est ce qui reste à lire CHEZ ce contact. */}
          {fil.nonLus > 0 ? <span className="home-threads__tally">{fil.nonLus}</span> : null}
        </li>
      ))}
    </ul>
  )
}

/** Deux ou trois initiales tirées du nom affiché, pour tenir dans une pastille. */
function initiales(nom: string): string {
  const mots = nom
    .replace(/[<>()"]/g, ' ')
    .split(/[\s.,;]+/)
    .filter((mot) => mot.length > 0)
  if (mots.length === 0) return '?'
  if (mots.length === 1) return mots[0].slice(0, 2).toUpperCase()
  return (mots[0][0] + mots[mots.length - 1][0]).toUpperCase()
}

/** L'agenda : aujourd'hui, puis la semaine — et à défaut, le prochain rendez-vous. */
function AgendaList({ agenda }: { agenda: Agenda }): React.JSX.Element {
  if (agenda.aujourdHui.length === 0 && agenda.semaine.length === 0) {
    if (agenda.suivant === null) {
      return <p className="home-hint">Aucun rendez-vous à venir dans votre agenda.</p>
    }
    // Un agenda calme ne doit pas se lire comme une panne : on nomme le prochain rendez-vous.
    return (
      <p className="home-hint">
        Rien cette semaine. Prochain rendez-vous : <b>{agenda.suivant.sujet}</b> le{' '}
        {new Date(agenda.suivant.debut).toLocaleDateString('fr-FR', {
          weekday: 'long',
          day: 'numeric',
          month: 'long'
        })}
        .
      </p>
    )
  }
  return (
    <>
      {agenda.aujourdHui.length > 0 ? (
        <ul className="home-list">
          {agenda.aujourdHui.map((entry) => (
            <li key={entry.id}>
              <time>{formatEventTime(entry)}</time>
              <span>{entry.sujet}</span>
              <em>{entry.lieu}</em>
            </li>
          ))}
        </ul>
      ) : (
        <p className="home-hint">Rien d’autre aujourd’hui.</p>
      )}
      {agenda.semaine.length > 0 ? (
        <>
          <p className="home-subhead">Cette semaine</p>
          <ul className="home-list">
            {agenda.semaine.map((entry) => (
              <li key={entry.id}>
                <time>{formatEventDay(entry)}</time>
                <span>{entry.sujet}</span>
                <em>{formatEventTime(entry)}</em>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  )
}
