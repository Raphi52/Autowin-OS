import { describe, expect, it } from 'vitest'
import type { LotDuPlan, PlanDeLots } from '../../../shared/plan-de-lots'
import {
  calculerFrise,
  DUREE_MIN_AXE_MS,
  LARGEUR_MIN_BLOC,
  lotsNonLus,
  ongletDuFil,
  planEnMouvement,
  repartirEnCouloirs,
  type BarreDeLot
} from './frise-des-lots'

const MIN = 60_000
const T0 = Date.UTC(2026, 9, 30, 13, 0)

function lot(rang: number, champs: Partial<LotDuPlan>): LotDuPlan {
  return { rang, titre: `Lot ${rang}`, demande: 'x', fichiers: [], etat: 'a-faire', ...champs }
}

function plan(lots: LotDuPlan[]): PlanDeLots {
  return {
    id: 'plan-1',
    chef: 'conv-1',
    cle: 'k',
    titre: 'Plan',
    parallele: 3,
    plafondTours: 10,
    toursLances: 4,
    statut: 'en-cours',
    avertissements: [],
    creeLe: T0,
    lots
  }
}

describe('calculerFrise', () => {
  it('rend null tant qu’aucun lot n’est parti', () => {
    expect(calculerFrise(plan([lot(1, {}), lot(2, {})]), T0)).toBeNull()
  })

  it('place chaque barre sur l’axe du premier départ à maintenant, et la ligne « maintenant »', () => {
    // Axe 13:00 → 13:30 : 1 min = 3,333 %.
    const p = plan([
      lot(1, { etat: 'fait', debut: T0, fin: T0 + 6 * MIN }),
      lot(2, { etat: 'echec', debut: T0, fin: T0 + 9 * MIN }),
      lot(3, { etat: 'en-cours', debut: T0 + 9 * MIN }),
      lot(4, { etat: 'a-faire', apres: [3] })
    ])
    const frise = calculerFrise(p, T0 + 30 * MIN)
    expect(frise).not.toBeNull()
    if (!frise) return
    expect(frise.debut).toBe(T0)
    expect(frise.fin).toBe(T0 + 30 * MIN)
    expect(frise.maintenant).toBe(100)
    expect(frise.barres.get(1)).toMatchObject({ gauche: 0, largeur: 20 })
    expect(frise.barres.get(2)?.largeur).toBeCloseTo(30)
    expect(frise.barres.get(3)?.gauche).toBeCloseTo(30)
    expect(frise.barres.get(3)?.largeur).toBeCloseTo(70)
    expect(frise.barres.has(4)).toBe(false)
    expect(frise.graduations.map((g) => g.ms)).toEqual([
      T0,
      T0 + 10 * MIN,
      T0 + 20 * MIN,
      T0 + 30 * MIN
    ])
    expect(frise.ecoule).toBe(30 * MIN)
  })

  it('arrête l’axe à la dernière fin quand plus rien ne tourne, sans ligne « maintenant »', () => {
    const p = plan([
      lot(1, { etat: 'fait', debut: T0, fin: T0 + 10 * MIN }),
      lot(2, { etat: 'fait', debut: T0 + 2 * MIN, fin: T0 + 20 * MIN })
    ])
    const frise = calculerFrise(p, T0 + 90 * MIN)
    expect(frise?.fin).toBe(T0 + 20 * MIN)
    expect(frise?.maintenant).toBeUndefined()
    expect(frise?.ecoule).toBe(20 * MIN)
    expect(frise?.barres.get(2)?.gauche).toBeCloseTo(10)
  })

  it('laisse au dernier lot parti la place de son bloc, sans l’écraser contre le précédent', () => {
    // Capture conv-1393 : après 12 h 40 de plan, le lot parti derrière un lot fini d'une heure
    // n'avait plus que 0,3 % de l'axe, son texte écrasé en « 1… ». L'axe passe au-delà de maintenant.
    const p = plan([
      lot(1, { etat: 'fait', debut: T0, fin: T0 + 700 * MIN }),
      lot(2, { etat: 'fait', debut: T0 + 700 * MIN, fin: T0 + 760 * MIN }),
      lot(3, { etat: 'en-cours', debut: T0 + 760 * MIN })
    ])
    const frise = calculerFrise(p, T0 + 762 * MIN)
    if (!frise) throw new Error('frise attendue')
    const bloc3 = repartirEnCouloirs(frise.barres.values())
      .flat()
      .find((b) => b.rang === 3)
    expect(bloc3?.largeur).toBeGreaterThanOrEqual(LARGEUR_MIN_BLOC - 1e-9)
    // Il part à sa vraie heure, au lieu de reculer sur le lot 2.
    expect(bloc3?.gauche).toBeCloseTo(frise.barres.get(3)?.gauche ?? -1)
    expect(frise.maintenant).toBeLessThan(100)
    expect(frise.ecoule).toBe(762 * MIN)
  })

  it('garde un axe de 5 minutes au moins et une barre visible pour un lot très court', () => {
    const p = plan([lot(1, { etat: 'fait', debut: T0, fin: T0 + 1000 })])
    const frise = calculerFrise(p, T0 + 2000)
    expect(frise ? frise.fin - frise.debut : 0).toBe(DUREE_MIN_AXE_MS)
    expect(frise?.barres.get(1)?.largeur).toBeGreaterThanOrEqual(0.8)
  })
})

