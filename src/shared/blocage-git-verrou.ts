/**
 * UN VERROU TENU N'EST PAS UNE FUSION REFUSÉE.
 *
 * Mesure du 2026-09-06, trois runs lancés en parallèle sur le même dépôt : un publie, deux
 * échouent. Le motif affiché disait `merge-failed` — « la fusion dans la base a été refusée » —
 * alors qu'aucune fusion n'avait eu lieu. Ce que git disait vraiment :
 *
 *   fatal: Unable to create '.../.git/index.lock': File exists.
 *   Another git process seems to be running in this repository
 *   fatal: update_ref failed for ref 'ORIG_HEAD': cannot lock ref 'ORIG_HEAD'
 *
 * Deux publications simultanées, et git ne tolère qu'une opération d'index à la fois. Le motif
 * envoyait donc chercher un conflit de contenu qui n'existait pas — le défaut que ce dépôt se
 * reproche déjà ailleurs : « un gate qui nomme une cause qu'il n'a pas vérifiée envoie chercher au
 * mauvais endroit ».
 *
 * LE BON MOTIF EXISTE DÉJÀ et n'avait pas besoin d'être inventé : `base-in-progress` — « une
 * opération git est en cours dans ton arbre principal », dont l'action conseillée est « laisse-la
 * se terminer — aucun geste de plus ». C'est exactement la vérité, et exactement le bon conseil :
 * republier à la main, comme le suggère `merge-failed`, ne réglerait rien tant que l'autre
 * publication tient le verrou.
 */

/** Les empreintes d'un verrou git tenu, telles que git les écrit lui-même. */
const SIGNES_DE_VERROU = [
  // Le plus fréquent : deux `git add`/`git commit` simultanés sur le même dépôt.
  /\.lock'?: File exists/i,
  /Unable to create '[^']*\.lock'/i,
  // Le message que git donne quand il refuse par prudence, sans nommer le fichier.
  /Another git process seems to be running/i,
  // Les références : ORIG_HEAD, HEAD, une branche — même cause, autre verrou.
  /cannot lock ref/i,
  /update_ref failed for ref/i,
  /*
   * LE CROCHET DE TRANSACTION DE REFERENCES — troisieme visage du meme probleme, rencontre au
   * troisieme passage de la sonde. Git refuse une mise a jour de reference pendant qu'une autre
   * transaction est ouverte : « update aborted by the reference-transaction hook ». Encore une
   * publication concurrente, encore pas une fusion refusee.
   */
  /aborted by the reference-transaction hook/i
]

/**
 * Rend `true` quand l'échec vient d'un VERROU tenu par une autre opération git, et non d'un refus
 * de fusion. Sur une chaîne vide ou un autre message, rend `false` : dans le doute, on ne
 * requalifie rien — un motif inventé serait aussi trompeur que celui qu'on corrige.
 */
export function estVerrouGitTenu(message: string | undefined): boolean {
  if (!message) return false
  return SIGNES_DE_VERROU.some((signe) => signe.test(message))
}

/**
 * Le motif à afficher pour un échec de publication, d'après ce que git a RÉELLEMENT dit.
 *
 * `merge-failed` reste le défaut : il couvre tout ce qu'on n'a pas su qualifier, et il vaut mieux
 * un motif générique qu'un motif faux.
 */
export function motifDeBlocagePublication(
  message: string | undefined
): 'base-in-progress' | 'merge-failed' {
  return estVerrouGitTenu(message) ? 'base-in-progress' : 'merge-failed'
}
