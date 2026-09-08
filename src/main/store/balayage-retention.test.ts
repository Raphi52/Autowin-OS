import { describe, expect, it } from 'vitest'
import {
  PLAFOND_PAR_PASSAGE,
  planifierBalayage,
  type EntreeBalayage
} from './balayage-retention'

/**
 * LE PLAN D'UN BALAYAGE DE RETENTION.
 *
 * Entrees qui feraient echouer ces tests si le balayage etait dangereux :
 *  - un `supprimable-perime` glisse dans `aSupprimer` : on detruirait du travail que personne n'a
 *    lu, la branche etant condamnee par son seul age ;
 *  - un marqueur `trie` supprime : on rejouerait un tri deja fait a la main ;
 *  - un SHA non consigne supprime : on effacerait ce dont il ne reste aucune trace ;
 *  - un plafond ignore : c'est le defaut du 2026-08-24, ou un balayage sans plafond a recree
 *    682 Mo en rejouant vingt-et-une copies impubliables.
 */
const JOUR = 24 * 60 * 60 * 1_000
const base = (p: Partial<EntreeBalayage>): EntreeBalayage => ({
  nom: 'x',
  famille: 'branche',
  apporteQuelqueChose: true,
  shaConsigne: true,
  ...p
})

describe('planifierBalayage', () => {
  it('n’agit QUE sur le sans-perte — le perime est SIGNALE, jamais supprime', () => {
    const plan = planifierBalayage([
      base({ nom: 'doublon', apporteQuelqueChose: false }),
      base({ nom: 'vieux-porteur', ageMs: 90 * JOUR })
    ])
    expect(plan.aSupprimer.map((e) => e.nom)).toEqual(['doublon'])
    expect(plan.aSignaler.map((e) => e.nom)).toEqual(['vieux-porteur'])
  })

  it('ne touche JAMAIS un marqueur `trie`, meme vieux et sans apport', () => {
    const plan = planifierBalayage([
      base({ nom: 'trie/run-1', famille: 'trie', apporteQuelqueChose: false, ageMs: 90 * JOUR })
    ])
    expect(plan.aSupprimer).toEqual([])
    expect(plan.aSignaler).toEqual([])
  })

  it('ne touche JAMAIS un SHA non consigne — il n’en resterait aucune trace', () => {
    const plan = planifierBalayage([
      base({ nom: 'inconnu', apporteQuelqueChose: false, shaConsigne: false })
    ])
    expect(plan.aSupprimer).toEqual([])
  })

  it('PLAFONNE chaque passage et reporte le reste, au lieu de tout consommer d’un coup', () => {
    const lot = Array.from({ length: PLAFOND_PAR_PASSAGE + 7 }, (_, i) =>
      base({ nom: `doublon-${i}`, apporteQuelqueChose: false })
    )
    const plan = planifierBalayage(lot)
    expect(plan.aSupprimer).toHaveLength(PLAFOND_PAR_PASSAGE)
    expect(plan.reportees).toBe(7)
  })

  it('le plafond ne s’applique PAS aux signalements — un rapport tronque cacherait une perte', () => {
    const lot = Array.from({ length: PLAFOND_PAR_PASSAGE + 5 }, (_, i) =>
      base({ nom: `vieux-${i}`, ageMs: 90 * JOUR })
    )
    const plan = planifierBalayage(lot)
    expect(plan.aSignaler).toHaveLength(PLAFOND_PAR_PASSAGE + 5)
    expect(plan.aSupprimer).toEqual([])
  })

  it('un etat sain ne produit AUCUN geste', () => {
    const plan = planifierBalayage([base({ nom: 'recent', ageMs: 2 * JOUR })])
    expect(plan).toEqual({ aSupprimer: [], aSignaler: [], reportees: 0 })
  })
})
