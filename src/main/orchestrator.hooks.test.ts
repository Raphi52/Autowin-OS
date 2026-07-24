import { describe, expect, it } from 'vitest'
import { Orchestrator } from './orchestrator'
import { ProviderRegistry } from './providers/registry'
import type { Message, ProviderAdapter, SendOptions, SendResult, StreamChunk } from './providers/types'
import { RoleModelConfig } from './roles'
import { CostAggregator } from './dashboards/cost'
import { TrustLedger } from './trust/ledger'
import { AuthoritySas } from './authority/sas'
import { HookBus } from './hooks/hook-bus'
import { createDefaultHookBus } from './hooks/default-gate-hooks'
import type { VerifyRunner } from './hooks/verify-replay-hook'

/** Provider dont l'exec fournit mutation+verification ok et le juge répond VALIDE (gate vert par défaut). */
class GreenProvider implements ProviderAdapter {
  readonly id = 'rec'
  readonly supportsExecution = true
  async auth(): Promise<boolean> {
    return true
  }
  async *send(_m: Message[], options: SendOptions = {}): AsyncGenerator<StreamChunk, SendResult, void> {
    const isExec = options.execution?.sandbox === 'danger-full-access'
    const isJudge = options.execution?.sandbox === 'read-only'
    return {
      text: isJudge ? 'VALIDE' : 'livrable',
      provider: this.id,
      systemInjected: Boolean(options.system),
      executionEvidence: isExec
        ? [
            { type: 'file_change', kind: 'mutation', status: 'done', ok: true, summary: 'edit' },
            { type: 'command_execution', kind: 'verification', status: 'done', ok: true, summary: 'test exit=0' }
          ]
        : undefined
    }
  }
}

function makeOrchestrator(extra: Partial<ConstructorParameters<typeof Orchestrator>[0]> = {}): Orchestrator {
  const provider = new GreenProvider()
  return new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      subagent: { provider: provider.id, model: 'gros' },
      judge: { provider: provider.id, model: 'juge' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    authority: new AuthoritySas(),
    executionWorkspace: 'C:\\ws',
    classifyPhases: () => ['build'],
    ...extra
  })
}

describe('HookBus branché dans l’orchestrateur (pre-green)', () => {
  it('sans bus custom : une mutation prouvée passe le gate (rétrocompat)', async () => {
    const r = await makeOrchestrator().run('corrige le bug')
    expect(r.gateBlocked).toBe(false)
  })

  it('un hook pre-green bloquant fait échouer le gate MÊME si preuve + juge OK', async () => {
    const bus = new HookBus().register('pre-green', () => ({ block: true, reason: 'verify-replay refusé' }))
    const r = await makeOrchestrator({ hooks: bus }).run('corrige le bug')
    expect(r.gateBlocked).toBe(true)
  })

  it('v2 : verifyCmd fourni → verify-replay REJOUE la commande et BLOQUE si elle échoue', async () => {
    const calls: string[] = []
    const failing: VerifyRunner = async (cmd) => {
      calls.push(cmd)
      return { exitCode: 1 }
    }
    const r = await makeOrchestrator({
      verifyCmd: 'npm test',
      hooks: createDefaultHookBus(failing)
    }).run('corrige le bug')
    // Le gate a rejoué la commande (≥1× ; une mutation bloquée déclenche 1 réparation → re-gate → re-jeu).
    expect(calls).toContain('npm test')
    expect(r.gateBlocked).toBe(true) // échec du re-jeu → vert refusé, malgré preuve+juge OK
  })

  it('v2 : verifyCmd qui PASSE (exit 0) → gate vert', async () => {
    const passing: VerifyRunner = async () => ({ exitCode: 0 })
    const r = await makeOrchestrator({
      verifyCmd: 'npm test',
      hooks: createDefaultHookBus(passing)
    }).run('corrige le bug')
    expect(r.gateBlocked).toBe(false)
  })

  // Preuve RUNTIME : bus par défaut = VRAI runner (child_process, pas de mock) → exec réel + exit code réel.
  it('runtime : le VRAI runner exécute la commande — « exit 1 » BLOQUE, « exit 0 » passe', async () => {
    const cwd = process.cwd() // cwd RÉEL (existant) — sinon spawn ENOENT → fail-closed (bloque, à raison)
    const blocked = await makeOrchestrator({
      executionWorkspace: cwd,
      verifyCmd: 'exit 1',
      hooks: createDefaultHookBus()
    }).run('corrige le bug')
    expect(blocked.gateBlocked).toBe(true)

    const green = await makeOrchestrator({
      executionWorkspace: cwd,
      verifyCmd: 'exit 0',
      hooks: createDefaultHookBus()
    }).run('corrige le bug')
    expect(green.gateBlocked).toBe(false)
  })

  it('runtime : cwd inexistant → fail-closed (spawn échoue → BLOQUE, jamais un faux-vert)', async () => {
    const r = await makeOrchestrator({
      executionWorkspace: 'C:\\dossier-inexistant-xyz',
      verifyCmd: 'exit 0',
      hooks: createDefaultHookBus()
    }).run('corrige le bug')
    expect(r.gateBlocked).toBe(true)
  })
})
