import { describe, expect, it } from 'vitest'
import { AuthoritySas } from './authority/sas'
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

class CapturingProvider implements ProviderAdapter {
  readonly id = 'capture'
  readonly supportsExecution = true
  readonly calls: SendOptions[] = []

  constructor(private readonly emitsEvidence = true) {}

  async auth(): Promise<boolean> {
    return true
  }

  async *send(
    _messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    this.calls.push(options)
    return {
      text: this.calls.length === 1 ? 'travail exécuté' : 'VALIDE',
      provider: this.id,
      systemInjected: Boolean(options.system),
      executionEvidence:
        this.calls.length === 1 && this.emitsEvidence
          ? [
              {
                type: 'file_change',
                kind: 'mutation',
                status: 'completed',
                ok: true,
                summary: 'fichier modifié'
              },
              {
                type: 'command_execution',
                kind: 'verification',
                status: 'completed',
                ok: true,
                summary: 'vitest exit=0'
              }
            ]
          : undefined
    }
  }
}

describe('Orchestrator execution contract', () => {
  it('donne l’écriture au sous-agent et une lecture outillée distincte au juge', async () => {
    const provider = new CapturingProvider()
    const registry = new ProviderRegistry().register(provider)
    const roles = new RoleModelConfig({
      subagent: { provider: provider.id, model: 'worker' },
      judge: { provider: provider.id, model: 'judge' }
    })
    const orchestrator = new Orchestrator({
      registry,
      roles,
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      authority: new AuthoritySas(),
      executionWorkspace: 'C:\\workspace'
    })

    const result = await orchestrator.run('modifie le projet')

    expect(result.valid).toBe(true)
    expect(provider.calls).toHaveLength(2)
    expect(provider.calls[0].execution).toEqual({
      cwd: 'C:\\workspace',
      sandbox: 'danger-full-access'
    })
    expect(provider.calls[1].execution).toEqual({
      cwd: 'C:\\workspace',
      sandbox: 'read-only'
    })
  })

  it('garde le gate rouge si le worker prétend réussir sans preuve d’outil', async () => {
    const provider = new CapturingProvider(false)
    const registry = new ProviderRegistry().register(provider)
    const roles = new RoleModelConfig({
      subagent: { provider: provider.id, model: 'worker' },
      judge: { provider: provider.id, model: 'judge' }
    })
    const orchestrator = new Orchestrator({
      registry,
      roles,
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      authority: new AuthoritySas(),
      executionWorkspace: 'C:\\workspace'
    })

    const result = await orchestrator.run('prétends avoir travaillé')

    expect(result.valid).toBe(false)
    expect(result.gateBlocked).toBe(true)
  })

  it('garde le gate rouge avec une simple inspection ou une commande en échec', async () => {
    const evidenceCases: ExecutionEvidence[][] = [
      [{ type: 'command_execution', kind: 'inspection', status: 'completed', ok: true, summary: 'rg' }],
      [
        {
          type: 'command_execution',
          kind: 'verification',
          status: 'failed',
          ok: false,
          summary: 'vitest exit=1'
        }
      ]
    ]
    for (const executionEvidence of evidenceCases) {
      const provider = new CapturingProvider()
      provider.send = async function* (_messages, options = {}) {
        this.calls.push(options)
        return {
          text: this.calls.length === 1 ? 'travail exécuté' : 'VALIDE',
          provider: this.id,
          systemInjected: false,
          executionEvidence: this.calls.length === 1 ? executionEvidence : undefined
        }
      }
      const orchestrator = new Orchestrator({
        registry: new ProviderRegistry().register(provider),
        roles: new RoleModelConfig({
          subagent: { provider: provider.id },
          judge: { provider: provider.id }
        }),
        cost: new CostAggregator(),
        trust: new TrustLedger(),
        authority: new AuthoritySas(),
        executionWorkspace: 'C:\\workspace'
      })
      const result = await orchestrator.run('ajoute un sélecteur')
      expect(result.valid).toBe(false)
      expect(result.gateBlocked).toBe(true)
    }
  })

  it('accepte une mutation suivie d’une relecture réussie validée par le juge', async () => {
    const evidence: ExecutionEvidence[] = [
      { type: 'file_change', kind: 'mutation', status: 'completed', ok: true, summary: 'add' },
      {
        type: 'command_execution',
        kind: 'inspection',
        status: 'completed',
        ok: true,
        summary: 'Get-Content: valeur attendue'
      }
    ]
    const { evidenceSatisfiesTask } = await import('./orchestrator')
    expect(evidenceSatisfiesTask('crée puis relis le fichier', evidence)).toBe(true)
  })
})
