import { describe, expect, it, vi } from 'vitest'
import { ScheduledChatDispatcher, type ScheduledChatRuntime } from './chat-dispatch'
import type { ScheduledTask, TaskOccurrence } from './types'

function task(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'task-1',
    title: 'Rapport',
    prompt: 'Prépare le rapport.',
    enabled: true,
    mode: 'active-only',
    destination: { kind: 'existing', conversationId: 'conv-1' },
    schedule: {
      startDate: '2026-08-03',
      time: '09:30',
      timeZone: 'Europe/Paris',
      recurrence: { unit: 'day', interval: 1 }
    },
    nextRunAt: 1785742200000,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

const occurrence: TaskOccurrence = {
  id: 'task-1@1785742200000',
  taskId: 'task-1',
  scheduledFor: 1785742200000,
  mode: 'active-only',
  status: 'claimed',
  claimedAt: 1
}

function runtime(overrides: Partial<ScheduledChatRuntime> = {}): ScheduledChatRuntime {
  return {
    hasConversation: vi.fn(() => true),
    createConversation: vi.fn(() => ({ id: 'conv-new' })),
    bindConversation: vi.fn(),
    isConversationBusy: vi.fn(() => false),
    interruptAndWait: vi.fn(async () => false),
    runPrompt: vi.fn(async () => ({ ok: true, turnId: 'turn-1' })),
    ...overrides
  }
}

describe('Task Manager — dispatch par le vrai Chat', () => {
  it('envoie le prompt dans la conversation existante par le chemin Chat normal', async () => {
    const target = runtime()
    const dispatcher = new ScheduledChatDispatcher(target)

    const result = await dispatcher.run(task(), occurrence)

    expect(target.runPrompt).toHaveBeenCalledWith('conv-1', 'Prépare le rapport.')
    expect(result).toEqual({
      status: 'completed',
      conversationId: 'conv-1',
      turnId: 'turn-1'
    })
  })

  it('applique le modèle choisi à une conversation existante', async () => {
    const target = runtime()
    const dispatcher = new ScheduledChatDispatcher(target)

    await dispatcher.run(
      task({
        destination: {
          kind: 'existing',
          conversationId: 'conv-1',
          provider: 'claude',
          model: 'claude-sonnet',
          reasoningEffort: 'high'
        }
      }),
      occurrence
    )

    expect(target.runPrompt).toHaveBeenCalledWith('conv-1', 'Prépare le rapport.', {
      provider: 'claude',
      model: 'claude-sonnet',
      reasoningEffort: 'high'
    })
  })

  it('interrompt immédiatement un tour occupé puis crée un nouveau tour visible', async () => {
    const target = runtime({
      isConversationBusy: vi.fn(() => true),
      interruptAndWait: vi.fn(async () => true)
    })
    const dispatcher = new ScheduledChatDispatcher(target)

    await dispatcher.run(task(), occurrence)

    expect(target.interruptAndWait).toHaveBeenCalledWith('conv-1', 'scheduled-task')
    expect(target.runPrompt).toHaveBeenCalledTimes(1)
    expect(
      (target.interruptAndWait as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
    ).toBeLessThan((target.runPrompt as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0])
  })

  it('crée une conversation dédiée une fois puis la réutilise', async () => {
    const target = runtime()
    const dispatcher = new ScheduledChatDispatcher(target)
    const dedicated = task({
      destination: {
        kind: 'new',
        title: 'Rapport planifié',
        category: 'codex',
        provider: 'codex',
        model: 'gpt-5.6-sol',
        authorityMode: 'auto'
      }
    })

    const first = await dispatcher.run(dedicated, occurrence)
    const rebound = task({
      destination: {
        kind: 'new',
        title: 'Rapport planifié',
        category: 'codex',
        provider: 'codex',
        model: 'gpt-5.6-sol',
        authorityMode: 'auto',
        conversationId: 'conv-new'
      }
    })
    const second = await dispatcher.run(rebound, {
      ...occurrence,
      id: 'task-1@1785828600000',
      scheduledFor: 1785828600000
    })

    expect(target.createConversation).toHaveBeenCalledTimes(1)
    expect(target.bindConversation).toHaveBeenCalledWith('task-1', 'conv-new')
    expect(target.runPrompt).toHaveBeenNthCalledWith(1, 'conv-new', 'Prépare le rapport.', {
      provider: 'codex',
      model: 'gpt-5.6-sol'
    })
    expect(target.runPrompt).toHaveBeenNthCalledWith(2, 'conv-new', 'Prépare le rapport.', {
      provider: 'codex',
      model: 'gpt-5.6-sol'
    })
    expect(first.conversationId).toBe('conv-new')
    expect(second.conversationId).toBe('conv-new')
  })

  it('échoue visiblement si la conversation cible a disparu', async () => {
    const dispatcher = new ScheduledChatDispatcher(runtime({ hasConversation: vi.fn(() => false) }))

    await expect(dispatcher.run(task(), occurrence)).resolves.toEqual({
      status: 'failed',
      error: 'Conversation cible introuvable: conv-1'
    })
  })
})

describe('Task Manager — dispatch d’un réveil événementiel', () => {
  const watchdogOccurrence: TaskOccurrence = {
    id: 'task-1@watchdog-1785742200000-abc',
    taskId: 'task-1',
    scheduledFor: 1785742200000,
    mode: 'active-only',
    status: 'claimed',
    claimedAt: 1,
    trigger: 'watchdog',
    watchdog: {
      signature: 'error connexion perdue',
      rootSignature: 'error connexion perdue',
      context:
        'Source : fichier surveillé C:/logs/app.log\nLigne déclenchante : ERROR connexion perdue',
      depth: 0,
      source: 'file-match',
      observedAt: 1785742200000
    }
  }

  it('remet le CONTEXTE de l’événement à l’agent, en plus du prompt de la tâche', async () => {
    // Sans le contexte, l’agent est réveillé par « il s’est passé quelque chose » et devine.
    const chat = runtime()
    await new ScheduledChatDispatcher(chat).run(task(), watchdogOccurrence)

    const sentPrompt = vi.mocked(chat.runPrompt).mock.calls[0][1]
    expect(sentPrompt).toContain('Prépare le rapport.')
    expect(sentPrompt).toContain('ERROR connexion perdue')
    expect(sentPrompt).toContain('C:/logs/app.log')
    expect(sentPrompt).toContain('ISSUE: benign | report | investigate | repair')
  })

  it('une tâche HORAIRE garde exactement son prompt — le chemin planifié est intact', async () => {
    const chat = runtime()
    await new ScheduledChatDispatcher(chat).run(task(), occurrence)

    expect(vi.mocked(chat.runPrompt).mock.calls[0][1]).toBe('Prépare le rapport.')
  })

  it('DoD : le tri rendu par l’agent redescend dans le résultat', async () => {
    const chat = runtime({
      runPrompt: vi.fn(async () => ({
        ok: true,
        turnId: 'turn-1',
        text: 'Rien de grave, le service a repris seul.\n\nISSUE: benign'
      }))
    })

    const result = await new ScheduledChatDispatcher(chat).run(task(), watchdogOccurrence)

    expect(result.outcome).toBe('benign')
  })

  it('ne propage jamais les mutations revendiquees par un tour rouge ou annule', async () => {
    const claims = {
      'C:/logs/app.log': ['fingerprint-fantome']
    }
    const failed = runtime({
      runPrompt: vi.fn(async () => ({
        ok: false,
        turnId: 'failed-turn',
        mutatedPaths: ['C:/logs/app.log'],
        mutatedLineFingerprints: claims
      }))
    })
    const cancelled = runtime({
      runPrompt: vi.fn(async () => ({
        ok: false,
        cancelled: true,
        turnId: 'cancelled-turn',
        mutatedPaths: ['C:/logs/app.log'],
        mutatedLineFingerprints: claims
      }))
    })

    const failedResult = await new ScheduledChatDispatcher(failed).run(task(), watchdogOccurrence)
    const cancelledResult = await new ScheduledChatDispatcher(cancelled).run(
      task(),
      watchdogOccurrence
    )

    expect(failedResult).not.toHaveProperty('mutatedLineFingerprints')
    expect(cancelledResult).not.toHaveProperty('mutatedLineFingerprints')
  })

  it('n’INVENTE pas de tri quand l’agent n’a pas conclu', async () => {
    const chat = runtime({
      runPrompt: vi.fn(async () => ({ ok: true, turnId: 'turn-1', text: 'J’ai regardé.' }))
    })

    const result = await new ScheduledChatDispatcher(chat).run(task(), watchdogOccurrence)

    expect(result.outcome).toBeUndefined()
  })

  it('ne pose aucun tri sur une occurrence horaire, même si le texte en contient un', async () => {
    const chat = runtime({
      runPrompt: vi.fn(async () => ({ ok: true, turnId: 'turn-1', text: 'ISSUE: repair' }))
    })

    const result = await new ScheduledChatDispatcher(chat).run(task(), occurrence)

    expect(result).not.toHaveProperty('outcome')
  })
})

describe('Task Manager — une règle qui ORCHESTRE au lieu de discuter', () => {
  const orchestrating = (): ScheduledTask =>
    task({
      schedule: undefined,
      watchdog: {
        source: { kind: 'app-event', events: ['orchestration-red'] },
        guards: { dedupWindowMs: 0, maxTriggersPerHour: 10, maxChainDepth: 0, maxPerRoot: 20 },
        action: 'orchestration'
      }
    })

  const watchdogOccurrence: TaskOccurrence = {
    id: 'task-1@watchdog-1',
    taskId: 'task-1',
    scheduledFor: 1785742200000,
    mode: 'active-only',
    status: 'claimed',
    claimedAt: 1,
    trigger: 'watchdog',
    watchdog: {
      signature: 'orchestration-red',
      rootSignature: 'orchestration-red',
      context: 'Une orchestration s’est terminée en ROUGE.',
      depth: 0,
      source: 'app-event',
      observedAt: 1785742200000
    }
  }

  it('passe par le PIPELINE, pas par un simple tour de conversation', () => {
    const chat = runtime({ runOrchestration: vi.fn(async () => ({ ok: true, turnId: 't' })) })

    return new ScheduledChatDispatcher(chat).run(orchestrating(), watchdogOccurrence).then(() => {
      expect(chat.runOrchestration).toHaveBeenCalledOnce()
      expect(chat.runPrompt).not.toHaveBeenCalled()
      // Le contexte de l'événement part AUSSI dans l'orchestration.
      expect(vi.mocked(chat.runOrchestration!).mock.calls[0][1]).toContain('ROUGE')
    })
  })

  it('lit le tri rendu par le pipeline comme celui d’un chat', async () => {
    const chat = runtime({
      runOrchestration: vi.fn(async () => ({ ok: true, turnId: 't', text: 'ISSUE: repair' }))
    })

    const result = await new ScheduledChatDispatcher(chat).run(orchestrating(), watchdogOccurrence)

    expect(result.outcome).toBe('repair')
  })

  it('retombe sur le chat si le runtime ne sait pas orchestrer, au lieu d’échouer', async () => {
    // Dégradé ANNONCÉ : mieux vaut un tour de conversation qu'un réveil mort.
    const chat = runtime()

    const result = await new ScheduledChatDispatcher(chat).run(orchestrating(), watchdogOccurrence)

    expect(result.status).toBe('completed')
    expect(chat.runPrompt).toHaveBeenCalledOnce()
  })

  it('une règle en action chat n’orchestre JAMAIS', async () => {
    const chat = runtime({ runOrchestration: vi.fn(async () => ({ ok: true })) })
    const chatRule = orchestrating()
    chatRule.watchdog!.action = 'chat'

    await new ScheduledChatDispatcher(chat).run(chatRule, watchdogOccurrence)

    expect(chat.runOrchestration).not.toHaveBeenCalled()
    expect(chat.runPrompt).toHaveBeenCalledOnce()
  })

  it('propage le canal causal tardif au runtime orchestration', async () => {
    const chat = runtime({ runOrchestration: vi.fn(async () => ({ ok: true, turnId: 't' })) })
    const onLateMutationClaims = vi.fn()

    await new ScheduledChatDispatcher(chat).run(
      orchestrating(),
      watchdogOccurrence,
      onLateMutationClaims
    )

    expect(vi.mocked(chat.runOrchestration!).mock.calls[0][3]).toBe(onLateMutationClaims)
  })
})
