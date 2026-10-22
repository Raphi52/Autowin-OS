import { describe, expect, it } from 'vitest'
import { separationEntreBlocsTexte as s } from './collage-blocs-texte'

// Migré de scripts/arena-panel/p12-collage-fences.mts (banc /arena, commit 191ab51d), retiré le
// 2026-10-22 (residus, conv-1062). Défaut d'origine : les délimiteurs ``` et ~~~ étaient comptés
// ensemble, par parité ; un ~~~ cité DANS un bloc ``` passait pour une fermeture, et « \n\n »
// était inséré au milieu du code affiché.
describe('separationEntreBlocsTexte — blocs imbriqués', () => {
  it('un délimiteur d’une autre sorte, ou plus court, ne ferme pas le bloc', () => {
    expect(s('```md\n~~~\nligne.', 'Suite')).toBe('')
    expect(s('````\n```\nligne.', 'Suite')).toBe('')
    expect(s('~~~\n```\nligne.', 'Suite')).toBe('')
  })
  it('les cas ordinaires sont inchangés', () => {
    expect(s('```\ncode\n```\nFin.', 'Suite')).toBe('\n\n')
    expect(s('```\ncode.', 'Suite')).toBe('')
    expect(s('Fin.', 'Suite')).toBe('\n\n')
    expect(s('Fin.', '```js\nx')).toBe('\n\n')
  })
})
