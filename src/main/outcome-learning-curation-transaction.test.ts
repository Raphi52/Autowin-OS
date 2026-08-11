import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { OutcomeLearningLedger } from './activity/outcome-learning-ledger'
import {
  executeCurationTransaction,
  reconcileCurationIntents
} from './outcome-learning-curation-transaction'
import { OutcomeLearningSupervisor } from './outcome-learning-supervisor'

function supervisor(): OutcomeLearningSupervisor {
  let tick = 0
  return new OutcomeLearningSupervisor({
    ledger: new OutcomeLearningLedger(
      join(mkdtempSync(join(tmpdir(), 'curation-tx-')), 'events.jsonl')
    ),
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString()
  })
}

describe('transaction de curation', () => {
  it('compense la mutation si l’invalidation échoue et conserve un audit résolu', async () => {
    const learning = supervisor()
    const compensate = vi.fn(() => ({
      ok: true as const,
      from: '.trash/a.md',
      to: 'knowledge/a.md'
    }))

    await expect(
      executeCurationTransaction(
        learning,
        { action: 'retract', knowledgeId: 'knowledge/a.md' },
        {
          mutate: () => ({
            moved: { ok: true, from: 'knowledge/a.md', to: '.trash/a.md' },
            knowledgeId: 'knowledge/a.md',
            targetId: '.trash/a.md'
          }),
          compensate,
          invalidate: vi
            .fn()
            .mockRejectedValueOnce(new Error('worker unavailable'))
            .mockResolvedValueOnce(undefined)
        }
      )
    ).rejects.toThrow('worker unavailable')

    expect(compensate).toHaveBeenCalledOnce()
    expect(learning.pendingCurationIntents()).toEqual([])
    expect(learning.audit(10)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'curation-resolution',
          value: expect.objectContaining({ status: 'compensated' })
        })
      ])
    )
  })

  it('rejoue une intention durable restée incomplète après arrêt', async () => {
    const learning = supervisor()
    const intent = learning.recordCurationIntent('retract', 'knowledge/a.md')
    const replay = vi.fn(() => ({
      moved: {
        ok: true as const,
        from: 'knowledge/a.md',
        to: '.trash/a.md',
        replayed: true as const
      },
      knowledgeId: 'knowledge/a.md',
      targetId: '.trash/a.md'
    }))

    await expect(reconcileCurationIntents(learning, replay, async () => undefined)).resolves.toBe(1)

    expect(replay).toHaveBeenCalledWith(intent.value)
    expect(learning.pendingCurationIntents()).toEqual([])
    expect(learning.audit(10)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'curation',
          value: expect.objectContaining({ intentId: intent.value.eventId })
        })
      ])
    )
  })

  it('resout durablement chaque intention quand une curation identique est rejouee', async () => {
    const learning = supervisor()
    const operations = {
      mutate: () => ({
        moved: {
          ok: true as const,
          from: 'knowledge/a.md',
          to: '.trash/a.md',
          replayed: true as const
        },
        knowledgeId: 'knowledge/a.md',
        targetId: '.trash/a.md'
      }),
      compensate: vi.fn(() => ({
        ok: true as const,
        from: '.trash/a.md',
        to: 'knowledge/a.md'
      })),
      invalidate: async () => undefined
    }

    await executeCurationTransaction(
      learning,
      { action: 'retract', knowledgeId: 'knowledge/a.md' },
      operations
    )
    await executeCurationTransaction(
      learning,
      { action: 'retract', knowledgeId: 'knowledge/a.md' },
      operations
    )
    expect(learning.pendingCurationIntents()).toEqual([])

    learning.recordCurationIntent('retract', 'knowledge/a.md')
    await expect(
      reconcileCurationIntents(learning, operations.mutate, operations.invalidate)
    ).resolves.toBe(1)
    expect(learning.pendingCurationIntents()).toEqual([])
    await expect(
      reconcileCurationIntents(learning, operations.mutate, operations.invalidate)
    ).resolves.toBe(0)
    expect(learning.pendingCurationIntents()).toEqual([])
    expect(learning.audit(20)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'curation-resolution',
          value: expect.objectContaining({ status: 'deduplicated' })
        })
      ])
    )
  })

  it('serialise deux curations concurrentes avant toute mutation physique', async () => {
    const learning = supervisor()
    let releaseFirst!: () => void
    const firstInvalidation = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const mutate = vi.fn(() => ({
      moved: {
        ok: true as const,
        from: 'knowledge/a.md',
        to: '.trash/a.md',
        replayed: true as const
      },
      knowledgeId: 'knowledge/a.md',
      targetId: '.trash/a.md'
    }))
    const common = {
      mutate,
      compensate: vi.fn(() => ({
        ok: true as const,
        from: '.trash/a.md',
        to: 'knowledge/a.md'
      }))
    }
    const first = executeCurationTransaction(
      learning,
      { action: 'retract', knowledgeId: 'knowledge/a.md' },
      { ...common, invalidate: () => firstInvalidation }
    )
    const second = executeCurationTransaction(
      learning,
      { action: 'retract', knowledgeId: 'knowledge/a.md' },
      { ...common, invalidate: async () => undefined }
    )

    await vi.waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
    releaseFirst()
    await Promise.all([first, second])
    expect(mutate).toHaveBeenCalledTimes(2)
    expect(learning.pendingCurationIntents()).toEqual([])
  })
})
