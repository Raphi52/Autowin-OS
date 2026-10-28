/**
 * LA RIVIÈRE À ÉTAGES DE LA CARTE DU PROJET — le calcul PUR (/draft conv-1113, 2026-10-23).
 *
 * Demande : « implémente 1+2 », sur le tour 9 du /draft : la « Rivière à étages d'état » (le temps de
 * gauche à droite sur 14 jours, un étage par état, glisser un post-it vers un autre étage change son
 * état) avec une LOUPE : « la colonne la plus large est celle sur laquelle mon scroll est situé ».
 * Proposition 2 : chaque cran de molette avance ou recule la loupe d'une demi-journée. (La 1, la
 * colonne sous la souris, a été retirée le même jour : « laisse que la roulette ».)
 *
 * Le choix de période « 2 semaines / 1 mois / 3 mois » (même jour) a été RETIRÉ (conv-1131) : « enlève
 * le filtre 2 semaines, on doit pouvoir remonter à l'infini en lazy load ». La frise garde 14 colonnes,
 * mais elle GLISSE : le `recul` (en jours) recule sa fin, et la molette le fait grandir sans butée,
 * jusqu'au plus vieux fil daté (`loupeApresMolette`). Seuls les 14 jours affichés sont calculés et
 * posés : un fil plus ancien n'entre dans la frise qu'au moment où la loupe arrive à son jour.
 *
 * Tout dans la hauteur de l'écran (même jour) : « tout doit rentrer dans l'écran en hauteur », rien
 * ne défile. `disposerEtages` partage la hauteur offerte entre les étages d'après ce que demande la
 * LOUPE : le jour du foyer garde des post-it à taille de lecture tant que la place le permet, les
 * jours serrés tassent leurs pastilles. Les étages suivent donc la loupe ; l'ORDRE des post-it d'une
 * case (leur rang, à l'heure), lui, ne change jamais.
 *
 * Jour chargé (même jour) : « quand la loupe est sur un jour très chargé, range ses post-it sur 4 ou
 * 5 colonnes au lieu de 3 pour qu'ils restent plus grands ». Au jour de la loupe, chaque étage essaie
 * 3, 4 et 5 de front ; `disposerEtages` garde le choix qui laisse ses plus petits post-it les plus
 * grands. Un jour peu chargé reste donc à 3 : là, c'est la largeur qui borne, pas la hauteur.
 *
 * Un post-it = un FIL (une conversation), posé au moment de sa dernière demande, à l'étage de l'état
 * de cette dernière demande. Un état posé à la main (glisser) passe devant tant que le fil n'a pas
 * bougé depuis ; il ne compte jamais comme une preuve.
 *
 * Hors du fichier de composant : un module de composants qui exporte aussi des fonctions casse le
 * rafraîchissement à chaud (même raison que `carte-des-besoins-branches.ts`).
 */
import type {
  CarteDesBesoins,
  CollegueDeLaDemande,
  DemandeDeLaCarte,
  DemandeurDeLaCarte,
  StatutDemande
} from '../../../shared/carte-des-besoins'
import type { Langue } from '../../../shared/langue'
import { formaterDate, langueCourante } from '../langue'
import {
  traduireBoardEtMaintenance,
  type CleBoardEtMaintenance
} from '../textes-ecrans/board-et-maintenance'
import { filsDuProjet } from './carte-des-besoins-branches'

export type EtageDeLaRiviere = 'a-faire' | StatutDemande

/**
 * Un étage : son nom et son aide sont lus dans la langue COURANTE à chaque lecture (conv-1170),
 * `cle` reste l'identifiant que relisent les états manuels (`etats-manuels-carte.ts`).
 */
function etage(
  cle: EtageDeLaRiviere,
  nom: CleBoardEtMaintenance,
  aide: CleBoardEtMaintenance
): { cle: EtageDeLaRiviere; nom: string; aide: string } {
  return {
    cle,
    get nom() {
      return traduireBoardEtMaintenance(nom, langueCourante())
    },
    get aide() {
      return traduireBoardEtMaintenance(aide, langueCourante())
    }
  }
}

/** Les étages de haut en bas, avec les noms du kanban montrés au /draft. */
export const ETAGES: readonly { cle: EtageDeLaRiviere; nom: string; aide: string }[] = [
  etage('a-faire', 'etage.aFaire', 'etage.aFaire.aide'),
  etage('en-cours', 'etage.enCours', 'etage.enCours.aide'),
  etage('refuse', 'etage.bloque', 'etage.bloque.aide'),
  etage('sans-preuve', 'etage.aVerifier', 'etage.aVerifier.aide'),
  etage('prouve', 'etage.fait', 'etage.fait.aide')
]

/** Les jours affichés d'un coup : l'amplitude des maquettes du /draft. */
export const JOURS = 14

