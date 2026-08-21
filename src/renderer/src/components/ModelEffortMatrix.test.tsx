// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ModelEffortMatrix, type ModelEffortRow } from './ModelEffortMatrix'
import { OrchestratorModelSelector } from './OrchestratorModelSelector'

const rows: ModelEffortRow[] = [
  {
    key: 'claude:haiku',
    label: 'Haiku',
    model: 'haiku',
    option: {
      provider: 'claude',
      model: 'haiku',
      label: 'Haiku',
      reasoningEfforts: ['low', 'medium', 'high'],
      defaultReasoningEffort: 'low'
    } as ModelEffortRow['option'],
    efforts: ['low', 'medium', 'high']
  },
  {
    key: 'claude:opus',
    label: 'Opus',
    model: 'opus',
    option: {
      provider: 'claude',
      model: 'opus',
      label: 'Opus',
      reasoningEfforts: ['medium', 'high', 'max'],
      defaultReasoningEffort: 'high'
    } as ModelEffortRow['option'],
    efforts: ['medium', 'high', 'max']
  }
]

describe('ModelEffortMatrix', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  let root: Root | null = null
  let host: HTMLDivElement | null = null

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    host?.remove()
    root = null
    host = null
  })

  const render = async (element: React.JSX.Element): Promise<HTMLDivElement> => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root?.render(element))
    return host
  }

  it('rend une ligne par modèle, les colonnes du catalogue et le cran actif', async () => {
    const view = await render(
      createElement(ModelEffortMatrix, {
        rows,
        activeKey: 'claude:opus',
        activeEffort: 'max',
        onSelect: vi.fn(),
        onClose: vi.fn()
      })
    )

    expect(view.querySelectorAll('.effort-matrix-row')).toHaveLength(2)
    // Colonnes = union ordonnée des efforts exposés par le catalogue, jamais une liste en dur.
    expect(
      [...view.querySelectorAll('.effort-matrix-columns span')].map((n) => n.textContent)
    ).toEqual(['', 'low', 'medium', 'high', 'max'])
    const active = view.querySelector('.effort-matrix-row.is-active') as HTMLElement
    expect(active.dataset.row).toBe('claude:opus')
    expect(active.dataset.shown).toBe('max')
    // Le cran mémorisé des autres lignes reste marqué, sans être actif.
    const autre = view.querySelector('[data-row="claude:haiku"]') as HTMLElement
    expect(autre.dataset.shown).toBe('low')
    expect(autre.querySelectorAll('.effort-cran.is-memorized').length).toBeGreaterThan(0)
    // Un effort absent du modèle laisse un cran non cliquable.
    expect(autre.querySelectorAll('.effort-cran.is-absent')).toHaveLength(1)
  })

  it('groupe par fournisseur : chaque groupe porte SA propre échelle d’efforts', async () => {
    // Entrée qui doit faire échouer ce test si l'échelle restait GLOBALE :
    // `openai:o5` n'expose ni `low` ni `high`, et `xhigh` est inconnu de Claude.
    // Échelle globale → 5 colonnes partout + crans `is-absent` ; par fournisseur → 3 et 3, aucun absent.
    const multi: ModelEffortRow[] = [
      ...rows,
      {
        key: 'openai:o5',
        label: 'O5',
        model: 'o5',
        option: {
          provider: 'openai',
          model: 'o5',
          label: 'O5',
          reasoningEfforts: ['minimal', 'medium', 'xhigh'],
          defaultReasoningEffort: 'medium'
        } as ModelEffortRow['option'],
        efforts: ['minimal', 'medium', 'xhigh']
      }
    ]
    const view = await render(
      createElement(ModelEffortMatrix, {
        rows: multi,
        activeKey: 'openai:o5',
        activeEffort: 'xhigh',
        onSelect: vi.fn(),
        onClose: vi.fn()
      })
    )

    const groupes = [...view.querySelectorAll('.effort-matrix-group')]
    expect(groupes.map((g) => (g as HTMLElement).dataset.provider)).toEqual(['claude', 'openai'])
    const echelle = (g: Element): (string | null)[] =>
      [...g.querySelectorAll('.effort-matrix-columns span')].map((n) => n.textContent)
    expect(echelle(groupes[0])).toEqual(['', 'low', 'medium', 'high', 'max'])
    expect(echelle(groupes[1])).toEqual(['', 'minimal', 'medium', 'xhigh'])
    // L'échelle d'un fournisseur ne trahit plus les crans d'un autre.
    const o5 = view.querySelector('[data-row="openai:o5"]') as HTMLElement
    expect(o5.querySelectorAll('.effort-cran')).toHaveLength(3)
    expect(o5.querySelectorAll('.effort-cran.is-absent')).toHaveLength(0)
    expect(groupes[0].querySelector('[data-row="claude:opus"]')).not.toBeNull()
  })

  it('survole un cran pour en montrer l’aperçu, puis le sélectionne', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const view = await render(
      createElement(ModelEffortMatrix, {
        rows,
        activeKey: 'claude:haiku',
        activeEffort: 'low',
        onSelect,
        onClose
      })
    )

    const cran = view.querySelector(
      '[data-row="claude:opus"] [role="radio"]:last-of-type'
    ) as HTMLButtonElement
    await act(async () => {
      cran.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect((view.querySelector('[data-row="claude:opus"]') as HTMLElement).dataset.shown).toBe(
      'max'
    )
    expect(view.querySelector('footer')?.textContent).toBe('Opus · Max')

    await act(async () => cran.click())
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'claude', model: 'opus', reasoningEffort: 'max' })
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('refuse un cran dont le provider est injoignable', async () => {
    const onSelect = vi.fn()
    const view = await render(
      createElement(ModelEffortMatrix, {
        rows: [{ ...rows[0], blocked: true, blockedReason: 'claude : Expiré' }],
        activeKey: null,
        onSelect,
        onClose: vi.fn()
      })
    )
    const cran = view.querySelector('[role="radio"]') as HTMLButtonElement
    expect(cran.getAttribute('aria-disabled')).toBe('true')
    await act(async () => cran.click())
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('s’ouvre depuis le sélecteur d’orchestrateur et applique le couple choisi', async () => {
    const onSelect = vi.fn()
    const view = await render(
      createElement(OrchestratorModelSelector, {
        busy: false,
        catalogLoaded: true,
        models: [
          {
            id: 'claude:opus',
            provider: 'claude',
            model: 'opus',
            label: 'Opus',
            reasoningEfforts: ['medium', 'high', 'max'],
            defaultReasoningEffort: 'high'
          }
        ],
        binding: { provider: 'claude', model: 'opus', reasoningEffort: 'high' },
        pending: false,
        error: null,
        onSelect
      })
    )

    expect(view.querySelector('[data-testid="effort-matrix"]')).toBeNull()
    const ouvrir = view.querySelector('.model-select-matrix-open') as HTMLButtonElement
    expect(ouvrir).not.toBeNull()
    await act(async () => ouvrir.click())
    const matrice = view.querySelector('[data-testid="effort-matrix"]') as HTMLElement
    expect(matrice).not.toBeNull()
    expect((matrice.querySelector('.effort-matrix-row') as HTMLElement).dataset.shown).toBe('high')

    const crans = matrice.querySelectorAll('[role="radio"]')
    await act(async () => (crans[0] as HTMLButtonElement).click())
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'opus', reasoningEffort: 'medium' })
    )
    expect(view.querySelector('[data-testid="effort-matrix"]')).toBeNull()
  })
})
