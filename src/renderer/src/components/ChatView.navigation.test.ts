import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./ChatView.tsx', import.meta.url), 'utf8')

describe('navigation pendant une reponse', () => {
  it('laisse Nouvelle conversation accessible pendant la reflexion', () => {
    const newConversation = source.match(
      /<button\s+className="btn btn-sm"\s+onClick=\{newConv\}[\s\S]*?title="Nouvelle conversation"[\s\S]*?<\/button>/
    )?.[0]

    expect(newConversation).toBeDefined()
    expect(newConversation).not.toContain('disabled={busy}')
    expect(source.match(/function newConv\(\): void \{[\s\S]*?\n\s{2}\}/)?.[0]).not.toContain(
      'if (busy) return'
    )
  })

  it('etiquette une nouvelle conversation avec le provider orchestrateur reel', () => {
    const creation = source.match(
      /const identity = runtimeIdentity[\s\S]*?conversationsCreate\(\{[\s\S]*?\}\)/
    )?.[0]

    expect(creation).toBeDefined()
    expect(creation).toContain('category: identity.provider')
    expect(creation).toContain('provider: identity.provider')
    expect(creation).not.toMatch(/provider:\s*['"]claude['"]/)
  })
})
