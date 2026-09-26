import { describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import type { Message, SendOptions, SendResult } from './providers/types'

/**
 * Cas réel conv-843, tour c4e319ca-783f-4b49-9b87-971cd6392c8e (saisie ts 1790275899514
 * « fais le ») : une action de bureau A ÉCHOUÉ (keys "ctrl+t" refusé), puis la clôture a rendu
 * « À faire : Va dans Brave… Saisis le code ». La relance « échec tu » (iteration 5 du journal
 * des tours) est partie la première ; la garde du geste rendu ne doit pas être éteinte par elle.
 */
function pilot(responses: string[]) {
  const sent: string[] = []
  const registry = {
    send: vi.fn(async (_p: string, messages: Message[], _o: SendOptions): Promise<SendResult> => {
      sent.push(messages.at(-1)?.content ?? '')
      return { text: responses.shift() ?? '', sessionId: 'sess' } as SendResult
    }),
    describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' }))
  }
  const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
  const bus = {
    catalog: vi.fn(() => [{ name: 'desktop_act', args: {}, description: 'bureau' }]),
    snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
    exec: vi.fn(async () => ({ ok: false, error: 'keys doit contenir entre 1 et 8 touches' }))
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { pilot: new AgentPilot(registry as any, roles as any, bus as any), sent }
}

const ACTION = '<cmd>{"name":"desktop_act","args":{"actions":[{"type":"key","keys":"ctrl+t"}]}}</cmd>'
const A_FAIRE =
  "Je n'ai pas pu saisir le code.\n\n**À faire :**\n1. Va dans Brave.\n2. Saisis le code **CAP56FNHZ**."

describe('garde du geste rendu — câblage (tour c4e319ca)', () => {
  it('relance « fais le geste » même après la relance d’échec du même tour', async () => {
    const { pilot: p, sent } = pilot([ACTION, A_FAIRE, A_FAIRE, 'Code saisi, page confirmée.'])
    await p
      .chat([{ role: 'user', content: 'fais le' }], () => {}, undefined, 8, 'conv-843',
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, true)
      .catch(() => undefined)
    expect(sent.some((c) => c.includes('ta clôture confie à l’utilisateur un geste d’écran'))).toBe(true)
  })
})
