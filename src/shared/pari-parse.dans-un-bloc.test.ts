import { describe, expect, it } from 'vitest'
import { extrairePari as p } from './pari-parse'

// Migré de scripts/arena-panel/p9-pari-dans-un-bloc.mts (banc /arena, commit 191ab51d), retiré le
// 2026-10-22 (residus, conv-1062). Défaut d'origine : un EXEMPLE de pari cité dans un bloc ~~~,
// ou dans un ```` contenant ```, comptait comme vrai pari dans le score de calibration.
const L = (c: number, r: string): string =>
  `AUTOWIN_PARI_V1: {"confiance":${c},"refutateur":"${r}"}`

describe('extrairePari — un exemple dans un bloc de code n’est pas un pari', () => {
  it('dans un bloc ~~~, et ~~~ dans un ~~~~ ne ferme pas', () => {
    expect(p(`~~~\n${L(0.99, 'ex')}\n~~~`)).toBeNull()
    expect(p(`~~~~\n~~~\n${L(0.99, 'ex')}\n~~~~`)).toBeNull()
  })
  it('``` dans un ```` ne ferme pas', () => {
    expect(p(`\`\`\`\`md\n\`\`\`\n${L(0.99, 'ex')}\n\`\`\`\``)).toBeNull()
  })
  it('le vrai pari après un bloc fermé, ou hors bloc, est lu', () => {
    expect(p(`~~~\n${L(0.99, 'ex')}\n~~~\n${L(0.6, 'vrai')}`)).toEqual({
      confiance: 0.6,
      refutateur: 'vrai'
    })
    expect(p(L(0.7, 'x'))).toEqual({ confiance: 0.7, refutateur: 'x' })
    expect(p(`\`\`\`\n${L(0.9, 'ex')}\n\`\`\``)).toBeNull()
  })
})