/** Jours parcourus par cran de molette : la demi-journée validée au /draft. */
export const PAS_DE_LA_LOUPE = 0.5

/**
 * Jours gardés entre la loupe et le bord de la frise avant qu'elle glisse : la loupe voit venir les
 * jours plus anciens (ou plus récents) au lieu de buter contre le bord du tableau.
 */
export const MARGE_DE_LA_LOUPE = 3

/**
 * Où est la loupe : `foyer` en jours de la frise affichée (0 = minuit de sa première colonne), et
 * `recul`, le nombre de jours dont la fin de la frise précède aujourd'hui (0 = elle finit aujourd'hui).
 */
export interface Loupe {
  foyer: number
  recul: number
}

/**
 * Post-it par ligne dans un jour (hors jour chargé sous la loupe, voir disposerEtages). Chaque jour
 * range ses post-it d'un étage en GRILLE, dans l'ordre
 * des heures (gauche → droite, puis ligne suivante), une fois pour toutes : la loupe change les x,
 * la taille et le pas des lignes (pour tenir dans l'écran, voir disposerEtages), jamais l'ordre
 * des cases. Mesuré sur la copie des fils du 23/10 (182 fils) : un rangement à l'heure exacte empilait
 * en hauteur tous les fils d'une même tranche de 8 h et montait le tableau à 2 224 px.
 */
export const PAR_LIGNE = 3

export interface EtatManuel {
  etage: EtageDeLaRiviere
  /** Quand il a été posé (ms epoch) : une demande plus récente du fil le rend caduc. */
  a: number
}

export interface PostItDeLaRiviere {
  conversationId: string
  titre: string
  projet: string
  demandeur?: DemandeurDeLaCarte
  /** L'étage affiché : l'état posé à la main s'il tient encore, sinon `etatPreuve`. */
  etage: EtageDeLaRiviere
  /** L'état de la dernière demande du fil, tel que les preuves le donnent. */
  etatPreuve: StatutDemande
  manuel?: EtatManuel
  /** Heure de la dernière demande (ms epoch). */
  instant: number
  /** Position dans la fenêtre, en jours fractionnaires : 0 = minuit du premier jour, n = demain. */
  t: number
  /** Ses demandes dans l'ordre du fil. */
  demandes: DemandeDeLaCarte[]
  /** Le collègue dont vient ce post-it (conv-1210) : lecture seule, à l'étage de SON Board. */
  collegue?: CollegueDeLaDemande
  /** Son rang dans sa case (son étage, son jour), dans l'ordre des heures : sa colonne et sa ligne
   *  en découlent, d'après le nombre de post-it de front que `disposerEtages` donne à la case. */
  rang: number
}

export interface JourDeLaRiviere {
  debut: number
  /** Le nom montré quand la colonne est assez large : « jeu 22 », avec le mois au-delà de 2 semaines. */
  nom: string
  /** Le nom sans le mois, quand le nom entier ne tient pas : « jeu 22 ». */
  nomCourt: string
  /** Un jour REPÈRE garde un nom même dans une colonne serrée, sinon 1 ou 3 mois se lisent sans date. */
  repere?: 'aujourdhui' | 'mois' | 'semaine'
  /** Son nom de repère : « 1 oct. » pour un début de mois, « lun 13 » pour un lundi. */
  texteDuRepere?: string
  aujourdhui: boolean
}

export interface EtageCalcule {
  cle: EtageDeLaRiviere
  nom: string
  aide: string
  sousLignes: number
  nombre: number
  /** Post-it de chaque jour dans cet étage. */
  nombreParJour: number[]
}

export interface Riviere {
  jours: JourDeLaRiviere[]
  /** Bornes des jours (ms epoch), `jours + 1` valeurs : minuit de chaque jour, puis minuit de demain. */
  bornes: number[]
  postits: PostItDeLaRiviere[]
  etages: EtageCalcule[]
  /** Fils dont la dernière demande est plus ancienne que la fenêtre. */
  horsFenetre: number
  /** Fils dont la dernière demande est plus récente que la fenêtre (frise reculée dans le passé). */
  plusRecents: number
  /** Fils sans aucune demande datée : ils ne peuvent pas être posés dans le temps. */
  sansDate: number
  /** Jours entre aujourd'hui et le jour du plus vieux fil daté (0 sans fil daté) : la butée du passé. */
  joursEnArriere: number
}

function minuit(instant: number, decalageJours: number): number {
  const d = new Date(instant)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + decalageJours).getTime()
}

/** « jeu 22 » : le jour court sans le point que le français ajoute ; « jeu 22 oct. » avec le mois. */
export function nomDuJour(debut: number, avecMois = false): string {
  const date = new Date(debut)
  const semaine = formaterDate(date, { weekday: 'short' }).replace(/\.$/u, '')
  const nom = `${semaine} ${date.getDate()}`
  return avecMois ? `${nom} ${formaterDate(date, { month: 'short' })}` : nom
}

