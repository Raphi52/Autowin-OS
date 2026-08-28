import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests joués contre de VRAIS dépôts git en tmp (init, worktree, merge) : sous la charge parallèle
 * de la suite complète, ces I/O dépassent le budget vitest par défaut (5 s) — d'où des rouges
 * aléatoires alors que le code est bon. Budget explicite, assez large pour la contention, assez
 * serré pour attraper un vrai blocage.
 */
/**
 * BUDGET DIMENSIONNE SUR LA CONTENTION MESUREE — et c'est un DIMENSIONNEMENT, pas une rustine :
 * le comportement teste est correct, c'est l'horloge qui etait plus petite que le cout reel.
 *
 * Mesures du 2026-08-19, sept faux rouges observes dans la meme session (jamais le meme test, tous
 * verts en isole, toujours un « Test timed out », jamais une assertion) :
 *
 * - `worktree-manager.concurrence` SEUL : 237 s pour 21 tests, pire test 48,7 s.
 * - les QUATRE fichiers `worktree-manager.*` dans la suite complete : 413 s, 427 s, 444 s, 449 s.
 *   Soit un facteur 1,74 de ralentissement par contention.
 * - `maxWorkers: 4` (vitest.config.ts) et ces quatre fichiers sont les quatre plus lourds de la
 *   suite : ils occupent donc TOUS les workers en meme temps et se ralentissent mutuellement.
 *
 * 48,7 s x 1,74 = 85 s, pour un budget de 90 s : la marge etait de 5 s, d'ou un rouge marginal sur
 * le test qui franchissait la ligne le premier. 180 s laisse un facteur 2 sur le pire cas contendu,
 * sans jamais masquer un blocage reel (un test pendu echoue toujours, 90 s plus tard).
 *
 * Le budget avait DEJA ete releve une fois (20 s -> 90 s). Un troisieme relevement ne devra pas etre
 * accepte sans traiter la cause : ces quatre fichiers coutent ~1 500 s de vrai travail git a eux
 * seuls. Les serialiser a ete ecarte par la mesure — 16 min au lieu de 7,5 — donc la seule vraie
 * sortie est de rendre ces tests moins couteux, ce qui est un chantier a part (dispatche).
 */
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 })

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
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

