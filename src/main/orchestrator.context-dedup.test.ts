import { describe, expect, it } from 'vitest'
import { Orchestrator } from './orchestrator'
import { ProviderRegistry } from './providers/registry'
import type { Message, ProviderAdapter, SendOptions, SendResult, StreamChunk } from './providers/types'
import { RoleModelConfig } from './roles'
import { CostAggregator } from './dashboards/cost'
import { TrustLedger } from './trust/ledger'
import { AuthoritySas } from './authority/sas'
import type { PipelinePhase } from './skill-pipeline'

/** Provider qui enregistre chaque appel + rend un sessionId (pour déclencher le session-resume). */
class RecordingProvider implements ProviderAdapter {
  readonly id = 'rec'
  readonly supportsExecution = true
  readonly calls: SendOptions[] = []
  async auth(): Promise<boolean> {
    return true
  }
  async *send(messages: Message[], options: SendOptions = {}): AsyncGenerator<StreamChunk, SendResult, void> {
    void messages
    this.calls.push(options)
    const isJudge = options.execution?.sandbox === 'read-only'
    return {
      text: isJudge ? 'VALIDE' : 'livrable',
      provider: this.id,
      systemInjected: Boolean(options.system),
      sessionId: `sess-${this.calls.length}`
    }
  }
}

function makeOrchestrator(provider: ProviderAdapter, classifyPhases: (t: string) => PipelinePhase[]): Orchestrator {
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
    classifyPhases
  })
}

const names = (o: SendOptions): string[] => (o.systemBlocks ?? []).map((b) => b.name)

describe('#2 anti-perte-de-contexte : pas de ré-injection discipline/projectContext en session-resume', () => {
  it('phase 1 (non-resume) envoie discipline ; phase 2 (resume) ne la ré-envoie plus', async () => {
    const provider = new RecordingProvider()
    const orch = makeOrchestrator(provider, () => ['frame', 'build'])
    await orch.run('ajoute une fonctionnalité')

    // Phase 1 (frame) : pas de resume → system complet, discipline présente.
    expect(provider.calls[0].resumeSessionId).toBeUndefined()
    expect(names(provider.calls[0])).toContain('discipline')

    // Phase 2 (build) : reprend la session → discipline/projectContext NON ré-envoyés.
    expect(provider.calls[1].resumeSessionId).toBe('sess-1')
    expect(names(provider.calls[1])).not.toContain('discipline')
    expect(names(provider.calls[1])).not.toContain('projectContext')
    // La consigne de phase (qui CHANGE) et le style restent, eux.
    expect(names(provider.calls[1])).toContain('consigne:build')
    expect(names(provider.calls[1])).toContain('style')

    // Conséquence mesurable : le system de la phase resume est STRICTEMENT plus court.
    expect((provider.calls[1].system ?? '').length).toBeLessThan((provider.calls[0].system ?? '').length)
  })
})
