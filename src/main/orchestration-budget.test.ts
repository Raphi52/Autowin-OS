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
  it('a des plafonds durs par defaut meme sans cout USD', () => {
    const path = settingPath()
    const settings = loadOrchestrationBudget(path)
    expect(settings).toEqual({
      maxUsd: null,
      maxProviderCalls: 24,
      maxTotalTokens: 15_000_000
    })
    const breaker = new CostCircuitBreaker(costLimitsFromSettings(settings))
    expect(breaker.observe({ step: 'exec', tokens: 15_000_001 })?.trip).toBe(true)
  })

  it('persists a positive USD cap and feeds the runtime breaker', () => {
    const path = settingPath()
    expect(saveOrchestrationBudget(path, { maxUsd: 1.5 })).toEqual({
      maxUsd: 1.5,
      maxProviderCalls: 24,
      maxTotalTokens: 15_000_000
    })
    const breaker = new CostCircuitBreaker(costLimitsFromSettings(loadOrchestrationBudget(path)))
    expect(breaker.observe({ step: 'exec', costUsd: 1.5 })).toBeNull()
    expect(breaker.observe({ step: 'exec', costUsd: 0.01 })?.reason).toContain('seuil 1.50$')
  })

  it('rejects unsafe caps and blocks on malformed persisted data without recovery', () => {
    const path = settingPath()
    expect(() => saveOrchestrationBudget(path, { maxUsd: 0 })).toThrow(/strictement positif/)
    writeFileSync(path, '{"maxUsd":"not-a-number"}', 'utf8')
    expect(() => loadOrchestrationBudget(path)).toThrow(/budget.*invalide|corrompu/i)
  })

  it('récupère le dernier plafond valide après corruption du fichier principal', () => {
    const path = settingPath()
    saveOrchestrationBudget(path, { maxUsd: 1.5 })
    // La seconde publication crée une version précédente récupérable.
    saveOrchestrationBudget(path, { maxUsd: 1.5 })
    writeFileSync(path, '{"maxUsd":', 'utf8')

    const recovered = loadOrchestrationBudget(path)
    expect(recovered.maxUsd).toBe(1.5)
    const breaker = new CostCircuitBreaker(costLimitsFromSettings(recovered))
    expect(breaker.observe({ step: 'exec', costUsd: 1.51 })?.trip).toBe(true)
  })

  it('récupère le plafond si le JSON reste parsable mais perd un champ structurant', () => {
    const path = settingPath()
    saveOrchestrationBudget(path, { maxUsd: 1.5 })
    saveOrchestrationBudget(path, { maxUsd: 1.5 })
    writeFileSync(path, JSON.stringify({ maxProviderCalls: 24, maxTotalTokens: 15_000_000 }))

    const recovered = loadOrchestrationBudget(path)
    expect(recovered.maxUsd).toBe(1.5)
    const breaker = new CostCircuitBreaker(costLimitsFromSettings(recovered))
    expect(breaker.observe({ step: 'exec', costUsd: 1.51 })?.trip).toBe(true)
  })
})
