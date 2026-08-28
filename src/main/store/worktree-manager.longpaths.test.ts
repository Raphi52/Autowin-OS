/**
 * Sous Windows, `git worktree add` échoue (« Filename too long ») sur les dépôts dont un chemin
 * suivi dépasse MAX_PATH, sauf si `core.longpaths=true` est actif. La copie agent vit sous
 * `.autowin-data/.../worktrees/agent__run-...`, c'est-à-dire PLUS PROFOND que le dépôt lui-même :
 * le dépôt utilisateur peut être clonable et la copie agent, non.
 *
 * Le correctif passe l'option par la LIGNE DE COMMANDE (`git -c core.longpaths=true worktree add`)
 * et non par la config du dépôt : Autowin ne modifie pas la configuration de l'utilisateur.
 */
import { afterEach, describe, expect, it } from 'vitest'

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { WorktreeManager } from './worktree-manager'

const roots: string[] = []
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
}

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'autowin-lp-'))
  roots.push(dir)
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 't@t')
  git(dir, 'config', 'user.name', 'T')
  git(dir, 'config', 'commit.gpgsign', 'false')
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir })
  return dir
}

const PREFIXE = ['-c', 'core.longpaths=true']

describe('worktree add porte core.longpaths', () => {
  it('passe -c core.longpaths=true à la fonction git injectée lors de acquire()', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-lproot-'))
    roots.push(wtRoot)
    const appels: string[][] = []
    const manager = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: wtRoot,
      git: (dir, args) => {
        appels.push(args)
        return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
      },
      tryGitFn: (dir, args) => {
        appels.push(args)
        const r = execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
        return { code: 0, stdout: r, stderr: '' }
      }
    })
    manager.acquire('run-longpaths-1')

    const adds = appels.filter((args) => args.includes('worktree') && args.includes('add'))
    expect(adds.length).toBeGreaterThan(0)
    for (const args of adds) expect(args.slice(0, 2)).toEqual(PREFIXE)
  })

  /**
   * Oracle statique : le test ci-dessus n'exerce qu'UN des sites d'appel (celui de `acquire`). Les
   * autres sites (restauration de recovery, worktree d'intégration, ré-extraction après avance de
   * branche) ne sont pas atteignables sans monter chacun leur scénario ; ce garde-fou couvre les
   * SIX autres et échoue si un nouveau site est ajouté sans le préfixe.
   *
   * Entrée qui doit faire échouer ce test si la correction est fausse : un appel écrit
   * `this.git(this.baseRepo, ['worktree', 'add', ...])` — c'est exactement la forme d'avant-fix.
   */
  it('aucun site de worktree add dans la source ne démarre par la sous-commande', () => {
    const source = readFileSync(join(__dirname, 'worktree-manager.ts'), 'utf8')
    const sitesNus = source.match(/\[\s*'worktree',\s*\n?\s*'add'/g) ?? []
    expect(sitesNus).toEqual([])
    const sitesPrefixes =
      source.match(
        /\[\s*'-c',\s*\n?\s*'core\.longpaths=true',\s*\n?\s*'worktree',\s*\n?\s*'add'/g
      ) ?? []
    expect(sitesPrefixes.length).toBe(7)
  })
})
