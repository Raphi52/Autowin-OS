import { describe, expect, it } from 'vitest'
import { ConversationStore } from './conversations'

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

describe('ConversationStore — branchement', () => {
  it('fork crée une nouvelle branche active ancrée sur un message', () => {
    const { store, id, ids } = seed()
    const before = store.get(id)!.branches!.length
    const conv = store.fork(id, ids[1]) // fork depuis a1
    expect(conv.branches!.length).toBe(before + 1)
    const newBranch = conv.branches!.at(-1)!
    expect(conv.activeBranchId).toBe(newBranch.id)
    expect(newBranch.parentBranchId).toBe(conv.rootBranchId)
    expect(newBranch.forkedFromMessageId).toBe(ids[1])
  })

  it('après fork, un nouvel append chaîne sur le point de fork et exclut la suite du parent', () => {
    const { store, id, ids } = seed()
    store.fork(id, ids[1]) // depuis a1 (index 1)
    store.append(id, { role: 'assistant', content: 'alt' })
    const chain = store.branchMessages(id).map((m) => m.content)
    expect(chain).toEqual(['u1', 'a1', 'alt']) // u2/a2 exclus
    const alt = store.branchMessages(id).at(-1)!
    expect(alt.parentMessageId).toBe(ids[1])
  })

  it('switchBranch revient à la branche racine avec sa chaîne linéaire originale', () => {
    const { store, id, ids } = seed()
    const root = store.get(id)!.rootBranchId!
    store.fork(id, ids[1])
    store.append(id, { role: 'assistant', content: 'alt' })
    const conv = store.switchBranch(id, root)
    expect(conv.activeBranchId).toBe(root)
    expect(store.branchMessages(id).map((m) => m.content)).toEqual(['u1', 'a1', 'u2', 'a2'])
  })

  it('branchMessages(branchId explicite) reconstruit la chaîne de cette branche', () => {
    const { store, id, ids } = seed()
    const conv = store.fork(id, ids[1])
    store.append(id, { role: 'assistant', content: 'alt' })
    expect(store.branchMessages(id, conv.rootBranchId).map((m) => m.content)).toEqual([
      'u1',
      'a1',
      'u2',
      'a2'
    ])
    expect(store.branchMessages(id, conv.activeBranchId).map((m) => m.content)).toEqual([
      'u1',
      'a1',
      'alt'
    ])
  })

  it('rejette un fork sur une conversation ou un message inconnus', () => {
    const { store, id } = seed()
    expect(() => store.fork('conv-inconnue', 'x')).toThrow()
    expect(() => store.fork(id, 'message-inconnu')).toThrow()
  })

  it('rejette un switchBranch vers une branche inexistante', () => {
    const { store, id } = seed()
    expect(() => store.switchBranch(id, 'branch-fantome')).toThrow()
  })

  it('rejette un fork avec un anchor vide (évite le match d’un message legacy sans id)', () => {
    const { store, id } = seed()
    expect(() => store.fork(id, '')).toThrow()
  })

  it('reconstruit correctement un branchement à 3 niveaux', () => {
    const { store, id, ids } = seed()
    store.fork(id, ids[1]) // branche B depuis a1
    store.append(id, { role: 'assistant', content: 'altB' })
    const altBId = store.branchMessages(id).at(-1)!.messageId!
    store.fork(id, altBId) // branche C depuis altB
    store.append(id, { role: 'assistant', content: 'altC' })
    expect(store.branchMessages(id).map((m) => m.content)).toEqual(['u1', 'a1', 'altB', 'altC'])
  })

  it('forke depuis un message NON-tip et tronque la suite du parent', () => {
    const { store, id, ids } = seed()
    store.fork(id, ids[0]) // depuis u1 (u2/a1/a2 après sur le parent)
    store.append(id, { role: 'assistant', content: 'altU' })
    expect(store.branchMessages(id).map((m) => m.content)).toEqual(['u1', 'altU'])
  })

  it('rejette un fork depuis un message d’une branche sœur (hors branche active)', () => {
    const { store, id, ids } = seed()
    const root = store.get(id)!.rootBranchId!
    store.fork(id, ids[1]) // branche B active
    store.append(id, { role: 'assistant', content: 'altB' })
    const altBId = store.branchMessages(id).at(-1)!.messageId!
    store.switchBranch(id, root) // retour sur racine : altB n'est PAS dans sa chaîne
    expect(() => store.fork(id, altBId)).toThrow(/hors de la branche active/)
  })
})
