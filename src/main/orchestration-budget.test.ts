import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  costLimitsFromSettings,
  loadOrchestrationBudget,
  saveOrchestrationBudget
} from './orchestration-budget'
import { CostCircuitBreaker } from './cost-circuit-breaker'

const folders: string[] = []
function settingPath(): string {
  const folder = mkdtempSync(join(tmpdir(), 'autowin-budget-'))
  folders.push(folder)
  return join(folder, 'orchestration-budget.json')
}
afterEach(() =>
  folders.splice(0).forEach((folder) => rmSync(folder, { recursive: true, force: true }))
)

describe('orchestration budget settings', () => {
  it('defaults explicitly to no cost limit and therefore never trips on cost', () => {
    const path = settingPath()
    const settings = loadOrchestrationBudget(path)
    expect(settings).toEqual({ maxUsd: null })
    expect(
      new CostCircuitBreaker(costLimitsFromSettings(settings)).observe({
        step: 'exec',
        costUsd: 999
      })
    ).toBeNull()
  })

  it('persists a positive USD cap and feeds the runtime breaker', () => {
    const path = settingPath()
    expect(saveOrchestrationBudget(path, { maxUsd: 1.5 })).toEqual({ maxUsd: 1.5 })
    const breaker = new CostCircuitBreaker(costLimitsFromSettings(loadOrchestrationBudget(path)))
    expect(breaker.observe({ step: 'exec', costUsd: 1.5 })).toBeNull()
    expect(breaker.observe({ step: 'exec', costUsd: 0.01 })?.reason).toContain('seuil 1.50$')
  })

  it('rejects unsafe caps and safely falls back to no limit for malformed persisted data', () => {
    const path = settingPath()
    expect(() => saveOrchestrationBudget(path, { maxUsd: 0 })).toThrow(/strictement positif/)
    writeFileSync(path, '{"maxUsd":"not-a-number"}', 'utf8')
    expect(loadOrchestrationBudget(path)).toEqual({ maxUsd: null })
  })
})
