// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowCanvas, type CanvasGraph, type WorkflowCanvasProps } from './WorkflowCanvas'
import { PIPELINE_PHASES } from '../../../shared/pipeline-phases'

/**
 * La palette de briques était une liste ÉCRITE À LA MAIN : une skill installée sur le disque ne
 * pouvait donc jamais y apparaître. Elle se déduit désormais de l'inventaire réel, et une skill
 * future s'y ajoute seule.
 */
let container: HTMLDivElement
let root: Root
let onChange: ReturnType<typeof vi.fn>

const chaine: CanvasGraph = {
  entry: 'frame-1',
  nodes: [{ id: 'frame-1', phase: 'frame' }],
  edges: []
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  onChange = vi.fn()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(props: Partial<WorkflowCanvasProps> = {}): void {
  act(() => {
    root.render(createElement(WorkflowCanvas, { graph: chaine, onChange, ...props }))
  })
}
const briques = (): string[] =>
  [...container.querySelectorAll('[data-testid^="wf-add-"]')].map((el) =>
    el.getAttribute('data-testid')!.replace('wf-add-', '')
  )

describe('briques de skills', () => {
  it('sans inventaire, la palette est exactement les huit phases', () => {
    render()
    expect(briques()).toEqual([...PIPELINE_PHASES])
  })

  it('une skill du disque apparaît comme brique, après les phases', () => {
    render({ skills: ['think', 'learn'] })
    expect(briques()).toEqual([...PIPELINE_PHASES, 'think', 'learn'])
  })

  it('une skill homonyme d’une phase ne la double pas', () => {
    render({ skills: ['build', 'think'] })
    expect(briques()).toEqual([...PIPELINE_PHASES, 'think'])
  })

  it('un nœud skill porte la classe neutre, pas une couleur de phase inventée', () => {
    render({
      graph: { entry: 'n1', nodes: [{ id: 'n1', phase: 'think' }], edges: [] },
      skills: ['think']
    })
    const noeud = container.querySelector('.wf-node')!
    expect(noeud.className).toContain('wf-ph-skill')
    expect(noeud.className).not.toContain('wf-ph-think')
  })

  it('les skills ont leur propre bloc, sous les phases', () => {
    render({ skills: ['think', 'learn'] })
    const ids = (testId: string): string[] =>
      [...container.querySelectorAll(`[data-testid="${testId}"] [data-testid^="wf-add-"]`)].map(
        (el) => el.getAttribute('data-testid')!.replace('wf-add-', '')
      )
    expect(ids('wf-palette')).toEqual([...PIPELINE_PHASES])
    expect(ids('wf-palette-skills')).toEqual(['think', 'learn'])
  })

  it('cliquer une brique de skill l’ajoute réellement au graphe', () => {
    render({ skills: ['think'] })
    act(() => container.querySelector<HTMLElement>('[data-testid="wf-add-think"]')!.click())
    const graphe = onChange.mock.calls.at(-1)![0] as CanvasGraph
    expect(graphe.nodes.map((n) => n.phase)).toContain('think')
  })
})

/**
 * Une brique sans agent réglé n'affichait AUCUN sélecteur de modèle — on ne pouvait
 * choisir le modèle de `think` qu'en passant le nombre d'agents à 2 puis à 1.
 */
describe('modèle de chaque brique', () => {
  const modeles = [
    { provider: 'claude', id: 'claude-haiku' },
    { provider: 'codex', id: 'gpt-5' }
  ]
  const ouvrir = (id: string): void =>
    act(() => container.querySelector<HTMLElement>(`[data-testid="wf-open-${id}"]`)!.click())
  const choisir = (testId: string, valeur: string): void => {
    const liste = container.querySelector<HTMLSelectElement>(`[data-testid="${testId}"]`)!
    act(() => {
      liste.value = valeur
      liste.dispatchEvent(new Event('change', { bubbles: true }))
    })
  }

  it('une brique skill sans agent réglé propose le choix du modèle, sans angle vide', () => {
    render({
      graph: { entry: 'think-1', nodes: [{ id: 'think-1', phase: 'think' }], edges: [] },
      skills: ['think'],
      models: modeles
    })
    ouvrir('think-1')
    expect(container.querySelector('[data-testid="wf-agent-model-think-1-0"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="wf-agent-effort-think-1-0"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="wf-agent-persona-think-1-0"]')).toBeNull()

    choisir('wf-agent-model-think-1-0', 'gpt-5')
    const graphe = onChange.mock.calls.at(-1)![0] as CanvasGraph
    expect(graphe.nodes[0].agents).toEqual([{ provider: 'codex', model: 'gpt-5' }])
  })

  it('une phase sans agent réglé garde son choix d’angle et de modèle', () => {
    render({ models: modeles })
    ouvrir('frame-1')
    expect(container.querySelector('[data-testid="wf-agent-model-frame-1-0"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="wf-agent-persona-frame-1-0"]')).not.toBeNull()
  })

  it('revenir au modèle par défaut retire l’agent vide du profil', () => {
    render({
      graph: {
        entry: 'think-1',
        nodes: [{ id: 'think-1', phase: 'think', agents: [{ provider: 'codex', model: 'gpt-5' }] }],
        edges: []
      },
      skills: ['think'],
      models: modeles
    })
    ouvrir('think-1')
    choisir('wf-agent-model-think-1-0', '')
    const graphe = onChange.mock.calls.at(-1)![0] as CanvasGraph
    expect(graphe.nodes[0].agents).toBeUndefined()
  })
})
