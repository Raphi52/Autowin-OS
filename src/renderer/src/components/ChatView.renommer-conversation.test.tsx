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
 * DÉFAUT VÉCU le 2026-09-02 : « Renommer » dans le menu de la barre latérale ne faisait RIEN.
 * La cause n'était ni l'enregistrement ni les droits : le code appelait `window.prompt`, qu'Electron
 * ne sait pas afficher — l'appel rend `null` immédiatement, donc la condition de garde était toujours
 * fausse et `conversationsRename` n'était JAMAIS atteint. Ces tests interdisent le retour de la boîte
 * native et prouvent que la fenêtre React, elle, va jusqu'à l'enregistrement.
 */
const conversation = (id: string, title: string) => ({
  id,
  title,
  category: 'codex',
  provider: 'codex',
  messages: [],
  updatedAt: 1
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
    conversationsCreate: vi.fn(),
    conversationsRename: vi.fn().mockResolvedValue(undefined),
    pilotChat: vi.fn().mockResolvedValue({ ok: true }),
    markResponseDisplayed: vi.fn().mockResolvedValue(undefined),
    cancelPilotChat: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

describe('renommer une conversation depuis la barre latérale', () => {
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
    vi.unstubAllGlobals()
  })

  async function mount(mockApi: Record<string, unknown>): Promise<void> {
    Object.defineProperty(window, 'api', { configurable: true, value: mockApi })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(ChatView, {}))
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  async function ouvrirRenommage(): Promise<void> {
    const ligne = [...container!.querySelectorAll<HTMLButtonElement>('.conv-pick')].find((b) =>
      b.textContent?.includes('Ancien titre')
    )
    const trigger = ligne?.parentElement?.querySelector<HTMLButtonElement>('.conv-menu-trigger')
    expect(trigger, 'le menu ⋮ de la conversation est introuvable').not.toBeNull()
    await act(async () => trigger!.click())
    const renommer = [
      ...document.querySelectorAll<HTMLButtonElement>('.conv-menu-pop button[role="menuitem"]')
    ].find((b) => b.textContent?.includes('Renommer'))
    expect(renommer, 'l’action « Renommer » manque dans le menu').toBeDefined()
    await act(async () => renommer!.click())
  }

  async function saisir(valeur: string): Promise<void> {
    const champ = document.querySelector<HTMLInputElement>('[data-testid="rename-conv-input"]')
    expect(champ, 'la fenêtre de saisie du titre ne s’est pas ouverte').not.toBeNull()
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(champ, valeur)
      champ!.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  async function valider(): Promise<void> {
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="rename-conv-confirm"]')!.click()
      await Promise.resolve()
    })
  }

  it('ouvre une fenêtre de saisie et enregistre le nouveau titre', async () => {
    const conversationsRename = vi.fn().mockResolvedValue(undefined)
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A', 'Ancien titre')]),
      conversationsRename
    })
    await mount(mockApi)
    await ouvrirRenommage()
    await saisir('Préférences Utilisateur')
    await valider()

    expect(conversationsRename).toHaveBeenCalledWith('A', 'Préférences Utilisateur')
    // La fenêtre se referme après l'enregistrement.
    expect(document.querySelector('[data-testid="rename-conv-dialog"]')).toBeNull()
  })

  it('n’appelle JAMAIS la boîte native du navigateur (Electron ne l’affiche pas)', async () => {
    const promptSpy = vi.fn(() => null)
    Object.defineProperty(window, 'prompt', { configurable: true, value: promptSpy })
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A', 'Ancien titre')])
    })
    await mount(mockApi)
    await ouvrirRenommage()

    expect(promptSpy, 'window.prompt est inutilisable dans Electron : rien ne s’affiche').not
      .toHaveBeenCalled()
    expect(document.querySelector('[data-testid="rename-conv-dialog"]')).not.toBeNull()
  })

  it('ignore une saisie vide et n’enregistre rien', async () => {
    const conversationsRename = vi.fn().mockResolvedValue(undefined)
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A', 'Ancien titre')]),
      conversationsRename
    })
    await mount(mockApi)
    await ouvrirRenommage()
    await saisir('   ')
    await valider()

    expect(conversationsRename).not.toHaveBeenCalled()
  })
})
