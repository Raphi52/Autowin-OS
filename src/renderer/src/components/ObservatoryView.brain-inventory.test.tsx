// @vitest-environment happy-dom
/**
 * L'Observatory promet « toutes les injections et tous les appels au Brain ». Une chronologie ne
 * peut pas tenir cette promesse : elle montre ce qui a eu lieu, jamais ce qui EXISTE et n'a pas
 * servi. Ce test verrouille le panneau d'inventaire — la liste vient du registre du main, un point
 * à zéro appel reste VISIBLE, et les traces non rattachables sont comptées à part.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ObservatoryView } from './ObservatoryView'

const inventaire = {
  points: [
    {
      id: 'orchestration-task-rag',
      label: 'Run · RAG de tâche',
      kind: 'automatic',
      injecte: true,
      emission: 'spool',
      pourquoi: 'Savoir curé injecté en tête de contexte.',
      appelsTotal: 3,
      appelsConversation: 2,
      caracteresConversation: 1234,
      dernierAppel: '2026-08-31T10:00:00.000Z'
    },
    {
      id: 'orchestration-empreinte-depot',
      label: 'Run · empreinte du dépôt (skill think)',
      kind: 'empreinte',
      injecte: true,
      emission: 'spool',
      pourquoi: 'Chargée à chaque run.',
      appelsTotal: 0,
      appelsConversation: 0,
      caracteresConversation: 0
    }
  ],
  tracesNonRattachees: 2,
  totalTraces: 5,
  pointsJamaisAppeles: ['orchestration-empreinte-depot']
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

describe('Observatory — inventaire exhaustif des appels Brain', () => {
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

  it('affiche CHAQUE point déclaré, y compris celui qui n’a jamais été appelé', async () => {
    const brainInjectionInventory = vi.fn(async () => inventaire)
    const view = await mount(api({ brainInjectionInventory }))
    expect(brainInjectionInventory).toHaveBeenCalledWith('conv-1')
    const lignes = [...view.querySelectorAll('[data-testid="brain-injection-point"]')]
    expect(lignes.map((ligne) => ligne.getAttribute('data-point'))).toEqual([
      'orchestration-task-rag',
      'orchestration-empreinte-depot'
    ])
    const jamais = lignes.find(
      (ligne) => ligne.getAttribute('data-point') === 'orchestration-empreinte-depot'
    )
    expect(jamais?.textContent).toContain('aucun appel')
  })

  it('donne le compte réel de la conversation, pas un total global déguisé', async () => {
    const view = await mount(api({ brainInjectionInventory: vi.fn(async () => inventaire) }))
    const rag = view.querySelector('[data-point="orchestration-task-rag"]')
    expect(rag?.getAttribute('data-appels')).toBe('2')
    // Espaces insecables du format fr-FR normalises : on verifie le NOMBRE, pas la typographie.
    const texte = (rag?.textContent ?? '').replace(/\s+/gu, ' ')
    expect(texte).toContain('2 appels')
    expect(texte).toContain('1 234 car. injectés')
  })

  it('compte à part les traces non rattachables plutôt que de les attribuer', async () => {
    const view = await mount(api({ brainInjectionInventory: vi.fn(async () => inventaire) }))
    expect(view.querySelector('[data-testid="brain-inventory-orphelines"]')?.textContent).toContain(
      '2 traces sans point déclaré'
    )
  })

  it('un preload sans cet inventaire ne casse pas la vue', async () => {
    const view = await mount(api())
    expect(view.querySelector('[data-testid="brain-injection-inventory"]')).toBeNull()
  })
})
