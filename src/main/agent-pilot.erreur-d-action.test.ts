import { describe, expect, it, vi } from 'vitest'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import type { PromptSnapshot } from './commands'

/**
 * LE MESSAGE D'ERREUR D'UNE ACTION ROUGE ATTEINT LE FIL — conv-341 (2026-10-19) : « quand y a une
 * action rouge, c'est possible d'avoir le message d'erreur […] un truc qui coûte pas de token ».
 *
 * L'adaptateur Claude émet `Glob erreur - <message>` juste après `Glob échoué - 25 s`. Ce test
 * prouve que le pilote le RELAIE au fil comme une ligne d'état (c'est elle que le fil sauvegarde
 * dans le journal d'actions), et ce qui doit le faire échouer : une ligne d'erreur filtrée en route.
 */
const snapshotForPrompt = async (): Promise<PromptSnapshot> => ({
  tab: 'chat',
  providers: [],
  runsBlocked: [],
  conversationsCount: 0
})

const DELAI =
  'Ripgrep search timed out after 20 seconds. The search may have matched files but did not complete in time.'

describe('pilote — la ligne d’erreur d’une action rouge part au fil', () => {
  it('relaie « Glob erreur - … » comme ligne d’état, après la ligne de fin', async () => {
    const statuts = ['Glob · **/*.ts', 'Glob échoué - 25 s', `Glob erreur - ${DELAI}`]
    const send = vi.fn(
      async (_p: unknown, _m: unknown, _o: unknown, onChunk?: (c: { status?: string }) => void) => {
        for (const status of statuts) onChunk?.({ status })
        return { text: 'La recherche a été coupée au bout de 20 s.', provider: 'claude' }
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
      [{ role: 'user', content: 'pourquoi la recherche a échoué ?' }],
      (e) => events.push(e),
      undefined,
      4,
      'conv-erreur-d-action'
    )

    const relayees = events
      .filter((e) => e.kind === 'provider-status')
      .map((e) => (e as { text: string }).text)
    expect(relayees).toEqual(statuts)
  })
})
