import { describe, expect, it, vi } from 'vitest'
import { creerGardeEveil } from './garder-eveille'

describe('gardeEveil', () => {
  it('tient le verrou tant qu’un agent tourne et le rend au dernier', () => {
    const b = { start: vi.fn(() => 7), stop: vi.fn() }
    const g = creerGardeEveil(() => b)
    const r1 = g.prendre()
    const r2 = g.prendre()
    expect(b.start).toHaveBeenCalledTimes(1)
    r1()
    r1()
    expect(b.stop).not.toHaveBeenCalled()
    r2()
    expect(b.stop).toHaveBeenCalledWith(7)
    expect(g.actif()).toBe(false)
  })

  it('sans Electron, ne plante pas', () => {
    const g = creerGardeEveil(() => undefined)
    g.prendre()()
    expect(g.jetons()).toBe(0)
  })
})
