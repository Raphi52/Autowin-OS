import { describe, expect, it, vi } from 'vitest'
import { CostAggregator } from './dashboards/cost'
import { Orchestrator, murDeQuotaDuRun, type RunWorktrees } from './orchestrator'
import { ProviderRegistry } from './providers/registry'
import type {
  Message,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk
} from './providers/types'
import { RoleModelConfig } from './roles'
import { TrustLedger } from './trust/ledger'

/**
 * UN RUN ARRÊTÉ PAR LE MUR DE QUOTA EST SUSPENDU, PAS CLOS.
 *
 * Mesuré le 2026-10-13 : run-219bfae8dec4-1 (conv-914) s'est arrêté en phase clean sur le refus
 * ci-dessous, après un build déjà payé, et son état reprenable avait disparu de `run-state/`.
 */
const REFUS_DU_13_10 =
  "Claude a interrompu l'appel : You've hit your session limit · resets 1pm (Europe/Paris)"

class ProviderQuiRefuse implements ProviderAdapter {
  readonly id = 'refus'
  readonly supportsExecution = true
  constructor(private readonly message: string) {}
  async auth(): Promise<boolean> {
    return true
  }
  // eslint-disable-next-line require-yield
  async *send(_m: Message[], _o: SendOptions = {}): AsyncGenerator<StreamChunk, SendResult, void> {
    throw new Error(this.message)
  }
}

function monter(
  message: string,
  appelsActifs = 0
): {
  orch: Orchestrator
  onRunSettled: ReturnType<typeof vi.fn>
  onRunQuotaWalled: ReturnType<typeof vi.fn>
  fins: Array<Record<string, unknown> | undefined>
  runIds: string[]
} {
  const provider = new ProviderQuiRefuse(message)
  const onRunSettled = vi.fn()
  const onRunQuotaWalled = vi.fn()
  const fins: Array<Record<string, unknown> | undefined> = []
  const runIds: string[] = []
  const worktrees: RunWorktrees = {
    begin: () => 'C:\\wt\\run-1',
    end: (runId, options) => {
      runIds.push(runId)
      fins.push(options as Record<string, unknown> | undefined)
      return undefined
    }
  }
  const orch = new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      subagent: { provider: provider.id, model: 'worker' },
      judge: { provider: provider.id, model: 'judge' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\\base',
    worktrees,
    onRunSettled,
    onRunQuotaWalled,
    // Un membre de fan-out encore en vol au moment du mur (revue du 2026-10-14).
    ...(appelsActifs > 0
      ? {
          currentExecutionUsage: () =>
            ({ activeCalls: appelsActifs }) as unknown as ReturnType<
              NonNullable<ConstructorParameters<typeof Orchestrator>[0]['currentExecutionUsage']>
            >
        }
      : {})
  })
  return { orch, onRunSettled, onRunQuotaWalled, fins, runIds }
}

describe('mur de quota pendant un run', () => {
  it('garde l’état reprenable, note le refus et son heure de retour, et garde la copie', async () => {
    const { orch, onRunSettled, onRunQuotaWalled, fins } = monter(REFUS_DU_13_10)

    await expect(orch.run('modifie le projet')).rejects.toThrow(/session limit/)

    // Avant le correctif : `!green` rendait le run terminal et `onRunSettled` effaçait l'acquis.
    expect(onRunSettled).not.toHaveBeenCalled()
    expect(onRunQuotaWalled).toHaveBeenCalledTimes(1)
    const [runId, mur, regle] = onRunQuotaWalled.mock.calls[0]
    expect(runId).toMatch(/^run-/)
    expect(mur.reason).toMatch(/session limit/)
    expect(typeof mur.resumeAfter).toBe('number')
    expect(regle.agents).toEqual(expect.any(Array))
    // La copie n'est ni fusionnée, ni libérée, ni classée triée : la reprise la rouvre.
    expect(fins).toHaveLength(1)
    expect(fins[0]).toMatchObject({ merge: false, suspendu: true })
  })

  it('un échec ordinaire reste terminal : état effacé, copie rouge ordinaire', async () => {
    const { orch, onRunSettled, onRunQuotaWalled, fins } = monter('TypeError: boom')

    await expect(orch.run('modifie le projet')).rejects.toThrow(/boom/)

    expect(onRunQuotaWalled).not.toHaveBeenCalled()
    expect(onRunSettled).toHaveBeenCalledTimes(1)
    expect(fins[0]).toMatchObject({ merge: false })
    expect(fins[0]).not.toHaveProperty('suspendu')
  })

  it('un rate-limit passager n’est pas un mur de quota', () => {
    expect(murDeQuotaDuRun(new Error('429 rate limit exceeded, retry after 20s'))).toBeUndefined()
    expect(murDeQuotaDuRun(undefined)).toBeUndefined()
    expect(murDeQuotaDuRun(new Error(REFUS_DU_13_10))).toContain('session limit')
  })

  it('un appel encore EN VOL retarde la marque jusqu’à son règlement, sans jamais effacer l’état', async () => {
    const { orch, onRunSettled, onRunQuotaWalled, fins, runIds } = monter(REFUS_DU_13_10, 1)

    await expect(orch.run('modifie le projet')).rejects.toThrow(/session limit/)

    // La copie est gardée sur le seul critère du mur : l'état reprenable doit l'être aussi.
    expect(fins[0]).toMatchObject({ merge: false, suspendu: true })
    expect(onRunSettled).not.toHaveBeenCalled()
    expect(onRunQuotaWalled).not.toHaveBeenCalled()

    // Le dernier appel se règle : la marque part, l'état n'est toujours pas effacé.
    const interne = orch as unknown as {
      rememberAgent(runId: string, token: string, patch: Record<string, unknown>): void
      settleAgentReservationInMemory(runId: string, reservationId: string): void
    }
    interne.rememberAgent(runIds[0], 'membre-fan-out', { active: true, reservationId: 'resa-1' })
    interne.settleAgentReservationInMemory(runIds[0], 'resa-1')
    expect(onRunQuotaWalled).toHaveBeenCalledTimes(1)
    expect(onRunQuotaWalled.mock.calls[0][1].reason).toMatch(/session limit/)
    expect(onRunSettled).not.toHaveBeenCalled()
  })
})
