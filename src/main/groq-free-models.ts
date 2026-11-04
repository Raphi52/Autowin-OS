/*
 * MODÈLES GRATUITS DE GROQ servis par le CLI Codex — ajoutés le 2026-11-04 (conv-1499, « Gemini Flash
 * en principal, Groq en secours »). Une clé (variable d'environnement GROQ_API_KEY, jamais écrite sur
 * disque par Autowin), branchée sur Codex par `-c model_providers.groq.*`.
 *
 * Pourquoi Codex et pas Claude : Groq ne parle que le format OpenAI, pas celui d'Anthropic.
 * Mesuré le 2026-11-04 sur codex-cli 0.166.0 :
 *  - `wire_api="chat"` est REFUSÉ (« no longer supported ») : seul `responses` passe ;
 *  - Groq sert `/openai/v1/responses` (401 « Invalid API Key » avec une fausse clé = branché) ;
 *  - Gemini (AI Studio) répond 404 sur `/v1beta/openai/responses` : PAS de voie Gemini directe par
 *    Codex. Gemini reste disponible par OpenRouter (`openrouter-free-models.ts`).
 */

export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1'
export const GROQ_MODELS_URL = `${GROQ_BASE_URL}/models`
export const PREFIXE_GROQ = 'groq/'

/** Familles qui appellent des outils chez Groq ; la liste live ne le dit pas, d'où ce filtre. */
const FAMILLES_AGENTIQUES = /kimi|qwen|gpt-oss|llama-3\.3|llama-4/i
const NON_CONVERSATIONNELS = /whisper|guard|tts|playai|orpheus|prompt-guard/i

export interface GroqModel {
  id: string
  active?: boolean
}

export const MESSAGE_CLE_GROQ_MANQUANTE =
  'Clé Groq manquante : la variable d’environnement GROQ_API_KEY n’est pas définie. ' +
  'Crée une clé gratuite sur https://console.groq.com/keys, enregistre-la dans GROQ_API_KEY ' +
  '(variable utilisateur Windows), puis redémarre Autowin.'

export function estModeleGroqAdmis(model: unknown): model is GroqModel {
  if (!model || typeof model !== 'object') return false
  const { id, active } = model as GroqModel
  if (typeof id !== 'string' || active === false) return false
  return FAMILLES_AGENTIQUES.test(id) && !NON_CONVERSATIONNELS.test(id)
}

export function filtrerModelesGroq(liste: unknown): GroqModel[] {
  return Array.isArray(liste) ? liste.filter(estModeleGroqAdmis) : []
}

/** Catalogue live ; sans clé, aucune requête et aucun modèle (la voie se tait). */
export async function chargerModelesGroq(
  fetchFn: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env
): Promise<GroqModel[]> {
  const cle = env.GROQ_API_KEY?.trim()
  if (!cle) return []
  const reponse = await fetchFn(GROQ_MODELS_URL, { headers: { Authorization: `Bearer ${cle}` } })
  if (!reponse.ok) throw new Error(`Groq : catalogue indisponible (HTTP ${reponse.status})`)
  const corps = (await reponse.json()) as { data?: unknown }
  return filtrerModelesGroq(corps.data)
}

/**
 * Lancement Codex d'un modèle du catalogue : `null` hors Groq ; sinon l'id nu pour `--model` et les
 * réglages `-c`. La clé n'est jamais copiée dans les arguments : Codex la lit dans GROQ_API_KEY.
 * Sans clé : erreur explicite, jamais un repli silencieux sur ChatGPT.
 */
export function lancementGroq(
  model: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): { model: string; config: string[] } | null {
  if (!model?.startsWith(PREFIXE_GROQ)) return null
  if (!env.GROQ_API_KEY?.trim()) throw new Error(MESSAGE_CLE_GROQ_MANQUANTE)
  return {
    model: model.slice(PREFIXE_GROQ.length),
    config: [
      '-c',
      'model_provider="groq"',
      '-c',
      'model_providers.groq.name="Groq"',
      '-c',
      `model_providers.groq.base_url="${GROQ_BASE_URL}"`,
      '-c',
      'model_providers.groq.env_key="GROQ_API_KEY"',
      '-c',
      'model_providers.groq.wire_api="responses"'
    ]
  }
}
