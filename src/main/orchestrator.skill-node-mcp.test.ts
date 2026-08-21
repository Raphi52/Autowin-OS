import { describe, expect, it } from 'vitest'
import type {
  Message,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk
} from './providers/types'
import { Orchestrator } from './orchestrator'
import { ProviderRegistry } from './providers/registry'
import { RoleModelConfig } from './roles'
import { CostAggregator } from './dashboards/cost'
import { TrustLedger } from './trust/ledger'
import { makeTestWorktrees } from './orchestrator.test-helpers'

/**
 * LE CYCLE DE VIE du serveur d'outils d'un nœud skill, sur le chemin d'ECHEC.
 *
 * Defaut trouve par l'audit du 2026-08-20, converge par trois relecteurs independants : le serveur
 * etait ouvert avant l'appel provider et ferme APRES, sans rien couvrir le `throw` intermediaire.
 * Un echec provider, un timeout ou une annulation laissait donc le port loopback — et son jeton —
 * ouvert pour toute la duree de vie du process principal.
 *
 * Ces tests exercent le chemin par un provider qui JETTE. Ils portent l'identifiant `claude` a
 * dessein : c'est le seul provider qui consomme reellement l'option (cf. `PROVIDERS_OUTILS_NATIFS`),
 * donc le seul pour lequel un serveur doit s'ouvrir.
 */
class ProviderQuiJette implements ProviderAdapter {
  readonly id = 'claude'
  readonly supportsExecution = true
  // eslint-disable-next-line require-yield
  async *send(): AsyncGenerator<StreamChunk, SendResult, void> {
    throw new Error('provider indisponible')
  }
  async auth(): Promise<boolean> {
    return true
  }
}

class ProviderMuet implements ProviderAdapter {
  readonly id = 'claude'
  readonly supportsExecution = true
  readonly calls: SendOptions[] = []
  // eslint-disable-next-line require-yield
  async *send(
    _m: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    this.calls.push(options)
    return { text: 'rendu', provider: this.id, systemInjected: Boolean(options.system) }
  }
  async auth(): Promise<boolean> {
    return true
  }
}

class ProviderSansMcp implements ProviderAdapter {
  readonly id = 'codex'
  readonly supportsExecution = true
  readonly calls: SendOptions[] = []
  // eslint-disable-next-line require-yield
  async *send(
    _m: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    this.calls.push(options)
    return { text: 'rendu', provider: this.id, systemInjected: Boolean(options.system) }
  }
  async auth(): Promise<boolean> {
    return true
  }
}

const lanceur = {
  exec: async () => ({ ok: true, data: 'ok' }),
  catalogue: () => [
    {
      name: 'brain_query',
      description: 'Interroger le Brain',
      args: { question: 'la question' }
    }
  ]
}

const orchestrateur = (provider: ProviderAdapter, phases: string[]): Orchestrator =>
  new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      subagent: { provider: provider.id },
      judge: { provider: provider.id }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\workspace',
    worktrees: makeTestWorktrees('C:\workspace'),
    execPhases: phases as never,
    skillCommands: () => lanceur
  })

describe('serveur d’outils d’un nœud skill — cycle de vie', () => {
  it('est FERMÉ même quand l’appel provider échoue (fuite de port)', async () => {
    const details: string[] = []
    const run = orchestrateur(new ProviderQuiJette(), ['think']).run(
      'consulte le Brain',
      (etape: { detail?: string }) => {
        if (etape.detail) details.push(etape.detail)
      }
    )
    await expect(run).rejects.toThrow()
    // Le serveur a bien ete ouvert pour ce noeud...
    expect(details.some((d) => d.startsWith('outils natifs servis'))).toBe(true)
    // ...ET refermé malgré l'exception : c'est ce que l'ancien code ne garantissait pas.
    expect(details.some((d) => d.includes('outils natifs fermes') && d.includes('echec'))).toBe(
      true
    )
  })

  it('est fermé aussi sur le chemin normal', async () => {
    const details: string[] = []
    await orchestrateur(new ProviderMuet(), ['think']).run(
      'consulte le Brain',
      (etape: { detail?: string }) => {
        if (etape.detail) details.push(etape.detail)
      }
    )
    expect(details.some((d) => d.includes('outils natifs fermes'))).toBe(true)
  })

  it("DIT que l'héritage MCP machine est actif — le coût accepté doit être visible", async () => {
    /**
     * La garde de la décision d'héritage demandait de « journaliser les serveurs MCP hérités ».
     * Autowin ne peut PAS les nommer : c'est le CLI qui lit la configuration du poste et il ne rend
     * pas cette liste. La garde tenable est donc de dire que l'héritage est ACTIF, donc que la
     * surface d'outils dépend de la machine — nommer ce qu'on ne peut pas voir aurait été une fausse
     * garde.
     */
    const details: string[] = []
    await orchestrateur(new ProviderMuet(), ['think']).run(
      'consulte le Brain',
      (etape: { detail?: string }) => {
        if (etape.detail) details.push(etape.detail)
      }
    )
    const ligne = details.find((d) => d.includes('heritage MCP machine ACTIF'))
    expect(ligne, "l'héritage doit être annoncé dans la trace").toBeDefined()
    expect(ligne).toContain('depend de la configuration du poste')
  })

  it("n'ouvre AUCUN serveur pour un provider qui ne transporte pas l'option, et le DIT", async () => {
    const details: string[] = []
    const provider = new ProviderSansMcp()
    await orchestrateur(provider, ['think']).run(
      'consulte le Brain',
      (etape: { detail?: string }) => {
        if (etape.detail) details.push(etape.detail)
      }
    )
    // Ni serveur, ni promesse d'outils : la privation est NOMMÉE au lieu d'être silencieuse.
    expect(details.some((d) => d.startsWith('outils natifs servis'))).toBe(false)
    expect(details.some((d) => d.includes('outils natifs indisponibles sur codex'))).toBe(true)
    expect(provider.calls[0]?.skillNodeTools).toBeUndefined()
  })
})
