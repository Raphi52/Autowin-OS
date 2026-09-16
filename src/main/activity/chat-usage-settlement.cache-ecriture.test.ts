import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadConvActivity } from './conv-activity'
import { persistChatUsageSettlement } from './chat-usage-settlement'
import { TraceStore } from './trace-store'
import type { ExecutionUsageSnapshot } from '../execution-supervisor'

/**
 * LE PRIX DU CACHE N'ETAIT JAMAIS ECRIT. `scripts/audit-cout-tokens.mjs` mesure
 * « cacheCreationTokens cumules = 0 » sur tous les enregistrements `chat-usage` de
 * `.autowin-data` — non pas parce que rien n'est ecrit en cache, mais parce que cette projection
 * recopiait `cacheReadTokens` et LAISSAIT TOMBER `cacheCreationTokens`, pourtant present dans le
 * snapshot du superviseur (execution-supervisor.ts) et deja utilise deux lignes plus haut pour le
 * libelle de cout. Sans lui, tout raisonnement « un cache 1 h ferait gagner X » est invérifiable :
 * on ne connait que le benefice, jamais le prix paye.
 */
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
    cacheCreationTokens: 0,
    totalTokens: 0,
    freshTokens: 0,
    knownCostUsd: null,
    unpricedCalls: 0,
    unmeteredCalls: 0,
    tokenCoverage: 'complete',
    ...overrides
  } as ExecutionUsageSnapshot
}

describe('chat-usage — cout d’ECRITURE du cache', () => {
  it('ecrit cacheCreationTokens en delta, comme la lecture', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-cache-write-'))
    const activityRoot = join(root, 'activity')
    const traceStore = new TraceStore(join(root, 'trace'))
    const commun = {
      conversationId: 'conv-cache',
      turnId: 'turn-cache',
      provider: 'claude',
      model: 'claude-opus-5',
      label: 'test',
      activityRoot,
      traceStore
    }
    const premier = usage({ inputTokens: 100, cacheReadTokens: 10, cacheCreationTokens: 40 })
    persistChatUsageSettlement({ ...commun, usage: premier })
    persistChatUsageSettlement({
      ...commun,
      usage: usage({ inputTokens: 250, cacheReadTokens: 30, cacheCreationTokens: 90 }),
      previous: premier
    })

    const lignes = loadConvActivity('conv-cache', activityRoot).filter(
      (e) => e.kind === 'chat-usage'
    ) as unknown as Array<Record<string, unknown>>
    expect(lignes).toHaveLength(2)
    expect(lignes[0].cacheCreationTokens).toBe(40)
    expect(lignes[1].cacheCreationTokens).toBe(50)
    expect(lignes[1].cacheReadTokens).toBe(20)
  })
})
