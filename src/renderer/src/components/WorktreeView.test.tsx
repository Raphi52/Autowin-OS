// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorktreeView } from './WorktreeView'
import type { WorktreeAgentActivity } from '../../../shared/worktree-activity-model'

type WorktreeApi = Pick<Window['api'], 'getWorktreeActivity' | 'onWorktreeActivity'> & {
  getWorktreeStatus?: () => Promise<unknown>
}

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true

let container: HTMLDivElement | undefined
let root: Root | undefined
let previousApi: PropertyDescriptor | undefined

function installApi(api: Partial<WorktreeApi>): void {
  previousApi = Object.getOwnPropertyDescriptor(window, 'api')
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: api
  })
}

async function renderView(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(WorktreeView, { active: true }))
    await Promise.resolve()
  })
}

async function rerenderView(active: boolean): Promise<void> {
  await act(async () => {
    root?.render(createElement(WorktreeView, { active }))
    await Promise.resolve()
  })
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  if (previousApi) Object.defineProperty(window, 'api', previousApi)
  else Reflect.deleteProperty(window, 'api')
  previousApi = undefined
})

describe('WorktreeView — contrat preload', () => {
  it('signale le vrai preload ancien qui expose l’activité sans API de statut', async () => {
    installApi({
      getWorktreeActivity: vi.fn(async () => []),
      onWorktreeActivity: vi.fn(() => () => undefined)
    })

    await renderView()

    expect(container?.textContent).toContain('Relance Autowin OS')
    expect(container?.textContent).not.toContain('Aucune copie en cours')
    expect(container?.querySelector('[data-testid="wt-view"]')).toBeNull()
  })

  it('signale un statut inaccessible au lieu d’afficher une fausse activité vide', async () => {
    installApi({
      getWorktreeActivity: vi.fn(async () => []),
      onWorktreeActivity: vi.fn(() => () => undefined),
      getWorktreeStatus: vi.fn(async () => Promise.reject(new Error('canal absent')))
    })

    await renderView()

    expect(container?.textContent).toContain('Relance Autowin OS')
    expect(container?.textContent).not.toContain('Aucune copie en cours')
    expect(container?.querySelector('[data-testid="wt-view"]')).toBeNull()
  })

  it.each([{}, null])(
    'refuse un statut IPC mal formé au lieu d’afficher une fausse activité vide',
    async (malformedStatus) => {
      installApi({
        getWorktreeActivity: vi.fn(async () => []),
        onWorktreeActivity: vi.fn(() => () => undefined),
        getWorktreeStatus: vi.fn(async () => malformedStatus)
      })

      await renderView()

      expect(container?.textContent).toContain('Relance Autowin OS')
      expect(container?.textContent).not.toContain('Aucune copie en cours')
      expect(container?.querySelector('[data-testid="wt-view"]')).toBeNull()
    }
  )

  it('attend le statut sans afficher fugitivement une fausse activité vide', async () => {
    const pendingStatus = new Promise<{ available: boolean }>(() => undefined)
    installApi({
      getWorktreeActivity: vi.fn(async () => []),
      onWorktreeActivity: vi.fn(() => () => undefined),
      getWorktreeStatus: vi.fn(() => pendingStatus)
    })

    await renderView()

    expect(container?.textContent).toContain('Connexion au moteur des copies')
    expect(container?.textContent).not.toContain('Aucune copie en cours')
    expect(container?.querySelector('[data-testid="wt-view"]')).toBeNull()
  })

  it('ne laisse pas le snapshot initial périmé effacer une activité live', async () => {
    let resolveSnapshot!: (items: WorktreeAgentActivity[]) => void
    let publish!: (items: WorktreeAgentActivity[]) => void
    const snapshot = new Promise<WorktreeAgentActivity[]>((resolve) => {
      resolveSnapshot = resolve
    })
    installApi({
      getWorktreeActivity: vi.fn(() => snapshot),
      getWorktreeStatus: vi.fn(async () => ({ available: true })),
      onWorktreeActivity: vi.fn((listener) => {
        publish = listener
        return () => undefined
      })
    })
    await renderView()

    const live: WorktreeAgentActivity = {
      agentId: 'run-1',
      agentName: 'Builder',
      state: 'working',
      files: [],
      startedAtMs: 1
    }
    act(() => publish([live]))
    await act(async () => {
      resolveSnapshot([])
      await Promise.resolve()
    })

    expect(container?.querySelectorAll('[data-testid="wt-lane"]')).toHaveLength(1)
    expect(container?.textContent).toContain('Builder travaille')
  })

  it('rafraîchit l’activité avant de réafficher l’onglet réactivé', async () => {
    let resolveSecondSnapshot!: (items: WorktreeAgentActivity[]) => void
    const secondSnapshot = new Promise<WorktreeAgentActivity[]>((resolve) => {
      resolveSecondSnapshot = resolve
    })
    const getWorktreeActivity = vi
      .fn<() => Promise<WorktreeAgentActivity[]>>()
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(secondSnapshot)
    installApi({
      getWorktreeActivity,
      getWorktreeStatus: vi.fn(async () => ({ available: true })),
      onWorktreeActivity: vi.fn(() => () => undefined)
    })
    await renderView()
    expect(container?.textContent).toContain('Aucune copie en cours')

    await rerenderView(false)
    await rerenderView(true)

    expect(container?.textContent).toContain('Connexion au moteur des copies')
    expect(container?.textContent).not.toContain('Aucune copie en cours')

    await act(async () => {
      resolveSecondSnapshot([
        {
          agentId: 'run-3',
          agentName: 'Builder',
          state: 'working',
          files: [],
          startedAtMs: 1
        }
      ])
      await Promise.resolve()
    })
    expect(container?.textContent).toContain('Builder travaille')
  })

  it('ne présente pas de bouton de résolution quand aucun handler réel n’est branché', async () => {
    const conflict: WorktreeAgentActivity = {
      agentId: 'run-2',
      agentName: 'Judge',
      state: 'conflict',
      files: [{ path: 'os.ts', kind: 'mod' }],
      startedAtMs: 1,
      endedAtMs: 2,
      conflictFile: 'os.ts'
    }
    installApi({
      getWorktreeActivity: vi.fn(async () => [conflict]),
      getWorktreeStatus: vi.fn(async () => ({ available: true })),
      onWorktreeActivity: vi.fn(() => () => undefined)
    })

    await renderView()

    expect(container?.textContent).toContain('À toi de trancher')
    expect(container?.querySelector('.wt-btn')).toBeNull()
  })

  it('distingue un moteur indisponible d’une activité simplement vide', async () => {
    installApi({
      getWorktreeActivity: vi.fn(async () => []),
      onWorktreeActivity: vi.fn(() => () => undefined),
      getWorktreeStatus: vi.fn(async () => ({
        available: false
      }))
    })

    await renderView()

    expect(container?.textContent).toContain('Le dossier ouvert')
    expect(container?.textContent).toContain('AUTOWIN_OS_WORKSPACE')
    expect(container?.textContent).not.toContain('Aucune copie en cours')
  })
})
