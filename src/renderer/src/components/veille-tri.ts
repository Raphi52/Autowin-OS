import type { CandidatVeille } from '../../../main/veille/candidats'

/**
 * Le tri de la liste de veille, sorti du composant : une fonction exportée depuis un fichier de
 * composant casse le fast-refresh de Vite (`react-refresh/only-export-components`), et cette logique
 * pure se teste mieux hors du rendu de toute façon.
 */
export type TriVeille = 'pertinence' | 'date'

/**
 * Ordonne les candidats. FONCTION PURE (copie d'abord, `sort` mute) : la question de l'utilisateur est
 * « lequel reprendre en premier », donc pertinence DÉCROISSANTE par défaut. Un candidat NON NOTÉ
 * (`pertinence === undefined`) tombe en fin — on ne le traite pas comme un zéro, mais on ne le laisse
 * pas flotter en tête faute de note. `date` = ordre de lecture d'origine, sans réordonnancement.
 */
export function trierParPertinence(
  candidats: readonly CandidatVeille[],
  tri: TriVeille
): CandidatVeille[] {
  if (tri === 'date') return [...candidats]
  return [...candidats].sort((a, b) => (b.pertinence ?? -1) - (a.pertinence ?? -1))
}
