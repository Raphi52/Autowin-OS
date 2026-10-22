import { describe, expect, it } from 'vitest'
import { extrairePromptSuivant as x, retirerLignePromptSuivant as r } from './prompt-suivant'

// Migré de scripts/arena-panel/p6-prompt-crlf.mts et p8-prompt-dans-un-bloc.mts (banc /arena,
// commit 191ab51d), retirés le 2026-10-22 (residus, conv-1062).
describe('retirerLignePromptSuivant — fins de ligne CRLF (p6)', () => {
  it('une réponse en CRLF se rend comme en LF', () => {
    expect(r('a\r\nAUTOWIN_PROMPT_V1: fais x\r\n')).toBe('a')
    expect(r('a\r\nAUTOWIN_PROMPT_V1: fais x')).toBe('a')
    expect(r('a\nAUTOWIN_PROMPT_V1: fais x')).toBe('a')
  })
  it('sans ligne de prompt, ou dans un bloc de code, le texte est intact', () => {
    expect(r('a\r\nb')).toBe('a\r\nb')
    expect(r('```\nAUTOWIN_PROMPT_V1: x\n```')).toBe('```\nAUTOWIN_PROMPT_V1: x\n```')
  })
})

describe('prompt suivant — un EXEMPLE cité dans un bloc de code n’est pas le prompt (p8)', () => {
  const tilde = 'réponse\n~~~\nAUTOWIN_PROMPT_V1: exemple\n~~~'
  const imbrique = 'réponse\n````md\n```\nAUTOWIN_PROMPT_V1: exemple\n````'
  it('dans un bloc ~~~', () => {
    expect(x(tilde)).toBeNull()
    expect(r(tilde)).toBe(tilde)
  })
  it('dans un bloc ```` qui contient ``` (le ``` intérieur ne ferme pas)', () => {
    expect(x(imbrique)).toBeNull()
    expect(r(imbrique)).toBe(imbrique)
  })
  it('le vrai prompt, hors bloc ou après un bloc fermé, est toujours lu', () => {
    expect(x('a\nAUTOWIN_PROMPT_V1: fais x')).toBe('fais x')
    expect(x('```\nAUTOWIN_PROMPT_V1: ex\n```\nAUTOWIN_PROMPT_V1: vrai')).toBe('vrai')
    expect(x('~~~\nAUTOWIN_PROMPT_V1: ex\n~~~\nAUTOWIN_PROMPT_V1: vrai')).toBe('vrai')
    expect(r('a\nAUTOWIN_PROMPT_V1: fais x')).toBe('a')
  })
})
