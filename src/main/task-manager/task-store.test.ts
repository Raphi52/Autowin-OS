import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ScheduledTaskInput } from './types'
import { TaskStore } from './task-store'
import { persistTaskStore } from './task-store-disk'

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
})
