// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { CostConfidenceTimeline } from './CostConfidenceTimeline'
import type { OrchestrationStep } from '../../../main/orchestrator'

let container: HTMLDivElement
let root: Root

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})

function render(steps: OrchestrationStep[]): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(createElement(CostConfidenceTimeline, { steps })))
}

describe('CostConfidenceTimeline', () => {
  it('rend une barre par phase avec les totaux et le verdict', () => {
    render([
      { step: 'exec', role: 'subagent', detail: 'phase frame', durationMs: 100, costUsd: 0.1, tokens: 500 },
      { step: 'exec', role: 'subagent', detail: 'phase build', durationMs: 200, costUsd: 0.2, tokens: 800 },
      { step: 'judge', role: 'judge', detail: 'validé', durationMs: 50, costUsd: 0.05, tokens: 100 }
    ])
    const segs = container.querySelectorAll('[data-testid="cc-seg"]')
    expect(segs).toHaveLength(3)
    expect(container.textContent).toContain('frame')
    expect(container.textContent).toContain('build')
    expect(container.textContent).toContain('validé')
    // Le waterfall place la 2e barre après la 1re (offset > 0).
    expect((segs[1] as HTMLElement).style.left).not.toBe('0%')
  })

  it('un step en échec est marqué ko', () => {
    render([{ step: 'exec', role: 'subagent', status: 'failed', durationMs: 10 }])
    expect(container.querySelector('.cc-seg.ko')).toBeTruthy()
  })

  it('aucune phase → état vide', () => {
    render([])
    expect(container.textContent).toContain('Aucune phase')
  })
})
