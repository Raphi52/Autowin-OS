// @vitest-environment happy-dom
/**
 * Lisibilité du suivi : UNE LIGNE par étape, dépliable, le détail DEDANS.
 * Rouge attendu si le détail (obstacles / preuves / raisonnement) est rendu hors du <details>,
 * ou si une étape terminée s'ouvre d'office (le mur de texte que l'utilisateur constate).
 */
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
      { type: 'command', kind: 'shell', ok: false, summary: 'v', command: 'npx vitest', exitCode: 1 }
    ]
  }
]

describe('RunProgress — une ligne par étape, dépliable', () => {
  it('replie chaque étape terminée et loge tout le détail DANS le <details>', () => {
    act(() => root.render(createElement(RunProgress, { steps })))
    const items = Array.from(
      container.querySelectorAll<HTMLDetailsElement>('details[data-testid="run-progress-step"]')
    )
    expect(items).toHaveLength(2)

    // 1) l'étape terminée est REPLIÉE : sa ligne ne montre pas le raisonnement
    const frame = items[0]
    expect(frame.open).toBe(false)
    const frameSummary = frame.querySelector('summary')!
    expect(frameSummary.textContent).not.toContain('Je pèse deux options.')
    expect(frameSummary.textContent).toContain('cadrage')

    // 2) le détail existe quand même, mais DANS le details, hors du summary
    expect(frame.textContent).toContain('Je pèse deux options.')

    // 3) une étape en échec s'ouvre d'office (sinon l'obstacle est invisible)
    expect(items[1].open).toBe(true)
    expect(items[1].querySelector('summary')!.textContent).toContain('1 obstacle')

    // 4) aucun détail ne fuit hors des <details>
    items.forEach((d) => d.remove())
    expect(container.textContent).not.toContain('npx vitest')
    expect(container.textContent).not.toContain('Je pèse deux options.')
  })
})
