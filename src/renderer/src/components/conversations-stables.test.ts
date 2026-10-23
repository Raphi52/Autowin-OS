import { describe, expect, it } from 'vitest'
import { memeContenu, reutiliserConversationsInchangees } from './conversations-stables'

/** Réconciliation de la liste rechargée par IPC (gel `renderer:vue-chat-liste`, conv-1115). */
const fil = (
  id: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> & {
  id: string
} => ({
  id,
  title: `Fil ${id}`,
  updatedAt: 1,
  modeleChoisi: { provider: 'claude', model: 'opus' },
  ...extra
})

describe('memeContenu', () => {
  it('compare le contenu, pas l’identité', () => {
    expect(memeContenu(fil('a'), structuredClone(fil('a')))).toBe(true)
    expect(memeContenu([1, { x: [2] }], [1, { x: [2] }])).toBe(true)
  })

  it('voit une différence imbriquée, une clé en plus ou en moins, un type différent', () => {
    expect(memeContenu(fil('a'), fil('a', { modeleChoisi: { provider: 'claude' } }))).toBe(false)
    expect(memeContenu(fil('a'), fil('a', { surlignee: true }))).toBe(false)
    expect(memeContenu({ a: 1, b: undefined }, { a: 1, c: undefined })).toBe(false)
    expect(memeContenu({ a: 1 }, { a: 1, b: undefined })).toBe(false)
    expect(memeContenu([1, 2], { 0: 1, 1: 2 })).toBe(false)
    expect(memeContenu([1, 2], [1, 2, 3])).toBe(false)
    expect(memeContenu(null, {})).toBe(false)
    expect(memeContenu(1, '1')).toBe(false)
  })
})

describe('reutiliserConversationsInchangees', () => {
  it('rien de changé ⇒ la liste affichée elle-même (React n’a rien à refaire)', () => {
    const affichees = [fil('a'), fil('b'), fil('c')]
    expect(reutiliserConversationsInchangees(affichees, structuredClone(affichees))).toBe(affichees)
  })

  it('un fil modifié ⇒ seul lui change d’objet, les autres gardent le leur', () => {
    const affichees = [fil('a'), fil('b'), fil('c')]
    const chargees = structuredClone(affichees)
    chargees[1].title = 'Nouveau titre'
    const stables = reutiliserConversationsInchangees(affichees, chargees)
    expect(stables).not.toBe(affichees)
    expect(stables[0]).toBe(affichees[0])
    expect(stables[1]).toBe(chargees[1])
    expect(stables[1].title).toBe('Nouveau titre')
    expect(stables[2]).toBe(affichees[2])
  })

  it('l’ordre et l’appartenance viennent de la liste chargée', () => {
    const affichees = [fil('a'), fil('b'), fil('c')]
    const nouveau = fil('d')
    // c remonte en tête, b est supprimé, d apparaît.
    const chargees = [structuredClone(affichees[2]), structuredClone(affichees[0]), nouveau]
    const stables = reutiliserConversationsInchangees(affichees, chargees)
    expect(stables.map((c) => c.id)).toEqual(['c', 'a', 'd'])
    expect(stables[0]).toBe(affichees[2])
    expect(stables[1]).toBe(affichees[0])
    expect(stables[2]).toBe(nouveau)
  })

  it('même contenus mais ordre changé ⇒ une nouvelle liste (le tri doit se voir)', () => {
    const affichees = [fil('a'), fil('b')]
    const stables = reutiliserConversationsInchangees(
      affichees,
      structuredClone([...affichees].reverse())
    )
    expect(stables).not.toBe(affichees)
    expect(stables[0]).toBe(affichees[1])
    expect(stables[1]).toBe(affichees[0])
  })

  it('un fil retiré en fin de liste ⇒ une nouvelle liste plus courte', () => {
    const affichees = [fil('a'), fil('b')]
    const stables = reutiliserConversationsInchangees(affichees, [structuredClone(affichees[0])])
    expect(stables).toHaveLength(1)
    expect(stables[0]).toBe(affichees[0])
  })

  it('première charge (rien d’affiché) ⇒ la liste chargée telle quelle', () => {
    const chargees = [fil('a')]
    const stables = reutiliserConversationsInchangees([], chargees)
    expect(stables).toEqual(chargees)
    expect(stables[0]).toBe(chargees[0])
  })
})
