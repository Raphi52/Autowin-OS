import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createDecorScene, DECOR_DEFAUT, type DecorScene, type DecorVariant } from './home-decor-scene'
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
import { canUndo, emptyHistory, remember, undo, type ArrangementHistory } from './home-history'
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
/**
 * Combien de fois la notice d'usage s'affiche avant de s'effacer.
 *
 * Un mode d'emploi PERMANENT est un aveu que l'interface ne se comprend pas seule, et il occupait
 * l'en-tête pour toujours en poussant tout le contenu vers le bas. Il reste rappelable : effacer une
 * aide sans laisser le moyen de la revoir échange une friction contre une autre.
 */
const NOTICE_STORAGE_KEY = autowinStorageKey('home.notice-vue.v1')
/** La direction visuelle du decor. Un reglage, pas une constante : l'utilisateur en choisit une. */
/*
 * `v2` et non `v1` : la cle est VOLONTAIREMENT changee le 2026-08-25.
 *
 * Cause de la plainte « je vois des poussieres » : le defaut du decor est passe a `actuel` (planetes
 * annelees), mais une machine qui avait deja choisi `poussiere` gardait ce choix en localStorage et
 * continuait d'afficher l'ancienne direction — le nouveau defaut n'atteignait jamais l'ecran.
 * Repartir sur une cle neuve rend la main a `DECOR_DEFAUT` sans effacer l'ancienne valeur.
 */
