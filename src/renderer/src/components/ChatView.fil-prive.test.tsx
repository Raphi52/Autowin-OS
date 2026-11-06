// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ChatView } from './ChatView'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

/**
 * LE FIL PRIVÉ DU VILLAGE COMMUN (D6 de `grill/agent-hq-japon-town.md`, lot 3).
 *
 * Une entrée du menu « ⋮ » d'un fil le marque privé : son tanuki reste chez les collègues, sans
 * titre. Ces tests exercent le GESTE (l'appel qui persiste, dans les deux sens), le RENDU (la
 * mention discrète sur la ligne) et le bouton mort quand le canal manque (preload d'avant
 * redémarrage) — même contrat que le surlignage.
 */
describe('ChatView — marquer un fil privé depuis son menu', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0)
    })
  })

  let container: HTMLDivElement | null = null
  let root: Root | null = null

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    container?.remove()
    root = null
    container = null
    vi.restoreAllMocks()
  })

  const conversation = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    title: `Conversation ${id}`,
    category: 'codex',
    provider: 'codex',
    messages: [],
    updatedAt: 1,
    ...extra
  })

  function api(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      conversations: vi.fn().mockResolvedValue([]),
      conversationRuns: vi.fn().mockResolvedValue([]),
      listRuns: vi.fn().mockResolvedValue([]),
      runTrace: vi.fn().mockResolvedValue(null),
      topology: vi.fn().mockResolvedValue({
        orchestrator: { provider: 'codex', modelId: 'gpt', reasoningEffort: 'auto' }
      }),
      models: vi.fn().mockResolvedValue([{ id: 'gpt', provider: 'codex', model: 'gpt' }]),
      roles: vi.fn().mockResolvedValue({ orchestrator: { provider: 'codex', model: 'gpt' } }),
      onAppEvent: vi.fn(() => vi.fn()),
      onPilotEvent: vi.fn(() => vi.fn()),
      setActiveConversation: vi.fn(),
      conversationsSetPrive: vi.fn().mockResolvedValue(true),
      ...overrides
    }
  }

  async function mount(mockApi: Record<string, unknown>): Promise<void> {
    Object.defineProperty(window, 'api', { configurable: true, value: mockApi })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(ChatView))
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  async function ouvrirMenu(titre: string): Promise<void> {
    const carte = [...container!.querySelectorAll<HTMLButtonElement>('.conv-pick')].find((b) =>
      b.textContent?.includes(titre)
    )
    if (!carte) throw new Error(`conversation « ${titre} » absente de la liste`)
    await act(async () =>
      carte.parentElement?.querySelector<HTMLButtonElement>('.conv-menu-trigger')!.click()
    )
  }

  const entree = (): HTMLButtonElement | null =>
    document.querySelector<HTMLButtonElement>('[data-testid="conv-menu-prive"]')

  it('marque le fil privé par le menu et le persiste', async () => {
    const conversationsSetPrive = vi.fn().mockResolvedValue(true)
    await mount(
      api({ conversations: vi.fn().mockResolvedValue([conversation('A')]), conversationsSetPrive })
    )
    await ouvrirMenu('Conversation A')
    expect(entree(), 'aucune entrée « privé » dans le menu du fil').not.toBeNull()
    expect(entree()!.textContent).toContain('Marquer privé au village')
    await act(async () => {
      entree()!.click()
      await Promise.resolve()
    })
    expect(conversationsSetPrive).toHaveBeenCalledWith('A', true)
  })

  it('propose de DÉMARQUER un fil déjà privé', async () => {
    const conversationsSetPrive = vi.fn().mockResolvedValue(false)
    await mount(
      api({
        conversations: vi.fn().mockResolvedValue([conversation('A', { prive: true })]),
        conversationsSetPrive
      })
    )
    await ouvrirMenu('Conversation A')
    expect(entree()?.textContent).toContain('Ne plus marquer privé')
    await act(async () => {
      entree()!.click()
      await Promise.resolve()
    })
    expect(conversationsSetPrive).toHaveBeenCalledWith('A', false)
  })

  /** Sans mention sur la ligne, l'utilisateur ne saurait plus quels fils partent sans titre. */
  it('dit « privé » sur la ligne du fil privé, et seulement sur elle', async () => {
    await mount(
      api({
        conversations: vi
          .fn()
          .mockResolvedValue([conversation('A', { prive: true }), conversation('B')])
      })
    )
    expect(container!.querySelector('[data-testid="conv-prive-A"]')?.textContent).toBe('privé')
    expect(container!.querySelector('[data-testid="conv-prive-B"]')).toBeNull()
  })

  it('signale à l’écran quand le canal est absent (preload d’avant redémarrage)', async () => {
    await mount(
      api({
        conversations: vi.fn().mockResolvedValue([conversation('A')]),
        conversationsSetPrive: undefined
      })
    )
    await ouvrirMenu('Conversation A')
    await act(async () => {
      entree()!.click()
      await Promise.resolve()
    })
    const alerte = document.querySelector('[data-testid="chat-workflow-notice"]')
    expect(alerte, 'le clic est resté MUET : aucun avertissement affiché').not.toBeNull()
    expect(alerte!.textContent).toContain('redémarre')
  })
})
