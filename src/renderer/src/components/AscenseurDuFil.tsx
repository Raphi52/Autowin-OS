import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as EvenementPointeur,
  type ReactElement,
  type RefObject,
  type WheelEvent as EvenementMolette
} from 'react'
import './AscenseurDuFil.css'
import {
  cibleAimant,
  aimanterSurPiste,
  cranCale,
  cranCourant,
  cranSousPointeur,
  dureeGlisse,
  elementDeLecture,
  hautDansLeContenu,
  hautDansLeFil,
  hautDeVuePour,
  lireReperes,
  MARGE_PISTE,
  moletteFaitDefiler,
  placerEtiquettes,
  poignee,
  positionGlissee,
  reserveDeLaCarte,
  scrollTopApresGlisse,
  scrollTopSousPointeur,
  SELECTEUR_MESSAGES,
  seuilMolette,
  versPiste,
  voisinsDeLaVue,
  type Geometrie,
  type Repere
} from './ascenseur-du-fil'
import { isChatNearBottom } from './chat-view-model'

/**
 * ASCENSEUR DU FIL À CRANS — « 1 · Dépli en place » (draft conv-1114, 2026-10-23).
 *
 * Au repos : une barre fine de 18 px à la place de l'ascenseur du système, un cran dégradé par
 * message de l'utilisateur. Dès la molette (ou une prise de la barre), elle se DÉPLIE en carte du
 * fil de 72 px, par-dessus le bord du texte : ses bulles en dégradé, les réponses en pavés gris,
 * la vue en cadre. Elle se replie 1 s après l'arrêt, sauf si la souris est dessus.
 * L'aimant : une fin de molette tout près d'un message le cale à 10 px du haut. La barre est aussi
 * un curseur : un clic n'importe où y amène la vue, et un glisser fait suivre le fil à la souris en
 * marquant un arrêt sur chacun de tes messages (voir `surAppui`).
 */

const FINE = 18
const CARTE = 72
/** Hauteur (écart compris) d'un aperçu sur deux lignes, puis compact sur une ligne (AscenseurDuFil.css). */
const ETIQUETTE = 44
const ETIQUETTE_COMPACTE = 26
/** Délai sans défilement qui marque la fin d'un coup de molette (fin de l'inertie comprise). */
const FIN_DEFILEMENT_MS = 140
/** Une fin de défilement n'aimante que si la molette a servi juste avant. */
const FENETRE_MOLETTE_MS = 1500
const REPLI_MS = 1000

type Place = { top: number; height: number; right: number }

const memeReperes = (a: readonly Repere[], b: readonly Repere[]): boolean =>
  a.length === b.length &&
  a.every(
    (r, i) =>
      r.haut === b[i].haut &&
      r.hauteur === b[i].hauteur &&
      r.numero === b[i].numero &&
      r.heure === b[i].heure &&
      r.texte === b[i].texte &&
      r.element === b[i].element
  )

