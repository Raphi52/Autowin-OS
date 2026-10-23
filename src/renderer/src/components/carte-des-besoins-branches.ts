/**
 * LA FICHE DE LA CARTE DES BESOINS — le calcul PUR de ses branches (/draft conv-1102, 2026-10-22).
 *
 * Demande : « Implémente la Fiche avec un menu « Branches » qui propose état, semaine et dernier
 * constat, semaine par défaut, dans la vue Besoins. » La Fiche montre UN dépôt (un projet de la
 * carte) comme une étoile : au centre ses fils, autour ses branches, et à côté la fiche d'un fil.
 *
 * Aucune donnée neuve : tout part des demandes que la carte calcule déjà (`demandesDuFil`). L'unité
 * de la Fiche est le FIL, pas la demande : un fil compte « avec une preuve » dès qu'UNE de ses
 * demandes est prouvée (règle annoncée sur les maquettes du /draft).
 *
 * Hors du fichier de composant : un module de composants qui exporte aussi des fonctions casse le
 * rafraîchissement à chaud (même raison que `carte-des-besoins-libelles.ts`).
 */
import type { DemandeDeLaCarte, StatutDemande } from '../../../shared/carte-des-besoins'

export type Rangement = 'semaine' | 'etat' | 'constat'

/** L'ordre du menu « Branches » ; la semaine d'abord, c'est le rangement par défaut. */
export const RANGEMENTS: readonly { cle: Rangement; libelle: string }[] = [
  { cle: 'semaine', libelle: 'semaine' },
  { cle: 'etat', libelle: 'état' },
  { cle: 'constat', libelle: 'dernier constat' }
]

export const RANGEMENT_PAR_DEFAUT: Rangement = 'semaine'

/** Au-delà, les semaines les plus anciennes se regroupent en une dent « avant » : le peigne reste lisible. */
export const MAX_SEMAINES = 8

export type EtatDuFil = StatutDemande

export interface FilDeLaCarte {
  conversationId: string
  titre: string
  /** Ses demandes dans l'ordre du fil (rang croissant). */
  demandes: DemandeDeLaCarte[]
  comptes: Record<StatutDemande, number>
  etat: EtatDuFil
  /** L'heure de sa demande la plus récente ; absente si aucune n'est datée. */
  derniereActivite?: number
  /** Sa dernière demande : c'est elle qui range le fil par « dernier constat ». */
  derniere: DemandeDeLaCarte
}

export interface BrancheDeLaCarte {
  cle: string
  libelle: string
  /** Les fils de la branche, le plus récent d'abord. */
  fils: FilDeLaCarte[]
  /** Le nombre de fils par état, pour la jauge de la branche. */
  comptes: Record<EtatDuFil, number>
}

function comptesVides(): Record<StatutDemande, number> {
  return { prouve: 0, refuse: 0, 'en-cours': 0, 'sans-preuve': 0 }
}

function etatDe(comptes: Record<StatutDemande, number>): EtatDuFil {
  if (comptes.prouve > 0) return 'prouve'
  if (comptes.refuse > 0) return 'refuse'
  if (comptes['en-cours'] > 0) return 'en-cours'
  return 'sans-preuve'
}

const parRecence = (a: FilDeLaCarte, b: FilDeLaCarte): number =>
  (b.derniereActivite ?? Number.NEGATIVE_INFINITY) -
  (a.derniereActivite ?? Number.NEGATIVE_INFINITY)

/** Les fils d'un projet, le plus récemment actif d'abord. */
export function filsDuProjet(demandes: readonly DemandeDeLaCarte[]): FilDeLaCarte[] {
  const parFil = new Map<string, DemandeDeLaCarte[]>()
  for (const demande of demandes) {
    const liste = parFil.get(demande.conversationId)
    if (liste) liste.push(demande)
    else parFil.set(demande.conversationId, [demande])
  }
  const fils: FilDeLaCarte[] = []
  for (const [conversationId, liste] of parFil) {
    const ordonnees = [...liste].sort((a, b) => a.rang - b.rang)
    const comptes = comptesVides()
    let derniereActivite: number | undefined
    for (const d of ordonnees) {
      comptes[d.statut] += 1
      if (d.debut !== undefined && (derniereActivite === undefined || d.debut > derniereActivite))
        derniereActivite = d.debut
    }
    const derniere = ordonnees[ordonnees.length - 1]
    fils.push({
      conversationId,
      titre: derniere.conversationTitre || conversationId,
      demandes: ordonnees,
      comptes,
      etat: etatDe(comptes),
      ...(derniereActivite === undefined ? {} : { derniereActivite }),
      derniere
    })
  }
  return fils.sort(parRecence)
}

export type FamilleDeConstat =
  | 'sans-verification'
  | 'arret'
  | 'bloque'
  | 'attente'
  | 'typecheck'
  | 'tests'
  | 'run'
  | 'autre-preuve'

/** L'ordre des branches « dernier constat » autour de l'étoile, et leur libellé. */
export const FAMILLES_DE_CONSTAT: readonly { cle: FamilleDeConstat; libelle: string }[] = [
  { cle: 'sans-verification', libelle: 'sans vérification' },
  { cle: 'arret', libelle: 'arrêté / échec' },
  { cle: 'bloque', libelle: 'bloqué / non résolu' },
  { cle: 'attente', libelle: 'en cours / question' },
  { cle: 'typecheck', libelle: 'typecheck' },
  { cle: 'tests', libelle: 'tests' },
  { cle: 'run', libelle: 'run réussi' },
  { cle: 'autre-preuve', libelle: 'autre vérification' }
]