function repereDuJour(debut: number): Pick<JourDeLaRiviere, 'repere' | 'texteDuRepere'> {
  const date = new Date(debut)
  if (date.getDate() === 1) {
    const mois = formaterDate(date, { month: 'short' })
    return { repere: 'mois', texteDuRepere: `1 ${mois}` }
  }
  if (date.getDay() === 1) return { repere: 'semaine', texteDuRepere: nomDuJour(debut) }
  return {}
}

/** Le jour fractionnaire d'un instant ; les bornes suivent l'heure locale (jours de 23 ou 25 h compris). */
export function jourFractionnaire(instant: number, bornes: readonly number[]): number {
  const n = bornes.length - 1
  if (instant <= bornes[0]) return 0
  for (let j = 0; j < n; j += 1) {
    if (instant < bornes[j + 1]) return j + (instant - bornes[j]) / (bornes[j + 1] - bornes[j])
  }
  return n - 1e-6
}

/** L'état manuel qui tient encore : posé APRÈS la dernière demande du fil. */
function manuelValable(
  manuel: EtatManuel | undefined,
  instant: number,
  etatPreuve: StatutDemande
): EtatManuel | undefined {
  if (!manuel || manuel.a < instant || manuel.etage === etatPreuve) return undefined
  return manuel
}

/** Jours de calendrier entre deux instants (minuit local à minuit local, heure d'été comprise). */
function joursEntre(avant: number, apres: number): number {
  return Math.round((minuit(apres, 0) - minuit(avant, 0)) / 86_400_000)
}

/**
 * La frise de `n` jours qui finit `recul` jours avant aujourd'hui (0 = aujourd'hui). Seuls les fils
 * dont la dernière demande tombe dans ces jours y sont posés ; les autres sont COMPTÉS (plus anciens,
 * plus récents), jamais perdus.
 */
export function riviereDe(
  carte: CarteDesBesoins,
  maintenant: number,
  manuels: Readonly<Record<string, EtatManuel>> = {},
  n = JOURS,
  recul = 0,
  /** La langue des noms écrits dans la frise ; passée par la rivière pour recalculer à son changement. */
  langue: Langue = langueCourante()
): Riviere {
  const r = Math.max(0, Math.round(recul))
  const bornes = Array.from({ length: n + 1 }, (_, j) => minuit(maintenant, j - (n - 1) - r))
  const jours = bornes.slice(0, n).map((debut, j): JourDeLaRiviere =>
    j === n - 1 && r === 0
      ? {
          debut,
          nom: traduireBoardEtMaintenance('jour.aujourdhui', langue),
          nomCourt: traduireBoardEtMaintenance('jour.aujourdhui', langue),
          repere: 'aujourdhui',
          // Court : « aujourd’hui » en entier couvrait les 16 derniers jours à 3 mois et masquait le 1er du mois.
          texteDuRepere: traduireBoardEtMaintenance('jour.aujourdhuiCourt', langue),
          aujourdhui: true
        }
      : {
          debut,
          // Dans le passé, le mois n'est plus évident : la colonne large le porte.
          nom: nomDuJour(debut, n > JOURS || r > 0),
          nomCourt: nomDuJour(debut),
          ...repereDuJour(debut),
          aujourdhui: false
        }
  )
  const postits: PostItDeLaRiviere[] = []
  let horsFenetre = 0
  let plusRecents = 0
  let sansDate = 0
  let plusAncien = Infinity
  for (const projet of carte.projets) {
    for (const fil of filsDuProjet(projet.demandes)) {
      const instant = fil.derniereActivite
      if (instant === undefined) {
        sansDate += 1
        continue
      }
      plusAncien = Math.min(plusAncien, instant)
      if (instant < bornes[0]) {
        horsFenetre += 1
        continue
      }
      if (instant >= bornes[n]) {
        plusRecents += 1
        continue
      }
      const etatPreuve = fil.derniere.statut
      // Un post-it de collègue (conv-1210) est posé à l'étage de SON Board : nos états posés à la
      // main ne le touchent pas (il ne se glisse pas d'ici).
      const collegue = fil.derniere.collegue
      const manuel = collegue
        ? undefined
        : manuelValable(manuels[fil.conversationId], instant, etatPreuve)
      const demandeur = fil.derniere.demandeur ?? fil.demandes.find((d) => d.demandeur)?.demandeur
      postits.push({
        conversationId: fil.conversationId,
        titre: fil.titre,
        projet: projet.libelle,
        ...(demandeur ? { demandeur } : {}),
        etage: collegue?.etage ?? manuel?.etage ?? etatPreuve,
        etatPreuve,
        ...(manuel ? { manuel } : {}),
        ...(collegue ? { collegue } : {}),
        instant,
        t: jourFractionnaire(instant, bornes),
        demandes: fil.demandes,
        rang: 0
      })
    }
  }
  const etages = ETAGES.map((e) => {
    const dEtage = postits.filter((p) => p.etage === e.cle).sort((a, b) => a.t - b.t)
    const parJour = new Map<number, number>()
    let sousLignes = 0
    const nombreParJour = Array<number>(n).fill(0)
    for (const p of dEtage) {
      const jour = Math.floor(p.t)
      p.rang = parJour.get(jour) ?? 0
      parJour.set(jour, p.rang + 1)
      nombreParJour[jour] = p.rang + 1
      sousLignes = Math.max(sousLignes, Math.ceil((p.rang + 1) / PAR_LIGNE))
    }
    return { ...e, sousLignes, nombre: dEtage.length, nombreParJour }
  })
  const joursEnArriere =
    plusAncien === Infinity ? 0 : Math.max(0, joursEntre(plusAncien, maintenant))
  return { jours, bornes, postits, etages, horsFenetre, plusRecents, sansDate, joursEnArriere }
}

