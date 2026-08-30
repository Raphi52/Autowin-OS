// @vitest-environment happy-dom
/**
 * Variante A : chaque carte d'étape porte une ICÔNE de type (en plus du liseré de statut)
 * et, quand l'étape contient plusieurs sous-étapes, un ÉTAGE interne (rail) les liste.
 *
 * Entrées qui feraient échouer une correction fausse :
 *  - l'étape `frame` (sans preuve ni obstacle) ne doit PORTER AUCUN rail : une implémentation
 *    qui rend le rail inconditionnellement passerait un test ne regardant que l'étape `build` ;
 *  - l'icône de `scout` doit différer de celle de `build` : une icône constante passerait
 *    un test qui n'en vérifierait qu'une.
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
  { step: 'exec', role: 'scout', detail: 'phase scout', status: 'completed', text: 'Exploré.' },
  { step: 'exec', role: 'frame', detail: 'phase frame', status: 'completed', text: 'Cadré.' },
  {
    step: 'exec',
    role: 'build',
    detail: 'phase build',
    status: 'failed',
    error: '⛔ Bloqué : vitest introuvable',
    evidence: [
      { type: 'command', kind: 'shell', ok: true, summary: 'v', command: 'npx vitest', exitCode: 0 },
      { type: 'file', kind: 'file', ok: true, summary: 'w', path: 'src/a.ts' }
    ]
  }
]

const cards = (): HTMLDetailsElement[] =>
  Array.from(container.querySelectorAll<HTMLDetailsElement>('details[data-testid="run-progress-step"]'))

describe('RunProgress — étages + icônes', () => {
  it('donne à chaque carte une icône de type distincte par phase', () => {
    act(() => root.render(createElement(RunProgress, { steps })))
    const icons = cards().map(
      (c) => c.querySelector('[data-testid="run-progress-icon"]')?.textContent ?? ''
    )
    expect(icons).toHaveLength(3)
    expect(icons.every((i) => i.length > 0)).toBe(true)
    expect(icons[0]).not.toBe(icons[2])
  })

  it('n’ouvre un étage QUE pour les étapes qui ont des sous-étapes', () => {
    act(() => root.render(createElement(RunProgress, { steps })))
    const [scout, frame, build] = cards()
    expect(frame.querySelector('[data-testid="run-progress-substeps"]')).toBeNull()
    expect(scout.querySelector('[data-testid="run-progress-substeps"]')).toBeNull()
    const rail = build.querySelector('[data-testid="run-progress-substeps"]')
    expect(rail).not.toBeNull()
    const subs = rail!.querySelectorAll('[data-testid="run-progress-substep"]')
    expect(subs).toHaveLength(3) // 1 obstacle + 2 preuves
    subs.forEach((s) =>
      expect(s.querySelector('[data-testid="run-progress-substep-icon"]')?.textContent).toBeTruthy()
    )
    expect(build.querySelector('[data-testid="run-progress-substeps"]')!.closest('details')).toBe(build)
  })
})
