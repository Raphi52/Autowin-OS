/**
 * Moteurs réellement routés par le produit. Kimi et Gemini ont été retirés (projets abandonnés) :
 * ils ne sont plus proposés au premier lancement, ni sondés, ni listés au catalogue. Leur identifiant
 * reste TOLÉRÉ en lecture des données anciennes — voir `model-aliases`.
 *
 * `codex` (les modèles ChatGPT) est REVENU le 2026-10-31 à la demande de l'utilisateur (conv-1414),
 * après son retrait du 2026-09-04. Il reste FACULTATIF : Claude garde la première place, et un poste
 * sans CLI Codex ne voit simplement aucun modèle ChatGPT.
 */
import { SERVICES_HTTP, type ServiceHttpId } from './providers/services-http'

/**
 * Ouverte le 2026-11-04 (conv-1499) : aux deux CLI s'ajoutent les services HTTP déclarés dans
 * `providers/services-http.ts`, servis sans CLI. Un service nouveau s'y déclare, jamais ici.
 */
export const ROUTED_PROVIDERS: readonly ('claude' | 'codex' | ServiceHttpId)[] = [
  'claude',
  'codex',
  ...SERVICES_HTTP.map((s) => s.id)
]

export type RoutedProvider = (typeof ROUTED_PROVIDERS)[number]
