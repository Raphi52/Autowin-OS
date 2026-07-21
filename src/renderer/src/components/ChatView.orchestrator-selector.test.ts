import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
// @vitest-environment happy-dom
import { act, createElement, useState, type ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildOrchestratorModelGroups } from './chat-view-model'
import { OrchestratorModelSelector } from './OrchestratorModelSelector'

const source = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/components/ChatView.tsx'),
  'utf8'
)
const selectorSource = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/components/OrchestratorModelSelector.tsx'),
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

  it('ne présente pas l’absence d’effort comme un niveau Défaut', async () => {
    const onSelect = vi.fn()
    const dom = await renderSelector({
      models: [
        {
          id: 'h1',
          provider: 'hermes',
          model: 'llama',
          label: 'Llama',
          reasoningEfforts: ['none'],
          defaultReasoningEffort: 'none'
        }
      ],
      binding: { provider: 'hermes', model: 'llama', reasoningEffort: 'none' },
      onSelect
    })
    expect(dom.textContent).not.toContain('Défaut')
    await act(async () => {
      dom.querySelector<HTMLButtonElement>('[role="option"]')?.click()
    })
    expect(dom.querySelector('.model-effort-menu')).toBeNull()
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'hermes', model: 'llama', reasoningEffort: 'none' })
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
      (button) => button.textContent?.includes('Défaut')
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

  it('regroupe par éditeur et preserve le modele courant disparu', () => {
    const result = buildOrchestratorModelGroups(
      [
        { id: 'c1', provider: 'omniroute', model: 'gpt-5', label: 'GPT-5' },
        { id: 'h1', provider: 'omniroute', model: 'llama', label: 'Llama' }
      ],
      { provider: 'legacy', model: 'gone' }
    )
    // ChatGPT (rang 1) avant Meta (rang 2).
    expect(result.groups.map((group) => group.key)).toEqual(['openai', 'meta'])
    expect(result.groups.map((group) => group.label)).toEqual(['ChatGPT', 'Meta (Llama)'])
    expect(result.currentMissing).toEqual({
      provider: 'legacy',
      model: 'gone',
      label: 'legacy · gone (indisponible)',
      reasoningEfforts: []
    })
  })

  it('ordonne les catégories : Anthropic, ChatGPT, puis les autres éditeurs', () => {
    const result = buildOrchestratorModelGroups([
      { id: 'h1', provider: 'omniroute', model: 'llama', label: 'Llama' },
      { id: 'c1', provider: 'omniroute', model: 'gpt-5', label: 'GPT-5' },
      { id: 'a1', provider: 'omniroute', model: 'claude-opus', label: 'Opus' }
    ])
    expect(result.groups.map((group) => group.label)).toEqual([
      'Anthropic',
      'ChatGPT',
      'Meta (Llama)'
    ])
  })

  it('éclate le catalogue OmniRoute en catégories éditeur propres', () => {
    const result = buildOrchestratorModelGroups([
      { id: 'o0', provider: 'omniroute', model: 'zeta-model', label: 'Zeta' },
      { id: 'o1', provider: 'omniroute', model: 'gpt-5.6-terra', label: 'GPT-5.6' },
      { id: 'o2', provider: 'omniroute', model: 'auto/pro-coding', label: 'Pro Code' },
      { id: 'o3', provider: 'omniroute', model: 'claude-opus-4-6', label: 'Opus' },
      { id: 'o4', provider: 'omniroute', model: 'auto/best-chat', label: 'Best Chat' },
      { id: 'o5', provider: 'omniroute', model: 'auto/best-coding', label: 'Best Code' }
    ])
    // Catégories dans l'ordre : Anthropic, ChatGPT, Sélection automatique, Autres.
    expect(result.groups.map((group) => group.key)).toEqual([
      'anthropic',
      'openai',
      'auto',
      'other'
    ])
    expect(result.groups[0].options.map((option) => option.model)).toEqual(['claude-opus-4-6'])
    expect(result.groups[1].options.map((option) => option.model)).toEqual(['gpt-5.6-terra'])
    // Dans la catégorie auto : Chat puis Code (best avant pro) — sous-tri conservé.
    expect(result.groups[2].options.map((option) => option.model)).toEqual([
      'auto/best-chat',
      'auto/best-coding',
      'auto/pro-coding'
    ])
    expect(result.groups[3].options.map((option) => option.model)).toEqual(['zeta-model'])
  })

  it('sort les auto/claude d’Anthropic, masque no-think, trie du plus récent au plus vieux', () => {
    const result = buildOrchestratorModelGroups([
      { id: 'm1', provider: 'omniroute', model: 'cc/claude-opus-4-5-20251101', label: 'Opus 4.5' },
      { id: 'm2', provider: 'omniroute', model: 'cc/claude-opus-4-8', label: 'Opus 4.8' },
      { id: 'm3', provider: 'omniroute', model: 'cc/claude-sonnet-4-6', label: 'Sonnet 4.6' },
      { id: 'm4', provider: 'omniroute', model: 'cc/claude-opus-4-7', label: 'Opus 4.7' },
      { id: 'm7', provider: 'omniroute', model: 'cc/claude-fable-5', label: 'Fable 5' },
      {
        id: 'm5',
        provider: 'omniroute',
        model: 'no-think/cc/claude-opus-4-8',
        label: 'Opus 4.8 · Sans raisonnement'
      },
      { id: 'm6', provider: 'omniroute', model: 'auto/claude-opus', label: 'Auto Claude Opus' }
    ])
    const anthropic = result.groups.find((group) => group.key === 'anthropic')
    // Fable en tête ; no-think masqué ; Opus décroissant puis Sonnet ; auto/claude ABSENT d’ici.
    expect(anthropic?.options.map((option) => option.model)).toEqual([
      'cc/claude-fable-5',
      'cc/claude-opus-4-8',
      'cc/claude-opus-4-7',
      'cc/claude-opus-4-5-20251101',
      'cc/claude-sonnet-4-6'
    ])
    // La route auto/claude-opus vit dans la catégorie « Sélection automatique ».
    expect(result.groups.find((group) => group.key === 'auto')?.options[0]?.model).toBe(
      'auto/claude-opus'
    )
  })

  it('change uniquement la route OmniRoute sans toucher la conversation', () => {
    // Logique de changement de route : reste dans ChatView.
    expect(source).toContain("option.provider !== 'omniroute'")
    expect(source).toContain('activateOmniRoute(option.model, option.reasoningEffort)')
    expect(source).toContain('generation === runtimeRefreshGenerationRef.current')
    // Rendu du sélecteur : extrait dans OrchestratorModelSelector.
    expect(selectorSource).toContain('const disabled = busy || pending || models.length === 0')
    expect(selectorSource).toContain('className="model-select-menu"')
    expect(selectorSource).toContain('Le changement s’appliquera au prochain tour')
    expect(selectorSource).not.toMatch(
      /model-select[\s\S]{0,800}(navigate|newConv|location\.reload)/
    )
  })
})
