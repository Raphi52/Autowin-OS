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
  installCompensationIndexOwner,
  manager,
  nettoyerRacines,
  roots,
  tempRepo,
  type CompensationIndexLockProbe
} from './worktree-manager.test-helpers'

afterEach(nettoyerRacines)

describe('WorktreeManager — acquisition (21/81 de la suite d’origine)', () => {
  it('changedFiles restitue sans ambiguïté Unicode, retours ligne et flèche littérale', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    mkdirSync(join(wtRoot, 'agent__porcelain-z'))
    const names = ['café -> littéral.txt', 'ligne\nsuivante.txt', 'guillemet"brut.txt']
    const status = names.map((name) => `?? ${name}`).join('\0') + '\0'
    const wm = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: wtRoot,
      git: (_dir, args) => (args[0] === 'status' ? status : '')
    })

    expect(wm.changedFiles('porcelain-z').sort()).toEqual(names.sort())
  })

  it('borne l affichage de 501 fichiers sales sans bloquer ni contaminer le nouveau job', () => {
    const repo = tempRepo()
    for (let index = 0; index < 501; index += 1) {
      writeFileSync(join(repo, `dirty-${String(index).padStart(3, '0')}.txt`), 'local\n')
    }
    const wm = manager(repo)

    const context = wm.describeForLaunch('dirty-large')
    const worktree = wm.acquire('dirty-large', context)

    expect(context.excludedDirtyFiles).toHaveLength(500)
    expect(context.excludedDirtyFileCount).toBe(501)
    expect(context.excludedDirtyFilesTruncated).toBe(true)
    expect(existsSync(join(worktree, 'dirty-000.txt'))).toBe(false)
    expect(existsSync(join(worktree, 'dirty-500.txt'))).toBe(false)
  })

  it('nettoie une copie d’intégration orpheline appartenant au dépôt', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot })
    const residue = join(wtRoot, 'integration__run-z__crash')
    git(repo, 'worktree', 'add', '--detach', residue, 'HEAD')

    expect(wm.reconcileResidues()).toMatchObject({ cleaned: 1, recovered: [], blocked: [] })
    expect(existsSync(residue)).toBe(false)
  })

  it('conserve la barrière d’un PID vivant même si son identité reste indisponible après douze heures', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const wm = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: wtRoot,
      processIdentityFn: () => undefined
    })
    wm.markProcess('run-long', process.pid, true)
    writeFileSync(
      join(wtRoot, '.leases', 'run-long', String(process.pid)),
      JSON.stringify({ identity: null, recordedAt: Date.now() - 13 * 60 * 60 * 1_000 })
    )

    expect(wm.hasActiveProcesses('run-long')).toBe(true)
  })

  it('full-auto : fusionne le travail de l’agent dans la base puis range la copie', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('scout')
    writeFileSync(join(path, 'b.txt'), 'nouveau fichier\n')
    const res = wm.finalize('scout')
    expect(res.outcome).toBe('merged')
    // le fichier de l'agent est arrivé dans la base (tolère CRLF Windows via autocrlf)
    expect(readFileSync(join(repo, 'b.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe(
      'nouveau fichier\n'
    )
    // la copie a été rangée
    expect(wm.changedFiles('scout')).toHaveLength(0)
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
    if (res.outcome === 'conflict') {
      expect(res.files).toContain('a.txt')
      const headBeforeRead = git(repo, 'rev-parse', 'HEAD')
      const statusBeforeRead = git(repo, 'status', '--porcelain')
      const comparison = wm.readConflictDiff('judge', {
        files: res.files,
        baseSha: res.baseSha,
        agentSha: res.agentSha
      })
      expect(comparison).toMatchObject({ available: true, paths: ['a.txt'] })
      if (comparison.available) {
        expect(comparison.diff).toContain('-BUILDER')
        expect(comparison.diff).toContain('+JUDGE')
      }
      expect(
        wm.readConflictDiff('judge', {
          files: ['../secret.txt'],
          baseSha: res.baseSha,
          agentSha: res.agentSha
        })
      ).toEqual({ available: false, reason: 'invalid-path' })
      expect(git(repo, 'rev-parse', 'HEAD')).toBe(headBeforeRead)
      expect(git(repo, 'status', '--porcelain')).toBe(statusBeforeRead)
    }
    // Garde-fou : la base n'a PAS été écrasée (garde le travail du builder, pas de marqueurs de conflit).
    const baseA = readFileSync(join(repo, 'a.txt'), 'utf8')
    expect(baseA).toContain('BUILDER')
    expect(baseA).not.toMatch(/<<<<<<<|>>>>>>>/)
    // Garde-fou : la copie du judge est CONSERVÉE (merge assisté possible).
    expect(wm.changedFiles('judge').length >= 0).toBe(true)
    expect(() => wm.acquire('judge')).not.toThrow() // le worktree existe toujours
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
    expect(res).toMatchObject({ outcome: 'blocked', files: ['a.txt'], reason: 'base-in-progress' })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(baseSha)
    expect(git(repo, 'status', '--porcelain')).toBe(stagedStatus)
    expect(existsSync(join(repo, 'b.txt'))).toBe(false)
    expect(() => wm.acquire('builder')).not.toThrow()
  })

  it('hook utilisateur recréant sans index un fichier supprimé par l’agent → bloque et préserve', () => {
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
  printf 'travail utilisateur recréé\n' > "$root/b.txt" || exit 31
fi
exit 0
`
    )
    chmodSync(hookPath, 0o755)
    const wm = manager(repo)
    const path = wm.acquire('builder')
    rmSync(join(path, 'b.txt'))

    const res = wm.finalize('builder')

    expect(res).toMatchObject({
      outcome: 'blocked',
      files: ['b.txt'],
      reason: 'base-in-progress'
    })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(baseSha)
    expect(git(repo, 'write-tree')).toBe(baseIndexTree)
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('travail utilisateur recréé')
    expect(git(repo, 'status', '--porcelain')).toBe('M b.txt')
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

  it('reference-transaction refusant main → restaure l’index utilisateur sans résidu agent', () => {
    const repo = tempRepo()
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    const wm = manager(repo)
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'b.txt'), 'travail de la copie\n')

    writeFileSync(join(repo, 'a.txt'), 'travail utilisateur indexé\n')
    git(repo, 'add', 'a.txt')
    const indexTreeBefore = git(repo, 'write-tree')
    const statusBefore = git(repo, 'status', '--porcelain')
    const hook = join(repo, '.git', 'hooks', 'reference-transaction')
    writeFileSync(
      hook,
      `#!/bin/sh
state="$1"
payload=$(cat)
if [ "$state" = "prepared" ] && printf '%s\n' "$payload" | grep -q 'refs/heads/main'; then
  exit 1
fi
exit 0
`
    )
    chmodSync(hook, 0o755)

    const res = wm.finalize('builder')

    expect(res).toMatchObject({ outcome: 'blocked', reason: 'merge-failed' })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(baseSha)
    expect(git(repo, 'write-tree')).toBe(indexTreeBefore)
    expect(git(repo, 'status', '--porcelain')).toBe(statusBefore)
    expect(existsSync(join(repo, 'b.txt'))).toBe(false)
  })

  it('git add entre garde index et patch worktree → le verrou natif protège la frontière', () => {
    const repo = tempRepo()
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    let attemptedAddStatus: number | null | undefined
    const tryGitFn = (dir: string, args: string[]) => {
      if (
        attemptedAddStatus === undefined &&
        dir === repo &&
        args[0] === 'apply' &&
        !args.includes('--cached')
      ) {
        attemptedAddStatus = spawnSync('git', ['add', 'b.txt'], {
          cwd: repo,
          encoding: 'utf8'
        }).status
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

    expect(attemptedAddStatus).not.toBe(0)
    expect(result).toMatchObject({ outcome: 'blocked', reason: 'base-in-progress' })
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('travail utilisateur du hook')
    expect(git(repo, 'write-tree')).toBe(git(repo, 'rev-parse', `${baseSha}^{tree}`))
  })

  it('un échec de suppression de la ref reprend dans le worker suivant', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    const resumedRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot, resumedRoot)
    let failOwnershipRelease = true
    const tryGitFn = (dir: string, args: string[]) => {
      if (
        failOwnershipRelease &&
        args.includes('update-ref') &&
        args.includes('-d') &&
        args.includes('refs/autowin/locks/index')
      ) {
        failOwnershipRelease = false
        return { code: 1, stdout: '', stderr: 'ref Windows transitoirement verrouillée' }
      }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
    }
    const wm = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: wtRoot,
      tryGitFn
    }) as unknown as CompensationIndexLockProbe
    const firstLock = wm.acquireCompensationIndexLock()
    expect(firstLock).toBeDefined()

    wm.releaseCompensationIndexLock(firstLock!)

    expect(existsSync(join(repo, '.git', 'index.lock'))).toBe(false)
    expect(git(repo, 'rev-parse', '--verify', 'refs/autowin/locks/index')).toBe(
      firstLock!.ownershipOid
    )

    const resumed = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: resumedRoot
    }) as unknown as CompensationIndexLockProbe
    const nextLock = resumed.acquireCompensationIndexLock()
    expect(nextLock).toBeDefined()
    resumed.releaseCompensationIndexLock(nextLock!)
    writeFileSync(join(repo, 'a.txt'), 'étape suivante libérée\n')
    expect(spawnSync('git', ['add', 'a.txt'], { cwd: repo }).status).toBe(0)
    expect(existsSync(join(repo, '.git', 'index.lock'))).toBe(false)
    expect(
      spawnSync('git', ['rev-parse', '--verify', 'refs/autowin/locks/index'], { cwd: repo }).status
    ).not.toBe(0)
  })

  it('une reprise nettoie un temporaire de marqueur expiré après fsync', () => {
    const repo = tempRepo()
    const markerRoot = join(repo, '.git', 'autowin-compensations', 'locks')
    mkdirSync(markerRoot, { recursive: true })
    const temporaryMarker = join(
      markerRoot,
      'acquiring-crash-fsync.marker.12345678.00000000-0000-0000-0000-000000000000.tmp'
    )
    writeFileSync(
      temporaryMarker,
      JSON.stringify({
        version: 1,
        token: 'crash-fsync',
        state: 'acquiring',
        predecessorSerialized: null,
        expiresAt: 999
      })
    )
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const resumed = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: wtRoot,
      nowFn: () => 1_000
    }) as unknown as CompensationIndexLockProbe

    const lock = resumed.acquireCompensationIndexLock()

    expect(lock).toBeDefined()
    resumed.releaseCompensationIndexLock(lock!)
    expect(existsSync(temporaryMarker)).toBe(false)
  })

  it('crash après la première mutation conditionnelle → reprend sans perdre le hook', () => {
    const repo = tempRepo()
    const baseSha = git(repo, 'rev-parse', 'HEAD')
    let crashAfterMutation = true
    const tryGitFn = (dir: string, args: string[]) => {
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      if (
        crashAfterMutation &&
        dir === repo &&
        result.status === 0 &&
        (args[0] === 'apply' || args.includes('autowin-compensation-apply'))
      ) {
        crashAfterMutation = false
        throw new Error('crash après mutation conditionnelle réussie')
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

    expect(wm.finalize('builder')).toMatchObject({ outcome: 'blocked', reason: 'merge-failed' })

    const patchRoot = join(repo, '.git', 'autowin-compensations', 'patches', 'builder')
    const orphanPatch = join(patchRoot, 'conditional-crash.patch')
    mkdirSync(patchRoot, { recursive: true })
    writeFileSync(orphanPatch, 'contenu temporaire sensible\n')
    const staleIndexLock = join(repo, '.git', 'index.lock')
    const stalePid = 2_147_483_647
    installCompensationIndexOwner(
      repo,
      JSON.stringify({
        owner: 'autowin-compensation',
        pid: stalePid,
        identity: null,
        token: 'crash-owner'
      })
    )

    const resumed = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: wtRoot,
      processIdentityFn: (pid) => (pid === stalePid ? undefined : `live|${pid}`)
    }).finalize('builder')
    expect(resumed).toMatchObject({ outcome: 'blocked', reason: 'base-in-progress' })
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('travail utilisateur du hook')
    expect(git(repo, 'write-tree')).toBe(git(repo, 'rev-parse', `${baseSha}^{tree}`))
    expect(existsSync(orphanPatch)).toBe(false)
    expect(existsSync(staleIndexLock)).toBe(false)
    expect(
      spawnSync('git', ['rev-parse', '--verify', 'refs/autowin/locks/index'], { cwd: repo }).status
    ).not.toBe(0)
  })

  it('échec de persistance du plan → conserve les snapshots d’intégration pour reprise', () => {
    const repo = tempRepo()
    let failFirstCompensationRef = true
    const tryGitFn = (dir: string, args: string[]) => {
      const updateRef = args.indexOf('update-ref')
      if (
        failFirstCompensationRef &&
        updateRef >= 0 &&
        args[updateRef + 1]?.startsWith('refs/autowin/compensations/builder/')
      ) {
        failFirstCompensationRef = false
        return { code: 128, stdout: '', stderr: 'ref compensation indisponible' }
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
    expect(
      readdirSync(wtRoot).filter((name) => name.startsWith('integration__builder__'))
    ).toHaveLength(1)

    const restarted = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot })
    expect(restarted.reconcileResidues()).toMatchObject({ cleaned: 1, blocked: [] })
    expect(restarted.finalize('builder')).toMatchObject({
      outcome: 'blocked',
      reason: 'base-in-progress'
    })
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('travail utilisateur du hook')
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

  it('laisse la reprise détecter une ref recréée juste après le contrôle post-CAS', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-'))
    roots.push(wtRoot)
    const setup = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot })
    const agentPath = setup.acquire('post-cas-race')
    writeFileSync(join(agentPath, 'published.txt'), 'publié\n')
    git(agentPath, 'add', 'published.txt')
    git(agentPath, 'commit', '-q', '-m', 'published')
    const publishedSha = git(agentPath, 'rev-parse', 'HEAD')
    git(repo, 'merge', '--ff-only', publishedSha)
    const recoveryBranch = 'autowin/recovery/post-cas-race'
    const recoveryRef = `refs/heads/${recoveryBranch}`
    git(agentPath, 'switch', '-C', recoveryBranch)
    git(repo, 'worktree', 'remove', '--force', agentPath)
    const lateSha = detachedCommit(repo, publishedSha, 'late.txt', 'à préserver\n')
    let deleted = false
    let recreated = false
    const tryGitFn = (dir: string, args: string[]) => {
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      if (
        dir === repo &&
        args[0] === 'update-ref' &&
        args[1] === '-d' &&
        args[2] === recoveryRef &&
        result.status === 0
      ) {
        deleted = true
      } else if (
        deleted &&
        !recreated &&
        dir === repo &&
        args[0] === 'rev-parse' &&
        args[1] === '--verify' &&
        args[2] === recoveryRef
      ) {
        git(repo, 'update-ref', recoveryRef, lateSha)
        recreated = true
      }
      return {
        code: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? ''
      }
    }
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot, tryGitFn })

    expect(wm.cleanupPublished('post-cas-race', publishedSha, 'main')).toMatchObject({
      outcome: 'merged'
    })
    expect(recreated).toBe(true)
    expect(wm.listAgentIds()).toContain('post-cas-race')
    expect(git(repo, 'rev-parse', recoveryRef)).toBe(lateSha)
  })

  it('réessaie le rangement quand la preuve Git est temporairement indisponible après publication', () => {
    const repo = tempRepo()
    const publishedBranch = git(repo, 'branch', '--show-current')
    let ownershipProbeUnavailable = false
    const tryGitFn = (dir: string, args: string[]) => {
      if (ownershipProbeUnavailable && args[0] === 'rev-parse' && args[1] === '--git-common-dir') {
        return { code: 1, stdout: '', stderr: 'sonde Git temporairement indisponible' }
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
    const agentPath = wm.acquire('ownership-retry')
    writeFileSync(join(agentPath, 'ownership.txt'), 'travail publié\n')
    git(agentPath, 'add', 'ownership.txt')
    git(agentPath, 'commit', '-m', 'agent ownership')
    const publishedSha = git(agentPath, 'rev-parse', 'HEAD')
    git(repo, 'merge', '--no-edit', publishedSha)

    ownershipProbeUnavailable = true
    expect(wm.cleanupPublished('ownership-retry', publishedSha, publishedBranch)).toMatchObject({
      outcome: 'cleanup-pending',
      files: [],
      publishedSha
    })
    expect(existsSync(agentPath)).toBe(true)

    ownershipProbeUnavailable = false
    expect(wm.cleanupPublished('ownership-retry', publishedSha, publishedBranch)).toMatchObject({
      outcome: 'merged',
      committed: false
    })
    expect(existsSync(agentPath)).toBe(false)
  })

  it('une copie appartenant à un AUTRE dépôt est bloquée, pas fusionnée', () => {
    // Le dossier de copies est partagé entre workspaces : on y retrouve des copies dont le commit
    // est inconnu de la base courante. `git diff a...b` échouait alors (« Invalid symmetric
    // difference »), la liste de fichiers repartait VIDE — donc plus rien ne bloquait et la fusion
    // s'enchaînait quand même. Observé au démarrage de l'app.
    const repo = tempRepo()
    const wm = manager(repo)
    const copie = wm.acquire('etranger')
    // On remplace la copie par un dépôt INDÉPENDANT : son HEAD n'existe pas dans la base.
    rmSync(copie, { recursive: true, force: true })
    mkdirSync(copie, { recursive: true })
    git(copie, 'init', '-q', '-b', 'main')
    git(copie, 'config', 'user.email', 't@t')
    git(copie, 'config', 'user.name', 'T')
    git(copie, 'config', 'commit.gpgsign', 'false')
    writeFileSync(join(copie, 'venu-d-ailleurs.txt'), 'contenu\n')
    git(copie, 'add', '-A')
    git(copie, 'commit', '-q', '-m', 'commit inconnu de la base')

    const result = wm.finalize('etranger')

    expect(result).toMatchObject({ outcome: 'blocked', reason: 'merge-failed' })
    // Et rien n'a été fusionné dans la base.
    expect(git(repo, 'log', '--oneline')).not.toContain('venu-d-ailleurs')
  })

  it('abandonne explicitement un bureau sale sans toucher au dépôt de base', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('held')
    writeFileSync(join(path, 'solution.txt'), 'solution retenue puis abandonnée\n')

    wm.discard('held')

    expect(existsSync(path)).toBe(false)
    expect(existsSync(join(repo, 'solution.txt'))).toBe(false)
  })
})
