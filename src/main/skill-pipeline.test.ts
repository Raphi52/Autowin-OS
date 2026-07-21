import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadSkillText,
  loadEngineText,
  kitAvailable,
  phaseInstruction,
  PIPELINE_PHASES
} from './skill-pipeline'

describe('skill-pipeline — chargement du kit au runtime', () => {
  it('charge le texte d’un SKILL.md présent, vide sinon', () => {
    const root = mkdtempSync(join(tmpdir(), 'skills-'))
    try {
      mkdirSync(join(root, 'frame'), { recursive: true })
      writeFileSync(join(root, 'frame', 'SKILL.md'), '# frame\nframe le besoin')
      mkdirSync(join(root, '_engine'), { recursive: true })
      writeFileSync(join(root, '_engine', 'ENGINE.md'), '# ENGINE\nCh.4 build')

      expect(loadSkillText('frame', root)).toContain('frame le besoin')
      expect(loadSkillText('judge', root)).toBe('') // absent → vide, pas de crash
      expect(loadEngineText(root)).toContain('Ch.4 build')
      expect(kitAvailable(root)).toBe(true)
      expect(phaseInstruction('frame', root)).toContain('SKILL FRAME (kit)')
      expect(phaseInstruction('judge', root)).toBe('') // absent → pas d’injection
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('kit absent (racine inexistante) → tout vide, jamais de throw', () => {
    const root = join(tmpdir(), 'skills-none-' + Math.random().toString(36).slice(2))
    expect(kitAvailable(root)).toBe(false)
    expect(loadSkillText('frame', root)).toBe('')
    expect(phaseInstruction('build', root)).toBe('')
  })

  it('expose les 6 phases de la pipeline dans l’ordre', () => {
    expect(PIPELINE_PHASES).toEqual(['scout', 'frame', 'terrain', 'build', 'clean', 'judge'])
  })
})
