import { describe, expect, it, vi } from 'vitest'
import { ConversationRouter, bindingDeTri } from './conversation-router'
import { ExecutionSupervisor } from './execution-supervisor'
import type { Conversation, Msg } from './store/conversations'

/**
 * LE TRI DES CONVERSATIONS TOURNAIT SUR LE MODELE DE L'ORCHESTRATEUR.
 *
 * `decide()` lisait `getBinding('orchestrator')` : il n'existe aucun role dedie au tri, donc le
 * classement heritait du modele le plus cher configure dans `.autowin-data/.../roles.json`.
 * Mesure du 2026-09-16 (`scripts/audit-cout-tokens.mjs`) : 1 894 classements sur claude-opus-5,
 * 52,17 $, pour une tache qui rend 31 tokens de JSON. Le defaut du CODE est claude-fable-5.
 */
function conversation(messages: Msg[]): Conversation {
  return { id: 'conv-1', title: 'Sujet', provider: 'claude', messages } as Conversation
}
const message = (role: Msg['role'], content: string): Msg =>
  ({ role, content, ts: 1 }) as unknown as Msg

describe('modele de tri des conversations', () => {
  it('remplace le modele de l’orchestrateur par le defaut economique du provider', () => {
    expect(
      bindingDeTri({ provider: 'claude', model: 'claude-opus-5', reasoningEffort: 'low' })
    ).toEqual({ provider: 'claude', model: 'claude-fable-5', reasoningEffort: 'low' })
  })

  it('laisse INTACT un provider sans defaut publie (aucun modele invente)', () => {
    expect(bindingDeTri({ provider: 'codex', model: 'gpt-5.6-terra' })).toEqual({
      provider: 'codex',
      model: 'gpt-5.6-terra',
      reasoningEffort: 'low'
    })
  })

  it('l’appel de classement part avec ce modele-la, pas avec opus', async () => {
    const send = vi.fn(async (_p: string, _m: unknown, options: { model?: string }) => ({
      text: '{"route":"current","confidence":0.99,"reason":"related","title":""}',
      provider: 'claude',
      model: options.model,
      systemInjected: true
    }))
    const router = new ConversationRouter(
      { send } as never,
      { getBinding: () => ({ provider: 'claude', model: 'claude-opus-5' }) } as never,
      new ExecutionSupervisor()
    )
    await router.decide(
      conversation([message('user', 'Sujet courant')]),
      'Suite substantielle du sujet courant, assez longue pour interroger le modele'
    )
    expect(send).toHaveBeenCalledWith(
      'claude',
      expect.any(Array),
      expect.objectContaining({ model: 'claude-fable-5' })
    )
  })
})
