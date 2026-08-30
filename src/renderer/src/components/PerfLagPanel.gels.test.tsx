// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { PerfLagPanel } from './PerfLagPanel'

/**
 * L'onglet Latence doit NOMMER le coupable d'un « ce programme ne repond pas », pas le deduire.
 * Ces tests verrouillent les deux etats qui comptent : un journal absent le DIT, un journal present
 * classe les operations par temps de gel CUMULE.
 */
const jalonsVides = {
  tours: 0,
  lignesIllisibles: 0,
  segments: [],
  suspects: [],
  disponible: false,
  source: 'C:/data/turn-timing.jsonl'
}

async function rendreAvec(gels: unknown): Promise<HTMLDivElement> {
  ;(window as unknown as { api: unknown }).api = {
    perfTurnLatency: async () => jalonsVides,
    perfGels: async () => gels
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(PerfLagPanel))
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
  return container
}

afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
  document.body.innerHTML = ''
})

describe('PerfLagPanel — gels du process principal', () => {
  it('DIT qu’aucun journal n’existe au lieu d’afficher un zero rassurant', async () => {
    const c = await rendreAvec({
      gels: 0,
      pireMs: 0,
      cumulMs: 0,
      parOperation: [],
      lignesIllisibles: 0,
      disponible: false,
      source: 'C:/data/gels.jsonl'
    })
    expect(c.querySelector('[data-testid="perf-gels-indisponible"]')).toBeTruthy()
  })

  it('classe les operations coupables par temps de gel cumule', async () => {
    const c = await rendreAvec({
      gels: 3,
      pireMs: 5200,
      cumulMs: 7800,
      parOperation: [
        { operation: 'snapshot:travauxNonPublies', gels: 2, cumulMs: 6500, pireMs: 5200 },
        { operation: 'snapshot:runs', gels: 1, cumulMs: 1300, pireMs: 1300 }
      ],
      lignesIllisibles: 0,
      disponible: true,
      source: 'C:/data/gels.jsonl'
    })
    const resume = c.querySelector('[data-testid="perf-gels-resume"]')
    expect(resume?.textContent).toContain('3 gel(s)')
    expect(resume?.textContent).toContain('5200 ms')
    const premiere = c.querySelectorAll('[data-testid="perf-gels"] tbody tr')[0]
    expect(premiere?.textContent).toContain('snapshot:travauxNonPublies')
  })
})

/*
 * Un gel NON imputable (process desordonnance, machine en veille) est reel pour l'utilisateur : il
 * est exclu de l'ATTRIBUTION par operation, jamais de l'affichage. Sans ce verrou, l'exclusion
 * transformerait « 36 min figees » en « aucun blocage » — un faux vert.
 */
describe('PerfLagPanel — les gels non imputables restent VISIBLES', () => {
  it('ne dit pas « aucun blocage » quand des gels non imputables existent', async () => {
    const c = await rendreAvec({
      gels: 0,
      pireMs: 0,
      cumulMs: 0,
      parOperation: [],
      lignesIllisibles: 0,
      gelsNonImputables: 3,
      msNonImputables: 51_000,
      disponible: true,
      source: 'C:/data/gels.jsonl'
    })
    expect(c.querySelector('[data-testid="perf-gels-vide"]')).toBeNull()
    const hors = c.querySelector('[data-testid="perf-gels-non-imputables"]')
    expect(hors?.textContent).toContain('3')
    expect(hors?.textContent).toContain('51000')
  })

  it('reste muet sur cette ligne quand tout est imputable', async () => {
    const c = await rendreAvec({
      gels: 1,
      pireMs: 2000,
      cumulMs: 2000,
      parOperation: [{ operation: 'ipc:git:graph', gels: 1, cumulMs: 2000, pireMs: 2000 }],
      lignesIllisibles: 0,
      gelsNonImputables: 0,
      msNonImputables: 0,
      disponible: true,
      source: 'C:/data/gels.jsonl'
    })
    expect(c.querySelector('[data-testid="perf-gels-non-imputables"]')).toBeNull()
  })
})
