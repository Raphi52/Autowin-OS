import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createDecorScene, type DecorScene } from './home-decor-scene'
import {
  formatEventDay,
  formatEventTime,
  formatExchangeDate,
  groupByInterlocutor,
  parseOutlookResult,
  splitByExchange,
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

/**
 * L'etat de la passerelle Outlook, en UN seul type.
 *
 * Il etait declare deux fois -- une fois pour l'etat du composant, une fois pour le corps du widget --
 * et les deux ont diverge des que `luLe` a ete ajoute. Un type porte a deux endroits est un type qui
 * finira faux a l'un des deux.
 */
export type OutlookState =
  | { etat: 'chargement' }
  | { etat: 'ok'; fils: Interlocuteur[]; agenda: Agenda; luLe: number }
  | { etat: 'panne'; cause: string }

interface HoldState {
  id: HomeWidgetId
  edge: ResizeEdge | 'move'
  startX: number
  startY: number
  from: HomeWidgetBox
}

/**
 * L'AGENCEMENT enregistré, tel quel.
 *
 * Volontairement SANS recadrage : c'est la source de vérité, celle que l'utilisateur a posée. Ce qui
 * s'affiche en est dérivé pour la surface du moment (`reconcileLayout`), mais on ne remplace jamais
 * la source par sa dérivée — sinon un simple passage sur fenêtre étroite détruit l'agencement pour
 * toujours. Défaut relevé le 2026-08-21 par un scout lancé dans Autowin : la disposition était
 * remplacée PUIS persistée immédiatement, donc ré-agrandir la fenêtre ne rendait rien.
 */
function readStoredArrangement(viewport: { width: number; height: number }): HomeLayout {
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY)
    if (raw === null) return defaultHomeLayout(viewport)
    return parseHomeLayout(JSON.parse(raw), viewport)
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
  // Au premier rendu la surface n'est pas encore mesurée : on part de la fenêtre, et la mesure
  // ci-dessous corrige dès que les dimensions réelles sont connues.
  const [arrangement, setArrangement] = useState<HomeLayout>(() =>
    readStoredArrangement({ width: window.innerWidth || 1440, height: window.innerHeight || 900 })
  )
  const [surface, setSurface] = useState<{ width: number; height: number; top: number }>(() => ({
    width: window.innerWidth || 1440,
    height: window.innerHeight || 900,
    top: 142
  }))
  const [snapshot, setSnapshot] = useState<TaskSnapshotLike | null>(null)
  const [snapshotError, setSnapshotError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [outlook, setOutlook] = useState<OutlookState>({ etat: 'chargement' })
  const [held, setHeld] = useState<HomeWidgetId | null>(null)
  const [outlookEnCours, setOutlookEnCours] = useState(false)

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


  // Seul l'AGENCEMENT est enregistré. Écrire ce qui s'affiche graverait le mode compact d'une fenêtre
  // étroite et l'utilisateur ne retrouverait jamais son organisation.
  useEffect(() => {
    try {
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, serializeHomeLayout(arrangement))
    } catch {
      // Pas d'écriture possible : la disposition vivra le temps de la session, sans casser la vue.
    }
  }, [arrangement])

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
   * La surface. Mesurée au montage et à chaque redimensionnement.
   *
   * Elle ne MODIFIE PAS la disposition : elle est une entrée de son calcul. C'est la différence entre
   * « la fenêtre a changé, j'adapte l'affichage » et « la fenêtre a changé, j'écrase ton
   * organisation ».
   * ---------------------------------------------------------------- */
  useEffect(() => {
    const element = surfaceRef.current
    if (!element) return
    const mesurer = (): void => {
      const taille = viewport()
      if (taille.width === 0 || taille.height === 0) return
      setSurface((courante) =>
        courante.width === taille.width &&
        courante.height === taille.height &&
        courante.top === taille.top
          ? courante
          : taille
      )
    }
    mesurer()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(mesurer) : null
    observer?.observe(element)
    // `resize` de fenêtre EN PLUS de l'observateur : sans lui, un environnement sans `ResizeObserver`
    // (et c'est le cas des tests) ne mesurerait jamais rien, donc la règle ci-dessus ne serait
    // vérifiable nulle part.
    window.addEventListener('resize', mesurer)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', mesurer)
    }
  }, [viewport])

  /**
   * Ce qui s'AFFICHE : l'agencement, adapté à la surface du moment.
   *
   * Recalculé, jamais enregistré. Réduire puis ré-agrandir la fenêtre repasse donc exactement par la
   * même dérivation et rend les positions d'origine au pixel.
   */
  const layout = useMemo(() => reconcileLayout(arrangement, surface), [arrangement, surface])

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
    if (force) setOutlookEnCours(true)
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
        fils: groupByInterlocutor(resultat.mails, resultat.adressesEchangees),
        agenda: splitAgenda(resultat.evenements, Date.now()),
        luLe: Date.now()
      })
    } catch (error) {
      setOutlook({
        etat: 'panne',
        cause: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setOutlookEnCours(false)
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
      // Un geste de l'utilisateur fait AUTORITE : il ecrit l'agencement. C'est la difference avec un
      // redimensionnement de fenetre, qui n'exprime aucune intention sur la disposition.
      setArrangement((current) => replaceWidget(current, box))
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

  const resetLayout = useCallback(() => setArrangement(defaultHomeLayout(viewport())), [viewport])
  const scatter = useCallback(
    () => setArrangement((current) => scatterHomeLayout(current, viewport(), Math.random)),
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
          {/* Outlook n'est relu que toutes les deux minutes : sans ce bouton, un mail qui vient
              d'arriver reste invisible sans qu'on puisse rien y faire. Friction relevee par un scout
              lance dans Autowin (score 86). L'horodatage rend l'effet du clic VISIBLE. */}
          <button
            type="button"
            onClick={() => void readOutlook(true)}
            disabled={outlookEnCours}
            data-testid="home-refresh-outlook"
            title={
              outlook.etat === 'ok'
                ? `Outlook lu à ${new Date(outlook.luLe).toLocaleTimeString('fr-FR')}`
                : 'Relire Outlook maintenant'
            }
          >
            {outlookEnCours ? 'Lecture…' : 'Actualiser Outlook'}
          </button>
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
      // Un widget vide occupe autant de place qu'un widget plein : autant qu'il serve à quelque
      // chose. Relevé en pilotant l'app — trois quarts de l'écran affichaient des phrases de vide.
      return (
        <p className="home-hint">
          Aucune routine horaire n’est programmée.{' '}
          <button type="button" className="home-lien" onClick={() => onNavigate?.('planification')}>
            En créer une
          </button>
        </p>
      )
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
    return (
      <p className="home-hint">
        Rien à signaler. Vos agents n’ont rien remonté.{' '}
        <button type="button" className="home-lien" onClick={() => onNavigate?.('watchdog')}>
          Voir le Watchdog
        </button>
      </p>
    )
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

/**
 * Les interlocuteurs : un fil par contact, non lus en tête, comme une messagerie.
 *
 * Les PERSONNES d'abord, les automates ensuite et annoncés comme tels. Mesure du 2026-08-21 en
 * pilotant l'app sur une vraie boîte : sur 23 émetteurs, 3 étaient des personnes — le reste était
 * des codes à usage unique, des ajouts à des groupes et des robots de suivi. Un widget qui promet
 * « mes échanges par interlocuteur » et livre cela rate sa promesse.
 */
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
  const { personnes, automates, indistinct } = splitByExchange(fils)
  return (
    <>
      {personnes.length > 0 ? <FilsList fils={personnes} now={now} /> : null}
      {personnes.length === 0 && !indistinct ? (
        <p className="home-hint">
          Aucun message d’une personne à qui vous avez déjà écrit. Ci-dessous, les envois
          automatiques.
        </p>
      ) : null}
      {automates.length > 0 ? (
        <>
          {/* Nommé, pas masqué : ces messages existent, ils ne sont simplement pas des échanges. */}
          <p className="home-subhead">Envois automatiques</p>
          <FilsList fils={automates} now={now} />
        </>
      ) : null}
    </>
  )
}

function FilsList({ fils, now }: { fils: Interlocuteur[]; now: number }): React.JSX.Element {
  return (
    <ul className="home-threads">
      {fils.map((fil) => (
        <li
          key={fil.cle}
          data-unread={fil.nonLus > 0 ? 'true' : undefined}
          data-echange={fil.echange === true ? 'true' : undefined}
        >
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
