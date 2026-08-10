import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ScheduledTaskInput, TaskOccurrence } from './types'
import { TaskStore } from './task-store'
import { persistTaskStore } from './task-store-disk'
import { WatchdogEngine } from './watchdog-engine'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixturePath(): string {
  const root = mkdtempSync(join(tmpdir(), 'autowin-task-store-'))
  roots.push(root)
  return join(root, 'scheduled-tasks.json')
}

function input(overrides: Partial<ScheduledTaskInput> = {}): ScheduledTaskInput {
  return {
    title: 'Rapport du matin',
    prompt: 'Prépare le rapport quotidien.',
    enabled: true,
    mode: 'active-only',
    destination: { kind: 'existing', conversationId: 'conv-4' },
    schedule: {
      startDate: '2026-08-03',
      time: '09:30',
      timeZone: 'Europe/Paris',
      recurrence: { unit: 'day', interval: 1 }
    },
    ...overrides
  }
}

describe('Task Manager — store durable', () => {
  it('charge une ancienne tâche puis retire son authorityMode devenu inactif', () => {
    const seeded = new TaskStore({ now: () => 1000, id: () => 'task-legacy' })
    seeded.create(
      input({
        destination: {
          kind: 'new',
          title: 'Legacy',
          category: 'codex',
          provider: 'codex'
        }
      })
    )
    const snapshot = seeded.snapshot()
    Object.assign(snapshot.tasks[0].destination, { authorityMode: 'plan' })

    const reloaded = new TaskStore({ now: () => 2000 })
    reloaded.hydrate(snapshot)

    expect(reloaded.getTask('task-legacy')?.destination).not.toHaveProperty('authorityMode')
  })

  it('remplace atomiquement un horaire par un watchdog puis revient a un horaire', () => {
    const store = new TaskStore({ now: () => 1000, id: () => 'task-1' })
    const scheduled = store.create(input())
    const watchdog = {
      source: { kind: 'app-event' as const, events: ['task-failed' as const] },
      guards: { dedupWindowMs: 60_000, maxTriggersPerHour: 4, maxChainDepth: 0, maxPerRoot: 20 }
    }

    const eventDriven = store.update(scheduled.id, { schedule: undefined, watchdog })
    expect(eventDriven.schedule).toBeUndefined()
    expect(eventDriven.watchdog).toEqual(watchdog)

    const hourly = store.update(scheduled.id, {
      watchdog: undefined,
      schedule: input().schedule
    })
    expect(hourly.watchdog).toBeUndefined()
    expect(hourly.schedule).toEqual(input().schedule)
  })

  it('publie immediatement une alerte creee par le scheduler', () => {
    const ids = ['task-1', 'alert-1']
    const store = new TaskStore({ now: () => 1000, id: () => ids.shift() ?? 'unused' })
    const alertsSeen: string[][] = []
    store.subscribe((snapshot) => alertsSeen.push(snapshot.alerts.map(({ id }) => id)))
    const task = store.create(input())
    const occurrenceId = `${task.id}@${task.nextRunAt}`

    store.claim(task.id, occurrenceId, task.nextRunAt!)
    store.finish(occurrenceId, 'failed', { error: 'provider indisponible' })

    expect(alertsSeen.at(-1)).toEqual(['alert-1'])
  })

  it('accepte une tâche événementielle sans horaire et ne lui invente aucune échéance', () => {
    const store = new TaskStore({ now: () => 1000, id: () => 'watchdog-1' })

    const task = store.create(
      input({
        schedule: undefined,
        watchdog: {
          source: { kind: 'app-event', events: ['task-failed'] },
          guards: { dedupWindowMs: 60_000, maxTriggersPerHour: 4, maxChainDepth: 0, maxPerRoot: 20 }
        }
      })
    )

    expect(task).toMatchObject({ id: 'watchdog-1', enabled: true, nextRunAt: null })
    expect(task.schedule).toBeUndefined()
  })

  it('persiste les tâches et les recharge après redémarrage', () => {
    const path = fixturePath()
    const first = new TaskStore({ now: () => 1000, id: () => 'task-1' })
    persistTaskStore(first, path)
    first.create(input())

    const restarted = new TaskStore({ now: () => 2000, id: () => 'task-2' })
    persistTaskStore(restarted, path)

    expect(restarted.listTasks()).toEqual([
      expect.objectContaining({
        id: 'task-1',
        title: 'Rapport du matin',
        nextRunAt: Date.parse('2026-08-03T07:30:00.000Z')
      })
    ])
  })

  it('revendique une occurrence exactement une fois, même après redémarrage', () => {
    const path = fixturePath()
    const first = new TaskStore({ now: () => 1000, id: () => 'task-1' })
    persistTaskStore(first, path)
    const task = first.create(input())
    const occurrenceId = `${task.id}@${task.nextRunAt}`

    expect(first.claim(task.id, occurrenceId, task.nextRunAt!)).toEqual({
      claimed: true,
      occurrence: expect.objectContaining({ id: occurrenceId, status: 'claimed' })
    })
    expect(first.claim(task.id, occurrenceId, task.nextRunAt!)).toEqual({
      claimed: false,
      occurrence: expect.objectContaining({ id: occurrenceId, status: 'claimed' })
    })

    const restarted = new TaskStore({ now: () => 2000 })
    persistTaskStore(restarted, path)
    expect(restarted.claim(task.id, occurrenceId, task.nextRunAt!)).toEqual({
      claimed: false,
      occurrence: expect.objectContaining({ id: occurrenceId, status: 'claimed' })
    })
  })

  it('crée une seule alerte durable pour une échéance manquée et permet de l’acquitter', () => {
    const path = fixturePath()
    const first = new TaskStore({
      now: () => 10_000,
      id: (() => {
        const ids = ['task-1', 'alert-1']
        return () => ids.shift() ?? 'unused'
      })()
    })
    persistTaskStore(first, path)
    const task = first.create(input())
    const occurrenceId = `${task.id}@${task.nextRunAt}`

    first.markMissed(task.id, occurrenceId, task.nextRunAt!, 'Autowin était arrêté')
    first.markMissed(task.id, occurrenceId, task.nextRunAt!, 'second passage')

    expect(first.listAlerts()).toEqual([
      expect.objectContaining({
        id: 'alert-1',
        taskId: task.id,
        occurrenceId,
        acknowledgedAt: undefined
      })
    ])
    expect(first.acknowledgeAlert('alert-1')).toBe(true)

    const restarted = new TaskStore({ now: () => 20_000 })
    persistTaskStore(restarted, path)
    expect(restarted.listAlerts()[0].acknowledgedAt).toBe(10_000)
  })

  it('édite, désactive et supprime sans conserver d’occurrence exécutable', () => {
    const store = new TaskStore({ now: () => 1000, id: () => 'task-1' })
    const task = store.create(input())
    if (!task.schedule) throw new Error('Le fixture horaire doit conserver son planning')
    const updated = store.update(task.id, {
      title: 'Rapport modifié',
      enabled: false,
      schedule: {
        ...task.schedule,
        startDate: '2026-08-04'
      }
    })

    expect(updated).toMatchObject({
      title: 'Rapport modifié',
      enabled: false,
      nextRunAt: null
    })
    expect(store.remove(task.id)).toBe(true)
    expect(store.listTasks()).toEqual([])
    expect(store.listOccurrences()).toEqual([])
  })

  it('refuse de supprimer une tâche dont une occurrence tourne puis l’autorise terminée', () => {
    const store = new TaskStore({ now: () => 1000, id: () => 'task-1' })
    const task = store.create(input())
    const occurrenceId = `${task.id}@${task.nextRunAt}`
    store.claim(task.id, occurrenceId, task.nextRunAt!)
    store.markRunning(occurrenceId, 'conv-4')

    expect(() => store.remove(task.id)).toThrow(/en cours/i)
    expect(store.getTask(task.id)).toBeDefined()
    expect(store.getOccurrence(occurrenceId)?.status).toBe('running')

    store.finish(occurrenceId, 'completed')
    expect(store.remove(task.id)).toBe(true)
    expect(store.getTask(task.id)).toBeUndefined()
  })

  it('agrège aussi les retards avant une mise à jour de tâche', () => {
    const firstDue = Date.parse('2026-08-03T07:30:00.000Z')
    let now = firstDue - 60_000
    const ids = ['task-1', 'alert-1']
    const store = new TaskStore({ now: () => now, id: () => ids.shift() ?? 'unused' })
    const task = store.create(
      input({
        schedule: {
          ...input().schedule!,
          recurrence: { unit: 'minute', interval: 1 }
        }
      })
    )
    now = firstDue + 24 * 60 * 60_000

    const updated = store.update(task.id, { title: 'Rapport agrégé' })

    expect(store.listOccurrences(task.id)).toEqual([
      expect.objectContaining({ missedCount: 1_441, lastMissedFor: now })
    ])
    expect(store.listAlerts()).toHaveLength(1)
    expect(updated.nextRunAt).toBe(now + 60_000)
  })

  it('transforme un claim interrompu par un crash en échec alerté, sans le rejouer', () => {
    const store = new TaskStore({
      now: () => 5000,
      id: (() => {
        const ids = ['task-1', 'alert-crash']
        return () => ids.shift() ?? 'unused'
      })()
    })
    const task = store.create(input())
    const occurrenceId = `${task.id}@${task.nextRunAt}`
    store.claim(task.id, occurrenceId, task.nextRunAt!)
    store.markRunning(occurrenceId, 'conv-4')

    expect(store.recoverInterrupted('Processus interrompu avant la fin.')).toBe(1)
    expect(store.getOccurrence(occurrenceId)).toMatchObject({
      status: 'failed',
      error: 'Processus interrompu avant la fin.'
    })
    expect(store.listAlerts()).toEqual([
      expect.objectContaining({ id: 'alert-crash', occurrenceId, kind: 'failed' })
    ])
    expect(store.claim(task.id, occurrenceId, task.nextRunAt!)).toMatchObject({ claimed: false })
  })

  it('fige le mode de chaque occurrence même si la tâche change ensuite', () => {
    const ids = ['task-1', 'task-2', 'alert-1']
    const store = new TaskStore({ now: () => 5000, id: () => ids.shift() ?? 'unused' })
    const claimedTask = store.create(input({ mode: 'active-only' }))
    const claimedId = `${claimedTask.id}@${claimedTask.nextRunAt}`

    store.claim(claimedTask.id, claimedId, claimedTask.nextRunAt!)
    store.finish(claimedId, 'completed')
    store.update(claimedTask.id, { mode: 'windows' })

    expect(store.getOccurrence(claimedId)).toMatchObject({ mode: 'active-only' })

    const missedTask = store.create(input({ mode: 'windows', title: 'Relais Windows' }))
    const missedId = `${missedTask.id}@${missedTask.nextRunAt}`
    store.markMissed(missedTask.id, missedId, missedTask.nextRunAt!, 'Relais indisponible')
    store.update(missedTask.id, { mode: 'active-only' })

    expect(store.getOccurrence(missedId)).toMatchObject({ mode: 'windows' })
  })

  it("marque le mode d'une ancienne occurrence comme inconnu au lieu de l'inventer", () => {
    const source = new TaskStore({ now: () => 5000, id: () => 'task-1' })
    const task = source.create(input({ mode: 'windows' }))
    const legacyOccurrence = {
      id: `${task.id}@${task.nextRunAt}`,
      taskId: task.id,
      scheduledFor: task.nextRunAt!,
      status: 'completed',
      claimedAt: 4000,
      finishedAt: 5000
    } as unknown as TaskOccurrence
    const restarted = new TaskStore()

    restarted.hydrate({
      ...source.snapshot(),
      occurrences: [legacyOccurrence]
    })

    expect(restarted.getOccurrence(legacyOccurrence.id)).toMatchObject({
      mode: 'legacy-unknown'
    })
  })

  it('restaure la borne de largeur sur une règle persistée avant son ajout', () => {
    const source = new TaskStore({ now: () => 1000, id: () => 'watchdog-legacy' })
    source.create(
      input({
        schedule: undefined,
        watchdog: {
          source: { kind: 'app-event', events: ['task-failed'] },
          guards: { dedupWindowMs: 60_000, maxTriggersPerHour: 4, maxChainDepth: 0, maxPerRoot: 20 }
        }
      })
    )
    const legacy = source.snapshot()
    delete (legacy.tasks[0].watchdog!.guards as Partial<{ maxPerRoot: number }>).maxPerRoot

    const restarted = new TaskStore()
    restarted.hydrate(legacy)

    expect(restarted.listTasks()[0].watchdog?.guards.maxPerRoot).toBe(20)
  })

  it('migre seulement l’ancien app-event.event et reste idempotent', () => {
    let counter = 0
    const source = new TaskStore({ now: () => 1000, id: () => `task-${++counter}` })
    const legacy = source.create(
      input({
        schedule: undefined,
        watchdog: {
          source: { kind: 'app-event', events: ['orchestration-red'] },
          guards: { dedupWindowMs: 1, maxTriggersPerHour: 2, maxChainDepth: 0, maxPerRoot: 3 }
        }
      })
    )
    const modern = source.create(
      input({
        schedule: undefined,
        watchdog: {
          source: { kind: 'app-event', events: ['task-failed', 'task-missed'] },
          guards: { dedupWindowMs: 1, maxTriggersPerHour: 2, maxChainDepth: 0, maxPerRoot: 3 }
        }
      })
    )
    const file = source.create(
      input({
        schedule: undefined,
        watchdog: {
          source: { kind: 'file-match', path: 'C:\\logs\\app.log', pattern: 'ERROR' },
          guards: { dedupWindowMs: 1, maxTriggersPerHour: 2, maxChainDepth: 0, maxPerRoot: 3 }
        }
      })
    )
    const persisted = source.snapshot()
    const oldSource = persisted.tasks.find(({ id }) => id === legacy.id)!.watchdog!
      .source as unknown as Record<string, unknown>
    oldSource.event = 'orchestration-red'
    delete oldSource.events
    const fileSource = persisted.tasks.find(({ id }) => id === file.id)!.watchdog!
      .source as unknown as Record<string, unknown>
    fileSource.event = 'extension-custom'

    const restarted = new TaskStore()
    restarted.hydrate(persisted)
    const twice = new TaskStore()
    twice.hydrate(restarted.snapshot())
    const byId = new Map(twice.listTasks().map((task) => [task.id, task]))

    expect(byId.get(legacy.id)?.watchdog?.source).toEqual({
      kind: 'app-event',
      events: ['orchestration-red']
    })
    expect(byId.get(modern.id)?.watchdog?.source).toEqual({
      kind: 'app-event',
      events: ['task-failed', 'task-missed']
    })
    expect(byId.get(file.id)?.watchdog?.source).toEqual({
      kind: 'file-match',
      path: 'C:\\logs\\app.log',
      pattern: 'ERROR',
      event: 'extension-custom'
    })
  })

  it.each([null, 42, {}, { kind: 'file-match' }, { kind: 'app-event' }])(
    'ignore une source watchdog imbriquée corrompue sans bloquer le chargement (%j)',
    async (corruptSource) => {
      const path = fixturePath()
      const source = new TaskStore({ now: () => 1000, id: () => 'task-corrupt' })
      source.create(
        input({
          schedule: undefined,
          watchdog: {
            source: { kind: 'app-event', events: ['orchestration-red'] },
            guards: { dedupWindowMs: 1, maxTriggersPerHour: 2, maxChainDepth: 0, maxPerRoot: 3 }
          }
        })
      )
      const persisted = source.snapshot()
      persisted.tasks[0].watchdog!.source = corruptSource as never
      writeFileSync(path, JSON.stringify(persisted), 'utf8')

      const restarted = new TaskStore()

      expect(() => persistTaskStore(restarted, path)).not.toThrow()
      expect(restarted.listTasks()[0].watchdog?.source).toEqual(corruptSource)
      const engine = new WatchdogEngine(() => restarted.listTasks(), {
        async runWatchdog() {
          throw new Error('Une source corrompue ne doit jamais atteindre le dispatcher')
        }
      })
      await expect(engine.start()).resolves.toBeUndefined()
      await expect(engine.poll()).resolves.toBeUndefined()
      engine.stop()
    }
  )

  it.each([null, 42, [], {}])(
    'ignore un conteneur watchdog corrompu sans bloquer le chargement (%j)',
    async (corruptWatchdog) => {
      const path = fixturePath()
      const source = new TaskStore({ now: () => 1000, id: () => 'task-corrupt-watchdog' })
      source.create(input())
      const persisted = source.snapshot()
      persisted.tasks[0].watchdog = corruptWatchdog as never
      writeFileSync(path, JSON.stringify(persisted), 'utf8')

      const restarted = new TaskStore()

      expect(() => persistTaskStore(restarted, path)).not.toThrow()
      expect(restarted.listTasks()[0].watchdog).toEqual(corruptWatchdog)
      const engine = new WatchdogEngine(() => restarted.listTasks(), {
        async runWatchdog() {
          throw new Error('Un watchdog corrompu ne doit jamais atteindre le dispatcher')
        }
      })
      await expect(engine.start()).resolves.toBeUndefined()
      await expect(engine.poll()).resolves.toBeUndefined()
      engine.stop()
    }
  )
})
