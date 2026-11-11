/**
 * LA RIVIÈRE À ÉTAGES DE LA CARTE DU PROJET (2026-10-23).
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
 * Le choix de période « 2 semaines / 1 mois / 3 mois » (même jour) est RETIRÉ : « enlève
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
 * Puis : « quand je click sur une colonne du board ca doit me scroll dessus ». Un CLIC
 * sur une colonne — son fond sur le tableau, ou son nom dans la bande des jours — y amène la loupe,
 * avec la même animation que la molette. Le SURVOL ne fait toujours rien (proposition 1 retirée) ;
 * le clic sur un post-it ouvre sa fiche sans déplacer la loupe. Puis : « le clic sur une colonne
 * n'agit pas quand une fiche est ouverte : le premier clic ferme juste la fiche ». Puis :
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
import type { FichesDesDemandes } from '../../../shared/fiche-de-demande'
import { corpsDeLaFiche } from './fiches-du-fil'
import { formaterDate } from '../langue'
import type { Langue } from '../../../shared/langue'
import {
  TEXTES_FR,
  traduireBoardEtMaintenance,
  useTextesBoardEtMaintenance,
  type CleBoardEtMaintenance
} from '../textes-ecrans/board-et-maintenance'
import { TachesDeLaDemande, type SourceDeTache } from './TachesDeLaDemande'
import {
  ETAGES,
  JOURS,
  PAR_LIGNE,
  PLACE_DES_GESTES,
  POSTIT_H,
  bordsDesColonnes,
  cadreDuTexte,
  disposerEtages,
  etiquettesDesJours,
  foyerDAujourdhui,
  loupeApresMolette,
  loupeCentreeSur,
  placer,
  poidsDesJours,
  riviereDe,
  texteDuPostit,
  type EtageDeLaRiviere,
  type Loupe,
  type PostItDeLaRiviere
} from './carte-riviere'
import { lireEtatsManuels, poserEtatManuel } from './etats-manuels-carte'
import { GestesDeVerification, ToutVerifier, type Verifier } from './VerificationDuBoard'
import { postitsAVerifier, useSurvolDesGestes } from './verification-du-board'
import { regrouperLesProjets, type ProjetDuFiltre } from './board-projets-du-filtre'
import { NOM_DU_DOSSIER_PERSONNEL } from './dossiers-du-chat'
import { cleDeDossier } from '../../../shared/board-dossiers-du-chat'
import './RiviereDuProjet.css'
import './RiviereDuProjet.noms-crayon.css'
import './RiviereDuProjet.collegues.css'

/** La colonne des noms d'étage, à droite du tableau (comme sur la maquette). */
const LARGEUR_ETIQUETTES = 150
/** La bande des noms de jours, en haut, hors de la partie qui défile. */
const HAUT_JOURS = 28
/** Le premier étage, sous le haut du tableau. */
const HAUT_ETAGES = 2
/** La hauteur gardée à un étage vide : il reste une cible de dépôt. */
const HAUT_ETAGE_VIDE = 26
const SOUS_LIGNE = POSTIT_H + 8
/**
 * La ligne « À vérifier » garde sous chaque post-it la place de ses boutons : posés dans
 * l'écart de 8, ils mordaient sur le post-it du dessous.
 */
const SOUS_LIGNE_A_VERIFIER = SOUS_LIGNE + PLACE_DES_GESTES
const sousLigneDe = (etage: EtageDeLaRiviere): number =>
  etage === 'sans-preuve' ? SOUS_LIGNE_A_VERIFIER : SOUS_LIGNE
/** Entre le bas d'un post-it et ses gestes « vérifier », posés dessous. */
const ECART_DES_GESTES = 3
const MARGE_ETAGE = 12
/** Sans mesure (rendu de test), la largeur d'une colonne de chat moyenne. */
const LARGEUR_PAR_DEFAUT = 960
const SEUIL_GLISSER = 5
/** Pixels de molette par cran : une molette rend ~100 par cran, un pavé tactile beaucoup moins. */
const PAS_DE_MOLETTE = 50
/** En dessous, la colonne ne trace plus son bord : à 3 mois, 90 traits gris tous les 4 px griseraient le tableau. */
const COLONNE_SERREE = 12
/**
 * En dessous, les gestes « vérifier » reprennent leur taille d'origine au lieu de suivre le post-it.
 * Elle cachait aussi le texte jusqu'au 2026-10-28 : c'est désormais `texteDuPostit`.
 */
