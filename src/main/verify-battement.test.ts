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
  /*
   * DEFAUT VECU le 2026-08-25 (conv-1404). Le fil affichait « 9 min 27 s · <ESC>[33m<ESC>[2m … e2e —
   * du message de chat a la mutation prouvee » : les codes de couleur de vitest s'affichaient TELS
   * QUELS. Deux degats, pas un : ils salissent la ligne, ET ils consomment le budget de largeur,
   * donc le texte utile est coupe bien avant sa vraie longueur.
   *
   * `String.fromCharCode(27)` plutot qu'un echappement ecrit a la main : ce depot a deja paye le
   * prix d'un caractere de controle fige en dur par un patch (`SAUT`, `ANTISLASH`).
   */
  const ESC = String.fromCharCode(27)
  const colore = (texte: string, code: string): string =>
    ESC + '[' + code + 'm' + texte + ESC + '[39m'

  it('ne laisse passer AUCUN code de couleur du terminal', () => {
    const sortie = colore(' e2e — du message de chat a la mutation prouvee', '33')

    expect(battementDeVerification(sortie, 5_000)).not.toContain(ESC)
  })

  it("mesure sa largeur sur le texte VISIBLE, pas sur les octets d'echappement", () => {
    const utile = 'x'.repeat(100)
    const bruite = utile
      .split('')
      .map((c) => colore(c, '32'))
      .join('')

    expect(battementDeVerification(bruite, 5_000)).toBe('5 s · ' + utile)
  })
})
