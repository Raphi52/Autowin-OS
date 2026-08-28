// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { TestsView } from './TestsView'

/**
 * L'onglet LATENCE : l'outillage de mesure des lenteurs vit DANS la vue Tests, a cote des suites.
 * Il montre des faits lus (journal de jalons cote main) et une sonde de reactivite du renderer.
 */
async function rendre(): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(TestsView, { active: true }))
    await Promise.resolve()
    await Promise.resolve()
  })
  return container
}

const rapport = {
  disponible: true,
  source: 'C:/data/turn-timing.jsonl',
  tours: 42,
  lignesIllisibles: 0,
  segments: [
    { nom: 'snapshot', n: 42, p50Ms: 229, p95Ms: 1288, maxMs: 19250 },
    { nom: 'ragBrain', n: 42, p50Ms: 81, p95Ms: 356, maxMs: 15245 }
  ],
  suspects: [{ nom: 'snapshot', n: 42, p50Ms: 229, p95Ms: 1288, maxMs: 19250 }]
}

describe('TestsView — onglet Latence', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  it('affiche les segments LUS et designe le suspect', async () => {
    const perfTurnLatency = vi.fn(async () => rapport)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { testProjects: vi.fn(async () => []), perfTurnLatency }
    })
    const container = await rendre()
    // Entree qui ferait echouer un onglet decoratif : tant qu'on n'a pas clique, la vue Tests
    // reste sur les suites ; apres le clic, le rapport REEL doit apparaitre.
    expect(container.querySelector('[data-testid="perf-panel"]')).toBeNull()
    const onglet = container.querySelector('[data-testid="tests-tab-latence"]') as HTMLButtonElement
    expect(onglet).not.toBeNull()
    await act(async () => {
      onglet.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(perfTurnLatency).toHaveBeenCalled()
    const panneau = container.querySelector('[data-testid="perf-panel"]')
    expect(panneau?.textContent).toContain('snapshot')
    expect(panneau?.textContent).toContain('1288')
    expect(container.querySelector('[data-testid="perf-suspects"]')?.textContent).toContain(
      'snapshot'
    )
  })

  it('journal absent : le dit, au lieu d’afficher un zero rassurant', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        testProjects: vi.fn(async () => []),
        perfTurnLatency: vi.fn(async () => ({
          disponible: false,
          source: 'x',
          tours: 0,
          lignesIllisibles: 0,
          segments: [],
          suspects: []
        }))
      }
    })
    const container = await rendre()
    const onglet = container.querySelector('[data-testid="tests-tab-latence"]') as HTMLButtonElement
    await act(async () => {
      onglet.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(container.querySelector('[data-testid="perf-indisponible"]')).not.toBeNull()
  })
})
