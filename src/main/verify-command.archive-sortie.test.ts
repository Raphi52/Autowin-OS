import { describe, expect, it } from 'vitest'
import { capVerifyOutput } from './verify-command'

/**
 * CE QUI DEPASSE LE PLAFOND NE DOIT PLUS DISPARAITRE.
 *
 * Mesure du 2026-09-16 sur `.autowin-data/autowin-os/causal-trace/*.jsonl` : 25 sorties de `run`
 * tronquées, 2 434 771 caractères jetés — dont 1 826 011 d'un seul coup — sans aucun moyen de les
 * relire, d'où des commandes REJOUÉES juste pour retrouver leur fin.
 */
describe('capVerifyOutput — la partie omise devient récupérable', () => {
  const enorme = 'x'.repeat(50_000) + '\nFIN DE SORTIE'

  it('nomme le fichier d’archive dans le marqueur de troncature', () => {
    const vus: string[] = []
    const rendu = capVerifyOutput(enorme, 4_000, (texte) => {
      vus.push(texte)
      return 'C:/donnees/sorties/2026-09-16.txt'
    })
    expect(rendu).toContain('sortie complète : C:/donnees/sorties/2026-09-16.txt')
    expect(rendu).toContain('caractères omis')
    // L'archive reçoit le texte ENTIER, pas la version déjà coupée.
    expect(vus).toHaveLength(1)
    expect(vus[0].length).toBeGreaterThan(49_000)
    expect(vus[0]).toContain('FIN DE SORTIE')
  })

  it('garde le plafond : l’archive n’autorise pas une sortie plus grosse', () => {
    const rendu = capVerifyOutput(enorme, 4_000, () => 'C:/donnees/sorties/a.txt')
    expect(rendu.length).toBeLessThanOrEqual(4_000)
  })

  it('n’archive rien quand il n’y a pas de troncature', () => {
    let appele = false
    const rendu = capVerifyOutput('court', 4_000, () => {
      appele = true
      return 'C:/x.txt'
    })
    expect(rendu).toBe('court')
    expect(appele).toBe(false)
  })

  it('reste muet — et ne jette pas — quand l’archivage échoue (disque plein)', () => {
    const rendu = capVerifyOutput(enorme, 4_000, () => {
      throw new Error('ENOSPC')
    })
    expect(rendu).toContain('caractères omis')
    expect(rendu).not.toContain('sortie complète')
  })

  it('sans archiviste, le comportement d’avant est INCHANGÉ', () => {
    expect(capVerifyOutput(enorme, 4_000)).toContain('…[tronqué — ')
    expect(capVerifyOutput(enorme, 4_000)).not.toContain('sortie complète')
  })
})
