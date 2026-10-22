import { describe, expect, it, vi } from 'vitest'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import type { PromptSnapshot } from './commands'

/**
 * LES TESTS DU TERMINAL ATTEIGNENT LE TOUR (conv-1059, 2026-10-22). L'adaptateur joint à un
 * fragment les tests qu'une commande `Bash` a joués et leur code de sortie (`testsDuTerminal`) ; le
 * pilote doit les relayer en un événement `tests-du-terminal`, que le tour enregistre et que la
 * carte du fil lit comme une vérification. Ce qui fait échouer ce test : un champ jeté en route, ou
 * un fragment sans texte pris pour le premier mot de la réponse.
 */
const snapshotForPrompt = async (): Promise<PromptSnapshot> => ({
  tab: 'chat',
  providers: [],
  runsBlocked: [],
  conversationsCount: 0
})

describe('pilote — les tests du terminal partent au tour', () => {
  it('relaie `testsDuTerminal` en un événement `tests-du-terminal`, sans texte parasite', async () => {
    const tests = [{ commande: 'npx vitest run a.test.ts', codeDeSortie: 0 }]
    const send = vi.fn(
      async (_p: unknown, _m: unknown, _o: unknown, onChunk?: (c: object) => void) => {
        onChunk?.({ delta: '', status: 'Bash · npx vitest run a.test.ts' })
        onChunk?.({ delta: '', testsDuTerminal: tests })
        onChunk?.({ delta: '', status: 'Bash terminé - 3 s' })
        return { text: 'Les tests passent.', provider: 'claude' }
      }
    )
    const events: PilotEvent[] = []
    await new AgentPilot(
      {
        send,
        describePrompt: () => ({
          provider: 'claude',
          transport: 'fixture',
          messages: [],
          options: {},
          limitation: 'test'
        })
      } as never,
      {
        getBinding: () => ({ provider: 'claude', model: 'claude-test', reasoningEffort: 'low' })
      } as never,
      { catalog: () => [], snapshotForPrompt, exec: vi.fn() } as never
    ).chat(
      [{ role: 'user', content: 'lance les tests' }],
      (e) => events.push(e),
      undefined,
      4,
      'conv-tests-du-terminal'
    )

    const relayes = events.filter((e) => e.kind === 'tests-du-terminal')
    expect(relayes).toHaveLength(1)
    expect(relayes[0].data).toEqual(tests)
    // Le fragment des tests n'est pas une réponse : aucun delta vide ni texte en plus.
    const textes = events.filter((e) => e.kind === 'delta').map((e) => e.text ?? '')
    expect(textes.join('')).not.toContain('npx vitest')
  })
})
