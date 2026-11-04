import { describe, expect, it } from 'vitest'
import { buildOrchestratorModelGroups } from './chat-view-model'

// conv-1519 : le service direct Groq revient dans le menu des modèles ; la voie `groq/…` servie
// par Codex reste masquée (conv-1517).
describe('menu des modèles : Groq', () => {
  it('montre les modèles du service direct api-groq et masque la voie groq/ de Codex', () => {
    const { groups } = buildOrchestratorModelGroups([
      { provider: 'api-groq', model: 'openai/gpt-oss-120b' },
      { provider: 'codex', model: 'groq/llama-3.3-70b' }
    ] as never)
    const options = groups.flatMap((g) => g.options)
    expect(options.map((o) => `${o.provider}:${o.model}`)).toEqual(['api-groq:openai/gpt-oss-120b'])
  })
})
