import { describe, expect, it, vi } from 'vitest'
import { AgentPilot, snapshotDuTour } from './agent-pilot'
import type { Message, SendOptions, SendResult } from './providers/types'

/**
 * L'IDENTITÉ DU FIL INJECTÉE AU MODÈLE EST CELLE DU TOUR, PAS CELLE DE L'ONGLET AFFICHÉ.
 *
 * Mesuré le 2026-09-14 : un tour joué dans conv-526 pendant que l'utilisateur regardait conv-533
 * recevait `activeConversationId: "conv-533"` (valeur posée par l'interface au changement d'onglet).
 * Le modèle répondait « cet échange arrive dans un fil différent (conv-533)… ce fil-ci est vide »
 * — alors qu'il répondait DANS conv-526, dont l'historique lui était bien transmis.
 */
function pilot(responses: string[], etatActif: string) {
  const sent: string[] = []
  const registry = {
    send: vi.fn(async (_p: string, messages: Message[], _o: SendOptions): Promise<SendResult> => {
      sent.push(messages.map((m) => m.content).join('\n'))
      return { text: responses.shift() ?? '', sessionId: 'sess' } as SendResult
    }),
    describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' }))
  }
  const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
  const bus = {
    catalog: vi.fn(() => [{ name: 'get_state', args: {}, description: 'état' }]),
    snapshotForPrompt: vi.fn(async () => ({ tab: 'chat', activeConversationId: etatActif })),
    exec: vi.fn(async () => ({ ok: true, data: { ok: true } }))
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { pilot: new AgentPilot(registry as any, roles as any, bus as any), sent }
}

describe('identité du fil injectée au modèle', () => {
  it('injecte le fil DU TOUR, pas l’onglet affiché', async () => {
    const { pilot: p, sent } = pilot(['Vu.'], 'conv-533-onglet-affiche')
    await p.chat([{ role: 'user', content: 'salut' }], () => {}, undefined, 6, 'conv-526-du-tour')
    const prompt = sent.join('\n')
    expect(prompt).toContain('conv-526-du-tour')
    expect(prompt).not.toContain('conv-533-onglet-affiche')
  })

  it('l’état RENVOYÉ après une commande porte lui aussi le fil du tour', async () => {
    const { pilot: p, sent } = pilot(
      ['<cmd>{"name":"get_state","args":{}}</cmd>', 'Fini.'],
      'conv-533-onglet-affiche'
    )
    await p.chat([{ role: 'user', content: 'regarde' }], () => {}, undefined, 6, 'conv-526-du-tour')
    expect(sent.join('\n')).not.toContain('conv-533-onglet-affiche')
  })

  it('sans fil de tour, l’état d’origine passe intact', () => {
    expect(snapshotDuTour({ activeConversationId: 'conv-affiche' }, undefined)).toEqual({
      activeConversationId: 'conv-affiche'
    })
  })
})