const ECHELLE_TEXTE = 0.55
const DEMANDES_DE_LA_FICHE = 12
const COULEURS_PERSONNES = ['#e9bd4e', '#4fb6e0', '#ff85c8', '#7cc46b', '#b48cff', '#ff9f5a']

/**
 * La couleur de punaise de la i-ème personne : une couleur par personne. Au-delà de la
 * palette, l'ancien `i % 6` redonnait la couleur d'une autre ; l'angle d'or écarte chaque teinte
 * suivante de toutes les précédentes.
 */
function couleurDePersonne(i: number): string {
  if (i < COULEURS_PERSONNES.length) return COULEURS_PERSONNES[i]
  const teinte = Math.round(((i - COULEURS_PERSONNES.length) * 137.508 + 20) % 360)
  return `hsl(${teinte}, 70%, 55%)`
}

function stockage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

const heure = (instant: number): string =>
  formaterDate(instant, { hour: '2-digit', minute: '2-digit' })

/** L'état prouvé d'un fil, dit dans la fiche (« ses preuves disent … »). */
const CLES_STATUT: Record<PostItDeLaRiviere['etatPreuve'], CleBoardEtMaintenance> = {
  prouve: 'statut.prouve',
  refuse: 'statut.refuse',
  'en-cours': 'statut.enCours',
  'sans-preuve': 'statut.sansPreuve'
}

/**
 * Les constats et titres de repli d'une demande sont écrits EN FRANÇAIS par `carte-du-fil.ts`, qui
 * tourne dans le processus principal et dont la carte est gardée en cache : on ne peut
 * pas les traduire à la source — `carte-des-besoins-branches.ts` compare d'ailleurs le constat
 * « une question t’attend » mot pour mot. Ils sont donc traduits ICI, à l'affichage ; un texte qui
 * n'est pas l'un d'eux (titre écrit par l'utilisateur, sortie d'une vérification) passe tel quel.
 */
const TEXTES_FIXES_DE_LA_CARTE: readonly CleBoardEtMaintenance[] = [
  'constat.agentTravaille',
  'constat.attenteReponse',
  'constat.aucuneReponse',
  'constat.tourEnEchec',
  'constat.tourArrete',
  'constat.finiSansVerification',
  'constat.rienAVerifier',
  'constat.repartDuResume',
  'constat.questionTAttend',
  'titre.demande',
  'titre.compactage',
  'titre.suiteAcceptee'
]
const TEXTES_A_VALEUR_DE_LA_CARTE: readonly (readonly [CleBoardEtMaintenance, string])[] = [
  ['constat.tourEnEchecDetail', 'detail'],
  ['titre.suite', 'suite']
]

function texteDeLaCarte(texte: string, langue: Langue): string {
  if (langue === 'fr') return texte
  const fixe = TEXTES_FIXES_DE_LA_CARTE.find((cle) => TEXTES_FR[cle] === texte)
  if (fixe) return traduireBoardEtMaintenance(fixe, langue)
  for (const [cle, nom] of TEXTES_A_VALEUR_DE_LA_CARTE) {
    const prefixe = TEXTES_FR[cle].split(`{${nom}}`)[0]
    if (texte.startsWith(prefixe) && texte.length > prefixe.length)
      return traduireBoardEtMaintenance(cle, langue, { [nom]: texte.slice(prefixe.length) })
  }
  return texte
}

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

/**
 * Le lien « RUN.md » de chaque demande d'un post-it : la fiche que l'app écrit pour elle,
 * ouverte dans son fil. Absent = pas de lien (Board sans fiches, demande d'un collègue).
 */
interface FichesDuBoard {
  fiches?: FichesDesDemandes
  ouvrirFiche?: (conversationId: string, chemin: string) => void
}

