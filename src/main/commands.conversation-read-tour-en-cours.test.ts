import { describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'

/**
 * conv-1144 : un script extérieur (point d'entrée local) attend la fin du tour qu'il a lancé. Il
 * n'avait que `get_state`, qui liste TOUS les fils (908) pour en dire un seul : trop lourd à
 * interroger toutes les 2 s. `conversation_read` dit donc lui-même si un tour tourne dans CE fil, avec
 * la même autorité (`tourDeChatActif`, câblée sur `activeChatTurns.isInFlight`) que `get_state`.
 */
describe('conversation_read — dit si un tour tourne dans le fil', () => {
  function bus(actifs: Set<string>, cable = true) {
    const conversation = {
      id: 'conv-1',
      title: 'fil',
      provider: 'claude',
      createdAt: 1,
      updatedAt: 2,
      runPaths: [],
      messages: [{ role: 'user' as const, content: 'bonjour', ts: 1 }]
    }
    const os = {
      executionWorkspace: process.cwd(),
      conversations: {
        get: (id: string) => (id === 'conv-1' ? conversation : undefined),
        list: () => [conversation]
      },
      registry: { ids: () => ['claude'] },
      roles: { all: () => ({}), getBinding: () => ({ provider: 'claude' }) },
      runsWithGate: () => [],
      budget: () => ({ spent: 0 })
    }
    const b = new AppCommandBus(os as never, () => undefined)
    if (cable) b.tourDeChatActif = (id) => actifs.has(id)
    return b
  }

  it('rend tourEnCours: true pendant le tour, puis rien après', async () => {
    const actifs = new Set(['conv-1'])
    const b = bus(actifs)

    const pendant = await b.exec('conversation_read', { id: 'conv-1', derniers: '1' })
    expect(pendant.ok).toBe(true)
    expect((pendant.data as Record<string, unknown>).tourEnCours).toBe(true)

    actifs.delete('conv-1')
    const apres = await b.exec('conversation_read', { id: 'conv-1', derniers: '1' })
    expect((apres.data as Record<string, unknown>).tourEnCours).toBeUndefined()
  })

  /*
   * conv-1144 : un tour qui finit par une question à l'utilisateur (`ask`) se relisait comme une
   * réponse ordinaire — un script le prenait pour un succès alors que le fil ATTEND quelqu'un. La
   * question est rangée dans le message comme une action `ask` (chat-turn.ts, évènement `command`).
   */
  it('dit qu’un message pose une question à l’utilisateur, avec la question et ses choix', async () => {
    const b = bus(new Set())
    const conversation = (
      b as unknown as { os: { conversations: { get(id: string): { messages: unknown[] } } } }
    ).os.conversations.get('conv-1')
    conversation.messages.push(
      {
        role: 'assistant',
        content: 'Deux approches.',
        ts: 2,
        parts: [
          {
            kind: 'action',
            name: 'ask',
            args: { question: 'Laquelle ?', options: ['A — simple', 'B — robuste'] }
          }
        ]
      },
      { role: 'assistant', content: 'Fait.', ts: 3, parts: [{ kind: 'text', text: 'Fait.' }] }
    )
    const r = await b.exec('conversation_read', { id: 'conv-1', derniers: '2' })
    const [question, ordinaire] = (r.data as { messages: Array<Record<string, unknown>> }).messages
    expect(question.questionPosee).toEqual({
      question: 'Laquelle ?',
      options: ['A — simple', 'B — robuste']
    })
    expect(ordinaire.questionPosee).toBeUndefined()
  })

  it('ne déclare aucun tour quand la sonde n’est pas câblée', async () => {
    const r = await bus(new Set(['conv-1']), false).exec('conversation_read', { id: 'conv-1' })
    expect((r.data as Record<string, unknown>).tourEnCours).toBeUndefined()
  })
})
