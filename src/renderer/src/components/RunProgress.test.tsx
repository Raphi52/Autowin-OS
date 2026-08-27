// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RunProgress } from './RunProgress'
import type { OrchStep } from './chat-view-model'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const steps: OrchStep[] = [
  {
    step: 'exec',
    role: 'frame',
    detail: 'phase frame',
    status: 'completed',
    text: 'Cadré.',
    thinking: 'Je pèse deux options.'
  },
  {
    step: 'exec',
    role: 'build',
    detail: 'phase build',
    status: 'failed',
    error: '⛔ Bloqué : vitest introuvable',
    evidence: [
      {
        type: 'command',
        kind: 'shell',
        ok: false,
        summary: 'vitest',
        command: 'npx vitest',
        exitCode: 1
      }
    ]
  }
]

describe('RunProgress', () => {
  it('rend une timeline avec états, obstacles, pensée et phase en cours', () => {
    act(() =>
      root.render(
        createElement(RunProgress, { steps, activePhase: { step: 'judge', role: 'judge' } })
      )
    )
    const items = container.querySelectorAll('[data-testid="run-progress-step"]')
    expect(items).toHaveLength(3)
    expect(items[1].getAttribute('data-state')).toBe('failed')
    expect(items[2].getAttribute('data-state')).toBe('running')
    expect(container.textContent).toContain('⛔ Bloqué : vitest introuvable')
    expect(container.textContent).toContain('Je pèse deux options.')
    expect(container.textContent).toContain('$ npx vitest — exit 1')
    // Le bandeau de suivi doit chiffrer l'avancée (sinon ce n'est qu'une liste) :
    expect(container.querySelector('[data-testid="run-progress-recap"]')?.textContent).toContain(
      '1'
    )
  })

  it('affiche un état vide explicite plutôt qu’un cadre muet', () => {
    act(() => root.render(createElement(RunProgress, { steps: [] })))
    expect(container.querySelector('[data-testid="run-progress-empty"]')).not.toBeNull()
  })
})
