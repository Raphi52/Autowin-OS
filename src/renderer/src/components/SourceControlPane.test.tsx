// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SourceControlPane } from './SourceControlPane'
import type { GitReadResult } from '../../../shared/git-read'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const GIT: GitReadResult = {
  available: true,
  state: {
    branch: 'feat/source-control',
    ahead: 1,
    behind: 0,
    changes: [
      {
        path: 'src/main/index.ts',
        status: 'modified',
        staged: false,
        workspaceRoot: 'C:/repo'
      },
      {
        path: 'src/shared/git-read.ts',
        status: 'added',
        staged: true,
        workspaceRoot: 'C:/repo'
      }
    ]
  },
  history: [{ hash: 'a1b2c3d', subject: 'feat: git-read' }]
}

const calls: {
  repoArgs: (string | undefined)[]
  conversationArgs: string[]
  conversationDiffArgs: Array<[string, string, string]>
  brainArgs: string[]
  pickReturns: (string | null)[]
} = {
  repoArgs: [],
  conversationArgs: [],
  conversationDiffArgs: [],
  brainArgs: [],
  pickReturns: []
}
function mockApi(
  git: GitReadResult,
  diff = 'diff --git a/x b/x\n@@ -1 +1 @@\n-old\n+new',
  brainTraces: unknown[] = []
): void {
  calls.repoArgs = []
  calls.conversationArgs = []
  calls.conversationDiffArgs = []
  calls.brainArgs = []
  ;(window as unknown as { api: unknown }).api = {
    getGitState: (repoPath?: string) => {
      calls.repoArgs.push(repoPath)
      return Promise.resolve(git)
    },
    conversationGitState: (conversationId: string) => {
      calls.conversationArgs.push(conversationId)
      return Promise.resolve(git)
    },
    conversationGitDiff: (conversationId: string, path: string, workspaceRoot: string) => {
      calls.conversationDiffArgs.push([conversationId, path, workspaceRoot])
      return Promise.resolve({ available: true, diff })
    },
    brainTraces: (conversationId: string) => {
      calls.brainArgs.push(conversationId)
      return Promise.resolve(brainTraces)
    },
    getGitDiff: () => Promise.resolve({ available: true, diff }),
    pickGitRepo: () => Promise.resolve(calls.pickReturns.shift() ?? null),
    getWorktreeActivity: () => Promise.resolve([]),
    onWorktreeActivity: () => () => {},
    onPilotEvent: () => () => {},
    onAppEvent: () => () => {},
    retryWorktreeRecovery: () => Promise.resolve(undefined)
  }
}

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  localStorage.clear()
})
async function render(
  onSendPrompt?: (p: string) => void,
  conversationId = 'conv-a'
): Promise<void> {
  await act(async () => {
    root.render(createElement(SourceControlPane, { onSendPrompt, conversationId }))
    await Promise.resolve()
    await Promise.resolve()
  })
}
describe('SourceControlPane (prompt-first)', () => {
  /** Bascule sur la vue « Workspace » (branche et copies d'agents). */
  async function openWorkspaceView(): Promise<void> {
    const tab = container.querySelector('[data-testid="sc-view-workspace"]') as HTMLButtonElement
    await act(async () => {
      tab.click()
      await Promise.resolve()
    })
  }

  it('vue par défaut : UNIQUEMENT les changements (ni branche ni historique)', async () => {
    mockApi(GIT)
    await render()
    expect(calls.conversationArgs).toEqual(['conv-a'])
    expect(calls.repoArgs).toHaveLength(0)
    expect(container.querySelectorAll('[data-testid="sc-file"]')).toHaveLength(2)
    // La branche vit derrière « Workspace » ; l'historique appartient à la vue Worktrees.
    expect(container.textContent).not.toContain('feat/source-control')
    expect(container.textContent).not.toContain('a1b2c3d')
  })

  it('vue Workspace : branche et copies d’agents, sans historique ni liste des changements', async () => {
    mockApi(GIT)
    await render()
    const tab = container.querySelector('[data-testid="sc-view-workspace"]')
    expect(tab?.textContent?.trim()).toBe('Workspace')
    await openWorkspaceView()
    expect(container.textContent).toContain('feat/source-control')
    expect(container.textContent).toContain('Hub des bureaux')
    expect(container.textContent).not.toContain('a1b2c3d')
    expect(container.textContent).not.toContain('Historique')
    expect(container.querySelectorAll('[data-testid="sc-file"]')).toHaveLength(0)
  })

  it('rétablit et explique l’état Auto-close quand sa persistance échoue', async () => {
    mockApi(GIT)
    const setAutoClose = vi.fn(() => Promise.reject(new Error('disque indisponible')))
    const api = (window as unknown as { api: Record<string, unknown> }).api
    api.getAutoClose = () => Promise.resolve({ enabled: false })
    api.setAutoClose = setAutoClose
    await render()
    await openWorkspaceView()

    const toggle = container.querySelector('[data-testid="sc-autoclose"]') as HTMLButtonElement
    await act(async () => {
      toggle.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(setAutoClose).toHaveBeenCalledWith(true)
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(toggle.textContent).toContain('OFF')
    expect(container.querySelector('[data-testid="sc-autoclose-error"]')?.textContent).toContain(
      'Impossible de conserver ce réglage'
    )
  })

  it('affiche le dernier résultat réel de clôture au lieu de promettre un push absolu', async () => {
    mockApi(GIT)
    const api = (window as unknown as { api: Record<string, unknown> }).api
    api.getAutoClose = () =>
      Promise.resolve({
        enabled: true,
        last: {
          runId: 'run-42',
          branch: 'auto/run-42',
          at: '2026-08-10T12:00:00.000Z',
          project: { status: 'skipped', reason: 'no-remote' },
          brain: { status: 'skipped', reason: 'no-changes' }
        }
      })
    await render()
    await openWorkspaceView()

    const toggle = container.querySelector('[data-testid="sc-autoclose"]') as HTMLButtonElement
    expect(toggle.title).toContain('tente de publier')
    expect(container.querySelector('[data-testid="sc-autoclose-last"]')?.textContent).toContain(
      'Projet · non publié · aucun distant'
    )
  })

  it('rafraichit le resultat auto-close quand une publication differee se termine', async () => {
    mockApi(GIT)
    const api = (window as unknown as { api: Record<string, unknown> }).api
    let published = false
    let notifyWorktree!: (activity: unknown[]) => void
    const getAutoClose = vi.fn(() =>
      Promise.resolve(
        published
          ? {
              enabled: true,
              last: {
                runId: 'run-delayed',
                branch: 'auto/run-delayed',
                at: '2026-08-10T12:00:00.000Z',
                project: { status: 'pushed', branch: 'auto/run-delayed', files: 1 },
                brain: { status: 'skipped', reason: 'no-changes' }
              }
            }
          : { enabled: true }
      )
    )
    api.getAutoClose = getAutoClose
    api.onWorktreeActivity = (listener: (activity: unknown[]) => void) => {
      notifyWorktree = listener
      return () => {}
    }
    await render()
    await openWorkspaceView()
    expect(container.querySelector('[data-testid="sc-autoclose-last"]')).toBeNull()

    published = true
    await act(async () => {
      notifyWorktree([])
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getAutoClose).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[data-testid="sc-autoclose-last"]')?.textContent).toContain(
      'Projet · publié · auto/run-delayed'
    )
  })

  it('ouvre le vrai diff read-only du bureau conflictuel sans écrire dans le prompt', async () => {
    mockApi(GIT)
    const getWorktreeConflictDiff = vi.fn(() =>
      Promise.resolve({
        available: true as const,
        agentId: 'a2',
        paths: ['src/main/os.ts'],
        diff: '@@ -1 +1 @@\n-version principale\n+version du bureau'
      })
    )
    const api = (window as unknown as { api: Record<string, unknown> }).api
    api.getWorktreeActivity = () =>
      Promise.resolve([
        {
          agentId: 'a2',
          agentName: 'Builder',
          state: 'conflict',
          files: [{ path: 'src/main/os.ts', kind: 'mod' }],
          startedAtMs: 1,
          conflictFile: 'src/main/os.ts',
          verdict: 'green',
          publication: 'blocked'
        }
      ])
    api.getWorktreeStatus = () =>
      Promise.resolve({ available: true, workspacePath: 'C:\\Amitel\\Autowin OS' })
    api.getWorktreeConflictDiff = getWorktreeConflictDiff
    const onSendPrompt = vi.fn()
    await render(onSendPrompt)
    await openWorkspaceView()

    const compare = container.querySelector(
      '[data-testid="wt-resolve-conflict"]'
    ) as HTMLButtonElement
    await act(async () => {
      compare.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getWorktreeConflictDiff).toHaveBeenCalledWith('a2')
    expect(onSendPrompt).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="wt-conflict-diff"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="diff-view"]')).toBeTruthy()
    expect(container.textContent).toContain('version du bureau')
  })

  it('sort de la préparation quand la comparaison du bureau échoue', async () => {
    mockApi(GIT)
    const api = (window as unknown as { api: Record<string, unknown> }).api
    api.getWorktreeActivity = () =>
      Promise.resolve([
        {
          agentId: 'a2',
          agentName: 'Builder',
          state: 'conflict',
          files: [{ path: 'src/main/os.ts', kind: 'mod' }],
          startedAtMs: 1,
          conflictFile: 'src/main/os.ts',
          verdict: 'green',
          publication: 'blocked'
        }
      ])
    api.getWorktreeStatus = () =>
      Promise.resolve({ available: true, workspacePath: 'C:\\Amitel\\Autowin OS' })
    api.getWorktreeConflictDiff = () => Promise.reject(new Error('bureau illisible'))
    await render()
    await openWorkspaceView()

    await act(async () => {
      ;(container.querySelector('[data-testid="wt-resolve-conflict"]') as HTMLButtonElement).click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Comparaison indisponible')
    expect(container.textContent).not.toContain('Préparation des deux versions')
  })

  it('réarme depuis le Hub la recréation d’un bureau épuisé', async () => {
    mockApi(GIT)
    const retryWorktreeRecovery = vi.fn(() => Promise.resolve(undefined))
    const api = (window as unknown as { api: Record<string, unknown> }).api
    api.getWorktreeActivity = () =>
      Promise.resolve([
        {
          agentId: 'restore-me',
          agentName: 'Agent récupéré',
          state: 'ready',
          files: [{ path: 'late.txt', kind: 'mod' }],
          startedAtMs: 1,
          verdict: 'green',
          publication: 'cleanup-pending',
          attentionReason: 'retry-exhausted',
          retryCount: 6,
          worktreePath: 'C:\\AppData\\worktrees\\agent__restore-me',
          worktreeAvailable: false
        }
      ])
    api.getWorktreeStatus = () =>
      Promise.resolve({ available: true, workspacePath: 'C:\\Amitel\\Autowin OS' })
    api.retryWorktreeRecovery = retryWorktreeRecovery
    await render()
    await openWorkspaceView()

    const retry = container.querySelector<HTMLButtonElement>('[data-testid="wt-retry-office"]')
    expect(retry?.textContent).toContain('Réessayer de recréer')
    await act(async () => {
      retry!.click()
      await Promise.resolve()
    })

    expect(retryWorktreeRecovery).toHaveBeenCalledWith('restore-me')
    expect(container.querySelector('[data-testid="wt-open-office"]')).toBeNull()
  })

  it('clic sur un fichier affiche son diff (consultation read-only)', async () => {
    mockApi(GIT)
    await render()
    const file = container.querySelector('[data-testid="sc-file"]') as HTMLDivElement
    await act(async () => {
      file.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(calls.conversationDiffArgs).toEqual([['conv-a', 'src/main/index.ts', 'C:/repo']])
    expect(container.querySelector('[data-testid="diff-view"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="sc-diff-card"]')).not.toBeNull()
    expect(container.querySelector('.sc-diff-title')?.textContent).toBe('src/main/index.ts')
    expect(container.querySelector('.sc-diff-wrap-mode')?.textContent).toContain('Retour ligne')
    expect(container.textContent).toContain('+new')
  })

  it('sort du chargement et affiche une erreur quand la lecture du diff échoue', async () => {
    mockApi(GIT)
    const api = (window as unknown as { api: Record<string, unknown> }).api
    api.conversationGitDiff = () => Promise.reject(new Error('git indisponible'))
    await render()

    await act(async () => {
      ;(container.querySelector('[data-testid="sc-file"]') as HTMLDivElement).click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Diff indisponible.')
    expect(container.textContent).not.toContain('Chargement du diff')
  })

  it('ignore un diff obsolète si un autre fichier est ouvert entre-temps', async () => {
    mockApi(GIT)
    let resolveFirst!: (value: { available: true; diff: string }) => void
    let resolveSecond!: (value: { available: true; diff: string }) => void
    const first = new Promise<{ available: true; diff: string }>((resolve) => {
      resolveFirst = resolve
    })
    const second = new Promise<{ available: true; diff: string }>((resolve) => {
      resolveSecond = resolve
    })
    ;(
      window as unknown as {
        api: {
          conversationGitDiff: (
            conversationId: string,
            path: string,
            workspaceRoot: string
          ) => Promise<{ available: true; diff: string }>
        }
      }
    ).api.conversationGitDiff = (_conversationId, path) =>
      path === 'src/main/index.ts' ? first : second

    await render()
    const files = container.querySelectorAll('[data-testid="sc-file"]')
    act(() => {
      ;(files[0] as HTMLDivElement).click()
      ;(files[1] as HTMLDivElement).click()
    })
    await act(async () => {
      resolveSecond({ available: true, diff: '@@ -1 +1 @@\n-old-second\n+new-second' })
      await second
    })
    expect(container.querySelector('.sc-diff-title')?.textContent).toBe('src/shared/git-read.ts')
    expect(container.textContent).toContain('+new-second')

    await act(async () => {
      resolveFirst({ available: true, diff: '@@ -1 +1 @@\n-old-first\n+new-first' })
      await first
    })
    expect(container.querySelector('.sc-diff-title')?.textContent).toBe('src/shared/git-read.ts')
    expect(container.textContent).toContain('+new-second')
    expect(container.textContent).not.toContain('+new-first')
  })

  it('ignore aussi l’erreur obsolète d’un premier diff après le succès du second', async () => {
    mockApi(GIT)
    let rejectFirst!: (reason: Error) => void
    let resolveSecond!: (value: { available: true; diff: string }) => void
    const first = new Promise<{ available: true; diff: string }>((_resolve, reject) => {
      rejectFirst = reject
    })
    const second = new Promise<{ available: true; diff: string }>((resolve) => {
      resolveSecond = resolve
    })
    ;(
      window as unknown as {
        api: {
          conversationGitDiff: (
            conversationId: string,
            path: string,
            workspaceRoot: string
          ) => Promise<{ available: true; diff: string }>
        }
      }
    ).api.conversationGitDiff = (_conversationId, path) =>
      path === 'src/main/index.ts' ? first : second

    await render()
    const files = container.querySelectorAll('[data-testid="sc-file"]')
    act(() => {
      ;(files[0] as HTMLDivElement).click()
      ;(files[1] as HTMLDivElement).click()
    })
    await act(async () => {
      resolveSecond({ available: true, diff: '@@ -1 +1 @@\n-old-second\n+new-second' })
      await second
    })
    await act(async () => {
      rejectFirst(new Error('premier diff indisponible'))
      await Promise.resolve()
    })

    expect(container.querySelector('.sc-diff-title')?.textContent).toBe('src/shared/git-read.ts')
    expect(container.textContent).toContain('+new-second')
    expect(container.textContent).not.toContain('Diff indisponible.')
  })

  it('un bouton envoie la demande à l’agent (le renderer n’exécute aucun git)', async () => {
    mockApi(GIT)
    const onSendPrompt = vi.fn()
    await render(onSendPrompt)
    const commit = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Commit')
    ) as HTMLButtonElement
    act(() => commit.click())
    // La barre de prompt intermédiaire a été retirée : le clic transmet directement à l'agent,
    // qui reste le SEUL à exécuter git (le renderer ne fait que de la lecture).
    expect(onSendPrompt).toHaveBeenCalledTimes(1)
    expect(String(onSendPrompt.mock.calls[0][0])).toContain('commit')
    expect(container.querySelector('[data-testid="sc-prompt-input"]')).toBeNull()
  })

  it('le dépôt Worktree persisté ne change jamais le dépôt du Projet', async () => {
    localStorage.setItem('autowin:sc-repo', 'C:/rig')
    mockApi(GIT)
    await render()
    expect(calls.conversationArgs).toEqual(['conv-a'])
    expect(calls.repoArgs).toHaveLength(0)
    await openWorkspaceView()
    expect(calls.repoArgs).toContain('C:/rig')
  })

  it('Brain affiche uniquement les appels de la conversation, pas le dépôt Brain', async () => {
    mockApi(GIT, undefined, [
      {
        timestamp: '2026-07-30T20:00:00.000Z',
        conversationId: 'conv-a',
        turnId: 'turn-a',
        kind: 'query',
        query: 'décision architecture',
        found: true,
        injectedChars: 420
      }
    ])
    await render()
    const brain = container.querySelector('[data-testid="sc-repo-brain"]') as HTMLButtonElement
    expect(brain).not.toBeNull()
    await act(async () => {
      brain.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(calls.brainArgs).toContain('conv-a')
    expect(calls.repoArgs.some((p) => String(p).includes('Amitel Brain'))).toBe(false)
    expect(container.textContent).toContain('décision architecture')
    expect(container.textContent).toContain('420')
    expect(container.textContent).toContain('Tour turn-a')
  })

  it('distingue une lecture Brain indisponible d’une conversation sans appel', async () => {
    mockApi(GIT)
    ;(
      window as unknown as {
        api: { brainTraces: (conversationId: string) => Promise<unknown[]> }
      }
    ).api.brainTraces = () => Promise.reject(new Error('spool illisible'))

    await render()
    await act(async () => {
      ;(container.querySelector('[data-testid="sc-repo-brain"]') as HTMLButtonElement).click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Lecture des appels Brain indisponible.')
    expect(container.textContent).not.toContain('Aucun appel Brain dans cette conversation.')
  })

  it('signale explicitement un résultat Brain historique sans statut', async () => {
    mockApi(GIT, undefined, [
      {
        timestamp: '2026-07-30T20:00:00.000Z',
        conversationId: 'conv-a',
        kind: 'query',
        query: 'ancienne recherche',
        injectedChars: 12
      }
    ])

    await render()
    await act(async () => {
      ;(container.querySelector('[data-testid="sc-repo-brain"]') as HTMLButtonElement).click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Résultat historique inconnu')
  })

  it('distingue un service Brain indisponible d’une recherche vide', async () => {
    mockApi(GIT, undefined, [
      {
        timestamp: '2026-07-30T20:00:00.000Z',
        conversationId: 'conv-a',
        kind: 'automatic',
        query: 'contexte demandé',
        found: false,
        status: 'unavailable',
        injectedChars: 0
      }
    ])

    await render()
    await act(async () => {
      ;(container.querySelector('[data-testid="sc-repo-brain"]') as HTMLButtonElement).click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Brain indisponible')
    expect(container.textContent).not.toContain('Aucun résultat')
  })

  it('ignore la réponse Projet obsolète après un changement de conversation', async () => {
    mockApi(GIT)
    let resolveA!: (value: GitReadResult) => void
    const slowA = new Promise<GitReadResult>((resolve) => {
      resolveA = resolve
    })
    const gitB: GitReadResult = {
      available: true,
      state: {
        branch: 'main',
        ahead: 0,
        behind: 0,
        changes: [{ path: 'conversation-b.ts', status: 'modified', staged: false }]
      }
    }
    ;(
      window as unknown as {
        api: {
          conversationGitState: (
            conversationId: string,
            repoPath?: string
          ) => Promise<GitReadResult>
        }
      }
    ).api.conversationGitState = (conversationId) =>
      conversationId === 'conv-a' ? slowA : Promise.resolve(gitB)

    await act(async () => {
      root.render(createElement(SourceControlPane, { conversationId: 'conv-a' }))
      await Promise.resolve()
      root.render(createElement(SourceControlPane, { conversationId: 'conv-b' }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(container.textContent).toContain('conversation-b.ts')

    await act(async () => {
      resolveA(GIT)
      await slowA
    })
    expect(container.textContent).toContain('conversation-b.ts')
    expect(container.textContent).not.toContain('src/main/index.ts')
  })

  it('efface Brain immédiatement puis charge la nouvelle conversation sans fuite', async () => {
    mockApi(GIT)
    let resolveB!: (value: unknown[]) => void
    const slowB = new Promise<unknown[]>((resolve) => {
      resolveB = resolve
    })
    const traceA = {
      timestamp: '2026-07-30T20:00:00.000Z',
      conversationId: 'conv-a',
      kind: 'query',
      query: 'brain-a',
      injectedChars: 99
    }
    ;(
      window as unknown as {
        api: { brainTraces: (conversationId: string) => Promise<unknown[]> }
      }
    ).api.brainTraces = (conversationId) =>
      conversationId === 'conv-a' ? Promise.resolve([traceA]) : slowB

    await render(undefined, 'conv-a')
    await act(async () => {
      ;(container.querySelector('[data-testid="sc-repo-brain"]') as HTMLButtonElement).click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(container.textContent).toContain('brain-a')

    await act(async () => {
      root.render(createElement(SourceControlPane, { conversationId: 'conv-b' }))
      await Promise.resolve()
    })
    expect(container.textContent).not.toContain('brain-a')

    await act(async () => {
      resolveB([
        {
          timestamp: '2026-07-30T20:05:00.000Z',
          conversationId: 'conv-b',
          kind: 'query',
          query: 'brain-b',
          found: true,
          injectedChars: 12
        }
      ])
      await slowB
    })
    expect(container.textContent).toContain('brain-b')
    expect(container.textContent).not.toContain('brain-a')
  })

  it('le bouton Push (vue Workspace) transmet directement la demande à l’agent', async () => {
    mockApi(GIT)
    const onSendPrompt = vi.fn()
    await render(onSendPrompt)
    await openWorkspaceView()
    const push = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Push')
    ) as HTMLButtonElement
    act(() => push.click())
    expect(onSendPrompt).toHaveBeenCalledWith('push la branche courante')
  })
})

describe('SourceControlPane — Hub des bureaux', () => {
  const CONFLICT_AGENT = {
    agentId: 'a2',
    agentName: 'Builder',
    state: 'conflict',
    files: [{ path: 'src/main/os.ts', kind: 'mod' }],
    startedAtMs: 1,
    conflictFile: 'src/main/os.ts',
    verdict: 'green',
    publication: 'blocked'
  }

  function api(): Record<string, unknown> {
    return (window as unknown as { api: Record<string, unknown> }).api
  }

  async function renderPane(): Promise<void> {
    await act(async () => {
      root.render(createElement(SourceControlPane, { conversationId: 'conv-a' }))
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  async function openWorkspace(): Promise<void> {
    await act(async () => {
      ;(container.querySelector('[data-testid="sc-view-workspace"]') as HTMLButtonElement).click()
      await Promise.resolve()
    })
  }

  it('P0-1 : le panneau de comparaison peut être refermé', async () => {
    mockApi(GIT)
    api().getWorktreeActivity = () => Promise.resolve([CONFLICT_AGENT])
    api().getWorktreeStatus = () => Promise.resolve({ available: true, workspacePath: 'C:\\repo' })
    api().getWorktreeConflictDiff = () =>
      Promise.resolve({ available: true, agentId: 'a2', paths: ['src/main/os.ts'], diff: '-a\n+b' })
    await renderPane()
    await openWorkspace()

    await act(async () => {
      ;(container.querySelector('[data-testid="wt-resolve-conflict"]') as HTMLButtonElement).click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(container.querySelector('[data-testid="wt-conflict-diff"]')).toBeTruthy()

    await act(async () => {
      ;(container.querySelector('[data-testid="wt-conflict-close"]') as HTMLButtonElement).click()
      await Promise.resolve()
    })

    expect(container.querySelector('[data-testid="wt-conflict-diff"]')).toBeNull()
  })

  it('P0-2 : pendant la lecture du statut, la protection n’est pas déclarée indisponible', async () => {
    mockApi(GIT)
    api().getWorktreeActivity = () => Promise.resolve([])
    api().getWorktreeStatus = () => new Promise(() => {})
    await renderPane()
    await openWorkspace()

    const main = container.querySelector('[data-testid="wt-main-office"]')!
    expect(main.className).not.toContain('is-unavailable')
    expect(main.textContent).toContain('Vérification de la protection')
  })

  it('P0-3 : un échec de lecture est nommé et rejouable', async () => {
    mockApi(GIT)
    let attempt = 0
    api().getWorktreeActivity = () => {
      attempt += 1
      return attempt === 1
        ? Promise.reject(new Error('IPC coupé'))
        : Promise.resolve([CONFLICT_AGENT])
    }
    api().getWorktreeStatus = () => Promise.resolve({ available: true, workspacePath: 'C:\\repo' })
    await renderPane()
    await openWorkspace()

    const banner = container.querySelector('[data-testid="wt-load-error"]')!
    expect(banner.getAttribute('role')).toBe('alert')
    expect(banner.textContent).toContain('Lecture des bureaux agents indisponible.')

    await act(async () => {
      ;(container.querySelector('[data-testid="wt-load-retry"]') as HTMLButtonElement).click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(attempt).toBe(2)
    expect(container.querySelector('[data-testid="wt-load-error"]')).toBeNull()
    expect(container.querySelectorAll('[data-testid="wt-agent-office"]')).toHaveLength(1)
  })

  it('P0-4 : la résolution est envoyée au main puis referme la comparaison', async () => {
    mockApi(GIT)
    const resolveWorktreeConflict = vi.fn(() =>
      Promise.resolve({ resolved: true as const, agentId: 'a2', outcome: 'merged' as const })
    )
    api().getWorktreeActivity = () => Promise.resolve([CONFLICT_AGENT])
    api().getWorktreeStatus = () => Promise.resolve({ available: true, workspacePath: 'C:\\repo' })
    api().getWorktreeConflictDiff = () =>
      Promise.resolve({ available: true, agentId: 'a2', paths: ['src/main/os.ts'], diff: '-a\n+b' })
    api().resolveWorktreeConflict = resolveWorktreeConflict
    await renderPane()
    await openWorkspace()

    await act(async () => {
      ;(container.querySelector('[data-testid="wt-resolve-conflict"]') as HTMLButtonElement).click()
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      ;(container.querySelector('[data-testid="wt-keep-agent"]') as HTMLButtonElement).click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(resolveWorktreeConflict).toHaveBeenCalledWith('a2', 'agent')
    expect(container.querySelector('[data-testid="wt-conflict-diff"]')).toBeNull()
    expect(
      container.querySelector('[data-testid="wt-conflict-resolution"]')?.textContent
    ).toContain('Version de l’agent appliquée')
  })

  it('P0-4 : un refus du main est affiché sans prétendre avoir résolu', async () => {
    mockApi(GIT)
    api().getWorktreeActivity = () => Promise.resolve([CONFLICT_AGENT])
    api().getWorktreeStatus = () => Promise.resolve({ available: true, workspacePath: 'C:\\repo' })
    api().resolveWorktreeConflict = () =>
      Promise.resolve({ resolved: false as const, reason: 'blocked' as const })
    await renderPane()
    await openWorkspace()

    await act(async () => {
      ;(container.querySelector('[data-testid="wt-keep-mine"]') as HTMLButtonElement).click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.querySelector('[data-testid="wt-office-error"]')?.textContent).toContain(
      'Résolution refusée'
    )
    expect(container.querySelector('[data-testid="wt-conflict-resolution"]')).toBeNull()
  })

  it('P1-7 : l’onglet Workspace porte le nombre de bureaux à décider', async () => {
    mockApi(GIT)
    api().getWorktreeActivity = () => Promise.resolve([CONFLICT_AGENT])
    api().getWorktreeStatus = () => Promise.resolve({ available: true, workspacePath: 'C:\\repo' })
    await renderPane()

    expect(container.querySelector('[data-testid="sc-workspace-badge"]')?.textContent).toBe('1')
  })

  it('P1-6 : chaque raison d’échec de comparaison a son propre message', async () => {
    const reasons = [
      ['invalid-agent', 'plus connu'],
      ['not-conflict', 'plus en conflit'],
      ['ownership-unproven', 'n’appartient plus'],
      ['invalid-path', 'pas lisibles'],
      ['revision-unavailable', 'plus présentes'],
      ['read-failed', 'a échoué']
    ] as const
    for (const [reason, expected] of reasons) {
      mockApi(GIT)
      api().getWorktreeActivity = () => Promise.resolve([CONFLICT_AGENT])
      api().getWorktreeStatus = () =>
        Promise.resolve({ available: true, workspacePath: 'C:\\repo' })
      api().getWorktreeConflictDiff = () => Promise.resolve({ available: false, reason })
      await renderPane()
      await openWorkspace()
      await act(async () => {
        ;(
          container.querySelector('[data-testid="wt-resolve-conflict"]') as HTMLButtonElement
        ).click()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(
        container.querySelector('[data-testid="wt-conflict-diff-error"]')?.textContent
      ).toContain(expected)
    }
  })

  it('P2-11 : un preload partiel ne crashe pas et le dit', async () => {
    mockApi(GIT)
    delete api().retryWorktreeRecovery
    api().getWorktreeActivity = () =>
      Promise.resolve([
        {
          agentId: 'restore-me',
          agentName: 'Agent récupéré',
          state: 'ready',
          files: [],
          startedAtMs: 1,
          verdict: 'green',
          publication: 'cleanup-pending',
          attentionReason: 'retry-exhausted',
          retryCount: 6,
          worktreeAvailable: false
        }
      ])
    api().getWorktreeStatus = () => Promise.resolve({ available: true, workspacePath: 'C:\\repo' })
    await renderPane()
    await openWorkspace()

    await act(async () => {
      ;(container.querySelector('[data-testid="wt-retry-office"]') as HTMLButtonElement).click()
      await Promise.resolve()
    })

    expect(container.querySelector('[data-testid="wt-office-error"]')?.textContent).toContain(
      'Nouvel essai indisponible'
    )
    expect(container.querySelector('[data-testid="wt-agent-office"]')).toBeTruthy()
  })
})
