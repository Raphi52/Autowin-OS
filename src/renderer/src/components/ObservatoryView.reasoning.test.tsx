// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ObservatoryView } from './ObservatoryView'
import type { HarnessTraceEvent } from './harness-timeline-model'

/**
 * Le raisonnement du modèle EST dans la trace (reasoning-trace.ts) mais s'affichait comme une
 * « Décision » isolée, indiscernable d'un contrôle qualité : on ne pouvait pas voir la pensée du
 * modèle en la lisant. Ces deux tests fixent ce que l'écran doit montrer.
 */
function base(id: string, type: string, payloads: Array<{ kind: string; content: string }>) {
  return {
    id,
    conversationId: 'conv-1',
    turnId: 'conv-1-turn',
    timestamp: '2026-09-09T10:00:00.000Z',
    sequence: id === 'evt-reasoning' ? 1 : 2,
    type,
    status: 'completed',
    channel: 'assistant',
    actor: { id: 'orchestrator', kind: 'agent', label: 'Orchestrateur' },
    recipient: { id: 'user', kind: 'human', label: 'Utilisateur' },
    payloads,
    observation: { boundary: 'Autowin OS model reasoning', fidelity: 'exact' },
    provider: { id: 'claude', model: 'claude-opus-5' }
  } as unknown as HarnessTraceEvent
}

const events = [
  base('evt-reasoning', 'decision', [
    { kind: 'reasoning', content: 'Je compare deux pistes avant de répondre.' }
  ]),
  base('evt-response', 'model-response', [{ kind: 'text', content: 'Voici la réponse.' }])
]

describe('Observatory · raisonnement du modèle', () => {
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

  async function mount(): Promise<HTMLDivElement> {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        conversations: vi.fn(async () => [
          { id: 'conv-1', title: 'Conversation A', provider: 'claude', updatedAt: 2 }
        ]),
        promptCalls: vi.fn(async () => []),
        promptTraceSummary: vi.fn(async () => []),
        authorizeDiagnostics: vi.fn(async () => null),
        promptTracesGlobal: vi.fn(async () => []),
        causalTrace: vi.fn(async () => events),
        brainTraces: vi.fn(async () => []),
        conversationActivity: vi.fn(async () => []),
        activitySessions: vi.fn(async () => [])
      }
    })
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

  it('nomme le raisonnement au lieu de « Décision »', async () => {
    const view = await mount()
    const item = view.querySelector('.observatory-event.is-decision')
    expect(item).not.toBeNull()
    expect(item?.textContent).toContain('Raisonnement du modèle')
    expect(item?.textContent).toContain('Je compare deux pistes')
  })

  it('le pose dans le bloc « Réponse », pas en marge de la chronologie', async () => {
    const view = await mount()
    const group = view.querySelector('.observatory-group.is-reponse')
    expect(group).not.toBeNull()
    expect(group?.querySelector('.observatory-event.is-decision')).not.toBeNull()
    expect(group?.querySelector('.observatory-event.is-model-response')).not.toBeNull()
  })
})
