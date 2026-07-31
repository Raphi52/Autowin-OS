// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaskManagerView } from './TaskManagerView'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

afterEach(async () => {
  for (const item of mounted.splice(0)) {
    await act(async () => item.root.unmount())
    item.container.remove()
  }
})

function api() {
  return {
    taskManagerSnapshot: vi.fn().mockResolvedValue({
      schemaVersion: 1,
      tasks: [
        {
          id: 'task-1',
          title: 'Rapport du matin',
          prompt: 'Prépare le rapport.',
          enabled: true,
          mode: 'windows',
          destination: { kind: 'existing', conversationId: 'conv-1' },
          schedule: {
            startDate: '2026-08-03',
            time: '09:30',
            timeZone: 'Europe/Paris',
            recurrence: { unit: 'day', interval: 1 }
          },
          nextRunAt: Date.parse('2026-08-03T07:30:00.000Z'),
          createdAt: 1,
          updatedAt: 1
        }
      ],
      occurrences: [
        {
          id: 'task-1@1',
          taskId: 'task-1',
          scheduledFor: 1,
          status: 'missed',
          mode: 'active-only',
          claimedAt: 1,
          finishedAt: 1,
          error: 'Autowin était arrêté.'
        },
        {
          id: 'task-1@0',
          taskId: 'task-1',
          scheduledFor: 0,
          status: 'completed',
          mode: 'legacy-unknown',
          claimedAt: 0,
          finishedAt: 0
        }
      ],
      alerts: [
        {
          id: 'alert-1',
          taskId: 'task-1',
          occurrenceId: 'task-1@1',
          kind: 'missed',
          message: 'Autowin était arrêté.',
          createdAt: 1
        }
      ],
      scheduler: {
        running: true,
        nextWakeAt: Date.parse('2026-08-03T07:30:00.000Z'),
        relayAvailable: true
      }
    }),
    conversations: vi
      .fn()
      .mockResolvedValue([
        { id: 'conv-1', title: 'Projet RIG', category: 'codex', provider: 'codex' }
      ]),
    models: vi.fn().mockResolvedValue([
      { id: 'ollama:qwen', provider: 'ollama', model: 'qwen' },
      { id: 'claude:sonnet', provider: 'claude', model: 'claude-sonnet' }
    ]),
    providerStatus: vi.fn().mockResolvedValue([
      { provider: 'kimi', status: 'authenticated', testable: true },
      { provider: 'ollama', status: 'authenticated', testable: true }
    ]),
    roles: vi.fn().mockResolvedValue({
      orchestrator: { provider: 'codex', model: 'gpt-5.4' }
    }),
    taskManagerCreate: vi.fn().mockResolvedValue({ id: 'task-2' }),
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
  return { container, mockApi, root }
}

describe('TaskManagerView', () => {
  it('rend les tâches, la garantie Windows et les alertes manquées', async () => {
    const { container } = await mount()

    expect(container.textContent).toContain('Rapport du matin')
    expect(container.textContent).toContain('Autonome Windows')
    expect(container.textContent).toContain('Autowin était arrêté.')
    expect(container.querySelector('[data-testid="task-manager-view"]')).not.toBeNull()
  })

  it("affiche le mode figé sur chaque ligne d'historique", async () => {
    const { container } = await mount()
    const occurrence = container.querySelector('.task-manager-occurrence')

    expect(occurrence?.textContent).toContain('Autowin actif uniquement')
  })

  it("n'invente pas la garantie d'une ancienne occurrence sans mode archivé", async () => {
    const { container } = await mount()
    const history = [...container.querySelectorAll('.task-manager-occurrence')]

    expect(history.some((occurrence) => occurrence.textContent?.includes('Mode non archivé'))).toBe(
      true
    )
  })

  it('permet de choisir le modèle pour une conversation existante', async () => {
    const { container } = await mount()
    const newButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Nouvelle tâche')
    )
    await act(async () => newButton?.click())

    const model = [...container.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('Modèle'))
      ?.querySelector('select')

    expect(model).not.toBeNull()
    expect([...model!.options].map((option) => option.value)).toEqual([
      'claude:sonnet',
      'ollama:qwen'
    ])
  })

  it('ne propose qu’une entrée quand un alias et sa version exacte ont le même libellé', async () => {
    const mockApi = api()
    mockApi.models.mockResolvedValue([
      {
        id: 'claude:opus',
        provider: 'claude',
        model: 'opus',
        label: 'Claude Opus 5 · CLI'
      },
      {
        id: 'claude:opus-5',
        provider: 'claude',
        model: 'claude-opus-5',
        label: 'Claude Opus 5 · CLI'
      },
      {
        id: 'claude:opus-4-8',
        provider: 'claude',
        model: 'claude-opus-4-8',
        label: 'Claude Opus 4.8 · CLI'
      },
      {
        id: 'gateway:opus-5',
        provider: 'gateway',
        model: 'opus-5',
        label: 'Claude Opus 5 · CLI'
      }
    ])
    const { container } = await mount(mockApi)
    const newButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Nouvelle tâche')
    )
    await act(async () => newButton?.click())

    const model = [...container.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('Modèle'))
      ?.querySelector('select')
    const options = [...model!.options]

    expect(options.filter((option) => option.textContent === 'Claude Opus 5 · CLI · claude')).toHaveLength(1)
    expect(options.map((option) => option.value)).toContain('claude:opus')
    expect(options.map((option) => option.value)).not.toContain('claude:opus-5')
    expect(options.map((option) => option.value)).toContain('claude:opus-4-8')
    expect(options.map((option) => option.value)).toContain('gateway:opus-5')
  })

  it('crée une tâche depuis des champs structurés', async () => {
    const { container, mockApi } = await mount()
    const newButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Nouvelle tâche')
    )
    await act(async () => newButton?.click())

    const title = container.querySelector<HTMLInputElement>('input[name="title"]')!
    const prompt = container.querySelector<HTMLTextAreaElement>('textarea[name="prompt"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        title,
        'Veille quotidienne'
      )
      title.dispatchEvent(new Event('input', { bubbles: true }))
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
        prompt,
        'Fais la veille.'
      )
      prompt.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const destination = [...container.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('Destination'))
      ?.querySelector('select')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(
        destination,
        'new'
      )
      destination?.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const model = [...container.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('Modèle'))
      ?.querySelector('select')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(
        model,
        'claude:sonnet'
      )
      model?.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const save = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Créer la tâche'
    )
    await act(async () => save?.click())

    expect(mockApi.taskManagerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Veille quotidienne',
        prompt: 'Fais la veille.',
        destination: expect.objectContaining({
          kind: 'new',
          provider: 'claude',
          model: 'claude-sonnet'
        }),
        schedule: expect.objectContaining({
          startDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          time: expect.stringMatching(/^\d{2}:\d{2}$/)
        })
      })
    )
  })

  it('propose exactement les providers dynamiques d’Agent Studio', async () => {
    const { container, mockApi } = await mount()
    const newButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Nouvelle tâche')
    )
    await act(async () => newButton?.click())

    const destination = [...container.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('Destination'))
      ?.querySelector('select')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(
        destination,
        'new'
      )
      destination?.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const provider = [...container.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('Modèle'))
      ?.querySelector('select')
    expect([...provider!.options].map((option) => option.value)).toEqual([
      'claude:sonnet',
      'ollama:qwen'
    ])
    expect(mockApi.roles).not.toHaveBeenCalled()
  })

  it('bloque une nouvelle conversation quand Agent Studio ne charge aucun provider', async () => {
    const mockApi = api()
    mockApi.conversations.mockResolvedValue([])
    mockApi.models.mockResolvedValue([])
    mockApi.providerStatus.mockResolvedValue([])
    const { container } = await mount(mockApi)
    const newButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Nouvelle tâche')
    )
    await act(async () => newButton?.click())

    const provider = [...container.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('Modèle'))
      ?.querySelector('select')
    expect(provider?.disabled).toBe(true)
    expect(provider?.textContent).toContain('Aucun modèle chargé dans Agent Studio')

    const title = container.querySelector<HTMLInputElement>('input[name="title"]')!
    const prompt = container.querySelector<HTMLTextAreaElement>('textarea[name="prompt"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        title,
        'Tâche sans provider'
      )
      title.dispatchEvent(new Event('input', { bubbles: true }))
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
        prompt,
        'Impossible à envoyer.'
      )
      prompt.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const save = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Créer la tâche'
    )
    expect(save?.disabled).toBe(true)
    await act(async () => save?.click())

    expect(mockApi.taskManagerCreate).not.toHaveBeenCalled()
  })

  it('ignore un ancien rechargement qui termine après le catalogue le plus récent', async () => {
    type Model = { id: string; provider: string; model: string }
    let appEvent: ((event: { type: string; scope?: string }) => void) | undefined
    const stale = deferred<Model[]>()
    const fresh = deferred<Model[]>()
    const mockApi = api()
    mockApi.providerStatus.mockResolvedValue([])
    mockApi.onAppEvent.mockImplementation((listener) => {
      appEvent = listener
      return () => undefined
    })
    const { container } = await mount(mockApi)
    mockApi.models
      .mockImplementationOnce(() => stale.promise)
      .mockImplementationOnce(() => fresh.promise)

    act(() => appEvent?.({ type: 'refresh', scope: 'roles' }))
    act(() => appEvent?.({ type: 'refresh', scope: 'roles' }))
    await act(async () => fresh.resolve([{ id: 'ollama:qwen', provider: 'ollama', model: 'qwen' }]))
    await act(async () =>
      stale.resolve([{ id: 'claude:sonnet', provider: 'claude', model: 'claude-sonnet' }])
    )

    const newButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Nouvelle tâche')
    )
    await act(async () => newButton?.click())
    const destination = [...container.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('Destination'))
      ?.querySelector('select')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(
        destination,
        'new'
      )
      destination?.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const provider = [...container.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('Modèle'))
      ?.querySelector('select')

    expect([...provider!.options].map((option) => option.value)).toEqual(['ollama:qwen'])
  })

  it('ne permet pas une nouvelle destination avec la liste périmée pendant une réactivation', async () => {
    type Model = { id: string; provider: string; model: string }
    const pending = deferred<Model[]>()
    const mockApi = api()
    const { container, root } = await mount(mockApi)
    const newButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Nouvelle tâche')
    )
    await act(async () => newButton?.click())
    mockApi.models.mockImplementationOnce(() => pending.promise)
    mockApi.providerStatus.mockResolvedValue([])

    await act(async () => root.render(createElement(TaskManagerView, { active: false })))
    await act(async () => root.render(createElement(TaskManagerView, { active: true })))

    const destination = [...container.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('Destination'))
      ?.querySelector('select')
    expect([...destination!.options].find((option) => option.value === 'new')?.disabled).toBe(true)

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(
        destination,
        'new'
      )
      destination?.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const provider = [...container.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('Modèle'))
      ?.querySelector('select')
    const save = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Créer la tâche'
    )
    expect(provider?.disabled).toBe(true)
    expect(save?.disabled).toBe(true)
    expect(mockApi.taskManagerCreate).not.toHaveBeenCalled()

    await act(async () => pending.resolve([]))
  })
})
