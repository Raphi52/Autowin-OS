import { describe, expect, it, vi } from 'vitest'

/**
 * LE CHOIX AUTOMATIQUE DU WORKFLOW LIT LE MODÈLE DES PETITES TÂCHES (conv-264, 2026-10-11).
 *
 * `poseWorkflowDynamique` envoyait le modèle du chat avec un effort `low` écrit en dur. Il part
 * désormais sur le réglage « modèle des petites tâches » (écran Routeur) ; non réglé, sur l'alias
 * `haiku` du CLI en effort low (conv-1097 — avant : le modèle du chat en effort low).
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

type Envoi = { text: string; provider: string; model?: string; usage?: Record<string, number> }

async function poser(
  roles: InstanceType<typeof RoleModelConfig>,
  reponses: Envoi[]
): Promise<{
  resultat: unknown
  send: ReturnType<typeof vi.fn>
  lignes: Array<Record<string, unknown>>
}> {
  const file = [...reponses]
  const send = vi.fn(async () => file.shift() ?? { text: 'WORKFLOW: aucun', provider: 'claude' })
  const lignes: Array<Record<string, unknown>> = []
  const fake = {
    roles,
    registry: { send },
    cost: { add: (l: Record<string, unknown>) => lignes.push(l) }
  }
  const resultat = await (
    AutowinOS.prototype as unknown as {
      poseWorkflowDynamique: (task: string) => Promise<unknown>
    }
  ).poseWorkflowDynamique.call(fake, TACHE)
  return { resultat, send, lignes }
}

async function appelDuChoix(
  roles: InstanceType<typeof RoleModelConfig>
): Promise<{ provider: string; model?: string; reasoningEffort?: string }> {
  const { send } = await poser(roles, [{ text: '{"kind":"none"}', provider: 'claude' }])
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

  // conv-1097 : non réglé, le défaut n'est plus le modèle du chat mais l'alias Haiku du CLI.
  it('non réglé : alias haiku, effort low', async () => {
    await expect(appelDuChoix(new RoleModelConfig({ orchestrator: CHAT }))).resolves.toEqual({
      provider: 'claude',
      model: 'haiku',
      reasoningEffort: 'low'
    })
  })

  // conv-1097, piste 1 du scout : « nouveau » + graphe JSON est de la GÉNÉRATION, pas un choix.
  it('Haiku CHOISIT seulement : on ne lui demande jamais d’écrire un graphe', async () => {
    const { send } = await poser(new RoleModelConfig({ orchestrator: CHAT }), [])
    const [, messages] = send.mock.calls[0] as unknown as [string, Array<{ content: string }>]
    expect(messages[0].content).toContain('WORKFLOW: nouveau')
    expect(messages[0].content).not.toMatch(/Format d'un graphe/)
  })

  it('un graphe joint par Haiku n’est jamais exécuté : la composition repart sur le modèle du chat', async () => {
    const grapheDeHaiku =
      'WORKFLOW: nouveau\n{"name":"De Haiku","graph":{"entry":"b","nodes":[{"id":"b","phase":"build"}],"edges":[]}}'
    const grapheDuChat =
      'WORKFLOW: nouveau\n{"name":"Du chat","graph":{"entry":"f","nodes":[{"id":"f","phase":"frame"},{"id":"b","phase":"build"}],"edges":[{"from":"f","to":"b","when":"always"}]}}'
    const { resultat, send } = await poser(new RoleModelConfig({ orchestrator: CHAT }), [
      { text: grapheDeHaiku, provider: 'claude', model: 'claude-haiku-5-5' },
      { text: grapheDuChat, provider: 'claude', model: 'claude-opus-5-5' }
    ])
    expect(send).toHaveBeenCalledTimes(2)
    const [, messagesDuChat, optionsDuChat] = send.mock.calls[1] as unknown as [
      string,
      Array<{ content: string }>,
      { model?: string; reasoningEffort?: string }
    ]
    expect(optionsDuChat).toEqual({ model: 'claude-opus-5-5', reasoningEffort: 'xhigh' })
    expect(messagesDuChat[0].content).toMatch(/Format d'un graphe/)
    expect((resultat as { identity?: { name?: string } }).identity?.name).toBe('Du chat')
  })

  it('chaque appel laisse une ligne de coût : modèle réel, nom de l’appel, issue', async () => {
    const { lignes } = await poser(new RoleModelConfig({ orchestrator: CHAT }), [
      {
        text: 'WORKFLOW: aucun',
        provider: 'claude',
        model: 'claude-haiku-5-5',
        usage: { inputTokens: 900, outputTokens: 4, costUsd: 0.0006 }
      }
    ])
    expect(lignes).toHaveLength(1)
    expect(lignes[0]).toMatchObject({
      role: 'petitesTaches',
      appel: 'choixWorkflow',
      model: 'claude-haiku-5-5',
      inputTokens: 900,
      outputTokens: 4,
      costUsd: 0.0006,
      issue: 'aucun'
    })
  })

  it('une panne du modèle n’empêche pas le run de partir, et elle est NOMMÉE', async () => {
    const avertissement = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const send = vi.fn(async () => {
      throw new Error('surcharge 529')
    })
    const fake = {
      roles: new RoleModelConfig({ orchestrator: CHAT }),
      registry: { send },
      cost: { add: vi.fn() }
    }
    await expect(
      (
        AutowinOS.prototype as unknown as {
          poseWorkflowDynamique: (task: string) => Promise<unknown>
        }
      ).poseWorkflowDynamique.call(fake, TACHE)
    ).resolves.toBeUndefined()
    expect(avertissement.mock.calls.flat().join(' ')).toContain(
      'choixWorkflow abandonné : surcharge 529'
    )
    avertissement.mockRestore()
  })
})
