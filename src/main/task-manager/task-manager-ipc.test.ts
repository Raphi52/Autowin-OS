import { describe, expect, it, vi } from 'vitest'
import {
  parseTaskUpdate,
  registerTaskManagerIpc,
  summarizeTaskUsageLastHour
} from './task-manager-ipc'
import { TaskStore } from './task-store'
import type { ScheduledTaskInput } from './types'

const schedule = {
  startDate: '2026-08-09',
  time: '09:00',
  timeZone: 'Europe/Paris',
  recurrence: { unit: 'day' as const, interval: 1 }
}

const base: ScheduledTaskInput = {
  title: 'Rapport',
  prompt: 'Prepare le rapport.',
  enabled: true,
  mode: 'active-only',
  destination: { kind: 'existing', conversationId: 'conv-1' },
  schedule
}

describe('Task Manager IPC — remplacement du declencheur', () => {
  it('additionne seulement le cout connu de la derniere heure pour cette tache', () => {
    expect(
      summarizeTaskUsageLastHour(
        [
          {
            id: 'recent',
            taskId: 'task-cost',
            scheduledFor: 4_000_000,
            mode: 'active-only',
            status: 'completed',
            claimedAt: 4_000_000,
            finishedAt: 4_000_000,
            knownCostUsd: 0.42,
            totalTokens: 12_345,
            unpricedCalls: 1
          },
          {
            id: 'old',
            taskId: 'task-cost',
            scheduledFor: 1,
            mode: 'active-only',
            status: 'completed',
            claimedAt: 1,
            finishedAt: 1,
            knownCostUsd: 99,
            totalTokens: 99
          }
        ],
        'task-cost',
        4_000_000
      )
    ).toEqual({
      knownCostUsdLastHour: 0.42,
      totalTokensLastHour: 12_345,
      unpricedCallsLastHour: 1
    })
  })

  it('ne restaure pas l horaire retire quand le renderer envoie un watchdog', () => {
    const watchdog = {
      source: { kind: 'app-event' as const, events: ['task-failed' as const] },
      guards: { dedupWindowMs: 60_000, maxTriggersPerHour: 4, maxChainDepth: 0, maxPerRoot: 20 },
      action: 'orchestration' as const
    }

    const updated = parseTaskUpdate(base, { watchdog })
    expect(updated.watchdog).toEqual(watchdog)
    expect(updated).not.toHaveProperty('schedule')
  })

  it('ne restaure pas le watchdog retire quand le renderer envoie un horaire', () => {
    const watchdogCurrent: ScheduledTaskInput = {
      ...base,
      schedule: undefined,
      watchdog: {
        source: { kind: 'app-event', events: ['task-failed'] },
        guards: { dedupWindowMs: 60_000, maxTriggersPerHour: 4, maxChainDepth: 0, maxPerRoot: 20 }
      }
    }

    expect(parseTaskUpdate(watchdogCurrent, { schedule })).toEqual({
      ...watchdogCurrent,
      schedule,
      watchdog: undefined
    })
  })

  it('preserve tous les evenements Auto-kaizen lors d une sauvegarde UI', () => {
    const events = [
      'orchestration-red',
      'workflow-gate-failed',
      'workflow-unverified',
      'workflow-proof-lost'
    ] as const
    const watchdog = {
      source: { kind: 'app-event' as const, events: [...events] },
      guards: { dedupWindowMs: 300_000, maxTriggersPerHour: 2, maxChainDepth: 0, maxPerRoot: 1 },
      action: 'orchestration' as const
    }

    const updated = parseTaskUpdate({ ...base, schedule: undefined, watchdog }, { watchdog })

    expect(updated.watchdog?.source).toEqual({ kind: 'app-event', events })
  })

  it('contraint les plafonds quotidiens recus du renderer', () => {
    const updated = parseTaskUpdate(base, {
      watchdog: {
        source: { kind: 'app-event', events: ['task-failed'] },
        guards: {
          dedupWindowMs: 60_000,
          maxTriggersPerHour: 4,
          maxTriggersPerDay: 99_999,
          maxKnownCostUsdPerDay: 0,
          maxUnpricedCallsPerDay: 0,
          maxChainDepth: 0,
          maxPerRoot: 1
        }
      }
    })

    expect(updated.watchdog?.guards).toMatchObject({
      maxTriggersPerDay: 5_760,
      maxKnownCostUsdPerDay: 0.01,
      maxUnpricedCallsPerDay: 1
    })
  })

  it('refuse la suppression IPC pendant une occurrence active puis la permet terminee', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const store = new TaskStore({ now: () => 1_000, id: () => 'task-ipc' })
    const task = store.create(base)
    const occurrenceId = `${task.id}@${task.nextRunAt}`
    store.claim(task.id, occurrenceId, task.nextRunAt!)
    store.markRunning(occurrenceId, 'conv-1')
    const refresh = vi.fn(async () => undefined)
    const onChanged = vi.fn()
    registerTaskManagerIpc({
      ipc: {
        handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
          handlers.set(channel, handler)
        }
      } as never,
      store,
      scheduler: { refresh } as never,
      watchdogDiagnostics: () => ({ admittedLastHour: 0 }),
      assertTrusted: () => undefined,
      onChanged
    })
    const remove = handlers.get('task-manager:remove')
    if (!remove) throw new Error('handler remove absent')

    await expect(remove({}, task.id)).rejects.toThrow(/en cours/i)
    expect(store.getTask(task.id)).toBeDefined()
    expect(refresh).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()

    store.finish(occurrenceId, 'completed')
    await expect(remove({}, task.id)).resolves.toBe(true)
    expect(store.getTask(task.id)).toBeUndefined()
    expect(refresh).toHaveBeenCalledOnce()
    expect(onChanged).toHaveBeenCalledOnce()
  })
})
