import { describe, expect, it } from 'vitest'
import type {
  Message,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk
} from '../providers/types'
import { Orchestrator } from './orchestrator'
import { ProviderRegistry } from '../providers/registry'
import { RoleModelConfig } from '../profil/roles'
import { CostAggregator } from '../dashboards/cost'
import { TrustLedger } from '../trust/ledger'
import { makeTestWorktrees } from './orchestrator.test-helpers'

/**
 * UNE ÉTAPE D'UN RUN DE LOT PEUT ÉCRIRE AU CHEF.
 *
 * La demande d'un lot dit « bloqué par une information que seul le chef détient ? envoie-lui une
 * question avec ecrire_a_un_fil ». Ce texte arrive à l'agent de l'étape build : sans l'outil, sa
 * question reste dans un bilan que le chef ne lit qu'après l'échec du lot.
 *
 * Ce faux fournisseur fait ce que fait le CLI : il lit `mcpConfig`, liste les outils et en appelle,
 * en HTTP, avec le jeton.
 */
class ProviderQuiEcritAuChef implements ProviderAdapter {
  readonly id = 'claude'
  readonly supportsExecution = true
  readonly appels: SendOptions[] = []
  outilsListes: string[] = []
  reponses: Record<string, { isError?: boolean; texte: string }> = {}
  // eslint-disable-next-line require-yield
  async *send(
    _m: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    this.appels.push(options)
    const outils = options.skillNodeTools
    if (outils) {
      const serveur = JSON.parse(outils.mcpConfig).mcpServers.autowin
      type ResultatMcp = {
        tools: Array<{ name: string }>
        isError?: boolean
        content?: Array<{ text?: string }>
      }
      const appeler = async (
        method: string,
        params: Record<string, unknown>
      ): Promise<ResultatMcp> => {
        const reponse = await fetch(serveur.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...serveur.headers },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
        })
        return ((await reponse.json()) as { result: ResultatMcp }).result
      }
      const liste = await appeler('tools/list', {})
      this.outilsListes = liste.tools.map((t: { name: string }) => t.name)
      for (const [name, args] of [
        ['ecrire_a_un_fil', { destinataire: 'conv-chef', texte: 'Quelle base garder ?' }],
        ['remember', { title: 'x', fact: 'y' }]
      ] as const) {
        const r = await appeler('tools/call', { name, arguments: args })
        this.reponses[name] = { isError: r?.isError, texte: r?.content?.[0]?.text ?? '' }
      }
    }
    return { text: 'rendu', provider: this.id, systemInjected: Boolean(options.system) }
  }
  async auth(): Promise<boolean> {
    return true
  }
}

const orchestrateur = (
  provider: ProviderAdapter,
  executes: Array<{ name: string; args: Record<string, unknown> }>
): Orchestrator =>
  new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      subagent: { provider: provider.id },
      judge: { provider: provider.id }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\\ws',
    worktrees: makeTestWorktrees('C:\\ws'),
    execPhases: ['build'],
    sleep: async () => undefined,
    // Seul conv-lot est le fil d'un lot : les autres n'ont aucun outil.
    outilsDuLot: (fil: string) =>
      fil === 'conv-lot'
        ? {
            exec: async (name: string, args: Record<string, unknown>) => {
              executes.push({ name, args })
              return { ok: true, data: { id: 'msg-1', a: args.destinataire } }
            },
            catalogue: () => [
              {
                name: 'ecrire_a_un_fil',
                description: "Écrire à l'agent d'un autre fil",
                args: { destinataire: 'le fil visé', texte: 'le message' }
              }
            ]
          }
        : undefined
  })

const lancer = (o: Orchestrator, fil: string): Promise<unknown> =>
  o.run('corrige le défaut nommé', undefined, undefined, undefined, undefined, '', [], fil)

describe('étapes d’un run de lot : ecrire_a_un_fil pour écrire au chef', () => {
  it('le build d’un fil de lot reçoit ecrire_a_un_fil, et lui seul', async () => {
    const provider = new ProviderQuiEcritAuChef()
    const executes: Array<{ name: string; args: Record<string, unknown> }> = []
    await lancer(orchestrateur(provider, executes), 'conv-lot')
    const build = provider.appels.find((o) => o.execution?.phaseAppelante === 'build')
    expect(build?.skillNodeTools?.allowedTools).toEqual(['mcp__autowin__ecrire_a_un_fil'])
    expect(provider.outilsListes).toEqual(['ecrire_a_un_fil'])
    // Rien d'hérité du poste : l'étape reste privée des autres serveurs MCP.
    expect(build?.skillNodeTools?.inheritMachineMcp).not.toBe(true)
    expect(build?.skillNodeTools?.sansServeursUtilisateur).toBe(true)
  })

  it('le message part, signé par le lanceur du lot ; tout autre outil est refusé', async () => {
    const provider = new ProviderQuiEcritAuChef()
    const executes: Array<{ name: string; args: Record<string, unknown> }> = []
    await lancer(orchestrateur(provider, executes), 'conv-lot')
    // Un appel par envoi du build (ce montage le relance après un contrôle rouge), et rien d'autre :
    // le `remember` de chaque envoi n'atteint jamais le lanceur.
    const envoisDuBuild = provider.appels.filter((o) => o.execution?.phaseAppelante === 'build')
    expect(executes).toHaveLength(envoisDuBuild.length)
    expect(executes.length).toBeGreaterThan(0)
    for (const appel of executes)
      expect(appel).toEqual({
        name: 'ecrire_a_un_fil',
        args: { destinataire: 'conv-chef', texte: 'Quelle base garder ?' }
      })
    expect(provider.reponses.ecrire_a_un_fil?.isError).not.toBe(true)
    expect(provider.reponses.remember?.isError).toBe(true)
    expect(provider.reponses.remember?.texte).toContain('REFUSÉ')
  })

  it('un run hors plan de lots ne reçoit aucun outil', async () => {
    const provider = new ProviderQuiEcritAuChef()
    const executes: Array<{ name: string; args: Record<string, unknown> }> = []
    await lancer(orchestrateur(provider, executes), 'conv-hors-plan')
    expect(provider.appels.every((o) => o.skillNodeTools === undefined)).toBe(true)
    expect(executes).toEqual([])
  })
})
