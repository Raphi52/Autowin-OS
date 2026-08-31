import { describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import type { Message, SendOptions, SendResult } from './providers/types'

/**
 * L'ÉTAT NE SE REPAYE PAS À CHAQUE ITÉRATION.
 *
 * Mesuré le 2026-08-31 sur conv-1 : le bloc `ÉTAT DE L'APP` — dont les 17 descriptions de skills —
 * réapparaissait HUIT fois dans un seul tour, identique au caractère près, pour un contenu utile
 * d'une ligne. Ce test verrouille le CÂBLAGE de `etat-diff.ts` dans le pilote : entier une fois,
 * delta ensuite.
 */
function pilot(responses: string[]) {
  const sent: string[] = []
  const etat = { tab: 'chat', skillsDisponibles: ['build — …', 'scout — …'] }
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
    snapshotForPrompt: vi.fn(async () => ({ ...etat })),
    exec: vi.fn(async () => ({ ok: true, data: { ok: true } }))
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { pilot: new AgentPilot(registry as any, roles as any, bus as any), sent }
}

describe('le catalogue des skills n’est envoyé qu’une fois par tour', () => {
  it('les itérations suivantes ne repoussent AUCUN skillsDisponibles', async () => {
    const { pilot: p, sent } = pilot([
      '<cmd>{"name":"get_state","args":{}}</cmd>',
      '<cmd>{"name":"get_state","args":{}}</cmd>',
      'Rien n’a bougé.'
    ])
    await p.chat([{ role: 'user', content: 'regarde' }], () => {}, undefined, 6, 'conv-etat')

    expect(sent.length).toBeGreaterThanOrEqual(3)
    // Le PREMIER message porte l'état entier.
    expect(sent[0]).toContain('skillsDisponibles')
    // Les relances n'ajoutent QUE le delta : ici l'état n'a pas bougé.
    const ajouts = sent.slice(1).map((message, index) => message.slice(sent[index].length))
    for (const ajout of ajouts) {
      expect(ajout).not.toContain('skillsDisponibles')
      expect(ajout).toContain('ÉTAT DE L’APP : inchangé')
    }
  })
})
