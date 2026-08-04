import { describe, expect, it } from 'vitest'
import type { ExecutionUsageSnapshot } from '../execution-supervisor'
import type { RunLifecycleEvent } from '../../shared/run-execution'
import { reconcileLateRunLifecycle } from './late-run-usage-settlement'

const usage = (overrides: Partial<ExecutionUsageSnapshot> = {}): ExecutionUsageSnapshot => ({
  quoteId: 'quote-1',
  startedAgents: 1,
  startedCalls: 1,
  completedCalls: 0,
  failedCalls: 1,
  activeCalls: 0,
  inputTokens: 120,
  outputTokens: 8,
  cacheReadTokens: 20,
  totalTokens: 128,
  freshTokens: 108,
  knownCostUsd: null,
  unpricedCalls: 1,
  unmeteredCalls: 0,
  tokenCoverage: 'complete',
  ...overrides
})

const closure = (
  currentUsage: ExecutionUsageSnapshot
): Extract<RunLifecycleEvent, { stage: 'closure' }> => ({
  stage: 'closure',
  runId: 'run-1',
  timestampMs: 10,
  closure: {
    status: 'red',
    totalDurationMs: 1000,
    totalCostUsd: 0,
    usage: currentUsage
  }
})

describe('règlement tardif d’une lifecycle de run', () => {
  it('ne fabrique pas de clôture avant que le run en ait publié une', () => {
    expect(reconcileLateRunLifecycle(undefined, usage(), 20)).toBeUndefined()
  })

  it('déduplique un snapshot identique', () => {
    const current = usage()
    expect(reconcileLateRunLifecycle(closure(current), current, 20)).toBeUndefined()
  })

  it('remplace uniquement l’usage terminal et conserve le sort du run', () => {
    const initial = usage({ activeCalls: 1, inputTokens: 0, outputTokens: 0, totalTokens: 0 })
    const settled = usage()

    expect(reconcileLateRunLifecycle(closure(initial), settled, 42)).toEqual({
      ...closure(initial),
      timestampMs: 42,
      closure: {
        ...closure(initial).closure,
        totalCostUsd: 0,
        usage: settled
      }
    })
  })
})
