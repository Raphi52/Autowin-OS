import { execFileSync as vraiExec } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// Un execFileSync dans le process principal fige la fenêtre (gels.jsonl) : headShaOfWorkspace
// doit lire HEAD sur disque. On compte les lancements de git pendant l'appel.
const appels = vi.hoisted(() => ({ n: 0 }))
vi.mock('node:child_process', async (orig) => {
  const vrai = await orig<typeof import('node:child_process')>()
  return {
    ...vrai,
    execFileSync: (...a: Parameters<typeof vrai.execFileSync>) => {
      appels.n++
      return vrai.execFileSync(...a)
    }
  }
})

import { headShaOfWorkspace } from './brain-remember'

function git(cwd: string, ...args: string[]): string {
  return String(vraiExec('git', args, { cwd, encoding: 'utf8' })).trim()
}

function depot(): string {
  const root = mkdtempSync(join(tmpdir(), 'head-sans-git-'))
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 'a@b.c')
  git(root, 'config', 'user.name', 't')
  writeFileSync(join(root, 'x.ts'), 'x\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'i')
  return root
}

describe('headShaOfWorkspace — sans lancer git', () => {
  it('dépôt classique, référence en fichier puis groupée (packed-refs), copie de travail liée', () => {
    const root = depot()
    const attendu = git(root, 'rev-parse', 'HEAD')
    appels.n = 0
    expect(headShaOfWorkspace(root)).toBe(attendu)
    expect(headShaOfWorkspace(join(root))).toBe(attendu)
    expect(appels.n).toBe(0)

    git(root, 'pack-refs', '--all')
    appels.n = 0
    expect(headShaOfWorkspace(root)).toBe(attendu)
    expect(appels.n).toBe(0)

    const lie = `${root}-lie`
    git(root, 'worktree', 'add', '-q', '-b', 'lie', lie)
    appels.n = 0
    expect(headShaOfWorkspace(lie)).toBe(attendu)
    expect(appels.n).toBe(0)

    git(root, 'checkout', '-q', '--detach')
    appels.n = 0
    expect(headShaOfWorkspace(root)).toBe(attendu)
    expect(appels.n).toBe(0)
  })

  it('hors dépôt : vide, sans lancer git', () => {
    appels.n = 0
    expect(headShaOfWorkspace(mkdtempSync(join(tmpdir(), 'pas-depot-')))).toBe('')
    expect(appels.n).toBe(0)
  })
})
