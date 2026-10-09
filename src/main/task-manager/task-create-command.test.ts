import { describe, expect, it, vi } from 'vitest'
import { createTaskFromCommand, type TaskCreateDeps } from './task-create-command'
import { TaskStore } from './task-store'

const valide = {
  title: 'Rapport',
  prompt: 'Prepare le rapport.',
  enabled: true,
  mode: 'active-only',
  destination: { kind: 'existing', conversationId: 'conv-1' },
  schedule: {
    startDate: '2099-08-09',
    time: '09:00',
    timeZone: 'Europe/Paris',
    recurrence: { unit: 'day', interval: 1 }
  }
}

function banc(): {
  store: TaskStore
  deps: TaskCreateDeps
  refresh: ReturnType<typeof vi.fn>
  onChanged: ReturnType<typeof vi.fn>
} {
  const store = new TaskStore()
  const refresh = vi.fn(async () => {})
  const onChanged = vi.fn()
  return {
    store,
    refresh,
    onChanged,
    deps: { create: (i) => store.create(i), list: () => store.listTasks(), refresh, onChanged }
  }
}

describe('task_create — rien que l’utilisateur ne puisse supprimer dans le Task Manager', () => {
  it('crée dans le stockage de l’écran, réarme le minuteur, et la suppression manuelle marche', async () => {
    const { store, deps, refresh, onChanged } = banc()
    const r = await createTaskFromCommand({ task: JSON.stringify(valide) }, deps)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(store.listTasks().map((t) => t.id)).toEqual([r.task.id])
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(store.remove(r.task.id)).toBe(true)
    expect(store.listTasks()).toEqual([])
  })

  it('accepte une règle de surveillance (objet passé tel quel)', async () => {
    const { store, deps } = banc()
    const { schedule: _s, ...sansHoraire } = valide
    const r = await createTaskFromCommand(
      {
        task: {
          ...sansHoraire,
          watchdog: {
            source: { kind: 'app-event', events: ['task-failed'] },
            guards: {
              dedupWindowMs: 60_000,
              maxTriggersPerHour: 4,
              maxChainDepth: 0,
              maxPerRoot: 20
            },
            action: 'orchestration'
          }
        }
      },
      deps
    )
    expect(r.ok).toBe(true)
    expect(store.listTasks()[0]?.watchdog?.source.kind).toBe('app-event')
  })

  it('deux appels identiques = deux tâches distinctes, toutes deux supprimables', async () => {
    const { store, deps } = banc()
    await createTaskFromCommand({ task: valide }, deps)
    await createTaskFromCommand({ task: valide }, deps)
    const ids = store.listTasks().map((t) => t.id)
    expect(new Set(ids).size).toBe(2)
    for (const id of ids) expect(store.remove(id)).toBe(true)
  })

  it.each([
    ['argument absent', undefined],
    ['texte non JSON', { task: '{pas du json' }],
    ['pas un objet', { task: '42' }],
    ['titre vide', { task: { ...valide, title: '   ' } }],
    ['ni horaire ni surveillance', { task: { ...valide, schedule: undefined } }],
    ['mode inconnu', { task: { ...valide, mode: 'toujours' } }],
    ['action inconnue', { task: { ...valide, action: 'shell' } }]
  ])('refuse (%s) sans rien écrire ni réarmer', async (_cas, args) => {
    const { store, deps, refresh, onChanged } = banc()
    const r = await createTaskFromCommand(args as { task?: unknown } | undefined, deps)
    expect(r.ok).toBe(false)
    expect(store.listTasks()).toEqual([])
    expect(refresh).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('sans Task Manager câblé : refus nommé', async () => {
    const r = await createTaskFromCommand({ task: valide }, undefined)
    expect(r).toEqual({ ok: false, reason: expect.stringMatching(/indisponible/) })
  })
})
