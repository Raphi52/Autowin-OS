import { mkdtempSync, readFileSync } from 'node:fs'
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
    completedCalls: 0,
    failedCalls: 0,
    activeCalls: 1,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    freshTokens: 0,
    knownCostUsd: null,
    unpricedCalls: 0,
    unmeteredCalls: 0,
    tokenCoverage: 'complete',
    ...overrides
  }
}

describe('persistChatUsageSettlement', () => {
  it('persiste seulement le delta tardif et garde le cout inconnu explicite', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-chat-usage-'))
    const activityRoot = join(root, 'activity')
    const traceRoot = join(root, 'trace')
    const traceStore = new TraceStore(traceRoot)
    const first = usage()
    const terminal = usage({
      completedCalls: 0,
      failedCalls: 1,
      activeCalls: 0,
      inputTokens: 120,
      outputTokens: 8,
      cacheReadTokens: 20,
      totalTokens: 128,
      freshTokens: 108,
      unpricedCalls: 1
    })

    const persistedFirst = persistChatUsageSettlement({
      conversationId: 'conv-usage',
      turnId: 'turn-usage',
      usage: first,
      provider: 'codex',
      model: 'gpt-test',
      label: 'test',
      activityRoot,
      traceStore
    })
    persistChatUsageSettlement({
      conversationId: 'conv-usage',
      turnId: 'turn-usage',
      usage: terminal,
      previous: persistedFirst,
      provider: 'codex',
      model: 'gpt-test',
      label: 'test',
      activityRoot,
      traceStore
    })

    const activity = loadConvActivity('conv-usage', activityRoot)
    expect(activity).toHaveLength(2)
    expect(activity[1]).toMatchObject({
      inputTokens: 120,
      outputTokens: 8,
      cacheReadTokens: 20
    })
    expect(activity[1].costUsd).toBeUndefined()
    expect(activity[1].text).toMatch(/cout non expose/i)
    expect(activity[1].text).toMatch(/0 appel\(s\) actif/i)

    const trace = traceStore.readConversation('conv-usage')
    expect(trace).toHaveLength(2)
    expect(trace[1]).toMatchObject({
      status: 'failed',
      metrics: { inputTokens: 120, outputTokens: 8, cacheReadTokens: 20 }
    })
    expect(JSON.parse(trace[1].payloads[0].content)).toMatchObject({
      activeCalls: 0,
      failedCalls: 1,
      knownCostUsd: null
    })

    traceStore.deleteConversation('conv-usage')
    expect(() => readFileSync(join(traceRoot, 'conv-usage.jsonl'))).toThrow()
  })

  it('ne duplique pas un snapshot deja persiste', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-chat-usage-dedupe-'))
    const activityRoot = join(root, 'activity')
    const traceStore = new TraceStore(join(root, 'trace'))
    const terminal = usage({ activeCalls: 0, completedCalls: 1, inputTokens: 4, totalTokens: 4 })

    const previous = persistChatUsageSettlement({
      conversationId: 'conv-dedupe',
      turnId: 'turn-dedupe',
      usage: terminal,
      provider: 'claude',
      label: 'test',
      activityRoot,
      traceStore
    })
    persistChatUsageSettlement({
      conversationId: 'conv-dedupe',
      turnId: 'turn-dedupe',
      usage: terminal,
      previous,
      provider: 'claude',
      label: 'test',
      activityRoot,
      traceStore
    })

    expect(loadConvActivity('conv-dedupe', activityRoot)).toHaveLength(1)
    expect(traceStore.readConversation('conv-dedupe')).toHaveLength(1)
  })
})
