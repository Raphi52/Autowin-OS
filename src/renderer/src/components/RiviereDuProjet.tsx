/**
 * LA RIVIÈRE À ÉTAGES DE LA CARTE DU PROJET (/draft conv-1113, 2026-10-23).
 *
 * Demande : « implémente 1+2 » — tour 9 du /draft, « la colonne la plus large est celle sur laquelle
 * mon scroll est situé ». Base choisie au tour 8 : la Rivière à étages d'état (tableau blanc, le
 * temps de gauche à droite, un étage par état, glisser un post-it vers un autre étage change son
 * état, clic = fiche). Proposition 2 : la molette avance ou recule la loupe d'une demi-journée ;
 * la loupe s'ouvre sur aujourd'hui.
 *
 * La proposition 1 (la colonne sous la souris s'élargit) a été livrée avec la 2 puis RETIRÉE à la
 * demande de l'utilisateur, le même jour : « enlève le mécanisme avec le curseur, laisse que la
 * roulette ». Seule la molette déplace la loupe ; la souris ne fait que cliquer et glisser.
 *
 * Le choix de période « 2 semaines / 1 mois / 3 mois » (même jour) est RETIRÉ (conv-1131) : « enlève
 * le filtre 2 semaines, on doit pouvoir remonter à l'infini en lazy load ». La frise garde ses 14
 * colonnes et GLISSE dans le passé : la molette vers le haut recule la loupe sans butée jusqu'au plus
 * vieux fil, et la frise suit quand la loupe approche de son bord (`loupeApresMolette`). Seuls les
 * 14 jours affichés sont calculés et dessinés. « revenir à aujourd’hui » ramène d'un clic, sinon il
 * faudrait deux crans par jour remonté.
 *
 * Seule dans sa vue (même jour) : « il doit y avoir que ce board dans la view […] la vue n'est pas
 * scrollable verticalement », puis « tout doit rentrer dans l'écran en hauteur » : RIEN ne défile.
 * La rivière prend la hauteur restante de la vue et le tableau la mesure ; `disposerEtages` y fait
 * tenir les étages (le jour de la loupe garde des post-it lisibles, les autres tassent leurs
 * pastilles). La molette n'a qu'un rôle : la loupe.
 *
 * Même jour encore : « quand la loupe est sur un jour très chargé, range ses post-it sur 4 ou 5
 * colonnes » (choix fait par `disposerEtages`, case par case).
 *
 * Ajout au-delà des maquettes, pour qu'elle serve dans l'app : la loupe se FIGE tant qu'une fiche
 * est ouverte (sinon le post-it quitterait sa fiche).
 *
 * Puis (conv-1130) : « quand je click sur une colonne du board ca doit me scroll dessus ». Un CLIC
 * sur une colonne — son fond sur le tableau, ou son nom dans la bande des jours — y amène la loupe,
 * avec la même animation que la molette. Le SURVOL ne fait toujours rien (proposition 1 retirée) ;
 * le clic sur un post-it ouvre sa fiche sans déplacer la loupe. Puis : « le clic sur une colonne
 * n'agit pas quand une fiche est ouverte : le premier clic ferme juste la fiche ». Puis (conv-1135) :
 * « quand je click sur une colonne du passé elle doit se mettre au centre » — le clic fait aussi
 * GLISSER la frise pour poser ce jour au milieu (`loupeCentreeSur`), sans quoi la colonne de gauche
 * restait au bord et il fallait la molette pour voir les jours d'avant.
 *
 * Le calcul (fils, étages, sous-lignes, largeur des colonnes) vit dans `carte-riviere.ts`.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  CarteDesBesoins,
  DemandeDeLaCarte,
  ResultatDuRattachement,
  WorkItemDeLaDemande
} from '../../../shared/carte-des-besoins'
import { LIBELLES_STATUT } from './carte-du-fil'
import { TachesDeLaDemande, type SourceDeTache } from './TachesDeLaDemande'
import {
  ETAGES,
  JOURS,
  PAR_LIGNE,
  POSTIT_H,
  POSTIT_L,
  bordsDesColonnes,
  disposerEtages,
  etiquettesDesJours,
  foyerDAujourdhui,
  loupeApresMolette,
  loupeCentreeSur,
  placer,
  poidsDesJours,
  riviereDe,
  type EtageDeLaRiviere,
  type Loupe,
  type PostItDeLaRiviere
} from './carte-riviere'
import { lireEtatsManuels, poserEtatManuel } from './etats-manuels-carte'
import { GestesDeVerification, ToutVerifier, type Verifier } from './VerificationDuBoard'
import { postitsAVerifier, useSurvolDesGestes } from './verification-du-board'
import './RiviereDuProjet.css'
import './RiviereDuProjet.noms-crayon.css'

/** La colonne des noms d'étage, à droite du tableau (comme sur la maquette). */
const LARGEUR_ETIQUETTES = 150
/** La bande des noms de jours, en haut, hors de la partie qui défile. */
const HAUT_JOURS = 28
/** Le premier étage, sous le haut du tableau. */
const HAUT_ETAGES = 2
/** La hauteur gardée à un étage vide : il reste une cible de dépôt. */
const HAUT_ETAGE_VIDE = 26
const SOUS_LIGNE = POSTIT_H + 8
const MARGE_ETAGE = 12
/** Sans mesure (rendu de test), la largeur d'une colonne de chat moyenne. */
const LARGEUR_PAR_DEFAUT = 960
const SEUIL_GLISSER = 5
/** Pixels de molette par cran : une molette rend ~100 par cran, un pavé tactile beaucoup moins. */
const PAS_DE_MOLETTE = 50
/** En dessous, la colonne ne trace plus son bord : à 3 mois, 90 traits gris tous les 4 px griseraient le tableau. */
const COLONNE_SERREE = 12
/** En dessous, le post-it n'est plus qu'une pastille de couleur : son texte serait illisible. */
const ECHELLE_TEXTE = 0.55
const DEMANDES_DE_LA_FICHE = 12
const AIDE =
  'molette sur le tableau ou clic sur une colonne : la colonne visée s’élargit, et ses post-it grandissent · la molette vers le haut remonte le temps jusqu’au plus vieux fil · glisse un post-it vers un autre étage pour changer son état — gardé sur ce poste jusqu’à la prochaine demande du fil, jamais compté comme une preuve'
