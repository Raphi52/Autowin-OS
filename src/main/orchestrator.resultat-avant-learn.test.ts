import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// Meme precaution que orchestrator.memoire-juge.test.ts : la mesure de code perime reste active,
// on lui donne seulement une racine vide.
const RACINE_SANS_BUNDLE = mkdtempSync(`${tmpdir()}/autowin-resultat-avant-learn-`)
let cwdSpy: ReturnType<typeof vi.spyOn>
beforeAll(() => {
  cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(RACINE_SANS_BUNDLE)
})
afterAll(() => {
  cwdSpy.mockRestore()
})

import { CostAggregator } from './dashboards/cost'
import { Orchestrator, type OrchestrationStep } from './orchestrator'
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
import { LIGNE_RESULTAT_VALIDE } from '../shared/resultat-valide'

/**
 * PISTE 3 DE CONV-914 : LE RÉSULTAT VALIDÉ PART AVANT LA FIN DE `learn`.
 *
 * Avant : le résultat ne sortait qu'au retour de `run`, après `learn` puis `salvage`. Un `learn`
 * lent (3 min 49 sur conv-911 d'après l'analyse de conv-914) retardait d'autant un travail déjà
 * validé. Le résultat part désormais dans le fil du run dès la validation, et `valid`/`gate` ne
 * bougent plus ensuite.
 *
 * fix-ok: conv-914 (13/10) — au commit b2b9e25a, orchestrator.ts:5808-5852 ne rendait le résultat
 * qu'après `learn` puis `salvage`. Mesuré : avec orchestrator.ts de b2b9e25a, les événements sont
 * ['learn-debut', 'learn-fin'] sans 'resultat-valide' (`toEqual` du 1er test rouge) ; avec le correctif, vert.
 */
const LIVRABLE = 'travail fait et vérifié'

class LearnLentProvider implements ProviderAdapter {
  readonly id = 'lent'
  readonly supportsExecution = true
  readonly evenements: string[] = []
  private ouvriers = 0

  // eslint-disable-next-line require-yield
  async *send(
    _messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    if ((options.model ?? '').startsWith('juge')) {
      return {
        text: 'VALIDE\n\nSCORE: 90\n\nOBJECTIONS:\n- OK: le livrable est là',
        provider: this.id,
        systemInjected: true
      }
    }
    this.ouvriers += 1
    if (this.ouvriers > 1) {
      // 2e appel ouvrier = `learn`, joué après le gate : on le rend LENT.
      this.evenements.push('learn-debut')
      await new Promise((resolve) => setTimeout(resolve, 80))
      this.evenements.push('learn-fin')
      return { text: 'rien à capitaliser', provider: this.id, systemInjected: true }
    }
    return {
      text: LIVRABLE,
      provider: this.id,
      systemInjected: true,
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

function graphe(avecLearn: boolean): WorkflowGraph {
  return {
    entry: 'build-1',
    nodes: [
      { id: 'build-1', phase: 'build' },
      { id: 'judge-1', phase: 'judge' },
      ...(avecLearn ? [{ id: 'learn-1', phase: 'learn' as const }] : [])
    ],
    edges: [
      { from: 'build-1', to: 'judge-1', when: 'always' },
      { from: 'judge-1', to: 'build-1', when: 'red', maxTraversals: 2 },
      ...(avecLearn ? [{ from: 'judge-1', to: 'learn-1', when: 'green' as const }] : [])
    ]
  }
}

async function lancer(avecLearn: boolean) {
  const provider = new LearnLentProvider()
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
    currentWorkflow: () => ({ graph: graphe(avecLearn) })
  })
  const etapes: OrchestrationStep[] = []
  const onStep = (s: OrchestrationStep): void => {
    etapes.push(s)
    if (s.detail === LIGNE_RESULTAT_VALIDE) provider.evenements.push('resultat-valide')
  }
  const resultat = await orch.run(
    'modifie le projet',
    onStep,
    undefined,
    undefined,
    undefined,
    undefined,
    []
  )
  return { resultat, etapes, evenements: provider.evenements }
}

describe('le résultat validé part avant la fin de learn', () => {
  it('learn lent : le résultat est envoyé AVANT que learn commence, et le verdict reste vert', async () => {
    const { resultat, etapes, evenements } = await lancer(true)
    expect(evenements).toEqual(['resultat-valide', 'learn-debut', 'learn-fin'])
    const envoye = etapes.find((s) => s.detail === LIGNE_RESULTAT_VALIDE)
    // La ligne dit où lire le résultat, en mots courants, sans nom d'étape interne (objection du juge, réparation 3).
    expect(envoye?.detail).toContain('onglet Runs')
    expect(envoye?.detail).not.toMatch(/learn|salvage|affich/i)
    // Le texte envoyé est EXACTEMENT le résultat rendu au retour du run.
    expect(envoye?.text).toBe(resultat.result)
    expect(resultat.result).toContain(LIVRABLE)
    expect(resultat.valid).toBe(true)
    expect(resultat.gateBlocked).toBe(false)
  })

  it('jumeau : sans étape après le juge, rien à attendre — aucun envoi anticipé', async () => {
    const { resultat, etapes, evenements } = await lancer(false)
    expect(evenements).toEqual([])
    expect(etapes.some((s) => s.detail === LIGNE_RESULTAT_VALIDE)).toBe(false)
    expect(resultat.valid).toBe(true)
  })
})
