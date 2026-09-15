import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * La mesure « code compile perime » lit process.cwd() : sur le depot reel out/main/index.js est
 * plus vieux que les sources et la boucle s'arreterait AVANT le juge. On lui donne une racine vide,
 * la vraie fonction tourne et ne mesure rien (meme remede que orchestrator.reparation-budget.test.ts).
 */
const RACINE_SANS_BUNDLE = mkdtempSync(`${tmpdir()}/autowin-panel-`)
let cwdSpy: ReturnType<typeof vi.spyOn>
beforeAll(() => {
  cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(RACINE_SANS_BUNDLE)
})
afterAll(() => cwdSpy.mockRestore())

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
 * GARDE-FOU AU SITE D'APPEL : le chemin PANEL de src/main/orchestrator.ts (~l.5147) ne doit pas
 * reduire un quorum atteint au seul mot « VALIDE ».
 *
 * Objection du juge restee ouverte : « le lien de cause pour la correction du panel reste une
 * deduction ». Mesure du dossier : conv-539, tour 6ba33167-9b16-4dbb-8a5f-fd40207ed80e — quatre
 * appels juge (promptCalls ts 09:47:42.375, 09:50:30.425, 09:55:17.497, 09:58:16.977) rendent
 * « VALIDE » AVEC objections ; saisie ts 1789466353210 : « tu t'es arrete alors que 3/4 des juges
 * ont des objections ». Le test unitaire de verdictPanelValide ne couvrait QUE la fonction :
 * remettre 'VALIDE' en dur au site d'appel laissait la suite verte. Ce test-ci mord a cet endroit.
 */
const OBJECTION_A = 'les commits ne sont pas annulables un par un'
const OBJECTION_B = 'rien n est mesure sur un vrai tour'
const OBJECTION_C = 'le tour n est pas fini en reussite'

class PanelProvider implements ProviderAdapter {
  readonly id = 'panel'
  readonly supportsExecution = true

  // eslint-disable-next-line require-yield
  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    void messages
    const membre = options.model ?? ''
    if (membre.startsWith('juge-')) {
      // Puces NON etiquetees : le membre vote VALIDE (aucune MAJEUR), comme les 3 juges du tour reel.
      // juge-3 est le DISSIDENT du tour reel (promptCalls ts 09:55:17.497 : DEFAUT / SCORE 66).
      if (membre === 'juge-3') {
        return {
          text: `DEFAUT: ${OBJECTION_C}\n\nSCORE: 66\n\nOBJECTIONS:\n- ${OBJECTION_C}`,
          provider: this.id,
          systemInjected: Boolean(options.system)
        }
      }
      const puce = membre === 'juge-1' ? OBJECTION_A : OBJECTION_B
      return {
        text: `VALIDE\n\nSCORE: 72\n\nOBJECTIONS:\n- ${puce}`,
        provider: this.id,
        systemInjected: Boolean(options.system)
      }
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
  edges: [{ from: 'build-1', to: 'judge-1', when: 'always' }]
}

function harnais() {
  const provider = new PanelProvider()
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
    judgeFanOut: () => [
      { provider: provider.id, model: 'juge-1' },
      { provider: provider.id, model: 'juge-2' },
      { provider: provider.id, model: 'juge-3' }
    ],
    currentWorkflow: () => ({ graph: GRAPHE })
  })
  return () =>
    orch.run('modifie le projet', undefined, undefined, undefined, undefined, undefined, [])
}

describe('un panel de juges qui atteint le quorum garde les objections de ses membres', () => {
  it('le verdict rendu au tour porte les objections des juges APPROBATEURS', async () => {
    const resultat = await harnais()()
    const texte = resultat.judgeText ?? ''
    expect(texte).toMatch(/VALIDE/)
    expect(texte).toContain(OBJECTION_A)
    expect(texte).toContain(OBJECTION_B)
  })

  /**
   * conv-539, tour 6ba33167-9b16-4dbb-8a5f-fd40207ed80e : le juge de 09:55:17.497 vote DEFAUT, les
   * 3 autres VALIDE. Le quorum passe — mais la puce du dissident doit rester MAJEUR, sinon le tour
   * se clot sur un DEFAUT explicite ignore (saisie ts 1789466353210).
   */
  it('la puce du juge DISSIDENT reste MAJEUR dans le verdict agrege', async () => {
    const resultat = await harnais()()
    expect(resultat.judgeText ?? '').toContain(`MAJEUR: ${OBJECTION_C}`)
  })
})
