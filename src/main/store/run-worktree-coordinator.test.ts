import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'
import type { FinalizeResult } from './worktree-manager'
import { WorktreeRunStateStore } from './worktree-run-state'

const TEST_SHA = '1'.repeat(40)
const PUBLISHED_SHA = 'a'.repeat(40)

function fakeManager(
  over: Partial<{
    acquire: (
      id: string,
      context?: {
        workspacePath: string
        worktreePath: string
        baseBranch: string
        baseSha: string
      }
    ) => string
    finalize: (
      id: string,
      options?: {
        baseBranch?: string
        expectedAgentSha?: string
        onPrepared?: (agentSha: string, baseSha: string) => void
      }
    ) => FinalizeResult
    cleanupPublished: (id: string, sha: string, baseBranch?: string) => FinalizeResult
    readConflictDiff: (
      id: string,
      snapshot: { files: string[]; baseSha: string; agentSha: string }
    ) => { available: true; agentId: string; paths: string[]; diff: string }
    changedFiles: (id: string) => string[]
    remove: (id: string) => void
    listAgentIds: () => string[]
    markProcess: (id: string, pid: number, active: boolean) => void
    markSpawnIntent: (id: string, token: string, active: boolean) => void
    confirmSpawn: (id: string, token: string, pid: number) => void
    hasActiveProcesses: (id: string) => boolean
    validateRecoveryContext: (
      id: string,
      context: {
        worktreePath: string
        baseBranch: string
        baseSha: string
        publication: 'pending' | 'integrating' | 'published' | 'cleanup-pending'
        publishedSha?: string
      }
    ) =>
      { ok: true; decision?: 'resume-publication' | 'cleanup-only' } | { ok: false; detail: string }
    describe: (id: string) => {
      workspacePath: string
      worktreePath: string
      baseBranch: string
      baseSha: string
    }
  }> = {}
) {
  return {
    acquire: over.acquire ?? ((id: string) => `/wt/${id}`),
    finalize:
      over.finalize ??
      ((id: string) => ({ outcome: 'merged', agentId: id, committed: true }) as FinalizeResult),
    cleanupPublished:
      over.cleanupPublished ??
      ((id: string) => ({ outcome: 'merged', agentId: id, committed: false }) as FinalizeResult),
    ...(over.readConflictDiff ? { readConflictDiff: over.readConflictDiff } : {}),
    changedFiles: over.changedFiles ?? (() => ['os.ts']),
    remove: over.remove ?? (() => {}),
    listAgentIds: over.listAgentIds ?? (() => []),
    markProcess: over.markProcess ?? (() => {}),
    markSpawnIntent: over.markSpawnIntent ?? (() => {}),
    confirmSpawn: over.confirmSpawn ?? (() => {}),
    hasActiveProcesses: over.hasActiveProcesses ?? (() => false),
    validateRecoveryContext: over.validateRecoveryContext ?? (() => ({ ok: true as const })),
    describe:
      over.describe ??
      ((id: string) => ({
        workspacePath: '/repo',
        worktreePath: `/wt/${id}`,
        baseBranch: 'main',
        baseSha: '1111111'
      }))
  }
}

