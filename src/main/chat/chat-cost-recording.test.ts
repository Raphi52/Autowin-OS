import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CostAggregator } from '../dashboards/cost'
import { ChatTurnCostRecorder } from './chat-cost-recording'

describe('cout des tours de chat — le budget voit enfin la depense du superviseur', () => {
  it('un tour de chat tarife remonte dans budgetStatus().pricedSpendUsd', () => {
    const cost = new CostAggregator(100)
    new ChatTurnCostRecorder(cost).record(
      { inputTokens: 1200, outputTokens: 300, costUsd: 2.5 },
      { provider: 'claude', model: 'claude-opus-5', conversationId: 'conv-467', turnId: 't1' }
    )
    const status = cost.budgetStatus()
    expect(status.pricedSpendUsd).toBeCloseTo(2.5, 6)
    expect(status.turns).toBe(1)
    expect(status.unpricedTurns).toBe(0)
  })

  it('les republications CUMULEES du meme tour ne comptent pas deux fois', () => {
    const cost = new CostAggregator(100)
    const recorder = new ChatTurnCostRecorder(cost)
    const id = { provider: 'claude', model: 'claude-opus-5' }
    expect(recorder.record({ inputTokens: 100, outputTokens: 10, costUsd: 1 }, id)).toBe(true)
    expect(recorder.record({ inputTokens: 100, outputTokens: 10, costUsd: 1 }, id)).toBe(false)
    expect(recorder.record({ inputTokens: 250, outputTokens: 40, costUsd: 3 }, id)).toBe(true)
    expect(cost.budgetStatus().pricedSpendUsd).toBeCloseTo(3, 6)
    expect(cost.byProvider().claude.costUsd).toBeCloseTo(3, 6)
  })

  it('un tour NON tarife est compte comme non tarife, pas comme gratuit', () => {
    const cost = new CostAggregator(100)
    new ChatTurnCostRecorder(cost).record(
      { inputTokens: 500, outputTokens: 20, costUsd: null },
      { provider: 'claude' }
    )
    const status = cost.budgetStatus()
    expect(status.unpricedTurns).toBe(1)
    expect(status.spentIsPartial).toBe(true)
  })

  it('le pilote de chat CABLE bien le recorder sur os.cost', () => {
    const source = readFileSync(join(__dirname, 'run-pilot-chat.ts'), 'utf8')
    expect(source).toMatch(/new ChatTurnCostRecorder\(os\.cost\)/)
    // Les DEUX chemins de persistance d'usage du tour doivent alimenter le collecteur.
    expect(source.match(/chatCostRecorder\.record\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  it("le role 'supervisor' apparait dans le journal de cout persiste", () => {
    const path = join(process.env.TEMP ?? '/tmp', `cost-chat-${Date.now()}.jsonl`)
    const cost = new CostAggregator(undefined, path)
    new ChatTurnCostRecorder(cost).record(
      { inputTokens: 10, outputTokens: 5, costUsd: 0.02 },
      { provider: 'claude' }
    )
    expect(readFileSync(path, 'utf8')).toContain('"role":"supervisor"')
  })
})
