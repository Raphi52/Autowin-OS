import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// Même racine vide que orchestrator.reprise-reparations.test.ts : la mesure « code compilé périmé »
// tourne pour de vrai, mais sur un dossier sans bundle, donc elle n'arrête pas la boucle.
const RACINE_SANS_BUNDLE = mkdtempSync(`${tmpdir()}/autowin-bundle-`)
let cwdSpy: ReturnType<typeof vi.spyOn>
const bornee = process.env.AUTOWIN_REPARATION_BORNEE
beforeAll(() => {
  cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(RACINE_SANS_BUNDLE)
  delete process.env.AUTOWIN_REPARATION_BORNEE
})
afterAll(() => {
  cwdSpy.mockRestore()
  if (bornee !== undefined) process.env.AUTOWIN_REPARATION_BORNEE = bornee
})

import { CostAggregator } from '../dashboards/cost'
import { dernierJugeLitLeTexteFinal, Orchestrator } from './orchestrator'
import { ProviderRegistry } from '../providers/registry'
import type {
  ExecutionEvidence,
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
import type { NodePhase } from '../skills/skill-pipeline'

/**
 * À LA REPRISE, LE VERDICT REJOUÉ EST CELUI QUI A JUGÉ LE TEXTE FINAL, PAS LE PREMIER ENREGISTRÉ.
 *
 * Mesuré sur run-7b7d533c318e-1 (conv-1324, 2026-10-30). Seul un juge fini pendant un redémarrage
 * entre dans les étapes enregistrées (`settleCompletedDetachedPhase`, run-reattach.ts) ; un juge
 * joué en direct n'y entre jamais. L'état enregistré portait donc deux verdicts au milieu des builds :
 * un refus à 84, puis une validation à 92, suivie d'un build. À chaque reprise, le premier contrôle
 * relisait le refus à 84 (« verdict repris · défaut »). Les réparations déjà payées sortaient
 * ensuite sans juge, puis un build de réparation était payé pour rien, et la validation à 92 tombait
 * sur ce texte neuf, qu'elle n'avait jamais lu. Trois reprises de suite (16:11, 16:26, 16:33).
 */

const PREUVES: ExecutionEvidence[] = [
  { type: 'file_change', kind: 'mutation', status: 'completed', ok: true, summary: 'm' },
  { type: 'command_execution', kind: 'verification', status: 'completed', ok: true, summary: 'v' }
]

type Acquis = Array<{ phase: NodePhase; text: string; executionEvidence?: ExecutionEvidence[] }>

const build = (texte: string): Acquis[number] => ({
  phase: 'build',
  text: texte,
  executionEvidence: PREUVES
})
const REFUS_84 =
  'DEFAUT: le rechargement en pause reste sans pointillés\nSCORE: 84\nOBJECTIONS:\n- MAJEUR: rechargement en pause'
const VALIDE_92 = 'VALIDE\nSCORE: 92\nOBJECTIONS:\n- OK: objection 1 corrigée'

/** Les étapes enregistrées de run-7b7d533c318e-1 à 16:33, dans leur ordre réel (textes raccourcis). */
const ACQUIS_RUN_7B7D: Acquis = [
  build('build initial'),
  build('reprise des trois objections'),
  { phase: 'judge', text: REFUS_84 },
  build('deux tests du rechargement'),
  build('relecture des deux corrections'),
  { phase: 'learn', text: 'une note ajoutée au Brain' },
  build('pourquoi le refus à 84 revient'),
  { phase: 'judge', text: VALIDE_92 },
  build('pourquoi le même refus revient encore')
]

const GRAPHE_BUILD_JUGE: WorkflowGraph = {
  entry: 'build-1',
  nodes: [
    { id: 'build-1', phase: 'build' },
    { id: 'judge-1', phase: 'judge' }
  ],
  edges: [
    { from: 'build-1', to: 'judge-1', when: 'always' },
    { from: 'judge-1', to: 'build-1', when: 'red', maxTraversals: 24 }
  ]
}

/** Juge qui valide toujours : seul compte ce que la reprise paie, ou pas. */
class Fournisseur implements ProviderAdapter {
  readonly id = 'rep'
  readonly supportsExecution = true
  juges = 0
  executions = 0

  // eslint-disable-next-line require-yield
  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    void messages
    if (options.model === 'juge') {
      this.juges += 1
      return { text: VALIDE_92, provider: this.id, systemInjected: Boolean(options.system) }
    }
    this.executions += 1
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

function lancer(fournisseur: Fournisseur, acquis: Acquis) {
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
    currentWorkflow: () => ({ graph: GRAPHE_BUILD_JUGE })
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

const traces = (resultat: Awaited<ReturnType<typeof lancer>>): string =>
  resultat.trace.map((step) => step.detail ?? '').join('\n')

describe('reprise : le verdict rejoué est celui du texte final', () => {
  it('cas run-7b7d533c318e-1 : un build suit le dernier verdict, donc un seul juge sur le texte final et aucun build payé', async () => {
    const fournisseur = new Fournisseur()
    const resultat = await lancer(fournisseur, ACQUIS_RUN_7B7D)

    // Avant le correctif : le refus à 84 relu, 1 build de réparation payé, 0 juge (la validation à
    // 92 appliquée à un texte qu'elle n'avait pas lu).
    expect(traces(resultat)).not.toMatch(/verdict repris · défaut/)
    expect(fournisseur.executions).toBe(0)
    expect(fournisseur.juges).toBe(1)
    expect(resultat.valid).toBe(true)
  })

  it('tué juste après le juge qui valide : sa validation est rejouée, rien n’est payé', async () => {
    const fournisseur = new Fournisseur()
    const resultat = await lancer(fournisseur, ACQUIS_RUN_7B7D.slice(0, 8))

    expect(traces(resultat)).not.toMatch(/verdict repris · défaut/)
    expect(traces(resultat)).toMatch(/verdict repris · validé/)
    expect(fournisseur.executions).toBe(0)
    expect(fournisseur.juges).toBe(0)
    expect(resultat.valid).toBe(true)
  })

  it('jumeau : un refus qui porte sur le texte final est rejoué, puis une vraie réparation et son juge', async () => {
    const fournisseur = new Fournisseur()
    const resultat = await lancer(fournisseur, [
      build('build initial'),
      { phase: 'judge', text: REFUS_84 }
    ])

    expect(traces(resultat)).toMatch(/verdict repris · défaut/)
    expect(fournisseur.executions).toBe(1)
    expect(fournisseur.juges).toBe(1)
    expect(resultat.valid).toBe(true)
  })

  it('learn, joué seulement après une validation, ne rend pas le verdict périmé ; clean, si', () => {
    expect(
      dernierJugeLitLeTexteFinal([{ phase: 'build' }, { phase: 'judge' }, { phase: 'learn' }])
    ).toBe(true)
    expect(
      dernierJugeLitLeTexteFinal([{ phase: 'build' }, { phase: 'judge' }, { phase: 'clean' }])
    ).toBe(false)
    expect(dernierJugeLitLeTexteFinal([{ phase: 'build' }])).toBe(false)
  })
})
