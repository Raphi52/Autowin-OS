import { describe, it, expect } from 'vitest'
import { AuthoritySas } from './sas'

describe('AuthoritySas', () => {
  it('propose retourne des ids incrémentaux déterministes', () => {
    const t = 0
    const sas = new AuthoritySas(() => t)
    const id1 = sas.propose({ question: 'Q1', options: ['a', 'b'], safeDefault: 'a', ttlMs: 1000 })
    const id2 = sas.propose({ question: 'Q2', options: ['x', 'y'], safeDefault: 'x', ttlMs: 1000 })
    expect(id1).toBe('dec-1')
    expect(id2).toBe('dec-2')
  })

  it('pending liste les décisions non résolues et non expirées', () => {
    const t = 0
    const sas = new AuthoritySas(() => t)
    const id1 = sas.propose({ question: 'Q1', options: ['a', 'b'], safeDefault: 'a', ttlMs: 1000 })
    const pending = sas.pending()
    expect(pending.map((d) => d.id)).toEqual([id1])
  })

  it('resolve par user trace une résolution by=user', () => {
    const t = 0
    const sas = new AuthoritySas(() => t)
    const id = sas.propose({ question: 'Q1', options: ['a', 'b'], safeDefault: 'a', ttlMs: 1000 })
    const res = sas.resolve(id, 'b')
    expect(res.by).toBe('user')
    expect(res.choice).toBe('b')
  })

  it('resolve avec un id inconnu jette', () => {
    const sas = new AuthoritySas(() => 0)
    expect(() => sas.resolve('dec-999', 'a')).toThrow()
  })

  it('resolve deux fois sur le même id jette', () => {
    const t = 0
    const sas = new AuthoritySas(() => t)
    const id = sas.propose({ question: 'Q1', options: ['a', 'b'], safeDefault: 'a', ttlMs: 1000 })
    sas.resolve(id, 'a')
    expect(() => sas.resolve(id, 'b')).toThrow()
  })

  it('sweepExpired applique le safeDefault après dépassement du TTL', () => {
    let t = 0
    const sas = new AuthoritySas(() => t)
    const id = sas.propose({ question: 'Q1', options: ['a', 'b'], safeDefault: 'a', ttlMs: 1000 })
    t = 1000
    const produced = sas.sweepExpired()
    expect(produced).toHaveLength(1)
    expect(produced[0].id).toBe(id)
    expect(produced[0].choice).toBe('a')
    expect(produced[0].by).toBe('timeout-default')
  })

  it('une décision expirée ne figure plus dans pending()', () => {
    let t = 0
    const sas = new AuthoritySas(() => t)
    sas.propose({ question: 'Q1', options: ['a', 'b'], safeDefault: 'a', ttlMs: 1000 })
    t = 1000
    expect(sas.pending()).toEqual([])
  })

  it('journal cumule les résolutions user et timeout-default', () => {
    let t = 0
    const sas = new AuthoritySas(() => t)
    const id1 = sas.propose({ question: 'Q1', options: ['a', 'b'], safeDefault: 'a', ttlMs: 1000 })
    const id2 = sas.propose({ question: 'Q2', options: ['x', 'y'], safeDefault: 'x', ttlMs: 500 })
    sas.resolve(id1, 'b')
    t = 500
    const produced = sas.sweepExpired()
    const journal = sas.journal()
    expect(journal).toHaveLength(2)
    expect(journal.find((r) => r.id === id1)?.by).toBe('user')
    expect(journal.find((r) => r.id === id2)?.by).toBe('timeout-default')
    expect(produced).toHaveLength(1)
  })

  it("sweepExpired n'affecte pas les décisions déjà résolues par l'utilisateur", () => {
    let t = 0
    const sas = new AuthoritySas(() => t)
    const id = sas.propose({ question: 'Q1', options: ['a', 'b'], safeDefault: 'a', ttlMs: 100 })
    sas.resolve(id, 'b')
    t = 200
    const produced = sas.sweepExpired()
    expect(produced).toHaveLength(0)
    expect(sas.journal()).toHaveLength(1)
  })
  it('rejects a choice outside the proposed options', () => {
    const sas = new AuthoritySas()
    const id = sas.propose({
      question: 'Q',
      options: ['approve', 'cancel'],
      safeDefault: 'cancel',
      ttlMs: 1000
    })
    expect(() => sas.resolve(id, 'bypass')).toThrow('choix invalide')
    expect(sas.pending()).toHaveLength(1)
  })
})
