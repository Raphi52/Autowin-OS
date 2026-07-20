import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { snapshotWorkspace } from './branch-snapshots'
import { restoreWorkspace, RestoreFailedError } from './branch-restore'

const dirs: string[] = []
function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'autowin-restore-'))
  dirs.push(dir)
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  }
  git('init', '-q')
  git('config', 'user.email', 't@t')
  git('config', 'user.name', 'T')
  git('config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'a.txt'), 'v1')
  git('add', '-A')
  git('commit', '-q', '-m', 'init')
  return dir
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
const gitOut = (dir: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()

describe('restoreWorkspace (sûr, réversible)', () => {
  it('restaure le contenu du snapshot, garde les fichiers créés après, et renvoie un snapshot de sécurité', () => {
    const repo = tempRepo()
    const snap = snapshotWorkspace(repo, 'état v1') // a.txt = v1

    // état ultérieur : modifie a.txt + ajoute un fichier
    writeFileSync(join(repo, 'a.txt'), 'v2')
    writeFileSync(join(repo, 'c.txt'), 'extra')

    const safety = restoreWorkspace(repo, snap)

    // a.txt revenu à v1
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('v1')
    // NON destructif : c.txt (créé après le snapshot) conservé
    expect(existsSync(join(repo, 'c.txt'))).toBe(true)
    // réversibilité (R4) : le safety capture l'état pré-restore (v2 + c.txt)
    expect(safety).toMatch(/^[0-9a-f]{40}$/)
    expect(gitOut(repo, 'show', `${safety}:a.txt`)).toBe('v2')
    expect(gitOut(repo, 'show', `${safety}:c.txt`)).toBe('extra')
    // HEAD non déplacé
    expect(gitOut(repo, 'rev-parse', 'HEAD')).toBe(gitOut(repo, 'rev-parse', 'HEAD'))
  })

  it('permet d’annuler un restore en restaurant le safety', () => {
    const repo = tempRepo()
    const snap = snapshotWorkspace(repo, 'v1')
    writeFileSync(join(repo, 'a.txt'), 'v2')
    const safety = restoreWorkspace(repo, snap)
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('v1')
    restoreWorkspace(repo, safety) // undo
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('v2')
  })

  it('sur échec (snapshot invalide), lève une RestoreFailedError portant le safetySha (R4)', () => {
    const repo = tempRepo()
    writeFileSync(join(repo, 'a.txt'), 'v2') // état courant à préserver
    let caught: unknown
    try {
      restoreWorkspace(repo, '0000000000000000000000000000000000000000')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(RestoreFailedError)
    const err = caught as RestoreFailedError
    expect(err.safetySha).toMatch(/^[0-9a-f]{40}$/)
    // le safety capture bien l'état pré-restore → annulation possible
    expect(gitOut(repo, 'show', `${err.safetySha}:a.txt`)).toBe('v2')
  })
})
