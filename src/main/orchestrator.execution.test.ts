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
import { CONCISE_STRUCTURED_RESPONSE_INSTRUCTION } from './response-style'

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
    expect(provider.calls[0].system).toContain(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION)
    expect(provider.calls[1].system).toContain(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION)
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

    // Tâche de MUTATION revendiquée sans aucune preuve d'outil → le gate déterministe bloque
    // (B1 : le gate de preuve reste STRICT sur les mutations ; c'est le juge qui garde les autres).
    const result = await orchestrator.run('ajoute une fonctionnalité au projet')

    expect(result.valid).toBe(false)
    expect(result.gateBlocked).toBe(true)
  })

  it('B1 — une tâche NON-mutation sans preuve d’outil passe si le juge valide', async () => {
    const provider = new CapturingProvider(false) // aucune preuve d'outil émise
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

    const result = await orchestrator.run('analyse et cadre les pistes, ne modifie pas de code')

    expect(result.valid).toBe(true)
    expect(result.gateBlocked).toBe(false)
  })

  it('garde le gate rouge avec une simple inspection ou une commande en échec', async () => {
    const evidenceCases: ExecutionEvidence[][] = [
      [
        {
          type: 'command_execution',
          kind: 'inspection',
          status: 'completed',
          ok: true,
          summary: 'rg'
        }
      ],
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

  it('plie le fichier de contexte projet du workspace dans les system (exec + juge)', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const ws = mkdtempSync(join(tmpdir(), 'orch-ctx-'))
    writeFileSync(join(ws, 'CLAUDE.md'), 'RÈGLE PROJET: préfixer les commits par TICKET-123')
    try {
      const provider = new CapturingProvider()
      const orchestrator = new Orchestrator({
        registry: new ProviderRegistry().register(provider),
        roles: new RoleModelConfig({
          subagent: { provider: provider.id },
          judge: { provider: provider.id }
        }),
        cost: new CostAggregator(),
        trust: new TrustLedger(),
        authority: new AuthoritySas(),
        executionWorkspace: ws
      })
      await orchestrator.run('analyse le projet, ne modifie rien')
      // exec (calls[0]) ET juge (calls[1]) reçoivent le bloc contexte, étiqueté par le fichier gagnant
      expect(provider.calls[0].system).toContain('=== CONTEXTE PROJET (CLAUDE.md) ===')
      expect(provider.calls[0].system).toContain('TICKET-123')
      expect(provider.calls[1].system).toContain('=== CONTEXTE PROJET (CLAUDE.md) ===')
    } finally {
      rmSync(ws, { recursive: true, force: true })
    }
  })

  it('B5 — répare UNE fois une mutation bloquée puis clôture vert', async () => {
    // exec#1 sans preuve → bloqué ; réparation exec#2 avec mutation+vérification → vert.
    let execCount = 0
    const provider: ProviderAdapter = {
      id: 'repair',
      supportsExecution: true,
      auth: async () => true,
      async *send(_m, options: SendOptions = {}) {
        const isExec = options.execution?.sandbox === 'danger-full-access'
        if (isExec) execCount += 1
        const secondExec = isExec && execCount >= 2
        return {
          text: isExec ? (secondExec ? 'réparé' : 'tentative') : 'VALIDE',
          provider: 'repair',
          systemInjected: false,
          executionEvidence: secondExec
            ? [
                { type: 'file_change', kind: 'mutation', status: 'completed', ok: true, summary: 'fix' },
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
    } as ProviderAdapter

    const orchestrator = new Orchestrator({
      registry: new ProviderRegistry().register(provider),
      roles: new RoleModelConfig({
        subagent: { provider: 'repair' },
        judge: { provider: 'repair' }
      }),
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      authority: new AuthoritySas(),
      executionWorkspace: 'C:\\workspace'
    })

    const result = await orchestrator.run('corrige le bug du sélecteur')

    expect(result.valid).toBe(true)
    expect(result.gateBlocked).toBe(false)
    expect(execCount).toBe(2) // une réparation a bien eu lieu
  })

  it('F3 (strict) — une mutation exige une VÉRIFICATION, pas une simple inspection', async () => {
    const { evidenceSatisfiesTask } = await import('./orchestrator')
    const mut = { type: 'file_change', kind: 'mutation' as const, status: 'done', ok: true, summary: 'add' }
    const inspection = {
      type: 'command_execution',
      kind: 'inspection' as const,
      status: 'done',
      ok: true,
      summary: 'Get-Content: valeur attendue'
    }
    const verification = {
      type: 'command_execution',
      kind: 'verification' as const,
      status: 'done',
      ok: true,
      summary: 'vitest exit=0'
    }
    // mutation + relecture (inspection) seule → NE suffit plus (F3)
    expect(evidenceSatisfiesTask('crée puis relis le fichier', [mut, inspection])).toBe(false)
    // mutation + vrai test (verification) → validé
    expect(evidenceSatisfiesTask('crée le fichier', [mut, verification])).toBe(true)
  })
})
