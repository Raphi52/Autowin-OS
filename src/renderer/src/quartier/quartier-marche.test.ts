import { describe, expect, it } from 'vitest'
import donnees from '../assets/quartier/donnees.json'
import {
  creerMarche,
  ENTREE,
  LEVITE_APRES_S,
  SEJOUR_MIN_S,
  type Consigne,
  type DonneesMarche,
  type MetierPoste
} from './quartier-marche'

const D = donnees as unknown as DonneesMarche
const IMAGE = 1 / 30

/** Un générateur reproductible : une marche qui échoue doit échouer de la même façon au relancement. */
function graine(n: number): () => number {
  let g = n
  return () => {
    g = (g * 16807) % 2147483647
    return (g & 0xfffffff) / 0x10000000
  }
}

const travail = (metier: MetierPoste): Consigne => ({ metier, pose: '', partir: false })

describe('la carte de la Falaise', () => {
  const m = creerMarche(D, graine(5))

  it('relie tous les postes entre eux', () => {
    const P = D.postes
    for (let i = 0; i < P.length; i++)
      for (let j = 0; j < P.length; j++) {
        if (i === j) continue
        const c = m.chemin([P[i].x, P[i].y], [P[j].x, P[j].y], null, true)
        const f = c[c.length - 1]
        expect(Math.hypot(f[0] - P[j].x, f[1] - P[j].y), `${i} vers ${j}`).toBeLessThan(10)
      }
  }, 30_000)

  it('pose chaque poste et l’entrée sur le sol', () => {
    for (const p of D.postes) expect(m.taille(p.x, p.y), `${p.x},${p.y}`).toBeGreaterThan(0)
    expect(m.libre(ENTREE[0], ENTREE[1])).toBe(true)
  })

  it('a au moins un poste par métier demandé', () => {
    const metiers = new Set(D.postes.map((p) => p.me))
    for (const me of [
      'commandes',
      'runs',
      'lire',
      'chercher',
      'brain',
      'web',
      'modifier',
      'tester',
      'ecran',
      'publier',
      'tickets',
      'messages',
      'taches',
      'sql',
      'bain',
      'pause'
    ])
      expect(metiers.has(me), me).toBe(true)
  })

  it('offre plusieurs activités de pause, chacune avec son animation', () => {
    const pauses = D.postes.filter((p) => p.me === 'pause')
    const gestes = new Set(pauses.map((p) => p.g))
    expect(gestes.size).toBeGreaterThanOrEqual(6)
    for (const g of gestes) expect(D.gestes?.[g], g).toBeDefined()
  })

  // fix-ok: ces deux tests cherchaient les escaliers P et B1, absents de D.esc (A à E) depuis le lot 1 (conv-1458).
  /**
   * La Falaise o-1916 n'a plus de passerelle entre le hangar et la bibliothèque : on descend du hangar
   * au sable par l'escalier A, puis on remonte par B. Un trou dans la grille le long du rocher ferait
   * monter le tanuki droit dans la falaise, sans escalier (conv-1459).
   */
  it('va du hangar à la bibliothèque par le sable : escalier A, puis escalier B', () => {
    const P = D.postes
    const c = m.chemin([P[5].x, P[5].y], [P[8].x, P[8].y], null, true)
    const pris = c.flatMap((q) => (q.e !== undefined && q.e >= 0 ? [D.esc[q.e].nom] : []))
    expect([...new Set(pris)]).toEqual(['A', 'B'])
  })
})

