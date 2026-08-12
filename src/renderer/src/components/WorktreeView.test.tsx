// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorktreeAgentActivity } from '../../../shared/worktree-activity-model'
import { WorktreeView } from './WorktreeView'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const snapshot = {
  available: true as const,
  repoPath: 'C:\\Amitel\\Autowin OS',
  repositoryName: 'Autowin OS',
  head: '46285c3',
  branch: 'main',
  changeCount: 2,
  refs: [
    {
      name: 'main',
      fullName: 'refs/heads/main',
      kind: 'local' as const,
      hash: '46285c3full',
      isHead: true
    },
    {
      name: 'feat/cockpit',
      fullName: 'refs/heads/feat/cockpit',
      kind: 'local' as const,
      hash: '5d5cc22full',
      isHead: false
    }
  ],
  worktrees: [
    {
      path: 'C:\\Amitel\\Autowin OS',
      head: '46285c3full',
      branch: 'main',
      detached: false,
      locked: false
    },
    {
      path: 'C:\\Amitel\\wt\\cockpit',
      head: '5d5cc22full',
      branch: 'feat/cockpit',
      detached: false,
      locked: false
    }
  ],
  commits: [
    {
      hash: '46285c3full',
      shortHash: '46285c3',
      parents: ['5d5cc22full'],
      refs: ['HEAD -> main'],
      author: 'Raphaël',
      date: '2026-07-23T19:00:00.000Z',
      subject: 'merge: cockpit'
    },
    {
      hash: '5d5cc22full',
      shortHash: '5d5cc22',
      parents: [],
      refs: ['feat/cockpit'],
      author: 'Raphaël',
      date: '2026-07-23T18:00:00.000Z',
      subject: 'feat: cockpit'
    }
  ]
}

const activity: WorktreeAgentActivity[] = [
  {
    agentId: 'builder',
    agentName: 'Builder',
    role: 'build',
    task: 'Construire le cockpit',
    worktreePath: 'C:\\Amitel\\wt\\cockpit',
    state: 'working',
    verdict: 'running',
    publication: 'not-requested',
    files: [{ path: 'src/renderer/WorktreeView.tsx', kind: 'mod' }],
    startedAtMs: Date.now() - 30_000
  },
  {
    agentId: 'judge',
    agentName: 'Judge',
    role: 'judge',
    task: 'Trancher le conflit',
    state: 'conflict',
    verdict: 'red',
    publication: 'blocked',
    files: [{ path: 'src/shared/state.ts', kind: 'mod' }],
    conflictFile: 'src/shared/state.ts',
    startedAtMs: Date.now() - 120_000,
    endedAtMs: Date.now() - 60_000
  }
]

let container: HTMLDivElement | undefined
let root: Root | undefined
let previousApi: PropertyDescriptor | undefined

function installApi(
  overrides: Record<string, unknown> = {}
): Record<string, ReturnType<typeof vi.fn>> {
  const api = {
    getGitGraph: vi.fn(async () => snapshot),
    getWorktreeActivity: vi.fn(async () => activity),
    getWorktreeStatus: vi.fn(async () => ({ available: true, workspacePath: snapshot.repoPath })),
    onWorktreeActivity: vi.fn(() => () => {}),
    getGitDiff: vi.fn(async () => ({ available: true, diff: '@@ -1 +1 @@\n-old\n+new' })),
    listRuns: vi.fn(async () => [
      {
        subject: 'Construire le cockpit',
        session: 'session-builder',
        path: 'C:\\runs\\cockpit\\RUN.md',
        mtime: Date.now(),
        summary: {
          status: 'open',
          regime: 'standard',
          dodTotal: 3,
          dodChecked: 1,
          journalEvents: 2,
          defauts: 0
        }
      }
    ]),
    readNodeFile: vi.fn(async (path: string) => ({ path, content: '# RUN\nstatus: open' })),
    ...overrides
  }
  previousApi = Object.getOwnPropertyDescriptor(window, 'api')
  Object.defineProperty(window, 'api', { configurable: true, value: api })
  return api as Record<string, ReturnType<typeof vi.fn>>
}