describe('repartirEnCouloirs', () => {
  const barre = (rang: number, gauche: number, largeur: number): BarreDeLot => ({
    rang,
    etat: 'fait',
    gauche,
    largeur
  })
  const rangs = (couloirs: BarreDeLot[][]): number[][] => couloirs.map((c) => c.map((b) => b.rang))

  it('fait suivre dans un même couloir les lots qui s’enchaînent, comme sur le vrai plan', () => {
    // Trois lots partent ensemble ; le 4 prend la place du 1, le 5 et le 7 celle du 3.
    const couloirs = repartirEnCouloirs([
      barre(1, 0, 28),
      barre(2, 0, 100),
      barre(3, 0, 29),
      barre(4, 28, 66),
      barre(5, 29, 24),
      barre(7, 53, 47)
    ])
    expect(rangs(couloirs)).toEqual([[1, 4], [2], [3, 5, 7]])
  })

  it('ne pose jamais deux lots qui se chevauchent dans le même couloir', () => {
    const couloirs = repartirEnCouloirs([barre(1, 0, 40), barre(2, 10, 40), barre(3, 20, 40)])
    expect(rangs(couloirs)).toEqual([[1], [2], [3]])
  })

  it('range d’abord le premier parti, quel que soit l’ordre reçu', () => {
    const couloirs = repartirEnCouloirs([barre(2, 50, 10), barre(1, 0, 10)])
    expect(rangs(couloirs)).toEqual([[1, 2]])
  })

  it('accepte deux lots collés malgré l’arrondi des pourcentages', () => {
    const couloirs = repartirEnCouloirs([barre(1, 0, 33.33333333), barre(2, 33.33333332, 20)])
    expect(rangs(couloirs)).toEqual([[1, 2]])
  })

  it('garde autant de couloirs que de lots tournant ensemble, même sur un plan très long', () => {
    // Le vrai plan après 1 h 27 : les lots courts du début pèsent 3,6 % de l'axe. Réserver leur largeur
    // minimale dans le couloir montait à 5 lignes, pour 3 lots au plus en même temps (conv-1376).
    const couloirs = repartirEnCouloirs([
      barre(1, 0, 3.6),
      barre(2, 0, 21.8),
      barre(3, 0, 3.7),
      barre(4, 3.6, 8.9),
      barre(5, 3.7, 94),
      barre(6, 22, 78),
      barre(7, 12.5, 9),
      barre(8, 98, 2)
    ])
    expect(rangs(couloirs)).toEqual([
      [1, 4, 7, 6],
      [2, 8],
      [3, 5]
    ])
  })

  it('donne une largeur lisible à un lot très court quand la place est libre', () => {
    const [[bloc]] = repartirEnCouloirs([barre(1, 10, 0.8)])
    expect(bloc).toMatchObject({ gauche: 10, largeur: LARGEUR_MIN_BLOC })
  })

  it('ne laisse jamais un bloc court déborder sur le lot suivant de son couloir', () => {
    const couloirs = repartirEnCouloirs([barre(1, 10, 0.8), barre(2, 12, 30)])
    expect(rangs(couloirs)).toEqual([[1, 2]])
    expect(couloirs[0][0]).toMatchObject({ gauche: 10, largeur: 2 })
    expect(couloirs[0][1]).toMatchObject({ gauche: 12, largeur: 30 })
  })

  it('garde entier sur l’axe un lot qui vient de partir, au lieu d’un trait au bout', () => {
    const [[bloc]] = repartirEnCouloirs([barre(1, 99.5, 0.5)])
    expect(bloc.largeur).toBe(LARGEUR_MIN_BLOC)
    expect(bloc.gauche + bloc.largeur).toBeCloseTo(100)
  })

  it('ne recule pas un lot qui vient de partir jusque sur le précédent', () => {
    const couloirs = repartirEnCouloirs([barre(1, 0, 97), barre(2, 98, 2)])
    expect(rangs(couloirs)).toEqual([[1, 2]])
    expect(couloirs[0][1].gauche).toBe(97)
    expect(couloirs[0][1].gauche + couloirs[0][1].largeur).toBeCloseTo(100)
  })

  it('rend zéro couloir quand aucun lot n’est parti', () => {
    expect(repartirEnCouloirs([])).toEqual([])
  })
})

describe('lotsNonLus', () => {
  it('dore les lots finis après l’ouverture de la case, sauf l’onglet ouvert et ceux déjà vus', () => {
    const p = plan([
      lot(1, { etat: 'fait', debut: T0, fin: T0 + MIN }),
      lot(2, { etat: 'fait', debut: T0, fin: T0 + 5 * MIN }),
      lot(3, { etat: 'echec', debut: T0, fin: T0 + 6 * MIN }),
      lot(4, { etat: 'fait', debut: T0, fin: T0 + 7 * MIN }),
      lot(5, { etat: 'en-cours', debut: T0 })
    ])
    const nonLus = lotsNonLus(p, { 3: T0 + 6 * MIN }, T0 + 2 * MIN, 4)
    expect([...nonLus]).toEqual([2])
  })
})

describe('ongletDuFil', () => {
  it('le chef, le rang d’un lot, ou rien pour un fil que le plan ne connaît pas', () => {
    const p = { ...plan([lot(1, { fil: 'conv-l1' }), lot(2, {})]), chef: 'conv-c' }
    expect(ongletDuFil(p, 'conv-c')).toBe('chef')
    expect(ongletDuFil(p, 'conv-l1')).toBe(1)
    expect(ongletDuFil(p, 'conv-ancien-plan')).toBeNull()
  })
})

describe('planEnMouvement', () => {
  it('ne fait avancer l’horloge que si un lot tourne', () => {
    expect(planEnMouvement(plan([lot(1, { etat: 'en-cours', debut: T0 })]))).toBe(true)
    expect(planEnMouvement(plan([lot(1, { etat: 'fait', debut: T0, fin: T0 + MIN })]))).toBe(false)
    expect(planEnMouvement(null)).toBe(false)
  })
})
