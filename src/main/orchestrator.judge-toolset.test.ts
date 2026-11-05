import { describe, expect, it } from 'vitest'
import { CostAggregator } from './dashboards/cost'
import { Orchestrator, sandboxForPhase } from './orchestrator'
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
                // Fichier NON rendu : depuis 9a79ce39 (chemins ramenes au dossier de travail), un .tsx de
                // src/renderer exige une capture et le juge n'est jamais appele. Ce test vise le prompt du juge.
                path: 'C:/base/src/main/vue-task-manager.ts'
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

  // 2026-09-26 (conv-863) : une capture verte de l'application EMPAQUETÉE ne contient pas une
  // modification non empaquetée. Le juge doit savoir lire d'où vient l'interface capturée.
  it('apprend au juge à lire d’où vient l’interface capturée', async () => {
    const prompt = await promptDuJuge()
    expect(prompt).toContain('interfaceCapturee')
    expect(prompt).toContain('--code-dev')
    expect(prompt).toMatch(/application-empaquetee.*ne contient PAS une modification/)
    expect(prompt).toMatch(/code-construit.*copie de travail du producteur reconstruite/)
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

  /**
   * conv-1582 (2026-11-05) : le contrat disait au juge que le producteur n'a Bash/Edit/Write
   * « qu'en phase de mutation » et « pas d'accès web ». Or `sandboxForPhase` rend
   * `danger-full-access` à chaque phase de la chaîne, et `providers/claude.ts` charge Bash et
   * WebFetch/WebSearch sur toute exécution. Le juge croyait donc impossible ce que le producteur
   * peut faire, et contredisait `PIPELINE_DISCIPLINE_INSTRUCTION`, qui dit l'inverse au producteur.
   *
   * Entrées qui rendent ce test rouge : « en phase de mutation de Bash/Edit/Write » ou « Pas d'accès
   * web » remis dans `JUDGE_TOOLSET_CONTRACT` ; une phase de lecture repassée en `read-only` par
   * `sandboxForPhase` sans que le contrat change.
   */
  it('ne réserve ni Bash, ni Edit/Write, ni le web à certaines phases du producteur', async () => {
    for (const phase of ['scout', 'frame', 'terrain', 'build', 'clean'] as const) {
      expect(sandboxForPhase('tâche', phase), phase).toBe('danger-full-access')
    }
    const prompt = await promptDuJuge()
    expect(prompt).not.toMatch(/en phase de mutation de\s+Bash/u)
    expect(prompt).not.toMatch(/Pas d'accès web/iu)
    expect(prompt).toMatch(/Read\/Grep\/Glob\/Bash et d'Edit\/Write/u)
    expect(prompt).toMatch(/WebFetch\/WebSearch/u)
    // Jumeau accepté : le juge sait toujours que seules BUILD et CLEAN modifient des fichiers,
    // et qu'une sous-tâche parallèle d'un build qui ne modifie rien n'a pas Edit/Write
    // (`orchestrator-parcours-glouton.ts`, `isMutationTask(task) ? … : 'read-only'`).
    expect(prompt).toMatch(/seules BUILD et CLEAN modifient des fichiers/u)
    expect(prompt).toMatch(/sous-tâche parallèle d'un build qui ne modifie rien/u)
  })
})
