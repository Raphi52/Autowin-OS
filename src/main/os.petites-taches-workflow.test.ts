import { describe, expect, it, vi } from 'vitest'

/**
 * LE CHOIX AUTOMATIQUE DU WORKFLOW LIT LE MODÈLE DES PETITES TÂCHES (conv-264, 2026-10-11).
 *
 * `poseWorkflowDynamique` envoyait le modèle du chat avec un effort `low` écrit en dur. Il part
 * désormais sur le réglage « modèle des petites tâches » (écran Routeur) ; non réglé, sur le modèle
 * du chat en effort low — le même effort qu'avant, mais affiché à l'écran au lieu d'être caché.
 */
vi.mock('./role-store', () => ({ loadRoleBindings: () => undefined, saveRoleBindings: vi.fn() }))
vi.mock('./workflow-profiles', async (original) => ({
  ...(await original<typeof import('./workflow-profiles')>()),
  loadWorkflowProfiles: () => ({ profiles: [] })
}))

const { AutowinOS } = await import('./os')
const { RoleModelConfig } = await import('./roles')

const TACHE =
  'Ajoute un export CSV du journal des coûts avec un test qui vérifie les colonnes produites.'
const CHAT = { provider: 'claude', model: 'claude-opus-5-5', reasoningEffort: 'xhigh' } as const

async function appelDuChoix(
  roles: InstanceType<typeof RoleModelConfig>
): Promise<{ provider: string; model?: string; reasoningEffort?: string }> {
  const send = vi.fn(async () => ({ text: '{"kind":"none"}', provider: 'claude' }))
  const fake = { roles, registry: { send } }
  await (
    AutowinOS.prototype as unknown as {
      poseWorkflowDynamique: (task: string) => Promise<unknown>
    }
  ).poseWorkflowDynamique.call(fake, TACHE)
  expect(send).toHaveBeenCalledTimes(1)
  const [provider, , options] = send.mock.calls[0] as unknown as [
    string,
    unknown,
    { model?: string; reasoningEffort?: string }
  ]
  return { provider, model: options.model, reasoningEffort: options.reasoningEffort }
}

describe('choix automatique du workflow — modèle des petites tâches', () => {
  it('part sur le réglage posé, avec son effort', async () => {
    const roles = new RoleModelConfig({
      orchestrator: CHAT,
      petitesTaches: { provider: 'claude', model: 'claude-sonnet-4-6', reasoningEffort: 'medium' }
    })
    await expect(appelDuChoix(roles)).resolves.toEqual({
      provider: 'claude',
      model: 'claude-sonnet-4-6',
      reasoningEffort: 'medium'
    })
  })

  it('non réglé : modèle du chat, effort low', async () => {
    await expect(appelDuChoix(new RoleModelConfig({ orchestrator: CHAT }))).resolves.toEqual({
      provider: 'claude',
      model: 'claude-opus-5-5',
      reasoningEffort: 'low'
    })
  })
})
