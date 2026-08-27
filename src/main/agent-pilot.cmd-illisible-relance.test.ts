import { describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import type { Message, SendOptions, SendResult } from './providers/types'

/**
 * TOUR PARASITE — un `<cmd>` cassé ne peut plus clore le tour en silence.
 *
 * Mesuré sur `conv-1472` (2026-08-27, tour `c73fd638`) : le modèle émet un `orchestrate` dont
 * l'accolade fermante MANQUE. Le parseur en fait un token `invalid`, mais le signalement vivait
 * uniquement dans la boucle d'exécution, gardée par `hasCommand` (qui ne compte que les tokens
 * `command`). Le bloc brut s'affichait, RIEN ne s'exécutait, et le tour se cloturait sur
 * « Je lance la fusion en build. » : l'utilisateur devait retaper « go ».
 */
const CMD_TRONQUE =
  '<cmd>{"name":"orchestrate","args":{"task":"Fusionner le travail non publié","phase":"build"}' +
  '</cmd>\n\nJe lance la fusion en build.'

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
    catalog: vi.fn(() => [{ name: 'get_state', args: {}, description: 'état' }]),
    snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
    exec: vi.fn(async () => ({ ok: true, data: { ok: true } }))
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { pilot: new AgentPilot(registry as any, roles as any, bus as any), sent }
}

const history: Message[] = [{ role: 'user', content: 'go' }]

describe('un <cmd> inexploitable RELANCE le tour au lieu de le clore', () => {
  it('JSON tronqué seul : échec visible + réinjection + le tour repart et agit', async () => {
    const { pilot: p, sent } = pilot([
      CMD_TRONQUE,
      '<cmd>{"name":"get_state","args":{}}</cmd>',
      'État relu, rien à changer.'
    ])
    const events: { kind: string; name?: string; ok?: boolean; text?: string }[] = []
    await p.chat(history, (e) => events.push(e as never), undefined, 6, 'conv-P')

    // (a) l'echec est VISIBLE dans le fil
    expect(
      events.some((e) => e.kind === 'result' && e.name === 'commande illisible' && e.ok === false)
    ).toBe(true)
    // (b) il est REINJECTE au modele
    const relance = sent.find((c) => c.includes('ton bloc <cmd> est INEXPLOITABLE'))
    expect(relance).toBeDefined()
    expect(relance).toContain('accolades équilibrées')
    // (c) le tour REPART et execute pour de vrai — plus besoin de retaper « go »
    expect(events.some((e) => e.kind === 'result' && e.name === 'get_state')).toBe(true)
  })

  it('la relance est bornée à une fois (jamais de boucle payante)', async () => {
    const { pilot: p, sent } = pilot([CMD_TRONQUE, CMD_TRONQUE, CMD_TRONQUE])
    await p.chat(history, () => {}, undefined, 6, 'conv-P').catch(() => undefined)
    expect(sent.filter((c) => c.includes('ton bloc <cmd> est INEXPLOITABLE'))).toHaveLength(1)
  })

  it('une commande VALIDE ne déclenche aucune relance (zéro appel superflu)', async () => {
    const { pilot: p, sent } = pilot([
      '<cmd>{"name":"get_state","args":{}}</cmd>',
      'État relu.'
    ])
    await p.chat(history, () => {}, undefined, 6, 'conv-P')
    expect(sent.some((c) => c.includes('ton bloc <cmd> est INEXPLOITABLE'))).toBe(false)
  })
})