/** Le foyer par défaut : le milieu d'aujourd'hui. */
export const foyerDAujourdhui = (n = JOURS): number => n - 0.5

const LARGEUR_CLOCHE = 0.75
/**
 * 9 jusqu'au 2026-10-28 (le foyer prenait ~38 % de la largeur) ; 15 depuis (~47 %) : « le post-it
 * doit être plus grand, on optimise mal l'espace » (conv-1204) — les post-it de la loupe sont bornés
 * par la largeur de sa colonne, et les jours voisins n'y portent que des pastilles.
 */
const AMPLITUDE_2_SEMAINES = 15
/** Ce que pèse la cloche en tout, en multiples de son sommet : son jour et deux voisins de chaque côté (≈ 1,34). */
const ETALEMENT =
  1 + 2 * Math.exp(-((1 / LARGEUR_CLOCHE) ** 2)) + 2 * Math.exp(-((2 / LARGEUR_CLOCHE) ** 2))
/** Part de la largeur que prend le jour du foyer à 2 semaines (≈ 47 %) : on la garde à toute période. */
const PART_DU_FOYER = (1 + AMPLITUDE_2_SEMAINES) / (JOURS + AMPLITUDE_2_SEMAINES * ETALEMENT)

/**
 * L'amplitude de la cloche pour n jours : celle qui laisse au jour du foyer la même part de la
 * largeur qu'à 2 semaines — résout (1 + A) / (n + A·ÉTALEMENT) = PART_DU_FOYER, qui rend 15 à 14 jours.
 * À amplitude fixe, la colonne large tombait à ~10 % de la largeur sur 3 mois : plus rien de lisible.
 */
export function amplitudeDe(n: number): number {
  return Math.max(AMPLITUDE_2_SEMAINES, (PART_DU_FOYER * n - 1) / (1 - PART_DU_FOYER * ETALEMENT))
}

/**
 * Le poids de chaque jour pour un foyer donné : une cloche autour du foyer (largeur 0,75 jour, celle
 * des propositions 1 et 2 du /draft ; amplitude 15 à 2 semaines). Le jour du foyer prend ~47 % de la largeur.
 */
export function poidsDesJours(foyer: number, n = JOURS): number[] {
  const amplitude = amplitudeDe(n)
  return Array.from(
    { length: n },
    (_, j) => 1 + amplitude * Math.exp(-(((j + 0.5 - foyer) / LARGEUR_CLOCHE) ** 2))
  )
}

/** Les bords des colonnes en fraction de la largeur : `jours + 1` valeurs de 0 à 1. */
export function bordsDesColonnes(poids: readonly number[]): number[] {
  const total = poids.reduce((a, b) => a + b, 0)
  const bords = [0]
  let x = 0
  for (const p of poids) {
    x += p / total
    bords.push(x)
  }
  bords[bords.length - 1] = 1
  return bords
}

/**
 * Largeur d'un post-it à l'échelle 1, en pixels ; sa hauteur suit. 84 de haut depuis le 2026-10-28
 * (54, puis 62 pour la bande de la punaise) : « il doit y avoir plus de texte par post it », puis
 * « réduis un peu la taille de la police et passe à 4 lignes » (conv-1204) — le titre, coupé à 2
 * lignes en 12 px, en tient 4 en 11 px (RiviereDuProjet.css). La largeur gagnée vient d'ETIREMENT_MAX.
 */
