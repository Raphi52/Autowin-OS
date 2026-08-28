import { describe, expect, it } from 'vitest'
import { skillsInvocables } from './commands'
import { nativeSkills } from './native-registry'

/**
 * DECLENCHEUR, pas seulement NOM.
 *
 * Un nom nu (`forge`) ne dit pas QUAND s'en servir : la skill ne pouvait donc partir que si
 * l'utilisateur tapait le slash. Chaque SKILL.md porte deja son declencheur dans son front-matter
 * `description` ; ce test verifie que cette phrase arrive bien dans le snapshot du tour.
 */
describe('skillsInvocables — declencheur remis au modele', () => {
  it('accole a chaque skill le debut de sa description', () => {
    const lignes = skillsInvocables()
    const forge = lignes.find((l) => l.startsWith('forge'))
    expect(forge, 'skill forge absente du disque').toBeDefined()
    expect(forge).toContain(' — ')
    expect(forge!.toLowerCase()).toContain('tool')
  })

  it('borne chaque ligne : le declencheur, jamais le contrat entier', () => {
    for (const ligne of skillsInvocables()) {
      expect(ligne.length).toBeLessThanOrEqual(280)
      expect(ligne).not.toContain('\n')
    }
  })

  it('retombe sur le nom nu quand la description est absente', () => {
    const sansPhrase = nativeSkills().filter((s) => s.description === 'Skill (SKILL.md)')
    for (const s of sansPhrase) {
      expect(skillsInvocables()).toContain(s.id)
    }
  })
})
