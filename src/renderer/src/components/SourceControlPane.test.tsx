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
const input = (): HTMLTextAreaElement =>
  container.querySelector('[data-testid="sc-prompt-input"]') as HTMLTextAreaElement

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
    expect(container.textContent).toContain('+new')
  })

  it('un bouton PRÉ-REMPLIT le prompt, il n’exécute pas de git', async () => {
    mockApi(GIT)
    const onSendPrompt = vi.fn()
    await render(onSendPrompt)
    const commit = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Commit')
    ) as HTMLButtonElement
    act(() => commit.click())
    // Le prompt est pré-rempli dans la barre — RIEN n'est envoyé tant que l'utilisateur ne valide pas.
    expect(input().value).toContain('commit')
    expect(onSendPrompt).not.toHaveBeenCalled()
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

  it('Envoyer transmet le prompt (pré-rempli par un bouton) à l’agent', async () => {
    mockApi(GIT)
    const onSendPrompt = vi.fn()
    await render(onSendPrompt)
    // flux réel : le bouton Push (vue Worktree) pré-remplit la barre, puis Envoyer transmet.
    await openWorktreeView()
    const push = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Push')
    ) as HTMLButtonElement
    act(() => push.click())
    expect(input().value).toContain('push')
    const sendBtn = container.querySelector('[data-testid="sc-send"]') as HTMLButtonElement
    act(() => sendBtn.click())
    expect(onSendPrompt).toHaveBeenCalledWith('push la branche courante')
  })
})
