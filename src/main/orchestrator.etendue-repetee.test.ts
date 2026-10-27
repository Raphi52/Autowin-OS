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
import type { ModelQuestion } from './model-questions'
import { OPTION_ARRETER, OPTION_CONTINUER } from './gates/etendue-repetee'

/*
 * LE CAS conv-1146 REJOUÉ (conv-1149, 2026-10-25) : en mode jusqu'au vert, le juge refuse deux fois
 * d'affilée pour l'ÉTENDUE de la demande. Avant ce correctif, la boucle relançait une réparation
 * après l'autre (le test lève au-delà de 6 builds pour échouer vite) ; désormais elle se met en
 * pause, pose la question, et suit la réponse.
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
      throw new Error('boucle non arrêtée : la question d’étendue est débranchée')
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

async function lancer(
  reponse: string | undefined | null,
  valideAuJuge?: number
): Promise<{
  resultat: Awaited<ReturnType<Orchestrator['run']>>
  provider: JugeEtendueProvider
  questions: ModelQuestion[]
}> {
  const provider = new JugeEtendueProvider(valideAuJuge)
  const questions: ModelQuestion[] = []
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
    currentWorkflow: () => ({ graph: GRAPHE }),
    // `null` = aucune fenêtre branchée (l'app sans interface) : la dépendance est absente.
    ...(reponse === null
      ? {}
      : {
          demanderALUtilisateur: async (question: ModelQuestion) => {
            questions.push(question)
            return reponse
          }
        })
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
  return { resultat, provider, questions }
}

describe('objection d’étendue répétée en mode jusqu’au vert : pause et question', () => {
  it('le juge du pipeline reçoit la consigne du préfixe « ÉTENDUE — »', async () => {
    const { provider } = await lancer(OPTION_ARRETER)
    expect(provider.promptsJuge[0]).toContain('commence par « ÉTENDUE — »')
  })

  it('« Arrêter » → une seule question après DEUX refus d’étendue, aucune réparation de plus', async () => {
    const { resultat, provider, questions } = await lancer(OPTION_ARRETER)
    expect(questions).toHaveLength(1)
    expect(questions[0].options).toEqual([OPTION_CONTINUER, OPTION_ARRETER])
    expect(questions[0].text).toContain('110 écrans sur 113')
    expect(provider.promptsJuge).toHaveLength(2)
    expect(provider.promptsBuild).toHaveLength(2)
    expect(resultat.gateBlocked).toBe(true)
    expect(resultat.gateReasons.join(' | ')).toMatch(/Réparation arrêtée sur ta réponse/)
  })

  it('« Continuer » → la boucle reprend sans redemander, jusqu’au vert', async () => {
    const { resultat, provider, questions } = await lancer(OPTION_CONTINUER, 4)
    expect(questions).toHaveLength(1)
    expect(provider.promptsJuge).toHaveLength(4)
    expect(resultat.gateBlocked).toBe(false)
  })

  it('texte libre → il devient la consigne de la réparation suivante', async () => {
    const { provider, questions } = await lancer('seulement le chat et Settings', 3)
    expect(questions).toHaveLength(1)
    expect(provider.promptsBuild[2]).toContain('seulement le chat et Settings')
  })

  it('aucune fenêtre pour répondre → arrêt nommé, jamais une réparation de plus', async () => {
    const { resultat, provider } = await lancer(null)
    expect(provider.promptsBuild).toHaveLength(2)
    expect(resultat.gateReasons.join(' | ')).toMatch(/restée sans réponse/)
  })
})