async function renderView(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(WorktreeView, { active: true }))
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function clickButton(label: string): Promise<void> {
  const button = Array.from(container?.querySelectorAll('button') ?? [])
    .reverse()
    .find((candidate) => candidate.textContent?.includes(label))
  if (!button) throw new Error(`bouton absent: ${label}`)
  await act(async () => {
    button.click()
    await Promise.resolve()
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
  localStorage.clear()
})

describe('WorktreeView — cockpit projet', () => {
  it('résume le projet, les priorités, les travaux et l’activité sans inventer de progression', async () => {
    installApi()
    await renderView()

    expect(container?.textContent).toContain('Autowin OS')
    expect(container?.textContent).toContain('main')
    expect(container?.textContent).toContain('Changements locaux')
    expect(container?.textContent).toContain('2')
    expect(container?.textContent).toContain('À faire maintenant')
    expect(container?.textContent).toContain('Trancher le conflit')
    expect(container?.textContent).toContain('Travaux en cours')
    expect(container?.textContent).toContain('Construire le cockpit')
    expect(container?.textContent).toContain('build')
    expect(container?.textContent).toContain('running')
    expect(container?.textContent).toContain('src/renderer/WorktreeView.tsx')
    expect(container?.textContent).toContain('Activité récente')
    expect(container?.textContent).not.toMatch(/\b\d{1,3}\s?%/)
  })

  it.each([
    [
      'sain',
      {
        activity: [],
        status: { available: true, workspacePath: snapshot.repoPath },
        graph: snapshot
      }
    ],
    [
      'inconnu',
      {
        activity: [{ ...activity[0], verdict: 'unknown' }],
        status: { available: true, workspacePath: snapshot.repoPath },
        graph: snapshot
      }
    ],
    [
      'indisponible',
      {
        activity: [],
        status: { available: false, workspacePath: 'D:\\notes', reason: 'not-git' },
        graph: { available: false, repoPath: 'D:\\notes', error: 'not a git repository' }
      }
    ],
    [
      'obsolète',
      {
        activity: [{ ...activity[0], startedAtMs: Date.now() - 86_400_000 }],
        status: { available: true, workspacePath: snapshot.repoPath },
        graph: snapshot
      }
    ]
  ])('distingue explicitement la santé %s', async (label, fixture) => {
    installApi({
      getGitGraph: vi.fn(async () => fixture.graph),
      getWorktreeActivity: vi.fn(async () => fixture.activity),
      getWorktreeStatus: vi.fn(async () => fixture.status)
    })
    await renderView()
    expect(container?.textContent?.toLocaleLowerCase('fr')).toContain(label)
  })

  it('affiche le chargement puis un projet vide sans masquer la structure du cockpit', async () => {
    let resolveGraph: ((value: typeof snapshot) => void) | undefined
    const graph = new Promise<typeof snapshot>((resolve) => {
      resolveGraph = resolve
    })
    installApi({
      getGitGraph: vi.fn(() => graph),
      getWorktreeActivity: vi.fn(async () => []),
      getWorktreeStatus: vi.fn(async () => ({ available: true, workspacePath: snapshot.repoPath }))
    })

    const pendingRender = renderView()
    await act(async () => {
      await Promise.resolve()
    })
    expect(container?.querySelector('[role="status"]')?.textContent).toMatch(/chargement|lecture/i)
    await act(async () => {
      resolveGraph?.({ ...snapshot, changeCount: 0, refs: [], worktrees: [], commits: [] })
      await pendingRender
    })
    expect(container?.textContent).toContain('À faire maintenant')
    expect(container?.textContent).toMatch(/aucun travail|projet vide/i)
  })

  it('conserve les données disponibles quand Git échoue ou que l’activité est partielle', async () => {
    installApi({
      getGitGraph: vi.fn(async () => ({
        available: false,
        repoPath: snapshot.repoPath,
        error: 'fatal: index corrupt'
      })),
      getWorktreeActivity: vi.fn(async () => [{ ...activity[0], files: [], verdict: undefined }])
    })
    await renderView()

    expect(container?.textContent).toContain('Construire le cockpit')
    expect(container?.textContent).toContain('indisponible')
    expect(container?.textContent).toContain('fatal: index corrupt')
    expect(container?.textContent).toContain('inconnu')
  })

  it('place le conflit en priorité et ouvre son détail à la demande', async () => {
    installApi()
    await renderView()

    const priorities = container?.querySelector('[data-testid="worktree-priorities"]')
    expect(priorities?.textContent).toContain('Trancher le conflit')
    expect(priorities?.textContent).toContain('src/shared/state.ts')
    await clickButton('Trancher le conflit')
    expect(container?.querySelector('[data-testid="worktree-detail-panel"]')).not.toBeNull()
  })

  it('ne charge diff, RUN et topologie qu’après ouverture du panneau correspondant', async () => {
    const api = installApi()
    await renderView()

    expect(container?.textContent).toContain('Historique')
    expect(container?.querySelector('[data-testid="worktree-recent-activity"]')).not.toBeNull()
    expect(container?.querySelector('[data-testid="git-topology"]')).toBeNull()
    expect(api.getGitDiff).not.toHaveBeenCalled()
    expect(api.readNodeFile).not.toHaveBeenCalled()

    await clickButton('Construire le cockpit')
    expect(container?.querySelector('[data-testid="worktree-detail-panel"]')).not.toBeNull()
    expect(api.getGitDiff).not.toHaveBeenCalled()

    await clickButton('Fichiers')
    await clickButton('src/renderer/WorktreeView.tsx')
    expect(api.getGitDiff).toHaveBeenCalledTimes(1)

    await clickButton('RUN')
    expect(api.readNodeFile).toHaveBeenCalledWith('C:\\runs\\cockpit\\RUN.md')
    expect(container?.textContent).toContain('status: open')

    await clickButton('Topologie Git')
    expect(container?.querySelector('[data-testid="git-topology"]')).not.toBeNull()
  })
})
