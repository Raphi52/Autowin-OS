import React, { memo, useCallback, useEffect, useRef, useState } from 'react'
import { glypheDuHalo, TAILLE_GLYPHE } from '../../../shared/glyphe-du-halo'
import { attenteDuCran } from '../animations-par-crans'
import { avancerLesPistes, prendreLaMain, type Piste } from './accueil-cadence'
import type { UsageDeSkill } from './chat-home-suggestions'
import { PhraseInvoquee } from './PhraseInvoquee'
import { TeaserAccueil } from './TeaserAccueil'
import { placeDeLaPhrase, teaserVu } from './teaser-accueil-calcul'
import type { EtatDePhrase } from './teaser-accueil-calcul'
import './AnimationAccueilChat.css'

/**
 * Accueil d'un fil vide (conv-1401, 2026-10-31, « implémente 3+5 ») : remplace le bloc « Parle à
 * l'agent » et ses puces « Pour démarrer ». C'est le mélange de deux propositions du /draft :
 *  - 3 · Invite vivante : les suggestions s'écrivent une à une, et un clic pose la phrase dans la
 *    saisie. Elle n'envoie plus rien toute seule : l'utilisateur relit, puis envoie.
 *  - 5 · Mascotte : elle fait coucou, lit quand on écrit, s'endort sans activité, et travaille avec
 *    le vrai compte dès qu'un agent tourne.
 *
 * LA VRAIE MASCOTTE (« prend exactement la meme mascotte qu'on a dans les settings ») : la page même
 * de la mascotte du bureau (`htmlDeMascotte`), dans le style choisi en Settings. Rien n'est recopié
 * ici : ce composant ne choisit qu'une humeur, et le moteur rend la feuille à poser dessus.
 *
 * LE SOL MAGIQUE (« Implémenter la 6 · Sol magique », deuxième tour du /draft sur le fond animé) :
 * le cercle de runes de son halo, couché en perspective sous ses pieds. Il prend la couleur de son
 * état, une onde en part quand elle salue ou qu'un agent démarre, et sa couronne tourne au travail.
 * Au repos, rien n'y bouge : il n'ajoute aucune image à recomposer.
 *
 * LE TEASER (« faudrait comme un teaser de jeu video magicien du temps obscur ») prend le relais :
 * tout le fil vide devient une vidéo (`TeaserAccueil`), avec le vrai cercle de runes peint au sol.
 * « enleve la mascotte du coup la video suffit » : le magicien du film tient son rôle, seule la
 * phrase se pose sous le cercle (`placeDeLaPhrase`). La mascotte et son sol en CSS ne reviennent que
 * si la vidéo ne se lit pas.
 *
 * « que ce soit le cercle au sol qui les invoque » : sur le film, les phrases ne s'écrivent plus.
 * Leurs lettres sortent du cercle quand le mage le frappe de son bâton (`TeaserAccueil`), et
 * s'assemblent (`PhraseInvoquee`).
 *
 * Aucune garde `prefers-reduced-motion` : ce poste a le réglage actif, l'animation ne se verrait
 * jamais (même choix que le bloc Étapes et la cascade des candidats).
 */

/** Sans geste pendant ce temps, la mascotte s'endort. */
export const ENDORMISSEMENT_MS = 30_000
/** Sans aucun geste pendant ce temps, le film s'arrête : plus personne ne le regarde. */
export const ABSENCE_MS = 5 * 60_000
/** Durée du coucou, à l'arrivée et au réveil : le temps de deux petits sauts de « pour toi ». */
export const COUCOU_MS = 2_400
/** Temps laissé pour lire et cliquer une phrase écrite, avant la suivante. */
export const PAUSE_PHRASE_MS = 2_400
/** La mascotte est dessinée pour 128 px : on la montre en grand. */
const ZOOM = 2
/** Quand un agent démarre, l'onde dure autant que celle du coucou. */
const ONDE_MS = COUCOU_MS
/** Le cercle vient du code, calculé une seule fois : rien de saisi ni de reçu n'y entre. */
const GLYPHE = { __html: glypheDuHalo() }
const CENTRE_GLYPHE = TAILLE_GLYPHE / 2

type Humeur = 'coucou' | 'eveil' | 'lecture' | 'sommeil'
type PageMascotte = Awaited<ReturnType<typeof window.api.mascottePage>>

