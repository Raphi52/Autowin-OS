import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  headShaOfWorkspace,
  rememberFact,
  repairSourceLocator,
  sourceLocatorProblem
} from './brain-remember'

/**
 * UNE RÉVISION SYMBOLIQUE NE DOIT PLUS JETER LE FAIT.
 *
 * Mesuré le 2026-09-11 sur les traces causales : 19 refus « locator non vérifiable » sur 150 appels,
 * dont 18 portaient un `git:<chemin>` valide dont seule la révision manquait ou valait `@HEAD`,
 * `@working`, `@working-tree`. Le sha est une donnée que l'app tient : elle le copie.
 */
const SHA = '9218eaf1c0de9218eaf1c0de9218eaf1c0de9218'
const resolu = (): string => SHA

describe('la révision d’un locator git se résout au lieu d’être refusée', () => {
  it('complète une révision absente', () => {
    expect(repairSourceLocator('git:src/main/x.ts', '/dépôt', resolu)).toBe(
      `git:src/main/x.ts@${SHA}`
    )
  })

  it.each(['HEAD', 'working', 'working-tree', 'current'])('remplace @%s', (revision) => {
    expect(repairSourceLocator(`git:src/main/x.ts@${revision}`, '/dépôt', resolu)).toBe(
      `git:src/main/x.ts@${SHA}`
    )
  })

  it('laisse INTACT un locator déjà conforme', () => {
    const bon = `git:src/main/x.ts@${SHA}`
    expect(repairSourceLocator(bon, '/dépôt', resolu)).toBe(bon)
  })

  it('n’invente rien quand aucun sha n’est disponible', () => {
    const source = 'git:src/main/x.ts@HEAD'
    expect(repairSourceLocator(source, undefined, () => '')).toBe(source)
    expect(sourceLocatorProblem(source)).toBeTruthy()
  })

  it('ne répare pas une révision concrète mais malformée — ce serait masquer une source fausse', () => {
    const source = 'git:src/main/x.ts@abc'
    expect(repairSourceLocator(source, '/dépôt', resolu)).toBe(source)
  })

  it('ne touche pas les autres schémas', () => {
    expect(repairSourceLocator('session:conv-472', '/dépôt', resolu)).toBe('session:conv-472')
  })

  it('lit le sha réel d’un dépôt git, et rend vide hors dépôt', () => {
    const root = mkdtempSync(join(tmpdir(), 'locator-'))
    expect(headShaOfWorkspace(root)).toBe('')
    execFileSync('git', ['init', '-q'], { cwd: root })
    execFileSync('git', ['config', 'user.email', 'a@b.c'], { cwd: root })
    execFileSync('git', ['config', 'user.name', 'test'], { cwd: root })
    writeFileSync(join(root, 'x.ts'), 'export const x = 1\n', 'utf8')
    execFileSync('git', ['add', '.'], { cwd: root })
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: root })
    expect(headShaOfWorkspace(root)).toMatch(/^[0-9a-f]{7,64}$/)
  })

  it('rememberFact accepte le fait au lieu de le jeter', async () => {
    const root = mkdtempSync(join(tmpdir(), 'locator-fait-'))
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'autowin-os' }), 'utf8')
    execFileSync('git', ['init', '-q'], { cwd: root })
    execFileSync('git', ['config', 'user.email', 'a@b.c'], { cwd: root })
    execFileSync('git', ['config', 'user.name', 'test'], { cwd: root })
    execFileSync('git', ['add', '.'], { cwd: root })
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: root })

    const outcome = await rememberFact(
      {
        title: 'un fait durable',
        fact: 'un fait autoporté, relisible dans trois mois sans cette conversation.',
        type: 'lesson',
        source: 'git:src/main/commands.ts@HEAD'
      },
      { workspace: root }
    )
    expect(outcome.allowed).toBe(true)
    expect(outcome.reason).toBeUndefined()
    expect(outcome.fact?.source).toMatch(/^git:src\/main\/commands\.ts@[0-9a-f]{7,64}$/)
  })
})