describe('RunWorktreeCoordinator (flip live)', () => {
  it('reprend exactement la copie durable du run au lieu de recréer un bureau vide', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-resume-worktree-'))
    try {
      const runId = 'run-resume'
      const worktreePath = join(root, `agent__${runId}`)
      const stateStore = new WorktreeRunStateStore(root, 'repo-a')
      stateStore.save({
        version: 1,
        repoId: 'repo-a',
        runId,
        agentName: 'Builder',
        worktreePath,
        baseBranch: 'main',
        baseSha: TEST_SHA,
        verdict: 'interrupted',
        publication: 'blocked',
        files: [{ path: 'src/feature.ts', kind: 'mod' }],
        createdAtMs: 10,
        updatedAtMs: 20
      })
      const acquire = vi.fn(
        (_id: string, context?: { worktreePath: string }) => context?.worktreePath ?? ''
      )
      const coordinator = new RunWorktreeCoordinator({
        manager: fakeManager({
          acquire,
          listAgentIds: () => [runId],
          describe: (id) => ({
            workspacePath: '/repo',
            worktreePath: join(root, `agent__${id}`),
            baseBranch: 'main',
            baseSha: '2'.repeat(40)
          })
        }),
        stateStore,
        nowFn: () => 30
      })

      expect(
        coordinator.begin(runId, 'Builder', true, {
          task: 'corrige',
          role: 'build',
          resumeExisting: true
        })
      ).toBe(worktreePath)
      expect(acquire).toHaveBeenCalledWith(
        runId,
        expect.objectContaining({ worktreePath, baseSha: TEST_SHA })
      )
      expect(coordinator.activity()[0]).toMatchObject({
        agentId: runId,
        state: 'working',
        worktreePath,
        baseSha: TEST_SHA,
        endedAtMs: undefined
      })
      expect(stateStore.get(runId)).toMatchObject({
        verdict: 'running',
        publication: 'not-requested',
        worktreePath,
        baseSha: TEST_SHA
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reprend en worker un run green bloqué sans republier ses anciens champs de conflit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-resume-blocked-worktree-'))
    try {
      const runId = 'run-resume-blocked'
      const worktreePath = join(root, `agent__${runId}`)
      const stateStore = new WorktreeRunStateStore(root, 'repo-a')
      stateStore.save({
        version: 1,
        repoId: 'repo-a',
        runId,
        agentName: 'Builder',
        worktreePath,
        baseBranch: 'main',
        baseSha: TEST_SHA,
        verdict: 'green',
        publication: 'blocked',
        files: [{ path: 'src/feature.ts', kind: 'mod' }],
        conflictFile: 'src/feature.ts',
        conflictBaseSha: '2'.repeat(40),
        conflictAgentSha: '3'.repeat(40),
        publicationBaseSha: '2'.repeat(40),
        publicationAgentSha: '3'.repeat(40),
        attentionReason: 'conflict',
        detail: 'conflit précédent',
        createdAtMs: 10,
        updatedAtMs: 20
      })
      const context = {
        workspacePath: root,
        worktreePath,
        baseBranch: 'main',
        baseSha: TEST_SHA
      }
      const coordinator = new RunWorktreeCoordinator({
        manager: {
          ...fakeManager({
            listAgentIds: () => [runId],
            describe: () => context
          }),
          describeAsync: vi.fn(async () => context),
          prepareAsync: vi.fn(async () => ({ context, path: worktreePath })),
          validateRecoveryContextAsync: vi.fn(async () => ({ ok: true as const }))
        },
        stateStore,
        nowFn: () => 30
      })

      await expect(
        coordinator.beginAsync(runId, 'Builder', true, {
          task: 'reprends',
          role: 'build',
          resumeExisting: true
        })
      ).resolves.toBe(worktreePath)
      expect(stateStore.get(runId)).toMatchObject({
        verdict: 'running',
        publication: 'not-requested',
        worktreePath,
        baseSha: TEST_SHA
      })
      expect(stateStore.get(runId)).not.toMatchObject({
        conflictFile: expect.anything(),
        conflictBaseSha: expect.anything(),
        conflictAgentSha: expect.anything(),
        publicationBaseSha: expect.anything(),
        publicationAgentSha: expect.anything()
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuse deux reprises worker concurrentes du même worktree', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-double-resume-worktree-'))
    let releaseFirst: (() => void) | undefined
    try {
      const runId = 'run-double-resume'
      const worktreePath = join(root, `agent__${runId}`)
      const stateStore = new WorktreeRunStateStore(root, 'repo-a')
      stateStore.save({
        version: 1,
        repoId: 'repo-a',
        runId,
        agentName: 'Builder',
        worktreePath,
        baseBranch: 'main',
        baseSha: TEST_SHA,
        verdict: 'interrupted',
        publication: 'blocked',
        files: [],
        createdAtMs: 10,
        updatedAtMs: 20
      })
      const context = {
        workspacePath: root,
        worktreePath,
        baseBranch: 'main',
        baseSha: TEST_SHA
      }
      let firstEntered!: () => void
      const firstEnteredPromise = new Promise<void>((resolve) => {
        firstEntered = resolve
      })
      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      const prepareAsync = vi
        .fn()
        .mockImplementationOnce(async () => {
          firstEntered()
          await firstGate
          return { context, path: worktreePath }
        })
        .mockResolvedValue({ context, path: worktreePath })
      const coordinator = new RunWorktreeCoordinator({
        manager: {
          ...fakeManager({ listAgentIds: () => [runId], describe: () => context }),
          describeAsync: vi.fn(async () => context),
          prepareAsync,
          validateRecoveryContextAsync: vi.fn(async () => ({ ok: true as const })),
          hasActiveProcessesAsync: vi.fn(async () => false)
        },
        stateStore,
        nowFn: () => 30
      })

      const first = coordinator.beginAsync(runId, 'Builder', true, { resumeExisting: true })
      await firstEnteredPromise
      const second = coordinator.beginAsync(runId, 'Builder', true, { resumeExisting: true })
      const secondOutcome = await Promise.race([
        second.then(
          () => 'resolved',
          () => 'rejected'
        ),
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 100))
      ])

      expect(secondOutcome).toBe('rejected')
      expect(prepareAsync).toHaveBeenCalledTimes(1)
      releaseFirst?.()
      await expect(first).resolves.toBe(worktreePath)
    } finally {
      releaseFirst?.()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuse une reprise sync ou worker tant que le CLI du run est actif', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-active-resume-worktree-'))
    try {
      const runId = 'run-active-resume'
      const worktreePath = join(root, `agent__${runId}`)
      const context = {
        workspacePath: root,
        worktreePath,
        baseBranch: 'main',
        baseSha: TEST_SHA
      }
      const saveRecord = (): WorktreeRunStateStore => {
        const stateStore = new WorktreeRunStateStore(root, 'repo-a')
        stateStore.save({
          version: 1,
          repoId: 'repo-a',
          runId,
          agentName: 'Builder',
          worktreePath,
          baseBranch: 'main',
          baseSha: TEST_SHA,
          verdict: 'interrupted',
          publication: 'blocked',
          files: [],
          createdAtMs: 10,
          updatedAtMs: 20
        })
        return stateStore
      }
      const acquire = vi.fn(() => worktreePath)
      const syncCoordinator = new RunWorktreeCoordinator({
        manager: fakeManager({
          acquire,
          listAgentIds: () => [runId],
          describe: () => context,
          hasActiveProcesses: () => true
        }),
        stateStore: saveRecord(),
        nowFn: () => 30
      })

      expect(() => syncCoordinator.begin(runId, 'Builder', true, { resumeExisting: true })).toThrow(
        /déjà actif|processus.*actif/i
      )
      expect(acquire).not.toHaveBeenCalled()

      const prepareAsync = vi.fn(async () => ({ context, path: worktreePath }))
      const asyncCoordinator = new RunWorktreeCoordinator({
        manager: {
          ...fakeManager({ listAgentIds: () => [runId], describe: () => context }),
          describeAsync: vi.fn(async () => context),
          prepareAsync,
          validateRecoveryContextAsync: vi.fn(async () => ({ ok: true as const })),
          hasActiveProcessesAsync: vi.fn(async () => true)
        },
        stateStore: saveRecord(),
        nowFn: () => 30
      })

      await expect(
        asyncCoordinator.beginAsync(runId, 'Builder', true, { resumeExisting: true })
      ).rejects.toThrow(/processus.*actif/i)
      expect(prepareAsync).not.toHaveBeenCalled()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('autorise la reprise récupérée quand le CLI vient de finir malgré un état working périmé', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-stale-working-resume-'))
    try {
      const runId = 'run-stale-working'
      const worktreePath = join(root, `agent__${runId}`)
      const stateStore = new WorktreeRunStateStore(root, 'repo-a')
      stateStore.save({
        version: 1,
        repoId: 'repo-a',
        runId,
        agentName: 'Builder',
        worktreePath,
        baseBranch: 'main',
        baseSha: TEST_SHA,
        verdict: 'green',
        publication: 'blocked',
        files: [{ path: 'src/feature.ts', kind: 'mod' }],
        conflictFile: 'src/feature.ts',
        conflictBaseSha: '2'.repeat(40),
        conflictAgentSha: '3'.repeat(40),
        createdAtMs: 10,
        updatedAtMs: 20
      })
      const context = {
        workspacePath: root,
        worktreePath,
        baseBranch: 'main',
        baseSha: TEST_SHA
      }
      let active = true
      const prepareAsync = vi.fn(async () => ({ context, path: worktreePath }))
      const coordinator = new RunWorktreeCoordinator({
        manager: {
          ...fakeManager({
            listAgentIds: () => [runId],
            describe: () => context,
            hasActiveProcesses: () => active
          }),
          describeAsync: vi.fn(async () => context),
          prepareAsync,
          validateRecoveryContextAsync: vi.fn(async () => ({ ok: true as const })),
          hasActiveProcessesAsync: vi.fn(async () => active)
        },
        stateStore,
        nowFn: () => 30
      })
      expect(coordinator.activity()[0]).toMatchObject({ agentId: runId, state: 'working' })

      active = false
      await expect(
        coordinator.beginAsync(runId, 'Builder', true, { resumeExisting: true })
      ).resolves.toBe(worktreePath)
      await expect(
        coordinator.beginAsync(runId, 'Builder', true, { resumeExisting: true })
      ).rejects.toThrow(/déjà actif/i)
      expect(prepareAsync).toHaveBeenCalledTimes(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('ne rouvre jamais comme pending un résidu déjà publié', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-published-residue-resume-'))
    try {
      const runId = 'run-published-residue'
      const worktreePath = join(root, `agent__${runId}`)
      const stateStore = new WorktreeRunStateStore(root, 'repo-a')
      const context = {
        workspacePath: root,
        worktreePath,
        baseBranch: 'main',
        baseSha: TEST_SHA
      }
      const prepareAsync = vi.fn(async () => ({ context, path: worktreePath }))
      const coordinator = new RunWorktreeCoordinator({
        manager: {
          ...fakeManager({ listAgentIds: () => [], describe: () => context }),
          describeAsync: vi.fn(async () => context),
          prepareAsync,
          validateRecoveryContextAsync: vi.fn(async () => ({ ok: true as const })),
          hasActiveProcessesAsync: vi.fn(async () => false)
        },
        stateStore,
        nowFn: () => 30
      })
      stateStore.save({
        version: 1,
        repoId: 'repo-a',
        runId,
        agentName: 'Builder',
        worktreePath,
        worktreeAvailable: true,
        baseBranch: 'main',
        baseSha: TEST_SHA,
        verdict: 'green',
        publication: 'published',
        files: [{ path: 'src/human-after-publish.ts', kind: 'mod' }],
        publishedSha: '4'.repeat(40),
        publicationBaseSha: TEST_SHA,
        publicationAgentSha: '5'.repeat(40),
        attentionReason: 'post-publish-change',
        createdAtMs: 10,
        updatedAtMs: 20
      })

      await expect(
        coordinator.beginAsync(runId, 'Builder', true, { resumeExisting: true })
      ).rejects.toThrow(/publication.*published|déjà publiée/i)
      expect(prepareAsync).not.toHaveBeenCalled()
      expect(stateStore.get(runId)).toMatchObject({
        publication: 'published',
        publishedSha: '4'.repeat(40),
        files: [{ path: 'src/human-after-publish.ts', kind: 'mod' }]
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('récupère l’inventaire Git en worker sans bloquer le heartbeat du main', async () => {
    const listAgentIds = vi.fn(() => {
      throw new Error('le chemin synchrone ne doit pas être appelé')
    })
    let heartbeat = false
    setTimeout(() => {
      heartbeat = true
    }, 5)
    const coordinator = new RunWorktreeCoordinator({
      manager: {
        ...fakeManager({ listAgentIds }),
        operationsAreIsolated: () => true,
        recoveryInventoryAsync: () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  residues: { cleaned: 0, recovered: [], blocked: [] },
                  agents: []
                }),
              25
            )
          )
      }
    })

    expect(coordinator.activity()).toEqual([])
    await new Promise((resolve) => setTimeout(resolve, 35))
    expect(heartbeat).toBe(true)
    expect(listAgentIds).not.toHaveBeenCalled()
  })

  it('run MUTATION → acquiert une copie et renvoie son cwd', () => {
    const acquire = vi.fn((id: string) => `/wt/${id}`)
    const co = new RunWorktreeCoordinator({ manager: fakeManager({ acquire }), nowFn: () => 1 })
    const cwd = co.begin('run-1', 'Builder', true)
    expect(cwd).toBe('/wt/run-1')
    expect(acquire).toHaveBeenCalledWith('run-1', {
      workspacePath: '/repo',
      worktreePath: '/wt/run-1',
      baseBranch: 'main',
      baseSha: '1111111'
    })
    expect(co.activity()[0]).toMatchObject({ agentId: 'run-1', state: 'working' })
  })

  it('prépare atomiquement la base fraîche puis persiste le contexte complet', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-async-begin-'))
    try {
      const runId = 'run-async-begin'
      const worktreePath = join(root, `agent__${runId}`)
      const context = {
        workspacePath: root,
        worktreePath,
        baseBranch: 'main',
        baseSha: TEST_SHA,
        excludedDirtyFiles: Array.from({ length: 500 }, (_, index) => `dirty-${index}.txt`),
        excludedDirtyFileCount: 501,
        excludedDirtyFilesTruncated: true
      }
      const stateStore = new WorktreeRunStateStore(root, 'repo-a')
      const prepareAsync = vi.fn(async () => ({ context, path: worktreePath }))
      const coordinator = new RunWorktreeCoordinator({
        manager: {
          ...fakeManager({ describe: () => context }),
          describeAsync: vi.fn(async () => context),
          prepareAsync
        },
        stateStore,
        nowFn: () => 10
      })

      await expect(coordinator.beginAsync(runId, 'Builder', true)).resolves.toBe(worktreePath)
      expect(prepareAsync).toHaveBeenCalledWith(runId, undefined)
      const stored = stateStore.get(runId)
      expect(stored).toMatchObject({
        runId,
        worktreePath,
        baseBranch: 'main',
        baseSha: TEST_SHA,
        excludedDirtyFileCount: 501,
        excludedDirtyFilesTruncated: true,
        verdict: 'running'
      })
      expect(stored?.excludedDirtyFiles).toHaveLength(500)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('ne masque pas une erreur de préparation atomique par un manifeste vide', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-async-describe-error-'))
    try {
      const stateStore = new WorktreeRunStateStore(root, 'repo-a')
      const coordinator = new RunWorktreeCoordinator({
        manager: {
          ...fakeManager(),
          prepareAsync: vi.fn(async () => {
            throw new Error('description Git indisponible')
          })
        },
        stateStore,
        nowFn: () => 10
      })

      await expect(coordinator.beginAsync('run-describe-error', 'Builder', true)).rejects.toThrow(
        'description Git indisponible'
      )
      expect(stateStore.get('run-describe-error')).toBeUndefined()
      expect(coordinator.activity()[0]).toMatchObject({
        agentId: 'run-describe-error',
        state: 'blocked'
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('impose le SHA du checkpoint a la copie au lieu de relire la branche courante', () => {
    const acquire = vi.fn((id: string) => `/wt/${id}`)
    const co = new RunWorktreeCoordinator({ manager: fakeManager({ acquire }), nowFn: () => 1 })
    co.begin('run-checkpoint', 'Contrefactuel', true, {
      sourceWorkspacePath: '/repo',
      sourceBaseSha: TEST_SHA
    })

    expect(acquire).toHaveBeenCalledWith(
      'run-checkpoint',
      expect.objectContaining({ workspacePath: '/repo', baseSha: TEST_SHA })
    )
  })

  it('run NON-mutation → pas de copie, cwd undefined (retombe sur la base)', () => {
    const acquire = vi.fn()
    const co = new RunWorktreeCoordinator({ manager: fakeManager({ acquire }), nowFn: () => 1 })
    expect(co.begin('run-2', 'Scout', false)).toBeUndefined()
    expect(acquire).not.toHaveBeenCalled()
  })

  it('end fusionne en full-auto et marque merged', () => {
    const co = new RunWorktreeCoordinator({ manager: fakeManager(), nowFn: () => 5 })
    co.begin('run-1', 'Builder', true)
    const res = co.end('run-1')
    expect(res?.outcome).toBe('merged')
    expect(co.activity()[0]).toMatchObject({ state: 'merged', endedAtMs: 5 })
  })

  it('retient un run vert de tournoi sans appeler finalize et persiste green/held', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-held-'))
    try {
      const finalize = vi.fn()
      const stateStore = new WorktreeRunStateStore(root, 'repo-a')
      const co = new RunWorktreeCoordinator({
        manager: fakeManager({
          finalize,
          changedFiles: () => ['a.ts'],
          acquire: (id) => join(root, `agent__${id}`),
          describe: (id) => ({
            workspacePath: root,
            worktreePath: join(root, `agent__${id}`),
            baseBranch: 'main',
            baseSha: TEST_SHA
          })
        }),
        stateStore,
        nowFn: () => 5
      })
      co.begin('run-held', 'Tournoi', true)
      co.end('run-held', { merge: false, retainGreen: true })

      expect(finalize).not.toHaveBeenCalled()
      expect(co.activity()[0]).toMatchObject({
        state: 'ready',
        verdict: 'green',
        publication: 'held',
        files: [{ path: 'a.ts', kind: 'mod' }]
      })
      expect(stateStore.get('run-held')).toMatchObject({ verdict: 'green', publication: 'held' })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('supprime uniquement un bureau explicitement retenu et le retire de l’activité', async () => {
    const discardAsync = vi.fn().mockResolvedValue(undefined)
    const coordinator = new RunWorktreeCoordinator({
      manager: { ...fakeManager(), discardAsync }
    })
    coordinator.begin('held-run', 'Tournoi', true)
    coordinator.end('held-run', { merge: false, retainGreen: true })

    await expect(coordinator.discardHeldAsync('held-run')).resolves.toBe(true)
    expect(discardAsync).toHaveBeenCalledWith('held-run')
    expect(coordinator.activity()).toEqual([])
    await expect(coordinator.discardHeldAsync('missing')).resolves.toBe(false)
  })

  it('end attend le CLI encore vivant avant de fusionner et supprimer sa copie', () => {
    let active = true
    const finalize = vi.fn((id: string): FinalizeResult => ({
      outcome: 'merged',
      agentId: id,
      committed: true
    }))
    const co = new RunWorktreeCoordinator({
      manager: fakeManager({ finalize, hasActiveProcesses: () => active }),
      nowFn: () => 5
    })
    co.begin('run-1', 'Builder', true)

    expect(co.end('run-1')).toBeUndefined()
    expect(finalize).not.toHaveBeenCalled()
    expect(co.activity()[0]).toMatchObject({ state: 'working', endedAtMs: undefined })

    active = false
    co.retryRecovery()
    expect(finalize).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ baseBranch: 'main', onPrepared: expect.any(Function) })
    )
    expect(co.activity()[0]).toMatchObject({ state: 'merged', endedAtMs: 5 })
  })

  it('conserve le callback causal jusqu a une publication differee', () => {
    let active = true
    const finalize = vi.fn(
      (
        id: string,
        options?: { onPrepared?: (agentSha: string, baseSha: string) => void }
      ): FinalizeResult => {
        options?.onPrepared?.(PUBLISHED_SHA, TEST_SHA)
        return { outcome: 'merged', agentId: id, committed: true }
      }
    )
    const onPublished = vi.fn()
    const co = new RunWorktreeCoordinator({
      manager: fakeManager({ finalize, hasActiveProcesses: () => active }),
      nowFn: () => 5
    })
    co.begin('run-deferred', 'Builder', true)

    expect(co.end('run-deferred', { onPublished })).toBeUndefined()
    active = false
    co.retryRecovery()

    expect(onPublished).toHaveBeenCalledTimes(1)
    expect(onPublished).toHaveBeenCalledWith({ baseSha: TEST_SHA, agentSha: PUBLISHED_SHA })
  })

  it('restaure la publication causale durable quand le callback memoire est mort', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-causal-restart-'))
    try {
      const stateStore = new WorktreeRunStateStore(root, 'repo-a')
      let active = true
      const context = (id: string) => ({
        workspacePath: '/repo',
        worktreePath: join(root, `agent__${id}`),
        baseBranch: 'main',
        baseSha: TEST_SHA
      })
      const first = new RunWorktreeCoordinator({
        manager: fakeManager({
          acquire: (id) => join(root, `agent__${id}`),
          describe: context,
          hasActiveProcesses: () => active
        }),
        stateStore,
        nowFn: () => 10
      })
      first.begin('run-restart', 'Builder', true, {
        conversationId: 'conv-1',
        turnId: 'turn-1',
        causalWatchPaths: ['C:/repo/app.log']
      })
      expect(first.end('run-restart', { onPublished: vi.fn() })).toBeUndefined()

      active = false
      const onRecoveredPublication = vi.fn()
      new RunWorktreeCoordinator({
        manager: fakeManager({
          listAgentIds: () => ['run-restart'],
          describe: context,
          hasActiveProcesses: () => active,
          finalize: (id, options) => {
            options?.onPrepared?.(PUBLISHED_SHA, TEST_SHA)
            return { outcome: 'merged', agentId: id, committed: true }
          }
        }),
        stateStore,
        nowFn: () => 20,
        onRecoveredPublication
      })

      expect(onRecoveredPublication).toHaveBeenCalledWith({
        runId: 'run-restart',
        conversationId: 'conv-1',
        turnId: 'turn-1',
        causalWatchPaths: ['C:/repo/app.log'],
        baseSha: TEST_SHA,
        agentSha: PUBLISHED_SHA
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('restaure la publication causale apres un crash entre fusion Git et callback', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-causal-post-publication-crash-'))
    try {
      const runId = 'run-post-publication-crash'
      const stateStore = new WorktreeRunStateStore(root, 'repo-a')
      stateStore.save({
        version: 1,
        repoId: 'repo-a',
        runId,
        conversationId: 'conv-1',
        turnId: 'turn-1',
        causalWatchPaths: ['C:/repo/app.log'],
        agentName: 'Builder',
        worktreePath: join(root, `agent__${runId}`),
        baseBranch: 'main',
        baseSha: TEST_SHA,
        publicationBaseSha: TEST_SHA,
        verdict: 'green',
        publication: 'integrating',
        files: [{ path: 'app.log', kind: 'mod' }],
        publishedSha: PUBLISHED_SHA,
        createdAtMs: 10,
        updatedAtMs: 11
      })
      const cleanupPublished = vi.fn((id: string): FinalizeResult => ({
        outcome: 'merged',
        agentId: id,
        committed: false
      }))
      const onRecoveredPublication = vi.fn()

      new RunWorktreeCoordinator({
        manager: fakeManager({
          listAgentIds: () => [runId],
          cleanupPublished,
          validateRecoveryContext: () => ({ ok: true, decision: 'cleanup-only' })
        }),
        stateStore,
        nowFn: () => 20,
        onRecoveredPublication
      })

      expect(cleanupPublished).toHaveBeenCalledWith(runId, PUBLISHED_SHA, 'main')
      expect(onRecoveredPublication).toHaveBeenCalledWith({
        runId,
        conversationId: 'conv-1',
        turnId: 'turn-1',
        causalWatchPaths: ['C:/repo/app.log'],
        baseSha: TEST_SHA,
        agentSha: PUBLISHED_SHA
      })
      expect(stateStore.get(runId)).toMatchObject({ publication: 'complete' })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejoue puis acquitte un callback perdu apres le manifeste complete sans worktree', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-causal-complete-crash-'))
    try {
      const runId = 'run-complete-callback-crash'
      const stateStore = new WorktreeRunStateStore(root, 'repo-a')
      stateStore.save({
        version: 1,
        repoId: 'repo-a',
        runId,
        conversationId: 'conv-complete',
        turnId: 'turn-complete',
        causalWatchPaths: ['C:/repo/app.log'],
        agentName: 'Builder',
        worktreePath: join(root, `agent__${runId}`),
        baseBranch: 'main',
        baseSha: '2'.repeat(40),
        publicationBaseSha: TEST_SHA,
        verdict: 'green',
        publication: 'complete',
        files: [{ path: 'app.log', kind: 'mod' }],
        publishedSha: PUBLISHED_SHA,
        createdAtMs: 10,
        updatedAtMs: 11
      })
      const onRecoveredPublication = vi.fn()

      new RunWorktreeCoordinator({
        manager: fakeManager({ listAgentIds: () => [] }),
        stateStore,
        nowFn: () => 20,
        onRecoveredPublication
      })

      expect(onRecoveredPublication).toHaveBeenCalledTimes(1)
      expect(onRecoveredPublication).toHaveBeenCalledWith({
        runId,
        conversationId: 'conv-complete',
        turnId: 'turn-complete',
        causalWatchPaths: ['C:/repo/app.log'],
        baseSha: TEST_SHA,
        agentSha: PUBLISHED_SHA
      })
      expect(stateStore.get(runId)).toMatchObject({ causalPublicationDeliveredAtMs: 20 })

      const replayAfterAck = vi.fn()
      new RunWorktreeCoordinator({
        manager: fakeManager({ listAgentIds: () => [] }),
        stateStore,
        nowFn: () => 30,
        onRecoveredPublication: replayAfterAck
      })
      expect(replayAfterAck).not.toHaveBeenCalled()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reprend une auto-publication sans trace causale et ne l acquitte qu apres le push async', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-autoclose-recovery-'))
    try {
      const runId = 'run-autoclose-recovery'
      const stateStore = new WorktreeRunStateStore(root, 'repo-a')
      stateStore.save({
        version: 1,
        repoId: 'repo-a',
        runId,
        task: 'Corriger la publication',
        agentName: 'Builder',
        worktreePath: join(root, `agent__${runId}`),
        baseBranch: 'main',
        baseSha: '2'.repeat(40),
        publicationBaseSha: TEST_SHA,
        verdict: 'green',
        publication: 'complete',
        files: [],
        publishedSha: PUBLISHED_SHA,
        createdAtMs: 10,
        updatedAtMs: 11
      })
      let finishPush!: () => void
      const pendingPush = new Promise<void>((resolve) => {
        finishPush = resolve
      })
      const onRecoveredPublication = vi.fn(() => pendingPush)
      const onActivity = vi.fn()

      new RunWorktreeCoordinator({
        manager: fakeManager({ listAgentIds: () => [] }),
        stateStore,
        nowFn: () => 20,
        onRecoveredPublication,
        onActivity
      })

      expect(onRecoveredPublication).toHaveBeenCalledWith({
        runId,
        task: 'Corriger la publication',
        causalWatchPaths: [],
        baseSha: TEST_SHA,
        agentSha: PUBLISHED_SHA
      })
      expect(stateStore.get(runId)?.causalPublicationDeliveredAtMs).toBeUndefined()
      const eventsBeforePush = onActivity.mock.calls.length

      finishPush()
      await vi.waitFor(() => expect(stateStore.get(runId)?.causalPublicationDeliveredAtMs).toBe(20))
      expect(onActivity.mock.calls.length).toBeGreaterThan(eventsBeforePush)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejoue au redemarrage une publication distante rejetee', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-autoclose-rejected-'))
    try {
      const runId = 'run-autoclose-rejected'
      const stateStore = new WorktreeRunStateStore(root, 'repo-a')
      stateStore.save({
        version: 1,
        repoId: 'repo-a',
        runId,
        task: 'Publier apres panne',
        agentName: 'Builder',
        worktreePath: join(root, `agent__${runId}`),
        baseBranch: 'main',
        baseSha: '2'.repeat(40),
        publicationBaseSha: TEST_SHA,
        verdict: 'green',
        publication: 'complete',
        files: [],
        publishedSha: PUBLISHED_SHA,
        createdAtMs: 10,
        updatedAtMs: 11
      })
      const failedPush = vi.fn().mockRejectedValue(new Error('reseau indisponible'))

      new RunWorktreeCoordinator({
        manager: fakeManager({ listAgentIds: () => [] }),
        stateStore,
        nowFn: () => 20,
        onRecoveredPublication: failedPush
      })

      await vi.waitFor(() => expect(failedPush).toHaveBeenCalledTimes(1))
      expect(stateStore.get(runId)?.causalPublicationDeliveredAtMs).toBeUndefined()

      const recoveredPush = vi.fn().mockResolvedValue(undefined)
      new RunWorktreeCoordinator({
        manager: fakeManager({ listAgentIds: () => [] }),
        stateStore,
        nowFn: () => 30,
        onRecoveredPublication: recoveredPush
      })

      await vi.waitFor(() => expect(stateStore.get(runId)?.causalPublicationDeliveredAtMs).toBe(30))
      expect(recoveredPush).toHaveBeenCalledTimes(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('n invente pas la base causale d un ancien manifeste qui ne l a jamais persistee', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-causal-legacy-publication-'))
    try {
      const runId = 'run-legacy-publication'
      const stateStore = new WorktreeRunStateStore(root, 'repo-a')
      stateStore.save({
        version: 1,
        repoId: 'repo-a',
        runId,
        conversationId: 'conv-legacy',
        turnId: 'turn-legacy',
        causalWatchPaths: ['C:/repo/app.log'],
        agentName: 'Builder',
        worktreePath: join(root, `agent__${runId}`),
        baseBranch: 'main',
        baseSha: TEST_SHA,
        verdict: 'green',
        publication: 'integrating',
        files: [{ path: 'app.log', kind: 'mod' }],
        publishedSha: PUBLISHED_SHA,
        createdAtMs: 10,
        updatedAtMs: 11
      })
      const onRecoveredPublication = vi.fn()

      new RunWorktreeCoordinator({
        manager: fakeManager({
          listAgentIds: () => [runId],
          validateRecoveryContext: () => ({ ok: true, decision: 'cleanup-only' })
        }),
        stateStore,
        nowFn: () => 20,
        onRecoveredPublication
      })

      expect(onRecoveredPublication).not.toHaveBeenCalled()
      expect(stateStore.get(runId)).toMatchObject({ publication: 'complete' })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('end en CONFLIT → state conflict + fichier remonté (pas d’écrasement)', () => {
    const finalize = (id: string): FinalizeResult => ({
      outcome: 'conflict',
      agentId: id,
      files: ['os.ts'],
      baseSha: 'base111',
      agentSha: 'agent222'
    })
    const readConflictDiff = vi.fn(() => ({
      available: true as const,
      agentId: 'run-1',
      paths: ['os.ts'],
      diff: '-base\n+agent'
    }))
    const co = new RunWorktreeCoordinator({
      manager: fakeManager({ finalize, readConflictDiff }),
      nowFn: () => 9
    })
    co.begin('run-1', 'Judge', true)
    const res = co.end('run-1')
    expect(res?.outcome).toBe('conflict')
    const a = co.activity()[0]
    expect(a.state).toBe('conflict')
    expect(a.conflictFile).toBe('os.ts')
    expect(co.conflictDiff('run-1')).toMatchObject({ available: true, paths: ['os.ts'] })
    expect(readConflictDiff).toHaveBeenCalledWith('run-1', {
      files: ['os.ts'],
      baseSha: 'base111',
      agentSha: 'agent222'
    })
  })

  it('end BLOQUÉ par la base sale → état d’attention distinct, jamais merged', () => {
    const finalize = (id: string): FinalizeResult => ({
      outcome: 'blocked',
      agentId: id,
      files: ['os.ts'],
      reason: 'base-dirty'
    })
    const co = new RunWorktreeCoordinator({ manager: fakeManager({ finalize }), nowFn: () => 9 })
    co.begin('run-1', 'Builder', true)

    expect(co.end('run-1')?.outcome).toBe('blocked')
    expect(co.activity()[0]).toMatchObject({
      state: 'blocked',
      files: [{ path: 'os.ts', kind: 'mod' }],
      attentionReason: 'base-dirty'
    })
  })

  it('préserve le motif d’une opération déjà en cours jusqu’à l’activité renderer', () => {
    const finalize = (id: string): FinalizeResult => ({
      outcome: 'blocked',
      agentId: id,
      files: ['a.txt'],
      reason: 'base-in-progress'
    })
    const co = new RunWorktreeCoordinator({ manager: fakeManager({ finalize }), nowFn: () => 9 })
    co.begin('run-1', 'Builder', true)

    expect(co.end('run-1')?.outcome).toBe('blocked')
    expect(co.activity()[0]).toMatchObject({
      state: 'blocked',
      files: [{ path: 'os.ts', kind: 'mod' }],
      attentionReason: 'base-in-progress'
    })
  })

  it('échec de compensation durable → conserve la provenance des fichiers agent', () => {
    const finalize = (id: string): FinalizeResult => ({
      outcome: 'blocked',
      agentId: id,
      files: ['a.txt', 'b.txt'],
      reason: 'merge-failed',
      preserveAgentFiles: true
    })
    const co = new RunWorktreeCoordinator({
      manager: fakeManager({ finalize, changedFiles: () => ['b.txt'] }),
      nowFn: () => 9
    })
    co.begin('run-compensation', 'Builder', true)

    expect(co.end('run-compensation')).toMatchObject({ outcome: 'blocked' })
    expect(co.activity()[0]).toMatchObject({
      files: [{ path: 'b.txt', kind: 'mod' }],
      attentionReason: 'merge-failed'
    })
  })

  it('réessaie automatiquement un blocage transitoire puis converge vers merged', () => {
    const finalize = vi
      .fn<(id: string) => FinalizeResult>()
      .mockReturnValueOnce({
        outcome: 'blocked',
        agentId: 'run-1',
        files: ['a.txt'],
        reason: 'base-in-progress'
      })
      .mockReturnValueOnce({
        outcome: 'merged',
        agentId: 'run-1',
        committed: true
      })
    const co = new RunWorktreeCoordinator({ manager: fakeManager({ finalize }), nowFn: () => 9 })
    co.begin('run-1', 'Builder', true)

    expect(co.end('run-1')?.outcome).toBe('blocked')
    co.retryRecovery()

    expect(finalize).toHaveBeenCalledTimes(2)
    expect(co.activity()[0]).toMatchObject({ state: 'merged' })
  })

  it('réarme manuellement une publication épuisée après libération de la base', () => {
    const blocked = {
      outcome: 'blocked' as const,
      agentId: 'run-busy',
      files: ['a.txt'],
      reason: 'base-in-progress' as const
    }
    const finalize = vi
      .fn<(id: string) => FinalizeResult>()
      .mockReturnValueOnce(blocked)
      .mockReturnValueOnce(blocked)
      .mockReturnValueOnce(blocked)
      .mockReturnValueOnce(blocked)
      .mockReturnValueOnce(blocked)
      .mockReturnValueOnce(blocked)
      .mockReturnValueOnce({
        outcome: 'merged',
        agentId: 'run-busy',
        committed: true
      })
    const co = new RunWorktreeCoordinator({ manager: fakeManager({ finalize }), nowFn: () => 9 })
    co.begin('run-busy', 'Builder', true)
    co.end('run-busy')
    for (let index = 0; index < 8; index += 1) co.retryRecovery()

    expect(finalize).toHaveBeenCalledTimes(6)
    expect(co.activity()[0]).toMatchObject({
      state: 'blocked',
      publication: 'pending',
      attentionReason: 'retry-exhausted',
      retryCount: 6
    })

    expect(co.retryRun('run-busy')).toMatchObject({
      state: 'merged',
      publication: 'complete'
    })
    expect(finalize).toHaveBeenCalledTimes(7)
  })

  it("réessaie manuellement une publication verte bloquée après correction de l'environnement", () => {
    const finalize = vi
      .fn<(id: string) => FinalizeResult>()
      .mockReturnValueOnce({
        outcome: 'blocked',
        agentId: 'run-environment-fixed',
        files: ['tsconfig.web.tsbuildinfo'],
        reason: 'merge-failed',
        detail: 'La copie contient des fichiers ignorés non régénérables.'
      })
      .mockReturnValueOnce({
        outcome: 'merged',
        agentId: 'run-environment-fixed',
        committed: true
      })
    const co = new RunWorktreeCoordinator({ manager: fakeManager({ finalize }), nowFn: () => 9 })
    co.begin('run-environment-fixed', 'Builder', true)

    expect(co.end('run-environment-fixed')).toMatchObject({ outcome: 'blocked' })
    expect(co.activity()[0]).toMatchObject({
      state: 'blocked',
      publication: 'blocked',
      attentionReason: 'merge-failed'
    })

    expect(co.retryRun('run-environment-fixed')).toMatchObject({
      state: 'merged',
      publication: 'complete'
    })
    expect(finalize).toHaveBeenCalledTimes(2)
  })

  it('reprend seulement le rangement après une publication déjà réussie', () => {
    const finalize = vi.fn<(id: string) => FinalizeResult>().mockReturnValue({
      outcome: 'cleanup-pending',
      agentId: 'run-1',
      files: ['a.txt'],
      publishedSha: 'abc123'
    })
    const cleanupPublished = vi
      .fn<(id: string, sha: string, baseBranch?: string) => FinalizeResult>()
      .mockReturnValue({
        outcome: 'merged',
        agentId: 'run-1',
        committed: false
      })
    const co = new RunWorktreeCoordinator({
      manager: fakeManager({ finalize, cleanupPublished }),
      nowFn: () => 9
    })
    co.begin('run-1', 'Builder', true)

    expect(co.end('run-1')?.outcome).toBe('cleanup-pending')
    expect(co.activity()[0]).toMatchObject({
      state: 'ready',
      publication: 'cleanup-pending'
    })
    co.retryRecovery()

    expect(finalize).toHaveBeenCalledTimes(1)
    expect(cleanupPublished).toHaveBeenCalledWith('run-1', 'abc123', 'main')
    expect(co.activity()[0]).toMatchObject({ state: 'merged', publication: 'complete' })
  })

  it('expose séparément une publication réussie avec du travail tardif conservé', () => {
    const finalize = vi.fn<(id: string) => FinalizeResult>().mockReturnValue({
      outcome: 'published-residue',
      agentId: 'run-1',
      files: ['late.tmp'],
      publishedSha: PUBLISHED_SHA,
      detail: 'travail plus récent conservé'
    })
    const co = new RunWorktreeCoordinator({
      manager: fakeManager({ finalize }),
      nowFn: () => 9
    })
    co.begin('run-1', 'Builder', true)

    expect(co.end('run-1')?.outcome).toBe('published-residue')
    expect(co.activity()[0]).toMatchObject({
      state: 'ready',
      publication: 'published',
      publishedSha: PUBLISHED_SHA,
      attentionReason: 'post-publish-change',
      files: [{ path: 'late.tmp', kind: 'mod' }]
    })
  })

  it('après redémarrage ne republie jamais un retour dont seul le rangement restait', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-cleanup-restart-'))
    try {
      const stateStore = new WorktreeRunStateStore(root, 'repo-a')
      const first = new RunWorktreeCoordinator({
        manager: fakeManager({
          acquire: (id) => join(root, `agent__${id}`),
          describe: (id) => ({
            workspacePath: '/repo',
            worktreePath: join(root, `agent__${id}`),
            baseBranch: 'main',
            baseSha: TEST_SHA
          }),
          finalize: (id) => ({
            outcome: 'cleanup-pending',
            agentId: id,
            files: ['a.txt'],
            publishedSha: PUBLISHED_SHA
          })
        }),
        stateStore,
        nowFn: () => 10
      })
      first.begin('run-cleanup', 'Builder', true)
      first.end('run-cleanup')

      const finalize = vi.fn<(id: string) => FinalizeResult>()
      const cleanupPublished = vi.fn<
        (id: string, sha: string, baseBranch?: string) => FinalizeResult
      >(() => ({
        outcome: 'merged',
        agentId: 'run-cleanup',
        committed: false
      }))
      const restarted = new RunWorktreeCoordinator({
        manager: fakeManager({
          listAgentIds: () => ['run-cleanup'],
          finalize,
          cleanupPublished,
          describe: (id) => ({
            workspacePath: '/repo',
            worktreePath: join(root, `agent__${id}`),
            baseBranch: 'main',
            baseSha: TEST_SHA
          })
        }),
        stateStore,
        nowFn: () => 20
      })

      expect(finalize).not.toHaveBeenCalled()
      expect(cleanupPublished).toHaveBeenCalledWith('run-cleanup', PUBLISHED_SHA, 'main')
      expect(restarted.activity()[0]).toMatchObject({
        state: 'merged',
        publication: 'complete',
        recovered: true
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('recontrôle une ref réapparue derrière un manifeste complete', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-complete-ref-restart-'))
    try {
      const stateStore = new WorktreeRunStateStore(root, 'repo-a')
      stateStore.save({
        version: 1,
        repoId: 'repo-a',
        runId: 'run-complete',
        agentName: 'Builder',
        worktreePath: join(root, 'agent__run-complete'),
        baseBranch: 'main',
        baseSha: TEST_SHA,
        verdict: 'green',
        publication: 'complete',
        files: [],
        publishedSha: PUBLISHED_SHA,
        createdAtMs: 1,
        updatedAtMs: 2
      })
      const cleanupPublished = vi.fn<
        (id: string, sha: string, baseBranch?: string) => FinalizeResult
      >(() => ({
        outcome: 'published-residue',
        agentId: 'run-complete',
        files: ['late.txt'],
        publishedSha: PUBLISHED_SHA
      }))

      const restarted = new RunWorktreeCoordinator({
        manager: fakeManager({
          listAgentIds: () => ['run-complete'],
          cleanupPublished
        }),
        stateStore,
        nowFn: () => 3
      })

      expect(cleanupPublished).toHaveBeenCalledWith('run-complete', PUBLISHED_SHA, 'main')
      expect(restarted.activity()[0]).toMatchObject({
        state: 'ready',
        publication: 'published',
        attentionReason: 'post-publish-change',
        files: [{ path: 'late.txt', kind: 'mod' }]
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('borne durablement les retries de rangement à six tentatives', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-cleanup-budget-'))
    try {
      const stateStore = new WorktreeRunStateStore(root, 'repo-a')
      const finalize = vi.fn<(id: string) => FinalizeResult>(() => ({
        outcome: 'cleanup-pending',
        agentId: 'run-budget',
        files: ['a.txt'],
        publishedSha: PUBLISHED_SHA,
        worktreeAvailable: false
      }))
      const cleanupPublished = vi.fn<
        (id: string, sha: string, baseBranch?: string) => FinalizeResult
      >(() => ({
        outcome: 'cleanup-pending',
        agentId: 'run-budget',
        files: ['a.txt'],
        publishedSha: PUBLISHED_SHA,
        worktreeAvailable: false
      }))
      const manager = fakeManager({
        acquire: (id) => join(root, `agent__${id}`),
        describe: (id) => ({
          workspacePath: '/repo',
          worktreePath: join(root, `agent__${id}`),
          baseBranch: 'main',
          baseSha: TEST_SHA
        }),
        finalize,
        cleanupPublished
      })
      const first = new RunWorktreeCoordinator({ manager, stateStore, nowFn: () => 10 })
      first.begin('run-budget', 'Builder', true)
      first.end('run-budget')
      for (let index = 0; index < 10; index += 1) first.retryRecovery()

      expect(finalize).toHaveBeenCalledTimes(1)
      expect(cleanupPublished).toHaveBeenCalledTimes(5)
      expect(first.activity()[0]).toMatchObject({
        publication: 'cleanup-pending',
        retryCount: 6,
        attentionReason: 'retry-exhausted',
        worktreeAvailable: false
      })

      const cleanupAfterRestart = vi.fn<
        (id: string, sha: string, baseBranch?: string) => FinalizeResult
      >(() => ({
        outcome: 'published-residue',
        agentId: 'run-budget',
        files: ['late.txt'],
        publishedSha: PUBLISHED_SHA
      }))
      const restarted = new RunWorktreeCoordinator({
        manager: fakeManager({
          listAgentIds: () => ['run-budget'],
          cleanupPublished: cleanupAfterRestart
        }),
        stateStore,
        nowFn: () => 20
      })

      expect(cleanupAfterRestart).not.toHaveBeenCalled()
      expect(restarted.activity()[0]).toMatchObject({
        state: 'ready',
        publication: 'cleanup-pending',
        retryCount: 6,
        attentionReason: 'retry-exhausted',
        worktreeAvailable: false
      })

      expect(restarted.retryRun('run-budget')).toMatchObject({
        state: 'ready',
        publication: 'published',
        attentionReason: 'post-publish-change',
        worktreeAvailable: true,
        retryCount: undefined
      })
      expect(cleanupAfterRestart).toHaveBeenCalledTimes(1)
      expect(cleanupAfterRestart).toHaveBeenCalledWith('run-budget', PUBLISHED_SHA, 'main')
      expect(stateStore.get('run-budget')).toMatchObject({
        publication: 'published',
        attentionReason: 'post-publish-change',
        retryCount: 0,
        worktreeAvailable: true
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('notifie onActivity à chaque changement (pour l’IPC → renderer)', () => {
    const onActivity = vi.fn()
    const co = new RunWorktreeCoordinator({ manager: fakeManager(), nowFn: () => 1, onActivity })
    co.begin('run-1', 'Builder', true)
    co.end('run-1')
    expect(onActivity).toHaveBeenCalled()
    // dernier appel = état final merged
    const last = onActivity.mock.calls.at(-1)![0]
    expect(last[0].state).toBe('merged')
  })

  it('end sur run inconnu → undefined, ne jette pas', () => {
    const co = new RunWorktreeCoordinator({ manager: fakeManager() })
    expect(co.end('nope')).toBeUndefined()
  })

  it('conserve au démarrage les copies orphelines sans verdict durable et ne les fusionne jamais', () => {
    const finalize = vi.fn<(id: string) => FinalizeResult>()
    const co = new RunWorktreeCoordinator({
      manager: fakeManager({
        listAgentIds: () => ['run-old', 'run-conflict'],
        finalize,
        changedFiles: (id) => (id === 'run-conflict' ? ['src/main/os.ts'] : [])
      }),
      nowFn: () => 42
    })

    expect(finalize).not.toHaveBeenCalled()
    expect(co.activity()).toEqual([
      expect.objectContaining({
        agentId: 'run-old',
        state: 'blocked',
        attentionReason: 'merge-failed',
        endedAtMs: 42
      }),
      expect.objectContaining({
        agentId: 'run-conflict',
        state: 'blocked',
        attentionReason: 'merge-failed',
        files: [{ path: 'src/main/os.ts', kind: 'mod' }],
        endedAtMs: 42
      })
    ])
  })

  it('bloque et rend actionnable une copie sans manifeste dès le démarrage', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-orphan-no-manifest-'))
    try {
      const stateStore = new WorktreeRunStateStore(root, 'repo-a')
      const worktreePath = join(root, 'agent__run-orphan')
      const finalize = vi.fn<(id: string) => FinalizeResult>()
      const recovered = new RunWorktreeCoordinator({
        manager: fakeManager({
          listAgentIds: () => ['run-orphan'],
          changedFiles: () => ['orphan.txt'],
          describe: () => ({
            workspacePath: '/repo',
            worktreePath,
            baseBranch: 'main',
            baseSha: TEST_SHA
          }),
          finalize
        }),
        stateStore,
        nowFn: () => 30
      })

      expect(finalize).not.toHaveBeenCalled()
      expect(recovered.activity()[0]).toMatchObject({
        state: 'blocked',
        worktreePath,
        verdict: 'unknown',
        publication: 'blocked',
        attentionReason: 'merge-failed',
        endedAtMs: 30
      })
      expect(stateStore.get('run-orphan')).toMatchObject({
        verdict: 'unknown',
        publication: 'blocked'
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('sort de working une copie sans manifeste quand son processus disparaît', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-orphan-process-exit-'))
    try {
      const stateStore = new WorktreeRunStateStore(root, 'repo-a')
      const worktreePath = join(root, 'agent__run-orphan-live')
      let active = true
      const finalize = vi.fn<(id: string) => FinalizeResult>()
      const recovered = new RunWorktreeCoordinator({
        manager: fakeManager({
          listAgentIds: () => ['run-orphan-live'],
          hasActiveProcesses: () => active,
          describe: () => ({
            workspacePath: '/repo',
            worktreePath,
            baseBranch: 'main',
            baseSha: TEST_SHA
          }),
          finalize
        }),
        stateStore,
        nowFn: () => 30
      })

      expect(recovered.activity()[0]).toMatchObject({ state: 'working', worktreePath })
      active = false
      recovered.retryRecovery()

      expect(finalize).not.toHaveBeenCalled()
      expect(recovered.activity()[0]).toMatchObject({
        state: 'blocked',
        worktreePath,
        verdict: 'unknown',
        publication: 'blocked',
        attentionReason: 'merge-failed',
        endedAtMs: 30
      })
      expect(stateStore.get('run-orphan-live')).toMatchObject({
        verdict: 'unknown',
        publication: 'blocked'
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('persiste un verdict rouge et le conserve après deux redémarrages', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-coordinator-restart-'))
    try {
      const stateStore = new WorktreeRunStateStore(root, 'repo-a')
      const finalize = vi.fn((id: string): FinalizeResult => ({
        outcome: 'merged',
        agentId: id,
        committed: true
      }))
      const manager = fakeManager({
        finalize,
        listAgentIds: () => ['run-red'],
        acquire: (id) => join(root, `agent__${id}`),
        describe: (id) => ({
          workspacePath: '/repo',
          worktreePath: join(root, `agent__${id}`),
          baseBranch: 'main',
          baseSha: TEST_SHA
        })
      })
      const first = new RunWorktreeCoordinator({ manager, stateStore, nowFn: () => 10 })
      first.begin('run-red', 'Builder', true, { task: 'corrige', role: 'build' })
      first.end('run-red', { merge: false })

      const second = new RunWorktreeCoordinator({ manager, stateStore, nowFn: () => 20 })
      const third = new RunWorktreeCoordinator({ manager, stateStore, nowFn: () => 30 })

      expect(finalize).not.toHaveBeenCalled()
      expect(stateStore.get('run-red')).toMatchObject({
        verdict: 'red',
        publication: 'not-requested'
      })
      expect(second.activity()[0]).toMatchObject({ agentId: 'run-red', state: 'ready' })
      expect(third.activity()[0]).toMatchObject({ agentId: 'run-red', state: 'ready' })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
  it.each([
    ['red', 'not-requested', 'ready'],
    ['cancelled', 'not-requested', 'ready'],
    ['unknown', 'blocked', 'blocked'],
    // Un run coupé par un arrêt de l'application converge vers `interrupted`, pas `blocked` :
    // il n'a été refusé par rien. Le reste de l'assertion (sortie de `working`, aucune
    // finalisation, verdict persisté) est inchangé — seul le libellé cessait d'être vrai.
    ['interrupted', 'blocked', 'interrupted'],
    ['running', 'not-requested', 'interrupted']
  ] as const)(
    'fait converger un run %s récupéré dès que son processus disparaît',
    (verdict, publication, expectedState) => {
      const root = mkdtempSync(join(tmpdir(), `autowin-${verdict}-process-exit-`))
      try {
        const stateStore = new WorktreeRunStateStore(root, 'repo-a')
        stateStore.save({
          version: 1,
          repoId: 'repo-a',
          runId: `run-${verdict}`,
          agentName: 'Builder',
          worktreePath: join(root, `agent__run-${verdict}`),
          baseBranch: 'main',
          baseSha: TEST_SHA,
          verdict,
          publication,
          files: [{ path: 'a.txt', kind: 'mod' }],
          createdAtMs: 10,
          updatedAtMs: 20
        })
        let active = true
        const finalize = vi.fn<(id: string) => FinalizeResult>()
        const recovered = new RunWorktreeCoordinator({
          manager: fakeManager({
            listAgentIds: () => [`run-${verdict}`],
            hasActiveProcesses: () => active,
            finalize
          }),
          stateStore,
          nowFn: () => 30
        })

        expect(recovered.activity()[0]).toMatchObject({ state: 'working', recovered: true })
        active = false
        recovered.retryRecovery()

        expect(finalize).not.toHaveBeenCalled()
        expect(recovered.activity()[0]).toMatchObject({
          state: expectedState,
          endedAtMs: 30,
          recovered: true
        })
        if (verdict === 'running') {
          expect(stateStore.get(`run-${verdict}`)).toMatchObject({
            verdict: 'interrupted',
            publication: 'blocked'
          })
        }
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  )

  it('ne finalise jamais un manifeste vert forge au redemarrage', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-forged-restart-'))
    try {
      const stateStore = new WorktreeRunStateStore(root, 'repo-a')
      mkdirSync(join(root, '.runs'), { recursive: true })
      writeFileSync(
        stateStore.pathFor('forged-green'),
        JSON.stringify({
          version: 1,
          repoId: 'repo-a',
          runId: 'forged-green',
          agentName: 'Intrus',
          worktreePath: '',
          baseBranch: '',
          baseSha: '',
          verdict: 'green',
          publication: 'pending',
          files: [],
          createdAtMs: 10,
          updatedAtMs: 20
        })
      )
      const finalize = vi.fn<(id: string) => FinalizeResult>()

      const restarted = new RunWorktreeCoordinator({
        manager: fakeManager({
          listAgentIds: () => ['forged-green'],
          finalize
        }),
        stateStore,
        nowFn: () => 30
      })

      expect(finalize).not.toHaveBeenCalled()
      expect(restarted.activity()[0]).toMatchObject({
        agentId: 'forged-green',
        state: 'blocked',
        verdict: 'unknown',
        publication: 'blocked'
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('bloque une reprise structurellement valide que Git ne peut pas prouver', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-unproven-restart-'))
    try {
      const stateStore = new WorktreeRunStateStore(root, 'repo-a')
      mkdirSync(join(root, '.runs'), { recursive: true })
      writeFileSync(
        stateStore.pathFor('unproven-green'),
        JSON.stringify({
          version: 1,
          repoId: 'repo-a',
          runId: 'unproven-green',
          agentName: 'Intrus',
          worktreePath: join(root, 'agent__unproven-green'),
          baseBranch: 'main',
          baseSha: TEST_SHA,
          verdict: 'green',
          publication: 'pending',
          files: [],
          createdAtMs: 10,
          updatedAtMs: 20
        })
      )
      const finalize = vi.fn<(id: string) => FinalizeResult>()
      const validateRecoveryContext = vi.fn(() => ({
        ok: false as const,
        detail: 'contexte Git non prouve'
      }))

      const restarted = new RunWorktreeCoordinator({
        manager: fakeManager({
          listAgentIds: () => ['unproven-green'],
          finalize,
          validateRecoveryContext
        }),
        stateStore,
        nowFn: () => 30
      })

      expect(validateRecoveryContext).toHaveBeenCalledOnce()
      expect(finalize).not.toHaveBeenCalled()
      expect(restarted.activity()[0]).toMatchObject({
        agentId: 'unproven-green',
        state: 'blocked',
        verdict: 'green',
        publication: 'blocked',
        detail: 'contexte Git non prouve'
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  /**
   * WORKTREE ORPHELIN D'UN RUN INTERROMPU. Le redemarrage marque deja `interrupted` un run dont le
   * processus a disparu (`verdict: 'running'` -> `interrupted`), mais RIEN ne permettait de savoir
   * quelles copies isolees restaient sur le disque a cause de ca : elles restaient noyees dans
   * l'activite generale. On les LISTE — jamais on ne les supprime : le travail d'un agent tue par la
   * fermeture de l'app est recuperable, et une suppression est irreversible.
   */
  it('liste les copies isolees des runs interrompus, sans jamais les supprimer', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-interrupted-worktrees-'))
    try {
      const stateStore = new WorktreeRunStateStore(root, 'repo-a')
      for (const [runId, verdict] of [
        ['run-zombie', 'running'],
        ['run-fini', 'green']
      ] as const) {
        stateStore.save({
          version: 1,
          repoId: 'repo-a',
          runId,
          agentName: 'Builder',
          task: 'une tache interrompue',
          conversationId: 'conv-1056',
          worktreePath: join(root, `agent__${runId}`),
          baseBranch: 'main',
          baseSha: TEST_SHA,
          verdict,
          publication: verdict === 'green' ? 'complete' : 'not-requested',
          files: [{ path: 'a.txt', kind: 'mod' }],
          createdAtMs: 10,
          updatedAtMs: 20
        })
      }
      const remove = vi.fn()
      const coordinator = new RunWorktreeCoordinator({
        manager: fakeManager({
          listAgentIds: () => ['run-zombie', 'run-fini'],
          hasActiveProcesses: () => false,
          remove
        }),
        stateStore,
        nowFn: () => 30
      })

      const orphelins = coordinator.interruptedWorktrees()

      expect(orphelins).toEqual([
        {
          runId: 'run-zombie',
          worktreePath: join(root, 'agent__run-zombie'),
          task: 'une tache interrompue',
          conversationId: 'conv-1056'
        }
      ])
      // Contrainte dure : lister n'est pas nettoyer. Une suppression ici serait irreversible.
      expect(remove).not.toHaveBeenCalled()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  /** P0-4 : la résolution humaine d'un conflit repasse par la transaction protégée. */
  describe('resolveConflictAsync (décision humaine sur un conflit)', () => {
    function conflictedCoordinator(
      finalizeAsync: (id: string, options?: unknown) => Promise<FinalizeResult>
    ) {
      const manager = {
        ...fakeManager({
          finalize: (id: string): FinalizeResult => ({
            outcome: 'conflict',
            agentId: id,
            files: ['os.ts'],
            baseSha: 'base111',
            agentSha: 'agent222'
          })
        }),
        finalizeAsync,
        changedFilesAsync: async () => ['os.ts']
      }
      const co = new RunWorktreeCoordinator({ manager, nowFn: () => 9 })
      co.begin('run-1', 'Judge', true)
      co.end('run-1')
      return co
    }

    it('« garder la version de l’agent » rejoue l’intégration avec la stratégie theirs', async () => {
      const finalizeAsync = vi.fn(
        async (id: string) =>
          ({
            outcome: 'merged',
            agentId: id,
            committed: true,
            publishedSha: PUBLISHED_SHA
          }) as FinalizeResult
      )
      const co = conflictedCoordinator(finalizeAsync)

      const result = await co.resolveConflictAsync('run-1', 'agent')

      expect(result).toEqual({ resolved: true, agentId: 'run-1', outcome: 'merged' })
      expect(finalizeAsync).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ conflictStrategy: 'theirs' })
      )
      expect(co.activity()[0].state).toBe('merged')
    })

    it('« garder ma version » utilise la stratégie ours sans toucher au workspace autrement', async () => {
      const finalizeAsync = vi.fn(
        async (id: string) =>
          ({ outcome: 'merged', agentId: id, committed: true }) as FinalizeResult
      )
      const co = conflictedCoordinator(finalizeAsync)

      await co.resolveConflictAsync('run-1', 'mine')

      expect(finalizeAsync).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ conflictStrategy: 'ours' })
      )
    })

    it('un refus de la base ne prétend jamais avoir résolu', async () => {
      const finalizeAsync = vi.fn(
        async (id: string) =>
          ({
            outcome: 'blocked',
            agentId: id,
            files: ['os.ts'],
            reason: 'base-dirty'
          }) as FinalizeResult
      )
      const co = conflictedCoordinator(finalizeAsync)

      const result = await co.resolveConflictAsync('run-1', 'agent')

      expect(result).toMatchObject({ resolved: false, reason: 'blocked' })
      expect(co.activity()[0]).toMatchObject({ state: 'blocked', attentionReason: 'base-dirty' })
    })

    it('refuse un bureau qui n’est pas en conflit', async () => {
      const co = new RunWorktreeCoordinator({ manager: fakeManager(), nowFn: () => 9 })
      co.begin('run-2', 'Builder', true)

      expect(await co.resolveConflictAsync('run-2', 'agent')).toEqual({
        resolved: false,
        reason: 'not-conflict'
      })
      expect(await co.resolveConflictAsync('inconnu', 'agent')).toEqual({
        resolved: false,
        reason: 'invalid-agent'
      })
    })
  })
})

/**
 * Defaut vecu : les deux chemins symetriques de finalisation recuperee attrapaient l'exception de
 * publication avec un `catch {}` NU. Ils persistaient bien « bloque · merge-failed », mais la CAUSE
 * reelle etait jetee — l'utilisateur lisait un echec sans savoir quoi reparer. La classification
 * n'est pas en cause : c'est le message qui manquait, en plus d'elle.
 */
describe('RunWorktreeCoordinator — cause conservee quand la reprise de publication jette', () => {
  const SENTINELLE = 'sentinelle-cause-publication-9f3c2a7e'

  function manifesteVertEnAttente(root: string, runId: string): WorktreeRunStateStore {
    const stateStore = new WorktreeRunStateStore(root, 'repo-a')
    stateStore.save({
      version: 1,
      repoId: 'repo-a',
      runId,
      agentName: 'Builder',
      worktreePath: join(root, `agent__${runId}`),
      baseBranch: 'main',
      baseSha: TEST_SHA,
      verdict: 'green',
      publication: 'pending',
      files: [{ path: 'a.txt', kind: 'mod' as const }],
      createdAtMs: 10,
      updatedAtMs: 20
    })
    return stateStore
  }

  /**
   * ORACLE COMMUN aux variantes synchrone et asynchrone : deux tests qui divergeraient laisseraient
   * la production asynchrone muette sans que le signal rougisse.
   */
  function laCauseEstConservee(
    coordinator: RunWorktreeCoordinator,
    stateStore: WorktreeRunStateStore,
    runId: string,
    cause: string
  ): void {
    // 1. L'activite (ce que lit l'IPC -> renderer, et l'orchestrateur via `finalActivity`).
    expect(coordinator.activity()[0]).toMatchObject({
      agentId: runId,
      state: 'blocked',
      attentionReason: 'merge-failed',
      detail: cause
    })
    // 2. Le manifeste durable : c'est lui qui attrape une perte APRES redemarrage, qu'une
    //    assertion sur `activity()` seule manquerait completement.
    expect(stateStore.get(runId)).toMatchObject({
      publication: 'blocked',
      attentionReason: 'merge-failed',
      detail: cause
    })
  }

  it('chemin SYNCHRONE — conserve `merge-failed` ET le message de l’exception', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-cause-sync-'))
    try {
      const runId = 'run-cause-sync'
      const stateStore = manifesteVertEnAttente(root, runId)
      const coordinator = new RunWorktreeCoordinator({
        manager: fakeManager({
          listAgentIds: () => [runId],
          finalize: () => {
            throw new Error(SENTINELLE)
          }
        }),
        stateStore,
        nowFn: () => 30
      })

      laCauseEstConservee(coordinator, stateStore, runId, SENTINELLE)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('chemin ASYNCHRONE — meme invariant, sans quoi la production reste muette', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-cause-async-'))
    try {
      const runId = 'run-cause-async'
      const stateStore = manifesteVertEnAttente(root, runId)
      const coordinator = new RunWorktreeCoordinator({
        manager: {
          ...fakeManager({ listAgentIds: () => [runId] }),
          operationsAreIsolated: () => true,
          recoveryInventoryAsync: async () => ({
            residues: { cleaned: 0, recovered: [], blocked: [] },
            agents: [{ agentId: runId, active: false, changedFiles: ['a.txt'] }]
          }),
          finalizeAsync: async () => {
            throw new Error(SENTINELLE)
          }
        },
        stateStore,
        nowFn: () => 30
      })

      await new Promise((resolve) => setTimeout(resolve, 20))
      laCauseEstConservee(coordinator, stateStore, runId, SENTINELLE)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('une valeur jetee qui n’est pas une Error reste lisible (String), jamais « [object Object] »', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-cause-non-error-'))
    try {
      const runId = 'run-cause-non-error'
      const stateStore = manifesteVertEnAttente(root, runId)
      const coordinator = new RunWorktreeCoordinator({
        manager: fakeManager({
          listAgentIds: () => [runId],
          finalize: () => {
            throw SENTINELLE
          }
        }),
        stateStore,
        nowFn: () => 30
      })

      laCauseEstConservee(coordinator, stateStore, runId, SENTINELLE)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('chemin ASYNCHRONE - conserve aussi une valeur jetee non-Error via String', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-cause-async-non-error-'))
    try {
      const runId = 'run-cause-async-non-error'
      const stateStore = manifesteVertEnAttente(root, runId)
      const coordinator = new RunWorktreeCoordinator({
        manager: {
          ...fakeManager({ listAgentIds: () => [runId] }),
          operationsAreIsolated: () => true,
          recoveryInventoryAsync: async () => ({
            residues: { cleaned: 0, recovered: [], blocked: [] },
            agents: [{ agentId: runId, active: false, changedFiles: ['a.txt'] }]
          }),
          finalizeAsync: async () => {
            throw SENTINELLE
          }
        },
        stateStore,
        nowFn: () => 30
      })

      await new Promise((resolve) => setTimeout(resolve, 20))
      laCauseEstConservee(coordinator, stateStore, runId, SENTINELLE)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
