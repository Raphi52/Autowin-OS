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
  const c = creerCadence(30)
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
    // conv-1643 : régulier d'abord. 30 images/s pile n'existe qu'en alternant les écarts là où 30
    // ne divise pas la fréquence (75 Hz : 2 puis 3 battements) — l'à-coup qu'on corrige. On exige
    // donc le nombre entier de battements le plus proche : au plus un demi-battement d'écart.
    for (const hz of [60, 66.2, 75, 120, 144, 165, 240]) {
      const ips = imagesParSeconde(hz)
      expect(Math.abs(hz / ips - hz / 30), `${hz} Hz : ${ips} images/s`).toBeLessThanOrEqual(0.51)
    }
    for (const hz of [60, 120, 240]) expect(imagesParSeconde(hz), `${hz} Hz`).toBeCloseTo(30, 0)
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
    const c = creerCadence(30)
    expect(c.doitDessiner(0)).toBe(true)
    expect(c.doitDessiner(33.4)).toBe(true)
    expect(c.doitDessiner(10_000)).toBe(true)
    expect(c.doitDessiner(10_016.7)).toBe(false)
    expect(c.doitDessiner(10_033.4)).toBe(true)
  })
})

/**
 * conv-1643, « quand je clique sur un élément de l'accueil et que ça zoome dessus, ça fait saccadé ».
 * Mesuré sur le poste de l'utilisateur : il regarde l'app par le Bureau à distance, dont l'écran
 * virtuel bat toutes les 15,1 ms (66 Hz). La cadence visait 16,7 ms : elle sautait un battement sur
 * dix environ, un trou de 30 ms six fois par seconde — invisible au repos, net pendant un zoom.
 */
describe('une cadence RÉGULIÈRE sur tout écran (conv-1643)', () => {
  /** Les écarts entre deux images dessinées, en battements d'écran, une fois le battement appris. */
  const ecartsEnBattements = (hz: number, cible?: number): number[] => {
    const c = cible === undefined ? creerCadence() : creerCadence(cible)
    const dessinees: number[] = []
    battements(hz, 5).forEach((b, i) => {
      if (c.doitDessiner(b)) dessinees.push(i)
    })
    return dessinees
      .slice(1)
      .map((v, i) => v - dessinees[i])
      .slice(5)
  }

  it('Bureau à distance, 66 Hz (15,1 ms mesurés chez l utilisateur) : une image à CHAQUE battement', () => {
    expect([...new Set(ecartsEnBattements(1000 / 15.1))]).toEqual([1])
  })

  it('quel que soit l écran, les images tombent à intervalle constant (pas d accordéon 1-2 ou 2-3)', () => {
    for (const hz of [50, 60, 66.2, 75, 90, 100, 120, 144, 165, 240]) {
      expect(new Set(ecartsEnBattements(hz)).size, `${hz} Hz`).toBe(1)
      expect(new Set(ecartsEnBattements(hz, 30)).size, `${hz} Hz, cible 30`).toBe(1)
    }
  })
})

describe('la cadence d un décor dessiné dans son propre fil (conv-347)', () => {
  const BATTEMENT = 1000 / 60
  const palierApres = (couts: number[]): number => {
    const c = creerCadence(30)
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
    const c = creerCadence(30)
    for (let i = 0; i < 20; i++) c.noterCout(40, 'dedie') // 50 ms → 3 battements
    expect(c.intervalle()).toBeCloseTo(3 * BATTEMENT, 5)
    for (let i = 0; i < 20; i++) c.noterCout(26, 'dedie') // 32,5 ms : tout juste sous 33 → reste
    expect(c.intervalle()).toBeCloseTo(3 * BATTEMENT, 5)
    for (let i = 0; i < 20; i++) c.noterCout(18, 'dedie') // 22,5 ms : nettement dessous → 30 i/s
    expect(c.intervalle()).toBeCloseTo(2 * BATTEMENT, 5)
  })

  it('le coût d un fil dédié ne réclame pas la moitié de l interface : 30 ms ne divise pas la cadence par deux', () => {
    const c = creerCadence(30)
    for (let i = 0; i < 20; i++) c.noterCout(24, 'dedie')
    // règle du fil principal : 24 / 0,5 = 48 ms ; fil dédié : 24 / 0,8 = 30 → 2 battements
    expect(c.intervalle()).toBeCloseTo(2 * BATTEMENT, 5)
  })
})

describe('la cadence au repos (conv-337)', () => {
  it('plus de cadence réduite au repos (conv-1512) : 60 images/s, au repos comme hors repos', () => {
    const c = creerCadence()
    let n = 0
    for (const b of battements(60, 10)) {
      c.repos(true)
      if (c.doitDessiner(b)) n++
    }
    expect(IMAGES_PAR_SECONDE_REPOS).toBe(60)
    expect(Math.abs(n / 10 - 60)).toBeLessThan(1)
  })

  it('le premier geste ramène la cadence visée tout de suite, sans finir un intervalle de repos', () => {
    const c = creerCadence(30)
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
