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

function task(id: string, title: string) {
  return {
    id,
    title,
    prompt: 'Prépare le rapport.',
    enabled: true,
    mode: 'active-only',
    destination: { kind: 'existing', conversationId: 'conv-1', provider: 'ollama', model: 'qwen' },
    schedule: {
      startDate: '2026-08-03',
      time: '09:30',
      timeZone: 'Europe/Paris',
      recurrence: { unit: 'day', interval: 1 }
    },
    nextRunAt: 10,
    createdAt: 1,
    updatedAt: 1
  }
}

function api() {
  return {
    taskManagerSnapshot: vi.fn().mockResolvedValue({
      tasks: [task('task-1', 'Rapport du matin'), task('task-2', 'Veille du soir')],
      occurrences: [
        {
          id: 'task-2@1',
          taskId: 'task-2',
          scheduledFor: 1,
          status: 'running',
          mode: 'active-only'
        }
      ],
      alerts: [],
      scheduler: { running: true, nextWakeAt: 10, relayAvailable: true }
    }),
    conversations: vi
      .fn()
      .mockResolvedValue([
        { id: 'conv-1', title: 'Projet RIG', category: 'codex', provider: 'codex' }
      ]),
    models: vi
      .fn()
      .mockResolvedValue([
        { id: 'ollama:qwen', provider: 'ollama', model: 'qwen', defaultReasoningEffort: 'none' }
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

describe('Task Manager — état « en cours »', () => {
  it('marque la ligne de la tâche dont une occurrence tourne, et elle seule', async () => {
    const { container } = await mount()
    const rows = [...container.querySelectorAll('.task-manager-row')]
    const running = rows.filter((row) =>
      row.querySelector('[data-testid="task-manager-row-running"]')
    )

    expect(running).toHaveLength(1)
    expect(running[0].textContent).toContain('Veille du soir')
  })

  it('affiche le compteur d’exécutions en cours dans l’en-tête', async () => {
    const { container } = await mount()
    const badge = container.querySelector('[data-testid="task-manager-running-count"]')

    expect(badge).not.toBeNull()
    expect(badge?.textContent).toContain('1')
  })
})

describe('Task Manager — erreurs de chargement simultanées', () => {
  it('montre chaque scope en échec avec son propre Réessayer', async () => {
    const mockApi = api()
    mockApi.taskManagerSnapshot.mockRejectedValueOnce(new Error('snapshot coupé'))
    mockApi.models.mockRejectedValueOnce(new Error('catalogue coupé'))

    const { container } = await mount(mockApi)
    const banners = [...container.querySelectorAll('[data-testid="task-manager-load-error"]')]

    expect(banners).toHaveLength(2)
    expect(banners.map((banner) => banner.textContent).join(' ')).toContain('snapshot coupé')
    expect(banners.map((banner) => banner.textContent).join(' ')).toContain('catalogue coupé')

    const modelBanner = banners.find((banner) =>
      banner.textContent?.includes('catalogue coupé')
    ) as HTMLElement
    await act(async () => {
      ;[...modelBanner.querySelectorAll('button')]
        .find((button) => button.textContent === 'Réessayer')
        ?.click()
    })

    expect(mockApi.models).toHaveBeenCalledTimes(2)
    expect(mockApi.taskManagerSnapshot).toHaveBeenCalledTimes(1)
    expect(
      [...container.querySelectorAll('[data-testid="task-manager-load-error"]')].map(
        (banner) => banner.textContent
      )
    ).toHaveLength(1)
  })
})
