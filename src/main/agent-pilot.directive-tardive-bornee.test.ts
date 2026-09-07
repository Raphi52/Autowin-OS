import { describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import type { PromptSnapshot } from './commands'

const snapshotForPrompt = async (): Promise<PromptSnapshot> => ({
  tab: 'chat',
  providers: [],
  runsBlocked: [],
  conversationsCount: 0
})

/*
 * UNE DIRECTIVE TARDIVE RALLONGE LE TOUR, ELLE NE L'ETIRE PAS SANS FIN.
 *
 * Le cap d'iterations grandissait de 1 a CHAQUE directive tardive, sans budget : il reculait donc
 * exactement aussi vite que la boucle avancait. Un appelant qui fixe une borne finie ne l'obtenait
 * jamais. Mesure du 2026-09-07 : avec un flux de directives qui ne se tarit pas, le tour ne se
 * terminait plus et le processus mourait de saturation memoire.
 */
describe('directive tardive — la rallonge du tour est bornee', () => {
  it('termine le tour meme si les directives ne se tarissent jamais', async () => {
    const registry = {
      // Aucune commande : seule la directive tardive peut rallonger le tour.
      send: vi.fn(async () => ({ text: 'je continue', provider: 'codex' })),
      describePrompt: () => ({
        provider: 'codex',
        transport: 'fixture',
        messages: [],
        options: {},
        limitation: 'test'
      })
    }
    const bus = {
      catalog: () => [],
      snapshotForPrompt,
      exec: vi.fn()
    }
    // Un flux de directives qui ne s'arrete pas : c'est le cas qui faisait reculer le cap sans fin.
    const drainDirectives = (): string[] => ['change de cap']

    // Le tour FINIT — ici par le cap, atteint et annonce. C'est le comportement voulu : borne
    // franche plutot que boucle sans fin. Avant le budget, cette promesse ne se resolvait jamais.
    await expect(
      new AgentPilot(
      registry as never,
      { getBinding: () => ({ provider: 'codex', model: 'gpt-test' }) } as never,
      bus as never
      ).chat(
        [{ role: 'user', content: 'vas-y' }],
        () => {},
        undefined,
        2,
        undefined,
        undefined,
        drainDirectives
      )
    ).rejects.toThrow(/Cap d’itérations \(5\)|Cap d'itérations \(5\)/)

    // Borne prouvee : 2 iterations demandees + 3 rallonges au maximum. Sans le budget, ce compteur
    // ne cessait jamais de monter et le tour ne rendait pas la main.
    expect(registry.send.mock.calls.length).toBeLessThanOrEqual(5)
    expect(registry.send.mock.calls.length).toBeGreaterThan(0)
  })
})
