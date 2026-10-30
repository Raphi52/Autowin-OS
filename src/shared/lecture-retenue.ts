/**
 * LA LIGNE « LECTURE RETENUE » (conv-1123, 2026-10-23). Quand le contrôle des deux lectures laisse
 * partir le travail sur la lecture dominante, le processus principal l'annonce dans un flux de texte
 * à part (`src/main/agent-pilot.ts`). Le fil reconnaît ce flux à son nom et l'affiche atténué, sous
 * une étiquette « lecture », au lieu de le fondre dans la réponse (`chat-view-model.ts`,
 * `ChatMessageRow.tsx`) — demande de l'utilisateur : « qu'elle se repère d'un coup d'œil ».
 */
export const FLUX_LECTURE_RETENUE = 'lectures:retenue'

/** Début du texte de l'annonce (`annonceDeLaLectureRetenue`) : à l'écran, l'étiquette le remplace.
 *  « Compréhension » depuis conv-1280 (2026-10-29 : « la balise compréhension doit s'appeler
 *  compréhension par le modèle ») : le modèle lit ce mot, et le reprend s'il en parle. */
export const DEBUT_LECTURE_RETENUE = 'Compréhension : '

/** Le début écrit avant conv-1280 : les fils de cette époque le portent encore dans leur texte. */
const ANCIENS_DEBUTS = ['Lecture retenue : ']

/** Le texte affiché à côté de l'étiquette : l'annonce sans son début, déjà dit par l'étiquette. */
export function texteDeLaLectureRetenue(annonce: string): string {
  const texte = annonce.trim()
  const debut = [DEBUT_LECTURE_RETENUE, ...ANCIENS_DEBUTS]
    .map((d) => d.trim())
    .find((d) => texte.startsWith(d))
  return debut ? texte.slice(debut.length).trim() : texte
}

/**
 * Ce que le fil affiche à côté de la pastille : la phrase comprise, guillemets compris, et rien
 * d'autre (conv-1280, 2026-10-29 : « si tu voulais plutôt, c'est nul, mets juste ce qu'il a compris,
 * point »). Les lignes des anciens fils portent encore l'autre lecture après la phrase : elle est
 * coupée ici. Un texte sans guillemets en tête est rendu entier.
 */
export function ceQuiAEteCompris(annonce: string): string {
  const texte = texteDeLaLectureRetenue(annonce)
  return /^«[^»]*»/.exec(texte)?.[0] ?? texte
}
