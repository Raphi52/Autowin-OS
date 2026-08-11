// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaskManagerView } from './TaskManagerView'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []

afterEach(async () => {
  for (const item of mounted.splice(0)) {
    await act(async () => item.root.unmount())
    item.container.remove()
  }
})

function snapshotFixture() {
  return {
    tasks: [
      {
        id: 'task-1',
        title: 'Rapport du matin',
        prompt: 'Prépare le rapport.',
        enabled: true,
        mode: 'active-only',
        destination: {
          kind: 'existing',
          conversationId: 'conv-1',
          provider: 'ollama',
          model: 'qwen'
        },
        schedule: {
          startDate: '2026-08-03',
          time: '09:30',
          timeZone: 'Europe/Paris',
          recurrence: { unit: 'day', interval: 1 }
        },
        nextRunAt: 10,
        createdAt: 1,
        updatedAt: 1
      },
      {
        id: 'task-2',
        title: 'Veille du soir',
        prompt: 'Résume la veille.',
        enabled: true,
        mode: 'active-only',
        destination: {
          kind: 'existing',
          conversationId: 'conv-1',
          provider: 'ollama',
          model: 'qwen'
        },
        schedule: {
          startDate: '2026-08-03',
          time: '20:30',
          timeZone: 'Europe/Paris',
          recurrence: { unit: 'day', interval: 1 }
        },
        nextRunAt: 20,
        createdAt: 1,
        updatedAt: 1
      }
    ],
    occurrences: [
      {
        id: 'task-1@1',
        taskId: 'task-1',
        scheduledFor: 1,
        status: 'failed',
        mode: 'active-only',
        startedAt: 1,
        finishedAt: 2,
        error: 'Le modèle a refusé le prompt.'
      }
    ],
    alerts: [
      {
        id: 'alert-2',
        taskId: 'task-2',
        occurrenceId: 'task-2@1',
        kind: 'failed',
        message: 'La veille du soir a échoué.',
        createdAt: 5
      }
    ],
    scheduler: { running: true, nextWakeAt: 10, relayAvailable: true }
  }
}

function api() {
  return {
    taskManagerSnapshot: vi.fn().mockResolvedValue(snapshotFixture()),
    conversations: vi
      .fn()
      .mockResolvedValue([
        { id: 'conv-1', title: 'Projet RIG', category: 'codex', provider: 'codex' }
      ]),
    models: vi.fn().mockResolvedValue([
      {
        id: 'ollama:qwen',
        provider: 'ollama',
        model: 'qwen',
        reasoningEfforts: ['none'],
        defaultReasoningEffort: 'none'
      }
    ]),
    taskManagerCreate: vi.fn().mockResolvedValue({ id: 'task-3' }),
    taskManagerUpdate: vi.fn().mockResolvedValue({ id: 'task-1' }),
    taskManagerRemove: vi.fn().mockResolvedValue(true),
    taskManagerAcknowledge: vi.fn().mockResolvedValue(true),
    taskManagerRunNow: vi.fn().mockResolvedValue({ started: true }),
    onAppEvent: vi.fn(
      (_listener: (event: { type: string; scope?: string }) => void) => () => undefined
    )
  }
}

async function mount(mockApi = api()) {
  Object.defineProperty(window, 'api', { configurable: true, value: mockApi })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  await act(async () => root.render(createElement(TaskManagerView, { active: true })))
  return { container, mockApi }
}

function buttons(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')]
}

function byText(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return buttons(container).find((button) => button.textContent?.trim() === text)
}

describe('Task Manager — rafraîchissement ciblé', () => {
  it('n’efface pas le catalogue modèles après un acquittement', async () => {
    const { container, mockApi } = await mount()
    expect(mockApi.models).toHaveBeenCalledTimes(1)

    const acknowledge = byText(container, 'Acquitter')
    expect(acknowledge).toBeDefined()
    await act(async () => acknowledge!.click())

    expect(mockApi.taskManagerAcknowledge).toHaveBeenCalledWith('alert-2')
    expect(mockApi.models).toHaveBeenCalledTimes(1)
    expect(mockApi.taskManagerSnapshot).toHaveBeenCalledTimes(2)
  })

  it('ne recharge que le snapshot après un lancement manuel', async () => {
    const { container, mockApi } = await mount()
    const run = byText(container, 'Lancer maintenant')
    await act(async () => run!.click())

    expect(mockApi.taskManagerRunNow).toHaveBeenCalledWith('task-1')
    expect(mockApi.models).toHaveBeenCalledTimes(1)
    expect(mockApi.conversations).toHaveBeenCalledTimes(1)
    expect(mockApi.taskManagerSnapshot).toHaveBeenCalledTimes(2)
  })
})

describe('Task Manager — boucle de correction après échec', () => {
  it('rejoue une occurrence échouée avec l’IPC run-now existant', async () => {
    const { container, mockApi } = await mount()
    const replay = container.querySelector<HTMLButtonElement>(
      '[data-testid="task-manager-occurrence-replay"]'
    )
    expect(replay).not.toBeNull()

    await act(async () => replay!.click())
    expect(mockApi.taskManagerRunNow).toHaveBeenCalledWith('task-1')
  })

  it('ouvre l’éditeur pré-rempli avec le prompt et montre l’erreur de l’occurrence', async () => {
    const { container } = await mount()
    const fix = container.querySelector<HTMLButtonElement>(
      '[data-testid="task-manager-occurrence-replay-fixed"]'
    )
    expect(fix).not.toBeNull()

    await act(async () => fix!.click())

    const prompt = container.querySelector<HTMLTextAreaElement>('textarea[name="prompt"]')
    expect(prompt?.value).toBe('Prépare le rapport.')
    expect(container.textContent).toContain('Le modèle a refusé le prompt.')
  })
})

describe('Task Manager — cohérence des alertes', () => {
  it('rend atteignable une alerte ouverte portée par une tâche non sélectionnée', async () => {
    const { container } = await mount()
    const alerts = container.querySelector('.task-manager-alerts') as HTMLElement

    expect(alerts.textContent).toContain('La veille du soir a échoué.')
    expect(alerts.textContent).toContain('Veille du soir')

    const focus = alerts.querySelector<HTMLButtonElement>(
      '[data-testid="task-manager-alert-select"]'
    )
    expect(focus).not.toBeNull()
    await act(async () => focus!.click())

    expect(container.querySelector('.task-manager-detail-head h2')?.textContent).toBe(
      'Veille du soir'
    )
  })
})

describe('Task Manager — validation du brouillon planifié', () => {
  it('refuse un départ déjà passé sans répétition et affiche le message français', async () => {
    const { container, mockApi } = await mount()
    await act(async () => byText(container, 'Modifier')!.click())

    const recurrence = [...container.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('Répétition'))
      ?.querySelector('select') as HTMLSelectElement
    await act(async () => {
      recurrence.value = 'none'
      recurrence.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const startDate = [...container.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('Date de départ'))
      ?.querySelector('input') as HTMLInputElement
    await act(async () => {
      startDate.value = '2020-01-01'
      startDate.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const submit = buttons(container).find((button) =>
      button.textContent?.includes('Enregistrer')
    ) as HTMLButtonElement
    await act(async () => submit.click())

    expect(mockApi.taskManagerUpdate).not.toHaveBeenCalled()
    expect(container.textContent).toContain('déjà passées')
  })
})
