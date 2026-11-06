import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { skillInstruction, stripSkillFrontmatter, PIPELINE_PHASES } from './skill-pipeline'

/*
 * Le chargeur d'ÉTAPE (`phaseInstruction`, `engineForPhase`, `loadSkillText`, `loadEngineText`) et
 * ses tests sont retirés : rien ne l'appelait hors de ce fichier depuis c8c90007, une
 * étape de run lit sa consigne dans `phase-briefs.ts`. Reste ici ce que le fil charge vraiment.
 */
describe('skill-pipeline — corps de skill chargé par le fil', () => {
  it('expose les 8 phases de la pipeline dans l’ordre', () => {
    expect(PIPELINE_PHASES).toEqual([
      'scout',
      'frame',
      'terrain',
      'build',
      'clean',
      'judge',
      'kaizen',
      'remake'
    ])
  })

  it('retire la frontmatter de routing avant injection, garde le corps', () => {
    const root = mkdtempSync(join(tmpdir(), 'skills-fm-'))
    try {
      mkdirSync(join(root, 'scout'), { recursive: true })
      const md =
        '---\nname: scout\ndescription: >-\n  Trigger on X. Do NOT use to Y.\n---\n\n# scout\nCorps réel du skill.'
      writeFileSync(join(root, 'scout', 'SKILL.md'), md)
      const injected = skillInstruction('scout', [root])
      expect(injected).toContain('SKILL SCOUT (kit)')
      expect(injected).toContain('Corps réel du skill.')
      expect(injected).not.toContain('description:')
      expect(injected).not.toContain('Do NOT use to')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('stripSkillFrontmatter est un no-op sans frontmatter', () => {
    expect(stripSkillFrontmatter('# build\nsans frontmatter')).toBe('# build\nsans frontmatter')
  })
})
