import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests joués contre de VRAIS dépôts git en tmp (init, worktree, merge) : sous la charge parallèle
 * de la suite complète, ces I/O dépassent le budget vitest par défaut (5 s) — d'où des rouges
 * aléatoires alors que le code est bon. Budget explicite, assez large pour la contention, assez
 * serré pour attraper un vrai blocage.
 */
vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorktreeManager } from './worktree-manager'
import {
  detachedCommit,
  git,
  manager,
  nettoyerRacines,
  roots,
  tempRepo,
  type CompensationIndexLockProbe
} from './worktree-manager.test-helpers'

afterEach(nettoyerRacines)

describe('WorktreeManager — recuperation (20/81 de la suite d’origine)', () => {
  it('énumère les changements locaux exclus du snapshot remis à l’agent', () => {
    const repo = tempRepo()
    writeFileSync(join(repo, 'local-only.txt'), 'pas commité\n')

    const context = manager(repo).describeForLaunch('dirty')

    expect(context.excludedDirtyFiles).toEqual(['local-only.txt'])
  })

  it('inventorie uniquement les copies agent récupérables après redémarrage', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot })
    wm.acquire('run-z')
    wm.acquire('run-a')
    mkdirSync(join(wtRoot, 'integration__run-z__temporary'))
    mkdirSync(join(wtRoot, 'agent__invalid.name'))

    expect(wm.listAgentIds()).toEqual(['run-a', 'run-z'])
  })

  it('conserve le lease si seul le chemin de la même identité devient lisible', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    let identity = '638904000000000000|'
    const wm = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: wtRoot,
      processIdentityFn: () => identity
    })
    wm.markProcess('run-same-process', process.pid, true)

    identity = '638904000000000000|C:\\Tools\\claude.exe'

    expect(wm.hasActiveProcesses('run-same-process')).toBe(true)
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

  it('acquiert exactement la branche et la SHA capturées même si HEAD change entre-temps', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    git(repo, 'switch', '-c', 'topic')
    writeFileSync(join(repo, 'topic.txt'), 'uniquement topic\n')
    git(repo, 'add', 'topic.txt')
    git(repo, 'commit', '-q', '-m', 'topic diverge')
    git(repo, 'switch', 'main')

    const context = wm.describe('run-race')
    git(repo, 'switch', 'topic')
    const path = wm.acquire('run-race', context)
    writeFileSync(join(path, 'agent.txt'), 'travail agent\n')

    expect(git(path, 'rev-parse', 'HEAD')).toBe(context.baseSha)
    git(repo, 'switch', 'main')
    expect(wm.finalize('run-race', { baseBranch: context.baseBranch }).outcome).toBe('merged')
    expect(existsSync(join(repo, 'agent.txt'))).toBe(true)
    expect(existsSync(join(repo, 'topic.txt'))).toBe(false)
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

  it('base avancée après l ancre → libère l ancre puis réussit au retry', () => {
    const repo = tempRepo()
    let advanced = false
    const tryGitFn = (dir: string, args: string[]) => {
      if (!advanced && dir === repo && args.includes('merge') && args.includes('--ff-only')) {
        advanced = true
        writeFileSync(join(repo, 'concurrent.txt'), 'avance concurrente\n')
        git(repo, 'add', 'concurrent.txt')
        git(repo, 'commit', '-q', '-m', 'avance concurrente')
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

    const first = wm.finalize('builder')

    expect(first).toMatchObject({ outcome: 'blocked', reason: 'base-in-progress' })
    expect(() => git(repo, 'rev-parse', 'refs/autowin/publications/builder')).toThrow()

    const retried = wm.finalize('builder')

    expect(retried).toMatchObject({ outcome: 'merged' })
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('travail de la copie')
    expect(readFileSync(join(repo, 'concurrent.txt'), 'utf8')).toContain('avance concurrente')
    expect(git(repo, 'rev-parse', 'refs/autowin/publications/builder')).toMatch(/^[0-9a-f]{40}$/)
  })

  it('hook désindexant seulement la version agent → restaure aussi le worktree de base', () => {
    const repo = tempRepo()
    writeFileSync(join(repo, 'b.txt'), 'version de base\n')
    git(repo, 'add', 'b.txt')
    git(repo, 'commit', '-q', '-m', 'ajout b')
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    const baseIndexTree = git(repo, 'write-tree')
    const hooksPath = join(repo, git(repo, 'rev-parse', '--git-path', 'hooks'))
    mkdirSync(hooksPath, { recursive: true })
    const hookPath = join(hooksPath, 'reference-transaction')
    writeFileSync(
      hookPath,
      `#!/bin/sh
state="$1"
payload=$(cat)
if [ "$state" = "prepared" ] && printf '%s\n' "$payload" | grep -q 'refs/heads/main'; then
  root=$(git rev-parse --show-toplevel) || exit 30
  git -C "$root" restore --staged --source=HEAD -- b.txt || exit 31
fi
exit 0
`
    )
    chmodSync(hookPath, 0o755)
    const wm = manager(repo)
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'version agent\n')

    const res = wm.finalize('builder')

    expect(res).toMatchObject({ outcome: 'blocked', reason: 'base-in-progress' })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(baseSha)
    expect(git(repo, 'write-tree')).toBe(baseIndexTree)
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('version de base')
    expect(git(repo, 'status', '--porcelain')).toBe('')
  })

  it('hook utilisateur indexant un fichier distinct → retire le fichier agent et préserve le hook', () => {
    const repo = tempRepo()
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    const hooksPath = join(repo, git(repo, 'rev-parse', '--git-path', 'hooks'))
    mkdirSync(hooksPath, { recursive: true })
    const hookPath = join(hooksPath, 'reference-transaction')
    writeFileSync(
      hookPath,
      `#!/bin/sh
state="$1"
payload=$(cat)
if [ "$state" = "prepared" ] && printf '%s\n' "$payload" | grep -q 'refs/heads/main'; then
  root=$(git rev-parse --show-toplevel) || exit 30
  printf 'travail utilisateur distinct\n' > "$root/a.txt" || exit 31
  git -C "$root" add a.txt || exit 32
fi
exit 0
`
    )
    chmodSync(hookPath, 0o755)
    const wm = manager(repo)
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')

    const res = wm.finalize('builder')
    expect(res).toMatchObject({
      outcome: 'blocked',
      files: ['a.txt'],
      reason: 'base-in-progress'
    })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(baseSha)
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toContain('travail utilisateur distinct')
    expect(existsSync(join(repo, 'b.txt'))).toBe(false)
    expect(git(repo, 'status', '--porcelain')).toBe('M  a.txt')
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

  it('git add pendant le snapshot CAS → refuse sans désindexer l’action humaine', () => {
    const repo = tempRepo()
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    let compensationAnchored = false
    let indexedDuringSnapshot = false
    const tryGitFn = (dir: string, args: string[]) => {
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      const updateRef = args.indexOf('update-ref')
      if (
        dir === repo &&
        result.status === 0 &&
        updateRef >= 0 &&
        args[updateRef + 1]?.endsWith('/resume-worktree')
      ) {
        compensationAnchored = true
      } else if (
        compensationAnchored &&
        !indexedDuringSnapshot &&
        dir === repo &&
        result.status === 0 &&
        (args[0] === 'write-tree' ||
          args[0] === 'apply' ||
          args.includes('autowin-compensation-apply'))
      ) {
        indexedDuringSnapshot = true
        git(repo, 'add', 'b.txt')
      }
      return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
    }
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot, tryGitFn })
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')
    const hook = join(repo, '.git', 'hooks', 'reference-transaction')
    writeFileSync(
      hook,
      `#!/bin/sh
state="$1"
payload=$(cat)
if [ "$state" = "prepared" ] && printf '%s\n' "$payload" | grep -q 'refs/heads/main'; then
  printf 'travail utilisateur du hook\n' > b.txt
fi
exit 0
`
    )
    chmodSync(hook, 0o755)

    const result = wm.finalize('builder')

    expect(result).toMatchObject({ outcome: 'blocked', reason: 'merge-failed' })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(baseSha)
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('travail utilisateur du hook')
    expect(git(repo, 'diff', '--cached', '--name-only')).toBe('b.txt')
  })

  it('un échec de suppression native conserve la ref puis se reprend', () => {
    const repo = tempRepo()
    const failedRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    const resumedRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(failedRoot, resumedRoot)
    let failNativeRelease = true
    const failed = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: failedRoot,
      removeIndexLockFn: (path) => {
        if (failNativeRelease) {
          failNativeRelease = false
          throw new Error('verrou Windows transitoire')
        }
        rmSync(path, { force: true })
      }
    }) as unknown as CompensationIndexLockProbe
    const firstLock = failed.acquireCompensationIndexLock()
    expect(firstLock).toBeDefined()

    failed.releaseCompensationIndexLock(firstLock!)

    expect(existsSync(join(repo, '.git', 'index.lock'))).toBe(true)
    expect(git(repo, 'rev-parse', '--verify', 'refs/autowin/locks/index')).toBe(
      firstLock!.ownershipOid
    )

    const resumed = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: resumedRoot
    }) as unknown as CompensationIndexLockProbe
    const resumedLock = resumed.acquireCompensationIndexLock()
    expect(resumedLock).toBeDefined()
    resumed.releaseCompensationIndexLock(resumedLock!)
    writeFileSync(join(repo, 'a.txt'), 'index libéré\n')
    expect(spawnSync('git', ['add', 'a.txt'], { cwd: repo }).status).toBe(0)
    expect(existsSync(join(repo, '.git', 'index.lock'))).toBe(false)
    expect(
      spawnSync('git', ['rev-parse', '--verify', 'refs/autowin/locks/index'], { cwd: repo }).status
    ).not.toBe(0)
  })

  it('une acquisition expirée reprise après balayage reste récupérable après son CAS', () => {
    const repo = tempRepo()
    const failedRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    const competingRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    const resumedRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(failedRoot, competingRoot, resumedRoot)
    let now = 1_000
    let suspendBeforeCas = true
    const tryGitFn = (dir: string, args: string[]) => {
      if (
        suspendBeforeCas &&
        args.includes('update-ref') &&
        args.includes('refs/autowin/locks/index') &&
        !args.includes('-d')
      ) {
        suspendBeforeCas = false
        now = 301_001
        const competing = new WorktreeManager({
          baseRepo: repo,
          worktreeRoot: competingRoot,
          nowFn: () => now
        }) as unknown as CompensationIndexLockProbe
        const competingLock = competing.acquireCompensationIndexLock()
        expect(competingLock).toBeDefined()
        competing.releaseCompensationIndexLock(competingLock!)

        const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
        expect(result.status).toBe(0)
        throw new Error('worker tué juste après son CAS tardif')
      }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
    }
    const failed = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: failedRoot,
      nowFn: () => now,
      processIdentityFn: (pid) => `live|${pid}`,
      tryGitFn
    }) as unknown as CompensationIndexLockProbe

    expect(failed.acquireCompensationIndexLock()).toBeUndefined()
    expect(existsSync(join(repo, '.git', 'index.lock'))).toBe(false)
    expect(
      spawnSync('git', ['rev-parse', '--verify', 'refs/autowin/locks/index'], { cwd: repo }).status
    ).toBe(0)

    const resumed = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: resumedRoot,
      nowFn: () => now,
      processIdentityFn: (pid) => `live|${pid}`
    }) as unknown as CompensationIndexLockProbe
    const lock = resumed.acquireCompensationIndexLock()

    expect(lock).toBeDefined()
    resumed.releaseCompensationIndexLock(lock!)
    expect(existsSync(join(repo, '.git', 'index.lock'))).toBe(false)
  })

  it('un worker mort en acquisition expire même si le PID Electron vit encore', () => {
    const repo = tempRepo()
    const predecessorSerialized = JSON.stringify({
      owner: 'autowin-compensation',
      pid: 2_147_483_647,
      identity: null,
      token: 'worker-predecessor'
    })
    const currentSerialized = JSON.stringify({
      owner: 'autowin-compensation',
      pid: process.pid,
      identity: `live|${process.pid}`,
      token: 'expired-worker-owner'
    })
    const currentObject = spawnSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: repo,
      encoding: 'utf8',
      input: currentSerialized
    })
    expect(currentObject.status).toBe(0)
    git(repo, 'update-ref', 'refs/autowin/locks/index', currentObject.stdout.trim())
    writeFileSync(join(repo, '.git', 'index.lock'), predecessorSerialized)
    const markerRoot = join(repo, '.git', 'autowin-compensations', 'locks')
    mkdirSync(markerRoot, { recursive: true })
    writeFileSync(
      join(markerRoot, 'acquiring-expired-worker-owner.marker'),
      JSON.stringify({
        version: 1,
        token: 'expired-worker-owner',
        state: 'acquiring',
        predecessorSerialized,
        expiresAt: 999
      })
    )
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const resumed = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: wtRoot,
      nowFn: () => 1_000,
      processIdentityFn: (pid) => `live|${pid}`
    }) as unknown as CompensationIndexLockProbe

    const lock = resumed.acquireCompensationIndexLock()

    expect(lock).toBeDefined()
    resumed.releaseCompensationIndexLock(lock!)
    writeFileSync(join(repo, 'a.txt'), 'worker expiré repris\n')
    expect(spawnSync('git', ['add', 'a.txt'], { cwd: repo }).status).toBe(0)
    expect(existsSync(join(repo, '.git', 'index.lock'))).toBe(false)
  })

  it('plan de compensation forgé avec pathspec global → bloque sans toucher au travail humain', () => {
    const repo = tempRepo()
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    let failNextPatch = true
    const tryGitFn = (dir: string, args: string[]) => {
      if (
        failNextPatch &&
        dir === repo &&
        (args[0] === 'apply' || args.includes('autowin-compensation-apply'))
      ) {
        failNextPatch = false
        return { code: 128, stdout: '', stderr: 'verrou index transitoire' }
      }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
    }
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot, tryGitFn })
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')
    const hook = join(repo, '.git', 'hooks', 'reference-transaction')
    writeFileSync(
      hook,
      `#!/bin/sh
state="$1"
payload=$(cat)
if [ "$state" = "prepared" ] && printf '%s\n' "$payload" | grep -q 'refs/heads/main'; then
  printf 'travail utilisateur du hook\n' > b.txt
fi
exit 0
`
    )
    chmodSync(hook, 0o755)
    expect(wm.finalize('builder')).toMatchObject({ outcome: 'blocked', reason: 'merge-failed' })

    const planPath = join(repo, '.git', 'autowin-compensations', 'builder.json')
    const forged = JSON.parse(readFileSync(planPath, 'utf8')) as Record<string, unknown>
    forged.agentFiles = ['.']
    forged.indexedAgentPaths = []
    forged.worktreeAgentPaths = []
    forged.untrackedAgentPaths = []
    writeFileSync(planPath, JSON.stringify(forged))
    writeFileSync(join(repo, 'a.txt'), 'travail humain précieux\n')
    git(repo, 'add', 'a.txt')
    const statusBefore = git(repo, 'status', '--porcelain')
    const indexBefore = git(repo, 'write-tree')

    const result = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot }).finalize('builder')

    expect(result).toMatchObject({ outcome: 'blocked', reason: 'merge-failed' })
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toContain('travail humain précieux')
    expect(git(repo, 'write-tree')).toBe(indexBefore)
    expect(git(repo, 'status', '--porcelain')).toBe(statusBefore)
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(baseSha)

    forged.agentFiles = [':(top)a.txt']
    writeFileSync(planPath, JSON.stringify(forged))
    expect(
      new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot }).finalize('builder')
    ).toMatchObject({ outcome: 'blocked', reason: 'merge-failed' })
    expect(git(repo, 'write-tree')).toBe(indexBefore)
    expect(git(repo, 'status', '--porcelain')).toBe(statusBefore)

    forged.agentFiles = ['b.txt']
    forged.postHookIndexTree = ''
    writeFileSync(planPath, JSON.stringify(forged))
    expect(
      new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot }).finalize('builder')
    ).toMatchObject({ outcome: 'blocked', reason: 'merge-failed' })
    expect(git(repo, 'write-tree')).toBe(indexBefore)
    expect(git(repo, 'status', '--porcelain')).toBe(statusBefore)
  })

  it('hook modifiant le worktree → aucune transaction main temporaire n’est publiée', () => {
    const repo = tempRepo()
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    const wm = manager(repo)
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')
    const hook = join(repo, '.git', 'hooks', 'reference-transaction')
    const hookEvents = join(repo, '.git', 'autowin-hook-events')
    writeFileSync(
      hook,
      `#!/bin/sh
state="$1"
payload=$(cat)
if printf '%s\n' "$payload" | grep -q 'refs/heads/main'; then
  printf '%s main\n' "$state" >> ${hookEvents.replace(/\\/g, '/')}
  if [ "$state" = "prepared" ]; then
    printf 'travail utilisateur du hook\n' > b.txt
  fi
fi
exit 0
`
    )
    chmodSync(hook, 0o755)

    const result = wm.finalize('builder')

    expect(result).toMatchObject({ outcome: 'blocked', reason: 'base-in-progress' })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(baseSha)
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('travail utilisateur du hook')
    expect(git(repo, 'write-tree')).toBe(git(repo, 'rev-parse', `${baseSha}^{tree}`))
    expect(git(repo, 'status', '--porcelain')).toBe('?? b.txt')
    const events = readFileSync(hookEvents, 'utf8')
    expect(events).toContain('prepared main')
    expect(events).not.toContain('committed main')
  })

  it('préserve une ref de récupération avancée pendant cleanupPublished', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const setup = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot })
    const agentPath = setup.acquire('cleanup-race')
    writeFileSync(join(agentPath, 'published.txt'), 'publié\n')
    git(agentPath, 'add', 'published.txt')
    git(agentPath, 'commit', '-q', '-m', 'published')
    const publishedSha = git(agentPath, 'rev-parse', 'HEAD')
    git(repo, 'merge', '--ff-only', publishedSha)
    const recoveryBranch = 'autowin/recovery/cleanup-race'
    git(agentPath, 'switch', '-C', recoveryBranch)
    git(repo, 'worktree', 'remove', '--force', agentPath)
    const lateSha = detachedCommit(repo, publishedSha, 'late.txt', 'à préserver\n')
    let advanced = false
    const tryGitFn = (dir: string, args: string[]) => {
      if (
        !advanced &&
        dir === repo &&
        ((args[0] === 'branch' && args[1] === '-D' && args[2] === recoveryBranch) ||
          (args[0] === 'update-ref' &&
            args[1] === '-d' &&
            args[2] === `refs/heads/${recoveryBranch}`))
      ) {
        git(repo, 'update-ref', `refs/heads/${recoveryBranch}`, lateSha, publishedSha)
        advanced = true
      }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return {
        code: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? ''
      }
    }
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot, tryGitFn })

    expect(wm.cleanupPublished('cleanup-race', publishedSha, 'main')).toMatchObject({
      outcome: 'published-residue',
      publishedSha,
      files: ['late.txt']
    })
    expect(git(repo, 'rev-parse', `refs/heads/${recoveryBranch}`)).toBe(lateSha)
    expect(existsSync(agentPath)).toBe(true)
    expect(git(agentPath, 'rev-parse', 'HEAD')).toBe(lateSha)
    expect(readFileSync(join(agentPath, 'late.txt'), 'utf8')).toContain('préserver')
  })

  it('restaure le bureau si sa ref avance entre contrôle et suppression', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const setup = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot })
    const agentPath = setup.acquire('finalize-race')
    writeFileSync(join(agentPath, 'published.txt'), 'publié\n')
    git(agentPath, 'add', 'published.txt')
    git(agentPath, 'commit', '-q', '-m', 'published')
    const publishedSha = git(agentPath, 'rev-parse', 'HEAD')
    const lateSha = detachedCommit(repo, publishedSha, 'late.txt', 'à préserver\n')
    const recoveryBranch = 'autowin/recovery/finalize-race'
    let advanced = false
    const tryGitFn = (dir: string, args: string[]) => {
      if (
        !advanced &&
        dir === repo &&
        ((args[0] === 'branch' && args[1] === '-D' && args[2] === recoveryBranch) ||
          (args[0] === 'update-ref' &&
            args[1] === '-d' &&
            args[2] === `refs/heads/${recoveryBranch}`))
      ) {
        git(repo, 'update-ref', `refs/heads/${recoveryBranch}`, lateSha, publishedSha)
        advanced = true
      }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return {
        code: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? ''
      }
    }
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot, tryGitFn })

    expect(wm.finalize('finalize-race', { expectedAgentSha: publishedSha })).toMatchObject({
      outcome: 'published-residue',
      publishedSha,
      files: ['late.txt']
    })
    expect(existsSync(agentPath)).toBe(true)
    expect(git(agentPath, 'rev-parse', 'HEAD')).toBe(lateSha)
    expect(readFileSync(join(agentPath, 'late.txt'), 'utf8')).toContain('préserver')
  })

  it('rejette un agentId de traversée de chemin', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    expect(() => wm.acquire('../evil')).toThrow()
  })

  it('une copie appartenant BIEN à la base est finalisée normalement (garde non sur-bloquante)', () => {
    // Risque n°1 du correctif : une comparaison de chemins trop stricte (jonction, casse, slash
    // final) prendrait un worktree légitime pour un dépôt étranger et bloquerait tout.
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('legitime')
    writeFileSync(join(path, 'a.txt'), 'travail de l’agent\n')

    const result = wm.finalize('legitime')

    expect(result).toMatchObject({ outcome: 'merged', committed: true })
    // `core.autocrlf` du poste peut réécrire les fins de ligne : on compare le contenu, pas l'EOL.
    expect(readFileSync(join(repo, 'a.txt'), 'utf8').trim()).toBe('travail de l’agent')
  })
})
