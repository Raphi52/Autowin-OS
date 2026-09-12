import { describe, it, expect } from 'vitest'
import { construireRetrospective } from './trace-retrospective-model'
import type { TraceEventLu } from './trace-retrospective-model'

function event(partiel: Partial<TraceEventLu> & Pick<TraceEventLu, 'turnId' | 'type'> & { id: string }): TraceEventLu {
  return {
    schema: 'autowin.trace/v1',
    conversationId: 'conv-1',
    timestamp: '2026-09-12T10:00:00.000Z',
    sequence: 1,
    status: 'completed',
    actor: { id: 'a', kind: 'agent', label: 'Agent' },
    channel: 'assistant',
    payloads: [],
    observation: { boundary: 'test', fidelity: 'exact' },
    ...partiel
  } as TraceEventLu
}

describe('retrospective d’une conversation depuis la trace disque', () => {
  it('replie raisonnement et actions par tour, le plus récent d’abord', () => {
    const tours = construireRetrospective([
      event({
        id: '1',
        turnId: 't1',
        type: 'message',
        sequence: 1,
        actor: { id: 'u', kind: 'human', label: 'Moi' },
        payloads: [{ kind: 'user-message', content: 'corrige le bloc Actions' }]
      }),
      event({
        id: '2',
        turnId: 't1',
        type: 'model-response',
        sequence: 2,
        payloads: [{ kind: 'reasoning', content: '  je relis le fichier  ' }]
      }),
      event({
        id: '3',
        turnId: 't1',
        type: 'tool-call',
        sequence: 3,
        payloads: [{ kind: 'tool-call', name: 'Bash', content: '{"name":"Bash","args":{"command":"npm test"}}' }]
      }),
      event({
        id: '4',
        turnId: 't2',
        type: 'tour-suivant',
        sequence: 4,
        timestamp: '2026-09-12T11:00:00.000Z'
      }),
      event({
        id: '5',
        turnId: 't2',
        type: 'tool-call',
        sequence: 5,
        timestamp: '2026-09-12T11:00:01.000Z',
        payloads: [{ kind: 'tool-call', name: 'Read', content: 'src/a.ts' }]
      })
    ])

    expect(tours.map((t) => t.turnId)).toEqual(['t2', 't1'])
    const premier = tours[1]
    expect(premier.demande).toBe('corrige le bloc Actions')
    expect(premier.raisonnement).toEqual(['je relis le fichier'])
    expect(premier.actions).toEqual([
      { nom: 'Bash', detail: 'npm test', statut: 'completed', horodatage: '2026-09-12T10:00:00.000Z' }
    ])
    expect(tours[0].actions[0]).toMatchObject({ nom: 'Read', detail: 'src/a.ts' })
  })

  it('n’affiche PAS les reçus d’autorité comme du raisonnement', () => {
    const tours = construireRetrospective([
      event({
        id: '1',
        turnId: 't1',
        type: 'decision',
        actor: { id: 'autowin-authority', kind: 'system', label: 'Autorite Autowin' },
        payloads: [{ kind: 'reasoning', content: 'orchestrate — mutation oui, decision allow' }]
      }),
      event({
        id: '2',
        turnId: 't1',
        type: 'model-response',
        sequence: 2,
        payloads: [{ kind: 'reasoning', content: 'la vraie pensée' }]
      })
    ])

    expect(tours[0].raisonnement).toEqual(['la vraie pensée'])
  })

  it('affiche le raisonnement du modèle, écrit en événement `decision` par un acteur agent', () => {
    const tours = construireRetrospective([
      event({
        id: '1',
        turnId: 't1',
        type: 'decision',
        actor: { id: 'orchestrator', kind: 'agent', label: 'Orchestrateur' },
        payloads: [{ kind: 'reasoning', content: 'je compare A et B' }]
      })
    ])

    expect(tours[0].raisonnement).toEqual(['je compare A et B'])
  })

  it('écarte les tours sans aucune trace exploitable', () => {
    expect(construireRetrospective([event({ id: '1', turnId: 't1', type: 'boundary' })])).toEqual([])
  })
})
