import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// fix-ok: run-a8a70cd0ee56-1 — écrit une seule fois (Write). Le contrôle comptait 3 :
// fichiersEditesParLeRun compte un Write 2 fois (chemin absolu `path` + relatif `paths`) plus le
// bilan de fin d'étape. Mesuré avec ce code sur run-state/run-a8a70cd0ee56-1.json.

// Meme precaution que orchestrator.memoire-juge.test.ts : la mesure de code perime reste active,
// on lui donne seulement une racine vide.
const RACINE_SANS_BUNDLE = mkdtempSync(`${tmpdir()}/autowin-tests-deja-joues-`)
let cwdSpy: ReturnType<typeof vi.spyOn>
beforeAll(() => {
  cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(RACINE_SANS_BUNDLE)
})
afterAll(() => {
  cwdSpy.mockRestore()
})

import { CostAggregator } from './dashboards/cost'
import { Orchestrator } from './orchestrator'
import { ProviderRegistry } from './providers/registry'
import type {
  ExecutionEvidence,
  Message,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk
} from './providers/types'
import type { RoleBinding } from './roles'
import { RoleModelConfig } from './roles'
import { TrustLedger } from './trust/ledger'
import { makeTestWorktrees } from './orchestrator.test-helpers'
import type { WorkflowGraph } from './workflow-graph'

/**
 * PISTE 4 DE CONV-914 : LE JUGE REÇOIT LES TESTS DÉJÀ JOUÉS SUR LE CODE ACTUEL.
 *
 * Le contrôle final de run-a8a70cd0ee56-1 a passé 30 s sur 247 à relancer vitest et typecheck que le
 * producteur venait de jouer : rien ne lui disait que le code n'avait pas changé depuis.
 */
const BLOC = 'TESTS DÉJÀ JOUÉS SUR LE CODE ACTUEL'
const VITEST = 'npx vitest run src/main/a.test.ts'

const edition: ExecutionEvidence = {
  type: 'Edit',
  kind: 'mutation',
  status: 'completed',
  ok: true,
  summary: 'Edit src/main/a.ts',
  path: 'src/main/a.ts'
}
const test: ExecutionEvidence = {
  type: 'Bash',
  kind: 'verification',
  status: 'completed',
  ok: true,
  summary: `Bash ${VITEST}`,
  command: VITEST,
  exitCode: 0
}

class PreuvesProvider implements ProviderAdapter {
  readonly id = 'preuves'
  readonly supportsExecution = true
  readonly promptsJuge: string[] = []

  constructor(private readonly preuvesParModele: Record<string, ExecutionEvidence[]>) {}

  // eslint-disable-next-line require-yield
  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    const modele = options.model ?? ''
    if (modele.startsWith('juge')) {
      this.promptsJuge.push(
        messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n')
      )
      return {
        text: 'VALIDE\n\nSCORE: 90\n\nOBJECTIONS:\n- OK: le livrable est là',
        provider: this.id,
        systemInjected: true
      }
    }
    // Le membre qui TESTE finit en dernier : sa preuve arrive APRÈS l'édition de l'autre membre,
    // alors que dans les faits son test a pu tourner avant cette édition.
    if (modele === 'testeur') await new Promise((resolve) => setTimeout(resolve, 60))
    return {
      text: `travail de ${modele}`,
      provider: this.id,
      systemInjected: true,
      executionEvidence: this.preuvesParModele[modele] ?? []
    }
  }

  async auth(): Promise<boolean> {
    return true
  }
}

const graphe: WorkflowGraph = {
  entry: 'build-1',
  nodes: [
    { id: 'build-1', phase: 'build' },
    { id: 'judge-1', phase: 'judge' }
  ],
  edges: [{ from: 'build-1', to: 'judge-1', when: 'always' }]
}

async function lancer(
  preuvesParModele: Record<string, ExecutionEvidence[]>,
  membresBuild: RoleBinding[] = []
): Promise<string[]> {
  const provider = new PreuvesProvider(preuvesParModele)
  const orch = new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      subagent: { provider: provider.id, model: 'ouvrier' },
      orchestrator: { provider: provider.id, model: 'synthese' },
      judge: { provider: provider.id, model: 'juge-1' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\\base',
    worktrees: makeTestWorktrees('C:\\base'),
    execPhases: ['build'],
    phaseFanOut: (phase) => (phase === 'build' ? membresBuild : []),
    currentWorkflow: () => ({ graph: graphe })
  })
  await orch.run('modifie le projet', () => {}, undefined, undefined, undefined, undefined, [])
  return provider.promptsJuge
}

describe('le juge reçoit les tests déjà joués sur le code actuel', () => {
  it('test joué après la dernière édition : le juge le reçoit avec son code de sortie', async () => {
    const prompts = await lancer({ ouvrier: [edition, test] })
    expect(prompts.length).toBeGreaterThan(0)
    expect(prompts[0]).toContain(BLOC)
    expect(prompts[0]).toContain(`\`${VITEST}\` → code de sortie 0`)
  })

  it('jumeau : édition après le test, le bloc est absent', async () => {
    const prompts = await lancer({ ouvrier: [test, edition] })
    expect(prompts[0]).not.toContain(BLOC)
  })

  it('deux agents parallèles dans la même copie : aucun test de leur étape n est réutilisé', async () => {
    const prompts = await lancer({ editeur: [edition], testeur: [test] }, [
      { provider: 'preuves', model: 'editeur' },
      { provider: 'preuves', model: 'testeur' }
    ])
    expect(prompts.length).toBeGreaterThan(0)
    // Sans la borne `debutPreuvesOrdonnees`, l'ordre d'arrivée [édition, test] ferait passer le test
    // pour postérieur à l'édition.
    expect(prompts[0]).not.toContain(BLOC)
  })
})
