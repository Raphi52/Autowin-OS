// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SourceControlPane } from './SourceControlPane'
import type { GitReadResult } from '../../../shared/git-read'

const GIT: GitReadResult = {
  available: true,
  state: {
    branch: 'feat/source-control',
    ahead: 1,
    behind: 0,
    changes: [
      { path: 'src/main/index.ts', status: 'modified', staged: false },
      { path: 'src/shared/git-read.ts', status: 'added', staged: true }
    ]
  },
  history: [{ hash: 'a1b2c3d', subject: 'feat: git-read' }]
}

const calls: { repoArgs: (string | undefined)[]; pickReturns: (string | null)[] } = {
  repoArgs: [],
  pickReturns: []
}
function mockApi(git: GitReadResult, diff = 'diff --git a/x b/x\n@@ -1 +1 @@\n-old\n+new'): void {
  calls.repoArgs = []
  ;(window as unknown as { api: unknown }).api = {
    getGitState: (repoPath?: string) => {
      calls.repoArgs.push(repoPath)
      return Promise.resolve(git)
    },
    getGitDiff: () => Promise.resolve({ available: true, diff }),
    brainRepoPath: () => Promise.resolve('//ged2/rig/Projets IA/Amitel Brain'),
    pickGitRepo: () => Promise.resolve(calls.pickReturns.shift() ?? null),
    getWorktreeActivity: () => Promise.resolve([]),
    retryWorktreeRecovery: () => Promise.resolve(undefined),
    onWorktreeActivity: () => () => {}
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
async function render(onSendPrompt?: (p: string) => void): Promise<void> {
  await act(async () => {
    root.render(createElement(SourceControlPane, { onSendPrompt }))
    await Promise.resolve()
    await Promise.resolve()
  })
}
describe('SourceControlPane (prompt-first)', () => {
  /** Bascule sur la vue « Worktree » (branche, copies d'agents, historique). */
  async function openWorktreeView(): Promise<void> {
    const tab = container.querySelector('[data-testid="sc-view-worktree"]') as HTMLButtonElement
    await act(async () => {
      tab.click()
      await Promise.resolve()
    })
  }

  it('vue par défaut : UNIQUEMENT les changements (ni branche ni historique)', async () => {
    mockApi(GIT)
    await render()
    expect(container.querySelectorAll('[data-testid="sc-file"]')).toHaveLength(2)
    // Branche et historique vivent désormais derrière « Worktree » — la liste reste lisible.
    expect(container.textContent).not.toContain('feat/source-control')
    expect(container.textContent).not.toContain('a1b2c3d')
  })

  it('vue Worktree : branche, copies d’agents et historique (pas la liste des changements)', async () => {
    mockApi(GIT)
    await render()
    await openWorktreeView()
    expect(container.textContent).toContain('feat/source-control')
    expect(container.textContent).toContain('a1b2c3d')
    expect(container.querySelectorAll('[data-testid="sc-file"]')).toHaveLength(0)
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
    await openWorktreeView()

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
    await openWorktreeView()

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
    expect(container.querySelector('[data-testid="diff-view"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="sc-diff-card"]')).not.toBeNull()
    expect(container.querySelector('.sc-diff-title')?.textContent).toBe('src/main/index.ts')
    expect(container.querySelector('.sc-diff-wrap-mode')?.textContent).toContain('Retour ligne')
    expect(container.textContent).toContain('+new')
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
        api: { getGitDiff: (path: string) => Promise<{ available: true; diff: string }> }
      }
    ).api.getGitDiff = (path) => (path === 'src/main/index.ts' ? first : second)

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

  it('v3 : le dépôt persisté est passé à getGitState', async () => {
    localStorage.setItem('autowin:sc-repo', 'C:/rig')
    mockApi(GIT)
    await render()
    expect(calls.repoArgs).toContain('C:/rig')
  })

  it('« Brain » recharge sur le dépôt du Brain + persiste le choix', async () => {
    mockApi(GIT)
    await render()
    const brain = container.querySelector('[data-testid="sc-repo-brain"]') as HTMLButtonElement
    expect(brain).not.toBeNull()
    await act(async () => {
      brain.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(calls.repoArgs.some((p) => String(p).includes('Amitel Brain'))).toBe(true)
    expect(localStorage.getItem('autowin:sc-repo')).toContain('Amitel Brain')
  })

  it('le bouton Push (vue Worktree) transmet directement la demande à l’agent', async () => {
    mockApi(GIT)
    const onSendPrompt = vi.fn()
    await render(onSendPrompt)
    await openWorktreeView()
    const push = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Push')
    ) as HTMLButtonElement
    act(() => push.click())
    expect(onSendPrompt).toHaveBeenCalledWith('push la branche courante')
  })
})
