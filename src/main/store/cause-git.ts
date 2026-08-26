/**
 * QUELLE LIGNE DE GIT PORTE LA CAUSE.
 *
 * Défaut vécu le 2026-08-26 : un `edit_file` rapportait « merge-failed — Preparing worktree
 * (detached HEAD a5c46b36) ». Cette ligne n'est pas une erreur, c'est la PROGRESSION de
 * `git worktree add`. Mesuré le même jour sur un dépôt temporaire, un `add` qui échoue (exit 128)
 * écrit sur stderr la progression PUIS `fatal: '<chemin>' already exists`. Le code gardait le tout
 * et l'affichage, borné à une ligne, ne montrait que la première : la seule information utile était
 * juste en dessous, coupée.
 *
 * Deux règles, et la seconde compte autant que la première :
 *   1. une ligne qui se DÉCLARE cause (`fatal:` / `error:`) passe devant tout le reste — la dernière,
 *      car git termine par la raison décisive et empile le contexte avant ;
 *   2. si AUCUNE ligne ne se déclare, on rend le texte INTACT. Filtrer sur un préfixe rendrait muet
 *      tout échec qui n'emploie pas le vocabulaire attendu — l'erreur classique des gardes trop
 *      sûres d'elles.
 *
 * `causeGit` est un réducteur d'AFFICHAGE : il JETTE des lignes. Ne jamais y chercher un marqueur
 * de contrôle. Mesuré le 2026-08-26 : brancher `causeGit` sur les deux sites qui testaient
 * `AUTOWIN_GUARD:` a fait rougir 4 tests — quand git émettait AUSSI un `fatal:`, la ligne sentinelle
 * du hook disparaissait, et un refus TEMPORAIRE (`base-in-progress`, réessayable) se rapportait en
 * refus DÉFINITIF (`merge-failed`). Pour décider, lire `sortieGit` ; pour montrer, `causeGit`.
 */

/** La sortie de git, INTACTE (stderr sinon stdout). À lire dès qu'on cherche un marqueur. */
export function sortieGit(res: { stdout?: string; stderr?: string }): string {
  return ((res.stderr ?? '').trim() || (res.stdout ?? '').trim()).trim()
}

export function causeGit(res: { stdout?: string; stderr?: string }): string {
  const brut = sortieGit(res)
  if (!brut) return ''
  const causes = brut
    .split(/\r?\n/)
    .map((ligne) => ligne.trim())
    .filter((ligne) => /^(?:fatal|error)\s*:/iu.test(ligne))
  return causes.length > 0 ? causes[causes.length - 1] : brut
}
