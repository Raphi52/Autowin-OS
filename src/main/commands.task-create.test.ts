import { describe, expect, it, vi } from 'vitest'
import { AppCommandBus } from './commands'
import { TaskStore } from './task-manager/task-store'

/**
 * Demande conv-114 (2026-10-09) : l'agent peut créer des tâches, mais rien que l'utilisateur ne
 * puisse supprimer dans le Task Manager. Ce test verrouille le CÂBLAGE du bus : `task_create` passe
 * par le stockage de l'écran, et sans Task Manager câblé il refuse au lieu d'inventer un chemin.
 */
describe('task_create — câblage du bus', () => {
  const os = {
    executionWorkspace: process.cwd(),
    conversations: { get: () => undefined, list: () => [] },
    registry: { ids: () => ['claude'] },
    roles: { all: () => ({}), getBinding: () => ({ provider: 'claude' }) },
    runsWithGate: () => [],
    budget: () => ({ spent: 0 })
  }
  const tache = {
    title: 'Veille du matin',
    prompt: 'Résume les nouveautés.',
    enabled: true,
    mode: 'active-only',
    destination: { kind: 'existing', conversationId: 'conv-1' },
    schedule: {
      startDate: '2099-01-01',
      time: '09:00',
      timeZone: 'Europe/Paris',
      recurrence: { unit: 'none', interval: 1 }
    }
  }

  it('figure au catalogue, non idempotent et non destructif', () => {
    const bus = new AppCommandBus(os as never, () => undefined)
    const spec = bus.catalog().find((c) => c.name === 'task_create')
    expect(spec?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false
    })
  })

  it('crée dans le stockage de l’écran ; la tâche se supprime ensuite', async () => {
    const store = new TaskStore()
    const refresh = vi.fn(async () => {})
    const bus = new AppCommandBus(os as never, () => undefined)
    bus.taskManager = { create: (i) => store.create(i), refresh, onChanged: () => undefined }

    const result = await bus.exec('task_create', { task: JSON.stringify(tache) })

    expect(result.data).toMatchObject({ ok: true })
    expect(store.listTasks().map((t) => t.title)).toEqual(['Veille du matin'])
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(store.remove(store.listTasks()[0]!.id)).toBe(true)
  })

  it('sans Task Manager câblé : refus nommé, rien créé', async () => {
    const bus = new AppCommandBus(os as never, () => undefined)
    const result = await bus.exec('task_create', { task: JSON.stringify(tache) })
    expect(result.data).toEqual({ ok: false, reason: expect.stringMatching(/indisponible/) })
  })
})
