import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// Même neutralisation que reparation-budget.test.ts : la mesure « code compilé périmé » lit
// process.cwd() ; on la pointe sur un dossier vide pour que la boucle atteigne la réparation.
const RACINE_SANS_BUNDLE = mkdtempSync(`${tmpdir()}/autowin-bundle-`)
let cwdSpy: ReturnType<typeof vi.spyOn>
beforeAll(() => {
  cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(RACINE_SANS_BUNDLE)
})
afterAll(() => cwdSpy.mockRestore())

import { CostAggregator } from './dashboards/cost'
import { Orchestrator } from './orchestrator'
import { ProviderRegistry } from './providers/registry'
import type { Message, ProviderAdapter, SendOptions, SendResult, StreamChunk } from './providers/types'
import { RoleModelConfig } from './roles'
import { TrustLedger } from './trust/ledger'
import type { WorkflowGraph } from './workflow-graph'

/**
 * UNE VRAIE RÉPARATION, DANS UNE COPIE DE TRAVAIL SÉPARÉE, QUI RETOUCHE LE FICHIER TEST: DU JUGE
 * NE CLÔT PAS EN VERT (piste 2 /build, conv-44). Jusqu'ici le branchement n'était prouvé que par
 * une recherche dans le texte (objections-juge.test-protege.test.ts). Le fichier existe dans la
 * copie ET dans executionWorkspace ; seule la copie est modifiée : le refus prouve que le contrôle
 * lit la copie du run (commit d41eec5f), pas le dossier principal.
 */
const ORIGINAL = 'export const t = 1\n'

class ReparationProvider implements ProviderAdapter {
  readonly id = 'reparation'
  readonly supportsExecution = true
  jugements = 0
  builds = 0
  constructor(private copie: string, private modifierTest: boolean) {}

  // eslint-disable-next-line require-yield
  async *send(messages: Message[], options: SendOptions = {}): AsyncGenerator<StreamChunk, SendResult, void> {
    void messages
    if (options.model === 'juge-dedie') {
      this.jugements += 1
      const text =
        this.jugements === 1
          ? 'DEFAUT: cas limite casse\n\nSCORE: 40\n\nOBJECTIONS:\n- MAJEUR: casse | TEST: t.test.ts | npx vitest run t.test.ts'
          : 'VALIDE'
      return { text, provider: this.id, systemInjected: Boolean(options.system) }
    }
    this.builds += 1
    if (this.builds > 1) {
      if (this.modifierTest) appendFileSync(join(this.copie, 't.test.ts'), '// triche\n')
      else writeFileSync(join(this.copie, 'src.ts'), 'export const fix = 1\n')
    }
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
    { from: 'judge-1', to: 'build-1', when: 'red', maxTraversals: 2 }
  ]
}

const dossiers: string[] = []
afterEach(() => {
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true })
})

async function jouer(modifierTest: boolean) {
  const base = mkdtempSync(join(tmpdir(), 'autowin-base-'))
  const copie = mkdtempSync(join(tmpdir(), 'autowin-copie-'))
  dossiers.push(base, copie)
  writeFileSync(join(base, 't.test.ts'), ORIGINAL)
  writeFileSync(join(copie, 't.test.ts'), ORIGINAL)
  const provider = new ReparationProvider(copie, modifierTest)
  const orch = new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      subagent: { provider: provider.id, model: 'ouvrier' },
      judge: { provider: provider.id, model: 'juge-dedie' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: base,
    worktrees: {
      begin: () => copie,
      end: (_runId, options) => (options?.merge === false ? { outcome: 'blocked' } : { outcome: 'merged' })
    },
    execPhases: ['build'],
    currentWorkflow: () => ({ graph: GRAPHE })
  })
  const resultat = await orch.run('modifie le projet', undefined, undefined, undefined, undefined, undefined, [])
  return { resultat, provider, base, copie }
}

describe('réparation réelle dans une copie séparée : le fichier TEST: du juge est protégé', () => {
  it('une réparation qui modifie TEST: dans la copie bloque le contrôle final et nomme le fichier', async () => {
    const { resultat, provider, base, copie } = await jouer(true)
    expect(provider.builds).toBeGreaterThanOrEqual(2)
    expect(readFileSync(join(copie, 't.test.ts'), 'utf8')).not.toBe(ORIGINAL)
    expect(readFileSync(join(base, 't.test.ts'), 'utf8')).toBe(ORIGINAL)
    expect(resultat.gateBlocked).toBe(true)
    expect(resultat.gateReasons.join(' | ')).toMatch(/t\.test\.ts/)
  })

  it('témoin : la même réparation sans toucher au test clôt en vert', async () => {
    const { resultat, provider } = await jouer(false)
    expect(provider.builds).toBeGreaterThanOrEqual(2)
    expect(resultat.gateReasons.join(' | ')).not.toMatch(/t\.test\.ts/)
    expect(resultat.gateBlocked).toBe(false)
  })
})
