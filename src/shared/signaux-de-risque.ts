/**
 * LES SIGNAUX DE RISQUE d'une tâche — source UNIQUE, lue par deux côtés qui doivent dire la même chose.
 *
 * Côté processus principal, `classifyRegime` (src/main/task-regime.ts) classe en régime `critical`
 * toute tâche qui porte l'un de ces mots, et lui fait jouer le pipeline complet. Côté interface, le
 * panneau des candidats scout (`voieRecommandee`, veille-candidats-message.ts) refuse de recommander
 * une correction directe sur une piste qui en porte un. Déplacé ici le 2026-10-22 (conv-1080) : une
 * copie du motif dans l'interface aurait divergé du classement réel au premier mot ajouté.
 */

/** Signaux de COMPLEXITÉ : architecture, transverse, risque, irréversible. */
export const SIGNAUX_CRITIQUES =
  /\b(architect\w*|refactor\w*|migrat\w*|s[eé]curit\w*|security|auth\w*|pipeline|(?<!\/)orchestrat(?!e\b)\w*|transvers\w*|breaking|irr[eé]versibl\w*|production|prod\b|deploy\w*|d[eé]ploie\w*|sch[eé]ma|schema|multi-\w+|tout le|l'ensemble|whole|entire)/i

/**
 * Une contrainte négative décrit précisément ce qu'il NE faut pas faire ; elle ne doit donc pas
 * promouvoir seule une correction bornée en chantier critique. On retire uniquement le signal
 * placé dans la petite fenêtre de la négation : tout autre signal positif reste compté.
 */
export const SIGNAUX_CRITIQUES_NIES =
  /\b(?:ne\s+pas|n['’]\s*|pas\s+de|aucun(?:e)?|sans|ni|do\s+not|don't|without)\s+(?:[^\s.;,:!?]+\s+){0,5}(?:architect\w*|refactor\w*|migrat\w*|s[eé]curit\w*|security|auth\w*|pipeline|orchestrat\w*|transvers\w*|breaking|irr[eé]versibl\w*|production|prod\b|deploy\w*|d[eé]ploie\w*|sch[eé]ma|schema|multi-\w+|tout le|l'ensemble|whole|entire)/gi

/** Vrai si le texte porte un signal de risque qui n'est pas pris dans une négation. */
export function porteUnSignalDeRisque(texte: string): boolean {
  return SIGNAUX_CRITIQUES.test(texte.replace(SIGNAUX_CRITIQUES_NIES, ''))
}
