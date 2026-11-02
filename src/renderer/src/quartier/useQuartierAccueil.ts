/**
 * L'ACCUEIL, VU DEPUIS LE QUARTIER (conv-1421) : les gestes de la souris et les widgets dans leurs tours.
 *
 * Trois gestes, trois réponses :
 *  - un objet du décor : la caméra zoome dessus pendant que sa vue s'ouvre (D-11) ;
 *  - une tour : son widget en sort, et elle reste allumée tant qu'il est dehors ; un second clic l'y
 *    fait rentrer (demande de l'utilisateur du 2026-11-01, 20:25) ;
 *  - un tanuki : son fil s'ouvre (D-3) ; celui d'un collègue montre sa carte, sans rien ouvrir, car son
 *    fil vit sur un autre poste (D10 de `grill/agent-hq-japon-town.md`, conv-1429).
 *
 * Tant que l'Accueil est affiché sur le Quartier, le partage des collègues se relit toutes les 5 s
 * (`agents-collegues.ts`) ; ailleurs, personne ne le relit.
 *
 * Seul un clic sur le fond compte : `event.target` doit être l'Accueil lui-même. Une tuile posée sur la
 * scène garde donc tous ses gestes, et le décor ne vole jamais un clic.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as SourisReact,
  type PointerEvent as PointeurReact,
  type RefObject
} from 'react'
import type { HomeWidgetId } from '../components/home-layout'
import { lireAgentsQuartier, type AgentQuartier } from './agents-quartier'
import {
  abonnerAgentsCollegues,
  abonnerModeVillage,
  agentCollegue,
  choisirModeVillage,
  estIdCollegue,
  lireAgentsCollegues,
  lireModeVillage,
  suivreAgentsCollegues,
  type AgentCollegue,
  type ModeVillage
} from './agents-collegues'
import { piloteQuartier, type CibleQuartier, type RectQuartier } from './quartier-pont'
import {
  abonnerTuilesSorties,
  basculerTuileSortie,
  lireTuilesSorties,
  visibiliteDesSorties
} from './quartier-tuiles'

const DUREE_SORTIE_MS = 560
const DUREE_RETOUR_MS = 340
const VIDE: ReadonlySet<HomeWidgetId> = new Set()
const AUCUN_COLLEGUE: readonly AgentCollegue[] = []
const EQUIPE = (): ModeVillage => 'equipe'
/** La carte d'un collègue : sa place, en pixels de l'Accueil, pour qu'elle ne sorte pas de l'écran. */
const CARTE_LARGEUR = 260
const CARTE_HAUTEUR = 150

/** Le départ d'un widget : tout petit, au sommet de sa tour. */
function transformDepuisTour(tuile: DOMRect, surface: DOMRect, tour: RectQuartier): string {
  const echelle = Math.max(0.05, Math.min(0.3, tour.w / tuile.width))
  const x = tour.x + tour.w / 2 - (tuile.width * echelle) / 2 - surface.left
  const y = tour.y + tour.h * 0.12 - surface.top
  return `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${echelle.toFixed(3)})`
}

interface Options {
  /** Le fond choisi est le Quartier, et l'Accueil est affiché. */
  actif: boolean
  surfaceRef: RefObject<HTMLDivElement | null>
  /** L'étiquette qui suit la souris : sa position s'écrit sans repasser par React. */
  etiquetteRef: RefObject<HTMLDivElement | null>
  onNavigate?: (destination: string) => void
  ouvrirConversation: (id: string) => void
}

/** La carte ouverte par un clic sur l'agent d'un collègue (D10). */
export interface CarteCollegue {
  agent: AgentCollegue
  x: number
  y: number
}

export interface SceneAccueil {
  sorties: ReadonlySet<HomeWidgetId>
  visibilite: ReturnType<typeof visibiliteDesSorties>
  survol: CibleQuartier | null
  agentSurvole: AgentQuartier | null
  /** L'agent d'un collègue sous la souris : son prénom, son titre, son activité (D9). */
  collegueSurvole: AgentCollegue | null
  carte: CarteCollegue | null
  fermerCarte(): void
  /** Le bouton « Mes agents / Toute l'équipe » (D8). */
  modeVillage: ModeVillage
  choisirModeVillage(mode: ModeVillage): void
  basculerTuile(id: HomeWidgetId): void
  auSurvol(event: PointeurReact<HTMLDivElement>): void
  auClic(event: SourisReact<HTMLDivElement>): void
  horsChamp(): void
}

