/**
 * UNE DEMANDE QUI VIENT D'UNE SÉLECTION DE CANDIDATS SCOUT — reconnue à son en-tête.
 *
 * L'en-tête est écrit par le panneau des candidats (`redigerPromptWorkflowSelection` et
 * `redigerPromptCorrectionDirecte`, src/renderer/src/components/veille-candidats-message.ts). Deux
 * lecteurs côté processus principal en dépendent : la mémoire du scout, qui note les pistes prises
 * (`scout-memoire.ts`), et le choix des étapes du run, qui ne rejoue pas un scout déjà fait
 * (`task-regime.ts`, `selection-sans-scout.ts`). Source unique depuis le 2026-10-22 (conv-1080).
 *
 * Le « T » est facultatif : la demande de conv-890 est arrivée en « raite ENSEMBLE… », collée sans
 * sa première lettre. Le `/build` facultatif est la correction DIRECTE : le routeur le recolle
 * devant l'en-tête (« /build Traite ce candidat… »).
 */
export const ENTETE_SELECTION_SCOUT =
  /(?:^|\n)\s*(?:\/build\s+)?(?:t[âa]che\s*:\s*)?t?raite\s+(?:ensemble\s+ces\s+\d+\s+candidats|ce\s+candidat)\s+issus?\s+du\s+scout/iu

/** Vrai si la demande est une sélection de candidats envoyée depuis le panneau d'un scout. */
export function estSelectionDeScout(texte: string | undefined): boolean {
  return ENTETE_SELECTION_SCOUT.test(texte ?? '')
}
