import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { REGLES_VISUELLES } from './chat-pilotage-prompt'

/**
 * DEFAUT VECU (conv-526, tour c14c2d28-f864-4ca5-ba3f-3dfe24e41d47, 2026-09-13) : le chat a lance
 * Roblox Studio par Bash sur le bureau REEL puis capture l'ecran reel ; l'utilisateur a annule et
 * demande que le bureau cache soit le comportement par defaut.
 */
describe('pilotage non invasif par defaut', () => {
  it('nomme le lanceur et la capture du bureau cache, qui existent vraiment', () => {
    const prompt = REGLES_VISUELLES
    expect(prompt).toContain("ECRAN DE L'UTILISATEUR = SON ESPACE")
    expect(prompt).toContain('scripts/hdesk-lancer.ps1')
    expect(prompt).toContain('scripts/hdesk-observe.ps1')
    expect(existsSync('scripts/hdesk-lancer.ps1')).toBe(true)
    expect(existsSync('scripts/hdesk-observe.ps1')).toBe(true)
  })

  // kaizen conv-540, tour a3691bd9-88b8-4b86-bd0d-b21c34bae8f2 : un crash n'autorise plus la bascule.
  it('traite un code non nul du bureau cache comme une erreur a corriger, pas un motif de bascule', () => {
    const prompt = REGLES_VISUELLES
    expect(prompt).toContain('ERREUR DU BUREAU CACHE = ERREUR DE TON TOUR')
    expect(prompt).toContain('journalWindows')
    expect(prompt).not.toContain('pid disparu')
  })

  // kaizen conv-854, tour 78a0d7d3-6a84-4d86-a3a7-fd1b5cc1393f : ouvrir une page / taper un code
  // passe d'abord par le bureau cache, plus par le focus de la fenetre de l'utilisateur.
  it('place le bureau cache avant tout geste sur la fenetre de l utilisateur', () => {
    const prompt = REGLES_VISUELLES
    expect(prompt).toContain("ORDRE : d'abord le bureau cache")
    expect(prompt).not.toContain('focaliser sa fenetre, hdesk')
  })
})
