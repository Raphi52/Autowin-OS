// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowCanvas, type CanvasGraph, type WorkflowCanvasProps } from './WorkflowCanvas'

let container: HTMLDivElement
let root: Root
let onChange: ReturnType<typeof vi.fn>

const chaine: CanvasGraph = {
  entry: 'frame-1',
  nodes: [
    { id: 'frame-1', phase: 'frame' },
    { id: 'build-1', phase: 'build' },
    { id: 'judge-1', phase: 'judge' }
  ],
  edges: [
    { from: 'frame-1', to: 'build-1', when: 'always' },
    { from: 'build-1', to: 'judge-1', when: 'always' }
  ]
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
const q = <T extends Element>(sel: string): T => container.querySelector<T>(sel)!
const clic = (id: string): void => {
  act(() => q<HTMLElement>(`[data-testid="${id}"]`).click())
}
const dernier = (): CanvasGraph => onChange.mock.calls[onChange.mock.calls.length - 1][0]

describe('composer la chaîne', () => {
  it('la palette ajoute une phase au bout, et la relie', () => {
    render()
    clic('wf-add-clean')
    expect(dernier().nodes.map((n) => n.phase)).toEqual(['frame', 'build', 'judge', 'clean'])
    expect(dernier().edges.filter((e) => e.when === 'always')).toHaveLength(3)
  })

  it('deux phases identiques restent deux nœuds distincts', () => {
    render()
    clic('wf-add-build')
    const ids = dernier().nodes.map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('retirer un nœud RECOMPOSE la chaîne au lieu de la laisser trouée', () => {
    render()
    clic('wf-remove-build-1')
    expect(dernier().nodes.map((n) => n.id)).toEqual(['frame-1', 'judge-1'])
    expect(dernier().edges).toEqual([{ from: 'frame-1', to: 'judge-1', when: 'always' }])
  })

  it('retirer le premier nœud déplace le point d’entrée', () => {
    render()
    clic('wf-remove-frame-1')
    expect(dernier().entry).toBe('build-1')
  })

  it('glisser-déposer réordonne et réenchaîne', () => {
    render()
    const source = q<HTMLElement>('[data-testid="wf-node-judge-1"]')
    const cible = q<HTMLElement>('[data-testid="wf-node-frame-1"]')
    // Deux gestes séparés : dans un même lot de rendu, le dépôt lirait un état pas encore appliqué.
    act(() => {
      source.dispatchEvent(new Event('dragstart', { bubbles: true }))
    })
    act(() => {
      cible.dispatchEvent(new Event('drop', { bubbles: true }))
    })
    expect(dernier().nodes.map((n) => n.phase)).toEqual(['judge', 'frame', 'build'])
    expect(dernier().edges[0]).toEqual({ from: 'judge-1', to: 'frame-1', when: 'always' })
  })
})

describe('ouvrir un nœud pour voir ses agents', () => {
  it('le détail est fermé par défaut et s’ouvre au clic', () => {
    render()
    expect(container.querySelector('[data-testid="wf-detail-judge-1"]')).toBeNull()
    clic('wf-open-judge-1')
    expect(container.querySelector('[data-testid="wf-detail-judge-1"]')).not.toBeNull()
  })

  it('régler le nombre d’agents le persiste dans le nœud', () => {
    render()
    clic('wf-open-judge-1')
    const champ = q<HTMLInputElement>('[data-testid="wf-agents-judge-1"]')
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(champ, '3')
      champ.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(dernier().nodes.find((n) => n.id === 'judge-1')?.agents).toHaveLength(3)
  })
})

describe('tracer un retour', () => {
  it('un retour se trace vers un nœud DÉJÀ passé, jamais vers l’avant', () => {
    render()
    clic('wf-open-judge-1')
    // Les cibles proposées sont celles qui précèdent : un « retour » vers l'avant n'en est pas un.
    expect(container.querySelector('[data-testid="wf-return-judge-1-build-1"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="wf-return-frame-1-judge-1"]')).toBeNull()
  })

  it('un retour naît BORNÉ — composer sans limite serait refusé d’office', () => {
    render()
    clic('wf-open-judge-1')
    clic('wf-return-judge-1-build-1')
    const retour = dernier().edges.find((e) => e.when === 'red')
    expect(retour).toMatchObject({ from: 'judge-1', to: 'build-1', maxTraversals: 1 })
  })

  it('la limite se règle', () => {
    render({ graph: { ...chaine, edges: [...chaine.edges, { from: 'judge-1', to: 'build-1', when: 'red', maxTraversals: 1 }] } })
    const champ = q<HTMLInputElement>('[data-testid="wf-bound-judge-1-build-1"]')
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(champ, '3')
      champ.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(dernier().edges.find((e) => e.when === 'red')?.maxTraversals).toBe(3)
  })

  it('une limite vide ou nulle retombe à 1, jamais à zéro', () => {
    render({ graph: { ...chaine, edges: [...chaine.edges, { from: 'judge-1', to: 'build-1', when: 'red', maxTraversals: 2 }] } })
    const champ = q<HTMLInputElement>('[data-testid="wf-bound-judge-1-build-1"]')
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(champ, '0')
      champ.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(dernier().edges.find((e) => e.when === 'red')?.maxTraversals).toBe(1)
  })

  it('retirer un nœud efface les retours qui pointaient dessus', () => {
    // Sinon une arête tracerait vers le vide et le graphe deviendrait illisible.
    render({ graph: { ...chaine, edges: [...chaine.edges, { from: 'judge-1', to: 'build-1', when: 'red', maxTraversals: 1 }] } })
    clic('wf-remove-build-1')
    expect(dernier().edges.filter((e) => e.when === 'red')).toEqual([])
  })
})

describe('ne jamais accepter en silence', () => {
  it('un défaut se lit SUR le nœud fautif, pas dans un message global', () => {
    render({ defects: [{ target: 'judge-1', message: 'Quorum 3 impossible pour 2 agent(s).' }] })
    expect(q('[data-testid="wf-node-judge-1"]').textContent).toContain('Quorum 3 impossible')
    expect(q('[data-testid="wf-node-judge-1"]').className).toContain('is-broken')
  })

  it('un défaut sans nœud désigné s’affiche quand même', () => {
    render({ defects: [{ message: 'Le workflow est vide.' }] })
    expect(q('[data-testid="wf-defects"]').textContent).toContain('Le workflow est vide')
  })

  // Les deux tests de la mention « inerte » ont été retirés avec la fonctionnalité : depuis que
  // l'orchestrateur marche le graphe, TOUT retour composable est joué, et la mention ne pouvait plus
  // apparaître. Ce que le moteur fait vraiment de ces retours est prouvé dans `workflow-walk.test.ts`.

  it('les arêtes AVANT sont tracées d’après les ARÊTES, pas d’après l’ordre du tableau', () => {
    // Un graphe dont l'ordre du tableau contredit les arêtes : frame → judge → build en arêtes,
    // mais [frame, build, judge] en tableau. Dessiner nœud[i]→nœud[i+1] afficherait frame→build,
    // une topologie que le moteur ne jouera jamais.
    render({
      graph: {
        entry: 'frame-1',
        nodes: [
          { id: 'frame-1', phase: 'frame' },
          { id: 'build-1', phase: 'build' },
          { id: 'judge-1', phase: 'judge' }
        ],
        edges: [
          { from: 'frame-1', to: 'judge-1', when: 'always' },
          { from: 'judge-1', to: 'build-1', when: 'always' }
        ]
      }
    })
    const traces = [...container.querySelectorAll('path.wf-wire')].length
    // Exactement 2 arêtes avant dessinées — celles du graphe, pas les 2 de la chaîne du tableau.
    expect(traces).toBe(2)
  })

  it('deux retours ne se superposent pas : chacun a sa voie dans le couloir', () => {
    render({
      graph: {
        ...chaine,
        edges: [
          ...chaine.edges,
          { from: 'judge-1', to: 'build-1', when: 'red', maxTraversals: 1 },
          { from: 'judge-1', to: 'frame-1', when: 'red', maxTraversals: 1 }
        ]
      }
    })
    const retours = [...container.querySelectorAll('path.wf-wire-red')].map((p) =>
      p.getAttribute('d')
    )
    expect(retours).toHaveLength(2)
    // Le segment vertical du couloir doit différer, sinon les deux flèches se recouvrent au pixel.
    const voies = retours.map((d) => /H(\d+(?:\.\d+)?)/.exec(d ?? '')?.[1])
    expect(voies[0]).not.toBe(voies[1])
  })
})

describe('un modèle par agent', () => {
  const troisAgents: CanvasGraph = {
    entry: 'judge-1',
    nodes: [
      {
        id: 'judge-1',
        phase: 'judge',
        agents: [{ provider: 'claude' }, { provider: 'claude' }],
        quorum: 2
      }
    ],
    edges: []
  }
  const saisir = (id: string, valeur: string): void => {
    const champ = q<HTMLInputElement>(`[data-testid="${id}"]`)
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(champ, valeur)
      champ.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('chaque agent a son propre modèle — sinon trois juges seraient trois fois le même', () => {
    render({ graph: troisAgents })
    clic('wf-open-judge-1')
    saisir('wf-agent-model-judge-1-1', 'codex-mini')
    const agents = dernier().nodes[0].agents!
    expect(agents[1].model).toBe('codex-mini')
    expect(agents[0].model).toBeUndefined() // l'autre est intact
  })

  it('augmenter le nombre d’agents PRÉSERVE les modèles déjà choisis', () => {
    render({
      graph: {
        ...troisAgents,
        nodes: [{ ...troisAgents.nodes[0], agents: [{ provider: 'claude', model: 'opus' }] , quorum: 1 }]
      }
    })
    clic('wf-open-judge-1')
    saisir('wf-agents-judge-1', '3')
    expect(dernier().nodes[0].agents?.[0].model).toBe('opus')
    expect(dernier().nodes[0].agents).toHaveLength(3)
  })

  it('réduire le nombre d’agents ramène un quorum devenu impossible', () => {
    // Sinon le graphe deviendrait invalide sans que le geste en soit la cause visible.
    render({ graph: troisAgents })
    clic('wf-open-judge-1')
    saisir('wf-agents-judge-1', '1')
    expect(dernier().nodes[0].quorum).toBe(1)
  })
})
