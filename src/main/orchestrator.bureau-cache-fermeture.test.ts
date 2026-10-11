/**
 * LOT 1 (RUN outils-agent-1-2-4-6-7, conv-222) : en FIN DE RUN, le bureau caché du run
 * (`run-<runId>`) est fermé sans geste de l'agent — vert, rouge ou planté. Une app laissée ouverte
 * par une phase occupait son identifiant (hdesk-lancer refuse une relance tant qu'elle vit).
 *
 * Le run d'un fil seulement : sans conversation, hdesk-lancer refuse de lancer — rien à fermer.
 * Et la fermeture ne doit JAMAIS faire échouer le run (best-effort).
 */
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
import { makeTestWorktrees } from './orchestrator.test-helpers'
import type { DemandeFermeture } from './hdesk-tv'

class Fournisseur implements ProviderAdapter {
  readonly id = 'rec'
  readonly supportsExecution = true
  readonly bureaux: string[] = []
  constructor(private readonly planter = false) {}
  async auth(): Promise<boolean> {
    return true
  }
  // eslint-disable-next-line require-yield
  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    void messages
    const bureau = options.execution?.agentEnv?.AUTOWIN_HDESK_ID
    if (bureau) this.bureaux.push(bureau)
    if (this.planter) throw new Error('panne simulee du fournisseur')
    return {
      text: options.execution?.sandbox === 'read-only' ? 'VALIDE' : 'livrable',
      provider: this.id,
      systemInjected: Boolean(options.system)
    }
  }
}

const orchestrateur = (
  provider: ProviderAdapter,
  fermer?: (d: DemandeFermeture) => Promise<unknown>
): Orchestrator =>
  new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      subagent: { provider: provider.id, model: 'gros' },
      judge: { provider: provider.id, model: 'juge' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\\ws',
    worktrees: makeTestWorktrees('C:\\ws'),
    classifyPhases: () => ['build'],
    ...(fermer ? { fermerBureauCache: fermer } : {})
  })

const lancerRun = (orch: Orchestrator, conversationId?: string): Promise<unknown> =>
  orch.run(
    'corrige un défaut visible',
    undefined,
    undefined,
    undefined,
    undefined,
    '',
    [],
    conversationId
  )

describe('fin de run : le bureau caché du run est fermé', () => {
  it('ferme run-<runId> avec la conversation du run', async () => {
    const appels: DemandeFermeture[] = []
    const provider = new Fournisseur()
    await lancerRun(
      orchestrateur(provider, async (d) => void appels.push(d)),
      'conv-222'
    )
    expect(provider.bureaux.length).toBeGreaterThan(0)
    expect(appels).toEqual([{ id: provider.bureaux[0], conversationId: 'conv-222' }])
  })

  it('ferme aussi quand le run plante', async () => {
    const appels: DemandeFermeture[] = []
    const provider = new Fournisseur(true)
    await lancerRun(
      orchestrateur(provider, async (d) => void appels.push(d)),
      'conv-222'
    ).catch(() => undefined)
    expect(appels.map((a) => a.conversationId)).toEqual(['conv-222'])
    expect(appels[0].id).toMatch(/^run-/)
  })

  it('ne ferme rien pour un run sans conversation', async () => {
    const appels: DemandeFermeture[] = []
    await lancerRun(orchestrateur(new Fournisseur(), async (d) => void appels.push(d)))
    expect(appels).toEqual([])
  })

  it('une fermeture qui échoue ne fait pas échouer le run', async () => {
    const provider = new Fournisseur()
    const r = await lancerRun(
      orchestrateur(provider, async () => {
        throw new Error('powershell absent')
      }),
      'conv-222'
    )
    expect(r).toBeDefined()
  })
})
