// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { BehaviourView } from './BehaviourView'

async function render(): Promise<{ root: Root; container: HTMLElement }> {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      behaviourComposition: vi.fn(async (workspace?: string) => ({
        inspection: workspace
          ? {
              workspace,
              files: [
                {
                  id: 'codex:workspace:b',
                  label: 'AGENTS.md',
                  path: `${workspace}\\AGENTS.md`,
                  engine: 'codex',
                  state: 'active',
                  reason: 'Applicable au contexte sélectionné',
                  active: true,
                  excerpt: 'INSTRUCTION_WORKSPACE_B_ACTIVE'
                }
              ]
            }
          : { workspace: 'C:\\workspace-a', files: [] },
        cockpit: {
          systemPrompt: [],
          retrievedContext: [],
          modelSelection: []
        },
        orchestrated: {
          systemPrompt: [],
          injectedContext: [],
          modelSelection: [],
          regime: [],
          guardrails: []
        },
        direct: {
          systemPrompt: [
            {
              label: 'constitution',
              value: 'CONSTITUTION injectée comme system par défaut.',
              source: 'src/main/constitution.ts:16'
            }
          ],
          modelSelection: []
        }
      })),
      chooseBehaviourWorkspace: vi.fn(async () => 'C:\\workspace-b'),
      outcomeLearning: vi.fn(async () => ({
        mode: 'auto',
        events: [
          { kind: 'decision', value: {} },
          {
            kind: 'curation',
            value: { eventId: 'curation-1', action: 'retract', knowledgeId: 'knowledge/a' }
          }
        ]
      })),
      outcomeLearningCurations: vi.fn(async (offset = 0) => ({
        total: 2,
        events:
          offset === 0
            ? [
                {
                  kind: 'curation',
                  value: { eventId: 'curation-1', action: 'retract', knowledgeId: 'knowledge/a' }
                }
              ]
            : [
                {
                  kind: 'curation',
                  value: { eventId: 'curation-2', action: 'restore', knowledgeId: 'knowledge/b' }
                }
              ]
      })),
      setOutcomeLearningMode: vi.fn(async (mode: string) => ({ mode })),
      undoOutcomeLearningCuration: vi.fn(async () => ({ from: 'a', to: 'b' }))
    }
  })

  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(BehaviourView))
    await Promise.resolve()
    await Promise.resolve()
  })
  return { root, container }
}

describe('vue Behaviour', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  it('décrit le chat direct avec la CONSTITUTION réellement utilisée', async () => {
    const { root, container } = await render()

    await act(async () => {
      ;(container.querySelectorAll('[role="tab"]')[2] as HTMLButtonElement).click()
    })

    expect(container.textContent).toContain('CONSTITUTION')
    expect(container.textContent).not.toContain('seul kit SOUL')

    await act(async () => root.unmount())
  })

  it('recharge la composition avec le workspace approuvé', async () => {
    const { root, container } = await render()
    const button = [...container.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('Choisir un workspace')
    ) as HTMLButtonElement
    await act(async () => {
      button.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(window.api.behaviourComposition).toHaveBeenLastCalledWith('C:\\workspace-b')
    expect(container.textContent).toContain('INSTRUCTION_WORKSPACE_B_ACTIVE')
    expect(container.textContent).toContain('AGENTS.md')
    await act(async () => root.unmount())
  })

  it('expose le kill switch et le journal outcome-learning', async () => {
    const { root, container } = await render()
    const select = container.querySelector(
      '[aria-label="Mode d’apprentissage Brain"]'
    ) as HTMLSelectElement
    expect(container.textContent).toContain('2 événements audités')
    expect(container.textContent).toContain('Journal détaillé · 2 plus récents')
    expect(container.textContent).toContain('decision')
    await act(async () => {
      select.value = 'off'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })
    expect(window.api.setOutcomeLearningMode).toHaveBeenCalledWith('off')
    const undo = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Annuler retract')
    ) as HTMLButtonElement
    await act(async () => {
      undo.click()
      await Promise.resolve()
    })
    expect(window.api.undoOutcomeLearningCuration).toHaveBeenCalledWith('curation-1')
    await act(async () => root.unmount())
  })

  it('pagine les curations anciennes et garde leur commande Undo accessible', async () => {
    const { root, container } = await render()
    const more = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Afficher plus de curations')
    ) as HTMLButtonElement

    await act(async () => {
      more.click()
      await Promise.resolve()
    })

    expect(window.api.outcomeLearningCurations).toHaveBeenLastCalledWith(1, 20)
    expect(container.textContent).toContain('Annuler restore · knowledge/b')
    await act(async () => root.unmount())
  })
})

const COMPOSITION = {
  inspection: { workspace: 'C:\\ws', files: [] },
  cockpit: { systemPrompt: [], retrievedContext: [], turnContext: [], modelSelection: [] },
  orchestrated: {
    systemPrompt: [],
    injectedContext: [],
    modelSelection: [],
    topology: [],
    regime: [],
    guardrails: []
  },
  direct: { systemPrompt: [], modelSelection: [] }
}

async function mountBehaviour(api: Record<string, unknown>): Promise<{
  root: Root
  container: HTMLElement
}> {
  Object.defineProperty(window, 'api', { configurable: true, value: api })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(BehaviourView))
    await Promise.resolve()
    await Promise.resolve()
  })
  return { root, container }
}

describe('vue Behaviour — états dégradés', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  it("annonce l'erreur en role=alert et permet de réessayer", async () => {
    const behaviourComposition = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(COMPOSITION)
    const { root, container } = await mountBehaviour({
      behaviourComposition,
      chooseBehaviourWorkspace: vi.fn()
    })

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('boom')
    const retry = [...container.querySelectorAll('button')].find(
      (item) => item.textContent === 'Réessayer'
    ) as HTMLButtonElement
    expect(retry).toBeTruthy()
    await act(async () => {
      retry.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(behaviourComposition).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.textContent).toContain('C:\\ws')
    await act(async () => root.unmount())
  })

  it("capture l'échec du choix de workspace au lieu de le laisser filer", async () => {
    const chooseBehaviourWorkspace = vi.fn().mockRejectedValue(new Error('dialog KO'))
    const { root, container } = await mountBehaviour({
      behaviourComposition: vi.fn().mockResolvedValue(COMPOSITION),
      chooseBehaviourWorkspace
    })
    const button = [...container.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('Choisir un workspace')
    ) as HTMLButtonElement
    await act(async () => {
      button.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('dialog KO')
    await act(async () => root.unmount())
  })

  it('affiche un état de chargement pendant le choix de workspace', async () => {
    let release: (value: string) => void = () => {}
    const chooseBehaviourWorkspace = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = resolve
        })
    )
    const { root, container } = await mountBehaviour({
      behaviourComposition: vi.fn().mockResolvedValue(COMPOSITION),
      chooseBehaviourWorkspace
    })
    const button = [...container.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('Choisir un workspace')
    ) as HTMLButtonElement
    await act(async () => {
      button.click()
      await Promise.resolve()
    })
    const busy = [...container.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('Sélection')
    ) as HTMLButtonElement
    expect(busy).toBeTruthy()
    expect(busy.disabled).toBe(true)
    await act(async () => {
      release('')
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => root.unmount())
  })
})
