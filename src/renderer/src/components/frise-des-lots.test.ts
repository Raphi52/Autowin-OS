import { describe, expect, it } from 'vitest'
import type { LotDuPlan, PlanDeLots } from '../../../shared/plan-de-lots'
import {
  calculerFrise,
  DUREE_MIN_AXE_MS,
  lotsNonLus,
  ongletDuFil,
  planEnMouvement
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

  it('garde un axe de 5 minutes au moins et une barre visible pour un lot très court', () => {
    const p = plan([lot(1, { etat: 'fait', debut: T0, fin: T0 + 1000 })])
    const frise = calculerFrise(p, T0 + 2000)
    expect(frise ? frise.fin - frise.debut : 0).toBe(DUREE_MIN_AXE_MS)
    expect(frise?.barres.get(1)?.largeur).toBeGreaterThanOrEqual(0.8)
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
