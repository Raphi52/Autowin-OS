import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'

/**
 * DEFAUT VECU (conv-526, tour c14c2d28-f864-4ca5-ba3f-3dfe24e41d47, 2026-09-13) : le chat a lance
 * Roblox Studio par Bash sur le bureau REEL puis capture l'ecran reel ; l'utilisateur a annule et
 * demande que le bureau cache soit le comportement par defaut.
 */
describe('pilotage non invasif par defaut', () => {
  it('nomme le lanceur et la capture du bureau cache, qui existent vraiment', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toContain("ECRAN DE L'UTILISATEUR = SON ESPACE")
    expect(prompt).toContain('scripts/hdesk-lancer.ps1')
    expect(prompt).toContain('scripts/hdesk-observe.ps1')
    expect(existsSync('scripts/hdesk-lancer.ps1')).toBe(true)
    expect(existsSync('scripts/hdesk-observe.ps1')).toBe(true)
  })
})
