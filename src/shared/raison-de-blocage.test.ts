import { describe, expect, it } from 'vitest'
import { raisonDeBlocageIntegration } from './raison-de-blocage'

describe('une finalisation non fusionnée ne peut pas rester muette', () => {
  it('rend la CATÉGORIE, la cause et les fichiers quand l’issue les porte', () => {
    expect(
      raisonDeBlocageIntegration({
        outcome: 'blocked',
        reason: 'base-dirty',
        detail: 'la base porte du travail non commité',
        files: ['src/a.ts', 'src/b.ts']
      })
    ).toBe(
      'blocage d’intégration: base-dirty — cause: la base porte du travail non commité — ' +
        'fichiers en cause: src/a.ts, src/b.ts'
    )
  })

  // LE CAS VÉCU (conv-1, run « reprend-pardon-mthg437j », 2,13 $) : une issue SANS `reason`.
  it('sans reason, nomme l’issue OBSERVÉE et avoue que la cause manque', () => {
    const raison = raisonDeBlocageIntegration({ outcome: 'kept', files: ['src/a.ts'] })
    expect(raison).toContain('kept')
    expect(raison).toContain('aucune cause')
    expect(raison).toContain('src/a.ts')
  })

  it('sans reason NI outcome, le dit — jamais une chaîne vide', () => {
    expect(raisonDeBlocageIntegration({})).toBe(
      'blocage d’intégration: aucune cause NI issue rendue par la finalisation'
    )
  })

  it('issue ABSENTE ou de forme inconnue : encore une phrase, jamais un silence', () => {
    for (const entree of [undefined, null, 'merged', 42]) {
      expect(raisonDeBlocageIntegration(entree)).toBe(
        'blocage d’intégration: aucune issue rendue par la finalisation'
      )
    }
  })

  it('borne la cause à 300 caractères — une sortie git entière rendrait le journal illisible', () => {
    const raison = raisonDeBlocageIntegration({
      outcome: 'blocked',
      reason: 'merge-failed',
      detail: 'x'.repeat(1_000)
    })
    expect(raison).toContain('...')
    expect(raison.length).toBeLessThan(360)
  })

  it('le retour n’est JAMAIS vide, quelle que soit l’entrée', () => {
    const entrees: unknown[] = [
      undefined,
      {},
      { outcome: '' },
      { reason: '' },
      { outcome: '   ' },
      { outcome: 'conflict' }
    ]
    for (const entree of entrees)
      expect(raisonDeBlocageIntegration(entree).trim().length).toBeGreaterThan(0)
  })
})
