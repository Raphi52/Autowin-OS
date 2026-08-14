/**
 * Binding persistant d'une tâche vers le rôle orchestrateur courant d'Agent Studio.
 * Ce sentinel est résolu au moment du run : il ne capture jamais un provider ou un modèle figé.
 */
export const AGENT_STUDIO_DEFAULT_PROVIDER = 'agent-studio-default'
export const AGENT_STUDIO_DEFAULT_MODEL_LABEL = 'Agents Studio model (default)'

export function usesAgentStudioDefault(provider: string | undefined): boolean {
  return provider === AGENT_STUDIO_DEFAULT_PROVIDER
}
