import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TaskStore } from './task-store'
import { gcSeed, seedGcTask } from './gc-seed'

function store(): TaskStore {
  let counter = 0
  return new TaskStore({ now: () => 1000, id: () => `task-${++counter}` })
}

describe('seedGcTask', () => {
  it('pose une tache quotidienne qui invoque /gc', () => {
    const tasks = store()
    const id = seedGcTask(tasks)
    const task = tasks.getTask(id!)
    expect(task?.prompt.startsWith('/gc')).toBe(true)
    expect(task?.schedule?.recurrence).toEqual({ unit: 'day', interval: 1 })
    expect(task?.nextRunAt).not.toBeNull()
  })

  it('ne revient pas apres suppression par l utilisateur', () => {
    const tasks = store()
    const id = seedGcTask(tasks)!
    tasks.remove(id)
    expect(seedGcTask(tasks)).toBeUndefined()
    expect(tasks.listTasks()).toEqual([])
  })

  it('la skill invoquee existe dans le kit', () => {
    expect(gcSeed().prompt).toMatch(/^\/gc /)
    expect(existsSync(join(__dirname, '..', '..', '..', 'skills', 'gc', 'SKILL.md'))).toBe(true)
  })
})
