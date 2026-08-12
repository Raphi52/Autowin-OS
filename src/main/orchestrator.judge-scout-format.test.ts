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
 * LE JUGE DOIT JUGER CONTRE LE CONTRAT QUE LE PRODUCTEUR A REÇU.
 *
 * Mesuré sur la campagne du 2026-08-12 : QUATRE scouts sur quatre (conv-1123 Knowledge,
 * conv-1125 Task Manager, conv-1128 Tickets, conv-1129 Settings) rejetés pour la MÊME raison,
 * purement cosmétique — « score /100 interdit par /scout, colonne # absente et bandes 🟢/🟡/🔴
 * non utilisées ». Aucun défaut de fond n'était reproché.
 *
 * Cause, texte contre texte :
 *  - contrat IN-APP (`phase-briefs.ts`) : colonnes `Score | Type | What | Why | How`,
 *    « Score = une note agrégée /100 » — c'est CE contrat que le producteur reçoit ;
 *  - SKILL.md `scout` du kit externe (l. 66) : « Emit a /100 » est INTERDIT, colonne `#` requise,
 *    bandes 🟢/🟡/🔴, « never a 2-digit /100 ».
 *
 * Le juge charge le SKILL.md du kit et sanctionne le livrable pour n'avoir pas suivi un contrat
 * qui n'est pas le sien. Le format /100 est de surcroît celui que l'utilisateur veut dans Autowin.
 * Même classe de couplage que celui déjà neutralisé pour le RUN.md physique et l'empreinte SHA-256.
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
      text: estJuge ? 'VALIDE' : 'Chantiers proposés.',
      provider: this.id,
      systemInjected: Boolean(options.system),
      // Sans preuve d'exécution, le pré-gate bloque AVANT le juge : le prompt jugé n'existerait pas.
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

const promptDuJuge = async (task: string): Promise<string> => {
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
  await orch.run(task, undefined, undefined, undefined, undefined, undefined, [])
  return provider.prompts.filter((t) => t.includes('Tu es un juge')).at(-1) ?? ''
}

describe('contrat de format opposable au juge', () => {
  it('dit au juge que le contrat de format est celui de l’application', async () => {
    const prompt = await promptDuJuge('améliore la vue Knowledge')
    expect(prompt).not.toBe('')
    expect(prompt).toMatch(/contrat de format|format attendu/i)
  })

  it('interdit explicitement de sanctionner un /100, une colonne « # » ou des bandes', async () => {
    const prompt = await promptDuJuge('améliore la vue Tickets')
    expect(prompt).toContain('/100')
    expect(prompt).toMatch(/colonne « # »|colonne "#"/)
    expect(prompt).toMatch(/bandes/i)
  })

  it('ne transforme pas cette tolérance en blanc-seing sur le fond', async () => {
    const prompt = await promptDuJuge('améliore la vue Settings')
    // La substance et les preuves restent exigées : on neutralise le format, pas le jugement.
    expect(prompt).toMatch(/substance|preuve/i)
  })
})
