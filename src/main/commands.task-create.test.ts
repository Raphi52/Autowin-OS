import { describe, expect, it, vi } from 'vitest'
import { AppCommandBus } from './commands'
import { TaskStore } from './task-manager/task-store'
import { MODELE_PROMPT_TACHE_COURT, TETES_DU_MODELE_PROMPT_TACHE } from '../shared/modele-prompt-tache'

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

  // conv-983 (2026-10-16) : l'agent rédige le prompt d'une tâche sur le modèle partagé, qu'il lit
  // au moment même de créer — la description de la commande, servie à chaque tour.
  it('donne à l’agent le modèle de prompt, sans redevenir un paragraphe', () => {
    const bus = new AppCommandBus(os as never, () => undefined)
    const description = bus.catalog().find((c) => c.name === 'task_create')?.description ?? ''
    expect(description).toContain(MODELE_PROMPT_TACHE_COURT)
    for (const tete of TETES_DU_MODELE_PROMPT_TACHE) expect(description).toContain(tete)
    expect(description.length).toBeLessThan(1000)
  })

  it('crée dans le stockage de l’écran ; la tâche se supprime ensuite', async () => {
    const store = new TaskStore()
    const refresh = vi.fn(async () => {})
    const bus = new AppCommandBus(os as never, () => undefined)
    bus.taskManager = {
      create: (i) => store.create(i),
      list: () => store.listTasks(),
      refresh,
      onChanged: () => undefined
    }

    const result = await bus.exec('task_create', { task: JSON.stringify(tache) })

    expect(result.data).toMatchObject({ ok: true })
    expect(store.listTasks().map((t) => t.title)).toEqual(['Veille du matin'])
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(store.remove(store.listTasks()[0]!.id)).toBe(true)
  })

  /*
   * conv-1069, candidat 3 : « attendre la fin d'un autre fil » sans le sonder. L'entrée qui ferait
   * échouer ce test si la correction était fausse : la même règle SANS fil — elle réveillerait sur
   * chaque tour de chaque fil, y compris celui qu'elle lance elle-même.
   */
  it('crée une règle « fin du tour de conv-N » et refuse la même sans fil nommé', async () => {
    const store = new TaskStore()
    const bus = new AppCommandBus(os as never, () => undefined)
    bus.taskManager = {
      create: (i) => store.create(i),
      list: () => store.listTasks(),
      refresh: async () => {},
      onChanged: () => undefined
    }
    const regle = (source: Record<string, unknown>): string =>
      JSON.stringify({
        title: 'Relire conv-1065',
        prompt: 'Relis la conclusion de conv-1065.',
        enabled: true,
        mode: 'active-only',
        destination: { kind: 'existing', conversationId: 'conv-1069' },
        watchdog: { source, guards: {} }
      })

    const sansFil = await bus.exec('task_create', {
      task: regle({ kind: 'app-event', events: ['chat-turn-done'] })
    })
    expect(sansFil.data).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/conversationId/)
    })
    expect(store.listTasks()).toHaveLength(0)

    const avecFil = await bus.exec('task_create', {
      task: regle({ kind: 'app-event', events: ['chat-turn-done'], conversationId: 'conv-1065' })
    })
    expect(avecFil.data).toMatchObject({ ok: true })
    expect(store.listTasks()[0]?.watchdog?.source).toEqual({
      kind: 'app-event',
      events: ['chat-turn-done'],
      conversationId: 'conv-1065'
    })
    // L'agent le lit au moment de créer : la forme est dans le catalogue, pas à deviner.
    expect(JSON.stringify(bus.catalog().find((c) => c.name === 'task_create'))).toContain(
      'chat-turn-done'
    )
  })

  it('sans Task Manager câblé : refus nommé, rien créé', async () => {
    const bus = new AppCommandBus(os as never, () => undefined)
    const result = await bus.exec('task_create', { task: JSON.stringify(tache) })
    expect(result.data).toEqual({ ok: false, reason: expect.stringMatching(/indisponible/) })
  })
})

/**
 * conv-114, 2026-10-09 : `task_list` était demandée avec `task_create` mais n'avait jamais été
 * écrite — l'appel rendait « Commande inconnue : task_list » après le redémarrage.
 */
describe('task_list — lecture du Task Manager', () => {
  const os = {
    executionWorkspace: process.cwd(),
    conversations: { get: () => undefined, list: () => [] },
    registry: { ids: () => ['claude'] },
    roles: { all: () => ({}), getBinding: () => ({ provider: 'claude' }) },
    runsWithGate: () => [],
    budget: () => ({ spent: 0 })
  }

  it('figure au catalogue en lecture seule', () => {
    const bus = new AppCommandBus(os as never, () => undefined)
    const spec = bus.catalog().find((c) => c.name === 'task_list')
    expect(spec?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true
    })
  })

  it('liste les tâches du stockage de l’écran sans rien modifier', async () => {
    const store = new TaskStore()
    const creee = store.create({
      title: 'Veille du matin',
      prompt: 'Résume les nouveautés.',
      enabled: true,
      mode: 'active-only',
      destination: { kind: 'existing', conversationId: 'conv-1' },
      schedule: {
        startDate: '2099-01-01',
        time: '09:00',
        timeZone: 'Europe/Paris',
        recurrence: { unit: 'day', interval: 1 }
      }
    })
    const avant = JSON.stringify(store.snapshot())
    const refresh = vi.fn(async () => {})
    const onChanged = vi.fn()
    const bus = new AppCommandBus(os as never, () => undefined)
    bus.taskManager = {
      create: (i) => store.create(i),
      list: () => store.listTasks(),
      refresh,
      onChanged
    }

    const result = await bus.exec('task_list', {})

    expect(result.data).toMatchObject({
      ok: true,
      count: 1,
      tasks: [
        {
          id: creee.id,
          title: 'Veille du matin',
          kind: 'horaire',
          enabled: true,
          mode: 'active-only',
          conversationId: 'conv-1',
          nextRunAt: new Date(creee.nextRunAt!).toISOString()
        }
      ]
    })
    expect(JSON.stringify(store.snapshot())).toBe(avant)
    expect(refresh).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('sans Task Manager câblé : refus nommé', async () => {
    const bus = new AppCommandBus(os as never, () => undefined)
    const result = await bus.exec('task_list', {})
    expect(result.data).toEqual({ ok: false, reason: expect.stringMatching(/indisponible/) })
  })
})
