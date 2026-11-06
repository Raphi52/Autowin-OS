/**
 * SERVICES DE MODÈLES SERVIS SANS CLI (2026-11-04) : la demande « l'architecture doit
 * pouvoir héberger n'importe quel modèle » interdit que tout passe par le CLI Claude ou Codex.
 * Chaque service qui parle le format OpenAI « chat completions » se déclare ICI par une ligne de
 * données ; le moteur unique `OpenAICompatAdapter` (openai-compat.ts) le sert. Ajouter un service =
 * ajouter une ligne, sans toucher au registre, au catalogue ni à la liste des moteurs routés.
 *
 * Identifiants préfixés `api-` : `gemini` est un ancien moteur retiré, toléré en lecture des données
 * anciennes (`model-aliases`) ; un identifiant neuf évite toute confusion avec lui.
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
  /** Montré dans le menu même sans clé (onglet visible ; l'appel refuse tant que la clé manque). */
  toujoursVisible?: boolean
}

// Liste vidée le 2026-11-04 : l'utilisateur ne veut AUCUN modèle par clé d'API, seulement
// ses abonnements (Claude, ChatGPT/Codex, Gemini par agy, Grok par son CLI).
export const SERVICES_HTTP: readonly ServiceHttp[] = []

export type ServiceHttpId = string

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
  return SERVICES_HTTP.filter(
    (s: ServiceHttp) => serviceHttpActif(s, env) || s.toujoursVisible
  ).flatMap((s: ServiceHttp) =>
    s.modeles.map((m) => ({
      id: `${s.id}/${m}`,
      provider: s.id,
      model: m,
      label: `${m} (${s.libelle})`,
      reasoningEfforts: ['none' as const],
      defaultReasoningEffort: 'none' as const,
      dynamicallyLoaded: true
    }))
  )
}
