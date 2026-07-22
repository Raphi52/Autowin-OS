import { describe, it, expect } from 'vitest'
import { CostAggregator, type TurnCost } from './cost'

describe('CostAggregator', () => {
  it('add + totalUsd cumule le cout', () => {
    const agg = new CostAggregator()
    agg.add({ provider: 'claude', inputTokens: 100, outputTokens: 50, costUsd: 0.5 })
    agg.add({ provider: 'claude', inputTokens: 200, outputTokens: 80, costUsd: 0.3 })
    expect(agg.totalUsd()).toBeCloseTo(0.8)
  })

  it('totalTokens cumule input/output/cacheRead', () => {
    const agg = new CostAggregator()
    agg.add({ provider: 'claude', inputTokens: 100, outputTokens: 50, cacheReadTokens: 20 })
    agg.add({ provider: 'codex', inputTokens: 40, outputTokens: 10, cacheReadTokens: 5 })
    expect(agg.totalTokens()).toEqual({ input: 140, output: 60, cacheRead: 25 })
  })

  it('totalTokens sans cacheReadTokens => cacheRead reste a 0', () => {
    const agg = new CostAggregator()
    agg.add({ provider: 'claude', inputTokens: 10, outputTokens: 5 })
    expect(agg.totalTokens().cacheRead).toBe(0)
  })

  it('byProvider agrege cout et nombre de tours par provider', () => {
    const agg = new CostAggregator()
    agg.add({ provider: 'claude', inputTokens: 1, outputTokens: 1, costUsd: 1 })
    agg.add({ provider: 'claude', inputTokens: 1, outputTokens: 1, costUsd: 2 })
    agg.add({ provider: 'codex', inputTokens: 1, outputTokens: 1, costUsd: 0.5 })
    expect(agg.byProvider()).toEqual({
      claude: { costUsd: 3, turns: 2 },
      codex: { costUsd: 0.5, turns: 1 }
    })
  })

  it('byRole agrege cout et nombre de tours par role (ignore les tours sans role)', () => {
    const agg = new CostAggregator()
    agg.add({
      provider: 'claude',
      role: 'orchestrator',
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 1
    })
    agg.add({ provider: 'claude', role: 'subagent', inputTokens: 1, outputTokens: 1, costUsd: 2 })
    agg.add({ provider: 'claude', inputTokens: 1, outputTokens: 1, costUsd: 5 })
    expect(agg.byRole()).toEqual({
      orchestrator: { costUsd: 1, turns: 1 },
      subagent: { costUsd: 2, turns: 1 }
    })
  })

  it('budget non defini => alert false et ratio null', () => {
    const agg = new CostAggregator()
    agg.add({ provider: 'claude', inputTokens: 1, outputTokens: 1, costUsd: 100 })
    const status = agg.budgetStatus()
    expect(status.budget).toBeNull()
    expect(status.ratio).toBeNull()
    expect(status.alert).toBe(false)
  })

  it('sous 80% du budget => alert false', () => {
    const agg = new CostAggregator(10)
    agg.add({ provider: 'claude', inputTokens: 1, outputTokens: 1, costUsd: 7 })
    const status = agg.budgetStatus()
    expect(status.ratio).toBeCloseTo(0.7)
    expect(status.alert).toBe(false)
  })

  it('a exactement 80% du budget => alert true', () => {
    const agg = new CostAggregator(10)
    agg.add({ provider: 'claude', inputTokens: 1, outputTokens: 1, costUsd: 8 })
    const status = agg.budgetStatus()
    expect(status.ratio).toBeCloseTo(0.8)
    expect(status.alert).toBe(true)
  })

  it('au-dessus de 80% du budget => alert true', () => {
    const agg = new CostAggregator(10)
    agg.add({ provider: 'claude', inputTokens: 1, outputTokens: 1, costUsd: 9.5 })
    const status = agg.budgetStatus()
    expect(status.alert).toBe(true)
    expect(status.spent).toBeCloseTo(9.5)
  })

  it('turn sans costUsd compte comme 0 dans les totaux', () => {
    const t: TurnCost = { provider: 'claude', inputTokens: 5, outputTokens: 5 }
    const agg = new CostAggregator()
    agg.add(t)
    expect(agg.totalUsd()).toBe(0)
    expect(agg.byProvider().claude.costUsd).toBe(0)
  })
})

describe('CostAggregator — persistance (F1)', () => {
  it('recharge les tours depuis le fichier au démarrage', async () => {
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const path = join(mkdtempSync(join(tmpdir(), 'cost-')), 'cost.jsonl')
    const first = new CostAggregator(undefined, path)
    first.add({ provider: 'codex', inputTokens: 100, outputTokens: 50, costUsd: 0.4 })
    first.add({ provider: 'claude', inputTokens: 200, outputTokens: 80, costUsd: 0.6 })
    // Nouvelle instance (= redémarrage app) : le coût doit persister.
    const reloaded = new CostAggregator(undefined, path)
    expect(reloaded.totalUsd()).toBeCloseTo(1.0)
    expect(reloaded.byProvider().codex.turns).toBe(1)
  })
})
