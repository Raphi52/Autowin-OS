// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WorktreePaneTab } from './WorktreePaneTab'
import type { WorktreeAgentActivity } from '../../../shared/worktree-activity-model'

let container: HTMLDivElement
let root: Root
function mockApi(activity: WorktreeAgentActivity[]): void {
  ;(window as unknown as { api: unknown }).api = {
    getWorktreeActivity: () => Promise.resolve(activity),
    onWorktreeActivity: () => () => {}
  }
}
const agent = (id: string): WorktreeAgentActivity =>
  ({ agentId: id, label: `Agent ${id}`, branch: `wt/${id}`, state: 'working', files: [], events: [] }) as unknown as WorktreeAgentActivity

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})
async function render(): Promise<void> {
  await act(async () => {
    root.render(createElement(WorktreePaneTab))
    await Promise.resolve()
  })
}

describe('WorktreePaneTab', () => {
  it('état vide pédagogique quand aucune activité', async () => {
    mockApi([])
    await render()
    expect(container.querySelector('[data-testid="worktree-pane-empty"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="wt-view"]')).toBeNull()
  })

  it('rend la frise worktree quand il y a de l’activité', async () => {
    mockApi([agent('a')])
    await render()
    expect(container.querySelector('[data-testid="worktree-pane"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="wt-view"]')).not.toBeNull()
  })
})
