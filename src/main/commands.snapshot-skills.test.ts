import { describe, expect, it } from 'vitest'
import { nativeSkills } from './native-registry'

/**
 * Le snapshot injecte a CHAQUE tour doit nommer les skills invocables : sans ca, l'agent du chat
 * ignore `/see` tant que l'utilisateur ne l'a pas tapee (defaut du 2026-08-28).
 */
describe('snapshotForPrompt — skills disponibles', () => {
  it('expose les identifiants des skills actives, jamais leur corps', () => {
    const ids = nativeSkills()
      .filter((s) => s.enabled)
      .map((s) => s.id)
    expect(ids).toContain('see')
    const source = String(
      require('node:fs').readFileSync(require('node:path').join(__dirname, 'commands.ts'), 'utf8')
    )
    expect(source).toContain('skillsDisponibles')
    expect(source).toContain('skillsInvocables()')
  })
})
