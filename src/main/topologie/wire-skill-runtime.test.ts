import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { skillInstruction } from '../skills/skill-pipeline'

/*
 * Passé sur `skillInstruction` quand `phaseInstructionFromRoots` a été retirée sans appelant.
 * Son verrou « skill désactivée » ne valait que pour ce chargeur mort : dans le fil,
 * seul l'outil `skill_charger` le lit (`skill-charger-command.ts`), pas `skillInstruction`.
 */
describe('skill registry to runtime wiring', () => {
  it('injecte la première racine qui porte la skill, et passe les racines où elle manque', () => {
    const base = mkdtempSync(join(tmpdir(), 'wire-skills-'))
    const codex = join(base, 'codex')
    const claude = join(base, 'claude')
    const autowin = join(base, 'autowin')
    try {
      mkdirSync(join(codex, 'frame'), { recursive: true })
      mkdirSync(join(claude, 'frame'), { recursive: true })
      mkdirSync(join(autowin, 'build'), { recursive: true })
      writeFileSync(join(codex, 'frame', 'SKILL.md'), '---\nname: frame\n---\nCODEX FRAME')
      writeFileSync(join(claude, 'frame', 'SKILL.md'), '---\nname: frame\n---\nCLAUDE FRAME')
      writeFileSync(join(autowin, 'build', 'SKILL.md'), '---\nname: build\n---\nAUTOWIN BUILD')

      const frame = skillInstruction('frame', [codex, claude, autowin])
      expect(frame).toContain('CODEX FRAME')
      expect(frame).not.toContain('CLAUDE FRAME')
      expect(skillInstruction('build', [codex, claude, autowin])).toContain('AUTOWIN BUILD')
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})