/** Vrai après `delai` sans aucun geste, faux dès le suivant. `auRetour` : appelé à ce moment-là. */
function useAbsence(delai: number, auRetour?: () => void): boolean {
  const [absent, setAbsent] = useState(false)

  useEffect(() => {
    let dernierGeste = Date.now()
    let dehors = false
    let minuteur: ReturnType<typeof setTimeout>
    // Un seul minuteur, réarmé à son échéance : `pointermove` tombe des dizaines de fois par seconde.
    const verifier = (): void => {
      const reste = delai - (Date.now() - dernierGeste)
      if (reste > 0) {
        minuteur = setTimeout(verifier, reste)
        return
      }
      dehors = true
      setAbsent(true)
    }
    const geste = (): void => {
      dernierGeste = Date.now()
      if (!dehors) return
      dehors = false
      setAbsent(false)
      auRetour?.()
      minuteur = setTimeout(verifier, delai)
    }
    minuteur = setTimeout(verifier, delai)
    window.addEventListener('pointermove', geste, { passive: true })
    window.addEventListener('pointerdown', geste, { passive: true })
    window.addEventListener('keydown', geste, true)
    return () => {
      clearTimeout(minuteur)
      window.removeEventListener('pointermove', geste)
      window.removeEventListener('pointerdown', geste)
      window.removeEventListener('keydown', geste, true)
    }
  }, [delai, auRetour])

  return absent
}

function useCompagnon(saisieRemplie: boolean): Humeur {
  const [coucou, setCoucou] = useState(true)
  const refaireCoucou = useCallback(() => setCoucou(true), [])
  const endormie = useAbsence(ENDORMISSEMENT_MS, refaireCoucou)

  useEffect(() => {
    if (!coucou) return
    const minuteur = setTimeout(() => setCoucou(false), COUCOU_MS)
    return () => clearTimeout(minuteur)
  }, [coucou])

  if (endormie) return 'sommeil'
  if (saisieRemplie) return 'lecture'
  return coucou ? 'coucou' : 'eveil'
}

/** L'onde du sol : elle accompagne le coucou, et repart à chaque agent qui démarre. */
function useOnde(humeur: Humeur, agents: number): boolean {
  const [agentsVus, setAgentsVus] = useState(agents)
  const [depart, setDepart] = useState(false)
  // Pendant le rendu, comme le conseille React : un agent qui finit ne fait rien partir.
  if (agents !== agentsVus) {
    setAgentsVus(agents)
    if (agents > agentsVus) setDepart(true)
  }
  useEffect(() => {
    if (!depart) return
    const minuteur = setTimeout(() => setDepart(false), ONDE_MS)
    return () => clearTimeout(minuteur)
  }, [depart])
  return depart || humeur === 'coucou'
}

/** La phrase du moment et ce qui en est écrit. `fige` : elle se montre entière et ne change plus. */
function usePhraseEcrite(
  phrases: readonly string[],
  fige: boolean
): { phrase: string | undefined; ecrit: string } {
  const [position, setPosition] = useState({ indice: 0, lettres: 0 })
  const { indice, lettres } = position
  const phrase = phrases.length > 0 ? phrases[indice % phrases.length] : undefined
  // Par points de code, pour ne jamais couper un emoji en deux.
  const signes = Array.from(phrase ?? '')
  const longueur = signes.length

  // Pendant le rendu, comme le conseille React : figée puis relâchée, la phrase repart de son état
  // complet, elle ne se réécrit pas à moitié sous les yeux.
  if (fige && lettres < longueur) setPosition({ indice, lettres: longueur })

  const nombre = phrases.length
  useEffect(() => {
    if (fige || nombre === 0) return
    const finie = lettres >= longueur
    const minuteur = setTimeout(
      () =>
        setPosition(
          finie ? { indice: (indice + 1) % nombre, lettres: 0 } : { indice, lettres: lettres + 1 }
        ),
      (finie ? PAUSE_PHRASE_MS : 0) + attenteDuCran()
    )
    return () => clearTimeout(minuteur)
  }, [fige, nombre, indice, lettres, longueur])

  return { phrase, ecrit: signes.slice(0, lettres).join('') }
}

/** La page de la mascotte, relue à chaque retour au chat : le style a pu changer en Settings. */
function usePageMascotte(actif: boolean): PageMascotte | null {
  const [page, setPage] = useState<PageMascotte | null>(null)
  useEffect(() => {
    if (!actif) return
    // Sans pont (écran rendu hors de l'app, tests de la vue) : pas de mascotte, la phrase reste.
    const lire = (window.api as Partial<typeof window.api> | undefined)?.mascottePage
    if (!lire) return
    let vivant = true
    void lire()
      .then((lue) => {
        if (vivant) setPage(lue)
      })
      .catch((erreur: unknown) => console.warn('[accueil] mascotte non lue —', String(erreur)))
    return () => {
      vivant = false
    }
  }, [actif])
  return page
}