export const POSTIT_L = 124
export const POSTIT_H = 84
/**
 * La place gardée sous un post-it « À vérifier » pour ses boutons « vérifier / à la main », à
 * l'échelle 1 : 3 d'écart, 20 de boutons (mesurés dans Chromium), 1 de jeu. Sans elle (conv-1214,
 * 2026-10-28), les boutons tombaient sur le haut du post-it du dessous — l'écart entre deux lignes
 * n'est que de 8 — et la souris, plus bas dans sa carte, ne les voyait plus.
 */
export const PLACE_DES_GESTES = 24
/**
 * L'échelle la plus grande d'un post-it. Plafonnée à 1 jusqu'au 2026-10-28, quand l'utilisateur a
 * constaté (conv-1204) : « le post it doit être plus grand, on optimise mal l'espace » — la colonne
 * de la loupe gardait des post-it de 124 px au-dessus d'un tiers de tableau vide. Ils grandissent
 * désormais jusqu'à ce que la largeur de leur colonne ou la hauteur de l'écran les arrête.
 */
export const ECHELLE_MAX = 1.5
/**
 * Le plus large qu'un post-it s'étire, en multiple de POSTIT_L. Depuis le 2026-10-28 (conv-1204,
 * « il doit y avoir plus de texte par post it ») : quand c'est la HAUTEUR de l'écran qui fixe son
 * échelle, il gardait 124 de large au milieu d'une case deux fois plus large — mesuré sur la capture
 * de l'utilisateur, la moitié de la colonne du jour restait vide entre les post-it. Il s'élargit donc
 * jusqu'à remplir sa case : plus de mots par ligne, à la même taille d'écriture.
 */
export const ETIREMENT_MAX = 2

/**
 * Où poser un post-it : son centre x (pixels) et son échelle. La taille suit la largeur de la colonne
 * de son jour, qu'il partage avec `colonnes` - 1 voisins (PAR_LIGNE, 4 ou 5 au jour chargé de la
 * loupe) : il y reste toujours (sans quoi ceux
 * d'aujourd'hui débordaient du tableau quand la colonne se serrait — vu sur les captures du tour 9).
 * `k` ne descend pas sous 0,09 (en dessous, plus rien ne se voit) ; dans une colonne plus serrée
 * encore — ~4 px à 3 mois —, le post-it garde cette hauteur et s'amincit (`kx`) pour ne pas déborder
 * sur les jours voisins. `echelleMax` borne l'échelle par le pas vertical de sa ligne : un étage
 * tassé pour tenir dans l'écran ne laisse pas un post-it chevaucher la ligne suivante.
 * `largeur` est sa largeur avant l'échelle : POSTIT_L, ou plus quand l'échelle est tenue par la
 * hauteur et que sa case a de la place (ETIREMENT_MAX) — à l'écran, `largeur × kx` reste dans sa case.
 */
export function placer(
  jour: number,
  colonne: number,
  bords: readonly number[],
  largeurPx: number,
  echelleMax = ECHELLE_MAX,
  colonnes = PAR_LIGNE
): { x: number; k: number; kx: number; largeur: number } {
  const j = Math.min(bords.length - 2, Math.max(0, jour))
  const g = bords[j] * largeurPx
  const l = (bords[j + 1] - bords[j]) * largeurPx
  const ajuste = ajusteALaColonne(l, colonnes)
  const k = Math.min(ECHELLE_MAX, Math.max(0.09, ajuste), echelleMax)
  const largeur = POSTIT_L * Math.min(ETIREMENT_MAX, Math.max(1, ajuste / k))
  return { x: g + (l * (colonne + 0.5)) / colonnes, k, kx: Math.min(k, ajuste), largeur }
}

/** L'échelle qui fait tenir `colonnes` post-it de front dans une colonne de `l` px (90 % de sa largeur). */
function ajusteALaColonne(l: number, colonnes: number): number {
  return (l * 0.9) / (colonnes * POSTIT_L)
}

/**
 * La loupe après un cran de molette (vers le bas = vers aujourd'hui), ou `null` en butée : au milieu
 * d'aujourd'hui, ou au jour du plus vieux fil daté (`joursEnArriere`) — au-delà, la frise ne
 * montrerait plus que des jours vides. Entre les deux, aucune butée (conv-1131, « remonter à
 * l'infini ») : la loupe recule d'une demi-journée par cran et, arrivée à MARGE_DE_LA_LOUPE jours du
 * bord, c'est la FRISE qui glisse d'un jour (le `recul`), pas la loupe qui sort du tableau. Même
 * chose vers aujourd'hui, jusqu'à ce que la frise y revienne (`recul` 0).
 */
