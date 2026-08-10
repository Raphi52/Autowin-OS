import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'

describe('chat HTML rendering contract', () => {
  it('teaches every orchestrator the explicit local-only fence without replacing normal text', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toContain('```html-render')
    expect(prompt).toContain('HTML/CSS')
    expect(prompt).toContain('sans JavaScript')
    expect(prompt).toContain('sans réseau')
    expect(prompt).toContain('texte ou le Markdown normal')
    expect(prompt).toContain("Au-delà d'environ 1 Mo")
    expect(prompt).toContain('artefact `.html`')
    /**
     * Ces assertions gardent le SENS du defaut, pas seulement la presence des mots. La consigne a ete
     * desserree le 2026-08-07 (« reponds-moi en HTML pour que ce soit plus lisible ») : le test
     * precedent passait encore APRES l'inversion du defaut, parce qu'il ne verifiait que des chaines
     * qui avaient survecu. Une garde qui ne voit pas le changement qu'elle est censee garder ne garde
     * rien.
     */
    expect(prompt).toContain('tu peux répondre en HTML mis en forme')
    expect(prompt).toMatch(/Dès que ta réponse a une STRUCTURE/u)
    expect(prompt).toContain('prefers-color-scheme')
    // Le garde-fou inverse : le HTML ne doit pas devenir obligatoire pour deux phrases.
    expect(prompt).toContain('court et purement')
  })
})
