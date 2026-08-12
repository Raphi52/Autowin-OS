import { describe, expect, it } from 'vitest'
import { CostAggregator } from './dashboards/cost'
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
import { TrustLedger } from './trust/ledger'
import { makeTestWorktrees } from './orchestrator.test-helpers'

/**
 * LE JUGE DOIT CONNAÎTRE LES MOYENS DE CELUI QU'IL JUGE.
 *
 * Mesuré sur la campagne propre du 2026-08-12 : les quatre builds ont été rejetés, et deux d'entre
 * eux exigeaient une preuve hors de portée — « aucune preuve UI live sur un binaire packagé frais »
 * (conv-1135 Task Manager), « la capture/CDP de l'application réelle est affirmée sans preuve
 * d'exécution ou de relecture observable » (conv-1137 Tickets).
 *
 * Asymétrie structurelle : le PRODUCTEUR reçoit `PIPELINE_DISCIPLINE_INSTRUCTION`, qui lui dit
 * « n'invente jamais un outil, une commande, un harnais absents ; l'absence d'un mécanisme non
 * exposé n'est jamais un défaut du livrable ». Le JUGE ne reçoit que sa consigne de phase, le style
 * et le contexte projet — on ne lui dit NULLE PART de quels outils dispose l'agent jugé. Il réclame
 * donc une capture d'écran et un parcours UI que personne, in-app, ne peut produire.
 *
 * On neutralise l'exigence IMPOSSIBLE, pas l'exigence de preuve : les tests, exit-codes et lectures
 * ciblées restent dus, et une affirmation invérifiable reste un défaut.
 */
class CapturingProvider implements ProviderAdapter {
  readonly id = 'capturing'
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
      ...(estJuge
        ? {}
        : {
            executionEvidence: [
              {
                type: 'file_change',
                kind: 'mutation' as const,
                status: 'completed',
                ok: true,
                summary: 'Écriture de la vue',
                path: 'C:/base/src/renderer/src/components/Vue.tsx'
              },
              {
                type: 'command_execution',
                kind: 'verification' as const,
                status: 'completed',
                ok: true,
                summary: 'Tests verts',
                command: 'npx vitest run',
                exitCode: 0
              }
            ]
          })
    }
  }

  async auth(): Promise<boolean> {
    return true
  }
}

const promptDuJuge = async (): Promise<string> => {
  const provider = new CapturingProvider()
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
  await orch.run('améliore la vue Task Manager', undefined, undefined, undefined, undefined, undefined, [])
  return provider.prompts.filter((t) => t.includes('Tu es un juge')).at(-1) ?? ''
}

describe('moyens du producteur opposables au juge', () => {
  it('énonce au juge l’outillage réellement disponible in-app', async () => {
    const prompt = await promptDuJuge()
    expect(prompt).not.toBe('')
    expect(prompt).toMatch(/OUTILLAGE DU PRODUCTEUR/)
    expect(prompt).toMatch(/Read\/Grep\/Glob/)
  })

  it('nomme le harnais de capture, sinon le juge ignore que la preuve UI est atteignable', async () => {
    const prompt = await promptDuJuge()
    expect(prompt).toContain('scripts/ui-capture.mjs')
    expect(prompt).toMatch(/exit-code 0/)
  })

  it('interdit de réclamer un mécanisme absent de cet outillage', async () => {
    const prompt = await promptDuJuge()
    expect(prompt).toMatch(/binaire packagé/)
    expect(prompt).toMatch(/jamais un défaut/)
  })

  it('ne troque pas l’exigence contre un blanc-seing', async () => {
    const prompt = await promptDuJuge()
    expect(prompt).toMatch(/exige ce qui EST à portée/)
    expect(prompt).toMatch(/invérifiable/)
  })
})
