/**
 * FENÊTRE DE REPRISE D'UN FIL — la seule définition de « combien de conversation on remonte ».
 *
 * Ces bornes vivaient dans `conversation-router.ts`, qui les utilisait pour décider si un message
 * poursuit le même objectif. Elles sont extraites ici parce qu'un SECOND appelant en a besoin :
 * `orchestration-context.ts`, qui doit joindre le fil récent au contexte transmis aux phases d'un run.
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

/** Réduit un texte à une ligne bornée : espaces normalisés, coupe explicite par une ellipse. */
export function clip(value: string, cap: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > cap ? `${normalized.slice(0, cap)}…` : normalized
}
