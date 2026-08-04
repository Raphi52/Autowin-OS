import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./ChatView.tsx', import.meta.url), 'utf8')
const modelsSource = readFileSync(new URL('./AgentsTopologyView.tsx', import.meta.url), 'utf8')

describe('navigation pendant une reponse', () => {
  it('ne propose plus le selecteur de permissions defectueux', () => {
    expect(source).not.toContain('Permissions de la conversation')
    expect(source).not.toContain('conversationsSetAuthorityMode')
  })

  it('laisse Nouveau accessible pendant la reflexion', () => {
    const newConversation = source.match(
      /<button\s+className=\{`conv-new-row\$\{activeId === null \? ' active' : ''\}`\}[\s\S]*?onClick=\{newConv\}[\s\S]*?<\/button>/
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
    expect(source).toContain('window.api.roles()')
    expect(source).toMatch(/window\.api\.setRole\(\s*'orchestrator'/)
    expect(modelsSource).not.toContain('window.api.roles()')
    expect(modelsSource).not.toContain('window.api.setRole(')
    expect(modelsSource).toContain('window.api.setTopology(')
    expect(modelsSource).toContain("event.scope === 'roles'")
    expect(modelsSource).not.toMatch(/function withOrchestratorRole\(/)
    expect(modelsSource).toContain('replaceTopology(applied.topology)')
  })

  it('synchronise le routage live avant de publier une nouvelle selection', () => {
    const load = source.match(
      /async function loadConv\(c: Conv\): Promise<void> \{[\s\S]*?\n\s{2}\}/
    )?.[0]
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
    expect(fresh).toContain('void refreshRuntimeIdentity(true)')
    expect(fresh!.indexOf('setActiveId(null)')).toBeLessThan(
      fresh!.indexOf('refreshRuntimeIdentity(true)')
    )
  })

  it('transforme le bouton principal en vrai Stop pendant la reflexion', () => {
    const composerButton = source.match(
      /<button\s+className=\{`btn-accent btn composer-send[\s\S]*?<\/button>/
    )?.[0]

    expect(composerButton).toBeDefined()
    // Tour en cours + composer VIDE → vrai Stop (annule le tour) ; texte présent → mise en file.
    expect(composerButton).toContain('window.api.cancelPilotChat(activeId)')
    expect(composerButton).toContain("'■ Stop'")
    expect(composerButton).toContain("'⚡ Mettre en file'")
    expect(composerButton).not.toContain('disabled={busy ||')
  })
})
