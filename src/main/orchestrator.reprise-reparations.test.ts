import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// Même racine vide que orchestrator.reparation-budget.test.ts : la mesure « code compilé périmé »
// tourne pour de vrai, mais sur un dossier sans bundle, donc elle n'arrête pas la boucle.
const RACINE_SANS_BUNDLE = mkdtempSync(`${tmpdir()}/autowin-bundle-`)
let cwdSpy: ReturnType<typeof vi.spyOn>
// Le vrai run tournait en mode « réparer jusqu’au vert » (conv-844), sans l’arrêt « même refus
// 2 fois » que tests/reinit-couts-session.ts impose aux tests d’orchestrateur.
const bornee = process.env.AUTOWIN_REPARATION_BORNEE
beforeAll(() => {
  cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(RACINE_SANS_BUNDLE)
  delete process.env.AUTOWIN_REPARATION_BORNEE
})
afterAll(() => {
  cwdSpy.mockRestore()
  if (bornee !== undefined) process.env.AUTOWIN_REPARATION_BORNEE = bornee
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
import { RoleModelConfig } from './roles'
import { TrustLedger } from './trust/ledger'
import { makeTestWorktrees } from './orchestrator.test-helpers'
import type { WorkflowGraph } from './workflow-graph'
import type { NodePhase } from './skill-pipeline'

/**
 * UNE RÉPARATION DÉJÀ PAYÉE NE REPAIE PAS SON JUGE À LA REPRISE.
 *
 * Mesuré sur run-85d8e7f57af2-1 (conv-892, 2026-10-01) : au redémarrage de 12:54, le run repart avec
 * ses 15 étapes acquises (`run-state/run-85d8e7f57af2-1.json`, `phaseOutputs` : think, frame, puis
 * 7 build et 6 clean alternés). `phaseOutputs` est pré-rempli avec TOUTES : le premier juge voit
 * donc déjà le texte final. Ensuite chaque réparation rejouée sortait par `dejaPayee` sans rien
 * produire, et `judgeAndGate` repayait un juge sur le MÊME texte : 3 juges à 1,2-1,6 $ constatés,
 * `phaseOutputs` resté à 15, compteur reparti à « Réparation 1/24 ».
 */

const PREUVES: ExecutionEvidence[] = [
  { type: 'file_change', kind: 'mutation', status: 'completed', ok: true, summary: 'm' },
  { type: 'command_execution', kind: 'verification', status: 'completed', ok: true, summary: 'v' }
]

/** Les 15 étapes acquises de run-85d8e7f57af2-1, dans leur ordre réel (textes raccourcis). */
const ACQUIS_RUN_85D8: Array<{
  phase: NodePhase
  text: string
  executionEvidence?: ExecutionEvidence[]
}> = [
  { phase: 'think', text: 'briefing think' },
  { phase: 'frame', text: 'cadrage des 7 pistes' },
  ...[0, 1, 2, 3, 4, 5].flatMap((n) => [
    {
      phase: 'build',
      text: n === 0 ? 'build initial' : `build de la réparation ${n}`,
      executionEvidence: PREUVES
    },
    { phase: 'clean', text: n === 0 ? 'clean initial' : `clean de la réparation ${n}` }
  ]),
  { phase: 'build', text: 'build de la réparation 6', executionEvidence: PREUVES }
]

const GRAPHE_FEATURE: WorkflowGraph = {
  entry: 'think-1',
  nodes: [
    { id: 'think-1', phase: 'think' },
    { id: 'frame-1', phase: 'frame' },
    { id: 'build-1', phase: 'build' },
    { id: 'clean-1', phase: 'clean' },
    { id: 'judge-1', phase: 'judge' }
  ],
  edges: [
    { from: 'think-1', to: 'frame-1', when: 'always' },
    { from: 'frame-1', to: 'build-1', when: 'always' },
    { from: 'build-1', to: 'clean-1', when: 'always' },
    { from: 'clean-1', to: 'judge-1', when: 'always' },
    { from: 'judge-1', to: 'build-1', when: 'red', maxTraversals: 24 }
  ]
}

/** Juge qui refuse tant qu'aucun travail NOUVEAU n'a été fait depuis son dernier verdict. */
class Fournisseur implements ProviderAdapter {
  readonly id = 'rep'
  readonly supportsExecution = true
  juges = 0
  executions = 0
  private nouveauDepuisLeJuge = 0
  constructor(private readonly validerAuJuge = 1) {}

  // eslint-disable-next-line require-yield
  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    void messages
    if (options.model === 'juge') {
      this.juges += 1
      const valide = this.nouveauDepuisLeJuge > 0 && this.juges >= this.validerAuJuge
      this.nouveauDepuisLeJuge = 0
      return {
        text: valide
          ? 'VALIDE\nSCORE: 90\nOBJECTIONS:\n- aucune'
          : `DEFAUT: objection ${this.juges}\nSCORE: 60\nOBJECTIONS:\n- MAJEUR: objection ${this.juges}`,
        provider: this.id,
        systemInjected: Boolean(options.system)
      }
    }
    this.executions += 1
    this.nouveauDepuisLeJuge += 1
    return {
      text: `travail nouveau ${this.executions}`,
      provider: this.id,
      systemInjected: Boolean(options.system),
      executionEvidence: PREUVES
    }
  }

  async auth(): Promise<boolean> {
    return true
  }
}

function lancer(fournisseur: Fournisseur, acquis: typeof ACQUIS_RUN_85D8) {
  const orch = new Orchestrator({
    registry: new ProviderRegistry().register(fournisseur),
    roles: new RoleModelConfig({
      subagent: { provider: fournisseur.id, model: 'ouvrier' },
      judge: { provider: fournisseur.id, model: 'juge' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\\base',
    worktrees: makeTestWorktrees('C:\\base'),
    execPhases: ['build'],
    currentWorkflow: () => ({ graph: GRAPHE_FEATURE })
  })
  return orch.run(
    'modifie le projet',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    acquis
  )
}

describe('reprise d’un run interrompu pendant ses réparations', () => {
  it('cas run-85d8e7f57af2-1 : un juge sur le texte repris, puis un seul après le premier travail nouveau', async () => {
    const fournisseur = new Fournisseur()
    const resultat = await lancer(fournisseur, ACQUIS_RUN_85D8)

    // Seul le clean qui suit le 7e build manquait : c'est le seul travail payé.
    expect(fournisseur.executions).toBe(1)
    // Avant le correctif : 7 juges (un par réparation rejouée). Attendu : 2.
    expect(fournisseur.juges).toBe(2)
    expect(resultat.valid).toBe(true)
    const traces = resultat.trace.map((step) => step.detail ?? '').join('\n')
    expect(traces).toMatch(/Réparation 1 déjà payée avant l’interruption/)
    expect(traces).toMatch(/Réparation 5 déjà payée avant l’interruption/)
    expect(traces).not.toMatch(/Réparation 6 déjà payée/)
  })

  it('sans acquis, chaque réparation garde son juge', async () => {
    const fournisseur = new Fournisseur(3)
    const resultat = await lancer(fournisseur, [])

    expect(fournisseur.juges).toBe(3)
    expect(resultat.valid).toBe(true)
    expect(resultat.trace.map((step) => step.detail ?? '').join('\n')).not.toMatch(
      /déjà payée avant/
    )
  })
})
