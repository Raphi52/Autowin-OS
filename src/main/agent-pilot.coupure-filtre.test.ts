import { describe, expect, it, vi } from 'vitest'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import type { PromptSnapshot } from './commands'
import { pilotJournalEvents } from './runs/turn-journal-enrich'

/**
 * LA COUPURE DU FILTRE DE SÉCURITÉ ATTEINT LE JOURNAL DU TOUR (conv-1161, 2026-10-27).
 *
 * L'adaptateur joint à un fragment la coupure d'une réponse par le filtre du fournisseur
 * (`coupureFiltre` : catégorie et explication). Le pilote doit la relayer en un événement
 * `coupure-filtre`, que le journal du tour écrit (`pilotJournalEvents`) et que la rétrospective et
 * le kaizen lisent. Mesuré sur conv-1161 : sans cet événement, la coupure n'existait que dans le
 * journal brut du CLI (`run-stdout/aeaf1921-…` l.637), et le diagnostic a dû l'y chercher.
 * Ce qui fait échouer ce test : un champ jeté en route, ou un fragment sans texte pris pour un mot.
 */
const snapshotForPrompt = async (): Promise<PromptSnapshot> => ({
  tab: 'chat',
  providers: [],
  runsBlocked: [],
  conversationsCount: 0
})

describe('pilote — la coupure du filtre de sécurité part au journal du tour', () => {
  it('relaie chaque `coupureFiltre` en un événement `coupure-filtre` écrit au journal', async () => {
    const avis = '\n\n⚠️ Le filtre de sécurité a coupé une partie de cette réponse.'
    const coupure = { categorie: 'cyber', explication: 'blocked under Usage Policy' }
    const send = vi.fn(
      async (_p: unknown, _m: unknown, _o: unknown, onChunk?: (c: object) => void) => {
        onChunk?.({ delta: 'Je regarde.' })
        onChunk?.({ delta: avis, coupureFiltre: coupure })
        // Seconde coupure du même tour : pas d'avis répété, mais la donnée part quand même.
        onChunk?.({ delta: '', coupureFiltre: coupure })
        onChunk?.({ delta: "\n\nJe m'arrête ici." })
        return { text: `Je regarde.${avis}\n\nJe m'arrête ici.`, provider: 'claude' }
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
      [{ role: 'user', content: 'regarde' }],
      (e) => events.push(e),
      undefined,
      4,
      'conv-coupure-filtre'
    )

    const relayes = events.filter((e) => e.kind === 'coupure-filtre')
    expect(relayes).toHaveLength(2)
    expect(relayes[0].data).toEqual(coupure)
    expect(relayes[0].text).toContain('cyber')

    // L'avis reste dans la réponse, une seule fois ; la donnée n'y ajoute aucun texte.
    const reponse = events
      .filter((e) => e.kind === 'delta')
      .map((e) => e.text ?? '')
      .join('')
    expect(reponse.split('⚠️ Le filtre de sécurité').length - 1).toBe(1)
    expect(reponse).not.toContain('blocked under Usage Policy')

    // Le journal du tour l'écrit avec sa catégorie : c'est ce que lisent rétrospective et kaizen.
    const journal = pilotJournalEvents(relayes[0], 1_700_000_000_000)
    expect(journal).toHaveLength(1)
    expect(journal[0]).toMatchObject({ kind: 'coupure-filtre', data: coupure })
  })
})
