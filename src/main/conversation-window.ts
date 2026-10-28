/**
 * FENÊTRE DE REPRISE D'UN FIL — la seule définition de « combien de conversation on remonte ».
 *
 * Ces bornes vivaient dans `conversation-router.ts` (tri de sujet avant l'envoi, retiré le 2026-10-17,
 * conv-305), qui les utilisait pour décider si un message poursuit le même objectif. Elles ont été
 * extraites ici pour `orchestration-context.ts`, qui joint le fil récent au contexte d'un run.
 *
 * Pourquoi une extraction plutôt qu'une seconde paire de constantes — défaut mesuré le 2026-08-23 sur
 * conv-1376 : le sous-agent d'un run recevait la phrase-tâche NUE, sans une ligne du fil qui l'avait
 * produite, et devait donc DEVINER l'intention au lieu de la lire. En corrigeant ça, dupliquer « 10
 * messages / 600 caractères » aurait créé deux vérités sur la même notion, qui divergent au premier
 * réglage. Le module est volontairement sans dépendance : le contexte d'orchestration ne doit pas
 * tirer tout le graphe du routeur (providers, execution-quote, skill-routing) pour deux entiers.
 */

/** Nombre de messages de fin de fil repris. */
export const CONTEXT_MESSAGE_LIMIT = 10

/** Plafond de caractères par message repris. */
export const CONTEXT_MESSAGE_CHARS = 600

/**
 * Plafond de la DERNIÈRE réponse de l'assistant reprise dans le contexte d'un run, en entier et avec
 * ses retours à la ligne. Défaut mesuré sur conv-798 (tour d97a3d36-2502-4b43-9a4b-46caff94d312,
 * saisie ts 1790161702779 « judge cette archi ») : l'objet à juger ÉTAIT la réponse précédente, coupée
 * à 600 caractères sur « Format stock… » ; le run a jugé une moitié de stack et l'a avoué. La borne
 * 600 reste celle du routeur (classification bon marché) ; le run, lui, doit lire l'objet désigné.
 */
export const CONTEXT_LAST_REPLY_CHARS = 12000

/**
 * Plafond d'un message de l'UTILISATEUR repris dans le contexte d'un run. Avant conv-1228
 * (2026-10-28), il subissait les 600 caractères du résumé : une demande détaillée faite plus tôt dans
 * le fil arrivait amputée au run. Sa parole passe entière, à la même borne que la dernière réponse ;
 * au-delà, la coupe est dite.
 */
export const CONTEXT_USER_MESSAGE_CHARS = CONTEXT_LAST_REPLY_CHARS

/** Réduit un texte à une ligne bornée : espaces normalisés, coupe explicite par une ellipse. */
export function clip(value: string, cap: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > cap ? `${normalized.slice(0, cap)}…` : normalized
}
