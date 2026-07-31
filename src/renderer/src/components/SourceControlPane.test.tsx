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
    onAppEvent: () => () => {}
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
    expect(calls.conversationArgs).toEqual(['conv-a'])
    expect(calls.repoArgs).toHaveLength(0)
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

  it('clic sur un fichier affiche son diff (consultation read-only)', async () => {
    mockApi(GIT)
    await render()
    const file = container.querySelector('[data-testid="sc-file"]') as HTMLDivElement
    await act(async () => {
      file.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(calls.conversationDiffArgs).toEqual([
      ['conv-a', 'src/main/index.ts', 'C:/repo']
    ])
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
    await openWorktreeView()
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
