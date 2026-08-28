import { ESSAIS_MAX } from './delai-de-reprise'
import { execFileSync, spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Vrais dépôts git en tmp : le budget vitest par défaut (5 s) ne couvre pas ces cas.
 *
 * MESURÉ le 2026-08-28 : le fichier prend 152 s EN ISOLATION, et son cas le plus lourd
 * (« publie une seule fois apres un retry manuel epuise avant publication ») 27 s à lui seul — il
 * épuise le barème de reprise, donc ESSAIS_MAX passages de vrais processus git. Dans la suite
 * complète (934 fichiers, 4 workers), ce cas dépassait 60 s et sortait en « Test timed out », vert
 * dès qu'il était rejoué seul : le budget mesurait la CONTENTION, pas un blocage. 180 s laisse ~6x
 * la durée isolée ; un test réellement pendu échoue toujours.
 */
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 })
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'
import { WorktreeManager } from './worktree-manager'
import { WorktreeRunStateStore } from './worktree-run-state'

const roots: string[] = []

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
}

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'autowin-recovery-'))
  roots.push(dir)
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 't@t')
  git(dir, 'config', 'user.name', 'T')
  git(dir, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'a.txt'), 'base\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'init')
  return dir
}

function manager(repo: string): { manager: WorktreeManager; worktreeRoot: string } {
  const worktreeRoot = mkdtempSync(join(tmpdir(), 'autowin-recovery-root-'))
  roots.push(worktreeRoot)
  return {
    manager: new WorktreeManager({ baseRepo: repo, worktreeRoot }),
    worktreeRoot
  }
}

function stateStore(worktreeRoot: string): WorktreeRunStateStore {
  return new WorktreeRunStateStore(worktreeRoot, 'repo-test')
}

