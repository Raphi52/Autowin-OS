import { describe, expect, it } from 'vitest'
import { Orchestrator } from './orchestrator'
import { ProviderRegistry } from './providers/registry'
import type {
  Message,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk
} from './providers/types'
import { RoleModelConfig } from './roles'
import { CostAggregator } from './dashboards/cost'
import { TrustLedger } from './trust/ledger'
import { AuthoritySas } from './authority/sas'
import type { PipelinePhase } from './skill-pipeline'
import { makeTestWorktrees } from './orchestrator.test-helpers'

/** Provider qui enregistre chaque appel + rend un sessionId (pour déclencher le session-resume). */
class RecordingProvider implements ProviderAdapter {
  readonly id = 'rec'
  readonly supportsExecution = true
  /** Tient le rôle d'un adaptateur qui REPREND vraiment : sans ça, plus de session à chaîner. */
  readonly honoursSessionResume: boolean = true
  readonly calls: SendOptions[] = []
  async auth(): Promise<boolean> {
    return true
  }
  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
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

function makeOrchestrator(
  provider: ProviderAdapter,
  classifyPhases: (t: string) => PipelinePhase[]
): Orchestrator {
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
    worktrees: makeTestWorktrees('C:\\ws'),
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
    // Le skill de phase installé (qui CHANGE) et le style restent, eux.
    expect(names(provider.calls[1])).toContain('skill:build')
    expect(names(provider.calls[1])).toContain('style')

    // Conséquence mesurable : le system de la phase resume est STRICTEMENT plus court.
    expect((provider.calls[1].system ?? '').length).toBeLessThan(
      (provider.calls[0].system ?? '').length
    )
  })

  /**
   * RESUME FANTÔME côté orchestrateur — même défaut que dans le chat, conséquence plus lourde.
   *
   * Un provider qui rend un `sessionId` sans l'honorer (`codex` et son `thread_id`) faisait basculer
   * la phase suivante dans la branche `resuming`, qui REMPLACE tout `phaseContext` par « acquis des
   * phases précédentes déjà connus — ne les redemande pas ». L'acquis de la phase `frame` disparaissait
   * donc au moment exact où `build` en dépend, sans que rien ne le signale.
   */
  it("provider qui ne REPREND pas → la phase 2 reçoit l'acquis en entier, pas une promesse de session", async () => {
    class SessionIdWithoutResume extends RecordingProvider {
      /** Exactement `codex` : rend son thread_id, ne sait pas le reprendre. */
      readonly honoursSessionResume = false
      readonly contents: string[] = []
      async *send(
        messages: Message[],
        options: SendOptions = {}
      ): AsyncGenerator<StreamChunk, SendResult, void> {
        this.contents.push(messages.at(-1)?.content ?? '')
        return yield* super.send(messages, options)
      }
    }
    const provider = new SessionIdWithoutResume()
    const orch = makeOrchestrator(provider, () => ['frame', 'build'])
    await orch.run('ajoute une fonctionnalité')

    // Aucune reprise n'est armée, puisque personne ne la tient.
    expect(provider.calls[1].resumeSessionId).toBeUndefined()
    // L'acquis de la phase précédente est REMIS, au lieu d'être supposé connu.
    expect(provider.contents[1]).toContain('[phase frame]')
    expect(provider.contents[1]).not.toContain('ne les redemande pas')
    // Et la discipline redevient nécessaire, faute de session qui la porterait.
    expect(names(provider.calls[1])).toContain('discipline')
  })
})
