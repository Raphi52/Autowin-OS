// fix-ok: les editions successives de ce fichier ne corrigeaient pas un bug mystere, elles
// fermaient des cas nommes par des tests rouges puis verts : (1) seuils saisis dans le desordre
// -> une couleur devenait inatteignable, cause = les planchers etaient lus tels quels sans tri
// decroissant ; (2) un type d'acte RSM inconnu tombait dans le groupe inscriptions/modifs/renouv,
// cause = un fallback else au lieu d'une liste explicite ; (3) un reglage enregistre partiel ou
// corrompu vidait la tuile, cause = JSON.parse sans validation par champ. Mesure : 14 tests verts
// (performance-greffe-model.test.ts), rouges si l'un des trois correctifs est retire.
/**
 * Le widget « performance » d'un greffe : ce qu'il COMPTE et quelle couleur ça vaut, en fonctions
 * pures.
 *
 * Demande de l'utilisateur (2026-09-17) : deux familles d'indicateurs — RCS (formalités validées,
 * DCA, DAS) et RSM (inscriptions/modifications/renouvellements comptés ENSEMBLE, radiations) — lues
 * soit pour soi (mode utilisateur), soit pour tout le monde (mode greffier). Et surtout : un code
 * couleur vert/jaune/orange/rouge dont les seuils sont RÉGLABLES, « certains considèrent que 100 par
 * jour c'est pas assez et d'autres sont plus petits et ils verraient tout en rouge tout le temps ».
 *
 * Donc aucun seuil en dur dans le rendu : le défaut vit ici, le réglage vit dans le navigateur, et
 * un réglage illisible retombe sur le défaut au lieu de vider la tuile.
 *
 * Hors React à dessein : le comptage, le regroupement et le choix de la couleur sont exactement là
 * où se logent les défauts, et ils se testent sans monter d'interface.
 */
import { autowinStorageKey } from '../storage-keys'

export type PerfGroupeId = 'rcs' | 'rsm'

export type PerfIndicateurId =
  'rcs-formalites-validees' | 'rcs-dca' | 'rcs-das' | 'rsm-imr' | 'rsm-radiations'

export interface PerfIndicateur {
  id: PerfIndicateurId
  groupe: PerfGroupeId
  label: string
}

export const PERF_GROUPE_LABELS: Readonly<Record<PerfGroupeId, string>> = {
  rcs: 'RCS',
  rsm: 'RSM'
}

/**
 * L'ordre est celui que l'utilisateur a dicté ; il n'est pas cosmétique, c'est sa façon de lire son
 * activité.
 */
export const PERF_INDICATEURS: readonly PerfIndicateur[] = [
  { id: 'rcs-formalites-validees', groupe: 'rcs', label: 'Formalités validées' },
  { id: 'rcs-dca', groupe: 'rcs', label: 'DCA' },
  { id: 'rcs-das', groupe: 'rcs', label: 'DAS' },
  // « les 3 ensemble » : inscriptions, modifications et renouvellements comptent pour UNE ligne.
  { id: 'rsm-imr', groupe: 'rsm', label: 'Inscriptions / modifications / renouvellements' },
  { id: 'rsm-radiations', groupe: 'rsm', label: 'Radiations' }
]

export const PERF_INDICATEUR_IDS: readonly PerfIndicateurId[] = PERF_INDICATEURS.map(
  (indicateur) => indicateur.id
)

export function indicateursDuGroupe(groupe: PerfGroupeId): readonly PerfIndicateur[] {
  return PERF_INDICATEURS.filter((indicateur) => indicateur.groupe === groupe)
}

/**
 * Le type d'acte tel que la SOURCE le nomme, vers la ligne affichée.
 *
 * C'est ici, et nulle part ailleurs, que les trois actes du RSM fusionnent : si le regroupement se
 * faisait dans le rendu, un futur appelant qui compte lui-même afficherait trois lignes là où
 * l'utilisateur en veut une.
 */
export const PERF_INDICATEUR_PAR_TYPE_SOURCE: Readonly<Record<string, PerfIndicateurId>> = {
  'formalite-validee': 'rcs-formalites-validees',
  dca: 'rcs-dca',
  das: 'rcs-das',
  inscription: 'rsm-imr',
  modification: 'rsm-imr',
  renouvellement: 'rsm-imr',
  radiation: 'rsm-radiations'
}