export function AscenseurDuFil({
  conteneurRef,
  numeroDepart,
  onGesteLecteur
}: {
  conteneurRef: RefObject<HTMLDivElement | null>
  /** Nombre de tes messages pas encore rendus en haut du fil (rendu par tranches). */
  numeroDepart: number
  /** Prévient le fil qu'un défilement vient du LECTEUR (mémoire de la position de lecture). */
  onGesteLecteur?: () => void
}): ReactElement | null {
  const idDegrade = `adf-deg-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const [reperes, setReperes] = useState<Repere[]>([])
  const [geo, setGeo] = useState<Geometrie>({ scrollTop: 0, clientHeight: 0, scrollHeight: 0 })
  const [place, setPlace] = useState<Place | null>(null)
  const [deplie, setDeplie] = useState(false)
  const [survol, setSurvol] = useState<Repere | null>(null)

  // Dernières valeurs, lues par les écouteurs posés une seule fois (défilement, mesure).
  const numeroDepartRef = useRef(numeroDepart)
  const onGesteRef = useRef(onGesteLecteur)
  const reperesRef = useRef(reperes)
  useLayoutEffect(() => {
    numeroDepartRef.current = numeroDepart
    onGesteRef.current = onGesteLecteur
    reperesRef.current = reperes
  })
  const surBarreRef = useRef(false)
  const glisseRef = useRef<{
    y: number
    depart: number
    geo: Geometrie
    poignee: boolean
    bouge: boolean
    /** Cran sous la poignée attrapée : un simple clic (sans glisser) y mène quand même. */
    cranSousPoignee: Repere | null
  } | null>(null)
  const derniereMoletteRef = useRef(0)
  const minuteurRepliRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const minuteurFinRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Maintien de la ligne lue pendant que le fil change de largeur (voir plus bas). */
  const maintienRef = useRef(0)
  /**
   * Le message sur lequel la vue vient d'être amenée (clic sur un cran, aimant) : c'est LUI que le
   * maintien garde en place tant que le fil se réagence, jusqu'au prochain geste. Sans lui, le
   * maintien reprenait l'élément du haut de la vue pendant le trajet et déplaçait la bulle arrivée à
   * 10 px de 22 à 43 px (trace de la sonde, conv-1114).
   */
  const ancreRef = useRef<HTMLElement | null>(null)
  /** Horodatage de la dernière image où le glissement a posé la vue (voir le maintien). */
  const imageDuGlissementRef = useRef(-1)

  const lireGeo = (conteneur: HTMLElement): Geometrie => ({
    scrollTop: conteneur.scrollTop,
    clientHeight: conteneur.clientHeight,
    scrollHeight: conteneur.scrollHeight
  })

  const programmerRepli = useCallback((): void => {
    if (minuteurRepliRef.current) clearTimeout(minuteurRepliRef.current)
    minuteurRepliRef.current = setTimeout(() => {
      if (!surBarreRef.current && !glisseRef.current) setDeplie(false)
    }, REPLI_MS)
  }, [])

  // Glissement en cours (aimant, clic sur un cran) : une molette ou une prise de la barre l'arrête.
  const glissementRef = useRef(0)
  const arreterGlissement = useCallback((): void => {
    if (glissementRef.current) cancelAnimationFrame(glissementRef.current)
    glissementRef.current = 0
  }, [])

  const allerA = useCallback(
    (cible: number, vers?: Repere | null): void => {
      const conteneur = conteneurRef.current
      if (!conteneur) return
      arreterGlissement()
      // La vue glisse ELLE-MÊME, image par image : `scrollTo({ behavior: 'smooth' })` sautait d'un
      // coup sur ce poste, qui a la réduction des animations active (conv-1114, « pas fluide »).
      // Vers un MESSAGE, la cible est relue à chaque image : la carte qui s'ouvre décale le fil et
      // réagence le texte au-dessus pendant le trajet (bulle arrivée à 53 px au lieu de 10 sinon).
      ancreRef.current = vers?.element ?? null
      const but = (): number => {
        const element = vers?.element
        if (!element || !element.isConnected) return cible
        return hautDeVuePour({ haut: hautDansLeContenu(element, conteneur) }, lireGeo(conteneur))
      }
      const depart = conteneur.scrollTop
      const ecart = but() - depart
      if (Math.abs(ecart) < 1) return
      const duree = dureeGlisse(ecart)
      const t0 = performance.now()
      const pas = (t: number): void => {
        imageDuGlissementRef.current = t
        conteneur.scrollTop = positionGlissee(depart, but() - depart, t - t0, duree)
        glissementRef.current = t - t0 < duree ? requestAnimationFrame(pas) : 0
      }
      glissementRef.current = requestAnimationFrame(pas)
    },
    [conteneurRef, arreterGlissement]
  )

  // MESURE : la place de la barre (calée sur le fil), sa géométrie et les messages rendus. Une fois
  // par image au plus, sur tout changement de taille du fil ou d'un message (streaming, images).
  useEffect(() => {
    const conteneur = conteneurRef.current
    if (!conteneur) return
    let image = 0
    const mesurer = (): void => {
      image = 0
      const parent = conteneur.offsetParent as HTMLElement | null
      const nouvellePlace: Place = {
        top: conteneur.offsetTop,
        height: conteneur.clientHeight,
        right: parent ? parent.clientWidth - conteneur.offsetLeft - conteneur.offsetWidth : 0
      }
      setPlace((p) =>
        p &&
        p.top === nouvellePlace.top &&
        p.height === nouvellePlace.height &&
        p.right === nouvellePlace.right
          ? p
          : nouvellePlace
      )
      const g = lireGeo(conteneur)
      setGeo((p) =>
        p.scrollTop === g.scrollTop &&
        p.clientHeight === g.clientHeight &&
        p.scrollHeight === g.scrollHeight
          ? p
          : g
      )
      const r = lireReperes(conteneur, numeroDepartRef.current)
      setReperes((p) => (memeReperes(p, r) ? p : r))
    }
    const planifier = (): void => {
      if (!image) image = requestAnimationFrame(mesurer)
    }
    // Hors navigateur complet (certains environnements de test), pas d'observateur : une seule mesure.
    if (typeof ResizeObserver === 'undefined' || typeof MutationObserver === 'undefined') {
      planifier()
      return () => {
        if (image) cancelAnimationFrame(image)
      }
    }
    const tailles = new ResizeObserver(planifier)
    const suivis = new Set<Element>()
    const suivreMessages = (): void => {
      tailles.observe(conteneur)
      for (const element of conteneur.querySelectorAll(SELECTEUR_MESSAGES)) {
        if (suivis.has(element)) continue
        suivis.add(element)
        tailles.observe(element)
      }
      for (const element of suivis) {
        if (!element.isConnected) {
          tailles.unobserve(element)
          suivis.delete(element)
        }
      }
      planifier()
    }
    const ajouts = new MutationObserver(suivreMessages)
    ajouts.observe(conteneur, { childList: true })
    suivreMessages()
    window.addEventListener('resize', planifier)
    return () => {
      if (image) cancelAnimationFrame(image)
      tailles.disconnect()
      ajouts.disconnect()
      window.removeEventListener('resize', planifier)
    }
  }, [conteneurRef])

  // Un nouveau départ de numérotation (tranche rendue en haut) se relit tout de suite.
  useEffect(() => {
    const conteneur = conteneurRef.current
    if (!conteneur) return
    const r = lireReperes(conteneur, numeroDepart)
    setReperes((p) => (memeReperes(p, r) ? p : r))
  }, [conteneurRef, numeroDepart])

  // DÉFILEMENT : position de la vue, dépli à la molette, aimant à la fin d'un coup de molette.
  useEffect(() => {
    const conteneur = conteneurRef.current
    if (!conteneur) return
    let image = 0
    const surDefilement = (): void => {
      if (!image)
        image = requestAnimationFrame(() => {
          image = 0
          const g = lireGeo(conteneur)
          setGeo((p) =>
            p.scrollTop === g.scrollTop &&
            p.clientHeight === g.clientHeight &&
            p.scrollHeight === g.scrollHeight
              ? p
              : g
          )
        })
      if (minuteurFinRef.current) clearTimeout(minuteurFinRef.current)
      minuteurFinRef.current = setTimeout(() => {
        if (glisseRef.current) return
        if (Date.now() - derniereMoletteRef.current > FENETRE_MOLETTE_MS) return
        derniereMoletteRef.current = 0
        const g = lireGeo(conteneur)
        // Collé au bas : c'est le suivi de la fin du fil qui décide, pas l'aimant.
        if (isChatNearBottom(g)) return
        const crans = reperesRef.current.filter((r) => r.role === 'user')
        const cible = cibleAimant(g, crans, seuilMolette(g.clientHeight))
        if (cible !== null)
          allerA(
            cible,
            crans.find((cran) => hautDeVuePour(cran, g) === cible)
          )
      }, FIN_DEFILEMENT_MS)
      if (derniereMoletteRef.current) programmerRepli()
    }
    const surMolette = (event: WheelEvent): void => {
      // En butée (tout en haut vers le haut, tout en bas vers le bas), rien ne défile : la carte ne
      // s'ouvre pas et ne prolonge pas son ouverture (conv-1114).
      if (!moletteFaitDefiler(event.deltaY, lireGeo(conteneur))) return
      arreterGlissement()
      ancreRef.current = null
      derniereMoletteRef.current = Date.now()
      setDeplie(true)
      programmerRepli()
    }
    conteneur.addEventListener('scroll', surDefilement, { passive: true })
    conteneur.addEventListener('wheel', surMolette, { passive: true })
    return () => {
      if (image) cancelAnimationFrame(image)
      conteneur.removeEventListener('scroll', surDefilement)
      conteneur.removeEventListener('wheel', surMolette)
    }
  }, [conteneurRef, allerA, arreterGlissement, programmerRepli])

  useEffect(
    () => () => {
      if (minuteurRepliRef.current) clearTimeout(minuteurRepliRef.current)
      if (minuteurFinRef.current) clearTimeout(minuteurFinRef.current)
      if (glissementRef.current) cancelAnimationFrame(glissementRef.current)
      if (maintienRef.current) cancelAnimationFrame(maintienRef.current)
    },
    []
  )

  // LA CARTE DÉCALE LA CONVERSATION (conv-1114 : « ça doit décaler la conv et pas la masquer ») :
  // pendant qu'elle est ouverte, le fil réserve sa place à droite (AscenseurDuFil.css,
  // `data-ascenseur`), au même rythme qu'elle. La marge de départ se lit fil replié.
  // Le texte se réagence sur la nouvelle largeur : la ligne lue est tenue en place, image par image,
  // le temps de la transition (800 ms à l'ouverture, 200 ms au repli). Seul le RÉAGENCEMENT est
  // compensé : la position mesurée dans le contenu du fil ne bouge pas quand on défile, donc la
  // molette du lecteur garde tout son effet.
  useLayoutEffect(() => {
    const conteneur = conteneurRef.current
    if (!conteneur) return
    if (deplie === (conteneur.dataset.ascenseur === 'deplie')) return
    if (maintienRef.current) cancelAnimationFrame(maintienRef.current)
    let lu =
      (ancreRef.current?.isConnected ? ancreRef.current : null) ?? elementDeLecture(conteneur)
    let precedent = lu ? hautDansLeFil(lu, conteneur) : 0
    const fin = performance.now() + (deplie ? 800 : 200) + 120
    const tenir = (t: number): void => {
      maintienRef.current = 0
      // Un glissement vers un message ou un glisser de la barre mènent la vue : ils visent déjà la
      // bonne place, compenser en plus la déplacerait deux fois. Y compris dans l'image où le
      // glissement vient de FINIR : lancé au clic, il passe avant le maintien dans chaque image, et
      // sa dernière image se déclarait finie juste avant que le maintien compense le même
      // réagencement une seconde fois (vue 22 à 43 px trop loin, trace conv-1114 sur conv-1113).
      const pilotee =
        glissementRef.current !== 0 ||
        imageDuGlissementRef.current === t ||
        glisseRef.current?.bouge === true
      const ancre = ancreRef.current?.isConnected ? ancreRef.current : null
      if (ancre && !pilotee) {
        // Vue amenée sur un de tes messages : il est CALÉ à 10 px à chaque image, plutôt que d'y
        // reporter un écart — une erreur ne peut pas s'accumuler.
        const cible = hautDeVuePour(
          { haut: hautDansLeContenu(ancre, conteneur) },
          lireGeo(conteneur)
        )
        if (Math.abs(conteneur.scrollTop - cible) >= 0.5) conteneur.scrollTop = cible
      } else if (lu && lu.isConnected && !pilotee) {
        const haut = hautDansLeFil(lu, conteneur)
        if (Math.abs(haut - precedent) >= 0.5) conteneur.scrollTop += haut - precedent
      }
      // L'ancre suit le HAUT de la vue courante : la molette du lecteur a pu la faire défiler.
      lu = (ancreRef.current?.isConnected ? ancreRef.current : null) ?? elementDeLecture(conteneur)
      precedent = lu ? hautDansLeFil(lu, conteneur) : 0
      if (t < fin) maintienRef.current = requestAnimationFrame(tenir)
    }
    if (deplie) {
      const marge = parseFloat(getComputedStyle(conteneur).paddingRight)
      conteneur.style.setProperty('--adf-reserve', `${reserveDeLaCarte(marge, CARTE)}px`)
      conteneur.dataset.ascenseur = 'deplie'
    } else {
      delete conteneur.dataset.ascenseur
    }
    maintienRef.current = requestAnimationFrame(tenir)
  }, [deplie, conteneurRef])

  // Le fil survit à la barre (elle est remontée à chaque conversation) : rien ne doit y rester.
  useEffect(() => {
    const conteneur = conteneurRef.current
    return () => {
      if (!conteneur) return
      delete conteneur.dataset.ascenseur
      conteneur.style.removeProperty('--adf-reserve')
    }
  }, [conteneurRef])

  if (!place || place.height <= 2 * MARGE_PISTE || geo.scrollHeight <= geo.clientHeight + 1)
    return null

  const H = place.height
  const crans = reperes.filter((r) => r.role === 'user')
  const vue = poignee(geo, H)
  const cale = cranCale(geo, crans)
  const courant = cranCourant(geo, crans)
  const y = (haut: number): number => versPiste(haut, geo.scrollHeight, H)
  const yLocal = (event: EvenementPointeur<HTMLDivElement>): number =>
    event.clientY - event.currentTarget.getBoundingClientRect().top

  /*
   * LA BARRE EST UN CURSEUR (conv-1114 : « la barre doit slider et je dois pouvoir clicker n'importe
   * où dessus »). Avant, seul un appui sur la poignée (20 px) faisait glisser, et un clic allait au
   * message le plus proche, pas à l'endroit cliqué. Maintenant :
   *  - appui n'importe où : la vue y glisse (cadre centré sur la souris ; sur un cran, ton message) ;
   *  - bouton tenu : le fil suit la souris, et s'arrête sur tes crans (`aimanterSurPiste`) ;
   *  - appui SUR la poignée : elle se tire telle quelle, sans saut.
   */
  const surAppui = (event: EvenementPointeur<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const conteneur = conteneurRef.current
    if (!conteneur) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    arreterGlissement()
    ancreRef.current = null
    onGesteRef.current?.()
    const py = yLocal(event)
    const g = lireGeo(conteneur)
    const v = poignee(g, H)
    const surPoignee = py >= v.haut - 2 && py <= v.haut + v.hauteur + 2
    const vise = cranSousPointeur(py, crans, g.scrollHeight, H)
    // LA POIGNÉE D'ABORD : dans un fil dense (24 crans sur conv-1113), elle recouvre presque toujours
    // un cran, et l'appui partait vers ce message au lieu de l'attraper — saut de 837 px mesuré par
    // la sonde du curseur (conv-1114). Attrapée, elle ne saute pas ; un simple clic dessus mène
    // quand même au cran qu'elle couvre (au relâchement).
    if (!surPoignee) {
      if (vise) {
        allerA(hautDeVuePour(vise, g), vise)
        setSurvol(vise)
      } else {
        const point = aimanterSurPiste(scrollTopSousPointeur(py, g, H), g, crans, H)
        allerA(point.scrollTop, point.cran)
        setSurvol(point.cran)
      }
    }
    glisseRef.current = {
      y: py,
      depart: g.scrollTop,
      geo: g,
      poignee: surPoignee,
      bouge: false,
      cranSousPoignee: surPoignee ? vise : null
    }
    setDeplie(true)
  }

  const surMouvement = (event: EvenementPointeur<HTMLDivElement>): void => {
    const py = yLocal(event)
    const glisse = glisseRef.current
    if (glisse) {
      const dy = py - glisse.y
      if (Math.abs(dy) > 3) glisse.bouge = true
      const conteneur = conteneurRef.current
      if (!glisse.bouge || !conteneur) return
      // La souris reprend la main sur le glissement lancé par l'appui.
      arreterGlissement()
      const brut = glisse.poignee
        ? scrollTopApresGlisse(glisse.depart, dy, glisse.geo, H)
        : scrollTopSousPointeur(py, glisse.geo, H)
      const point = aimanterSurPiste(brut, glisse.geo, crans, H)
      conteneur.scrollTop = point.scrollTop
      setSurvol((p) => (p === point.cran ? p : point.cran))
      return
    }
    const vise = cranSousPointeur(py, crans, geo.scrollHeight, H)
    setSurvol((p) => (p === vise ? p : vise))
  }

  const surRelache = (event: EvenementPointeur<HTMLDivElement>): void => {
    const glisse = glisseRef.current
    glisseRef.current = null
    const conteneur = conteneurRef.current
    if (glisse && !glisse.bouge && glisse.cranSousPoignee && conteneur)
      allerA(hautDeVuePour(glisse.cranSousPoignee, lireGeo(conteneur)), glisse.cranSousPoignee)
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
    // Rien à recaler : pendant le glisser, la vue s'est déjà arrêtée sur les crans.
    if (!surBarreRef.current) programmerRepli()
  }

  const surMoletteBarre = (event: EvenementMolette<HTMLDivElement>): void => {
    // La barre est posée À CÔTÉ du fil : sans ce relais, la molette sur elle ne ferait rien.
    const conteneur = conteneurRef.current
    if (!conteneur || !moletteFaitDefiler(event.deltaY, lireGeo(conteneur))) return
    ancreRef.current = null
    onGesteRef.current?.()
    const facteur = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? conteneur.clientHeight : 1
    arreterGlissement()
    derniereMoletteRef.current = Date.now()
    setDeplie(true)
    conteneur.scrollBy({ top: event.deltaY * facteur })
  }

  const pourcentage = Math.round(
    geo.scrollHeight > geo.clientHeight
      ? (geo.scrollTop / (geo.scrollHeight - geo.clientHeight)) * 100
      : 0
  )
  const traitsCrans = crans.map((c) => `M5 ${y(c.haut).toFixed(1)}h8`).join('')
  const xBulle = Math.round(CARTE * 0.42)
  const largeurGris = Math.round((CARTE - 14) * 0.6)
  const allume = survol ?? cale
  const yApercu = survol ? Math.max(18, Math.min(H - 18, y(survol.haut))) : 0

  // TROIS APERÇUS, carte ouverte (conv-1114 : « ça doit afficher que celui d'en bas et celui
  // au-dessus de là où je suis », après un essai à tous les aperçus qui couvraient le texte d'un long
  // fil ; puis « montre aussi le message d'avant celui que je lis ») : le message d'avant, celui dont
  // tu lis la réponse et le suivant, chacun en face de son cran. Compacts seulement si la barre est
  // trop basse pour trois aperçus sur deux lignes.
  const voisins = voisinsDeLaVue(geo, crans)
  const etiquettes = ((): {
    compactes: boolean
    items: { cran: Repere; y: number; ancre: number }[]
  } => {
    const choisis = [voisins.precedent, voisins.avant, voisins.apres].filter(
      (cran): cran is Repere => cran !== null
    )
    const ancres = choisis.map((c) => y(c.haut))
    for (const [hauteur, compactes] of [
      [ETIQUETTE, false],
      [ETIQUETTE_COMPACTE, true]
    ] as const) {
      const centres = placerEtiquettes(ancres, hauteur, 4, H - 4)
      if (centres)
        return {
          compactes,
          items: choisis.map((cran, i) => ({ cran, y: centres[i], ancre: ancres[i] }))
        }
    }
    return { compactes: true, items: [] }
  })()
  const allerAuMessage = (cran: Repere): void => {
    const conteneur = conteneurRef.current
    if (!conteneur) return
    onGesteRef.current?.()
    allerA(hautDeVuePour(cran, lireGeo(conteneur)), cran)
  }
  const misEnAvant = survol ?? courant

  return (
    <div
      className={`adf${deplie ? ' is-deplie' : ''}`}
      style={{ top: place.top, height: H, right: place.right }}
      role="scrollbar"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pourcentage}
      aria-label="Défilement du fil : un cran par message que tu as écrit"
      data-testid="ascenseur-du-fil"
      onPointerEnter={() => {
        surBarreRef.current = true
      }}
      onPointerLeave={() => {
        surBarreRef.current = false
        setSurvol(null)
        if (deplie) programmerRepli()
      }}
      onPointerDown={surAppui}
      onPointerMove={surMouvement}
      onPointerUp={surRelache}
      onPointerCancel={surRelache}
      onWheel={surMoletteBarre}
    >
      <svg className="adf-fine" width={FINE} height={H} aria-hidden="true">
        <defs>
          <linearGradient id={`${idDegrade}-f`} gradientUnits="userSpaceOnUse" x1="2" x2="16">
            <stop className="adf-s1" />
            <stop offset="1" className="adf-s2" />
          </linearGradient>
        </defs>
        <line className="adf-trait" x1="9" x2="9" y1={MARGE_PISTE} y2={H - MARGE_PISTE} />
        {traitsCrans && (
          <path className="adf-crans" d={traitsCrans} stroke={`url(#${idDegrade}-f)`} />
        )}
        <rect className="adf-poignee" x="6" width="6" rx="3" y={vue.haut} height={vue.hauteur} />
        {allume && (
          <path
            className="adf-lueur"
            d={`M2 ${y(allume.haut).toFixed(1)}h14`}
            stroke={`url(#${idDegrade}-f)`}
          />
        )}
      </svg>
      <svg className="adf-carte" width={CARTE} height={H} aria-hidden="true">
        <defs>
          <linearGradient
            id={`${idDegrade}-c`}
            gradientUnits="userSpaceOnUse"
            x1={xBulle}
            x2={CARTE - 8}
          >
            <stop className="adf-s1" />
            <stop offset="1" className="adf-s2" />
          </linearGradient>
        </defs>
        <rect className="adf-plaque" x="2" y="2" width={CARTE - 4} height={H - 4} rx="8" />
        <g className="adf-gris" strokeWidth={largeurGris}>
          {reperes.map((r) => {
            if (r.role !== 'assistant') return null
            const haut = y(r.haut)
            const bas = y(r.haut + r.hauteur)
            if (bas - haut < 2) return null
            const x = 7 + largeurGris / 2
            return <path key={`a${r.haut}`} d={`M${x} ${haut.toFixed(1)}V${bas.toFixed(1)}`} />
          })}
        </g>
        {crans.map((c) => (
          <rect
            key={`u${c.numero}-${c.haut}`}
            className={`adf-bulle${c === courant || c === survol ? ' is-courant' : ''}`}
            x={xBulle}
            width={CARTE - 8 - xBulle}
            y={y(c.haut)}
            height={Math.max(4, y(c.haut + c.hauteur) - y(c.haut))}
            rx="1.5"
            fill={`url(#${idDegrade}-c)`}
          />
        ))}
        <rect
          className="adf-cadre"
          x="4.5"
          width={CARTE - 9}
          rx="4"
          y={vue.haut}
          height={vue.hauteur}
        />
      </svg>
      <div
        className={`adf-etiquettes${etiquettes.compactes ? ' is-compactes' : ''}`}
        data-testid="ascenseur-apercus"
      >
        <svg className="adf-liens" width="10" height={H} aria-hidden="true">
          {etiquettes.items.map(({ cran, y: centre, ancre }) => (
            <path
              key={`l${cran.numero}-${cran.haut}`}
              d={`M0 ${centre.toFixed(1)}C5 ${centre.toFixed(1)} 5 ${ancre.toFixed(1)} 10 ${ancre.toFixed(1)}`}
            />
          ))}
        </svg>
        {/* CLIQUABLES (conv-1114 : « un clic amène son message en haut de la vue ») : l'appui
            s'arrête ici, sinon la barre le prendrait pour une prise du curseur à cette hauteur. */}
        {etiquettes.items.map(({ cran, y: centre }) => (
          <button
            type="button"
            key={`e${cran.numero}-${cran.haut}`}
            className={`adf-etiquette${cran === misEnAvant ? ' is-courant' : ''}`}
            style={{ top: centre }}
            aria-label={`Aller à ton message ${cran.numero} : ${cran.texte}`}
            onPointerDown={(event) => event.stopPropagation()}
            onPointerMove={(event) => {
              event.stopPropagation()
              setSurvol((p) => (p === cran ? p : cran))
            }}
            onClick={() => allerAuMessage(cran)}
          >
            <span className="adf-apercu-k">
              {String(cran.numero).padStart(2, '0')}
              {cran.heure ? ` · ${cran.heure}` : ''}
            </span>
            <span className="adf-apercu-t">{cran.texte}</span>
          </button>
        ))}
      </div>
      {/* Carte ouverte, l'aperçu du survol ferait doublon avec ceux qui sont déjà là. */}
      {survol && !deplie && (
        <div className="adf-apercu" style={{ top: yApercu }} role="tooltip">
          <span className="adf-apercu-k">
            {String(survol.numero).padStart(2, '0')}
            {survol.heure ? ` · ${survol.heure}` : ''}
          </span>
          <span className="adf-apercu-t">{survol.texte}</span>
        </div>
      )}
    </div>
  )
}
