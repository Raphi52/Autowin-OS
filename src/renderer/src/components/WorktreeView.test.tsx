// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorktreeView } from './WorktreeView'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true

const snapshot = {
  available: true,
  repoPath: 'C:\\Amitel\\Autowin OS',
  repositoryName: 'Autowin OS',
  head: '46285c3',
  branch: 'main',
  changeCount: 2,
  refs: [
    { name: 'main', fullName: 'refs/heads/main', kind: 'local', hash: '46285c3full', isHead: true },
    {
      name: 'origin/main',
      fullName: 'refs/remotes/origin/main',
      kind: 'remote',
      hash: '46285c3full',
      isHead: false
    },
    {
      name: 'feat/worktrees-in-chat',
      fullName: 'refs/heads/feat/worktrees-in-chat',
      kind: 'local',
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
      path: 'C:\\Amitel\\wt\\chat',
      head: '5d5cc22full',
      branch: 'feat/worktrees-in-chat',
      detached: false,
      locked: false
    }
  ],
  commits: [
    {
      hash: '46285c3full',
      shortHash: '46285c3',
      parents: ['5d5cc22full'],
      refs: ['HEAD -> main', 'origin/main'],
      author: 'Raphaël Vilain',
      date: '2026-07-23T19:00:00.000Z',
      subject: 'merge: worktrees-in-chat dans la ligne principale'
    },
    {
      hash: '5d5cc22full',
      shortHash: '5d5cc22',
      parents: [],
      refs: ['feat/worktrees-in-chat'],
      author: 'Raphaël Vilain',
      date: '2026-07-23T18:00:00.000Z',
      subject: 'feat: worktrees in chat'
    }
  ]
}

let container: HTMLDivElement | undefined
let root: Root | undefined
let previousApi: PropertyDescriptor | undefined

function installApi(api: Record<string, unknown>): void {
  previousApi = Object.getOwnPropertyDescriptor(window, 'api')
  Object.defineProperty(window, 'api', { configurable: true, value: api })
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

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  if (previousApi) Object.defineProperty(window, 'api', previousApi)
  else Reflect.deleteProperty(window, 'api')
  previousApi = undefined
})

describe('WorktreeView — cartographie Git', () => {
  it('remplace entièrement l’ancienne activité par le ledger, le graphe et l’analyse', async () => {
    installApi({ getGitGraph: vi.fn(async () => snapshot) })

    await renderView()

    expect(container?.textContent).toContain('Références & historique')
    expect(container?.textContent).toContain('feat/worktrees-in-chat')
    expect(container?.textContent).toContain('C:\\Amitel\\wt\\chat')
    expect(container?.textContent).toContain('merge: worktrees-in-chat')
    expect(container?.querySelector('[data-testid="git-topology"]')).not.toBeNull()
    expect(container?.textContent).not.toContain('Activité worktree')
  })

  it('affiche un état explicite quand le dépôt est indisponible', async () => {
    installApi({
      getGitGraph: vi.fn(async () => ({
        available: false,
        repoPath: 'C:\\tmp',
        error: 'not a git repository'
      }))
    })

    await renderView()

    expect(container?.querySelector('.worktree-tab')?.getAttribute('data-active')).toBe('true')
    expect(container?.textContent).toContain('Dépôt Git introuvable')
  })

  it('applique la recherche au graphe tout en conservant les ancêtres nécessaires', async () => {
    installApi({ getGitGraph: vi.fn(async () => snapshot) })
    await renderView()
    expect(container?.querySelectorAll('.git-ledger__node')).toHaveLength(2)

    const input = container?.querySelector<HTMLInputElement>('.git-ledger__search input')
    await act(async () => {
      if (!input) throw new Error('champ de recherche absent')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        input,
        'feat/worktrees-in-chat'
      )
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
    })

    expect(container?.querySelectorAll('.git-ledger__node')).toHaveLength(1)
    expect(container?.textContent).toContain('feat: worktrees in chat')
    expect(container?.textContent).not.toContain('merge: worktrees-in-chat dans la ligne principale')
  })
})