describe('un tanuki suit son agent', () => {
  it('entre par le sable et attend sa première action (D14)', () => {
    const m = creerMarche(D, graine(5))
    const w = m.ajouter('a', { metier: null, pose: '', partir: false })
    for (let i = 0; i < 90; i++) m.avance(IMAGE)
    expect(w.etat).toBe('attend')
    expect(m.libre(w.x, w.y)).toBe(true)
  })

  it('va au poste du métier réel et y travaille', () => {
    const m = creerMarche(D, graine(5))
    const w = m.ajouter('a', travail('lire'))
    for (let i = 0; i < 30 * 120 && w.etat !== 'poste'; i++) m.avance(IMAGE)
    expect(w.etat).toBe('poste')
    expect(w.metierIci).toBe('lire')
    expect(D.postes[w.poste as number].me).toBe('lire')
  })

  it('ne change pas de poste pour une action courte (D15)', () => {
    const m = creerMarche(D, graine(5))
    const w = m.ajouter('a', travail('commandes'))
    for (let i = 0; i < 30 * 120 && w.etat !== 'poste'; i++) m.avance(IMAGE)
    w.consigne = travail('lire')
    for (let i = 0; i < 30 * (SEJOUR_MIN_S - 2); i++) m.avance(IMAGE)
    expect(w.metierIci).toBe('commandes')
    expect(w.etat).toBe('poste')
    for (let i = 0; i < 30 * 4; i++) m.avance(IMAGE)
    expect(w.etat).toBe('va')
  })

  it('prend la pose de l’état réel, là où il est', () => {
    const m = creerMarche(D, graine(5))
    const w = m.ajouter('a', travail('modifier'))
    for (let i = 0; i < 30 * 120 && w.etat !== 'poste'; i++) m.avance(IMAGE)
    w.consigne = { metier: null, pose: 'at', partir: false }
    m.avance(IMAGE)
    expect(w).toMatchObject({ etat: 'etat', nom: 'at', metierIci: 'modifier' })
    w.consigne = { metier: null, pose: '', partir: false }
    m.avance(IMAGE)
    expect(w).toMatchObject({ etat: 'poste', nom: '' })
  })

  const fini: Consigne = { metier: 'bain', pose: 'ba', partir: false }
  const pause: Consigne = { metier: 'pause', pose: '', partir: false }
  /** Il est arrivé quelque part et s'y tient : à une activité, à une place libre, ou dans une pose. */
  const pose = (w: { etat: string }): boolean =>
    w.etat === 'poste' || w.etat === 'etat' || w.etat === 'attend'

  /**
   * Les places de bain : celles du grand onsen, qui a remplacé les trois baquets, puis la machine et le
   * tabouret (conv-1434).
   */
  const BAINS = D.postes.filter((p) => p.me === 'bain')
  /**
   * L'eau de l'onsen de la Falaise o-1916 (conv-1459), relevée sur la peinture un peu en retrait de ses pierres :
   * le fond sous les galets, la gauche contre le rocher et la barrière, la droite contre le tas de galets.
   */
  const ONSEN: [number, number][] = [
    [204, 706],
    [216, 700],
    [232, 699],
    [262, 696],
    [300, 694],
    [345, 692],
    [400, 692],
    [405, 703],
    [430, 705],
    [468, 707],
    [480, 714],
    [498, 722],
    [502, 738],
    [506, 748],
    [496, 758],
    [494, 768],
    [300, 768],
    [246, 754],
    [222, 748],
    [203, 740],
    [199, 726]
  ]

  it("descend au bain quand il a fini, et prend une pause si l'onsen est plein", () => {
    const m = creerMarche(D, graine(5))
    const liste = Array.from({ length: BAINS.length + 1 }, (_, i) => m.ajouter(`a${i}`, fini))
    for (let i = 0; i < 30 * 200 && liste.some((w) => w.metierIci === null || w.etat === 'va'); i++)
      m.avance(IMAGE)
    for (let i = 0; i < 30; i++) m.avance(IMAGE)
    expect(liste.filter((w) => w.nom === 'ba')).toHaveLength(BAINS.length)
    const autre = liste.find((w) => w.nom !== 'ba')
    expect(autre?.metierIci).toBe('pause')
  })

  // conv-1558 : content au bain, puis endormi — le même bain, il ne se relève pas pour changer de visage.
  it("s'endort dans son bain sans en sortir", () => {
    const m = creerMarche(D, graine(5))
    const w = m.ajouter('a', fini)
    for (let i = 0; i < 30 * 200 && (w.metierIci === null || w.etat === 'va'); i++) m.avance(IMAGE)
    for (let i = 0; i < 30; i++) m.avance(IMAGE)
    expect(w).toMatchObject({ etat: 'etat', nom: 'ba', metierIci: 'bain' })
    const place = w.poste
    w.consigne = { metier: 'bain', pose: 'bz', partir: false }
    for (let i = 0; i < 30; i++) m.avance(IMAGE)
    expect(w).toMatchObject({ etat: 'etat', nom: 'bz', metierIci: 'bain', poste: place })
  })

  it('le grand onsen offre dix places, toutes dans son eau (conv-1434)', () => {
    expect(BAINS).toHaveLength(10)
    const m = creerMarche(D, graine(7))
    for (const p of BAINS) {
      // Le corps s'enfonce dans l'eau jusqu'aux épaules : tout ce qui passe sous le rebord (cl) est caché,
      // et ce rebord tombe dans le bassin.
      expect(p.y - (p.cl as number)).toBeGreaterThanOrEqual(20)
      expect(m.dans(ONSEN, p.x, p.cl as number), `${p.x},${p.cl}`).toBe(true)
    }
    // Toutes les places sont dans l'onsen, entre son rocher de gauche et ses galets de droite.
    expect(BAINS.every((p) => p.x >= 199 && p.x <= 506)).toBe(true)
    const liste = Array.from({ length: 10 }, (_, i) => m.ajouter(`a${i}`, fini))
    for (let i = 0; i < 30 * 300 && liste.some((w) => w.metierIci === null || w.etat === 'va'); i++)
      m.avance(IMAGE)
    for (let i = 0; i < 30; i++) m.avance(IMAGE)
    expect(liste.filter((w) => w.nom === 'ba')).toHaveLength(10)
  })

  it("les baigneurs s'adossent aux bords de l'onsen, le milieu reste libre (conv-1447)", () => {
    // Demande : « les tanukis doivent se mettre sur les bords du onsen, pas alignés en plein milieu ».
    const bord = (x: number, y: number): number => {
      let d = 1e9
      for (let i = 0, j = ONSEN.length - 1; i < ONSEN.length; j = i++) {
        const [ax, ay] = ONSEN[j]
        const [bx, by] = ONSEN[i]
        const l2 = (bx - ax) ** 2 + (by - ay) ** 2
        const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / l2))
        d = Math.min(d, Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay)))
      }
      return d
    }
    // La ligne d'eau de chaque baigneur (là où son corps sort de l'eau) longe la berge.
    for (const p of BAINS) expect(bord(p.x, p.cl as number), `${p.x},${p.cl}`).toBeLessThan(12)
    // Personne au milieu du bassin.
    expect(BAINS.filter((p) => p.x > 250 && p.x < 460 && (p.cl as number) > 713)).toEqual([])
    // Ils font le tour : le fond, la gauche et la droite ont chacun leurs baigneurs. La barrière de devant coupe
    // le bord gauche de l'eau à mi-hauteur (conv-1459) : la gauche compte aussi le coin du fond.
    const fond = BAINS.filter((p) => p.x >= 235 && p.x <= 455 && (p.cl as number) < 713)
    const gauche = BAINS.filter((p) => p.x < 235)
    const droite = BAINS.filter((p) => p.x > 455)
    expect(fond.length).toBeGreaterThanOrEqual(4)
    expect(gauche.length).toBeGreaterThanOrEqual(2)
    expect(droite.length).toBeGreaterThanOrEqual(2)
  })

  it("aucun poste de travail ni de pause n'est dans l'eau de l'onsen (conv-1434)", () => {
    const m = creerMarche(D, graine(7))
    for (const p of D.postes.filter((q) => q.me !== 'bain'))
      expect(m.dans(ONSEN, p.x, p.y), `${p.me} ${p.x},${p.y}`).toBe(false)
  })

  /**
   * Sur la Falaise o-1916, l'onsen s'étend au pied du tunnel des commandes : c'est le trajet vers les
   * commandes, depuis un escalier ou l'entrée, qui couperait par l'eau. Mesuré en rendant marchables le
   * bain et ses pierres : 15 trajets y passaient, et aucun entre deux escaliers (conv-1434, conv-1459).
   */
  it("personne ne traverse l'onsen pour aller d'un escalier ou de l'entrée aux commandes", () => {
    const m = creerMarche(D, graine(5))
    const departs = [...D.esc.map((e) => e.a as number[]), [ENTREE[0], ENTREE[1]]]
    const commandes = D.postes.filter((p) => p.me === 'commandes').map((p) => [p.x, p.y])
    expect(commandes.length).toBeGreaterThan(0)
    const trajets = departs.flatMap((d) => commandes.map((q) => [d, q]))
    for (const [a, b] of [...trajets, ...trajets.map(([d, q]) => [q, d])]) {
      const c = m.chemin(a, b, null)
      expect(c.length).toBeGreaterThan(1)
      for (let k = 1; k < c.length; k++)
        for (let t = 0; t <= 1; t += 0.05) {
          const X = c[k - 1][0] + (c[k][0] - c[k - 1][0]) * t
          const Y = c[k - 1][1] + (c[k][1] - c[k - 1][1]) * t
          expect(m.dans(ONSEN, X, Y), `${X.toFixed(0)},${Y.toFixed(0)}`).toBe(false)
        }
    }
  })

  /**
   * Demande (conv-1550) : « les personnages marchent sur l'eau, ils doivent marcher au bord du bassin pour
   * aller se mettre dans leur spot dans l'eau ». Mesuré avant correction : la grille gardait une bande d'eau
   * marchable le long des pierres, et les baigneurs y faisaient le tour du bassin.
   */
  describe("l'eau de l'onsen n'est pas un chemin (conv-1550)", () => {
    const EAU = D.bassin ?? []
    /** Dans l'eau, et pas seulement en frôlant son bord entre deux cases du rebord. */
    const mouille = (m: ReturnType<typeof creerMarche>, X: number, Y: number): boolean => {
      if (!m.dans(EAU, X, Y)) return false
      for (let i = 0, j = EAU.length - 1; i < EAU.length; j = i++) {
        const [ax, ay] = EAU[j]
        const [bx, by] = EAU[i]
        const l2 = (bx - ax) ** 2 + (by - ay) ** 2
        const t = Math.max(0, Math.min(1, ((X - ax) * (bx - ax) + (Y - ay) * (by - ay)) / l2))
        if (Math.hypot(X - ax - t * (bx - ax), Y - ay - t * (by - ay)) < 3) return false
      }
      return true
    }

    it("a l'eau relevée, et chaque baigneur y a sa ligne d'eau", () => {
      expect(EAU.length).toBeGreaterThan(8)
      const m = creerMarche(D, graine(5))
      for (const p of BAINS) expect(m.dans(EAU, p.x, p.cl as number), `${p.x},${p.cl}`).toBe(true)
    })

    it("aucun trajet ne passe par l'eau, sauf le dernier pas qui entre à sa place", () => {
      const m = creerMarche(D, graine(5))
      const departs = [
        [ENTREE[0], ENTREE[1]],
        ...D.esc.map((e) => e.a as number[]),
        ...D.postes.map((p) => [p.x, p.y])
      ]
      for (const b of BAINS)
        for (const a of departs) {
          if (a[0] === b.x && a[1] === b.y) continue
          const c = m.chemin(a, [b.x, b.y], null, true)
          // Le pas qui entre dans l'eau n'existe que si la place est dans l'eau.
          const fin = m.dans(EAU, b.x, b.y) ? c.length - 1 : c.length
          for (let k = 1; k < fin; k++)
            for (let t = 0; t <= 1; t += 0.05) {
              const X = c[k - 1][0] + (c[k][0] - c[k - 1][0]) * t
              const Y = c[k - 1][1] + (c[k][1] - c[k - 1][1]) * t
              expect(
                mouille(m, X, Y),
                `${a} vers ${b.x},${b.y} : ${X.toFixed(0)},${Y.toFixed(0)}`
              ).toBe(false)
            }
          const f = c[c.length - 1]
          expect(Math.hypot(f[0] - b.x, f[1] - b.y), `${a} vers ${b.x},${b.y}`).toBeLessThan(10)
        }
    }, 30_000)

    it('le baigneur longe le bord, entre dans l’eau à sa place et en ressort par le bord le plus proche', () => {
      const m = creerMarche(D, graine(5))
      const liste = Array.from({ length: BAINS.length }, (_, i) => m.ajouter(`a${i}`, fini))
      const nage = new Map(liste.map((w) => [w, 0]))
      const avance = (): void => {
        const avant = liste.map((w) => [w.x, w.y])
        m.avance(IMAGE)
        liste.forEach((w, k) => {
          if (mouille(m, w.x, w.y) || mouille(m, avant[k][0], avant[k][1]))
            nage.set(w, (nage.get(w) as number) + Math.hypot(w.x - avant[k][0], w.y - avant[k][1]))
        })
      }
      for (
        let i = 0;
        i < 30 * 300 && liste.some((w) => w.metierIci === null || w.etat === 'va');
        i++
      )
        avance()
      // Le dernier arrivé s'assied à l'image suivante.
      for (let i = 0; i < 30; i++) avance()
      expect(liste.filter((w) => w.nom === 'ba')).toHaveLength(BAINS.length)
      // Du rebord à la place la plus loin de la berge : un seul pas d'une cinquantaine de pixels.
      for (const w of liste) expect(nage.get(w), `${w.id} pour entrer`).toBeLessThan(60)
      for (const w of liste) {
        nage.set(w, 0)
        w.consigne = travail('lire')
      }
      // Au bain depuis plus de SEJOUR_MIN_S : chacun se lève et sort de l'eau.
      for (let i = 0; i < 30 * (SEJOUR_MIN_S + 20); i++) avance()
      for (const w of liste) {
        expect(w.nom, `${w.id} est resté au bain`).not.toBe('ba')
        expect(mouille(m, w.x, w.y), `${w.id} est resté dans l'eau`).toBe(false)
        expect(nage.get(w), `${w.id} pour sortir`).toBeLessThan(60)
      }
    }, 60_000)
  })

  it("ne laisse personne en tas quand l'onsen est plein", () => {
    const m = creerMarche(D, graine(5))
    const liste = Array.from({ length: 12 }, (_, i) => m.ajouter(`a${i}`, fini))
    for (let i = 0; i < 30 * 300 && liste.some((w) => w.metierIci === null || w.etat === 'va'); i++)
      m.avance(IMAGE)
    const arretes = liste.filter((w) => w.etat !== 'va')
    for (const w of arretes)
      for (const o of arretes)
        if (o !== w)
          expect(Math.hypot(o.x - w.x, (o.y - w.y) / D.sp), `${w.id} ${o.id}`).toBeGreaterThan(8)
  })

  it('part en pause quand il réfléchit, à une activité de la famille pause', () => {
    const m = creerMarche(D, graine(5))
    const w = m.ajouter('a', pause)
    for (let i = 0; i < 30 * 120 && !(pose(w) && w.metierIci === 'pause'); i++) m.avance(IMAGE)
    expect(w.metierIci).toBe('pause')
    if (w.poste !== null) expect(D.postes[w.poste].me).toBe('pause')
  })

  it('répartit huit tanukis en pause sur au moins cinq activités différentes', () => {
    const m = creerMarche(D, graine(11))
    const liste = Array.from({ length: 8 }, (_, i) => m.ajouter(`a${i}`, pause))
    const vus = new Set<string>()
    for (let i = 0; i < 30 * 240; i++) {
      m.avance(IMAGE)
      for (const w of liste)
        if (w.etat === 'poste' && w.poste !== null) vus.add(D.postes[w.poste].g)
    }
    expect(vus.size).toBeGreaterThanOrEqual(5)
  }, 60_000)

  it('change d’activité au bout d’un moment, sans revenir à la même', () => {
    const m = creerMarche(D, graine(3))
    const w = m.ajouter('a', pause)
    const suite: string[] = []
    for (let i = 0; i < 30 * 600; i++) {
      m.avance(IMAGE)
      const g = w.etat === 'poste' && w.poste !== null ? D.postes[w.poste].g : ''
      if (g && suite[suite.length - 1] !== g) suite.push(g)
    }
    expect(suite.length).toBeGreaterThanOrEqual(3)
    for (let k = 1; k < suite.length; k++) expect(suite[k]).not.toBe(suite[k - 1])
  }, 60_000)

  it('s’assied à la méditation : il se tourne, s’assied, puis se relève avant de partir', () => {
    const m = creerMarche(D, graine(5))
    const w = m.ajouter('a', pause)
    const siege = D.postes.findIndex((p) => p.me === 'pause' && p.g === 'me')
    // Toutes les autres places sont prises : il ne reste que ce coussin.
    D.postes.forEach((p, i) => {
      if (p.me === 'pause' && i !== siege) m.ajouter(`x${i}`, { metier: null, pose: '', partir: false }).poste = i
    })
    const etats = new Set<string>()
    for (let i = 0; i < 30 * 200 && !(w.etat === 'poste' && w.th > 3); i++) {
      m.avance(IMAGE)
      etats.add(w.etat)
    }
    expect(w.poste).toBe(siege)
    expect(etats.has('tourne')).toBe(true)
    w.consigne = travail('lire')
    for (let i = 0; i < 30 * (SEJOUR_MIN_S + 1) && w.etat !== 'leve'; i++) m.avance(IMAGE)
    expect(w.etat).toBe('leve')
    for (let i = 0; i < 30 * 3; i++) m.avance(IMAGE)
    expect(w.etat).toBe('va')
  })

  it('lévite un peu quand la méditation dure, et retombe en se relevant', () => {
    const m = creerMarche(D, graine(5))
    const w = m.ajouter('a', pause)
    const siege = D.postes.findIndex((p) => p.me === 'pause' && p.g === 'me')
    D.postes.forEach((p, i) => {
      if (p.me === 'pause' && i !== siege) m.ajouter(`x${i}`, { metier: null, pose: '', partir: false }).poste = i
    })
    for (let i = 0; i < 30 * 200 && !(w.etat === 'poste' && w.poste === siege); i++) m.avance(IMAGE)
    for (let i = 0; i < 30 * (LEVITE_APRES_S + 10); i++) m.avance(IMAGE)
    expect(w.lev).toBeGreaterThan(1)
    w.consigne = travail('lire')
    for (let i = 0; i < 30 * (SEJOUR_MIN_S + 3) && w.etat !== 'va'; i++) m.avance(IMAGE)
    expect(w.lev).toBe(0)
  })

  it('ne quitte pas son poste de travail pour une courte pause (D15)', () => {
    const m = creerMarche(D, graine(5))
    const w = m.ajouter('a', travail('commandes'))
    for (let i = 0; i < 30 * 120 && w.etat !== 'poste'; i++) m.avance(IMAGE)
    w.consigne = pause
    for (let i = 0; i < 30 * 2; i++) m.avance(IMAGE)
    expect(w).toMatchObject({ etat: 'poste', nom: '', metierIci: 'commandes' })
    for (let i = 0; i < 30 * (SEJOUR_MIN_S + 2); i++) m.avance(IMAGE)
    expect(w.etat).toBe('va')
  })

  it('reprend le travail dès que son agent repart', () => {
    const m = creerMarche(D, graine(5))
    const w = m.ajouter('a', pause)
    for (let i = 0; i < 30 * 120 && !(pose(w) && w.metierIci === 'pause'); i++) m.avance(IMAGE)
    w.consigne = travail('lire')
    for (let i = 0; i < 30 * 200 && w.metierIci !== 'lire'; i++) m.avance(IMAGE)
    expect(w).toMatchObject({ metierIci: 'lire', nom: '' })
  })

  it('repart par l’entrée et quitte la scène', () => {
    const m = creerMarche(D, graine(5))
    const w = m.ajouter('a', { metier: null, pose: '', partir: false })
    m.avance(IMAGE)
    w.consigne = { metier: null, pose: '', partir: true }
    for (let i = 0; i < 30 * 120 && m.T.length > 0; i++) m.avance(IMAGE)
    expect(m.T).toHaveLength(0)
  })
})

