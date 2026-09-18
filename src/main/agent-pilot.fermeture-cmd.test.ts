import { describe, expect, it } from 'vitest'
import { parseOrderedPilotTokens } from './agent-pilot'

// conv-686, tour 6185f7e7-88fa-4add-bf84-c51741d1b8b0 : `<cmd>{...}</invoke>` → tour muet, rien lancé.
describe('parseOrderedPilotTokens — fermeture </cmd> erronée', () => {
  it('récupère la commande et garde la conclusion visible', () => {
    const raw =
      '<cmd>{"name":"orchestrate","args":{"task":"a } b \\" {"}}</invoke>\n</function_calls>\n</invoke>\n\nJe lance le travail.'
    const tokens = parseOrderedPilotTokens(raw)
    expect(tokens.find((t) => t.kind === 'command')).toMatchObject({
      name: 'orchestrate',
      args: { task: 'a } b " {' }
    })
    const texte = tokens.filter((t) => t.kind === 'text').map((t) => (t as { text: string }).text).join('')
    expect(texte).toContain('Je lance le travail.')
    expect(texte).not.toContain('</invoke>')
  })
  it('laisse intact un bloc bien fermé et un JSON incomplet', () => {
    expect(parseOrderedPilotTokens('<cmd>{"name":"x","args":{}}</cmd>')).toEqual([
      { kind: 'command', name: 'x', args: {} }
    ])
    expect(parseOrderedPilotTokens('<cmd>{"name":"x","args":{}').some((t) => t.kind === 'command')).toBe(false)
  })
})