const DECOR_STORAGE_KEY = autowinStorageKey('home.decor.v2')
const NOTICE_OUVERTURES = 4
/** Pas de déplacement au clavier, en pixels. Assez grand pour avancer, assez petit pour viser. */
const PAS_CLAVIER = 16
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
  const [histoire, setHistoire] = useState<ArrangementHistory>(() => emptyHistory())
  const [ouvertureEnCours, setOuvertureEnCours] = useState<string | null>(null)
  const [erreurOuverture, setErreurOuverture] = useState<string | null>(null)
  /**
   * Nombre d'ouvertures DEJA comptees, lu une fois et fige pour toute la vie du montage.
   *
   * C'etait un etat qu'un effet incrementait aussitot -- donc un `setState` synchrone dans un effet,
   * signale par le React Compiler : le premier rendu affichait la notice sur l'ancienne valeur, un
   * second rendu suivait immediatement. Rien ici n'a besoin de re-rendre : l'ouverture courante est
   * connue des le montage, et la persistance est un effet de bord.
   */
  const [ouverturesDejaComptees] = useState(() => {
    const lu = Number(window.localStorage.getItem(NOTICE_STORAGE_KEY) ?? '0')
    return Number.isFinite(lu) ? lu : 0
  })
  /** Celle-ci comprise : c'est ce nombre que l'affichage compare, comme avant ce correctif. */
  const noticeVue = ouverturesDejaComptees + 1
  const [noticeForcee, setNoticeForcee] = useState(false)

  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const decorHostRef = useRef<HTMLDivElement | null>(null)
  const headerRef = useRef<HTMLDivElement | null>(null)
  const holdRef = useRef<HoldState | null>(null)
  const frontRef = useRef(10)
  const zIndexRef = useRef<Map<HomeWidgetId, number>>(new Map())

  // `active` est lu par la boucle de rendu, qui ne doit PAS se remonter à chaque bascule d'onglet :
  // recréer la scène coûterait plus cher que le rendu qu'on économise.
  //
  // L'affectation vit dans un EFFET et non dans le corps du composant. Écrire une ref pendant le
  // rendu fonctionne tant que React rend une fois et jusqu'au bout ; il abandonne et rejoue des
  // rendus en mode concurrent, et la ref se désynchronise alors sans que rien ne le signale. Le
  // décalage introduit est d'au plus une frame, invisible pour une boucle `requestAnimationFrame`.
  // Signalé par le React Compiler (« Cannot access refs during render »), vérifié au rendu.
  const activeRef = useRef(active)
  useEffect(() => {
    activeRef.current = active
  }, [active])


  // La notice se compte a l'OUVERTURE de la vue, une fois par montage. L'effet ne fait plus que
  // PERSISTER : le compte affiché est déjà connu au montage, il n'a jamais eu besoin d'un rendu.
  useEffect(() => {
    try {
      window.localStorage.setItem(NOTICE_STORAGE_KEY, String(noticeVue))
    } catch {
      // Sans persistance la notice restera : c'est le comportement le moins surprenant.
    }
  }, [noticeVue])

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
    const choisie = (window.localStorage.getItem(DECOR_STORAGE_KEY) ?? DECOR_DEFAUT) as DecorVariant
    const scene: DecorScene | null = createDecorScene(choisie)
    // Pas de WebGL (happy-dom en test, pilote absent) : la page s'affiche sans décor, ce qui est le
    // comportement voulu — un décor n'est pas une dépendance de la fonction.
    if (!scene) return
    host.appendChild(scene.canvas)

    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    /**
     * Redimensionne le decor, PUIS le redessine.
     *
     * Le redessin n'est pas une precaution : sans lui, le decor disparait. Cause localisee le
     * 2026-08-21 apres deux hypotheses fausses, sur une machine ou « reduire les animations » est
     * ACTIF — celle de l'utilisateur. Dans ce mode la scene ne dessine qu'UNE image au montage, et
     * `renderer.setSize` realloue le tampon de dessin : redimensionner la fenetre repositionnait donc
     * correctement tous les elements sur un tampon que plus personne ne remplissait. Mesure : 0,13 %
     * de pixels de la planete apres redimensionnement, contre 60,42 % apres un rechargement.
     *
     * C'est la MEME faute que celle deja corrigee pour les tuiles — une fonction adossee a l'horloge
     * d'animation — refaite sur le decor. Le redessin est inconditionnel : quand la boucle tourne, une
     * image de plus ne coute rien ; quand elle ne tourne pas, c'est la seule qui existera.
     */
    const fit = (): void => {
      scene.resize(host.clientWidth, host.clientHeight)
      scene.render(reduceMotion ? 12 : performance.now() / 1000, { x: 0, y: 0 })
    }
    fit()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null
    observer?.observe(host)
    // `resize` de fenetre EN PLUS de l'observateur, comme pour la disposition.
    //
    // Filet de coherence, et RIEN DE PLUS : un environnement sans `ResizeObserver` ne recalculerait
    // jamais le cadrage, alors que le decor place tous ses elements en fractions du cadre VISIBLE.
    //
    // Honnetement : je l'ai d'abord ajoute en croyant expliquer un ecart de rendu mesure le
    // 2026-08-21 (0,13 % de pixels ambres contre 60,42 % selon qu'on rechargeait ou non la page avant
    // la capture). Cette explication est REFUTEE — une sonde a montre que l'hote passe bien de 1834 a
    // 1414 px, que le canevas suit, et que les deux evenements se declenchent. La cause de cet ecart
    // n'est PAS localisee. Ce filet reste parce qu'il se defend seul, pas parce qu'il corrige cela.
    window.addEventListener('resize', fit)

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
      /*
       * « MOUVEMENT REDUIT » REDUIT LE MOUVEMENT, il n'efface pas le decor.
       *
       * Avant, cette preference coupait TOUT : aucune boucle, parallaxe curseur annulee, une seule
       * image figee. Mesure le 2026-08-24 sur la machine de l'utilisateur, ou
       * `SPI_GETCLIENTAREAANIMATION` vaut False : il ne voyait donc AUCUN des decors qu'il
       * demandait, et croyait que ses demandes echouaient. Elles aboutissaient ; l'ecran restait
       * muet.
       *
       * La coupure retenue distingue les deux natures de mouvement. Le temps est FIGE, donc plus
       * aucune derive autonome -- c'est ce que la preference vise, une image qui bouge toute seule
       * sous des yeux qui ne l'ont pas demande. La parallaxe curseur, elle, reste : elle ne bouge
       * QUE quand l'utilisateur bouge, c'est de la manipulation directe, et la supprimer retirait
       * une fonctionnalite au lieu de calmer une animation.
       */
      scene.render(reduceMotion ? 12 : time / 1000, look)
    }

    /*
     * La boucle tourne MEME en mouvement reduit, et c'est le coeur du correctif : sans elle, le
     * curseur ne pouvait rien deplacer. Elle reste bon marche -- suspendue hors de la vue active
     * (voir `draw`), plafonnee a ~40 images/s, et le temps qu'elle passe a la scene est constant,
     * donc le GPU ne recalcule qu'une parallaxe, pas une derive.
     */
    frame = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('resize', fit)
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
  /**
   * Le compteur de la tuile Mails ne compte QUE les personnes.
   *
   * Friction relevée en pilotant l'app : 85 des 106 non lus venaient d'un seul robot. Un compteur
   * écrasé par un automate n'informe pas — il n'indique jamais qu'il faut aller voir. Le total reste
   * lisible dans l'infobulle : on n'efface pas une information, on choisit celle qui alerte.
   */
  const compteurs = useMemo(() => {
    if (outlook.etat !== 'ok') return { personnes: 0, total: 0 }
    const { personnes, indistinct } = splitByExchange(outlook.fils)
    return {
      personnes: totalUnread(indistinct ? outlook.fils : personnes),
      total: totalUnread(outlook.fils)
    }
  }, [outlook])

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
      // L'etat AVANT le geste est memorise ICI, une seule fois par geste — et non a chaque
      // `pointermove`, ce qui remplirait l'historique de centaines d'etats intermediaires.
      setArrangement((courant) => {
        setHistoire((h) => remember(h, courant))
        return courant
      })
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

  const resetLayout = useCallback(() => {
    setArrangement((courant) => {
      setHistoire((h) => remember(h, courant))
      return defaultHomeLayout(viewport())
    })
  }, [viewport])
  const scatter = useCallback(() => {
    setArrangement((courant) => {
      setHistoire((h) => remember(h, courant))
      return scatterHomeLayout(courant, viewport(), Math.random)
    })
  }, [viewport])
  const annuler = useCallback(() => {
    setHistoire((h) => {
      const defait = undo(h)
      if (!defait) return h
      setArrangement(defait.arrangement)
      return defait.history
    })
  }, [])

  /** Ouvre un élément dans Outlook. La cause d'un échec est AFFICHÉE, pas avalée. */
  const ouvrirDansOutlook = useCallback(async (id: string): Promise<void> => {
    const api = (window as unknown as {
      api?: { outlookOuvrir?: (id: string) => Promise<{ ok: boolean; erreur?: string }> }
    }).api
    if (!api?.outlookOuvrir) {
      setErreurOuverture("Cette version ne sait pas encore ouvrir un élément dans Outlook.")
      return
    }
    setOuvertureEnCours(id)
    setErreurOuverture(null)
    try {
      const resultat = await api.outlookOuvrir(id)
      if (!resultat.ok) setErreurOuverture(resultat.erreur ?? "Outlook n'a pas pu ouvrir cet élément.")
    } catch (error) {
      setErreurOuverture(error instanceof Error ? error.message : String(error))
    } finally {
      setOuvertureEnCours(null)
    }
  }, [])

  /** Acquitte une alerte d'agent depuis l'accueil, sans aller la chercher ailleurs. */
  const acquitter = useCallback(async (alertId: string): Promise<void> => {
    const api = (window as unknown as {
      api?: { taskManagerAcknowledge?: (id: string) => Promise<boolean> }
    }).api
    if (!api?.taskManagerAcknowledge) return
    await api.taskManagerAcknowledge(alertId)
    // Relecture immédiate : sans elle, le compteur ne bougerait qu'au prochain cycle de 30 s et le
    // clic paraîtrait sans effet.
    const snapshotApi = (window as unknown as {
      api?: { taskManagerSnapshot?: () => Promise<unknown> }
    }).api
    if (snapshotApi?.taskManagerSnapshot) {
      setSnapshot((await snapshotApi.taskManagerSnapshot()) as TaskSnapshotLike)
    }
  }, [])

  /**
   * Déplacer et redimensionner AU CLAVIER.
   *
   * Friction relevée par un scout lancé dans Autowin (score 50) : tout reposait sur `PointerEvent` et
   * huit poignées sans sémantique clavier. Une personne sans souris ne pouvait pas personnaliser un
   * tableau annoncé comme libre.
   *
   * Pas de `Ctrl` : l'app s'en sert déjà pour naviguer entre les vues (Ctrl+N). Les flèches déplacent,
   * `Maj` + flèches redimensionnent.
   */
  const auClavier = useCallback(
    (event: React.KeyboardEvent, id: HomeWidgetId): void => {
      const pas: Record<string, [number, number]> = {
        ArrowLeft: [-PAS_CLAVIER, 0],
        ArrowRight: [PAS_CLAVIER, 0],
        ArrowUp: [0, -PAS_CLAVIER],
        ArrowDown: [0, PAS_CLAVIER]
      }
      const delta = pas[event.key]
      if (!delta || event.ctrlKey || event.altKey || event.metaKey) return
      const from = layout.find((entry) => entry.id === id)
      if (!from) return
      event.preventDefault()
      const taille = viewport()
      const box = event.shiftKey
        ? resizeWidgetBox(from, 'se', delta[0], delta[1], taille)
        : moveWidgetBox(from, delta[0], delta[1], taille)
      setArrangement((courant) => {
        setHistoire((h) => remember(h, courant))
        return replaceWidget(courant, box)
      })
    },
    [layout, viewport]
  )

  const noticeVisible = noticeForcee || noticeVue <= NOTICE_OUVERTURES

  /**
   * Marque un panneau dont le contenu DEBORDE, et s'il reste quelque chose plus bas.
   *
   * Mesure du 2026-08-21 en pilotant l'app : le widget des interlocuteurs portait 1149 px de contenu
   * pour 788 px visibles, et rien ne l'annoncait — il fallait deviner qu'on pouvait defiler. L'etat
   * est pose en attribut plutot qu'en etat React : il change a chaque pixel de defilement, et un rendu
   * par pixel serait un cout pour une information qui n'est que visuelle.
   */
  const marquerDebordement = useCallback((element: HTMLDivElement | null): void => {
    if (!element) return
    const reste = element.scrollHeight - element.clientHeight - element.scrollTop
    element.dataset.deborde = element.scrollHeight > element.clientHeight + 2 ? 'true' : 'false'
    element.dataset.resteEnBas = reste > 8 ? 'true' : 'false'
  }, [])

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
          {noticeVisible ? (
            <p>
              Prenez une tuile n’importe où et posez-la : elle reste exactement là où vous la lâchez.
              Les huit bords la redimensionnent, les flèches aussi (Maj pour la taille).
            </p>
          ) : null}
          {erreurOuverture !== null ? (
            <p className="home-view__alerte" role="status">
              {erreurOuverture}
            </p>
          ) : null}
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
          <button
            type="button"
            onClick={annuler}
            disabled={!canUndo(histoire)}
            data-testid="home-undo"
            title="Défaire le dernier déplacement ou redimensionnement"
          >
            Annuler
          </button>
          <button type="button" onClick={scatter}>
            Disperser
          </button>
          <button type="button" onClick={resetLayout}>
            Rétablir la disposition
          </button>
          {!noticeVisible ? (
            <button
              type="button"
              onClick={() => setNoticeForcee(true)}
              title="Rappeler comment manipuler les tuiles"
              data-testid="home-rappel-notice"
            >
              ?
            </button>
          ) : null}
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
          tabIndex={0}
          role="group"
          aria-label={`${HOME_WIDGET_TITLES[box.id]} — flèches pour déplacer, Maj+flèches pour redimensionner`}
          onKeyDown={(event) => auClavier(event, box.id)}
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
            {box.id === 'mails' && compteurs.personnes > 0 ? (
              <span
                className="home-tile__count"
                title={`${compteurs.personnes} non lu(s) de personnes — ${compteurs.total} au total avec les envois automatiques`}
              >
                {compteurs.personnes}
              </span>
            ) : null}
          </div>
          <div className="home-tile__panel">
            <div
              className="home-tile__scroll"
              ref={(element) => marquerDebordement(element)}
              onScroll={(event) => marquerDebordement(event.currentTarget)}
            >
              <WidgetBody
                id={box.id}
                departures={departures}
                notices={notices}
                outlook={outlook}
                now={now}
                loading={snapshot === null && snapshotError === null}
                error={snapshotError}
                onNavigate={onNavigate}
                onOuvrir={ouvrirDansOutlook}
                onAcquitter={acquitter}
                ouvertureEnCours={ouvertureEnCours}
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
  onNavigate,
  onOuvrir,
  onAcquitter,
  ouvertureEnCours
}: {
  id: HomeWidgetId
  departures: RoutineDeparture[]
  notices: AgentNotice[]
  outlook: OutlookState
  now: number
  loading: boolean
  error: string | null
  onNavigate?: (destination: string) => void
  onOuvrir: (id: string) => Promise<void>
  onAcquitter: (alertId: string) => Promise<void>
  ouvertureEnCours: string | null
}): React.JSX.Element {
  if (id === 'hublot') {
    // Il occupait 357x298 px pour EXPLIQUER ce qu'il était. Un widget qui parle de lui-même ne sert
    // personne : il porte maintenant l'heure et la date, que le décor traverse toujours.
    return <Hublot now={now} />
  }

  if (id === 'mails' || id === 'agenda') {
    if (outlook.etat === 'chargement') return <p className="home-hint">Lecture d’Outlook…</p>
    if (outlook.etat === 'panne') {
      // La cause est AFFICHÉE. Une liste vide se lirait « vous n'avez pas de mail » alors qu'elle
      // veut dire « la lecture a échoué » — et l'utilisateur ne saurait pas quoi faire.
      return <p className="home-error">Outlook injoignable : {outlook.cause}</p>
    }
    return id === 'mails' ? (
      <InterlocuteursList
        fils={outlook.fils}
        now={now}
        onOuvrir={onOuvrir}
        ouvertureEnCours={ouvertureEnCours}
      />
    ) : (
      <AgendaList agenda={outlook.agenda} onOuvrir={onOuvrir} ouvertureEnCours={ouvertureEnCours} />
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
          <button
            type="button"
            onClick={() => onNavigate?.('watchdog')}
            title={`Ouvrir le Watchdog — ${notice.origin}`}
          >
            <span>{notice.message}</span>
            <small>
              {notice.origin} · {notice.kind === 'missed' ? 'occurrence ratée' : 'échec'}
            </small>
          </button>
          {/* Solder l'alerte SANS quitter l'accueil : sinon traiter une alerte demandait de la
              retrouver ailleurs, alors que son identifiant est déjà là. Relevé par le scout (78). */}
          {!notice.acknowledged ? (
            <button
              type="button"
              className="home-notices__acquitter"
              onClick={() => void onAcquitter(notice.id)}
              title="Acquitter : l’alerte sort du compteur"
              data-testid={`home-acquitter-${notice.id}`}
            >
              Acquitter
            </button>
          ) : null}
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
  now,
  onOuvrir,
  ouvertureEnCours
}: {
  fils: Interlocuteur[]
  now: number
  onOuvrir: (id: string) => Promise<void>
  ouvertureEnCours: string | null
}): React.JSX.Element {
  if (fils.length === 0) {
    return <p className="home-hint">Aucun message dans votre boîte de réception.</p>
  }
  const { personnes, automates, indistinct } = splitByExchange(fils)
  return (
    <>
      {personnes.length > 0 ? (
        <FilsList fils={personnes} now={now} onOuvrir={onOuvrir} ouvertureEnCours={ouvertureEnCours} />
      ) : null}
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
          <FilsList fils={automates} now={now} onOuvrir={onOuvrir} ouvertureEnCours={ouvertureEnCours} />
        </>
      ) : null}
    </>
  )
}

