import { describe, expect, it, vi } from 'vitest'

// Le depot reel a toujours un `out/main/index.js` plus vieux que les sources modifiees : la mesure
// « bundle perime » arreterait la boucle AVANT la reparation et ce test ne verrait jamais le cas.
vi.mock('./gates/bundle-perime', () => ({ mesureBundlePerime: () => undefined }))
import { CostAggregator } from './dashboards/cost'
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
import type { WorkflowGraph } from './workflow-graph'

/**
 * UN TOUR NE DOIT PAS PERDRE LES OBJECTIONS DES JUGES PARCE QUE LA REPARATION N'A PLUS DE BUDGET.
 *
 * Mesure : conv-539, tour 6ba33167-9b16-4dbb-8a5f-fd40207ed80e. Quatre appels juge (promptCalls
 * 09:47:42 → 09:58:16) listent des objections ; le build de reparation suivant leve « Budget
 * d'appels provider atteint : 42 appels » et l'exception remonte jusqu'a `orchestrate`, qui rend
 * ok:false. Tout le travail juge disparait de la reponse : l'utilisateur ne lit qu'« Echec du
 * workflow ». Ce test exige que la panne de reparation devienne un MOTIF de refus, pas un rejet.
 */
class BudgetProvider implements ProviderAdapter {
  readonly id = 'budget'
  readonly supportsExecution = true
  private buildsExecutes = 0

  // eslint-disable-next-line require-yield
  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    void messages
    if (options.model === 'juge-dedie') {
      return {
        text: 'DEFAUT: livrable incomplet\n\nSCORE: 40\n\nOBJECTIONS:\n- la preuve manque',
        provider: this.id,
        systemInjected: Boolean(options.system)
      }
    }
    this.buildsExecutes += 1
    // Le 2e build est celui de la reparation : c'est la que le plafond d'appels a mordu.
    if (this.buildsExecutes > 1) {
      throw new Error("Budget d'appels provider atteint : 42 appels")
    }
    return {
      text: 'travail fait',
      provider: this.id,
      systemInjected: Boolean(options.system),
      executionEvidence: [
        { type: 'file_change', kind: 'mutation', status: 'completed', ok: true, summary: 'm' },
        {
          type: 'command_execution',
          kind: 'verification',
          status: 'completed',
          ok: true,
          summary: 'v'
        }
      ]
    }
  }

  async auth(): Promise<boolean> {
    return true
  }
}

const GRAPHE: WorkflowGraph = {
  entry: 'build-1',
  nodes: [
    { id: 'build-1', phase: 'build' },
    { id: 'judge-1', phase: 'judge' }
  ],
  edges: [
    { from: 'build-1', to: 'judge-1', when: 'always' },
    // Retour de reparation : sans lui, aucune reparation n'est accordee et la boucle s'arrete avant.
    { from: 'judge-1', to: 'build-1', when: 'red', maxTraversals: 2 }
  ]
}

function harnais() {
  const provider = new BudgetProvider()
  const orch = new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      subagent: { provider: provider.id, model: 'ouvrier' },
      judge: { provider: provider.id, model: 'juge-dedie' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\base',
    worktrees: makeTestWorktrees('C:\base'),
    execPhases: ['build'],
    currentWorkflow: () => ({ graph: GRAPHE })
  })
  return () =>
    orch.run('modifie le projet', undefined, undefined, undefined, undefined, undefined, [])
}

describe('une reparation sans budget ne fait pas disparaitre le verdict du juge', () => {
  it('le run rend un refus NOMME au lieu de rejeter tout le tour', async () => {
    const resultat = await harnais()()
    expect(resultat.gateBlocked).toBe(true)
    expect(resultat.gateReasons.join(' | ')).toMatch(/Réparation 1 interrompue/)
    expect(resultat.gateReasons.join(' | ')).toMatch(/Budget d'appels provider atteint/)
  })

  it('les objections du dernier juge survivent au tour', async () => {
    const resultat = await harnais()()
    expect(resultat.judgeText ?? '').toMatch(/la preuve manque/)
  })
})
