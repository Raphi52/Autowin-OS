import { describe, expect, it, vi } from 'vitest'
import { ConversationRouteCoordinator, ConversationRouter } from './conversation-router'
import { ConversationStore, type Conversation } from './store/conversations'

function conversation(messages: Conversation['messages']): Conversation {
  return {
    schemaVersion: 3,
    id: 'conv-1',
    title: 'Refonte du graphe Git',
    category: 'codex',
    provider: 'codex',
    messages,
    workspaceId: 'workspace-conv-1',
    authorityMode: 'auto',
    createdAt: 1,
    updatedAt: 1
  }
}

function message(role: 'user' | 'assistant', content: string, index: number) {
  return {
    messageId: `message-${index}`,
    branchId: 'branch-conv-1-root',
    role,
    content,
    ts: index
  }
}

function harness(response: string | Error) {
  const registry = {
    send: vi.fn(async () => {
      if (response instanceof Error) throw response
      return {
        text: response,
        provider: 'codex',
        model: 'gpt-router',
        systemInjected: true,
        usage: { inputTokens: 20, outputTokens: 8, costUsd: 0.001 }
      }
    })
  }
  const roles = {
    getBinding: () => ({
      provider: 'codex',
      model: 'gpt-router',
      reasoningEffort: 'low'
    })
  }
  return { router: new ConversationRouter(registry as never, roles as never), registry }
}

describe('ConversationRouter', () => {
  it('keeps a related follow-up in the current conversation', async () => {
    const { router } = harness(
      '{"route":"current","confidence":0.99,"reason":"follow-up","title":""}'
    )
    const current = conversation([
      message('user', 'Refais le graphe Git des worktrees', 1),
      message('assistant', 'Le graphe est prêt.', 2)
    ])

    await expect(router.decide(current, 'Décale aussi son icône de 3px')).resolves.toMatchObject({
      route: 'current',
      confidence: 0.99,
      reason: 'follow-up'
    })
  })

  it('routes a clearly unrelated topic to a titled new conversation', async () => {
    const { router } = harness(
      '{"route":"new","confidence":0.96,"reason":"new-topic","title":"Programme Mouse Move"}'
    )
    const current = conversation([
      message('user', 'Refais le graphe Git des worktrees', 1),
      message('assistant', 'Le graphe est prêt.', 2)
    ])

    await expect(
      router.decide(current, 'Crée un petit exécutable qui bouge la souris')
    ).resolves.toMatchObject({
      route: 'new',
      confidence: 0.96,
      reason: 'new-topic',
      title: 'Programme Mouse Move'
    })
  })

  it.each([
    [0.89, 'current'],
    [0.9, 'new']
  ] as const)('applies the conservative threshold at confidence %s', async (confidence, route) => {
    const { router } = harness(
      JSON.stringify({ route: 'new', confidence, reason: 'new-topic', title: 'Autre sujet' })
    )
    const current = conversation([message('user', 'Sujet courant', 1)])

    await expect(router.decide(current, 'Sujet clairement distinct')).resolves.toMatchObject({
      route
    })
  })

  it.each([
    ['low confidence', '{"route":"new","confidence":0.74,"reason":"new-topic","title":"Autre"}'],
    ['malformed output', 'je pense que non'],
    ['provider failure', new Error('provider indisponible')]
  ])('fails closed to the current conversation on %s', async (_name, response) => {
    const { router } = harness(response)
    const current = conversation([message('user', 'Sujet courant', 1)])

    await expect(router.decide(current, 'Peut-être autre chose')).resolves.toMatchObject({
      route: 'current'
    })
  })

  it('does not spend a model call for an empty conversation', async () => {
    const { router, registry } = harness(
      '{"route":"new","confidence":1,"reason":"new-topic","title":"Jamais"}'
    )

    await expect(router.decide(conversation([]), 'Premier message')).resolves.toMatchObject({
      route: 'current',
      reason: 'empty-context'
    })
    expect(registry.send).not.toHaveBeenCalled()
  })

  it('can route an attachment-only message without inventing text', async () => {
    const { router, registry } = harness(
      '{"route":"new","confidence":0.95,"reason":"new-topic","title":"Analyse du document"}'
    )
    const current = conversation([message('user', 'Sujet courant', 1)])

    await expect(router.decide(current, '', ['nouveau-cahier.md'])).resolves.toMatchObject({
      route: 'new',
      title: 'Analyse du document'
    })
    const calls = registry.send.mock.calls as unknown as Array<
      [string, Array<{ role: string; content: string }>]
    >
    expect(JSON.parse(calls[0][1][0].content)).toMatchObject({
      incoming: '',
      attachments: ['nouveau-cahier.md']
    })
  })

  it('bounds the old context before sending it to the routing model', async () => {
    const { router, registry } = harness(
      '{"route":"current","confidence":0.9,"reason":"related","title":""}'
    )
    const huge = 'x'.repeat(10_000)
    const current = conversation(
      Array.from({ length: 30 }, (_, index) =>
        message(index % 2 ? 'assistant' : 'user', `${index}:${huge}`, index)
      )
    )

    await router.decide(current, 'Suite')

    const calls = registry.send.mock.calls as unknown as Array<
      [string, Array<{ role: string; content: string }>]
    >
    const sent = JSON.stringify(calls[0][1])
    const envelope = JSON.parse(calls[0][1][0].content) as {
      currentContext: Array<{ content: string }>
    }
    expect(sent.length).toBeLessThan(10_000)
    expect(envelope.currentContext).toHaveLength(10)
    expect(envelope.currentContext[0].content).toMatch(/^20:/)
    expect(envelope.currentContext.at(-1)?.content).toMatch(/^29:/)
  })
})

describe('ConversationRouteCoordinator', () => {
  it('creates an empty target and leaves the source untouched for a new topic', async () => {
    const store = new ConversationStore(() => 10)
    const source = store.create({ title: 'Git', category: 'codex', provider: 'codex' })
    store.append(source.id, { role: 'user', content: 'Parlons du graphe Git' })
    store.setAuthorityMode(source.id, 'ask')
    const decide = vi.fn().mockResolvedValue({
      route: 'new',
      confidence: 0.97,
      reason: 'new-topic',
      title: 'Mouse Move'
    })
    const before = store.get(source.id)!.messages.map((item) => ({ ...item }))

    const result = await new ConversationRouteCoordinator(store, { decide } as never).route(
      source.id,
      'Crée Mouse Move'
    )

    expect(result).toMatchObject({
      sourceConversationId: source.id,
      routed: true,
      decision: { route: 'new' }
    })
    expect(result.conversationId).not.toBe(source.id)
    expect(store.get(source.id)?.messages).toEqual(before)
    expect(store.get(result.conversationId)).toMatchObject({
      title: 'Mouse Move',
      category: 'codex',
      provider: 'codex',
      authorityMode: 'ask',
      messages: []
    })
  })

  it('returns the source without creating anything when the decision is current', async () => {
    const store = new ConversationStore(() => 10)
    const source = store.create({ title: 'Git', category: 'codex', provider: 'codex' })
    store.append(source.id, { role: 'user', content: 'Parlons du graphe Git' })
    const decide = vi.fn().mockResolvedValue({
      route: 'current',
      confidence: 0.8,
      reason: 'uncertain'
    })

    const result = await new ConversationRouteCoordinator(store, { decide } as never).route(
      source.id,
      'Et sinon ?'
    )

    expect(result).toMatchObject({
      sourceConversationId: source.id,
      conversationId: source.id,
      routed: false
    })
    expect(store.list()).toHaveLength(1)
  })
})
