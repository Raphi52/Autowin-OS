import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// Même précaution que orchestrator.memoire-juge.test.ts : une racine sans bundle, sinon la mesure de
// code périmé arrête la boucle avant la réparation ; et le VRAI mode de production, jusqu'au vert.
const RACINE_SANS_BUNDLE = mkdtempSync(`${tmpdir()}/autowin-etendue-repetee-`)
let cwdSpy: ReturnType<typeof vi.spyOn>
const bornePrecedente = process.env.AUTOWIN_REPARATION_BORNEE
beforeAll(() => {
  cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(RACINE_SANS_BUNDLE)
  delete process.env.AUTOWIN_REPARATION_BORNEE
})
afterAll(() => {
  cwdSpy.mockRestore()
  if (bornePrecedente === undefined) delete process.env.AUTOWIN_REPARATION_BORNEE
  else process.env.AUTOWIN_REPARATION_BORNEE = bornePrecedente
})

import { CostAggregator } from '../dashboards/cost'
import { Orchestrator } from './orchestrator'
import { ProviderRegistry } from '../providers/registry'
import type {
  Message,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk
} from '../providers/types'
import { RoleModelConfig } from '../profil/roles'
import { TrustLedger } from '../trust/ledger'
import { makeTestWorktrees } from './orchestrator.test-helpers'
import type { WorkflowGraph } from '../workflow/workflow-graph'

/*
 * LE CAS REJOUÉ (2026-10-25) : en mode jusqu'au vert, le juge refuse deux fois
 * d'affilée pour l'ÉTENDUE de la demande. La boucle relançait une réparation après l'autre (le test
 * lève au-delà de 6 builds pour échouer vite). Elle se mettait ensuite en pause sur une fenêtre de
 * question, que l'utilisateur ne veut plus (2026-11-08) : la réparation suivante reçoit désormais
 * l'ordre de trancher elle-même, et le frein du refus répété borne le coût.
 */
const ETENDUE = 'ÉTENDUE — 110 écrans sur 113 restent en français'
const texte = (m: Message[]): string =>
  m.map((x) => (typeof x.content === 'string' ? x.content : JSON.stringify(x.content))).join('\n')

class JugeEtendueProvider implements ProviderAdapter {
  readonly id = 'etendue'
  readonly supportsExecution = true
  readonly promptsJuge: string[] = []
  readonly promptsBuild: string[] = []
  constructor(private readonly valideAuJuge = Number.POSITIVE_INFINITY) {}

  // eslint-disable-next-line require-yield
  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    if ((options.model ?? '').startsWith('juge')) {
      this.promptsJuge.push(`${options.system ?? ''}\n${texte(messages)}`)
      const valide = this.promptsJuge.length >= this.valideAuJuge
      return {
        text: valide
          ? 'VALIDE\nSCORE: 90\nOBJECTIONS:\n- aucune'
          : `DEFAUT: demande pas remplie\nSCORE: 40\nOBJECTIONS:\n- MAJEUR: ${ETENDUE}`,
        provider: this.id,
        systemInjected: Boolean(options.system)
      }
    }
    this.promptsBuild.push(texte(messages))
    if (this.promptsBuild.length > 6)
      throw new Error('boucle non arrêtée : rien ne borne les refus d’étendue')
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
    { from: 'judge-1', to: 'build-1', when: 'red', maxTraversals: 50 }
  ]
}

async function lancer(valideAuJuge?: number): Promise<{
  resultat: Awaited<ReturnType<Orchestrator['run']>>
  provider: JugeEtendueProvider
  traces: string[]
}> {
  const provider = new JugeEtendueProvider(valideAuJuge)
  const orch = new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      subagent: { provider: provider.id, model: 'ouvrier' },
      judge: { provider: provider.id, model: 'juge-1' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\\base',
    worktrees: makeTestWorktrees('C:\\base'),
    execPhases: ['build'],
    currentWorkflow: () => ({ graph: GRAPHE })
  })
  const resultat = await orch.run(
    'passe autowin en full anglais',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    []
  )
  const traces = resultat.trace.map((etape) => etape.detail ?? '')
  return { resultat, provider, traces }
}

describe('objection d’étendue répétée en mode jusqu’au vert : le modèle tranche, sans pause', () => {
  it('le juge du pipeline reçoit la consigne du préfixe « ÉTENDUE — »', async () => {
    const { provider } = await lancer(3)
    expect(provider.promptsJuge[0]).toContain('commence par « ÉTENDUE — »')
  })

  it('après DEUX refus d’étendue, la réparation suivante reçoit l’ordre de décider elle-même', async () => {
    const { provider, traces } = await lancer(3)
    expect(provider.promptsBuild).toHaveLength(3)
    // Les deux premiers builds ne l'ont pas : un seul refus ne suffit pas à trancher.
    expect(provider.promptsBuild[1]).not.toContain('DÉCISION À PRENDRE TOI-MÊME')
    expect(provider.promptsBuild[2]).toContain('DÉCISION À PRENDRE TOI-MÊME')
    expect(provider.promptsBuild[2]).toContain('110 écrans sur 113')
    expect(provider.promptsBuild[2]).toContain('`Décision :')
    expect(provider.promptsBuild[2]).toContain('inventaire en lecture seule')
    expect(traces.join('\n')).toMatch(/pas de pause, la réparation suivante tranche elle-même/)
    expect(traces.join('\n')).not.toMatch(/question posée à l'utilisateur/)
  })

  it('la décision mène au vert quand le juge l’accepte', async () => {
    const { resultat, provider } = await lancer(3)
    expect(provider.promptsJuge).toHaveLength(3)
    expect(resultat.gateBlocked).toBe(false)
  })

  it('la même objection revient après la décision → arrêt nommé, sans réparation de plus', async () => {
    const { resultat, provider, traces } = await lancer()
    expect(provider.promptsBuild).toHaveLength(3)
    expect(resultat.gateBlocked).toBe(true)
    expect(`${resultat.gateReasons.join(' | ')}\n${traces.join('\n')}`).toMatch(
      /le même refus est revenu 3 fois de suite/
    )
    // Une seule décision par run.
    expect(traces.filter((t) => /tranche elle-même/.test(t))).toHaveLength(1)
  })
})
