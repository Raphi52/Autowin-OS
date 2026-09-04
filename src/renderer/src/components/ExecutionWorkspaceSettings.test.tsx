// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExecutionWorkspaceSettings } from './ExecutionWorkspaceSettings'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []

afterEach(async () => {
  for (const item of mounted.splice(0)) {
    await act(async () => item.root.unmount())
    item.container.remove()
  }
})

async function monter(api: Record<string, unknown>): Promise<HTMLDivElement> {
  Object.defineProperty(window, 'api', { configurable: true, value: api })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  await act(async () => root.render(createElement(ExecutionWorkspaceSettings)))
  return container
}

describe('Dossier de travail', () => {
  it('affiche le dossier actif', async () => {
    const container = await monter({
      executionWorkspace: vi.fn().mockResolvedValue({
        path: 'D:/AutoWinOS',
        chosen: null,
        isGitRepo: true,
        restartRequired: false
      })
    })
    expect(
      container.querySelector('[data-testid="execution-workspace-active"]')?.textContent
    ).toContain('D:/AutoWinOS')
    expect(container.querySelector('[data-testid="execution-workspace-restart"]')).toBeNull()
  })

  it('après un changement, montre le choix et réclame un redémarrage', async () => {
    const chooseExecutionWorkspace = vi.fn().mockResolvedValue({
      path: 'D:/AutoWinOS',
      chosen: 'D:/Autre',
      isGitRepo: true,
      restartRequired: true
    })
    const container = await monter({
      executionWorkspace: vi.fn().mockResolvedValue({
        path: 'D:/AutoWinOS',
        chosen: null,
        isGitRepo: true,
        restartRequired: false
      }),
      chooseExecutionWorkspace
    })
    const bouton = container.querySelector<HTMLButtonElement>(
      '[data-testid="execution-workspace-choose"]'
    )
    await act(async () => bouton?.click())
    expect(chooseExecutionWorkspace).toHaveBeenCalledOnce()
    expect(
      container.querySelector('[data-testid="execution-workspace-chosen"]')?.textContent
    ).toContain('D:/Autre')
    expect(container.querySelector('[data-testid="execution-workspace-restart"]')).not.toBeNull()
  })

  it('avertit quand le dossier n’est pas un dépôt git', async () => {
    const container = await monter({
      executionWorkspace: vi.fn().mockResolvedValue({
        path: 'D:/Documents',
        chosen: 'D:/Documents',
        isGitRepo: false,
        restartRequired: false
      })
    })
    expect(container.querySelector('[data-testid="execution-workspace-no-git"]')).not.toBeNull()
  })
})