function authorizeGreenRecovery(
  manager: WorktreeManager,
  worktreeRoot: string,
  runId: string,
  now = Date.now()
): void {
  const context = manager.describe(runId)
  stateStore(worktreeRoot).save({
    version: 1,
    repoId: 'repo-test',
    runId,
    agentName: 'Builder',
    role: 'build',
    task: 'mutation vérifiée',
    worktreePath: context.worktreePath,
    baseBranch: context.baseBranch,
    baseSha: context.baseSha,
    verdict: 'green',
    publication: 'pending',
    files: manager.changedFiles(runId).map((path) => ({ path, kind: 'mod' })),
    createdAtMs: now,
    updatedAtMs: now
  })
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('récupération des worktrees après redémarrage', () => {
  it('conserve un run rouge après deux redémarrages sans modifier la base', () => {
    const repo = tempRepo()
    const previous = manager(repo)
    const store = stateStore(previous.worktreeRoot)
    const first = new RunWorktreeCoordinator({ manager: previous.manager, stateStore: store })
    const orphanPath = first.begin('run-crashed', 'Builder', true)!
    writeFileSync(join(orphanPath, 'recovered.txt'), 'rouge\n')
    first.end('run-crashed', { merge: false })
    const baseSha = git(repo, 'rev-parse', 'HEAD')

    const restartedManager = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: previous.worktreeRoot
    })
    const firstRestart = new RunWorktreeCoordinator({
      manager: restartedManager,
      stateStore: store
    })
    const secondRestart = new RunWorktreeCoordinator({
      manager: new WorktreeManager({ baseRepo: repo, worktreeRoot: previous.worktreeRoot }),
      stateStore: store
    })

    expect(existsSync(join(repo, 'recovered.txt'))).toBe(false)
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(baseSha)
    expect(restartedManager.listAgentIds()).toEqual(['run-crashed'])
    expect(firstRestart.activity()).toEqual([
      expect.objectContaining({ agentId: 'run-crashed', state: 'ready' })
    ])
    expect(secondRestart.activity()).toEqual([
      expect.objectContaining({ agentId: 'run-crashed', state: 'ready' })
    ])
  })

  it('reprend uniquement une copie autorisée par un verdict vert durable', () => {
    const repo = tempRepo()
    const previous = manager(repo)
    const orphanPath = previous.manager.acquire('run-green')
    writeFileSync(join(orphanPath, 'recovered.txt'), 'récupéré\n')
    authorizeGreenRecovery(previous.manager, previous.worktreeRoot, 'run-green')

    const restartedManager = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: previous.worktreeRoot
    })
    const coordinator = new RunWorktreeCoordinator({
      manager: restartedManager,
      stateStore: stateStore(previous.worktreeRoot)
    })

    expect(readFileSync(join(repo, 'recovered.txt'), 'utf8')).toContain('récupéré')
    expect(restartedManager.listAgentIds()).toEqual([])
    expect(coordinator.activity()).toEqual([
      expect.objectContaining({ agentId: 'run-green', state: 'merged' })
    ])
  })

  it.each([true, false])(
    'reconnaît une publication réussie après crash quand la référence de récupération est présente=%s',
    (keepRecoveryRef) => {
      const repo = tempRepo()
      const previous = manager(repo)
      const runId = keepRecoveryRef ? 'crash-with-ref' : 'crash-without-ref'
      const context = previous.manager.describe(runId)
      const agentPath = previous.manager.acquire(runId, context)
      writeFileSync(join(agentPath, 'published.txt'), 'déjà publié\n')
      git(agentPath, 'add', 'published.txt')
      git(agentPath, 'commit', '-m', 'agent published')
      const publishedSha = git(agentPath, 'rev-parse', 'HEAD')
      git(repo, 'merge', '--ff-only', publishedSha)
      const publishedHead = git(repo, 'rev-parse', 'HEAD')
      const recoveryBranch = `autowin/recovery/${runId}`
      git(agentPath, 'switch', '-C', recoveryBranch)
      git(repo, 'worktree', 'remove', '--force', agentPath)
      if (!keepRecoveryRef) git(repo, 'branch', '-D', recoveryBranch)
      stateStore(previous.worktreeRoot).save({
        version: 1,
        repoId: 'repo-test',
        runId,
        agentName: 'Builder',
        role: 'build',
        task: 'publication interrompue avant persistance finale',
        worktreePath: context.worktreePath,
        baseBranch: context.baseBranch,
        baseSha: context.baseSha,
        verdict: 'green',
        publication: 'integrating',
        publishedSha,
        files: [{ path: 'published.txt', kind: 'add' }],
        createdAtMs: 10,
        updatedAtMs: 20
      })

      const restartedManager = new WorktreeManager({
        baseRepo: repo,
        worktreeRoot: previous.worktreeRoot
      })
      const coordinator = new RunWorktreeCoordinator({
        manager: restartedManager,
        stateStore: stateStore(previous.worktreeRoot)
      })

      expect(git(repo, 'rev-parse', 'HEAD')).toBe(publishedHead)
      expect(readFileSync(join(repo, 'published.txt'), 'utf8')).toContain('déjà publié')
      expect(coordinator.activity()[0]).toMatchObject({
        state: 'merged',
        verdict: 'green',
        publication: 'complete',
        publishedSha
      })
      expect(restartedManager.listAgentIds()).toEqual([])
    }
  )

  it('reprend la SHA exacte d un merge publie avant la persistance finale', async () => {
    const repo = tempRepo()
    const remote = mkdtempSync(join(tmpdir(), 'autowin-recovery-remote-'))
    roots.push(remote)
    git(remote, 'init', '--bare', '-q')
    git(repo, 'remote', 'add', 'origin', remote)
    const previous = manager(repo)
    const runId = 'crash-after-merge-publish'
    const context = previous.manager.describe(runId)
    const agentPath = previous.manager.acquire(runId, context)
    writeFileSync(join(agentPath, 'agent.txt'), 'agent\n')
    git(agentPath, 'add', 'agent.txt')
    git(agentPath, 'commit', '-q', '-m', 'agent work')
    const agentSha = git(agentPath, 'rev-parse', 'HEAD')

    writeFileSync(join(repo, 'concurrent.txt'), 'base concurrente\n')
    git(repo, 'add', 'concurrent.txt')
    git(repo, 'commit', '-q', '-m', 'concurrent base')
    const publicationBaseSha = git(repo, 'rev-parse', 'HEAD')
    const integrationPath = mkdtempSync(join(tmpdir(), 'autowin-recovery-integration-'))
    rmSync(integrationPath, { recursive: true, force: true })
    roots.push(integrationPath)
    git(repo, 'worktree', 'add', '--detach', integrationPath, publicationBaseSha)
    git(integrationPath, '-c', 'commit.gpgsign=false', 'merge', '--no-edit', agentSha)
    const integratedSha = git(integrationPath, 'rev-parse', 'HEAD')
    git(repo, 'update-ref', `refs/autowin/publications/${runId}`, integratedSha)
    git(repo, 'merge', '--ff-only', integratedSha)
    git(repo, 'worktree', 'remove', '--force', integrationPath)

    const store = stateStore(previous.worktreeRoot)
    store.save({
      version: 1,
      repoId: 'repo-test',
      runId,
      agentName: 'Builder',
      role: 'build',
      task: 'reprend un merge exact',
      worktreePath: context.worktreePath,
      baseBranch: context.baseBranch,
      baseSha: context.baseSha,
      publicationBaseSha,
      publicationAgentSha: agentSha,
      verdict: 'green',
      publication: 'integrating',
      files: [{ path: 'agent.txt', kind: 'add' }],
      createdAtMs: 10,
      updatedAtMs: 20
    })
    const publications: Array<{ baseSha: string; agentSha: string }> = []
    new RunWorktreeCoordinator({
      manager: new WorktreeManager({ baseRepo: repo, worktreeRoot: previous.worktreeRoot }),
      stateStore: store,
      onRecoveredPublication: (publication) => {
        publications.push(publication)
        git(repo, 'push', 'origin', `${publication.agentSha}:refs/heads/auto/${runId}`)
      }
    })
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(publications).toEqual([
      expect.objectContaining({ baseSha: publicationBaseSha, agentSha: integratedSha })
    ])
    expect(git(remote, 'rev-parse', `refs/heads/auto/${runId}`)).toBe(integratedSha)
    expect(store.get(runId)).toMatchObject({
      publication: 'complete',
      publishedSha: integratedSha,
      causalPublicationDeliveredAtMs: expect.any(Number)
    })
    expect(() => git(repo, 'rev-parse', `refs/autowin/publications/${runId}`)).toThrow()

    new RunWorktreeCoordinator({
      manager: new WorktreeManager({ baseRepo: repo, worktreeRoot: previous.worktreeRoot }),
      stateStore: store,
      onRecoveredPublication: (publication) => {
        publications.push(publication)
      }
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(publications).toHaveLength(1)
  })

  it('reprend la publication après un crash juste après la préparation du commit agent', () => {
    const repo = tempRepo()
    const previous = manager(repo)
    const runId = 'crash-before-publish'
    const context = previous.manager.describe(runId)
    const agentPath = previous.manager.acquire(runId, context)
    writeFileSync(join(agentPath, 'prepared.txt'), 'préparé mais pas encore publié\n')
    git(agentPath, 'add', 'prepared.txt')
    git(agentPath, 'commit', '-m', 'agent prepared')
    const publishedSha = git(agentPath, 'rev-parse', 'HEAD')
    const baseHead = git(repo, 'rev-parse', 'HEAD')
    expect(() => git(repo, 'show', 'main:prepared.txt')).toThrow()
    stateStore(previous.worktreeRoot).save({
      version: 1,
      repoId: 'repo-test',
      runId,
      agentName: 'Builder',
      role: 'build',
      task: 'publication préparée avant crash',
      worktreePath: context.worktreePath,
      baseBranch: context.baseBranch,
      baseSha: context.baseSha,
      verdict: 'green',
      publication: 'integrating',
      publishedSha,
      files: [{ path: 'prepared.txt', kind: 'add' }],
      createdAtMs: 10,
      updatedAtMs: 20
    })

    const coordinator = new RunWorktreeCoordinator({
      manager: new WorktreeManager({ baseRepo: repo, worktreeRoot: previous.worktreeRoot }),
      stateStore: stateStore(previous.worktreeRoot)
    })

    expect(git(repo, 'rev-parse', 'HEAD')).not.toBe(baseHead)
    expect(readFileSync(join(repo, 'prepared.txt'), 'utf8')).toContain('pas encore publié')
    expect(coordinator.activity()[0]).toMatchObject({
      state: 'merged',
      verdict: 'green',
      publication: 'complete',
      publishedSha
    })
  })

  it('conserve une copie contenant un fichier ignoré non jetable', () => {
    const repo = tempRepo()
    writeFileSync(join(repo, '.gitignore'), '*.tmp\n')
    git(repo, 'add', '.gitignore')
    git(repo, 'commit', '-q', '-m', 'ignore tmp')
    const previous = manager(repo)
    const orphanPath = previous.manager.acquire('run-ignored')
    writeFileSync(join(orphanPath, 'result.tmp'), 'livrable ignoré\n')

    const restartedManager = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: previous.worktreeRoot
    })
    const coordinator = new RunWorktreeCoordinator({
      manager: restartedManager,
      stateStore: stateStore(previous.worktreeRoot)
    })

    expect(existsSync(join(orphanPath, 'result.tmp'))).toBe(true)
    expect(restartedManager.listAgentIds()).toEqual(['run-ignored'])
    expect(coordinator.activity()).toEqual([
      expect.objectContaining({
        agentId: 'run-ignored',
        state: 'blocked',
        files: [{ path: 'result.tmp', kind: 'mod' }],
        attentionReason: 'merge-failed',
        verdict: 'unknown',
        publication: 'blocked',
        worktreePath: orphanPath
      })
    ])
  })

  it('conserve un fichier arrivé pendant la publication juste avant le nettoyage', () => {
    const repo = tempRepo()
    writeFileSync(join(repo, '.gitignore'), '*.tmp\n')
    git(repo, 'add', '.gitignore')
    git(repo, 'commit', '-q', '-m', 'ignore tmp')
    const previous = manager(repo)
    const orphanPath = previous.manager.acquire('run-late-write')
    writeFileSync(join(orphanPath, 'tracked.txt'), 'travail suivi\n')
    authorizeGreenRecovery(previous.manager, previous.worktreeRoot, 'run-late-write')
    let injected = false
    const tryGitFn = (dir: string, args: string[]) => {
      if (
        !injected &&
        dir === repo &&
        args[0] === 'worktree' &&
        args[1] === 'repair' &&
        args.at(-1)?.includes('.quarantine')
      ) {
        injected = true
        writeFileSync(join(args.at(-1)!, 'late.tmp'), 'arrivé pendant la publication\n')
      }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return {
        code: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? ''
      }
    }

    const restartedManager = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: previous.worktreeRoot,
      tryGitFn
    })
    const coordinator = new RunWorktreeCoordinator({
      manager: restartedManager,
      stateStore: stateStore(previous.worktreeRoot)
    })

    expect(readFileSync(join(repo, 'tracked.txt'), 'utf8')).toContain('travail suivi')
    expect(existsSync(join(orphanPath, 'late.tmp'))).toBe(true)
    expect(restartedManager.listAgentIds()).toEqual(['run-late-write'])
    expect(coordinator.activity()).toEqual([
      expect.objectContaining({
        agentId: 'run-late-write',
        state: 'ready',
        publication: 'published',
        publishedSha: expect.stringMatching(/^[0-9a-f]{40}$/),
        attentionReason: 'post-publish-change',
        files: [{ path: 'late.tmp', kind: 'mod' }]
      })
    ])

    const publishedHead = git(repo, 'rev-parse', 'HEAD')
    const secondRestart = new RunWorktreeCoordinator({
      manager: new WorktreeManager({
        baseRepo: repo,
        worktreeRoot: previous.worktreeRoot
      }),
      stateStore: stateStore(previous.worktreeRoot)
    })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(publishedHead)
    expect(secondRestart.activity()).toEqual([
      expect.objectContaining({
        agentId: 'run-late-write',
        state: 'ready',
        publication: 'published',
        files: [{ path: 'late.tmp', kind: 'mod' }]
      })
    ])
  })

  it('attend la fin du CLI vivant avant de reprendre sa copie', () => {
    const repo = tempRepo()
    const previous = manager(repo)
    const orphanPath = previous.manager.acquire('run-active')
    writeFileSync(join(orphanPath, 'active.txt'), 'encore en cours\n')
    authorizeGreenRecovery(previous.manager, previous.worktreeRoot, 'run-active')
    previous.manager.markProcess('run-active', process.pid, true)

    const restartedManager = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: previous.worktreeRoot
    })
    const coordinator = new RunWorktreeCoordinator({
      manager: restartedManager,
      stateStore: stateStore(previous.worktreeRoot)
    })

    expect(existsSync(join(repo, 'active.txt'))).toBe(false)
    expect(existsSync(orphanPath)).toBe(true)
    expect(coordinator.activity()).toEqual([
      expect.objectContaining({ agentId: 'run-active', state: 'working' })
    ])

    restartedManager.markProcess('run-active', process.pid, false)
    coordinator.retryRecovery()

    expect(readFileSync(join(repo, 'active.txt'), 'utf8')).toContain('encore en cours')
    expect(restartedManager.listAgentIds()).toEqual([])
  })

  it('conserve un commit arrivé pendant la publication au lieu de supprimer sa copie', () => {
    const repo = tempRepo()
    const previous = manager(repo)
    const orphanPath = previous.manager.acquire('run-late-commit')
    writeFileSync(join(orphanPath, 'tracked.txt'), 'travail publié\n')
    authorizeGreenRecovery(previous.manager, previous.worktreeRoot, 'run-late-commit')
    let injected = false
    const tryGitFn = (dir: string, args: string[]) => {
      if (
        !injected &&
        dir === repo &&
        args[0] === 'worktree' &&
        args[1] === 'repair' &&
        args.at(-1)?.includes('.quarantine')
      ) {
        injected = true
        const quarantinePath = args.at(-1)!
        writeFileSync(join(quarantinePath, 'late-commit.txt'), 'commit tardif\n')
        git(quarantinePath, 'add', 'late-commit.txt')
        git(quarantinePath, 'commit', '-q', '-m', 'late commit')
      }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return {
        code: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? ''
      }
    }

    const restartedManager = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: previous.worktreeRoot,
      tryGitFn
    })
    const coordinator = new RunWorktreeCoordinator({
      manager: restartedManager,
      stateStore: stateStore(previous.worktreeRoot)
    })

    expect(readFileSync(join(repo, 'tracked.txt'), 'utf8')).toContain('travail publié')
    expect(existsSync(join(repo, 'late-commit.txt'))).toBe(false)
    expect(existsSync(join(orphanPath, 'late-commit.txt'))).toBe(true)
    expect(restartedManager.listAgentIds()).toEqual(['run-late-commit'])
    expect(coordinator.activity()).toEqual([
      expect.objectContaining({
        agentId: 'run-late-commit',
        state: 'ready',
        publication: 'published',
        attentionReason: 'post-publish-change',
        files: [{ path: 'late-commit.txt', kind: 'mod' }]
      })
    ])
  })

  it('nettoie une copie qui ne contient que des sorties régénérables', () => {
    const repo = tempRepo()
    writeFileSync(join(repo, '.gitignore'), 'node_modules\nout\n.eslintcache\n*.tsbuildinfo\n')
    git(repo, 'add', '.gitignore')
    git(repo, 'commit', '-q', '-m', 'ignore generated')
    const current = manager(repo)
    const path = current.manager.acquire('run-generated')
    mkdirSync(join(path, 'node_modules', 'pkg'), { recursive: true })
    mkdirSync(join(path, 'out'), { recursive: true })
    writeFileSync(join(path, 'node_modules', 'pkg', 'index.js'), 'generated\n')
    writeFileSync(join(path, 'out', 'bundle.js'), 'generated\n')
    writeFileSync(join(path, '.eslintcache'), 'generated\n')
    writeFileSync(join(path, 'tsconfig.web.tsbuildinfo'), 'generated\n')

    expect(current.manager.finalize('run-generated')).toMatchObject({ outcome: 'nothing' })
    expect(current.manager.listAgentIds()).toEqual([])
  })

  it("publie un travail accompagné de ses captures de preuve dans Audit/", () => {
    // Mesuré le 2026-08-21 (conv-1362) : le run « fond 3d animé » a produit sa preuve avec
    // `ui-capture --out Audit/accueil-3d-anime.png`, dans un dossier ignoré — et le refus des
    // ignorés non régénérables a bloqué SON PROPRE code, vert, avec le motif `merge-failed`.
    // `Audit/` est le dossier de preuves du harnais : régénérable par relance de la capture.
    const repo = tempRepo()
    writeFileSync(join(repo, '.gitignore'), 'node_modules\nout\nAudit/\n')
    git(repo, 'add', '.gitignore')
    git(repo, 'commit', '-q', '-m', 'ignore Audit')
    const current = manager(repo)
    const path = current.manager.acquire('run-audit-proof')
    writeFileSync(join(path, 'a.txt'), 'travail agent\n')
    mkdirSync(join(path, 'Audit'), { recursive: true })
    writeFileSync(join(path, 'Audit', 'accueil-3d-anime.png'), 'capture\n')

    expect(current.manager.finalize('run-audit-proof')).toMatchObject({ outcome: 'merged' })
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toContain('travail agent')
  })

  it('nomme le refus des ignorés non régénérables sans parler de fusion', () => {
    const repo = tempRepo()
    writeFileSync(join(repo, '.gitignore'), '*.tmp\n')
    git(repo, 'add', '.gitignore')
    git(repo, 'commit', '-q', '-m', 'ignore tmp')
    const current = manager(repo)
    const path = current.manager.acquire('run-livrable-ignore')
    writeFileSync(join(path, 'result.tmp'), 'livrable ignoré\n')

    // `merge-failed` envoyait chercher un conflit de fusion inexistant : aucune fusion n'est tentée.
    expect(current.manager.finalize('run-livrable-ignore')).toMatchObject({
      outcome: 'blocked',
      reason: 'ignored-deliverables',
      files: ['result.tmp']
    })
  })

  it("conserve les fichiers agent dans le manifeste après un blocage transitoire de l'index", () => {
    const repo = tempRepo()
    const worktreeRoot = mkdtempSync(join(tmpdir(), 'autowin-recovery-root-'))
    roots.push(worktreeRoot)
    let injected = false
    const tryGitFn = (dir: string, args: string[]) => {
      if (!injected && dir === repo && args.includes('merge') && args.includes('--ff-only')) {
        injected = true
        writeFileSync(join(repo, 'a.txt'), 'travail utilisateur indexé\n')
        git(repo, 'add', 'a.txt')
      }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return {
        code: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? ''
      }
    }
    const store = stateStore(worktreeRoot)
    const coordinator = new RunWorktreeCoordinator({
      manager: new WorktreeManager({ baseRepo: repo, worktreeRoot, tryGitFn }),
      stateStore: store
    })
    const runId = 'index-change-then-retry'
    const worktreePath = coordinator.begin(runId, 'Builder', true)!
    writeFileSync(join(worktreePath, 'b.txt'), 'travail agent\n')

    expect(coordinator.end(runId)).toMatchObject({
      outcome: 'blocked',
      reason: 'base-in-progress'
    })
    expect(store.get(runId)).toMatchObject({
      publication: 'pending',
      files: [{ path: 'b.txt', kind: 'mod' }]
    })

    coordinator.retryRecovery()

    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toContain('travail agent')
    expect(git(repo, 'status', '--porcelain')).toBe('M  a.txt')
    expect(store.get(runId)).toMatchObject({
      publication: 'complete',
      files: [{ path: 'b.txt', kind: 'mod' }]
    })
  })

  it('publie une seule fois apres un retry manuel epuise avant publication', () => {
    const repo = tempRepo()
    const current = manager(repo)
    const store = stateStore(current.worktreeRoot)
    const coordinator = new RunWorktreeCoordinator({
      manager: current.manager,
      stateStore: store
    })
    const runId = 'manual-retry-before-publication'
    const worktreePath = coordinator.begin(runId, 'Builder', true)!
    writeFileSync(join(worktreePath, 'a.txt'), 'manual retry\n', 'utf8')

    const marker = git(repo, 'rev-parse', '--git-path', 'BISECT_START')
    const operationMarker = isAbsolute(marker) ? marker : resolve(repo, marker)
    writeFileSync(operationMarker, 'blocked for test\n', 'utf8')

    expect(coordinator.end(runId)).toMatchObject({
      outcome: 'blocked',
      reason: 'base-in-progress'
    })
    // Épuiser le barème, quel que soit son plafond : `end()` compte pour le premier essai, d'où
    // le « -1 ». Écrit en dur (5), ce compte a rougi le jour où le barème est passé à sept.
    for (let attempt = 0; attempt < ESSAIS_MAX - 1; attempt += 1) coordinator.retryRecovery()

    expect(store.get(runId)).toMatchObject({
      verdict: 'green',
      publication: 'pending',
      attentionReason: 'retry-exhausted',
      retryCount: ESSAIS_MAX
    })

    rmSync(operationMarker, { force: true })
    expect(coordinator.retryRun(runId)).toMatchObject({
      state: 'merged',
      publication: 'complete'
    })
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toContain('manual retry')
    expect(git(repo, 'log', '--format=%s', '--grep', 'agent manual-retry-before-publication')).toBe(
      'agent manual-retry-before-publication'
    )
    expect(existsSync(worktreePath)).toBe(false)
  })
})
