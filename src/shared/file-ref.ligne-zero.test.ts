import { describe, expect, it } from 'vitest'
import { parseFileRef as p } from './file-ref'

// Migré de scripts/arena-panel/p5-ligne-zero.mts (banc /arena, commit 191ab51d), retiré le
// 2026-10-22 (residus, conv-1062). `file-ref.test.ts` ne couvre que « a.ts:0 » ; les variantes
// ci-dessous n'étaient gardées que par ce script.
describe('parseFileRef — ligne zéro et numéros invalides', () => {
  it('une ligne 0, même écrite 00 ou suivie d’une colonne, donne le fichier sans ligne', () => {
    expect(p('a.ts:00')).toEqual({ path: 'a.ts', line: undefined })
    expect(p('a.ts:0:5')).toEqual({ path: 'a.ts', line: undefined })
  })
  it('un numéro négatif n’est pas une référence', () => {
    expect(p('a.ts:-1')).toBeNull()
  })
  it('les lignes réelles sont inchangées', () => {
    expect(p('a.ts:1')).toEqual({ path: 'a.ts', line: 1 })
    expect(p('src/a.ts:12:5')).toEqual({ path: 'src/a.ts', line: 12 })
  })
})
