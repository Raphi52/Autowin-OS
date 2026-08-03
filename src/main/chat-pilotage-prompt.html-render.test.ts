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
  })
})
