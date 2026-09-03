import { describe, expect, it } from 'vitest'
import { filAffichable, type MessageAffichable } from './fil-affichable'

const u = (content: string): MessageAffichable & { content: string } => ({
  role: 'user',
  content
})
const a = (content: string, done = true): MessageAffichable & { content: string } => ({
  role: 'assistant',
  content,
  done
})

describe('filAffichable', () => {
  it("ne RETRECIT pas le fil : un cache tronque ne cache plus l'historique du store", () => {
    // conv-152 : cache amorce par un tour lance cote main, store complet.
    const store = [u('q1'), a('r1'), u('q2'), a('r2'), u('/kaizen'), a('', false)]
    const cacheTronque = [a('', false)]
    const rendu = filAffichable(cacheTronque, store)
    expect(rendu.map((m) => (m as { content: string }).content)).toEqual([
      'q1',
      'r1',
      'q2',
      'r2',
      '/kaizen',
      ''
    ])
  })

  it('garde la queue VIVANTE du cache, que le store ne connait pas encore', () => {
    const store = [u('q1'), a('r1')]
    const cache = [a('en vol', false)]
    expect(filAffichable(cache, store)).toEqual([u('q1'), a('r1'), a('en vol', false)])
  })

  it('un cache PLEIN gagne sur un store vide (conv-82)', () => {
    const cache = [u('q1'), a('r1')]
    expect(filAffichable(cache, [])).toEqual(cache)
  })

  it('un cache vide est une absence, pas un fil', () => {
    const store = [u('q1'), a('r1')]
    expect(filAffichable([], store)).toEqual(store)
    expect(filAffichable(undefined, store)).toEqual(store)
  })

  it('un cache plus court SANS tour en vol laisse le store faire foi', () => {
    const store = [u('q1'), a('r1'), u('q2'), a('r2')]
    expect(filAffichable([u('q1'), a('r1')], store)).toEqual(store)
  })
})
