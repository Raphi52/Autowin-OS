import { describe, expect, it } from 'vitest'
import { ConversationStore, forkTitle } from './conversations'

function seed(): { store: ConversationStore; id: string; ids: string[] } {
  const store = new ConversationStore(() => 1)
  const conv = store.create({ title: 'T', category: 'codex', provider: 'codex' })
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

  it('reprend la catégorie, le provider et le mode d’autorité de la source', () => {
    const store = new ConversationStore(() => 1)
    const source = store.create({
      title: 'T',
      category: 'claude',
      provider: 'claude',
      authorityMode: 'manuel' as never
    })
    store.append(source.id, { role: 'user', content: 'u1' })
    const forked = store.fork(source.id, store.get(source.id)!.messages[0].messageId!)
    expect(forked.category).toBe('claude')
    expect(forked.provider).toBe('claude')
    expect(forked.authorityMode).toBe('manuel')
  })

  it('forker un fork n’empile pas les suffixes dans le titre', () => {
    expect(forkTitle('Analyse RIG')).toBe('Analyse RIG (fork)')
    expect(forkTitle('Analyse RIG (fork)')).toBe('Analyse RIG (fork)')
    expect(forkTitle('   ')).toBe('Conversation (fork)')
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
