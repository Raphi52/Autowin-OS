import { describe, expect, it, vi } from 'vitest'
import { ConversationRouter } from './conversation-router'
import { ExecutionSupervisor } from './execution-supervisor'
import { RoleModelConfig, type RolesPersistes } from './roles'
import type { Conversation, Msg } from './store/conversations'

/**
 * LE MODÈLE DU TRI DES CONVERSATIONS EST UN RÉGLAGE DE L'UTILISATEUR (conv-264, 2026-10-11).
 *
 * Historique : le tri empruntait le modèle de l'orchestrateur (mesure du 2026-09-16 : 1 894
 * classements sur claude-opus-5, 52,17 $), puis le défaut CODÉ du provider, `claude-fable-5` —
 * choisi nulle part et facturé le double d'Opus (449 classements pour 28,68 $ relevés dans
 * `activity/*.jsonl`). Il lit maintenant « modèle des petites tâches » (écran Routeur, clé
 * `petitesTaches` de `roles.json`) ; non réglé, il suit le modèle du chat en effort low.
 */
function conversation(messages: Msg[]): Conversation {
  return { id: 'conv-1', title: 'Sujet', provider: 'claude', messages } as Conversation
}
const message = (role: Msg['role'], content: string): Msg =>
  ({ role, content, ts: 1 }) as unknown as Msg

async function modeleDuTri(roles: RolesPersistes): Promise<Record<string, unknown>> {
  const send = vi.fn(
    async (_p: string, _m: unknown, options: { model?: string; reasoningEffort?: string }) => ({
      text: '{"route":"current","confidence":0.99,"reason":"related","title":""}',
      provider: 'claude',
      model: options.model,
      systemInjected: true
    })
  )
  const router = new ConversationRouter(
    { send } as never,
    new RoleModelConfig(roles),
    new ExecutionSupervisor()
  )
  await router.decide(
    conversation([message('user', 'Sujet courant')]),
    'Suite substantielle du sujet courant, assez longue pour interroger le modele'
  )
  expect(send).toHaveBeenCalledTimes(1)
  const [provider, , options] = send.mock.calls[0]
  return { provider, model: options.model, reasoningEffort: options.reasoningEffort }
}

const CHAT = { provider: 'claude', model: 'claude-opus-5-5', reasoningEffort: 'xhigh' } as const

describe('modele de tri des conversations', () => {
  it('part sur le modele des petites taches REGLE, avec son effort', async () => {
    await expect(
      modeleDuTri({
        orchestrator: CHAT,
        petitesTaches: { provider: 'claude', model: 'claude-sonnet-4-6', reasoningEffort: 'medium' }
      })
    ).resolves.toEqual({
      provider: 'claude',
      model: 'claude-sonnet-4-6',
      reasoningEffort: 'medium'
    })
  })

  it('non regle : suit le modele du CHAT, en effort low', async () => {
    await expect(modeleDuTri({ orchestrator: CHAT })).resolves.toEqual({
      provider: 'claude',
      model: 'claude-opus-5-5',
      reasoningEffort: 'low'
    })
  })

  it('n’envoie JAMAIS le defaut code claude-fable-5, regle ou pas', async () => {
    const sansReglage = await modeleDuTri({ orchestrator: CHAT })
    const avecReglage = await modeleDuTri({
      orchestrator: CHAT,
      petitesTaches: { provider: 'claude', model: 'claude-haiku-4-5' }
    })
    expect(sansReglage.model).not.toBe('claude-fable-5')
    expect(avecReglage.model).toBe('claude-haiku-4-5')
  })

  it('un reglage pose a chaud est lu au classement suivant', async () => {
    const roles = new RoleModelConfig({ orchestrator: CHAT })
    const send = vi.fn(async (_p: string, _m: unknown, options: { model?: string }) => ({
      text: '{"route":"current","confidence":0.99,"reason":"related","title":""}',
      provider: 'claude',
      model: options.model,
      systemInjected: true
    }))
    const router = new ConversationRouter({ send } as never, roles, new ExecutionSupervisor())
    const decider = (): Promise<unknown> =>
      router.decide(
        conversation([message('user', 'Sujet courant')]),
        'Suite substantielle du sujet courant, assez longue pour interroger le modele'
      )

    await decider()
    roles.setPetitesTaches({
      provider: 'claude',
      model: 'claude-haiku-4-5',
      reasoningEffort: 'low'
    })
    await decider()
    roles.setPetitesTaches(undefined)
    await decider()

    expect(send.mock.calls.map(([, , options]) => options.model)).toEqual([
      'claude-opus-5-5',
      'claude-haiku-4-5',
      'claude-opus-5-5'
    ])
  })
})