const SolMagique = memo(function SolMagique({ onde }: { onde: boolean }): React.JSX.Element {
  return (
    <div className="as-tient" aria-hidden="true">
      <svg className="as-sceau" viewBox={`0 0 ${TAILLE_GLYPHE} ${TAILLE_GLYPHE}`} focusable="false">
        <g dangerouslySetInnerHTML={GLYPHE} />
        {onde &&
          [0, 1, 2].map((k) => (
            <circle
              key={k}
              className={`as-onde as-onde-${k}`}
              cx={CENTRE_GLYPHE}
              cy={CENTRE_GLYPHE}
              r={30}
            />
          ))}
      </svg>
    </div>
  )
})

function Mascotte({
  libelle,
  detail,
  humeur,
  agents,
  actif,
  onde
}: {
  libelle: string
  detail: string
  humeur: Humeur
  agents: number
  actif: boolean
  onde: boolean
}): React.JSX.Element | null {
  const page = usePageMascotte(actif)
  const [document, setDocument] = useState<Document | null>(null)
  const pistes = useRef<readonly Piste[]>([])
  const html = page?.html

  // L'humeur entre comme sur le bureau : par une feuille de style, la page n'a aucun script.
  useEffect(() => {
    const feuilleDe = (window.api as Partial<typeof window.api> | undefined)?.mascotteFeuilleAccueil
    if (!document || !feuilleDe) return
    let vivant = true
    void feuilleDe(humeur, agents)
      .then((css) => {
        if (!vivant) return
        const existante = document.getElementById('humeur')
        const feuille = existante ?? document.createElement('style')
        feuille.id = 'humeur'
        feuille.textContent = css
        if (!existante) document.head.append(feuille)
        pistes.current = prendreLaMain(document)
      })
      .catch((erreur: unknown) => console.warn('[accueil] humeur non posée —', String(erreur)))
    return () => {
      vivant = false
    }
    // `html` : un changement de style en Settings recharge la page, et la feuille avec elle.
  }, [document, html, humeur, agents])

  // Fluide, à chaque image (conv-1512 : « remove the 10 fps cap everywhere »). `requestAnimationFrame`
  // s'arrête tout seul quand la fenêtre est cachée ou réduite : hors de la vue, la boucle ne coûte rien.
  useEffect(() => {
    if (!document || !actif) return
    pistes.current = prendreLaMain(document)
    let image = 0
    let avant = performance.now()
    const avancer = (maintenant: number): void => {
      avancerLesPistes(pistes.current, maintenant, Math.max(0, maintenant - avant))
      avant = maintenant
      image = requestAnimationFrame(avancer)
    }
    image = requestAnimationFrame(avancer)
    return () => cancelAnimationFrame(image)
  }, [document, actif])

  // Le sol arrive avec elle : sans sa page, il se poserait à vide, là où elle n'est pas encore.
  if (!page) return null
  return (
    <>
      <SolMagique onde={onde} />
      <div
        className="am-perso"
        role="img"
        aria-label={libelle}
        title={detail}
        style={{ width: page.largeur * ZOOM, height: page.hauteur * ZOOM }}
      >
        {/* `allow-same-origin` sans `allow-scripts` : on atteint ses animations, elle n'exécute rien. */}
        <iframe
          className="am-cadre"
          title={libelle}
          tabIndex={-1}
          aria-hidden="true"
          sandbox="allow-same-origin"
          srcDoc={page.html.replace('</head>', `<style>html{zoom:${ZOOM}}</style></head>`)}
          onLoad={(evenement) => setDocument(evenement.currentTarget.contentDocument)}
        />
      </div>
    </>
  )
}

