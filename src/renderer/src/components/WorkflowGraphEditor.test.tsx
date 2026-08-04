// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowGraphEditor } from './WorkflowGraphEditor'

let container: HTMLDivElement
let root: Root
let check: ReturnType<typeof vi.fn>
let onSave: ReturnType<typeof vi.fn>

const sain = { defects: [], inertReturns: [], worstCaseNodeExecutions: 3 }

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  check = vi.fn().mockResolvedValue(sain)
  onSave = vi.fn()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { checkWorkflowGraph: check }
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const q = <T extends Element>(sel: string): T => container.querySelector<T>(sel)!
const bouton = (): HTMLButtonElement => q('[data-testid="workflow-graph-save"]')

async function render(profile: Record<string, unknown> = { id: 'p', phases: ['frame', 'build'] }) {
  await act(async () => {
    root.render(createElement(WorkflowGraphEditor, { profile: profile as never, onSave }))
    await Promise.resolve()
  })
}

async function ajouterUnePhase(): Promise<void> {
  await act(async () => {
    q<HTMLElement>('[data-testid="wf-add-clean"]').click()
    await Promise.resolve()
  })
}

describe('composer et enregistrer', () => {
  it('le profil s’ouvre sur son graphe, dérivé de ses phases s’il n’en a pas', async () => {
    await render()
    expect(container.querySelector('[data-testid="wf-node-frame-1"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="wf-node-build-1"]')).not.toBeNull()
  })

  it('la validité est décidée CÔTÉ MAIN, par le code qui exécute', async () => {
    // Deux vérités — une dans le canevas, une dans le moteur — divergeraient tôt ou tard.
    await render()
    expect(check).toHaveBeenCalled()
  })

  it('rien à enregistrer tant que rien n’a changé', async () => {
    await render()
    expect(bouton().disabled).toBe(true)
    expect(bouton().textContent).toContain('Enregistré')
  })

  it('une modification rend l’enregistrement possible, et le transmet', async () => {
    await render()
    await ajouterUnePhase()
    expect(bouton().disabled).toBe(false)
    await act(async () => bouton().click())
    expect(onSave).toHaveBeenCalledOnce()
    expect(onSave.mock.calls[0][0].nodes.map((n: { phase: string }) => n.phase)).toEqual([
      'frame',
      'build',
      'clean'
    ])
  })
})

describe('ne jamais enregistrer un graphe que le moteur refusera', () => {
  it('un défaut bloque l’enregistrement, et le DIT', async () => {
    check.mockResolvedValue({
      defects: [{ target: 'build-1', message: 'Le retour doit porter une limite.' }],
      inertReturns: [],
      worstCaseNodeExecutions: null
    })
    await render()
    await ajouterUnePhase()
    expect(bouton().disabled).toBe(true)
    expect(q('[data-testid="workflow-graph-blocked"]').textContent).toContain('à corriger')
  })

  it('le défaut remonte jusqu’au nœud fautif', async () => {
    check.mockResolvedValue({
      defects: [{ target: 'build-1', message: 'Le retour doit porter une limite.' }],
      inertReturns: [],
      worstCaseNodeExecutions: null
    })
    await render()
    expect(q('[data-testid="wf-node-build-1"]').textContent).toContain('doit porter une limite')
  })

  it('une vérification injoignable bloque l’enregistrement au lieu de laisser passer', async () => {
    check.mockRejectedValue(new Error('main muet'))
    await render()
    await ajouterUnePhase()
    expect(bouton().disabled).toBe(true)
  })

  it('un graphe vide ne s’enregistre pas', async () => {
    await render({ id: 'p', phases: [] })
    expect(bouton().disabled).toBe(true)
  })
})

describe('dire ce que le graphe peut coûter', () => {
  it('annonce le pire cas — la seule mesure du coût maximal d’un graphe à boucles', async () => {
    await render()
    expect(q('[data-testid="workflow-graph-worstcase"]').textContent).toContain('au plus 3')
  })

  it('un retour inerte est signalé jusque dans le canevas', async () => {
    check.mockResolvedValue({
      defects: [],
      inertReturns: [{ from: 'build-1', to: 'frame-1' }],
      worstCaseNodeExecutions: 2
    })
    await render({
      id: 'p',
      graph: {
        entry: 'frame-1',
        nodes: [
          { id: 'frame-1', phase: 'frame' },
          { id: 'build-1', phase: 'build' }
        ],
        edges: [
          { from: 'frame-1', to: 'build-1', when: 'always' },
          { from: 'build-1', to: 'frame-1', when: 'red', maxTraversals: 1 }
        ]
      }
    })
    expect(q('[data-testid="wf-inert-build-1-frame-1"]').textContent).toContain(
      'ne sait pas encore le jouer'
    )
  })
})
