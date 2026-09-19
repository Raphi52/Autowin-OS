import { describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import type { Message, SendOptions, SendResult } from './providers/types'

/**
 * conv-717, point 1 — un tour qui finit SANS texte juste après un appel d'outil est relancé par le
 * code (pas par une consigne). Cas limites : réponse vide, seulement des espaces, et le mur de quota
 * « You've hit your session limit » qu'il faut laisser passer (aucune relance payée contre un mur).
 */
const RELANCE = 'tu as agi mais tu n’as rien dit'

function pilot(responses: Array<string | Error>) {
  const sent: string[] = []
  const registry = {
    send: vi.fn(async (_p: string, messages: Message[], _o: SendOptions): Promise<SendResult> => {
      sent.push(messages.at(-1)?.content ?? '')
      const next = responses.shift() ?? ''
      if (next instanceof Error) throw next
      return { text: next, sessionId: 'sess' } as SendResult
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
  return { pilot: new AgentPilot(registry as any, roles as any, bus as any), sent, registry }
}

const history: Message[] = [{ role: 'user', content: 'fais quelque chose' }]
const OUTIL = '<cmd>{"name":"get_state","args":{}}</cmd>'

describe('tour muet après un appel d’outil — cas limites', () => {
  it('réponse vide après l’outil : relance, et la clôture porte du texte', async () => {
    const { pilot: p, sent } = pilot([OUTIL, '', 'État relu, rien à changer.'])
    const events: string[] = []
    await p.chat(history, (e) => events.push(`${e.kind}:${e.text ?? ''}`), undefined, 6, 'conv-A')
    expect(sent.filter((c) => c.includes(RELANCE))).toHaveLength(1)
    expect(events.find((e) => e.startsWith('done:'))).toContain('rien à changer')
  })

  it('réponse faite SEULEMENT d’espaces après l’outil : traitée comme vide, donc relancée', async () => {
    const { pilot: p, sent } = pilot([OUTIL, '  \n\t  \n', 'État relu, rien à changer.'])
    const events: string[] = []
    await p.chat(history, (e) => events.push(`${e.kind}:${e.text ?? ''}`), undefined, 6, 'conv-A')
    expect(sent.filter((c) => c.includes(RELANCE))).toHaveLength(1)
    expect(events.find((e) => e.startsWith('done:'))).toContain('rien à changer')
  })

  it('mur de quota après l’outil : AUCUNE relance, le refus remonte tel quel', async () => {
    const { pilot: p, sent, registry } = pilot([
      OUTIL,
      new Error("You've hit your session limit · resets 7:10pm")
    ])
    await expect(p.chat(history, () => {}, undefined, 6, 'conv-A')).rejects.toThrow(
      /session limit/
    )
    expect(sent.some((c) => c.includes(RELANCE))).toBe(false)
    expect(registry.send).toHaveBeenCalledTimes(2)
  })
})
