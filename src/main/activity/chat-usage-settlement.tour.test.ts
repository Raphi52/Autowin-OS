import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadConvActivity } from './conv-activity'
import { persistChatUsageSettlement } from './chat-usage-settlement'
import { TraceStore } from './trace-store'
import type { ExecutionUsageSnapshot } from '../execution-supervisor'

function usage(overrides: Partial<ExecutionUsageSnapshot> = {}): ExecutionUsageSnapshot {
  return {
    quoteId: 'quote-chat',
    startedCalls: 1,
    completedCalls: 1,
    failedCalls: 0,
    activeCalls: 0,
    inputTokens: 100,
    outputTokens: 10,
    cacheReadTokens: 0,
    totalTokens: 110,
    freshTokens: 110,
    knownCostUsd: 0.5,
    unpricedCalls: 0,
    unmeteredCalls: 0,
    tokenCoverage: 'complete',
    ...overrides
  }
}

/**
 * Le cout d'un TOUR DE CHAT partait dans le journal de conversation sans son tour, alors que le
 * reglement l'a en main (il l'ecrit deja dans la trace). /rendement devait donc le rattacher a la
 * derniere demande par l'HEURE : faux des qu'un appel se regle apres la demande suivante.
 */
describe('reglement d usage de chat — tour d origine', () => {
  it('ecrit le turnId dans le journal de conversation', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-usage-tour-'))
    const activityRoot = join(root, 'activity')
    const traceStore = new TraceStore(join(root, 'trace'))

    persistChatUsageSettlement({
      conversationId: 'conv-tour',
      turnId: 'turn-42',
      usage: usage(),
      provider: 'claude',
      model: 'opus',
      label: 'chat',
      activityRoot,
      traceStore
    })

    const entries = loadConvActivity('conv-tour', activityRoot)
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.at(-1)?.turnId).toBe('turn-42')
  })
})
