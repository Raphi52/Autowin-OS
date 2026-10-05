import { describe, expect, it } from 'vitest'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import type { PromptSnapshot } from './commands'
import { createChatTurn, reduceChatTurn, type ChatTurnEvent } from '../shared/chat-turn'

/**
 * UNE CONSIGNE ÉCRITE PENDANT LE TOUR N'EFFACE PAS LA RÉPONSE DÉJÀ AFFICHÉE.
 *
 * Mesure du 2026-10-05 (conv-99, tour 5ef60fbb-1b39-45c9-a173-418feb595345, saisie ts 1791186255017,
 * voie « orientation »). Le premier appel (iteration 0, promptCalls ts 2026-10-05T07:44:23.743Z) a
 * rendu une réponse complète et vérifiée (« le dossier du patient affiche maintenant chaque
 * consentement en entier… »). La consigne « met un rond simple » est arrivée pendant ce temps :
 * le pilote a émis `stream-reset` sur le flux 0:0, et la réponse affichée (response-displayed
 * 07:47:49) ne contient plus que l'iteration 1. L'utilisateur : « si l'orientation ça rate,
 * n'efface pas le bloc de réponse, il y a peut-être des infos intéressantes dedans ».
 *
 * Règle : le texte écrit avant la consigne reste à l'écran ET reste connu du modèle (`TOI:`), la
 * réponse à la consigne s'ajoute après.
 */
const snapshotForPrompt = async (): Promise<PromptSnapshot> => ({
  tab: 'chat',
  providers: [],
  runsBlocked: [],
  conversationsCount: 0
})

describe('consigne tardive : le bloc déjà écrit survit', () => {
  it('ne retire pas le texte affiché et le rend au modèle', async () => {
    const queue: string[] = []
    const reponses = ['Vue document entier livrée, test vert.', 'Trait rond appliqué.']
    const appels: Array<Array<{ content: string }>> = []
    const registry = {
      send: async (
        _provider: string,
        messages: Array<{ content: string }>,
        _options: unknown,
        onChunk?: (chunk: { delta: string }) => void
      ) => {
        appels.push(messages)
        const text = reponses.shift() ?? 'fin'
        onChunk?.({ delta: text })
        if (appels.length === 1) queue.push('met un rond simple')
        return { text, provider: 'codex' }
      },
      describePrompt: () => ({
        provider: 'codex',
        transport: 'fixture',
        messages: [],
        options: {},
        limitation: 'test'
      })
    }
    const roles = {
      getBinding: () => ({ provider: 'codex', model: 'gpt-test', reasoningEffort: 'low' })
    }
    const bus = { catalog: () => [], snapshotForPrompt }
    const events: PilotEvent[] = []

    await new AgentPilot(registry as never, roles as never, bus as never).chat(
      [{ role: 'user', content: 'enlève la signature seule' }],
      (event) => events.push(event),
      undefined,
      6,
      'conv-99',
      undefined,
      () => queue.splice(0, queue.length)
    )

    expect(events.some((event) => event.kind === 'stream-reset')).toBe(false)

    let turn = createChatTurn('t')
    for (const event of events) {
      if (event.kind === 'delta' && event.streamId)
        turn = reduceChatTurn(turn, {
          kind: 'delta',
          streamId: event.streamId,
          text: event.text
        } as ChatTurnEvent)
    }
    const affiche = turn.parts.map((part) => (part as { text?: string }).text ?? '').join('\n')
    expect(affiche).toContain('Vue document entier livrée, test vert.')
    expect(affiche).toContain('Trait rond appliqué.')

    const second = appels[1].map((message) => message.content).join('\n')
    expect(second).toContain('Vue document entier livrée, test vert.')
    expect(second).toContain('met un rond simple')
  })
})
