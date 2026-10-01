import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// Meme precaution que orchestrator.reparation-budget.test.ts : la mesure de code perime reste
// active, on lui donne seulement une racine vide (sinon elle arrete la boucle avant la reparation).
const RACINE_SANS_BUNDLE = mkdtempSync(`${tmpdir()}/autowin-memoire-juge-`)
let cwdSpy: ReturnType<typeof vi.spyOn>
const bornePrecedente = process.env.AUTOWIN_REPARATION_BORNEE
beforeAll(() => {
  cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(RACINE_SANS_BUNDLE)
  // Le VRAI mode de production (conv-844) : reparation sans plafond. Seul l'arret sur reserves
  // mineures figees peut terminer la boucle — le provider leve au-dela de 6 juges pour echouer vite.
  delete process.env.AUTOWIN_REPARATION_BORNEE
})
afterAll(() => {
  cwdSpy.mockRestore()
  if (bornePrecedente === undefined) delete process.env.AUTOWIN_REPARATION_BORNEE
  else process.env.AUTOWIN_REPARATION_BORNEE = bornePrecedente
})

import { CostAggregator } from './dashboards/cost'
import { Orchestrator } from './orchestrator'
import { ProviderRegistry } from './providers/registry'
import type { Message, ProviderAdapter, SendOptions, SendResult, StreamChunk } from './providers/types'
import { RoleModelConfig } from './roles'
import { TrustLedger } from './trust/ledger'
import { makeTestWorktrees } from './orchestrator.test-helpers'
import type { WorkflowGraph } from './workflow-graph'

/**
 * BRANCHEMENT DE LA MEMOIRE DU JUGE DANS L'ORCHESTRATEUR (objections du juge, conv-36 reparation 1) :
 * (a) le 2e juge recoit les objections du 1er ; (b) la boucle s'arrete quand les memes reserves
 * MINEUR reviennent ; (c) idem avec un panel ou chaque membre valide en listant une reserve
 * (vote DEFAUT -> texte agrege « DEFAUT: quorum non atteint »).
 */
const RESERVE = 'la mesure sur un vrai run long manque'

class JugeFigeProvider implements ProviderAdapter {
  readonly id = 'fige'
  readonly supportsExecution = true
  readonly promptsJuge: string[] = []
  private builds = 0

  // eslint-disable-next-line require-yield
  async *send(messages: Message[], options: SendOptions = {}): AsyncGenerator<StreamChunk, SendResult, void> {
    if ((options.model ?? '').startsWith('juge')) {
      this.promptsJuge.push(messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n'))
      if (this.promptsJuge.length > 6) throw new Error('boucle non arretee : la memoire du juge est debranchee')
      return { text: `VALIDE\n\nSCORE: 82\n\nOBJECTIONS:\n- MINEUR: ${RESERVE}`, provider: this.id, systemInjected: Boolean(options.system) }
    }
    // Frein de test : un juge panel qui leve est avale (membre non votant) ; une reparation qui leve
    // devient un motif d'arret nomme. Sans branchement, le test echoue donc vite au lieu de boucler.
    if (++this.builds > 6) throw new Error('boucle non arretee : la memoire du juge est debranchee')
    return {
      text: 'travail fait',
      provider: this.id,
      systemInjected: Boolean(options.system),
      executionEvidence: [
        { type: 'file_change', kind: 'mutation', status: 'completed', ok: true, summary: 'm' },
        { type: 'command_execution', kind: 'verification', status: 'completed', ok: true, summary: 'v' }
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
    { from: 'judge-1', to: 'build-1', when: 'red', maxTraversals: 50 }
  ]
}

async function lancer(panel: boolean) {
  const provider = new JugeFigeProvider()
  const orch = new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      subagent: { provider: provider.id, model: 'ouvrier' },
      judge: { provider: provider.id, model: 'juge-1' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\base',
    worktrees: makeTestWorktrees('C:\base'),
    execPhases: ['build'],
    ...(panel
      ? {
          judgeFanOut: () => [
            { provider: provider.id, model: 'juge-1' },
            { provider: provider.id, model: 'juge-2' }
          ]
        }
      : {}),
    currentWorkflow: () => ({ graph: GRAPHE })
  })
  const resultat = await orch.run('modifie le projet', undefined, undefined, undefined, undefined, undefined, [])
  return { resultat, prompts: provider.promptsJuge }
}

describe('memoire du juge branchee dans la boucle de reparation', () => {
  it('juge unique : le 2e juge recoit les objections du 1er, puis la boucle s arrete', async () => {
    const { resultat, prompts } = await lancer(false)
    expect(prompts[0]).not.toMatch(/VERDICT PRÉCÉDENT/)
    expect(prompts[1]).toMatch(/VERDICT PRÉCÉDENT/)
    expect(prompts[1]).toContain(RESERVE)
    expect(prompts.length).toBe(2)
    expect(resultat.gateReasons.join(' | ')).toMatch(/mêmes réserves mineures deux passages de suite/)
  })

  it('panel dont chaque membre valide avec une reserve mineure : la boucle s arrete aussi', async () => {
    const { resultat, prompts } = await lancer(true)
    // 2 membres par passage, 2 passages.
    expect(prompts.length).toBe(4)
    expect(prompts[2]).toContain(RESERVE)
    expect(resultat.gateReasons.join(' | ')).toMatch(/mêmes réserves mineures deux passages de suite/)
  })
})
