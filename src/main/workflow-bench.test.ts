import { describe, expect, it, vi } from 'vitest'
import { runWorkflowBench } from './workflow-bench'
import type { OrchestrationResult } from './orchestrator'
import type { WorkflowProfile } from './workflow-profiles'

const profile = (id: string): WorkflowProfile => ({ id, name: id })

const ok = (costUsd: number, over: Partial<OrchestrationResult> = {}): OrchestrationResult =>
  ({
    task: 'obj',
    result: 'fait',
    valid: true,
    gateBlocked: false,
    gateReasons: [],
    costUsd,
    phaseOutputs: [],
    trace: [],
    ...over
  }) as OrchestrationResult

describe('confronter plusieurs workflows sur un objectif', () => {
  it('lance chaque workflow sur le MÊME objectif et classe le résultat', async () => {
    const runOnce = vi
      .fn()
      .mockResolvedValueOnce(ok(3))
      .mockResolvedValueOnce(ok(1))
    const report = await runWorkflowBench(
      { objective: 'ranger la cuisine', profiles: [profile('lent'), profile('vif')] },
      { runOnce }
    )
    expect(runOnce.mock.calls.map((c) => c[0])).toEqual(['ranger la cuisine', 'ranger la cuisine'])
    expect(report.recommendedProfileId).toBe('vif')
    expect(report.objective).toBe('ranger la cuisine')
  })

  it('les runs s’ENCHAÎNENT — deux workflows en parallèle se marcheraient dessus', async () => {
    let enCours = 0
    let maxSimultane = 0
    const runOnce = vi.fn(async () => {
      maxSimultane = Math.max(maxSimultane, ++enCours)
      await Promise.resolve()
      enCours--
      return ok(1)
    })
    await runWorkflowBench({ objective: 'o', profiles: [profile('a'), profile('b'), profile('c')] }, { runOnce })
    expect(maxSimultane).toBe(1)
  })

  it('un workflow qui CRASHE reste dans le tableau, non vert et sans coût inventé', async () => {
    const runOnce = vi
      .fn()
      .mockRejectedValueOnce(new Error('provider mort'))
      .mockResolvedValueOnce(ok(2))
    const report = await runWorkflowBench(
      { objective: 'o', profiles: [profile('fragile'), profile('solide')] },
      { runOnce }
    )
    const fragile = report.rows.find((r) => r.profileId === 'fragile')
    expect(fragile).toBeDefined() // sinon le workflow le plus fragile disparaîtrait du classement
    expect(fragile?.green).toBe(false)
    expect(fragile?.comparableCostUsd).toBeNull()
    expect(report.recommendedProfileId).toBe('solide')
  })

  it('un run bloqué par le gate n’est pas vert, quoi qu’il ait écrit', async () => {
    const runOnce = vi.fn().mockResolvedValue(ok(1, { gateBlocked: true, gateReasons: ['secret'] }))
    const report = await runWorkflowBench({ objective: 'o', profiles: [profile('a')] }, { runOnce })
    expect(report.rows[0].green).toBe(false)
    expect(report.recommendedProfileId).toBeUndefined()
  })

  it('préfère la consommation MESURÉE au coût déclaré, et reporte les appels non tarifés', async () => {
    const usage = { totalTokens: 900, knownCostUsd: 0.5, unpricedCalls: 2, activeCalls: 0 }
    const runOnce = vi.fn().mockResolvedValue(ok(99, { usage } as Partial<OrchestrationResult>))
    const report = await runWorkflowBench({ objective: 'o', profiles: [profile('a')] }, { runOnce })
    expect(report.rows[0].costUsd).toBe(0.5)
    expect(report.rows[0].comparableCostUsd).toBeNull() // amputé de 2 appels
    expect(report.rows[0].totalTokens).toBe(900)
  })

  it('la configuration courante concourt comme les autres', async () => {
    const runOnce = vi.fn().mockResolvedValueOnce(ok(1)).mockResolvedValueOnce(ok(5))
    const report = await runWorkflowBench({ objective: 'o', profiles: [null, profile('cher')] }, { runOnce })
    expect(report.rows[0].profileName).toBe('Configuration courante')
    expect(report.recommendedProfileId).toBe('')
  })

  it('interrompre n’efface pas ce qui restait à lancer — c’est dit', async () => {
    const controller = new AbortController()
    const runOnce = vi.fn(async () => {
      controller.abort()
      return ok(1)
    })
    const report = await runWorkflowBench(
      { objective: 'o', profiles: [profile('a'), profile('b')] },
      { runOnce, signal: controller.signal }
    )
    expect(runOnce).toHaveBeenCalledTimes(1)
    expect(report.skipped).toEqual(['b'])
  })

  it('annonce la progression pour que l’attente ne soit pas aveugle', async () => {
    const onProgress = vi.fn()
    await runWorkflowBench(
      { objective: 'o', profiles: [profile('a'), profile('b')] },
      { runOnce: vi.fn().mockResolvedValue(ok(1)), onProgress }
    )
    expect(onProgress).toHaveBeenCalledWith(0, 2, 'a')
    expect(onProgress).toHaveBeenCalledWith(1, 2, 'b')
  })
})
