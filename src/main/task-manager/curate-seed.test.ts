import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TaskStore } from './task-store'
import { curateSeed, seedCurateTask } from './curate-seed'

function store(): TaskStore {
  let counter = 0
  return new TaskStore({ now: () => 1000, id: () => `task-${++counter}` })
}

describe('seedCurateTask', () => {
  it('pose une tache quotidienne qui invoque /curate', () => {
    const tasks = store()
    const id = seedCurateTask(tasks)
    const task = tasks.getTask(id!)
    expect(task?.prompt.startsWith('/curate')).toBe(true)
    expect(task?.schedule?.recurrence).toEqual({ unit: 'day', interval: 1 })
    expect(task?.nextRunAt).not.toBeNull()
  })

  it('ne revient pas apres suppression par l utilisateur', () => {
    const tasks = store()
    const id = seedCurateTask(tasks)!
    tasks.remove(id)
    expect(seedCurateTask(tasks)).toBeUndefined()
    expect(tasks.listTasks()).toEqual([])
  })

  it('la skill invoquee existe dans le kit', () => {
    expect(curateSeed().prompt).toMatch(/^\/curate /)
    expect(existsSync(join(__dirname, '..', '..', '..', 'skills', 'curate', 'SKILL.md'))).toBe(true)
  })
})
