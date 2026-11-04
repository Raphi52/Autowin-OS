/**
 * SERVICES DE MODÈLES SERVIS SANS CLI (2026-11-04, conv-1499) : la demande « l'architecture doit
 * pouvoir héberger n'importe quel modèle » interdit que tout passe par le CLI Claude ou Codex.
 * Chaque service qui parle le format OpenAI « chat completions » se déclare ICI par une ligne de
 * données ; le moteur unique `OpenAICompatAdapter` (openai-compat.ts) le sert. Ajouter un service =
 * ajouter une ligne, sans toucher au registre, au catalogue ni à la liste des moteurs routés.
 *
 * Identifiants préfixés `api-` : `gemini` est un ancien moteur retiré, toléré en lecture des données
 * anciennes (`model-aliases`) ; un identifiant neuf évite toute confusion avec lui ou avec la voie
 * Groq déjà servie par Codex (`codex/groq/…`).
 */
import { OpenAICompatAdapter } from './openai-compat'

export interface ServiceHttp {
  id: string
  libelle: string
  baseUrl: string
  /** Variable qui porte la clé ; absente = service local (actif seulement si `activeEnv` est posée). */
  apiKeyEnv?: string
  /** Pour un service sans clé : variable qui l'active explicitement (un Ollama n'est pas présumé). */
  activeEnv?: string
  modeles: readonly string[]
}

export const SERVICES_HTTP = [
  {
    id: 'api-gemini',
    libelle: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKeyEnv: 'GEMINI_API_KEY',
    modeles: ['gemini-2.5-flash', 'gemini-2.5-pro']
  },
  {
    id: 'api-groq',
    libelle: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'GROQ_API_KEY',
    modeles: ['moonshotai/kimi-k2-instruct', 'qwen/qwen3-32b', 'openai/gpt-oss-120b']
  },
  {
    id: 'api-mistral',
    libelle: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    apiKeyEnv: 'MISTRAL_API_KEY',
    modeles: ['devstral-medium-latest', 'mistral-medium-latest']
  },
  {
    id: 'api-cerebras',
    libelle: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    apiKeyEnv: 'CEREBRAS_API_KEY',
    modeles: ['qwen-3-coder-480b', 'gpt-oss-120b']
  },
  {
    id: 'api-ollama',
    libelle: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    activeEnv: 'AUTOWIN_OLLAMA',
    modeles: ['qwen3-coder', 'llama3.3']
  }
] as const satisfies readonly ServiceHttp[]

export type ServiceHttpId = (typeof SERVICES_HTTP)[number]['id']

/** Un service est actif quand sa clé est posée, ou, pour un service local, quand il est activé. */
export function serviceHttpActif(s: ServiceHttp, env: NodeJS.ProcessEnv = process.env): boolean {
  if (s.apiKeyEnv) return Boolean(env[s.apiKeyEnv]?.trim())
  return Boolean(s.activeEnv && env[s.activeEnv]?.trim())
}

export function servicesHttpActifs(env: NodeJS.ProcessEnv = process.env): ServiceHttp[] {
  return SERVICES_HTTP.filter((s) => serviceHttpActif(s, env))
}

/** Un adaptateur par service : tous sont enregistrés, un service sans clé refuse à l'appel. */
export function adaptateursServicesHttp(): OpenAICompatAdapter[] {
  return SERVICES_HTTP.map(
    (s: ServiceHttp) =>
      new OpenAICompatAdapter({
        id: s.id,
        baseUrl: s.baseUrl,
        apiKeyEnv: s.apiKeyEnv,
        defaultModel: s.modeles[0]
      })
  )
}

/** Entrées de catalogue des services actifs seulement : sans clé, la voie se tait. */
export function modelesServicesHttp(env: NodeJS.ProcessEnv = process.env): Array<{
  id: string
  provider: string
  model: string
  label: string
  reasoningEfforts: Array<'none'>
  defaultReasoningEffort: 'none'
  dynamicallyLoaded: boolean
}> {
  return servicesHttpActifs(env).flatMap((s) =>
    s.modeles.map((m) => ({
      id: `${s.id}/${m}`,
      provider: s.id,
      model: m,
      label: `${m} (${s.libelle}, direct)`,
      reasoningEfforts: ['none' as const],
      defaultReasoningEffort: 'none' as const,
      dynamicallyLoaded: true
    }))
  )
}
