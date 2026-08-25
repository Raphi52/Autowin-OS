import { describe, expect, it } from 'vitest'
import { battementDeVerification } from './verify-battement'

/**
 * LA LIGNE DE VIE d'une vérification en cours — ce que le fil affiche pendant l'attente.
 *
 * DÉFAUT VÉCU le 2026-08-25 (conv-1400) : dix minutes de « 1 action en cours » sans une ligne de
 * plus. Le signal doit répondre à la seule question que l'utilisateur se pose devant l'écran :
 * « est-ce que ça avance, et depuis combien de temps ? ».
 */
describe('battementDeVerification', () => {
  it('rend la dernière ligne utile de la sortie, avec le temps écoulé', () => {
    const sortie = ['✓ src/a.test.ts (12)', '', '✓ src/b.test.ts (8)', '   '].join('\n')

    expect(battementDeVerification(sortie, 200_000)).toBe('3 min 20 s · ✓ src/b.test.ts (8)')
  })

  it('sans aucune sortie, le temps écoulé suffit à prouver que ça tourne', () => {
    expect(battementDeVerification('', 45_000)).toBe('45 s · démarrage…')
  })

  it('borne une ligne trop longue pour ne pas déformer le fil', () => {
    const ligne = 'x'.repeat(300)

    const battement = battementDeVerification(ligne, 1_000)

    expect(battement.length).toBeLessThanOrEqual(140)
    expect(battement).toContain('…')
  })

  it('ignore les retours chariot que vitest écrit pour réécrire sa ligne', () => {
    // vitest repeint sa ligne d'avancement avec \r : sans ce traitement, le battement affiche
    // plusieurs états concaténés et devient illisible.
    const sortie = 'Tests 10/900\rTests 411/900\rTests 412/900'

    expect(battementDeVerification(sortie, 60_000)).toBe('1 min · Tests 412/900')
  })
})
