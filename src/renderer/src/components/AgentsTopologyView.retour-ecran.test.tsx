// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentsTopologyView } from './AgentsTopologyView'

/**
 * AGENTS STUDIO RELIT L'ORCHESTRATEUR QUAND ON Y REVIENT (2026-11-04).
 *
 * La vue reste montée quand on la quitte et n'écoute les changements de rôles que visible. Vécu :
 * l'effort « high » choisi dans l'en-tête d'un chat était bien écrit (roles.json.bak, 16:11:08),
 * mais Agents Studio, revenu à l'écran, affichait toujours « xhigh ». Ce test rejoue ce parcours :
 * vue visible → cachée → orchestrateur changé ailleurs (événement manqué) → vue de nouveau visible.
 */
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const models = [
  {
    id: 'opus',
    provider: 'claude',
    model: 'claude-opus-5-5',
    label: 'Opus 5.5',
    reasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
    defaultReasoningEffort: 'high'
  }
]

const topologie = (effort: string): Record<string, unknown> => ({
  version: 1,
  orchestrator: {
    slotId: 'orchestrator',
    provider: 'claude',
    modelId: 'opus',
    reasoningEffort: effort
  },
  subagents: [
    { slotId: 'subagent-1', provider: 'claude', modelId: 'opus', reasoningEffort: 'low' }
  ],
  panels: { scout: [], frame: [], terrain: [], judge: [] }
})

let container: HTMLDivElement
let root: Root

const flush = (): Promise<void> =>
  act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })

const rendre = async (active: boolean): Promise<void> => {
  await act(async () => root.render(<AgentsTopologyView active={active} />))
  await flush()
}

const valeursAffichees = (): string[] =>
  Array.from(container.querySelectorAll('select')).map((select) => select.value)

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('Agents Studio — retour à l’écran', () => {
  it('affiche l’orchestrateur changé pendant que la vue était cachée', async () => {
    let effortCourant = 'xhigh'
    const topology = vi.fn(async () => topologie(effortCourant))
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      models: async () => models,
      topology,
      roles: async () => ({}),
      profiles: async () => [],
      // Aucun événement n'est rejoué : c'est exactement le cas d'une vue cachée qui l'a manqué.
      onAppEvent: () => () => undefined,
      setTopology: vi.fn(async (next: unknown) => next)
    }

    await rendre(true)
    expect(valeursAffichees()).toContain('xhigh')

    await rendre(false)
    effortCourant = 'high' // posé depuis l'en-tête d'un chat pendant que la vue est cachée
    await rendre(true)

    expect(valeursAffichees()).toContain('high')
    expect(valeursAffichees()).not.toContain('xhigh')
  })

  it('le premier montage ne lit la topologie qu’une fois', async () => {
    const topology = vi.fn(async () => topologie('xhigh'))
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      models: async () => models,
      topology,
      roles: async () => ({}),
      profiles: async () => [],
      onAppEvent: () => () => undefined,
      setTopology: vi.fn(async (next: unknown) => next)
    }
    await rendre(true)
    expect(topology).toHaveBeenCalledTimes(1)
  })
})
