/*
 * MODÈLES GRATUITS D'OPENROUTER — ajoutés le 2026-11-04 (conv-1471, « OpenRouter free models (one key,
 * many models) »). Une seule clé (variable d'environnement OPENROUTER_API_KEY, jamais écrite sur disque
 * par Autowin) ouvre les modèles `:free`, servis à Claude Code par ANTHROPIC_BASE_URL.
 *
 * Filtre aussi à la relecture du cache : un cache écrit avant un changement de règle ramènerait sinon
 * des modèles exclus. Gemini et Kimi sont admis (retrait levé le 2026-11-04, conv-1471).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { autowinAppDataRoot } from './app-data'

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

/**
 * MODÈLES QUI NE RÉPONDENT PAS (2026-11-04, conv-1496 : « teste chaque modèle, enlève ceux qui
 * marchent pas »). Le catalogue en annonce que la clé ne peut pas appeler (ex. 403 « only available
 * on agentic harnesses »). `scripts/openrouter-sonde.mjs` les essaie un par un et écrit ici ceux
 * qui REFUSENT pour de bon (400/403/404) ; un 429 est une limite passagère, le modèle reste.
 * Fichier sur le poste, jamais une liste figée dans le code.
 */
export function cheminExclusionsOpenRouter(racine = autowinAppDataRoot()): string {
  return join(racine, 'openrouter-exclus.json')
}

export function lireExclusionsOpenRouter(chemin = cheminExclusionsOpenRouter()): Set<string> {
  try {
    const corps = JSON.parse(readFileSync(chemin, 'utf8')) as { exclus?: { id?: unknown }[] }
    return new Set(
      (corps.exclus ?? []).map((e) => e.id).filter((id): id is string => typeof id === 'string')
    )
  } catch {
    // Pas encore de sonde sur ce poste (ou fichier illisible) : aucun modèle n'est retiré.
    return new Set()
  }
}

/** Lit le catalogue public live ; jamais de liste figée. */
export async function chargerModelesGratuits(
  fetchFn: typeof fetch = fetch,
  exclus: Set<string> = lireExclusionsOpenRouter()
): Promise<OpenRouterModel[]> {
  const reponse = await fetchFn(OPENROUTER_MODELS_URL)
  if (!reponse.ok) throw new Error(`OpenRouter : catalogue indisponible (HTTP ${reponse.status})`)
  const corps = (await reponse.json()) as { data?: unknown }
  return filtrerModelesGratuits(corps.data).filter((m) => !exclus.has(m.id))
}

export const OPENROUTER_KEY_URL = 'https://openrouter.ai/api/v1/key'

/**
 * QUOTA DES MODÈLES GRATUITS : OpenRouter ne compte pas par modèle mais par compte —
 * `free_model_daily_requests` { used, limit, remaining } de GET /api/v1/key (mesuré le 2026-11-04 :
 * 17 / 50). Une seule barre partagée par tous les modèles `:free`, compteur du « jour UTC en cours » (doc :
 * https://openrouter.ai/docs/api-reference/limits), donc remis à zéro au changement de jour UTC.
 */
export async function quotaJournalierOpenRouter(
  fetchFn: typeof fetch = fetch,
  cle = process.env.OPENROUTER_API_KEY?.trim(),
  now = Date.now()
): Promise<{ used: number; limit: number; resetsAt: string } | { erreur: string }> {
  if (!cle) return { erreur: 'Clé OPENROUTER_API_KEY absente' }
  try {
    const reponse = await fetchFn(OPENROUTER_KEY_URL, {
      headers: { authorization: `Bearer ${cle}` }
    })
    if (!reponse.ok) return { erreur: `OpenRouter : HTTP ${reponse.status}` }
    const corps = (await reponse.json()) as {
      data?: { free_model_daily_requests?: { used?: unknown; limit?: unknown } }
    }
    const jour = corps.data?.free_model_daily_requests
    if (typeof jour?.used !== 'number' || typeof jour.limit !== 'number' || jour.limit <= 0)
      return { erreur: 'OpenRouter : quota journalier non exposé' }
    const demain = new Date(now)
    demain.setUTCHours(24, 0, 0, 0)
    return { used: jour.used, limit: jour.limit, resetsAt: demain.toISOString() }
  } catch (cause) {
    return { erreur: `OpenRouter : ${cause instanceof Error ? cause.message : String(cause)}` }
  }
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
