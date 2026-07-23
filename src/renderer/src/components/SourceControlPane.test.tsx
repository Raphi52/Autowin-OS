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

function mockApi(git: GitReadResult): void {
  ;(window as unknown as { api: unknown }).api = {
    getGitState: () => Promise.resolve(git),
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
  it('affiche branche, changements et historique (consultation)', async () => {
    mockApi(GIT)
    await render()
    expect(container.textContent).toContain('feat/source-control')
    expect(container.querySelectorAll('[data-testid="sc-file"]')).toHaveLength(2)
    expect(container.textContent).toContain('a1b2c3d')
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

  it('Envoyer transmet le prompt (pré-rempli par un bouton) à l’agent', async () => {
    mockApi(GIT)
    const onSendPrompt = vi.fn()
    await render(onSendPrompt)
    // flux réel : le bouton Push pré-remplit la barre (état React), puis Envoyer transmet.
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
