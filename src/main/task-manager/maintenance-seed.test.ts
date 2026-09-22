import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TaskStore } from './task-store'
import { maintenanceSeed, seedMaintenanceTask } from './maintenance-seed'

function store(): TaskStore {
  let counter = 0
  return new TaskStore({ now: () => 1000, id: () => `task-${++counter}` })
}

describe('seedMaintenanceTask', () => {
  it('pose une tache quotidienne qui invoque /maintenance', () => {
    const tasks = store()
    const id = seedMaintenanceTask(tasks)
    const task = tasks.getTask(id!)
    expect(task?.prompt.startsWith('/maintenance')).toBe(true)
    expect(task?.schedule?.recurrence).toEqual({ unit: 'day', interval: 1 })
    expect(task?.nextRunAt).not.toBeNull()
  })

  it('ne revient pas apres suppression par l utilisateur', () => {
    const tasks = store()
    const id = seedMaintenanceTask(tasks)!
    tasks.remove(id)
    expect(seedMaintenanceTask(tasks)).toBeUndefined()
    expect(tasks.listTasks()).toEqual([])
  })

  it('la skill invoquee existe dans le kit', () => {
    expect(maintenanceSeed().prompt).toMatch(/^\/maintenance /)
    expect(existsSync(join(__dirname, '..', '..', '..', 'skills', 'maintenance', 'SKILL.md'))).toBe(true)
  })
})
