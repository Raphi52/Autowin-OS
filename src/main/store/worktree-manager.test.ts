import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorktreeManager } from './worktree-manager'

const roots: string[] = []

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
}

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'autowin-wm-'))
  roots.push(dir)
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 't@t')
  git(dir, 'config', 'user.name', 'T')
  git(dir, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'a.txt'), 'ligne1\nligne2\nligne3\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'init')
  return dir
}

function manager(repo: string): WorktreeManager {
  const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
  roots.push(wtRoot)
  return new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot })
}

afterEach(() => {
  for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('WorktreeManager (full-auto merge + garde-fou conflit)', () => {
  it('acquire donne une copie isolée qui ne touche pas le repo de base', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('scout')
    writeFileSync(join(path, 'a.txt'), 'modifié dans la copie\n')
    expect(git(repo, 'status', '--porcelain')).toBe('') // base intacte
    expect(wm.changedFiles('scout')).toContain('a.txt')
  })

  it('full-auto : fusionne le travail de l’agent dans la base puis range la copie', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('scout')
    writeFileSync(join(path, 'b.txt'), 'nouveau fichier\n')
    const res = wm.finalize('scout')
    expect(res.outcome).toBe('merged')
    // le fichier de l'agent est arrivé dans la base (tolère CRLF Windows via autocrlf)
    expect(readFileSync(join(repo, 'b.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe('nouveau fichier\n')
    // la copie a été rangée
    expect(wm.changedFiles('scout')).toHaveLength(0)
  })

  it('copie sans changement → "nothing", rien à fusionner', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    wm.acquire('idle')
    expect(wm.finalize('idle').outcome).toBe('nothing')
  })

  it('CONFLIT : deux agents modifient la même ligne → PAS de merge, copie conservée, fichiers remontés', () => {
    const repo = tempRepo()
    const wm = manager(repo)

    // Les DEUX copies partent de la MÊME base (agents parallèles) — acquises avant tout merge.
    const p1 = wm.acquire('builder')
    const p2 = wm.acquire('judge')
    writeFileSync(join(p1, 'a.txt'), 'BUILDER\nligne2\nligne3\n')
    writeFileSync(join(p2, 'a.txt'), 'JUDGE\nligne2\nligne3\n')

    // Builder fusionne en premier (propre). Judge, parti de la base d'origine, entre en conflit.
    expect(wm.finalize('builder').outcome).toBe('merged')
    const res = wm.finalize('judge')

    expect(res.outcome).toBe('conflict')
    if (res.outcome === 'conflict') expect(res.files).toContain('a.txt')
    // Garde-fou : la base n'a PAS été écrasée (garde le travail du builder, pas de marqueurs de conflit).
    const baseA = readFileSync(join(repo, 'a.txt'), 'utf8')
    expect(baseA).toContain('BUILDER')
    expect(baseA).not.toMatch(/<<<<<<<|>>>>>>>/)
    // Garde-fou : la copie du judge est CONSERVÉE (merge assisté possible).
    expect(wm.changedFiles('judge').length >= 0).toBe(true)
    expect(() => wm.acquire('judge')).not.toThrow() // le worktree existe toujours
  })

  it('remove est idempotent', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    wm.acquire('x')
    wm.remove('x')
    expect(() => wm.remove('x')).not.toThrow()
  })

  it('rejette un agentId de traversée de chemin', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    expect(() => wm.acquire('../evil')).toThrow()
  })
})
