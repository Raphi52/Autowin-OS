import { describe, expect, it } from 'vitest'
import { nativeSkills } from './native-registry'

/**
 * Le libellé des skills dans la palette `/` vient du front-matter. Plusieurs SKILL.md du kit
 * déclarent `description: >-` (scalaire YAML replié) : lire la seule première ligne rendait
 * littéralement « >- », et c'est ce qui se serait affiché à l'utilisateur.
 */
describe('description des skills', () => {
  const skills = nativeSkills()

  it("scanne au moins le kit embarqué du dépôt (sinon l'assertion suivante ne prouve rien)", () => {
    expect(skills.map((s) => s.id)).toEqual(expect.arrayContaining(['build', 'judge', 'scout']))
  })

  it('ne rend jamais un indicateur de bloc YAML en guise de description', () => {
    const fautives = skills.filter((s) => /^[|>][-+\d]*$/.test((s.description ?? '').trim()))
    expect(fautives.map((s) => s.id)).toEqual([])
  })

  it('rend le texte replié de `build`, qui utilise justement `>-`', () => {
    const build = skills.find((s) => s.id === 'build')
    expect((build?.description ?? '').length).toBeGreaterThan(40)
    expect(build?.description).not.toBe('Skill (SKILL.md)')
  })
})
