import { describe, expect, it } from 'vitest'
import { extrairePromptSuivant, extrairePropositionsSuite } from './prompt-suivant'

/**
 * PLAFOND MUET n°2 (conv-1228, 2026-10-28) : une ligne de prompt suivant au-delà de 600 caractères
 * était COUPÉE en pleine phrase, sans marque — et un clic sur le bouton envoyait cet ordre amputé
 * comme s'il était entier. Un ordre coupé est pire qu'aucun ordre : on garde la ligne entière, et
 * seul un vrai pavé (qui n'est plus un prompt) est écarté — jamais tronqué.
 */
describe('un prompt suivant n’est jamais coupé', () => {
  it('garde entier un prompt long mais légitime', () => {
    const consigne = `Corrige les fiches, ${'puis vérifie chaque cas, '.repeat(30)}et termine par le typage.`
    expect(consigne.length).toBeGreaterThan(600)
    expect(extrairePromptSuivant(`AUTOWIN_PROMPT_V1: [85] ${consigne}`)).toBe(consigne)
  })

  it('écarte un pavé au lieu d’en envoyer un morceau', () => {
    const pave = 'a'.repeat(3_000)
    expect(extrairePropositionsSuite(`AUTOWIN_PROMPT_V1: [85] ${pave}`)).toEqual([])
  })
})