export function loupeApresMolette(
  loupe: Loupe,
  sens: number,
  joursEnArriere: number,
  n = JOURS,
  pas = PAS_DE_LA_LOUPE
): Loupe | null {
  if (sens === 0) return null
  // Positions comptées depuis la frise qui finit aujourd'hui : n − 0,5 = le milieu d'aujourd'hui.
  const position = loupe.foyer - loupe.recul
  const max = n - 0.5
  const min = Math.min(0.5, n - 0.5 - Math.max(0, joursEnArriere))
  if (sens > 0 ? position >= max : position <= min) return null
  const suivante = Math.max(min, Math.min(max, position + Math.sign(sens) * pas))
  const reculMax = Math.max(0, Math.round(joursEnArriere) - (n - 1))
  // Une loupe posée plus près du bord (clic sur une colonne) y reste : la frise glisse sans la sauter.
  const bas = Math.min(MARGE_DE_LA_LOUPE, loupe.foyer)
  const haut = Math.max(n - MARGE_DE_LA_LOUPE, loupe.foyer)
  let recul = loupe.recul
  if (suivante + recul < bas) recul = Math.ceil(bas - suivante)
  else if (suivante + recul > haut) recul = Math.floor(haut - suivante)
  recul = Math.max(0, Math.min(reculMax, recul))
  return { foyer: Math.max(0.5, Math.min(n - 0.5, suivante + recul)), recul }
}

/**
 * La loupe après un clic sur la colonne `jour` de la frise affichée (conv-1135, 2026-10-23 : « quand
 * je click sur une colonne du passé elle doit se mettre au centre et faire apparaître les plus
 * anciennes ou plus récentes ») : la FRISE glisse pour poser ce jour à la colonne du milieu, avec
 * ses voisins des deux côtés. Avant, seule la loupe bougeait : un clic sur la colonne de gauche la
 * laissait collée au bord, et il fallait remonter les jours d'avant à la molette.
 * Mêmes butées que la molette : la frise ne dépasse ni aujourd'hui (`recul` 0) ni le jour du plus
 * vieux fil (`joursEnArriere`) — en butée, le jour cliqué reste sous la loupe, simplement hors du
 * milieu. Rien n'est chargé : la frise se recalcule sur la carte déjà en mémoire.
 */
export function loupeCentreeSur(
  loupe: Loupe,
  jour: number,
  joursEnArriere: number,
  n = JOURS
): Loupe {
  const centre = Math.floor(n / 2)
  const reculMax = Math.max(0, Math.round(joursEnArriere) - (n - 1))
  const recul = Math.max(0, Math.min(reculMax, loupe.recul + centre - jour))
  return { foyer: Math.max(0.5, Math.min(n - 0.5, jour + recul - loupe.recul + 0.5)), recul }
}

export interface EtiquetteDuJour {
  texte: string
  /** `nom` : centré dans sa colonne ; `repere` : nom court posé au bord, qui peut déborder. */
  mode: 'nom' | 'repere'
  ancre: 'debut' | 'fin'
  taillePx: number
}

/** Largeur d'un caractère du feutre, en fraction de sa taille (mesure approchée de Segoe Print). */
const CHASSE = 0.56
const TAILLE_REPERE = 10

/**
 * Ce que chaque colonne écrit en tête : son nom quand il y tient (avec le mois, sinon sans) ; sinon,
 * pour un jour repère — aujourd'hui, puis les débuts de mois, puis les lundis —, son nom court posé
 * au bord, s'il ne chevauche aucune étiquette déjà posée. Sans repères, à 1 et 3 mois, seules la
 * loupe et ses voisines portaient une date : on ne savait plus où tombait le reste de la frise.
 */
export function etiquettesDesJours(
  jours: readonly JourDeLaRiviere[],
  bords: readonly number[],
  largeurPx: number
): (EtiquetteDuJour | null)[] {
  const etiquettes: (EtiquetteDuJour | null)[] = jours.map(() => null)
  const prises: [number, number][] = []
  const libre = (a: number, b: number): boolean =>
    prises.every(([c, d]) => b + 6 <= c || a >= d + 6)
  jours.forEach((jour, j) => {
    const g = bords[j] * largeurPx
    const l = bords[j + 1] * largeurPx - g
    const taillePx = Math.min(15, Math.max(10, l / 12))
    const texte = [jour.nom, jour.nomCourt].find((t) => t.length * taillePx * CHASSE <= l)
    if (!texte) return
    etiquettes[j] = { texte, mode: 'nom', ancre: 'debut', taillePx }
    prises.push([g, g + l])
  })
  for (const niveau of ['aujourdhui', 'mois', 'semaine'] as const) {
    jours.forEach((jour, j) => {
      if (etiquettes[j] || jour.repere !== niveau || !jour.texteDuRepere) return
      const w = jour.texteDuRepere.length * TAILLE_REPERE * 0.62 + 4
      const fin = j === jours.length - 1
      const a = fin ? bords[j + 1] * largeurPx - w : bords[j] * largeurPx
      if (!libre(a, a + w)) return
      etiquettes[j] = {
        texte: jour.texteDuRepere,
        mode: 'repere',
        ancre: fin ? 'fin' : 'debut',
        taillePx: TAILLE_REPERE
      }
      prises.push([a, a + w])
    })
  }
  return etiquettes
}

