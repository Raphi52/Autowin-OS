/**
 * Moteurs réellement routés par le produit. Kimi et Gemini ont été retirés (projets abandonnés) :
 * ils ne sont plus proposés au premier lancement, ni sondés, ni listés au catalogue. Leur identifiant
 * reste TOLÉRÉ en lecture des données anciennes — voir `model-aliases`.
 *
 * `codex` (les modèles ChatGPT) est REVENU le 2026-10-31 à la demande de l'utilisateur (conv-1414),
 * après son retrait du 2026-09-04. Il reste FACULTATIF : Claude garde la première place, et un poste
 * sans CLI Codex ne voit simplement aucun modèle ChatGPT.
 */
export const ROUTED_PROVIDERS = ['claude', 'codex'] as const

export type RoutedProvider = (typeof ROUTED_PROVIDERS)[number]