/**
 * La famille d'un constat, lue sur les MÊMES textes que la carte du fil (`statutDuSegment`) : une
 * vérification s'écrit « commande → exit N » (`verifyOutcomeSummary`, tests du terminal), une
 * orchestration réussie porte son seul statut (« succeeded », « terminé »), un blocage déclaré
 * commence par ⛔ ou ⚠️.
 */
export function classerConstat(
  demande: Pick<DemandeDeLaCarte, 'statut' | 'constat'>
): FamilleDeConstat {
  const { statut, constat } = demande
  if (statut === 'en-cours' || constat === 'une question t’attend') return 'attente'
  if (statut === 'prouve') {
    if (!constat.includes('→ exit')) return 'run'
    if (/typecheck|\btsc\b/iu.test(constat)) return 'typecheck'
    if (/\btests?\b|vitest|jest|pytest|playwright|mocha/iu.test(constat)) return 'tests'
    return 'autre-preuve'
  }
  if (statut === 'refuse') return /⛔|⚠️|Bloqué|Non résolu/u.test(constat) ? 'bloque' : 'arret'
  return 'sans-verification'
}

const LIBELLES_ETAT: Record<EtatDuFil, string> = {
  prouve: 'prouvé',
  refuse: 'refusé',
  'en-cours': 'en cours',
  'sans-preuve': 'sans preuve'
}
const ORDRE_ETATS: readonly EtatDuFil[] = ['prouve', 'refuse', 'en-cours', 'sans-preuve']

function branche(cle: string, libelle: string, fils: FilDeLaCarte[]): BrancheDeLaCarte {
  const comptes = comptesVides()
  for (const fil of fils) comptes[fil.etat] += 1
  return { cle, libelle, fils: [...fils].sort(parRecence), comptes }
}

/** Le lundi (heure locale, minuit) de la semaine d'un instant. */
function lundiDe(instant: number): Date {
  const date = new Date(instant)
  const decalage = (date.getDay() + 6) % 7
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - decalage)
}

const jourMois = (date: Date): string =>
  `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`

function branchesParSemaine(fils: readonly FilDeLaCarte[]): BrancheDeLaCarte[] {
  const datés = fils.filter((f) => f.derniereActivite !== undefined)
  const sansDate = fils.filter((f) => f.derniereActivite === undefined)
  const branches: BrancheDeLaCarte[] = []
  if (datés.length > 0) {
    const parLundi = new Map<number, FilDeLaCarte[]>()
    for (const fil of datés) {
      const cle = lundiDe(fil.derniereActivite!).getTime()
      const liste = parLundi.get(cle)
      if (liste) liste.push(fil)
      else parLundi.set(cle, [fil])
    }
    const lundis = [...parLundi.keys()]
    const premier = new Date(Math.min(...lundis))
    const dernier = Math.max(...lundis)
    // Semaine après semaine, trous compris : une semaine sans activité est un fait, pas un oubli.
    const semaines: Date[] = []
    for (
      let d = premier;
      d.getTime() <= dernier;
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7)
    )
      semaines.push(d)
    const gardees = semaines.slice(-MAX_SEMAINES)
    const anciennes = semaines.slice(0, -MAX_SEMAINES)
    if (anciennes.length > 0)
      branches.push(
        branche(
          'avant',
          'avant',
          anciennes.flatMap((d) => parLundi.get(d.getTime()) ?? [])
        )
      )
    for (const d of gardees)
      branches.push(branche(`semaine-${d.getTime()}`, jourMois(d), parLundi.get(d.getTime()) ?? []))
  }
  if (sansDate.length > 0) branches.push(branche('sans-date', 'sans date', sansDate))
  return branches
}

/** Les branches d'un rangement ; « état » et « dernier constat » ne gardent que les branches peuplées. */
export function branchesDe(
  fils: readonly FilDeLaCarte[],
  rangement: Rangement
): BrancheDeLaCarte[] {
  if (rangement === 'semaine') return branchesParSemaine(fils)
  if (rangement === 'etat')
    return ORDRE_ETATS.map((etat) =>
      branche(
        etat,
        LIBELLES_ETAT[etat],
        fils.filter((f) => f.etat === etat)
      )
    ).filter((b) => b.fils.length > 0)
  const parFamille = new Map<FamilleDeConstat, FilDeLaCarte[]>()
  for (const fil of fils) {
    const famille = classerConstat(fil.derniere)
    const liste = parFamille.get(famille)
    if (liste) liste.push(fil)
    else parFamille.set(famille, [fil])
  }
  return FAMILLES_DE_CONSTAT.filter((f) => parFamille.has(f.cle)).map((f) =>
    branche(f.cle, f.libelle, parFamille.get(f.cle)!)
  )
}

/** La branche où tombe un fil (le cercle or de la carte). */
export function brancheDuFil(
  branches: readonly BrancheDeLaCarte[],
  conversationId: string
): string | undefined {
  return branches.find((b) => b.fils.some((f) => f.conversationId === conversationId))?.cle
}
