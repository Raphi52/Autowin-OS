/**
 * LES TÂCHES DE FOND QU'AUTOWIN A RELANCÉES HORS DU TOUR — registre du processus principal.
 *
 * Écrit par `chat/relance-taches-de-fond.ts` (relance et reprise au démarrage), lu par
 * `providers/claude.ts` (avis de fin de tour) et par `commands.ts` (état poussé au modèle).
 *
 * POURQUOI IL EXISTE — conv-253, mesuré le 2026-10-11 :
 * - tour `dcb537d2-ed5a-4646-806d-880ef76df295` (« reprend ») : le modèle lance en fond une
 *   surveillance du run de construction (tâche CLI `bmaye5d39`). Le CLI la coupe en fin de tour ;
 *   Autowin la relance (lot `6cb0f6b4-…`, bash 24564 encore vivant 35 min plus tard) et l'annonce :
 *   « 🔁 Tâche de fond reprise par Autowin hors de ce tour ».
 * - tour `bdfe38d3-5ba5-4693-bad2-f70b39bc845e` (« ? ») : à la reprise de session, le CLI signale
 *   `bmaye5d39` « stopped » (« didn't finish before the previous session ended »,
 *   `run-stdout/354008f8-….stdout.jsonl` l.1). `claude.ts` ne savait pas qu'Autowin la suivait :
 *   il a affiché « son résultat est perdu » — faux —, et le modèle, qui croyait sa surveillance
 *   morte, en a lancé une SECONDE (tâche `biiy5js9b`, lot `2449bdc5-…`). Deux tours de reprise
 *   automatique étaient alors programmés pour la même fin de run.
 *
 * Le lien entre les deux tours est l'identifiant de tâche du CLI : c'est le même dans la
 * notification de reprise et dans le lot relancé.
 */

export interface TacheDeFondSuivie {
  conversationId: string
  /** `task_id` du CLI. */
  tache: string
  commande: string
  /** Horodatage (ms) du lancement par Autowin. */
  depuis: number
}

/** Relancées par Autowin et pas encore rendues par un tour de reprise. */
const enCours = new Map<string, TacheDeFondSuivie>()
/**
 * Toutes celles relancées depuis le démarrage, rendues ou non. Une tâche déjà rendue par son tour
 * de reprise n'est pas « perdue » non plus : son résultat est arrivé dans le fil.
 */
const relancees = new Set<string>()

export function noterTacheRelancee(tache: TacheDeFondSuivie): void {
  if (!tache.tache) return
  enCours.set(tache.tache, tache)
  relancees.add(tache.tache)
}

/** Le tour de reprise est parti : la tâche n'est plus « en cours », elle reste « relancée ». */
export function noterTacheRendue(tache: string): void {
  enCours.delete(tache)
}

export function tacheRelanceeParAutowin(tache: string): boolean {
  return relancees.has(tache)
}

/** Ce qu'Autowin surveille encore, du plus ancien au plus récent. */
export function tachesDeFondEnCours(): TacheDeFondSuivie[] {
  return [...enCours.values()].sort((a, b) => a.depuis - b.depuis)
}

/** Réservé aux tests. */
export function viderTachesDeFondSuivies(): void {
  enCours.clear()
  relancees.clear()
}
