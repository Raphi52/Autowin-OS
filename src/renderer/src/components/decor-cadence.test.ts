import { describe, expect, it } from 'vitest'
import { creerCadence, estAuRepos, IMAGES_PAR_SECONDE_REPOS, REPOS_APRES_MS } from './decor-cadence'

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

describe('la cadence d un décor dessiné dans son propre fil (conv-347)', () => {
  const BATTEMENT = 1000 / 60
  const palierApres = (couts: number[]): number => {
    const c = creerCadence()
    for (const ms of couts) c.noterCout(ms, 'dedie')
    return c.intervalle()
  }

  it('le coût du Worker règle l intervalle, en battements entiers d écran (33, 50, 67 ms…)', () => {
    expect(palierApres(Array(20).fill(12))).toBeCloseTo(2 * BATTEMENT, 5)
    expect(palierApres(Array(20).fill(36))).toBeCloseTo(3 * BATTEMENT, 5)
    // reflet une image sur deux : c'est l'image LOURDE qui compte, pas la moyenne
    expect(palierApres(Array.from({ length: 20 }, (_, i) => (i % 2 ? 52 : 30)))).toBeCloseTo(
      4 * BATTEMENT,
      5
    )
  })

  it('un pic isolé ne change pas le palier', () => {
    const couts = Array(20).fill(12)
    couts[7] = 480
    expect(palierApres(couts)).toBeCloseTo(2 * BATTEMENT, 5)
  })

  it('hystérésis : le palier ne redescend que si le coût passe nettement dessous', () => {
    const c = creerCadence()
    for (let i = 0; i < 20; i++) c.noterCout(40, 'dedie') // 50 ms → 3 battements
    expect(c.intervalle()).toBeCloseTo(3 * BATTEMENT, 5)
    for (let i = 0; i < 20; i++) c.noterCout(26, 'dedie') // 32,5 ms : tout juste sous 33 → reste
    expect(c.intervalle()).toBeCloseTo(3 * BATTEMENT, 5)
    for (let i = 0; i < 20; i++) c.noterCout(18, 'dedie') // 22,5 ms : nettement dessous → 30 i/s
    expect(c.intervalle()).toBeCloseTo(2 * BATTEMENT, 5)
  })

  it('le coût d un fil dédié ne réclame pas la moitié de l interface : 30 ms ne divise pas la cadence par deux', () => {
    const c = creerCadence()
    for (let i = 0; i < 20; i++) c.noterCout(24, 'dedie')
    // règle du fil principal : 24 / 0,5 = 48 ms ; fil dédié : 24 / 0,8 = 30 → 2 battements
    expect(c.intervalle()).toBeCloseTo(2 * BATTEMENT, 5)
  })
})

describe('la cadence au repos (conv-337)', () => {
  const compter = (hz: number, secondes: number, auRepos: (t: number) => boolean): number => {
    const c = creerCadence()
    let n = 0
    for (const b of battements(hz, secondes)) {
      c.repos(auRepos(b))
      if (c.doitDessiner(b)) n++
    }
    return n
  }

  it('au repos, 15 images/s sur tous les écrans ; hors repos, 30', () => {
    for (const hz of [60, 120, 144]) {
      expect(Math.abs(compter(hz, 10, () => true) / 10 - IMAGES_PAR_SECONDE_REPOS)).toBeLessThan(1)
      expect(Math.abs(compter(hz, 10, () => false) / 10 - 30)).toBeLessThan(1)
    }
  })

  it('le premier geste ramène la cadence visée tout de suite, sans finir un intervalle de repos', () => {
    const c = creerCadence()
    c.repos(true)
    expect(c.doitDessiner(0)).toBe(true)
    c.repos(false)
    // l'image suivante tombe un intervalle normal après la précédente (33 ms), pas 67 ms
    expect(c.doitDessiner(1000 / 30)).toBe(true)
  })

  it('repos = fenêtre sans le focus, ou aucun geste depuis REPOS_APRES_MS', () => {
    expect(estAuRepos(1000, 0, false)).toBe(true)
    expect(estAuRepos(REPOS_APRES_MS - 1, 0, true)).toBe(false)
    expect(estAuRepos(REPOS_APRES_MS, 0, true)).toBe(true)
    // assez long pour ne pas ralentir quelqu'un qui regarde l'Accueil un instant
    expect(REPOS_APRES_MS).toBeGreaterThanOrEqual(60_000)
  })
})
