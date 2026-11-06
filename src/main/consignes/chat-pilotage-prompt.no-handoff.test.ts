import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// kaizen conv-843, tour c4e319ca-783f-4b49-9b87-971cd6392c8e, saisie ts 1790275899514
describe('prompt chat : pas de rendu de geste faisable', () => {
  it('contient la regle', () => {
    const src = readFileSync(join(__dirname, 'chat-pilotage-prompt.ts'), 'utf8')
    expect(src).toContain("NE REND JAMAIS A L'UTILISATEUR UN GESTE QUE TES OUTILS PEUVENT FAIRE")
  })
})
