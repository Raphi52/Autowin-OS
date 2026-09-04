/**
 * Moteurs réellement routés par le produit. Codex, Kimi et Gemini ont été retirés (projets
 * abandonnés) : ils ne sont plus proposés au premier lancement, ni sondés, ni listés au catalogue.
 * Leur identifiant reste TOLÉRÉ en lecture des données anciennes — voir `model-aliases`.
 */
export const ROUTED_PROVIDERS = ['claude'] as const

export type RoutedProvider = (typeof ROUTED_PROVIDERS)[number]