const COULEURS_PERSONNES = ['#e9bd4e', '#4fb6e0', '#ff85c8', '#7cc46b', '#b48cff', '#ff9f5a']

function stockage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

const heure = (instant: number): string =>
  new Date(instant).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

const nomDEtage = (cle: EtageDeLaRiviere): string => ETAGES.find((e) => e.cle === cle)?.nom ?? cle

interface Glisse {
  id: string
  /** Départ du pointeur et du post-it, en pixels du tableau. */
  sx: number
  sy: number
  x0: number
  y0: number
  dx: number
  dy: number
  bouge: boolean
}

/** Lier / détacher un work item d'une demande (conv-1127) ; absents = la fiche ne fait que montrer. */
interface GestesDesTaches {
  lierWorkItem?: (
    demande: DemandeDeLaCarte,
    saisie: string,
    sourceId?: string
  ) => Promise<ResultatDuRattachement>
  delierWorkItem?: (demande: DemandeDeLaCarte, workItem: WorkItemDeLaDemande) => Promise<unknown>
  /** Les sources de tickets configurées : à partir de deux, « + task » propose de choisir. */
  sourcesDesTaches?: readonly SourceDeTache[]
}

export function RiviereDuProjet({
  carte,
  ouvrir,
  lierWorkItem,
  delierWorkItem,
  sourcesDesTaches,
  verifier
}: {
  carte: CarteDesBesoins
  ouvrir: (conversationId: string) => void
  /** Envoie `/check` dans des fils (conv-1136) ; absent = seul « Vérifié à la main » reste. */
  verifier?: Verifier
} & GestesDesTaches): React.JSX.Element {
  const [manuels, setManuels] = useState(() => {
    const s = stockage()
    return s ? lireEtatsManuels(s) : {}
  })
  // La loupe s'ouvre sur aujourd'hui, frise non reculée.
  const [loupe, setLoupeAffichee] = useState<Loupe>(() => ({ foyer: foyerDAujourdhui(), recul: 0 }))
  const { foyer, recul } = loupe
  // Seuls les JOURS affichés sont calculés : reculer la frise recalcule ces 14 jours, pas l'historique.
  const riviere = useMemo(
    () => riviereDe(carte, carte.calculeeA, manuels, JOURS, recul),
    [carte, manuels, recul]
  )
  // La place offerte au tableau, mesurée : il s'y tient en entier (0 = pas encore mesurée).
  const [taille, setTaille] = useState({ l: 0, h: 0 })
  const [personne, setPersonne] = useState<string | null>(null)
  const [choisi, setChoisiAffiche] = useState<string | null>(null)
  // Le glisser vit dans une référence (les gestionnaires la lisent sans attendre un rendu) ; l'état
  // n'en garde qu'une copie pour dessiner le post-it sous le pointeur.
  const [glisse, setGlisseAffiche] = useState<Glisse | null>(null)
  const glisseCourant = useRef<Glisse | null>(null)
  const tableau = useRef<HTMLDivElement | null>(null)
  const cadre = useRef<HTMLDivElement | null>(null)
  const plateau = useRef<HTMLDivElement | null>(null)
  const loupeCourante = useRef(loupe)
  // La butée du passé, lue par la molette : le jour du plus vieux fil daté.
  const joursEnArriere = useRef(riviere.joursEnArriere)
  const choisiCourant = useRef<string | null>(null)
  const cumulMolette = useRef(0)
  const clicAvale = useRef(false)
  // Vrai quand l'appui sur le fond vient de fermer une fiche : son clic s'arrête là (conv-1130).
  const appuiAFermeLaFiche = useRef(false)
  // Chaque valeur que lisent les écouteurs (molette native, pointeur) est posée DANS la référence au
  // moment du changement, jamais pendant le rendu : l'écouteur lit toujours la dernière.
  const setLoupe = useCallback((l: Loupe): void => {
    loupeCourante.current = l
    setLoupeAffichee(l)
  }, [])
  const setChoisi = (id: string | null): void => {
    choisiCourant.current = id
    setChoisiAffiche(id)
  }
  const setGlisse = (g: Glisse | null): void => {
    glisseCourant.current = g
    setGlisseAffiche(g)
  }
  /** Retour au présent d'un clic : remonter de 3 mois à la molette coûterait 180 crans au retour. */
  const revenirAujourdhui = (): void => {
    cumulMolette.current = 0
    // Le post-it d'une fiche ouverte sortirait de la frise.
    setChoisi(null)
    setLoupe({ foyer: foyerDAujourdhui(), recul: 0 })
  }
  /**
   * Un clic sur une colonne : la frise glisse pour la poser au MILIEU, ses voisins plus anciens et
   * plus récents des deux côtés (conv-1135), et la loupe se pose sur elle.
   */
  const allerAuJour = (j: number): void => {
    cumulMolette.current = 0
    setLoupe(loupeCentreeSur(loupeCourante.current, j, joursEnArriere.current))
  }
  /** La loupe ne bouge pas pendant un glisser ni tant qu'une fiche est ouverte. */
  const figee = useCallback(
    (): boolean => choisiCourant.current !== null || glisseCourant.current !== null,
    []
  )

  useEffect(() => {
    joursEnArriere.current = riviere.joursEnArriere
  }, [riviere.joursEnArriere])

  useEffect(() => {
    const el = plateau.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const obs = new ResizeObserver((entrees) => {
      const { width, height } = entrees[0].contentRect
      setTaille((t) => (t.l === width && t.h === height ? t : { l: width, h: height }))
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // La molette déplace la loupe, et vers le haut remonte le temps sans butée avant le plus vieux fil ;
  // écouteur natif car React pose les siens en passif (pas de preventDefault possible). Rien d'autre
  // ne défile : elle ne rend jamais la main.
  useEffect(() => {
    const el = cadre.current
    if (!el) return
    const surMolette = (e: WheelEvent): void => {
      const facteur = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 400 : 1
      // La fiche ouverte garde son propre défilement.
      if ((e.target as Element | null)?.closest?.('.riviere-fiche')) return
      e.preventDefault()
      if (figee()) return
      const delta = e.deltaY * facteur
      if (delta === 0) return
      const suivant = loupeApresMolette(loupeCourante.current, delta, joursEnArriere.current)
      if (suivant === null) {
        cumulMolette.current = 0
        return
      }
      cumulMolette.current += delta
      if (Math.abs(cumulMolette.current) < PAS_DE_MOLETTE) return
      cumulMolette.current = 0
      setLoupe(suivant)
    }
    el.addEventListener('wheel', surMolette, { passive: false })
    return () => el.removeEventListener('wheel', surMolette)
  }, [figee, setLoupe])

  useEffect(() => {
    if (choisi === null) return
    const surTouche = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        choisiCourant.current = null
        setChoisiAffiche(null)
      }
    }
    document.addEventListener('keydown', surTouche)
    return () => document.removeEventListener('keydown', surTouche)
  }, [choisi])

  const total = taille.l > 0 ? taille.l : LARGEUR_PAR_DEFAUT
  const zone = Math.max(240, total - LARGEUR_ETIQUETTES)
  const bords = useMemo(() => bordsDesColonnes(poidsDesJours(foyer, JOURS)), [foyer])
  const etiquettes = useMemo(
    () => etiquettesDesJours(riviere.jours, bords, zone),
    [riviere.jours, bords, zone]
  )
  const jourLoupe = Math.min(JOURS - 1, Math.max(0, Math.floor(foyer)))
  const etages = useMemo(
    () =>
      disposerEtages(riviere.etages, bords, zone, taille.h, {
        jourLoupe,
        debut: HAUT_ETAGES,
        marge: MARGE_ETAGE,
        sousLigne: SOUS_LIGNE,
        vide: HAUT_ETAGE_VIDE
      }),
    [riviere.etages, bords, zone, taille.h, jourLoupe]
  )
  const contenu = etages.length
    ? etages[etages.length - 1].haut + etages[etages.length - 1].hauteur
    : 0
  // Mesuré, le tableau prend toute la place (les colonnes descendent jusqu'en bas) ; sans mesure
  // (rendu de test), la hauteur de son contenu.
  const hauteur = taille.h > 0 ? taille.h : contenu + 8
  const etageDe = useMemo(() => new Map(etages.map((e) => [e.cle, e])), [etages])
  /** Le jour dont la colonne contient `x` (pixels du tableau) ; null sur les noms d'étage. */
  const jourSous = (x: number): number | null => {
    if (x < 0 || x >= zone) return null
    const j = bords.findIndex((b, i) => i > 0 && x < b * zone) - 1
    return j >= 0 ? j : null
  }

  const couleurs = useMemo(
    () =>
      new Map(
        carte.demandeurs.map((d, i) => [d.cle, COULEURS_PERSONNES[i % COULEURS_PERSONNES.length]])
      ),
    [carte.demandeurs]
  )
  const presents = useMemo(() => {
    const cles = new Set(riviere.postits.map((p) => p.demandeur?.cle).filter(Boolean))
    return carte.demandeurs.filter((d) => cles.has(d.cle))
  }, [carte.demandeurs, riviere.postits])

  const position = useCallback(
    (p: PostItDeLaRiviere) => {
      const jour = Math.floor(p.t)
      const etage = etageDe.get(p.etage)
      const pas = etage?.pas[jour] ?? SOUS_LIGNE
      // 3 de front, ou 4 à 5 dans une case chargée sous la loupe : la case de chaque post-it en découle.
      const c = etage?.colonnes[jour] ?? PAR_LIGNE
      const { x, k, kx } = placer(jour, p.rang % c, bords, zone, pas / SOUS_LIGNE, c)
      const ligne = Math.floor(p.rang / c)
      return { x, y: (etage?.haut ?? 0) + (etage?.marge ?? MARGE_ETAGE) + ligne * pas, k, kx }
    },
    [bords, zone, etageDe]
  )

  const pointDuTableau = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = tableau.current?.getBoundingClientRect()
    return r ? [e.clientX - r.left, e.clientY - r.top] : [e.clientX, e.clientY]
  }

  const deposer = (p: PostItDeLaRiviere, yTableau: number): void => {
    const cible = etages.find((e) => yTableau >= e.haut && yTableau < e.haut + e.hauteur)
    if (!cible || cible.cle === p.etage) return
    const s = stockage()
    if (!s) return
    // Ramené à l'étage de ses preuves, le post-it perd son état manuel au lieu d'en garder un copié.
    setManuels(poserEtatManuel(s, p.conversationId, cible.cle === p.etatPreuve ? null : cible.cle))
  }

  const fiche = choisi ? riviere.postits.find((p) => p.conversationId === choisi) : undefined
  // Les boutons « vérifier » (conv-1136) : la ligne « À vérifier » affichée, filtre de personne compris.
  const aVerifier = useMemo(
    () => postitsAVerifier(riviere.postits, personne),
    [riviere.postits, personne]
  )
  const survol = useSurvolDesGestes()
  /** « Vérifié à la main » : le même état manuel que le glisser vers « Fait », jamais une preuve. */
  const verifieALaMain = (conversationId: string): void => {
    const s = stockage()
    if (s) setManuels(poserEtatManuel(s, conversationId, 'prouve'))
  }
  // Dans le passé, la frise dit ses dates : « les 14 derniers jours » y serait faux.
  const fenetre =
    recul === 0
      ? `les ${JOURS} derniers jours`
      : `du ${riviere.jours[0].nom} au ${riviere.jours[JOURS - 1].nom}`

  return (
    <section className="riviere" data-testid="riviere" aria-label={`La rivière, ${fenetre}`}>
      <div className="riviere-outils">
        <h2 className="besoins-section">La rivière</h2>
        {recul > 0 && (
          <button
            type="button"
            className="riviere-puce"
            data-testid="riviere-aujourdhui"
            title="Ramener la frise et la loupe sur aujourd’hui"
            onClick={revenirAujourdhui}
          >
            revenir à aujourd’hui
          </button>
        )}
        {presents.length > 0 && (
          <span className="riviere-personnes" role="group" aria-label="Filtrer par personne">
            <button
              type="button"
              className={`riviere-puce${personne === null ? ' is-actif' : ''}`}
              aria-pressed={personne === null}
              onClick={() => setPersonne(null)}
            >
              Tous
            </button>
            {presents.map((d) => (
              <button
                key={d.cle}
                type="button"
                data-testid="riviere-personne"
                className={`riviere-puce${personne === d.cle ? ' is-actif' : ''}`}
                style={{ '--riviere-personne': couleurs.get(d.cle) } as React.CSSProperties}
                aria-pressed={personne === d.cle}
                // Barré au crayon quand une AUTRE personne est choisie (conv-1132) : sans choix,
                // tout le monde est affiché, donc personne n'est barré.
                data-barre={personne !== null && personne !== d.cle ? 'true' : undefined}
                title={d.email ?? d.nom}
                onClick={() => setPersonne(personne === d.cle ? null : d.cle)}
              >
                {d.nom}
              </button>
            ))}
          </span>
        )}
        {verifier && <ToutVerifier aVerifier={aVerifier} verifier={verifier} />}
        {/* Le compte et l'aide, en tête : rien ne reste sous le tableau (« que ce board »). */}
        <span className="riviere-compte" data-testid="riviere-pied" title={AIDE}>
          <b>{riviere.postits.length}</b> fils {recul === 0 ? 'sur ' : ''}
          {fenetre}
          {riviere.horsFenetre > 0 && <> · {riviere.horsFenetre} plus anciens</>}
          {riviere.plusRecents > 0 && <> · {riviere.plusRecents} plus récents</>} · molette ou clic
          = loupe
          {/* Dans le passé, « revenir à aujourd’hui » dit déjà où l'on est ; l'indice y passait sur
              deux lignes et volait sa hauteur au tableau (capture à 900 px, conv-1131). */}
          {recul === 0 && <>, molette vers le haut = plus ancien</>}
        </span>
      </div>
      <div ref={cadre} className="riviere-cadre" data-testid="riviere-cadre">
        {/* La bande des jours reste en place pendant que le tableau défile dessous. */}
        <div className="riviere-tete" style={{ height: HAUT_JOURS }}>
          {riviere.jours.map((jour, j) => {
            const l = (bords[j + 1] - bords[j]) * zone
            const etiquette = etiquettes[j]
            return (
              <div
                key={jour.debut}
                className="riviere-jour"
                data-testid="riviere-tete-jour"
                data-aujourdhui={jour.aujourdhui || undefined}
                data-foyer={Math.floor(foyer) === j || undefined}
                data-repere={jour.repere}
                data-serre={l < COLONNE_SERREE || undefined}
                style={{ left: bords[j] * zone, width: l, height: HAUT_JOURS }}
                onClick={() => {
                  // Fiche ouverte : le premier clic la ferme seulement (conv-1130).
                  if (choisiCourant.current !== null) setChoisi(null)
                  else allerAuJour(j)
                }}
              >
                <span
                  className="riviere-jour-nom"
                  data-testid="riviere-jour-nom"
                  data-mode={etiquette?.mode}
                  data-ancre={etiquette?.ancre}
                  style={{ fontSize: etiquette?.taillePx ?? 10, opacity: etiquette ? 1 : 0 }}
                >
                  {etiquette?.texte ?? jour.nomCourt}
                </span>
              </div>
            )
          })}
        </div>
        <div ref={plateau} className="riviere-plateau" data-testid="riviere-plateau">
          <div
            ref={tableau}
            className="riviere-tableau"
            data-testid="riviere-tableau"
            data-foyer={foyer}
            data-recul={recul}
            style={{ height: hauteur }}
            onPointerDown={(e) => {
              const fond = e.target === e.currentTarget || !!(e.target as HTMLElement).dataset.fond
              appuiAFermeLaFiche.current = fond && choisiCourant.current !== null
              if (fond) setChoisi(null)
            }}
            onClick={(e) => {
              // Le fond seul : un post-it, sa fiche ou un nom d'étage gardent leur propre clic.
              if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.fond) return
              // Fiche ouverte : le premier clic la ferme seulement, la loupe reste (conv-1130).
              if (appuiAFermeLaFiche.current) {
                appuiAFermeLaFiche.current = false
                return
              }
              const j = jourSous(pointDuTableau(e)[0])
              if (j !== null) allerAuJour(j)
            }}
          >
            {riviere.jours.map((jour, j) => {
              const l = (bords[j + 1] - bords[j]) * zone
              return (
                <div
                  key={jour.debut}
                  className="riviere-jour"
                  data-fond="1"
                  data-testid="riviere-jour"
                  data-aujourdhui={jour.aujourdhui || undefined}
                  data-foyer={Math.floor(foyer) === j || undefined}
                  data-repere={jour.repere}
                  data-serre={l < COLONNE_SERREE || undefined}
                  style={{ left: bords[j] * zone, width: l, height: hauteur }}
                />
              )
            })}
            {etages.map((e) => (
              <div
                key={e.cle}
                className="riviere-etage"
                data-fond="1"
                data-etage={e.cle}
                data-colonnes-loupe={e.colonnes[jourLoupe]}
                data-testid="riviere-etage"
                style={{ top: e.haut, height: e.hauteur, width: zone }}
              >
                <span className="riviere-etage-nom" style={{ left: zone + 10 }} title={e.aide}>
                  {e.nom} · {e.nombre}
                </span>
              </div>
            ))}
            {riviere.postits.map((p) => {
              const enMain = glisse?.id === p.conversationId && glisse.bouge ? glisse : null
              const { x, y, k, kx } = position(p)
              const px = enMain ? enMain.x0 + enMain.dx : x
              const py = enMain ? enMain.y0 + enMain.dy : y
              const estompe = personne !== null && p.demandeur?.cle !== personne
              return (
                <button
                  key={p.conversationId}
                  type="button"
                  className="riviere-postit"
                  data-testid="riviere-postit"
                  data-conversation={p.conversationId}
                  data-jour={Math.floor(p.t)}
                  data-etage={p.etage}
                  data-manuel={p.manuel ? '1' : undefined}
                  data-taille={k >= ECHELLE_TEXTE ? 'carte' : 'puce'}
                  data-estompe={estompe || undefined}
                  data-glisse={enMain ? '1' : undefined}
                  data-choisi={choisi === p.conversationId || undefined}
                  style={{
                    width: POSTIT_L,
                    height: POSTIT_H,
                    transform: `translate(${px - POSTIT_L / 2}px, ${py}px) scale(${kx}, ${k})`
                  }}
                  title={`${p.titre} — ${p.projet} · ${heure(p.instant)}${p.manuel ? ' · posé à la main' : ''}`}
                  // Le survol montre ses gestes « vérifier », s'il est dans la ligne (conv-1136).
                  {...(p.etage === 'sans-preuve'
                    ? {
                        onPointerEnter: () => survol.entrer(p.conversationId),
                        onPointerLeave: survol.sortir
                      }
                    : {})}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return
                    e.stopPropagation()
                    const [sx, sy] = pointDuTableau(e)
                    e.currentTarget.setPointerCapture?.(e.pointerId)
                    setGlisse({
                      id: p.conversationId,
                      sx,
                      sy,
                      x0: x,
                      y0: y,
                      dx: 0,
                      dy: 0,
                      bouge: false
                    })
                  }}
                  onPointerMove={(e) => {
                    const g = glisseCourant.current
                    if (!g || g.id !== p.conversationId) return
                    e.stopPropagation()
                    const [mx, my] = pointDuTableau(e)
                    const dx = mx - g.sx
                    const dy = my - g.sy
                    if (g.bouge || Math.hypot(dx, dy) > SEUIL_GLISSER)
                      setGlisse({ ...g, dx, dy, bouge: true })
                  }}
                  onPointerUp={(e) => {
                    const g = glisseCourant.current
                    if (!g || g.id !== p.conversationId) return
                    if (g.bouge) {
                      clicAvale.current = true
                      deposer(p, pointDuTableau(e)[1])
                    }
                    setGlisse(null)
                  }}
                  onPointerCancel={() => setGlisse(null)}
                  onClick={() => {
                    if (clicAvale.current) {
                      clicAvale.current = false
                      return
                    }
                    setChoisi(choisiCourant.current === p.conversationId ? null : p.conversationId)
                  }}
                >
                  <span
                    className="riviere-aimant"
                    style={{
                      background: (p.demandeur && couleurs.get(p.demandeur.cle)) || '#9aa4b2'
                    }}
                  />
                  <span className="riviere-postit-titre">{p.titre}</span>
                  <span className="riviere-postit-meta">
                    {p.projet} · {heure(p.instant)} · {p.demandes.length} dem.
                  </span>
                </button>
              )
            })}
            {/* Les gestes « vérifier » de la ligne (conv-1136), posés au coin bas-droit de chaque
                post-it : rendus à part, un bouton n'entre pas dans un bouton. */}
            {riviere.postits.map((p) => {
              if (p.etage !== 'sans-preuve' || glisse?.id === p.conversationId) return null
              const { x, y, k, kx } = position(p)
              return (
                <GestesDeVerification
                  key={`verif-${p.conversationId}`}
                  postit={p}
                  variante="postit"
                  {...(verifier ? { verifier } : {})}
                  aLaMain={() => verifieALaMain(p.conversationId)}
                  visible={survol.id === p.conversationId || choisi === p.conversationId}
                  onEntrer={() => survol.entrer(p.conversationId)}
                  onSortir={survol.sortir}
                  style={{ left: x + (POSTIT_L * kx) / 2 - 3, top: y + POSTIT_H * k - 3 }}
                />
              )
            })}
            {fiche && (
              <FicheDeLaRiviere
                postit={fiche}
                position={position(fiche)}
                largeur={total}
                hauteur={hauteur}
                ouvrir={ouvrir}
                {...(lierWorkItem ? { lierWorkItem } : {})}
                {...(delierWorkItem ? { delierWorkItem } : {})}
                {...(sourcesDesTaches ? { sourcesDesTaches } : {})}
                {...(verifier ? { verifier } : {})}
                aLaMain={() => verifieALaMain(fiche.conversationId)}
                fermer={() => setChoisi(null)}
                revenir={() => {
                  const s = stockage()
                  if (s) setManuels(poserEtatManuel(s, fiche.conversationId, null))
                }}
              />
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

function FicheDeLaRiviere({
  postit: p,
  position,
  largeur,
  hauteur,
  ouvrir,
  fermer,
  revenir,
  lierWorkItem,
  delierWorkItem,
  sourcesDesTaches,
  verifier,
  aLaMain
}: {
  postit: PostItDeLaRiviere
  position: { x: number; y: number; kx: number }
  largeur: number
  hauteur: number
  ouvrir: (conversationId: string) => void
  fermer: () => void
  revenir: () => void
  verifier?: Verifier
  aLaMain: () => void
} & GestesDesTaches): React.JSX.Element {
  const L = 300
  const droite = position.x + (POSTIT_L * position.kx) / 2 + 12
  const left =
    droite + L <= largeur ? droite : Math.max(4, position.x - (POSTIT_L * position.kx) / 2 - 12 - L)
  // Placée d'après sa hauteur MESURÉE (contenu entier, `scrollHeight`) et bornée au bas du tableau :
  // supposée de 240 px, la fiche « À vérifier » et ses gestes rognaient « Ouvrir le fil » (conv-1136).
  const boite = useRef<HTMLDivElement | null>(null)
  const [haute, setHaute] = useState(240)
  // Mesurée à chaque post-it montré ; ce qui grandit ensuite (« + task » ouvert) défile dans la fiche.
  useLayoutEffect(() => {
    const h = boite.current?.scrollHeight ?? 0
    if (h > 0) setHaute(h)
  }, [p])
  const top = Math.max(0, Math.min(position.y - 8, hauteur - haute - 4))
  const demandes = p.demandes.slice(-DEMANDES_DE_LA_FICHE)
  const date = new Date(p.instant).toLocaleString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
  return (
    <div
      ref={boite}
      className="riviere-fiche"
      data-testid="riviere-fiche"
      data-etage={p.etage}
      role="dialog"
      aria-label={p.titre}
      style={{ left, top, width: L, maxHeight: Math.max(0, hauteur - top - 4) }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="riviere-fiche-fermer"
        aria-label="Fermer la fiche"
        onClick={fermer}
      >
        ×
      </button>
      <b className="riviere-fiche-titre">{p.titre}</b>
      <span className="riviere-fiche-meta">
        {p.demandeur?.nom ?? 'demandeur inconnu'} · {p.projet} · {date} · {nomDEtage(p.etage)}
      </span>
      {p.manuel && (
        <span className="riviere-fiche-manuel" data-testid="riviere-fiche-manuel">
          posé à la main · ses preuves disent « {LIBELLES_STATUT[p.etatPreuve]} »
          <button type="button" className="riviere-fiche-lien" onClick={revenir}>
            revenir à l’état prouvé
          </button>
        </span>
      )}
      <ul className="riviere-fiche-demandes">
        {p.demandes.length > demandes.length && (
          <li className="riviere-fiche-plus">
            {p.demandes.length - demandes.length} demandes plus anciennes
          </li>
        )}
        {demandes.map((d) => (
          <li key={d.rang} title={d.constat} data-testid="riviere-fiche-demande">
            <span className="riviere-point" data-statut={d.statut} />
            <span className="riviere-fiche-heure">
              {d.debut !== undefined ? heure(d.debut) : '—'}
            </span>
            <span className="riviere-fiche-texte">{d.titre}</span>
            {/* La task de la demande (conv-1127) : liée, héritée, ou « sans task » + rattachement. */}
            <TachesDeLaDemande
              demande={d}
              {...(lierWorkItem ? { lier: lierWorkItem } : {})}
              {...(delierWorkItem ? { delier: delierWorkItem } : {})}
              {...(sourcesDesTaches ? { sources: sourcesDesTaches } : {})}
            />
          </li>
        ))}
      </ul>
      {p.etage === 'sans-preuve' && (
        <GestesDeVerification
          postit={p}
          variante="fiche"
          {...(verifier ? { verifier } : {})}
          aLaMain={aLaMain}
        />
      )}
      <button
        type="button"
        className="riviere-fiche-ouvrir"
        data-testid="riviere-fiche-ouvrir"
        onClick={() => ouvrir(p.conversationId)}
      >
        Ouvrir le fil
      </button>
    </div>
  )
}
