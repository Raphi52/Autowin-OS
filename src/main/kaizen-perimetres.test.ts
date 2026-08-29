import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { bundledSkillsRoot } from './native-registry'

/**
 * KAIZEN — les trois périmètres d'audit ajoutés (axes 2-3-4) doivent VIVRE dans le SKILL.md
 * embarqué, et la copie LIVE (`~/.claude/skills`) ne doit pas diverger de celle du dépôt.
 *
 * Défaut vécu : les axes étaient écrits dans une copie seulement, donc l'app chargeait un kaizen
 * qui ignorait les conversations Autowin, les injections runtime et les lentilles workflow.
 * Contrôle négatif NOMMÉ : le SKILL.md du commit `74501455` (avant les 4 éditions) — s'il passait
 * ces assertions, le test ne prouverait rien.
 */
const AXES: Array<[string, RegExp]> = [
  ['axe 2 — conversations Autowin', /conversation_read|conversation_search/],
  ['axe 3 — injections runtime', /INJECTED instruction/],
  ['axe 4 — lentilles workflow', /WORKFLOW\/TOPOLOGY lenses/]
]

function kaizenPackage(): string {
  const root = bundledSkillsRoot()
  expect(root).toBeTruthy()
  return readFileSync(join(root!, 'kaizen', 'SKILL.md'), 'utf8')
}

describe('kaizen — périmètres d’audit et propagation package→live', () => {
  const texte = kaizenPackage()

  for (const [nom, motif] of AXES) {
    it(`le SKILL.md embarqué porte ${nom}`, () => {
      expect(motif.test(texte)).toBe(true)
    })
  }

  it('les axes sont ANNONCÉS dans le frontmatter (ce que l’app charge comme déclencheur)', () => {
    const front = texte.split('---')[1] ?? ''
    expect(front).toMatch(/AUTOWIN conversation/)
    expect(front).toMatch(/INJECTED instruction/)
  })

  it('contrôle négatif : la version d’avant les éditions ÉCHOUE ces axes', () => {
    const avant = execFileSync('git', ['show', '74501455:skills/kaizen/SKILL.md'], {
      encoding: 'utf8',
      cwd: bundledSkillsRoot()!.replace(/[\/]skills$/, '')
    })
    const portes = AXES.filter(([, motif]) => motif.test(avant))
    expect(portes).toHaveLength(0)
  })

  it('la copie live ~/.claude/skills/kaizen est identique au dépôt', () => {
    const live = join(homedir(), '.claude', 'skills', 'kaizen', 'SKILL.md')
    if (!existsSync(live)) return
    expect(readFileSync(live, 'utf8')).toBe(texte)
  })
})
