import { expect, it } from 'vitest'
import { CONCISE_STRUCTURED_RESPONSE_INSTRUCTION, STYLE_TON } from './response-style'

it('la consigne de chat ne contient aucune phrase deux fois (conv-706)', () => {
  const phrases = CONCISE_STRUCTURED_RESPONSE_INSTRUCTION.split(/(?<=[.!?)])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40)
  const doublons = phrases.filter((s, i) => phrases.indexOf(s) !== i)
  expect(doublons).toEqual([])
  // Le FORMAT imposé par une consigne de phase ne sert qu'aux étapes de run : le chat n'en a pas
  // (revue règle par règle, 2026-11-06), les étapes le gardent.
  expect(STYLE_TON).toMatch(/rang 3 contre rang 4/u)
  expect(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION).not.toMatch(/CONSIGNE de phase/u)
})