function FilsList({
  fils,
  now,
  onOuvrir,
  ouvertureEnCours
}: {
  fils: Interlocuteur[]
  now: number
  onOuvrir: (id: string) => Promise<void>
  ouvertureEnCours: string | null
}): React.JSX.Element {
  return (
    <ul className="home-threads">
      {fils.map((fil) => {
        const dernier = fil.messages[0]
        return (
          <li
            key={fil.cle}
            data-unread={fil.nonLus > 0 ? 'true' : undefined}
            data-echange={fil.echange === true ? 'true' : undefined}
          >
            {/* Un VRAI bouton, pas un `<li>` décoré : l'accueil informait puis renvoyait chercher
                l'élément à la main dans Outlook. Relevé en pilotant l'app ET par le scout (score 82). */}
            <button
              type="button"
              className="home-threads__ouvrir"
              onClick={() => void onOuvrir(dernier?.id ?? '')}
              disabled={!dernier || ouvertureEnCours === dernier.id}
              title={`Ouvrir dans Outlook — ${fil.adresse || fil.nom}`}
              data-testid={`home-ouvrir-mail-${fil.cle}`}
            >
              <span className="home-threads__who" aria-hidden="true">
                {initiales(fil.nom)}
              </span>
              <span className="home-threads__lines">
                <span className="home-threads__name">
                  <b>{fil.nom}</b>
                  <em>{formatExchangeDate(fil.dernierEchange, now)}</em>
                </span>
                <span className="home-threads__last">
                  {ouvertureEnCours === dernier?.id ? 'Ouverture…' : dernier?.sujet}
                </span>
              </span>
              {/* Le compte du fil, pas celui de la boîte : c'est ce qui reste à lire CHEZ ce contact. */}
              {fil.nonLus > 0 ? <span className="home-threads__tally">{fil.nonLus}</span> : null}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** L'heure et la date, que le décor traverse. Le hublot ne parle plus de lui-même. */
function Hublot({ now }: { now: number }): React.JSX.Element {
  const date = new Date(now)
  return (
    <div className="home-hublot">
      <time className="home-hublot__heure">
        {date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
      </time>
      <span className="home-hublot__date">
        {date.toLocaleDateString('fr-FR', {
          weekday: 'long',
          day: 'numeric',
          month: 'long'
        })}
      </span>
    </div>
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
function AgendaList({
  agenda,
  onOuvrir,
  ouvertureEnCours
}: {
  agenda: Agenda
  onOuvrir: (id: string) => Promise<void>
  ouvertureEnCours: string | null
}): React.JSX.Element {
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
        <ul className="home-list home-list--cliquable">
          {agenda.aujourdHui.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => void onOuvrir(entry.id)}
                disabled={ouvertureEnCours === entry.id}
                title="Ouvrir le rendez-vous dans Outlook"
                data-testid={`home-ouvrir-rdv-${entry.id}`}
              >
                <time>{formatEventTime(entry)}</time>
                <span>{ouvertureEnCours === entry.id ? 'Ouverture…' : entry.sujet}</span>
                <em>{entry.lieu}</em>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="home-hint">Rien d’autre aujourd’hui.</p>
      )}
      {agenda.semaine.length > 0 ? (
        <>
          <p className="home-subhead">Cette semaine</p>
          <ul className="home-list home-list--cliquable">
            {agenda.semaine.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => void onOuvrir(entry.id)}
                  disabled={ouvertureEnCours === entry.id}
                  title="Ouvrir le rendez-vous dans Outlook"
                  data-testid={`home-ouvrir-rdv-${entry.id}`}
                >
                  <time>{formatEventDay(entry)}</time>
                  <span>{ouvertureEnCours === entry.id ? 'Ouverture…' : entry.sujet}</span>
                  <em>{formatEventTime(entry)}</em>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  )
}
