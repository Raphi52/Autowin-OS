// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { RunInspector } from './RunInspector'

describe('RunInspector', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null

  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    await act(async () => root?.unmount())
    container?.remove()
    root = null
    container = null
  })

  it('renders health counters, section navigation and explicit missing sections', async () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        createElement(RunInspector, {
          source: '## Besoin\n\n- [x] Une preuve.\n\n## Journal\n\n[2026-07-21] Vérifié.',
          status: 'open',
          regime: 'standard',
          dodChecked: 1,
          dodTotal: 1,
          journalEvents: 1,
          defauts: 0
        })
      )
    })

    expect(container.textContent).toContain('DoD 1/1')
    expect(container.textContent).toContain('Journal 1')
    expect(container.textContent).toContain('Défauts 0')
    expect(container.querySelector('a[href="#run-section-journal"]')).not.toBeNull()
    expect(container.textContent).toContain('Section absente.')
  })
})
