import { describe, expect, it } from 'vitest'
import { TaskStore } from './task-store'
import {
  AUTO_KAIZEN_SEED_ID,
  autoKaizenSeed,
  previousOrchestrationAutoKaizenSeed,
  seedWatchdogTasks
} from './watchdog-seeds'

function store(): TaskStore {
  let counter = 0
  return new TaskStore({ now: () => 1000, id: () => `task-${++counter}` })
}

describe('Auto-kaizen borne', () => {
  it('trie en lecture seule avec le modele Agent Studio courant, sans second pipeline', () => {
    const seed = autoKaizenSeed()
    expect(seed.watchdog?.action).toBe('chat')
    expect(seed.prompt).toContain('LECTURE SEULE')
    expect(seed.prompt).toContain('Ne lance aucune orchestration')
    expect(seed.prompt).not.toMatch(/^\/build\b/)
    expect(seed.destination).toMatchObject({
      provider: 'agent-studio-default'
    })
    expect(seed.destination).not.toHaveProperty('model')
    expect(seed.watchdog?.guards.maxPerRoot).toBe(1)
    expect(seed.watchdog?.guards.maxTriggersPerHour).toBe(1)
    expect(seed.watchdog?.guards.maxTriggersPerDay).toBe(4)
    expect(seed.watchdog?.guards.maxKnownCostUsdPerDay).toBe(0.25)
    expect(seed.watchdog?.guards.maxUnpricedCallsPerDay).toBe(1)
    expect(seed.watchdog?.guards.dedupWindowMs).toBe(1_800_000)
  })

  it('migre le premier triage Haiku intact vers le binding dynamique et les budgets quotidiens', () => {
    const tasks = store()
    const current = autoKaizenSeed()
    if (current.destination.kind !== 'new') throw new Error('destination inattendue')
    const prior = tasks.create({
      ...current,
      prompt: [
        'Auto-kaizen LECTURE SEULE : trie cet incident en un seul diagnostic borne.',
        'Ne lance aucune orchestration. Ne modifie aucun fichier et ne cree aucun worktree.',
        '',
        'Un workflow vient de mal se terminer — soit en echec, soit en annoncant un succes que rien',
        "n'etaye. Etablis ce qui s'est reellement passe avant de conclure.",
        '',
        '1. Lis le RUN cite dans le contexte s’il est accessible et distingue la cause du symptome.',
        '2. Cherche la preuve terminale deja disponible ; ne relance ni test ni workflow couteux.',
        "3. Si le workflow s'est dit REUSSI sans preuve, dis explicitement quelle preuve manque.",
        '4. Si une correction est justifiee, decris la correction bornee et son oracle, sans',
        '   l’appliquer. Sans cause etablie, rapporte seulement ce qui reste a verifier.',
        '5. Termine par le tri ISSUE demande. `repair` est interdit ici puisqu’aucune mutation',
        '   automatique n’est autorisee ; utilise `investigate` ou `report` pour une suite.'
      ].join('\n'),
      destination: {
        ...current.destination,
        provider: 'claude',
        model: 'haiku',
        reasoningEffort: 'low',
        conversationId: 'conv-auto-kaizen-read-only'
      },
      watchdog: {
        ...current.watchdog!,
        guards: {
          dedupWindowMs: 1_800_000,
          maxTriggersPerHour: 1,
          maxChainDepth: 0,
          maxPerRoot: 1
        }
      }
    })
    tasks.markSeeded(AUTO_KAIZEN_SEED_ID)

    seedWatchdogTasks(tasks)

    expect(tasks.getTask(prior.id)?.destination).toMatchObject({
      provider: 'agent-studio-default',
      conversationId: 'conv-auto-kaizen-read-only'
    })
    expect(tasks.getTask(prior.id)?.watchdog?.guards).toMatchObject({
      maxTriggersPerDay: 4,
      maxKnownCostUsdPerDay: 0.25,
      maxUnpricedCallsPerDay: 1
    })
  })

  it('durcit la version bornee precedente sans toucher une regle personnalisee', () => {
    const tasks = store()
    const current = previousOrchestrationAutoKaizenSeed()
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
    expect(tasks.getTask(previous.id)?.watchdog?.action).toBe('chat')
    expect(tasks.getTask(previous.id)?.destination).toMatchObject({
      provider: 'agent-studio-default'
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
    expect(migrated.watchdog?.action).toBe('chat')
    expect(migrated.prompt).not.toMatch(/^\/build\b/)
    expect(migrated.destination).toMatchObject({ provider: 'agent-studio-default' })
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

  it('migre la version build naturelle observée en production vers le triage', () => {
    const tasks = store()
    const previous = previousOrchestrationAutoKaizenSeed()
    if (previous.destination.kind !== 'new') throw new Error('destination de semis inattendue')
    const legacy = tasks.create({
      ...previous,
      prompt: previous.prompt.replace(/^\/build /, 'build '),
      destination: { ...previous.destination, conversationId: 'conv-auto-kaizen-active' }
    })
    tasks.markSeeded(AUTO_KAIZEN_SEED_ID)

    seedWatchdogTasks(tasks)

    const migrated = tasks.getTask(legacy.id)!
    expect(migrated.watchdog?.action).toBe('chat')
    expect(migrated.prompt).not.toMatch(/^\/build\b/)
    expect(migrated.destination).toMatchObject({ conversationId: 'conv-auto-kaizen-active' })
  })

  it('migre la version orchestration mesuree en production vers le binding Agent Studio', () => {
    const tasks = store()
    const previous = previousOrchestrationAutoKaizenSeed()
    if (previous.destination.kind !== 'new') throw new Error('destination inattendue')
    const live = tasks.create({
      ...previous,
      destination: { ...previous.destination, conversationId: 'conv-auto-kaizen-live' }
    })
    tasks.markSeeded(AUTO_KAIZEN_SEED_ID)

    seedWatchdogTasks(tasks)

    expect(tasks.getTask(live.id)).toMatchObject({
      watchdog: { action: 'chat' },
      destination: {
        conversationId: 'conv-auto-kaizen-live',
        provider: 'agent-studio-default'
      }
    })
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

  it.each([
    ['provider', { provider: 'codex' }],
    ['categorie', { category: 'Mes diagnostics' }],
    ['modele', { model: 'opus' }],
    ['effort', { reasoningEffort: 'high' as const }]
  ])('ne migre pas une destination personnalisee (%s)', (_label, destinationPatch) => {
    const tasks = store()
    const previous = previousOrchestrationAutoKaizenSeed()
    if (previous.destination.kind !== 'new') throw new Error('destination inattendue')
    const edited = tasks.create({
      ...previous,
      destination: {
        ...previous.destination,
        ...destinationPatch,
        conversationId: 'conv-personnalisee'
      }
    })
    tasks.markSeeded(AUTO_KAIZEN_SEED_ID)

    seedWatchdogTasks(tasks)

    expect(tasks.getTask(edited.id)).toEqual(edited)
  })

  it('ne migre pas une garde personnalisee', () => {
    const tasks = store()
    const previous = previousOrchestrationAutoKaizenSeed()
    const edited = tasks.create({
      ...previous,
      watchdog: {
        ...previous.watchdog!,
        guards: { ...previous.watchdog!.guards, maxTriggersPerHour: 9 }
      }
    })
    tasks.markSeeded(AUTO_KAIZEN_SEED_ID)

    seedWatchdogTasks(tasks)

    expect(tasks.getTask(edited.id)).toEqual(edited)
  })

  it('ne migre pas un budget quotidien personnalise sur une ancienne version', () => {
    const tasks = store()
    const previous = previousOrchestrationAutoKaizenSeed()
    const edited = tasks.create({
      ...previous,
      watchdog: {
        ...previous.watchdog!,
        guards: {
          ...previous.watchdog!.guards,
          maxKnownCostUsdPerDay: 9.99
        }
      }
    })
    tasks.markSeeded(AUTO_KAIZEN_SEED_ID)

    seedWatchdogTasks(tasks)

    expect(tasks.getTask(edited.id)).toEqual(edited)
  })
})