export function useQuartierAccueil({
  actif,
  surfaceRef,
  etiquetteRef,
  onNavigate,
  ouvrirConversation
}: Options): SceneAccueil {
  const sorties = useSyncExternalStore(abonnerTuilesSorties, lireTuilesSorties, () => VIDE)
  const [survol, setSurvol] = useState<CibleQuartier | null>(null)
  const [carteOuverte, setCarteOuverte] = useState<CarteCollegue | null>(null)
  const [etaitActif, setEtaitActif] = useState(actif)
  const collegues = useSyncExternalStore(
    abonnerAgentsCollegues,
    lireAgentsCollegues,
    () => AUCUN_COLLEGUE
  )
  const modeVillage = useSyncExternalStore(abonnerModeVillage, lireModeVillage, EQUIPE)
  const precedentes = useRef(sorties)
  const cleSurvol = useRef('')

  const animer = useCallback(
    (id: HomeWidgetId, retour: boolean, fin?: () => void): void => {
      const surface = surfaceRef.current
      const tuile = surface?.querySelector<HTMLElement>(`[data-widget="${id}"]`)
      const tour = piloteQuartier()?.rectDeLaTour(id)
      if (!surface || !tuile || !tour || typeof tuile.animate !== 'function') {
        fin?.()
        return
      }
      const depart = transformDepuisTour(
        tuile.getBoundingClientRect(),
        surface.getBoundingClientRect(),
        tour
      )
      const arrivee = tuile.style.transform
      const images: Keyframe[] = [
        { transform: depart, opacity: 0.15, transformOrigin: '0 0' },
        { transform: arrivee, opacity: 1, transformOrigin: '0 0' }
      ]
      const duree = retour ? DUREE_RETOUR_MS : DUREE_SORTIE_MS
      const a = tuile.animate(retour ? [...images].reverse() : images, {
        duration: duree,
        easing: retour ? 'cubic-bezier(.55,0,.85,.35)' : 'cubic-bezier(.16,1,.3,1)',
        fill: retour ? 'forwards' : 'none'
      })
      if (!fin) return
      // Une animation ne finit jamais dans une fenêtre qui ne s'affiche pas : mesuré dans une instance
      // cachée, à une image par seconde. Le geste, lui, ne dépend pas de ce qu'on voit.
      let fait = false
      const finir = (): void => {
        if (fait) return
        fait = true
        fin()
      }
      a.onfinish = finir
      setTimeout(finir, duree + 120)
    },
    [surfaceRef]
  )

  // Un widget vient de sortir : il faut qu'il existe à l'écran pour partir de la tour.
  useLayoutEffect(() => {
    if (actif) for (const id of sorties) if (!precedentes.current.has(id)) animer(id, false)
    precedentes.current = sorties
  }, [sorties, actif, animer])

  /** Sort un widget de sa tour, ou l'y fait rentrer. */
  const basculerTuile = useCallback(
    (id: HomeWidgetId): void => {
      if (lireTuilesSorties().has(id)) animer(id, true, () => basculerTuileSortie(id))
      else basculerTuileSortie(id)
    },
    [animer]
  )

  const auSurvol = useCallback(
    (event: PointeurReact<HTMLDivElement>): void => {
      if (!actif) return
      const c =
        event.target === event.currentTarget
          ? (piloteQuartier()?.cibleSous(event.clientX, event.clientY) ?? null)
          : null
      const cle = c ? (c.type === 'agent' ? c.id : c.cle) : ''
      if (cle !== cleSurvol.current) {
        cleSurvol.current = cle
        setSurvol(c)
        piloteQuartier()?.survoler(c)
      }
      const surface = event.currentTarget.getBoundingClientRect()
      const etiquette = etiquetteRef.current
      if (etiquette && c) {
        const x = Math.min(event.clientX - surface.left + 14, surface.width - 230)
        const y = Math.max(8, event.clientY - surface.top - 46)
        etiquette.style.transform = `translate(${x}px, ${y}px)`
      }
    },
    [actif, etiquetteRef]
  )

  const horsChamp = useCallback((): void => {
    cleSurvol.current = ''
    setSurvol(null)
    piloteQuartier()?.survoler(null)
  }, [])

  const fermerCarte = useCallback((): void => setCarteOuverte(null), [])

  const auClic = useCallback(
    (event: SourisReact<HTMLDivElement>): void => {
      if (!actif || event.target !== event.currentTarget) return
      // Un clic sur le décor referme la carte ouverte, puis fait ce qu'il aurait fait sans elle.
      setCarteOuverte(null)
      const pilote = piloteQuartier()
      const c = pilote?.cibleSous(event.clientX, event.clientY)
      if (!pilote || !c) return
      horsChamp()
      // L'agent d'un collègue : sa carte, sans zoom ni fil ouvert — ce fil vit sur un autre poste (D10).
      if (c.type === 'agent' && estIdCollegue(c.id)) {
        const agent = agentCollegue(c.id)
        if (!agent) return
        const surface = event.currentTarget.getBoundingClientRect()
        const x = Math.max(
          8,
          Math.min(event.clientX - surface.left + 12, surface.width - CARTE_LARGEUR)
        )
        const y = Math.max(
          8,
          Math.min(event.clientY - surface.top - 24, surface.height - CARTE_HAUTEUR)
        )
        setCarteOuverte({ agent, x, y })
        return
      }
      if (c.type === 'tour') {
        basculerTuile(c.widget)
        return
      }
      if (c.type === 'vue' && c.cle === 'task') pilote.frapperGong(true)
      void pilote.zoomerSur(c).then(() => {
        if (c.type === 'agent') ouvrirConversation(c.id)
        else if (c.type === 'vue') onNavigate?.(c.destination)
      })
    },
    [actif, basculerTuile, horsChamp, onNavigate, ouvrirConversation]
  )

  // Quitter le Quartier en plein survol ne doit pas laisser une étiquette allumée : l'état se corrige
  // pendant le rendu, le décor et le souvenir de la cible juste après.
  if (actif !== etaitActif) {
    setEtaitActif(actif)
    if (!actif) {
      setSurvol(null)
      setCarteOuverte(null)
    }
  }
  useEffect(() => {
    if (actif) return
    cleSurvol.current = ''
    piloteQuartier()?.survoler(null)
  }, [actif])

  // Le partage des collègues se relit tant que l'Accueil est affiché sur le Quartier, et pas au-delà ;
  // « Mes agents » les masque tous : rien à relire.
  const suivre = actif && modeVillage === 'equipe'
  useEffect(() => (suivre ? suivreAgentsCollegues() : undefined), [suivre])

  // Échap referme la carte, comme toute fenêtre posée par-dessus.
  useEffect(() => {
    if (!carteOuverte) return
    const touche = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setCarteOuverte(null)
    }
    window.addEventListener('keydown', touche)
    return () => window.removeEventListener('keydown', touche)
  }, [carteOuverte])

  const visibilite = useMemo(() => visibiliteDesSorties(sorties), [sorties])
  const agentSurvole: AgentQuartier | null =
    survol?.type === 'agent' ? (lireAgentsQuartier().find((a) => a.id === survol.id) ?? null) : null
  const collegueSurvole: AgentCollegue | null =
    survol?.type === 'agent' ? (collegues.find((a) => a.id === survol.id) ?? null) : null
  // La carte suit l'agent tant qu'il est là (phase, titre) ; parti, elle garde ce qu'elle montrait.
  const carte: CarteCollegue | null = carteOuverte
    ? {
        ...carteOuverte,
        agent: collegues.find((a) => a.id === carteOuverte.agent.id) ?? carteOuverte.agent
      }
    : null

  return {
    sorties,
    visibilite,
    survol,
    agentSurvole,
    collegueSurvole,
    carte,
    fermerCarte,
    modeVillage,
    choisirModeVillage,
    basculerTuile,
    auSurvol,
    auClic,
    horsChamp
  }
}
