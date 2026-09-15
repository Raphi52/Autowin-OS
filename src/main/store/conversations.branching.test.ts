import { describe, expect, it } from 'vitest'
import { ConversationStore, forkTitle } from './conversations'

function seed(): { store: ConversationStore; id: string; ids: string[] } {
  const store = new ConversationStore(() => 1)
  const conv = store.create({ title: 'T', provider: 'codex' })
  store.append(conv.id, { role: 'user', content: 'u1' })
  store.append(conv.id, { role: 'assistant', content: 'a1' })
  store.append(conv.id, { role: 'user', content: 'u2' })
  store.append(conv.id, { role: 'assistant', content: 'a2' })
  const ids = store.get(conv.id)!.messages.map((m) => m.messageId!)
  return { store, id: conv.id, ids }
}

/**
 * Forker crée une CONVERSATION À PART (comportement attendu, celui de Claude). L'ancienne version
 * empilait des branches DANS une conversation — invisibles depuis la liste, d'où la barre d'onglets
 * qu'il fallait pour s'y retrouver. Cette barre n'existe plus, et le modèle non plus.
 */
describe('ConversationStore — fork', () => {
  it('crée une conversation distincte, copie de l’historique jusqu’au point de fork', () => {
    const { store, id, ids } = seed()
    const forked = store.fork(id, ids[1]) // depuis a1

    expect(forked.id).not.toBe(id)
    expect(forked.messages.map((m) => m.content)).toEqual(['u1', 'a1']) // u2/a2 exclus
    expect(forked.forkedFrom).toEqual({ conversationId: id, messageId: ids[1] })
  })

  it('n’altère PAS la conversation d’origine', () => {
    const { store, id, ids } = seed()
    store.fork(id, ids[1])
    expect(store.get(id)!.messages.map((m) => m.content)).toEqual(['u1', 'a1', 'u2', 'a2'])
  })

  it('apparaît dans la liste des conversations — c’est tout l’intérêt', () => {
    const { store, id, ids } = seed()
    const before = store.list().length
    const forked = store.fork(id, ids[1])
    expect(store.list().length).toBe(before + 1)
    expect(store.list().some((c) => c.id === forked.id)).toBe(true)
  })

  it('les messages copiés reçoivent de NOUVEAUX identifiants', () => {
    const { store, id, ids } = seed()
    const forked = store.fork(id, ids[1])
    // Deux conversations partageant un messageId : un fork ultérieur viserait les deux à la fois.
    for (const message of forked.messages) expect(ids).not.toContain(message.messageId)
  })

  it('remappe les parents vers les nouveaux identifiants du fork', () => {
    const { store, id, ids } = seed()
    const forked = store.fork(id, ids[3])

    expect(forked.messages[0].parentMessageId).toBeUndefined()
    for (let index = 1; index < forked.messages.length; index += 1) {
      expect(forked.messages[index].parentMessageId).toBe(forked.messages[index - 1].messageId)
      expect(ids).not.toContain(forked.messages[index].parentMessageId)
    }
  })

  it('evite les messageId deja presents apres hydratation', () => {
    const store = new ConversationStore(() => 1)
    store.hydrate([
      {
        schemaVersion: 3,
        id: 'conv-1',
        title: 'Hydrated',
        provider: 'codex',
        messages: [{ role: 'user', content: 'u1', ts: 1, messageId: 'msg-3' }],
        createdAt: 1,
        updatedAt: 1
      }
    ])

    const forked = store.fork('conv-1', 'msg-3')
    const allIds = store
      .list()
      .flatMap((conversation) => conversation.messages.map(({ messageId }) => messageId))

    expect(forked.messages[0].messageId).not.toBe('msg-3')
    expect(new Set(allIds).size).toBe(allIds.length)
  })

  it('reste unique au-dela de Number.MAX_SAFE_INTEGER et sur les forks suivants', () => {
    const store = new ConversationStore(() => 1)
    const sourceConversationId = `conv-${Number.MAX_SAFE_INTEGER}`
    store.hydrate([
      {
        schemaVersion: 3,
        id: sourceConversationId,
        title: 'Huge ids',
        provider: 'codex',
        messages: [
          {
            role: 'user',
            content: 'u1',
            ts: 1,
            messageId: `msg-${Number.MAX_SAFE_INTEGER}`
          },
          {
            role: 'assistant',
            content: 'a1',
            ts: 2,
            messageId: 'message-source-2',
            parentMessageId: `msg-${Number.MAX_SAFE_INTEGER}`
          }
        ],
        createdAt: 1,
        updatedAt: 2
      }
    ])

    const firstFork = store.fork(sourceConversationId, 'message-source-2')
    const secondFork = store.fork(sourceConversationId, 'message-source-2')
    const ids = store
      .list()
      .flatMap((conversation) => conversation.messages.map(({ messageId }) => messageId))

    expect(new Set(ids).size).toBe(ids.length)
    expect(firstFork.id).not.toBe(secondFork.id)
    expect(store.list()).toHaveLength(3)
    expect(store.get(firstFork.id)).toBe(firstFork)
    expect(store.get(secondFork.id)).toBe(secondFork)
  })

  it('alloue append et beginTurn sans collision apres une hydratation non sequentielle', () => {
    const store = new ConversationStore(() => 3)
    store.hydrate([
      {
        schemaVersion: 3,
        id: 'conv-1',
        title: 'Sparse ids',
        provider: 'codex',
        messages: [
          { role: 'user', content: 'old', ts: 1, messageId: 'message-conv-1-3' },
          {
            role: 'assistant',
            content: 'custom',
            ts: 2,
            messageId: 'custom-2',
            parentMessageId: 'message-conv-1-3'
          }
        ],
        createdAt: 1,
        updatedAt: 2
      }
    ])

    store.append('conv-1', { role: 'user', content: 'appended' })
    const appendedId = store.get('conv-1')!.messages.at(-1)!.messageId!
    store.beginTurn('conv-1', { content: 'turn' }, { turnId: 'turn-sparse' })
    const sourceIds = store.get('conv-1')!.messages.map(({ messageId }) => messageId)
    const forked = store.fork('conv-1', appendedId)

    expect(new Set(sourceIds).size).toBe(sourceIds.length)
    expect(forked.messages.map(({ content }) => content)).toEqual(['old', 'custom', 'appended'])
  })

  it('reecrit un messageId duplique entre deux conversations pendant hydrate', () => {
    const store = new ConversationStore(() => 1)
    const conversation = (id: string, content: string) => ({
      schemaVersion: 3 as const,
      id,
      title: id,
      provider: 'codex',
      messages: [{ role: 'user' as const, content, ts: 1, messageId: 'shared-id' }],
      workspaceId: `workspace-${id}`,
      createdAt: 1,
      updatedAt: 1
    })

    expect(store.hydrate([conversation('conv-1', 'one'), conversation('conv-2', 'two')])).toBe(true)
    const messages = store.list().flatMap(({ messages: items }) => items)

    expect(new Set(messages.map(({ messageId }) => messageId)).size).toBe(messages.length)
    expect(messages.every(({ parentMessageId }) => parentMessageId === undefined)).toBe(true)
  })

  it('remappe les parents non adjacents vers un messageId deduplique pendant hydrate', () => {
    const store = new ConversationStore(() => 1)
    const base = {
      schemaVersion: 3 as const,
      category: 'codex' as const,
      provider: 'codex' as const,
      createdAt: 1,
      updatedAt: 1
    }

    expect(
      store.hydrate([
        {
          ...base,
          id: 'conv-1',
          title: 'one',
          messages: [{ role: 'user', content: 'one', ts: 1, messageId: 'shared-id' }]
        },
        {
          ...base,
          id: 'conv-2',
          title: 'two',
          messages: [
            { role: 'user', content: 'root', ts: 1, messageId: 'shared-id' },
            {
              role: 'user',
              content: 'middle',
              ts: 2,
              messageId: 'middle-id',
              parentMessageId: 'shared-id'
            },
            {
              role: 'user',
              content: 'branch',
              ts: 3,
              messageId: 'branch-id',
              parentMessageId: 'shared-id'
            }
          ]
        }
      ])
    ).toBe(true)
    const messages = store.get('conv-2')!.messages

    expect(messages[0].messageId).not.toBe('shared-id')
    expect(messages[1].parentMessageId).toBe(messages[0].messageId)
    expect(messages[2].parentMessageId).toBe(messages[0].messageId)
    expect(messages[2].parentMessageId).not.toBe(messages[1].messageId)
  })

  it('remappe un parent non adjacent depuis un messageId legacy implicite deduplique', () => {
    const store = new ConversationStore(() => 1)
    const base = {
      schemaVersion: 3 as const,
      category: 'codex' as const,
      provider: 'codex' as const,
      createdAt: 1,
      updatedAt: 1
    }

    expect(
      store.hydrate([
        {
          ...base,
          id: 'conv-2',
          title: 'collision',
          messages: [{ role: 'user', content: 'occupant', ts: 1, messageId: 'message-conv-1-1' }]
        },
        {
          ...base,
          id: 'conv-1',
          title: 'legacy',
          messages: [
            { role: 'user', content: 'root', ts: 1 },
            {
              role: 'user',
              content: 'middle',
              ts: 2,
              messageId: 'middle-id',
              parentMessageId: 'message-conv-1-1'
            },
            {
              role: 'user',
              content: 'branch',
              ts: 3,
              messageId: 'branch-id',
              parentMessageId: 'message-conv-1-1'
            }
          ]
        }
      ])
    ).toBe(true)
    const messages = store.get('conv-1')!.messages

    expect(messages[0].messageId).not.toBe('message-conv-1-1')
    expect(messages[1].parentMessageId).toBe(messages[0].messageId)
    expect(messages[2].parentMessageId).toBe(messages[0].messageId)
    expect(messages[2].parentMessageId).not.toBe(messages[1].messageId)
  })

  it('écrire dans le fork n’écrit pas dans l’original', () => {
    const { store, id, ids } = seed()
    const forked = store.fork(id, ids[1])
    store.append(forked.id, { role: 'assistant', content: 'suite du fork' })

    expect(store.get(forked.id)!.messages.map((m) => m.content)).toEqual([
      'u1',
      'a1',
      'suite du fork'
    ])
    expect(store.get(id)!.messages.map((m) => m.content)).toEqual(['u1', 'a1', 'u2', 'a2'])
  })

  it('reprend la catégorie et le provider de la source', () => {
    const store = new ConversationStore(() => 1)
    const source = store.create({
      title: 'T',
      provider: 'claude'
    })
    store.append(source.id, { role: 'user', content: 'u1' })
    const forked = store.fork(source.id, store.get(source.id)!.messages[0].messageId!)
    expect(forked.provider).toBe('claude')
  })

  it('forker un fork n’empile pas les suffixes dans le titre', () => {
    expect(forkTitle('Analyse RIG')).toBe('Analyse RIG (fork)')
    expect(forkTitle('Analyse RIG (fork)')).toBe('Analyse RIG (fork)')
    expect(forkTitle('   ')).toBe('Conversation (fork)')
  })

  it('garde le tour ET note QUI le possède, pour que la loupe aille au bon endroit', () => {
    // Constaté en usage : la loupe d'un message copié cherchait le tour SOUS le fork — le journal
    // étant rangé par conversation, elle ne trouvait rien et retombait sur un run étranger.
    const store = new ConversationStore(() => 1)
    const source = store.create({ title: 'T', provider: 'codex' })
    store.beginTurn(source.id, { content: 'u1' }, { turnId: 'turn-origine' })
    const messages = store.get(source.id)!.messages

    const forked = store.fork(source.id, messages.at(-1)!.messageId!)
    const copie = forked.messages.find((m) => m.turnId === 'turn-origine')
    expect(copie).toBeDefined() // le tour reste consultable
    expect(copie!.turnConversationId).toBe(source.id) // …mais dans la conversation qui le possède

    // Dans l'originale, aucun renvoi : le tour est chez elle.
    expect(store.get(source.id)!.messages.every((m) => m.turnConversationId === undefined)).toBe(
      true
    )
  })

  it('un fork de fork renvoie vers le propriétaire D’ORIGINE, pas vers l’intermédiaire', () => {
    const store = new ConversationStore(() => 1)
    const source = store.create({ title: 'T', provider: 'codex' })
    store.beginTurn(source.id, { content: 'u1' }, { turnId: 'turn-origine' })

    const premier = store.fork(source.id, store.get(source.id)!.messages.at(-1)!.messageId!)
    const second = store.fork(premier.id, premier.messages.at(-1)!.messageId!)

    expect(second.messages.find((m) => m.turnId === 'turn-origine')!.turnConversationId).toBe(
      source.id
    )
  })

  it('rejette une conversation ou un message inconnus', () => {
    const { store, id } = seed()
    expect(() => store.fork('conv-inconnue', 'x')).toThrow()
    expect(() => store.fork(id, 'message-inconnu')).toThrow()
  })

  it('rejette un ancrage vide (évite de matcher un message legacy sans id)', () => {
    const { store, id } = seed()
    expect(() => store.fork(id, '')).toThrow()
  })
})
