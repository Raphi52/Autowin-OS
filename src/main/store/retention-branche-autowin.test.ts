import { describe, expect, it } from 'vitest'
import { WorktreeManager } from './worktree-manager'

/**
 * LA RETENTION DES BRANCHES `autowin/*` — decision seule, aucune suppression.
 *
 * Contexte mesure le 2026-09-08 sur le depot reel : 89 branches de secours accumulees en 22 jours,
 * aucune politique de retention dans le code, et un tri complet par contenu qui n'a rendu AUCUN
 * fichier recuperable. Le stock grossissait donc sans fin pour une valeur nulle.
 *
 * Entrees qui feraient echouer ces tests si la regle etait fausse :
 *  - une branche non consignee jugee supprimable (on perdrait le seul exemplaire du travail) ;
 *  - un doublon garde quatorze jours (le stock ne se viderait jamais) ;
 *  - un age illisible traite comme perime (on detruirait sur une donnee non lue).
 */
const JOUR = 24 * 60 * 60 * 1_000

describe('decisionRetentionBranche', () => {
  it('GARDE tant que le SHA n’est pas consigne, meme vieux et meme sans apport', () => {
    expect(
      WorktreeManager.decisionRetentionBranche({
        apporteQuelqueChose: false,
        shaConsigne: false,
        ageMs: 90 * JOUR
      })
    ).toBe('garder')
  })

  it('declare supprimable SANS PERTE ce qui n’apporte rien, sans attendre le delai', () => {
    expect(
      WorktreeManager.decisionRetentionBranche({
        apporteQuelqueChose: false,
        shaConsigne: true,
        ageMs: 0
      })
    ).toBe('supprimable-sans-perte')
  })

  it('garde un travail porteur AVANT le delai, et le declare perime APRES', () => {
    const porteur = { apporteQuelqueChose: true, shaConsigne: true }
    expect(
      WorktreeManager.decisionRetentionBranche({ ...porteur, ageMs: 13 * JOUR })
    ).toBe('garder')
    // Le bord exact : a quatorze jours pile, on garde encore.
    expect(
      WorktreeManager.decisionRetentionBranche({
        ...porteur,
        ageMs: WorktreeManager.RETENTION_BRANCHE_MS
      })
    ).toBe('garder')
    expect(
      WorktreeManager.decisionRetentionBranche({ ...porteur, ageMs: 15 * JOUR })
    ).toBe('supprimable-perime')
  })

  it('FAIL-CLOSED : un age absent, illisible ou futur ne perime jamais', () => {
    const porteur = { apporteQuelqueChose: true, shaConsigne: true }
    expect(WorktreeManager.decisionRetentionBranche(porteur)).toBe('garder')
    expect(WorktreeManager.decisionRetentionBranche({ ...porteur, ageMs: Number.NaN })).toBe(
      'garder'
    )
    expect(WorktreeManager.decisionRetentionBranche({ ...porteur, ageMs: -1 })).toBe('garder')
  })

  it('la retention vaut QUATORZE jours — un delai de trente rouvrirait le stock', () => {
    expect(WorktreeManager.RETENTION_BRANCHE_MS).toBe(14 * JOUR)
  })
})
