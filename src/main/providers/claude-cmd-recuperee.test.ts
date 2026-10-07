import { describe, expect, it } from 'vitest'
import { commandeRecupereeApresAppelIllisible } from './claude-cmd-recuperee'

// Forme exacte observee conv-121, tour 080f524d-01eb-4fa6-b5a8-fcf1a347f8dc (run-stdout 8f2cc560…).
const tentative = (task: string): string =>
  `<cmd>{"name":"orchestrate","args":{"task":"${task}","phase":"build"}}</parameter>\n</invoke>`

describe('commandeRecupereeApresAppelIllisible', () => {
  it('recupere la derniere commande complete fermee par </invoke>', () => {
    const texte =
      tentative('migrer ui en React. Ne pas commit.') +
      '\n\n' +
      tentative('migrer ui en React v2 {a}') +
      "\n\nThe model's tool call could not be parsed (retry also failed)."
    const r = commandeRecupereeApresAppelIllisible(texte)
    expect(r).toBe(
      '<cmd>{"name":"orchestrate","args":{"task":"migrer ui en React v2 {a}","phase":"build"}}</cmd>'
    )
  })
  it('rend undefined sans commande lisible', () => {
    expect(commandeRecupereeApresAppelIllisible('<cmd>{"name":"orchestrate","args":{')).toBeUndefined()
    expect(commandeRecupereeApresAppelIllisible('rien')).toBeUndefined()
    expect(commandeRecupereeApresAppelIllisible('<cmd>{"args":{}}</invoke>')).toBeUndefined()
  })
})
