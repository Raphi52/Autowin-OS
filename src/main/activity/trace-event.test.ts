import { describe, expect, it } from 'vitest'
import {
  assertTraceEvent,
  traceActionEventId,
  type TraceEventV1,
  type TracePayload
} from './trace-event'

const payloads: TracePayload[] = [
  { kind: 'user-message', content: 'Analyse ce dossier.' },
  { kind: 'system-instruction', content: 'Respecte le RUN.' },
  { kind: 'app-state', content: '{"view":"chat"}', mediaType: 'application/json' },
  { kind: 'history', content: 'Tour précédent.' },
  { kind: 'resource', content: '# Skill', name: 'SKILL.md', mediaType: 'text/markdown' },
  { kind: 'attachment', content: 'preuve', name: 'preuve.txt', mediaType: 'text/plain' },
  { kind: 'tool-call', content: '{"path":"RUN.md"}', mediaType: 'application/json' },
  { kind: 'tool-result', content: 'status: open' },
  { kind: 'model-response', content: 'Je délègue au juge.' },
  { kind: 'error', content: 'timeout' }
]

function completeEvent(overrides: Partial<TraceEventV1> = {}): TraceEventV1 {
  return {
    schema: 'autowin.trace/v1',
    id: 'evt-002',
    conversationId: 'conv-1',
    turnId: 'turn-1',
    parentId: 'evt-001',
    timestamp: '2026-07-19T12:00:00.000Z',
    sequence: 2,
    type: 'injection',
    status: 'completed',
    actor: { id: 'autowin', kind: 'system', label: 'Autowin OS' },
    injector: { id: 'skill-frame', kind: 'skill', label: 'Frame' },
    recipient: { id: 'orchestrator', kind: 'agent', label: 'Orchestrateur' },
    channel: 'system',
    payloads,
    observation: {
      boundary: 'pre-provider',
      fidelity: 'exact',
      limitation: 'Transformations internes du provider non observables.'
    },
    provider: { id: 'codex', model: 'gpt-5.6-sol', reasoningEffort: 'high' },
    metrics: { durationMs: 42, inputTokens: 120, outputTokens: 0, cacheReadTokens: 20 },
    ...overrides
  }
}

describe('TraceEvent v1 — contrat causal canonique', () => {
  it('accepte une fixture exhaustive sans tronquer les payloads', () => {
    const longContent = 'x'.repeat(12_000)
    const event = completeEvent({
      payloads: [...payloads, { kind: 'attachment', name: 'long.txt', content: longContent }]
    })
    expect(assertTraceEvent(event)).toBe(event)
    expect(event.payloads.at(-1)?.content).toHaveLength(12_000)
  })

  it.each([
    ['id', { id: '' }],
    ['conversation', { conversationId: '' }],
    ['causal parent', { parentId: 'evt-002' }],
    ['actor', { actor: { id: '', kind: 'agent', label: 'Agent' } }],
    ['payload', { payloads: [] }],
    ['observation boundary', { observation: { boundary: '', fidelity: 'exact' } }]
  ])('rejette un événement sans %s', (_label, mutation) => {
    expect(() => assertTraceEvent(completeEvent(mutation as Partial<TraceEventV1>))).toThrow()
  })

  it('distingue retry, annulation, sous-agent, juge et zone opaque', () => {
    const variants: TraceEventV1[] = [
      completeEvent({ id: 'retry', type: 'retry', status: 'running' }),
      completeEvent({ id: 'cancel', type: 'cancellation', status: 'cancelled' }),
      completeEvent({
        id: 'subagent',
        type: 'handoff',
        actor: { id: 'sub', kind: 'agent', label: 'Sous-agent' }
      }),
      completeEvent({
        id: 'judge',
        type: 'verdict',
        actor: { id: 'judge', kind: 'judge', label: 'Juge' }
      }),
      completeEvent({
        id: 'opaque',
        type: 'boundary',
        observation: { boundary: 'inside-provider', fidelity: 'opaque', limitation: 'Non exposé.' }
      })
    ]
    expect(variants.map(assertTraceEvent)).toEqual(variants)
  })

  it('valide un reçu d’autorité complet et rejette les valeurs inventées', () => {
    const authorized = completeEvent({
      type: 'decision',
      actor: { id: 'autowin-authority', kind: 'system', label: 'Autorité Autowin' },
      channel: 'internal',
      observation: { boundary: 'app-command-bus', fidelity: 'exact' },
      authority: {
        mode: 'ask',
        commandAuthority: 'destructive',
        mutates: true,
        decision: 'confirm',
        decisionId: 'dec-1',
        resolution: 'approve',
        resolvedBy: 'user'
      }
    })

    expect(assertTraceEvent(authorized)).toBe(authorized)
    expect(() =>
      assertTraceEvent({
        ...authorized,
        authority: { ...authorized.authority!, decision: 'maybe' as never }
      })
    ).toThrow(/authority\.decision/)
  })
})

