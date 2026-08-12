import { describe, expect, it } from 'vitest'
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

/**
 * LE PROMPT DU JUGE NE DOIT PAS TRANSPORTER LA CHARGE D'AFFICHAGE DU CHAT.
 *
 * Mesuré sur le run réel conv-1102 (vue Worktrees, campagne dogfood du 11/08) : le prompt du juge
 * pesait 422 504 caractères, dont 44,7 % de `stdout` bruts, 26,6 % d'empreintes SHA-256
 * (1 652 hashes) et 9,9 % de commandes recopiées. La cause : `JSON.stringify(executionEvidence)`
 * sérialisait la structure entière, alors que `stdout`/`diff`/`writtenLineFingerprints` n'existent
 * que pour l'affichage inline du Chat. Le run mourait ensuite sur
 * « Budget tokens total dépassé (9 639 639 / 2 500 000) » — soit zéro chantier livré sur 8.
 *
 * Ces tests échouent sur le code d'avant : ils bornent le prompt et interdisent les empreintes.
 */
const sha = (seed: number): string => seed.toString(16).padStart(64, 'b')

const preuvesVolumineuses = (): ExecutionEvidence[] => [
  {
    type: 'file_change',
    kind: 'mutation',
    status: 'completed',
    ok: true,
    summary: 'Écriture de SourceControlPane.tsx',
    path: 'C:/base/src/renderer/src/components/SourceControlPane.tsx',
    paths: ['C:/base/src/renderer/src/components/SourceControlPane.tsx'],
    diff: Array.from({ length: 800 }, (_, i) => `+  ligne ajoutée ${i}`).join('\n'),
    writtenLineFingerprints: Array.from({ length: 400 }, (_, i) => sha(i)),
    pathFingerprints: { 'src/renderer/src/components/SourceControlPane.tsx': sha(999) }
  },
  {
    type: 'command_execution',
    kind: 'verification',
    status: 'completed',
    ok: true,
    summary: 'Tests ciblés verts',
    command: 'npx vitest run src/renderer/src/components/SourceControlPane.test.tsx',
    exitCode: 0,
    stdout: `${'bruit de sortie sans valeur de verdict\n'.repeat(3_000)}Tests  103 passed (103)`
  }
]

class ProviderAvecPreuves implements ProviderAdapter {
  readonly id = 'preuves'
  readonly supportsExecution = true
  readonly prompts: string[] = []

  // eslint-disable-next-line require-yield
  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    const prompt = messages.map((m) => m.content).join('\n')
    this.prompts.push(prompt)
    const estJuge = prompt.includes('Tu es un juge')
    return {
      text: estJuge ? 'VALIDE' : 'Chantier livré.',
      provider: this.id,
      systemInjected: Boolean(options.system),
      ...(estJuge ? {} : { executionEvidence: preuvesVolumineuses() })
    }
  }

  async auth(): Promise<boolean> {
    return true
  }
}

const lancerRun = async () => {
  const provider = new ProviderAvecPreuves()
  const orch = new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      subagent: { provider: provider.id, model: 'ouvrier' },
      judge: { provider: provider.id, model: 'juge-dedie' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\\base',
    worktrees: makeTestWorktrees('C:\\base'),
    execPhases: ['build']
  })
  await orch.run('améliore la vue Worktrees', undefined, undefined, undefined, undefined, undefined, [])
  return provider.prompts.filter((t) => t.includes('Tu es un juge')).at(-1) ?? ''
}

describe('volume du prompt de juge', () => {
  it('ne transporte aucune empreinte SHA-256', async () => {
    const promptDuJuge = await lancerRun()
    expect(promptDuJuge).not.toBe('')
    expect(promptDuJuge).not.toMatch(/[0-9a-f]{64}/)
  })

  it('ne recopie pas le diff intégral', async () => {
    const promptDuJuge = await lancerRun()
    expect(promptDuJuge).not.toContain('ligne ajoutée 799')
  })

  it('reste sous 12 000 caractères là où la sérialisation brute en produisait plus de 130 000', async () => {
    const promptDuJuge = await lancerRun()
    const brut = JSON.stringify(preuvesVolumineuses()).length
    expect(brut).toBeGreaterThan(130_000)
    expect(promptDuJuge.length).toBeLessThan(12_000)
  })

  it('conserve ce qui fonde le verdict : commande, code de sortie et ligne de résultat', async () => {
    const promptDuJuge = await lancerRun()
    expect(promptDuJuge).toContain('vitest')
    expect(promptDuJuge).toContain('"exitCode":0')
    expect(promptDuJuge).toContain('Tests  103 passed (103)')
    expect(promptDuJuge).toContain('SourceControlPane.tsx')
  })
})