/** Pas vertical minimal d'une ligne de pastilles : en dessous, elles se fondraient en une barre. */
export const PAS_MIN_PASTILLE = 9

export interface EtageDispose extends EtageCalcule {
  haut: number
  hauteur: number
  /** Retrait du haut de l'étage avant sa première ligne : `o.marge`, réduit en fenêtre très basse. */
  marge: number
  /** Pas vertical des lignes de post-it, jour par jour, en pixels. */
  pas: number[]
  /** Post-it de front, jour par jour : PAR_LIGNE, sauf au jour chargé de la loupe (4 ou 5). */
  colonnes: number[]
}

interface MesureDeDisposition {
  besoins: number[]
  /** Tassement commun des demandes, puis réduction de dernier recours (fenêtre très basse). */
  f: number
  g: number
  /** Le plus petit post-it du jour de la loupe, et la somme de leurs échelles. */
  min: number
  somme: number
  colonnes: number
}

/**
 * Les nombres de post-it de front essayés au jour de la loupe. 1 et 2 depuis le 2026-10-28
 * (conv-1204, « on optimise mal l'espace ») : une case peu chargée était tenue à 3 de front, donc à
 * des post-it du tiers de la colonne, alors que la hauteur restait vide sous les étages.
 */
export const COLONNES_DE_LA_LOUPE: readonly number[] = [1, 2, 3, 4, 5]

/**
 * En deçà de cet écart, deux choix de colonnes rendent la même taille au plus petit post-it : on
 * prend alors celui qui laisse tous les post-it du jour les plus grands, puis le moins de colonnes.
 * Sans cette marge, un étage peu chargé passerait à 5 de front pour un gain invisible sur un autre.
 */
const ECART_SANS_EFFET = 0.01

export interface OptionsDeDisposition {
  debut: number
  marge: number
  sousLigne: number
  /**
   * Le pas d'un étage qui garde de la place sous ses post-it (« À vérifier » et ses boutons,
   * conv-1214), à l'échelle 1 ; les autres étages prennent `sousLigne`.
   */
  sousLigneParEtage?: Readonly<Partial<Record<string, number>>>
  vide: number
  /** Le jour de la loupe : ses cases chargées essaient COLONNES_DE_LA_LOUPE. Absent = 3 partout. */
  jourLoupe?: number
  /** Plafond des colonnes essayées (3 = la grille d'avant, pour comparer). */
  colonnesMax?: number
}

/**
 * Les étages empilés de haut en bas, tenus dans `hauteurPx` (0 = hauteur inconnue : rien n'est tassé).
 * Chaque case (étage × jour) veut le pas de SA taille de post-it (`sousLigne` à pleine taille, celui
 * d'une pastille dans une colonne serrée) ; un étage demande la hauteur de sa case la plus exigeante —
 * d'ordinaire celle de la loupe. Si la somme dépasse, toutes les demandes sont tassées du même
 * facteur, cherché par dichotomie (un étage vide garde `vide`, sa cible de dépôt), et chaque case
 * prend le pas qui lui reste. « tout doit rentrer dans l'écran en hauteur » (conv-1113) : la somme
 * ne dépasse jamais.
 *
 * Au jour de la loupe, chaque case occupée essaie de 1 à 5 de front, sans dépasser son nombre de
 * post-it (au plus 5^5 combinaisons, chacune ne coûte qu'une dichotomie) ; moins de colonnes
 * échange de la largeur contre la hauteur restée libre (conv-1204). Gagne le choix dont le plus petit post-it du jour
 * est le plus grand — jamais plus petit qu'avec 3 partout ; à égalité (ECART_SANS_EFFET), celui dont
 * les post-it du jour sont en tout les plus grands, puis celui qui a le moins de colonnes.
 */
