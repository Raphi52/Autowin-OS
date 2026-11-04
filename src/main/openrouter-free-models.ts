/*
 * MODÈLES GRATUITS D'OPENROUTER — ajoutés le 2026-11-04 (conv-1471, « OpenRouter free models (one key,
 * many models) »). Une seule clé (variable d'environnement OPENROUTER_API_KEY, jamais écrite sur disque
 * par Autowin) ouvre les modèles `:free`, servis à Claude Code par ANTHROPIC_BASE_URL.
 *
 * Filtre aussi à la relecture du cache : un cache écrit avant un changement de règle ramènerait sinon
 * des modèles exclus. Gemini et Kimi sont admis (retrait levé le 2026-11-04, conv-1471).
 */

export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'
export const OPENROUTER_ANTHROPIC_BASE_URL = 'https://openrouter.ai/api'

export interface OpenRouterModel {
  id: string
  name?: string
  supported_parameters?: string[]
}

/** Garde un modèle gratuit, capable d'appeler des outils, tous éditeurs confondus. */
export function estModeleGratuitAdmis(model: unknown): model is OpenRouterModel {
  if (!model || typeof model !== 'object') return false
  const id = (model as OpenRouterModel).id
  if (typeof id !== 'string' || !id.endsWith(':free')) return false
  const params = (model as OpenRouterModel).supported_parameters
  return Array.isArray(params) && params.includes('tools')
}

/** Filtre une liste brute (réponse live OU cache disque relu). */
export function filtrerModelesGratuits(liste: unknown): OpenRouterModel[] {
  return Array.isArray(liste) ? liste.filter(estModeleGratuitAdmis) : []
}

/** Lit le catalogue public live ; jamais de liste figée. */
export async function chargerModelesGratuits(
  fetchFn: typeof fetch = fetch
): Promise<OpenRouterModel[]> {
  const reponse = await fetchFn(OPENROUTER_MODELS_URL)
  if (!reponse.ok) throw new Error(`OpenRouter : catalogue indisponible (HTTP ${reponse.status})`)
  const corps = (await reponse.json()) as { data?: unknown }
  return filtrerModelesGratuits(corps.data)
}

/** Environnement de Claude Code pointé sur OpenRouter ; null sans clé (aucun repli silencieux). */
export function environnementClaudeOpenRouter(
  modelId: string,
  env: NodeJS.ProcessEnv = process.env
): Record<string, string> | null {
  const cle = env.OPENROUTER_API_KEY?.trim()
  if (!cle) return null
  return {
    ANTHROPIC_BASE_URL: OPENROUTER_ANTHROPIC_BASE_URL,
    ANTHROPIC_AUTH_TOKEN: cle,
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_MODEL: modelId
  }
}

/** Préfixe de transport d'un modèle OpenRouter dans le catalogue (`openrouter/<id>`). */
export const PREFIXE_OPENROUTER = 'openrouter/'

/** Message montré quand un modèle OpenRouter est choisi sans clé : nomme le réglage, jamais sa valeur. */
export const MESSAGE_CLE_OPENROUTER_MANQUANTE =
  'Clé OpenRouter manquante : la variable d’environnement OPENROUTER_API_KEY n’est pas définie. ' +
  'Crée une clé sur https://openrouter.ai/keys, enregistre-la dans OPENROUTER_API_KEY ' +
  '(variable utilisateur Windows), puis redémarre Autowin.'

/**
 * Lancement d'un modèle du catalogue : `null` hors OpenRouter ; sinon le vrai id pour `--model` et
 * l'environnement à ajouter. Sans clé : erreur explicite, jamais un repli silencieux sur Anthropic.
 */
export function lancementOpenRouter(
  model: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): { model: string; env: Record<string, string> } | null {
  if (!model?.startsWith(PREFIXE_OPENROUTER)) return null
  const id = model.slice(PREFIXE_OPENROUTER.length)
  const envOpenRouter = environnementClaudeOpenRouter(id, env)
  if (!envOpenRouter) throw new Error(MESSAGE_CLE_OPENROUTER_MANQUANTE)
  return { model: id, env: envOpenRouter }
}
