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
    expect(target.runPrompt).toHaveBeenNthCalledWith(1, 'conv-new', 'Prépare le rapport.')
    expect(target.runPrompt).toHaveBeenNthCalledWith(2, 'conv-new', 'Prépare le rapport.')
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
