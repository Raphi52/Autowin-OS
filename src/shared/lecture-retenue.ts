/**
 * LA LIGNE « LECTURE RETENUE » (conv-1123, 2026-10-23). Quand le contrôle des deux lectures laisse
 * partir le travail sur la lecture dominante, le processus principal l'annonce dans un flux de texte
 * à part (`src/main/agent-pilot.ts`). Le fil reconnaît ce flux à son nom et l'affiche atténué, sous
 * une étiquette « lecture », au lieu de le fondre dans la réponse (`chat-view-model.ts`,
 * `ChatMessageRow.tsx`) — demande de l'utilisateur : « qu'elle se repère d'un coup d'œil ».
 */
export const FLUX_LECTURE_RETENUE = 'lectures:retenue'

/** Début du texte de l'annonce (`annonceDeLaLectureRetenue`) : à l'écran, l'étiquette le remplace. */
export const DEBUT_LECTURE_RETENUE = 'Lecture retenue : '

/** Le texte affiché à côté de l'étiquette : l'annonce sans son début, déjà dit par l'étiquette. */
export function texteDeLaLectureRetenue(annonce: string): string {
  const texte = annonce.trim()
  return texte.startsWith(DEBUT_LECTURE_RETENUE.trim())
    ? texte.slice(DEBUT_LECTURE_RETENUE.trim().length).trim()
    : texte
}
