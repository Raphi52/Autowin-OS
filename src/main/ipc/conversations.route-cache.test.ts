import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * LA PART DE CACHE DU TRI N'ETAIT PAS MESURABLE. L'audit conclut « cacheRead = 0 » sur les 1 894
 * classements, mais le journal `conversation-route` ne recopiait que input/output/cout : les deux
 * champs de cache portes par `decision.usage` n'etaient JAMAIS ecrits. Un zero par absence
 * d'ecriture ne prouve rien sur le cache — il rend seulement la question invisible.
 */
const source = readFileSync(join(__dirname, 'conversations.ts'), 'utf8')
const bloc = source.slice(
  source.indexOf("kind: 'conversation-route'"),
  source.indexOf("kind: 'conversation-route'") + 900
)

describe('journal du tri de conversation', () => {
  it('ecrit la part de cache lue ET ecrite de l’appel de classement', () => {
    expect(bloc).toContain('cacheReadTokens: decision.usage?.cacheReadTokens')
    expect(bloc).toContain('cacheCreationTokens: decision.usage?.cacheCreationTokens')
  })
})