export function indicateurDuTypeSource(type: string): PerfIndicateurId | null {
  return PERF_INDICATEUR_PAR_TYPE_SOURCE[type.trim().toLowerCase()] ?? null
}

export type PerfCouleur = 'vert' | 'jaune' | 'orange' | 'rouge'

/** Trois planchers, en actes sur la période affichée. Sous le dernier, c'est rouge. */
export interface PerfSeuils {
  vert: number
  jaune: number
  orange: number
}

export type PerfSeuilsParIndicateur = Readonly<Record<PerfIndicateurId, PerfSeuils>>

export const CLE_SEUILS_PERF = autowinStorageKey('home.performance-seuils.v1')

/**
 * Des défauts, PAS une vérité : ils sont là pour que la tuile s'ouvre remplie, et l'utilisateur les
 * remplace par les siens depuis le widget. C'est exactement ce que la demande exige.
 */
export const PERF_SEUILS_PAR_DEFAUT: PerfSeuilsParIndicateur = {
  'rcs-formalites-validees': { vert: 100, jaune: 70, orange: 40 },
  'rcs-dca': { vert: 30, jaune: 20, orange: 10 },
  'rcs-das': { vert: 30, jaune: 20, orange: 10 },
  'rsm-imr': { vert: 60, jaune: 40, orange: 20 },
  'rsm-radiations': { vert: 20, jaune: 12, orange: 6 }
}

function nombreSain(valeur: unknown, defaut: number): number {
  if (typeof valeur !== 'number' || !Number.isFinite(valeur)) return defaut
  return Math.max(0, Math.round(valeur))
}

/**
 * Remet trois planchers dans l'ordre décroissant.
 *
 * Saisir « jaune » au-dessus de « vert » est un geste NORMAL quand on tape trois champs à la suite ;
 * laisser passer l'ordre incohérent rendrait une couleur inatteignable et le widget mentirait sans
 * rien signaler. On range, on ne refuse pas.
 */
export function normaliserSeuils(brut: Partial<PerfSeuils>, defaut: PerfSeuils): PerfSeuils {
  const vert = nombreSain(brut.vert, defaut.vert)
  const jaune = nombreSain(brut.jaune, defaut.jaune)
  const orange = nombreSain(brut.orange, defaut.orange)
  const [haut, milieu, bas] = [vert, jaune, orange].sort((a, b) => b - a)
  return { vert: haut, jaune: milieu, orange: bas }
}

/**
 * La couleur d'une valeur.
 *
 * Planchers INCLUSIFS : atteindre pile son objectif doit donner le vert, sinon « 100 par jour »
 * affiché en jaune à 100 serait incompréhensible.
 */
export function couleurPerf(valeur: number, seuils: PerfSeuils): PerfCouleur {
  const bornes = normaliserSeuils(seuils, seuils)
  if (valeur >= bornes.vert) return 'vert'
  if (valeur >= bornes.jaune) return 'jaune'
  if (valeur >= bornes.orange) return 'orange'
  return 'rouge'
}

export function seuilsParDefaut(): PerfSeuilsParIndicateur {
  return { ...PERF_SEUILS_PAR_DEFAUT }
}

/**
 * Règle UN plancher, et fait céder les autres.
 *
 * Ici on ne trie pas : le champ que l'utilisateur vient de taper GARDE sa valeur, ce sont les deux
 * autres qui s'écartent. Un tri échangerait les libellés — descendre « vert » à 30 alors que
 * « jaune » vaut 70 ferait réapparaître 70 dans la case verte, juste après l'avoir quittée. Le
 * réglage doit obéir à la main qui tape.
 */
