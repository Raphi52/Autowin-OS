// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowProfilesView } from './WorkflowProfilesView'

/**
 * La vue calculait l'exécutabilité SANS l'inventaire de skills : un workflow composé d'une brique
 * skill — que la palette propose pourtant — était donc affiché « phase inconnue » et son activation
 * bloquée. L'inventaire arrivant par IPC, l'état « pas encore chargé » ne doit accuser personne.
 */
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const avecSkill = {
  id: 'mixte',
  name: 'Mixte',
  graph: {
    entry: 'frame-1',
    nodes: [
      { id: 'frame-1', phase: 'frame' },
      { id: 'think-1', phase: 'think' }
    ],
    edges: [{ from: 'frame-1', to: 'think-1', when: 'always' as const }]
  }
}

function api(overrides: Record<string, unknown> = {}): void {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      workflowProfiles: vi.fn().mockResolvedValue({ profiles: [avecSkill], activeId: 'mixte' }),
      workflowProfileSelect: vi.fn(),
      workflowProfileRemove: vi.fn(),
      workflowProfileSave: vi.fn(),
      capabilityControls: vi.fn().mockResolvedValue([{ id: 'think', enabled: true }]),
      models: vi.fn().mockResolvedValue([]),
      ...overrides
    }
  })
}

async function render(): Promise<void> {
  await act(async () => {
    root.render(createElement(WorkflowProfilesView, { active: true }))
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('vue Workflows — un nœud skill n’est pas une phase inconnue', () => {
  it('une skill installée ne rend pas le workflow injouable', async () => {
    api()
    await render()
    expect(container.querySelector('[data-testid="workflow-issues-mixte"]')).toBeNull()
    expect(container.querySelector('[data-testid="workflow-active-unrunnable"]')).toBeNull()
  })

  it('une skill absente de la machine est bien signalée', async () => {
    api({ capabilityControls: vi.fn().mockResolvedValue([{ id: 'learn', enabled: true }]) })
    await render()
    const soucis = container.querySelector('[data-testid="workflow-issues-mixte"]')
    expect(soucis?.textContent).toContain('think')
  })

  it('inventaire pas encore chargé : aucun faux positif affiché', async () => {
    api({ capabilityControls: vi.fn().mockReturnValue(new Promise(() => {})) })
    await render()
    expect(container.querySelector('[data-testid="workflow-issues-mixte"]')).toBeNull()
    expect(container.querySelector('[data-testid="workflow-active-unrunnable"]')).toBeNull()
  })
})
