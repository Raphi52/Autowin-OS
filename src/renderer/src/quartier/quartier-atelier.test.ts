import { describe, expect, it } from 'vitest'
import { creerRobotDeLAtelier, travailDe, TRAVAIL_S, type PoseAtelier } from './quartier-atelier'

// Le réveil du grand robot du hangar (conv-1453) : assez rare pour rester un moment, jamais en boucle.
const pose = (id: string, th: number): PoseAtelier => ({
  id,
  x: 250,
  y: 570,
  u: 60,
  th,
  sens: -1,
  cycle: 0.667,
  images: 6,
  alpha: 1
})

/** Les instants (en s) où le robot s'éveille, avec `n` agents qui forgent depuis t = 0. */
function reveils(n: number, duree: number): number[] {
  const robot = creerRobotDeLAtelier()
  const dt = 1 / 60
  const vus: number[] = []
  let avant = -1
  for (let t = 0; t < duree; t += dt) {
    robot.avancer(
      dt,
      Array.from({ length: n }, (_, i) => pose(`a${i}`, t + i * 0.17))
    )
    const { reveil } = robot.lire()
    if (reveil >= 0 && avant < 0) vus.push(t)
    avant = reveil
  }
  return vus
}

describe("le robot de l'atelier", () => {
  it('seul, un agent le réveille vers 20 s, pas avant', () => {
    const r = reveils(1, 25)
    expect(r.length).toBe(1)
    expect(r[0]).toBeGreaterThan(18)
    expect(r[0]).toBeLessThan(22)
  })

  it("à quatre, il s'éveille en moins de 7 s, et jamais deux fois d'affilée sans recharge", () => {
    const r = reveils(4, 40)
    expect(r[0]).toBeLessThan(7)
    for (let i = 1; i < r.length; i++) expect(r[i] - r[i - 1]).toBeGreaterThan(2.8 + 4)
  })

  it("un agent qui arrive en plein travail n'apporte pas d'un coup tous ses coups passés", () => {
    const robot = creerRobotDeLAtelier()
    robot.avancer(1 / 60, [pose('vieux', 120)])
    expect(robot.lire().charge).toBe(0)
  })

  it('sans agent, il reste éteint', () => {
    expect(reveils(0, 30)).toEqual([])
  })
})

// Les métiers de l'atelier (conv-1464) : forge, soudure, ordinateur, robotique, en alternance.
describe("les travaux de l'atelier", () => {
  it('chaque agent change de travail toutes les 30 s, jamais deux fois le même de suite', () => {
    for (const id of ['a', 'run-12', 'conv-1464', 'zz']) {
      let avant = travailDe({ id, th: 0 })
      for (let k = 1; k < 40; k++) {
        const t = travailDe({ id, th: k * TRAVAIL_S + 1 })
        expect(t).not.toBe(avant)
        expect(travailDe({ id, th: k * TRAVAIL_S + 29 })).toBe(t)
        avant = t
      }
    }
  })
  it('les quatre travaux apparaissent dans l’atelier', () => {
    const vus = new Set<string>()
    for (let i = 0; i < 20; i++)
      for (let k = 0; k < 6; k++) vus.add(travailDe({ id: `a${i}`, th: k * TRAVAIL_S }))
    expect([...vus].sort()).toEqual(['forge', 'ordinateur', 'robotique', 'soudure'])
  })
})
