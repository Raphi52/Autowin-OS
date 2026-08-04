// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { CapabilitiesView } from './CapabilitiesView'

describe('Capabilities plugins wiring', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  it('loads the plugins registry when its tab is selected', async () => {
    const capabilityControls = vi.fn(async (kind: string) =>
      kind === 'plugins'
        ? [
            {
              id: 'plugin-a',
              label: 'Plugin A',
              description: 'Connecteur',
              enabled: true,
              mutable: false
            }
          ]
        : []
    )
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        skills: vi.fn(async () => []),
        claudeHooks: vi.fn(async () => []),
        codexHooks: vi.fn(async () => []),
        toolUsage: vi.fn(async () => []),
        capabilityControls,
        setCapabilityTool: vi.fn()
      }
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(CapabilitiesView, { active: true }))
      await Promise.resolve()
      await Promise.resolve()
    })
    const plugins = [...container.querySelectorAll('[role="tab"]')].find((node) =>
      node.textContent?.includes('Plugins')
    ) as HTMLButtonElement
    await act(async () => {
      plugins.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(capabilityControls).toHaveBeenCalledWith('plugins')
    expect(container.textContent).toContain('Plugin A')
    await act(async () => root.unmount())
    container.remove()
  })
})
