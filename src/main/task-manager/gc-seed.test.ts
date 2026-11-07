import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TaskStore } from './task-store'
import { GC_PROMPT_SUR_AUTOWIN_DATA, GC_SEED_ID, gcSeed, seedGcTask } from './gc-seed'

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

  it('le libelle ne borne plus le menage a un seul dossier', () => {
    expect(gcSeed().prompt).not.toContain('.autowin-data')
  })

  it('met a jour le libelle d une tache deja posee, si personne ne l a retouche', () => {
    const tasks = store()
    const ancienne = tasks.create({ ...gcSeed(), prompt: GC_PROMPT_SUR_AUTOWIN_DATA })
    tasks.markSeeded(GC_SEED_ID)

    expect(seedGcTask(tasks)).toBeUndefined()

    expect(tasks.getTask(ancienne.id)?.prompt).toBe(gcSeed().prompt)
  })

  it('ne touche pas une tache dont l utilisateur a change le texte', () => {
    const tasks = store()
    const retouchee = tasks.create({ ...gcSeed(), prompt: '/gc seulement les captures' })
    tasks.markSeeded(GC_SEED_ID)

    seedGcTask(tasks)

    expect(tasks.getTask(retouchee.id)?.prompt).toBe('/gc seulement les captures')
  })

  it('range son fil sur « This computer », et y remet une tâche déjà posée sans dossier', () => {
    const tasks = store()
    const ancienne = tasks.create(gcSeed())
    tasks.markSeeded(GC_SEED_ID)
    expect(seedGcTask(tasks, 'C:\\Users\\moi')).toBeUndefined()
    const avant = tasks.getTask(ancienne.id)?.destination
    expect(avant?.kind === 'new' && avant.dossier).toBe('C:\\Users\\moi')

    const neuve = store()
    const destination = neuve.getTask(seedGcTask(neuve, 'C:\\Users\\moi')!)?.destination
    expect(destination?.kind === 'new' && destination.dossier).toBe('C:\\Users\\moi')
  })

  it('la skill invoquee existe dans le kit', () => {
    expect(gcSeed().prompt).toMatch(/^\/gc /)
    expect(existsSync(join(__dirname, '..', '..', '..', 'skills', 'gc', 'SKILL.md'))).toBe(true)
  })
})
