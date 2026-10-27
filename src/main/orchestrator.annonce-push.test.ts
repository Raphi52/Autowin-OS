import { describe, expect, it, vi } from 'vitest'
import { CostAggregator } from './dashboards/cost'
import { Orchestrator, type RunWorktrees } from './orchestrator'
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

/*
 * L'ANNONCE DU COMMIT DIT LE VRAI ÉTAT DU PUSH (conv-1139, 2026-10-25).
 *
 * Constaté le 2026-10-24 : la clôture automatique a poussé `494e7d45` (19:12) puis `e4daf170` (23:50)
 * sur `origin/main`, et la réponse de chacun des deux runs affichait « intégré dans ta branche, non
 * poussé ». La phrase était écrite en dur (`annonce-commit-local.ts`), sans lire le compte rendu de
 * la clôture. Deux chemins poussent : le rappel `onPublished` pendant la fusion, et le chemin sans
 * rappel, qui clôt APRÈS la fusion.
 */

class ProviderVert implements ProviderAdapter {
  readonly id = 'vert'
  readonly supportsExecution = true
  private appels = 0
  async auth(): Promise<boolean> {
    return true
  }
  // eslint-disable-next-line require-yield
  async *send(
    _m: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    this.appels += 1
    return {
      text: this.appels === 1 ? 'travail' : 'VALIDE',
      provider: this.id,
      systemInjected: Boolean(options.system),
      executionEvidence:
        this.appels === 1
          ? [
              {
                type: 'file_change',
                kind: 'mutation',
                status: 'completed',
                ok: true,
                summary: 'm'
              },
              {
                type: 'command_execution',
                kind: 'verification',
                status: 'completed',
                ok: true,
                summary: 'v'
              }
            ]
          : undefined
    }
  }
}

const baseSha = 'a'.repeat(40)
const publishedSha = 'e4daf170' + '0'.repeat(32)
const issueFusionnee = {
  outcome: 'merged' as const,
  agentId: 'run-1',
  committed: true,
  baseSha,
  publishedSha
}

/** Fusion avec rappel `onPublished` : la clôture tourne PENDANT la fusion (chemin du 24/10). */
const avecRappel: RunWorktrees = {
  begin: () => 'C:\\wt\\run-1',
  end: () => undefined,
  endAsync: async (_runId, options) => {
    await options?.onPublished?.({ baseSha, agentSha: publishedSha })
    return issueFusionnee
  }
}

/** Fusion sans rappel : la clôture tourne APRÈS la fusion (chemin historique). */
const sansRappel: RunWorktrees = {
  begin: () => 'C:\\wt\\run-1',
  end: () => issueFusionnee
}

async function reponseDuRun(
  worktrees: RunWorktrees,
  close: ReturnType<typeof vi.fn>
): Promise<string> {
  const provider = new ProviderVert()
  const orch = new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      subagent: { provider: provider.id, model: 'worker' },
      judge: { provider: provider.id, model: 'judge' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\\base',
    worktrees,
    closeGreenRun: { begin: vi.fn(), close }
  })
  const r = await orch.run('modifie le projet')
  expect(close).toHaveBeenCalledTimes(1)
  return r.result
}

describe('annonce du commit : le vrai état du push', () => {
  for (const [nom, worktrees] of [
    ['fusion avec rappel', avecRappel],
    ['fusion sans rappel', sansRappel]
  ] as const) {
    it(`${nom} — la clôture a poussé sur main → « poussé sur origin/main », jamais « non poussé »`, async () => {
      const close = vi
        .fn()
        .mockResolvedValue({ status: 'pushed', branch: 'main', files: 4, mode: 'direct' })
      const reponse = await reponseDuRun(worktrees, close)
      expect(reponse).toContain('poussé sur `origin/main` par la clôture automatique')
      expect(reponse).toContain('`e4daf170`')
      expect(reponse).not.toContain('non poussé')
      expect(reponse).not.toContain('Commit local créé')
    })
  }

  it('clôture éteinte (elle ne rend rien) → « non poussé », comme avant', async () => {
    const reponse = await reponseDuRun(avecRappel, vi.fn().mockResolvedValue(undefined))
    expect(reponse).toContain('Commit local créé')
    expect(reponse).toContain('non poussé')
  })

  it('clôture qui a seulement commité, ou publication sautée → « non poussé »', async () => {
    for (const rendu of [
      { status: 'committed', files: 4 },
      { status: 'skipped', reason: 'no-remote' }
    ]) {
      const reponse = await reponseDuRun(avecRappel, vi.fn().mockResolvedValue(rendu))
      expect(reponse).toContain('non poussé')
    }
  })

  it('push direct refusé, repli sur une branche dédiée → cette branche est nommée, pas la tienne', async () => {
    const close = vi.fn().mockResolvedValue({
      status: 'pushed',
      branch: 'auto/run-1',
      files: 4,
      mode: 'pr',
      directRefused: 'pre-push'
    })
    const reponse = await reponseDuRun(avecRappel, close)
    expect(reponse).toContain('poussé sur la branche dédiée `origin/auto/run-1`')
    expect(reponse).not.toContain('non poussé')
  })
})
