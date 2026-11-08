/** Ce qu'une erreur dit d'elle-même : le message d'une `Error`, sinon la valeur mise en texte. */
export function raisonDeLErreur(erreur: unknown): string {
  return erreur instanceof Error ? erreur.message : String(erreur)
}
