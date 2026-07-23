// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatWorktreePanel } from './ChatWorktreePanel'
import type { WorktreeAgentActivity } from '../../../shared/worktree-activity-model'

let container: HTMLDivElement
let root: Root

function mockApi(activity: WorktreeAgentActivity[]): void {
  ;(window as unknown as { api: unknown }).api = {
    getWorktreeActivity: () => Promise.resolve(activity),
    onWorktreeActivity: () => () => {}
  }
}
function agent(id: string): WorktreeAgentActivity {
  return {
    agentId: id,
    label: `Agent ${id}`,
    branch: `wt/${id}`,
    state: 'working',
    files: [],
    events: []
  } as unknown as WorktreeAgentActivity
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

async function render(): Promise<void> {
  await act(async () => {
    root.render(createElement(ChatWorktreePanel))
    await Promise.resolve()
  })
}

describe('ChatWorktreePanel', () => {
  it('ne rend RIEN quand il n’y a aucune activité worktree', async () => {
    mockApi([])
    await render()
    expect(container.querySelector('[data-testid="chat-worktree-panel"]')).toBeNull()
  })

  it('affiche une bande compacte avec le compte quand il y a de l’activité', async () => {
    mockApi([agent('a'), agent('b')])
    await render()
    expect(container.querySelector('[data-testid="chat-worktree-panel"]')).not.toBeNull()
    expect(container.textContent).toContain('2')
    // Repliée par défaut : la frise n'est pas montée tant qu'on n'a pas déplié.
    expect(container.querySelector('[data-testid="wt-view"]')).toBeNull()
  })

  it('déplie la frise au clic sur la bande', async () => {
    mockApi([agent('a')])
    await render()
    const toggle = container.querySelector('[data-testid="chat-worktree-toggle"]') as HTMLButtonElement
    await act(async () => {
      toggle.click()
      await Promise.resolve()
    })
    expect(container.querySelector('[data-testid="wt-view"]')).not.toBeNull()
  })
})
