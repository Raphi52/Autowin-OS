import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TaskStore } from './task-store'
import { CURATE_SEED_ID, curateSeed, seedCurateTask } from './curate-seed'

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

  it('range son fil sur « This computer », pas dans le dossier d’Autowin', () => {
    const tasks = store()
    const id = seedCurateTask(tasks, 'C:\\Users\\moi')
    const destination = tasks.getTask(id!)?.destination
    expect(destination?.kind === 'new' && destination.dossier).toBe('C:\\Users\\moi')
  })

  it('range sur « This computer » une tâche déjà posée sans dossier, jamais un dossier choisi', () => {
    const tasks = store()
    const ancienne = tasks.create(curateSeed())
    const choisie = tasks.create(curateSeed())
    const destination = choisie.destination
    if (destination.kind !== 'new') throw new Error('semis attendu en nouvelle conversation')
    tasks.update(choisie.id, { destination: { ...destination, dossier: 'D:\\Brain' } })
    tasks.markSeeded(CURATE_SEED_ID)

    seedCurateTask(tasks, 'C:\\Users\\moi')

    const dossier = (id: string): string | undefined => {
      const d = tasks.getTask(id)?.destination
      return d?.kind === 'new' ? d.dossier : undefined
    }
    expect(dossier(ancienne.id)).toBe('C:\\Users\\moi')
    expect(dossier(choisie.id)).toBe('D:\\Brain')
  })

  it('la skill invoquee existe dans le kit', () => {
    expect(curateSeed().prompt).toMatch(/^\/curate /)
    expect(existsSync(join(__dirname, '..', '..', '..', 'skills', 'curate', 'SKILL.md'))).toBe(true)
  })
})
