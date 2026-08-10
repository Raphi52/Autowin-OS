import { describe, expect, it, vi } from 'vitest'
import { TaskStore } from './task-store'
import {
  TaskScheduler,
  type SchedulerClock,
  type TaskDispatcher,
  type WindowsRelay
} from './task-scheduler'
import type { ScheduledTaskInput } from './types'

function input(
  mode: ScheduledTaskInput['mode'],
  overrides: Partial<ScheduledTaskInput> = {}
): ScheduledTaskInput {
  return {
    title: `Tâche ${mode}`,
    prompt: 'Exécute ce prompt.',
    enabled: true,
    mode,
    destination: { kind: 'existing', conversationId: 'conv-1' },
    schedule: {
      startDate: '2026-08-03',
      time: '09:30',
      timeZone: 'Europe/Paris',
      recurrence: { unit: 'day', interval: 1 }
    },
    ...overrides
  }
}

function harness(now: number): {
  store: TaskStore
  clock: SchedulerClock
  advanceTo: (value: number) => Promise<void>
  dispatch: TaskDispatcher
  relay: WindowsRelay
  dispatched: string[]
  relayCalls: Array<{ scheduledFor: number | null; occurrenceId: string | null }>
} {
  let current = now
  let timer:
    | {
        at: number
        callback: () => void
      }
    | undefined
  const dispatched: string[] = []
  const relayCalls: Array<{ scheduledFor: number | null; occurrenceId: string | null }> = []
  const store = new TaskStore({
    now: () => current,
    id: (() => {
      let sequence = 0
      return () => `id-${++sequence}`
    })()
  })
  return {
    store,
    clock: {
      now: () => current,
      setTimer: (callback, delayMs) => {
        timer = { at: current + delayMs, callback }
        return timer
      },
      clearTimer: (handle) => {
        if (timer === handle) timer = undefined
      }
    },
    advanceTo: async (value) => {
      current = value
      if (timer && timer.at <= current) {
        const callback = timer.callback
        timer = undefined
        callback()
        await vi.waitFor(() =>
          expect(timer?.at ?? Number.POSITIVE_INFINITY).toBeGreaterThan(current)
        )
      }
    },
    dispatch: {
      run: async (_task, occurrence) => {
        dispatched.push(occurrence.id)
        return { status: 'completed', conversationId: 'conv-1', turnId: 'turn-1' }
      }
    },
    relay: {
      arm: async (scheduledFor, occurrenceId) => {
        relayCalls.push({ scheduledFor, occurrenceId })
        return {
          available: true,
          scheduledFor,
          wakeToRun: true,
          startWhenAvailable: false,
          multipleInstances: 'IgnoreNew'
        }
      }
    },
    dispatched,
    relayCalls
  }
}

