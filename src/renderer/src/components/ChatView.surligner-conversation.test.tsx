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
 * Le repère visuel demandé le 2026-09-09 : une entrée du menu « ⋮ » d'une conversation qui la fait
 * RESSORTIR dans la liste. Ces tests exercent le GESTE (l'appel qui persiste) et le RENDU (la
 * classe qui porte la couleur) — pas l'apparence, qui vit dans ChatView.css.
 */
describe('ChatView — surligner une conversation depuis son menu', () => {
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
      conversationsSetHighlight: vi.fn().mockResolvedValue(true),
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

  it('pose le repère par le menu et le persiste', async () => {
    const conversationsSetHighlight = vi.fn().mockResolvedValue(true)
    await mount(
      api({
        conversations: vi.fn().mockResolvedValue([conversation('A')]),
        conversationsSetHighlight
      })
    )
    await ouvrirMenu('Conversation A')
    const action = document.querySelector<HTMLButtonElement>('[data-testid="conv-menu-highlight"]')
    expect(action, 'aucune entrée de surlignage dans le menu de la conversation').not.toBeNull()
    await act(async () => {
      action!.click()
      await Promise.resolve()
    })
    expect(conversationsSetHighlight).toHaveBeenCalledWith('A', true)
  })

  it('propose de RETIRER le repère quand la conversation le porte déjà', async () => {
    const conversationsSetHighlight = vi.fn().mockResolvedValue(false)
    await mount(
      api({
        conversations: vi.fn().mockResolvedValue([conversation('A', { surlignee: true })]),
        conversationsSetHighlight
      })
    )
    await ouvrirMenu('Conversation A')
    const action = document.querySelector<HTMLButtonElement>('[data-testid="conv-menu-highlight"]')
    expect(action?.textContent).toContain('Retirer le surlignage')
    await act(async () => {
      action!.click()
      await Promise.resolve()
    })
    expect(conversationsSetHighlight).toHaveBeenCalledWith('A', false)
  })

  /** Sans cette classe, le repère serait persisté mais INVISIBLE — le besoin ne serait pas servi. */
  it('marque la ligne surlignée dans la liste', async () => {
    await mount(
      api({
        conversations: vi
          .fn()
          .mockResolvedValue([conversation('A', { surlignee: true }), conversation('B')])
      })
    )
    const lignes = [...container!.querySelectorAll<HTMLElement>('.conv-item')]
    const ligne = (titre: string): HTMLElement =>
      lignes.find((l) => l.textContent?.includes(titre))!
    expect(ligne('Conversation A').className).toContain('surlignee')
    expect(ligne('Conversation B').className).not.toContain('surlignee')
  })

  /*
   * UN BOUTON MORT DOIT LE DIRE.
   *
   * Vécu le 2026-09-09 (conv-384) : l'affichage se recharge à chaud, le processus principal non.
   * L'entrée de menu est donc arrivée AVANT le canal qui l'enregistre, et l'appel etait ecrit
   * « appelle si ca existe » — le clic ne faisait rien, sans message ni erreur. L'utilisateur a
   * cliqué sur un bouton mort en croyant à un bug du surlignage.
   */
  it('signale à l’écran quand le canal d’enregistrement est absent', async () => {
    await mount(
      api({
        conversations: vi.fn().mockResolvedValue([conversation('A')]),
        conversationsSetHighlight: undefined
      })
    )
    await ouvrirMenu('Conversation A')
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="conv-menu-highlight"]')!.click()
      await Promise.resolve()
    })
    const alerte = document.querySelector('[data-testid="chat-workflow-notice"]')
    expect(alerte, 'le clic est reste MUET : aucun avertissement affiche').not.toBeNull()
    expect(alerte!.textContent).toContain('Redémarre')
  })

  /** Un canal qui JETTE ne doit pas non plus disparaitre en silence. */
  it('signale à l’écran quand l’enregistrement échoue', async () => {
    await mount(
      api({
        conversations: vi.fn().mockResolvedValue([conversation('A')]),
        conversationsSetHighlight: vi.fn().mockRejectedValue(new Error('disque plein'))
      })
    )
    await ouvrirMenu('Conversation A')
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="conv-menu-highlight"]')!.click()
      await Promise.resolve()
    })
    const alerte = document.querySelector('[data-testid="chat-workflow-notice"]')
    expect(alerte?.textContent).toContain('disque plein')
  })
})
