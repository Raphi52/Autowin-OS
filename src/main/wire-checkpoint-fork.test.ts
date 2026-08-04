import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AutowinOS } from './os'
import { admitAutomaticResumeRuntime, type OrchestrationRunState } from './runs/orchestration-state'
import {
  CheckpointForkError,
  createCheckpointForkManifest,
  type PersistedCheckpoint
} from './wire-checkpoint-fork'

type RunState = {
  phase: string
  attempts: number
  notes: string[]
}

const checkpoint: PersistedCheckpoint<RunState> = {
  id: 'checkpoint-42',
  runId: 'run-source',
  createdAt: '2026-07-31T10:00:00.000Z',
  sourceSnapshot: {
    workspaceId: 'workspace-7',
    baseSha: 'abc123',
    contentHash: 'sha256:source'
  },
  state: { phase: 'build', attempts: 1, notes: ['source'] }
}

const temporaryRoots: string[] = []
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('checkpoint fork manifests', () => {
  it('creates an immutable fork with a stable source snapshot and ancestor', () => {
    const manifest = createCheckpointForkManifest([checkpoint], {
      checkpointId: 'checkpoint-42',
      forkId: 'fork-a',
      createdAt: '2026-07-31T10:05:00.000Z'
    })

    expect(manifest).toEqual({
      schema: 'autowin.checkpoint-fork/v1',
      id: 'fork-a',
      createdAt: '2026-07-31T10:05:00.000Z',
      ancestor: {
        checkpointId: 'checkpoint-42',
        runId: 'run-source',
        checkpointCreatedAt: '2026-07-31T10:00:00.000Z'
      },
      sourceSnapshot: {
        workspaceId: 'workspace-7',
        baseSha: 'abc123',
        contentHash: 'sha256:source'
      },
      branchState: { phase: 'build', attempts: 1, notes: ['source'] }
    })
    expect(Object.isFrozen(manifest)).toBe(true)
    expect(Object.isFrozen(manifest.sourceSnapshot)).toBe(true)
    expect(Object.isFrozen(manifest.branchState.notes)).toBe(true)
  })

  it('allows branches to diverge without mutating the persisted checkpoint', () => {
    const checkpoints = [structuredClone(checkpoint)]
    const first = createCheckpointForkManifest(checkpoints, {
      checkpointId: 'checkpoint-42',
      forkId: 'fork-a',
      createdAt: '2026-07-31T10:05:00.000Z',
      deriveState: (state) => {
        state.attempts = 2
        state.notes.push('route-a')
        return state
      }
    })
    const second = createCheckpointForkManifest(checkpoints, {
      checkpointId: 'checkpoint-42',
      forkId: 'fork-b',
      createdAt: '2026-07-31T10:06:00.000Z',
      deriveState: (state) => {
        state.phase = 'judge'
        state.notes.push('route-b')
        return state
      }
    })

    expect(first.branchState).toEqual({ phase: 'build', attempts: 2, notes: ['source', 'route-a'] })
    expect(second.branchState).toEqual({
      phase: 'judge',
      attempts: 1,
      notes: ['source', 'route-b']
    })
    expect(first.sourceSnapshot).toEqual(second.sourceSnapshot)
    expect(first.ancestor).toEqual(second.ancestor)
    expect(first.branchState).not.toBe(checkpoints[0].state)
    expect(first.sourceSnapshot).not.toBe(checkpoints[0].sourceSnapshot)
    expect(checkpoints[0]).toEqual(checkpoint)
  })

  it('persists a restartable branch with a turn identity distinct from its source', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-checkpoint-fork-'))
    temporaryRoots.push(root)
    const os = Object.create(AutowinOS.prototype) as AutowinOS
    Object.defineProperty(os, 'orchestrationStateRoot', { value: root })
    const source: OrchestrationRunState = {
      runId: 'source-run',
      task: 'continuer indépendamment',
      conversationId: 'conversation-a',
      turnId: 'source-turn',
      phaseOutputs: [{ phase: 'frame', text: 'acquis' }],
      startedAt: 1,
      updatedAt: 2
    }

    const fork = os.persistCheckpointFork(
      { ...source, runId: 'branch-run' },
      {
        checkpointId: 'source-run',
        runId: 'source-run',
        checkpointCreatedAt: '2026-08-01T20:00:00.000Z',
        contentHash: 'source-hash'
      }
    )
    const persisted = JSON.parse(
      readFileSync(join(root, 'branch-run.json'), 'utf8')
    ) as OrchestrationRunState
    const binding = { provider: 'codex', model: 'gpt-5.6-sol' }
    const runtime = {
      roles: {
        orchestrator: binding,
        subagent: binding,
        judge: binding,
        scout: binding
      },
      phaseFanOut: {},
      judgeFanOut: []
    }
    const admission = admitAutomaticResumeRuntime(
      persisted,
      runtime,
      'branch-turn'
    )

    expect(fork.turnId).toBeUndefined()
    expect(persisted.turnId).toBeUndefined()
    expect(admission.resumeExisting).toBe(false)
    expect(admission.turnId).toBe('branch-turn')
    expect(admission.turnId).not.toBe(source.turnId)
  })

  it.each([
    ['', 'CHECKPOINT_ID_MISSING'],
    ['checkpoint-unknown', 'CHECKPOINT_NOT_FOUND']
  ] as const)('rejects an unavailable checkpoint id %j', (checkpointId, code) => {
    expect(() =>
      createCheckpointForkManifest([checkpoint], {
        checkpointId,
        forkId: 'fork-a',
        createdAt: '2026-07-31T10:05:00.000Z'
      })
    ).toThrowError(expect.objectContaining<Partial<CheckpointForkError>>({ code }))
  })
})
