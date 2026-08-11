import { describe, expect, it } from 'vitest'
import type { ExecutionUsageSnapshot } from '../execution-supervisor'
import { taskUsageMetricsFromExecution } from './task-usage-metrics'

const usage = (overrides: Partial<ExecutionUsageSnapshot> = {}): ExecutionUsageSnapshot => ({
  quoteId: 'chat:test',
  startedCalls: 1,
  completedCalls: 1,
  failedCalls: 0,
  activeCalls: 0,
  inputTokens: 120,
  outputTokens: 8,
  cacheReadTokens: 80,
  totalTokens: 128,
  freshTokens: 48,
  knownCostUsd: 0.42,
  unpricedCalls: 0,
  unmeteredCalls: 0,
  tokenCoverage: 'complete',
  ...overrides
})

describe('taskUsageMetricsFromExecution', () => {
  it('convertit le snapshot terminal dans le contrat de metering des taches', () => {
    expect(taskUsageMetricsFromExecution(usage())).toEqual({
      knownCostUsd: 0.42,
      totalTokens: 128,
      unpricedCalls: 0
    })
  })

  it('ne fabrique pas un cout nul quand le provider ne le chiffre pas', () => {
    expect(
      taskUsageMetricsFromExecution(
        usage({ knownCostUsd: null, unpricedCalls: 1, tokenCoverage: 'partial' })
      )
    ).toEqual({ totalTokens: 128, unpricedCalls: 1 })
  })

  it('rend un objet vide sans snapshot', () => {
    expect(taskUsageMetricsFromExecution(undefined)).toEqual({})
  })
})