describe('dix minutes avec huit agents réalistes', () => {
  it('ne sort jamais du sol, ne se croise jamais dans une volée, et tout le monde avance', () => {
    const alea = graine(7)
    const m = creerMarche(D, alea)
    const metiers: MetierPoste[] = [
      'commandes',
      'commandes',
      'runs',
      'lire',
      'lire',
      'chercher',
      'modifier',
      'tester',
      'ecran',
      'web',
      'brain',
      'publier',
      'messages',
      // Réfléchir longtemps : 42 % du temps d'un tour (conv-1428).
      'pause',
      'pause',
      'pause'
    ]
    const liste = Array.from({ length: 8 }, (_, i) => m.ajouter(`a${i}`, travail('lire')))
    let dehors = 0
    let croisements = 0
    let saut = 0
    for (let i = 0; i < 30 * 600; i++) {
      // Un agent change d'outil toutes les 25 s en moyenne : la cadence mesurée sur ce poste.
      for (const w of liste)
        if (alea() < IMAGE / 25) w.consigne = travail(metiers[Math.floor(alea() * metiers.length)])
      const avant = liste.map((w) => [w.x, w.y])
      m.avance(IMAGE)
      liste.forEach((w, k) => {
        if (!m.libre(w.x, w.y)) dehors++
        saut = Math.max(saut, Math.hypot(w.x - avant[k][0], w.y - avant[k][1]))
        for (const o of liste)
          if (o !== w && w.sur >= 0 && o.sur === w.sur && o.sens !== w.sens) croisements++
      })
    }
    expect(dehors).toBe(0)
    expect(croisements).toBe(0)
    expect(saut).toBeLessThan(4)
    for (const w of liste) expect(w.nb, w.id).toBeGreaterThan(4)
  }, 60_000)
})
