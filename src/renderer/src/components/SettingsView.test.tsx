// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./CapabilitiesView', () => ({ CapabilitiesView: () => null }))
vi.mock('./BehaviourView', () => ({ BehaviourView: () => null }))

import { SettingsView } from './SettingsView'

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
      checkedAt: '2026-07-23T09:00:00.000Z',
      checks: [
        {
          id: 'git',
          label: 'Git',
          required: true,
          status: 'ok',
          detail: 'git 2.x détecté'
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
    expect(container.textContent).toContain('Git')
    expect(container.textContent).toContain('git 2.x détecté')
  })
})
