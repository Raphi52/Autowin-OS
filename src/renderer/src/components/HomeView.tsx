import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  formatEventDay,
  formatEventTime,
  groupByInterlocutor,
  parseOutlookResult,
  splitByExchange,
  splitAgenda,
  totalUnread,
  type Agenda,
  type AgendaEntry,
  type Interlocuteur
} from './outlook-model'
import {
  agentNotices,
  nextDepartures,
  unacknowledgedAlertCount,
  type AgentNotice,
  type RoutineDeparture
} from './home-widgets-model'
import {
  defaultHomeLayout,
  HOME_WIDGET_IDS,
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
import {
  basculerWidget,
  ecrireVisibilite,
  estVisible,
  lireVisibilite,
  type HomeWidgetsVisibility
} from './home-widgets-visibility'
import { EVENEMENT_NOM_JARVIS, lireNomJarvis } from './jarvis-nom'
import {
  memoriserOuvertureReglages,
  reglagesSontOuverts
} from './home-reglages-ouverture'
import {
  instantaneConversationsEnAttente,
  retirerConversationEnAttente,
  souscrireConversationsEnAttente,
  type ConversationEnAttente
} from './conversations-attention'
import { autowinStorageKey } from '../storage-keys'
import { JarvisWidget } from './JarvisWidget'
import { EnregistrementsWidget } from './EnregistrementsWidget'
import { InterlocuteursWidget } from './InterlocuteursWidget'
import './HomeView.css'
import { Spinner } from './Spinner'

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
const NOTICE_OUVERTURES = 4
/** Pas de déplacement au clavier, en pixels. Assez grand pour avancer, assez petit pour viser. */
const PAS_CLAVIER = 16
const REFRESH_MS = 30_000
/**
 * Outlook se relit moins souvent que le Task Manager : chaque lecture est un dialogue COM avec une
 * application lourde.
 *
 * Ramene de deux minutes a une : demande de l'utilisateur du 2026-09-04, « je voudrais aussi que ca
 * s'actualise automatiquement ». Deux minutes, c'est assez long pour qu'un message arrive, qu'on
 * regarde la tuile, et qu'on la croie figee.
 */
const OUTLOOK_REFRESH_MS = 60_000
/**
 * Ecart MINIMUM entre deux relectures declenchees par un retour dans la fenetre.
 *
 * Sans lui, alterner entre Autowin et une autre application lancerait un appel COM par aller-retour.
 */
const OUTLOOK_ECART_MIN_MS = 15_000

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
  /**
   * L'agencement affiche a-t-il ete POSE A LA MAIN sur la surface courante ?
   *
   * Defaut constate le 2026-09-01 : glisser une tuile jusqu'au bord droit la faisait deborder (c'est
   * permis, un tiers de tuile suffit a la reprendre), le controle de validite jugeait alors l'agencement
   * invalide pour la surface et TOUTE la page repassait a la disposition d'origine. La reconciliation
   * repond a un changement de SURFACE, jamais a un geste : tant que la surface n'a pas bouge depuis le
   * dernier geste, ce que l'utilisateur a pose fait autorite et s'affiche tel quel.
   */
  const [poseALaMain, setPoseALaMain] = useState(false)
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
   * Instant de la derniere lecture d'Outlook. Une reference, pas un etat : elle sert a espacer les
   * relectures, et la faire re-rendre la page serait un rendu de plus a chaque relecture.
   */
  const derniereLecture = useRef(0)
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

  /* ---------------------------------------------------------------- *
   * LES REGLAGES : ce que l'accueil affiche, et comment on l'appelle.
   *
   * Un seul endroit, ouvert par un seul bouton. Les commandes de disposition (annuler, disperser,
   * retablir) vivaient en barre permanente : elles servent une fois de temps en temps et occupaient
   * la place tout le temps. Elles sont donc RANGEES ici avec le reste des reglages -- demande
   * explicite de l'utilisateur le 2026-09-01.
   * ---------------------------------------------------------------- */
  // OUVERT au montage : choix de l'utilisateur du 2026-09-01. Les reglages de l'accueil (visibilite
  // des tuiles, nom de l'assistant, disposition) sont ce qu'on vient regler en arrivant ; les
  // cacher derriere un clic obligeait a le faire a chaque ouverture.
  // FERME au demarrage de l'application, mais RETROUVE OUVERT si on l'avait ouvert avant de changer
  // de page : l'etat vit dans un module, donc il survit au demontage de la vue et meurt avec la
  // fenetre. Demande de l'utilisateur du 2026-09-01.
  const [reglagesOuverts, setReglagesOuverts] = useState(() => reglagesSontOuverts())

  const basculerReglages = useCallback((): void => {
    setReglagesOuverts((ouvert) => {
      memoriserOuvertureReglages(!ouvert)
      return !ouvert
    })
  }, [])
  const [visibilite, setVisibilite] = useState<HomeWidgetsVisibility>(() =>
    lireVisibilite(window.localStorage)
  )
  /**
   * LE NOM DE L'ASSISTANT, RELU EN DIRECT.
   *
   * Il ne se SAISIT plus ici : son champ vit dans le widget de l'assistant (demande du 2026-09-01).
   * L'accueil n'en garde que la LECTURE, pour titrer la tuile. Le navigateur n'emet pas `storage`
   * dans la fenetre qui ecrit, d'ou l'evenement dedie de `jarvis-nom` — sans lui, le titre de la
   * tuile garderait l'ancien nom jusqu'au redemarrage.
   */
  const [nomJarvis, setNomJarvis] = useState<string>(() => lireNomJarvis(window.localStorage))
  useEffect(() => {
    const relire = (): void => setNomJarvis(lireNomJarvis(window.localStorage))
    window.addEventListener(EVENEMENT_NOM_JARVIS, relire)
    window.addEventListener('storage', relire)
    return () => {
      window.removeEventListener(EVENEMENT_NOM_JARVIS, relire)
      window.removeEventListener('storage', relire)
    }
  }, [])

  const basculerVisibilite = useCallback((id: HomeWidgetId): void => {
    setVisibilite((courante) => {
      const suivante = basculerWidget(courante, id)
      ecrireVisibilite(window.localStorage, suivante)
      return suivante
    })
  }, [])

  /**
   * Le titre affiche d'une tuile.
   *
   * Tous les titres sont fixes SAUF celui de l'assistant, qui suit le nom choisi : le nom regle et le
   * titre affiche doivent etre la meme chose, sinon on aurait deux verites pour un seul objet.
   */
  const titreWidget = useCallback(
    (id: HomeWidgetId): string => (id === 'jarvis' ? nomJarvis : HOME_WIDGET_TITLES[id]),
    [nomJarvis]
  )

  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const headerRef = useRef<HTMLDivElement | null>(null)
  const holdRef = useRef<HoldState | null>(null)
  /**
   * Compteur du dernier plan attribue. Reste une REF : il n'est ni lu ni affiche par le rendu, il
   * ne sert qu'a produire le prochain numero dans le gestionnaire de prise.
   */
  const frontRef = useRef(10)
  /**
   * Plan de chaque tuile. C'est un ETAT et non une ref, parce que le RENDU le lit.
   *
   * Lire une ref pendant le rendu (« Cannot access refs during render ») rend l'affichage dependant
   * d'une valeur que React ne suit pas : un rendu rejoue peut peindre un empilement perime. Et le
   * passage en etat ne coute AUCUN rendu de plus -- l'ecriture etait deja suivie d'un `setHeld`
   * dans le meme gestionnaire, donc un rendu suivait de toute facon.
   */
  const [plans, setPlans] = useState<Map<HomeWidgetId, number>>(() => new Map())

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
      top: headerHeight > 0 ? headerHeight + 32 : 142
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
  const layout = useMemo(
    () => (poseALaMain ? arrangement : reconcileLayout(arrangement, surface)),
    [arrangement, surface, poseALaMain]
  )

  // Une nouvelle surface annule cette autorite : la disposition doit y etre re-jugee.
  useEffect(() => {
    setPoseALaMain(false)
  }, [surface])

  /* ---------------------------------------------------------------- *
   * LE DECOR A DEMENAGE : il est desormais le fond de TOUTE l'application, monte a la racine de la
   * coque par `DecorDeFond`. Il ne pouvait pas rester ici — un decor possede par l'Accueil laissait
   * les autres vues sur un PNG plat, et faire cohabiter les deux revenait a payer DEUX contextes
   * WebGL et DEUX boucles d'animation pour une seule image visible.
   *
   * La cle de reglage (`home.decor.v2`) et le ralentissement `tempsDecor` sont partis avec lui : ils
   * vivent maintenant dans `DecorDeFond`, seul proprietaire de la scene.
   * ---------------------------------------------------------------- */

  /* ---------------------------------------------------------------- *
   * Les données. Lues seulement quand la vue est affichée.
   * ---------------------------------------------------------------- */
  useEffect(() => {
    if (!active) return
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const api = (
          window as unknown as { api?: { taskManagerSnapshot?: () => Promise<unknown> } }
        ).api
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
  /**
   * Ne pose AUCUN etat de facon synchrone : l'indicateur de chargement est allume par l'APPELANT.
   *
   * Elle le faisait (`if (force) setOutlookEnCours(true)`), et l'effet qui l'appelle heritait donc
   * d'un « setState synchrone dans un effet » -- un rendu en cascade, signale par le React Compiler.
   * Le linter ne peut pas savoir que l'effet passe `force = false` ; plutot que de le faire taire,
   * la fonction n'a plus d'effet synchrone du tout. Un seul appelant allumait l'indicateur : le
   * bouton, qui le fait desormais lui-meme, la ou l'intention est visible.
   */
  const readOutlook = useCallback(async (force = false): Promise<void> => {
    // Horodate AVANT l'appel, et non apres : deux declencheurs qui se suivent de pres (l'intervalle
    // et un retour dans la fenetre) doivent se voir l'un l'autre, meme pendant que la lecture dure.
    derniereLecture.current = Date.now()
    const api = (
      window as unknown as { api?: { outlookSnapshot?: (f?: boolean) => Promise<unknown> } }
    ).api
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

  /*
   * Le chemin SYNCHRONE qui reste dans `readOutlook` est son cas d'ERREUR : passerelle Outlook
   * absente, elle pose l'etat de panne avant tout `await`. Il se produit une fois, au montage, en
   * mode degrade -- un rendu de plus, sans boucle possible puisque l'etat suivant est identique.
   *
   * Le rendre asynchrone demanderait un `await` artificiel dont la seule fonction serait de faire
   * taire l'outil. Le `setState` synchrone du chemin NORMAL, lui, a ete retire : il est desormais
   * pose par le bouton qui l'allume.
   */
  useEffect(() => {
    if (!active) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void readOutlook()
    const timer = window.setInterval(() => void readOutlook(), OUTLOOK_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [active, readOutlook])

  /**
   * Relit Outlook quand on REVIENT dans la fenetre.
   *
   * L'intervalle seul ne suffit pas : Windows ralentit fortement les minuteries d'une fenetre en
   * arriere-plan, donc revenir apres une heure passee dans Outlook affichait encore la boite d'avant.
   * Le retour au premier plan est exactement l'instant ou l'utilisateur REGARDE la tuile.
   *
   * `force` court-circuite le cache de la passerelle : sinon on reafficherait l'instantane deja lu,
   * c'est-a-dire precisement ce qu'on cherche a remplacer.
   */
  useEffect(() => {
    if (!active) return
    const relire = (): void => {
      if (document.visibilityState === 'hidden') return
      if (Date.now() - derniereLecture.current < OUTLOOK_ECART_MIN_MS) return
      void readOutlook(true)
    }
    window.addEventListener('focus', relire)
    document.addEventListener('visibilitychange', relire)
    return () => {
      window.removeEventListener('focus', relire)
      document.removeEventListener('visibilitychange', relire)
    }
  }, [active, readOutlook])

  const departures = useMemo(
    () => (snapshot ? nextDepartures(snapshot.tasks, now) : []),
    [snapshot, now]
  )
  const notices = useMemo(
    () => (snapshot ? agentNotices(snapshot.alerts, snapshot.tasks) : []),
    [snapshot]
  )
  /**
   * La pastille compte sur les alertes BRUTES, jamais sur `notices` : cette liste est plafonnee a
   * 30 lignes pour tenir dans la tuile, et compter dessus faisait annoncer « 30 » a la 31e remontee
   * non lue.
   */
  const pending = snapshot ? unacknowledgedAlertCount(snapshot.alerts) : 0
  /**
   * Les conversations dont la fenetre de mosaique est en etat « cadre dore / pastille jaune » :
   * tour termine, l'utilisateur n'y est pas revenu. L'accueil ne les DEDUIT pas — la mosaique les
   * publie dans un registre partage, seule source qui sache quand la bordure s'allume.
   */
  const enAttente = useSyncExternalStore(
    souscrireConversationsEnAttente,
    instantaneConversationsEnAttente
  )
  const ouvrirConversation = useCallback(
    (id: string): void => {
      // Ouvrir, c'est y revenir : la conversation quitte la liste au moment ou on la demande.
      retirerConversationEnAttente(id)
      window.dispatchEvent(new CustomEvent('autowin:open-conversation', { detail: id }))
      onNavigate?.('chat')
    },
    [onNavigate]
  )
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
      const plan = frontRef.current
      setPlans((courants) => new Map(courants).set(id, plan))
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
      setPoseALaMain(true)
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
      setPoseALaMain(true)
      return scatterHomeLayout(courant, viewport(), Math.random)
    })
  }, [viewport])
  const annuler = useCallback(() => {
    setHistoire((h) => {
      const defait = undo(h)
      if (!defait) return h
      setPoseALaMain(true)
      setArrangement(defait.arrangement)
      return defait.history
    })
  }, [])

  /** Ouvre un élément dans Outlook. La cause d'un échec est AFFICHÉE, pas avalée. */
  const ouvrirDansOutlook = useCallback(async (id: string): Promise<void> => {
    const api = (
      window as unknown as {
        api?: { outlookOuvrir?: (id: string) => Promise<{ ok: boolean; erreur?: string }> }
      }
    ).api
    if (!api?.outlookOuvrir) {
      setErreurOuverture('Cette version ne sait pas encore ouvrir un élément dans Outlook.')
      return
    }
    setOuvertureEnCours(id)
    setErreurOuverture(null)
    try {
      const resultat = await api.outlookOuvrir(id)
      if (!resultat.ok)
        setErreurOuverture(resultat.erreur ?? "Outlook n'a pas pu ouvrir cet élément.")
    } catch (error) {
      setErreurOuverture(error instanceof Error ? error.message : String(error))
    } finally {
      setOuvertureEnCours(null)
    }
  }, [])

  /**
   * ENVOIE une réponse à un message Outlook.
   *
   * Le seul chemin de cette page qui écrit quelque part. La confirmation est demandée par la tuile,
   * juste au-dessus du bouton : c'est là que l'utilisateur regarde. Le résultat est RENDU à
   * l'appelant plutôt qu'affiché ici — la tuile doit pouvoir dire « envoyé » à l'endroit exact où
   * l'utilisateur vient de cliquer.
   */
  const repondreDansOutlook = useCallback(
    async (id: string, corps: string): Promise<{ ok: boolean; erreur?: string }> => {
      const api = (
        window as unknown as {
          api?: {
            outlookRepondre?: (id: string, corps: string) => Promise<{ ok: boolean; erreur?: string }>
          }
        }
      ).api
      if (!api?.outlookRepondre) {
        return { ok: false, erreur: 'Cette version ne sait pas encore répondre depuis Outlook.' }
      }
      try {
        return await api.outlookRepondre(id, corps)
      } catch (error) {
        return { ok: false, erreur: error instanceof Error ? error.message : String(error) }
      }
    },
    []
  )

  /**
   * MARQUE des messages comme lus dans Outlook, puis relit la boîte AUSSITÔT.
   *
   * Défaut relevé par l'utilisateur le 2026-09-04 : « la notif reste même après avoir lu le message ».
   * Le widget lisait sans rien écrire, donc l'instantané suivant rendait toujours ces messages non
   * lus. Deux moitiés sont nécessaires pour que la pastille parte : l'écriture dans Outlook, et la
   * RELECTURE forcée — c'est elle qui fait passer le compteur de la tuile à jour tout de suite. Sans
   * elle, le clic resterait sans effet visible jusqu'au cycle suivant.
   */
  const marquerLuDansOutlook = useCallback(
    async (ids: string[]): Promise<{ ok: boolean; erreur?: string }> => {
      const api = (
        window as unknown as {
          api?: {
            outlookMarquerLu?: (ids: readonly string[]) => Promise<{ ok: boolean; erreur?: string }>
          }
        }
      ).api
      if (!api?.outlookMarquerLu) {
        return {
          ok: false,
          erreur: 'Cette version ne sait pas encore marquer un message comme lu.'
        }
      }
      try {
        const resultat = await api.outlookMarquerLu(ids)
        if (resultat.ok) await readOutlook(true)
        return resultat
      } catch (error) {
        return { ok: false, erreur: error instanceof Error ? error.message : String(error) }
      }
    },
    [readOutlook]
  )

  /** Acquitte une alerte d'agent depuis l'accueil, sans aller la chercher ailleurs. */
  const acquitter = useCallback(async (alertId: string): Promise<void> => {
    const api = (
      window as unknown as {
        api?: { taskManagerAcknowledge?: (id: string) => Promise<boolean> }
      }
    ).api
    if (!api?.taskManagerAcknowledge) return
    await api.taskManagerAcknowledge(alertId)
    // Relecture immédiate : sans elle, le compteur ne bougerait qu'au prochain cycle de 30 s et le
    // clic paraîtrait sans effet.
    const snapshotApi = (
      window as unknown as {
        api?: { taskManagerSnapshot?: () => Promise<unknown> }
      }
    ).api
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
      {/* UNE seule rangée, qui se replie. Deux blocs positionnés en absolu se recouvraient dès que la
          fenêtre devenait étroite : le titre passait sous les boutons. Une rangée qui se replie rend
          ce chevauchement impossible, quelle que soit la largeur. */}
      <div
        className="home-view__header"
        ref={headerRef}
        data-reglages={reglagesOuverts ? 'true' : undefined}
      >
        <div className="home-view__masthead">
          {/* Le rouage vit DANS la plaque du titre, a sa droite (demande utilisateur du 2026-09-02) :
              un bouton isole a l'autre bout de l'ecran obligeait a traverser la page pour un reglage. */}
          <div className="home-view__masthead-ligne">
            <h1>
              Autowin <b>Accueil</b>
            </h1>
            <button
              type="button"
              className="home-view__rouage"
              onClick={basculerReglages}
              aria-expanded={reglagesOuverts}
              aria-label="Réglages de l’accueil"
              data-testid="home-settings"
              title="Réglages de l'accueil : widgets affichés, nom de l'assistant, disposition"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.63-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.63.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
              </svg>
            </button>
          </div>
          {noticeVisible ? (
            <p>
              Prenez une tuile n’importe où et posez-la : elle reste exactement là où vous la
              lâchez. Les huit bords la redimensionnent, les flèches aussi (Maj pour la taille).
            </p>
          ) : null}
          {erreurOuverture !== null ? (
            <p className="home-view__alerte" role="status">
              {erreurOuverture}
            </p>
          ) : null}
        </div>
        {reglagesOuverts ? (
          <div className="home-view__settings" role="dialog" aria-label="Réglages de l'accueil" data-testid="home-settings-panel">
            <section className="home-settings__bloc">
              <h3>Widgets affichés</h3>
              <ul>
                {HOME_WIDGET_IDS.map((id) => (
                  <li key={id}>
                    <label>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={estVisible(visibilite, id)}
                        aria-checked={estVisible(visibilite, id)}
                        aria-label={titreWidget(id)}
                        data-testid={`home-widget-switch-${id}`}
                        onChange={() => basculerVisibilite(id)}
                      />
                      <span>{titreWidget(id)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
            {/* Les reglages de l'assistant (nom, voix, debit, hauteur) ne sont PLUS ici : ils
                vivent dans SON widget — demande de l'utilisateur du 2026-09-01. Ce panneau ne garde
                que ce qui concerne la PAGE : les tuiles affichees et leur disposition. */}
            <section className="home-settings__bloc">
              <h3>Disposition</h3>
              <div className="home-settings__actions">
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
                <button
                  type="button"
                  onClick={() => setNoticeForcee(true)}
                  title="Rappeler comment manipuler les tuiles"
                  data-testid="home-rappel-notice"
                >
                  Rappeler l'aide
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </div>

      {/* Seules les tuiles ALLUMEES sont rendues : une tuile eteinte ne doit ni s'afficher, ni faire
          tourner son contenu (l'assistant tient un micro). L'agencement, lui, n'est PAS touche —
          rallumer une tuile la rend exactement ou elle etait. */}
      {layout
        .filter((box) => estVisible(visibilite, box.id))
        .map((box) => (
        <section
          key={box.id}
          className="home-tile"
          data-widget={box.id}
          data-held={held === box.id ? 'true' : undefined}
          data-testid={`home-widget-${box.id}`}
          tabIndex={0}
          role="group"
          aria-label={`${titreWidget(box.id)} — flèches pour déplacer, Maj+flèches pour redimensionner`}
          onKeyDown={(event) => auClavier(event, box.id)}
          style={{
            width: `${box.w}px`,
            height: `${box.h}px`,
            zIndex: plans.get(box.id) ?? 10,
            // Z RAMENE A 0 au rendu : avec `perspective: 1600px`, un z negatif mettait la tuile a
            // l'echelle 1600/(1600+|z|) (0.93 a 0.98) et rasterisait son texte hors grille pixel —
            // d'ou des widgets plus FLOUS que « mails » (seul z: 0). La profondeur reste portee par
            // `zIndex` (plans) et les ombres, sans mise a l'echelle fractionnaire.
            transform: `translate3d(${box.x}px, ${box.y}px, 0)`
          }}
        >
          {/*
            LA PRISE EST LA BARRE DU HAUT, ET ELLE SEULE (demande utilisateur du 2026-09-02).
            Saisir n'importe ou dans le corps rendait le contenu inutilisable : selectionner un
            texte, tirer un curseur de reglage ou cliquer un lien amorçait un deplacement de tuile.
          */}
          <div
            className="home-tile__label"
            onPointerDown={(event) => grab(event, box.id, 'move')}
          >
            <h2>{titreWidget(box.id)}</h2>
            <i className="home-tile__rule" />
            {box.id === 'notifications' && pending > 0 ? (
              <span className="home-tile__count" title={`${pending} remontée(s) à lire`}>
                {pending}
              </span>
            ) : null}
            {box.id === 'conversations' && enAttente.length > 0 ? (
              <span
                className="home-tile__count"
                title={`${enAttente.length} conversation(s) en attente de reprise`}
              >
                {enAttente.length}
              </span>
            ) : null}
            {/* Relire Outlook se commande DEPUIS la tuile Outlook : le bouton vivait dans la barre
                du haut, loin de ce qu'il rafraichit. Demande de l'utilisateur du 2026-09-01. */}
            {box.id === 'mails' ? (
              <button
                type="button"
                className="home-tile__action"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  setOutlookEnCours(true)
                  void readOutlook(true)
                }}
                disabled={outlookEnCours}
                data-testid="home-refresh-outlook"
                title={
                  outlook.etat === 'ok'
                    ? `Outlook lu à ${new Date(outlook.luLe).toLocaleTimeString('fr-FR')}`
                    : 'Relire Outlook maintenant'
                }
              >
                {outlookEnCours ? <Spinner /> : 'Actualiser'}
              </button>
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
                enAttente={enAttente}
                onOuvrirConversation={ouvrirConversation}
                onOuvrir={ouvrirDansOutlook}
                onRepondre={repondreDansOutlook}
                onMarquerLu={marquerLuDansOutlook}
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
  enAttente,
  onOuvrirConversation,
  onOuvrir,
  onRepondre,
  onMarquerLu,
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
  enAttente: readonly ConversationEnAttente[]
  onOuvrirConversation: (id: string) => void
  onOuvrir: (id: string) => Promise<void>
  onRepondre: (id: string, corps: string) => Promise<{ ok: boolean; erreur?: string }>
  onMarquerLu: (ids: string[]) => Promise<{ ok: boolean; erreur?: string }>
  onAcquitter: (alertId: string) => Promise<void>
  ouvertureEnCours: string | null
}): React.JSX.Element {
  if (id === 'enregistrements') {
    // Le micro qui ECRIT sur le disque, et la liste de ce qu'il a ecrit. A part de Jarvis a
    // dessein : ici le mot « Jarvis » prononce ne lance rien.
    return <EnregistrementsWidget />
  }

  if (id === 'jarvis') {
    // Le seul widget qui PARLE a l'app au lieu de la lire : micro continu et fil du direct.
    return <JarvisWidget />
  }

  if (id === 'conversations') {
    // Le hublot ne montrait qu'une horloge posée sur le décor — « ça sert à rien ». À sa place, la
    // seule chose que l'accueil ne pouvait pas dire : où l'agent attend qu'on revienne.
    return <ConversationsEnAttenteList items={enAttente} onOuvrir={onOuvrirConversation} />
  }

  if (id === 'mails' || id === 'agenda') {
    if (outlook.etat === 'chargement')
      return (
        <p className="home-hint">
          <Spinner /> Lecture d’Outlook…
        </p>
      )
    if (outlook.etat === 'panne') {
      // La cause est AFFICHÉE. Une liste vide se lirait « vous n'avez pas de mail » alors qu'elle
      // veut dire « la lecture a échoué » — et l'utilisateur ne saurait pas quoi faire.
      return <p className="home-error">Outlook injoignable : {outlook.cause}</p>
    }
    return id === 'mails' ? (
      <InterlocuteursWidget
        fils={outlook.fils}
        now={now}
        onOuvrir={onOuvrir}
        ouvertureEnCours={ouvertureEnCours}
        onRepondre={onRepondre}
        onMarquerLu={onMarquerLu}
      />
    ) : (
      <AgendaList agenda={outlook.agenda} onOuvrir={onOuvrir} ouvertureEnCours={ouvertureEnCours} />
    )
  }

  if (error) {
    return <p className="home-error">Task Manager injoignable : {error}</p>
  }
  if (loading) {
    return (
      <p className="home-hint">
        <Spinner /> Lecture du Task Manager…
      </p>
    )
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
 * Les conversations qui ATTENDENT une reprise, une ligne cliquable chacune.
 *
 * La pastille jaune reprend le code couleur de la fenetre de mosaique : ce qui est dore la-bas
 * est jaune ici, sinon l'accueil parlerait une autre langue que le chat.
 */
function ConversationsEnAttenteList({
  items,
  onOuvrir
}: {
  items: readonly ConversationEnAttente[]
  onOuvrir: (id: string) => void
}): React.JSX.Element {
  if (items.length === 0) {
    return (
      <p className="home-hint">
        Aucune conversation en attente. Les fenêtres dont le tour vient de finir apparaîtront ici.
      </p>
    )
  }
  return (
    <ul className="home-convs">
      {items.map((conversation) => (
        <li key={conversation.id}>
          <button
            type="button"
            data-testid="home-conversation"
            data-conv-id={conversation.id}
            onClick={() => onOuvrir(conversation.id)}
            title="Ouvrir cette conversation dans le chat"
          >
            <i className="home-convs__dot" aria-hidden="true" />
            <span className="home-convs__title">{conversation.titre || 'Sans titre'}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** L'agenda : le PROCHAIN rendez-vous en tête, puis le reste d'aujourd'hui et de la semaine. */
function AgendaList({
  agenda,
  onOuvrir,
  ouvertureEnCours
}: {
  agenda: Agenda
  onOuvrir: (id: string) => Promise<void>
  ouvertureEnCours: string | null
}): React.JSX.Element {
  // Le widget n'est plus « du jour » : sa première ligne nomme TOUJOURS le prochain rendez-vous,
  // quel que soit son jour — c'est la question que l'utilisateur pose en premier.
  const prochain = agenda.aujourdHui[0] ?? agenda.semaine[0] ?? agenda.suivant
  const resteAujourdHui = agenda.aujourdHui.filter((entry) => entry.id !== prochain?.id)
  const resteSemaine = agenda.semaine.filter((entry) => entry.id !== prochain?.id)
  if (prochain === null || prochain === undefined) {
    return <p className="home-hint">Aucun rendez-vous à venir dans votre agenda.</p>
  }
  const ligne = (entry: AgendaEntry, label: string): React.JSX.Element => (
    <li key={entry.id}>
      <button
        type="button"
        onClick={() => void onOuvrir(entry.id)}
        disabled={ouvertureEnCours === entry.id}
        title="Ouvrir le rendez-vous dans Outlook"
        data-testid={`home-ouvrir-rdv-${entry.id}`}
      >
        <time>{label}</time>
        <span>{ouvertureEnCours === entry.id ? 'Ouverture…' : entry.sujet}</span>
        <em>{entry.lieu || formatEventTime(entry)}</em>
      </button>
    </li>
  )
  return (
    <>
      <p className="home-subhead">Prochain</p>
      <ul className="home-list home-list--cliquable" data-testid="home-agenda-prochain">
        {ligne(
          prochain,
          prochain.aujourdHui
            ? formatEventTime(prochain)
            : `${formatEventDay(prochain)} · ${formatEventTime(prochain)}`
        )}
      </ul>
      {resteAujourdHui.length > 0 ? (
        <>
          <p className="home-subhead">Aujourd’hui</p>
          <ul className="home-list home-list--cliquable">
            {resteAujourdHui.map((entry) => ligne(entry, formatEventTime(entry)))}
          </ul>
        </>
      ) : null}
      {resteSemaine.length > 0 ? (
        <>
          <p className="home-subhead">Cette semaine</p>
          <ul className="home-list home-list--cliquable">
            {resteSemaine.map((entry) => ligne(entry, formatEventDay(entry)))}
          </ul>
        </>
      ) : null}
    </>
  )
}
