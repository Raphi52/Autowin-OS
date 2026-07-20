import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { snapshotWorkspace } from './branch-snapshots'

const dirs: string[] = []
function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'autowin-snap-'))
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

describe('snapshotWorkspace (isolé, R1-proof)', () => {
  it('capture l’état courant (suivi + non suivi) sans toucher working tree / HEAD / index', () => {
    const repo = tempRepo()
    const headBefore = gitOut(repo, 'rev-parse', 'HEAD')
    const statusBefore = gitOut(repo, 'status', '--porcelain')
    // modifie un fichier suivi + ajoute un non suivi
    writeFileSync(join(repo, 'a.txt'), 'v2')
    writeFileSync(join(repo, 'b.txt'), 'nouveau')

    const snap = snapshotWorkspace(repo, 'turn-1')
    expect(snap).toMatch(/^[0-9a-f]{40}$/) // sha de commit

    // le snapshot contient l'état courant (v2 + b.txt)
    expect(gitOut(repo, 'show', `${snap}:a.txt`)).toBe('v2')
    expect(gitOut(repo, 'show', `${snap}:b.txt`)).toBe('nouveau')

    // NON destructif : working tree, HEAD et index utilisateur intacts
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('v2')
    expect(gitOut(repo, 'rev-parse', 'HEAD')).toBe(headBefore)
    // l'index utilisateur n'a pas été modifié (b.txt reste non suivi, a.txt reste non stagé)
    expect(gitOut(repo, 'status', '--porcelain')).not.toBe(statusBefore) // état working modifié...
    expect(gitOut(repo, 'diff', '--cached', '--name-only')).toBe('') // ...mais rien stagé par le snapshot
  })

  it('chaîne le snapshot sur HEAD comme parent (historique navigable)', () => {
    const repo = tempRepo()
    const head = gitOut(repo, 'rev-parse', 'HEAD')
    const snap = snapshotWorkspace(repo, 'turn-1')
    expect(gitOut(repo, 'rev-parse', `${snap}^`)).toBe(head)
  })

  it('capture la SUPPRESSION d’un fichier suivi (pas seulement add/modify)', () => {
    const repo = tempRepo() // a.txt suivi
    rmSync(join(repo, 'a.txt'))
    const snap = snapshotWorkspace(repo, 'après suppression')
    // a.txt absent de l'arbre du snapshot
    expect(() => gitOut(repo, 'show', `${snap}:a.txt`)).toThrow()
  })

  it('gère un repo SANS commit initial (snapshot orphelin, sans parent)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'autowin-snap-noinit-'))
    dirs.push(dir)
    execFileSync('git', ['init', '-q'], { cwd: dir })
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
    execFileSync('git', ['config', 'user.name', 'T'], { cwd: dir })
    execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir })
    writeFileSync(join(dir, 'x.txt'), 'contenu')
    const snap = snapshotWorkspace(dir, 'premier snapshot')
    expect(snap).toMatch(/^[0-9a-f]{40}$/)
    expect(gitOut(dir, 'show', `${snap}:x.txt`)).toBe('contenu')
    // orphelin : pas de parent
    expect(gitOut(dir, 'rev-list', '--count', snap)).toBe('1')
  })
})
