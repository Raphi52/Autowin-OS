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

  it('cliquer une brique de skill l’ajoute réellement au graphe', () => {
    render({ skills: ['think'] })
    act(() => container.querySelector<HTMLElement>('[data-testid="wf-add-think"]')!.click())
    const graphe = onChange.mock.calls.at(-1)![0] as CanvasGraph
    expect(graphe.nodes.map((n) => n.phase)).toContain('think')
  })
})
