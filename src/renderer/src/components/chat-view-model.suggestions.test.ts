import { describe, expect, it } from 'vitest'
import { groupAssistantActivity, type ChatPart } from './chat-view-model'

const SCOUT_MD = `3 jeux proposés :

A — Découverte
\`Que peux-tu faire ?\` · \`Crée une conv\`

B — Avancé
\`Mets le juge sur codex\` · \`Fan-out 3 agents\``

describe('groupAssistantActivity — détection du retour scout', () => {
  it('transforme un texte scout en bloc suggestions structuré', () => {
    const parts: ChatPart[] = [{ kind: 'text', text: SCOUT_MD }]
    const blocks = groupAssistantActivity(parts)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].kind).toBe('suggestions')
    if (blocks[0].kind === 'suggestions') {
      expect(blocks[0].groups).toHaveLength(2)
      expect(blocks[0].groups[0].items[0].label).toBe('Que peux-tu faire ?')
    }
  })

  it('laisse un texte normal en bloc texte (pas de faux array)', () => {
    const parts: ChatPart[] = [{ kind: 'text', text: 'Voici mon analyse.\nDeux points à noter.' }]
    const blocks = groupAssistantActivity(parts)
    expect(blocks[0].kind).toBe('text')
  })
})
