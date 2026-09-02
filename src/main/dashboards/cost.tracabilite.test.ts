import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CostAggregator, withCostContext } from './cost'

/**
 * Chaque ligne de `cost.jsonl` doit pouvoir dire QUAND elle a ete ecrite et POUR QUELLE
 * conversation. Sans ces deux champs, le rapport /rendement ne peut pas rattacher un dollar
 * a un tour : il ne restait qu'un provider et des tokens hors du temps.
 */
describe('cost.jsonl — tracabilite temporelle et conversationnelle', () => {
  it('horodate chaque tour persiste, meme quand l appelant ne fournit pas de date', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'cost-trace-')), 'cost.jsonl')
    const agg = new CostAggregator(undefined, path)
    agg.add({ provider: 'claude', inputTokens: 1, outputTokens: 2, costUsd: 0.5 })
    const ligne = JSON.parse(readFileSync(path, 'utf8').trim())
    expect(typeof ligne.ts).toBe('string')
    expect(Number.isFinite(Date.parse(ligne.ts))).toBe(true)
  })

  it('conserve la date fournie par l appelant', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'cost-trace-')), 'cost.jsonl')
    const agg = new CostAggregator(undefined, path)
    agg.add({ provider: 'claude', inputTokens: 1, outputTokens: 2, ts: '2026-01-02T03:04:05.000Z' })
    expect(JSON.parse(readFileSync(path, 'utf8').trim()).ts).toBe('2026-01-02T03:04:05.000Z')
  })

  it('attache conversation et tour quand le contexte est connu', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'cost-trace-')), 'cost.jsonl')
    const agg = new CostAggregator(undefined, path)
    const scoped = withCostContext(agg, { conversationId: 'conv-71', turnId: 'turn-9' })
    scoped.add({ provider: 'codex', inputTokens: 3, outputTokens: 4 })
    const ligne = JSON.parse(readFileSync(path, 'utf8').trim())
    expect(ligne.conversationId).toBe('conv-71')
    expect(ligne.turnId).toBe('turn-9')
  })

  it('ne fabrique jamais de conversation quand elle est inconnue', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'cost-trace-')), 'cost.jsonl')
    const agg = new CostAggregator(undefined, path)
    withCostContext(agg, {}).add({ provider: 'codex', inputTokens: 1, outputTokens: 1 })
    const ligne = JSON.parse(readFileSync(path, 'utf8').trim())
    expect(ligne.conversationId).toBeUndefined()
    expect(ligne.turnId).toBeUndefined()
  })

  it('n ecrase pas un contexte deja porte par l appelant', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'cost-trace-')), 'cost.jsonl')
    const agg = new CostAggregator(undefined, path)
    withCostContext(agg, { conversationId: 'conv-1' }).add({
      provider: 'codex',
      inputTokens: 1,
      outputTokens: 1,
      conversationId: 'conv-2'
    })
    expect(JSON.parse(readFileSync(path, 'utf8').trim()).conversationId).toBe('conv-2')
  })
})
