// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./CapabilitiesView', () => ({ CapabilitiesView: () => null }))
vi.mock('./BehaviourView', () => ({ BehaviourView: () => null }))

import { SettingsView } from './SettingsView'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true

const mounted: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []

afterEach(async () => {
  for (const item of mounted.splice(0)) {
    await act(async () => item.root.unmount())
    item.container.remove()
  }
})

describe('SettingsView diagnostic', () => {
  it('relance le preflight forcé et rend son résultat', async () => {
    const recheckPreflight = vi.fn().mockResolvedValue({
      ok: true,
      summary: 'Tous les prérequis sont OK.',
      checks: [
        {
          id: 'codex-session',
          label: 'Session OAuth Codex',
          ok: true
        }
      ]
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { recheckPreflight }
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    mounted.push({ root, container })

    await act(async () => {
      root.render(
        createElement(SettingsView, {
          active: true,
          section: 'preflight',
          onSectionChange: vi.fn()
        })
      )
    })
    const button = [...container.querySelectorAll('button')].find((candidate) =>
      candidate.textContent?.includes('Relancer')
    )
    await act(async () => button?.click())

    expect(recheckPreflight).toHaveBeenCalledWith(true)
    expect(container.textContent).toContain('Session OAuth Codex')
    expect(container.querySelector('.settings-preflight-list li')?.className).toContain('is-ok')
  })
})
