import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./ChatView.tsx', import.meta.url), 'utf8')

describe('navigation pendant une reponse', () => {
  it('ne propose plus le selecteur de permissions defectueux', () => {
    expect(source).not.toContain('Permissions de la conversation')
    expect(source).not.toContain('conversationsSetAuthorityMode')
  })

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
      /const identity = await refreshRuntimeIdentity\(\)[\s\S]*?conversationsCreate\(\{[\s\S]*?\}\)/
    )?.[0]

    expect(creation).toBeDefined()
    expect(creation).toContain('category: identity.provider')
    expect(creation).toContain('provider: identity.provider')
    expect(creation).not.toMatch(/provider:\s*['"]claude['"]/)
    expect(source).toContain("if (e.scope === 'roles') refreshRuntimeIdentity()")
  })

  it('synchronise le routage live avant de publier une nouvelle selection', () => {
    const load = source.match(/function loadConv\(c: Conv\): void \{[\s\S]*?\n\s{2}\}/)?.[0]
    const fresh = source.match(/function newConv\(\): void \{[\s\S]*?\n\s{2}\}/)?.[0]

    expect(load).toBeDefined()
    expect(fresh).toBeDefined()
    expect(load!.indexOf('activeRef.current = c.id')).toBeGreaterThanOrEqual(0)
    expect(load!.indexOf('activeRef.current = c.id')).toBeLessThan(
      load!.indexOf('setActiveId(c.id)')
    )
    expect(fresh!.indexOf('activeRef.current = null')).toBeGreaterThanOrEqual(0)
    expect(fresh!.indexOf('activeRef.current = null')).toBeLessThan(
      fresh!.indexOf('setActiveId(null)')
    )
  })

  it('transforme le bouton principal en vrai Stop pendant la reflexion', () => {
    const composerButton = source.match(
      /<button\s+className=\{`btn-accent btn composer-send[\s\S]*?<\/button>/
    )?.[0]

    expect(composerButton).toBeDefined()
    // Tour en cours + composer VIDE → vrai Stop (annule le tour) ; texte présent → Injecter.
    expect(composerButton).toContain('window.api.cancelPilotChat(activeId)')
    expect(composerButton).toContain("'■ Stop'")
    expect(composerButton).toContain("'⚡ Injecter'")
    expect(composerButton).not.toContain('disabled={busy ||')
  })
})
