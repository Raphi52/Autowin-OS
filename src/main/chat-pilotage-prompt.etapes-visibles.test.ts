import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'
import { CATALOG } from './commands'

/**
 * ÉTAPES VISIBLES (conv-304, 2026-10-17). Le bloc Étapes du fil se nourrit des appels
 * TaskCreate/TaskUpdate du modèle. Mesuré en A/B sur le CLI 2.1.302 (Opus, même demande en trois
 * gestes) : sans cette consigne, 0 étape — elle vit dans le prompt par défaut de Claude Code, que le
 * chat remplace ; avec elle, 3 étapes passées une à une en cours puis terminées.
 */
describe('prompt du chat — étapes visibles', () => {
  it('demande la liste d’étapes, avancée une à une, pour une action en plusieurs gestes', () => {
    const prompt = buildChatPilotagePrompt(CATALOG)
    expect(prompt).toContain('ÉTAPES VISIBLES')
    expect(prompt).toMatch(/TaskCreate, une étape par geste, AVANT le premier geste/)
    expect(prompt).toMatch(/in_progress avec TaskUpdate[\s\S]*completed dès qu'elle est finie/)
    // Conditionnelle : un modèle sans ces outils (Codex) ne doit pas les chercher.
    expect(prompt).toMatch(/si tu disposes de TaskCreate et TaskUpdate/)
  })

  it('n’alourdit pas un tour en lecture seule, qui n’agit pas', () => {
    // Même construction que chat-pilotage-prompt.lecture-seule.test.ts : les seules commandes de lecture.
    const lecture = CATALOG.filter((c) => c.annotations?.readOnlyHint)
    expect(buildChatPilotagePrompt(lecture)).not.toContain('ÉTAPES VISIBLES')
  })
})
