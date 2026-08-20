import { describe, expect, it } from 'vitest'
import { skillInstruction } from './skill-pipeline'
import { bundledSkillsRoot } from './native-registry'
import { skillSlashCommands } from '../renderer/src/components/chat-view-model'

describe('/design est un alias de front-converge', () => {
  it('injecte le CORPS de front-converge', () => {
    const body = skillInstruction('design', [bundledSkillsRoot()!])
    expect(body).toContain('visual elicitation')
    expect(body).not.toContain('name: front-converge')
  })

  it('un id inconnu reste vide, et la garde anti-traversee tient', () => {
    expect(skillInstruction('../../ailleurs', [bundledSkillsRoot()!])).toBe('')
    expect(skillInstruction('pas-une-skill', [bundledSkillsRoot()!])).toBe('')
  })

  it('la palette propose /design a cote de /front-converge', () => {
    const noms = skillSlashCommands([
      { id: 'front-converge', description: 'Use when the user wants to DESIGN.', enabled: true }
    ]).map((c) => c.name)
    expect(noms).toContain('front-converge')
    expect(noms).toContain('design')
  })
})
