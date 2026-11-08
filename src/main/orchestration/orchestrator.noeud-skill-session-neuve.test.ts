import { describe, expect, it } from 'vitest'
import { Orchestrator } from './orchestrator'
import { ProviderRegistry } from '../providers/registry'
import type {
  Message,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk
} from '../providers/types'
import { RoleModelConfig } from '../profil/roles'
import { CostAggregator } from '../dashboards/cost'
import { TrustLedger } from '../trust/ledger'
import { makeTestWorktrees } from './orchestrator.test-helpers'

/**
 * UNE ÉTAPE SKILL (learn, git…) PART D'UNE SESSION NEUVE.
 *
 * Mesure du 2026-11-08 (`prompt-observability` croisé avec `run-stdout`) : sur une journée, les
 * étapes d'un run n'ont repris une session que 4 fois — 3 « learn » après la construction, 1 « git »
 * après « learn » — et les 4 fois le modèle a tout relu au prix plein (1,10 $). Une étape skill
 * reçoit ses outils natifs et les serveurs du poste, qu'une phase du pipeline n'a pas, et sa propre
 * consigne dans le système : sa liste d'outils et son système diffèrent de ceux de la session qu'elle
 * reprenait, donc la mémoire de relecture ne servait jamais. Session neuve : elle reçoit l'acquis
 * des phases en entier, comme un juge dédié.
 */
class ClaudeQuiReprend implements ProviderAdapter {
  readonly id = 'claude'
  readonly supportsExecution = true
  readonly honoursSessionResume = true
  readonly appels: Array<{ options: SendOptions; message: string }> = []
  async auth(): Promise<boolean> {
    return true
  }
  // eslint-disable-next-line require-yield
  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    this.appels.push({ options, message: messages.at(-1)?.content ?? '' })
    return {
      text: 'livrable',
      provider: this.id,
      systemInjected: Boolean(options.system),
      sessionId: `sess-${this.appels.length}`
    }
  }
}

const lanceur = {
  exec: async () => ({ ok: true, data: 'ok' }),
  catalogue: () => [
    { name: 'remember', description: 'Déposer une note', args: { title: 't', fact: 'f' } }
  ]
}

describe('étape skill après la construction : session neuve, pas de reprise', () => {
  it('learn puis git ne reprennent aucune session, et reçoivent l’acquis en entier', async () => {
    const provider = new ClaudeQuiReprend()
    await new Orchestrator({
      registry: new ProviderRegistry().register(provider),
      roles: new RoleModelConfig({
        subagent: { provider: provider.id, model: 'gros' },
        judge: { provider: provider.id, model: 'juge' }
      }),
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      executionWorkspace: 'C:\\workspace',
      worktrees: makeTestWorktrees('C:\\workspace'),
      execPhases: ['build', 'learn', 'git'] as never,
      skillCommands: () => lanceur
    }).run('corrige le bug du calcul dans src/x.ts')

    const parPhase = (phase: string) =>
      provider.appels.filter((a) => a.options.execution?.phaseAppelante === phase)
    const [build] = parPhase('build')
    const [learn] = parPhase('learn')
    const [git] = parPhase('git')
    expect(build).toBeDefined()
    expect(learn?.options.skillNodeTools).toBeDefined()
    expect(learn?.options.resumeSessionId).toBeUndefined()
    expect(git?.options.resumeSessionId).toBeUndefined()
    // Sans reprise, l'acquis de la construction est remis, pas supposé connu.
    expect(learn?.message).toContain('[phase build]')
    expect(learn?.message).not.toContain('ne les redemande pas')
  })

  it('une phase du pipeline après learn reprend la session de la construction, pas celle de learn', async () => {
    const provider = new ClaudeQuiReprend()
    await new Orchestrator({
      registry: new ProviderRegistry().register(provider),
      roles: new RoleModelConfig({
        subagent: { provider: provider.id, model: 'gros' },
        judge: { provider: provider.id, model: 'juge' }
      }),
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      executionWorkspace: 'C:\\workspace',
      worktrees: makeTestWorktrees('C:\\workspace'),
      execPhases: ['build', 'learn', 'clean'] as never,
      skillCommands: () => lanceur
    }).run('corrige le bug du calcul dans src/x.ts')

    const rang = (phase: string) =>
      provider.appels.findIndex((a) => a.options.execution?.phaseAppelante === phase)
    const clean = provider.appels[rang('clean')]
    expect(rang('learn')).toBeGreaterThan(rang('build'))
    expect(clean?.options.resumeSessionId).toBe(`sess-${rang('build') + 1}`)
  })
})
