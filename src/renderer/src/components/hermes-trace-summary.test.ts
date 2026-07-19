import { describe, expect, it } from 'vitest'
import { summarizeHermesTraces } from './hermes-trace-summary'

describe('résumé des traces Hermes', () => {
  it('distingue clairement les appels non rattachés et la dernière preuve', () => {
    expect(
      summarizeHermesTraces([
        {
          timestamp: '2026-07-19T13:00:00.000Z',
          provider: 'custom',
          model: 'gpt',
          boundary: 'hermes.pre_api_request',
          source: 'plugin-hook'
        }
      ])
    ).toEqual({
      count: 1,
      linkedCount: 0,
      unlinkedCount: 1,
      lastTimestamp: '2026-07-19T13:00:00.000Z',
      lastProvider: 'custom',
      lastModel: 'gpt',
      boundary: 'hermes.pre_api_request',
      source: 'plugin-hook',
      coverage: 'non-rattachée'
    })
  })

  it('retourne un état absent explicite', () => {
    expect(summarizeHermesTraces([])).toMatchObject({ count: 0, coverage: 'aucune' })
  })
})
