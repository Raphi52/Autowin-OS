// @vitest-environment happy-dom
/**
 * conv-1303 (2026-10-30) : l'inventaire Brain liste les notes servies souvent et jamais ouvertes,
 * de quoi nourrir /curate — et le dit quand il n'y en a aucune, avec la date de début de la mesure.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ObservatoryView } from './ObservatoryView'

const base = {
  points: [],
  tracesNonRattachees: 0,
  totalTraces: 0,
  pointsJamaisAppeles: [],
  seuilNotesBruyantes: 10
}

function api(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    conversations: vi.fn(async () => [
      { id: 'conv-1', title: 'Conversation A', provider: 'codex', updatedAt: 2 }
    ]),
    promptCalls: vi.fn(async () => []),
    promptTraceSummary: vi.fn(async () => []),
    authorizeDiagnostics: vi.fn(async () => null),
    promptTracesGlobal: vi.fn(async () => []),
    causalTrace: vi.fn(async () => []),
    brainTraces: vi.fn(async () => []),
    conversationActivity: vi.fn(async () => []),
    activitySessions: vi.fn(async () => []),
    ...overrides
  }
}

describe('Observatory — notes servies jamais ouvertes (conv-1303)', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  let root: Root | null = null
  let container: HTMLDivElement | null = null

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    container?.remove()
    root = null
    container = null
    vi.restoreAllMocks()
  })

  async function mount(mockApi: Record<string, unknown>): Promise<HTMLDivElement> {
    Object.defineProperty(window, 'api', { configurable: true, value: mockApi })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(ObservatoryView, { active: true }))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    return container
  }

  it('liste chaque note bruyante avec ses comptes', async () => {
    const inventaire = {
      ...base,
      mesureOuverturesDepuis: '2026-10-30T05:00:00.000Z',
      notesBruyantes: [{ chemin: 'knowledge/domain/plan-de-lots.md', servies: 46, fils: 14 }]
    }
    const view = await mount(api({ brainInjectionInventory: vi.fn(async () => inventaire) }))
    const bloc = view.querySelector('[data-testid="brain-inventory-bruyantes"]')
    expect(bloc?.textContent).toContain(
      'servies 10 fois ou plus, jamais ouvertes (depuis le 2026-10-30)'
    )
    const lignes = [...view.querySelectorAll('[data-testid="brain-note-bruyante"]')]
    expect(lignes).toHaveLength(1)
    expect(lignes[0].textContent).toContain('knowledge/domain/plan-de-lots.md')
    expect(lignes[0].textContent).toContain('servie 46 fois dans 14 fils')
  })

  it('dit « aucune » quand la mesure a commencé sans rien trouver', async () => {
    const inventaire = {
      ...base,
      mesureOuverturesDepuis: '2026-10-30T05:00:00.000Z',
      notesBruyantes: []
    }
    const view = await mount(api({ brainInjectionInventory: vi.fn(async () => inventaire) }))
    expect(view.querySelector('[data-testid="brain-inventory-bruyantes"]')?.textContent).toContain(
      'Aucune note servie 10 fois sans être ouverte depuis le 2026-10-30.'
    )
  })

  it('ne dit rien tant qu’aucune ouverture n’a été tracée', async () => {
    const view = await mount(
      api({ brainInjectionInventory: vi.fn(async () => ({ ...base, notesBruyantes: [] })) })
    )
    expect(view.querySelector('[data-testid="brain-injection-inventory"]')).not.toBeNull()
    expect(view.querySelector('[data-testid="brain-inventory-bruyantes"]')).toBeNull()
  })
})
