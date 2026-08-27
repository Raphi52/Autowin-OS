import { describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import type { Message, SendOptions, SendResult } from './providers/types'

/**
 * DEFAUT VECU (conv-1450) : la capture lue par le modele pour VALIDER une modif front partait bien
 * dans son prochain prompt, mais n'atteignait jamais le fil de l'utilisateur — l'evenement `result`
 * porte `attachments`, et le chemin de rendu ne connait que `artifact`. L'utilisateur ne voyait donc
 * jamais l'image sur laquelle le verdict s'appuyait.
 */
describe('AgentPilot — la capture qui valide est VUE par l’utilisateur', () => {
  const capture = {
    name: 'capture.jpg',
    mimeType: 'image/jpeg',
    size: 3,
    kind: 'image' as const,
    content: 'YWJj'
  }

  function pilote(attachments: unknown[]): {
    events: Array<{
      kind: string
      artifact?: { mimeType?: string; content?: string; kind?: string }
    }>
    run: () => Promise<unknown>
  } {
    let tour = 0
    const registry = {
      send: vi.fn(
        async (
          _provider: string,
          _messages: Message[],
          _options: SendOptions
        ): Promise<SendResult> => {
          tour += 1
          return {
            text:
              tour === 1
                ? '<cmd>{"name":"desktop_observe","args":{}}</cmd>'
                : 'La vue est correcte.',
            provider: 'codex',
            systemInjected: true
          } as SendResult
        }
      ),
      describePrompt: vi.fn(() => ({ provider: 'codex', messages: [], transport: 'test' }))
    }
    const roles = { getBinding: vi.fn(() => ({ provider: 'codex', model: 'gpt-test' })) }
    const bus = {
      catalog: vi.fn(() => [{ name: 'desktop_observe', description: 'capture', args: {} }]),
      snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
      exec: vi.fn(async () => ({ ok: true, data: 'vu', attachments }))
    }
    const events: Array<{ kind: string; artifact?: Record<string, unknown> }> = []
    return {
      events,
      run: () =>
        new AgentPilot(registry as never, roles as never, bus as never).chat(
          [{ role: 'user', content: 'verifie le front' }],
          (event) => events.push(event as never),
          undefined,
          3,
          'conv-capture'
        )
    }
  }

  it('emet la capture d’un outil comme artefact rendu dans le fil', async () => {
    const { events, run } = pilote([capture])
    await run()
    const artefact = events.find((event) => event.kind === 'artifact')?.artifact
    expect(artefact).toMatchObject({ mimeType: 'image/jpeg', kind: 'image', content: 'YWJj' })
  })

  /**
   * ENTREE QUI DOIT FAIRE ECHOUER une correction FAUSSE : une piece jointe NON-image (log texte)
   * n'est pas une preuve visuelle et ne doit pas etre poussee comme artefact dans le fil. Une
   * correction qui rebalancerait aveuglement toutes les `attachments` casse ici.
   */
  it('ne pousse PAS une piece jointe non-image comme artefact', async () => {
    const { events, run } = pilote([
      {
        name: 'sortie.log',
        mimeType: 'text/plain',
        size: 3,
        kind: 'text' as const,
        content: 'YWJj'
      }
    ])
    await run()
    expect(events.find((event) => event.kind === 'artifact')).toBeUndefined()
  })
})