function AnimationAccueilChatBrute({
  libelle,
  detail,
  phrases,
  usages,
  agentsAuTravail,
  saisieRemplie,
  actif,
  onChoisir
}: {
  /** Nom lu par un lecteur d'écran (l'ancien titre). */
  libelle: string
  /** Explication montrée au survol de la mascotte, quand elle est là (l'ancien texte d'accueil). */
  detail: string
  /**
   * Les suggestions réelles (`buildHomeSuggestions`) : celles de la mise en page sans film. Vide dès
   * qu'un brouillon est en cours : plus rien ne s'affiche alors, ni elles ni les usages du film.
   */
  phrases: readonly string[]
  /** Ce que le cercle du film invoque : les skills, chacune avec un usage. */
  usages: readonly UsageDeSkill[]
  /** Tours de chat et runs en cours : le même calcul que la mascotte du bureau. */
  agentsAuTravail: number
  saisieRemplie: boolean
  /** Faux quand un autre onglet que le Chat est affiché : plus rien ne tourne. */
  actif: boolean
  /** Reçoit toujours la phrase ENTIÈRE, même cliquée à moitié écrite. */
  onChoisir: (phrase: string) => void
}): React.JSX.Element {
  const [sansDecor, setSansDecor] = useState(false)
  const [taille, setTaille] = useState({ largeur: 0, hauteur: 0 })
  const [introAJouer, setIntroAJouer] = useState(!teaserVu.intro)
  const enIntro = introAJouer && !sansDecor
  const humeur = useCompagnon(saisieRemplie)
  const onde = useOnde(humeur, agentsAuTravail)
  const absente = useAbsence(ABSENCE_MS)
  const [survolee, setSurvolee] = useState(false)
  const surTaille = useCallback((largeur: number, hauteur: number) => {
    setTaille({ largeur, hauteur })
  }, [])
  // Chaque entrée de phrase est une nouvelle invocation : le rang choisit le texte et relance son
  // animation d'apparition.
  const [invocation, setInvocation] = useState<{ rang: number; etat: EtatDePhrase }>({
    rang: 0,
    etat: 'absente'
  })
  const surPhrase = useCallback((etat: EtatDePhrase) => {
    setInvocation((avant) =>
      avant.etat === etat
        ? avant
        : {
            etat,
            rang: avant.etat === 'absente' && etat !== 'absente' ? avant.rang + 1 : avant.rang
          }
    )
  }, [])
  const surFinIntro = useCallback(() => setIntroAJouer(false), [])
  const surAbsente = useCallback(() => setSansDecor(true), [])
  const place =
    !sansDecor && taille.hauteur > 0 ? placeDeLaPhrase(taille.largeur, taille.hauteur) : null
  const surLeFilm = place !== null
  // Une phrase qui file sous le pointeur ne se clique pas : on la tient tant qu'il est dessus.
  // Sur le film, c'est lui qui fait défiler : rien ne s'écrit.
  const fige = survolee || humeur === 'sommeil' || !actif || enIntro || surLeFilm
  const { phrase, ecrit } = usePhraseEcrite(phrases, fige)
  // Le rang vaut 1 à la première invocation : la première phrase ouvre le bal.
  const invoquee =
    phrases.length > 0 && usages.length > 0
      ? usages[Math.max(invocation.rang - 1, 0) % usages.length]
      : undefined
  // Sous le pointeur, la phrase reste celle qu'il vise, même si le film passe à la suivante.
  const [tenue, setTenue] = useState<{ usage: UsageDeSkill; rang: number } | undefined>(undefined)
  const surFilm = tenue?.usage ?? (invocation.etat === 'absente' ? undefined : invoquee)
  const classes = [
    'accueil-anim',
    `est-${humeur}`,
    agentsAuTravail > 0 && actif ? 'avec-agents' : '',
    surLeFilm ? 'avec-decor' : '',
    enIntro ? 'en-intro' : ''
  ]

  return (
    <>
      {!sansDecor && (
        <TeaserAccueil
          libelle={libelle}
          lecture={actif && (enIntro || !absente || agentsAuTravail > 0)}
          acceleree={agentsAuTravail > 0}
          enIntro={enIntro}
          onTaille={surTaille}
          onPhrase={surPhrase}
          onFinIntro={surFinIntro}
          onAbsente={surAbsente}
        />
      )}
      <div
        className={classes.filter(Boolean).join(' ')}
        style={place ? { top: place.haut } : undefined}
      >
        {sansDecor && (
          <Mascotte
            libelle={libelle}
            detail={detail}
            humeur={humeur}
            agents={agentsAuTravail}
            actif={actif}
            onde={onde}
          />
        )}
        <div className="aa-phrase-zone">
          {place && surFilm !== undefined && (
            <PhraseInvoquee
              key={tenue?.rang ?? invocation.rang}
              usage={surFilm}
              sortante={invocation.etat === 'sortante' && !tenue}
              ecartAuCercle={place.ecart}
              onChoisir={onChoisir}
              onTenir={(oui) =>
                setTenue(oui ? { usage: surFilm, rang: invocation.rang } : undefined)
              }
            />
          )}
          {!surLeFilm && phrase !== undefined && (
            <button
              type="button"
              className="aa-phrase"
              aria-label={phrase}
              title={phrase}
              onClick={() => onChoisir(phrase)}
              onPointerEnter={() => setSurvolee(true)}
              onPointerLeave={() => setSurvolee(false)}
              onFocus={() => setSurvolee(true)}
              onBlur={() => setSurvolee(false)}
            >
              <span aria-hidden="true">
                {ecrit}
                {!fige && <i className="aa-barre" />}
              </span>
            </button>
          )}
        </div>
      </div>
    </>
  )
}

/** `memo` : `ChatView` se redessine à chaque morceau de réponse des autres fils, pas elle. */
export const AnimationAccueilChat = memo(AnimationAccueilChatBrute)