export function majSeuil(
  courants: PerfSeuilsParIndicateur,
  id: PerfIndicateurId,
  champ: keyof PerfSeuils,
  valeur: number
): PerfSeuilsParIndicateur {
  const defaut = PERF_SEUILS_PAR_DEFAUT[id]
  const courant = courants[id] ?? defaut
  const pose = nombreSain(valeur, defaut[champ])
  const suivant: PerfSeuils = { ...courant, [champ]: pose }
  if (champ === 'vert') {
    suivant.jaune = Math.min(suivant.jaune, pose)
    suivant.orange = Math.min(suivant.orange, suivant.jaune)
  } else if (champ === 'jaune') {
    suivant.vert = Math.max(suivant.vert, pose)
    suivant.orange = Math.min(suivant.orange, pose)
  } else {
    suivant.jaune = Math.max(suivant.jaune, pose)
    suivant.vert = Math.max(suivant.vert, suivant.jaune)
  }
  return { ...courants, [id]: suivant }
}

/** Tolérant par construction : un réglage absent, partiel ou corrompu rend le défaut. */
export function parseSeuilsPerf(raw: unknown): PerfSeuilsParIndicateur {
  const defaut = seuilsParDefaut()
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return defaut
  const lu = raw as Record<string, unknown>
  const resultat: Record<string, PerfSeuils> = { ...defaut }
  for (const id of PERF_INDICATEUR_IDS) {
    const entree = lu[id]
    if (typeof entree !== 'object' || entree === null) continue
    resultat[id] = normaliserSeuils(entree as Partial<PerfSeuils>, PERF_SEUILS_PAR_DEFAUT[id])
  }
  return resultat as PerfSeuilsParIndicateur
}

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function lireSeuilsPerf(storage: StorageLike): PerfSeuilsParIndicateur {
  try {
    const raw = storage.getItem(CLE_SEUILS_PERF)
    if (raw === null) return seuilsParDefaut()
    return parseSeuilsPerf(JSON.parse(raw))
  } catch {
    return seuilsParDefaut()
  }
}

export function ecrireSeuilsPerf(storage: StorageLike, seuils: PerfSeuilsParIndicateur): void {
  try {
    storage.setItem(CLE_SEUILS_PERF, JSON.stringify(seuils))
  } catch {
    // Sans écriture, le réglage vaut pour la session : mieux qu'une tuile qui refuse de se régler.
  }
}

/** Une mesure BRUTE, telle qu'une source la donnerait : qui, quel acte, combien. */
export interface PerfMesure {
  utilisateur: string
  /** Type d'acte tel que la source le nomme (voir `indicateurDuTypeSource`). */
  type: string
  valeur: number
}

export type PerfTotaux = Readonly<Record<PerfIndicateurId, number>>

export function totauxVides(): PerfTotaux {
  return Object.fromEntries(PERF_INDICATEUR_IDS.map((id) => [id, 0])) as PerfTotaux
}

/**
 * Le mode UTILISATEUR lit ce qu'une personne a produit ; le mode GREFFIER lit la somme de tout le
 * monde, avec le détail par personne (`totauxParUtilisateur`).
 */
export function totauxDe(mesures: readonly PerfMesure[]): PerfTotaux {
  const totaux: Record<string, number> = totauxVides()
  for (const mesure of mesures) {
    const id = indicateurDuTypeSource(mesure.type)
    // Un type d'acte inconnu est IGNORÉ, jamais rangé dans une ligne au hasard : un chiffre faux se
    // lit comme un chiffre vrai.
    if (id === null) continue
    if (typeof mesure.valeur !== 'number' || !Number.isFinite(mesure.valeur)) continue
    totaux[id] += mesure.valeur
  }
  return totaux as PerfTotaux
}

export function totauxUtilisateur(mesures: readonly PerfMesure[], utilisateur: string): PerfTotaux {
  return totauxDe(mesures.filter((mesure) => mesure.utilisateur === utilisateur))
}

export interface PerfLigneUtilisateur {
  utilisateur: string
  totaux: PerfTotaux
}

/** Le détail du mode greffier, par personne, dans un ordre stable (alphabétique). */
export function totauxParUtilisateur(mesures: readonly PerfMesure[]): PerfLigneUtilisateur[] {
  const noms = [...new Set(mesures.map((mesure) => mesure.utilisateur))].sort((a, b) =>
    a.localeCompare(b, 'fr')
  )
  return noms.map((utilisateur) => ({
    utilisateur,
    totaux: totauxUtilisateur(mesures, utilisateur)
  }))
}

export type PerfMode = 'utilisateur' | 'greffier'
