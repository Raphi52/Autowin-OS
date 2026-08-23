import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { libelleTravail } from './TravauxNonPublies'

describe('nommer un travail non publié dans la liste', () => {
  it('montre le chemin complet — dans une liste, on a la place, contrairement au bandeau', () => {
    expect(
      libelleTravail({ agentId: 'x', date: '2026-08-20', fichiers: ['src/main/activity/spool.ts'] })
    ).toBe('src/main/activity/spool.ts')
  })

  it('dit combien de fichiers accompagnent le premier', () => {
    expect(libelleTravail({ agentId: 'x', date: '', fichiers: ['a.ts', 'b.ts', 'c.ts'] })).toBe(
      'a.ts +2 fichiers'
    )
  })

  it('retombe sur l’identifiant quand les fichiers sont inconnus, jamais sur du vide', () => {
    expect(libelleTravail({ agentId: 'run-7', date: '', fichiers: [] })).toBe('run-7')
  })
})

describe('le panneau ne peut RIEN casser', () => {
  /**
   * Garde MÉCANIQUE, pas une promesse. Ce panneau existe pour qu'on puisse LIRE un travail avant
   * d'en décider ; s'il gagnait un jour un bouton « fusionner » ou « abandonner », il deviendrait
   * capable de détruire du travail non publié depuis un simple survol de liste. Ce test échoue
   * alors, et c'est le but.
   */
  it('n’appelle aucune API DESTRUCTRICE — réintégrer est permis, détruire ne l’est pas', () => {
    const source = readFileSync('src/renderer/src/components/TravauxNonPublies.tsx', 'utf8')
    for (const interdit of [
      // `retryWorktreeRecovery` est VOLONTAIREMENT absent de cette liste depuis le 2026-08-23 :
      // réintégrer un travail ne détruit rien, et c'était le geste qui manquait. Ces quatre-là, en
      // revanche, suppriment, écrasent ou tranchent un conflit — ils n'ont rien à faire dans une vue
      // dont le rôle est de MONTRER avant de décider.
      'resolveWorktreeConflict',
      'discardHeldWorktree',
      'preserveReleaseWorktree',
      'removeWorktree'
    ]) {
      expect(source).not.toContain(interdit)
    }
  })
})
