import { describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'
import { CostAggregator } from '../dashboards/cost'

/**
 * L'AGENT VOIT CE QUE SON FIL A COÛTÉ, ET CE QUE COÛTE UNE EXÉCUTION, AVANT DE LA LANCER.
 *
 * Sans ces repères, un tour de chat à 0,7 $ a lancé sur un périmètre seulement supposé une
 * exécution de 235 $ : rien dans son contexte ne disait l'écart entre les deux.
 */
function osAvec(cost: CostAggregator): ConstructorParameters<typeof AppCommandBus>[0] {
  return {
    executionWorkspace: process.cwd(),
    conversations: { listResumes: () => [] },
    registry: { ids: () => ['claude'] },
    roles: { all: () => ({}), getBinding: () => undefined },
    runsWithGate: async () => [],
    budget: () => ({ pricedSpendUsd: 0 }),
    reperesDeCout: (conversationId?: string) => cost.reperesDeCout(conversationId),
    getWorktreeActivity: () => [],
    travauxNonPubliesBornes: () => []
  } as unknown as ConstructorParameters<typeof AppCommandBus>[0]
}

const ligne = (conversationId: string, turnId: string, role: string, costUsd: number) => ({
  provider: 'claude',
  role,
  conversationId,
  turnId,
  costUsd,
  inputTokens: 0,
  outputTokens: 0
})

describe('état du tour — repères de coût', () => {
  it('porte le coût du fil DU TOUR et l’ordre de grandeur d’une exécution', async () => {
    const cost = new CostAggregator()
    for (let i = 1; i <= 6; i++) cost.add(ligne(`conv-${i}`, 't', 'subagent', i * 2))
    cost.add(ligne('conv-42', 't1', 'supervisor', 0.6))
    const etat = await new AppCommandBus(osAvec(cost), () => undefined).snapshotForPrompt(
      undefined,
      'conv-42'
    )
    expect(etat.reperesDeCout?.ceFil).toEqual({
      depenseUsd: 0.6,
      dontExecutionsUsd: 0,
      toursDeChat: 1
    })
    expect(etat.reperesDeCout?.uneExecution).toMatchObject({
      medianeUsd: 6,
      maxUsd: 12,
      mesurees: 6
    })
    expect(etat.reperesDeCout?.legende).toContain('orchestrate')
  })

  it('absent quand rien n’est mesuré : aucun caractère payé pour une légende seule', async () => {
    const etat = await new AppCommandBus(
      osAvec(new CostAggregator()),
      () => undefined
    ).snapshotForPrompt(undefined, 'conv-1')
    expect('reperesDeCout' in etat).toBe(false)
  })
})
