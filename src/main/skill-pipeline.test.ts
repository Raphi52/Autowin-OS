import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadSkillText,
  loadEngineText,
  kitAvailable,
  phaseInstruction,
  stripSkillFrontmatter,
  engineForPhase,
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

  it('retire la frontmatter de routing avant injection, garde le corps', () => {
    const root = mkdtempSync(join(tmpdir(), 'skills-fm-'))
    try {
      mkdirSync(join(root, 'scout'), { recursive: true })
      const md = '---\nname: scout\ndescription: >-\n  Trigger on X. Do NOT use to Y.\n---\n\n# scout\nCorps réel du skill.'
      writeFileSync(join(root, 'scout', 'SKILL.md'), md)
      const injected = phaseInstruction('scout', root)
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

  it('injecte la FONDATION + le seul chapitre de la phase (pas ENGINE entier)', () => {
    const root = mkdtempSync(join(tmpdir(), 'skills-eng-'))
    try {
      mkdirSync(join(root, '_engine'), { recursive: true })
      const engine = [
        '# ENGINE',
        '## ⚡ THE FOUNDATION — 7 things',
        'les 7 concepts',
        '# REFERENCE',
        '## Ch.1 — GENERATE',
        'contenu ch1',
        '## Ch.2 — JUDGE',
        'contenu ch2',
        '## Ch.4 — BUILD',
        'contenu ch4',
        '## Telemetry',
        'hors usage'
      ].join('\n')
      writeFileSync(join(root, '_engine', 'ENGINE.md'), engine)
      const build = engineForPhase('build', root)
      expect(build).toContain('les 7 concepts') // fondation toujours
      expect(build).toContain('contenu ch4') // chapitre de la phase build
      expect(build).not.toContain('contenu ch1') // pas les autres chapitres
      expect(build).not.toContain('contenu ch2')
      expect(build).not.toContain('hors usage') // ni Telemetry/Roadmap
      expect(engineForPhase('scout', root)).toContain('contenu ch1')
      expect(engineForPhase('judge', root)).toContain('contenu ch2')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('fondation ENGINE 1×/run', () => {
  it('withFoundation=false omet THE FOUNDATION mais garde le chapitre de phase', () => {
    const withF = engineForPhase('scout', undefined, true)
    const without = engineForPhase('scout', undefined, false)
    // Si le kit ENGINE est absent sur ce poste, les deux sont vides → test trivialement vrai.
    if (!withF) return
    expect(withF).toContain('THE FOUNDATION')
    expect(without).not.toContain('THE FOUNDATION')
    expect(without.length).toBeLessThan(withF.length)
  })
  it('phaseInstruction propage withFoundation', () => {
    const first = phaseInstruction('frame', undefined, { withFoundation: true })
    const later = phaseInstruction('frame', undefined, { withFoundation: false })
    if (!first.includes('THE FOUNDATION')) return
    expect(later).not.toContain('THE FOUNDATION')
  })
})
