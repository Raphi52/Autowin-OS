import { describe, expect, it } from 'vitest'
import { ConversationStore, LOT_SUPPRESSION_MAX } from './conversations'

function makeClock(start = 1000): () => number {
  let t = start
  return () => t++
}

/**
 * Purge en LOT. Le geste humain actuel est 1-par-1 avec une modale par conversation
 * (ChatView.removeConv → confirmRemoveConv → IPC mono-id). Ce test décrit le contrat du chemin
 * en lot AVANT qu'il existe : il doit être rouge tant que `removeMany` n'est pas là.
 */
describe('ConversationStore.removeMany', () => {
  it('supprime les ids nommés et RIEN d’autre, et rend la liste réellement supprimée', () => {
    const store = new ConversationStore(makeClock())
    const a = store.create({ title: 'A', provider: 'p' })
    const b = store.create({ title: 'B', provider: 'p' })
    const c = store.create({ title: 'C', provider: 'p' })

    const removed = store.removeMany([a.id, c.id])

    expect(removed).toEqual([a.id, c.id])
    expect(store.get(a.id)).toBeUndefined()
    expect(store.get(c.id)).toBeUndefined()
    // Entrée qui doit faire ÉCHOUER ce test si la correction supprimait trop large :
    // `b` n'est pas nommé, il reste INTACT.
    expect(store.get(b.id)?.title).toBe('B')
  })

  it('ignore les ids inconnus et les doublons sans jeter', () => {
    const store = new ConversationStore(makeClock())
    const a = store.create({ title: 'A', provider: 'p' })

    const removed = store.removeMany([a.id, a.id, 'conv-inconnue'])

    expect(removed).toEqual([a.id])
  })

  it('refuse un lot au-delà du plafond, sans rien supprimer', () => {
    const store = new ConversationStore(makeClock())
    const a = store.create({ title: 'A', provider: 'p' })
    const trop = [a.id, ...Array.from({ length: LOT_SUPPRESSION_MAX }, (_, i) => `conv-x${i}`)]

    expect(() => store.removeMany(trop)).toThrow(/lot/i)
    expect(store.get(a.id)?.title).toBe('A')
  })

  it('notifie onChange une fois par conversation réellement supprimée', () => {
    const store = new ConversationStore(makeClock())
    const a = store.create({ title: 'A', provider: 'p' })
    const b = store.create({ title: 'B', provider: 'p' })
    const vus: string[] = []
    store.onChange = (change) => vus.push(change.id)

    store.removeMany([a.id, b.id, 'conv-inconnue'])

    expect(vus).toEqual([a.id, b.id])
  })
})
