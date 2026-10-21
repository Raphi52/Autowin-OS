import { describe, expect, it, vi } from 'vitest'
import { TaskStore } from './task-store'
import type { TaskOccurrence } from './types'
import { seedVeilleTask, veilleSeed } from './veille-seed'
import { dispatcherAvecVeille } from '../veille/dispatch-veille'
import type { ResultatPasse } from '../veille/passe'

/**
 * La veille concurrents n'avait JAMAIS lu une page web sur ce poste : le dispatcheur `veille` est
 * branche au planificateur, mais aucune graine ne posait la tache `action: 'veille'` — mesure du
 * 2026-10-21 (conv-1032) : `scheduled-tasks.json` sans aucune tache veille, et les 12 candidats du
 * stock tous internes, 0 echec de source (la signature d'une passe INTERNE seule, sans scout web).
 */

function store(): TaskStore {
  let counter = 0
  return new TaskStore({
    now: () => Date.parse('2026-10-21T08:00:00Z'),
    id: () => `task-${++counter}`
  })
}

const passeVide: ResultatPasse = {
  retenus: 0,
  refuses: [],
  echecs: [],
  sourcesWeb: 1,
  stock: { candidats: [], echecs: [], dernierePasse: '2026-10-26T07:00:00Z' }
}

describe('seedVeilleTask', () => {
  it('pose une tache hebdomadaire qui porte l action veille', () => {
    const tasks = store()
    const id = seedVeilleTask(tasks)
    const task = tasks.getTask(id!)
    expect(task?.action).toBe('veille')
    expect(task?.enabled).toBe(true)
    expect(task?.schedule?.recurrence).toEqual({ unit: 'week', interval: 1, weekDays: [1] })
    // Mercredi 2026-10-21 -> prochaine passe le lundi 2026-10-26 a 09:00 Paris, soit 08:00 UTC :
    // l'heure d'hiver commence le dimanche 25, la veille.
    expect(task?.nextRunAt).toBe(Date.parse('2026-10-26T08:00:00Z'))
  })

  it('ne la pose qu une fois, et ne la remet pas apres suppression par l utilisateur', () => {
    const tasks = store()
    const id = seedVeilleTask(tasks)!
    expect(seedVeilleTask(tasks)).toBeUndefined()
    tasks.remove(id)
    expect(seedVeilleTask(tasks)).toBeUndefined()
    expect(tasks.listTasks()).toEqual([])
  })

  it('ne double pas une veille deja creee a la main : deux passes par semaine paieraient deux fois', () => {
    const tasks = store()
    const manuelle = tasks.create({ ...veilleSeed(), title: 'Ma veille du vendredi' })
    expect(seedVeilleTask(tasks)).toBeUndefined()
    expect(tasks.listTasks().map((tache) => tache.id)).toEqual([manuelle.id])
  })

  // Prouve le ROUTAGE par le dispatcheur, avec une passe simulee : le branchement dans index.ts et
  // le passage par TaskScheduler ne sont pas couverts ici (relecture independante, conv-1032).
  it('le dispatcheur de veille capte la tache posee, sans tour de chat', async () => {
    const tasks = store()
    const task = tasks.getTask(seedVeilleTask(tasks)!)!
    const executerPasse = vi.fn(async () => passeVide)
    const suivant = { run: vi.fn() }
    const dispatcher = dispatcherAvecVeille({ suivant, executerPasse })

    const issue = await dispatcher.run(task, { id: 'occ-1', taskId: task.id } as TaskOccurrence)

    expect(executerPasse).toHaveBeenCalledTimes(1)
    expect(suivant.run).not.toHaveBeenCalled()
    expect(issue.status).toBe('completed')
  })

  // Seul test qui garde `TaskStore.update` sur `action` (task-store.ts) : sans lui, un renommage
  // retransformait deja une fois une veille en tache de chat, en silence.
  it('TaskStore.update garde l action veille quand on renomme la tache', () => {
    const tasks = store()
    const id = seedVeilleTask(tasks)!
    tasks.update(id, { title: 'Veille du lundi' })
    expect(tasks.getTask(id)?.action).toBe('veille')
  })
})
