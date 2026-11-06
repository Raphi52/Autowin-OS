import { describe, expect, it } from 'vitest'
import { nativeSkills } from '../app/native-registry'
import { sourceDuBus } from './source-du-bus.test-helpers'

/**
 * Le snapshot injecte a CHAQUE tour doit nommer les skills invocables : sans ca, l'agent du chat
 * ignore `/look` tant que l'utilisateur ne l'a pas tapee (defaut du 2026-08-28).
 */
describe('snapshotForPrompt — skills disponibles', () => {
  it('expose les identifiants des skills actives, jamais leur corps', () => {
    const ids = nativeSkills()
      .filter((s) => s.enabled)
      .map((s) => s.id)
    expect(ids).toContain('look')
    // snapshotForPrompt vit dans commands/instantanes.ts (conv-1580, lot 6) : on lit la famille du bus.
    const source = sourceDuBus()
    expect(source).toContain('skillsDisponibles')
    expect(source).toContain('skillsInvocables()')
  })
})
