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
 * SCÉNARIOS À PLUSIEURS PASSAGES (juge indépendant, conv-44, 2 MAJEUR) : la protection d'un fichier
 * TEST: dure TOUT le run — elle ne tombe ni après une passe propre, ni quand un autre TEST: est désigné.
 */
const ORIGINAL = 'export const t = 1\n'

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

type Geste = ((copie: string) => void) | undefined
class ScenarioProvider implements ProviderAdapter {
  readonly id = 'scenario'
  readonly supportsExecution = true
  jugements = 0
  builds = 0
  constructor(private copie: string, private juges: string[], private gestes: Geste[]) {}

  // eslint-disable-next-line require-yield
  async *send(messages: Message[], options: SendOptions = {}): AsyncGenerator<StreamChunk, SendResult, void> {
    void messages
    if (options.model === 'juge-dedie') {
      const text = this.juges[Math.min(this.jugements, this.juges.length - 1)]
      this.jugements += 1
      return { text, provider: this.id, systemInjected: Boolean(options.system) }
    }
    const geste = this.gestes[this.builds]
    this.builds += 1
    if (geste) geste(this.copie)
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

const dossiers: string[] = []
afterEach(() => {
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true })
})

async function jouer(juges: string[], gestes: Geste[]) {
  const base = mkdtempSync(join(tmpdir(), 'autowin-base-'))
  const copie = mkdtempSync(join(tmpdir(), 'autowin-copie-'))
  dossiers.push(base, copie)
  for (const d of [base, copie]) {
    writeFileSync(join(d, 'a.test.ts'), ORIGINAL)
    writeFileSync(join(d, 'b.test.ts'), ORIGINAL)
  }
  const provider = new ScenarioProvider(copie, juges, gestes)
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
  return { resultat, provider, copie }
}

const DEFAUT_A = 'DEFAUT: cas limite casse\n\nSCORE: 40\n\nOBJECTIONS:\n- MAJEUR: casse | TEST: a.test.ts | npx vitest run a.test.ts'
const DEFAUT_B = 'DEFAUT: autre cas\n\nSCORE: 40\n\nOBJECTIONS:\n- MAJEUR: casse aussi | TEST: b.test.ts | npx vitest run b.test.ts'
const DEFAUT_SANS_TEST = 'DEFAUT: reste un trou\n\nSCORE: 50\n\nOBJECTIONS:\n- MAJEUR: doc manquante'
let n = 0
const fixSrc: Geste = (c) => writeFileSync(join(c, 'src.ts'), `export const fix = ${++n}\n`)
const triche = (f: string): Geste => (c) => appendFileSync(join(c, f), '// triche\n')

describe('protection TEST: sur tout le run (2 MAJEUR du juge indépendant)', () => {
  it('MAJEUR 1 : une passe propre ne lève pas la protection — modifier a.test.ts plus tard bloque', async () => {
    const { resultat, provider, copie } = await jouer([DEFAUT_A, DEFAUT_SANS_TEST, 'VALIDE'], [undefined, fixSrc, triche('a.test.ts')])
    expect(provider.builds).toBeGreaterThanOrEqual(3)
    expect(readFileSync(join(copie, 'a.test.ts'), 'utf8')).not.toBe(ORIGINAL)
    expect(resultat.gateBlocked).toBe(true)
    expect(resultat.gateReasons.join(' | ')).toMatch(/a\.test\.ts/)
  })

  it('MAJEUR 2 : un nouveau TEST: est protégé même si l’ancien était modifié — restaurer a et tricher b bloque', async () => {
    const restaureA_tricheB: Geste = (c) => {
      writeFileSync(join(c, 'a.test.ts'), ORIGINAL)
      appendFileSync(join(c, 'b.test.ts'), '// triche\n')
    }
    const { resultat, provider, copie } = await jouer([DEFAUT_A, DEFAUT_B, 'VALIDE'], [undefined, triche('a.test.ts'), restaureA_tricheB])
    expect(provider.builds).toBeGreaterThanOrEqual(3)
    expect(readFileSync(join(copie, 'a.test.ts'), 'utf8')).toBe(ORIGINAL)
    expect(resultat.gateBlocked).toBe(true)
    expect(resultat.gateReasons.join(' | ')).toMatch(/b\.test\.ts/)
  })

  it('jumeau : A puis B désignés, aucun fichier de test touché → vert', async () => {
    const { resultat, provider } = await jouer([DEFAUT_A, DEFAUT_B, 'VALIDE'], [undefined, fixSrc, fixSrc])
    expect(provider.builds).toBeGreaterThanOrEqual(3)
    expect(resultat.gateReasons.join(' | ')).not.toMatch(/\.test\.ts/)
    expect(resultat.gateBlocked).toBe(false)
  })
})
