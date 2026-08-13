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
  renameSync,
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
  installCompensationIndexOwner,
  manager,
  nettoyerRacines,
  roots,
  tempRepo,
  type CompensationIndexLockProbe
} from './worktree-manager.test-helpers'

afterEach(nettoyerRacines)

describe('WorktreeManager — publication (20/81 de la suite d’origine)', () => {
  it('acquire donne une copie isolée qui ne touche pas le repo de base', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('scout')
    writeFileSync(join(path, 'a.txt'), 'modifié dans la copie\n')
    expect(git(repo, 'status', '--porcelain')).toBe('') // base intacte
    expect(wm.changedFiles('scout')).toContain('a.txt')
  })

  it('en mode production refuse un lancement sans base distante canonique', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: wtRoot,
      requireCanonicalRemote: true
    })

    expect(() => wm.describeForLaunch('strict')).toThrow(/distant origin est absent/i)
    expect(existsSync(join(wtRoot, 'agent__strict'))).toBe(false)
  })

  it('restaure une quarantaine orpheline comme bureau inconnu sans la publier', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot })
    const original = wm.acquire('run-crash')
    writeFileSync(join(original, 'a.txt'), 'travail non publié\n')
    const quarantineRoot = join(wtRoot, '.quarantine')
    const quarantined = join(quarantineRoot, 'run-crash__crash')
    mkdirSync(quarantineRoot, { recursive: true })
    renameSync(original, quarantined)
    git(repo, 'worktree', 'repair', quarantined)

    expect(wm.reconcileResidues()).toMatchObject({
      cleaned: 0,
      recovered: ['run-crash'],
      blocked: []
    })
    expect(existsSync(original)).toBe(true)
    expect(readFileSync(join(original, 'a.txt'), 'utf8')).toContain('non publié')
    expect(wm.listAgentIds()).toContain('run-crash')
  })

  it('conserve la barrière pré-spawn jusqu’à la confirmation du PID', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot })

    wm.markSpawnIntent('run-pending', 'attempt-a', true)
    expect(wm.hasActiveProcesses('run-pending')).toBe(true)

    wm.markSpawnIntent('run-pending', 'attempt-b', true)
    wm.confirmSpawn('run-pending', 'attempt-a', process.pid)
    expect(wm.hasActiveProcesses('run-pending')).toBe(true)

    wm.markProcess('run-pending', process.pid, false)
    expect(wm.hasActiveProcesses('run-pending')).toBe(true)

    wm.markSpawnIntent('run-pending', 'attempt-b', false)
    expect(wm.hasActiveProcesses('run-pending')).toBe(false)
  })

  it('copie sans changement → "nothing", rien à fusionner', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    wm.acquire('idle')
    expect(wm.finalize('idle').outcome).toBe('nothing')
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

  it('hook utilisateur modifiant le fichier agent pendant prepared → bloque avant la branche', () => {
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
  printf 'travail utilisateur concurrent\n' > "$root/b.txt" || exit 31
  git -C "$root" add b.txt || exit 32
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
      files: ['b.txt'],
      reason: 'base-in-progress'
    })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(baseSha)
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('travail utilisateur concurrent')
    expect(git(repo, 'status', '--porcelain')).toBe('A  b.txt')
  })

  it('hook recréant un fichier agent ignoré et non suivi → bloque et préserve', () => {
    const repo = tempRepo()
    writeFileSync(join(repo, '.gitignore'), '*.tmp\n')
    writeFileSync(join(repo, 'b.tmp'), 'version de base\n')
    git(repo, 'add', '.gitignore')
    git(repo, 'add', '-f', 'b.tmp')
    git(repo, 'commit', '-q', '-m', 'ajout b ignoré')
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    const baseIndexTree = git(repo, 'write-tree')
    const hooksPath = join(repo, git(repo, 'rev-parse', '--git-path', 'hooks'))
    const hookPath = join(hooksPath, 'reference-transaction')
    writeFileSync(
      hookPath,
      `#!/bin/sh
state="$1"
payload=$(cat)
if [ "$state" = "prepared" ] && printf '%s\n' "$payload" | grep -q 'refs/heads/main'; then
  root=$(git rev-parse --show-toplevel) || exit 30
  printf 'travail utilisateur ignoré\n' > "$root/b.tmp" || exit 31
fi
exit 0
`
    )
    chmodSync(hookPath, 0o755)
    const wm = manager(repo)
    const path = wm.acquire('builder')
    rmSync(join(path, 'b.tmp'))

    const res = wm.finalize('builder')

    expect(res).toMatchObject({
      outcome: 'blocked',
      files: ['b.tmp'],
      reason: 'base-in-progress'
    })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(baseSha)
    expect(git(repo, 'write-tree')).toBe(baseIndexTree)
    expect(readFileSync(join(repo, 'b.tmp'), 'utf8')).toContain('travail utilisateur ignoré')
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

  it('édition humaine après le retour du hook → refuse la compensation initiale sans écraser', () => {
    const repo = tempRepo()
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    let changedAfterMerge = false
    const tryGitFn = (dir: string, args: string[]) => {
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      if (
        !changedAfterMerge &&
        dir === repo &&
        args.includes('merge') &&
        args.includes('--ff-only')
      ) {
        changedAfterMerge = true
        writeFileSync(join(repo, 'b.txt'), 'édition humaine après le hook\n')
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
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('édition humaine après le hook')
  })

  it('deux managers ne peuvent pas voler le verrou pendant la reprise stale', () => {
    const repo = tempRepo()
    const stalePid = 2_147_483_647
    installCompensationIndexOwner(
      repo,
      JSON.stringify({
        owner: 'autowin-compensation',
        pid: stalePid,
        identity: null,
        token: 'stale-race-owner'
      })
    )
    const processIdentityFn = (pid: number) => (pid === stalePid ? undefined : `live|${pid}`)
    const firstRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    const racerRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(firstRoot, racerRoot)
    const racer = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: racerRoot,
      processIdentityFn
    }) as unknown as CompensationIndexLockProbe
    let racerAttempted = false
    let racerLock: ReturnType<CompensationIndexLockProbe['acquireCompensationIndexLock']>
    const tryGitFn = (dir: string, args: string[]) => {
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      if (
        !racerAttempted &&
        result.status === 0 &&
        args.includes('update-ref') &&
        !args.includes('-d') &&
        args.includes('refs/autowin/locks/index')
      ) {
        racerAttempted = true
        racerLock = racer.acquireCompensationIndexLock()
      }
      return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
    }
    const first = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: firstRoot,
      processIdentityFn,
      tryGitFn
    }) as unknown as CompensationIndexLockProbe

    const firstLock = first.acquireCompensationIndexLock()

    expect(racerAttempted).toBe(true)
    expect(racerLock).toBeUndefined()
    expect(firstLock).toBeDefined()
    writeFileSync(join(repo, 'a.txt'), 'édition humaine à indexer\n')
    expect(spawnSync('git', ['add', 'a.txt'], { cwd: repo }).status).not.toBe(0)
    first.releaseCompensationIndexLock(firstLock!)
    expect(spawnSync('git', ['add', 'a.txt'], { cwd: repo }).status).toBe(0)
  })

  it('un échec rm pendant takeover conserve la préimage pour le worker suivant', () => {
    const repo = tempRepo()
    const stalePid = 2_147_483_647
    installCompensationIndexOwner(
      repo,
      JSON.stringify({
        owner: 'autowin-compensation',
        pid: stalePid,
        identity: null,
        token: 'stale-takeover-owner'
      })
    )
    const failedRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    const resumedRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(failedRoot, resumedRoot)
    let failTakeoverRemove = true
    const failed = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: failedRoot,
      processIdentityFn: (pid) => (pid === stalePid ? undefined : `live|${pid}`),
      removeIndexLockFn: (path) => {
        if (failTakeoverRemove) {
          failTakeoverRemove = false
          throw new Error('antivirus pendant takeover')
        }
        rmSync(path, { force: true })
      }
    }) as unknown as CompensationIndexLockProbe

    expect(failed.acquireCompensationIndexLock()).toBeUndefined()
    expect(existsSync(join(repo, '.git', 'index.lock'))).toBe(true)
    expect(
      spawnSync('git', ['rev-parse', '--verify', 'refs/autowin/locks/index'], { cwd: repo }).status
    ).toBe(0)

    const resumed = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: resumedRoot
    }) as unknown as CompensationIndexLockProbe
    const lock = resumed.acquireCompensationIndexLock()
    expect(lock).toBeDefined()
    resumed.releaseCompensationIndexLock(lock!)
    writeFileSync(join(repo, 'a.txt'), 'takeover repris\n')
    expect(spawnSync('git', ['add', 'a.txt'], { cwd: repo }).status).toBe(0)
    expect(existsSync(join(repo, '.git', 'index.lock'))).toBe(false)
    expect(
      spawnSync('git', ['rev-parse', '--verify', 'refs/autowin/locks/index'], { cwd: repo }).status
    ).not.toBe(0)
  })

  it('un worker tué après le hard-link libère le lease expiré sans toucher au travail humain', () => {
    const repo = tempRepo()
    writeFileSync(join(repo, 'a.txt'), 'version index humain\n')
    git(repo, 'add', 'a.txt')
    writeFileSync(join(repo, 'a.txt'), 'version worktree humaine\n')
    const expectedIndex = git(repo, 'show', ':a.txt')
    const expectedWorktree = readFileSync(join(repo, 'a.txt'), 'utf8')
    const failedRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    const resumedRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(failedRoot, resumedRoot)
    let now = 1_000
    const failed = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: failedRoot,
      nowFn: () => now,
      processIdentityFn: (pid) => `live|${pid}`
    }) as unknown as CompensationIndexLockProbe
    const abandonedLock = failed.acquireCompensationIndexLock()
    expect(abandonedLock).toBeDefined()
    expect(existsSync(join(repo, '.git', 'index.lock'))).toBe(true)

    now = 301_001
    const resumed = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: resumedRoot,
      nowFn: () => now,
      processIdentityFn: (pid) => `live|${pid}`
    }) as unknown as CompensationIndexLockProbe
    const lock = resumed.acquireCompensationIndexLock()

    expect(lock).toBeDefined()
    resumed.releaseCompensationIndexLock(lock!)
    expect(git(repo, 'show', ':a.txt')).toBe(expectedIndex)
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe(expectedWorktree)
    expect(existsSync(join(repo, '.git', 'index.lock'))).toBe(false)
  })

  it('échec de persistance de la phase compensée → reprend sans rejouer les patches', () => {
    const repo = tempRepo()
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    const planPath = join(repo, '.git', 'autowin-compensations', 'builder.json')
    const pendingPath = `${planPath}.pending`
    let failCompensatedPersist = true
    const tryGitFn = (dir: string, args: string[]) => {
      const updateRef = args.indexOf('update-ref')
      if (
        failCompensatedPersist &&
        dir === repo &&
        updateRef >= 0 &&
        args[updateRef + 1]?.startsWith('refs/autowin/compensations/builder/') &&
        !args.includes('-d') &&
        existsSync(pendingPath) &&
        JSON.parse(readFileSync(pendingPath, 'utf8')).phase === 'compensated'
      ) {
        failCompensatedPersist = false
        return { code: 128, stdout: '', stderr: 'crash persistance phase compensée' }
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

    const resumed = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot }).finalize(
      'builder'
    )
    expect(resumed).toMatchObject({ outcome: 'blocked', reason: 'base-in-progress' })
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('travail utilisateur du hook')
    expect(git(repo, 'write-tree')).toBe(git(repo, 'rev-parse', `${baseSha}^{tree}`))
  })

  it('crash refs avant JSON → complète le journal pending puis reprend', () => {
    const repo = tempRepo()
    let failNextPatch = true
    const tryGitFn = (dir: string, args: string[]) => {
      if (
        failNextPatch &&
        dir === repo &&
        (args[0] === 'apply' || args.includes('autowin-compensation-apply'))
      ) {
        failNextPatch = false
        return { code: 128, stdout: '', stderr: 'arrêt avant compensation' }
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
    const pendingPath = `${planPath}.pending`
    const pending = JSON.parse(readFileSync(planPath, 'utf8')) as Record<string, unknown>
    pending.generation = 'crash-generation'
    writeFileSync(pendingPath, JSON.stringify(pending))
    const firstRef = 'refs/autowin/compensations/builder/crash-generation/index'
    git(repo, 'update-ref', firstRef, String(pending.postHookIndexTree))

    const resumed = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot }).finalize(
      'builder'
    )

    expect(resumed).toMatchObject({ outcome: 'blocked', reason: 'base-in-progress' })
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('travail utilisateur du hook')
    expect(existsSync(planPath)).toBe(false)
    expect(existsSync(pendingPath)).toBe(false)
    expect(
      git(repo, 'for-each-ref', '--format=%(refname)', 'refs/autowin/compensations/builder/')
    ).toBe('')

    const trees = [
      ['index', String(pending.postHookIndexTree)],
      ['worktree', String(pending.postHookWorktreeTree)],
      ['resume-index', String(pending.resumeIndexTree)],
      ['resume-worktree', String(pending.resumeWorktreeTree)]
    ]
    for (const generation of ['old-generation', 'current-generation']) {
      for (const [kind, tree] of trees) {
        git(repo, 'update-ref', `refs/autowin/compensations/builder/${generation}/${kind}`, tree)
      }
    }
    pending.generation = 'current-generation'
    pending.phase = 'compensated'
    writeFileSync(planPath, JSON.stringify(pending))

    expect(
      new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot }).finalize('builder')
    ).toMatchObject({ outcome: 'blocked', reason: 'base-in-progress' })
    expect(
      git(repo, 'for-each-ref', '--format=%(refname)', 'refs/autowin/compensations/builder/')
    ).toBe('')
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

  it('recrée le bureau quand sa ref était déjà avancée avant cleanupPublished', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot })
    const agentPath = wm.acquire('cleanup-advanced')
    writeFileSync(join(agentPath, 'published.txt'), 'publié\n')
    git(agentPath, 'add', 'published.txt')
    git(agentPath, 'commit', '-q', '-m', 'published')
    const publishedSha = git(agentPath, 'rev-parse', 'HEAD')
    git(repo, 'merge', '--ff-only', publishedSha)
    const recoveryBranch = 'autowin/recovery/cleanup-advanced'
    git(agentPath, 'switch', '-C', recoveryBranch)
    git(repo, 'worktree', 'remove', '--force', agentPath)
    const lateSha = detachedCommit(repo, publishedSha, 'late.txt', 'à préserver\n')
    git(repo, 'update-ref', `refs/heads/${recoveryBranch}`, lateSha, publishedSha)

    expect(wm.cleanupPublished('cleanup-advanced', publishedSha, 'main')).toMatchObject({
      outcome: 'published-residue',
      publishedSha,
      files: ['late.txt']
    })
    expect(existsSync(agentPath)).toBe(true)
    expect(git(agentPath, 'rev-parse', 'HEAD')).toBe(lateSha)
    expect(readFileSync(join(agentPath, 'late.txt'), 'utf8')).toContain('préserver')
  })

  it('copie sans changement mais cleanup impossible → bloque sans exception', () => {
    const repo = tempRepo()
    const isAgentRemove = (args: string[]) =>
      args[0] === 'worktree' &&
      args[1] === 'remove' &&
      ((args.at(-1) ?? '').includes('agent__builder') ||
        (args.at(-1) ?? '').includes('.quarantine'))
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

  it('une copie d’un AUTRE dépôt n’est PAS écrite : travail non commité et HEAD intacts', () => {
    // Discriminant du test précédent, qui ne regardait QUE la base : la garde révisionnelle
    // (`cat-file -e`) arrivait APRÈS `git add -A` + `git commit -m "agent <id>"`. Le travail non
    // commité d'un développeur était donc happé dans un commit sur le HEAD détaché de SON dépôt,
    // sans consentement, avant qu'Autowin ne conclue « copie étrangère ». On vérifie ici l'absence
    // d'écriture dans la copie, pas seulement l'absence de fusion.
    const repo = tempRepo()
    const wm = manager(repo)
    const copie = wm.acquire('etranger-intact')
    rmSync(copie, { recursive: true, force: true })
    mkdirSync(copie, { recursive: true })
    git(copie, 'init', '-q', '-b', 'main')
    git(copie, 'config', 'user.email', 't@t')
    git(copie, 'config', 'user.name', 'T')
    git(copie, 'config', 'commit.gpgsign', 'false')
    writeFileSync(join(copie, 'suivi.txt'), 'commité\n')
    git(copie, 'add', '-A')
    git(copie, 'commit', '-q', '-m', 'travail du développeur')
    // Travail NON commité du développeur, présent au moment où Autowin passe.
    writeFileSync(join(copie, 'suivi.txt'), 'modifié, pas encore commité\n')
    writeFileSync(join(copie, 'brouillon.txt'), 'nouveau fichier non suivi\n')
    const headAvant = git(copie, 'rev-parse', 'HEAD')
    const statusAvant = git(copie, 'status', '--porcelain')
    expect(statusAvant).not.toBe('')

    const result = wm.finalize('etranger-intact')

    expect(result).toMatchObject({ outcome: 'blocked', reason: 'merge-failed' })
    expect(git(copie, 'status', '--porcelain')).toBe(statusAvant)
    expect(git(copie, 'rev-parse', 'HEAD')).toBe(headAvant)
    expect(git(copie, 'log', '--oneline')).not.toContain('agent etranger-intact')
  })
})
