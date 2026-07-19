import { describe, expect, it } from 'vitest'
import { promptCallToTraceEvents } from './prompt-call-trace'
import type { PromptCallRecord } from './prompt-observability'

const call: PromptCallRecord = {
  id: 'call-1',
  ts: '2026-07-19T12:00:00.000Z',
  conversationId: 'conv-1',
  turnId: 'turn-1',
  iteration: 0,
  actor: 'orchestrator',
  provider: 'codex',
  model: 'gpt-5.6-sol',
  transport: 'Codex Responses API',
  boundary: 'Autowin OS -> provider adapter',
  limitation: 'Interne provider opaque.',
  system: 'REGLE EXACTE',
  messages: [
    {
      role: 'user',
      content: 'Question exacte',
      attachments: [
        { name: 'preuve.txt', mimeType: 'text/plain', size: 6, kind: 'text', content: 'preuve' }
      ]
    }
  ],
  options: { reasoningEffort: 'high' },
  response: 'Réponse exacte',
  usage: { inputTokens: 120, outputTokens: 30, cacheReadTokens: 20, costUsd: 0.004 }
}

describe('projection causale d’un appel provider', () => {
  it('produit une chaîne ordonnée entrée → injection → frontière → réponse', () => {
    const events = promptCallToTraceEvents(call)
    expect(events.map((event) => event.type)).toEqual([
      'message',
      'injection',
      'boundary',
      'model-response'
    ])
    expect(events.map((event) => event.sequence)).toEqual([0, 1, 2, 3])
    expect(events.slice(1).map((event) => event.parentId)).toEqual(
      events.slice(0, -1).map((event) => event.id)
    )
    expect(events.flatMap((event) => event.payloads).map((payload) => payload.content)).toEqual(
      expect.arrayContaining(['Question exacte', 'preuve', 'REGLE EXACTE', 'Réponse exacte'])
    )
    expect(events[2].observation).toMatchObject({
      fidelity: 'exact',
      limitation: 'Interne provider opaque.'
    })
    expect(events[3].metrics).toMatchObject({
      inputTokens: 120,
      outputTokens: 30,
      cacheReadTokens: 20
    })
  })
  it('accepte une base globale pour ne pas melanger deux tours', () => {
    const second = promptCallToTraceEvents({ ...call, id: 'call-2', turnId: 'turn-2' }, 4)
    expect(second.map((event) => event.sequence)).toEqual([4, 5, 6, 7])
  })
  it('rattache un nouvel appel au dernier resultat outil du sous-tour precedent', () => {
    const events = promptCallToTraceEvents(call, 12, 'turn-1:action:1')
    expect(events[0].parentId).toBe('turn-1:action:1')
    expect(events.slice(1).map((event) => event.parentId)).toEqual(
      events.slice(0, -1).map((event) => event.id)
    )
  })
  it('rend un appel provider échoué explicite et non une réponse vide', () => {
    const events = promptCallToTraceEvents({
      ...call,
      status: 'failed',
      response: '',
      error: 'quota dépassé'
    })
    expect(events.at(-1)).toMatchObject({ type: 'error', status: 'failed' })
    expect(events.at(-1)?.payloads[0].content).toBe('quota dépassé')
  })
  it('projette un appel echoue comme erreur explicite', () => {
    const events = promptCallToTraceEvents({
      ...call,
      status: 'failed',
      error: 'HTTP 500',
      response: ''
    })
    expect(events.at(-1)).toMatchObject({ type: 'error', status: 'failed' })
    expect(events.at(-1)?.payloads[0].content).toBe('HTTP 500')
  })
})
