import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { phaseInstructionFromRoots } from './skill-pipeline'

describe('skill registry to runtime wiring', () => {
  it('injects the first enabled source and falls through disabled or absent roots', () => {
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

      expect(
        phaseInstructionFromRoots('frame', [codex, claude, autowin], (id) => id !== 'frame')
      ).toBe('')
      expect(phaseInstructionFromRoots('frame', [codex, claude, autowin], () => true)).toContain(
        'CODEX FRAME'
      )
      expect(phaseInstructionFromRoots('build', [codex, claude, autowin], () => true)).toContain(
        'AUTOWIN BUILD'
      )
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})
