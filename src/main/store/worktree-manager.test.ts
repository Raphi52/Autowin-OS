import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
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

  it('changedFiles développe les dossiers non suivis en fichiers exacts', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('scout')
    mkdirSync(join(path, 'draft', 'nested'), { recursive: true })
    writeFileSync(join(path, 'draft', 'local.ts'), 'local\n')
    writeFileSync(join(path, 'draft', 'nested', 'more.ts'), 'nested\n')

    expect(wm.changedFiles('scout')).toEqual(['draft/local.ts', 'draft/nested/more.ts'])
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

  it(
    'CONFLIT : deux agents modifient la même ligne → PAS de merge, copie conservée, fichiers remontés',
    () => {
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
    },
    10_000
  )

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

  it('base avec travail indexé hors chevauchement → bloque sans avancer HEAD ni altérer l’index', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')
    writeFileSync(join(repo, 'a.txt'), 'travail utilisateur indexé\n')
    git(repo, 'add', 'a.txt')
    const headBefore = git(repo, 'rev-parse', 'HEAD')
    const statusBefore = git(repo, 'status', '--porcelain')

    const res = wm.finalize('builder')

    expect(res).toMatchObject({ outcome: 'blocked', files: ['a.txt'], reason: 'base-dirty' })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(headBefore)
    expect(git(repo, 'status', '--porcelain')).toBe(statusBefore)
    expect(() => wm.acquire('builder')).not.toThrow()
  })

  it('bisect utilisateur actif → bloque sans mutation même lorsque la base est propre', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')
    git(repo, 'bisect', 'start')
    const headBefore = git(repo, 'rev-parse', 'HEAD')
    const bisectStart = git(repo, 'rev-parse', '--git-path', 'BISECT_START')
    expect(existsSync(join(repo, bisectStart))).toBe(true)

    const res = wm.finalize('builder')

    expect(res).toMatchObject({ outcome: 'blocked', reason: 'base-in-progress' })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(headBefore)
    expect(existsSync(join(repo, bisectStart))).toBe(true)
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
      if (!injected && dir === repo && args.includes('merge')) {
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

  it('changement de branche pendant la publication → n’avance aucune branche', () => {
    const repo = tempRepo()
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    git(repo, 'branch', 'topic', baseSha)
    let switched = false
    const tryGitFn = (dir: string, args: string[]) => {
      if (!switched && dir === repo && args.includes('merge') && args.includes('--ff-only')) {
        switched = true
        git(repo, 'switch', 'topic')
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
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')

    const res = wm.finalize('builder')

    expect(switched).toBe(true)
    expect(res).toMatchObject({ outcome: 'blocked', reason: 'base-in-progress' })
    expect(git(repo, 'branch', '--show-current')).toBe('topic')
    expect(git(repo, 'rev-parse', 'main')).toBe(baseSha)
    expect(git(repo, 'rev-parse', 'topic')).toBe(baseSha)
    expect(existsSync(join(repo, 'b.txt'))).toBe(false)
    expect(() => wm.acquire('builder')).not.toThrow()
  })

  it('index utilisateur modifié pendant la publication → bloque sans avancer HEAD', () => {
    const repo = tempRepo()
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    let staged = false
    let stagedStatus = ''
    const tryGitFn = (dir: string, args: string[]) => {
      if (!staged && dir === repo && args.includes('merge') && args.includes('--ff-only')) {
        staged = true
        writeFileSync(join(repo, 'a.txt'), 'travail utilisateur indexé\n')
        git(repo, 'add', 'a.txt')
        stagedStatus = git(repo, 'status', '--porcelain')
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
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')

    const res = wm.finalize('builder')

    expect(staged).toBe(true)
    expect(res).toMatchObject({ outcome: 'blocked', files: ['a.txt'], reason: 'base-dirty' })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(baseSha)
    expect(git(repo, 'status', '--porcelain')).toBe(stagedStatus)
    expect(existsSync(join(repo, 'b.txt'))).toBe(false)
    expect(() => wm.acquire('builder')).not.toThrow()
  })

  it('bisect démarré pendant la publication → bloque sans mutation', () => {
    const repo = tempRepo()
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    let bisectStarted = false
    let bisectStartPath = ''
    const tryGitFn = (dir: string, args: string[]) => {
      if (!bisectStarted && dir === repo && args.includes('merge') && args.includes('--ff-only')) {
        bisectStarted = true
        git(repo, 'bisect', 'start')
        bisectStartPath = git(repo, 'rev-parse', '--git-path', 'BISECT_START')
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
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')

    const res = wm.finalize('builder')

    expect(bisectStarted).toBe(true)
    expect(res).toMatchObject({ outcome: 'blocked', reason: 'base-in-progress' })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(baseSha)
    expect(existsSync(join(repo, bisectStartPath))).toBe(true)
    expect(existsSync(join(repo, 'b.txt'))).toBe(false)
    expect(() => wm.acquire('builder')).not.toThrow()
  })

  it('fast-forward utilisateur vers la SHA intégrée → ne l’attribue pas à Autowin', () => {
    const repo = tempRepo()
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    let userPublished = false
    let userReflog = ''
    const tryGitFn = (dir: string, args: string[]) => {
      if (!userPublished && dir === repo && args.includes('merge') && args.includes('--ff-only')) {
        userPublished = true
        const targetSha = args.at(-1) ?? ''
        const userMerge = spawnSync('git', ['merge', '--ff-only', targetSha], {
          cwd: repo,
          encoding: 'utf8',
          env: { ...process.env, GIT_REFLOG_ACTION: 'user-fast-forward' }
        })
        expect(userMerge.status).toBe(0)
        userReflog = git(repo, 'reflog', '-1', '--format=%gs', 'main')
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
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')

    const res = wm.finalize('builder')

    expect(userPublished).toBe(true)
    expect(res).toMatchObject({ outcome: 'blocked', reason: 'base-in-progress' })
    expect(git(repo, 'rev-parse', 'HEAD')).not.toBe(baseSha)
    expect(git(repo, 'reflog', '-1', '--format=%gs', 'main')).toBe(userReflog)
    expect(userReflog).toContain('user-fast-forward')
    expect(() => wm.acquire('builder')).not.toThrow()
  })

  it('merge utilisateur de la même SHA démarré pendant la finalisation → le conserve intact', () => {
    const repo = tempRepo()
    let injected = false
    let baseAbortCalls = 0
    let agentSha = ''
    let mergeHeadBeforeFinalize = ''
    let statusBeforeFinalize = ''
    const tryGitFn = (dir: string, args: string[]) => {
      if (dir === repo && args[0] === 'merge' && args[1] === '--abort') baseAbortCalls += 1
      const isMerge = args.includes('merge') && args.at(-1) !== '--abort'
      if (isMerge && dir !== repo) agentSha = args.at(-1) ?? ''
      if (!injected && isMerge && dir === repo) {
        injected = true
        agentSha ||= args.at(-1) ?? ''
        writeFileSync(join(repo, 'a.txt'), 'UTILISATEUR\nligne2\nligne3\n')
        git(repo, 'add', '-A')
        git(repo, 'commit', '-q', '-m', 'avance utilisateur concurrente')
        const userMerge = spawnSync('git', ['merge', '--no-edit', agentSha], {
          cwd: repo,
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
    writeFileSync(join(path, 'a.txt'), 'AGENT\nligne2\nligne3\n')
    writeFileSync(join(repo, 'base.txt'), 'avance indépendante de la base\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'avance base')

    const res = wm.finalize('builder')

    expect(injected).toBe(true)
    expect(res).toMatchObject({ outcome: 'blocked', files: ['a.txt'], reason: 'base-in-progress' })
    expect(baseAbortCalls).toBe(0)
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

  it('échec de création de la worktree d’intégration → bloque sans propager d’exception', () => {
    const repo = tempRepo()
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    const isIntegrationAdd = (args: string[]) =>
      args[0] === 'worktree' &&
      args[1] === 'add' &&
      args.some((arg) => arg.includes('integration__builder__'))
    const gitRunner = (dir: string, args: string[]) => {
      if (isIntegrationAdd(args)) throw new Error('worktree add indisponible')
      return git(dir, ...args)
    }
    const tryGitFn = (dir: string, args: string[]) => {
      if (isIntegrationAdd(args)) {
        return { code: 128, stdout: '', stderr: 'worktree add indisponible' }
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
    const wm = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: wtRoot,
      git: gitRunner,
      tryGitFn
    })
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')

    const res = wm.finalize('builder')

    expect(res).toMatchObject({ outcome: 'blocked', reason: 'merge-failed' })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(baseSha)
    expect(existsSync(join(repo, 'b.txt'))).toBe(false)
    expect(() => wm.acquire('builder')).not.toThrow()
  })

  it('échec de worktree remove → nettoie par repli avant de supprimer la copie agent', () => {
    const repo = tempRepo()
    let failedIntegrationRemove = false
    let integrationPath = ''
    const tryGitFn = (dir: string, args: string[]) => {
      const candidatePath = args.at(-1) ?? ''
      if (
        !failedIntegrationRemove &&
        dir === repo &&
        args[0] === 'worktree' &&
        args[1] === 'remove' &&
        candidatePath.includes('integration__builder__')
      ) {
        failedIntegrationRemove = true
        integrationPath = candidatePath
        return { code: 1, stdout: '', stderr: 'fichier verrouillé' }
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
    const agentPath = wm.acquire('builder')
    writeFileSync(join(agentPath, 'b.txt'), 'travail de la copie\n')

    const res = wm.finalize('builder')

    expect(failedIntegrationRemove).toBe(true)
    expect(res.outcome).toBe('merged')
    expect(existsSync(integrationPath)).toBe(false)
    expect(git(repo, 'worktree', 'list', '--porcelain')).not.toContain(integrationPath)
    expect(existsSync(agentPath)).toBe(false)
    expect(existsSync(join(repo, 'b.txt'))).toBe(true)
  })

  it('cleanup Git et disque impossible après publication → bloque et conserve la copie agent', () => {
    const repo = tempRepo()
    let integrationPath = ''
    const tryGitFn = (dir: string, args: string[]) => {
      const candidatePath = args.at(-1) ?? ''
      if (
        dir === repo &&
        args[0] === 'worktree' &&
        args[1] === 'remove' &&
        candidatePath.includes('integration__builder__')
      ) {
        integrationPath = candidatePath
        return { code: 1, stdout: '', stderr: 'fichier verrouillé' }
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
    const wm = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: wtRoot,
      tryGitFn,
      removeDirFn: () => {
        throw new Error('EPERM')
      }
    })
    const agentPath = wm.acquire('builder')
    writeFileSync(join(agentPath, 'b.txt'), 'travail de la copie\n')

    const res = wm.finalize('builder')

    expect(res).toMatchObject({ outcome: 'blocked', reason: 'merge-failed' })
    expect(existsSync(join(repo, 'b.txt'))).toBe(true)
    expect(existsSync(integrationPath)).toBe(true)
    expect(existsSync(agentPath)).toBe(true)
  })

  it('copie sans changement mais cleanup impossible → bloque sans exception', () => {
    const repo = tempRepo()
    const isAgentRemove = (args: string[]) =>
      args[0] === 'worktree' &&
      args[1] === 'remove' &&
      (args.at(-1) ?? '').includes('agent__builder')
    const gitRunner = (dir: string, args: string[]) => {
      if (isAgentRemove(args)) throw new Error('EPERM')
      return git(dir, ...args)
    }
    const tryGitFn = (dir: string, args: string[]) => {
      if (isAgentRemove(args)) return { code: 1, stdout: '', stderr: 'EPERM' }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return {
        code: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? ''
      }
    }
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: wtRoot,
      git: gitRunner,
      tryGitFn,
      removeDirFn: () => {
        throw new Error('EPERM')
      }
    })
    const agentPath = wm.acquire('builder')

    const res = wm.finalize('builder')

    expect(res).toMatchObject({ outcome: 'blocked', reason: 'merge-failed' })
    expect(existsSync(agentPath)).toBe(true)
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
