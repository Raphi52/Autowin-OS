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

const bloc = (cible: string): HTMLElement => {
  const trouve = container.querySelector<HTMLElement>(`[data-testid="topology-couvre-${cible}"]`)
  if (!trouve) throw new Error(`aucun bloc « ce que ça couvre » pour ${cible}`)
  return trouve
}

describe('Agents Studio — ce que couvre chaque rôle', () => {
  it('chaque panneau a son bloc, rangé dans le panneau qu’il explique', () => {
    for (const cible of ['orchestrator', 'subagents', 'scout', 'frame', 'terrain', 'judge']) {
      expect(bloc(cible).closest(`[data-target="${cible}"]`)).not.toBeNull()
      expect(bloc(cible).textContent).toContain('Ce que ça couvre')
    }
  })

  it('l’orchestrateur dit qu’il répond dans le chat et renvoie les petites tâches ailleurs', () => {
    const texte = bloc('orchestrator').textContent ?? ''
    expect(texte).toContain('te répond dans le Chat')
    expect(texte).toContain('petites tâches')
  })

  it('les sous-agents couvrent build, clean et toute étape restée vide', () => {
    const texte = bloc('subagents').textContent ?? ''
    expect(texte).toContain('build')
    expect(texte).toContain('clean')
    expect(texte).toContain('L’orchestrateur fait le travail lui-même.')
  })

  it('un panel vide renvoie aux sous-agents, et le juge vide prévient de l’auto-jugement', () => {
    for (const cible of ['scout', 'frame', 'terrain']) {
      expect(bloc(cible).textContent).toContain('Le modèle des Sous-agents fait l’étape seul.')
    }
    expect(bloc('judge').textContent).toContain('juge son propre travail')
    expect(bloc('terrain').textContent).toContain('seulement quand tu la demandes')
  })

  it('le mot porteur de chaque ligne est en gras', () => {
    for (const cible of ['orchestrator', 'subagents', 'scout', 'frame', 'terrain', 'judge']) {
      expect(bloc(cible).querySelectorAll('dd b').length).toBeGreaterThan(0)
    }
  })
})