export function disposerEtages(
  etages: readonly EtageCalcule[],
  bords: readonly number[],
  largeurPx: number,
  hauteurPx: number,
  o: OptionsDeDisposition
): EtageDispose[] {
  const n = bords.length - 1
  const largeur = (j: number): number => (bords[j + 1] - bords[j]) * largeurPx
  const echelle = (j: number, c: number): number =>
    Math.min(ECHELLE_MAX, Math.max(0.09, ajusteALaColonne(largeur(j), c)))
  /** Le pas à l'échelle 1 de l'étage `i`. */
  const sousLigne = etages.map((e) => o.sousLigneParEtage?.[e.cle] ?? o.sousLigne)
  const pasDe = (i: number, j: number, c: number): number =>
    Math.max(PAS_MIN_PASTILLE, sousLigne[i] * echelle(j, c))
  const pasDeBase = etages.map((_, i) =>
    Array.from({ length: n }, (_, j) => pasDe(i, j, PAR_LIGNE))
  )
  const jl = o.jourLoupe !== undefined && o.jourLoupe >= 0 && o.jourLoupe < n ? o.jourLoupe : -1
  // Ce que chaque étage demande HORS du jour de la loupe : ne dépend pas des colonnes essayées.
  const horsLoupe = etages.map((e, i) =>
    e.nombreParJour.reduce(
      (m, nb, j) => (j === jl ? m : Math.max(m, Math.ceil(nb / PAR_LIGNE) * pasDeBase[i][j])),
      0
    )
  )
  const fixe = o.debut + etages.length * (o.marge + 4)

  /** Le tassement et les échelles du jour de la loupe pour un choix de colonnes (une par étage). */
  const mesurer = (cs: readonly number[]): MesureDeDisposition => {
    const besoins = etages.map((e, i) =>
      jl < 0
        ? horsLoupe[i]
        : Math.max(horsLoupe[i], Math.ceil(e.nombreParJour[jl] / cs[i]) * pasDe(i, jl, cs[i]))
    )
    const tenue = (f: number): number => besoins.reduce((t, b) => t + Math.max(o.vide, b * f), 0)
    let f = 1
    if (hauteurPx > 0 && fixe + tenue(1) > hauteurPx) {
      let bas = 0
      let haut = 1
      for (let i = 0; i < 40; i += 1) {
        const m = (bas + haut) / 2
        if (fixe + tenue(m) > hauteurPx) haut = m
        else bas = m
      }
      f = bas
    }
    // Fenêtre très basse : même sans aucune ligne, marges et étages vides dépassaient (mesuré à
    // 160 px, 186 px de cadre fixe). Dernier recours, TOUT se réduit du même facteur, marges comprises.
    const total = fixe + tenue(f)
    const g = hauteurPx > 0 && total > hauteurPx ? hauteurPx / total : 1
    let min = Infinity
    let somme = 0
    if (jl >= 0)
      etages.forEach((e, i) => {
        const nb = e.nombreParJour[jl]
        if (nb === 0) return
        const lignes = Math.ceil(nb / cs[i])
        const pas = Math.min(pasDe(i, jl, cs[i]), (besoins[i] * f) / lignes) * g
        const k = Math.min(echelle(jl, cs[i]), pas / sousLigne[i])
        min = Math.min(min, k)
        somme += nb * k
      })
    return { besoins, f, g, min, somme, colonnes: cs.reduce((t, c) => t + c, 0) }
  }

  // Les choix à essayer : 3 partout d'abord (la référence), puis chaque case occupée de la loupe à
  // 1, 2, 4 ou 5 de front — jamais plus de colonnes que de post-it, une colonne vide ne sert à rien.
  const plafond = o.colonnesMax ?? COLONNES_DE_LA_LOUPE[COLONNES_DE_LA_LOUPE.length - 1]
  const options = etages.map((e) => {
    const nb = jl < 0 ? 0 : e.nombreParJour[jl]
    return [
      PAR_LIGNE,
      ...COLONNES_DE_LA_LOUPE.filter((c) => c !== PAR_LIGNE && c <= plafond && c <= nb)
    ]
  })
  let choix: number[][] = [[]]
  for (const opts of options) choix = choix.flatMap((cs) => opts.map((c) => [...cs, c]))
  const mesures = choix.map((cs) => ({ cs, m: mesurer(cs) }))
  const meilleurMin = Math.max(...mesures.map(({ m }) => m.min))
  const seuil = Math.max(mesures[0].m.min, meilleurMin - ECART_SANS_EFFET)
  const retenu = mesures
    .filter(({ m }) => m.min >= seuil - 1e-12)
    .reduce((a, b) =>
      b.m.somme > a.m.somme + 1e-9 ||
      (Math.abs(b.m.somme - a.m.somme) <= 1e-9 && b.m.colonnes < a.m.colonnes)
        ? b
        : a
    )

  const { besoins, f, g } = retenu.m
  let y = o.debut
  return etages.map((e, i) => {
    const place = besoins[i] * f
    const hauteur = o.marge + Math.max(o.vide, place) + 4
    const colonnes = Array.from({ length: n }, (_, j) => (j === jl ? retenu.cs[i] : PAR_LIGNE))
    const pas = colonnes.map((c, j) => {
      const voulu = j === jl ? pasDe(i, j, c) : pasDeBase[i][j]
      const lignes = Math.ceil(e.nombreParJour[j] / c)
      return (lignes > 0 ? Math.min(voulu, place / lignes) : voulu) * g
    })
    const dispose = { ...e, haut: y * g, hauteur: hauteur * g, marge: o.marge * g, pas, colonnes }
    y += hauteur
    return dispose
  })
}
