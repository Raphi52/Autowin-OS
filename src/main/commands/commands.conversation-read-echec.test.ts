import { describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'

/**
 * Defaut mesure le 2026-09-03 (conv-181) : trois tours de chat se sont termines sur
 * `error_during_execution` (le CLI Claude a rendu un `result` en erreur). Le store porte bien
 * `status: 'failed'` et `error` sur le message assistant — `terminalDuTour` les ecrit —, mais
 * `conversation_read` ne rendait QUE `role`, `ts` et `text`. Un tour echoue se relisait donc comme
 * une reponse VIDE, indiscernable d'un silence du modele : toute retrospective partait aveugle et
 * cherchait la cause ailleurs. Ce que l'app SAIT de l'echec doit traverser la lecture.
 */
describe('conversation_read — un tour ECHOUE se lit comme un echec, pas comme un vide', () => {
  function osAvecTourEchoue() {
    const conversation = {
      id: 'conv-181',
      title: 'clone et lance',
      category: 'claude',
      provider: 'claude',
      createdAt: 1,
      updatedAt: 2,
      runPaths: [],
      messages: [
        { role: 'user' as const, content: 'kaizen', ts: 1 },
        {
          role: 'assistant' as const,
          content: '',
          ts: 2,
          status: 'failed',
          error: "Claude a interrompu l'appel : error_during_execution · 0.0000 USD"
        }
      ]
    }
    return {
      executionWorkspace: process.cwd(),
      conversations: {
        get: (id: string) => (id === 'conv-181' ? conversation : undefined),
        list: () => [conversation]
      },
      registry: { ids: () => ['claude'] },
      roles: { all: () => ({}), getBinding: () => ({ provider: 'claude' }) },
      runsWithGate: () => [],
      budget: () => ({ spent: 0 })
    }
  }

  it('rend le statut et la cause de l echec du tour', async () => {
    const bus = new AppCommandBus(osAvecTourEchoue() as never, () => undefined)

    const result = await bus.exec('conversation_read', { id: 'conv-181' })

    expect(result.ok).toBe(true)
    const messages = (result.data as { messages: Array<Record<string, unknown>> }).messages
    const assistant = messages.at(-1)!
    expect(assistant.statut).toBe('failed')
    expect(String(assistant.erreur)).toContain('error_during_execution')
  })

  it('n alourdit PAS un tour normal (ni statut ni erreur quand tout va bien)', async () => {
    const bus = new AppCommandBus(osAvecTourEchoue() as never, () => undefined)

    const result = await bus.exec('conversation_read', { id: 'conv-181' })

    const messages = (result.data as { messages: Array<Record<string, unknown>> }).messages
    expect(messages[0].statut).toBeUndefined()
    expect(messages[0].erreur).toBeUndefined()
  })
})
