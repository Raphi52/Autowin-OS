import { describe, expect, it } from 'vitest'
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
import { makeTestWorktrees } from './orchestrator.test-helpers'

/**
 * LE JUGE EST RENVOYE VERS UNE COPIE ENTIERE QUI EXISTE (conv-989, 2026-10-16).
 *
 * Bout de chaine de `agregat-juge.ou-lire.test.ts` : l'orchestrateur passe le chemin fourni par ses
 * dependances a l'agregat, et c'est CE texte que recoit le juge — et qui devient le resultat du run.
 * Scenario LEGAL emprunte a `orchestrator.judge-evidence-volume.test.ts` : sans preuves d'execution,
 * un controle prealable refuse avant le juge, qui n'est alors jamais appele.
 */
const preuves = (): ExecutionEvidence[] => [
  {
    type: 'file_change',
    kind: 'mutation',
    status: 'completed',
    ok: true,
    summary: 'Écriture de SourceControlPane.tsx',
    path: 'C:/base/src/renderer/src/components/SourceControlPane.tsx',
    paths: ['C:/base/src/renderer/src/components/SourceControlPane.tsx']
  },
  {
    type: 'command_execution',
    kind: 'verification',
    status: 'completed',
    ok: true,
    summary: 'Tests ciblés verts',
    command: 'npx vitest run src/renderer/src/components/SourceControlPane.test.tsx',
    exitCode: 0,
    stdout: 'Tests  103 passed (103)'
  },
  {
    type: 'command_execution',
    kind: 'verification',
    status: 'completed',
    ok: true,
    summary: 'capture du rendu lue',
    command: 'node scripts/ui-capture.mjs --route worktrees',
    exitCode: 0,
    stdout: 'capture ecrite puis lue'
  }
]

class EtapesLongues implements ProviderAdapter {
  readonly id = 'long'
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
      text: estJuge ? 'VALIDE' : `${'détail '.repeat(3_000)}\nFIN-DE-L-ETAPE`,
      provider: this.id,
      systemInjected: Boolean(options.system),
      ...(estJuge ? {} : { executionEvidence: preuves() })
    }
  }
  async auth(): Promise<boolean> {
    return true
  }
}

async function lancer(
  chemin?: (runId: string) => string
): Promise<{ promptDuJuge: string; resultat: string; livrableEntier?: string }> {
  const provider = new EtapesLongues()
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
    execPhases: ['frame', 'build'],
    ...(chemin ? { cheminDuLivrableEntier: chemin } : {})
  })
  const issue = await orch.run(
    'améliore la vue Worktrees',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    []
  )
  return {
    promptDuJuge: provider.prompts.filter((t) => t.includes('Tu es un juge')).at(-1) ?? '',
    resultat: issue.result ?? '',
    livrableEntier: issue.livrableEntier
  }
}

describe('l’agrégat remis au juge nomme la copie entière des étapes', () => {
  it('le juge lit des étapes coupées qui renvoient au fichier du run', async () => {
    const nommes: string[] = []
    const { promptDuJuge, resultat, livrableEntier } = await lancer((runId) => {
      const chemin = `C:/donnees/run-livrables/${runId}.md`
      nommes.push(chemin)
      return chemin
    })
    const chemin = nommes.at(-1) ?? ''
    expect(chemin).toMatch(/run-livrables\/.+\.md$/)
    // Prémisse : le juge a bien été appelé, sur des étapes coupées.
    expect(promptDuJuge).toContain('[phase frame]')
    expect(promptDuJuge).toContain('tronqué')
    expect(promptDuJuge).toContain(chemin)
    expect(promptDuJuge).not.toContain('voir le fil des sous-agents')
    // Le résultat du run est ce même agrégat : le chat et l'utilisateur ont le chemin aussi.
    expect(resultat).toContain(chemin)
    // Et le run REND ce chemin à part, pour la bulle d'un run à une seule étape (sans agrégat).
    expect(livrableEntier).toBe(chemin)
  })

  it('sans fichier écrit par personne, aucune copie n’est nommée', async () => {
    const { promptDuJuge, livrableEntier } = await lancer()
    expect(livrableEntier).toBeUndefined()
    expect(promptDuJuge).toContain('tronqué')
    expect(promptDuJuge).not.toContain('run-livrables')
    expect(promptDuJuge).toContain('voir le fil des sous-agents')
  })
})