describe('Task Manager — ordonnanceur durable', () => {
  it('exécute une échéance live une seule fois puis programme la suivante', async () => {
    const due = Date.parse('2026-08-03T07:30:00.000Z')
    const h = harness(due - 60_000)
    const task = h.store.create(input('active-only'))
    const scheduler = new TaskScheduler(h.store, h.dispatch, h.relay, h.clock)

    await scheduler.start()
    await h.advanceTo(due)

    expect(h.dispatched).toEqual([`${task.id}@${due}`])
    expect(h.store.getOccurrence(`${task.id}@${due}`)).toMatchObject({ status: 'completed' })
    expect(h.store.getTask(task.id)?.nextRunAt).toBe(Date.parse('2026-08-04T07:30:00.000Z'))

    await scheduler.processLiveDue()
    expect(h.dispatched).toHaveLength(1)
  })

  it('agrège au démarrage les échéances passées sans les rattraper', async () => {
    const firstDue = Date.parse('2026-08-03T07:30:00.000Z')
    const h = harness(Date.parse('2026-08-03T07:00:00.000Z'))
    const task = h.store.create(input('active-only'))
    const scheduler = new TaskScheduler(h.store, h.dispatch, h.relay, h.clock)

    await h.advanceTo(Date.parse('2026-08-05T08:00:00.000Z'))
    await scheduler.start()

    expect(h.dispatched).toEqual([])
    expect(h.store.listOccurrences(task.id)).toEqual([
      expect.objectContaining({
        status: 'missed',
        scheduledFor: firstDue,
        lastMissedFor: Date.parse('2026-08-05T07:30:00.000Z'),
        missedCount: 3
      })
    ])
    expect(h.store.listAlerts()).toHaveLength(1)
    expect(h.store.getTask(task.id)?.nextRunAt).toBe(Date.parse('2026-08-06T07:30:00.000Z'))
  })

  it('agrège 24 heures de retards à la minute en une seule occurrence', async () => {
    const firstDue = Date.parse('2026-08-03T07:30:00.000Z')
    const h = harness(firstDue - 60_000)
    const task = h.store.create(
      input('active-only', {
        schedule: {
          ...input('active-only').schedule!,
          recurrence: { unit: 'minute', interval: 1 }
        }
      })
    )
    const scheduler = new TaskScheduler(h.store, h.dispatch, h.relay, h.clock)

    await h.advanceTo(firstDue + 24 * 60 * 60_000)
    const startedAt = performance.now()
    await scheduler.start()

    expect(performance.now() - startedAt).toBeLessThan(250)
    expect(h.store.listOccurrences(task.id)).toEqual([
      expect.objectContaining({ missedCount: 1_441, lastMissedFor: firstDue + 24 * 60 * 60_000 })
    ])
    expect(h.store.listAlerts()).toHaveLength(1)
    expect(h.store.getTask(task.id)?.nextRunAt).toBe(firstDue + 24 * 60 * 60_000 + 60_000)
  })

  it("ne rattrape pas les échéances d'une tâche réactivée après plusieurs jours", async () => {
    const now = Date.parse('2026-08-05T08:00:00.000Z')
    const h = harness(now)
    const task = h.store.create(input('active-only', { enabled: false }))
    const scheduler = new TaskScheduler(h.store, h.dispatch, h.relay, h.clock)

    await scheduler.start()
    h.store.update(task.id, { enabled: true })
    await scheduler.refresh()
    await h.advanceTo(now)

    expect(h.dispatched).toEqual([])
    expect(h.store.listOccurrences(task.id)).toEqual([])
    expect(h.store.getTask(task.id)?.nextRunAt).toBe(Date.parse('2026-08-06T07:30:00.000Z'))
  })

  it('programme une nouvelle tâche récurrente passée à sa première échéance future', () => {
    const h = harness(Date.parse('2026-08-05T08:00:00.000Z'))
    const task = h.store.create(input('active-only'))

    expect(task.nextRunAt).toBe(Date.parse('2026-08-06T07:30:00.000Z'))
  })

  it("marque l'échéance Windows dépassée avant un passage en actif uniquement", async () => {
    const due = Date.parse('2026-08-03T07:30:00.000Z')
    const now = Date.parse('2026-08-03T08:00:00.000Z')
    const h = harness(due - 60_000)
    const task = h.store.create(input('windows'))
    const scheduler = new TaskScheduler(h.store, h.dispatch, h.relay, h.clock)

    await scheduler.start()
    await h.advanceTo(now)
    h.store.update(task.id, { mode: 'active-only' })
    await scheduler.refresh()
    await h.advanceTo(now)

    expect(h.dispatched).toEqual([])
    expect(h.store.getOccurrence(`${task.id}@${due}`)).toMatchObject({
      mode: 'windows',
      status: 'missed'
    })
    expect(h.store.listAlerts()).toHaveLength(1)
    expect(h.store.getTask(task.id)?.nextRunAt).toBe(Date.parse('2026-08-04T07:30:00.000Z'))
  })

  it('honore l’occurrence demandée par le relais Windows puis refuse son doublon', async () => {
    const due = Date.parse('2026-08-03T07:30:00.000Z')
    const h = harness(due - 60_000)
    const task = h.store.create(input('windows'))
    const occurrenceId = `${task.id}@${due}`
    const scheduler = new TaskScheduler(h.store, h.dispatch, h.relay, h.clock)

    await h.advanceTo(due + 5_000)
    await scheduler.start(occurrenceId)
    await scheduler.runOccurrence(occurrenceId)

    expect(h.dispatched).toEqual([occurrenceId])
    expect(h.store.getOccurrence(occurrenceId)?.status).toBe('completed')
    expect(h.relayCalls.at(-1)).toEqual({
      scheduledFor: Date.parse('2026-08-04T07:30:00.000Z'),
      occurrenceId: `${task.id}@${Date.parse('2026-08-04T07:30:00.000Z')}`
    })
  })

  it('refuse un relais Windows reçu trop tard et alerte sans envoyer le prompt', async () => {
    const due = Date.parse('2026-08-03T07:30:00.000Z')
    const h = harness(due - 60_000)
    const task = h.store.create(input('windows'))
    const occurrenceId = `${task.id}@${due}`
    const scheduler = new TaskScheduler(h.store, h.dispatch, h.relay, h.clock)

    await h.advanceTo(due + 6 * 60_000)
    await scheduler.start(occurrenceId)

    expect(h.dispatched).toEqual([])
    expect(h.store.getOccurrence(occurrenceId)).toMatchObject({
      mode: 'windows',
      status: 'missed'
    })
    expect(h.store.listAlerts()).toHaveLength(1)
    expect(h.store.getTask(task.id)?.nextRunAt).toBe(Date.parse('2026-08-04T07:30:00.000Z'))
  })

  it('réserve les tâches Windows au relais et ne les exécute pas avec le timer interne', async () => {
    const due = Date.parse('2026-08-03T07:30:00.000Z')
    const h = harness(due - 60_000)
    const task = h.store.create(input('windows'))
    const occurrenceId = `${task.id}@${due}`
    const scheduler = new TaskScheduler(h.store, h.dispatch, h.relay, h.clock)

    await scheduler.start()
    await h.advanceTo(due)

    expect(h.dispatched).toEqual([])
    expect(h.store.getTask(task.id)?.nextRunAt).toBe(due)

    await scheduler.runOccurrence(occurrenceId)
    expect(h.dispatched).toEqual([occurrenceId])
  })

  it('conserve le canal de causalite tardive sur le chemin watchdog uniquement', async () => {
    const now = Date.parse('2026-08-03T08:00:00.000Z')
    const h = harness(now)
    const task = h.store.create(
      input('active-only', {
        schedule: undefined,
        watchdog: {
          source: { kind: 'app-event', events: ['orchestration-red'] },
          guards: { dedupWindowMs: 0, maxTriggersPerHour: 12, maxChainDepth: 0, maxPerRoot: 20 }
        }
      })
    )
    const onLateMutationClaims = vi.fn()
    const dispatch = {
      run: vi.fn(async (_task, _occurrence, _onLateMutationClaims) => ({
        status: 'completed' as const
      }))
    } satisfies TaskDispatcher
    const scheduler = new TaskScheduler(h.store, dispatch, h.relay, h.clock)

    await scheduler.runWatchdog(
      task.id,
      {
        signature: 'red',
        rootSignature: 'red@1',
        context: 'red',
        depth: 0,
        source: 'app-event',
        observedAt: now
      },
      onLateMutationClaims
    )

    expect(dispatch.run.mock.calls[0][2]).toBe(onLateMutationClaims)
  })
})
