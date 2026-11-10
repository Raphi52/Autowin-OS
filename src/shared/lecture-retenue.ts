/**
 * LA LIGNE « LECTURE RETENUE » (2026-10-23). Quand le contrôle des deux lectures laisse
 * partir le travail sur la lecture dominante, le processus principal l'annonce dans un flux de texte
 * à part (`src/main/agent-pilot/agent-pilot.ts`). Le fil reconnaît ce flux à son nom et l'affiche atténué, sous
 * une étiquette « lecture », au lieu de le fondre dans la réponse (`chat-view-model.ts`,
 * `ChatMessageRow.tsx`) — demande de l'utilisateur : « qu'elle se repère d'un coup d'œil ».
 */
export const FLUX_LECTURE_RETENUE = 'lectures:retenue'

/** Début du texte de l'annonce (`annonceDeLaLectureRetenue`) : à l'écran, l'étiquette le remplace.
 *  « Compréhension » depuis le 2026-10-29 (« la balise compréhension doit s'appeler
 *  compréhension par le modèle ») : le modèle lit ce mot, et le reprend s'il en parle. */
export const DEBUT_LECTURE_RETENUE = 'Compréhension : '

/** Début de la précision ajoutée à la TÂCHE d'un travail (`tacheAvecLectureRetenue`,
 *  `src/main/chat/deux-lectures.ts`). Partagé pour que le nom du dossier du travail (`slugify`,
 *  `src/main/runs/conv-runs.ts`) l'ignore : ces mots ne disent rien du sujet. */
export const DEBUT_PRECISION_DE_TACHE = "Compréhension de la demande, annoncée à l'utilisateur : "

/**
 * La tâche SANS cette précision : ce que l'utilisateur a tapé. Tout ce qui lit la demande pour
 * décider de ce qu'elle EXIGE (une cible, une modification à prouver, des tests) passe par ici : la
 * précision est une paraphrase du modèle, et elle porte aussi la lecture ÉCARTÉE. Lue comme des mots
 * de l'utilisateur, elle crée des obligations qu'il n'a pas demandées, donc un refus garanti.
 */
export function sansPrecisionDeTache(tache: string): string {
  const debut = tache.indexOf(`\n\n${DEBUT_PRECISION_DE_TACHE}`)
  if (debut < 0) return tache
  const fin = tache.indexOf('\n\n', debut + 2)
  return `${tache.slice(0, debut)}${fin < 0 ? '' : tache.slice(fin)}`
}

/** Le début écrit : les fils de cette époque le portent encore dans leur texte. */
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
 * d'autre (2026-10-29 : « si tu voulais plutôt, c'est nul, mets juste ce qu'il a compris,
 * point »). Les lignes des anciens fils portent encore l'autre lecture après la phrase : elle est
 * coupée ici. Un texte sans guillemets en tête est rendu entier.
 */
export function ceQuiAEteCompris(annonce: string): string {
  const texte = texteDeLaLectureRetenue(annonce)
  return /^«[^»]*»/.exec(texte)?.[0] ?? texte
}
