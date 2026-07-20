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
    const select = dom.querySelector('select') as HTMLSelectElement
    expect([...select.options].map((option) => option.textContent)).toEqual([
      'Aucun modèle disponible'
    ])
    expect(select.disabled).toBe(true)
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
    const select = dom.querySelector('select') as HTMLSelectElement
    expect([...select.options].map((option) => option.textContent)).toEqual(['GPT-5'])
    expect(dom.textContent).toContain('legacy · gone (indisponible)')
    expect(select.value).toBe('codex\u0000gpt-5')
    expect(onSelect).not.toHaveBeenCalled()
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
            await setRole('orchestrator', option.provider, option.model)
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
    const select = dom.querySelector('select') as HTMLSelectElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
      setter?.call(select, 'hermes\u0000llama')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(setRole).toHaveBeenCalledWith('orchestrator', 'hermes', 'llama')
    expect(select.value).toBe('codex\u0000gpt-5')
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
        { provider: 'codex', options: [{ provider: 'codex', model: 'gpt-5', label: 'GPT-5' }] },
        { provider: 'hermes', options: [{ provider: 'hermes', model: 'llama', label: 'Llama' }] }
      ],
      currentMissing: { provider: 'legacy', model: 'gone', label: 'legacy · gone (indisponible)' }
    })
  })

  it('change uniquement le binding orchestrator sans toucher la conversation', () => {
    expect(source).toContain("window.api.setRole('orchestrator', option.provider, option.model)")
    expect(source).toContain('disabled={busy || pending || models.length === 0}')
    expect(source).toContain('Le changement s’appliquera au prochain tour')
    expect(source).toContain('generation === runtimeRefreshGenerationRef.current')
    expect(source).not.toMatch(/model-select[\s\S]{0,800}(navigate|newConv|location\.reload)/)
  })
})
