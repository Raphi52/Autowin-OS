import { describe, expect, it } from 'vitest'
import { TaskStore } from './task-store'
import { autoKaizenSeed, seedWatchdogTasks } from './watchdog-seeds'

function store(): TaskStore {
  let counter = 0
  return new TaskStore({ now: () => 1000, id: () => `task-${++counter}` })
}

describe('seedWatchdogTasks — l’auto-kaizen a été retiré du produit', () => {
  it('ne pose plus AUCUNE règle au premier démarrage', () => {
    const tasks = store()

    expect(seedWatchdogTasks(tasks)).toEqual([])
    expect(tasks.listTasks()).toEqual([])
  })

  it('efface la règle Auto-kaizen déjà posée et restée intacte', () => {
    const tasks = store()
    const posee = tasks.create(autoKaizenSeed())

    seedWatchdogTasks(tasks)

    expect(tasks.getTask(posee.id)).toBeUndefined()
    expect(tasks.listTasks()).toEqual([])
  })

  it('efface aussi une variante historique intacte', () => {
    const tasks = store()
    const historique = tasks.create({
      ...autoKaizenSeed(),
      prompt: [
        "Une orchestration vient d'echouer. Etablis ce qui s'est reellement passe avant de conclure.",
        '',
        '1. Lis le RUN.md cite dans le contexte : son besoin, ses decisions, son journal.',
        '2. Cherche la cause RACINE, pas le symptome le plus visible. Un echec en fin de chaine vient',
        "   souvent d'une decision prise bien plus tot.",
        '3. Si la cause est claire ET la correction bornee, corrige-la et prouve-le par un signal',
        '   hors-modele (test rouge->vert, code de sortie, requete). Sans preuve, ne dis pas que',
        "   c'est repare.",
        "4. Si la cause n'est pas etablie, ne repare rien : rapporte ce que tu as ecarte et ce qui",
        '   reste a verifier. Une reparation sur une cause supposee cree le defaut suivant.'
      ].join('\n'),
      title: 'Auto-kaizen — une orchestration rouge',
      destination: { kind: 'new', title: 'Auto-kaizen', category: 'Qualite', provider: 'claude' },
      watchdog: {
        source: { kind: 'app-event', events: ['orchestration-red'] },
        action: 'orchestration',
        guards: {
          dedupWindowMs: 300_000,
          maxTriggersPerHour: 4,
          maxChainDepth: 0,
          maxPerRoot: 3
        }
      }
    })

    seedWatchdogTasks(tasks)

    expect(tasks.getTask(historique.id)).toBeUndefined()
  })

  it('NE supprime PAS une règle que l’utilisateur a éditée', () => {
    const tasks = store()
    const mienne = tasks.create({ ...autoKaizenSeed(), title: 'Mon auto-kaizen à moi' })

    seedWatchdogTasks(tasks)

    expect(tasks.getTask(mienne.id)?.title).toBe('Mon auto-kaizen à moi')
  })

  it('ne touche pas une règle sans rapport', () => {
    const tasks = store()
    const autre = tasks.create({
      title: 'Ma veille',
      prompt: 'Regarde les tickets',
      enabled: true,
      mode: 'active-only',
      destination: { kind: 'new', title: 'Veille', category: 'Qualite', provider: 'claude' },
      watchdog: {
        source: { kind: 'app-event', events: ['orchestration-red'] },
        action: 'chat',
        guards: { dedupWindowMs: 1000, maxTriggersPerHour: 1, maxChainDepth: 0, maxPerRoot: 1 }
      }
    })

    seedWatchdogTasks(tasks)

    expect(tasks.getTask(autre.id)?.title).toBe('Ma veille')
  })
})
