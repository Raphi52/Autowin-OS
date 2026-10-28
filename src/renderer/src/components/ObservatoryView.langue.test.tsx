// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ObservatoryView } from './ObservatoryView'
import type { HarnessTraceEvent } from './harness-timeline-model'
import { appliquerLangue } from '../langue'

/**
 * L'ÉCRAN OBSERVATORY SUIT LA LANGUE (traduction anglaise, conv-1170, lot « Observatory »). Entrée
 * qui doit faire échouer ce test : un libellé de l'en-tête, du rail ou de la barre de la chronologie
 * laissé en dur en français, ou un écran qui ne se redessine pas quand la langue change.
 */
beforeAll(() => {
  ;(globalThis as never as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
})

function trace(id: string, type: HarnessTraceEvent['type']): HarnessTraceEvent {
  return {
    id,
    conversationId: 'conv-1',
    turnId: 'conv-1-turn',
    timestamp: `2026-07-23T20:00:0${id.length}.000Z`,
    sequence: id.length,
    type,
    status: type === 'error' ? 'failed' : 'completed',
    channel: 'assistant',
    actor: { id: 'agent', kind: 'model', label: 'Agent' },
    recipient: { id: 'user', kind: 'human', label: 'Utilisateur' },
    payloads: [{ kind: 'text', content: id }],
    observation: { boundary: 'renderer', fidelity: 'exact' },
    provider: { id: 'codex', model: 'codex-model' },
    metrics: { durationMs: 10 }
  }
}

function api() {
  return {
    conversations: vi
      .fn()
      .mockResolvedValue([
        { id: 'conv-1', title: 'Conversation A', provider: 'codex', updatedAt: 2 }
      ]),
    promptCalls: vi.fn().mockResolvedValue([]),
    promptTraceSummary: vi.fn().mockResolvedValue([]),
    authorizeDiagnostics: vi.fn().mockResolvedValue(null),
    promptTracesGlobal: vi.fn().mockResolvedValue([]),
    causalTrace: vi.fn().mockResolvedValue([trace('root', 'message'), trace('err', 'error')]),
    semanticTimeline: vi.fn(async () => ({
      schema: 'autowin.semantic-temporal/v1',
      sourceDigest: 'a'.repeat(64),
      generatedAt: '2026-08-08T10:00:00.000Z',
      nodes: [],
      edges: []
    }))
  }
}

let root: Root | null = null
let hote: HTMLDivElement | null = null

async function monter(): Promise<HTMLDivElement> {
  Object.defineProperty(window, 'api', { configurable: true, value: api() })
  hote = document.createElement('div')
  document.body.append(hote)
  root = createRoot(hote)
  await act(async () => {
    root!.render(createElement(ObservatoryView, { active: true }))
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
  return hote
}

afterEach(async () => {
  await act(async () => root?.unmount())
  hote?.remove()
  root = null
  hote = null
  vi.restoreAllMocks()
  appliquerLangue('fr')
})

const texte = (zone: HTMLElement): string => zone.textContent ?? ''
const attribut = (zone: HTMLElement, selecteur: string, nom: string): string | null =>
  zone.querySelector(selecteur)?.getAttribute(nom) ?? null
const filtresRapides = (zone: HTMLElement): string[] =>
  [...zone.querySelectorAll('.observatory-quick-filters button')].map((b) => b.textContent ?? '')

describe('écran Observatory — langue', () => {
  it('bascule en anglais sans être remonté, puis revient au français', async () => {
    const zone = await monter()
    const filtreConversations = '[data-testid="observatory-conversation-filter"]'

    expect(texte(zone)).toContain('Suis les appels, les coûts, les durées et les erreurs.')
    expect(texte(zone)).toContain('SIGNAUX PRIORITAIRES')
    expect(attribut(zone, filtreConversations, 'placeholder')).toBe('Filtrer titre ou provider…')
    expect(filtresRapides(zone)).toContain('Erreurs')

    await act(async () => appliquerLangue('en'))
    expect(texte(zone)).toContain('Follow the calls, costs, durations and errors.')
    expect(texte(zone)).toContain('PRIORITY SIGNALS')
    expect(texte(zone)).toContain('OBSERVED CALLS')
    expect(texte(zone)).toContain('unknown duration')
    expect(attribut(zone, filtreConversations, 'placeholder')).toBe('Filter by title or provider…')
    expect(attribut(zone, filtreConversations, 'aria-label')).toBe('Filter conversations')
    expect(filtresRapides(zone)).toEqual([
      'Errors',
      'Tools',
      'Prompt / RAG',
      'Sub-agents',
      'Checks',
      'Artefacts'
    ])
    expect(texte(zone)).not.toContain('SIGNAUX PRIORITAIRES')
    expect(texte(zone)).not.toContain('durée inconnue')

    await act(async () => appliquerLangue('fr'))
    expect(texte(zone)).toContain('Suis les appels, les coûts, les durées et les erreurs.')
    expect(texte(zone)).toContain('durée inconnue')
    expect(attribut(zone, filtreConversations, 'placeholder')).toBe('Filtrer titre ou provider…')
    expect(filtresRapides(zone)).toContain('Erreurs')
  })
})
