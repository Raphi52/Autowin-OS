import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
// @vitest-environment happy-dom
import { act, createElement, useState, type ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildOrchestratorModelGroups } from './chat-view-model'
import { OrchestratorModelSelector } from './ChatView'

const source = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/components/ChatView.tsx'),
  'utf8'
)

describe('selecteur orchestrateur Chat', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })
  let container: HTMLDivElement | null = null

  afterEach(() => {
    container?.remove()
    container = null
  })

  async function renderSelector(
    props: Partial<ComponentProps<typeof OrchestratorModelSelector>> = {}
  ): Promise<HTMLDivElement> {
    container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        createElement(OrchestratorModelSelector, {
          busy: false,
          catalogLoaded: true,
          models: [],
          binding: { provider: 'codex', model: 'gpt-5' },
          pending: false,
          error: null,
          onSelect: vi.fn(),
          ...props
        })
      )
    })
    return container
  }

  it('rend honnêtement un catalogue models() vide sans option inventée ni faux succès', async () => {
    const dom = await renderSelector()
    const selector = dom.querySelector('[data-testid="chat-orchestrator-model"]') as HTMLElement
    expect(selector.textContent).toContain('Aucun modèle disponible')
    expect(selector.dataset.disabled).toBe('true')
    expect(dom.querySelectorAll('[role="option"]')).toHaveLength(0)
    expect(dom.textContent).toContain('Catalogue de modèles vide.')
    expect(dom.textContent).not.toMatch(/enregistré|réussi/i)
  })

  it('signale la disparition du binding tout en ne proposant que le catalogue dynamique', async () => {
    const onSelect = vi.fn()
    const dom = await renderSelector({
      models: [{ id: 'c1', provider: 'codex', model: 'gpt-5', label: 'GPT-5' }],
      binding: { provider: 'legacy', model: 'gone' },
      onSelect
    })
    const options = [...dom.querySelectorAll('[role="option"]')]
    expect(options.map((option) => option.querySelector('strong')?.textContent)).toEqual(['GPT-5'])
    expect(dom.textContent).toContain('legacy · gone (indisponible)')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('ouvre le sous-menu du modèle et transmet explicitement son effort', async () => {
    const onSelect = vi.fn()
    const dom = await renderSelector({
      models: [
        {
          id: 'c1',
          provider: 'codex',
          model: 'gpt-5.6-terra',
          label: 'GPT-5.6 Terra',
          reasoningEfforts: ['low', 'high', 'ultra'],
          defaultReasoningEffort: 'high'
        }
      ],
      binding: { provider: 'codex', model: 'gpt-5.6-terra', reasoningEffort: 'high' },
      onSelect
    })
    expect(dom.querySelector('summary')?.textContent).toContain('GPT-5.6 TerraÉlevé')
    await act(async () => {
      dom.querySelector<HTMLButtonElement>('[role="option"]')?.click()
    })
    expect(
      [...dom.querySelectorAll('.model-effort-menu button')].map((item) => item.textContent)
    ).toEqual(['low', 'high✓', 'ultra'])
    await act(async () => {
      ;[...dom.querySelectorAll<HTMLButtonElement>('.model-effort-menu button')]
        .find((item) => item.textContent === 'ultra')
        ?.click()
    })
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'codex',
        model: 'gpt-5.6-terra',
        reasoningEffort: 'ultra'
      })
    )
  })

  it('restitue un rejet setRole sans faux succès et conserve le binding runtime confirmé', async () => {
    const models = [
      { id: 'c1', provider: 'codex', model: 'gpt-5', label: 'GPT-5' },
      { id: 'h1', provider: 'hermes', model: 'llama', label: 'Llama' }
    ]
    const setRole = vi.fn().mockRejectedValue(new Error('refus fixture'))
    function RejectionHarness(): React.JSX.Element {
      const [error, setError] = useState<string | null>(null)
      return createElement(OrchestratorModelSelector, {
        busy: false,
        catalogLoaded: true,
        models,
        binding: { provider: 'codex', model: 'gpt-5' },
        pending: false,
        error,
        onSelect: async (option) => {
          try {
            await setRole('orchestrator', option.provider, option.model, option.reasoningEffort)
          } catch (reason) {
            setError(
              `Changement non enregistré : ${reason instanceof Error ? reason.message : String(reason)}`
            )
          }
        }
      })
    }
    container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => root.render(createElement(RejectionHarness)))
    const dom = container
    const llama = [...dom.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
      (option) => option.querySelector('strong')?.textContent === 'Llama'
    )
    await act(async () => {
      llama?.click()
    })
    const effort = [...dom.querySelectorAll<HTMLButtonElement>('.model-effort-menu button')].find(
      (button) => button.textContent?.includes('Auto')
    )
    await act(async () => {
      effort?.click()
    })
    expect(setRole).toHaveBeenCalledWith('orchestrator', 'hermes', 'llama', 'none')
    expect(dom.querySelector('summary')?.textContent).toContain('GPT-5')
    expect(dom.querySelector('[role="status"]')?.textContent).toContain(
      'Changement non enregistré : refus fixture'
    )
    expect(dom.textContent).not.toMatch(/réussi|appliqué/i)
  })

  it('groupe exclusivement le catalogue dynamique et preserve le modele courant disparu', () => {
    expect(
      buildOrchestratorModelGroups(
        [
          { id: 'c1', provider: 'codex', model: 'gpt-5', label: 'GPT-5' },
          { id: 'h1', provider: 'hermes', model: 'llama', label: 'Llama' }
        ],
        { provider: 'legacy', model: 'gone' }
      )
    ).toEqual({
      groups: [
        {
          provider: 'codex',
          options: [
            { provider: 'codex', model: 'gpt-5', label: 'GPT-5', reasoningEfforts: ['none'] }
          ]
        },
        {
          provider: 'hermes',
          options: [
            { provider: 'hermes', model: 'llama', label: 'Llama', reasoningEfforts: ['none'] }
          ]
        }
      ],
      currentMissing: {
        provider: 'legacy',
        model: 'gone',
        label: 'legacy · gone (indisponible)',
        reasoningEfforts: []
      }
    })
  })

  it('change uniquement la route OmniRoute sans toucher la conversation', () => {
    expect(source).toContain("option.provider !== 'omniroute'")
    expect(source).toContain('activateOmniRoute(option.model)')
    expect(source).toContain('const disabled = busy || pending || models.length === 0')
    expect(source).toContain('className="model-select-menu"')
    expect(source).toContain('Le changement s’appliquera au prochain tour')
    expect(source).toContain('generation === runtimeRefreshGenerationRef.current')
    expect(source).not.toMatch(/model-select[\s\S]{0,800}(navigate|newConv|location\.reload)/)
  })
})
