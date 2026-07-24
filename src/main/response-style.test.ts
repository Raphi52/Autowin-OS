import { describe, expect, it } from 'vitest'
import { CONCISE_STRUCTURED_RESPONSE_INSTRUCTION } from './response-style'

describe('concise structured response policy', () => {
  it('requires the exact compact closing block for substantial work', () => {
    const headings = ['✅ Fait', '📍 Maintenant', '⏳ Reste à faire', '👉 Recommandé']
    const positions = headings.map((heading) =>
      CONCISE_STRUCTURED_RESPONSE_INSTRUCTION.indexOf(heading)
    )

    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((left, right) => left - right))
    expect(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION).toMatch(
      /contenu.*(?:factuel|actions, preuves, limites et suites réelles)/iu
    )
    expect(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION).toMatch(
      /une seule (?:prochaine )?action|une seule recommandation/iu
    )
    expect(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION).toMatch(
      /(?:sans|absence de|supprime).*(?:répétition|répéter)/iu
    )
    expect(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION).toMatch(
      /format strict.*prioritaire/iu
    )
    expect(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION).not.toMatch(/rubrique vide.*masqu/iu)
  })

  it('does not impose a closing block on trivial conversational answers', () => {
    expect(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION).toMatch(
      /réponse conversationnelle triviale.*aucun bloc/iu
    )
  })
})
