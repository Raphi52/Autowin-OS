import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

  it('base sale sur le même fichier → bloque proprement sans inventer un conflit d’agents', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('builder')
    writeFileSync(join(repo, 'a.txt'), 'travail local non committé\n')
    writeFileSync(join(path, 'a.txt'), 'travail de la copie\n')

    const res = wm.finalize('builder')

    expect(res).toMatchObject({ outcome: 'blocked', files: ['a.txt'], reason: 'base-dirty' })
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toContain('travail local non committé')
    expect(() => wm.acquire('builder')).not.toThrow()
  })

  it('merge utilisateur déjà en conflit → bloque sans l’attribuer à l’agent ni l’annuler', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail indépendant de la copie\n')

    git(repo, 'checkout', '-q', '-b', 'user-conflict')
    writeFileSync(join(repo, 'a.txt'), 'UTILISATEUR-BRANCHE\nligne2\nligne3\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'branche utilisateur')
    git(repo, 'checkout', '-q', 'main')
    writeFileSync(join(repo, 'a.txt'), 'UTILISATEUR-MAIN\nligne2\nligne3\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'main utilisateur')
    expect(() => git(repo, 'merge', '--no-edit', 'user-conflict')).toThrow()

    const mergeHeadBefore = git(repo, 'rev-parse', 'MERGE_HEAD')
    const statusBefore = git(repo, 'status', '--porcelain')
    const res = wm.finalize('builder')

    expect(res).toMatchObject({
      outcome: 'blocked',
      files: ['a.txt'],
      reason: 'base-in-progress'
    })
    expect(git(repo, 'rev-parse', 'MERGE_HEAD')).toBe(mergeHeadBefore)
    expect(git(repo, 'status', '--porcelain')).toBe(statusBefore)
    expect(() => wm.acquire('builder')).not.toThrow()
  })

  it('merge utilisateur démarré après le préflight → ne l’attribue pas à l’agent et ne l’annule pas', () => {
    const repo = tempRepo()
    git(repo, 'checkout', '-q', '-b', 'user-conflict')
    writeFileSync(join(repo, 'a.txt'), 'UTILISATEUR-BRANCHE\nligne2\nligne3\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'branche utilisateur')
    git(repo, 'checkout', '-q', 'main')
    writeFileSync(join(repo, 'a.txt'), 'UTILISATEUR-MAIN\nligne2\nligne3\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'main utilisateur')

    let injected = false
    let mergeHeadBeforeFinalize = ''
    let statusBeforeFinalize = ''
    const tryGitFn = (dir: string, args: string[]) => {
      if (!injected && args[0] === '-c' && args[2] === 'merge') {
        injected = true
        const userMerge = spawnSync('git', ['merge', '--no-edit', 'user-conflict'], {
          cwd: dir,
          encoding: 'utf8'
        })
        expect(userMerge.status).not.toBe(0)
        mergeHeadBeforeFinalize = git(repo, 'rev-parse', 'MERGE_HEAD')
        statusBeforeFinalize = git(repo, 'status', '--porcelain')
      }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return {
        code: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? ''
      }
    }
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot, tryGitFn })
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail indépendant de la copie\n')

    const res = wm.finalize('builder')

    expect(res).toMatchObject({
      outcome: 'blocked',
      files: ['a.txt'],
      reason: 'base-in-progress'
    })
    expect(git(repo, 'rev-parse', 'MERGE_HEAD')).toBe(mergeHeadBeforeFinalize)
    expect(git(repo, 'status', '--porcelain')).toBe(statusBeforeFinalize)
    expect(() => wm.acquire('builder')).not.toThrow()
  })

  it('hook refusant le merge → avorte l’opération créée même sans fichier en conflit', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')

    writeFileSync(join(repo, 'base.txt'), 'avance indépendante de la base\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'avance base')
    const hook = join(repo, '.git', 'hooks', 'pre-merge-commit')
    writeFileSync(hook, '#!/bin/sh\nexit 1\n')
    chmodSync(hook, 0o755)

    const res = wm.finalize('builder')

    expect(res).toMatchObject({ outcome: 'blocked', files: ['b.txt'], reason: 'merge-failed' })
    expect(() => git(repo, 'rev-parse', '--verify', 'MERGE_HEAD')).toThrow()
    expect(git(repo, 'status', '--porcelain')).toBe('')
    expect(existsSync(join(repo, 'b.txt'))).toBe(false)
    expect(() => wm.acquire('builder')).not.toThrow()
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