describe('WorktreeManager — concurrence (20/81 de la suite d’origine)', () => {
  it('prépare un nouveau job depuis le main distant frais sans muter la branche locale', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-wmremote-'))
    roots.push(root)
    const remote = join(root, 'origin.git')
    const repo = join(root, 'work')
    const peer = join(root, 'peer')
    git(root, 'init', '--bare', '-q', remote)
    git(root, 'clone', '-q', remote, repo)
    git(repo, 'switch', '-c', 'main')
    git(repo, 'config', 'user.email', 't@t')
    git(repo, 'config', 'user.name', 'T')
    git(repo, 'config', 'commit.gpgsign', 'false')
    writeFileSync(join(repo, 'base.txt'), 'base\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'base')
    git(repo, 'push', '-q', '-u', 'origin', 'main')
    git(root, '--git-dir', remote, 'symbolic-ref', 'HEAD', 'refs/heads/main')
    git(root, 'clone', '-q', remote, peer)
    git(peer, 'config', 'user.email', 't@t')
    git(peer, 'config', 'user.name', 'T')
    writeFileSync(join(peer, 'remote.txt'), 'remote\n')
    git(peer, 'add', '-A')
    git(peer, 'commit', '-q', '-m', 'remote advances')
    git(peer, 'push', '-q', 'origin', 'main')

    const localHead = git(repo, 'rev-parse', 'HEAD')
    const wm = manager(repo)
    const context = wm.describeForLaunch('fresh')
    expect(context.canonicalBaseRef).toBe('origin/main')
    expect(context.baseSha).toBe(localHead)
    expect(context.sourceSha).toBe(git(repo, 'rev-parse', 'origin/main'))
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(localHead)
    const path = wm.acquire('fresh', context)
    expect(git(path, 'rev-parse', 'HEAD')).toBe(context.sourceSha)
    writeFileSync(join(path, 'agent.txt'), 'agent\n')
    const finalized = wm.finalize('fresh', { baseBranch: 'main' })
    expect(finalized).toMatchObject({
      outcome: 'merged',
      baseSha: localHead,
      publishedSha: git(repo, 'rev-parse', 'HEAD')
    })
    expect(readFileSync(join(repo, 'remote.txt'), 'utf8')).toContain('remote')
    expect(readFileSync(join(repo, 'agent.txt'), 'utf8')).toContain('agent')
  })

  it('une divergence local/origin ne bloque plus : le job part d’origin, commits locaux nommés', () => {
    // Décision user 14/08 : « ça devrait auto-gérer les workspaces, pas bloquer » — mesuré sur
    // conv-1178 : « Lancement bloqué : main et origin/main ont divergé » tuait toute orchestration.
    const root = mkdtempSync(join(tmpdir(), 'autowin-wmremote-'))
    roots.push(root)
    const remote = join(root, 'origin.git')
    const repo = join(root, 'work')
    const peer = join(root, 'peer')
    git(root, 'init', '--bare', '-q', remote)
    git(root, 'clone', '-q', remote, repo)
    git(repo, 'switch', '-c', 'main')
    git(repo, 'config', 'user.email', 't@t')
    git(repo, 'config', 'user.name', 'T')
    git(repo, 'config', 'commit.gpgsign', 'false')
    writeFileSync(join(repo, 'base.txt'), 'base\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'base')
    git(repo, 'push', '-q', '-u', 'origin', 'main')
    git(root, '--git-dir', remote, 'symbolic-ref', 'HEAD', 'refs/heads/main')
    git(root, 'clone', '-q', remote, peer)
    git(peer, 'config', 'user.email', 't@t')
    git(peer, 'config', 'user.name', 'T')
    writeFileSync(join(peer, 'remote.txt'), 'remote\n')
    git(peer, 'add', '-A')
    git(peer, 'commit', '-q', '-m', 'remote advances')
    git(peer, 'push', '-q', 'origin', 'main')
    // Divergence : un commit LOCAL non poussé pendant qu'origin avance.
    writeFileSync(join(repo, 'local.txt'), 'local\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'local diverge')

    const wm = manager(repo)
    const context = wm.describeForLaunch('diverged')
    expect(context.sourceSha).toBe(git(repo, 'rev-parse', 'origin/main'))
    expect(context.excludedLocalCommitCount).toBe(1)
    expect(context.excludedLocalCommits?.[0]).toContain('local diverge')
  })

  it('prouve le contexte Git durable avant une reprise automatique', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    wm.acquire('recovery')
    const { worktreePath, baseBranch, baseSha } = wm.describe('recovery')

    expect(
      wm.validateRecoveryContext('recovery', {
        worktreePath,
        baseBranch,
        baseSha,
        publication: 'pending'
      })
    ).toEqual({ ok: true, decision: 'resume-publication' })
    expect(
      wm.validateRecoveryContext('recovery', {
        worktreePath,
        baseBranch,
        baseSha: 'f'.repeat(40),
        publication: 'pending'
      })
    ).toMatchObject({ ok: false })
    expect(
      wm.validateRecoveryContext('recovery', {
        worktreePath: join(worktreePath, '..', 'agent__foreign'),
        baseBranch,
        baseSha,
        publication: 'pending'
      })
    ).toMatchObject({ ok: false })
  })

  it('écarte un lease dont le PID a été recyclé par un autre processus', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    let identity = 'cli-original'
    const wm = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: wtRoot,
      processIdentityFn: () => identity
    })
    wm.markProcess('run-recycled', process.pid, true)

    identity = 'processus-sans-rapport'

    expect(wm.hasActiveProcesses('run-recycled')).toBe(false)
  })

  it('expire une intention de spawn orpheline sans bloquer la reprise indéfiniment', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    let now = 1_000
    const wm = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: wtRoot,
      nowFn: () => now
    })

    wm.markSpawnIntent('run-expired', 'attempt-a', true)
    expect(wm.hasActiveProcesses('run-expired')).toBe(true)

    now += 5 * 60_000
    expect(wm.hasActiveProcesses('run-expired')).toBe(false)
  })

  it('capture la branche réellement active au début de chaque run sans redémarrage', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    wm.acquire('run-main')
    expect(wm.describe('run-main').baseBranch).toBe('main')
    expect(wm.finalize('run-main', { baseBranch: 'main' }).outcome).toBe('nothing')

    git(repo, 'switch', '-c', 'topic')
    const topicPath = wm.acquire('run-topic')
    const topicContext = wm.describe('run-topic')
    writeFileSync(join(topicPath, 'topic.txt'), 'topic\n')

    expect(topicContext.baseBranch).toBe('topic')
    expect(wm.finalize('run-topic', { baseBranch: topicContext.baseBranch }).outcome).toBe('merged')
    expect(readFileSync(join(repo, 'topic.txt'), 'utf8')).toContain('topic')
  })

  it('base avec travail indexé hors chevauchement → publie sans altérer l’index utilisateur', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')
    writeFileSync(join(repo, 'a.txt'), 'travail utilisateur indexé\n')
    git(repo, 'add', 'a.txt')
    const headBefore = git(repo, 'rev-parse', 'HEAD')
    const statusBefore = git(repo, 'status', '--porcelain')

    const res = wm.finalize('builder')

    expect(res).toMatchObject({ outcome: 'merged' })
    expect(git(repo, 'rev-parse', 'HEAD')).not.toBe(headBefore)
    expect(git(repo, 'status', '--porcelain')).toBe(statusBefore)
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toContain('travail utilisateur indexé')
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('travail de la copie')
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

  it('hook utilisateur modifiant seulement le worktree agent → restaure l’index initial', () => {
    const repo = tempRepo()
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
  printf 'travail utilisateur non indexé\n' > "$root/b.txt" || exit 31
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
    expect(git(repo, 'write-tree')).toBe(baseIndexTree)
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('travail utilisateur non indexé')
    expect(git(repo, 'status', '--porcelain')).toBe('?? b.txt')
  })

  it('hook modifiant l’index pendant la ref interne de publication → bloque avant le merge', () => {
    const repo = tempRepo()
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    const wm = manager(repo)
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')
    const hooksPath = join(repo, git(repo, 'rev-parse', '--git-path', 'hooks'))
    mkdirSync(hooksPath, { recursive: true })
    const hookPath = join(hooksPath, 'reference-transaction')
    writeFileSync(
      hookPath,
      `#!/bin/sh
state="$1"
payload=$(cat)
if [ "$state" = "prepared" ] && printf '%s\n' "$payload" | grep -q 'refs/autowin/publications/builder'; then
  root=$(git rev-parse --show-toplevel) || exit 30
  printf 'travail utilisateur pendant la ref\n' > "$root/a.txt" || exit 31
  git -C "$root" add a.txt || exit 32
fi
exit 0
`
    )
    chmodSync(hookPath, 0o755)

    const res = wm.finalize('builder')

    expect(res).toMatchObject({ outcome: 'blocked', reason: 'base-in-progress' })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(baseSha)
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toContain(
      'travail utilisateur pendant la ref'
    )
    expect(git(repo, 'status', '--porcelain')).toBe('M  a.txt')
    expect(existsSync(join(repo, 'b.txt'))).toBe(false)
    expect(() => git(repo, 'rev-parse', 'refs/autowin/publications/builder')).toThrow()
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

  it('édition humaine juste avant la mutation conditionnelle → refuse sans écraser', () => {
    const repo = tempRepo()
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    let changedBeforeMutation = false
    const tryGitFn = (dir: string, args: string[]) => {
      if (
        !changedBeforeMutation &&
        dir === repo &&
        (args[0] === 'restore' ||
          args[0] === 'apply' ||
          args.includes('autowin-compensation-apply'))
      ) {
        changedBeforeMutation = true
        writeFileSync(join(repo, 'b.txt'), 'édition humaine juste avant mutation\n')
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

    const result = wm.finalize('builder')

    expect(result).toMatchObject({ outcome: 'blocked', reason: 'merge-failed' })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(baseSha)
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain(
      'édition humaine juste avant mutation'
    )
  })

  it('un crash avant le lien atomique ne publie aucun index.lock tronqué', () => {
    const repo = tempRepo()
    const stalePid = 2_147_483_647
    const failedRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    const resumedRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(failedRoot, resumedRoot)
    const failed = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: failedRoot,
      linkFileFn: () => {
        throw new Error('crash avant publication atomique')
      }
    }) as unknown as CompensationIndexLockProbe

    expect(failed.acquireCompensationIndexLock()).toBeUndefined()
    expect(existsSync(join(repo, '.git', 'index.lock'))).toBe(false)
    expect(
      spawnSync('git', ['rev-parse', '--verify', 'refs/autowin/locks/index'], { cwd: repo }).status
    ).not.toBe(0)

    const partialOwner = join(
      repo,
      '.git',
      'autowin-compensations',
      'locks',
      `index-${stalePid}-partial.owner`
    )
    writeFileSync(partialOwner, '{"owner":"autowin-compensation"')

    const resumed = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: resumedRoot,
      processIdentityFn: (pid) => (pid === stalePid ? undefined : `live|${pid}`)
    }) as unknown as CompensationIndexLockProbe
    const lock = resumed.acquireCompensationIndexLock()
    expect(lock).toBeDefined()
    expect(existsSync(partialOwner)).toBe(false)
    resumed.releaseCompensationIndexLock(lock!)
    expect(existsSync(join(repo, '.git', 'index.lock'))).toBe(false)
  })

  it('un crash avant le CAS nettoie son marqueur acquiring orphelin après expiration', () => {
    const repo = tempRepo()
    const failedRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    const resumedRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(failedRoot, resumedRoot)
    let crashBeforeCas = true
    const tryGitFn = (dir: string, args: string[]) => {
      if (
        crashBeforeCas &&
        args.includes('update-ref') &&
        args.includes('refs/autowin/locks/index') &&
        !args.includes('-d')
      ) {
        crashBeforeCas = false
        throw new Error('worker tué avant le CAS')
      }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
    }
    const failed = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: failedRoot,
      nowFn: () => 1_000,
      tryGitFn
    }) as unknown as CompensationIndexLockProbe

    expect(failed.acquireCompensationIndexLock()).toBeUndefined()
    const markerRoot = join(repo, '.git', 'autowin-compensations', 'locks')
    const orphan = readdirSync(markerRoot).find((entry) => /^acquiring-.+\.marker$/.test(entry))
    expect(orphan).toBeDefined()
    expect(
      spawnSync('git', ['rev-parse', '--verify', 'refs/autowin/locks/index'], { cwd: repo }).status
    ).not.toBe(0)
    expect(existsSync(join(repo, '.git', 'index.lock'))).toBe(false)

    const resumed = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: resumedRoot,
      nowFn: () => 301_001
    }) as unknown as CompensationIndexLockProbe
    const lock = resumed.acquireCompensationIndexLock()

    expect(lock).toBeDefined()
    resumed.releaseCompensationIndexLock(lock!)
    expect(existsSync(join(markerRoot, orphan!))).toBe(false)
  })

  it('une reprise nettoie un owner vide laissé avant son écriture par un worker du même PID', () => {
    const repo = tempRepo()
    const ownerRoot = join(repo, '.git', 'autowin-compensations', 'locks')
    mkdirSync(ownerRoot, { recursive: true })
    const partialOwner = join(ownerRoot, `index-${process.pid}-partial-same-worker.owner`)
    writeFileSync(partialOwner, '')
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const resumed = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: wtRoot,
      processIdentityFn: (pid) => `live|${pid}`
    }) as unknown as CompensationIndexLockProbe

    const lock = resumed.acquireCompensationIndexLock()

    expect(lock).toBeDefined()
    resumed.releaseCompensationIndexLock(lock!)
    expect(existsSync(partialOwner)).toBe(false)
  })

  it('échec transitoire de compensation → reprend durablement au finalize suivant', () => {
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

    const failed = wm.finalize('builder')

    expect(failed).toMatchObject({ outcome: 'blocked', reason: 'merge-failed' })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(baseSha)
    const compensationPlan = join(repo, '.git', 'autowin-compensations', 'builder.json')
    expect(existsSync(compensationPlan)).toBe(true)
    const persistedPlan = JSON.parse(readFileSync(compensationPlan, 'utf8')) as {
      generation: string
    }
    const worktreeRef = `refs/autowin/compensations/builder/${persistedPlan.generation}/worktree`
    expect(git(repo, 'rev-parse', worktreeRef)).toMatch(/^[0-9a-f]{40}$/)

    const restarted = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot, tryGitFn })
    writeFileSync(join(repo, 'b.txt'), 'édition humaine plus récente\n')
    const indexBeforeRefusal = git(repo, 'write-tree')
    const refused = restarted.finalize('builder')
    expect(refused).toMatchObject({ outcome: 'blocked', reason: 'merge-failed' })
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('édition humaine plus récente')
    expect(git(repo, 'write-tree')).toBe(indexBeforeRefusal)

    writeFileSync(join(repo, 'b.txt'), 'travail utilisateur du hook\n')
    const resumed = restarted.finalize('builder')

    expect(resumed).toMatchObject({ outcome: 'blocked', reason: 'base-in-progress' })
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('travail utilisateur du hook')
    expect(git(repo, 'write-tree')).toBe(git(repo, 'rev-parse', `${baseSha}^{tree}`))
    expect(git(repo, 'status', '--porcelain')).toBe('?? b.txt')
    expect(existsSync(compensationPlan)).toBe(false)
    expect(() => git(repo, 'rev-parse', worktreeRef)).toThrow()

    rmSync(join(repo, 'b.txt'))
    rmSync(hook)
    const published = restarted.finalize('builder')
    expect(published).toMatchObject({ outcome: 'merged' })
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('travail de la copie')
  })

  it('crash après compensation avant acquittement → reprend sans restaurer le workspace', () => {
    const repo = tempRepo()
    const planPath = join(repo, '.git', 'autowin-compensations', 'builder.json')
    let interruptedCurrentGenerationDelete = false
    const tryGitFn = (dir: string, args: string[]) => {
      const updateRef = args.indexOf('update-ref')
      if (
        !interruptedCurrentGenerationDelete &&
        dir === repo &&
        updateRef >= 0 &&
        args[updateRef + 1] === '-d' &&
        args[updateRef + 2]?.startsWith('refs/autowin/compensations/builder/') &&
        existsSync(planPath)
      ) {
        const plan = JSON.parse(readFileSync(planPath, 'utf8')) as {
          phase?: string
          generation?: string
        }
        if (
          plan.phase === 'compensated' &&
          plan.generation &&
          args[updateRef + 2]?.includes(`/${plan.generation}/`)
        ) {
          interruptedCurrentGenerationDelete = true
          return { code: 128, stdout: '', stderr: 'arrêt avant acquittement' }
        }
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

    const interrupted = wm.finalize('builder')
    expect(interrupted).toMatchObject({ outcome: 'blocked', reason: 'merge-failed' })
    expect(JSON.parse(readFileSync(planPath, 'utf8'))).toMatchObject({ phase: 'compensated' })
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('travail utilisateur du hook')

    const resumed = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot }).finalize(
      'builder'
    )
    expect(resumed).toMatchObject({ outcome: 'blocked', reason: 'base-in-progress' })
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('travail utilisateur du hook')
    expect(existsSync(planPath)).toBe(false)
  })

  it('cleanup impossible après publication → mémorise puis reprend uniquement le rangement', () => {
    const repo = tempRepo()
    const publishedBranch = git(repo, 'branch', '--show-current')
    git(repo, 'branch', 'autre-branche')
    let integrationPath = ''
    let locked = true
    const tryGitFn = (dir: string, args: string[]) => {
      const candidatePath = args.at(-1) ?? ''
      if (
        locked &&
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
      removeDirFn: (path) => {
        if (locked) throw new Error('EPERM')
        rmSync(path, { recursive: true, force: true })
      }
    })
    const agentPath = wm.acquire('builder')
    writeFileSync(join(agentPath, 'b.txt'), 'travail de la copie\n')
    writeFileSync(join(repo, 'concurrent.txt'), 'avance concurrente de la base\n')
    git(repo, 'add', 'concurrent.txt')
    git(repo, 'commit', '-q', '-m', 'avance base')
    const baseBeforeFinalize = git(repo, 'rev-parse', 'HEAD')

    const res = wm.finalize('builder')

    expect(res).toMatchObject({ outcome: 'cleanup-pending', publishedSha: expect.any(String) })
    expect(existsSync(join(repo, 'b.txt'))).toBe(true)
    expect(existsSync(integrationPath)).toBe(true)
    expect(existsSync(agentPath)).toBe(true)

    const publishedHead = git(repo, 'rev-parse', 'HEAD')
    expect(res).toMatchObject({
      baseSha: baseBeforeFinalize,
      publishedSha: publishedHead,
      agentSha: expect.any(String)
    })
    if (res.outcome !== 'cleanup-pending') throw new Error('cleanup-pending attendu')
    expect(res.agentSha).not.toBe(res.publishedSha)
    locked = false
    git(repo, 'checkout', '-q', 'autre-branche')
    const otherBranchHead = git(repo, 'rev-parse', 'HEAD')
    const resumed = wm.cleanupPublished('builder', res.publishedSha, publishedBranch, res.agentSha)

    expect(resumed).toMatchObject({ outcome: 'merged', committed: false })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(otherBranchHead)
    expect(git(repo, 'rev-parse', publishedBranch)).toBe(publishedHead)
    expect(git(repo, 'show', `${publishedBranch}:b.txt`)).toContain('travail de la copie')
    expect(existsSync(join(repo, 'b.txt'))).toBe(false)
    expect(existsSync(integrationPath)).toBe(false)
    expect(existsSync(agentPath)).toBe(false)
  })

  it('réessaie sans prétendre que le bureau existe si sa recréation échoue', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const setup = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot })
    const agentPath = setup.acquire('restore-retry')
    writeFileSync(join(agentPath, 'published.txt'), 'publié\n')
    git(agentPath, 'add', 'published.txt')
    git(agentPath, 'commit', '-q', '-m', 'published')
    const publishedSha = git(agentPath, 'rev-parse', 'HEAD')
    git(repo, 'merge', '--ff-only', publishedSha)
    const recoveryBranch = 'autowin/recovery/restore-retry'
    git(agentPath, 'switch', '-C', recoveryBranch)
    git(repo, 'worktree', 'remove', '--force', agentPath)
    const lateSha = detachedCommit(repo, publishedSha, 'late.txt', 'à préserver\n')
    git(repo, 'update-ref', `refs/heads/${recoveryBranch}`, lateSha, publishedSha)
    const tryGitFn = (dir: string, args: string[]) => {
      const iWorktree = args.indexOf('worktree')
      if (
        dir === repo &&
        iWorktree >= 0 &&
        args[iWorktree + 1] === 'add' &&
        args[iWorktree + 2] === agentPath
      ) {
        return { code: 1, stdout: '', stderr: 'verrou temporaire' }
      }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return {
        code: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? ''
      }
    }
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot, tryGitFn })

    expect(wm.cleanupPublished('restore-retry', publishedSha, 'main')).toMatchObject({
      outcome: 'cleanup-pending',
      publishedSha,
      files: ['late.txt'],
      worktreeAvailable: false
    })
    expect(existsSync(agentPath)).toBe(false)
    expect(git(repo, 'rev-parse', `refs/heads/${recoveryBranch}`)).toBe(lateSha)
  })

  it('remove est idempotent', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    wm.acquire('x')
    wm.remove('x')
    expect(() => wm.remove('x')).not.toThrow()
  })

  it('ne touche pas une copie quand son appartenance Git est indémontrable', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const path = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot }).acquire(
      'indetermine'
    )
    writeFileSync(join(path, 'a.txt'), 'travail à préserver\n')
    const statusAvant = git(path, 'status', '--porcelain')
    const headAvant = git(path, 'rev-parse', 'HEAD')
    const guarded = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: wtRoot,
      tryGitFn: (cwd, args) => {
        if (args[0] === 'rev-parse' && args[1] === '--git-common-dir') {
          return { code: 1, stdout: '', stderr: 'probe indisponible' }
        }
        const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
        return {
          code: result.status ?? 1,
          stdout: result.stdout ?? '',
          stderr: result.stderr ?? ''
        }
      }
    })

    expect(guarded.finalize('indetermine')).toMatchObject({
      outcome: 'blocked',
      reason: 'merge-failed'
    })
    expect(git(path, 'status', '--porcelain')).toBe(statusAvant)
    expect(git(path, 'rev-parse', 'HEAD')).toBe(headAvant)
  })
})
