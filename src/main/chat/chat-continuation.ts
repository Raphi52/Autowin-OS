export const CONTINUATION_INSTRUCTION =
  'Reprends exactement la réponse interrompue à partir du contexte ci-dessus. Continue sans répéter la demande utilisateur ni recommencer le travail déjà acquis.'

export function buildContinuationProviderHistory(
  history: Array<{ role: 'user' | 'assistant'; content: string }>
): Array<{ role: 'user' | 'assistant'; content: string }> {
  return [...history, { role: 'user', content: CONTINUATION_INSTRUCTION }]
}
