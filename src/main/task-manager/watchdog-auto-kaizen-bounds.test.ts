import { describe, expect, it } from 'vitest'
import { routeSkillRequest } from '../skill-routing'
import { TaskStore } from './task-store'
import { AUTO_KAIZEN_SEED_ID, autoKaizenSeed, seedWatchdogTasks } from './watchdog-seeds'

function store(): TaskStore {
  let counter = 0
  return new TaskStore({ now: () => 1000, id: () => `task-${++counter}` })
}

describe('Auto-kaizen borne', () => {
  it('ne reserve que le build et une seule occurrence par cause', () => {
    const seed = autoKaizenSeed()
    // Le moteur d'orchestration ne neutralise un workflow compose que pour une COMMANDE de skill
    // (`/build`), pas pour le mot naturel « build ». Le dogfood Tickets a prouve qu'un simple
    // prefixe verbal repartait en scout quand la conversation Auto-kaizen gardait son workflow.
    expect(routeSkillRequest(seed.prompt)?.explicitPhase).toBe('build')
    expect(seed.watchdog?.guards.maxPerRoot).toBe(1)
    expect(seed.watchdog?.guards.maxTriggersPerHour).toBe(1)
    expect(seed.watchdog?.guards.dedupWindowMs).toBe(1_800_000)
  })

  it('durcit la version bornee precedente sans toucher une regle personnalisee', () => {
    const tasks = store()
    const current = autoKaizenSeed()
    const previous = tasks.create({
      ...current,
      watchdog: {
        ...current.watchdog!,
        guards: {
          dedupWindowMs: 300_000,
          maxTriggersPerHour: 2,
          maxChainDepth: 0,
          maxPerRoot: 1
        }
      }
    })
    tasks.markSeeded(AUTO_KAIZEN_SEED_ID)

    seedWatchdogTasks(tasks)

    expect(tasks.getTask(previous.id)?.watchdog?.guards).toMatchObject({
      dedupWindowMs: 1_800_000,
      maxTriggersPerHour: 1,
      maxChainDepth: 0,
      maxPerRoot: 1
    })
  })

  it('migre le semis historique intact sans perdre sa conversation dediee', () => {
    const tasks = store()
    const legacy = tasks.create({
      title: 'Auto-kaizen — une orchestration rouge',
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
      enabled: true,
      mode: 'active-only',
      destination: {
        kind: 'new',
        title: 'Auto-kaizen',
        category: 'Qualite',
        provider: 'claude',
        conversationId: 'conv-auto-kaizen'
      },
      watchdog: {
        source: { kind: 'app-event', events: ['orchestration-red'] },
        action: 'orchestration',
        guards: { dedupWindowMs: 300_000, maxTriggersPerHour: 4, maxChainDepth: 0, maxPerRoot: 3 }
      }
    })
    tasks.markSeeded(AUTO_KAIZEN_SEED_ID)

    expect(seedWatchdogTasks(tasks)).toEqual([])

    const migrated = tasks.getTask(legacy.id)!
    expect(migrated.destination).toMatchObject({ conversationId: 'conv-auto-kaizen' })
    expect(routeSkillRequest(migrated.prompt)?.explicitPhase).toBe('build')
    expect(migrated.watchdog?.guards.maxPerRoot).toBe(1)
    expect(migrated.watchdog?.source).toMatchObject({
      events: [
        'orchestration-red',
        'workflow-gate-failed',
        'workflow-unverified',
        'workflow-proof-lost'
      ]
    })
  })

  it('migre la version build naturelle observée en production vers la commande /build', () => {
    const tasks = store()
    const previous = autoKaizenSeed()
    if (previous.destination.kind !== 'new') throw new Error('destination de semis inattendue')
    const legacy = tasks.create({
      ...previous,
      prompt: previous.prompt.replace(/^\/build /, 'build '),
      destination: { ...previous.destination, conversationId: 'conv-auto-kaizen-active' }
    })
    tasks.markSeeded(AUTO_KAIZEN_SEED_ID)

    seedWatchdogTasks(tasks)

    const migrated = tasks.getTask(legacy.id)!
    expect(routeSkillRequest(migrated.prompt)?.explicitPhase).toBe('build')
    expect(migrated.destination).toMatchObject({ conversationId: 'conv-auto-kaizen-active' })
  })

  it('ne remplace jamais une variante historique editee par l utilisateur', () => {
    const tasks = store()
    const editedPrompt =
      "Une orchestration vient d'echouer. Etablis ce qui s'est reellement passe avant de conclure.\n\nConsigne personnelle : ne touche jamais au depot."
    const edited = tasks.create({
      title: 'Auto-kaizen — une orchestration rouge',
      prompt: editedPrompt,
      enabled: true,
      mode: 'active-only',
      destination: {
        kind: 'new',
        title: 'Auto-kaizen',
        category: 'Qualite',
        provider: 'claude',
        conversationId: 'conv-personnalisee'
      },
      watchdog: {
        source: { kind: 'app-event', events: ['orchestration-red'] },
        action: 'orchestration',
        guards: { dedupWindowMs: 300_000, maxTriggersPerHour: 4, maxChainDepth: 0, maxPerRoot: 3 }
      }
    })
    tasks.markSeeded(AUTO_KAIZEN_SEED_ID)

    seedWatchdogTasks(tasks)

    expect(tasks.getTask(edited.id)?.prompt).toBe(editedPrompt)
    expect(tasks.getTask(edited.id)?.watchdog?.guards.maxPerRoot).toBe(3)
  })
})
