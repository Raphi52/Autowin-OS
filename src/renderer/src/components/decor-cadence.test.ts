import { describe, expect, it } from 'vitest'
import { creerCadence } from './decor-cadence'

/** Les battements d'un écran à `hz`, pendant `secondes`, avec un léger tremblement de l'horloge. */
function battements(hz: number, secondes: number): number[] {
  const p = 1000 / hz
  const t: number[] = []
  for (let i = 0; i * p < secondes * 1000; i++) t.push(i * p + (i % 3 === 0 ? -0.3 : 0.2))
  return t
}

const imagesParSeconde = (hz: number, cout = 0): number => {
  const c = creerCadence()
  const t = battements(hz, 10)
  let n = 0
  for (const b of t)
    if (c.doitDessiner(b)) {
      n++
      c.noterCout(cout)
    }
  return n / 10
}

describe('la cadence du décor de fond', () => {
  it('vise 30 images/s sur TOUS les écrans — l ancien seuil de 25 ms donnait 30, 30 ou 36 selon l écran', () => {
    for (const hz of [60, 75, 120, 144, 165, 240]) {
      const ips = imagesParSeconde(hz)
      expect(ips, `${hz} Hz`).toBeGreaterThanOrEqual(26)
      expect(ips, `${hz} Hz`).toBeLessThanOrEqual(31)
    }
  })

  it('à 60 Hz, une image sur deux exactement malgré le tremblement de l horloge', () => {
    expect(imagesParSeconde(60)).toBeCloseTo(30, 0)
  })

  it('une image qui coûte cher espace les suivantes : le décor laisse la moitié du fil à l interface', () => {
    // 40 ms par image au fil principal (fond avenue, mesuré le 2026-10-18) : au plus 12,5 images/s
    const ips = imagesParSeconde(60, 40)
    expect(ips).toBeLessThanOrEqual(12.6)
    expect(ips * 40).toBeLessThanOrEqual(1000 * 0.5 + 25)
    // une image bon marché ne change rien
    expect(imagesParSeconde(60, 2)).toBeCloseTo(30, 0)
  })

  it('après une absence (fenêtre cachée), repart de maintenant sans rattraper les images perdues', () => {
    const c = creerCadence()
    expect(c.doitDessiner(0)).toBe(true)
    expect(c.doitDessiner(33.4)).toBe(true)
    expect(c.doitDessiner(10_000)).toBe(true)
    expect(c.doitDessiner(10_016.7)).toBe(false)
    expect(c.doitDessiner(10_033.4)).toBe(true)
  })
})
