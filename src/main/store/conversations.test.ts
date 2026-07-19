import { describe, expect, it } from 'vitest'
import { ConversationStore } from './conversations'

/** Horloge de test : incrémente à chaque appel pour garantir des ts strictement croissants. */
function makeClock(start = 1000): () => number {
  let t = start
  return () => t++
}

describe('ConversationStore', () => {
  it('create crée une conversation vide avec id déterministe', () => {
    const store = new ConversationStore(makeClock())
    const conv = store.create({ title: 'Titre', category: 'hermes', provider: 'anthropic' })

    expect(conv.id).toBe('conv-1')
    expect(conv.title).toBe('Titre')
    expect(conv.category).toBe('hermes')
    expect(conv.provider).toBe('anthropic')
    expect(conv.messages).toEqual([])
    expect(conv.createdAt).toBe(conv.updatedAt)
  })

  it("create incrémente le compteur d'id à chaque appel", () => {
    const store = new ConversationStore(makeClock())
    const c1 = store.create({ title: 'A', category: 'hermes', provider: 'p' })
    const c2 = store.create({ title: 'B', category: 'hermes', provider: 'p' })

    expect(c1.id).toBe('conv-1')
    expect(c2.id).toBe('conv-2')
  })

  it('append ajoute un message et met à jour updatedAt', () => {
    const store = new ConversationStore(makeClock())
    const conv = store.create({ title: 'A', category: 'hermes', provider: 'p' })
    const before = conv.updatedAt

    const updated = store.append(conv.id, { role: 'user', content: 'Salut' })

    expect(updated.messages).toHaveLength(1)
    expect(updated.messages[0]).toMatchObject({ role: 'user', content: 'Salut' })
    expect(updated.updatedAt).toBeGreaterThan(before)
  })

  it('persiste les métadonnées des fichiers joints sans leur contenu', () => {
    const store = new ConversationStore(makeClock())
    const conv = store.create({ title: 'A', category: 'claude', provider: 'claude' })
    const updated = store.append(conv.id, {
      role: 'user',
      content: 'Analyse',
      attachments: [{ name: 'notes.md', mimeType: 'text/markdown', size: 7 }]
    })

    expect(updated.messages[0].attachments).toEqual([
      { name: 'notes.md', mimeType: 'text/markdown', size: 7 }
    ])
    expect(JSON.stringify(updated.messages[0])).not.toContain('# Notes')
  })

  it('append sur un id inconnu jette', () => {
    const store = new ConversationStore(makeClock())
    expect(() => store.append('conv-inconnue', { role: 'user', content: 'x' })).toThrow()
  })

  it('get retourne la conversation ou undefined', () => {
    const store = new ConversationStore(makeClock())
    const conv = store.create({ title: 'A', category: 'hermes', provider: 'p' })

    expect(store.get(conv.id)).toBe(conv)
    expect(store.get('conv-inconnue')).toBeUndefined()
  })

  it('list retourne les conversations triées par updatedAt décroissant', () => {
    const store = new ConversationStore(makeClock())
    const c1 = store.create({ title: 'A', category: 'hermes', provider: 'p' })
    const c2 = store.create({ title: 'B', category: 'hermes', provider: 'p' })
    // Touche c1 en dernier pour qu'il passe devant c2.
    store.append(c1.id, { role: 'user', content: 'x' })

    const list = store.list()
    expect(list.map((c) => c.id)).toEqual([c1.id, c2.id])
  })

  it('byCategory filtre par catégorie', () => {
    const store = new ConversationStore(makeClock())
    const hermes = store.create({ title: 'A', category: 'hermes', provider: 'p' })
    store.create({ title: 'B', category: 'codex', provider: 'p' })

    const result = store.byCategory('hermes')
    expect(result).toEqual([hermes])
  })

  it('categories retourne les catégories distinctes', () => {
    const store = new ConversationStore(makeClock())
    store.create({ title: 'A', category: 'hermes', provider: 'p' })
    store.create({ title: 'B', category: 'codex', provider: 'p' })
    store.create({ title: 'C', category: 'hermes', provider: 'p' })

    expect(store.categories().sort()).toEqual(['codex', 'hermes'])
  })

  it('rename change le titre', () => {
    const store = new ConversationStore(makeClock())
    const conv = store.create({ title: 'A', category: 'hermes', provider: 'p' })

    store.rename(conv.id, 'Nouveau titre')

    expect(store.get(conv.id)?.title).toBe('Nouveau titre')
  })

  it("remove supprime la conversation et retourne true/false selon l'existence", () => {
    const store = new ConversationStore(makeClock())
    const conv = store.create({ title: 'A', category: 'hermes', provider: 'p' })

    expect(store.remove(conv.id)).toBe(true)
    expect(store.get(conv.id)).toBeUndefined()
    expect(store.remove(conv.id)).toBe(false)
  })
})
