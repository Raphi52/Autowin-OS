import { describe, expect, it } from 'vitest'
import { creerCoupeBoucle } from './coupe-boucle'

describe('coupeBoucle', () => {
  it('coupe au 4e appel identique au même résultat', () => {
    const c = creerCoupeBoucle()
    for (let i = 0; i < 3; i++)
      expect(c.observer('Bash', { command: 'ls' }, false, 'a')).toBeUndefined()
    expect(c.observer('Bash', { command: 'ls' }, false, 'a')).toMatch(/4 fois/)
  })

  it('ne coupe pas si le résultat change', () => {
    const c = creerCoupeBoucle()
    for (let i = 0; i < 10; i++)
      expect(c.observer('Bash', { command: 'ls' }, false, `r${i}`)).toBeUndefined()
  })

  it('coupe après 8 échecs d’affilée, un succès remet à zéro', () => {
    const c = creerCoupeBoucle()
    for (let i = 0; i < 7; i++) expect(c.observer('Read', { i }, true, `e${i}`)).toBeUndefined()
    expect(c.observer('Read', { ok: 1 }, false, 'ok')).toBeUndefined()
    for (let i = 0; i < 7; i++) expect(c.observer('Read', { j: i }, true, `x${i}`)).toBeUndefined()
    expect(c.observer('Read', { j: 99 }, true, 'x')).toMatch(/8 outils en échec/)
  })
})