/** Lier / détacher un work item d'une demande ; absents = la fiche ne fait que montrer. */
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
  verifier,
  dossierPersonnel = null,
  fiches,
  ouvrirFiche
}: {
  carte: CarteDesBesoins
  ouvrir: (conversationId: string) => void
  /** Envoie `/check` dans des fils ; absent = seul « Vérifié à la main » reste. */
  verifier?: Verifier
  /**
   * Le dossier personnel : le menu des projets le nomme « 💻 This computer », comme le Chat et le
   * rouage du Board (« prenom.nom » s'y lisait comme un projet à supprimer).
   */
  dossierPersonnel?: string | null
} & GestesDesTaches &
  FichesDuBoard): React.JSX.Element {
  const { t, langue } = useTextesBoardEtMaintenance()
  const [manuels, setManuels] = useState(() => {
    const s = stockage()
    return s ? lireEtatsManuels(s) : {}
  })
  // La loupe s'ouvre sur aujourd'hui, frise non reculée.
  const [loupe, setLoupeAffichee] = useState<Loupe>(() => ({ foyer: foyerDAujourdhui(), recul: 0 }))
  const { foyer, recul } = loupe
  // Seuls les JOURS affichés sont calculés : reculer la frise recalcule ces 14 jours, pas l'historique.
  // La langue en fait partie : les noms des jours et des étages y sont écrits.
  const riviere = useMemo(
    () => riviereDe(carte, carte.calculeeA, manuels, JOURS, recul, langue),
    [carte, manuels, recul, langue]
  )
  // La place offerte au tableau, mesurée : il s'y tient en entier (0 = pas encore mesurée).
  const [taille, setTaille] = useState({ l: 0, h: 0 })
  const [personne, setPersonne] = useState<string | null>(null)
  // Le filtre par projet (« filtre par projet dans le board en plus du filtre par
  // personne ») : la clé d'un GROUPE de libellés (`board-projets-du-filtre.ts`), jamais la clé du
  // dossier — un projet de collègue porte une clé à lui (`collegue:<poste>:…`) et parfois un autre
  // nom (« Autowin-OS »), et choisir AutoWinOS doit montrer les fils de tout le monde dessus.
  const [projet, setProjet] = useState<string | null>(null)
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
  // Vrai quand l'appui sur le fond vient de fermer une fiche : son clic s'arrête là.
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
   * plus récents des deux côtés, et la loupe se pose sur elle.
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
      // Ctrl + molette est le zoom de l'app (App.tsx) : il déplaçait AUSSI la loupe d'une
      // demi-journée par cran, et les post-it regardés perdaient leur texte.
      if (e.ctrlKey) return
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
        sousLigneParEtage: { 'sans-preuve': SOUS_LIGNE_A_VERIFIER },
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
    () => new Map(carte.demandeurs.map((d, i) => [d.cle, couleurDePersonne(i)])),
    [carte.demandeurs]
  )
  // Les groupes sont calculés sur TOUS les projets de la carte, pas sur la frise : une copie de fil
  // rejoint son projet même quand ce projet n'a aucun post-it dans les 14 jours affichés.
  const groupesDesProjets = useMemo(() => {
    const groupes = regrouperLesProjets(
      carte.projets.map((p) => ({ libelle: p.libelle, demandes: p.demandes.length })),
      traduireBoardEtMaintenance('riviere.projets.autres', langue)
    )
    const clePersonnelle = cleDeDossier(dossierPersonnel)
    const personnel = clePersonnelle
      ? carte.projets.find((p) => cleDeDossier(p.cle) === clePersonnelle)
      : undefined
    const groupe = personnel && groupes.get(personnel.libelle)
    if (groupe)
      for (const [libelle, g] of groupes)
        if (g.cle === groupe.cle) groupes.set(libelle, { ...g, nom: NOM_DU_DOSSIER_PERSONNEL })
    return groupes
  }, [carte.projets, langue, dossierPersonnel])
  const groupeDuPostit = useCallback(
    (p: PostItDeLaRiviere): ProjetDuFiltre =>
      groupesDesProjets.get(p.projet) ?? { cle: p.projet, nom: p.projet },
    [groupesDesProjets]
  )
  // Les projets des post-its affichés, le plus récemment actif d'abord (l'ordre de `carte.projets`).
  // Le projet choisi reste dans la liste quand la frise glisse hors de ses jours : sinon le menu
  // montrerait « Tous les projets » alors que le filtre estompe encore tout.
  const projetsPresents = useMemo(() => {
    const parCle = new Map<string, ProjetDuFiltre>()
    for (const p of riviere.postits) {
      const g = groupeDuPostit(p)
      if (!parCle.has(g.cle)) parCle.set(g.cle, g)
    }
    if (projet !== null && !parCle.has(projet)) {
      const choisi = [...groupesDesProjets.values()].find((g) => g.cle === projet)
      parCle.set(projet, choisi ?? { cle: projet, nom: projet })
    }
    return [...parCle.values()]
  }, [riviere.postits, projet, groupeDuPostit, groupesDesProjets])
  const dansLeProjet = useCallback(
    (p: PostItDeLaRiviere): boolean => projet === null || groupeDuPostit(p).cle === projet,
    [projet, groupeDuPostit]
  )
  // Les noms : ceux qui ont un post-it affiché DANS LE PROJET CHOISI (« n'affiche dans
  // la liste des personnes que celles qui ont des post-its dans le projet choisi »). La personne
  // choisie reste, comme le projet choisi : sans son nom, plus rien ne dirait pourquoi tout est
  // estompé, ni ne permettrait de la décocher.
  const presents = useMemo(() => {
    const cles = new Set(
      riviere.postits
        .filter(dansLeProjet)
        .map((p) => p.demandeur?.cle)
        .filter(Boolean)
    )
    if (personne !== null) cles.add(personne)
    return carte.demandeurs.filter((d) => cles.has(d.cle))
  }, [carte.demandeurs, riviere.postits, dansLeProjet, personne])

  const position = useCallback(
    (p: PostItDeLaRiviere) => {
      const jour = Math.floor(p.t)
      const etage = etageDe.get(p.etage)
      const sousLigne = sousLigneDe(p.etage)
      const pas = etage?.pas[jour] ?? sousLigne
      // 3 de front, ou 4 à 5 dans une case chargée sous la loupe : la case de chaque post-it en découle.
      const c = etage?.colonnes[jour] ?? PAR_LIGNE
      const { x, k, kx, largeur } = placer(jour, p.rang % c, bords, zone, pas / sousLigne, c)
      const ligne = Math.floor(p.rang / c)
      const y = (etage?.haut ?? 0) + (etage?.marge ?? MARGE_ETAGE) + ligne * pas
      return { x, y, k, kx, largeur }
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
    setManuels(poserEtatManuel(s, p.cle, cible.cle === p.etatPreuve ? null : cible.cle))
  }

  const fiche = choisi ? riviere.postits.find((p) => p.cle === choisi) : undefined
  // Les boutons « vérifier » : la ligne « À vérifier » affichée, filtres de personne et
  // de projet compris.
  const aVerifier = useMemo(
    () => postitsAVerifier(riviere.postits, personne, dansLeProjet),
    [riviere.postits, personne, dansLeProjet]
  )
  const survol = useSurvolDesGestes()
  /** « Vérifié à la main » : le même état manuel que le glisser vers « Fait », jamais une preuve. */
  const verifieALaMain = (cle: string): void => {
    const s = stockage()
    if (s) setManuels(poserEtatManuel(s, cle, 'prouve'))
  }
  // Dans le passé, la frise dit ses dates : « les 14 derniers jours » y serait faux.
  const fenetre =
    recul === 0
      ? t('riviere.fenetre.derniers', { n: JOURS })
      : t('riviere.fenetre.du', { debut: riviere.jours[0].nom, fin: riviere.jours[JOURS - 1].nom })

  return (
    <section className="riviere" data-testid="riviere" aria-label={t('riviere.aria', { fenetre })}>
      <div className="riviere-outils">
        <h2 className="besoins-section">{t('riviere.titre')}</h2>
        {recul > 0 && (
          <button
            type="button"
            className="riviere-puce"
            data-testid="riviere-aujourdhui"
            title={t('riviere.aujourdhui.aide')}
            onClick={revenirAujourdhui}
          >
            {t('riviere.aujourdhui')}
          </button>
        )}
        {presents.length > 0 && (
          <span className="riviere-personnes" role="group" aria-label={t('riviere.personnes')}>
            <button
              type="button"
              className={`riviere-puce${personne === null ? ' is-actif' : ''}`}
              aria-pressed={personne === null}
              onClick={() => setPersonne(null)}
            >
              {t('riviere.tous')}
            </button>
            {presents.map((d) => (
              <button
                key={d.cle}
                type="button"
                data-testid="riviere-personne"
                className={`riviere-puce${personne === d.cle ? ' is-actif' : ''}`}
                style={{ '--riviere-personne': couleurs.get(d.cle) } as React.CSSProperties}
                aria-pressed={personne === d.cle}
                // Barré au crayon quand une AUTRE personne est choisie : sans choix,
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
        {/* Un menu et non des puces comme les noms : les projets sont plus nombreux, et la
            barre doit tenir sur une ligne (« tout doit rentrer dans l'écran en hauteur »). Seul
            un projet ne se filtre pas : le menu n'apparaît qu'à partir de deux. */}
        {projetsPresents.length > 1 && (
          <select
            className="riviere-puce riviere-projets"
            data-testid="riviere-projet"
            aria-label={t('riviere.projets')}
            title={t('riviere.projets')}
            data-actif={projet !== null || undefined}
            value={projet ?? ''}
            onChange={(e) => setProjet(e.target.value === '' ? null : e.target.value)}
          >
            <option value="">{t('riviere.tousLesProjets')}</option>
            {projetsPresents.map((g) => (
              <option key={g.cle} value={g.cle}>
                {g.nom}
              </option>
            ))}
          </select>
        )}
        {verifier && <ToutVerifier aVerifier={aVerifier} verifier={verifier} />}
        {/* Plus de ligne de compte ni d'aide à la molette en tête : l'utilisateur l'a fait retirer
            (« vire ce texte du board »). La fenêtre reste dite par l'aria-label. */}
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
                  // Fiche ouverte : le premier clic la ferme seulement.
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
              // Fiche ouverte : le premier clic la ferme seulement, la loupe reste.
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
              const enMain = glisse?.id === p.cle && glisse.bouge ? glisse : null
              const { x, y, k, kx, largeur } = position(p)
              const px = enMain ? enMain.x0 + enMain.dx : x
              const py = enMain ? enMain.y0 + enMain.dy : y
              const estompe =
                (personne !== null && p.demandeur?.cle !== personne) || !dansLeProjet(p)
              // Le texte garde sa taille à l'écran ; ce sont ses lignes qui cèdent. Son
              // bloc est contre-échelonné même en pastille : il reste continu quand elle s'écrit.
              const texte = texteDuPostit(k, largeur)
              const cadreTexte = texte ?? cadreDuTexte(k, largeur)
              return (
                <button
                  key={p.cle}
                  type="button"
                  className="riviere-postit"
                  data-testid="riviere-postit"
                  data-conversation={p.conversationId}
                  data-fiche={p.fiche}
                  data-jour={Math.floor(p.t)}
                  data-etage={p.etage}
                  data-manuel={p.manuel ? '1' : undefined}
                  data-collegue={p.collegue?.poste}
                  data-taille={texte ? 'carte' : 'puce'}
                  data-meta={texte && !texte.avecMeta ? 'sans' : undefined}
                  data-estompe={estompe || undefined}
                  data-glisse={enMain ? '1' : undefined}
                  data-choisi={choisi === p.cle || undefined}
                  style={{
                    width: largeur,
                    height: POSTIT_H,
                    transform: `translate(${px - largeur / 2}px, ${py}px) scale(${kx}, ${k})`
                  }}
                  title={`${p.titre} — ${p.projet} · ${heure(p.instant)}${p.manuel ? t('riviere.postit.poseALaMain') : ''}${p.collegue ? t('riviere.postit.collegue', { nom: p.collegue.nom }) : ''}`}
                  // Le survol montre ses gestes « vérifier », s'il est dans la ligne —
                  // jamais sur un post-it de collègue : son fil vit sur son poste.
                  {...(p.etage === 'sans-preuve' && !p.collegue
                    ? {
                        onPointerEnter: () => survol.entrer(p.cle),
                        onPointerLeave: survol.sortir
                      }
                    : {})}
                  onPointerDown={(e) => {
                    // Un post-it de collègue ne se glisse pas : son clic ouvre sa fiche.
                    if (e.button !== 0 || p.collegue) return
                    e.stopPropagation()
                    const [sx, sy] = pointDuTableau(e)
                    e.currentTarget.setPointerCapture?.(e.pointerId)
                    setGlisse({
                      id: p.cle,
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
                    if (!g || g.id !== p.cle) return
                    e.stopPropagation()
                    const [mx, my] = pointDuTableau(e)
                    const dx = mx - g.sx
                    const dy = my - g.sy
                    if (g.bouge || Math.hypot(dx, dy) > SEUIL_GLISSER)
                      setGlisse({ ...g, dx, dy, bouge: true })
                  }}
                  onPointerUp={(e) => {
                    const g = glisseCourant.current
                    if (!g || g.id !== p.cle) return
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
                    setChoisi(choisiCourant.current === p.cle ? null : p.cle)
                  }}
                >
                  {/* La punaise (« les aimants disparaissent au profit d'une punaise au
                      centre du post-it ») : la couleur de la personne qui a demandé ; sans
                      personne connue, le gris de la feuille de style. */}
                  <span
                    className="riviere-punaise"
                    data-testid="riviere-punaise"
                    style={
                      {
                        '--riviere-punaise': p.demandeur ? couleurs.get(p.demandeur.cle) : undefined
                      } as React.CSSProperties
                    }
                  />
                  <span
                    className="riviere-postit-texte"
                    data-testid="riviere-postit-texte"
                    style={{
                      width: cadreTexte.largeur,
                      transform: `scale(${cadreTexte.grossi})`
                    }}
                  >
                    <span className="riviere-postit-titre" data-lignes={texte?.lignes}>
                      {p.titre}
                    </span>
                    <span className="riviere-postit-meta">
                      {/* Le nom du collègue d'abord : la ligne se coupe par la fin. */}
                      {p.collegue && (
                        <b
                          className="riviere-postit-collegue"
                          data-testid="riviere-postit-collegue"
                        >
                          {p.collegue.nom} ·{' '}
                        </b>
                      )}
                      {p.projet} · {heure(p.instant)} ·{' '}
                      {t('riviere.postit.demandes', { n: p.demandes.length })}
                    </span>
                  </span>
                </button>
              )
            })}
            {/* Les gestes « vérifier » de la ligne, centrés SOUS chaque post-it : posés
                sur son coin bas-droit, ils cachaient sa ligne projet · heure (« les boutons
                doivent apparaître en dessous du post-it et être bien centrés »). Rendus à part : un
                bouton n'entre pas dans un bouton. */}
            {riviere.postits.map((p) => {
              if (p.etage !== 'sans-preuve' || p.collegue || glisse?.id === p.cle) return null
              const { x, y, k } = position(p)
              // À l'échelle de leur post-it, comme son texte, pour tenir dans la place gardée dessous
              // Une pastille sans texte garde des boutons lisibles, comme avant.
              const kg = k >= ECHELLE_TEXTE ? k : 1
              return (
                <GestesDeVerification
                  key={`verif-${p.cle}`}
                  postit={p}
                  variante="postit"
                  // Un `/check` vise la dernière demande du FIL : pour une tâche que son fil a
                  // laissée derrière lui, il vérifierait une autre tâche.
                  {...(verifier && p.derniereDuFil ? { verifier } : {})}
                  aLaMain={() => verifieALaMain(p.cle)}
                  visible={survol.id === p.cle || choisi === p.cle}
                  onEntrer={() => survol.entrer(p.cle)}
                  onSortir={survol.sortir}
                  style={
                    {
                      left: x,
                      top: y + POSTIT_H * k + ECART_DES_GESTES * kg,
                      '--riviere-gestes-echelle': kg
                    } as React.CSSProperties
                  }
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
                {...(fiches ? { fiches } : {})}
                {...(ouvrirFiche ? { ouvrirFiche } : {})}
                {...(lierWorkItem ? { lierWorkItem } : {})}
                {...(delierWorkItem ? { delierWorkItem } : {})}
                {...(sourcesDesTaches ? { sourcesDesTaches } : {})}
                {...(verifier && fiche.derniereDuFil ? { verifier } : {})}
                aLaMain={() => verifieALaMain(fiche.cle)}
                fermer={() => setChoisi(null)}
                revenir={() => {
                  const s = stockage()
                  if (s) setManuels(poserEtatManuel(s, fiche.cle, null))
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
  aLaMain,
  fiches,
  ouvrirFiche
}: {
  postit: PostItDeLaRiviere
  position: { x: number; y: number; kx: number; largeur: number }
  largeur: number
  hauteur: number
  ouvrir: (conversationId: string) => void
  fermer: () => void
  revenir: () => void
  verifier?: Verifier
  aLaMain: () => void
} & GestesDesTaches &
  FichesDuBoard): React.JSX.Element {
  const { t, langue } = useTextesBoardEtMaintenance()
  const L = 300
  // La demi-largeur du post-it À L'ÉCRAN : il s'étire quand sa case a de la place.
  const demi = (position.largeur * position.kx) / 2
  const droite = position.x + demi + 12
  const left = droite + L <= largeur ? droite : Math.max(4, position.x - demi - 12 - L)
  // Placée d'après sa hauteur MESURÉE (contenu entier, `scrollHeight`) et bornée au bas du tableau :
  // supposée de 240 px, la fiche « À vérifier » et ses gestes rognaient « Ouvrir le fil ».
  const boite = useRef<HTMLDivElement | null>(null)
  const [haute, setHaute] = useState(240)
  // Mesurée à chaque post-it montré ; ce qui grandit ensuite (« + task » ouvert) défile dans la fiche.
  useLayoutEffect(() => {
    const h = boite.current?.scrollHeight ?? 0
    if (h > 0) setHaute(h)
  }, [p])
  const top = Math.max(0, Math.min(position.y - 8, hauteur - haute - 4))
  const demandes = p.demandes.slice(-DEMANDES_DE_LA_FICHE)
  const date = formaterDate(p.instant, {
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
        aria-label={t('fiche.fermer')}
        onClick={fermer}
      >
        ×
      </button>
      <b className="riviere-fiche-titre">{p.titre}</b>
      <span className="riviere-fiche-meta">
        {p.demandeur?.nom ?? t('fiche.demandeurInconnu')} · {p.projet} · {date} ·{' '}
        {nomDEtage(p.etage)}
      </span>
      {/* Le post-it EST un RUN.md léger : « je devrais pouvoir voir le run.md depuis le
          board ». Un bouton en tête, plutôt qu'un petit lien répété sur chaque demande. */}
      {(() => {
        if (!p.fiche || p.collegue || !ouvrirFiche) return null
        const porteuse = [...p.demandes]
          .reverse()
          .find((d) => !d.collegue && d.messageId && fiches?.[d.conversationId]?.[d.messageId])
        const chemin = porteuse?.messageId
          ? fiches?.[porteuse.conversationId]?.[porteuse.messageId]
          : undefined
        if (!porteuse || !chemin) return null
        return (
          <button
            type="button"
            className="riviere-fiche-lien riviere-fiche-runmd"
            data-testid="riviere-fiche-runmd-tache"
            title={t('fiche.runMdTitre')}
            onClick={() => ouvrirFiche(porteuse.conversationId, chemin)}
          >
            RUN.md
          </button>
        )
      })()}
      {/* Le RUN.md d'un collègue : son fil vit dans SON Autowin, sa fiche se lit ici,
          recopiée par son Board dans le dossier partagé. */}
      {p.collegue && p.fiche && <RunMdDuCollegue poste={p.collegue.poste} fiche={p.fiche} />}
      {p.manuel && (
        <span className="riviere-fiche-manuel" data-testid="riviere-fiche-manuel">
          {t('fiche.manuel', { etat: t(CLES_STATUT[p.etatPreuve]) })}
          <button type="button" className="riviere-fiche-lien" onClick={revenir}>
            {t('fiche.revenir')}
          </button>
        </span>
      )}
      <ul className="riviere-fiche-demandes">
        {p.demandes.length > demandes.length && (
          <li className="riviere-fiche-plus">
            {t('fiche.plusAnciennes', { n: p.demandes.length - demandes.length })}
          </li>
        )}
        {demandes.map((d) => (
          <li
            key={`${d.conversationId}:${d.rang}`}
            title={texteDeLaCarte(d.constat, langue)}
            data-testid="riviere-fiche-demande"
          >
            <span className="riviere-point" data-statut={d.statut} />
            <span className="riviere-fiche-heure">
              {d.debut !== undefined ? heure(d.debut) : '—'}
            </span>
            {/* Le message ENTIER, retours à la ligne gardés : la première ligne coupée
                à 120 caractères ne laissait pas lire la demande. */}
            <span className="riviere-fiche-texte" data-testid="riviere-fiche-texte">
              {texteDeLaCarte(d.texte ?? d.titre, langue)}
            </span>
            {/* L'envoi de ce tour a été refusé : la phrase du fil, avec sa raison et son geste. */}
            {d.envoiRefuse && (
              <span className="riviere-fiche-refus" data-testid="riviere-fiche-refus">
                {d.envoiRefuse}
              </span>
            )}
            {/* Une tâche peut courir sur plusieurs fils (un chantier et ses lots, une « façon N/3 »)
                La demande venue d'un autre fil dit lequel, et l'ouvre. */}
            {!d.collegue && d.conversationId !== p.conversationId && (
              <button
                type="button"
                className="riviere-fiche-lien"
                data-testid="riviere-fiche-autre-fil"
                title={t('fiche.ouvrir')}
                onClick={() => ouvrir(d.conversationId)}
              >
                {d.conversationId}
              </button>
            )}
            {(() => {
              const chemin =
                !d.collegue && d.messageId ? fiches?.[d.conversationId]?.[d.messageId] : undefined
              if (!chemin || !ouvrirFiche) return null
              return (
                <button
                  type="button"
                  className="riviere-fiche-lien riviere-fiche-runmd"
                  data-testid="riviere-fiche-runmd"
                  title={t('fiche.runMdTitre')}
                  onClick={() => ouvrirFiche(d.conversationId, chemin)}
                >
                  RUN.md
                </button>
              )
            })()}
            {/* La task de la demande : liée, héritée, ou « sans task » + rattachement.
                Chez un collègue, ses tasks telles que son Board les lie, sans geste. */}
            {d.collegue ? (
              d.collegue.taches?.length ? (
                <span className="riviere-fiche-taches-collegue" data-testid="riviere-fiche-taches">
                  {d.collegue.taches.map((w) => `#${w.id}`).join(', ')}
                </span>
              ) : null
            ) : (
              <TachesDeLaDemande
                demande={d}
                {...(lierWorkItem ? { lier: lierWorkItem } : {})}
                {...(delierWorkItem ? { delier: delierWorkItem } : {})}
                {...(sourcesDesTaches ? { sources: sourcesDesTaches } : {})}
              />
            )}
          </li>
        ))}
      </ul>
      {p.etage === 'sans-preuve' && !p.collegue && (
        <GestesDeVerification
          postit={p}
          variante="fiche"
          {...(verifier ? { verifier } : {})}
          aLaMain={aLaMain}
        />
      )}
      {/* Un fil de collègue vit dans SON Autowin : rien à ouvrir ici, on dit où il est. */}
      {p.collegue ? (
        <span className="riviere-fiche-collegue" data-testid="riviere-fiche-collegue">
          {t('fiche.collegue', { nom: p.collegue.nom, conv: p.collegue.conversationId })}
        </span>
      ) : (
        <button
          type="button"
          className="riviere-fiche-ouvrir"
          data-testid="riviere-fiche-ouvrir"
          onClick={() => ouvrir(p.conversationId)}
        >
          {t('fiche.ouvrir')}
        </button>
      )}
    </div>
  )
}

/**
 * Le RUN.md d'un post-it de collègue, déplié dans sa carte. `fiche` porte le préfixe du
 * poste (`board-collegues.ts`) : il est retiré avant la lecture.
 */
export function RunMdDuCollegue({
  poste,
  fiche,
  lire = (po, f) => window.api.boardFicheCollegue(po, f)
}: {
  poste: string
  fiche: string
  lire?: (poste: string, fiche: string) => Promise<string | null>
}): React.JSX.Element {
  const { t } = useTextesBoardEtMaintenance()
  const [ouvert, setOuvert] = useState(false)
  const [contenu, setContenu] = useState<string | null | undefined>(undefined)
  const relative = fiche.startsWith(`${poste}/`) ? fiche.slice(poste.length + 1) : fiche
  const basculer = async (): Promise<void> => {
    if (ouvert) return setOuvert(false)
    setOuvert(true)
    if (contenu === undefined) {
      try {
        setContenu(await lire(poste, relative))
      } catch {
        setContenu(null)
      }
    }
  }
  return (
    <div className="riviere-fiche-runmd-collegue" data-testid="riviere-fiche-runmd-collegue">
      <button
        type="button"
        className="riviere-fiche-lien riviere-fiche-runmd"
        aria-expanded={ouvert}
        title={t('fiche.runMdTitre')}
        onClick={() => void basculer()}
      >
        RUN.md
      </button>
      {ouvert &&
        (contenu === undefined ? (
          <span className="riviere-fiche-plus">…</span>
        ) : contenu === null ? (
          <span className="riviere-fiche-plus" data-testid="riviere-fiche-runmd-absent">
            {t('fiche.runMdAbsent')}
          </span>
        ) : (
          <pre className="riviere-fiche-runmd-texte" data-testid="riviere-fiche-runmd-texte">
            {corpsDeLaFiche(contenu)}
          </pre>
        ))}
    </div>
  )
}
