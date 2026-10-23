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
  cranCale,
  cranCourant,
  cranLePlusProche,
  cranSousPointeur,
  depuisPiste,
  dureeGlisse,
  hautDeVuePour,
  lireReperes,
  MARGE_PISTE,
  moletteFaitDefiler,
  poignee,
  positionGlissee,
  scrollTopApresGlisse,
  SELECTEUR_MESSAGES,
  seuilMolette,
  versPiste,
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
 * L'aimant : une fin de molette tout près d'un message le cale à 10 px du haut ; un glisser
 * relâché ou un clic va TOUJOURS sur le message le plus proche.
 */

const FINE = 18
const CARTE = 72
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
      r.texte === b[i].texte
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
  } | null>(null)
  const derniereMoletteRef = useRef(0)
  const minuteurRepliRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const minuteurFinRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    (cible: number): void => {
      const conteneur = conteneurRef.current
      if (!conteneur) return
      arreterGlissement()
      // La vue glisse ELLE-MÊME, image par image : `scrollTo({ behavior: 'smooth' })` sautait d'un
      // coup sur ce poste, qui a la réduction des animations active (conv-1114, « pas fluide »).
      const depart = conteneur.scrollTop
      const ecart = cible - depart
      if (Math.abs(ecart) < 1) return
      const duree = dureeGlisse(ecart)
      const t0 = performance.now()
      const pas = (t: number): void => {
        conteneur.scrollTop = positionGlissee(depart, ecart, t - t0, duree)
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
        if (cible !== null) allerA(cible)
      }, FIN_DEFILEMENT_MS)
      if (derniereMoletteRef.current) programmerRepli()
    }
    const surMolette = (event: WheelEvent): void => {
      // En butée (tout en haut vers le haut, tout en bas vers le bas), rien ne défile : la carte ne
      // s'ouvre pas et ne prolonge pas son ouverture (conv-1114).
      if (!moletteFaitDefiler(event.deltaY, lireGeo(conteneur))) return
      arreterGlissement()
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
    },
    []
  )

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

  const surAppui = (event: EvenementPointeur<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const conteneur = conteneurRef.current
    if (!conteneur) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    arreterGlissement()
    onGesteRef.current?.()
    const py = yLocal(event)
    const g = lireGeo(conteneur)
    const v = poignee(g, H)
    glisseRef.current = {
      y: py,
      depart: g.scrollTop,
      geo: g,
      poignee: py >= v.haut - 2 && py <= v.haut + v.hauteur + 2,
      bouge: false
    }
    setDeplie(true)
  }

  const surMouvement = (event: EvenementPointeur<HTMLDivElement>): void => {
    const py = yLocal(event)
    const glisse = glisseRef.current
    if (glisse) {
      const dy = py - glisse.y
      if (Math.abs(dy) > 3) glisse.bouge = true
      if (glisse.poignee && glisse.bouge && conteneurRef.current) {
        conteneurRef.current.scrollTop = scrollTopApresGlisse(glisse.depart, dy, glisse.geo, H)
      }
      return
    }
    const vise = cranSousPointeur(py, crans, geo.scrollHeight, H)
    setSurvol((p) => (p === vise ? p : vise))
  }

  const surRelache = (event: EvenementPointeur<HTMLDivElement>): void => {
    const glisse = glisseRef.current
    glisseRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
    const conteneur = conteneurRef.current
    if (!glisse || !conteneur) return
    const g = lireGeo(conteneur)
    if (glisse.poignee && glisse.bouge) {
      // Glisser relâché : TOUJOURS sur le message le plus proche.
      const cible = cibleAimant(g, crans, Number.POSITIVE_INFINITY)
      if (cible !== null) allerA(cible)
    } else if (!glisse.bouge) {
      // Clic : le cran visé, sinon le message le plus proche du point cliqué, en haut de la vue.
      const py = yLocal(event)
      const vise =
        cranSousPointeur(py, crans, g.scrollHeight, H) ??
        cranLePlusProche(depuisPiste(py, g.scrollHeight, H), crans)
      if (vise) allerA(hautDeVuePour(vise, g))
    }
    if (!surBarreRef.current) programmerRepli()
  }

  const surMoletteBarre = (event: EvenementMolette<HTMLDivElement>): void => {
    // La barre est posée À CÔTÉ du fil : sans ce relais, la molette sur elle ne ferait rien.
    const conteneur = conteneurRef.current
    if (!conteneur || !moletteFaitDefiler(event.deltaY, lireGeo(conteneur))) return
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
      {survol && (
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
