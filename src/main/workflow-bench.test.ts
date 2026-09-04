import { describe, expect, it, vi } from 'vitest'
import { runWorkflowBench } from './workflow-bench'
import type { OrchestrationResult } from './orchestrator'
import type { WorkflowProfile } from './workflow-profiles'
import type { PersistedCheckpoint } from './wire-checkpoint-fork'

const profile = (id: string): WorkflowProfile => ({ id, name: id })
const held = (id: string, baseSha = 'base-sha') => ({
  runId: `run-${id}`,
  path: `C:/worktrees/${id}`,
  baseSha,
  files: []
})

const checkpoint: PersistedCheckpoint<{ objective: string; dirty: boolean }> = {
  id: 'checkpoint-before-run',
  runId: 'counterfactual-parent',
  createdAt: '2026-08-08T12:00:00.000Z',
  sourceSnapshot: {
    workspaceId: 'C:/repo',
    baseSha: 'base-sha',
    contentHash: 'sha256:workspace-before-run'
  },
  state: { objective: 'o', dirty: false }
}

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
    const runOnce = vi.fn().mockResolvedValueOnce(ok(3)).mockResolvedValueOnce(ok(1))
    const report = await runWorkflowBench(
      { objective: 'ranger la cuisine', profiles: [profile('lent'), profile('vif')] },
      { runOnce }
    )
    expect(runOnce.mock.calls.map((c) => c[0])).toEqual(['ranger la cuisine', 'ranger la cuisine'])
    expect(report.recommendedProfileId).toBe('vif')
    expect(report.objective).toBe('ranger la cuisine')
  })

  it('en tournoi, un run sans preuve ou avec une vérification rouge ne peut pas gagner', async () => {
    const preuve = (ok: boolean) => ({
      step: 'exec' as const,
      evidence: [
        {
          type: 'command_execution',
          kind: 'verification' as const,
          status: 'completed',
          ok,
          summary: ok ? 'tests verts' : 'tests rouges',
          command: 'npm test',
          exitCode: ok ? 0 : 1
        }
      ]
    })
    const runOnce = vi
      .fn()
      .mockResolvedValueOnce(ok(0.1, { trace: [], retainedWorkspace: held('sans-preuve') }))
      .mockResolvedValueOnce(ok(0.2, { trace: [preuve(false)], retainedWorkspace: held('rouge') }))
      .mockResolvedValueOnce(ok(0.3, { trace: [preuve(true)], retainedWorkspace: held('vert') }))

    const report = await runWorkflowBench(
      {
        objective: 'o',
        profiles: [profile('sans-preuve'), profile('rouge'), profile('vert')],
        mode: 'tournament'
      },
      { runOnce }
    )

    expect(report.winnerProfileId).toBe('vert')
    expect(report.ranking?.map((row) => row.profileId)).toEqual(['vert', 'sans-preuve', 'rouge'])
    expect(report.rows.map((row) => row.proofStatus)).toEqual(['unknown', 'failed', 'passed'])
  })

  it('en tournoi, aucune preuve verte signifie aucun gagnant', async () => {
    const runOnce = vi
      .fn()
      .mockResolvedValueOnce(ok(1, { retainedWorkspace: held('a') }))
      .mockResolvedValueOnce(ok(1, { retainedWorkspace: held('b') }))
      .mockResolvedValueOnce(ok(1, { retainedWorkspace: held('c') }))
    const report = await runWorkflowBench(
      { objective: 'o', profiles: [profile('a'), profile('b'), profile('c')], mode: 'tournament' },
      { runOnce }
    )
    expect(report.winnerProfileId).toBeUndefined()
    expect(report.tournamentRationale).toContain('preuve exécutable')
  })

  it('en tournoi, trois preuves sans trois bureaux isolés ne désignent aucun gagnant', async () => {
    const preuve = {
      step: 'exec' as const,
      evidence: [
        {
          type: 'command_execution',
          kind: 'verification' as const,
          status: 'completed',
          ok: true,
          summary: 'tests verts',
          command: 'npm test',
          exitCode: 0
        }
      ]
    }
    const report = await runWorkflowBench(
      { objective: 'o', profiles: [profile('a'), profile('b'), profile('c')], mode: 'tournament' },
      { runOnce: vi.fn().mockResolvedValue(ok(1, { trace: [preuve] })) }
    )

    expect(report.winnerProfileId).toBeUndefined()
    expect(report.tournamentRationale).toContain('trois bureaux isolés')
  })

  it('en tournoi, le verdict textuel ne renverse jamais le classement mesuré', async () => {
    const preuve = {
      step: 'exec' as const,
      evidence: [
        {
          type: 'command_execution',
          kind: 'verification' as const,
          status: 'completed',
          ok: true,
          summary: 'tests verts',
          command: 'npm test',
          exitCode: 0
        }
      ]
    }
    const runOnce = vi
      .fn()
      .mockResolvedValueOnce(ok(1, { trace: [preuve], retainedWorkspace: held('a') }))
      .mockResolvedValueOnce(ok(2, { trace: [preuve], retainedWorkspace: held('b') }))
      .mockResolvedValueOnce(ok(3, { trace: [preuve], retainedWorkspace: held('c') }))
    const report = await runWorkflowBench(
      { objective: 'o', profiles: [profile('a'), profile('b'), profile('c')], mode: 'tournament' },
      { runOnce, judgeQuality: vi.fn().mockResolvedValue('MEILLEUR: C') }
    )

    expect(report.ranking?.map((row) => row.profileId)).toEqual(['a', 'b', 'c'])
    expect(report.winnerProfileId).toBe('a')
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
    await runWorkflowBench(
      { objective: 'o', profiles: [profile('a'), profile('b'), profile('c')] },
      { runOnce }
    )
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
    const report = await runWorkflowBench(
      { objective: 'o', profiles: [null, profile('cher')] },
      { runOnce }
    )
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

  it('materialise deux forks du MEME checkpoint avec diff, cout, duree, risques et verdict', async () => {
    const preuve = {
      step: 'exec' as const,
      evidence: [
        {
          type: 'command_execution',
          kind: 'verification' as const,
          status: 'completed',
          ok: true,
          summary: 'tests verts',
          command: 'npm test',
          exitCode: 0
        }
      ]
    }
    const clock = [0, 120, 120, 300]
    const report = await runWorkflowBench(
      {
        objective: 'o',
        profiles: [profile('sobre'), profile('large')],
        mode: 'counterfactual',
        checkpoint
      },
      {
        now: () => clock.shift() ?? 300,
        captureWorkspaceState: async ({ path }): Promise<Record<string, string | null>> =>
          path.endsWith('sobre')
            ? { 'commun.ts': 'hash-sobre', 'sobre.ts': 'hash-only-sobre' }
            : { 'commun.ts': 'hash-large', 'large.ts': 'hash-only-large' },
        runOnce: vi
          .fn()
          .mockResolvedValueOnce(
            ok(0.2, {
              result: 'solution sobre',
              trace: [preuve],
              retainedWorkspace: { ...held('sobre'), files: ['commun.ts', 'sobre.ts'] }
            })
          )
          .mockResolvedValueOnce(
            ok(0.7, {
              result: 'solution large',
              trace: [preuve],
              retainedWorkspace: { ...held('large'), files: ['commun.ts', 'large.ts'] }
            })
          )
      }
    )

    expect(report.mode).toBe('counterfactual')
    expect(report.counterfactual?.schema).toBe('autowin.workflow-counterfactual/v1')
    expect(report.counterfactual?.arms).toHaveLength(2)
    expect(report.counterfactual?.arms.map((arm) => arm.fork.sourceSnapshot)).toEqual([
      checkpoint.sourceSnapshot,
      checkpoint.sourceSnapshot
    ])
    expect(report.counterfactual?.diff).toMatchObject({
      sharedFiles: ['commun.ts'],
      onlyByProfile: { sobre: ['sobre.ts'], large: ['large.ts'] },
      differingSharedFiles: ['commun.ts']
    })
    expect(report.counterfactual?.arms[0]).toMatchObject({
      costUsd: 0.2,
      durationMs: 120,
      risks: [],
      verdict: 'eligible'
    })
    expect(report.counterfactual?.verdict.winnerProfileId).toBe('sobre')
  })

  it('conserve deux bras si un quota empeche le second run', async () => {
    const report = await runWorkflowBench(
      {
        objective: 'o',
        profiles: [profile('mesure'), profile('quota')],
        mode: 'counterfactual',
        checkpoint
      },
      {
        captureWorkspaceState: async () => ({ 'a.ts': 'hash' }),
        runOnce: vi
          .fn()
          .mockResolvedValueOnce(
            ok(0.2, {
              trace: [
                {
                  step: 'exec',
                  evidence: [
                    {
                      type: 'command_execution',
                      kind: 'verification',
                      status: 'completed',
                      ok: true,
                      summary: 'vert'
                    }
                  ]
                }
              ],
              retainedWorkspace: { ...held('mesure'), files: ['a.ts'] }
            })
          )
          .mockRejectedValueOnce(new Error('quota provider epuise'))
      }
    )

    expect(report.rows).toHaveLength(2)
    expect(report.counterfactual?.arms).toHaveLength(2)
    expect(report.nonMesures?.[0].raison).toContain('quota')
    expect(report.counterfactual?.arms.find((arm) => arm.profileId === 'quota')?.verdict).toBe(
      'rejected'
    )
  })
})
