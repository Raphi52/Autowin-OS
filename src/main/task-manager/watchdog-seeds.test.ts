import { describe, expect, it } from 'vitest'
import { TaskStore } from './task-store'
import { AUTO_KAIZEN_SEED_ID, autoKaizenSeed, seedWatchdogTasks } from './watchdog-seeds'

function store(): TaskStore {
  let counter = 0
  return new TaskStore({ now: () => 1000, id: () => `task-${++counter}` })
}

describe('seedWatchdogTasks — l’auto-kaizen comme VRAIE tâche', () => {
  it('crée une tâche visible dans le Task Manager, pas un module invisible', () => {
    const tasks = store()

    seedWatchdogTasks(tasks)

    const seeded = tasks.listTasks()
    expect(seeded).toHaveLength(1)
    expect(seeded[0].title).toContain('Auto-kaizen')
    expect(seeded[0].watchdog?.source).toMatchObject({ kind: 'app-event' })
  })

  it('elle passe par le PIPELINE : c’est ce qui remplace l’analyse/correctif/vérification maison', () => {
    const tasks = store()
    seedWatchdogTasks(tasks)

    expect(tasks.listTasks()[0].watchdog?.action).toBe('orchestration')
  })

  it('elle est ÉDITABLE comme n’importe quelle tâche', () => {
    const tasks = store()
    const [id] = seedWatchdogTasks(tasks)

    const edited = tasks.update(id, {
      title: 'Mon auto-kaizen à moi',
      watchdog: {
        source: { kind: 'app-event', events: ['task-failed'] },
        action: 'chat',
        guards: { dedupWindowMs: 0, maxTriggersPerHour: 9, maxChainDepth: 1, maxPerRoot: 7 }
      }
    })

    expect(edited.title).toBe('Mon auto-kaizen à moi')
    expect(edited.watchdog?.guards.maxTriggersPerHour).toBe(9)
    expect(edited.watchdog?.action).toBe('chat')
  })

  it('SUPPRIMÉE, elle ne renaît PAS au redémarrage', () => {
    // Sinon ce ne serait plus la tâche de l'utilisateur mais une tâche imposée.
    const first = store()
    const [id] = seedWatchdogTasks(first)
    first.remove(id)
    const persisted = first.snapshot()

    const afterRestart = store()
    afterRestart.hydrate(persisted)
    const createdAgain = seedWatchdogTasks(afterRestart)

    expect(createdAgain).toEqual([])
    expect(afterRestart.listTasks()).toEqual([])
  })

  it('ne se dédouble pas au redémarrage quand elle est toujours là', () => {
    const first = store()
    seedWatchdogTasks(first)
    const persisted = first.snapshot()

    const afterRestart = store()
    afterRestart.hydrate(persisted)
    seedWatchdogTasks(afterRestart)

    expect(afterRestart.listTasks()).toHaveLength(1)
  })

  it('le semis est mémorisé dans l’instantané persisté', () => {
    const tasks = store()
    seedWatchdogTasks(tasks)

    expect(tasks.snapshot().seeds).toContain(AUTO_KAIZEN_SEED_ID)
  })

  it('crée la règle sans mode d’autorité', () => {
    const seed = autoKaizenSeed()

    expect(seed.destination).not.toHaveProperty('authorityMode')
  })

  it('surveille les problèmes de WORKFLOW, pas seulement les orchestrations rouges', () => {
    // « un workflow qui se dit réussi sans preuve » ne casse rien et ne lève aucune alerte : sans
    // cette règle, personne ne le relit jamais. Un rouge se voit, un faux vert non.
    const source = autoKaizenSeed().watchdog!.source

    expect(source.kind).toBe('app-event')
    expect(source.kind === 'app-event' && source.events).toEqual([
      'orchestration-red',
      'workflow-gate-failed',
      'workflow-unverified',
      'workflow-proof-lost'
    ])
  })

  it('son prompt distingue « qu’est-ce qui a cassé » de « est-ce réellement fait »', () => {
    expect(autoKaizenSeed().prompt).toContain('est-ce reellement fait')
    expect(autoKaizenSeed().prompt).toContain('faux vert')
  })

  it('un kaizen ne peut pas en déclencher un autre', () => {
    expect(autoKaizenSeed().watchdog?.guards.maxChainDepth).toBe(0)
  })

  it('borne la largeur : une panne unique ne lance pas un agent par orchestration cassée', () => {
    expect(autoKaizenSeed().watchdog?.guards.maxPerRoot).toBe(3)
  })

  it('son prompt REFUSE de réparer sur une cause supposée', () => {
    // Le défaut que l'auto-kaizen historique pouvait produire : réparer un symptôme sans preuve.
    const prompt = autoKaizenSeed().prompt

    expect(prompt).toContain('cause RACINE')
    expect(prompt).toContain('hors-modele')
    expect(prompt).toContain('ne repare rien')
  })
})
