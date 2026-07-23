// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { BehaviourView } from './BehaviourView'

async function render(): Promise<{ root: Root; container: HTMLElement }> {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      behaviourComposition: vi.fn(async () => ({
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
      }))
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
      ;(container.querySelectorAll('[role="tab"]')[1] as HTMLButtonElement).click()
    })

    expect(container.textContent).toContain('CONSTITUTION')
    expect(container.textContent).not.toContain('seul kit SOUL')

    await act(async () => root.unmount())
  })
})