describe('identifiant d action — l unicite ne doit pas dependre d un compteur remis a zero', () => {
  it('DEUX retry d un meme tour recoivent des identifiants DISTINCTS', () => {
    // Le defaut mesure : l id valait `${turnId}:action:${compteur}:${kind}` et le compteur etait remis a
    // ZERO a chaque `prompt-call`. Un tour avec deux `retry` separes par un prompt-call produisait donc
    // deux fois `…:action:0:retry`, `TraceStore.append` jetait « evenement duplique », et le TOUR ENTIER
    // echouait. C etait le dernier incident legitime capable de declencher un auto-kaizen.
    const premier = traceActionEventId({ turnId: 'T', kind: 'retry', iteration: 1, ordinal: 0 })
    const second = traceActionEventId({ turnId: 'T', kind: 'retry', iteration: 2, ordinal: 1 })
    expect(premier).not.toBe(second)
  })

  it('reste distinct meme dans la MEME iteration — c est l ordinal qui porte l unicite', () => {
    // Inclure seulement l iteration ne suffisait pas : deux retry de la meme iteration collisionneraient.
    const a = traceActionEventId({ turnId: 'T', kind: 'retry', iteration: 1, ordinal: 0 })
    const b = traceActionEventId({ turnId: 'T', kind: 'retry', iteration: 1, ordinal: 1 })
    expect(a).not.toBe(b)
  })

  it('un lot de 50 evenements sans actionId ne produit AUCUN doublon', () => {
    const ids = Array.from({ length: 50 }, (_, i) =>
      traceActionEventId({ turnId: 'T', kind: 'retry', iteration: i % 3, ordinal: i })
    )
    expect(new Set(ids).size).toBe(50)
  })

  it('respecte l actionId FOURNI quand il existe, et neutralise ses deux-points', () => {
    // `command`/`result` portent leur propre actionId, deja unique : on ne le remplace pas. Les `:` sont
    // remplaces pour que l identifiant reste decoupable sans ambiguite.
    expect(
      traceActionEventId({ turnId: 'T', kind: 'command', actionId: 'a:b:c', ordinal: 7 })
    ).toBe('T:action:a-b-c:command')
  })

  it('reste STABLE pour un meme actionId, quel que soit l ordinal', () => {
    // L ordinal ne doit pas fabriquer de fausse difference sur un evenement deja identifie.
    const x = traceActionEventId({ turnId: 'T', kind: 'result', actionId: 'act-1', ordinal: 0 })
    const y = traceActionEventId({ turnId: 'T', kind: 'result', actionId: 'act-1', ordinal: 99 })
    expect(x).toBe(y)
  })

  it('distingue deux KINDS partageant le meme ordinal', () => {
    expect(traceActionEventId({ turnId: 'T', kind: 'retry', ordinal: 0 })).not.toBe(
      traceActionEventId({ turnId: 'T', kind: 'error', ordinal: 0 })
    )
  })
})
