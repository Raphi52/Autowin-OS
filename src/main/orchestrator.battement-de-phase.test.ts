import { describe, expect, it } from 'vitest'
import { CostAggregator } from './dashboards/cost'
import { Orchestrator } from './orchestrator'
import { ProviderRegistry } from './providers/registry'
import type { ProviderAdapter, SendResult, StreamChunk } from './providers/types'
import { RoleModelConfig } from './roles'
import { TrustLedger } from './trust/ledger'
import { makeTestWorktrees } from './orchestrator.test-helpers'

/**
 * TROU NOIR MESURÉ le 2026-09-07 sur conv-42 : entre 09:06 et 09:27 le fil n'a reçu AUCUNE ligne.
 * Journal du tour (`turn-journals/conv-42/0cea1626….jsonl`) : `action-progress` à 1788764779503
 * (fin de `frame`) puis plus rien jusqu'à 1788766075667 (fin de `build`) — 21 min 36 s de silence.
 *
 * Le fournisseur BAT pourtant toutes les 30 s : `claude.ts` traduit `tool_progress` en
 * `chunk.status` (« Bash en cours - 2 min 30 s - vitest run »). Le pilote de chat lit ce champ
 * (`agent-pilot.ts`, événement `provider-status`) ; le flux de phase de l'orchestrateur ne le
 * lisait pas. Le battement existait donc et était jeté — ce test le rattrape.
 */
class ProviderQuiBat implements ProviderAdapter {
  readonly id = 'sub'
  readonly supportsExecution = true
  async auth(): Promise<boolean> {
    return true
  }
  async *send(): AsyncGenerator<StreamChunk, SendResult, void> {
    yield { delta: '', status: 'Bash en cours - 2 min 30 s - vitest run' }
    yield { delta: 'VALIDE' }
    return {
      text: 'VALIDE',
      provider: this.id,
      model: 'claude-opus',
      systemInjected: true,
      usage: { inputTokens: 1, outputTokens: 1 }
    }
  }
}

function orchestrateur(provider: ProviderAdapter): Orchestrator {
  return new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      orchestrator: { provider: provider.id, model: 'claude-opus' },
      subagent: { provider: provider.id, model: 'claude-opus' },
      judge: { provider: provider.id, model: 'claude-opus' },
      scout: { provider: provider.id, model: 'claude-opus' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\\ws',
    worktrees: makeTestWorktrees('C:\\ws'),
    execPhases: ['build'],
    sleep: async () => undefined
  })
}

describe("Orchestrateur — le battement d'outil d'une phase atteint le fil", () => {
  it('relaie chunk.status sur le canal de note, au lieu de le jeter', async () => {
    const notes: string[] = []
    await orchestrateur(new ProviderQuiBat()).run(
      'corrige le défaut nommé',
      undefined,
      undefined,
      (_step, _delta, note) => {
        if (note) notes.push(note)
      }
    )
    expect(notes).toContain('Bash en cours - 2 min 30 s - vitest run')
  })
})
