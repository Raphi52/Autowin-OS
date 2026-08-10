import { describe, expect, it } from 'vitest'
import { canMoveQueueEntry, moveQueueEntry } from './chat-queue-order'

const q = (...ids: number[]) => ids.map((id) => ({ id }))

describe('moveQueueEntry', () => {
  it('remonte et redescend une entrée d’un cran', () => {
    expect(moveQueueEntry(q(1, 2, 3), 3, -1).map((e) => e.id)).toEqual([1, 3, 2])
    expect(moveQueueEntry(q(1, 2, 3), 1, 1).map((e) => e.id)).toEqual([2, 1, 3])
  })

  it('rend la MÊME liste aux bornes (rien à faire, aucun re-render inutile)', () => {
    const list = q(1, 2)
    expect(moveQueueEntry(list, 1, -1)).toBe(list)
    expect(moveQueueEntry(list, 2, 1)).toBe(list)
    expect(moveQueueEntry(list, 99, 1)).toBe(list)
  })

  it('préserve l’invariant BTW : le message btw reste en dernier', () => {
    const list = [{ id: 1 }, { id: 2 }, { id: 3, mode: 'btw' as const }]
    // On ne déplace pas un btw…
    expect(moveQueueEntry(list, 3, -1)).toBe(list)
    // …et rien ne passe après lui.
    expect(moveQueueEntry(list, 2, 1)).toBe(list)
    expect(moveQueueEntry(list, 1, 1).map((e) => e.id)).toEqual([2, 1, 3])
  })

  it('canMoveQueueEntry reflète exactement ce qui est possible', () => {
    const list = q(1, 2, 3)
    expect(canMoveQueueEntry(list, 1, -1)).toBe(false)
    expect(canMoveQueueEntry(list, 1, 1)).toBe(true)
    expect(canMoveQueueEntry(list, 3, 1)).toBe(false)
  })
})
