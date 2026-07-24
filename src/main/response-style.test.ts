import { describe, expect, it } from 'vitest'
import { CONCISE_STRUCTURED_RESPONSE_INSTRUCTION } from './response-style'

describe('concise structured response policy', () => {
  it('requires the three exact closing headings for substantial work', () => {
    expect(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION).toContain('Fait maintenant')
    expect(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION).toContain('Reste à faire')
    expect(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION).toContain('Recommandé')
    expect(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION).toMatch(/rubrique vide.*masqu/iu)
  })

  it('does not impose a closing block on trivial conversational answers', () => {
    expect(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION).toMatch(
      /réponse conversationnelle triviale.*aucun bloc/iu
    )
  })
})
