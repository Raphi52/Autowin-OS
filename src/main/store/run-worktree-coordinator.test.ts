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
    finalize: (id: string) => FinalizeResult
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
    ) => { ok: true } | { ok: false; detail: string }
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
      files: [{ path: 'a.txt', kind: 'mod' }],
      attentionReason: 'base-in-progress'
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
    ['interrupted', 'blocked', 'blocked'],
    ['running', 'not-requested', 'blocked']
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
})
