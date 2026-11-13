/**
 * LA MENTION QUI SIGNE UN ENVOI DU MODE AUTO, lue des deux côtés.
 *
 * L'écran l'écrit (`ancrerSurLaDemande`, chat-auto-mode.ts) et la relit pour compter les tours
 * automatiques ; le processus principal la lit pour ne pas poser à l'utilisateur la question
 * « deux lectures » sur un texte que l'agent a écrit lui-même (lectures-du-tour.ts). Une seule
 * expression, pour que les deux côtés ne divergent pas.
 *
 * L'ancienne formule (« tâche initiale de ce fil », avant le 2026-09-30) reste lue : elle vit dans
 * les fils déjà écrits. Le groupe 1 rend la demande citée.
 */
export const ANCRE_DU_MODE_AUTO =
  /\(Mode auto — (?:tâche initiale de ce fil|dernière demande de l'utilisateur) : « ([\s\S]*?) »\./

/** Ce message a-t-il été écrit par l'agent et envoyé seul par le mode auto ? */
export function estUnEnvoiDuModeAuto(texte: string | undefined): boolean {
  return texte !== undefined && ANCRE_DU_MODE_AUTO.test(texte)
}
