import { describe, expect, it } from 'vitest'
import { CostAggregator, type TurnCost } from './dashboards/cost'
import { Orchestrator } from './orchestrator'
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
import { makeTestWorktrees } from './orchestrator.test-helpers'

class Fixe implements ProviderAdapter {
  readonly id = 'fixe'
  readonly supportsExecution = true
  async auth(): Promise<boolean> {
    return true
  }
  // Provider de test : il rend son resultat d'un coup, sans flux intermediaire.
  // eslint-disable-next-line require-yield
  async *send(_m: Message[], _o: SendOptions = {}): AsyncGenerator<StreamChunk, SendResult, void> {
    return {
      text: 'VALIDE',
      provider: this.id,
      model: 'modele-fixe',
      systemInjected: true,
      usage: { inputTokens: 4, outputTokens: 2, costUsd: 0.01 }
    }
  }
}

function harnais(): { cost: CostAggregator; recus: TurnCost[]; orch: Orchestrator } {
  const registry = new ProviderRegistry().register(new Fixe())
  const roles = new RoleModelConfig({
    subagent: { provider: 'fixe', model: 'modele-fixe' },
    judge: { provider: 'fixe', model: 'modele-fixe' }
  })
  const cost = new CostAggregator()
  const recus: TurnCost[] = []
  const original = cost.add.bind(cost)
  cost.add = (turn) => {
    recus.push(turn)
    original(turn)
  }
  const orch = new Orchestrator({
    registry,
    roles,
    cost,
    trust: new TrustLedger(),
    executionWorkspace: 'C:\\ws',
    worktrees: makeTestWorktrees('C:\\ws'),
    execPhases: ['build']
  })
  return { cost, recus, orch }
}

describe('Orchestrateur — chaque dollar sait de quelle conversation il vient', () => {
  it('attache conversation et tour a tous les couts du run', async () => {
    const { recus, orch } = harnais()
    await orch.run(
      'corrige le filtre',
      undefined,
      undefined,
      undefined,
      undefined,
      '',
      [],
      'conv-71',
      undefined,
      undefined,
      'turn-42'
    )
    expect(recus.length).toBeGreaterThan(0)
    expect(recus.every((t) => t.conversationId === 'conv-71')).toBe(true)
    expect(recus.every((t) => t.turnId === 'turn-42')).toBe(true)
  })

  it('laisse les champs vides quand la conversation est inconnue — jamais de valeur inventee', async () => {
    const { recus, orch } = harnais()
    await orch.run('corrige le filtre')
    expect(recus.length).toBeGreaterThan(0)
    expect(recus.every((t) => t.conversationId === undefined)).toBe(true)
  })
})
