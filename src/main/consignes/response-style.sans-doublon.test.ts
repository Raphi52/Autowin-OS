import { expect, it } from 'vitest'
import { CONCISE_STRUCTURED_RESPONSE_INSTRUCTION } from './response-style'

it("la consigne de chat ne contient aucune phrase deux fois (conv-706)", () => {
  const phrases = CONCISE_STRUCTURED_RESPONSE_INSTRUCTION.split(/(?<=[.!?)])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40)
  const doublons = phrases.filter((s, i) => phrases.indexOf(s) !== i)
  expect(doublons).toEqual([])
  expect(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION).toMatch(/rang 3 contre rang 4/u)
})
