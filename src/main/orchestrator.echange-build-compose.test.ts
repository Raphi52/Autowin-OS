import { describe, expect, it } from 'vitest'
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
import { CostAggregator } from './dashboards/cost'
import { TrustLedger } from './trust/ledger'
import { makeTestWorktrees } from './orchestrator.test-helpers'
import { MARQUE_QUESTION_SANS_CAUSE } from './gates/echange-sans-cause'

/*
 * LA SESSION D'UN BUILD À AGENT COMPOSÉ (conv-1149, 2026-10-25).
 *
 * Défaut vécu sur conv-1146 (run-ec2036c0932d-1) : 7 refus « sans cause » sur 7 sont partis en
 * réparation complète avec « Échange impossible : aucune session du build à reprendre ». Les 18
 * appels de build portaient un bloc `persona` (prompt-observability/conv-1146.jsonl) : le profil de
 * travail « feature » pose un agent composé `{ persona: 'minimal' }` sur l'étape build, qui passe
 * donc par le chemin « panel » d'`executePipelinePhase`. Ce chemin rendait la main sans jamais
 * garder la session du build, alors qu'avec UN seul membre c'est la session du build elle-même.
 *
 * Fichier témoin sans jeton de cause : il n'existe pas, la source 3 ne peut rien créditer.
 */
const TEMOIN = 'src/temoin-echange-build-compose.ts'

class ProviderCompose implements ProviderAdapter {
  readonly id = 'rec'
  readonly supportsExecution = true
  readonly honoursSessionResume = true
  builds = 0
  questions: { resume?: string }[] = []
  // eslint-disable-next-line require-yield
  async *send(
    m: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    const dernier = String(m[m.length - 1]?.content ?? '')
    if (options.execution?.sandbox === 'read-only')
      return { text: 'VALIDE', provider: this.id, systemInjected: true }
    if (dernier.includes(MARQUE_QUESTION_SANS_CAUSE)) {
      this.questions.push({ resume: options.resumeSessionId })
      return {
        text: `CausalHypothesis: ${TEMOIN} — fichier neuf rédigé en trois passes`,
        provider: this.id,
        systemInjected: true
      }
    }
    this.builds += 1
    const edit = (): ExecutionEvidence => ({
      type: 'file_change',
      kind: 'mutation',
      status: 'done',
      ok: true,
      summary: 'edit',
      paths: [TEMOIN]
    })
    return {
      text: 'livrable',
      provider: this.id,
      systemInjected: true,
      sessionId: `sess-build-${this.builds}`,
      executionEvidence: [
        edit(),
        edit(),
        edit(),
        {
          type: 'command_execution',
          kind: 'verification',
          status: 'done',
          ok: true,
          summary: 'test exit=0'
        }
      ]
    }
  }
  async auth(): Promise<boolean> {
    return true
  }
}

function orchestrateur(
  provider: ProviderCompose,
  membresDuBuild: Array<{ provider: string; model?: string }>
): Orchestrator {
  return new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      // La synthèse d'un panel de plusieurs membres passe par le rôle orchestrateur.
      orchestrator: { provider: provider.id, model: 'gros' },
      subagent: { provider: provider.id, model: 'gros' },
      judge: { provider: provider.id, model: 'juge' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\\ws',
    worktrees: makeTestWorktrees('C:\\ws'),
    classifyPhases: () => ['build'],
    phaseFanOut: (phase) => (phase === 'build' ? membresDuBuild : [])
  })
}

const trace = (r: { trace: { detail?: string }[] }): string =>
  r.trace.map((t) => t.detail ?? '').join('\n')

describe('build à agent composé : sa session reste interrogeable avant une réparation', () => {
  it('UN membre (cas conv-1146) → la question part à SA session, aucun nouveau build', async () => {
    const provider = new ProviderCompose()
    const r = await orchestrateur(provider, [{ provider: 'rec', model: 'gros' }]).run(
      'corrige le bug'
    )
    expect(trace(r)).not.toMatch(/aucune session du build à reprendre/)
    expect(provider.questions).toEqual([{ resume: 'sess-build-1' }])
    expect(provider.builds).toBe(1)
    expect(trace(r)).toMatch(/Échange 1 — refus levé/)
  })

  it('DEUX membres en parallèle → aucune session unique : échange impossible, dit dans la trace', async () => {
    const provider = new ProviderCompose()
    const r = await orchestrateur(provider, [
      { provider: 'rec', model: 'gros' },
      { provider: 'rec', model: 'autre' }
    ]).run('corrige le bug')
    expect(provider.questions).toEqual([])
    expect(trace(r)).toMatch(/aucune session du build à reprendre/)
  })
})
