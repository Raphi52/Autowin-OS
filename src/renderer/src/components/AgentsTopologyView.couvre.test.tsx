// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentsTopologyView } from './AgentsTopologyView'

/**
 * CHAQUE PANNEAU D'AGENTS STUDIO DIT CE QU'IL COUVRE.
 *
 * Une ligne comme « Un seul modèle pilote et consolide » ne disait pas QUELLES étapes d'un travail
 * suivent quel bloc, ni qui prend le relais quand un bloc reste vide. Chaque panneau porte donc un
 * bloc « Ce que ça couvre » ; ce test fige les faits qui y sont affirmés, lus dans le processus
 * principal (`runtimeRoleSlots`, `bindingDeRepliPourPhase`, `task-regime.ts`).
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
    reasoningEfforts: ['low', 'high'],
    defaultReasoningEffort: 'high'
  }
]

let container: HTMLDivElement
let root: Root

beforeEach(async () => {
  window.localStorage.clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
    models: async () => models,
    topology: async () => ({
      version: 1,
      orchestrator: {
        slotId: 'orchestrator',
        provider: 'claude',
        modelId: 'opus',
        reasoningEffort: 'high'
      },
      subagents: [],
      panels: { scout: [], frame: [], terrain: [], judge: [] }
    }),
    profiles: async () => [],
    onAppEvent: () => () => undefined,
    setTopology: vi.fn(async (next: unknown) => next)
  }
  await act(async () => root.render(<AgentsTopologyView active />))
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

const CIBLES = ['orchestrator', 'subagents']

const bloc = (cible: string): HTMLElement => {
  const trouve = container.querySelector<HTMLElement>(`[data-testid="topology-couvre-${cible}"]`)
  if (!trouve) throw new Error(`aucun bloc « ce que ça couvre » pour ${cible}`)
  return trouve
}

describe('Agents Studio — ce que couvre chaque rôle', () => {
  it('chaque panneau a son bloc, rangé dans le panneau qu’il explique', () => {
    for (const cible of CIBLES) {
      expect(bloc(cible).closest(`[data-target="${cible}"]`)).not.toBeNull()
      expect(bloc(cible).textContent).toContain('Ce que ça couvre')
    }
  })

  it('l’orchestrateur dit qu’il répond dans le chat et renvoie les petites tâches ailleurs', () => {
    const texte = bloc('orchestrator').textContent ?? ''
    expect(texte).toContain('te répond dans le Chat')
    expect(texte).toContain('petites tâches')
  })

  it('les sous-agents couvrent toutes les étapes, contrôle final compris', () => {
    const texte = bloc('subagents').textContent ?? ''
    for (const etape of ['scout', 'frame', 'build', 'clean', 'judge'])
      expect(texte).toContain(etape)
    expect(texte).toContain('juge son propre travail')
    expect(texte).toContain('L’orchestrateur fait le travail lui-même.')
  })

  it('les panneaux Scouts, Frame, Judges et Terrain n’existent plus', () => {
    for (const cible of ['scout', 'frame', 'judge', 'terrain']) {
      expect(container.querySelector(`[data-target="${cible}"]`)).toBeNull()
      expect(container.querySelector(`[data-testid="topology-couvre-${cible}"]`)).toBeNull()
    }
  })

  it('les sous-agents nomment chaque skill qui lance des sous-agents, et leur vrai modèle', () => {
    const texte = bloc('subagents').textContent ?? ''
    for (const skill of [
      '/arena',
      '/scout',
      '/steal',
      '/frame',
      '/draft',
      '/remake',
      '/kaizen',
      '/judge'
    ]) {
      expect(texte).toContain(skill)
    }
    expect(texte).toContain('qui joue la skill')
  })

  it('le mot porteur de chaque ligne est en gras', () => {
    for (const cible of CIBLES) {
      expect(bloc(cible).querySelectorAll('dd b').length).toBeGreaterThan(0)
    }
  })

  it('chaque bloc se replie seul, et l’état est retenu sous le nom de son rôle', async () => {
    const titre = bloc('subagents').querySelector('button')
    expect(titre?.getAttribute('aria-expanded')).toBe('true')
    await act(async () => titre?.click())
    expect(bloc('subagents').querySelector('dl')).toBeNull()
    expect(bloc('orchestrator').querySelector('dl')).not.toBeNull()
    expect(
      JSON.parse(window.localStorage.getItem('autowin.ceQueCaCouvre.replies') ?? '{}')
    ).toEqual({ 'topologie-subagents': true })
  })
})
