import { describe, expect, it } from 'vitest'
import { DELAIS_REPRISE, delaiDeReprise, ESSAIS_MAX } from './delai-de-reprise'

/**
 * LE DÉFAUT, mesuré le 2026-08-23 : la fenêtre de rattrapage d'une intégration refusée faisait
 * TRENTE SECONDES — six essais espacés de cinq secondes — après quoi le travail était abandonné
 * définitivement.
 *
 * Or le code lui-même écrit (`worktree-manager.ts`) : « 216 refus base-in-progress contre 86
 * base-dirty, parce que l'utilisateur travaille en continu dans la base — ce refus est la NORME,
 * pas l'exception ». Un arbre occupé se libère en minutes ; on lui accordait une demi-minute.
 *
 * Ces tests tiennent les DEUX exigences contradictoires, et c'est tout l'enjeu : patienter beaucoup
 * plus longtemps, ET s'arrêter pour de bon. Une minuterie mal bornée est le vrai danger ici.
 */
describe('combien de temps attendre avant de réessayer une intégration', () => {
  it('patiente BIEN au-delà des trente secondes d’avant', () => {
    const cumul = DELAIS_REPRISE.reduce((total, delai) => total + delai, 0)
    expect(cumul).toBeGreaterThan(10 * 60_000)
    // Le repère qu'on quitte : 6 × 5 s.
    expect(cumul).toBeGreaterThan(30_000 * 20)
  })

  it('réagit toujours VITE au premier essai — une occupation d’une seconde ne doit pas coûter une minute', () => {
    expect(delaiDeReprise(0)).toBeLessThanOrEqual(5_000)
  })

  it('allonge le délai à chaque essai, jamais l’inverse', () => {
    for (let essai = 1; essai < DELAIS_REPRISE.length; essai += 1) {
      expect(delaiDeReprise(essai)).toBeGreaterThan(delaiDeReprise(essai - 1) as number)
    }
  })

  it('S’ARRÊTE : passé le plafond, plus aucun délai n’est proposé', () => {
    expect(delaiDeReprise(ESSAIS_MAX)).toBeNull()
    expect(delaiDeReprise(ESSAIS_MAX + 50)).toBeNull()
  })

  it('plafonne chaque attente — jamais d’attente absurde entre deux essais', () => {
    for (const delai of DELAIS_REPRISE) expect(delai).toBeLessThanOrEqual(30 * 60_000)
  })

  it('ne jette pas sur une entrée aberrante et ne rend jamais un délai négatif', () => {
    expect(delaiDeReprise(-1)).toBe(DELAIS_REPRISE[0])
    expect(() => delaiDeReprise(Number.NaN)).not.toThrow()
  })
})
