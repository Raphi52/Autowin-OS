import { describe, expect, it } from 'vitest'
import { buildObservatoryExport } from './observatory-export-model'

describe('observatory export model', () => {
  it('exports every observability plane under a versioned schema', () => {
    const result = buildObservatoryExport({
      scope: 'full',
      exportedAt: '2026-07-20T02:00:00.000Z',
      conversationId: 'conv-1',
      filters: { query: 'brain', type: 'injection', provider: 'native' },
      view: { mode: 'timeline', quickFilter: 'all', causalScope: 'all' },
      limitations: ['Native global non rattaché'],
      timeline: { turns: [{ id: 'turn-1' }], anomalies: [] },
      causalNodes: [],
      promptCalls: [{ id: 'call-1', provider: 'codex', limitation: 'usage estimé' }],
      nativeTraces: [
        {
          apiRequestId: 'api-1',
          timestamp: '2026-07-20T01:59:00.000Z',
          provider: 'openai-codex',
          model: 'gpt',
          boundary: 'native.pre_api_request',
          source: 'plugin-hook',
          fidelity: 'exact-redacted',
          request: {
            headers: { authorization: 'Bearer raw-secret' },
            body: {
              messages: [
                {
                  content:
                    'Question\n\n[AMITEL BRAIN REFERENCE DATA]\n### Source 1 - knowledge/a.md\nProvenance: domain | global | codex | 2026-07-20'
                }
              ]
            }
          }
        }
      ]
    })

    expect(result).toMatchObject({
      schema: 'autowin.observatory-export/v1',
      scope: 'full',
      conversationId: 'conv-1',
      filters: { query: 'brain', type: 'injection', provider: 'native' },
      view: { mode: 'timeline', quickFilter: 'all', causalScope: 'all' },
      limitations: ['Native global non rattaché'],
      timeline: { turns: [{ id: 'turn-1' }] },
      promptCalls: [{ id: 'call-1' }],
      nativeRag: [
        {
          apiRequestId: 'api-1',
          fidelity: 'exact-redacted',
          rag: { status: 'injected', sources: [{ path: 'knowledge/a.md' }] }
        }
      ]
    })
    expect(JSON.stringify(result)).not.toContain('raw-secret')
    expect(result.nativeRag[0].request).toMatchObject({
      headers: { authorization: '[REDACTED]' }
    })
  })

  it('rejects a Native payload whose fidelity is not exact-redacted', () => {
    expect(() =>
      buildObservatoryExport({
        scope: 'full',
        exportedAt: '2026-07-20T02:00:00.000Z',
        conversationId: 'conv-1',
        filters: { query: '', type: 'all', provider: 'all' },
        view: { mode: 'timeline', quickFilter: 'all', causalScope: 'all' },
        limitations: [],
        timeline: { turns: [] },
        causalNodes: [],
        promptCalls: [],
        nativeTraces: [
          {
            apiRequestId: 'unsafe',
            timestamp: '2026-07-20T01:59:00.000Z',
            provider: 'custom',
            model: 'model',
            boundary: 'native.pre_api_request',
            source: 'request-dump',
            fidelity: 'raw' as 'exact-redacted',
            request: {}
          }
        ]
      })
    ).toThrow(/exact-redacted/)
  })
})
